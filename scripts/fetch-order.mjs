#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   추첨순서(공이 나온 순서) 자동 누적 → lotto-order.json  (rev2, 2026-09-24)

   동행복권 공식 API는 당첨번호를 오름차순으로만 준다. 실제로 공이 나온
   순서는 방송에만 존재하고, index.html 의 ORDER_PACK(1~ORDER_MAX회)은
   외부 아카이브(lottohell.com)를 한 번 수집해 문자열로 굳혀 둔 것이다.
   이 스크립트는 그 뒤를 잇는다.

   ── 소스 2곳, 교차 확인 ──────────────────────────────────────────
   - lottospecial.kr(DJLab Corp) — data03.html 을 _sLnumber~_eLnumber
     범위로 GET 조회(POST 폼이지만 쿼리스트링도 받는다). 1~1242회 전부
     보유. 한 번의 요청으로 여러 회차를 받는다.
   - lottotapa.com — stat/result_number.php?sel_start=A&sel_end=B,
     마찬가지로 범위 GET 한 번. **468회부터만** 보유(그 이전은 아예
     없음 — 397~467회는 이 소스로 못 채운다). robots.txt 는 /stat/ 를
     막지 않는다(막는 건 /board/adm/, *page=, *device= 등 다른 경로).
   - 폴백: lottohell.com(원래 ORDER_PACK 의 출처). /results/<회차>/ 가
     회차 1개씩 정적 HTML을 준다. lottospecial 이 신규(확장) 회차를
     하나도 못 줄 때만, 그것도 신규 회차에 한해 회차당 1개씩 순차·지연
     요청으로 시도한다(자리표시자·판정보류 구간은 폴백 대상이 아니다 —
     급하지 않은 데이터라 다음 주 1순위 재시도로 충분).

   ── 신뢰 라벨(플래너 최종 결정, 정확히 이 값만 쓴다) ────────────────
   'ok'      — ORDER_PACK 이 이미 신뢰하는 회차, 또는 신규 회차인데
               (둘 다 공식 집합·보너스 검증 통과 후) 두 출처의 순서가
               정확히 일치.
   'single'  — 한 출처만 "진짜"(비-오름차순) 순서를 줬다(다른 출처는
               없거나, 있어도 오름차순이라 정보가 없다). index.html
               UI는 이걸 «단일 출처» 태그로 보여주고, 신뢰 가능 카운트·
               χ² 검정에서는 기본적으로 뺀다.
   'suspect' — 두 출처가 서로 다른 "진짜" 순서를 준다(누가 맞는지 알
               도리가 없다), 또는 확보한 모든 출처가 오름차순(자리
               표시자 패턴)이라 실제 순서인지 전혀 판단할 수 없다.

   2026-09-24 조사로 밝혀진 것(로컬 비교, index.html 의 ORD_DISPUTED/
   ORD_BAD_RANGE/ORD_SUSPECT 와 맞물린다):
   - 1239~1242회: lottospecial·lottotapa 4/4 일치 → 'ok'.
   - 397~467회(71회): lottotapa 는 데이터가 없다(468회부터). lottospecial
     만 "진짜"(비오름차순) 순서를 주고 전부 공식 집합·보너스와 일치 →
     'single'. (lottohell 은 이 구간이 원래 오름차순 자리표시자였다 —
     그래서 ORD_BAD_RANGE 로 남아 있었다.)
   - 기존 ORD_SUSPECT 16개 중 14개: lottospecial 은 "진짜" 순서를 주는데
     lottotapa 는 그 14개 회차에서 전부 오름차순만 준다(정보 없음과
     같음) → 'single'(lottospecial 값 채택). 626회 예시:
     lottospecial=[14,33,26,43,13,40,+15](실제 순서), lottotapa=
     [13,14,26,33,40,43,+15](오름차순 그대로) — 집합·보너스는 같지만
     lottotapa 쪽은 정보가 없는 것과 같다.
   - 645·824회: lottospecial·lottotapa 둘 다 오름차순 → 여전히 'suspect'
     (아무 정보도 못 얻음, 두 출처가 같은 방향으로 "모른다"고 답한 것).
   - ORDER_PACK 의 기존 'ok' 구간 안에서 lottospecial 값이 어긋나는
     7개 회차 — **전부 같은 유형의 사소한 순서 뒤바뀜이 아니다**:
       · 329·583·723·816회 — 집합·보너스는 같은데 순서가 진짜로 다르다
         (둘 다 유효해 보이지만 누가 맞는지 알 수 없다) → index.html 의
         ORD_DISPUTED 로 하드코딩해 'suspect' 처리한다(이 스크립트가
         JSON 에 넣지 않는다 — index.html 이 직접 안다).
       · 368회 — lottospecial 의 **보너스 번호 자체가 틀렸다**(공식 26
         인데 28). 검증에서 자동 탈락.
       · 620회 — lottospecial 이 내놓은 "순서"가 사실 **오름차순 그대로
         정렬된 값**이다(자리표시자 패턴). 검증 통과는 하지만(집합·
         보너스는 맞음) 오름차순이라 애초에 'ok' 후보가 안 된다.
       · 831회 — lottospecial 이 **아예 다른 번호(6 대신 16)** 를 준다
         — 집합 자체가 다르므로 검증에서 탈락.
     세 회차(368·620·831) 모두 lottospecial 값이 이 스크립트의 자체
     검증(공식 집합·보너스 일치)에서 떨어지므로애초에 후보가 되지 않고,
     ORDER_PACK 값이 그대로 남는다 — 이 스크립트가 손댈 필요가 없다.

   append-only: 기존 lotto-order.json 에 이미 있는 회차는 다시 받지
   않는다. 대신 매 실행마다 **이미 저장된 회차 중 최신 8개**를 다시
   받아 대조한다(결정성 감시) — 값이 달라지면 ::warning 만 남기고
   **절대 덮어쓰지 않는다**(기존 값이 이긴다, 다른 스크립트들과 같은
   관례).

   안전장치:
   - 기존 파일이 있는데 읽을 수 없으면(손상) ::warning 남기고 아무것도
     받지 않고 아무것도 쓰지 않은 채 exit 0.
   - --out 이 디렉터리면 그 안의 lotto-order.json 에 쓴다.
   - --from 은 1~1238회의 "이미 신뢰된"(bad/suspect/disputed 가 아닌)
     회차를 절대 가리킬 수 없다 — 그런 회차는 조용히 건너뛴다.
   - 회차마다 어느 출처에서 왔는지 src 에 남긴다
     ("lottospecial+lottotapa" | "lottospecial" | "lottotapa" | "lottohell").
   - 응답은 왔는데(200) 파싱된 행이 0개면 "접속 실패"가 아니라
     "레이아웃이 바뀐 것 같음"이라고 정확히 경고한다.

   출처 접속이 전부 실패해도: 파일이 있으면 그대로 두고, 없으면 만들지
   않는다. ::warning 만 남기고 exit 0(이 스텝은 workflow 에서
   continue-on-error 이므로 실패로 나머지를 막을 필요가 없다).
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', process.cwd()));
let OUT = path.resolve(ROOT, arg('--out', 'lotto-order.json'));
try { if (fs.existsSync(OUT) && fs.statSync(OUT).isDirectory()) OUT = path.join(OUT, 'lotto-order.json'); } catch (e) { /* 무시 — 아래 쓰기에서 다시 드러난다 */ }
const CACHE = arg('--cache', null);
const FROM_OVERRIDE = arg('--from', null) !== null ? +arg('--from', null) : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (compatible; lotto-lab-order-bot/1.0; +https://github.com/ljo0527/lotto-lab)';

function warn(msg) { console.log('::warning title=추첨순서 수집::' + msg); }
function isNum645(n) { return Number.isInteger(n) && n >= 1 && n <= 45; }

/* ── 1. index.html 에서 현재 커버리지·하드코딩 구간 읽기 ──────────────── */
function readIndexCoverage() {
  const idxPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(idxPath, 'utf8');
  const packM = html.match(/const ORDER_PACK = "([^"]+)";/);
  if (!packM) throw new Error('index.html 에서 ORDER_PACK을 찾지 못했습니다');
  const orderMax = packM[1].length / 7;
  const badM = html.match(/const ORD_BAD_RANGE\s*=\s*(\[[\s\S]*?\]);/);
  const suspectM = html.match(/const ORD_SUSPECT\s*=\s*(\[[\s\S]*?\]);/);
  const disputedM = html.match(/const ORD_DISPUTED\s*=\s*(\[[\s\S]*?\]);/);
  const badRanges = badM ? JSON.parse(badM[1]) : [];
  const suspectRounds = suspectM ? JSON.parse(suspectM[1]) : [];
  const disputedRounds = disputedM ? JSON.parse(disputedM[1]) : [];
  return { orderMax, badRanges, suspectRounds, disputedRounds };
}
function isEligibleRound(r, orderMax, badRanges, suspectRounds, disputedRounds) {
  if (r > orderMax) return true;
  if (badRanges.some(([a, b]) => r >= a && r <= b)) return true;
  if (suspectRounds.includes(r)) return true;
  if (disputedRounds.includes(r)) return true;
  return false;
}

/* ── 2. 공식 당첨번호(집합·보너스) — --cache 우선, 모자란 회차만 동행복권에서 ── */
const L645 = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=';
async function dhPage(center, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(L645 + center, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return j?.data?.list ?? [];
    } catch (e) {
      if (i === tries - 1) { warn('동행복권 조회 실패(center=' + center + '): ' + e.message); return []; }
      await sleep(500 * (i + 1));
    }
  }
  return [];
}
async function loadOfficial(neededRounds) {
  const off = new Map(); // round -> {n:[6], b}
  if (CACHE && fs.existsSync(CACHE)) {
    try {
      const o = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      (o.lotto?.rows ?? []).forEach(r => {
        off.set(+r.ltEpsd, {
          n: [r.tm1WnNo, r.tm2WnNo, r.tm3WnNo, r.tm4WnNo, r.tm5WnNo, r.tm6WnNo],
          b: r.bnsWnNo,
        });
      });
      console.error('공식 데이터 캐시 사용:', CACHE, off.size, '회차');
    } catch (e) { console.error('캐시 읽기 실패, 필요한 회차만 새로 받습니다:', e.message); }
  }
  const missing = [...neededRounds].filter(r => !off.has(r));
  if (missing.length) {
    console.error('공식 데이터 보강 필요:', missing.length, '회차 — 동행복권 조회');
    for (const r of missing) {
      if (off.has(r)) continue;
      const list = await dhPage(r);
      list.forEach(o => off.set(+o.ltEpsd, {
        n: [o.tm1WnNo, o.tm2WnNo, o.tm3WnNo, o.tm4WnNo, o.tm5WnNo, o.tm6WnNo],
        b: o.bnsWnNo,
      }));
      await sleep(250);
    }
  }
  return off;
}

/* ── 3. lottospecial.kr — 범위 조회(요청 1회로 여러 회차) ─────────────── */
const LS_URL = 'https://lottospecial.kr/m/pg/data/data03.html';
function parseLottospecial(html) {
  const re = /<td>([\d,]+)<br>회차<\/td>[\s\S]*?<div class="lotto-num">([\s\S]*?)<\/div>\s*<\/td>/g;
  const out = new Map();
  let m;
  while ((m = re.exec(html))) {
    const round = +m[1].replace(/,/g, '');
    const texts = [...m[2].matchAll(/<div class="_text">([^<]*)<\/div>/g)].map(x => x[1]).filter(t => t !== '+');
    const nums = texts.map(Number);
    if (nums.length === 7 && nums.every(isNum645)) out.set(round, nums);
  }
  return out;
}
async function fetchLottospecialRange(lo, hi, tries = 2) {
  const url = `${LS_URL}?_sLnumber=${lo}&_eLnumber=${hi}&_gap=1`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      const map = parseLottospecial(html);
      if (!map.size) warn('lottospecial.kr 응답 200 이지만 0행 파싱됨 — 레이아웃이 바뀐 것 같습니다(' + lo + '~' + hi + ')');
      return map;
    } catch (e) {
      if (i === tries - 1) { warn('lottospecial.kr 조회 실패(' + lo + '~' + hi + '): ' + e.message); return new Map(); }
      await sleep(800 * (i + 1));
    }
  }
  return new Map();
}

/* ── 4. lottotapa.com — 범위 조회, 468회부터만 보유 ───────────────────── */
const LT_URL = 'https://lottotapa.com/stat/result_number.php';
function parseLottotapa(html) {
  const re = /<a href="\/stat\/result\/(\d+)">[^<]*<\/a>[\s\S]{0,400}?<ol class="lotto-result-mid-ball-content"[^>]*>([\s\S]*?)<\/ol>/g;
  const out = new Map();
  let m;
  while ((m = re.exec(html))) {
    const round = +m[1];
    const nums = [...m[2].matchAll(/<div class="ball[^"]*">(\d+)<\/div>/g)].map(x => +x[1]);
    if (nums.length === 7 && nums.every(isNum645)) out.set(round, nums);
  }
  return out;
}
async function fetchLottotapaRange(lo, hi, tries = 2) {
  if (hi < 468) return new Map(); // 468회 이전은 이 출처에 아예 없다 — 요청도 하지 않는다
  const rlo = Math.max(lo, 468);
  const url = `${LT_URL}?sel_start=${rlo}&sel_end=${hi}`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      const map = parseLottotapa(html);
      if (!map.size) warn('lottotapa.com 응답 200 이지만 0행 파싱됨 — 레이아웃이 바뀐 것 같습니다(' + rlo + '~' + hi + ')');
      return map;
    } catch (e) {
      if (i === tries - 1) { warn('lottotapa.com 조회 실패(' + rlo + '~' + hi + '): ' + e.message); return new Map(); }
      await sleep(800 * (i + 1));
    }
  }
  return new Map();
}

/* ── 5. lottohell.com — 폴백, 회차 1개씩(신규 확장 회차에만 씀) ────────── */
async function fetchLottohellRound(round, tries = 2) {
  const url = `https://lottohell.com/results/${round}/`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      const bm = html.match(/class="ball-order"[\s\S]*?<a href="\/statistics\/round-ball-order\//);
      if (!bm) return null;
      const nums = [...bm[0].matchAll(/<strong>(\d+)<\/strong>/g)].map(x => +x[1]);
      return nums.length === 7 && nums.every(isNum645) ? nums : null;
    } catch (e) {
      if (i === tries - 1) { warn('lottohell.com 조회 실패(' + round + '회): ' + e.message); return null; }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

/* ── 6. 검증 + 두 출처 결합 ───────────────────────────────────────────
   한 출처의 답은 공식 집합·보너스와 안 맞으면 그 자리에서 탈락(그 출처가
   이 회차에선 "없는 것"과 같다) — 368·831회가 이렇게 걸러진다.
   둘 다 통과했는데 오름차순이면("진짜 순서"라는 정보가 없음) real=false —
   620회의 lottospecial 값이 이렇게 걸러진다(집합은 맞지만 정렬값이라
   real 취급하지 않는다). */
function validateSourceValue(nums, official) {
  if (!nums || !official) return null;
  const mySet = nums.slice(0, 6).slice().sort((a, b) => a - b).join(',');
  const offSet = official.n.slice().sort((a, b) => a - b).join(',');
  if (mySet !== offSet || nums[6] !== official.b) return null;
  const ascending = nums.slice(0, 6).every((v, i) => i === 0 || v > nums[i - 1]);
  return { nums, ascending };
}
function combineSources(primaryRaw, secondaryRaw, official, primaryName, secondaryName) {
  const p = validateSourceValue(primaryRaw, official);
  const s = validateSourceValue(secondaryRaw, official);
  const pReal = p && !p.ascending, sReal = s && !s.ascending;
  if (pReal && sReal) {
    const same = p.nums.slice(0, 6).join(',') === s.nums.slice(0, 6).join(',');
    return { value: p.nums, trust: same ? 'ok' : 'suspect', src: primaryName + '+' + secondaryName };
  }
  if (pReal && !sReal) return { value: p.nums, trust: 'single', src: primaryName };
  if (!pReal && sReal) return { value: s.nums, trust: 'single', src: secondaryName };
  if (p && s) return { value: p.nums, trust: 'suspect', src: primaryName + '+' + secondaryName }; // 둘 다 오름차순
  if (p) return { value: p.nums, trust: 'suspect', src: primaryName }; // 하나만 있고 오름차순
  if (s) return { value: s.nums, trust: 'suspect', src: secondaryName };
  return null; // 둘 다 검증 실패 또는 데이터 없음
}

/* 회차 목록을 인접한 것끼리 묶어 요청 범위를 최소화한다. */
function buildWindows(rounds, maxGap = 40) {
  const sorted = [...rounds].sort((a, b) => a - b);
  const windows = [];
  let lo = null, hi = null;
  for (const r of sorted) {
    if (lo === null) { lo = hi = r; continue; }
    if (r - hi <= maxGap) hi = r; else { windows.push([lo, hi]); lo = hi = r; }
  }
  if (lo !== null) windows.push([lo, hi]);
  return windows;
}
async function fetchBothSources(rounds) {
  const windows = buildWindows(rounds);
  const lsMap = new Map(), ltMap = new Map();
  for (const [lo, hi] of windows) {
    const part = await fetchLottospecialRange(lo, hi);
    part.forEach((v, k) => { if (rounds.has(k)) lsMap.set(k, v); });
    await sleep(400);
  }
  for (const [lo, hi] of windows) {
    if (hi < 468) continue; // 이 창은 전부 468회 미만 — lottotapa 에 요청할 필요조차 없다
    const part = await fetchLottotapaRange(lo, hi);
    part.forEach((v, k) => { if (rounds.has(k)) ltMap.set(k, v); });
    await sleep(400);
  }
  return { lsMap, ltMap };
}

/* ── main ────────────────────────────────────────────────────────── */
(async function main() {
  const t0 = Date.now();
  let cov;
  try { cov = readIndexCoverage(); }
  catch (e) { warn('index.html 커버리지 읽기 실패: ' + e.message); process.exit(0); }
  const { orderMax, badRanges, suspectRounds, disputedRounds } = cov;

  /* 안전장치 (a) — 기존 파일이 있는데 손상됐으면 아무것도 하지 않는다. */
  let existing = null;
  if (fs.existsSync(OUT)) {
    try {
      const raw = fs.readFileSync(OUT, 'utf8');
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || !o.rounds || typeof o.rounds !== 'object') throw new Error('형식이 예상과 다릅니다(rounds 없음)');
      existing = o;
    } catch (e) {
      warn('기존 ' + OUT + ' 를 읽을 수 없습니다(' + e.message + ') — 손상 가능성이 있어 아무것도 받지 않고 중단합니다.');
      process.exit(0);
    }
  }
  if (!existing) existing = { v: 1, source: null, generated: null, rounds: {}, trust: {}, src: {} };
  if (!existing.src) existing.src = {};
  const already = new Set(Object.keys(existing.rounds || {}).map(Number));

  /* 최신 회차 탐지 */
  let latest = 0;
  if (CACHE && fs.existsSync(CACHE)) {
    try {
      const o = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      latest = Math.max(0, ...(o.lotto?.rows ?? []).map(r => +r.ltEpsd));
    } catch (e) { /* 무시 — 아래에서 탐지 */ }
  }
  if (!latest) {
    const est = Math.floor((Date.now() - Date.UTC(2002, 11, 7)) / (7 * 864e5)) + 1;
    for (let g = est + 5, t = 0; g >= 1 && t < 8; g -= 5, t++) {
      const l = await dhPage(g);
      if (l.length) { latest = Math.max(...l.map(o => +o.ltEpsd)); break; }
    }
    for (let i = 0; latest && i < 10; i++) {
      const l = await dhPage(latest + 1);
      if (!l.length) break;
      latest = Math.max(latest, ...l.map(o => +o.ltEpsd));
    }
  }
  if (!latest) { warn('최신 회차를 확인하지 못해 중단합니다(네트워크?)'); process.exit(0); }

  /* 안전장치 (c) — --from 은 1~1238회의 "이미 신뢰된" 회차를 가리킬 수 없다. */
  const extFrom = FROM_OVERRIDE ?? (orderMax + 1);
  const targetExt = [];
  let blockedFrom = 0;
  for (let r = extFrom; r <= latest; r++) {
    if (already.has(r)) continue;
    if (!isEligibleRound(r, orderMax, badRanges, suspectRounds, disputedRounds)) { blockedFrom++; continue; }
    targetExt.push(r);
  }
  if (blockedFrom) warn('--from ' + extFrom + ' 이 1~' + orderMax + '회의 신뢰된 구간을 가리켜 ' + blockedFrom + '회차를 건너뛰었습니다(자리표시자·판정보류·분쟁 구간만 허용).');

  const targetGap = []; for (const [a, b] of badRanges) for (let r = a; r <= b; r++) if (!already.has(r)) targetGap.push(r);
  const targetSuspect = suspectRounds.filter(r => !already.has(r));
  const allTarget = new Set([...targetExt, ...targetGap, ...targetSuspect]);

  /* 안전장치 (d) — 이미 저장된 회차 중 최신 8개를 다시 받아 대조(결정성 감시). 덮어쓰지 않는다. */
  const recheckSet = [...already].sort((a, b) => b - a).slice(0, 8);

  if (!allTarget.size && !recheckSet.length) {
    console.log(JSON.stringify({ ok: true, added: 0, note: '새로 받을 회차 없음(이미 최신)', latest, orderMax }));
    process.exit(0);
  }
  console.error('목표 회차:', allTarget.size, '(확장', targetExt.length, '· 자리표시자 구간', targetGap.length, '· 판정보류', targetSuspect.length, ') · 결정성 재확인', recheckSet.length, '회차');

  const combinedFetchSet = new Set([...allTarget, ...recheckSet]);
  const official = await loadOfficial(combinedFetchSet);
  const { lsMap, ltMap } = await fetchBothSources(combinedFetchSet);

  /* 폴백 — lottospecial 이 신규(확장) 회차를 하나도 못 줬을 때만, 신규 회차에 한해 lottohell.com 시도. */
  const primaryLabel = {}; // round -> 'lottospecial' | 'lottohell'
  for (const r of lsMap.keys()) primaryLabel[r] = 'lottospecial';
  if (targetExt.length && targetExt.every(r => !lsMap.has(r))) {
    warn('lottospecial.kr 에서 신규 회차를 하나도 못 받아 lottohell.com 폴백을 시도합니다.');
    for (const r of targetExt) {
      const nums = await fetchLottohellRound(r);
      if (nums) { lsMap.set(r, nums); primaryLabel[r] = 'lottohell'; }
      await sleep(400);
    }
  }

  /* 신규 추가 후보 */
  const addedRounds = {}, addedTrust = {}, addedSrc = {};
  let rejected = 0;
  for (const r of allTarget) {
    const combo = combineSources(lsMap.get(r), ltMap.get(r), official.get(r), primaryLabel[r] || 'lottospecial', 'lottotapa');
    if (!combo) { rejected++; continue; }
    addedRounds[r] = combo.value;
    addedTrust[r] = combo.trust;
    addedSrc[r] = combo.src;
  }

  /* 결정성 재확인 — 절대 덮어쓰지 않는다. 다르면 경고만. */
  let mismatchExisting = 0;
  for (const r of recheckSet) {
    const combo = combineSources(lsMap.get(r), ltMap.get(r), official.get(r), 'lottospecial', 'lottotapa');
    if (!combo) continue; // 이번엔 확인 못함 — 다음 주에 다시
    const prevVal = existing.rounds[r], prevTrust = existing.trust[r];
    const sameVal = prevVal && JSON.stringify(prevVal) === JSON.stringify(combo.value);
    const sameTrust = prevTrust === combo.trust;
    if (!sameVal || !sameTrust) {
      mismatchExisting++;
      warn(r + '회 결정성 재확인 불일치 — 기존 ' + JSON.stringify(prevVal) + '(' + prevTrust + ') vs 새로 받은 ' + JSON.stringify(combo.value) + '(' + combo.trust + '). 기존 값을 유지합니다.');
    }
  }

  const addedCount = Object.keys(addedRounds).length;
  if (!addedCount) {
    if (rejected) warn('시도한 ' + allTarget.size + '회차 중 검증 통과 0건(집합/보너스 불일치 또는 데이터 없음 ' + rejected + '건) — 파일을 바꾸지 않습니다.');
    console.log(JSON.stringify({ ok: false, added: 0, tried: allTarget.size, rejected, mismatchExisting, latest, orderMax, took_ms: Date.now() - t0 }));
    process.exit(0);
  }

  const out = {
    v: 1,
    source: { name: 'lottospecial.kr + lottotapa.com(교차 확인)', urls: { lottospecial: LS_URL, lottotapa: LT_URL, lottohell_fallback: 'https://lottohell.com/results/' } },
    generated: new Date().toISOString(),
    rounds: { ...existing.rounds, ...addedRounds },
    trust: { ...existing.trust, ...addedTrust },
    src: { ...existing.src, ...addedSrc },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const okCount = Object.values(addedTrust).filter(t => t === 'ok').length;
  const singleCount = Object.values(addedTrust).filter(t => t === 'single').length;
  const suspectCount = Object.values(addedTrust).filter(t => t === 'suspect').length;
  console.log(JSON.stringify({
    ok: true, added: addedCount, ok_trust: okCount, single_trust: singleCount, suspect_trust: suspectCount,
    rejected, mismatchExisting, tried: allTarget.size, latest, orderMax,
    source: out.source, took_ms: Date.now() - t0,
  }));
})().catch(e => { warn('예기치 못한 오류: ' + e.message); process.exit(0); });
