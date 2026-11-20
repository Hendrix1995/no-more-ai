// YouTube / YouTube Music 페이지와 데이터 접근.
// 판별에 쓰는 영상 정보는 두 사이트 모두 www.youtube.com 시청 페이지에서 읽는다.
(function (root) {
  const D = root.NMADetector;
  const ORIGIN = 'https://www.youtube.com';
  const IS_MUSIC = typeof location !== 'undefined' && location.hostname === 'music.youtube.com';

  async function fetchHtml(path) {
    const res = await fetch(ORIGIN + path, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return res.text();
  }

  async function fetchVideoFacts(videoId) {
    const html = await fetchHtml(`/watch?v=${encodeURIComponent(videoId)}&hl=en`);
    const player = D.extractJsonAfter(html, ['var ytInitialPlayerResponse = ', 'ytInitialPlayerResponse = ']);
    const vd = (player && player.videoDetails) || {};
    // AI 공개 라벨은 ytInitialData의 "How this was made" 섹션에 있다. 섹션이 없으면 큰 JSON을 파싱하지 않는다.
    const data = html.includes('howThisWasMadeSectionViewModel')
      ? D.extractJsonAfter(html, ['var ytInitialData = ', 'window["ytInitialData"] = '])
      : null;
    return {
      videoId,
      title: vd.title || '',
      channelId: vd.channelId || '',
      channelName: vd.author || '',
      description: (vd.shortDescription || '').slice(0, 2000),
      tags: (vd.keywords || []).slice(0, 50),
      syntheticLabel: data ? D.hasAiDisclosure(data) : false,
      fetchedAt: Date.now(),
    };
  }

  async function fetchChannelFacts(channelId) {
    const html = await fetchHtml(`/channel/${encodeURIComponent(channelId)}/videos?hl=en`);
    const data = D.extractJsonAfter(html, ['var ytInitialData = ', 'window["ytInitialData"] = ']);
    return {
      channelId,
      recentUploads: data ? D.countRecentUploads(data) : 0,
      fetchedAt: Date.now(),
    };
  }

  // music.youtube.com의 content script는 www.youtube.com을 직접 fetch할 수 없어(CORS) 백그라운드에 맡긴다.
  function viaBackground(kind) {
    return async (id) => {
      const res = await chrome.runtime.sendMessage({ type: 'nma-fetch', kind, id });
      if (!res || res.error) throw new Error(res?.error || 'no response from background');
      return res.facts;
    };
  }

  // 플레이어가 실제로 재생 중인 영상 ID. 페이지 world의 player-bridge.js가 getVideoData()로 답한다.
  function playerVideoId() {
    document.dispatchEvent(new CustomEvent('nma-request-video-id'));
    return document.documentElement.getAttribute('data-nma-video-id') || null;
  }

  // SPA 전환 중에는 URL보다 플레이어가 먼저 바뀌고, 미니플레이어에서는 URL이 /watch가 아니므로 플레이어 기준으로 구한다.
  function currentVideoId() {
    const onWatch = location.pathname === '/watch';
    const urlId = onWatch ? new URLSearchParams(location.search).get('v') : null;
    // YouTube Music은 재생 화면을 닫아도 하단 플레이어 바에서 계속 재생된다.
    if (IS_MUSIC) return playerVideoId() || urlId;
    const player = document.getElementById('movie_player');
    if (!onWatch && !(player && player.getClientRects().length)) return null; // 미니플레이어도 없음
    return playerVideoId() || urlId;
  }

  function videoElement() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  // 화면에 보이는 플레이리스트 패널의 항목들. 패널이 둘 이상 렌더링되는 경우가 있어 보이는 쪽을 우선한다.
  function getYouTubeItems() {
    const panels = [...document.querySelectorAll('ytd-playlist-panel-renderer')];
    const panel =
      panels.find((p) => p.offsetParent !== null && p.querySelector('ytd-playlist-panel-video-renderer')) ||
      panels.find((p) => p.querySelector('ytd-playlist-panel-video-renderer'));
    if (!panel) return [];

    const items = [];
    for (const el of panel.querySelectorAll('ytd-playlist-panel-video-renderer')) {
      const anchor = el.querySelector('a#wc-endpoint') || el.querySelector('a[href*="/watch"]');
      if (!anchor) continue;
      let videoId = null;
      try {
        videoId = new URL(anchor.href, location.origin).searchParams.get('v');
      } catch {
        continue;
      }
      if (!videoId) continue;
      items.push({
        el,
        anchor,
        videoId,
        title: (el.querySelector('#video-title')?.textContent || '').trim(),
        channelName: (el.querySelector('#byline')?.textContent || '').trim(),
        selected: el.hasAttribute('selected'),
      });
    }
    return items;
  }

  // YouTube Music 재생 대기열. 항목에 링크가 없어 영상 ID는 player-bridge.js가 data-nma-vid 속성으로 적어 준다.
  // 노래/뮤직비디오 전환용으로 숨겨 둔 쪽(#counterpart-renderer[hidden])은 제외하고, 숨길 때는 감싸는 wrapper째 숨긴다.
  function getMusicItems() {
    const queue = document.querySelector('ytmusic-player-queue#queue') || document.querySelector('ytmusic-player-queue');
    if (!queue) return [];
    document.dispatchEvent(new CustomEvent('nma-request-queue'));

    const items = [];
    for (const item of queue.querySelectorAll('ytmusic-player-queue-item')) {
      if (item.closest('#counterpart-renderer[hidden]')) continue;
      const videoId = item.getAttribute('data-nma-vid');
      if (!videoId) continue;
      items.push({
        el: item.closest('ytmusic-playlist-panel-video-wrapper-renderer') || item,
        anchor: null,
        videoId,
        title: (item.querySelector('.song-title')?.textContent || '').trim(),
        channelName: (item.querySelector('.byline')?.textContent || '').trim(),
        selected: item.hasAttribute('selected'),
      });
    }
    return items;
  }

  function getPanelItems() {
    return IS_MUSIC ? getMusicItems() : getYouTubeItems();
  }

  // 지금 보이는 '다음 곡' 버튼.
  function nextButton() {
    const button = IS_MUSIC
      ? document.querySelector('ytmusic-player-bar .next-button')
      : document.querySelector('.ytp-next-button');
    return button && button.offsetParent !== null ? button : null;
  }

  root.NMAYouTube = {
    isMusic: IS_MUSIC,
    fetchVideoFacts: IS_MUSIC ? viaBackground('video') : fetchVideoFacts,
    fetchChannelFacts: IS_MUSIC ? viaBackground('channel') : fetchChannelFacts,
    currentVideoId,
    videoElement,
    getPanelItems,
    nextButton,
  };
})(globalThis);
