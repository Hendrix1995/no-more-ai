// 판별 결과에 따라 플레이리스트 항목을 숨기고, AI 곡이 재생되면 다음 곡으로 넘긴다.
(() => {
  const D = globalThis.NMADetector;
  const Y = globalThis.NMAYouTube;

  const VIDEO_TTL = 7 * 24 * 60 * 60 * 1000;
  const CHANNEL_TTL = 24 * 60 * 60 * 1000;
  const MAX_CONSECUTIVE_SKIPS = 15;
  const FETCH_CONCURRENCY = 2;
  const RETRY_MIN_MS = 5000;
  const RETRY_MAX_MS = 5 * 60 * 1000;
  const SKIP_RETRY_MS = 3000;

  let settings = null;
  const videoFacts = new Map(); // videoId -> facts
  const channelFacts = new Map(); // channelId -> facts
  const verdicts = new Map(); // videoId -> { ai, reasons } (전체 검사 결과만 저장)
  const inflight = new Map(); // videoId -> Promise<verdict>
  const failures = new Map(); // videoId -> { delay, retryAt } 현재 곡 검사 실패. 다시 멈추지 않고 폴링에서 재검사한다.
  const queue = [];
  let running = 0;

  let handledId = null;
  let gateId = null; // 판정이 끝날 때까지 일시정지해 둔 영상 ID
  let skipCount = 0;
  let consecutiveSkips = 0;
  let scanTimer = null;
  let pendingSkip = null; // { id, retryAt } 다음 곡으로 아직 이동하지 못한 AI 곡
  let pollTimer = null;
  let observer = null;

  // ---------- 캐시 ----------

  async function readCached(map, key, ttl, fetcher) {
    const mem = map.get(key);
    if (mem && Date.now() - mem.fetchedAt < ttl) return mem;
    const storageKey = (map === videoFacts ? 'v:' : 'c:') + key;
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    if (stored && Date.now() - stored.fetchedAt < ttl) {
      map.set(key, stored);
      return stored;
    }
    const fresh = await fetcher(key);
    map.set(key, fresh);
    await chrome.storage.local.set({ [storageKey]: fresh });
    return fresh;
  }

  const getVideoFacts = (id) => readCached(videoFacts, id, VIDEO_TTL, Y.fetchVideoFacts);
  const getChannelFacts = (id) => readCached(channelFacts, id, CHANNEL_TTL, Y.fetchChannelFacts);

  async function pruneCache() {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const expired = Object.keys(all).filter(
      (k) =>
        (k.startsWith('v:') && now - all[k].fetchedAt >= VIDEO_TTL) ||
        (k.startsWith('c:') && now - all[k].fetchedAt >= CHANNEL_TTL)
    );
    if (expired.length) await chrome.storage.local.remove(expired);
  }

  // ---------- 판별 ----------

  function quickVerdict(hint) {
    return D.evaluate({ title: hint.title, channelName: hint.channelName }, settings);
  }

  function knownVerdict(videoId, hint) {
    const v = verdicts.get(videoId);
    if (v) return v;
    if (hint) {
      const q = quickVerdict(hint);
      if (q.ai) return q;
    }
    return null;
  }

  async function computeVerdict(videoId, hint) {
    if (hint) {
      const q = quickVerdict(hint);
      if (q.ai) return q;
    }
    const vf = await getVideoFacts(videoId);
    const facts = { ...vf };
    let v = D.evaluate(facts, settings);
    if (v.ai || !settings.useUploadRate || !vf.channelId || D.isTopicChannel(vf.channelName)) return v;
    if (D.findChannel(settings.allowedChannels, vf.channelId, vf.channelName)) return v;
    const cf = await getChannelFacts(vf.channelId);
    facts.recentUploads = cf.recentUploads;
    return D.evaluate(facts, settings);
  }

  function getVerdict(videoId, hint) {
    if (verdicts.has(videoId)) return Promise.resolve(verdicts.get(videoId));
    if (inflight.has(videoId)) return inflight.get(videoId);
    const p = computeVerdict(videoId, hint)
      .then((v) => {
        verdicts.set(videoId, v);
        return v;
      })
      .finally(() => inflight.delete(videoId));
    inflight.set(videoId, p);
    return p;
  }

  function enqueue(item) {
    if (verdicts.has(item.videoId) || inflight.has(item.videoId)) return;
    if (queue.some((q) => q.videoId === item.videoId)) return;
    queue.push({ videoId: item.videoId, title: item.title, channelName: item.channelName });
    pump();
  }

  function pump() {
    while (running < FETCH_CONCURRENCY && queue.length) {
      const job = queue.shift();
      running++;
      getVerdict(job.videoId, job)
        .catch((e) => console.warn('[No More AI] 검사 실패', job.videoId, e))
        .finally(() => {
          running--;
          scheduleScan();
          pump();
        });
    }
  }

  // ---------- 재생 제어 ----------

  function pauseVideo() {
    const video = Y.videoElement();
    if (video && !video.paused) video.pause();
  }

  // 판정이 나지 않은 곡은 소리가 나기 전에 멈춰 두고, 통과하면 다시 재생한다.
  function onPlay(e) {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement) || !video.closest('#movie_player')) return;
    if (!contextAlive()) {
      teardown();
      return;
    }
    if (settings && !settings.enabled) return;
    const id = Y.currentVideoId();
    if (!id) return;
    const v = verdicts.get(id);
    if (v && !v.ai) return;
    if (!v && failures.has(id)) return; // 검사에 실패한 곡은 막아 두지 않는다
    video.pause();
    gateId = id;
    handleCurrent();
  }

  function releaseGate(id) {
    if (!gateId || (id && gateId !== id)) return;
    gateId = null;
    const video = Y.videoElement();
    if (video && video.paused) video.play().catch(() => {});
  }

  function toast(message) {
    if (!document.body) return;
    let box = document.getElementById('nma-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'nma-toast';
      Object.assign(box.style, {
        position: 'fixed',
        left: '24px',
        bottom: '24px',
        zIndex: 99999,
        maxWidth: '420px',
        padding: '10px 14px',
        borderRadius: '8px',
        background: 'rgba(20,20,20,0.92)',
        color: '#fff',
        font: '13px/1.4 Roboto, Arial, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        transition: 'opacity 0.3s',
      });
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.style.opacity = '1';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => (box.style.opacity = '0'), 4000);
  }

  function findNextPlayable(fromVideoId) {
    const items = Y.getPanelItems();
    if (!items.length) return { hasPlaylist: false, next: null };
    let idx = items.findIndex((i) => i.videoId === fromVideoId);
    if (idx < 0) idx = items.findIndex((i) => i.selected);
    for (const item of items.slice(idx + 1)) {
      const v = knownVerdict(item.videoId, item);
      if (!v || !v.ai) return { hasPlaylist: true, next: item };
    }
    return { hasPlaylist: true, next: null };
  }

  function skip(videoId, verdict) {
    gateId = null;
    pendingSkip = null;
    pauseVideo();
    skipCount++;
    consecutiveSkips++;
    if (consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
      toast('연속으로 너무 많은 곡이 걸러져 재생을 멈췄습니다.');
      return;
    }
    toast(`AI 음악을 건너뛰었습니다 (${verdict.reasons.join(', ')})`);
    moveNext(videoId);
  }

  // 다음 곡으로 이동을 시도한다. 패널·다음 버튼이 아직 없거나(첫 로드) 클릭해도 이동하지 않으면
  // pendingSkip에 남겨 폴링에서 다시 시도한다.
  function moveNext(videoId) {
    const { hasPlaylist, next } = findNextPlayable(videoId);
    if (hasPlaylist && !next) {
      pendingSkip = null;
      toast('남은 곡이 모두 AI 음악으로 판별되어 재생을 멈췄습니다.');
      return;
    }
    let moved = false;
    if (next) {
      next.anchor.click();
      moved = true;
    } else {
      const nextButton = document.querySelector('.ytp-next-button');
      if (nextButton && nextButton.offsetParent !== null) {
        nextButton.click();
        moved = true;
      }
    }
    pendingSkip = { id: videoId, retryAt: Date.now() + (moved ? SKIP_RETRY_MS : 0) };
  }

  async function handleCurrent() {
    if (!contextAlive()) {
      teardown();
      return;
    }
    if (!settings) return;
    if (!settings.enabled) {
      releaseGate();
      return;
    }
    const id = Y.currentVideoId();
    if (!id) return;
    if (id === handledId) {
      if (pendingSkip && pendingSkip.id === id && Date.now() >= pendingSkip.retryAt) {
        pauseVideo();
        moveNext(id);
      }
      const f = failures.get(id);
      if (!f || Date.now() < f.retryAt || inflight.has(id)) return;
    }
    handledId = id;

    const hint = Y.getPanelItems().find((i) => i.videoId === id);
    const known = knownVerdict(id, hint);
    if (known && known.ai) {
      skip(id, known);
      return;
    }

    let verdict;
    try {
      verdict = await getVerdict(id, hint);
    } catch (e) {
      if (!contextAlive()) {
        teardown();
        return;
      }
      console.warn('[No More AI] 현재 곡 검사 실패', id, e);
      // 같은 곡을 다시 멈추지 않도록 실패를 기록하고, 재검사는 폴링에서 백오프를 두고 한다.
      const prev = failures.get(id);
      const delay = prev ? Math.min(RETRY_MAX_MS, prev.delay * 2) : RETRY_MIN_MS;
      failures.set(id, { delay, retryAt: Date.now() + delay });
      releaseGate(id);
      return;
    }
    failures.delete(id);
    const now = Y.currentVideoId();
    if (now !== id) {
      // 다른 영상으로 바뀌었으면 그쪽 처리에 맡긴다. 플레이어가 사라졌으면 사람 곡의 게이트만 푼다.
      if (!now && !verdict.ai) releaseGate(id);
      return;
    }
    if (verdict.ai) {
      skip(id, verdict);
    } else {
      consecutiveSkips = 0;
      releaseGate(id);
    }
    scheduleScan();
  }

  // ---------- 플레이리스트 패널 ----------

  function applyMark(item, verdict) {
    if (verdict && verdict.ai) {
      if (item.el.dataset.nmaHidden !== '1') {
        item.el.dataset.nmaHidden = '1';
        item.el.style.display = 'none';
      }
    } else if (item.el.dataset.nmaHidden === '1') {
      delete item.el.dataset.nmaHidden;
      item.el.style.display = '';
    }
  }

  function scanPanel() {
    scanTimer = null;
    if (!settings || !contextAlive()) return;
    const items = Y.getPanelItems();
    if (!items.length) return;

    for (const item of items) {
      applyMark(item, settings.enabled ? knownVerdict(item.videoId, item) : null);
    }
    if (!settings.enabled) return;

    const current = Y.currentVideoId();
    let idx = items.findIndex((i) => i.videoId === current);
    if (idx < 0) idx = items.findIndex((i) => i.selected);
    items
      .slice(idx + 1)
      .filter((i) => !knownVerdict(i.videoId, i))
      .slice(0, settings.lookahead)
      .forEach(enqueue);
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(scanPanel, 500);
  }

  // ---------- 초기화 ----------

  function onSettingsChanged() {
    verdicts.clear();
    queue.length = 0;
    handledId = null;
    consecutiveSkips = 0;
    scheduleScan();
    handleCurrent();
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes).some((k) => NMA_SETTING_KEYS.includes(k))) return;
    settings = await nmaLoadSettings();
    onSettingsChanged();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'getStatus') return;
    const id = Y.currentVideoId();
    if (!id) {
      sendResponse({ videoId: null, skipCount });
      return;
    }
    Promise.all([getVideoFacts(id), getVerdict(id)])
      .then(([vf, verdict]) =>
        sendResponse({ videoId: id, channelId: vf.channelId, channelName: vf.channelName, verdict, skipCount })
      )
      .catch((e) => sendResponse({ videoId: id, error: String(e), skipCount }));
    return true;
  });

  function onNavigate() {
    handleCurrent();
    scheduleScan();
  }

  // 확장을 업데이트·리로드하면 열려 있던 탭의 기존 content script는 chrome API를 쓸 수 없게 된다.
  function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // 무효화된 content script를 정리한다. AI로 판정되지 않은 곡의 게이트는 풀어 둔다.
  function teardown() {
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('yt-navigate-finish', onNavigate);
    clearInterval(pollTimer);
    clearTimeout(scanTimer);
    if (observer) observer.disconnect();
    if (gateId && !verdicts.get(gateId)?.ai) releaseGate();
  }

  async function init() {
    // media 이벤트는 버블링되지 않으므로 캡처 단계에서 받는다. 설정 로드보다 먼저 등록한다.
    document.addEventListener('play', onPlay, true);
    settings = await nmaLoadSettings();
    pruneCache().catch(() => {});

    document.addEventListener('yt-navigate-finish', onNavigate);
    pollTimer = setInterval(handleCurrent, 1000);
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    handleCurrent();
    scheduleScan();
  }

  init();
})();
