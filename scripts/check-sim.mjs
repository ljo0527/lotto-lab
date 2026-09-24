#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   check-sim.mjs — 모의 원장(brief/sim-lotto.json, brief/sim-pension.json)의
   독립 검증기 (PLAN2 §2, Sonnet C 소유). 스키마: scratchpad/maps/SIM-SCHEMA.md (Opus, v1).

   설계 원칙 — scripts/backfill.mjs(Opus)가 만든 결과를 "페이지 없이, 내 코드로"
   원자료(동행복권 원본 행)에서 다시 계산해 맞대본다. index.html/pension.html 함수를
   부르지 않는다(도구가 틀렸을 때 검증도 같이 틀리는 것을 피한다). 미래 누설(round-gating)·
   페이지 동일성은 브라우저가 필요해 harness 쪽 one-off 스크립트로 따로 확인한다(팀 보고 참고).

   재계산하는 것 — SIM-SCHEMA.md §2·§3 전체:
     · 로또 채점(hit/bonus/rank, 상금 draw.a[rank-1]) / 연금 채점(gradeOf 로직, 금액 RANKS[grade].amt)
     · carry(직전 회차 대비 겹침 — 로또: 본번호 겹침수, 연금: 같은 자리 숫자 겹침수) · prevHit(직전 행 결과 요약)
     · cum(누적: weeks/spend/ret/net/roi/ranks/anyWeeks/lastPrizeRound/bestRank, bestRank 0=없음)
     · cross(행별: R 추첨 vs 그 이전에 산 모든 줄 — pairs/n/any/exp/top, top 정렬 규칙까지)
     · summary(mean/median/anyRate/dry/exp 기대치) + summary.cross(전역: lines×draws, before/same/after,
       관측·기대·양측 푸아송 p, notable, best 줄별 최고 성적 분포 + 기대분포)
     · 구조 불변식(5줄/5장, 로또 6개 서로 다른 1..45 오름차순, 회차 연속, pending 정확히 1개,
       라이브 동일성 — R≥1243 로또 / ep≥334 연금 pending·done picks == brief/purchases.json)

   로또 등위·매칭 확률은 초기하분포로 직접 유도했다(§LOTTO_WAYS_ALL 주석) — index.html 의 WAYS 상수·
   validate.mjs 의 PROB_L 상수 두 곳과 대조해 세 값이 모두 일치함을 확인했다(독립 유도 vs 페이지 상수 2곳).
   연금 등위 확률(RANKS[k].p)·"best" 자릿수 매칭 CDF(1-10^-(k+1))는 SIM-SCHEMA.md/pension.html 이 쓰는
   설계값을 그대로 따른다(재유도 대상이 아니라 "그 표를 올바르게 적용했는가"가 검증 대상).
   gammaP/logGamma(정규화 불완전감마)는 Numerical-Recipes 류의 표준 Lanczos 근사 — 통계 유틸이라
   pension.html 과 같은 알고리즘을 쓰되(계수가 교과서적으로 고정돼 있다) 채점·집계 로직 자체와는 무관하다.

   사용법:
     node scripts/check-sim.mjs --root . [--cache <weekly-brief 캐시 파일>] [--dir <sim json 폴더, 기본 root>]
   출력: 불일치가 있으면 ::error(회차·필드 포함) 줄 + exit 1. 전부 통과하면 JSON 요약 + exit 0.
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', process.cwd()));
const DIR = path.resolve(arg('--dir', ROOT));
const CACHE = arg('--cache', null);
const MAXPRINT = +arg('--max-print', 40);

let ERR = 0, WARN = 0;
const errList = [], warnList = [];
function err(round, field, msg) {
  ERR++;
  const line = `round=${round} field=${field} ${msg}`;
  errList.push(line);
  if (errList.length <= MAXPRINT) console.log(`::error title=check-sim 불일치::${line}`);
}
function warn(round, field, msg) {
  WARN++;
  const line = `round=${round} field=${field} ${msg}`;
  warnList.push(line);
  if (warnList.length <= MAXPRINT) console.log(`::warning title=check-sim 경고::${line}`);
}
const near = (a, b, eps) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;
const nearRel = (a, b, rel, absMin) => typeof a === 'number' && typeof b === 'number' &&
  Math.abs(a - b) <= Math.max(absMin, rel * Math.max(Math.abs(a), Math.abs(b)));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 1. 원자료 확보 — --cache 우선, 없으면 fetch-history.mjs/weekly-brief.mjs getPension() 과 같은 엔드포인트로 직접 받는다 ── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function jget(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (lotto-lab check-sim)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(Math.min(20000, 1000 * 2 ** i)); }
  }
}
const P720 = 'https://www.dhlottery.co.kr/pt720/';
const L645 = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=';
async function getPension() {
  const list = (await jget(P720 + 'selectPstPt720WnList.do')).data.result;
  return list.map(r => ({ ep: +r.psltEpsd, date: String(r.psltRflYmd), band: +r.wnBndNo,
    num: String(r.wnRnkVl).padStart(6, '0'), bonus: String(r.bnsRnkVl).padStart(6, '0') })).sort((a, b) => a.ep - b.ep);
}
async function getLotto() {
  const est = Math.floor((Date.now() - Date.UTC(2002, 11, 7)) / (7 * 864e5)) + 1;
  let latest = 0;
  for (let g = est + 5, t = 0; g >= 1 && t < 12; g -= 5, t++) {
    const l = (await jget(L645 + g)).data.list || [];
    if (l.length) { latest = Math.max(...l.map(x => +x.ltEpsd)); break; }
  }
  if (!latest) throw new Error('최신 회차 탐지 실패');
  for (let i = 0; i < 20; i++) {
    const l = (await jget(L645 + (latest + 1))).data.list || [];
    if (!l.length) break;
    const m = Math.max(...l.map(x => +x.ltEpsd));
    if (m > latest) latest = m; else break;
  }
  const all = {};
  for (let c = latest; c > -4; c -= 10) {
    const l = (await jget(L645 + Math.max(c, 3))).data.list || [];
    l.forEach(x => { all[+x.ltEpsd] = x; });
    await sleep(50);
  }
  const eps = Object.keys(all).map(Number).sort((a, b) => a - b);
  return { latest, rows: eps.map(e => all[e]) };
}
async function getData() {
  if (CACHE && fs.existsSync(CACHE)) {
    try {
      const o = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      if (o.pension && o.lotto) { console.error('데이터 캐시 사용:', CACHE); return [o.pension, o.lotto]; }
    } catch (e) { console.error('캐시 읽기 실패, 새로 받습니다:', e.message); }
  }
  return Promise.all([getPension(), getLotto()]);
}

/* ── 2. 독립 채점 로직 ──────────────────────────────────────────── */
const C456 = 8145060;                              // C(45,6)
/* 로또 "본번호 맞은 개수(hit, 0..6)"의 초기하분포 — C(6,j)*C(39,6-j), j=0..6. 합 = C456(대조 완료). */
const LOTTO_WAYS_ALL = [3262623, 3454542, 1233765, 182780, 11115, 234, 1];
const lottoHitCumP = k => k < 0 ? 0 : LOTTO_WAYS_ALL.slice(0, k + 1).reduce((a, b) => a + b, 0) / C456; // F(k)=P(hit<=k)
/* 등위별 "당첨 조합 수"(초기하분포로 직접 유도, 보너스는 "5개 일치"만 39분의 1로 쪼갠다) — 유도 근거:
   grade4(4개 일치)=C(6,4)*C(39,2)=11115, grade5(3개 일치)=C(6,3)*C(39,3)=182780 (보너스 무관 — rankOf 가 m 만 본다)
   grade1(6개 일치)=1. grade2/3(5개 일치, 보너스 유무)= "5개 일치" 전체 234(=LOTTO_WAYS_ALL[5])를 39분의 1/38로 쪼갠다:
   grade2=234×1/39=6, grade3=234×38/39=228. → {1:1,2:6,3:228,4:11115,5:182780}.
   index.html WAYS·validate.mjs PROB_L 두 상수와 대조해 세 값 모두 일치함을 확인했다. */
const LOTTO_WAYS_GRADE = { 1: 1, 2: 6, 3: 228, 4: 11115, 5: 182780 };
const LOTTO_P = Object.fromEntries(Object.entries(LOTTO_WAYS_GRADE).map(([k, v]) => [k, v / C456]));
const LOTTO_BUCKET_P = { '3': LOTTO_P[5], '4': LOTTO_P[4], '5': LOTTO_P[3], '5b': LOTTO_P[2], '6': LOTTO_P[1] };
const LOTTO_GRADE_BUCKET = { 1: '6', 2: '5b', 3: '5', 4: '4', 5: '3' };
const P_GE3 = Object.values(LOTTO_WAYS_GRADE).reduce((a, b) => a + b, 0) / C456;  // 194130/C456 — 한 줄이 5등 이상일 확률

function lottoGrade(line6, draw) {                  // draw = {n:[6], b:int}
  const set = new Set(draw.n);
  let hit = 0; for (const n of line6) if (set.has(n)) hit++;
  const bonus = line6.includes(draw.b);
  let grade = 0;
  if (hit === 6) grade = 1;
  else if (hit === 5) grade = bonus ? 2 : 3;
  else if (hit === 4) grade = 4;
  else if (hit === 3) grade = 5;
  return { hit, bonus, grade };
}

/* 연금 등위표 — pension.html RANKS 를 그대로 옮겨적음(금액·p 는 그 페이지가 정의하는 설계값이며
   이 검증기가 재유도할 대상이 아니다 — 검증 대상은 "그 표를 올바르게 적용했는가"). */
const PENSION_RANKS = [
  { k: 1, p: 2e-7, amt: 1_680_000_000 }, { k: 2, p: 8e-7, amt: 120_000_000 }, { k: 8, p: 1e-6, amt: 120_000_000 },
  { k: 3, p: 9e-6, amt: 1_000_000 }, { k: 4, p: 9e-5, amt: 100_000 }, { k: 5, p: 9e-4, amt: 50_000 },
  { k: 6, p: 9e-3, amt: 5_000 }, { k: 7, p: 9e-2, amt: 1_000 },
];
const PENSION_AMT = Object.fromEntries(PENSION_RANKS.map(r => [r.k, r.amt]));
const PENSION_P = Object.fromEntries(PENSION_RANKS.map(r => [r.k, r.p]));
const PENSION_ANY_P = PENSION_RANKS.reduce((a, r) => a + r.p, 0);
const PENSION_NOTABLE_GRADES = new Set([1, 2, 8, 3, 4]);   // "4등 이상"(RANKS 순서 = 1,2,8,3,4,5,6,7)
const RANK_ORDER = [1, 2, 8, 3, 4, 5, 6, 7];                // 좋음→나쁨
const rankOrderIdx = k => k ? RANK_ORDER.indexOf(k) : 999;

function pensionGrade(band, num, draw) {             // draw = {band,num,bonus}
  if (num === draw.num) return band === draw.band ? 1 : 2;
  if (num === draw.bonus) return 8;
  for (let n = 5; n >= 1; n--) if (num.slice(6 - n) === draw.num.slice(6 - n)) return 8 - n;
  return 0;
}
/* "best" 절의 줄별 최고 성적 — 조는 무시, 같은 자리 숫자가 맨 끝에서부터 몇 자리 연속 일치하는지(0..6). SIM-SCHEMA §3.1. */
function pensionTrailMatch(numA, numB) {
  let n = 0; for (let k = 1; k <= 6; k++) { if (numA.slice(6 - k) === numB.slice(6 - k)) n = k; else break; }
  return n;
}
const pensionTrailCumP = k => k < 0 ? 0 : 1 - Math.pow(10, -(k + 1));   // F(k)=P(trail<=k) — SIM-SCHEMA §3.1 설계식

/* ── 3. 규칙 이력표(round-gating) — index.html PORTFOLIO_RULES / pension.html PENSION_RULES 를 옮겨적음.
   [주의] 모의 원장은 "지금 규칙이 늘 있었다면"을 재현하므로(SIM-SCHEMA §0 — weeklyPicks('portfolio') 로 force),
   행별 rule 문자열은 회차와 무관하게 파일 최상단 rule.name 과 같다(append-only 로 예전 규칙이 남아있는 행이 있을
   수 있어 checks.kept===0 일 때만 이 동일성을 강제한다). 아래 상수는 "최상단 rule 필드 자체"를 독립 검증하는 데 쓴다. */
const PORTFOLIO_RULE_LATEST = { from: 1243, name: 'portfolio', opts: { n: 5, maxOv: 1, dz: 0.15, N: 1500, carry: false } };
const PENSION_RULE_LATEST = { from: 334, mode: 'spread' };

/* ── 4. 파싱 유틸 ───────────────────────────────────────────────── */
function parseLottoPick(p) {
  if (Array.isArray(p)) return p.map(Number);
  return String(p).trim().split(',').map(x => +x.trim());
}
function parsePensionPick(p) {
  const m = /^(\d)\s*조\s*(\d{6})$/.exec(String(p).trim());
  return m ? { band: +m[1], num: m[2] } : null;
}

/* ── 5. 정규화 불완전감마(gammaP) — Lanczos 근사, 교과서적 표준 알고리즘(pension.html 의 chi2/binomTest 와 같은 종류의
   통계 유틸). 여기서는 큰 λ(수만)에서도 안정적인 푸아송 CDF/SF 계산에만 쓴다. ── */
function logGamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1; let a = 0.99999999999980993, t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function gammaP(s, x) {                              // 하부 정규화 불완전감마 P(s,x)
  if (x < 0 || s <= 0) return NaN;
  if (x === 0) return 0;
  if (x < s + 1) {
    let ap = s, sum = 1 / s, del = sum;
    for (let i = 0; i < 500; i++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - s); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}
const poissonLE = (k, lambda) => k < 0 ? 0 : lambda <= 0 ? 1 : 1 - gammaP(k + 1, lambda);   // P[X<=k]
const poissonGE = (k, lambda) => k <= 0 ? 1 : lambda <= 0 ? 0 : gammaP(k, lambda);          // P[X>=k]
function poissonTwoSided(obs, lambda) {
  if (lambda <= 0) return obs <= 0 ? 1 : 0;
  return Math.min(1, 2 * Math.min(poissonLE(obs, lambda), poissonGE(obs, lambda)));
}
/* [REV2] sd/pMC sanity — 몬테카를로(1,000회, 줄 간 상관 반영) 값이라 이 검증기가 관측값을 독립 재현하지는
   않는다(계획 배정 범위: sanity 만: 유한·부호·구간). sd=0 은 exp 가 아주 작은(<1) 극희귀 버킷(예: 로또
   6개일치 exp≈0.0001)에서는 1,000회 전부 0 이 나오는 정상적인 결과다(out-opus/run4 실측으로 확인) —
   그런 버킷까지 sd>0 을 강제하면 false positive 가 난다. exp 가 1 이상인데 sd=0 이면 진짜 의심스럽다. */
function checkSdPmc(sd, pmc, exp, label) {
  if (sd !== undefined) {
    if (!Number.isFinite(sd) || sd < 0) err('summary.cross', `${label}.sd`, `기록=${sd} — 유한하고 음이 아닌 수가 아님(sanity 실패)`);
    else if (sd === 0 && exp >= 1) err('summary.cross', `${label}.sd`, `기록=0, exp=${exp.toFixed(3)}(1 이상)인데 몬테카를로 분산이 0 — sanity 실패(있을 법하지 않음)`);
  }
  if (pmc !== undefined && !(Number.isFinite(pmc) && pmc > 0 && pmc <= 1))
    err('summary.cross', `${label}.pMC`, `기록=${pmc} — (0,1] 범위 밖(sanity 실패)`);
}

/* ── 6. 회차 인덱스 구성 ────────────────────────────────────────── */
function buildLottoIndex(lottoRaw) {
  const byRound = new Map();
  for (const o of lottoRaw.rows) {
    byRound.set(+o.ltEpsd, {
      round: +o.ltEpsd, date: String(o.ltRflYmd),
      n: [o.tm1WnNo, o.tm2WnNo, o.tm3WnNo, o.tm4WnNo, o.tm5WnNo, o.tm6WnNo], b: o.bnsWnNo,
      a: [o.rnk1WnAmt, o.rnk2WnAmt, o.rnk3WnAmt, o.rnk4WnAmt, o.rnk5WnAmt],
    });
  }
  const latest = lottoRaw.latest ?? Math.max(...byRound.keys());
  return { byRound, latest };
}
function buildPensionIndex(pensionRaw) {
  const byEp = new Map();
  for (const r of pensionRaw) byEp.set(+r.ep, { ep: +r.ep, date: r.date, band: r.band, num: r.num, bonus: r.bonus });
  const latest = Math.max(...byEp.keys());
  return { byEp, latest };
}

/* ══════════════════ 7. 공통 — 행 단위 검증(로또/연금 공용 뼈대) ══════════════════ */
function checkRows(sim, idx, kind) {
  const FROM = kind === 'lotto' ? 1000 : 100;
  const rows = sim?.rows;
  if (!Array.isArray(rows) || !rows.length) { err('-', 'rows', `sim-${kind}.json rows 가 비어있거나 없습니다`); return null; }

  if (sim.games !== 5) err('-', 'games', `games=${sim.games}, 기대값 5`);
  if (sim.ticket !== 1000) err('-', 'ticket', `ticket=${sim.ticket}, 기대값 1000`);
  if (sim.from !== FROM) err('-', 'from', `from=${sim.from}, 기대값 ${FROM}`);
  if (sim.latest !== idx.latest) err('-', 'latest', `latest=${sim.latest}, 원자료 latest=${idx.latest}`);
  if (sim.to !== idx.latest + 1) err('-', 'to', `to=${sim.to}, 기대값 latest+1=${idx.latest + 1}`);

  const ruleLatest = kind === 'lotto' ? PORTFOLIO_RULE_LATEST : PENSION_RULE_LATEST;
  const expRuleName = kind === 'lotto' ? `${ruleLatest.name}@${ruleLatest.from}` : `${ruleLatest.mode}@${ruleLatest.from}`;
  if (sim.rule) {
    if (sim.rule.name !== expRuleName) err('-', 'rule.name', `rule.name=${sim.rule.name}, 기대값 ${expRuleName}`);
    if (sim.rule.from !== ruleLatest.from) err('-', 'rule.from', `rule.from=${sim.rule.from}, 기대값 ${ruleLatest.from}`);
    if (kind === 'lotto' && sim.rule.opts && !deepEq(sim.rule.opts, ruleLatest.opts))
      err('-', 'rule.opts', `rule.opts=${JSON.stringify(sim.rule.opts)}, 기대값 ${JSON.stringify(ruleLatest.opts)}(index.html PORTFOLIO_RULES 최신 항목)`);
    if (kind === 'pension' && sim.rule.mode !== ruleLatest.mode)
      err('-', 'rule.mode', `rule.mode=${sim.rule.mode}, 기대값 ${ruleLatest.mode}`);
  } else warn('-', 'rule', 'rule 필드가 없습니다');

  if (rows[0].round !== FROM) err(rows[0].round, 'round', `첫 행이 ${rows[0].round}, 기대값 ${FROM}부터`);
  for (let i = 1; i < rows.length; i++)
    if (rows[i].round !== rows[i - 1].round + 1) err(rows[i].round, 'round', `직전 행(${rows[i - 1].round}) 다음이 아님(연속 회차 불변식 위반)`);
  const last = rows[rows.length - 1];
  if (last.round !== idx.latest + 1) err(last.round, 'round', `마지막 행이 ${last.round}, 기대값 latest+1=${idx.latest + 1}`);
  const pendingRows = rows.filter(r => r.status === 'pending');
  if (pendingRows.length !== 1) err('-', 'status', `pending 행 개수=${pendingRows.length}, 기대값 1`);
  if (last.status !== 'pending') err(last.round, 'status', `마지막 행 status=${last.status}, 기대값 pending`);
  for (const r of rows.slice(0, -1)) if (r.status !== 'done') err(r.round, 'status', `status=${r.status}, 기대값 done(마지막 행 제외 전부)`);

  const keptZero = sim.checks && sim.checks.kept === 0;   // 완전 신규 빌드일 때만 rule 문자열을 강하게 검증할 수 있다(과거 규칙 이력은 이 파일만으로 재구성 불가)

  // 상태 추적(전부 독립 재계산) — cum.bestRank/summary.bestRank 는 "더 좋은 등수를 처음 만난 회차"를 함께 추적한다
  let cumWeeks = 0, cumRet = 0, anyWeeks = 0, lastPrizeRound = null;
  let bestRank = 0, bestRound = null;   // lotto: 등수 숫자(작을수록 좋음). pension: rankOrderIdx 로 비교, 저장은 grade 값.
  const cumRanks = kind === 'lotto' ? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
  const allLinesFlat = [];           // {round, line} — cross 용(행별은 "< R", 전역은 전부)
  const perRowRet = [];              // summary.mean/median/dry 용
  let lastDoneCum = null, lastDoneRow = null;
  let dryMax = 0, dryCur = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const R = row.round;
    if (row.rule && keptZero && row.rule !== expRuleName)
      err(R, 'rule', `rule=${row.rule}, 기대값 ${expRuleName}(checks.kept===0 인 신규 빌드라 전 행이 최신 규칙이어야 함)`);

    const picksRaw = row.picks;
    if (!Array.isArray(picksRaw) || picksRaw.length !== 5) { err(R, 'picks', `picks 개수=${picksRaw?.length}, 기대값 5`); continue; }
    const picks = kind === 'lotto' ? picksRaw.map(parseLottoPick) : picksRaw.map(parsePensionPick);
    if (kind === 'lotto') {
      picks.forEach((p, gi) => {
        const uniq = new Set(p);
        if (uniq.size !== 6 || p.length !== 6) err(R, `picks[${gi}]`, `6개 서로 다른 번호가 아님: ${JSON.stringify(picksRaw[gi])}`);
        if (p.some(n => n < 1 || n > 45)) err(R, `picks[${gi}]`, `1..45 범위 밖: ${JSON.stringify(picksRaw[gi])}`);
        const sorted = [...p].sort((a, b) => a - b);
        if (JSON.stringify(sorted) !== JSON.stringify(p)) err(R, `picks[${gi}]`, `오름차순이 아님: ${JSON.stringify(picksRaw[gi])}`);
      });
    } else {
      picks.forEach((p, gi) => { if (!p) err(R, `picks[${gi}]`, `"N조 NNNNNN" 형식이 아님: ${JSON.stringify(picksRaw[gi])}`); });
    }
    picks.forEach(p => { if (p) allLinesFlat.push({ round: R, line: p }); });

    // carry — R-1 존재하면 done/pending 관계없이 채워진다(SIM-SCHEMA §2)
    const prevRaw = kind === 'lotto' ? idx.byRound.get(R - 1) : idx.byEp.get(R - 1);
    if (prevRaw && row.carry !== undefined) {
      const carry = kind === 'lotto'
        ? picks.map(p => p.filter(n => prevRaw.n.includes(n)).length)
        : picks.map(p => { if (!p) return null; let c = 0; for (let d = 0; d < 6; d++) if (p.num[d] === prevRaw.num[d]) c++; return c; });
      if (!Array.isArray(row.carry) || !deepEq(row.carry, carry))
        err(R, 'carry', `기록=${JSON.stringify(row.carry)}, 독립재계산=${JSON.stringify(carry)}`);
    }
    // prevHit — 직전 행(항상 done, 마지막을 제외한 모든 행이 done 이므로)의 실제 result 그대로
    if (i > 0) {
      const prow = rows[i - 1];
      if (row.prevHit === undefined || row.prevHit === null) {
        warn(R, 'prevHit', 'prevHit 이 없습니다(첫 행이 아닌데)');
      } else if (Array.isArray(prow.result)) {
        const ph = row.prevHit;
        if (ph.round !== prow.round) err(R, 'prevHit.round', `기록=${ph.round}, 기대값 ${prow.round}`);
        if (ph.ret !== undefined && prow.ret !== undefined && ph.ret !== prow.ret) err(R, 'prevHit.ret', `기록=${ph.ret}, 기대값(직전 행 ret)=${prow.ret}`);
        if (kind === 'lotto') {
          const hits = prow.result.map(x => x.hit), ranks = prow.result.map(x => x.rank ?? x.grade);
          if (ph.hits && !deepEq(ph.hits, hits)) err(R, 'prevHit.hits', `기록=${JSON.stringify(ph.hits)}, 기대값=${JSON.stringify(hits)}`);
          if (ph.ranks && !deepEq(ph.ranks, ranks)) err(R, 'prevHit.ranks', `기록=${JSON.stringify(ph.ranks)}, 기대값=${JSON.stringify(ranks)}`);
        } else {
          const grades = prow.result.map(x => x.grade);
          if (ph.grades && !deepEq(ph.grades, grades)) err(R, 'prevHit.grades', `기록=${JSON.stringify(ph.grades)}, 기대값=${JSON.stringify(grades)}`);
        }
      }
    } else if (row.prevHit !== null && row.prevHit !== undefined) {
      err(R, 'prevHit', `첫 행인데 prevHit=${JSON.stringify(row.prevHit)}, 기대값 null`);
    }

    if (row.status === 'done') {
      const draw = kind === 'lotto' ? idx.byRound.get(R) : idx.byEp.get(R);
      if (!draw) { err(R, 'draw', '원자료에 이 회차의 추첨 결과가 없습니다'); continue; }
      let ret, grades;
      if (kind === 'lotto') {
        grades = picks.map(p => lottoGrade(p, draw));
        ret = grades.reduce((s, g) => s + (g.grade ? draw.a[g.grade - 1] || 0 : 0), 0);
        const res = row.result;
        if (Array.isArray(res) && res.length === 5) grades.forEach((g, gi) => {
          const r = res[gi] || {}; const rank = r.rank ?? r.grade;
          if (r.hit !== undefined && r.hit !== g.hit) err(R, `result[${gi}].hit`, `기록=${r.hit}, 독립재계산=${g.hit}`);
          if (r.bonus !== undefined && !!r.bonus !== g.bonus) err(R, `result[${gi}].bonus`, `기록=${r.bonus}, 독립재계산=${g.bonus}`);
          if (rank !== undefined && (rank || 0) !== g.grade) err(R, `result[${gi}].rank`, `기록=${rank}, 독립재계산=${g.grade}`);
        }); else err(R, 'result', `result 배열이 없거나 길이!=5: ${JSON.stringify(res)}`);
      } else {
        grades = picks.map(p => p ? pensionGrade(p.band, p.num, draw) : 0);
        ret = grades.reduce((s, g) => s + (g ? PENSION_AMT[g] || 0 : 0), 0);
        const res = row.result;
        if (Array.isArray(res) && res.length === 5) grades.forEach((g, gi) => {
          const r = res[gi] || {};
          if (r.grade !== undefined && (r.grade || 0) !== g) err(R, `result[${gi}].grade`, `기록=${r.grade}, 독립재계산=${g}`);
        }); else err(R, 'result', `result 배열이 없거나 길이!=5: ${JSON.stringify(res)}`);
      }
      if (row.ret !== undefined && row.ret !== ret) err(R, 'ret', `기록=${row.ret}, 독립재계산=${ret}`);
      perRowRet.push(ret);

      cumWeeks++; cumRet += ret;
      const gradeVals = kind === 'lotto' ? grades.map(g => g.grade) : grades;
      gradeVals.forEach(g => { if (g) cumRanks[g]++; });
      if (gradeVals.some(g => g)) { anyWeeks++; lastPrizeRound = R; }
      for (const g of gradeVals) if (g) {
        const better = kind === 'lotto' ? (bestRank === 0 || g < bestRank) : (bestRank === 0 || rankOrderIdx(g) < rankOrderIdx(bestRank));
        if (better) { bestRank = g; bestRound = R; }
      }
      dryCur = ret === 0 ? dryCur + 1 : 0; dryMax = Math.max(dryMax, dryCur);

      const spend = cumWeeks * 5000, net = cumRet - spend, roi = spend ? cumRet / spend : 0;
      if (row.cum) {
        const c = row.cum;
        if (c.weeks !== undefined && c.weeks !== cumWeeks) err(R, 'cum.weeks', `기록=${c.weeks}, 독립재계산=${cumWeeks}`);
        if (c.spend !== undefined && c.spend !== spend) err(R, 'cum.spend', `기록=${c.spend}, 독립재계산=${spend}`);
        if (c.ret !== undefined && c.ret !== cumRet) err(R, 'cum.ret', `기록=${c.ret}, 독립재계산=${cumRet}`);
        if (c.net !== undefined && c.net !== net) err(R, 'cum.net', `기록=${c.net}, 독립재계산=${net}`);
        if (c.roi !== undefined && !near(c.roi, roi, 1e-6)) err(R, 'cum.roi', `기록=${c.roi}, 독립재계산=${roi}`);
        if (c.anyWeeks !== undefined && c.anyWeeks !== anyWeeks) err(R, 'cum.anyWeeks', `기록=${c.anyWeeks}, 독립재계산=${anyWeeks}`);
        if (c.lastPrizeRound !== undefined && (c.lastPrizeRound ?? null) !== lastPrizeRound)
          err(R, 'cum.lastPrizeRound', `기록=${c.lastPrizeRound}, 독립재계산=${lastPrizeRound}`);
        if (c.bestRank !== undefined && (c.bestRank || 0) !== bestRank) err(R, 'cum.bestRank', `기록=${c.bestRank}, 독립재계산=${bestRank}`);
        if (c.ranks) for (const k of Object.keys(cumRanks))
          if (c.ranks[k] !== undefined && c.ranks[k] !== cumRanks[k]) err(R, `cum.ranks.${k}`, `기록=${c.ranks[k]}, 독립재계산=${cumRanks[k]}`);
        lastDoneCum = c;
      } else warn(R, 'cum', 'cum 필드가 없습니다');
      lastDoneRow = row;

      // cross(행별) — R 의 실제 추첨 vs 그 이전(< R)에 산 모든 줄
      if (row.cross !== undefined && row.cross !== null) {
        const priorLines = allLinesFlat.filter(x => x.round < R);
        const cx = row.cross;
        if (cx.pairs !== undefined && cx.pairs !== priorLines.length) err(R, 'cross.pairs', `기록=${cx.pairs}, 독립재계산=${priorLines.length}`);
        let graded, n = {}, any = 0;
        if (kind === 'lotto') {
          n = { '3': 0, '4': 0, '5': 0, '5b': 0, '6': 0 };
          graded = priorLines.map(x => ({ ...x, g: lottoGrade(x.line, draw) }));
          graded.forEach(x => { if (x.g.grade) { n[LOTTO_GRADE_BUCKET[x.g.grade]]++; any++; } });
        } else {
          graded = priorLines.map(x => ({ ...x, g: pensionGrade(x.line.band, x.line.num, draw) }));
          graded.forEach(x => { if (x.g) { n[x.g] = (n[x.g] || 0) + 1; any++; } });
        }
        if (cx.n) for (const key of Object.keys(kind === 'lotto' ? { '3': 0, '4': 0, '5': 0, '5b': 0, '6': 0 } : n))
          if (cx.n[key] !== undefined && cx.n[key] !== (n[key] || 0)) err(R, `cross.n.${key}`, `기록=${cx.n[key]}, 독립재계산=${n[key] || 0}`);
        if (cx.any !== undefined && cx.any !== any) err(R, 'cross.any', `기록=${cx.any}, 독립재계산=${any}`);
        const expP = kind === 'lotto' ? P_GE3 : PENSION_ANY_P;
        const exp = priorLines.length * expP;
        if (cx.exp !== undefined && !nearRel(cx.exp, exp, 1e-3, 0.01)) err(R, 'cross.exp', `기록=${cx.exp}, 독립재계산=${exp}`);
        if (Array.isArray(cx.top)) {
          // 각 항목 자체의 채점 정확성
          cx.top.forEach((t, ti) => {
            if (kind === 'lotto') {
              const line = Array.isArray(t.line) ? t.line.map(Number) : parseLottoPick(t.line);
              const g = lottoGrade(line, draw);
              if (t.hit !== undefined && t.hit !== g.hit) err(R, `cross.top[${ti}].hit`, `기록=${t.hit}, 독립재계산=${g.hit}`);
              if (t.bonus !== undefined && !!t.bonus !== g.bonus) err(R, `cross.top[${ti}].bonus`, `기록=${t.bonus}, 독립재계산=${g.bonus}`);
              const rk = t.rank ?? t.grade;
              if (rk !== undefined && (rk || 0) !== g.grade) err(R, `cross.top[${ti}].rank`, `기록=${rk}, 독립재계산=${g.grade}`);
            } else {
              const p = parsePensionPick(t.line);
              const g = p ? pensionGrade(p.band, p.num, draw) : null;
              if (t.grade !== undefined && g !== null && t.grade !== g) err(R, `cross.top[${ti}].grade`, `기록=${t.grade}, 독립재계산=${g}`);
            }
            if (t.boughtIn !== undefined && !(t.boughtIn < R)) err(R, `cross.top[${ti}].boughtIn`, `boughtIn=${t.boughtIn} >= R(${R}) — "이전에 산 줄" 불변식 위반`);
          });
          // 정확한 top-5(정렬 규칙 포함) 재구성 후 대조
          let trueTop;
          if (kind === 'lotto') {
            trueTop = graded.filter(x => x.g.grade).sort((a, b) => (a.g.grade - b.g.grade) || (b.g.hit - a.g.hit) || (b.round - a.round)).slice(0, 5)
              .map(x => ({ boughtIn: x.round, line: x.line.join(','), hit: x.g.hit, bonus: x.g.bonus, rank: x.g.grade }));
          } else {
            trueTop = graded.filter(x => x.g).sort((a, b) => (rankOrderIdx(a.g) - rankOrderIdx(b.g)) || (b.round - a.round)).slice(0, 5)
              .map(x => ({ boughtIn: x.round, line: x.line.band + '조 ' + x.line.num, grade: x.g }));
          }
          const norm = arr => arr.map(t => kind === 'lotto' ? `${t.boughtIn}|${t.line}|${t.hit}|${t.bonus}|${t.rank}` : `${t.boughtIn}|${t.line}|${t.grade}`);
          const got = norm(cx.top), want = norm(trueTop);
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            const gotSet = new Set(got), wantSet = new Set(want);
            const sameSet = got.length === want.length && got.every(x => wantSet.has(x));
            (sameSet ? warn : err)(R, 'cross.top', `기록=${JSON.stringify(got)}, 독립재계산(정렬 포함)=${JSON.stringify(want)}` + (sameSet ? ' (내용은 같고 정렬만 다름)' : ''));
          }
        }
      } else if (row.status === 'done') warn(R, 'cross', 'done 행인데 cross 가 없습니다');
    } else {
      // pending 행
      if (row.result !== null) err(R, 'result', `pending 행인데 result=${JSON.stringify(row.result)}, 기대값 null`);
      if (row.ret !== null) err(R, 'ret', `pending 행인데 ret=${JSON.stringify(row.ret)}, 기대값 null`);
      if (row.cross !== null) err(R, 'cross', `pending 행인데 cross=${JSON.stringify(row.cross)}, 기대값 null`);
      if (lastDoneCum && row.cum && !deepEq(row.cum, lastDoneCum))
        err(R, 'cum', `pending 행의 cum 이 직전 done 행 cum 과 다름: 기록=${JSON.stringify(row.cum)}, 기대값=${JSON.stringify(lastDoneCum)}`);
    }
  }

  return { rows, kind, idx, cumWeeks, cumRet, cumRanks, anyWeeks, lastPrizeRound, bestRank, bestRound,
    allLinesFlat, perRowRet, dryMax, dryCur, lastDoneCum, lastDoneRow };
}

/* ══════════════════ 8. summary(§3) + summary.cross(§3.1) 검증 ══════════════════ */
function checkSummary(sim, state) {
  if (!state || !sim.summary) { if (!sim.summary) err('-', 'summary', 'summary 필드가 없습니다'); return; }
  const { kind, idx } = state;
  const s = sim.summary;
  const weeks = state.cumWeeks, spend = weeks * 5000, ret = state.cumRet, net = ret - spend, roi = spend ? ret / spend : 0;
  if (s.weeks !== undefined && s.weeks !== weeks) err('summary', 'weeks', `기록=${s.weeks}, 독립재계산=${weeks}`);
  if (s.spend !== undefined && s.spend !== spend) err('summary', 'spend', `기록=${s.spend}, 독립재계산=${spend}`);
  if (s.ret !== undefined && s.ret !== ret) err('summary', 'ret', `기록=${s.ret}, 독립재계산=${ret}`);
  if (s.net !== undefined && s.net !== net) err('summary', 'net', `기록=${s.net}, 독립재계산=${net}`);
  if (s.roi !== undefined && !near(s.roi, roi, 1e-5)) err('summary', 'roi', `기록=${s.roi}, 독립재계산=${roi}`);

  const sortedRet = [...state.perRowRet].sort((a, b) => a - b);
  const mean = ret / weeks;
  const median = sortedRet.length ? (sortedRet.length % 2 ? sortedRet[(sortedRet.length - 1) / 2]
    : (sortedRet[sortedRet.length / 2 - 1] + sortedRet[sortedRet.length / 2]) / 2) : 0;
  if (s.mean !== undefined && !nearRel(s.mean, mean, 1e-3, 0.5)) err('summary', 'mean', `기록=${s.mean}, 독립재계산=${mean}`);
  if (s.median !== undefined && s.median !== median) err('summary', 'median', `기록=${s.median}, 독립재계산=${median}`);

  if (s.ranks) for (const k of Object.keys(state.cumRanks))
    if (s.ranks[k] !== undefined && s.ranks[k] !== state.cumRanks[k]) err('summary', `ranks.${k}`, `기록=${s.ranks[k]}, 독립재계산=${state.cumRanks[k]}`);
  if (s.anyWeeks !== undefined && s.anyWeeks !== state.anyWeeks) err('summary', 'anyWeeks', `기록=${s.anyWeeks}, 독립재계산=${state.anyWeeks}`);
  const anyRate = weeks ? state.anyWeeks / weeks : 0;
  if (s.anyRate !== undefined && !near(s.anyRate, anyRate, 1e-5)) err('summary', 'anyRate', `기록=${s.anyRate}, 독립재계산=${anyRate}`);
  if (s.bestRank !== undefined && (s.bestRank || 0) !== state.bestRank) err('summary', 'bestRank', `기록=${s.bestRank}, 독립재계산=${state.bestRank}`);
  if (s.bestRound !== undefined && (s.bestRound ?? null) !== state.bestRound) err('summary', 'bestRound', `기록=${s.bestRound}, 독립재계산=${state.bestRound}`);
  if (s.lastPrizeRound !== undefined && (s.lastPrizeRound ?? null) !== state.lastPrizeRound)
    err('summary', 'lastPrizeRound', `기록=${s.lastPrizeRound}, 독립재계산=${state.lastPrizeRound}`);
  if (s.dry) {
    if (s.dry.max !== undefined && s.dry.max !== state.dryMax) err('summary', 'dry.max', `기록=${s.dry.max}, 독립재계산=${state.dryMax}`);
    if (s.dry.current !== undefined && s.dry.current !== state.dryCur) err('summary', 'dry.current', `기록=${s.dry.current}, 독립재계산=${state.dryCur}`);
  }

  // exp(우연 기준선) — 로또: Σ_weeks 5·Σ_k P(k)·draw.a[k-1]. 연금: weeks·5·Σp·amt.
  if (s.exp) {
    let expRet = 0, expRetSmall = 0;
    const smallKeys = kind === 'lotto' ? [4, 5] : [4, 5, 6, 7];   // "typical" 작은 상금만(REV2 retSmall)
    if (kind === 'lotto') {
      for (const row of state.rows) if (row.status === 'done') {
        const draw = idx.byRound.get(row.round); if (!draw) continue;
        expRet += 5 * [1, 2, 3, 4, 5].reduce((a, k) => a + LOTTO_P[k] * (draw.a[k - 1] || 0), 0);
        expRetSmall += 5 * smallKeys.reduce((a, k) => a + LOTTO_P[k] * (draw.a[k - 1] || 0), 0);
      }
    } else {
      const evPerTicket = PENSION_RANKS.reduce((a, r) => a + r.p * r.amt, 0);
      const evSmall = smallKeys.reduce((a, k) => a + PENSION_P[k] * PENSION_AMT[k], 0);
      expRet = weeks * 5 * evPerTicket;
      expRetSmall = weeks * 5 * evSmall;
    }
    if (s.exp.ret !== undefined && !nearRel(s.exp.ret, expRet, 1e-3, 1)) err('summary', 'exp.ret', `기록=${s.exp.ret}, 독립재계산=${expRet}`);
    // [REV2] retSmall — 같은 식이되 작은 상금만(로또 4~5등, 연금 4~7등). "전형적인" 몫이고 나머지(큰 상금)는 극히 드물다.
    if (s.exp.retSmall !== undefined && !nearRel(s.exp.retSmall, expRetSmall, 1e-3, 1))
      err('summary', 'exp.retSmall', `기록=${s.exp.retSmall}, 독립재계산=${expRetSmall}`);
    if (s.exp.ranks) {
      const probTable = kind === 'lotto' ? LOTTO_P : PENSION_P;
      for (const k of Object.keys(state.cumRanks)) {
        const e = weeks * 5 * (probTable[k] || 0);
        if (s.exp.ranks[k] !== undefined && !nearRel(s.exp.ranks[k], e, 1e-3, 0.01)) err('summary', `exp.ranks.${k}`, `기록=${s.exp.ranks[k]}, 독립재계산=${e}`);
      }
    }
    if (kind === 'pension') {
      // [REV2] anyWeeks 는 이제 근사(독립가정)가 아니라 정확식: 1-(1-dL/10)(1-dN/10^6).
      // dL = 5장의 마지막 자리 숫자 중 서로 다른 값의 개수, dN = 5장의 6자리 번호 중 서로 다른 값의 개수(조 무시).
      // 로또의 coverExact 기반 정확값은 회차마다 C(45,6)=8,145,060 전수열거가 필요해(243주×814만 ≈ 20억 연산)
      // 이 검증기의 속도 예산(<60s)을 넘기므로 이번 배정 범위에서 제외했다(연금만 정확 검증, 로또는 sanity만).
      let expAny = 0;
      for (const row of state.rows) if (row.status === 'done') {
        const picks = row.picks.map(parsePensionPick).filter(Boolean);
        const dL = new Set(picks.map(p => p.num.slice(5))).size;
        const dN = new Set(picks.map(p => p.num)).size;
        expAny += 1 - (1 - dL / 10) * (1 - dN / 1e6);
      }
      if (s.exp.anyWeeks !== undefined && !nearRel(s.exp.anyWeeks, expAny, 1e-3, 0.01))
        err('summary', 'exp.anyWeeks', `기록=${s.exp.anyWeeks}, 독립재계산(정확식)=${expAny}`);
    } else if (s.exp.anyWeeks !== undefined) {
      // 로또는 sanity 만: 유한하고 0..weeks 범위, 무작위-기준 근사치와 같은 자릿수인지만 본다(범위 배정 밖).
      if (!(Number.isFinite(s.exp.anyWeeks) && s.exp.anyWeeks >= 0 && s.exp.anyWeeks <= weeks))
        err('summary', 'exp.anyWeeks', `기록=${s.exp.anyWeeks} — 유한하지 않거나 0..weeks(${weeks}) 범위 밖(로또 coverExact 기반 정확값은 이번 배정에서 검증 범위 밖, sanity 만)`);
      const approxIndep = weeks * (1 - Math.pow(1 - P_GE3, 5));
      if (!nearRel(s.exp.anyWeeks, approxIndep, 0.15, 1))
        warn('summary', 'exp.anyWeeks', `기록=${s.exp.anyWeeks}, 독립가정 근사치=${approxIndep.toFixed(3)} — 15% 넘게 다름(정확값은 줄 간 겹침 보정이 있어 차이가 있을 수 있음, 참고용 경고)`);
    }
  }

  if (s.pending) {
    const last = state.rows[state.rows.length - 1];
    if (s.pending.round !== last.round) err('summary', 'pending.round', `기록=${s.pending.round}, 기대값 ${last.round}`);
    if (s.pending.picks && !deepEq(s.pending.picks, last.picks)) err('summary', 'pending.picks', `기록과 마지막 행 picks 가 다름`);
  }

  if (s.cross) checkGlobalCross(sim, state, s.cross);
}

/* ══════════════════ 9. summary.cross(전역) — 산 모든 줄(대기 행 포함) × 전 회차(1..latest) ══════════════════ */
function checkGlobalCross(sim, state, cx) {
  const { kind, idx, rows } = state;
  const lines = [];
  for (const row of rows) {
    if (!Array.isArray(row.picks)) continue;
    const parsed = kind === 'lotto' ? row.picks.map(parseLottoPick) : row.picks.map(parsePensionPick);
    parsed.forEach(p => { if (p) lines.push({ round: row.round, line: p }); });
  }
  const drawRounds = (kind === 'lotto' ? [...idx.byRound.keys()] : [...idx.byEp.keys()]).filter(r => r <= idx.latest).sort((a, b) => a - b);

  if (cx.lines !== undefined && cx.lines !== lines.length) err('summary.cross', 'lines', `기록=${cx.lines}, 독립재계산=${lines.length}`);
  if (cx.draws !== undefined && cx.draws !== drawRounds.length) err('summary.cross', 'draws', `기록=${cx.draws}, 독립재계산=${drawRounds.length}`);
  // [REV2] sims/replay — sd/pMC 는 몬테카를로라 이 검증기가 독립 재현하지 않는다(무거움·비결정 시드 재현 부담).
  // 대신 replay(=페이지 자신의 자기 점검: 널모델 카운터가 "진짜 추첨"을 넣었을 때 obs 를 정확히 재현하는가)가
  // true 인지만 확인한다 — false 면 스키마 자체가 "pMC 를 믿지 말라"는 뜻(::warning)이다.
  if (cx.sims !== undefined && !(Number.isInteger(cx.sims) && cx.sims > 0)) err('summary.cross', 'sims', `기록=${cx.sims} — 양의 정수가 아님`);
  if (cx.replay !== undefined && cx.replay !== true)
    warn('summary.cross', 'replay', `기록=${cx.replay} — false 면 스키마 정의상 pMC 를 신뢰할 수 없다는 뜻(SIM-SCHEMA REV2)`);

  const buckets = { before: { pairs: 0, n: {} }, same: { pairs: 0, n: {} }, after: { pairs: 0, n: {} } };
  const notable = [];
  // best: 줄별 클래스(all/before/after)별 최고 성적(raw hit / trailing match) 히스토그램 + N(그 클래스 안 추첨 횟수)
  const drawCountAll = drawRounds.length;
  const bestMax = { all: new Map(), before: new Map(), after: new Map() };   // round(=line 식별에 picks 순서까지 필요하므로 line index 로) -> {max,N}
  // 줄 단위 식별자: (round, pickIndex) — picks 안에 중복 줄이 있을 수 있어 index 까지 포함해 별개 취급
  lines.forEach((ln, li) => { ln._li = li; bestMax.all.set(li, { max: -1, N: 0 }); bestMax.before.set(li, { max: -1, N: 0 }); bestMax.after.set(li, { max: -1, N: 0 }); });

  for (const dR of drawRounds) {
    const draw = kind === 'lotto' ? idx.byRound.get(dR) : idx.byEp.get(dR);
    for (const ln of lines) {
      const bucketName = dR < ln.round ? 'before' : dR === ln.round ? 'same' : 'after';
      buckets[bucketName].pairs++;
      let rawMatch;   // best 절용 — 등수가 아니라 "맞은 원시 개수"
      if (kind === 'lotto') {
        const g = lottoGrade(ln.line, draw);
        rawMatch = g.hit;
        if (g.grade) {
          const key = LOTTO_GRADE_BUCKET[g.grade];
          buckets[bucketName].n[key] = (buckets[bucketName].n[key] || 0) + 1;
          if (g.hit >= 5) notable.push({ draw: dR, boughtIn: ln.round, line: ln.line.join(','), hit: g.hit, bonus: g.bonus, rank: g.grade, cls: bucketName, _sortRank: g.grade });
        }
      } else {
        const g = pensionGrade(ln.line.band, ln.line.num, draw);
        rawMatch = pensionTrailMatch(ln.line.num, draw.num);
        if (g) {
          buckets[bucketName].n[g] = (buckets[bucketName].n[g] || 0) + 1;
          if (PENSION_NOTABLE_GRADES.has(g)) notable.push({ draw: dR, boughtIn: ln.round, line: ln.line.band + '조 ' + ln.line.num, grade: g, cls: bucketName, _sortRank: rankOrderIdx(g) });
        }
      }
      const all = bestMax.all.get(ln._li); all.max = Math.max(all.max, rawMatch); all.N++;
      if (bucketName === 'before') { const b = bestMax.before.get(ln._li); b.max = Math.max(b.max, rawMatch); b.N++; }
      else if (bucketName === 'after') { const a = bestMax.after.get(ln._li); a.max = Math.max(a.max, rawMatch); a.N++; }
    }
  }

  // pairs 합이 lines*draws 와 같은지(분류 완전성)
  const totalPairs = buckets.before.pairs + buckets.same.pairs + buckets.after.pairs;
  if (totalPairs !== lines.length * drawRounds.length)
    err('summary.cross', 'classes.pairs', `분류된 쌍 합=${totalPairs}, lines*draws=${lines.length * drawRounds.length}`);

  for (const bname of ['before', 'same', 'after']) {
    const got = cx.classes && cx.classes[bname]; if (!got) { warn('summary.cross', `classes.${bname}`, '없음'); continue; }
    const b = buckets[bname];
    if (got.pairs !== undefined && got.pairs !== b.pairs) err('summary.cross', `classes.${bname}.pairs`, `기록=${got.pairs}, 독립재계산=${b.pairs}`);
    const probTable = kind === 'lotto' ? LOTTO_BUCKET_P : PENSION_P;
    const keys = kind === 'lotto' ? ['3', '4', '5', '5b', '6'] : ['1', '2', '3', '4', '5', '6', '7', '8'];
    const anyKey = kind === 'lotto' ? 'ge3' : 'any';
    const anyP = kind === 'lotto' ? P_GE3 : PENSION_ANY_P;
    let anyObs = 0;
    for (const k of keys) {
      const obs = b.n[k] || 0; anyObs += obs;
      const exp = b.pairs * probTable[k];
      if (got.obs && got.obs[k] !== undefined && got.obs[k] !== obs) err('summary.cross', `classes.${bname}.obs.${k}`, `기록=${got.obs[k]}, 독립재계산=${obs}`);
      if (got.exp && got.exp[k] !== undefined && !nearRel(got.exp[k], exp, 1e-3, 0.01)) err('summary.cross', `classes.${bname}.exp.${k}`, `기록=${got.exp[k]}, 독립재계산=${exp}`);
      if (got.p && got.p[k] !== undefined) {
        const p = poissonTwoSided(obs, exp);
        if (!nearRel(got.p[k], p, 0.02, 0.01)) warn('summary.cross', `classes.${bname}.p.${k}`, `기록=${got.p[k]}, 독립재계산(양측 푸아송)=${p}`);
      }
      // [REV2] sd/pMC — 몬테카를로(줄 간 상관 반영)라 이 검증기가 독립 재현하지 않는다(계획서 지시 범위: sanity 만).
      checkSdPmc(got.sd && got.sd[k], got.pMC && got.pMC[k], exp, `classes.${bname}.${k}`);
    }
    const expAny = b.pairs * anyP;
    if (got.obs && got.obs[anyKey] !== undefined && got.obs[anyKey] !== anyObs) err('summary.cross', `classes.${bname}.obs.${anyKey}`, `기록=${got.obs[anyKey]}, 독립재계산=${anyObs}`);
    if (got.exp && got.exp[anyKey] !== undefined && !nearRel(got.exp[anyKey], expAny, 1e-3, 0.01)) err('summary.cross', `classes.${bname}.exp.${anyKey}`, `기록=${got.exp[anyKey]}, 독립재계산=${expAny}`);
    checkSdPmc(got.sd && got.sd[anyKey], got.pMC && got.pMC[anyKey], expAny, `classes.${bname}.${anyKey}`);
  }
  // same == 실제 원장(ledger) 그 자체(SIM-SCHEMA §3.1: "obs must equal summary.ranks")
  // [주의] lotto 는 두 키 체계가 다르다 — classes.*.obs 는 "맞은 개수" 버킷('3','4','5','5b','6'),
  // cum.ranks/summary.ranks 는 "등수"(1..5) 이다. LOTTO_GRADE_BUCKET 로 변환해서 비교해야 한다
  // (등수 5="5등"=3개 일치=버킷'3' 처럼 숫자가 반대 방향으로 대응된다 — 최초 구현에서 이 변환을 빼먹어
  // false positive 를 낸 적이 있어 여기 남겨둔다).
  if (cx.classes && cx.classes.same && cx.classes.same.obs) {
    const sameObs = cx.classes.same.obs;
    if (kind === 'lotto') {
      for (const grade of Object.keys(state.cumRanks)) {
        const bucketKey = LOTTO_GRADE_BUCKET[grade];
        if (sameObs[bucketKey] !== undefined && sameObs[bucketKey] !== state.cumRanks[grade])
          err('summary.cross', `classes.same.obs.${bucketKey}(=등수${grade})`, `기록=${sameObs[bucketKey]}, summary.ranks[${grade}](=cum 최종)와 다름=${state.cumRanks[grade]}`);
      }
    } else {
      for (const k of Object.keys(state.cumRanks))
        if (sameObs[k] !== undefined && sameObs[k] !== state.cumRanks[k])
          err('summary.cross', `classes.same.obs.${k}`, `기록=${sameObs[k]}, summary.ranks(=cum 최종)와 다름=${state.cumRanks[k]}`);
    }
  }

  // notable — 내용(멀티셋) 및 정렬 비교
  notable.sort((a, b) => (a._sortRank - b._sortRank) || (b.draw - a.draw) || (b.boughtIn - a.boughtIn));
  notable.forEach(x => delete x._sortRank);
  if (Array.isArray(cx.notable)) {
    if (cx.notable.length !== notable.length) err('summary.cross', 'notable.length', `기록=${cx.notable.length}, 독립재계산=${notable.length}`);
    const keyOf = kind === 'lotto' ? x => `${x.draw}|${x.boughtIn}|${x.line}|${x.hit}|${x.bonus}|${x.rank}|${x.cls}` : x => `${x.draw}|${x.boughtIn}|${x.line}|${x.grade}|${x.cls}`;
    const gotKeys = cx.notable.map(keyOf), wantKeys = notable.map(keyOf);
    const gotSet = new Set(gotKeys), wantSet = new Set(wantKeys);
    const missing = wantKeys.filter(k => !gotSet.has(k)), extra = gotKeys.filter(k => !wantSet.has(k));
    if (missing.length) err('summary.cross', 'notable.missing', `${missing.length}건 누락 — 예: ${missing.slice(0, 5).join(' / ')}`);
    if (extra.length) err('summary.cross', 'notable.extra', `${extra.length}건 초과 — 예: ${extra.slice(0, 5).join(' / ')}`);
    if (!missing.length && !extra.length && JSON.stringify(gotKeys) !== JSON.stringify(wantKeys))
      warn('summary.cross', 'notable.order', '내용은 같고 정렬 순서만 다릅니다');
  } else warn('summary.cross', 'notable', '없음');

  // best — 히스토그램 + 기대분포(순서통계량: F(k)^N - F(k-1)^N 을 줄별로 합산)
  if (cx.best) {
    for (const cls of ['all', 'before', 'after']) {
      const got = cx.best[cls]; if (!got) { warn('summary.cross', `best.${cls}`, '없음'); continue; }
      const map = bestMax[cls];
      const entries = [...map.values()].filter(v => v.N > 0);
      if (got.lines !== undefined && got.lines !== entries.length) err('summary.cross', `best.${cls}.lines`, `기록=${got.lines}, 독립재계산=${entries.length}`);
      const hist = {}; entries.forEach(v => { hist[v.max] = (hist[v.max] || 0) + 1; });
      const maxK = kind === 'lotto' ? 6 : 6;
      for (let k = 0; k <= maxK; k++) {
        const obs = hist[k] || 0;
        if (got.hist && got.hist[k] !== undefined && got.hist[k] !== obs) err('summary.cross', `best.${cls}.hist.${k}`, `기록=${got.hist[k]}, 독립재계산=${obs}`);
      }
      if (got.exp) {
        const F = kind === 'lotto' ? lottoHitCumP : pensionTrailCumP;
        const expHist = new Array(maxK + 1).fill(0);
        for (const v of entries) for (let k = 0; k <= maxK; k++) expHist[k] += Math.pow(F(k), v.N) - Math.pow(F(k - 1), v.N);
        for (let k = 0; k <= maxK; k++)
          if (got.exp[k] !== undefined && !nearRel(got.exp[k], expHist[k], 1e-2, 0.05))
            warn('summary.cross', `best.${cls}.exp.${k}`, `기록=${got.exp[k]}, 독립재계산=${expHist[k].toFixed(4)}`);
      }
    }
  } else warn('summary.cross', 'best', '없음');
}

/* ══════════════════ 10. checks(§4) — 독립 확인 가능한 부분만 ══════════════════ */
function checkChecksBlock(sim, state) {
  if (!sim.checks) { warn('-', 'checks', 'checks 필드가 없습니다'); return; }
  const c = sim.checks;
  if (c.live) {
    const last = state.rows[state.rows.length - 1];
    if (c.live.round !== last.round) err('checks.live', 'round', `기록=${c.live.round}, 기대값 ${last.round}(마지막 행)`);
  }
  if (c.kept !== undefined && c.added !== undefined && state) {
    if (c.kept + c.added !== state.rows.length)
      err('checks', 'kept+added', `kept(${c.kept})+added(${c.added})=${c.kept + c.added}, rows.length=${state.rows.length}`);
  }
  if (c.determinism) {
    const d = c.determinism;
    for (const field of ['mismatch', 'ruleChanged', 'regrade'])
      if (d[field] !== undefined && !Array.isArray(d[field])) err('checks.determinism', field, `기록=${JSON.stringify(d[field])} — 배열이 아님`);
    // [REV2] regrade — kept===0(완전 신규 빌드, 이번 실행에서 흔함)이면 "재사용해 비교할 기존 done 행"이
    // 아예 없으므로 mismatch/ruleChanged 와 마찬가지로 반드시 비어 있어야 한다.
    if (c.kept === 0) {
      if (Array.isArray(d.regrade) && d.regrade.length)
        err('checks.determinism', 'regrade', `kept=0(신규 빌드)인데 regrade=${JSON.stringify(d.regrade).slice(0, 200)} — 비교 대상 기존 행이 없어야 함`);
    }
  }
}

/* ══════════════════ 11. 라이브 동일성 — sim R≥1243(로또)/ep≥334(연금) == 저장소 brief/purchases.json ══════════════════ */
function checkLiveIdentity(root, simLotto, simPension) {
  const p = path.join(root, 'brief', 'purchases.json');
  if (!fs.existsSync(p)) { warn('-', 'purchases.json', `없음: ${p} — 라이브 동일성 검사를 건너뜁니다`); return; }
  const purchases = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byKindRound = new Map();
  for (const r of purchases.rounds || []) byKindRound.set(r.kind + ':' + r.round, r);

  const normPicksLotto = arr => arr.map(p => parseLottoPick(p).join(','));
  const normPicksPension = arr => arr.map(p => { const q = parsePensionPick(p); return q ? q.band + '조' + q.num : String(p); });

  for (const row of simLotto?.rows || []) {
    if (row.round < 1243) continue;
    const live = byKindRound.get('lotto:' + row.round);
    if (!live) { warn(row.round, 'purchases.json', 'purchases.json 에 이 회차가 없습니다(윈도우 밖 — 검사 생략)'); continue; }
    const a = normPicksLotto(row.picks), b = normPicksLotto(live.picks);
    if (JSON.stringify(a) !== JSON.stringify(b)) err(row.round, 'live-identity(lotto)', `sim picks=${JSON.stringify(a)} != purchases.json picks=${JSON.stringify(b)}`);
    if (row.status !== live.status) err(row.round, 'live-identity(lotto).status', `sim=${row.status}, purchases.json=${live.status}`);
  }
  for (const row of simPension?.rows || []) {
    if (row.round < 334) continue;
    const live = byKindRound.get('pension:' + row.round);
    if (!live) { warn(row.round, 'purchases.json', 'purchases.json 에 이 회차가 없습니다(윈도우 밖 — 검사 생략)'); continue; }
    const a = normPicksPension(row.picks), b = normPicksPension(live.picks);
    if (JSON.stringify(a) !== JSON.stringify(b)) err(row.round, 'live-identity(pension)', `sim picks=${JSON.stringify(a)} != purchases.json picks=${JSON.stringify(b)}`);
    if (row.status !== live.status) err(row.round, 'live-identity(pension).status', `sim=${row.status}, purchases.json=${live.status}`);
  }
}

/* ══════════════════ 12. main ══════════════════ */
async function main() {
  const t0 = Date.now();
  const [pensionRaw, lottoRaw] = await getData();
  const lottoIdx = buildLottoIndex(lottoRaw);
  const pensionIdx = buildPensionIndex(pensionRaw);

  const simLottoPath = path.join(DIR, 'brief', 'sim-lotto.json');
  const simPensionPath = path.join(DIR, 'brief', 'sim-pension.json');
  if (!fs.existsSync(simLottoPath)) { console.log(`::error title=check-sim::파일 없음 ${simLottoPath}`); process.exit(1); }
  if (!fs.existsSync(simPensionPath)) { console.log(`::error title=check-sim::파일 없음 ${simPensionPath}`); process.exit(1); }
  const simLotto = JSON.parse(fs.readFileSync(simLottoPath, 'utf8'));
  const simPension = JSON.parse(fs.readFileSync(simPensionPath, 'utf8'));

  if (simLotto.kind !== 'lotto') err('-', 'kind', `sim-lotto.json kind=${simLotto.kind}, 기대값 lotto`);
  if (simPension.kind !== 'pension') err('-', 'kind', `sim-pension.json kind=${simPension.kind}, 기대값 pension`);

  const lottoState = checkRows(simLotto, lottoIdx, 'lotto');
  checkSummary(simLotto, lottoState);
  checkChecksBlock(simLotto, lottoState);

  const pensionState = checkRows(simPension, pensionIdx, 'pension');
  checkSummary(simPension, pensionState);
  checkChecksBlock(simPension, pensionState);

  checkLiveIdentity(ROOT, simLotto, simPension);

  const ms = Date.now() - t0;
  const summary = {
    ok: ERR === 0, errors: ERR, warnings: WARN,
    errorsShown: Math.min(errList.length, MAXPRINT), warningsShown: Math.min(warnList.length, MAXPRINT),
    runtimeMs: ms,
    lotto: lottoState && { rows: lottoState.rows.length, cumWeeks: lottoState.cumWeeks, cumRet: lottoState.cumRet,
      cumRanks: lottoState.cumRanks, bestRank: lottoState.bestRank, bestRound: lottoState.bestRound },
    pension: pensionState && { rows: pensionState.rows.length, cumWeeks: pensionState.cumWeeks, cumRet: pensionState.cumRet,
      cumRanks: pensionState.cumRanks, bestRank: pensionState.bestRank, bestRound: pensionState.bestRound },
  };
  console.log(JSON.stringify(summary, null, 1));
  process.exit(ERR ? 1 : 0);
}
main().catch(e => { console.log('::error title=check-sim 실패::' + (e?.stack || e)); process.exit(1); });
