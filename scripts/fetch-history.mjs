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
import { writeFileSync } from 'node:fs';

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
let latest = 1238;
for (let step = 0; step < 40; step++) {
  const l = await page(latest + 5);
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
