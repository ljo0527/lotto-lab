/**
 * 동행복권 전 회차 수집 → lotto-history.json
 *
 * 엔드포인트: /lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=N
 *   지정 회차를 중심으로 [N-5, N+4] 범위 10건을 최신순으로 반환한다.
 *   따라서 최신 회차부터 10씩 내리며 순회하면 빈틈 없이 전량을 얻는다.
 *
 * 해외 IP 에서 차단될 수 있다. 그 경우 0이 아닌 코드로 종료하고
 * 워크플로는 배포를 건드리지 않고 넘어간다.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const API = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(center, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${API}?srchDir=center&srchLtEpsd=${center}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return (j?.data?.list) ?? [];
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
  return [];
}

const rows = new Map();

/* --cache <file> — weekly-brief/validate 가 이미 받아 둔 로또 원본 행을 재사용한다(네트워크 호출 0회).
   [2026-09-23] 한 잡에서 세 스크립트가 각자 전량을 받자 동행복권이 연결을 끊었다. */
const ci = process.argv.indexOf('--cache');
const cacheFile = ci > 0 ? process.argv[ci + 1] : null;
let fromCache = false;
if (cacheFile && existsSync(cacheFile)) {
  try {
    const o = JSON.parse(readFileSync(cacheFile, 'utf8'));
    (o.lotto?.rows ?? []).forEach(r => rows.set(+r.ltEpsd, r));
    fromCache = rows.size > 0;
    if (fromCache) console.log('데이터 캐시 사용:', cacheFile, rows.size, '회차');
  } catch (e) { console.error('캐시 읽기 실패, 새로 받습니다:', e.message); }
}

/* 최신 회차 탐지
   근거 — page(c) 는 c-5..c+4 를 주고, c 회차가 아직 없으면 빈 배열을 준다
          (네트워크 오류는 예외로 던진다 — 빈 배열과 구분된다).
          따라서 «center=latest+1 이 빈 배열» == «latest 가 마지막 회차» 다.
          존재하면 그 페이지의 최대값으로 한 번에 최대 +5 전진한다.

   [2026-08-30 버그 수정] 구버전은 상수 1238 에서 시작해 latest+5 를 찔렀다.
   로또는 주 1회 추첨이라 새 회차는 늘 1개만 쌓이고 그 +5 자리는 아직 없으므로,
   첫 반복에서 빈 배열 → break → latest 가 1238 에 영구 고정됐다.
   그 결과 이 워크플로는 매주 «최신 회차가 통째로 빠진» 스냅샷을 만들어
   remote 에 커밋해 왔다 (2026-08-30 커밋 c9c64d9c 는 latest:1238, count:1238).
   시작점도 상수 대신 추첨 달력(1회차 2002-12-07, 주 1회)에서 추정한다. */
let latest = 0;
if (fromCache) {
  latest = Math.max(...rows.keys());
} else {
  const est = Math.floor((Date.now() - Date.UTC(2002, 11, 7)) / (7 * 864e5)) + 1;
  for (let g = est + 5, t = 0; g >= 1 && t < 12; g -= 5, t++) {
    const l = await page(g);
    if (l.length) { l.forEach(o => rows.set(o.ltEpsd, o)); latest = Math.max(...l.map(o => o.ltEpsd)); break; }
  }
  if (!latest) { console.error('최신 회차 탐지 실패 — 응답이 모두 비어 있습니다'); process.exit(1); }
  for (let step = 0; step < 20; step++) {
    const l = await page(latest + 1);
    if (!l.length) break;
    const m = Math.max(...l.map(o => o.ltEpsd));
    l.forEach(o => rows.set(o.ltEpsd, o));
    if (m > latest) latest = m; else break;
  }
  console.log('최신 회차:', latest);

  const centers = [];
  for (let e = latest; e >= 8; e -= 10) centers.push(e);
  centers.push(1);

  let idx = 0;
  const worker = async () => {
    while (idx < centers.length) {
      const c = centers[idx++];
      (await page(c)).forEach(o => rows.set(o.ltEpsd, o));
    }
  };
  await Promise.all([0, 0, 0, 0].map(worker));

  const missing = [];
  for (let e = 1; e <= latest; e++) if (!rows.has(e)) missing.push(e);
  for (const e of missing) (await page(e)).forEach(o => rows.set(o.ltEpsd, o));
}

const still = [];
for (let e = 1; e <= latest; e++) if (!rows.has(e)) still.push(e);
if (still.length) {
  console.error('누락:', still.join(', '));
  process.exit(1);
}

const draws = [];
for (let e = 1; e <= latest; e++) {
  const o = rows.get(e);
  draws.push({
    round: o.ltEpsd,
    date: String(o.ltRflYmd),
    numbers: [o.tm1WnNo, o.tm2WnNo, o.tm3WnNo, o.tm4WnNo, o.tm5WnNo, o.tm6WnNo],
    bonus: o.bnsWnNo,
    winners: { first:o.rnk1WnNope, second:o.rnk2WnNope, third:o.rnk3WnNope, fourth:o.rnk4WnNope, fifth:o.rnk5WnNope },
    prize:   { first:o.rnk1WnAmt,  second:o.rnk2WnAmt,  third:o.rnk3WnAmt,  fourth:o.rnk4WnAmt,  fifth:o.rnk5WnAmt },
    sales: o.wholEpsdSumNtslAmt,
    firstType: { auto:o.winType1, manual:o.winType2, semi:o.winType3 },
  });
}

writeFileSync('lotto-history.json', JSON.stringify({
  meta: { generated:new Date().toISOString(), latest, count:draws.length,
          source:'dhlottery.co.kr /lt645/selectPstLt645InfoNew.do' },
  draws,
}));
console.log('저장 완료:', draws.length, '회차');
