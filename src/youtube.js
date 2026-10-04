// YouTube 페이지/데이터 접근.
(function (root) {
  const D = root.NMADetector;

  async function fetchHtml(path) {
    const res = await fetch(path, { credentials: 'include' });
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

  // 플레이어가 실제로 재생 중인 영상 ID. 페이지 world의 player-bridge.js가 getVideoData()로 답한다.
  function playerVideoId() {
    document.dispatchEvent(new CustomEvent('nma-request-video-id'));
    return document.documentElement.getAttribute('data-nma-video-id') || null;
  }

  // SPA 전환 중에는 URL보다 플레이어가 먼저 바뀌고, 미니플레이어에서는 URL이 /watch가 아니므로 플레이어 기준으로 구한다.
  function currentVideoId() {
    const onWatch = location.pathname === '/watch';
    const player = document.getElementById('movie_player');
    if (!onWatch && !(player && player.getClientRects().length)) return null; // 미니플레이어도 없음
    return playerVideoId() || (onWatch ? new URLSearchParams(location.search).get('v') : null);
  }

  function videoElement() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  // 화면에 보이는 플레이리스트 패널의 항목들. 패널이 둘 이상 렌더링되는 경우가 있어 보이는 쪽을 우선한다.
  function getPanelItems() {
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

  root.NMAYouTube = { fetchVideoFacts, fetchChannelFacts, currentVideoId, videoElement, getPanelItems };
})(globalThis);
