#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   check-rank.mjs — 무한 순위 · 당첨 순위 추적(brief/rank-*.json)의 독립 검증기 (PLAN3 §4, Opus-B 소유)

   원칙 — rank-track.mjs 가 rank-core.js 로 만든 결과를 «내 코드로» 다시 센다. rank-core.js 는 비교 대상일 뿐
   무차별 대입·통계 재계산에 그 내부(튜플 표·k-best 탐색 등)를 쓰지 않는다(도구가 틀리면 검증도 같이 틀리는 것을 피한다).

   무엇을 확인하나
     A. 구조: 스키마·회차 연속·당첨번호/날짜 = 원자료·mid/pct 정의(pct=(mid−0.5)/of)·site 별칭·params 회차 범위.
     B. 조합수 체계: 내 사전식 index(중첩 루프 순서) ↔ RANKCORE.lotto.index/combo 전단사(경계 + 무작위 100k)·filterPass 표본.
     C. 페이지 동등성(Playwright, index.html): 무작위 3,000 조합(+ 경계·당첨 조합)의 페이지 popFeat·zOf vs
        rank-core popFeat·popModelZ(1e-12) vs 내 z(비트 단위 기대) — 다음 회차(전체 DB) + 표본 2회차(DB 를 R−1 로 자름).
        같은 회차들의 fitPop A/B/bounds · weightsFor(hot/cold) 와 pension.html currentScores(5모델)·predSettings().model 이
        rank-params-*.json 과 같은지.
     D. 무차별 대입(표본): 로또 표본 2회차 × pop/popf/hot/cold 를 8,145,060 조합 전부 내 코드로 평가해 [best,worst] 일치.
        연금 표본 3회차 × 6모델을 5,000,000장 전부(번호 순위 10^6 포함) 평가해 일치.
     E. 전 회차 재계수(내 코드, 표본 밖 행까지): 로또 pop/popf = 내 전수 열거로 만든 특징 히스토그램 × 페이지식 z,
        hot/cold = 번호 가중치 동치류 조합 세기(정수 곱 = 수학적 동점) · 연금 = 자리 점수 분포 합성곱(DP).
     F. 다음 회차 top-20: 전수 정렬(Float64 전체 정렬 + 동점은 index 오름차순)로 재구성해 next.top 과 대조.
        (탐색 순서 = pop/popf: z 오름차순 · hot/cold: 정수 곱 내림차순 · 연금: 점수 내림차순, 동점은 모두 index 오름차순)
        rank-core 탐색기 함수(pagePop/pageAdditive/rankPop/rankAdditive/pension.page/rank)의 깊은 offset·임의 조합도 대조.
        정확한 위치 함수(posPop/posAdditive/pension.pos — 탐색기 «당첨번호 위치로 이동»)를 표본 회차 당첨 조합·티켓의
        전수 위치(= best + #{같은 점수 · index 더 작음 · 우주 안})와, 다음 회차 깊은 페이지 항목의 r 과 대조.
     H. wonIdx: rank-lotto.json 최상위 wonIdx[i] = (i+1)회 1등 조합의 사전식 index(길이 = latest) — 원자료로 다시 만들어 대조.
     G. 통계 재계산(STATUS-track 계약 — 동점 비율 규칙): n·평균·CI·중앙값(pct=mid 기준)·10분위(구간 (best−1,worst] 를
        10분위에 비율로 분배)·χ²(df 9)·KS(같은 비율 규칙의 평균 CDF, D 는 꺾이는 점에서; p 정확 MTW/점근 Stephens)·
        top-N 관측(동점 비율, %는 of·v/100)·기대·최고 회차(pct 최소)·구간 전략(워밍업 20, 비율 누적 최다 칸, 1e-9 동률은
        낮은 칸, 적중 = 그 칸 비율)·양측 이항 p · popf 통과율(exp = 평균 of_R/N, 양측 이항 p). 기록은 r6 반올림 → 허용 5e-7.
        p 값은 계약의 방식만 인정(KS: n ≤ 2000 이고 2⌊nD⌋+1 ≤ 301 이면 정확 MTW, 아니면 Stephens 점근 · 이항: pension.html
        binomTest 양측 정의) · 기록은 유효숫자 6자리(toPrecision) → 상대 허용 1e-5.

   동점 정의(PLAN3 §1·STATUS-core): 같은 점수 = 같은 순위 구간 [best,worst]. pop/popf 는 z 가 부동소수로 정확히 같음.
     hot/cold 는 점수가 Σ log w 라서 «수학적으로 같은 점수»(정수 밑의 곱이 같음 — 2·6=3·4 포함)가 동점이다. 이 검증기는
     w 에서 정수 밑(hot: max(1,freq52) = w^(1/2.2), cold: 1+gap = w^(1/1.6))을 역산해 정수 곱으로 정확히 센다
     (부동소수 합으로 세면 같은 곱의 조합이 1ulp 씩 갈라져 동점 구간이 쪼개진다 — 그런 기록은 ::error).
     역산은 b = round(w^(1/e)) 를 b^e 와 w 가 4 ulp 이내면 받는다: 가중치는 브라우저(CI 는 Playwright Chromium)의 Math.pow, 검증은 Node 의
     Math.pow 라 1ulp 다를 수 있다(비트 단위로 다른 개수는 ::notice 한 줄). 역산이 정말 안 되면(가중치 정의가 바뀐 경우) ::warning 을 내고
     STATUS-core 계약의 정수화(q = round(log w·2^46), 동점 |Δ| ≤ 6, 구간 안 index 오름차순)로 센다. 부동소수 합 «순서»로 대조하는 일은 없다.

   CLI: node scripts/check-rank.mjs --root . [--dir <brief 의 부모 폴더, 기본 root>] [--cache <lab-data.json>]
                                   [--no-page] [--samples-only] [--lotto-samples 1100,1200] [--pension-samples 150,200,300]
                                   [--core <rank-core.js 경로>] [--max-print 40]
        --root 는 «전체 저장소»(rank-core.js · index.html · pension.html 이 있는 곳)여야 한다 — 산출물만 있는 폴더를 검사하려면
        --root 는 저장소, --dir 은 그 산출물 폴더(brief/ 의 부모)로 준다. root 에 필요한 파일이 없으면 즉시 ::error(페이지 대기 없음).
   출력: 불일치 → ::error 줄 + exit 1. 경고 → ::warning. 끝에 JSON 요약(stdout). 진행 로그는 stderr.
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';
import vm from 'vm';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const has = k => argv.includes(k);
const ROOT = path.resolve(arg('--root', process.cwd()));
const DIR = path.resolve(arg('--dir', ROOT));
const CACHE = arg('--cache', null);
const NOPAGE = has('--no-page');
const ALLROWS = !has('--samples-only');
const MAXPRINT = +arg('--max-print', 40);
const CORE = path.resolve(ROOT, arg('--core', 'rank-core.js'));
const T0 = performance.now();
const TM = {};
const log = (...a) => console.error('[check-rank ' + ((performance.now() - T0) / 1000).toFixed(1) + 's]', ...a);
async function timed(k, fn) { const t = performance.now(); try { return await fn(); } finally { TM[k] = Math.round(performance.now() - t); } }
const yieldLoop = () => new Promise(r => setImmediate(r));

/* ── 0. 보고 ─────────────────────────────────────────────────────── */
let ERR = 0, WARN = 0;
const errList = [], warnList = [], notes = [];
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
function err(scope, msg) {
  ERR++; const l = scope + ' ' + msg; errList.push(l);
  if (errList.length <= MAXPRINT) console.log('::error title=check-rank 불일치::' + esc(l));
}
function warn(scope, msg) {
  WARN++; const l = scope + ' ' + msg; warnList.push(l);
  if (warnList.length <= MAXPRINT) console.log('::warning title=check-rank 경고::' + esc(l));
}
function notice(scope, msg) { console.log('::notice title=check-rank 참고::' + esc(scope + ' ' + msg)); }
const isNum = x => typeof x === 'number' && isFinite(x);
const near = (a, b, eps) => isNum(a) && isNum(b) && Math.abs(a - b) <= eps;
/* 기록 요약은 소수 6자리 반올림(r6)일 수 있다 → 통계 허용 오차 = 반올림 반 칸(5e-7) + 부동소수 여유. 정수 필드는 정확히. */
const STOL = 5.0001e-7;
/* p 값: 기록은 유효숫자 6자리(toPrecision(6)) → 상대 5e-6 반올림 + 구현 차이 여유 → 상대 1e-5 (+1e-12 절대) */
const pNear = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) <= 1e-5 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;
const nearRel = (a, b, rel) => isNum(a) && isNum(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

/* ── 1. 원자료 (check-sim/backfill 과 같은 --cache 형식·엔드포인트) ─────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function jget(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (lotto-lab check-rank)' } });
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
      if (o.pension && o.pension.length && o.lotto && o.lotto.rows && o.lotto.rows.length) { log('데이터 캐시 사용:', CACHE); return [o.pension, o.lotto]; }
    } catch (e) { log('캐시 읽기 실패, 새로 받습니다:', e.message); }
  }
  return Promise.all([getPension(), getLotto()]);
}
const digits8 = s => String(s == null ? '' : s).replace(/\D/g, '');

/* ── 2. 통계 유틸 (내 구현) ─────────────────────────────────────────── */
function logGamma(x) {                       // Lanczos (g=7, n=9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function gammaQ(a, x) {                      // 정규화 상측 불완전감마 Q(a,x)
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}
const chi2Upper = (x, df) => x <= 0 ? 1 : gammaQ(df / 2, x / 2);
function ksD(xs) {                           // 균등(0,1) 대비 D
  const s = xs.slice().sort((a, b) => a - b), n = s.length; let D = 0;
  for (let i = 0; i < n; i++) D = Math.max(D, (i + 1) / n - s[i], s[i] - i / n);
  return D;
}
function kolmQ(lam) {                        // Q_KS(λ) = 2Σ(−1)^{j−1} e^{−2j²λ²}
  if (lam < 1e-3) return 1;
  let s = 0;
  for (let j = 1; j <= 200; j++) { const t = Math.exp(-2 * j * j * lam * lam); s += (j & 1 ? 1 : -1) * t; if (t < 1e-18) break; }
  return Math.min(1, Math.max(0, 2 * s));
}
function ksExactCdf(n, d) {                  // Marsaglia–Tsang–Wang (2003): P(D_n < d)
  if (d <= 0) return 0; if (d >= 1) return 1;
  const k = Math.floor(n * d) + 1, m = 2 * k - 1, h = k - n * d;
  const H = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) H[i * m + j] = (i - j + 1 < 0) ? 0 : 1;
  for (let i = 0; i < m; i++) { H[i * m] -= Math.pow(h, i + 1); H[(m - 1) * m + i] -= Math.pow(h, m - i); }
  H[(m - 1) * m] += (2 * h - 1 > 0 ? Math.pow(2 * h - 1, m) : 0);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i - j + 1 > 0) for (let g = 1; g <= i - j + 1; g++) H[i * m + j] /= g;
  const mul = (A, B) => { const C = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let l = 0; l < m; l++) { const a = A[i * m + l]; if (!a) continue; for (let j = 0; j < m; j++) C[i * m + j] += a * B[l * m + j]; }
    return C; };
  const pow = (A, e) => {                   // 지수 추적 거듭제곱
    if (e === 1) return { M: A, E: 0 };
    const half = pow(A, e >> 1); let M = mul(half.M, half.M), E = 2 * half.E;
    if (e & 1) M = mul(A, M);
    if (M[(k - 1) * m + k - 1] > 1e140) { for (let i = 0; i < m * m; i++) M[i] *= 1e-140; E += 140; }
    return { M, E };
  };
  const { M, E } = pow(H, n);
  let s = M[(k - 1) * m + k - 1], eQ = E;
  for (let i = 1; i <= n; i++) { s = s * i / n; if (s < 1e-140) { s *= 1e140; eQ -= 140; } }
  return s * Math.pow(10, eQ);
}
function ksPvariants(n, D) {
  const out = { asym: kolmQ(Math.sqrt(n) * D), asymNR: kolmQ((Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * D) };
  try { out.exact = Math.min(1, Math.max(0, 1 - ksExactCdf(n, D))); } catch (e) {}
  return out;
}
function logChoose(n, k) { return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1); }
function binomPmf(k, n, p) { return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)); }
function binomVariants(k, n, p) {            // 여러 관례의 p — 기록값이 어느 것과 같은지 본다
  let ge = 0, le = 0; const pk = binomPmf(k, n, p); let two = 0;
  for (let i = 0; i <= n; i++) { const q = binomPmf(i, n, p); if (i >= k) ge += q; if (i <= k) le += q; if (q <= pk * (1 + 1e-7)) two += q; }
  return { upper: Math.min(1, ge), lower: Math.min(1, le), two: Math.min(1, two), twoMin: Math.min(1, 2 * Math.min(ge, le)) };
}
const clamp01 = x => Math.max(0, Math.min(1, x));
const topFrac = (N, best, worst) => clamp01((N - best + 1) / (worst - best + 1));
function median(xs) { const s = xs.slice().sort((a, b) => a - b), n = s.length; if (!n) return null; return n & 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

/* ── 3. 로또 엔진 (내 구현) ────────────────────────────────────────── */
const LN = 8145060;
const BIN = Array.from({ length: 46 }, (_, n) => { const r = [1]; for (let k = 1; k <= 6; k++) r[k] = r[k - 1] * (n - k + 1) / k; return r.map(v => Math.round(v)); });
for (let n = 0; n < 46; n++) for (let k = 0; k <= 6; k++) if (k > n) BIN[n][k] = 0;
function lexIndex(c) {                       // 사전식(중첩 루프 a<b<…<f 의 방문 순서) 0-based
  let idx = 0, prev = 0;
  for (let i = 0; i < 6; i++) { for (let v = prev + 1; v < c[i]; v++) idx += BIN[45 - v][5 - i]; prev = c[i]; }
  return idx;
}
function lexCombo(idx) {
  const c = []; let v = 1;
  for (let i = 0; i < 6; i++) { while (idx >= BIN[45 - v][5 - i]) { idx -= BIN[45 - v][5 - i]; v++; } c.push(v); v++; }
  return c;
}
const PC10 = new Uint8Array(1024); for (let i = 1; i < 1024; i++) PC10[i] = PC10[i >> 1] + (i & 1);
/* 특징 코드(비트 포장): c31 | c12<<3 | sum<<6 | cons<<14 | sameLast<<17 | range<<20 | decades<<26  (29비트)
   popFeat(n) = [1, c31, c12, (sum−138)/30, cons, sameLast, (range−33)/8, decades] — index.html popFeat 정의 그대로. */
const F_C31 = x => x & 7, F_C12 = x => (x >>> 3) & 7, F_SUM = x => (x >>> 6) & 255, F_CONS = x => (x >>> 14) & 7,
  F_SAME = x => (x >>> 17) & 7, F_RNG = x => (x >>> 20) & 63, F_DEC = x => (x >>> 26) & 7;
function featOfCode(x) { return [1, F_C31(x), F_C12(x), (F_SUM(x) - 138) / 30, F_CONS(x), F_SAME(x), (F_RNG(x) - 33) / 8, F_DEC(x)]; }
function codeOfCombo(c) {
  const [a, b, cc, d, e, f] = c;
  const s = a + b + cc + d + e + f;
  const c31 = c.filter(x => x <= 31).length, c12 = c.filter(x => x <= 12).length;
  let cons = 0; for (let i = 1; i < 6; i++) if (c[i] === c[i - 1] + 1) cons++;
  let ld = 0, dm = 0; for (const x of c) { ld |= 1 << (x % 10); dm |= 1 << Math.floor((x - 1) / 10); }
  return c31 | (c12 << 3) | (s << 6) | (cons << 14) | ((6 - PC10[ld]) << 17) | ((f - a) << 20) | (PC10[dm] << 26);
}
function filterOf(c) {                       // popf 주간 필터(1등 이력 제외는 별도)
  const s = c.reduce((a, b) => a + b, 0); if (s < 100 || s > 175) return false;
  const o = c.filter(x => x & 1).length; if (o < 2 || o > 4) return false;
  let cons = 0; for (let i = 1; i < 6; i++) if (c[i] === c[i - 1] + 1) cons++; if (cons > 2) return false;
  const bc = [0, 0, 0, 0, 0]; for (const x of c) bc[x > 40 ? 4 : Math.floor((x - 1) / 10)]++;
  return Math.max(...bc) <= 3;
}
let ENUM = null;
function enumerateAll() {                    // 8,145,060 조합 전부 — 특징 코드·필터 플래그
  if (ENUM) return ENUM;
  const code = new Uint32Array(LN), flag = new Uint8Array(LN);
  let i = 0, NF = 0;
  for (let a = 1; a <= 40; a++) for (let b = a + 1; b <= 41; b++) for (let c = b + 1; c <= 42; c++)
    for (let d = c + 1; d <= 43; d++) for (let e = d + 1; e <= 44; e++) for (let f = e + 1; f <= 45; f++) {
      const s = a + b + c + d + e + f;
      const c31 = (a <= 31) + (b <= 31) + (c <= 31) + (d <= 31) + (e <= 31) + (f <= 31);
      const c12 = (a <= 12) + (b <= 12) + (c <= 12) + (d <= 12) + (e <= 12) + (f <= 12);
      const cons = (b === a + 1) + (c === b + 1) + (d === c + 1) + (e === d + 1) + (f === e + 1);
      const ld = (1 << (a % 10)) | (1 << (b % 10)) | (1 << (c % 10)) | (1 << (d % 10)) | (1 << (e % 10)) | (1 << (f % 10));
      const dm = (1 << ((a - 1) / 10 | 0)) | (1 << ((b - 1) / 10 | 0)) | (1 << ((c - 1) / 10 | 0)) | (1 << ((d - 1) / 10 | 0)) | (1 << ((e - 1) / 10 | 0)) | (1 << ((f - 1) / 10 | 0));
      const x = c31 | (c12 << 3) | (s << 6) | (cons << 14) | ((6 - PC10[ld]) << 17) | ((f - a) << 20) | (PC10[dm] << 26);
      code[i] = x;
      let ok = s >= 100 && s <= 175 && cons <= 2;
      if (ok) { const o = (a & 1) + (b & 1) + (c & 1) + (d & 1) + (e & 1) + (f & 1); ok = o >= 2 && o <= 4; }
      if (ok) {
        const b0 = (a <= 10) + (b <= 10) + (c <= 10) + (d <= 10) + (e <= 10) + (f <= 10);
        const b1 = (a > 10 && a <= 20) + (b > 10 && b <= 20) + (c > 10 && c <= 20) + (d > 10 && d <= 20) + (e > 10 && e <= 20) + (f > 10 && f <= 20);
        const b2 = (a > 20 && a <= 30) + (b > 20 && b <= 30) + (c > 20 && c <= 30) + (d > 20 && d <= 30) + (e > 20 && e <= 30) + (f > 20 && f <= 30);
        const b3 = (a > 30 && a <= 40) + (b > 30 && b <= 40) + (c > 30 && c <= 40) + (d > 30 && d <= 40) + (e > 30 && e <= 40) + (f > 30 && f <= 40);
        const b4 = 6 - b0 - b1 - b2 - b3;
        ok = b0 <= 3 && b1 <= 3 && b2 <= 3 && b3 <= 3 && b4 <= 3;
      }
      if (ok) { flag[i] = 1; NF++; }
      i++;
    }
  if (i !== LN) err('enum', `열거 개수 ${i} ≠ ${LN}`);
  ENUM = { code, flag, NF };
  return ENUM;
}
/* 페이지 zOf 와 같은 연산 순서: acc=0; acc+=clamp(f_j)·β_j (j=0..7, j=0 은 clamp 안 함); z=(zA+zB)/2 또는 zA */
function zMaker(P) {
  const A = P && P.A, B = P && P.B, bd = P && Array.isArray(P.bounds) && P.bounds.length ? P.bounds : null;
  if (!A || !Array.isArray(A.beta)) return null;
  const cl = (j, v) => (j === 0 || !bd) ? v : Math.max(bd[j][0], Math.min(bd[j][1], v));
  const tab = (M) => {                         // tab[j][raw 정수값] = clamp(f_j)·β_j
    const t = [];
    t[0] = cl(0, 1) * M.beta[0];
    t[1] = Array.from({ length: 7 }, (_, v) => cl(1, v) * M.beta[1]);
    t[2] = Array.from({ length: 7 }, (_, v) => cl(2, v) * M.beta[2]);
    t[3] = Array.from({ length: 256 }, (_, s) => cl(3, (s - 138) / 30) * M.beta[3]);
    t[4] = Array.from({ length: 6 }, (_, v) => cl(4, v) * M.beta[4]);
    t[5] = Array.from({ length: 6 }, (_, v) => cl(5, v) * M.beta[5]);
    t[6] = Array.from({ length: 64 }, (_, r) => cl(6, (r - 33) / 8) * M.beta[6]);
    t[7] = Array.from({ length: 6 }, (_, v) => cl(7, v) * M.beta[7]);
    return t.map(x => Array.isArray(x) ? Float64Array.from(x) : x);
  };
  const TA = tab(A), TB = B && Array.isArray(B.beta) ? tab(B) : null;
  const lin = (T, x) => {
    let acc = 0;
    acc = acc + T[0]; acc = acc + T[1][x & 7]; acc = acc + T[2][(x >>> 3) & 7]; acc = acc + T[3][(x >>> 6) & 255];
    acc = acc + T[4][(x >>> 14) & 7]; acc = acc + T[5][(x >>> 17) & 7]; acc = acc + T[6][(x >>> 20) & 63]; acc = acc + T[7][(x >>> 26) & 7];
    return acc;
  };
  const aM = A.predMean, aS = A.predSD;
  if (!TB) return x => (lin(TA, x) - aM) / aS;
  const bM = B.predMean, bS = B.predSD;
  return x => ((lin(TA, x) - aM) / aS + (lin(TB, x) - bM) / bS) / 2;
}
/* 같은 식의 일괄판(특징 필드 배열 → z 배열). 앞 네 항(1·c31·c12·sum·cons)의 누적합은 그 네 값에만 달려 있으므로
   (c31,c12,sum,cons) 별 접두 누적합 표를 같은 순서로 먼저 만들고 나머지 세 항을 이어 더한다 — 연산 순서가 zMaker 와 같아 비트 단위로 같다. */
function zBatch(P, FD, out) {
  const A = P && P.A, B = P && P.B, bd = P && Array.isArray(P.bounds) && P.bounds.length ? P.bounds : null;
  const cl = (j, v) => (j === 0 || !bd) ? v : Math.max(bd[j][0], Math.min(bd[j][1], v));
  const tb = (M, j, len, raw) => { const t = new Float64Array(len); for (let v = 0; v < len; v++) t[v] = cl(j, raw(v)) * M.beta[j]; return t; };
  const mk = M => {
    const t0 = cl(0, 1) * M.beta[0], t1 = tb(M, 1, 7, v => v), t2 = tb(M, 2, 7, v => v), t3 = tb(M, 3, 256, v => (v - 138) / 30), t4 = tb(M, 4, 6, v => v);
    const X4 = new Float64Array(7 * 7 * 256 * 6);
    for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) for (let s = 0; s < 256; s++) for (let c = 0; c < 6; c++) {
      let x = 0; x = x + t0; x = x + t1[a]; x = x + t2[b]; x = x + t3[s]; x = x + t4[c];
      X4[((a * 7 + b) * 256 + s) * 6 + c] = x;
    }
    return [X4, tb(M, 5, 6, v => v), tb(M, 6, 64, v => (v - 33) / 8), tb(M, 7, 6, v => v)];
  };
  const [AX, a5, a6, a7] = mk(A), aM = A.predMean, aS = A.predSD;
  const { n, i4, same, rng, dec } = FD;
  if (!(B && Array.isArray(B.beta))) {
    for (let i = 0; i < n; i++) { let x = AX[i4[i]]; x = x + a5[same[i]]; x = x + a6[rng[i]]; x = x + a7[dec[i]]; out[i] = (x - aM) / aS; }
    return out;
  }
  const [BX, b5, b6, b7] = mk(B), bM = B.predMean, bS = B.predSD;
  for (let i = 0; i < n; i++) {
    const k = i4[i], p = same[i], q = rng[i], r = dec[i];
    let x = AX[k]; x = x + a5[p]; x = x + a6[q]; x = x + a7[r];
    let y = BX[k]; y = y + b5[p]; y = y + b6[q]; y = y + b7[r];
    out[i] = ((x - aM) / aS + (y - bM) / bS) / 2;
  }
  return out;
}
function fieldsOf(codes) {                   // 코드 배열 → 일괄 z 용 필드(접두 표 index·나머지 세 특징)
  const n = codes.length, F = { n, i4: new Uint32Array(n), same: new Uint8Array(n), rng: new Uint8Array(n), dec: new Uint8Array(n) };
  for (let i = 0; i < n; i++) { const x = codes[i]; F.i4[i] = ((F_C31(x) * 7 + F_C12(x)) * 256 + F_SUM(x)) * 6 + F_CONS(x); F.same[i] = F_SAME(x); F.rng[i] = F_RNG(x); F.dec[i] = F_DEC(x); }
  return F;
}
/* hot/cold 가중치 → 정확한 비교 기준(«가산 모델 M»). 부동소수 합 순서로는 절대 대조하지 않는다(같은 곱의 조합이 반올림 잡음으로 갈라진다).
   1순위 exact: 정수 밑 역산 b = round(w^(1/e)) (hot: e=2.2·밑 max(1,freq52) · cold: e=1.6·밑 1+gap), b^e 와 w 가 INV_MAXULP(4) ulp 이내면 채택 → 정수 곱으로 센다.
     왕복이 비트 단위로 같을 필요는 없다: 가중치는 브라우저(CI 는 Playwright 의 Chromium)의 Math.pow, 검증은 Node 의 Math.pow 라 1ulp 다를 수 있다
     (2026-09 CI 에서 실제 발생 — 엄격 비교(===)가 실패해 부동소수 순서로 떨어지며 거짓 ::error). 이웃 정수 밑의 b^e 는 상대 ≥ e/(b+1)(≳ 1%) 떨어져 있어
     밑을 잘못 고를 수는 없다. 허용을 ulp 로 좁게 두는 이유: 계약 점수는 q = round(log w·2^46) 이라 w 의 상대 오차 ε 는 q 를 ε·2^46 단위 움직인다 —
     4 ulp(ε ≤ 8.9e-16)면 가중치당 ≤ 0.06 단위, 한 쌍의 조합(12항)에 ≤ 0.75 단위라 «같은 곱 = 같은 동점 구간»(실측 퍼짐 ≤ 4 < ATOL 6)이 그대로 성립한다.
     그보다 크게 어긋나면(예: 1e-12 상대면 가중치당 70 단위) 정수 곱과 계약 정수화가 갈릴 수 있으므로 아래 quant 로 센다(밑은 원자료 대조용으로만 남김).
   2순위 quant: 역산이 정말 안 되면(가중치 정의가 바뀐 경우) STATUS-core 계약 그대로 — q[n] = round(log w[n]·2^bits)(bits 46, 6·max|log w|·2^bits ≥ 2^53 이면 낮춤),
     점수 Σq(정확한 정수), 동점 = |Δ| ≤ ATOL(6), 탐색 = 동점 구간 내림차순·구간 안 index 오름차순. 동점 사슬(구간 폭 > ATOL)이면 계약상 정의 불가(rank-core 도 throw)
     → ::warning 후 그 대조만 생략. 정수화 자체는 rank-core L.quantize 와 같은지 대조한다(::error).
   M = { mode, mul(곱/합), atol(0/6), key[46](밑 또는 q), lw[46](Node Math.log — next.top 의 s 대조용), bases? } — 같은 가중치 배열은 한 번만 만든다. */
const ADD_ATOL = 6, ADD_BITS = 46, INV_RTOL = 1e-12, INV_MAXULP = 4;
const addStat = { models: 0, tolerantModels: 0, weights: 0, tolerant: 0, maxUlp: 0, quant: [], chain: [] };
const addCache = new WeakMap();
const ulpBuf = new Float64Array(1), ulpInt = new BigInt64Array(ulpBuf.buffer);
function ulpDist(a, b) { ulpBuf[0] = a; const x = ulpInt[0]; ulpBuf[0] = b; const d = x - ulpInt[0]; return Number(d < 0n ? -d : d); }
function intBases(w, kind) {                 // → { bases, tol(비트 단위로 다른 개수), maxUlp } | null(어느 하나라도 1e-12 상대 밖 = 정수 밑이 아님)
  const ex = kind === 'hot' ? 2.2 : 1.6, b = new Array(46).fill(0); let tol = 0, mu = 0;
  for (let n = 1; n <= 45; n++) {
    const x = +w[n]; if (!(x > 0) || !isFinite(x)) return null;
    const g = Math.round(Math.pow(x, 1 / ex)); if (!(g >= 1)) return null;
    const y = Math.pow(g, ex);
    if (y !== x) { if (!(Math.abs(y - x) <= INV_RTOL * x)) return null; tol++; mu = Math.max(mu, ulpDist(x, y)); }
    b[n] = g;
  }
  return { bases: b, tol, maxUlp: mu };
}
function quantMine(lw) {                     // STATUS-core 계약의 정수화(내 구현)
  let mx = 0; for (let n = 1; n <= 45; n++) mx = Math.max(mx, Math.abs(lw[n]));
  let bits = ADD_BITS; while (bits > 0 && 6 * mx * Math.pow(2, bits) >= 9007199254740992) bits--;
  const scale = Math.pow(2, bits), q = new Float64Array(46); for (let n = 1; n <= 45; n++) q[n] = Math.round(lw[n] * scale);
  return { q, bits };
}
function addModel(w, kind, where) {
  if (w && typeof w === 'object' && addCache.has(w)) return addCache.get(w);
  const lw = new Float64Array(46); for (let n = 1; n <= 45; n++) lw[n] = Math.log(w[n]);
  const inv = intBases(w, kind); let M;
  addStat.models++;
  if (inv && inv.maxUlp <= INV_MAXULP) {
    M = { mode: 'exact', mul: true, atol: 0, key: Float64Array.from(inv.bases), bases: inv.bases, lw };
    addStat.weights += 45; addStat.tolerant += inv.tol; if (inv.tol) addStat.tolerantModels++; addStat.maxUlp = Math.max(addStat.maxUlp, inv.maxUlp);
  } else {
    const Q = quantMine(lw);
    M = { mode: 'quant', mul: false, atol: ADD_ATOL, key: Q.q, bits: Q.bits, lw, ...(inv ? { bases: inv.bases } : {}) };
    addStat.quant.push(where + ' ' + kind + (inv ? `(정수 밑 근처지만 최대 ${inv.maxUlp} ulp)` : ''));
    const L = RC && RC.lotto;
    if (L && typeof L.quantize === 'function' && typeof L.logw === 'function') {
      try {
        const cq = L.quantize(L.logw(kind, w)); let nb = 0;
        for (let n = 1; n <= 45; n++) if (cq[n] !== Q.q[n]) nb++;
        if (nb || (cq.bits != null && cq.bits !== Q.bits)) err(`core.quantize ${where} ${kind}`, `정수화가 계약(q=round(log w·2^${Q.bits}))과 다름 ${nb}개 (core bits ${cq.bits})`);
      } catch (e) { err(`core.quantize ${where} ${kind}`, '호출 실패: ' + e.message); }
    }
  }
  if (w && typeof w === 'object') addCache.set(w, M);
  return M;
}
const addKey = (M, c) => { const K = M.key; let v = M.mul ? 1 : 0; for (const n of c) v = M.mul ? v * K[n] : v + K[n]; return v; };
const addModeTxt = M => M.mode === 'exact' ? '수학적 동점 — 정수 곱' : `계약 정수화 ±${ADD_ATOL}`;
/* 순위(동치류 세기): 번호를 key 값으로 동치류로 묶어 6개 고르는 모든 다중집합을 센다. exact = 곱이 같음, quant = 합이 ±ATOL 안.
   quant 는 창 [kw−6, kw+6] 안의 폭과 창 밖 이웃까지 봐서 사슬이면 chain:true(계약상 정의 불가 — 대조 생략). */
function classRank(M, win) {
  const K = M.key, A = M.atol, mul = M.mul;
  const cls = new Map(); for (let n = 1; n <= 45; n++) cls.set(K[n], (cls.get(K[n]) || 0) + 1);
  const vals = [...cls.keys()].sort((a, b) => a - b), mult = vals.map(v => cls.get(v));
  const kw = addKey(M, win), hi = kw + A, lo = kw - A;
  let gt = 0, eq = 0, tot = 0, loW = kw, hiW = kw, mxB = -Infinity, mnA = Infinity;
  const rec = (i, left, acc, cnt) => {
    if (left === 0) {
      tot += cnt;
      if (acc > hi) { gt += cnt; if (acc < mnA) mnA = acc; }
      else if (acc >= lo) { eq += cnt; if (acc < loW) loW = acc; if (acc > hiW) hiW = acc; }
      else if (acc > mxB) mxB = acc;
      return;
    }
    if (i >= vals.length) return;
    let p = acc;
    for (let k = 0; k <= Math.min(left, mult[i]); k++) {
      rec(i + 1, left - k, p, cnt * BIN[mult[i]][k]);
      p = mul ? p * vals[i] : p + vals[i];
    }
  };
  rec(0, 6, mul ? 1 : 0, 1);
  if (tot !== LN) err('classRank', `조합 수 합 ${tot} ≠ ${LN}`);
  return { best: gt + 1, worst: gt + eq, chain: A > 0 && (hiW - loW > A || mxB >= loW - A || mnA <= hiW + A) };
}
/* 로또 한 회차 전수 무차별 대입 — 8,145,060 조합 각각의 z(페이지식)·hot/cold 합(float)·정수 곱(exact)을 평가해 센다 */
function bruteLottoRound(R, prm, wi, wonBefore) {
  const { code, flag } = enumerateAll();
  const zf = zMaker(prm.pop), zw = zf(code[wi]);
  /* 탐색 순서상의 정확한 위치 = best + #{같은 z · index < wi (· 우주 안)} — 열거가 index 순이라 i < wi 구간에서 센다 */
  let lt = 0, le = 0, ltF = 0, leF = 0, ofF = 0, eqB = 0, eqBF = 0;
  for (let i = 0; i < LN; i++) {
    const z = zf(code[i]);
    if (z < zw) lt++; if (z <= zw) le++;
    if (flag[i] && !wonBefore.has(i)) { ofF++; if (z < zw) ltF++; if (z <= zw) leF++; if (z === zw && i < wi) eqBF++; }
    if (z === zw && i < wi) eqB++;
  }
  const out = { R, zw, pop: { best: lt + 1, worst: le, of: LN, pos: lt + 1 + eqB },
    popf: (flag[wi] && !wonBefore.has(wi)) ? { best: ltF + 1, worst: leF, of: ofF, pos: ltF + 1 + eqBF } : { excluded: true, of: ofF } };
  const c = lexCombo(wi);
  for (const kind of ['hot', 'cold']) {
    /* ref = 계약 기준(가산 모델 M: exact 정수 곱 / quant ±ATOL) · float = 왼→오 부동소수 합(진단용 — «동점이 쪼개진 값» 판별에만 씀) */
    const M = addModel(prm[kind], kind, R), lw = M.lw, K = M.key, mul = M.mul, A = M.atol;
    let sw = lw[c[0]] + lw[c[1]]; sw = sw + lw[c[2]]; sw = sw + lw[c[3]]; sw = sw + lw[c[4]]; sw = sw + lw[c[5]];
    const kw = addKey(M, c), hi = kw + A, lo = kw - A;
    let gt = 0, ge = 0, pgt = 0, peq = 0, peqB = 0, i = 0, loW = kw, hiW = kw, mxB = -Infinity, mnA = Infinity;
    for (let a = 1; a <= 40; a++) { const s1 = lw[a], p1 = K[a];
      for (let b = a + 1; b <= 41; b++) { const s2 = s1 + lw[b], p2 = mul ? p1 * K[b] : p1 + K[b];
        for (let cc = b + 1; cc <= 42; cc++) { const s3 = s2 + lw[cc], p3 = mul ? p2 * K[cc] : p2 + K[cc];
          for (let d = cc + 1; d <= 43; d++) { const s4 = s3 + lw[d], p4 = mul ? p3 * K[d] : p3 + K[d];
            for (let e = d + 1; e <= 44; e++) { const s5 = s4 + lw[e], p5 = mul ? p4 * K[e] : p4 + K[e];
              for (let f = e + 1; f <= 45; f++) {
                const s = s5 + lw[f], p = mul ? p5 * K[f] : p5 + K[f];
                if (s > sw) gt++; if (s >= sw) ge++;
                if (p > hi) { pgt++; if (p < mnA) mnA = p; }
                else if (p >= lo) { peq++; if (i < wi) peqB++; if (p < loW) loW = p; else if (p > hiW) hiW = p; }
                else if (p > mxB) mxB = p;
                i++;
              } } } } } }
    const chain = A > 0 && (hiW - loW > A || mxB >= loW - A || mnA <= hiW + A);
    out[kind] = { float: { best: gt + 1, worst: ge, of: LN }, ref: { best: pgt + 1, worst: pgt + peq, of: LN, pos: pgt + 1 + peqB, mode: M.mode, chain }, sw, lw, M };
  }
  return out;
}
/* 전수 정렬로 브라우징 순서의 [offset, offset+k) 구간 재구성. vals: 오름차순 기준값(내림차순 모델은 −값), NaN=우주 밖 */
function browseFromSorted(vals, sorted, universe, offset, k) {
  const out = [];
  let q = offset;
  while (out.length < k && q < universe) {
    const v = sorted[q];
    let lo = 0, hi = q; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    const G = lo;                              // v 보다 작은 개수
    let skip = q - G;                          // 동점 그룹 안에서 index 오름차순 skip 번째부터
    for (let i = 0; i < LN && out.length < k; i++) {
      if (vals[i] === v) { if (skip > 0) { skip--; continue; } out.push({ r: q + 1, idx: i, v }); q++; if (q >= universe || sorted[q] !== v) break; }
    }
  }
  return out;
}

/* ── 4. 연금 엔진 (내 구현) ────────────────────────────────────────── */
const PN = 5000000;
function avgPoints(s) {                      // 점수 내림차순 1위 = len 점 … 꼴찌 = 1점, 동점은 평균
  const L = s.length, idx = [...Array(L).keys()].sort((a, b) => s[b] - s[a] || a - b), out = new Array(L);
  let i = 0;
  while (i < L) { let j = i; while (j + 1 < L && s[idx[j + 1]] === s[idx[i]]) j++;
    const p = L + 1 - ((i + 1) + (j + 1)) / 2; for (let t = i; t <= j; t++) out[idx[t]] = p; i = j + 1; }
  return out;
}
const pensionPoints = S => ({ pos: S.pos.map(avgPoints), band: avgPoints(S.band) });
const dig6 = s => String(s).padStart(6, '0').split('').map(Number);
function brutePension(pts, win) {            // 5,000,000 장 + 10^6 번호 전부
  const P = pts.pos, bp = pts.band, d = dig6(win.num);
  const nw = P[0][d[0]] + P[1][d[1]] + P[2][d[2]] + P[3][d[3]] + P[4][d[4]] + P[5][d[5]];
  const tw = nw + bp[win.band - 1], wb = win.band - 1, wn = +win.num;
  let ngt = 0, nge = 0, tgt = 0, tge = 0, teqB = 0, num = 0;   // teqB: 같은 점수 · 티켓 index((조−1)·10^6+번호) 더 작음
  for (let a = 0; a < 10; a++) { const s1 = P[0][a];
    for (let b = 0; b < 10; b++) { const s2 = s1 + P[1][b];
      for (let c = 0; c < 10; c++) { const s3 = s2 + P[2][c];
        for (let e = 0; e < 10; e++) { const s4 = s3 + P[3][e];
          for (let f = 0; f < 10; f++) { const s5 = s4 + P[4][f];
            for (let g = 0; g < 10; g++) { const sn = s5 + P[5][g];
              if (sn > nw) ngt++; if (sn >= nw) nge++;
              for (let k = 0; k < 5; k++) { const st = sn + bp[k]; if (st > tw) tgt++; if (st >= tw) { tge++; if (st === tw && (k < wb || (k === wb && num < wn))) teqB++; } }
              num++;
            } } } } } }
  return { best: tgt + 1, worst: tge, of: PN, pos: tgt + 1 + teqB, numRank: { best: ngt + 1, worst: nge, of: 1e6 } };
}
function dpPension(pts, win) {               // 점수 ×2 정수 단위 분포 합성곱
  const u = v => { const x = Math.round(v * 2); if (x !== v * 2) throw new Error('반정수 아님 ' + v); return x; };
  let dist = [1];
  for (let p = 0; p < 6; p++) {
    const nd = new Array(dist.length + 21).fill(0);
    for (let s = 0; s < dist.length; s++) if (dist[s]) for (let dd = 0; dd < 10; dd++) nd[s + u(pts.pos[p][dd])] += dist[s];
    dist = nd;
  }
  const td = new Array(dist.length + 11).fill(0);
  for (let s = 0; s < dist.length; s++) if (dist[s]) for (let b = 0; b < 5; b++) td[s + u(pts.band[b])] += dist[s];
  const d = dig6(win.num); let nw = 0; for (let p = 0; p < 6; p++) nw += u(pts.pos[p][d[p]]);
  const tw = nw + u(pts.band[win.band - 1]);
  const cnt = (D, w) => { let gt = 0, eq = 0; for (let s = 0; s < D.length; s++) { if (s > w) gt += D[s]; else if (s === w) eq += D[s]; } return { best: gt + 1, worst: gt + eq }; };
  return { ...cnt(td, tw), of: PN, numRank: { ...cnt(dist, nw), of: 1e6 } };
}
function pensionUnits(pts) {                 // 모든 티켓의 점수(×2 정수) — 인덱스 = (조−1)·10^6 + 번호
  const U = new Uint8Array(PN), P = pts.pos.map(r => r.map(v => Math.round(v * 2))), bp = pts.band.map(v => Math.round(v * 2));
  for (let b = 0; b < 5; b++) { let i = b * 1e6;
    for (let a = 0; a < 10; a++) for (let c = 0; c < 10; c++) for (let d = 0; d < 10; d++) for (let e = 0; e < 10; e++) for (let f = 0; f < 10; f++) {
      const s5 = bp[b] + P[0][a] + P[1][c] + P[2][d] + P[3][e] + P[4][f];
      for (let g = 0; g < 10; g++) U[i++] = s5 + P[5][g];
    } }
  return U;
}
function pensionBrowse(U, offset, k) {       // 점수 내림차순, 동점은 티켓 index 오름차순
  const cnt = new Float64Array(256); for (let i = 0; i < PN; i++) cnt[U[i]]++;
  const out = []; let q = offset;
  while (out.length < k && q < PN) {
    let acc = 0, v = 255; for (; v >= 0; v--) { if (acc + cnt[v] > q) break; acc += cnt[v]; }
    let skip = q - acc;
    for (let i = 0; i < PN && out.length < k; i++) if (U[i] === v) { if (skip > 0) { skip--; continue; }
      out.push({ r: q + 1, band: Math.floor(i / 1e6) + 1, num: String(i % 1e6).padStart(6, '0'), s: v / 2 }); q++; if (q >= acc + cnt[v]) break; }
  }
  return out;
}

/* ── 5. 페이지 구동 (validate/backfill 과 같은 serve·mockRoutes) ─────────── */
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const s = http.createServer((q, res) => {
    const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ srv: s, port: s.address().port })));
}
async function mockRoutes(ctx, pension, lotto) {
  const pRows = pension.slice().sort((a, b) => b.ep - a.ep);
  await ctx.route('**dhlottery.co.kr/**', route => {
    const u = route.request().url();
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('selectPstPt720WnList')) return json({ data: { result: pRows.map(r => ({
      psltEpsd: r.ep, psltRflYmd: r.date, wnBndNo: String(r.band), wnRnkVl: r.num, bnsRnkVl: r.bonus })) } });
    if (u.includes('selectPstPt720WnInfo')) {
      const ep = +(u.match(/srchPsltEpsd=(\d+)/) || [])[1];
      const r = pension.find(x => x.ep === ep);
      if (!r || !r.cnt) return json({ data: { result: [] } });
      return json({ data: { result: Object.keys(r.cnt).map(k => ({ wnRnk: +k, wnTotalCnt: r.cnt[k], wnInternetCnt: (r.net || {})[k] || 0, wnStoreCnt: 0 })) } });
    }
    if (u.includes('selectPstLt645InfoNew')) {
      const c = +(u.match(/srchLtEpsd=(\d+)/) || [])[1];
      let l = lotto.rows.filter(x => +x.ltEpsd >= c - 5 && +x.ltEpsd <= c + 4);
      if (!l.length) l = lotto.rows.slice(-10);
      return json({ data: { list: l.slice().sort((a, b) => b.ltEpsd - a.ltEpsd) } });
    }
    return json({ data: {} });
  });
  await ctx.route('**fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**fonts.gstatic.com/**', r => r.abort());
}
async function loadChromium() {
  for (const p of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs', '/usr/lib/node_modules/playwright/index.mjs']) {
    try { const m = await import(p); if (m.chromium) return m.chromium; } catch (e) {}
  }
  return null;
}
/* 로또 페이지: 회차 R 마다 DB 를 R−1 까지 잘라(bumpDB) fitPop/weightsFor, 조합들의 popFeat·zOf 를 읽는다 */
async function pageLotto(browser, base, pension, lotto, rounds, combos) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' }); await mockRoutes(ctx, pension, lotto);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof DB !== 'undefined' && DB.latest > 100 && DB.draws && DB.draws[DB.latest], { timeout: 120000 });
  await p.waitForTimeout(800);
  const out = await p.evaluate(({ rounds, combos }) => {
    if (typeof fitPop !== 'function' || typeof zOf !== 'function' || typeof popFeat !== 'function' || typeof weightsFor !== 'function' || typeof bumpDB !== 'function')
      return { error: 'index.html 에 fitPop/zOf/popFeat/weightsFor/bumpDB 가 없습니다' };
    const reset = () => { try { POPFIT = null; POPFIT_N = -1; } catch (e) {} try { WINSET = null; WINSET_N = -1; } catch (e) {} };
    const pick = M => M ? { beta: M.beta.slice(), predMean: M.predMean, predSD: M.predSD } : null;
    const orig = DB.draws, L = DB.latest, work = orig.slice(), res = { latest: L, rounds: {} };
    res.feats = combos.map(c => popFeat(c));
    try {
      DB.draws = work;
      for (const R of rounds) {
        for (let j = 1; j < orig.length; j++) work[j] = orig[j];
        for (let j = R; j < work.length; j++) work[j] = undefined;
        DB.latest = Math.min(L, R - 1); bumpDB(); reset();
        const F = fitPop();
        res.rounds[R] = { dbLatest: DB.latest, n: allRows().length,
          pop: { A: pick(F.A), B: pick(F.B), bounds: (F.bounds || []).map(b => b.slice()) },
          hot: weightsFor('hot').slice(), cold: weightsFor('cold').slice(), z: combos.map(c => zOf(c)) };
      }
    } finally { DB.draws = orig; DB.latest = L; bumpDB(); reset(); }
    return res;
  }, { rounds, combos });
  await ctx.close();
  out.pageErrors = errs;
  return out;
}
async function pagePension(browser, base, pension, lotto, eps) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' }); await mockRoutes(ctx, pension, lotto);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/pension.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof DB !== 'undefined' && DB.rounds && DB.rounds.length > 50, { timeout: 90000 });
  await p.waitForTimeout(500);
  const out = await p.evaluate(({ eps }) => {
    if (typeof currentScores !== 'function' || typeof predSettings !== 'function') return { error: 'pension.html 에 currentScores/predSettings 가 없습니다' };
    const save = DB.rounds, all = save.slice().sort((a, b) => a.ep - b.ep), res = { latest: all[all.length - 1].ep, eps: {} };
    try {
      for (const ep of eps) {
        DB.rounds = all.filter(r => r.ep < ep);
        const S = {}; for (const m of ['freq', 'cold', 'recent', 'gap', 'rand']) { const x = currentScores(m, ep * 7919); S[m] = { pos: x.pos.map(r => r.slice()), band: x.band.slice() }; }
        res.eps[ep] = { n: DB.rounds.length, site: predSettings().model, S };
      }
    } finally { DB.rounds = save; }
    return res;
  }, { eps });
  await ctx.close();
  out.pageErrors = errs;
  return out;
}

/* ── 6. 본 실행 ─────────────────────────────────────────────────── */
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return undefined; } };
const B = f => path.join(DIR, 'brief', f);
const rL = readJ(B('rank-lotto.json')), rLP = readJ(B('rank-params-lotto.json'));
const rP = readJ(B('rank-pension.json')), rPP = readJ(B('rank-params-pension.json'));
for (const [n, o] of [['rank-lotto.json', rL], ['rank-params-lotto.json', rLP], ['rank-pension.json', rP], ['rank-params-pension.json', rPP]])
  if (!o) err('files', `${B(n)} 없음/JSON 오류`);

/* --root 는 전체 저장소여야 한다(rank-core.js 를 vm 으로, index.html·pension.html 을 페이지로 띄운다).
   산출물만 있는 폴더를 root 로 주면 페이지가 404 로 떠서 90 s 대기 뒤에야 실패했다 → 먼저 확인하고 바로 알린다. */
const ROOT_MISSING = ['index.html', 'pension.html'].filter(f => !fs.existsSync(path.join(ROOT, f)));
if (!fs.existsSync(CORE)) err('root', `${CORE} 없음 — --root 는 전체 저장소 사본이어야 합니다(산출물 폴더는 --dir 로)`);
if (ROOT_MISSING.length && !NOPAGE) err('root', `${ROOT} 에 ${ROOT_MISSING.join('·')} 없음 — 페이지 동등성 건너뜀(--root 는 전체 저장소, 산출물 폴더는 --dir)`);
let RC = null;
if (fs.existsSync(CORE)) try {
  const src = fs.readFileSync(CORE, 'utf8');
  vm.runInThisContext(src, { filename: CORE });
  RC = globalThis.RANKCORE || null;
  if (!RC) err('rank-core', 'RANKCORE 전역이 없습니다');
} catch (e) { err('rank-core', '로드 실패: ' + e.message); }

const [pensionRaw, lottoRaw] = await getData();
const draws = new Map();
for (const o of lottoRaw.rows) draws.set(+o.ltEpsd, { round: +o.ltEpsd, date: String(o.ltRflYmd),
  n: [o.tm1WnNo, o.tm2WnNo, o.tm3WnNo, o.tm4WnNo, o.tm5WnNo, o.tm6WnNo].map(Number).sort((a, b) => a - b), b: +o.bnsWnNo });
const LATEST = Math.max(...draws.keys());
const pens = pensionRaw.slice().sort((a, b) => a.ep - b.ep), pByEp = new Map(pens.map(r => [r.ep, r])), PLATEST = pens[pens.length - 1].ep;
const summary = { ok: false, lotto: {}, pension: {}, page: {}, core: {}, timings: TM };
const rr = row => row.round != null ? +row.round : +row.ep;

/* 사전식 index 로 본 과거 1등 조합 → 처음 나온 회차 */
const firstWon = new Map();
for (const d of [...draws.values()].sort((a, b) => a.round - b.round)) { const k = lexIndex(d.n); if (!firstWon.has(k)) firstWon.set(k, d.round); }
const wonBeforeSet = R => { const s = new Set(); for (const [k, r] of firstWon) if (r < R) s.add(k); return s; };

/* 표본 선택(결정적): 최신 완료 회차 + 최신 회차로 정해지는 회전 표본(매주 바뀐다) */
function pickSamples(rounds, k, seed, override) {
  if (override) return override.split(',').map(Number).filter(x => rounds.includes(x));
  const rs = rounds.slice().sort((a, b) => a - b); if (!rs.length) return [];
  const out = [rs[rs.length - 1]]; let h = (seed * 2654435761) >>> 0;
  while (out.length < Math.min(k, rs.length)) { h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9E3779B9) >>> 0; const r = rs[h % rs.length]; if (!out.includes(r)) out.push(r); }
  return out;
}
const lRows = (rL && Array.isArray(rL.rows)) ? rL.rows.slice().sort((a, b) => rr(a) - rr(b)) : [];
const pRowsJ = (rP && Array.isArray(rP.rows)) ? rP.rows.slice().sort((a, b) => rr(a) - rr(b)) : [];
const LS = pickSamples(lRows.map(rr), 2, LATEST, arg('--lotto-samples', null));
const PS = pickSamples(pRowsJ.map(rr), 3, PLATEST, arg('--pension-samples', null));
const LNEXT = rL && rL.next ? +rL.next.round : LATEST + 1;
const PNEXT = rP && rP.next ? +(rP.next.round ?? rP.next.ep) : PLATEST + 1;
summary.lotto.samples = LS; summary.pension.samples = PS;
log('로또 표본', LS, '다음', LNEXT, '· 연금 표본', PS, '다음', PNEXT);

/* 페이지 동등성용 조합: 결정적 난수 3,000 + 경계·표본 당첨 조합 */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry(LATEST * 7919 + 17);
const pageCombos = [[1, 2, 3, 4, 5, 6], [40, 41, 42, 43, 44, 45], [1, 2, 3, 43, 44, 45], [1, 11, 21, 31, 41, 45], [5, 10, 15, 20, 25, 30]];
for (const R of LS) if (draws.get(R)) pageCombos.push(draws.get(R).n);
while (pageCombos.length < 3000 + 5 + LS.length) pageCombos.push(lexCombo(Math.floor(rnd() * LN)));

/* ── 6a. 페이지(백그라운드로 시작 — 브라우저는 별도 프로세스라 아래 CPU 작업과 겹친다) ── */
let pagePromise = Promise.resolve(null);
if (!NOPAGE && !ROOT_MISSING.length) {
  pagePromise = (async () => {
    const chromium = await loadChromium();
    if (!chromium) { warn('page', 'playwright 없음 — 페이지 동등성 건너뜀'); return null; }
    const { srv, port } = await serve(ROOT); const base = 'http://127.0.0.1:' + port;
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const t = performance.now();
      const [lp, pp] = await Promise.all([
        pageLotto(browser, base, pensionRaw, lottoRaw, [LNEXT, ...LS], pageCombos),
        pagePension(browser, base, pensionRaw, lottoRaw, [PNEXT, ...PS])]);
      TM.page = Math.round(performance.now() - t);
      return { lp, pp };
    } finally { await browser.close(); srv.close(); }
  })().catch(e => { err('page', '페이지 구동 실패: ' + (e && e.message || e)); return null; });
}

/* ── 6b. 구조 검사 ── */
const eqRange = (a, b) => a && b && a.best === b.best && a.worst === b.worst;
function checkRankObj(scope, o, of) {
  if (!o || typeof o !== 'object') { err(scope, '순위 객체 없음'); return false; }
  if (o.excluded) { if (o.of != null && !(o.of > 0)) err(scope, `excluded.of=${o.of}`); return true; }
  const { best, worst, mid, pct } = o;
  if (!(Number.isInteger(best) && Number.isInteger(worst) && best >= 1 && best <= worst && worst <= of)) { err(scope, `[best,worst]=[${best},${worst}] 범위 오류 (of=${of})`); return false; }
  if (mid !== (best + worst) / 2) err(scope, `mid=${mid} ≠ (best+worst)/2=${(best + worst) / 2}`);
  const ep = ((best + worst) / 2 - 0.5) / of;
  if (!nearRel(pct, ep, 1e-12)) err(scope, `pct=${pct} ≠ (mid−0.5)/of=${ep}`);
  if (o.of != null && o.of !== of) err(scope, `of=${o.of} ≠ ${of}`);
  return true;
}
const LKEYS = ['pop', 'popf', 'hot', 'cold'], PKEYS = ['freq', 'cold', 'recent', 'gap', 'rand', 'site'];
if (rL) {
  if (rL.v !== 1 || rL.kind !== 'lotto' || rL.N !== LN) err('lotto', `헤더 v/kind/N = ${rL.v}/${rL.kind}/${rL.N}`);
  if (typeof rL.note !== 'string' || !rL.note) warn('lotto.note', '정직 문구(note) 없음');
  const mk = (rL.models || []).map(m => m.key);
  if (JSON.stringify(mk) !== JSON.stringify(LKEYS)) err('lotto.models', `키 ${JSON.stringify(mk)} ≠ ${JSON.stringify(LKEYS)}`);
  const dirs = { pop: 'asc', popf: 'asc', hot: 'desc', cold: 'desc' }, claims = { pop: 'none', popf: 'none', hot: 'hit', cold: 'hit' };
  for (const m of rL.models || []) { if (dirs[m.key] && m.dir !== dirs[m.key]) err('lotto.models', `${m.key}.dir=${m.dir}`);
    if (claims[m.key] && m.claims !== claims[m.key]) warn('lotto.models', `${m.key}.claims=${m.claims} (PLAN: ${claims[m.key]})`); }
  const rounds = lRows.map(rr);
  if (rounds.length) {
    if (rL.from != null && rounds[0] !== +rL.from) err('lotto', `첫 행 ${rounds[0]} ≠ from ${rL.from}`);
    if (rL.latest != null && rounds[rounds.length - 1] !== +rL.latest) err('lotto', `마지막 행 ${rounds[rounds.length - 1]} ≠ latest ${rL.latest}`);
    for (let i = 1; i < rounds.length; i++) if (rounds[i] !== rounds[i - 1] + 1) err('lotto.rows', `회차 불연속 ${rounds[i - 1]} → ${rounds[i]}`);
  }
  if (+rL.latest !== LATEST) warn('lotto', `latest=${rL.latest}, 원자료 최신=${LATEST}`);
  if (LNEXT !== (+rL.latest) + 1) err('lotto.next', `next.round=${LNEXT} ≠ latest+1`);
  for (const row of lRows) {
    const R = rr(row), d = draws.get(R), sc = 'lotto R=' + R;
    if (!d) { err(sc, '원자료에 없는 회차'); continue; }
    if (JSON.stringify((row.win || []).map(Number)) !== JSON.stringify(d.n)) err(sc, `win ${JSON.stringify(row.win)} ≠ ${JSON.stringify(d.n)}`);
    if (row.bonus != null && +row.bonus !== d.b) err(sc, `bonus ${row.bonus} ≠ ${d.b}`);
    if (row.date != null && digits8(row.date) !== digits8(d.date)) err(sc, `date ${row.date} ≠ ${d.date}`);
    const K = row.ranks || {};
    for (const k of LKEYS) {
      const o = K[k]; if (!o) { err(sc, `ranks.${k} 없음`); continue; }
      checkRankObj(sc + ' ' + k, o, k === 'popf' ? (o.of || NaN) : LN);
    }
  }
}
if (rLP) {
  const want = []; if (lRows.length) for (let R = rr(lRows[0]); R <= LNEXT; R++) want.push(R);
  const miss = want.filter(R => !rLP.rows || !rLP.rows[R]);
  if (miss.length) err('lotto.params', `params 누락 회차 ${miss.length}개: ${miss.slice(0, 10).join(',')}`);
}
/* H. wonIdx — (i+1)회 1등 조합의 사전식 index, 길이 = latest, 자료가 빠진 회차만 null. 탐색기가 popf 제외 목록
   (wonIdx.slice(0, R−1))으로 쓰므로 한 칸만 틀려도 그 뒤 모든 회차의 popf 순위·분모가 달라진다. */
if (rL) {
  const W = rL.wonIdx, sc = 'lotto.wonIdx';
  if (!Array.isArray(W)) err(sc, '없음(배열이어야 함)');
  else {
    if (W.length !== +rL.latest) err(sc, `길이 ${W.length} ≠ latest ${rL.latest}`);
    let bad = 0, nul = 0;
    for (let i = 0; i < W.length; i++) {
      const d = draws.get(i + 1), v = W[i];
      if (v == null) { if (d) { if (bad++ < 5) err(sc, `[${i}] (=${i + 1}회) null 인데 원자료에 있음 → ${lexIndex(d.n)}`); } else nul++; continue; }
      if (!Number.isInteger(v) || v < 0 || v >= LN) { if (bad++ < 5) err(sc, `[${i}] (=${i + 1}회) ${v} 범위 오류`); continue; }
      if (!d) { if (nul++ < 3) warn(sc, `[${i}] (=${i + 1}회) 원자료에 없는 회차인데 값 ${v}`); continue; }
      const want = lexIndex(d.n);
      if (v !== want) { if (bad++ < 5) err(sc, `[${i}] (=${i + 1}회) ${v} (${lexCombo(v).join('-')}) ≠ 원자료 ${want} (${d.n.join('-')})`); }
    }
    if (bad > 5) err(sc, `불일치 모두 ${bad}건`);
    summary.lotto.wonIdx = { n: W.length, bad, missing: nul };
  }
}
if (rP) {
  if (rP.v !== 1 || rP.kind !== 'pension' || +rP.N !== PN) err('pension', `헤더 v/kind/N = ${rP.v}/${rP.kind}/${rP.N}`);
  if (typeof rP.note !== 'string' || !rP.note) warn('pension.note', '정직 문구(note) 없음');
  const mk = (rP.models || []).map(m => m.key);
  if (JSON.stringify(mk) !== JSON.stringify(PKEYS)) err('pension.models', `키 ${JSON.stringify(mk)} ≠ ${JSON.stringify(PKEYS)}`);
  const eps = pRowsJ.map(rr);
  if (eps.length) {
    if (rP.from != null && eps[0] !== +rP.from) err('pension', `첫 행 ${eps[0]} ≠ from ${rP.from}`);
    if (rP.latest != null && eps[eps.length - 1] !== +rP.latest) err('pension', `마지막 행 ${eps[eps.length - 1]} ≠ latest ${rP.latest}`);
    for (let i = 1; i < eps.length; i++) if (eps[i] !== eps[i - 1] + 1) err('pension.rows', `회차 불연속 ${eps[i - 1]} → ${eps[i]}`);
  }
  if (PNEXT !== (+rP.latest) + 1) err('pension.next', `next=${PNEXT} ≠ latest+1`);
  for (const row of pRowsJ) {
    const E = rr(row), d = pByEp.get(E), sc = 'pension ep=' + E;
    if (!d) { err(sc, '원자료에 없는 회차'); continue; }
    const w = row.win || {};
    if (+w.band !== d.band || String(w.num) !== d.num) err(sc, `win ${JSON.stringify(w)} ≠ ${d.band}조 ${d.num}`);
    if (row.date != null && digits8(row.date) !== digits8(d.date)) err(sc, `date ${row.date} ≠ ${d.date}`);
    const K = row.ranks || {};
    for (const k of PKEYS) {
      const o = K[k]; if (!o) { err(sc, `ranks.${k} 없음`); continue; }
      if (checkRankObj(sc + ' ' + k, o, PN) && o.numRank) checkRankObj(sc + ' ' + k + '.numRank', o.numRank, 1e6);
      else if (!o.numRank) err(sc, `ranks.${k}.numRank 없음`);
    }
    const site = rPP && rPP.rows && rPP.rows[E] && rPP.rows[E].site;
    if (site && K.site && K[site] && !(eqRange(K.site, K[site]) && eqRange(K.site.numRank, K[site].numRank))) err(sc, `site(=${site}) 순위가 ${site} 와 다름`);
  }
}
if (rPP) {
  const want = []; if (pRowsJ.length) for (let E = rr(pRowsJ[0]); E <= PNEXT; E++) want.push(E);
  const miss = want.filter(E => !rPP.rows || !rPP.rows[E]);
  if (miss.length) err('pension.params', `params 누락 회차 ${miss.length}개: ${miss.slice(0, 10).join(',')}`);
}
await yieldLoop();

/* ── 6c. 조합수 체계·rank-core 기본 함수 ── */
await timed('bijection', async () => {
  // 내 lexIndex/lexCombo 자체 확인(열거 순서와 같은가) — 경계 + 결정적 표본
  const chk = [0, 1, 2, LN - 2, LN - 1]; for (let a = 1; a <= 40; a++) chk.push(lexIndex([a, a + 1, a + 2, a + 3, a + 4, a + 5]));
  for (const i of chk) if (lexIndex(lexCombo(i)) !== i) err('lexIndex', `내 index/combo 자기모순 @${i}`);
  if (!RC || !RC.lotto) return;
  const L = RC.lotto;
  if (L.N !== LN) err('core.lotto.N', `${L.N}`);
  if (typeof L.index !== 'function' || typeof L.combo !== 'function') { err('core.lotto', 'index/combo 없음'); return; }
  const r2 = mulberry(12345); const ids = [...chk];
  for (let t = 0; t < 100000; t++) ids.push(Math.floor(r2() * LN));
  let bad = 0;
  for (const i of ids) {
    const mine = lexCombo(i), c = L.combo(i);
    const cc = Array.from(c || []);
    if (cc.length !== 6 || cc.some((v, j) => v !== mine[j])) { if (bad++ < 5) err('core.combo', `combo(${i})=${JSON.stringify(cc)} ≠ ${JSON.stringify(mine)}`); continue; }
    const j = L.index(mine); if (j !== i) { if (bad++ < 5) err('core.index', `index(${mine})=${j} ≠ ${i}`); }
  }
  summary.core.bijection = { n: ids.length, bad };
  if (typeof L.filterPass === 'function') {
    const E = enumerateAll(); let fb = 0;
    for (let t = 0; t < 200000; t++) { const i = Math.floor(r2() * LN); const c = lexCombo(i); if (!!L.filterPass(c) !== !!E.flag[i]) { if (fb++ < 5) err('core.filterPass', `${c} core=${L.filterPass(c)} mine=${!!E.flag[i]}`); } }
    summary.core.filterPass = { n: 200000, bad: fb };
  }
});
log('전단사·필터 확인 완료');
await yieldLoop();
const E = await timed('enumerate', async () => enumerateAll());
summary.lotto.NF = E.NF;
if (rL && rL.NF !== E.NF) err('lotto.NF', `NF=${rL.NF} ≠ 전수 ${E.NF}`);
await yieldLoop();

/* ── 6d. 로또 무차별 대입(표본) ── */
const lottoParams = R => rLP && rLP.rows && rLP.rows[R];
const coreT = { T: null };
function coreTable() {
  if (coreT.T || !RC || !RC.lotto || typeof RC.lotto.buildTable !== 'function') return coreT.T;
  const t = performance.now(); coreT.T = RC.lotto.buildTable({}); TM.coreBuildTable = Math.round(performance.now() - t); return coreT.T;
}
/* hot/cold: 계약(STATUS-core) = 수학적 동점(정수 곱이 같음). 밑 역산(허용 오차)이 되면 정수 곱 전수와, 정말 안 되면 계약 정수화(±ATOL) 전수와
   정확히 같아야 한다(::error). 부동소수 합 결과는 «동점이 쪼개진 값인지» 진단 문구에만 쓴다. 동점 사슬이면 정의 불가 → 생략(경고는 모아서 한 번). */
function cmpAdditive(sc, rec, mine) {
  if (!rec) return;
  const ref = mine.ref;
  if (ref.chain) { addStat.chain.push(sc); return; }
  if (!eqRange(rec, ref)) err(sc, `기록 [${rec.best},${rec.worst}] ≠ 전수(${addModeTxt(mine.M)}) [${ref.best},${ref.worst}]` +
    (eqRange(rec, mine.float) ? ' — 부동소수 합으로 동점이 쪼개진 값과 같음' : ` (float 합 [${mine.float.best},${mine.float.worst}])`));
}
await timed('bruteLotto', async () => {
  for (const R of LS) {
    const row = lRows.find(x => rr(x) === R), prm = lottoParams(R), d = draws.get(R);
    if (!row || !prm || !d) { err('brute.lotto R=' + R, 'row/params 없음'); continue; }
    const wi = lexIndex(d.n);
    const t = performance.now();
    const b = bruteLottoRound(R, prm, wi, wonBeforeSet(R));
    const K = row.ranks || {}, sc = 'brute.lotto R=' + R;
    if (!eqRange(K.pop, b.pop)) err(sc + ' pop', `기록 [${K.pop && K.pop.best},${K.pop && K.pop.worst}] ≠ 전수 [${b.pop.best},${b.pop.worst}]`);
    if (b.popf.excluded) { if (!(K.popf && K.popf.excluded)) err(sc + ' popf', `전수는 필터 밖(excluded), 기록 ${JSON.stringify(K.popf)}`); }
    else if (!eqRange(K.popf, b.popf)) err(sc + ' popf', `기록 [${K.popf && K.popf.best},${K.popf && K.popf.worst}] ≠ 전수 [${b.popf.best},${b.popf.worst}]`);
    if (K.popf && K.popf.of != null && K.popf.of !== b.popf.of) err(sc + ' popf.of', `${K.popf.of} ≠ 전수 ${b.popf.of}`);
    cmpAdditive(sc + ' hot', K.hot, b.hot); cmpAdditive(sc + ' cold', K.cold, b.cold);
    const refOf = x => ({ best: x.ref.best, worst: x.ref.worst, of: LN, mode: x.ref.mode, ...(x.ref.chain ? { chain: true } : {}) });
    summary.lotto['brute' + R] = { pop: b.pop, popf: b.popf, hot: refOf(b.hot), hotFloat: b.hot.float, cold: refOf(b.cold), coldFloat: b.cold.float, ms: Math.round(performance.now() - t) };
    // rank-core 직접 비교(같은 회차) — 탐색기 «당첨번호 위치로 이동»이 쓰는 함수
    if (RC && RC.lotto && typeof RC.lotto.rankPop === 'function') {
      try {
        const T = coreTable(), L = RC.lotto;
        const cp = L.rankPop(prm.pop, T, d.n, { filter: false });
        if (!eqRange(cp, b.pop)) err(sc + ' core.rankPop', `[${cp.best},${cp.worst}] ≠ 전수 [${b.pop.best},${b.pop.worst}]`);
        const excl = [...wonBeforeSet(R)].map(lexCombo);
        const cf = L.rankPop(prm.pop, T, d.n, { filter: true, excludeWon: excl });
        if (b.popf.excluded ? !cf.excluded : !eqRange(cf, b.popf)) err(sc + ' core.rankPop(filter)', `${JSON.stringify(cf)} ≠ 전수 ${JSON.stringify(b.popf)}`);
        if (cf.of != null && cf.of !== b.popf.of) err(sc + ' core.rankPop(filter).of', `${cf.of} ≠ ${b.popf.of}`);
        for (const kind of ['hot', 'cold']) {
          if (b[kind].ref.chain) { addStat.chain.push(sc + ' core.rankAdditive ' + kind); continue; }   // 사슬이면 rank-core 도 throw(계약)
          const ca = L.rankAdditive(L.logw ? L.logw(kind, prm[kind]) : b[kind].lw, d.n);
          cmpAdditive(sc + ' core.rankAdditive ' + kind, ca, b[kind]);
        }
        // 정확한 위치(탐색기 «당첨번호 위치로 이동») = 전수 위치
        const pos = {};
        if (typeof L.posPop === 'function') {
          pos.pop = L.posPop(prm.pop, T, d.n, { filter: false });
          if (pos.pop !== b.pop.pos) err(sc + ' core.posPop', `${pos.pop} ≠ 전수 위치 ${b.pop.pos} (구간 [${b.pop.best},${b.pop.worst}])`);
          pos.popf = L.posPop(prm.pop, T, d.n, { filter: true, excludeWon: excl });
          if (b.popf.excluded ? pos.popf != null : pos.popf !== b.popf.pos) err(sc + ' core.posPop(filter)', `${pos.popf} ≠ 전수 위치 ${b.popf.excluded ? 'null(제외)' : b.popf.pos}`);
        } else warn(sc + ' core.posPop', '없음 — 탐색기가 동점 구간을 훑는 느린 경로를 씀');
        if (typeof L.posAdditive === 'function') {
          for (const kind of ['hot', 'cold']) {
            const ref = b[kind].ref; if (ref.chain) continue;
            pos[kind] = L.posAdditive(L.logw(kind, prm[kind]), d.n);
            if (pos[kind] !== ref.pos) err(sc + ' core.posAdditive ' + kind, `${pos[kind]} ≠ 전수 위치 ${ref.pos} (구간 [${ref.best},${ref.worst}], ${addModeTxt(b[kind].M)})`);
          }
        } else warn(sc + ' core.posAdditive', '없음 — 탐색기가 동점 구간을 훑는 느린 경로를 씀');
        summary.lotto['pos' + R] = { pop: b.pop.pos, popf: b.popf.pos ?? null, hot: b.hot.ref.chain ? null : b.hot.ref.pos, cold: b.cold.ref.chain ? null : b.cold.ref.pos, core: pos };
      } catch (e) { err(sc + ' core', '호출 실패: ' + e.message); }
    }
    log('로또 전수', R, (performance.now() - t).toFixed(0) + 'ms', JSON.stringify(summary.lotto['brute' + R]));
    await yieldLoop();
  }
});

/* ── 6e. 로또 전 회차 재계수(내 코드: 특징 히스토그램 × 페이지식 z · 동치류 곱 세기) ── */
function hotColdBasesMine(R) {               // 원자료로 직접: hot = max(1, 최근 52회 출현수), cold = 1 + (R−1 − 마지막 출현 회차)
  const rs = []; for (let r = 1; r < R; r++) if (draws.get(r)) rs.push(draws.get(r));
  const f = new Array(46).fill(0); for (const d of rs.slice(-52)) for (const n of d.n) f[n]++;
  const last = new Array(46).fill(0); for (const d of rs) for (const n of d.n) last[n] = d.round;
  const hot = new Array(46).fill(0), cold = new Array(46).fill(0);
  for (let n = 1; n <= 45; n++) { hot[n] = Math.max(1, f[n]); cold[n] = 1 + (last[n] ? (R - 1) - last[n] : (R - 1)); }
  return { hot, cold };
}
await timed('allLotto', async () => {
  if (!ALLROWS || !rL) return;
  /* 내 전수 열거의 (특징 코드, 필터) 히스토그램 — 키 = 코드·2 + 필터 를 정렬해 묶는다 */
  const KEY = new Uint32Array(LN); for (let i = 0; i < LN; i++) KEY[i] = E.code[i] * 2 + E.flag[i];
  KEY.sort();
  let K = 0; for (let i = 0; i < LN; i++) if (i === 0 || (KEY[i] >>> 1) !== (KEY[i - 1] >>> 1)) K++;
  const hk = new Uint32Array(K), hc = new Float64Array(K), hf = new Float64Array(K);
  for (let i = 0, t = -1; i < LN; i++) { const x = KEY[i] >>> 1; if (i === 0 || x !== (KEY[i - 1] >>> 1)) { t++; hk[t] = x; } hc[t]++; if (KEY[i] & 1) hf[t]++; }
  let tc = 0, tf = 0; for (let i = 0; i < hk.length; i++) { tc += hc[i]; tf += hf[i]; }
  if (tc !== LN || tf !== E.NF) err('hist', `히스토그램 합 ${tc}/${tf} ≠ ${LN}/${E.NF}`);
  summary.lotto.tuples = hk.length;
  const FD = fieldsOf(hk), zT = new Float64Array(hk.length);
  { const zc = zMaker(lottoParams(rr(lRows[0])).pop), zb = zBatch(lottoParams(rr(lRows[0])).pop, FD, new Float64Array(hk.length)); let nb = 0;
    for (let i = 0; i < hk.length; i++) if (zc(hk[i]) !== zb[i]) nb++;
    if (nb) err('zBatch', `일괄 z 가 단건 z 와 비트 단위로 다름 ${nb}건`); }
  const wIdx = new Map(); for (const [k, r] of firstWon) wIdx.set(k, r);
  let n = 0, bad = 0, split = 0, drift = 0;
  for (const row of lRows) {
    const R = rr(row), prm = lottoParams(R), d = draws.get(R); if (!prm || !d) continue;
    const zf = zMaker(prm.pop); if (!zf) { err('all.lotto R=' + R, 'pop 파라미터 없음'); continue; }
    const wi = lexIndex(d.n), wcode = codeOfCombo(d.n), zw = zf(wcode);
    let lt = 0, le = 0, ltF = 0, leF = 0, ofF = 0;
    zBatch(prm.pop, FD, zT);
    for (let i = 0; i < hk.length; i++) {
      const z = zT[i], c = hc[i], cf = hf[i];
      if (z < zw) { lt += c; ltF += cf; } if (z <= zw) { le += c; leF += cf; }
      ofF += cf;
    }
    for (const [k, r] of wIdx) if (r < R) {       // R 이전 1등 조합(필터 통과한 것)을 우주에서 뺀다
      const c = lexCombo(k); if (!filterOf(c)) continue;
      const z = zf(codeOfCombo(c)); ofF--; if (z < zw) ltF--; if (z <= zw) leF--;
    }
    const K = row.ranks || {}, sc = 'all.lotto R=' + R;
    const pop = { best: lt + 1, worst: le };
    if (!eqRange(K.pop, pop)) { bad++; err(sc + ' pop', `기록 [${K.pop && K.pop.best},${K.pop && K.pop.worst}] ≠ 재계수 [${pop.best},${pop.worst}]`); }
    const wonB = firstWon.has(wi) && firstWon.get(wi) < R;
    if (!filterOf(d.n) || wonB) { if (!(K.popf && K.popf.excluded)) { bad++; err(sc + ' popf', `필터 밖이어야 함, 기록 ${JSON.stringify(K.popf)}`); } }
    else if (!eqRange(K.popf, { best: ltF + 1, worst: leF })) { bad++; err(sc + ' popf', `기록 [${K.popf && K.popf.best},${K.popf && K.popf.worst}] ≠ 재계수 [${ltF + 1},${leF}]`); }
    if (K.popf && K.popf.of !== ofF) { bad++; err(sc + ' popf.of', `${K.popf.of} ≠ ${ofF}`); }
    const mineB = hotColdBasesMine(R), leakB = hotColdBasesMine(R + 1);
    for (const kind of ['hot', 'cold']) {
      const M = addModel(prm[kind], kind, R);
      if (M.bases) {                              // 밑을 원자료로 센 값과 대조(역산이 안 되면 이 대조는 불가 — 끝에 모아서 ::warning)
        const bases = M.bases, same = (A, Bb) => A.every((v, i) => i === 0 || v === Bb[i]);
        if (!same(bases, mineB[kind])) {
          if (same(bases, leakB[kind])) err(sc + ' ' + kind, '미래 누설: params 가중치가 R 회차 자신의 추첨까지 넣어 센 값과 같다(walk-forward 위반)');
          else { drift++; if (drift <= 5) warn(sc + ' ' + kind, `params 가중치의 밑 ≠ 원자료로 센 값 (${JSON.stringify(bases.slice(1))} vs ${JSON.stringify(mineB[kind].slice(1))})`); }
        }
      }
      const ex = classRank(M, d.n), rec = K[kind];
      if (!rec) continue;
      if (ex.chain) { addStat.chain.push(sc + ' ' + kind); continue; }
      if (eqRange(rec, ex)) continue;
      bad++;
      if (rec.best >= ex.best && rec.worst <= ex.worst) { split++; err(sc + ' ' + kind, `기록 [${rec.best},${rec.worst}] ⊂ 동점(${addModeTxt(M)}) [${ex.best},${ex.worst}] (동점 구간이 쪼개짐)`); }
      else err(sc + ' ' + kind, `기록 [${rec.best},${rec.worst}] ≠ ${addModeTxt(M)} [${ex.best},${ex.worst}]`);
    }
    n++;
    if (n % 40 === 0) await yieldLoop();
  }
  summary.lotto.allRows = { n, bad, floatSplit: split, paramDrift: drift };
});
log('로또 전 회차 재계수', JSON.stringify(summary.lotto.allRows || {}));

/* ── 6f. 로또 다음 회차 top-20 (전수 정렬) + rank-core 탐색기 함수 깊은 offset ── */
/* 한 모델의 «브라우징 순서» 자료: vals(오름차순 기준값; 우주 밖 = +Inf), sorted(전체 정렬), uni(우주 크기).
   hot/cold 는 가산 모델 M 기준(exact: −정수 곱 · quant: −Σq 를 ATOL 사슬로 묶은 «동점 구간 대표값») — 부동소수 합 순서는 쓰지 않는다.
   score(i) = 왼→오 부동소수 합(next.top 의 s 대조용, 상대 1e-12). quant 에서 사슬 폭 > ATOL 이면 chain:true(계약상 정의 불가 → 호출자가 생략).
   한 번에 한 모델만 메모리에 둔다. */
function lottoOrder(k, prm, Z, wonB, R) {
  if (k === 'pop') return { vals: Z, sorted: Z.slice().sort(), uni: LN, score: i => Z[i] };
  if (k === 'popf') {
    const V = new Float64Array(LN); let uni = 0;
    for (let i = 0; i < LN; i++) { if (E.flag[i] && !wonB.has(i)) { V[i] = Z[i]; uni++; } else V[i] = Infinity; }
    return { vals: V, sorted: V.slice().sort(), uni, score: i => Z[i] };
  }
  const M = addModel(prm[k], k, R), lw = M.lw, K = M.key, mul = M.mul;
  const X = new Float64Array(LN); let i = 0;
  for (let a = 1; a <= 40; a++) { const p1 = K[a];
    for (let b = a + 1; b <= 41; b++) { const p2 = mul ? p1 * K[b] : p1 + K[b];
      for (let c = b + 1; c <= 42; c++) { const p3 = mul ? p2 * K[c] : p2 + K[c];
        for (let d = c + 1; d <= 43; d++) { const p4 = mul ? p3 * K[d] : p3 + K[d];
          for (let e = d + 1; e <= 44; e++) { const p5 = mul ? p4 * K[e] : p4 + K[e];
            for (let f = e + 1; f <= 45; f++) X[i++] = -(mul ? p5 * K[f] : p5 + K[f]); } } } } }
  const score = j => { const c = lexCombo(j); let s = lw[c[0]] + lw[c[1]]; s = s + lw[c[2]]; s = s + lw[c[3]]; s = s + lw[c[4]]; return s + lw[c[5]]; };
  const o = { lw, uni: LN, score, mode: M.mode, M, chain: false, vals: X, sorted: X.slice().sort() };
  if (M.mode === 'quant') {                    // 서로 ATOL 이내로 이어진 값 = 한 동점 구간 → 구간의 첫(가장 높은 점수) 값으로 바꾼다(단조 사상이라 정렬 유지)
    const s = o.sorted, dv = [], rep = [];
    let g0 = s[0];
    for (let q = 0; q < LN; q++) {
      if (q && s[q] === s[q - 1]) continue;
      if (q && s[q] - s[q - 1] > ADD_ATOL) g0 = s[q];
      if (s[q] - g0 > ADD_ATOL) o.chain = true;
      dv.push(s[q]); rep.push(g0);
    }
    const DV = Float64Array.from(dv), RP = Float64Array.from(rep), map = v => { let lo = 0, hi = DV.length - 1; while (lo < hi) { const m = (lo + hi) >>> 1; if (DV[m] < v) lo = m + 1; else hi = m; } return RP[lo]; };
    for (let q = 0; q < LN; q++) { X[q] = map(X[q]); s[q] = map(s[q]); }
  }
  return o;
}
/* 전체 탐색 순서(기대값) — 정렬된 값에서 그룹(같은 값)마다 시작 위치를 알고, 열거(index 오름차순)를 돌며 제자리에 넣는다
   → 그룹 안은 자동으로 index 오름차순. 값 → 그룹은 이진 탐색. order[r−1] = 그 순위의 조합 index. */
function fullOrder(O) {
  const s = O.sorted, uni = O.uni, vals = O.vals;
  let D = 0; for (let q = 0; q < uni; q++) if (q === 0 || s[q] !== s[q - 1]) D++;
  const dv = new Float64Array(D), wp = new Float64Array(D);
  D = 0; for (let q = 0; q < uni; q++) if (q === 0 || s[q] !== s[q - 1]) { dv[D] = s[q]; wp[D] = q; D++; }
  const order = new Uint32Array(uni);
  for (let i = 0; i < LN; i++) {
    const v = vals[i]; if (v === Infinity) continue;
    let lo = 0, hi = D - 1; while (lo < hi) { const m = (lo + hi) >>> 1; if (dv[m] < v) lo = m + 1; else hi = m; }
    order[wp[lo]++] = i;
  }
  return order;
}
/* rank-core 페이지 함수의 큰 창을 전체 기대 순서와 대조(동점 안 index 순서까지). 창: 힙 경로(offset+k ≤ 50,000) 2개 + 전수 경로 6개 */
function cmpOrderWindows(scope, order, uni, getPage) {
  const wins = [[0, 20000], [30000, 20000]];
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) wins.push([Math.floor(uni * f), 4000]);
  wins.push([uni - 4000, 4000]);
  let n = 0, bad = 0, first = null;
  for (const [off, k0] of wins) {
    const k = Math.max(0, Math.min(k0, uni - off)); if (!k) continue;
    let got; try { got = getPage(off, k); } catch (e) { err(scope, `offset ${off} 호출 실패: ${e.message}`); bad++; continue; }
    if (!Array.isArray(got) || got.length !== k) { err(scope, `offset ${off} 길이 ${got && got.length} ≠ ${k}`); bad++; continue; }
    for (let j = 0; j < k; j++) {
      const e = got[j], gi = e.i != null ? e.i : lexIndex(Array.from(e.c)); n++;
      if (e.r !== off + j + 1 || gi !== order[off + j]) { bad++; if (!first) first = `r=${off + j + 1}: core ${e.r}/${lexCombo(gi).join('-')} ≠ 전수 ${lexCombo(order[off + j]).join('-')}`; }
    }
  }
  if (bad) err(scope, `탐색 순서 불일치 ${bad}/${n} 위치 (첫 불일치 ${first}) — 동점 안은 index 오름차순이어야 함`);
  return { n, bad };
}
const rangeOf = (sorted, uni, v) => {        // 값 v 의 [best,worst] (오름차순 기준)
  let lo = 0, hi = uni; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let lo2 = lo, hi2 = uni; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (sorted[m] <= v) lo2 = m + 1; else hi2 = m; }
  return { best: lo + 1, worst: lo2 };
};
await timed('nextLotto', async () => {
  if (!rL || !rL.next) return;
  const prm = lottoParams(LNEXT); if (!prm) { err('next.lotto', `params ${LNEXT} 없음`); return; }
  { const mb = hotColdBasesMine(LNEXT);
    for (const kind of ['hot', 'cold']) { const M = addModel(prm[kind], kind, LNEXT);
      if (M.bases && M.bases.some((v, i) => i > 0 && v !== mb[kind][i])) warn('next.lotto.params ' + kind, 'params 가중치의 밑 ≠ 원자료로 센 값'); } }
  const wonB = wonBeforeSet(LNEXT), zf = zMaker(prm.pop);
  const Z = new Float64Array(LN); for (let i = 0; i < LN; i++) Z[i] = zf(E.code[i]);
  const top = rL.next.top || {}, TOPK = 20;
  const L = RC && RC.lotto, useCore = L && typeof L.pagePop === 'function' && typeof L.pageAdditive === 'function';
  const T = useCore ? coreTable() : null, excl = [...wonB].map(lexCombo), r3 = mulberry(LNEXT * 31 + 7);
  const sameList = (A, X) => A.length === X.length && A.every((e, i) => e.r === X[i].r && lexIndex(Array.from(e.c || [])) === X[i].idx);
  summary.lotto.next = { round: LNEXT };
  const deep = {};
  for (const k of LKEYS) {
    const t = performance.now();
    const O = lottoOrder(k, prm, Z, wonB, LNEXT);
    if (k === 'popf') summary.lotto.next.popfOf = O.uni;
    if (O.chain) { addStat.chain.push('next.lotto.' + k + ' R=' + LNEXT); deep[k] = { skipped: 'ATOL 사슬' }; await yieldLoop(); continue; }   // 계약상 순서 정의 불가(rank-core 도 throw)
    // (1) next.top 20 = 전수 정렬
    const rec = top[k];
    if (!Array.isArray(rec)) err('next.lotto.' + k, 'top 없음');
    else {
      if (rec.length !== TOPK) err('next.lotto.' + k, `길이 ${rec.length} ≠ ${TOPK}`);
      const exp = browseFromSorted(O.vals, O.sorted, O.uni, 0, TOPK);
      if (!sameList(rec.slice(0, TOPK), exp)) err('next.lotto.' + k, `top20 ≠ 전수 정렬: 기록 ${JSON.stringify(rec.slice(0, 4).map(e => [e.r, (e.c || []).join('-')]))}… 기대 ${JSON.stringify(exp.slice(0, 4).map(e => [e.r, lexCombo(e.idx).join('-')]))}…`);
      rec.slice(0, TOPK).forEach((e, i) => {
        const idx = lexIndex(Array.from(e.c || [])), v = O.score(idx);
        if (k === 'pop' || k === 'popf') { if (!near(e.z, v, 1e-12)) err('next.lotto.' + k, `#${i + 1} z=${e.z} ≠ ${v}`); }
        else if (!nearRel(e.s, v, 1e-12)) err('next.lotto.' + k, `#${i + 1} s=${e.s} ≠ ${v}`);
      });
    }
    // (2) rank-core 탐색기 함수: 깊은 offset 페이지 + 임의 조합 순위
    if (useCore) {
      /* offset 0(20개)·3만대 = pageAdditive 의 k-best 힙 경로(offset+k ≤ 50,000) · 가운데·끝·임의 = 전수 순서 경로 */
      let bad = 0; const offs = [0, 30000 + Math.floor(r3() * 19000), Math.floor(O.uni / 2) - 3, O.uni - 7, Math.floor(r3() * (O.uni - 10))];
      const lwc = (k === 'hot' || k === 'cold') ? (L.logw ? L.logw(k, prm[k]) : O.lw) : null;
      const hasPos = lwc ? typeof L.posAdditive === 'function' : typeof L.posPop === 'function';
      const corePos = c => lwc ? L.posAdditive(lwc, c) : L.posPop(prm.pop, T, c, { filter: k === 'popf', excludeWon: k === 'popf' ? excl : [] });
      let posN = 0;
      const ordChk = cmpOrderWindows(`core.order.${k} R=${LNEXT}`, fullOrder(O), O.uni,
        (off, kk) => lwc ? L.pageAdditive(lwc, off, kk) : L.pagePop(prm.pop, T, off, kk, { filter: k === 'popf', excludeWon: k === 'popf' ? excl : [] }));
      for (const off of offs) {
        const kk = Math.min(off === 0 ? 20 : 7, O.uni - off);
        let got;
        try { got = lwc ? L.pageAdditive(lwc, off, kk) : L.pagePop(prm.pop, T, off, kk, { filter: k === 'popf', excludeWon: k === 'popf' ? excl : [] }); }
        catch (e) { err('core.page.' + k, `offset ${off} 호출 실패: ${e.message}`); bad++; continue; }
        const exp = browseFromSorted(O.vals, O.sorted, O.uni, off, kk);
        if (!sameList(got, exp)) { bad++; err('core.page.' + k, `offset ${off}: ${JSON.stringify(got.map(e => [e.r, Array.from(e.c).join('-')]))} ≠ 전수 ${JSON.stringify(exp.map(e => [e.r, lexCombo(e.idx).join('-')]))}`); }
        // 정확한 위치 함수 — 전수 페이지 가운데 항목의 r 과 같아야 한다(동점 구간 안에서도)
        const mid = exp[exp.length >> 1];
        if (hasPos && mid) {
          try { const p = corePos(lexCombo(mid.idx)); posN++; if (p !== mid.r) { bad++; err('core.pos.' + k, `offset ${off}: ${lexCombo(mid.idx).join('-')} 위치 ${p} ≠ 전수 ${mid.r}`); } }
          catch (e) { bad++; err('core.pos.' + k, `호출 실패: ${e.message}`); }
        }
      }
      for (let t2 = 0; t2 < 20; t2++) {
        const i = Math.floor(r3() * LN); if (O.vals[i] === Infinity) continue;
        const exp = rangeOf(O.sorted, O.uni, O.vals[i]), c = lexCombo(i);
        let got;
        try { got = lwc ? L.rankAdditive(lwc, c) : L.rankPop(prm.pop, T, c, { filter: k === 'popf', excludeWon: k === 'popf' ? excl : [] }); }
        catch (e) { err('core.rank.' + k, e.message); bad++; break; }
        if (!eqRange(got, exp)) { bad++; err('core.rank.' + k, `${c}: [${got.best},${got.worst}] ≠ 전수 [${exp.best},${exp.worst}]`); }
        if (k === 'popf' && got.of != null && got.of !== O.uni) err('core.rank.popf', `of ${got.of} ≠ ${O.uni}`);
        if (hasPos && t2 < 3) {                  // 임의 조합의 정확한 위치 = best + #{같은 값 · index < i}
          const v = O.vals[i]; let tb = 0; for (let j = 0; j < i; j++) if (O.vals[j] === v) tb++;
          try { const p = corePos(c); posN++; if (p !== exp.best + tb) { bad++; err('core.pos.' + k, `${c.join('-')} 위치 ${p} ≠ 전수 ${exp.best + tb} (구간 [${exp.best},${exp.worst}])`); } }
          catch (e) { bad++; err('core.pos.' + k, `호출 실패: ${e.message}`); }
        }
      }
      /* popf: 과거 1등 조합(필터 통과)과 같은 z 인, index 가 더 큰 조합의 위치 — 제외된 1등을 위치에서 빼는지 */
      if (hasPos && k === 'popf') {
        let tried = 0, done = 0;
        for (const w of [...wonB].sort((a, b) => a - b)) {
          if (done >= 3 || tried >= 30) break;
          if (!E.flag[w]) continue; tried++;
          const zw = Z[w]; let j = w + 1; while (j < LN && !(Z[j] === zw && O.vals[j] !== Infinity)) j++;
          if (j >= LN) continue;
          const v = O.vals[j], exp = rangeOf(O.sorted, O.uni, v); let tb = 0; for (let q = 0; q < j; q++) if (O.vals[q] === v) tb++;
          try { const p = corePos(lexCombo(j)); posN++; done++;
            if (p !== exp.best + tb) { bad++; err('core.pos.popf', `1등 ${lexCombo(w).join('-')} 과 동점인 ${lexCombo(j).join('-')} 위치 ${p} ≠ 전수 ${exp.best + tb}`); } }
          catch (e) { bad++; err('core.pos.popf', `호출 실패: ${e.message}`); }
        }
      }
      if (!hasPos) warn('core.pos.' + k, '정확한 위치 함수 없음 — 대조 생략');
      deep[k] = { offsets: offs, bad, posChecked: posN, order: ordChk };
    }
    deep[k] = { ...(deep[k] || {}), ms: Math.round(performance.now() - t) };
    await yieldLoop();
  }
  summary.core.deepLotto = deep;
});
log('로또 다음 회차 top-20·탐색기 확인', JSON.stringify(summary.lotto.next || {}));
/* 과거 표본 회차의 hot/cold 탐색 순서(탐색기는 과거 회차도 재현한다). 동점(정수 곱이 같음) 안의 순서는 회차마다 가중치에 따라
   드러나기도 안 드러나기도 해서(반올림 잡음이 동점을 가르는 경우가 회차·모델마다 다름) 다음 회차 하나로는 부족하다. */
await timed('pastOrder', async () => {
  const L = RC && RC.lotto; if (!L || typeof L.pageAdditive !== 'function' || !rLP) return;
  const res = {};
  for (const R of LS) {
    const prm = lottoParams(R); if (!prm) continue;
    for (const kind of ['hot', 'cold']) {
      const O = lottoOrder(kind, prm, null, null, R), lwc = L.logw(kind, prm[kind]);
      if (O.chain) { addStat.chain.push(`core.order.${kind} R=${R}`); res[R + kind] = { skipped: 'ATOL 사슬' }; continue; }
      res[R + kind] = cmpOrderWindows(`core.order.${kind} R=${R}`, fullOrder(O), O.uni, (off, kk) => L.pageAdditive(lwc, off, kk));
      await yieldLoop();
    }
  }
  summary.core.pastOrder = res;
});

/* ── 6g. 연금: 표본 전수 + 전 회차 DP + 다음 회차 top-20 ── */
const pParams = E2 => rPP && rPP.rows && rPP.rows[E2];
function pensionScoresMine(E2, model, upto) { // pension.html currentScores 재구현(경고 수준 대조용). upto = 자료 상한(기본 E2 미만)
  const rows = pens.filter(r => r.ep < (upto || E2)), m = rows.length;
  let a = E2 * 7919 || 1; const rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const sc = (hist, K) => {
    const s = new Array(K).fill(0);
    if (model === 'rand') { for (let d = 0; d < K; d++) s[d] = rng(); return s; }
    const f = new Array(K).fill(0); hist.forEach(d => f[d]++);
    if (model === 'freq') return f; if (model === 'cold') return f.map(v => -v);
    if (model === 'recent') { hist.forEach((d, i) => { s[d] += Math.pow(0.5, (m - 1 - i) / 52); }); return s; }
    if (model === 'gap') { for (let d = 0; d < K; d++) { let last = -1; for (let i = m - 1; i >= 0; i--) if (hist[i] === d) { last = i; break; } s[d] = last < 0 ? m : (m - 1 - last); } return s; }
    return f;
  };
  const pos = []; for (let p = 0; p < 6; p++) pos.push(sc(rows.map(r => dig6(r.num)[p]), 10));
  const band = sc(rows.map(r => r.band - 1), 5);
  return { pos, band };
}
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Array.isArray(v) ? sameArr(v, b[i]) : v === b[i]);
await timed('brutePension', async () => {
  for (const E2 of PS) {
    const row = pRowsJ.find(x => rr(x) === E2), prm = pParams(E2), d = pByEp.get(E2);
    if (!row || !prm || !d) { err('brute.pension ep=' + E2, 'row/params 없음'); continue; }
    const res = {};
    for (const m of PKEYS) {
      const key = m === 'site' ? prm.site : m, S = prm.S && prm.S[key];
      if (!S) { err('brute.pension ep=' + E2, `S.${key} 없음`); continue; }
      const pts = pensionPoints(S), b = brutePension(pts, d), rec = row.ranks && row.ranks[m], sc = `brute.pension ep=${E2} ${m}`;
      if (!rec || !eqRange(rec, b) || !eqRange(rec.numRank, b.numRank))
        err(sc, `기록 [${rec && rec.best},${rec && rec.worst}]/num [${rec && rec.numRank && rec.numRank.best},${rec && rec.numRank && rec.numRank.worst}] ≠ 전수 [${b.best},${b.worst}]/num [${b.numRank.best},${b.numRank.worst}]`);
      res[m] = { best: b.best, worst: b.worst, num: [b.numRank.best, b.numRank.worst], pos: b.pos };
      if (RC && RC.pension && typeof RC.pension.points === 'function' && m !== 'site') {
        try {
          const cp = RC.pension.points(S);
          if (!sameArr(cp.pos.map(r => Array.from(r)), pts.pos) || !sameArr(Array.from(cp.band), pts.band)) err(sc + ' core.points', `${JSON.stringify(cp)} ≠ ${JSON.stringify(pts)}`);
          const cr = RC.pension.rank(cp, d.band, d.num);
          if (!eqRange(cr, b) || !eqRange(cr.numRank, b.numRank)) err(sc + ' core.rank', `${JSON.stringify(cr)} ≠ 전수`);
          if (typeof RC.pension.pos === 'function') {
            const cpos = RC.pension.pos(cp, d.band, d.num);
            if (cpos !== b.pos) err(sc + ' core.pos', `${cpos} ≠ 전수 위치 ${b.pos} (구간 [${b.best},${b.worst}])`);
          } else warn(sc + ' core.pos', '없음 — 탐색기가 동점 구간을 훑는 느린 경로를 씀');
        } catch (e) { err(sc + ' core', '호출 실패: ' + e.message); }
      }
    }
    summary.pension['brute' + E2] = res;
    await yieldLoop();
  }
});
await timed('allPension', async () => {
  if (!ALLROWS || !rP) return;
  let n = 0, bad = 0, drift = 0;
  for (const row of pRowsJ) {
    const E2 = rr(row), prm = pParams(E2), d = pByEp.get(E2); if (!prm || !d) continue;
    for (const m of PKEYS) {
      const key = m === 'site' ? prm.site : m, S = prm.S && prm.S[key]; if (!S) { err('all.pension ep=' + E2, `S.${key} 없음`); continue; }
      if (m !== 'site') { const mine = pensionScoresMine(E2, m); if (!sameArr(mine.pos, S.pos) || !sameArr(mine.band, S.band)) {
        const lk = pensionScoresMine(E2, m, E2 + 1);
        if (m !== 'rand' && sameArr(lk.pos, S.pos) && sameArr(lk.band, S.band)) err(`all.pension ep=${E2} ${m}`, '미래 누설: params S 가 ep 회차 자신의 추첨까지 넣은 값과 같다(walk-forward 위반)');
        else { drift++; if (drift <= 5) warn(`all.pension ep=${E2} ${m}`, 'params S ≠ 원자료로 재구현한 currentScores'); } } }
      const b = dpPension(pensionPoints(S), d), rec = row.ranks && row.ranks[m];
      if (!rec || !eqRange(rec, b) || !eqRange(rec.numRank, b.numRank)) { bad++; err(`all.pension ep=${E2} ${m}`, `기록 [${rec && rec.best},${rec && rec.worst}] ≠ DP [${b.best},${b.worst}] (num ${b.numRank.best}–${b.numRank.worst})`); }
    }
    n++;
  }
  summary.pension.allRows = { n, bad, paramDrift: drift };
});
await timed('nextPension', async () => {
  if (!rP || !rP.next || !rP.next.top) { if (rP && rP.next) warn('next.pension', 'next.top 없음 — 대조 생략'); return; }
  const prm = pParams(PNEXT); if (!prm) { err('next.pension', `params ${PNEXT} 없음`); return; }
  let bad = 0;
  for (const m of PKEYS) {
    const rec = rP.next.top[m]; if (!Array.isArray(rec)) { err('next.pension.' + m, 'top 없음'); continue; }
    const key = m === 'site' ? prm.site : m, pts = pensionPoints(prm.S[key]), U = pensionUnits(pts);
    const exp = pensionBrowse(U, 0, rec.length);
    const ok = rec.length === exp.length && rec.every((e, i) => e.r === exp[i].r && +e.band === exp[i].band && String(e.num) === exp[i].num && (e.s == null || e.s === exp[i].s));
    if (!ok) { bad++; err('next.pension.' + m, `top ≠ 전수 정렬: 기록 ${JSON.stringify(rec.slice(0, 3))} 기대 ${JSON.stringify(exp.slice(0, 3))}`); }
    if (RC && RC.pension && typeof RC.pension.page === 'function' && m !== 'site') {
      const r4 = mulberry(PNEXT * 131 + m.length);
      const cpts = RC.pension.points(prm.S[key]);
      for (const off of [0, Math.floor(PN / 2) - 3, PN - 7, Math.floor(r4() * (PN - 10))]) {
        try {
          const got = RC.pension.page(cpts, off, 7), ex = pensionBrowse(U, off, 7);
          const same = got.length === ex.length && got.every((e, i) => e.r === ex[i].r && +e.band === ex[i].band && String(e.num).padStart(6, '0') === ex[i].num);
          if (!same) { bad++; err('core.pension.page.' + m, `offset ${off}: ${JSON.stringify(got.slice(0, 2))} ≠ ${JSON.stringify(ex.slice(0, 2))}`); }
          if (typeof RC.pension.pos === 'function') for (const e of [ex[0], ex[ex.length >> 1]]) if (e) {   // 정확한 위치 = 전수 페이지의 r
            const p = RC.pension.pos(cpts, e.band, e.num);
            if (p !== e.r) { bad++; err('core.pension.pos.' + m, `${e.band}조 ${e.num} 위치 ${p} ≠ 전수 ${e.r}`); }
          }
        } catch (e) { err('core.pension.page.' + m, e.message); }
      }
    }
    await yieldLoop();
  }
  summary.pension.next = { ep: PNEXT, bad };
});
log('연금 완료', JSON.stringify({ all: summary.pension.allRows, next: summary.pension.next }));

/* ── 6h. 통계 재계산 ── */
/* 통계 — STATUS-track 계약(동점 비율 규칙, 2026-09-25 승인): 한 행의 순위 구간 [best,worst] 를 연속 구간 (best−1, worst] 에
   균등하게 펴서 10분위·KS·구간 전략에 나눠 넣는다(비무작위 PIT). meanPct·medianPct·best 는 행의 pct(mid) 를 쓴다. */
function decFracMine(b, w, of) {             // 10분위 k = (of·k/10, of·(k+1)/10] 와 (b−1, w] 의 겹친 길이 / 구간 길이
  const out = new Array(10), L = w - b + 1;
  for (let k = 0; k < 10; k++) { const lo = Math.max(b - 1, of * k / 10), hi = Math.min(w, of * (k + 1) / 10); out[k] = Math.max(0, hi - lo) / L; }
  return out;
}
function ksDties(items) {                    // sup_x |평균_i clamp((x·of_i − (b_i−1))/(w_i−b_i+1),0,1) − x| — 조각별 선형이라 꺾이는 점만 보면 된다
  const xs = [0, 1]; for (const t of items) { xs.push((t.b - 1) / t.of, t.w / t.of); }
  let D = 0; const n = items.length;
  for (const x of xs) {
    let F = 0; for (const t of items) F += clamp01((x * t.of - (t.b - 1)) / (t.w - t.b + 1));
    D = Math.max(D, Math.abs(F / n - x));
  }
  return D;
}
function recomputeStats(scope, rows, key, getR, ofOf, lite) {
  const R = rows.map(r => ({ round: rr(r), o: getR(r) })).filter(x => x.o && !x.o.excluded);
  const n = R.length; if (!n) return null;
  const pct = R.map(x => x.o.pct);
  const mean = pct.reduce((a, b) => a + b, 0) / n, hw = 1.96 * Math.sqrt(1 / 12 / n);
  const items = R.map(x => ({ b: x.o.best, w: x.o.worst, of: ofOf(x.o) }));
  const fr = items.map(t => decFracMine(t.b, t.w, t.of));
  const dec = new Array(10).fill(0); fr.forEach(f => { for (let k = 0; k < 10; k++) dec[k] += f[k]; });
  fr.forEach((f, i) => { const s = f.reduce((a, b) => a + b, 0); if (Math.abs(s - 1) > 1e-9) err(scope, `decFrac 합 ${s} ≠ 1 (회차 ${R[i].round})`); });
  const e = n / 10, chi = dec.reduce((a, o) => a + (o - e) * (o - e) / e, 0);
  const D = ksDties(items);
  const tops = {}, texp = {};
  for (const [lab, v, isPct] of [['10', 10, false], ['100', 100, false], ['1000', 1000, false], ['1%', 1, true], ['10%', 10, true]]) {
    let o = 0, x = 0; for (const t of items) { const N = isPct ? t.of * v / 100 : v; o += topFrac(N, t.b, t.w); x += N / t.of; }
    tops[lab] = o; texp[lab] = x;
  }
  const out = { n, meanPct: mean, meanCI: [mean - hw, mean + hw], medianPct: median(pct), deciles: dec, expDecile: e,
    chi2: { stat: chi, df: 9, p: chi2Upper(chi, 9) }, ks: { D, pv: ksPvariants(n, D) }, top: tops, topExp: texp };
  if (lite) return out;
  // 최고 회차: pct 최소(같으면 best 작은 쪽, 그다음 이른 회차)
  let bi = 0; for (let i = 1; i < n; i++) { const A = R[i].o, Bo = R[bi].o; if (A.pct < Bo.pct || (A.pct === Bo.pct && A.best < Bo.best)) bi = i; }
  out.best = { round: R[bi].round, best: R[bi].o.best, pct: R[bi].o.pct };
  // 구간 전략: 워밍업 20, 이전 행들의 비율 10분위 합이 최다인 칸(1e-9 이내 동률은 낮은 칸) → 이 행의 그 칸 비율을 적중으로
  const warm = 20, cnt = new Array(10).fill(0); let bn = 0, hits = 0;
  for (let i = 0; i < n; i++) {
    if (i >= warm) { let arg = 0; for (let j = 1; j < 10; j++) if (cnt[j] > cnt[arg] + 1e-9) arg = j; bn++; hits += fr[i][arg]; }
    for (let k = 0; k < 10; k++) cnt[k] += fr[i][k];
  }
  out.band = { warmup: warm, n: bn, hits, rate: bn ? hits / bn : null, exp: 0.1, pv: bn ? binomVariants(hits, bn, 0.1) : null };
  return out;
}
function compareStats(scope, rec, mine, sub) {
  if (!mine) { if (rec && rec.n) err(scope, `기록 n=${rec.n}, 재계산 대상 없음`); return; }
  if (!rec) { err(scope, '요약 없음'); return; }
  const EQ = (f, a, b) => { if (!(a === b || (a == null && b == null) || near(a, b, STOL))) err(scope + '.' + f, `기록 ${a} ≠ 재계산 ${b}`); };
  if (rec.n !== mine.n) err(scope + '.n', `기록 ${rec.n} ≠ ${mine.n}`);
  EQ('meanPct', rec.meanPct, mine.meanPct);
  if (!Array.isArray(rec.meanCI) || !near(rec.meanCI[0], mine.meanCI[0], STOL) || !near(rec.meanCI[1], mine.meanCI[1], STOL)) err(scope + '.meanCI', `기록 ${JSON.stringify(rec.meanCI)} ≠ ${JSON.stringify(mine.meanCI)}`);
  EQ('medianPct', rec.medianPct, mine.medianPct);
  if (!Array.isArray(rec.deciles) || rec.deciles.length !== 10 || rec.deciles.some((v, k) => !near(v, mine.deciles[k], STOL))) err(scope + '.deciles', `기록 ${JSON.stringify(rec.deciles)} ≠ ${JSON.stringify(mine.deciles.map(v => +v.toFixed(6)))}`);
  EQ('expDecile', rec.expDecile, mine.expDecile);
  if (!rec.chi2) err(scope + '.chi2', '없음'); else {
    EQ('chi2.stat', rec.chi2.stat, mine.chi2.stat); if (rec.chi2.df !== 9) err(scope + '.chi2.df', `${rec.chi2.df}`);
    if (!pNear(rec.chi2.p, mine.chi2.p)) err(scope + '.chi2.p', `기록 ${rec.chi2.p} ≠ 재계산 ${mine.chi2.p}`);
  }
  if (!rec.ks) err(scope + '.ks', '없음'); else {
    EQ('ks.D', rec.ks.D, mine.ks.D);
    /* 계약(STATUS-track §1): n ≤ 2000 이고 2⌊nD⌋+1 ≤ 301 이면 정확(MTW), 아니면 Stephens 보정 점근 — 그 방식의 값만 인정 */
    const pv = mine.ks.pv, kk = Math.floor(mine.n * mine.ks.D) + 1, how = (mine.n <= 2000 && 2 * kk - 1 <= 301) ? 'exact' : 'asymNR';
    if (!pNear(rec.ks.p, pv[how])) {
      const other = Object.entries(pv).filter(([k, v]) => k !== how && pNear(rec.ks.p, v)).map(([k]) => k);
      err(scope + '.ks.p', `기록 ${rec.ks.p} ≠ 계약 방식(${how}) ${pv[how]}` + (other.length ? ` — 다른 방식(${other.join('|')})의 값과 같음` : ` (정확 ${pv.exact} / 점근 ${pv.asym} / Stephens ${pv.asymNR})`));
    } else notes.push(`${scope.replace(/\.(pop|popf|hot|cold|freq|recent|gap|rand|site)\b/, '.*')}.ks.p = ${how}`);
  }
  for (const lab of ['10', '100', '1000', '1%', '10%']) {
    if (!rec.top || !near(rec.top[lab], mine.top[lab], STOL)) err(scope + '.top.' + lab, `기록 ${rec.top && rec.top[lab]} ≠ ${mine.top[lab]}`);
    if (!rec.topExp || !near(rec.topExp[lab], mine.topExp[lab], STOL)) err(scope + '.topExp.' + lab, `기록 ${rec.topExp && rec.topExp[lab]} ≠ ${mine.topExp[lab]}`);
  }
  if (!sub || rec.best) {
    const b = rec.best, m = mine.best;
    if (!m) err(scope + '.best', '재계산 불가(lite)');
    else if (!b || b.round !== m.round || b.best !== m.best || !near(b.pct, m.pct, STOL)) err(scope + '.best', `기록 ${JSON.stringify(b)} ≠ pct 최소 행 ${JSON.stringify(m)}`);
  }
  const bd = rec.band;
  if (!bd) { if (!sub) err(scope + '.band', '없음'); } else if (!mine.band) err(scope + '.band', '재계산 불가(lite)'); else {
    if (bd.warmup !== 20 || bd.n !== mine.band.n || !near(bd.hits, mine.band.hits, STOL)) err(scope + '.band', `기록 warmup/n/hits ${bd.warmup}/${bd.n}/${bd.hits} ≠ 20/${mine.band.n}/${mine.band.hits}`);
    EQ('band.rate', bd.rate, mine.band.rate); if (bd.exp !== 0.1) err(scope + '.band.exp', `${bd.exp}`);
    if (mine.band.pv) {                         // 계약: pension.html binomTest 양측(관측 확률 이하 칸의 합)
      if (!pNear(bd.p, mine.band.pv.two)) err(scope + '.band.p', `기록 ${bd.p} ≠ 양측 이항 ${mine.band.pv.two} (상측 ${mine.band.pv.upper} / 2·min ${mine.band.pv.twoMin})`);
      else notes.push(`${scope.replace(/\.(pop|popf|hot|cold|freq|recent|gap|rand|site)\b/, '.*')}.band.p = two`); }
    else if (bd.p != null) err(scope + '.band.p', `n=0 인데 p=${bd.p}`);
  }
}
await timed('stats', async () => {
  if (rL && rL.summary) {
    const S = rL.summary; if (S.n !== lRows.length) err('lotto.summary.n', `${S.n} ≠ 행 ${lRows.length}`);
    for (const k of LKEYS) {
      const mine = recomputeStats('lotto.' + k, lRows, k, r => r.ranks && r.ranks[k], o => k === 'popf' ? o.of : LN);
      compareStats('lotto.summary.' + k, S.models && S.models[k], mine);
    }
    const pf = S.popf || {}, passed = lRows.filter(r => r.ranks && r.ranks.popf && !r.ranks.popf.excluded).length;
    if (pf.passed !== passed || pf.n !== lRows.length || !near(pf.rate, passed / lRows.length, STOL)) err('lotto.summary.popf', `기록 ${JSON.stringify(pf)} ≠ passed ${passed}/${lRows.length}`);
    const ofs = lRows.map(r => r.ranks && r.ranks.popf && r.ranks.popf.of), pexp = ofs.reduce((a, b) => a + b / LN, 0) / lRows.length;
    if (!near(pf.exp, pexp, STOL)) err('lotto.summary.popf.exp', `기록 ${pf.exp} ≠ 평균(of_R/N) ${pexp}`);
    if (pf.p != null) { const bv = binomVariants(passed, lRows.length, pexp);
      if (!pNear(pf.p, bv.two)) err('lotto.summary.popf.p', `기록 ${pf.p} ≠ 양측 이항 ${bv.two} (${JSON.stringify(bv)})`); else notes.push('lotto.summary.popf.p = two'); }
    else err('lotto.summary.popf.p', '없음');
  } else if (rL) err('lotto.summary', '없음');
  if (rP && rP.summary) {
    const S = rP.summary; if (S.n !== pRowsJ.length) err('pension.summary.n', `${S.n} ≠ 행 ${pRowsJ.length}`);
    for (const k of PKEYS) {
      compareStats('pension.summary.' + k, S.models && S.models[k], recomputeStats('pension.' + k, pRowsJ, k, r => r.ranks && r.ranks[k], () => PN));
      const nr = S.models && S.models[k] && (S.models[k].numRank || S.models[k].num);
      if (nr) compareStats('pension.summary.' + k + '.num', nr, recomputeStats('pension.' + k + '.num', pRowsJ, k, r => r.ranks && r.ranks[k] && r.ranks[k].numRank, () => 1e6, true), true);
    }
  } else if (rP) err('pension.summary', '없음');
});

/* ── 6i. 페이지 결과 대조 ── */
const pg = await timed('pageWait', async () => pagePromise);
if (pg) {
  const { lp, pp } = pg;
  if (lp && lp.error) err('page.lotto', lp.error);
  else if (lp) {
    if (lp.pageErrors.length) warn('page.lotto', 'pageerror: ' + lp.pageErrors.slice(0, 3).join(' | '));
    const L = RC && RC.lotto;
    let featBad = 0, zCore = 0, zMine = 0, zMineMax = 0, zCoreMax = 0;
    // popFeat: 페이지 vs 내 코드 vs rank-core
    pageCombos.forEach((c, i) => {
      const pf = lp.feats[i], mf = featOfCode(codeOfCombo(c));
      if (!sameArr(pf, mf)) { if (featBad++ < 5) err('page.popFeat', `${c}: 페이지 ${JSON.stringify(pf)} ≠ 내 ${JSON.stringify(mf)}`); }
      if (L && typeof L.popFeat === 'function') { const cf = Array.from(L.popFeat(c)); if (cf.length !== 8 || cf.some((v, j) => !near(v, pf[j], 1e-12))) { if (featBad++ < 5) err('page.popFeat.core', `${c}: core ${JSON.stringify(cf)} ≠ 페이지 ${JSON.stringify(pf)}`); } }
    });
    for (const R of [LNEXT, ...LS]) {
      const pr = lp.rounds[R]; if (!pr) { err('page.lotto R=' + R, '결과 없음'); continue; }
      if (pr.dbLatest !== R - 1 && !(R === LNEXT && pr.dbLatest === LATEST)) err('page.lotto R=' + R, `DB.latest=${pr.dbLatest}`);
      const prm = lottoParams(R);
      if (!prm) { err('page.lotto R=' + R, 'params 없음'); continue; }
      // fitPop · weightsFor 가 params 와 같은가(정확히)
      const sameM = (a, b) => (!a && !b) || (a && b && sameArr(a.beta, b.beta) && a.predMean === b.predMean && a.predSD === b.predSD);
      if (!sameM(pr.pop.A, prm.pop.A) || !sameM(pr.pop.B, prm.pop.B) || !sameArr(pr.pop.bounds, prm.pop.bounds)) err('page.lotto R=' + R, 'fitPop A/B/bounds ≠ rank-params-lotto.json');
      if (!sameArr(pr.hot, prm.hot)) err('page.lotto R=' + R, `weightsFor('hot') ≠ params`);
      if (!sameArr(pr.cold, prm.cold)) err('page.lotto R=' + R, `weightsFor('cold') ≠ params`);
      const zfMine = zMaker(pr.pop);
      pageCombos.forEach((c, i) => {
        const zp = pr.z[i]; if (zp == null) return;
        const zm = zfMine(codeOfCombo(c)); const dm = Math.abs(zm - zp);
        if (dm > zMineMax) zMineMax = dm; if (dm !== 0) zMine++;
        if (dm > 1e-12) err('page.zOf.mine R=' + R, `${c}: 내 z ${zm} ≠ 페이지 ${zp}`);
        if (L && typeof L.popModelZ === 'function') {
          const zc = L.popModelZ(prm.pop, L.popFeat(c)); const dc = Math.abs(zc - zp);
          if (dc > zCoreMax) zCoreMax = dc; if (dc !== 0) zCore++;
          if (!(dc <= 1e-12)) { if (zCore <= 5) err('page.zOf.core R=' + R, `${c}: popModelZ ${zc} ≠ 페이지 zOf ${zp}`); }
        }
      });
    }
    summary.page.lotto = { rounds: [LNEXT, ...LS], combos: pageCombos.length, featBad, zMineNonBitwise: zMine, zMineMaxDiff: zMineMax, zCoreNonBitwise: zCore, zCoreMaxDiff: zCoreMax };
    if (zMine) warn('page.zOf.mine', `내 z 가 페이지와 비트 단위로 다른 경우 ${zMine}건(최대 ${zMineMax})`);
  }
  if (pp && pp.error) err('page.pension', pp.error);
  else if (pp) {
    if (pp.pageErrors.length) warn('page.pension', 'pageerror: ' + pp.pageErrors.slice(0, 3).join(' | '));
    let bad = 0;
    for (const E2 of [PNEXT, ...PS]) {
      const x = pp.eps[E2], prm = pParams(E2); if (!x || !prm) { err('page.pension ep=' + E2, '결과/params 없음'); continue; }
      if (x.site !== prm.site) { bad++; err('page.pension ep=' + E2, `predSettings().model=${x.site} ≠ params.site=${prm.site}`); }
      for (const m of ['freq', 'cold', 'recent', 'gap', 'rand']) {
        const a = x.S[m], b = prm.S && prm.S[m];
        if (!b || !sameArr(a.pos, b.pos) || !sameArr(a.band, b.band)) { bad++; err('page.pension ep=' + E2 + ' ' + m, 'currentScores ≠ rank-params-pension.json'); }
        const mine = pensionScoresMine(E2, m);
        if (!sameArr(mine.pos, a.pos) || !sameArr(mine.band, a.band)) warn('page.pension ep=' + E2 + ' ' + m, '내 currentScores 재구현이 페이지와 다름(재구현 대조는 경고 수준)');
      }
    }
    summary.page.pension = { eps: [PNEXT, ...PS], bad };
  }
} else if (!NOPAGE && !ROOT_MISSING.length) err('page', '페이지 결과 없음');

/* hot/cold 가산 모델 요약 — 허용 오차 역산(정상: 브라우저 libm 차이)은 참고, 역산 불가·동점 사슬은 경고(모아서 한 번씩) */
{
  const A = addStat, ex = xs => xs.slice(0, 6).join(' · ') + (xs.length > 6 ? ` … (+${xs.length - 6})` : '');
  summary.lotto.additive = { models: A.models, weights: A.weights, tolerantWeights: A.tolerant, tolerantModels: A.tolerantModels, maxUlp: A.maxUlp, quantModels: A.quant.length, chainSkipped: A.chain.length };
  if (A.tolerant) notice('lotto.hotcold', `가중치 ${A.tolerant}/${A.weights}개(${A.tolerantModels}/${A.models - A.quant.length} 모델-회차)가 Node Math.pow(b,e) 와 비트 단위로 다름(최대 ${A.maxUlp} ulp — 가중치를 계산한 브라우저의 libm 차이) → ${INV_MAXULP} ulp 허용으로 정수 밑을 역산해 정수 곱으로 대조함`);
  if (A.quant.length) warn('lotto.hotcold', `w 에서 정수 밑 역산 불가(또는 ${INV_MAXULP} ulp 초과) ${A.quant.length} 모델-회차(${ex(A.quant)}) — hot/cold 가중치 정의(max(1,freq52)^2.2 · (1+gap)^1.6)가 바뀌었거나 가중치를 계산한 환경의 Math.pow 가 크게 다름. 정수 곱 대신 계약 정수화(q=round(log w·2^46), 동점 |Δ| ≤ ${ADD_ATOL}, 구간 안 index 오름차순)로 대조함`);
  if (A.chain.length) warn('lotto.hotcold', `동점 사슬(구간 폭 > ATOL ${ADD_ATOL}) — 계약상 순위·탐색 순서가 정의되지 않아 대조 생략 ${A.chain.length}건: ${ex(A.chain)}`);
}
TM.total = Math.round(performance.now() - T0);
try { summary.maxRssMB = Math.round(process.resourceUsage().maxRSS / 1024); } catch (e) {}
summary.ok = ERR === 0;
summary.errors = ERR; summary.warnings = WARN;
if (errList.length > MAXPRINT) summary.moreErrors = errList.slice(MAXPRINT, MAXPRINT + 20);
summary.notes = [...new Set(notes)].slice(0, 40);
console.log(JSON.stringify(summary, null, 1));
log(ERR ? `불일치 ${ERR}건` : '전부 일치', `(경고 ${WARN}) · ${(TM.total / 1000).toFixed(1)}s`);
process.exit(ERR ? 1 : 0);
