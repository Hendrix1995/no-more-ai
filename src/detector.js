// 판별 로직. DOM/chrome API에 의존하지 않는 순수 함수만 둔다 (Node에서 테스트 가능).
(function (root) {
  // hl=en을 붙여도 브라우저/계정 언어 설정이 우선할 수 있어 한국어 형식도 인식한다.
  const RELATIVE_TIME_RE =
    /^(?:Streamed |Premiered )?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;
  const RELATIVE_TIME_KO_RE = /^(?:스트리밍 시간:\s*)?(\d+)\s*(초|분|시간|일|주|개월|년)\s*전$/;
  const KO_UNITS = { 초: 'second', 분: 'minute', 시간: 'hour', 일: 'day', 주: 'week', 개월: 'month', 년: 'year' };

  function parseRelativeTime(text) {
    const t = (text || '').trim();
    const en = RELATIVE_TIME_RE.exec(t);
    if (en) return { n: Number(en[1]), unit: en[2].toLowerCase() };
    const ko = RELATIVE_TIME_KO_RE.exec(t);
    if (ko) return { n: Number(ko[1]), unit: KO_UNITS[ko[2]] };
    return null;
  }

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 키워드 바로 앞의 부정어(관사 등은 사이에 허용). "not AI music, or AI generated"처럼 부정된 AI 구절에 or로 이어진 경우도 포함한다.
  const NEGATION = "(?:not|no|non|without|never|[a-z]*n['\u2019]t)";
  const FILLER = '(?:an?|the|any|using|made|with|by|from)';
  const NEGATED_BEFORE_RE = new RegExp(
    `(?:^|[^a-z0-9'\u2019])${NEGATION}(?:[\\s-]+${FILLER})*[\\s-]*$|` +
      `(?:^|[^a-z0-9'\u2019])${NEGATION}(?:[\\s-]+${FILLER})*[\\s-]+ai(?:[^a-z0-9][^.!?()\\[\\]|]{0,40})?[\\s,]+n?or\\s+$`
  );
  // 한글 키워드 뒤의 부정 표현 ("AI 음악 아님", "AI로 만든 곡이 아닙니다").
  const NEGATED_AFTER_RE = /^[^.!?()[\]|,]{0,12}?(?:아님|아닌|아닙|아니에|아니다|없이|없는|미사용|않)/;

  // ASCII 키워드는 단어 경계로, 그 외(한글 등)는 부분 문자열로 비교한다.
  // 한 번이라도 부정 문맥("not AI generated")으로 쓰인 키워드는 그 글에서 신호로 쓰지 않는다.
  function findKeyword(text, keywords) {
    const t = normalize(text);
    if (!t) return null;
    for (const kw of keywords || []) {
      const k = normalize(kw);
      if (!k) continue;
      let found = false;
      let negated = false;
      if (/^[\x00-\x7f]+$/.test(k)) {
        const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}(?=$|[^a-z0-9])`, 'g');
        let m;
        while ((m = re.exec(t))) {
          found = true;
          if (NEGATED_BEFORE_RE.test(t.slice(0, m.index + m[1].length))) negated = true;
        }
      } else {
        for (let at = t.indexOf(k); at >= 0; at = t.indexOf(k, at + 1)) {
          found = true;
          if (NEGATED_AFTER_RE.test(t.slice(at + k.length))) negated = true;
        }
      }
      if (found && !negated) return kw;
    }
    return null;
  }

  function findChannel(list, channelId, channelName) {
    const n = normalize(channelName);
    return (
      (list || []).find(
        (e) => (e.id && channelId && e.id === channelId) || (e.name && n && normalize(e.name) === n)
      ) || null
    );
  }

  function isWithinWeek(text) {
    const m = parseRelativeTime(text);
    if (!m) return false;
    const { n, unit } = m;
    if (unit === 'second' || unit === 'minute' || unit === 'hour') return true;
    if (unit === 'day') return n <= 7;
    return false;
  }

  function collectRelativeTimes(node, out) {
    if (typeof node === 'string') {
      if (parseRelativeTime(node)) out.push(node);
    } else if (Array.isArray(node)) {
      for (const v of node) collectRelativeTimes(v, out);
    } else if (node && typeof node === 'object') {
      for (const k in node) collectRelativeTimes(node[k], out);
    }
    return out;
  }

  // 자동 생성 '- Topic' 채널은 동영상 탭에 상대 시간이 없어 업로드 빈도를 셀 수 없다.
  function isTopicChannel(channelName) {
    return / - topic$/.test(normalize(channelName));
  }

  // 시청 페이지 ytInitialData(hl=en)의 "How this was made" 섹션에 AI 공개 라벨이 있는지 본다.
  // 같은 섹션이 자동 더빙("Auto-dubbed") 등에도 쓰이므로 섹션 존재만으로 판단하지 않는다.
  function hasAiDisclosure(initialData) {
    const sections = [];
    (function walk(node) {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const k in node) {
          if (k === 'howThisWasMadeSectionViewModel') sections.push(node[k]);
          walk(node[k]);
        }
      }
    })(initialData);
    // 문구는 계정/브라우저 언어를 따르므로, 언어와 무관한 도움말 링크(answer/15447836)를 우선 본다. 자동 더빙은 answer/15569972.
    return sections.some((s) => {
      if (JSON.stringify(s?.bodyText?.commandRuns || []).includes('/answer/15447836')) return true;
      const header = normalize(s?.bodyHeader?.content);
      const body = normalize(s?.bodyText?.content);
      return (
        header === 'made with ai' ||
        header === 'ai로 제작' ||
        body.includes('altered or fully generated') ||
        body.includes('변경되었거나 새롭게 생성되었습니다')
      );
    });
  }

  // 채널 동영상 탭의 ytInitialData(hl=en)에서 최근 7일 내 업로드 수를 센다.
  function countRecentUploads(initialData) {
    return collectRelativeTimes(initialData, []).filter(isWithinWeek).length;
  }

  // HTML 안의 `marker{...}` 형태 JSON을 문자열 리터럴을 고려해 잘라 파싱한다.
  function extractJsonAfter(html, markers) {
    for (const marker of markers) {
      const at = html.indexOf(marker);
      if (at < 0) continue;
      const start = html.indexOf('{', at + marker.length);
      if (start < 0) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(html.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }

  // facts: { title, channelId, channelName, description, tags, syntheticLabel, recentUploads }
  // 없는 필드는 아직 확인하지 않은 것으로 본다.
  function evaluate(facts, settings) {
    const allowed = findChannel(settings.allowedChannels, facts.channelId, facts.channelName);
    if (allowed) return { ai: false, reasons: ['허용한 채널'] };

    const reasons = [];
    if (findChannel(settings.blockedChannels, facts.channelId, facts.channelName)) {
      reasons.push('차단한 채널');
    }

    const fields = [
      ['제목', facts.title],
      ['채널명', facts.channelName],
      ['설명', facts.description],
      ['태그', (facts.tags || []).join(' , ')],
    ];
    for (const [label, text] of fields) {
      const kw = findKeyword(text, settings.keywords);
      if (kw) reasons.push(`${label}에 "${kw}" 포함`);
    }

    if (settings.useSyntheticLabel && facts.syntheticLabel) {
      reasons.push('YouTube 합성 콘텐츠 라벨');
    }

    if (
      settings.useUploadRate &&
      typeof facts.recentUploads === 'number' &&
      facts.recentUploads >= settings.uploadRateThreshold
    ) {
      reasons.push(`최근 7일 업로드 ${facts.recentUploads}개`);
    }

    return { ai: reasons.length > 0, reasons };
  }

  const api = {
    normalize,
    findKeyword,
    findChannel,
    isWithinWeek,
    isTopicChannel,
    hasAiDisclosure,
    countRecentUploads,
    extractJsonAfter,
    evaluate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NMADetector = api;
})(globalThis);
