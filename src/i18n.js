// 화면 문구 번역. 설정의 language('auto' | 'ko' | 'en')로 사용자가 직접 고를 수 있게
// chrome.i18n 대신 번역표를 직접 둔다 (chrome.i18n은 브라우저 언어만 따른다).
const NMA_MESSAGES = {
  ko: {
    popupToggle: 'AI 음악 걸러내기',
    popupIdle: 'YouTube 재생 페이지에서 상태가 표시됩니다.',
    popupBlock: '이 채널 차단',
    popupAllow: '이 채널 허용',
    popupOptions: '설정 열기',
    popupSupport: '☕ 개발자에게 커피 한 잔',
    popupSkips: '이 탭에서 건너뛴 곡: {count}개',
    popupCheckFailed: '현재 곡을 확인하지 못했습니다.',
    popupChannel: '채널: {name}',
    popupUnknown: '알 수 없음',
    popupFlagged: 'AI 음악으로 판별됨: {reasons}',
    popupPassedWith: '통과 ({reasons})',
    popupPassed: '통과',

    optTitle: 'No More AI Music 설정',
    optLanguage: '언어',
    optLanguageAuto: '자동 (브라우저 언어)',
    optCriteria: '판별 기준',
    optSyntheticLabel: 'YouTube의 "Made with AI"(AI로 제작됨) 라벨이 붙은 영상을 AI로 판별',
    optUploadRateBefore: '최근 7일 업로드가',
    optUploadRateAfter: '개 이상인 채널을 AI 양산 채널로 판별',
    optLookahead: '플레이리스트에서 미리 검사할 다음 곡 수',
    optKeywords: '키워드',
    optKeywordsHelp:
      '제목·채널명·설명·태그에 포함되면 AI 음악으로 판별합니다. 한 줄에 하나씩 입력합니다. 영문은 단어 단위로 비교합니다.',
    optBlocked: '차단한 채널',
    optBlockedPlaceholder: '채널명 (재생 중 팝업에서 차단하면 채널 ID로 정확히 저장됩니다)',
    optAllowed: '허용한 채널',
    optAllowedHelp: '허용한 채널은 다른 기준에 걸려도 건너뛰지 않습니다.',
    optAllowedPlaceholder: '채널명',
    optAdd: '추가',
    optRemove: '삭제',
    optSave: '저장',
    optSaved: '저장했습니다.',
    optSupportBefore: '이 확장이 도움이 됐다면 ',
    optSupportAfter: '로 개발을 후원할 수 있습니다. 후원 여부와 관계없이 모든 기능은 무료입니다.',

    toastSkipped: 'AI 음악을 건너뛰었습니다 ({reasons})',
    toastTooMany: '연속으로 너무 많은 곡이 걸러져 재생을 멈췄습니다.',
    toastAllAi: '남은 곡이 모두 AI 음악으로 판별되어 재생을 멈췄습니다.',

    reasonAllowed: '허용한 채널',
    reasonBlocked: '차단한 채널',
    reasonKeyword: '{field}에 "{keyword}" 포함',
    reasonSyntheticLabel: 'YouTube 합성 콘텐츠 라벨',
    reasonUploads: '최근 7일 업로드 {count}개',
    fieldTitle: '제목',
    fieldChannelName: '채널명',
    fieldDescription: '설명',
    fieldTags: '태그',
  },
  en: {
    popupToggle: 'Filter AI music',
    popupIdle: 'Status appears on a YouTube watch page.',
    popupBlock: 'Block this channel',
    popupAllow: 'Allow this channel',
    popupOptions: 'Open settings',
    popupSupport: '☕ Buy me a coffee',
    popupSkips: 'Skipped in this tab: {count}',
    popupCheckFailed: 'Could not check the current track.',
    popupChannel: 'Channel: {name}',
    popupUnknown: 'Unknown',
    popupFlagged: 'Detected as AI music: {reasons}',
    popupPassedWith: 'Passed ({reasons})',
    popupPassed: 'Passed',

    optTitle: 'No More AI Music Settings',
    optLanguage: 'Language',
    optLanguageAuto: 'Auto (browser language)',
    optCriteria: 'Detection rules',
    optSyntheticLabel: 'Treat videos with YouTube\'s "Made with AI" label as AI music',
    optUploadRateBefore: 'Treat channels with',
    optUploadRateAfter: 'or more uploads in the last 7 days as AI mass-production channels',
    optLookahead: 'Number of upcoming playlist tracks to check in advance',
    optKeywords: 'Keywords',
    optKeywordsHelp:
      'A track is flagged when its title, channel name, description, or tags contain one of these. One per line. English keywords match whole words.',
    optBlocked: 'Blocked channels',
    optBlockedPlaceholder: 'Channel name (blocking from the popup while playing saves the exact channel ID)',
    optAllowed: 'Allowed channels',
    optAllowedHelp: 'Allowed channels are never skipped, even if other rules match.',
    optAllowedPlaceholder: 'Channel name',
    optAdd: 'Add',
    optRemove: 'Remove',
    optSave: 'Save',
    optSaved: 'Saved.',
    optSupportBefore: 'If this extension helps you, you can support its development on ',
    optSupportAfter: '. Every feature stays free either way.',

    toastSkipped: 'Skipped AI music ({reasons})',
    toastTooMany: 'Playback paused: too many tracks in a row were filtered.',
    toastAllAi: 'Playback paused: all remaining tracks were detected as AI music.',

    reasonAllowed: 'Allowed channel',
    reasonBlocked: 'Blocked channel',
    reasonKeyword: '{field} contains "{keyword}"',
    reasonSyntheticLabel: 'YouTube synthetic content label',
    reasonUploads: '{count} uploads in the last 7 days',
    fieldTitle: 'Title',
    fieldChannelName: 'Channel name',
    fieldDescription: 'Description',
    fieldTags: 'Tags',
  },
};

let nmaLang = 'ko';

function nmaResolveLanguage(pref) {
  if (pref === 'ko' || pref === 'en') return pref;
  const ui = (globalThis.navigator && navigator.language) || '';
  return ui.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function nmaSetLanguage(pref) {
  nmaLang = nmaResolveLanguage(pref);
  return nmaLang;
}

function nmaT(key, params = {}) {
  const text = NMA_MESSAGES[nmaLang][key] ?? NMA_MESSAGES.ko[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : ''));
}

// detector.evaluate가 돌려주는 { code, ... } 형태의 판별 이유를 현재 언어 문장으로 바꾼다.
function nmaReason(reason) {
  switch (reason.code) {
    case 'allowed':
      return nmaT('reasonAllowed');
    case 'blocked':
      return nmaT('reasonBlocked');
    case 'keyword':
      return nmaT('reasonKeyword', { field: nmaT(reason.field), keyword: reason.keyword });
    case 'syntheticLabel':
      return nmaT('reasonSyntheticLabel');
    case 'uploads':
      return nmaT('reasonUploads', { count: reason.count });
    default:
      return String(reason.code);
  }
}

function nmaReasons(reasons) {
  return reasons.map(nmaReason).join(', ');
}

// popup·options 전용: data-i18n="키" 요소의 텍스트와 data-i18n-placeholder="키" 요소의 placeholder를 채운다.
function nmaApplyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = nmaT(el.dataset.i18n)));
  document
    .querySelectorAll('[data-i18n-placeholder]')
    .forEach((el) => (el.placeholder = nmaT(el.dataset.i18nPlaceholder)));
  document.documentElement.lang = nmaLang;
}
