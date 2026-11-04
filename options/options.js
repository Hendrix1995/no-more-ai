const $ = (id) => document.getElementById(id);
const lists = { blocked: [], allowed: [] };

function renderList(kind) {
  const ul = $(`${kind}List`);
  ul.replaceChildren(
    ...lists[kind].map((entry, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = entry.name || entry.id;
      if (entry.id) label.title = entry.id;
      const remove = document.createElement('button');
      remove.textContent = nmaT('optRemove');
      remove.addEventListener('click', () => {
        lists[kind].splice(i, 1);
        renderList(kind);
      });
      li.append(label, remove);
      return li;
    })
  );
}

async function init() {
  const s = await nmaLoadSettings();
  nmaSetLanguage(s.language);
  nmaApplyI18n();
  document.title = nmaT('optTitle');
  $('language').value = s.language;
  // 언어는 저장 버튼 없이 바로 적용한다. 다른 입력값은 화면에 그대로 남는다.
  $('language').addEventListener('change', async (e) => {
    await nmaSaveSettings({ language: e.target.value });
    nmaSetLanguage(e.target.value);
    nmaApplyI18n();
    document.title = nmaT('optTitle');
    renderList('blocked');
    renderList('allowed');
  });
  $('useSyntheticLabel').checked = s.useSyntheticLabel;
  $('useUploadRate').checked = s.useUploadRate;
  $('uploadRateThreshold').value = s.uploadRateThreshold;
  $('lookahead').value = s.lookahead;
  $('keywords').value = s.keywords.join('\n');
  lists.blocked = [...s.blockedChannels];
  lists.allowed = [...s.allowedChannels];
  renderList('blocked');
  renderList('allowed');

  // 이 탭을 연 채로 팝업에서 채널을 차단/허용하면 목록을 갱신해, 저장할 때 그 변경을 덮어쓰지 않게 한다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.blockedChannels) {
      lists.blocked = [...(changes.blockedChannels.newValue || [])];
      renderList('blocked');
    }
    if (changes.allowedChannels) {
      lists.allowed = [...(changes.allowedChannels.newValue || [])];
      renderList('allowed');
    }
  });

  document.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      const input = $(`${kind}Input`);
      const name = input.value.trim();
      if (!name) return;
      lists[kind].push({ id: '', name });
      input.value = '';
      renderList(kind);
    })
  );

  $('save').addEventListener('click', async () => {
    await nmaSaveSettings({
      useSyntheticLabel: $('useSyntheticLabel').checked,
      useUploadRate: $('useUploadRate').checked,
      uploadRateThreshold: Math.max(1, Number($('uploadRateThreshold').value) || NMA_DEFAULTS.uploadRateThreshold),
      lookahead: Math.min(30, Math.max(0, Number($('lookahead').value) || 0)),
      keywords: $('keywords').value.split('\n').map((k) => k.trim()).filter(Boolean),
      blockedChannels: lists.blocked,
      allowedChannels: lists.allowed,
    });
    $('saved').textContent = nmaT('optSaved');
    setTimeout(() => ($('saved').textContent = ''), 2000);
  });
}

init();
