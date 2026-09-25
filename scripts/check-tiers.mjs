#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   check-tiers.mjs — brief/rank-tiers-lotto.json · brief/rank-tiers-pension.json (scripts/rank-tiers.mjs,
   PLAN3 §10.1) 의 독립 검증기 (PLAN3 §10.2, Opus-4 소유). CI 에서 rank-tiers.mjs 바로 뒤에 돈다.

   설계 원칙 — rank-core.js · rank-tiers.mjs · 페이지를 부르지 않는다. PLAN3 §1 정의(+ .lab/STATUS-track.md 의
   승인된 동점 분할 규칙)만 보고 내 코드로 다시 센다.
     · 등수 조합: 구성(당첨번호로 조합 만들기)이 아니라 «정의로 분류» — 로또 8,145,060 조합 / 연금 5,000,000 장을
       전부 돌며 본번호 일치 수·보너스 포함(로또), 뒤에서부터 연속 일치 자리 수·조(연금)로 등수를 매긴다.
       로또 2등=본 5+보너스 · 3등=본 5(보너스 X) · 4등=본 4 · 5등=본 3 (4·5등은 보너스 무관)
       연금 2등=6자리 같고 조 다름 · k등(3..7)=뒤 (8−k)자리 일치 & 그 앞자리 불일치 (조 무관, 보너스 번호는 등수 정의 밖).
       센 개수는 조합론 값(6/228/11115/182780 · 4/45/450/4500/45000/450000)과 대조.
     · 순위: 표본 회차마다 모델 점수를 «모든» 조합/티켓에 대해 계산 → 전수 정렬(로또)·전수 도수표(연금)로
       [best, worst] (1-based, 같은 점수 = 같은 순위 구간), pct = (mid−0.5)/of.
       로또 pop  : z = zOf(c) 식 그대로(popFeat → bounds clamp → A/B 표준화 평균, 합산 순서도 페이지와 같음), 오름차순,
                   동점 = z 가 정확히 같음(같은 clamp 벡터 → 같은 비트).
       로또 hot/cold : Σ log w[n], 내림차순. 동점 = STATUS-core «ATOL 규칙» 그대로(판정 기준):
                   q[n] = round(ln w[n]·2^bits) (bits = 46, 6·max|ln w|·2^bits ≥ 2^53 이면 낮춤), 점수 = Σq (정확한 정수),
                   best = 1 + #{s > sc+6}, worst = best−1 + #{|s−sc| ≤ 6}  (창(window) 규칙 — 사슬로 잇지 않음).
                   교차 점검(진단): 부동소수 Σ ln w 를 정렬해 간격 ≤ 1e-9 인 이웃을 묶은 «수학적 동점»(합산 순서 잡음 ~1e-14 로
                   갈라진 같은 곱 — 2·6=3·4 류)과 ATOL 결과가 다르면 ::warning(엔진 쪽 문제 신호), 애매한 간격도 ::warning.
       연금 : §1 «순위만 반영» — 자리별 점수 내림차순 1위=10점…10위=1점(동점=평균 순위 점수), 조 1위=5점…5위=1점,
              티켓 점수 = 합, 내림차순. 점수는 0.5 배수라 2배 정수 도수표로 정확히 센다. site = 그 회차 params.site 모델 별칭.
     · 20칸 히스토그램 = 분할 규칙(STATUS-track §1 decFrac 의 20칸판): 순위 구간 [b,w] 를 연속 구간 (b−1, w] 로 보고
       칸 k = (of·k/20, of·(k+1)/20] 에 겹친 길이 비율만큼 나눠 넣는다 → 칸 값은 소수가 될 수 있다. 동점이 없으면 정수.
       m(회차별 평균 백분위) = 등수 조합 pct(mid) 의 평균(= 분할 구간 중심의 평균 — 두 해석이 같은 값).
     · 모델 파라미터는 brief/rank-params-*.json (rank-track.mjs 산출물) — 검증 대상과 같은 입력.
       당첨번호는 --cache(원자료 캐시) 또는 동행복권 원본(check-sim.mjs 와 같은 엔드포인트) — tiers 파일을 믿지 않는다.
     · 불일치하면 원인 진단용으로 «mid 규칙(정수 칸)» 과 (hot/cold) «수학적 동점»·«부동소수 == 동점» 결과도 계산해 어느 쪽과
       맞는지 알려 준다(hot/cold 의 두 진단 규칙은 첫 표본 회차 — ATOL 교차 점검 — 와 불일치가 난 회차에서만 계산).

   검사 항목
     A. 구조: v/kind/bins=20/N/sims/tiers 개수 정의/models/회차 오름차순·연속/from·latest(원자료 최신보다 뒤면 ::error,
        앞이면 ::warning)/행마다 h 20칸 ≥0 · 합 = 등수 조합 수, m ∈ (0,1), date = 원자료 추첨일,
        «모든 행» m ∈ [Σh_k·k/20, Σh_k·(k+1)/20]/조합 수 (칸 k 의 질량은 백분위 [k/20,(k+1)/20] 에만 있으므로),
        연금 site 별칭 = 그 회차 site 모델 값 · row.site = params.site (파라미터가 있는 모든 행).
     B. 표본 회차(결정적: 마지막 · 처음 · latest 로 시드한 LCG 중간 회차들)의 전수 재계산 → h·m 일치
        (허용오차 = 파일이 반올림한 자릿수에서 자동 산출: 파일 전체 h/m 의 최대 소수 자릿수 D → ½·10^−D;
        13자리 이상인 값은 반올림 안 된 잡음으로 보고 D 계산에서 뺀다).
     D. 참고 교차 점검(::warning): 표본 회차 1등 조합/티켓의 내 전수 순위 = <params-dir>/rank-lotto.json·rank-pension.json 값.
     C. 요약: n·size, bins = Σ 행 h, exp = n·(조합 수)/20 (분할 규칙에선 귀무 기대가 정확히 구간 길이 비율), meanPct = 행 m 평균,
        roundMean{mean, sd(n−1), n, t=(mean−½)/(sd/√n), p=양측 Student t(df=n−1)} — 요약은 «파일에 적힌 행 값» 의 통계여야 하므로
        허용오차는 출력 반올림(r6·r4·유효 6자리)만. 차이가 행 반올림 전파 한계 안이면 «반올림 전 값으로 계산?» 힌트를 붙인다.
        mc (귀무 MC 누적값 — 회차별 모의 추첨의 칸 평균·공분산 합):
          · 형식: sims = 파일 sims, n = 행 수, nullDraws, mean 20 · cov 210(상삼각) · sd/z 20 유한
          · 내부 정합(정확한 항등식): sd = √diag(cov) · z = (bins − exp)/sd · Q = Σz² · maxZ = max|z|
            · Σ_j cov(k,j) = 0 (칸 합이 늘 조합 수라 공분산 행 합 = 0) · |cov(i,j)| ≤ sd_i·sd_j · Σ mean = n·조합 수
          · 통계 정합: mean_k 가 n·조합 수/20(귀무 기대는 정확히 평평) ± sd_k/√sims 의 6.5σ 안
          · pMC·pMax 독립 재계산: 파일 cov 로 만든 상관행렬을 «내» 준정부호 콜레스키로 분해해 N(0,R) 재표집
            (결정적 시드, --null-sims 회) → P(Σz² ≥ Q) · P(max|z| ≥ maxZ) 가 두 MC 오차의 6σ 안. pMC 는 1/(nullDraws+1) 격자(::warning).
          · 규모 참고(::warning): 내 몬테카를로(표본 회차의 순위표 고정 × 무작위 추첨 --mc-sims 회; 로또 앞 --mc-rounds 회차·연금 전 표본)로
            추정한 √(n·회차당 분산) 대비 파일 sd (둘 다 20칸 RMS) 가 ×1/2~×2 밖이면.
        summary.n = 행 수, summary.mc.sims = sims, summary.mc.rounds = 행 회차 목록(있으면).

   사용법:
     node scripts/check-tiers.mjs --root . [--cache <원자료 캐시>]
        [--tiers-dir <dir>] [--params-dir <dir>]          (기본 둘 다 <root>/brief)
        [--lotto-samples 4] [--pension-samples 12|all] [--lotto-rounds 1100,1242] [--pension-eps 200,334]
        [--ties atol|either]  (either = hot/cold 가 «수학적 동점»·«부동소수 == 동점» 결과와 맞아도 ::warning 으로 통과 — 임시 허용용)
        [--mc-sims 10]        (sd 규모 점검용 내 몬테카를로 추첨 수, 0 = 끔)
        [--mc-rounds 2]       (로또에서 내 몬테카를로를 돌릴 표본 회차 수 — 연금은 모든 표본 회차)
        [--null-sims 40000]   (pMC·pMax 재계산용 N(0,R) 재표집 수, 0 = 끔)
        [--max-print 40]
   출력: 불일치 → ::error 줄 + exit 1. 통과 → stdout JSON 요약 + exit 0. 진행·시간은 stderr.
   시간(로컬 데스크톱, Node 22, 실측): 로또 표본 1회차 ≈ 2 s(814만 점수·정렬 × 3 모델; 첫 표본은 내 MC·동점 진단까지 ≈ 4 s),
        연금 1회차 ≈ 0.07 s(+ 내 MC 0.2 s), pMC·pMax 재표집 ≈ 2 s → 기본값 ≈ 15 s, 최대 RSS ≈ 380 MB (목표 ≤ 60 s).
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', process.cwd()));
const TIERS_DIR = path.resolve(arg('--tiers-dir', path.join(ROOT, 'brief')));
const PARAMS_DIR = path.resolve(arg('--params-dir', path.join(ROOT, 'brief')));
const CACHE = arg('--cache', null);
const L_SAMPLES = Math.max(0, +arg('--lotto-samples', 4));
const P_SAMPLES_ARG = String(arg('--pension-samples', 12));
const P_SAMPLES = P_SAMPLES_ARG === 'all' ? Infinity : Math.max(0, +P_SAMPLES_ARG || 0);
const L_ROUNDS = String(arg('--lotto-rounds', '')).split(',').map(Number).filter(x => x > 0);
const P_EPS = String(arg('--pension-eps', '')).split(',').map(Number).filter(x => x > 0);
const TIES = arg('--ties', 'atol') === 'either' ? 'either' : 'atol';     // 'math'(이전 이름)도 atol 로 받는다
const MC_SIMS = Math.max(0, +arg('--mc-sims', 10));
const MC_ROUNDS_L = Math.max(0, +arg('--mc-rounds', 2));          // 로또 내 MC 를 돌릴 표본 회차 수(앞에서부터)
const NULL_SIMS = Math.max(0, +arg('--null-sims', 40000));
const MAXPRINT = +arg('--max-print', 40);

const T0 = performance.now();
const sec = () => ((performance.now() - T0) / 1000).toFixed(1) + 's';
const log = (...a) => console.error(`[${sec()}]`, ...a);

let ERR = 0, WARN = 0;
const errList = [], warnList = [];
function err(where, field, msg) {
  ERR++; const line = `${where} field=${field} ${msg}`; errList.push(line);
  if (errList.length <= MAXPRINT) console.log(`::error title=check-tiers 불일치::${line}`);
}
function warn(where, field, msg) {
  WARN++; const line = `${where} field=${field} ${msg}`; warnList.push(line);
  if (warnList.length <= MAXPRINT) console.log(`::warning title=check-tiers 경고::${line}`);
}

/* ── 0. 허용오차 — 파일이 반올림해 저장했으면 그 자릿수만큼 ─────────────── */
function decimalsOf(x) {
  if (typeof x !== 'number' || !isFinite(x) || Number.isInteger(x)) return 0;
  const s = String(x); const e = s.match(/e-(\d+)$/i);
  if (e) { const m = s.split(/e/i)[0]; const i = m.indexOf('.'); return +e[1] + (i < 0 ? 0 : m.length - i - 1); }
  const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1;
}
/* 한 필드 묶음의 반올림 자릿수 = 소수 자릿수 최댓값. 단 13자리 이상(반올림 안 된 부동소수 잡음, 예 0.1+0.2)은 빼고 센다 —
   값 하나가 잡음 자릿수라고 묶음 전체 허용오차가 1e-17 로 좁아지지 않게. 전부 그렇다면 반올림 안 된 묶음(17). */
const maxDecimals = vals => { let d = -1, any = false; for (const v of vals) { const k = decimalsOf(v); any = true; if (k <= 12 && k > d) d = k; } return d >= 0 ? d : (any ? 17 : 0); };
const halfUlpD = D => (D >= 12 ? 0 : 0.5 * 10 ** -D);          // 소수 D 자리 반올림 오차 한계(12 자리 이상 = 반올림 안 함)
const near = (a, b, tol) => typeof a === 'number' && isFinite(a) && isFinite(b) && Math.abs(a - b) <= tol;
const arrNear = (a, b, tol) => Array.isArray(a) && a.length === b.length && a.every((x, i) => near(x, b[i], tol));
const fmt = x => (typeof x === 'number' && !Number.isInteger(x) ? +x.toFixed(6) : x);
const fmtArr = a => '[' + Array.from(a || [], fmt).join(',') + ']';
function readJSON(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { err(path.basename(file), 'json', `JSON 파싱 실패: ${e.message}`); return undefined; }
}

/* ── 1. 원자료 — --cache 우선, 없으면 동행복권 원본 (check-sim.mjs 와 같은 엔드포인트·형식) ── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function jget(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (lotto-lab check-tiers)' } });
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
      if (o.pension && o.lotto) { log('데이터 캐시 사용:', CACHE); return [o.pension, o.lotto]; }
    } catch (e) { log('캐시 읽기 실패, 새로 받습니다:', e.message); }
  }
  return Promise.all([getPension(), getLotto()]);
}

/* ── 2. 공용: 결정적 표본 · 난수 · 통계 · 칸 나누기 ─────────────────── */
/* 마지막 행(새로 붙은 행) · 첫 행 · latest 로 시드한 LCG 로 고른 중간 행들. 매주 latest 가 바뀌어 중간 표본이 돈다. */
function pickSamples(rounds, k, seed) {
  if (!rounds.length || k <= 0) return [];
  if (k >= rounds.length) return [rounds[rounds.length - 1], ...rounds.slice(0, -1)];
  const out = [rounds[rounds.length - 1]];
  if (k >= 2 && rounds.length > 1) out.push(rounds[0]);
  let s = (seed * 2654435761) >>> 0, guard = 0;
  while (out.length < Math.min(k, rounds.length) && guard++ < 10000) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = rounds[s % rounds.length];
    if (!out.includes(r)) out.push(r);
  }
  return out;
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/* Student t 양측 p = I_{df/(df+t²)}(df/2, ½) — 정규화 불완전 베타(연분수). 알려진 값(df=1,2,10,30 임계값)과 1e-13 일치 확인. */
function lnGamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1; let a = 0.99999999999980993; const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
  const FP = 1e-300; const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
const tTwoSided = (t, df) => (!isFinite(t) ? 0 : ibeta(df / 2, 0.5, df / (df + t * t)));
function erfc(x) { const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r; }
const zTwoSided = z => erfc(Math.abs(z) / Math.SQRT2);
function roundMeanOf(ms) {
  const n = ms.length; if (!n) return null;
  const mean = ms.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const t = sd > 0 ? (mean - 0.5) / (sd / Math.sqrt(n)) : 0;
  return { mean, sd, n, t, p: n > 1 ? tTwoSided(t, n - 1) : 1, pNorm: zTwoSided(t) };
}
/* 칸별 표본분산 (합·제곱합 누적, n−1) */
function varOf(acc, n) { const v = new Array(20);
  for (let b = 0; b < 20; b++) { const mu = acc.s[b] / n; v[b] = n > 1 ? Math.max(0, (acc.q[b] - n * mu * mu) / (n - 1)) : 0; } return v; }

/* 분할 규칙: [b,w] → 연속 구간 (b−1, w], 칸 k = (of·k/20, of·(k+1)/20]. 겹친 길이/(w−b+1) × wt 를 h[k] 에.
   of/20 이 정수(로또 407253 · 연금 250000)라 경계·겹친 길이는 정확한 정수, 나눗셈 한 번만 부동소수. */
function addFrac(h, b, w, of, wt) {
  const len = w - b + 1, B = of / 20;
  let k = Math.floor((b - 1) / B); if (k < 0) k = 0;
  for (; k < 20; k++) {
    const lo = B * k, hi = B * (k + 1);
    if (lo >= w) break;
    const ov = Math.min(w, hi) - Math.max(b - 1, lo);
    if (ov > 0) h[k] += wt * ov / len;
  }
}
/* 진단용 mid 규칙(정수 칸): ⌊20·pct⌋ = ⌊10·(b+w−1)/of⌋ (정수 산술) */
const binMid = (b, w, of) => Math.min(19, Math.floor(10 * (b + w - 1) / of));
const pctOf = (b, w, of) => ((b + w) / 2 - 0.5) / of;

/* ── 3. 로또 엔진 (내 코드) ───────────────────────────────────────── */
const LN = 8145060;
const LOTTO_TIERS = { 2: 6, 3: 228, 4: 11115, 5: 182780 };
{ const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); };
  const chk = { 2: C(6, 5) * 1, 3: C(6, 5) * 38, 4: C(6, 4) * C(39, 2), 5: C(6, 3) * C(39, 3) };  // 보너스 1 · 비당첨 38 · 비당첨+보너스 39
  for (const t in chk) if (chk[t] !== LOTTO_TIERS[t]) throw new Error('LOTTO_TIERS 상수 오류 ' + t);
  if (C(45, 6) !== LN) throw new Error('C(45,6)'); }
const POPC = new Uint8Array(1024); for (let i = 1; i < 1024; i++) POPC[i] = POPC[i >> 1] + (i & 1);
const DECBIT = new Int32Array(46); for (let x = 1; x <= 45; x++) DECBIT[x] = 1 << Math.floor((x - 1) / 10);

/* 모든 조합(사전식 중첩 루프 순서)의 popFeat 원시 정수 특징을 32비트로 포장:
   s(8) | range(6)<<8 | c31(3)<<14 | c12(3)<<17 | cons(3)<<20 | sameLast(3)<<23 | dec(3)<<26 */
function lottoFeatures() {
  const P = new Uint32Array(LN); let i = 0;
  for (let a = 1; a <= 40; a++) {
    const t1 = +(a <= 31), u1 = +(a <= 12), l1 = 1 << (a % 10), d1 = DECBIT[a];
    for (let b = a + 1; b <= 41; b++) {
      const s2 = a + b, t2 = t1 + (b <= 31), u2 = u1 + (b <= 12), k2 = +(b === a + 1), l2 = l1 | 1 << (b % 10), d2 = d1 | DECBIT[b];
      for (let c = b + 1; c <= 42; c++) {
        const s3 = s2 + c, t3 = t2 + (c <= 31), u3 = u2 + (c <= 12), k3 = k2 + (c === b + 1), l3 = l2 | 1 << (c % 10), d3 = d2 | DECBIT[c];
        for (let d = c + 1; d <= 43; d++) {
          const s4 = s3 + d, t4 = t3 + (d <= 31), u4 = u3 + (d <= 12), k4 = k3 + (d === c + 1), l4 = l3 | 1 << (d % 10), d4 = d3 | DECBIT[d];
          for (let e = d + 1; e <= 44; e++) {
            const s5 = s4 + e, t5 = t4 + (e <= 31), u5 = u4 + (e <= 12), k5 = k4 + (e === d + 1), l5 = l4 | 1 << (e % 10), d5 = d4 | DECBIT[e];
            for (let f = e + 1; f <= 45; f++) {
              const s6 = s5 + f, t6 = t5 + (f <= 31), u6 = u5 + (f <= 12), k6 = k5 + (f === e + 1), l6 = l5 | 1 << (f % 10), d6 = d5 | DECBIT[f];
              P[i++] = s6 | (f - a) << 8 | t6 << 14 | u6 << 17 | k6 << 20 | (6 - POPC[l6]) << 23 | POPC[d6] << 26;
            }
          }
        }
      }
    }
  }
  if (i !== LN) throw new Error('조합 수 ' + i);
  return P;
}
function packOne(c) {
  const s = c[0] + c[1] + c[2] + c[3] + c[4] + c[5];
  let t = 0, u = 0, k = 0, l = 0, d = 0;
  for (let j = 0; j < 6; j++) { const x = c[j]; t += x <= 31; u += x <= 12; if (j && x === c[j - 1] + 1) k++; l |= 1 << (x % 10); d |= DECBIT[x]; }
  return s | (c[5] - c[0]) << 8 | t << 14 | u << 17 | k << 20 | (6 - POPC[l]) << 23 | POPC[d] << 26;
}
/* index.html popFeat 원문(대조용 사본) — 내 빠른 포장이 같은 특징을 내는지 자체 점검 */
function popFeatRef(n) {
  const s = n.reduce((a, b) => a + b, 0);
  let cons = 0; for (let i = 1; i < 6; i++) if (n[i] === n[i - 1] + 1) cons++;
  const ld = {}; n.forEach(x => ld[x % 10] = (ld[x % 10] || 0) + 1);
  const sameLast = Object.values(ld).reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
  const dec = {}; n.forEach(x => dec[Math.floor((x - 1) / 10)] = 1);
  return [1, n.filter(x => x <= 31).length, n.filter(x => x <= 12).length,
    (s - 138) / 30, cons, sameLast, (n[5] - n[0] - 33) / 8, Object.keys(dec).length];
}
const unpack = p => [1, p >>> 14 & 7, p >>> 17 & 7, ((p & 255) - 138) / 30, p >>> 20 & 7, p >>> 23 & 7, ((p >>> 8 & 63) - 33) / 8, p >>> 26 & 7];
function randCombo(rng) { const s = new Set(); while (s.size < 6) s.add(1 + Math.floor(rng() * 45)); return [...s].sort((x, y) => x - y); }
function selfTestFeatures(P) {
  const rng = mulberry32(12345); let bad = 0;
  for (let t = 0; t < 20000; t++) {
    const a = randCombo(rng), ref = popFeatRef(a), mine = unpack(packOne(a));
    for (let j = 0; j < 8; j++) if (ref[j] !== mine[j]) bad++;
  }
  if (P[0] !== packOne([1, 2, 3, 4, 5, 6]) || P[LN - 1] !== packOne([40, 41, 42, 43, 44, 45])) bad++;
  if (bad) err('lotto', 'selftest', `내 popFeat 포장이 index.html popFeat 사본과 ${bad}곳 다릅니다 — 검증기 버그`);
}
/* pop: zOf(c) — popFeatClamped → Σ v·β (j=0..7 순서, 초기값 0) → (a−predMean)/predSD, B 가 있으면 두 z 평균.
   특징값마다 항 v·β 를 미리 표로(같은 부동소수 연산) → 합산 순서는 페이지 reduce 와 같다(자체 점검으로 비트 대조). */
function popTerms(pp) {
  const bd = pp.bounds && pp.bounds.length ? pp.bounds : null;
  const cl = (j, v) => (j === 0 || !bd) ? v : Math.max(bd[j][0], Math.min(bd[j][1], v));
  const mk = beta => {
    const T = { t0: cl(0, 1) * beta[0], t1: new Float64Array(8), t2: new Float64Array(8), t3: new Float64Array(256),
      t4: new Float64Array(8), t5: new Float64Array(8), t6: new Float64Array(64), t7: new Float64Array(8) };
    for (let v = 0; v < 8; v++) { T.t1[v] = cl(1, v) * beta[1]; T.t2[v] = cl(2, v) * beta[2]; T.t4[v] = cl(4, v) * beta[4];
      T.t5[v] = cl(5, v) * beta[5]; T.t7[v] = cl(7, v) * beta[7]; }
    for (let s = 0; s < 256; s++) T.t3[s] = cl(3, (s - 138) / 30) * beta[3];
    for (let r = 0; r < 64; r++) T.t6[r] = cl(6, (r - 33) / 8) * beta[6];
    return T;
  };
  return { A: mk(pp.A.beta), B: pp.B ? mk(pp.B.beta) : null, mA: pp.A.predMean, sA: pp.A.predSD,
    mB: pp.B ? pp.B.predMean : 0, sB: pp.B ? pp.B.predSD : 1 };
}
function zPacked(Z, p) {
  const s = p & 255, r = p >>> 8 & 63, t = p >>> 14 & 7, u = p >>> 17 & 7, k = p >>> 20 & 7, l = p >>> 23 & 7, d = p >>> 26 & 7;
  const A = Z.A;
  const a = 0 + A.t0 + A.t1[t] + A.t2[u] + A.t3[s] + A.t4[k] + A.t5[l] + A.t6[r] + A.t7[d];
  const za = (a - Z.mA) / Z.sA;
  if (!Z.B) return za;
  const B = Z.B;
  const b = 0 + B.t0 + B.t1[t] + B.t2[u] + B.t3[s] + B.t4[k] + B.t5[l] + B.t6[r] + B.t7[d];
  return (za + (b - Z.mB) / Z.sB) / 2;
}
/* zOf 원문식 사본(표 없이 직접) */
function zRef(pp, c) {
  const bd = pp.bounds && pp.bounds.length ? pp.bounds : null;
  const f = popFeatRef(c).map((v, j) => (j === 0 || !bd) ? v : Math.max(bd[j][0], Math.min(bd[j][1], v)));
  const za = (f.reduce((a, v, j) => a + v * pp.A.beta[j], 0) - pp.A.predMean) / pp.A.predSD;
  if (!pp.B) return za;
  return (za + (f.reduce((a, v, j) => a + v * pp.B.beta[j], 0) - pp.B.predMean) / pp.B.predSD) / 2;
}
function popScores(pp, FEAT, out) {
  const Z = popTerms(pp);
  for (let i = 0; i < LN; i++) out[i] = zPacked(Z, FEAT[i]);
  const rng = mulberry32(777); let bad = 0;
  for (let t = 0; t < 3000; t++) { const c = randCombo(rng); if (zRef(pp, c) !== zPacked(Z, packOne(c))) bad++; }
  return bad;
}
/* hot/cold: Σ log w[n] — 사전식 순서로 왼쪽부터 누적. 동점은 rankStruct 에서 수학적으로 묶는다. */
function addScores(w, out) {
  const lw = new Float64Array(46); for (let n = 1; n <= 45; n++) lw[n] = Math.log(w[n]);
  let i = 0;
  for (let a = 1; a <= 40; a++) { const s1 = lw[a];
    for (let b = a + 1; b <= 41; b++) { const s2 = s1 + lw[b];
      for (let c = b + 1; c <= 42; c++) { const s3 = s2 + lw[c];
        for (let d = c + 1; d <= 43; d++) { const s4 = s3 + lw[d];
          for (let e = d + 1; e <= 44; e++) { const s5 = s4 + lw[e];
            for (let f = e + 1; f <= 45; f++) out[i++] = s5 + lw[f]; } } } } }
}
/* hot/cold ATOL 규칙(STATUS-core «가산» 정의 — 판정 기준): q[n] = round(ln w[n]·2^bits), 점수 = Σq (정확한 정수, 덧셈 순서 무관).
   bits = 46 에서 시작해 6·max|ln w|·2^bits ≥ 2^53 이면 낮춘다(정수 합이 2^53 안에 있게). */
const ATOL = 6, ABITS = 46;
function atolQ(w) {
  const lw = new Float64Array(46); let mx = 0;
  for (let n = 1; n <= 45; n++) { lw[n] = Math.log(w[n]); if (!isFinite(lw[n])) throw new Error('ln w 가 유한하지 않음 n=' + n); mx = Math.max(mx, Math.abs(lw[n])); }
  let bits = ABITS; while (bits > 0 && 6 * mx * 2 ** bits >= 2 ** 53) bits--;
  const q = new Float64Array(46); for (let n = 1; n <= 45; n++) q[n] = Math.round(lw[n] * 2 ** bits);
  return { q, bits };
}
function atolScores(q, out) {
  let i = 0;
  for (let a = 1; a <= 40; a++) { const s1 = q[a];
    for (let b = a + 1; b <= 41; b++) { const s2 = s1 + q[b];
      for (let c = b + 1; c <= 42; c++) { const s3 = s2 + q[c];
        for (let d = c + 1; d <= 43; d++) { const s4 = s3 + q[d];
          for (let e = d + 1; e <= 44; e++) { const s5 = s4 + q[e];
            for (let f = e + 1; f <= 45; f++) out[i++] = s5 + q[f]; } } } } }
}
/* 창 규칙: 내림차순 순위 best = 1 + #{s > sc+6}, worst = best−1 + #{sc−6 ≤ s ≤ sc+6}. srtQ = 오름차순 정수 점수. */
function rankATOL(srtQ, sc) {
  const lo = lowerBound(srtQ, LN, sc - ATOL), hi = upperBound(srtQ, LN, sc + ATOL);
  if (hi <= lo) return null;
  return { b: LN - hi + 1, w: LN - lo };
}
/* 정수 점수 분포 진단: 서로 다른 값 수, 간격 ≤ ATOL 로 이은 사슬(= 동점 묶음)의 수·최대 폭·묶음 사이 최소 간격.
   최대 폭 ≤ ATOL 이면 창 규칙이 이행적(묶음 = 동치류)이고, 묶음 사이 간격이 크면 반올림 잡음과 참 차이가 뚜렷이 갈린다. */
function atolDiag(srtQ) {
  let distinct = 1, groups = 1, maxWidth = 0, minGroupGap = Infinity, start = srtQ[0];
  for (let i = 1; i < LN; i++) {
    const d = srtQ[i] - srtQ[i - 1]; if (d <= 0) continue;
    distinct++;
    if (d <= ATOL) { if (srtQ[i] - start > maxWidth) maxWidth = srtQ[i] - start; }
    else { groups++; start = srtQ[i]; if (d < minGroupGap) minGroupGap = d; }
  }
  return { distinct, groups, maxWidth, minGroupGap };
}
/* 정렬 + 동점 구간. snap>0: 간격 ≤ snap 인 이웃을 한 구간(수학적 동점) · 0: 부동소수 == 만. */
const NOISE_MAX = 1e-11, REAL_MIN = 1e-7;
function rankStruct(scores, srt, gid, snap) {
  srt.set(scores); srt.sort();
  let g = 0, minReal = Infinity, maxNoise = 0, ambiguous = 0, distinctFloat = 1;
  gid[0] = 0; const starts = [0];
  for (let i = 1; i < LN; i++) {
    const d = srt[i] - srt[i - 1];
    if (d > 0) {
      distinctFloat++;
      if (snap > 0 && d > NOISE_MAX && d < REAL_MIN) ambiguous++;       // 묶기(snap)를 쓸 때만 의미 — pop 은 == 동점
      if (d > snap) { g++; starts.push(i); if (d < minReal) minReal = d; }
      else if (d > maxNoise) maxNoise = d;
    }
    gid[i] = g;
  }
  starts.push(LN);
  return { srt, gid, starts: Int32Array.from(starts), groups: g + 1, distinctFloat, minReal, maxNoise, ambiguous };
}
function lowerBound(a, n, x) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
function upperBound(a, n, x) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; }
/* 점수 q 의 [best,worst] — m*(수학적 동점 구간) / f*(부동소수 == 만). dir 'asc' = 작을수록 위. */
function rankOfScore(RS, q, dir) {
  const lo = lowerBound(RS.srt, LN, q), hi = upperBound(RS.srt, LN, q);
  if (lo >= hi) return null;
  const g = RS.gid[lo], gs = RS.starts[g], ge = RS.starts[g + 1];
  if (dir === 'asc') return { mb: gs + 1, mw: ge, fb: lo + 1, fw: hi };
  return { mb: LN - ge + 1, mw: LN - gs, fb: LN - hi + 1, fw: LN - lo };
}
/* 등수 조합들 → 순위 규칙 ranker(점수 → {b,w}) 로 (분할) h · (mid 진단) h · 평균 pct. 같은 점수는 한 번만 순위 조회. */
function tierHist(scores, idxList, ranker) {
  const byScore = new Map();
  for (const idx of idxList) { const q = scores[idx]; byScore.set(q, (byScore.get(q) || 0) + 1); }
  const h = new Array(20).fill(0), hMid = new Array(20).fill(0);
  let s = 0, missing = 0;
  for (const [q, cnt] of byScore) {
    const r = ranker(q);
    if (!r) { missing += cnt; continue; }
    addFrac(h, r.b, r.w, LN, cnt); hMid[binMid(r.b, r.w, LN)] += cnt; s += cnt * pctOf(r.b, r.w, LN);
  }
  return { h, hMid, m: s / idxList.length, missing };
}
const sameHist = (a, b) => arrNear(a.h, b.h, 1e-9) && Math.abs(a.m - b.m) <= 1e-12;
/* 등수 분류(정의 그대로) — 모든 조합: 본번호 일치 수 m, 보너스 포함 여부. 반환: 등수별 사전식 위치 목록 */
function lottoTierLists(win, bonus) {
  const W = new Uint8Array(46); for (const x of win) W[x] = 1;
  const L = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  let i = 0;
  for (let a = 1; a <= 40; a++) { const m1 = W[a], b1 = a === bonus;
    for (let b = a + 1; b <= 41; b++) { const m2 = m1 + W[b], b2 = b1 || b === bonus;
      for (let c = b + 1; c <= 42; c++) { const m3 = m2 + W[c], b3 = b2 || c === bonus;
        for (let d = c + 1; d <= 43; d++) { const m4 = m3 + W[d], b4 = b3 || d === bonus;
          for (let e = d + 1; e <= 44; e++) { const m5 = m4 + W[e], b5 = b4 || e === bonus;
            for (let f = e + 1; f <= 45; f++, i++) {
              const m = m5 + W[f];
              if (m < 3) continue;
              if (m === 3) L[5].push(i);
              else if (m === 4) L[4].push(i);
              else if (m === 5) ((b5 || f === bonus) ? L[2] : L[3]).push(i);
              else L[1].push(i);
            } } } } } }
  return L;
}

/* ── 4. 연금 엔진 (내 코드) ───────────────────────────────────────── */
const PN = 5e6;
const PENSION_TIERS = { 2: 4, 3: 45, 4: 450, 5: 4500, 6: 45000, 7: 450000 };   // 2등 = 다른 조 4 · k등 = 5조 × 9 × 10^(k−3)
const PMODELS = ['freq', 'cold', 'recent', 'gap', 'rand'];
/* 순위 점수(2배 정수): 점수 내림차순 1위 = top 점 …, 동점 = 평균 순위 점수 = top − g − (q−1)/2  (g = 더 큰 수, q = 같은 수) */
function rankPoints2(arr, top) {
  const out = new Int32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let g = 0, q = 0;
    for (let j = 0; j < arr.length; j++) { if (arr[j] > arr[i]) g++; else if (arr[j] === arr[i]) q++; }
    out[i] = 2 * top - 2 * g - (q - 1);
  }
  return out;
}
function pensionPoints2(S) {
  const pos = new Int32Array(60), band = rankPoints2(S.band, 5);
  for (let p = 0; p < 6; p++) { const r = rankPoints2(S.pos[p], 10); for (let d = 0; d < 10; d++) pos[p * 10 + d] = r[d]; }
  return { pos, band };
}
const validS = S => S && Array.isArray(S.pos) && S.pos.length === 6 && S.pos.every(a => Array.isArray(a) && a.length === 10 && a.every(Number.isFinite)) &&
  Array.isArray(S.band) && S.band.length === 5 && S.band.every(Number.isFinite);
/* 5,000,000 장 전수 도수표 → H[v] = 2배 점수 v 인 티켓 수, gt[v] = v 보다 큰 티켓 수 */
function pensionHist(PT) {
  const H = new Float64Array(141), ps = PT.pos, bd = PT.band;
  for (let d0 = 0; d0 < 10; d0++) { const s0 = ps[d0];
    for (let d1 = 0; d1 < 10; d1++) { const s1 = s0 + ps[10 + d1];
      for (let d2 = 0; d2 < 10; d2++) { const s2 = s1 + ps[20 + d2];
        for (let d3 = 0; d3 < 10; d3++) { const s3 = s2 + ps[30 + d3];
          for (let d4 = 0; d4 < 10; d4++) { const s4 = s3 + ps[40 + d4];
            for (let d5 = 0; d5 < 10; d5++) { const s5 = s4 + ps[50 + d5];
              for (let b = 0; b < 5; b++) H[s5 + bd[b]]++; } } } } } }
  let tot = 0; for (const x of H) tot += x;
  if (tot !== PN) throw new Error('연금 도수표 합 ' + tot);
  const gt = new Float64Array(141); let acc = 0;
  for (let v = 140; v >= 0; v--) { gt[v] = acc; acc += H[v]; }
  return { H, gt };
}
/* 등수 분류(정의 그대로) + 히스토그램 — 5,000,000 장: 뒤에서부터 연속 일치 자리 수 j (j=0 은 등수 없음), j=6 이면 조 비교.
   같은 (등수, 점수) 는 모아서 한 번에 나눈다. */
function pensionTierHist(PT, HS, wband, wnum, errAt) {
  const w = [...wnum].map(Number), ps = PT.pos, bd = PT.band;
  const cnt = {}; for (const t in PENSION_TIERS) cnt[t] = new Float64Array(141);
  let first = 0;
  for (let d0 = 0; d0 < 10; d0++) { const s0 = ps[d0], e0 = d0 === w[0];
    for (let d1 = 0; d1 < 10; d1++) { const s1 = s0 + ps[10 + d1], e1 = d1 === w[1];
      for (let d2 = 0; d2 < 10; d2++) { const s2 = s1 + ps[20 + d2], e2 = d2 === w[2];
        for (let d3 = 0; d3 < 10; d3++) { const s3 = s2 + ps[30 + d3], e3 = d3 === w[3];
          for (let d4 = 0; d4 < 10; d4++) { const s4 = s3 + ps[40 + d4], e4 = d4 === w[4];
            for (let d5 = 0; d5 < 10; d5++) {
              if (d5 !== w[5]) continue;                          // 뒤 1자리도 안 맞으면 등수 없음
              const s5 = s4 + ps[50 + d5];
              const j = !e4 ? 1 : !e3 ? 2 : !e2 ? 3 : !e1 ? 4 : !e0 ? 5 : 6;
              for (let b = 1; b <= 5; b++) {
                const sc = s5 + bd[b - 1];
                if (j === 6) { if (b === wband) first++; else cnt[2][sc]++; }
                else cnt[8 - j][sc]++;
              } } } } } } }
  const h = {}, hMid = {}, m = {};
  for (const t in PENSION_TIERS) {
    const H = new Array(20).fill(0), HM = new Array(20).fill(0); let s = 0, c = 0;
    for (let v = 0; v <= 140; v++) { const k = cnt[t][v]; if (!k) continue;
      const b = HS.gt[v] + 1, wv = HS.gt[v] + HS.H[v];
      addFrac(H, b, wv, PN, k); HM[binMid(b, wv, PN)] += k; s += k * pctOf(b, wv, PN); c += k; }
    if (c !== PENSION_TIERS[t] && errAt) err(errAt, `tier${t}.count`, `정의로 센 ${t}등 티켓 ${c} ≠ ${PENSION_TIERS[t]} (검증기 버그)`);
    h[t] = H; hMid[t] = HM; m[t] = s / c;
  }
  if (first !== 1 && errAt) err(errAt, 'tier1.count', `1등 티켓 ${first} ≠ 1`);
  return { h, hMid, m };
}

/* ── 5. 파일 구조 · 요약 검사 (공용) ───────────────────────────────── */
function checkStructure(F, kind, TIERS, modelKeys, where, ctx) {
  if (F.v !== 1) err(where, 'v', `v=${F.v} (기대 1)`);
  if (F.kind !== kind) err(where, 'kind', `kind=${F.kind} (기대 ${kind})`);
  if (F.bins !== 20) err(where, 'bins', `bins=${F.bins} (기대 20)`);
  if (F.N != null && F.N !== ctx.N) err(where, 'N', `N=${F.N} ≠ ${ctx.N}`);
  if (F.sims != null && !(Number.isInteger(F.sims) && F.sims >= 2)) err(where, 'sims', `sims=${F.sims} (정수 ≥ 2 여야 함)`);
  const ft = F.tiers || {};
  for (const t in TIERS) if (ft[t] !== TIERS[t]) err(where, `tiers.${t}`, `${ft[t]} ≠ 정의 ${TIERS[t]}`);
  for (const t in ft) if (!(t in TIERS)) warn(where, `tiers.${t}`, `계약(§10.1) 밖의 등수 ${t} — 검증하지 않음`);
  const mk = (F.models || []).map(m => typeof m === 'string' ? m : m && m.key);
  for (const k of modelKeys) if (!mk.includes(k)) err(where, 'models', `모델 ${k} 없음 (models=${mk.join(',')})`);
  const rows = Array.isArray(F.rows) ? F.rows : [];
  const tol = { h: 1e-6, m: 1e-9, Dh: 0, Dm: 0 };
  if (!rows.length) { err(where, 'rows', '행이 없습니다'); return { rows, tol }; }
  for (let i = 1; i < rows.length; i++) if (!(rows[i].round > rows[i - 1].round)) err(where, `rows[${i}].round`, `회차가 오름차순이 아닙니다 (${rows[i - 1].round} → ${rows[i].round})`);
  const last = rows[rows.length - 1].round;
  if (F.from != null && rows[0].round !== F.from) err(where, 'from', `from=${F.from} ≠ 첫 행 ${rows[0].round}`);
  if (F.latest != null && last !== F.latest) err(where, 'latest', `latest=${F.latest} ≠ 마지막 행 ${last}`);
  if (ctx.rawLatest) {
    if (last > ctx.rawLatest) err(where, 'latest', `마지막 행 ${last} 이 원자료 최신 회차 ${ctx.rawLatest} 보다 뒤입니다`);
    else if (last < ctx.rawLatest) warn(where, 'latest', `원자료 최신 ${ctx.rawLatest}회인데 마지막 행이 ${last}회 — 등수 분포가 밀려 있습니다`);
  }
  let gaps = 0; for (let i = 1; i < rows.length; i++) if (rows[i].round !== rows[i - 1].round + 1) gaps++;
  if (gaps) warn(where, 'rows', `회차 사이 빈칸 ${gaps}곳 (연속이 아님)`);
  /* 반올림 자릿수 → 허용오차 (파일 전체의 최대 소수 자릿수 D: ½·10^−D, 반올림 없으면 1e-9 수준) */
  const hv = [], mv = [];
  for (const r of rows) for (const m of mk) { const hh = r.h && r.h[m], mm = r.m && r.m[m];
    for (const t in TIERS) { if (hh && Array.isArray(hh[t])) hv.push(...hh[t]); if (mm) mv.push(mm[t]); } }
  tol.Dh = maxDecimals(hv); tol.Dm = maxDecimals(mv);
  tol.h = Math.max(1e-6, halfUlpD(tol.Dh) + 1e-9); tol.m = halfUlpD(tol.Dm) + 1e-9;
  let nullCells = 0, boundsChecked = 0;
  for (const r of rows) {
    const at = `${where} round=${r.round}`;
    const dw = ctx.draws.get(r.round);
    if (!dw) { if (ctx.draws.size) err(at, 'round', '원자료(당첨번호)에 없는 회차입니다'); }
    else if (r.date != null && dw.date != null && String(r.date) !== dw.date) err(at, 'date', `행 date ${r.date} ≠ 원자료 추첨일 ${dw.date} (행과 추첨이 어긋남)`);
    for (const mkey of mk) {
      const hh = r.h && r.h[mkey], mm = r.m && r.m[mkey];
      if (hh === null && mm === null) {        // rank-tiers: 그 회차 파라미터가 없으면 null
        if (ctx.hasParam(r.round, mkey)) err(at, `h.${mkey}`, '파라미터가 있는데 h/m 이 null 입니다');
        else nullCells++;
        continue;
      }
      if (!hh || !mm) { err(at, `h/m.${mkey}`, '모델 칸이 없습니다'); continue; }
      for (const t in TIERS) {
        const a = hh[t];
        if (!Array.isArray(a) || a.length !== 20 || !a.every(x => typeof x === 'number' && isFinite(x) && x >= 0)) { err(at, `h.${mkey}.${t}`, `20칸 (≥0 유한수) 배열이 아닙니다: ${JSON.stringify(a)}`); continue; }
        const s = a.reduce((x, y) => x + y, 0);
        if (!near(s, TIERS[t], 20 * tol.h)) err(at, `h.${mkey}.${t}`, `합 ${fmt(s)} ≠ ${t}등 조합 수 ${TIERS[t]}`);
        if (!(typeof mm[t] === 'number' && mm[t] > 0 && mm[t] < 1)) { err(at, `m.${mkey}.${t}`, `평균 백분위가 (0,1) 밖: ${mm[t]}`); continue; }
        /* 칸 k 의 질량은 백분위 [k/20, (k+1)/20] 안에만 있다 → m 은 [Σh_k·k/20, Σh_k·(k+1)/20]/조합 수 안 (모든 행) */
        let lo = 0; for (let k = 0; k < 20; k++) lo += a[k] * k / 20;
        lo /= TIERS[t]; const hi = lo + s / 20 / TIERS[t];
        const tb = tol.m + 20 * tol.h / TIERS[t] + 1e-12;
        boundsChecked++;
        if (mm[t] < lo - tb || mm[t] > hi + tb) err(at, `m.${mkey}.${t}`, `평균 백분위 ${mm[t]} 가 이 행의 h 로 가능한 범위 [${fmt(lo)}, ${fmt(hi)}] 밖입니다`);
      }
    }
  }
  if (nullCells) warn(where, 'h', `null 인 모델 칸 ${nullCells}개 (그 회차 파라미터 없음 — 요약에서 빠짐)`);
  return { rows, tol, boundsChecked, nullCells };
}

/* ── 5b. 귀무 재표집 — 파일 cov 로 만든 상관행렬 R 에서 N(0,R) 을 내 코드로 뽑아 pMC·pMax 를 다시 잰다 ──────── */
/* 준정부호 콜레스키 R = L·Lᵀ. 칸 합 제약(Σ sd_k·z_k = 0)으로 R 은 계수 19 → 피벗이 (반올림 잡음 수준으로) 0 이면 그 열을 0 으로. */
function cholPSD(R, n) {
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let d = R[j * n + j]; for (let k = 0; k < j; k++) d -= L[j * n + k] * L[j * n + k];
    if (!(d > 1e-9)) continue;
    const ljj = Math.sqrt(d); L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) { let s = R[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; L[i * n + j] = s / ljj; }
  }
  let e = 0;                                          // 재구성 오차 max|R − L·Lᵀ| (자체 점검)
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k <= j; k++) s += L[i * n + k] * L[j * n + k]; e = Math.max(e, Math.abs(s - R[i * n + j])); }
  return { L, err: e };
}
function nullResample(L, n, Q, maxZ, M, seed) {
  const rng = mulberry32(seed), g = new Float64Array(n + 1);
  let geQ = 0, geM = 0;
  for (let s = 0; s < M; s++) {
    for (let i = 0; i < n; i += 2) {                                   // Box–Muller
      let u = rng(); if (u < 1e-300) u = 1e-300;
      const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * rng();
      g[i] = r * Math.cos(th); g[i + 1] = r * Math.sin(th);
    }
    let q = 0, mx = 0;
    for (let i = 0; i < n; i++) { let v = 0; const o = i * n; for (let k = 0; k <= i; k++) v += L[o + k] * g[k]; q += v * v; const a = v < 0 ? -v : v; if (a > mx) mx = a; }
    if (q >= Q) geQ++; if (mx >= maxZ) geM++;
  }
  return { pQ: geQ / M, pM: geM / M };
}
const TRI20 = (i, j) => (i <= j ? i * 20 - (i * (i - 1)) / 2 + (j - i) : j * 20 - (j * (j - 1)) / 2 + (i - j));   // 상삼각 행 우선
const finiteArr = (a, len) => Array.isArray(a) && a.length === len && a.every(x => typeof x === 'number' && isFinite(x));
const sig6Rel = 5e-6;                                   // 유효숫자 6자리 반올림의 상대 오차 한계

function checkSummary(F, rows, tol, TIERS, modelKeys, where, mcEst) {
  const SM = F.summary, S = SM && SM.models;
  if (!S) { err(where, 'summary.models', '요약이 없습니다'); return {}; }
  if (SM.n != null && SM.n !== rows.length) err(where, 'summary.n', `${SM.n} ≠ 행 수 ${rows.length}`);
  const smc = SM.mc || null;
  if (smc) {
    if (F.sims != null && smc.sims !== F.sims) err(where, 'summary.mc.sims', `${smc.sims} ≠ 파일 sims ${F.sims}`);
    if (Array.isArray(smc.rounds)) {
      const want = rows.map(r => r.round);
      if (smc.rounds.length !== want.length || smc.rounds.some((x, i) => x !== want[i])) err(where, 'summary.mc.rounds', `MC 누적 회차 목록(${smc.rounds.length}개) ≠ 행 회차 목록(${want.length}개)`);
    }
  }
  /* 요약 필드별 반올림 자릿수(모든 모델·등수의 같은 필드에서 최대 소수 자릿수) → 필드별 허용오차 */
  const fam = {}; const walk = (o, key) => { if (typeof o === 'number') (fam[key] = fam[key] || []).push(o);
    else if (Array.isArray(o)) o.forEach(x => walk(x, key)); else if (o && typeof o === 'object') for (const k in o) walk(o[k], key ? key + '.' + k : k); };
  for (const mk in S) for (const t in S[mk]) walk(S[mk][t], '');
  const Dsum = {}; for (const k in fam) Dsum[k] = maxDecimals(fam[k]);
  const tS = k => halfUlpD(Dsum[k] ?? 17) + 1e-9;
  const out = { roundingDecimals: { h: tol.Dh, m: tol.Dm, summary: Dsum } };
  const agg = { checked: 0, maxMeanZ: 0, maxRowSumRel: 0, maxPmcDevSigma: 0, maxPmaxDevSigma: 0, maxCholErr: 0, zeroSdBins: 0, pairs: [] };
  out.mcCheck = agg;
  let ti = 0;
  for (const mk of modelKeys) for (const t in TIERS) {
    ti++;
    const at = `${where} model=${mk} tier=${t}`, s = S[mk] && S[mk][t];
    if (!s) { err(at, 'summary', '요약 칸이 없습니다'); continue; }
    const use = rows.filter(r => r.h && r.h[mk] && Array.isArray(r.h[mk][t]) && r.m && r.m[mk] && typeof r.m[mk][t] === 'number');
    const n = use.length, size = TIERS[t];
    if (s.n != null && s.n !== n) err(at, 'summary.n', `${s.n} ≠ 이 모델·등수의 행 수 ${n}`);
    if (s.size != null && s.size !== size) err(at, 'summary.size', `${s.size} ≠ ${t}등 조합 수 ${size}`);
    const bins = new Array(20).fill(0); for (const r of use) for (let b = 0; b < 20; b++) bins[b] += r.h[mk][t][b];
    const binTight = b => tS('bins') + 1e-12 * Math.abs(bins[b]) + 1e-9;                     // 행 h 합의 출력 반올림만
    if (!Array.isArray(s.bins) || s.bins.length !== 20 || s.bins.some((x, b) => !near(x, bins[b], binTight(b)))) {
      const hint = Array.isArray(s.bins) && s.bins.length === 20 && s.bins.every((x, b) => near(x, bins[b], binTight(b) + n * tol.h))
        ? ` — 차이가 행 h 반올림 전파 한계(±${(n * tol.h).toExponential(1)}) 안: 요약을 파일의 행 h 가 아닌(반올림 전) 값으로 더했을 수 있음` : '';
      err(at, 'summary.bins', `${fmtArr(s.bins)} ≠ Σ행 ${fmtArr(bins)}${hint}`);
    }
    /* exp: 분할 규칙에선 귀무(균등) 기대가 정확히 구간 길이 비율 → n·(조합 수)/20 */
    const e = n * size / 20;
    if (!Array.isArray(s.exp) || s.exp.length !== 20 || s.exp.some(x => !near(x, e, tS('exp') + 1e-9 * e))) err(at, 'summary.exp', `${fmtArr((s.exp || []).slice(0, 3))}… ≠ n·${size}/20 = ${e}`);
    const ms = use.map(r => r.m[mk][t]);
    const RM = roundMeanOf(ms), rm = s.roundMean || {};
    if (!RM) { err(at, 'roundMean', '행이 없습니다'); continue; }
    /* 허용오차 = 출력 반올림(r6·r4·유효 6자리)만 — 요약은 «파일에 적힌 행 m» 의 통계여야 하므로 그보다 크면 ::error.
       진단: 차이가 «행 m 반올림 전파 한계»(요약을 반올림 전 m 으로 계산했을 때 생길 수 있는 차이, ×2) 안이면 메시지에 그 가능성을 적는다. */
    const dm = halfUlpD(tol.Dm) + 1e-15;
    const dMean = dm, dSd = dm * Math.sqrt(n / Math.max(1, n - 1));
    const dT = RM.sd > 0 ? (Math.sqrt(n) * dMean + Math.abs(RM.t) * dSd) / RM.sd : 0;
    const dP = 0.8 * dT;
    const two = (field, got, want, tight, loose, what) => {
      if (near(got, want, tight)) return true;
      const hint = near(got, want, tight + loose) ? ` — 차이가 행 m 반올림 전파 한계(±${loose.toExponential(1)}) 안: 요약을 파일의 행 m 이 아닌(반올림 전) 값으로 계산했을 수 있음` : '';
      err(at, field, `${got} ≠ ${want}${what ? ' (' + what + ')' : ''}${hint}`); return false;
    };
    two('summary.meanPct', s.meanPct, RM.mean, tS('meanPct') + 1e-12, 2 * dMean, '행 m 평균');
    if (rm.n !== n) err(at, 'roundMean.n', `${rm.n} ≠ ${n}`);
    two('roundMean.mean', rm.mean, RM.mean, tS('roundMean.mean') + 1e-12, 2 * dMean, '행 m 평균');
    if (n > 1) {
      two('roundMean.sd', rm.sd, RM.sd, tS('roundMean.sd') + 1e-12, 2 * dSd, '표본 sd, n−1');
      two('roundMean.t', rm.t, RM.t, tS('roundMean.t') + 1e-9 * Math.abs(RM.t) + 1e-12, 2 * dT, '(mean−0.5)/(sd/√n)');
      const pTight = sig6Rel * 1.2 * Math.abs(RM.p) + 1e-8 * Math.abs(RM.p) + 1e-14;          // p 는 유효 6자리(반올림 전 t 로 계산)
      if (!near(rm.p, RM.p, pTight)) {
        if (near(rm.p, RM.pNorm, pTight)) err(at, 'roundMean.p', `${rm.p} = 정규 근사 p — 계약은 Student t(df=${n - 1}) 양측 p = ${RM.p}`);
        else two('roundMean.p', rm.p, RM.p, pTight, 2 * dP + 1e-5 * Math.abs(RM.p), `Student t(df=${n - 1}) 양측; 정규 근사 ${RM.pNorm}`);
      }
    }
    /* ── mc ── */
    const mc = s.mc;
    if (!mc) { err(at, 'mc', '없습니다'); continue; }
    if (!Number.isInteger(mc.sims) || mc.sims < 2) err(at, 'mc.sims', `정수 ≥2 가 아닙니다: ${mc.sims}`);
    else if (F.sims != null && mc.sims !== F.sims) err(at, 'mc.sims', `${mc.sims} ≠ 파일 sims ${F.sims}`);
    if (mc.n !== n) { err(at, 'mc.n', `MC 누적 회차 수 ${mc.n} ≠ 행 수 ${n}${mc.note ? ' (' + mc.note + ')' : ''}`); continue; }
    if (n < 2 && !Array.isArray(mc.sd)) { warn(at, 'mc', `행이 ${n}개 — 귀무 MC 통계(sd·z·pMC)는 2회차부터 (검사 생략)`); continue; }
    const shapeBad = [['mean', 20], ['sd', 20], ['z', 20], ['cov', 210]].filter(([k, len]) => !finiteArr(mc[k], len)).map(([k]) => k);
    if (shapeBad.length) { err(at, 'mc.' + shapeBad[0], `유한수 배열 모양이 아닙니다 (${shapeBad.join(', ')}; mean·sd·z 20칸, cov 210칸)`); continue; }
    for (const k of ['Q', 'maxZ', 'pMC', 'pMax']) if (!(typeof mc[k] === 'number' && isFinite(mc[k]))) err(at, 'mc.' + k, `유한수가 아닙니다: ${mc[k]}`);
    if (mc.sd.some(x => x < 0)) err(at, 'mc.sd', `음수 sd: ${fmtArr(mc.sd)}`);
    for (const k of ['pMC', 'pMax']) if (!(mc[k] >= 0 && mc[k] <= 1)) err(at, 'mc.' + k, `[0,1] 밖: ${mc[k]}`);
    if (smc && smc.nullDraws != null && mc.nullDraws != null && mc.nullDraws !== smc.nullDraws) err(at, 'mc.nullDraws', `${mc.nullDraws} ≠ summary.mc.nullDraws ${smc.nullDraws}`);
    agg.checked++;
    const cov = mc.cov, sdC = new Array(20), sims = mc.sims;
    /* 정확한 항등식 — (1) sd = √diag(cov) (2) 공분산 행 합 = 0 (3) |cov_ij| ≤ sd_i sd_j (4) Σ mean = n·size */
    for (let k = 0; k < 20; k++) {
      const v = cov[TRI20(k, k)];
      if (v < 0) { err(at, 'mc.cov', `대각 cov[${k}] = ${v} < 0`); sdC[k] = 0; continue; }
      sdC[k] = Math.sqrt(v);
      if (!near(mc.sd[k], sdC[k], sig6Rel * sdC[k] + 1e-9 * sdC[k] + tS('mc.sd'))) err(at, 'mc.sd', `sd[${k}] = ${mc.sd[k]} ≠ √cov[${k},${k}] = ${sdC[k]}`);
      if (sdC[k] === 0) agg.zeroSdBins++;
    }
    let rowBad = -1, rowWorst = 0, csBad = null;
    for (let i = 0; i < 20; i++) {
      let rs = 0, ra = 0;
      for (let j = 0; j < 20; j++) { const c = cov[TRI20(i, j)]; rs += c; ra += Math.abs(c);
        if (j > i && Math.abs(c) > sdC[i] * sdC[j] * (1 + 1e-6) + 1e-9 * (ra + 1) && !csBad) csBad = [i, j, c]; }
      const rel = ra > 0 ? Math.abs(rs) / ra : 0;
      if (rel > rowWorst) rowWorst = rel;
      if (rel > 1e-6 && rowBad < 0) rowBad = i;
    }
    agg.maxRowSumRel = Math.max(agg.maxRowSumRel, rowWorst);
    if (rowBad >= 0) err(at, 'mc.cov', `공분산 행 ${rowBad} 의 합이 0 이 아닙니다 (|Σ_j cov|/Σ_j|cov| = ${rowWorst.toExponential(2)}) — 칸 합이 늘 ${size} 이므로 행 합은 0 이어야 함`);
    if (csBad) err(at, 'mc.cov', `|cov[${csBad[0]},${csBad[1]}]| = ${Math.abs(csBad[2])} > sd·sd — 공분산이 아닙니다`);
    const sumMean = mc.mean.reduce((a, b) => a + b, 0);
    if (!near(sumMean, n * size, 1e-8 * n * size + 20 * tS('mc.mean'))) err(at, 'mc.mean', `Σ mean = ${sumMean} ≠ n·${size} = ${n * size} (모의 추첨마다 칸 합은 ${size})`);
    /* z · Q · maxZ — 파일 bins·exp 와 √diag(cov) 로 */
    const zc = new Array(20); let Qc = 0, Mc = 0;
    for (let k = 0; k < 20; k++) { zc[k] = sdC[k] > 0 ? (s.bins[k] - s.exp[k]) / sdC[k] : 0; Qc += zc[k] * zc[k]; Mc = Math.max(Mc, Math.abs(zc[k])); }
    const zTol = k => tS('mc.z') + 1e-6 * Math.abs(zc[k]) + (sdC[k] > 0 ? (2 * tS('bins') + tS('exp')) / sdC[k] : 0) + 1e-9;
    const zBad = zc.findIndex((z, k) => !near(mc.z[k], z, zTol(k)));
    if (zBad >= 0) err(at, 'mc.z', `z[${zBad}] = ${mc.z[zBad]} ≠ (bins − exp)/sd = ${zc[zBad]}`);
    if (!near(mc.Q, Qc, tS('mc.Q') + 1e-5 * Qc + 1e-9)) err(at, 'mc.Q', `${mc.Q} ≠ Σz² = ${Qc}`);
    if (!near(mc.maxZ, Mc, tS('mc.maxZ') + 1e-5 * Mc + 1e-9)) err(at, 'mc.maxZ', `${mc.maxZ} ≠ max|z| = ${Mc}`);
    /* 통계 정합: Σ_회차 (회차 모의 평균) ~ n·size/20 ± sd/√sims (귀무 기대는 정확히 평평) */
    let mzMax = 0, mzAt = -1;
    for (let k = 0; k < 20; k++) {
      const se = sdC[k] / Math.sqrt(sims);
      const zz = se > 0 ? Math.abs(mc.mean[k] - e) / se : (Math.abs(mc.mean[k] - e) <= 1e-6 * e + tS('mc.mean') ? 0 : Infinity);
      if (zz > mzMax) { mzMax = zz; mzAt = k; }
    }
    agg.maxMeanZ = Math.max(agg.maxMeanZ, mzMax);
    if (mzMax > 6.5) err(at, 'mc.mean', `칸 ${mzAt} 의 모의 평균 합 ${mc.mean[mzAt]} 이 귀무 기대 ${e} 에서 ${mzMax.toFixed(1)} 표준오차 — 모의 추첨·누적 절차 오류 의심`);
    /* pMC·pMax: 격자(procedure) + 독립 재표집 */
    const nd = Number.isInteger(mc.nullDraws) && mc.nullDraws > 0 ? mc.nullDraws : null;
    if (nd) for (const k of ['pMC', 'pMax']) {
      const x = mc[k] * (nd + 1), tolG = (nd + 1) * mc[k] * sig6Rel + 1e-6;
      if (Math.abs(x - Math.round(x)) > tolG || x < 1 - tolG) warn(at, 'mc.' + k, `${mc[k]} 가 (개수+1)/(nullDraws+1) = 1/${nd + 1} 격자에 없습니다`);
    }
    if (NULL_SIMS > 0) {
      const R = new Float64Array(400);
      for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++)
        R[i * 20 + j] = i === j ? 1 : (sdC[i] > 0 && sdC[j] > 0 ? cov[TRI20(i, j)] / (sdC[i] * sdC[j]) : 0);
      const C = cholPSD(R, 20);
      agg.maxCholErr = Math.max(agg.maxCholErr, C.err);
      if (C.err > 1e-3) warn(at, 'mc.cov', `상관행렬 콜레스키 재구성 오차 ${C.err.toExponential(2)} — 준정부호가 아닐 수 있음(검증기 재표집 정확도 저하)`);
      const seed = (Math.imul(ti, 2654435761) ^ (where === 'lotto' ? 0x1234567 : 0x7654321)) >>> 0;
      const r = nullResample(C.L, 20, mc.Q, mc.maxZ, NULL_SIMS, seed);
      const ndd = nd || 20000;
      const dev = (pf, pm) => { const pb = Math.min(1 - 1 / NULL_SIMS, Math.max(1 / NULL_SIMS, (pf + pm) / 2));
        const sdv = Math.sqrt(pb * (1 - pb) * (1 / ndd + 1 / NULL_SIMS)); return { d: Math.abs(pf - pm), lim: 6 * sdv + 2 / ndd + 1 / NULL_SIMS, sig: Math.abs(pf - pm) / sdv }; };
      const dq = dev(mc.pMC, r.pQ), dmx = dev(mc.pMax, r.pM);
      agg.maxPmcDevSigma = Math.max(agg.maxPmcDevSigma, dq.sig); agg.maxPmaxDevSigma = Math.max(agg.maxPmaxDevSigma, dmx.sig);
      agg.pairs.push(`${mk}.${t} pMC ${mc.pMC}/${+r.pQ.toFixed(5)} pMax ${mc.pMax}/${+r.pM.toFixed(5)}`);
      if (dq.d > dq.lim) err(at, 'mc.pMC', `${mc.pMC} ≠ 내 재표집 P(Σz² ≥ Q=${mc.Q}) = ${r.pQ} (N(0,R) ${NULL_SIMS}회, 허용 ±${dq.lim.toFixed(4)})`);
      if (dmx.d > dmx.lim) err(at, 'mc.pMax', `${mc.pMax} ≠ 내 재표집 P(max|z| ≥ ${mc.maxZ}) = ${r.pM} (N(0,R) ${NULL_SIMS}회, 허용 ±${dmx.lim.toFixed(4)})`);
    }
    /* 규모 참고: 내 몬테카를로 회차당 분산 → √(n·회차당 분산) vs 파일 sd — 둘 다 20칸 RMS(√평균 분산)로 (칸마다 sd 가 수 배 달라 산술평균과 섞으면 치우침) */
    const est = mcEst && mcEst[mk] && mcEst[mk][t];
    if (est && est.length) {
      let vbar = 0; for (const x of est) for (let b = 0; b < 20; b++) vbar += x.v[b]; vbar /= est.length * 20;
      const mine = Math.sqrt(n * vbar), theirs = Math.sqrt(mc.sd.reduce((a, b) => a + b * b, 0) / 20), ratio = theirs / mine;
      out[`${mk}.${t}`] = { sdMine: +mine.toPrecision(4), sdFile: +theirs.toPrecision(4), ratio: +ratio.toPrecision(3) };
      if (!(ratio > 0.5 && ratio < 2) && mine > 0.5) warn(at, 'mc.sd', `파일 sd 20칸 RMS ${theirs.toPrecision(4)} 가 내 추정 √(n·회차당 분산) ${mine.toPrecision(4)} 의 ${ratio.toPrecision(3)}배 — 절차 확인 필요`);
    }
  }
  agg.maxMeanZ = +agg.maxMeanZ.toFixed(2); agg.maxRowSumRel = +agg.maxRowSumRel.toExponential(2);
  agg.maxPmcDevSigma = +agg.maxPmcDevSigma.toFixed(2); agg.maxPmaxDevSigma = +agg.maxPmaxDevSigma.toFixed(2); agg.maxCholErr = +agg.maxCholErr.toExponential(2);
  return out;
}
function mcAccumulate(acc, h) { for (let b = 0; b < 20; b++) { acc.s[b] += h[b]; acc.q[b] += h[b] * h[b]; } }
const newAcc = () => ({ s: new Float64Array(20), q: new Float64Array(20) });

/* ── 6. 로또 ─────────────────────────────────────────────────────── */
const LOTTO_MODELS = ['pop', 'hot', 'cold'];
function runLotto(lottoRaw) {
  const file = path.join(TIERS_DIR, 'rank-tiers-lotto.json'), pfile = path.join(PARAMS_DIR, 'rank-params-lotto.json');
  const F = readJSON(file);
  if (F === null) { warn('lotto', 'file', `${file} 없음 — 로또 등수 검증 생략`); return { skipped: true }; }
  if (F === undefined) return { skipped: true };
  const PR = readJSON(pfile);
  if (!PR) err('lotto', 'params', `${pfile} 없음/파싱 실패 — 등수 순위 재계산 불가`);
  const draws = new Map();
  for (const x of (lottoRaw && lottoRaw.rows) || []) {
    const n = [x.tm1WnNo, x.tm2WnNo, x.tm3WnNo, x.tm4WnNo, x.tm5WnNo, x.tm6WnNo].map(Number).sort((a, b) => a - b);
    draws.set(+x.ltEpsd, { n, b: +x.bnsWnNo, date: x.ltRflYmd != null ? String(x.ltRflYmd) : null });
  }
  const rawLatest = draws.size ? Math.max(...draws.keys()) : 0;
  const prow = R => PR && PR.rows && PR.rows[R];
  const hasParam = (R, mk) => { const p = prow(R); return !!(p && (mk === 'pop' ? p.pop && p.pop.A : Array.isArray(p[mk]))); };
  const { rows, tol, boundsChecked } = checkStructure(F, 'lotto', LOTTO_TIERS, LOTTO_MODELS, 'lotto', { N: LN, draws, rawLatest, hasParam });
  const TRACK = readJSON(path.join(PARAMS_DIR, 'rank-lotto.json'));   // 교차 점검용(있으면): 1등 조합 순위 = rank-track 값?
  const eligible = rows.map(r => r.round).filter(R => draws.has(R) && prow(R));
  const noParam = rows.filter(r => !prow(r.round)).length;
  if (noParam) warn('lotto', 'params', `파라미터가 없는 행 ${noParam}개 — 표본에서 제외`);
  const samples = L_ROUNDS.length ? L_ROUNDS.filter(R => eligible.includes(R)) : pickSamples(eligible, L_SAMPLES, F.latest || 0);
  for (const R of L_ROUNDS) if (!eligible.includes(R)) warn('lotto', 'samples', `요청한 회차 ${R} 는 행·파라미터·당첨번호 중 하나가 없어 제외`);
  log(`로또: 행 ${rows.length} (${rows.length ? rows[0].round + '~' + rows[rows.length - 1].round : '-'}) · 반올림 h ${tol.Dh}자리 m ${tol.Dm}자리 · 표본 ${samples.join(', ')}`);

  const res = { rows: rows.length, mBoundsChecked: boundsChecked, samples, compared: 0, matched: 0, midSensitive: 0, altCompared: 0, atolVsMathDiff: 0, floatSensitive: 0,
    firstPrizeVsTrack: { same: 0, diff: 0 }, diag: {} };
  const mcEst = {}; for (const m of LOTTO_MODELS) { mcEst[m] = {}; for (const t in LOTTO_TIERS) mcEst[m][t] = []; }
  if (samples.length) {
    let t = performance.now();
    const FEAT = lottoFeatures(); selfTestFeatures(FEAT);
    log(`  특징표 ${Math.round(performance.now() - t)}ms`);
    const scores = new Float64Array(LN), srt = new Float64Array(LN), gid = new Int32Array(LN);
    for (const R of samples) {
      const at = `lotto round=${R}`, row = rows.find(r => r.round === R), pr = prow(R), dw = draws.get(R);
      t = performance.now();
      const TL = lottoTierLists(dw.n, dw.b);
      if (TL[1].length !== 1) err(at, 'tier1', `본번호 6개 일치 조합 ${TL[1].length} ≠ 1 (당첨번호 자료 확인)`);
      for (const k in LOTTO_TIERS) if (TL[k].length !== LOTTO_TIERS[k]) err(at, `tier${k}.count`, `정의로 센 ${k}등 조합 ${TL[k].length} ≠ ${LOTTO_TIERS[k]}`);
      /* 내 몬테카를로 — 앞 --mc-rounds(기본 2) 표본 회차: 순위표(모델)는 이 회차 것 고정, 추첨만 무작위(결정적 시드), 같은 분류 함수 */
      const MC = [];
      if (MC_SIMS > 0 && samples.indexOf(R) < MC_ROUNDS_L) {        // 앞 --mc-rounds 개 표본 회차
        const rng = mulberry32((R * 7919) >>> 0);
        for (let sim = 0; sim < MC_SIMS; sim++) {
          const st = new Set(); while (st.size < 7) st.add(1 + Math.floor(rng() * 45));
          const arr = [...st]; MC.push(lottoTierLists(arr.slice(0, 6).sort((a, b) => a - b), arr[6]));
        }
      }
      for (const m of LOTTO_MODELS) {
        const t1 = performance.now();
        const hh = row.h && row.h[m], mm = row.m && row.m[m];
        /* X = 판정 기준(계약 정의) 결과. ranker·scores 는 X 의 순위표(MC·1등 교차 점검도 같은 것). */
        let X, ranker, dg, w = null;
        if (m === 'pop') {
          if (!pr.pop || !pr.pop.A) { if (hh != null) err(at, 'params.pop', 'pop 파라미터(A) 없음'); continue; }
          const bad = popScores(pr.pop, FEAT, scores);
          if (bad) err(at, 'pop.selftest', `표 방식 z 와 zOf 식 사본이 ${bad}/3000 조합에서 비트가 다릅니다 — 검증기 버그`);
          const RS = rankStruct(scores, srt, gid, 0);                    // pop 동점 = z 가 부동소수점으로 정확히 같음
          ranker = q => { const r = rankOfScore(RS, q, 'asc'); return r && { b: r.fb, w: r.fw }; };
          dg = { groups: RS.groups, minGap: +RS.minReal.toPrecision(3) };
        } else {
          w = pr[m];
          if (Array.isArray(w) && w.length === 45) w = [1, ...w];          // rank-core logw 처럼 45칸(1..45 → 0..44)도 받는다
          if (!Array.isArray(w) || w.length < 46 || w.slice(1, 46).some(x => !(x > 0 && isFinite(x)))) { err(at, `params.${m}`, '가중치 46칸(양의 유한수) 아님'); continue; }
          /* (판정) ATOL 규칙: 정수 점수 Σq, 창 ±6 */
          const { q, bits } = atolQ(w);
          atolScores(q, scores); srt.set(scores); srt.sort();
          const AD = atolDiag(srt);
          ranker = sc => rankATOL(srt, sc);
          dg = { bits, atolDistinct: AD.distinct, atolTieGroups: AD.groups, atolMaxTieWidth: AD.maxWidth, atolMinGroupGap: AD.minGroupGap };
          if (AD.maxWidth > ATOL) warn(at, `${m}.ties`, `정수 점수 동점 사슬 폭 ${AD.maxWidth} > ATOL ${ATOL} — 창 규칙이 이행적이지 않은 구간이 있음(참 동점 판정 애매)`);
        }
        X = {}; for (const k in LOTTO_TIERS) X[k] = tierHist(scores, TL[k], ranker);
        /* 교차 점검 — 1등 조합의 내 전수 순위 vs brief/rank-lotto.json (rank-track·rank-core). 검증 대상 밖이라 ::warning 만 */
        const tr = TRACK && Array.isArray(TRACK.rows) && TRACK.rows.find(x => x.round === R), trm = tr && tr.ranks && tr.ranks[m];
        if (trm && TL[1].length === 1) {
          const r1 = ranker(scores[TL[1][0]]);
          if (r1 && r1.b === trm.best && r1.w === trm.worst) res.firstPrizeVsTrack.same++;
          else { res.firstPrizeVsTrack.diff++; warn(at, `track.${m}`, `1등 조합 순위: 내 전수 [${r1 && r1.b},${r1 && r1.w}] ≠ rank-lotto.json [${trm.best},${trm.worst}] (check-rank 소관 — 참고)`); }
        }
        if (MC.length) {
          const acc = {}; for (const k in LOTTO_TIERS) acc[k] = newAcc();
          for (const TLs of MC) for (const k in LOTTO_TIERS) mcAccumulate(acc[k], tierHist(scores, TLs[k], ranker).h);
          for (const k in LOTTO_TIERS) mcEst[m][k].push({ v: varOf(acc[k], MC.length), n: MC.length });
        }
        const cellOK = k => hh && Array.isArray(hh[k]) && mm && arrNear(hh[k], X[k].h, tol.h) && near(mm[k], X[k].m, tol.m);
        const anyBad = Object.keys(LOTTO_TIERS).some(k => hh && Array.isArray(hh[k]) && mm && !cellOK(k));
        /* (진단) hot/cold 다른 동점 규칙 — 부동소수 Σ ln w 로 «수학적 동점»(간격 ≤ 1e-9 묶음)·«부동소수 ==» 동점.
           첫 표본 회차(ATOL 이 참 동점만 묶는지 교차 점검)와 불일치가 난 회차(원인 진단)에서만 계산 — scores·srt 를 덮어쓴다. */
        const ALT = {};
        if (w && (R === samples[0] || anyBad)) {
          addScores(w, scores);
          const RS = rankStruct(scores, srt, gid, 1e-9);
          if (RS.ambiguous) warn(at, `${m}.ties`, `점수 간격 ${NOISE_MAX}~${REAL_MIN} 사이가 ${RS.ambiguous}곳 — 수학적 동점 판정이 애매함(진단용 규칙만 영향)`);
          ALT.math = {}; ALT.float = {};
          for (const k in LOTTO_TIERS) {
            ALT.math[k] = tierHist(scores, TL[k], q => { const r = rankOfScore(RS, q, 'desc'); return r && { b: r.mb, w: r.mw }; });
            ALT.float[k] = tierHist(scores, TL[k], q => { const r = rankOfScore(RS, q, 'desc'); return r && { b: r.fb, w: r.fw }; });
            res.altCompared++;
            if (!sameHist(X[k], ALT.float[k])) res.floatSensitive++;
            if (!sameHist(X[k], ALT.math[k])) {
              res.atolVsMathDiff++;
              warn(at, `${m}.${k}.ties`, `ATOL 창 규칙과 «수학적 동점» 결과가 다름: ATOL h=${fmtArr(X[k].h)} · 수학 h=${fmtArr(ALT.math[k].h)} (판정은 ATOL — rank-core 동점 규칙 점검 필요)`);
            }
          }
          Object.assign(dg, { mathGroups: RS.groups, distinctFloat: RS.distinctFloat, minRealGap: +RS.minReal.toPrecision(3), maxNoise: +RS.maxNoise.toPrecision(3) });
        }
        res.diag[`${R}.${m}`] = dg;
        for (const k in LOTTO_TIERS) {
          const Y = X[k];
          if (Y.missing) err(at, `${m}.${k}`, `조합 점수 ${Y.missing}개를 정렬표에서 못 찾음 — 검증기 버그`);
          res.compared++;
          if (!arrNear(Y.h, Y.hMid, 1e-9)) res.midSensitive++;
          if (!hh || !Array.isArray(hh[k]) || !mm) continue;          // 구조 검사에서 이미 보고
          if (cellOK(k)) { res.matched++; continue; }
          const eq = Z => Z && arrNear(hh[k], Z.h, tol.h) && near(mm[k], Z.m, tol.m);
          const okMath = eq(ALT.math && ALT.math[k]), okF = eq(ALT.float && ALT.float[k]);
          if ((okMath || okF) && TIES === 'either') { warn(at, `h.${m}.${k}`, `ATOL 규칙이 아닌 «${okMath ? '수학적' : '부동소수 =='} 동점» 결과와만 일치 (ATOL h=${fmtArr(Y.h)})`); res.matched++; continue; }
          const why = okMath ? ' — 파일은 «수학적 동점»(부동소수 간격 묶음) 결과와 일치: 계약은 STATUS-core ATOL 창 규칙(정수 Σq, ±6)'
            : okF ? ' — 파일은 «부동소수 == 동점» 결과와 일치: 같은 곱이 합산 순서 잡음(~1e-14)으로 갈라짐(ATOL 규칙으로 묶어야 함; 임시 허용 --ties either)'
            : arrNear(hh[k], Y.hMid, tol.h) ? ' — 파일은 mid 규칙(⌊20·pct⌋ 정수 칸)과 일치: 계약은 동점 분할 규칙((b−1,w] 를 칸 길이 비율로)'
            : arrNear(hh[k], Y.h, tol.h) ? ' — h 는 일치, m 만 다름' : '';
          err(at, `h.${m}.${k}`, `파일 ${fmtArr(hh[k])} m=${mm[k]} ≠ 내 전수 ${fmtArr(Y.h)} m=${fmt(Y.m)}` +
            ` (차이 ${fmtArr(hh[k].map((x, b) => x - Y.h[b]))})${why}`);
        }
        log(`  ${R} ${m}: ${Math.round(performance.now() - t1)}ms`);
      }
      log(`  ${R} 끝 ${Math.round(performance.now() - t)}ms`);
    }
  }
  const t2 = performance.now();
  res.summary = checkSummary(F, rows, tol, LOTTO_TIERS, LOTTO_MODELS, 'lotto', mcEst);
  log(`  로또 요약 검사 ${Math.round(performance.now() - t2)}ms`);
  return res;
}

/* ── 7. 연금 ─────────────────────────────────────────────────────── */
const PENSION_MODELS = ['freq', 'cold', 'recent', 'gap', 'rand', 'site'];
function runPension(pensionRaw) {
  const file = path.join(TIERS_DIR, 'rank-tiers-pension.json'), pfile = path.join(PARAMS_DIR, 'rank-params-pension.json');
  const F = readJSON(file);
  if (F === null) { warn('pension', 'file', `${file} 없음 — 연금 등수 검증 생략`); return { skipped: true }; }
  if (F === undefined) return { skipped: true };
  const PR = readJSON(pfile);
  if (!PR) err('pension', 'params', `${pfile} 없음/파싱 실패 — 등수 순위 재계산 불가`);
  const draws = new Map((pensionRaw || []).map(r => [+r.ep, { band: +r.band, num: String(r.num).padStart(6, '0'), date: r.date != null ? String(r.date) : null }]));
  const rawLatest = draws.size ? Math.max(...draws.keys()) : 0;
  const prow = e => PR && PR.rows && PR.rows[e];
  const hasParam = (e, mk) => { const p = prow(e); if (!p || !p.S) return false; const key = mk === 'site' ? p.site : mk; return PMODELS.includes(key) && validS(p.S[key]); };
  const { rows, tol, boundsChecked } = checkStructure(F, 'pension', PENSION_TIERS, PENSION_MODELS, 'pension', { N: PN, draws, rawLatest, hasParam });
  const TRACK = readJSON(path.join(PARAMS_DIR, 'rank-pension.json'));
  /* site 별칭 — 파라미터가 있는 모든 행에서 h/m 이 그 회차 site 모델 값과 같아야 한다 (+ 행에 site 가 적혀 있으면 params.site 와 같아야) */
  let aliasChecked = 0;
  for (const r of rows) {
    const pr = prow(r.round); if (!pr || !pr.site) continue;
    if (r.site !== undefined && r.site !== pr.site) err(`pension round=${r.round}`, 'site', `행 site=${r.site} ≠ params.site=${pr.site}`);
    if (!r.h || !r.h.site) continue;
    if (!PMODELS.includes(pr.site)) { err(`pension round=${r.round}`, 'params.site', `site=${pr.site} 가 모델 목록에 없음`); continue; }
    if (!r.h[pr.site]) continue;
    aliasChecked++;
    for (const t in PENSION_TIERS) {
      if (!arrNear(r.h.site[t], r.h[pr.site][t] || [], 1e-12)) err(`pension round=${r.round}`, `h.site.${t}`, `site(=${pr.site}) 별칭인데 h 가 다름`);
      if (r.m && r.m.site && r.m[pr.site] && r.m.site[t] !== r.m[pr.site][t]) err(`pension round=${r.round}`, `m.site.${t}`, `site(=${pr.site}) 별칭인데 m 이 다름 ${r.m.site[t]} ≠ ${r.m[pr.site][t]}`);
    }
  }
  const eligible = rows.map(r => r.round).filter(e => draws.has(e) && PR && PR.rows && PR.rows[e]);
  const noParam = rows.filter(r => !(PR && PR.rows && PR.rows[r.round])).length;
  if (noParam) warn('pension', 'params', `파라미터가 없는 행 ${noParam}개 — 표본·별칭 점검에서 제외`);
  const samples = P_EPS.length ? P_EPS.filter(e => eligible.includes(e)) : pickSamples(eligible, P_SAMPLES, (F.latest || 0) + 17);
  for (const e of P_EPS) if (!eligible.includes(e)) warn('pension', 'samples', `요청한 회차 ${e} 는 행·파라미터·당첨번호 중 하나가 없어 제외`);
  log(`연금: 행 ${rows.length} · 반올림 h ${tol.Dh}자리 m ${tol.Dm}자리 · site 별칭 점검 ${aliasChecked}행 · 표본 ${samples.join(', ')}`);
  const res = { rows: rows.length, mBoundsChecked: boundsChecked, samples, compared: 0, matched: 0, midSensitive: 0, aliasChecked, firstPrizeVsTrack: { same: 0, diff: 0 } };
  const mcEst = {}; for (const m of PENSION_MODELS) { mcEst[m] = {}; for (const t in PENSION_TIERS) mcEst[m][t] = []; }
  for (const ep of samples) {
    const t = performance.now(), at = `pension round=${ep}`, row = rows.find(r => r.round === ep), pr = PR.rows[ep], dw = draws.get(ep);
    if (!/^\d{6}$/.test(dw.num) || !(dw.band >= 1 && dw.band <= 5)) { err(at, 'draw', `당첨 자료 이상 ${dw.band}조 ${dw.num}`); continue; }
    for (const m of PENSION_MODELS) {
      const key = m === 'site' ? pr.site : m, S = pr.S && pr.S[key];
      if (!validS(S)) { err(at, `params.${m}`, `점수 S(${key}) 가 6×10 + 5 유한수가 아닙니다`); continue; }
      const PT = pensionPoints2(S), HS = pensionHist(PT);
      const X = pensionTierHist(PT, HS, dw.band, dw.num, at);
      const tr = TRACK && Array.isArray(TRACK.rows) && TRACK.rows.find(x => x.round === ep), trm = tr && tr.ranks && tr.ranks[m];
      if (trm) {
        let s1 = PT.band[dw.band - 1]; for (let p = 0; p < 6; p++) s1 += PT.pos[p * 10 + +dw.num[p]];
        const b1 = HS.gt[s1] + 1, w1 = HS.gt[s1] + HS.H[s1];
        if (b1 === trm.best && w1 === trm.worst) res.firstPrizeVsTrack.same++;
        else { res.firstPrizeVsTrack.diff++; warn(at, `track.${m}`, `1등 티켓 순위: 내 전수 [${b1},${w1}] ≠ rank-pension.json [${trm.best},${trm.worst}] (check-rank 소관 — 참고)`); }
      }
      const hh = row.h && row.h[m], mm = row.m && row.m[m];
      for (const k in PENSION_TIERS) {
        res.compared++;
        if (!arrNear(X.h[k], X.hMid[k], 1e-9)) res.midSensitive++;
        if (!hh || !Array.isArray(hh[k]) || !mm) continue;
        if (arrNear(hh[k], X.h[k], tol.h) && near(mm[k], X.m[k], tol.m)) { res.matched++; continue; }
        const why = arrNear(hh[k], X.hMid[k], tol.h) ? ' — 파일은 mid 규칙(⌊20·pct⌋ 정수 칸)과 일치: 계약은 동점 분할 규칙((b−1,w] 를 칸 길이 비율로)' : '';
        err(at, `h.${m}.${k}`, `파일 ${fmtArr(hh[k])} m=${mm[k]} ≠ 내 전수 ${fmtArr(X.h[k])} m=${fmt(X.m[k])} (차이 ${fmtArr(hh[k].map((x, b) => x - X.h[k][b]))})${why}`);
      }
      /* 내 몬테카를로 — 모든 표본 회차, 같은 정의 함수에 무작위 추첨(시드 = 회차, 모델 간 같은 추첨). site 는 그 회차 site 모델 값 재사용. */
      if (MC_SIMS > 0 && m !== 'site') {
        const rng = mulberry32((ep * 7919) >>> 0);
        const acc = {}; for (const k in PENSION_TIERS) acc[k] = newAcc();
        for (let sim = 0; sim < MC_SIMS; sim++) {
          const wb = 1 + Math.floor(rng() * 5), wn = String(Math.floor(rng() * 1e6)).padStart(6, '0');
          const Y = pensionTierHist(PT, HS, wb, wn, at);
          for (const k in PENSION_TIERS) mcAccumulate(acc[k], Y.h[k]);
        }
        for (const k in PENSION_TIERS) { const e = { v: varOf(acc[k], MC_SIMS), n: MC_SIMS }; mcEst[m][k].push(e); if (m === pr.site) mcEst.site[k].push(e); }
      }
    }
    log(`  ${ep} 끝 ${Math.round(performance.now() - t)}ms`);
  }
  const t2 = performance.now();
  res.summary = checkSummary(F, rows, tol, PENSION_TIERS, PENSION_MODELS, 'pension', mcEst);
  log(`  연금 요약 검사 ${Math.round(performance.now() - t2)}ms`);
  return res;
}

/* ── 8. 실행 ─────────────────────────────────────────────────────── */
(async () => {
  let pensionRaw = null, lottoRaw = null;
  try { [pensionRaw, lottoRaw] = await getData(); }
  catch (e) { err('data', 'fetch', `원자료를 받지 못했습니다: ${e.message}`); }
  let lotto = null, pension = null;
  try { lotto = runLotto(lottoRaw); } catch (e) { err('lotto', 'exception', e.stack || e.message); }
  try { pension = runPension(pensionRaw); } catch (e) { err('pension', 'exception', e.stack || e.message); }
  if (errList.length > MAXPRINT) console.log(`::error title=check-tiers::… 외 ${errList.length - MAXPRINT}건 더 (총 ${ERR})`);
  if (warnList.length > MAXPRINT) console.log(`::warning title=check-tiers::… 외 ${warnList.length - MAXPRINT}건 더 (총 ${WARN})`);
  const out = { ok: ERR === 0, errors: ERR, warnings: WARN, seconds: +((performance.now() - T0) / 1000).toFixed(1),
    ties: TIES, mcSims: MC_SIMS, nullSims: NULL_SIMS, lotto, pension };
  console.log(JSON.stringify(out, null, 1));
  log(ERR ? `불일치 ${ERR}건 — 실패` : `통과 (경고 ${WARN})`);
  process.exit(ERR ? 1 : 0);
})();
