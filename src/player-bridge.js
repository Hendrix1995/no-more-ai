// 페이지 world에서 실행된다. content script(격리 world)는 #movie_player의 메서드를 호출할 수 없으므로,
// 요청 이벤트를 받으면 플레이어의 현재 영상 ID를 속성에 동기적으로 적어 둔다.
document.addEventListener('nma-request-video-id', () => {
  const player = document.getElementById('movie_player');
  let id = '';
  try {
    id = (player && typeof player.getVideoData === 'function' && player.getVideoData()?.video_id) || '';
  } catch {}
  document.documentElement.setAttribute('data-nma-video-id', id);
});
