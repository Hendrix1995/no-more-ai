const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/detector.js');

const settings = {
  keywords: ['suno', 'ai music', 'ai 음악'],
  blockedChannels: [{ id: 'UCbad', name: 'Bad Beats' }],
  allowedChannels: [{ id: '', name: 'Real Band' }],
  useSyntheticLabel: true,
  useUploadRate: true,
  uploadRateThreshold: 14,
};

test('findKeyword: 영문은 단어 경계, 한글은 부분 문자열', () => {
  assert.strictEqual(D.findKeyword('Chill Lofi (Suno v4)', settings.keywords), 'suno');
  assert.strictEqual(D.findKeyword('Sunova Live', settings.keywords), null);
  assert.strictEqual(D.findKeyword('잔잔한 AI 음악 모음', settings.keywords), 'ai 음악');
  assert.strictEqual(D.findKeyword('#AI  Music playlist', settings.keywords), 'ai music');
});

test('evaluate: 허용 채널이 다른 기준보다 우선한다', () => {
  const v = D.evaluate({ title: 'suno', channelName: 'real band' }, settings);
  assert.strictEqual(v.ai, false);
});

test('evaluate: 차단 채널, 합성 라벨, 업로드 빈도', () => {
  assert.ok(D.evaluate({ channelId: 'UCbad', channelName: 'x' }, settings).ai);
  assert.ok(D.evaluate({ title: 'song', syntheticLabel: true }, settings).ai);
  assert.ok(D.evaluate({ title: 'song', recentUploads: 20 }, settings).ai);
  assert.ok(!D.evaluate({ title: 'song', recentUploads: 3 }, settings).ai);
  assert.ok(!D.evaluate({ title: 'song', syntheticLabel: true }, { ...settings, useSyntheticLabel: false }).ai);
});

test('countRecentUploads: 7일 이내만 센다', () => {
  const data = {
    items: [
      { publishedTimeText: { simpleText: '3 hours ago' } },
      { publishedTimeText: { simpleText: '7 days ago' } },
      { publishedTimeText: { simpleText: '8 days ago' } },
      { publishedTimeText: { simpleText: '1 week ago' } },
      { publishedTimeText: { simpleText: 'Streamed 2 days ago' } },
      { label: 'Some title by Someone 1,234 views 3 hours ago 3 minutes' },
    ],
  };
  assert.strictEqual(D.countRecentUploads(data), 3);
});

test('extractJsonAfter: 문자열 안의 중괄호를 무시한다', () => {
  const html = '<script>var ytInitialPlayerResponse = {"a":"}{\\"x","b":{"c":1}};var x=1;</script>';
  assert.deepStrictEqual(D.extractJsonAfter(html, ['var ytInitialPlayerResponse = ']), { a: '}{"x', b: { c: 1 } });
  assert.strictEqual(D.extractJsonAfter('nothing', ['var ytInitialData = ']), null);
});

test('findKeyword: 부정 문맥으로 쓰인 키워드는 제외한다', () => {
  const kws = ['ai generated', 'ai-generated', 'ai music', 'ai cover', 'ai 음악'];
  assert.strictEqual(D.findKeyword('Loving You (Original Song not AI generated)', kws), null);
  assert.strictEqual(D.findKeyword('this song is not AI-generated', kws), null);
  assert.strictEqual(D.findKeyword('The vocals are not AI-generated', kws), null);
  assert.strictEqual(D.findKeyword('This music is not AI Music, or AI Generated Music.', kws), null);
  assert.strictEqual(D.findKeyword('Not an AI cover', kws), null);
  assert.strictEqual(D.findKeyword('잔잔한 노래 (AI 음악 아님)', kws), null);
  // 부정어가 키워드 바로 앞이 아니면 그대로 매칭한다.
  assert.strictEqual(D.findKeyword('Not Afraid (AI Cover)', kws), 'ai cover');
  assert.strictEqual(D.findKeyword('No Woman No Cry AI cover', kws), 'ai cover');
  assert.strictEqual(D.findKeyword('잔잔한 AI 음악 모음', kws), 'ai 음악');
});

test('findKeyword: 문맥 있는 suno 키워드는 힌디어 "suno"와 겹치지 않는다', () => {
  const kws = ['#suno', 'suno ai', 'suno.ai', 'made with suno'];
  assert.strictEqual(D.findKeyword('"Suno Na Sangemarmar" Full Song with Lyrics', kws), null);
  assert.strictEqual(D.findKeyword('Lofi beats made with Suno', kws), 'made with suno');
  assert.strictEqual(D.findKeyword('Created on suno.ai', kws), 'suno.ai');
  assert.strictEqual(D.findKeyword('Night drive #Suno', kws), '#suno');
});

test('hasAiDisclosure: "Made with AI" 라벨만 인정하고 자동 더빙은 제외한다', () => {
  const section = (header, body) => ({
    engagementPanels: [
      { howThisWasMadeSectionViewModel: { bodyHeader: { content: header }, bodyText: { content: body } } },
    ],
  });
  assert.ok(D.hasAiDisclosure(section('Made with AI', 'Sounds or visuals were altered or fully generated. Learn more')));
  assert.ok(D.hasAiDisclosure(section('', 'Sounds or visuals were altered or fully generated. Learn more')));
  assert.ok(!D.hasAiDisclosure(section('Auto-dubbed', 'Audio tracks for some languages were automatically generated. Learn more')));
  assert.ok(!D.hasAiDisclosure({ contents: {} }));
});

test('isTopicChannel: 자동 생성 Topic 채널', () => {
  assert.ok(D.isTopicChannel('Rick Astley - Topic'));
  assert.ok(!D.isTopicChannel('Rick Astley'));
  assert.ok(!D.isTopicChannel(''));
});

test('hasAiDisclosure: 한국어 응답(실제 YouTube 형식)도 판별하고 자동 더빙은 제외한다', () => {
  const run = (answer) => [{ onTap: { innertubeCommand: { urlEndpoint: { url: `//support.google.com/youtube/answer/${answer}?hl=ko` } } } }];
  const ai = { howThisWasMadeSectionViewModel: { bodyHeader: { content: 'AI로 제작' }, bodyText: { content: '사운드 또는 영상이 변경되었거나 새롭게 생성되었습니다. 자세히 알아보기', commandRuns: run(15447836) } } };
  const dub = { howThisWasMadeSectionViewModel: { bodyHeader: { content: '자동 더빙' }, bodyText: { content: '일부 언어의 오디오 트랙이 자동으로 생성되었습니다. 자세히 알아보기', commandRuns: run(15569972) } } };
  const otherLang = { howThisWasMadeSectionViewModel: { bodyHeader: { content: 'KI-generiert' }, bodyText: { content: '…', commandRuns: run(15447836) } } };
  assert.ok(D.hasAiDisclosure({ panels: [ai] }));
  assert.ok(D.hasAiDisclosure({ panels: [otherLang] }));
  assert.ok(!D.hasAiDisclosure({ panels: [dub] }));
});

test('countRecentUploads: 한국어 상대 시간', () => {
  const data = ['5시간 전', '1일 전', '7일 전', '8일 전', '1주 전', '스트리밍 시간: 2일 전', '3개월 전'].map((t) => ({ publishedTimeText: { simpleText: t } }));
  assert.strictEqual(D.countRecentUploads(data), 4);
});
