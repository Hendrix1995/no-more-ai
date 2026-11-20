// YouTube Music 탭의 content script 대신 www.youtube.com 페이지를 받아 영상·채널 정보를 만든다.
// (music.youtube.com에서 www.youtube.com으로의 fetch는 CORS로 막히지만, 확장 백그라운드는 host 권한으로 가능하다.)
importScripts('detector.js', 'youtube.js');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'nma-fetch' || !msg.id) return;
  const fetcher = msg.kind === 'channel' ? NMAYouTube.fetchChannelFacts : NMAYouTube.fetchVideoFacts;
  fetcher(msg.id).then(
    (facts) => sendResponse({ facts }),
    (e) => sendResponse({ error: String(e) })
  );
  return true;
});
