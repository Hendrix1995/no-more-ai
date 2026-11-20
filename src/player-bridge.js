// 페이지 world에서 실행된다. content script(격리 world)는 페이지 JS가 붙인 속성·메서드를 읽을 수 없으므로,
// 요청 이벤트를 받으면 필요한 값을 DOM 속성에 동기적으로 적어 둔다.
document.addEventListener('nma-request-video-id', () => {
  const player = document.getElementById('movie_player');
  let id = '';
  try {
    id = (player && typeof player.getVideoData === 'function' && player.getVideoData()?.video_id) || '';
  } catch {}
  document.documentElement.setAttribute('data-nma-video-id', id);
});

// YouTube Music 대기열 항목은 링크가 없고 영상 ID가 요소의 data 속성(JS 프로퍼티)에만 있다.
document.addEventListener('nma-request-queue', () => {
  for (const item of document.querySelectorAll('ytmusic-player-queue-item')) {
    let id = '';
    try {
      id = item.data?.videoId || '';
    } catch {}
    if (id) {
      if (item.getAttribute('data-nma-vid') !== id) item.setAttribute('data-nma-vid', id);
    } else if (item.hasAttribute('data-nma-vid')) {
      item.removeAttribute('data-nma-vid');
    }
  }
});
