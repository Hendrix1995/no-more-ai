const $ = (id) => document.getElementById(id);
let current = null;

function setStatus(nodes) {
  const box = $('status');
  box.replaceChildren(...nodes);
}

function line(text, className) {
  const div = document.createElement('div');
  div.textContent = text;
  if (className) div.className = className;
  return div;
}

async function moveChannel(toKey, fromKey) {
  if (!current?.channelId) return;
  const s = await nmaLoadSettings();
  const entry = { id: current.channelId, name: current.channelName };
  // content script의 findChannel과 같은 기준(ID 또는 이름)으로 지워, 이름으로만 추가한 항목도 남지 않게 한다.
  const norm = (n) => (n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const without = (list) =>
    list.filter((e) => !((e.id && e.id === entry.id) || (e.name && norm(e.name) === norm(entry.name))));
  await nmaSaveSettings({
    [toKey]: [...without(s[toKey]), entry],
    [fromKey]: without(s[fromKey]),
  });
  window.close();
}

async function loadStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'getStatus' });
  } catch {
    return; // YouTube 탭이 아니거나 content script가 아직 없음
  }
  if (!res) return;
  $('skips').textContent = `이 탭에서 건너뛴 곡: ${res.skipCount}개`;
  if (!res.videoId) return;
  if (res.error) {
    setStatus([line('현재 곡을 확인하지 못했습니다.', 'muted'), line(res.error, 'muted')]);
    return;
  }
  current = res;
  const verdict = res.verdict.ai
    ? line(`AI 음악으로 판별됨: ${res.verdict.reasons.join(', ')}`, 'ai')
    : line(res.verdict.reasons.length ? `통과 (${res.verdict.reasons.join(', ')})` : '통과', 'ok');
  setStatus([line(`채널: ${res.channelName || '알 수 없음'}`), verdict]);
  $('actions').hidden = !res.channelId;
}

async function init() {
  const s = await nmaLoadSettings();
  $('enabled').checked = s.enabled;
  $('enabled').addEventListener('change', (e) => nmaSaveSettings({ enabled: e.target.checked }));
  $('block').addEventListener('click', () => moveChannel('blockedChannels', 'allowedChannels'));
  $('allow').addEventListener('click', () => moveChannel('allowedChannels', 'blockedChannels'));
  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  loadStatus();
}

init();
