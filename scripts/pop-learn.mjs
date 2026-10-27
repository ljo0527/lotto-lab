#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   pop-learn.mjs — 당첨금 학습 장부 생성기 (그림자 모형, 추천은 바꾸지 않는다)

   하는 일: 매주 «등수별 당첨자 수» 로 «사람들이 고르는 조합» 인기 예측을 다시 학습하는 후보 모형 2개를 사전 등록하고,
            지금 쓰는 인기 모형(base)과 walk-forward 로 견준다. 입력은 lotto-history.json 과 brief/rank-params-lotto.json 뿐이다.
            외부 접속·Playwright 없음. index.html·rank-core.js 를 읽지도 가져오지도 않는다(식을 여기서 다시 구현했다).
   규격과 한계: docs/pop-learn.md · 독립 검증: scripts/check-pop-learn.mjs (이 파일을 가져오지 않는 따로 만든 구현)

   사용
     node scripts/pop-learn.mjs --history lotto-history.json --params brief/rank-params-lotto.json --out brief/pop-learn-lotto.json [--root .] [--now ISO]
       --root     상대 경로의 기준 폴더.                                  기본 .
       --history  로또 전 회차 스냅샷(1..latest 연속이어야 한다).          기본 lotto-history.json
       --params   회차별 인기 모형 파라미터(rows[t].pop = t-1 까지로 적합). 기본 brief/rank-params-lotto.json
       --out      쓸 곳. 기존 파일이 있으면 일지를 이어 쓴다.              기본 brief/pop-learn-lotto.json
       --now      시험용 고정 시각(ISO). generated·made·gradedAt 에만 쓴다. 기본 실제 현재 시각.
     종료 코드: 0 = 정상 또는 «쓰지 않음»(역행 가드·최신 회차 이상 → wrote=false) · 1 = 실패(출력 파일은 건드리지 않는다).
     $GITHUB_OUTPUT 이 있으면 wrote=true|false 를 쓴다(워크플로의 독립 검증 단계 조건).

   모형(회차 t 의 «당첨번호 인기»)
     관측 m45 = 0.5·w4/e4 + 0.5·w5/e5   (지금 모형 A 와 같은 정의, e_k = 판매 게임 수 × WAYS_k / 8,145,060)
          m123 = (w1+w2+w3)/(e1+e2+e3)   mp = Σw/Σe (1~5등 풀드)
     base = 지금 모형: rank-params rows[t] 의 A·B·bounds 로 당첨번호 z 를 index.html 의 zOf 와 같은 산술 순서로 계산 → 예측 a+b·z
            (a·b 는 t 이전 회차들의 «그때그때 z» 와 m45 의 단순회귀 — validate.calibrate 와 같다, 최소 CAL_MIN 쌍)
     C1   = 같은 8특징으로 m45 를 반감기 HALF_LIFE 회 지수 감쇠 가중 OLS 로 다시 맞춤(최근 인기 변화 반영)
     C2   = 같은 8특징으로 1~5등 풀드 배수 mp 를 포아송 가중(Σe) WLS 로 맞춤(1~3등 정보 포함)
     C1·C2 는 t-1 까지로만 적합하고, 특징은 base 와 같은 popFeat 와 학습 구간(2~98 백분위) 자르기를 쓴다.
     점수 = (ln 예측 − ln m45)²  (로그 배수 제곱오차). 후보−base 가 음수면 후보가 낫다.

   일지(매매 일지·규칙 15 와 같은 틀)
     pending(추첨 전, 얼린 파라미터) → done(추첨 뒤, 당첨번호의 모형별 예측 배수와 관측 m45·m123·mp).
     J1 채점(마감 추첨일 11:00Z 이후에 만든 행은 late) · J2 빠진 주는 missed(소급 없음) · J3 latest+1 제시 · J4 동결(다시 계산해 다르면 ::warning, 처음 값 유지)
     J5 재채점 대조 · J6 불변(행 삭제·재정렬 없음, from 고정) · 역행 가드 · 원자적 쓰기 · 1MB 확인.
   관문: done&&!late ≥ GATE_MIN 이고 후보−base 부호 뒤집기 순열 p ≤ α/후보 수 이고 돌아보면(사후) 재현도 같은 방향이면 «채택 조건 충족» 상태 + ::notice.
         추천 코드를 자동으로 바꾸지 않는다 — 반영은 소유자 결정이다.

   결정성: 모형·요약·관문 함수에는 Math.random·Date 가 없다(난수는 mulberry32 + 회차 시드). Date 는 --now 를 ISO 로 바꾸는 한 곳(resolveNow)에만 있다.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TITLE = 'pop-learn';
const WARN_MAX = 5;                                          // 같은 종류 ::warning 을 한 번에 이 개수까지만 적는다(주석 한도)
const MAX_BYTES = 1000000;                                  // CLAUDE.md 규칙 4: 새로 추적하는 파일 하나는 1MB 미만
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
class Fail extends Error {}                                  // 예상된 실패: ::error 한 줄 + exit 1, 쓰기 없음

/* ═════════════ 상수 한 곳 (바꾸면 VER 을 올리고 RULES 에 덧붙인다 — 규칙 11·15) ═════════════ */
export const VER = 'pop-1';
export const CONF = Object.freeze({
  WAYS: [1, 6, 228, 11115, 182780],      // 1~5등 조합 수
  C456: 8145060, TICKET: 1000,
  E4_MIN: 200,                           // 4등 기대 당첨자 수 하한 — 지금 모형 적합과 같은 표본 조건
  FIRST: 1000,                           // 돌아보기 시작 회차(rank-params 의 첫 행)
  RECENT: 52,                            // 회차별 원자료를 두는 최근 회차 수
  CAL_MIN: 60,                           // base 의 a·b 보정에 필요한 최소 쌍 수(validate.calibrate 와 같다)
  TRAIN_MIN: 60,                         // 후보 적합에 필요한 최소 학습 회차 수
  HALF_LIFE: 156,                        // C1 지수 감쇠 반감기(회)
  BOUND_LO: 0.02, BOUND_HI: 0.98,        // 학습 구간(특징 자르기) 백분위
  M_FLOOR: 0.05,                         // 예측 배수 하한(로그 점수 보호)
  PREC: 12,                              // 얼린 파라미터 유효숫자
  PERM_B: 20000,                         // 부호 뒤집기 순열 횟수
  SALT_RECON: 0x50504C31, SALT_LIVE: 0x50504C32,
  ALPHA: 0.05, NCAND: 2,                 // 본페로니: p ≤ ALPHA / NCAND
  GATE_MIN: 52,                          // 관문에 필요한 live(done&&!late) 행 수
  CUTOFF_UTC_H: 11,                      // 마감 = 추첨일 11:00Z (= 20:00 KST)
  FT_CHECK_FROM: 262                     // 이 회차부터 firstType 합 = 1등 당첨자 수 점검
});
/* 규칙표 — 덧붙이기만 한다. 이미 쓴 행의 ver 로 옛 규칙이 남는다. 각 항목은 문자열에 대괄호를 쓰지 않는 순수 리터럴이어야 한다(검증기가 소스에서 꺼낸다). */
export const RULES = [
  { ver: 'pop-1', from: 1248,
    models: [
      { id: 'base', kind: 'z-calib', cal: 'a+b*z (rank-params rows[t], 단순회귀, 최소 60쌍)' },
      { id: 'C1', kind: 'wls-decay', target: 'm45', halfLife: 156, feats: 8 },
      { id: 'C2', kind: 'wls-pooled', target: 'mp', weight: 'sumE', feats: 8 }
    ],
    score: 'logsq-m45', gate: { minN: 52, alpha: 0.05, nCand: 2, perm: 'sign-flip' } }
];
export const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
const CANDS = ['C1', 'C2'];

/* ═════════════ 결정성 장치 ═════════════ */
export function m32(sd) {
  let a = sd >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (r, salt) => (Math.imul(r, 0x9E3779B1) ^ salt) >>> 0;
export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 127) throw new Error('fnv: ASCII only');
    h ^= c; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
const sig = (x, p) => { if (!Number.isFinite(x)) throw new Fail('유한하지 않은 수가 생겼습니다'); return Number(x.toPrecision(p)); };
const o6 = (x) => Number(x.toFixed(6));
const o10 = (x) => Number(x.toFixed(10));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ═════════════ 자료 ═════════════ */
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export function parseHistory(hist) {
  const list = Array.isArray(hist) ? hist : (hist && Array.isArray(hist.draws) ? hist.draws : null);
  if (!list) throw new Fail('이력 모양이 맞지 않습니다(draws 배열 없음)');
  const by = new Map();
  for (const x of list) {
    const r = x && x.round;
    if (!Number.isInteger(r) || r < 1 || by.has(r)) throw new Fail(`자료 형식 오류 ${r}회 — 회차가 정수가 아니거나 중복입니다`);
    by.set(r, x);
  }
  let latest = 0; for (const r of by.keys()) if (r > latest) latest = r;
  const D = [null];
  for (let r = 1; r <= latest; r++) {
    const x = by.get(r);
    if (!x) throw new Fail(`자료 구멍 ${r}회 — 1..latest 가 연속이 아니어서 계산하지 않습니다`);
    const n = Array.isArray(x.numbers) ? x.numbers.slice().sort((a, b) => a - b) : null;
    if (!n || n.length !== 6 || n.some((v, i) => !Number.isInteger(v) || v < 1 || v > 45 || (i > 0 && v === n[i - 1]))) throw new Fail(`자료 형식 오류 ${r}회 — 당첨번호 6개가 맞지 않습니다`);
    const wn = x.winners || {}, ft = x.firstType;
    D[r] = {
      r, n, date: typeof x.date === 'string' ? x.date : '', sales: numOrNull(x.sales),
      w: [wn.first, wn.second, wn.third, wn.fourth, wn.fifth].map(numOrNull),
      ft: ft && typeof ft === 'object' ? [numOrNull(ft.auto) || 0, numOrNull(ft.manual) || 0, numOrNull(ft.semi) || 0] : null
    };
  }
  return { D, latest };
}
export function sourceDigest(D, latest) {
  let s = '';
  for (let r = 1; r <= latest; r++) {
    const d = D[r];
    s += `${r}:${d.n.join(',')}|${d.sales == null ? '' : d.sales}|${d.w.map((v) => (v == null ? '' : v)).join(',')};`;
  }
  return fnv(s);
}
/* 최신 회차 필드 이상 — 이 회차로는 학습도 일지도 쓰지 않는다 */
export function latestAnomaly(d) {
  const why = [];
  if (!(d.sales > 0)) why.push('sales≤0');
  if (!(d.w[3] > 0)) why.push('w4≤0');
  if (!(d.w[4] > 0)) why.push('w5≤0');
  if (!/^\d{8}$/.test(d.date)) why.push('date 없음');
  if (d.r >= CONF.FT_CHECK_FROM) {
    const ft = d.ft || [0, 0, 0];
    if (ft[0] + ft[1] + ft[2] !== (d.w[0] == null ? 0 : d.w[0])) why.push('firstType 합≠1등 당첨자 수');
  }
  return why;
}

/* ═════════════ 특징·회귀 (index.html popFeat / wls 와 같은 식을 다시 구현) ═════════════ */
export function popFeat(n) {                                  // n: 오름차순 6개
  const s = n.reduce((a, b) => a + b, 0);
  let cons = 0; for (let i = 1; i < 6; i++) if (n[i] === n[i - 1] + 1) cons++;
  const ld = {}; n.forEach((x) => { ld[x % 10] = (ld[x % 10] || 0) + 1; });
  const sameLast = Object.values(ld).reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
  const dec = {}; n.forEach((x) => { dec[Math.floor((x - 1) / 10)] = 1; });
  return [1, n.filter((x) => x <= 31).length, n.filter((x) => x <= 12).length, (s - 138) / 30, cons, sameLast, (n[5] - n[0] - 33) / 8, Object.keys(dec).length];
}
/* 가중최소자승(가우스-조던, 부분 피벗). w 가 없으면 전부 1. 특이하면 null. predMean/predSD 는 학습 표본 위의 적합값 평균·모표준편차. */
export function wls(X, y, w) {
  const n = X.length, k = X[0].length;
  if (!w) w = new Array(n).fill(1);
  const M = Array.from({ length: k }, (_, i) => [...new Array(k).fill(0), ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  const XtY = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    for (let a = 0; a < k; a++) {
      XtY[a] += wi * X[i][a] * y[i];
      for (let b = 0; b < k; b++) M[a][b] += wi * X[i][a] * X[i][b];
    }
  }
  for (let c = 0; c < k; c++) {
    let pv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;
    const t = M[c]; M[c] = M[pv]; M[pv] = t;
    const d = M[c][c]; if (!d || !isFinite(d)) return null;
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const inv = M.map((r) => r.slice(k));
  const beta = inv.map((r) => r.reduce((a, v, j) => a + v * XtY[j], 0));
  const yh = X.map((x) => x.reduce((a, v, j) => a + v * beta[j], 0));
  const mu = yh.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(yh.reduce((a, b) => a + (b - mu) ** 2, 0) / n);
  return { beta, predMean: mu, predSD: sd || 1 };
}
/* 학습 구간 = 특징별 2~98 백분위(정렬 인덱스 floor(len·p)) */
export function boundsOf(X) {
  const k = X[0].length, out = [];
  for (let j = 0; j < k; j++) {
    const col = X.map((x) => x[j]).sort((a, b) => a - b);
    out.push([col[Math.floor(col.length * CONF.BOUND_LO)], col[Math.floor(col.length * CONF.BOUND_HI)]]);
  }
  return out;
}
/* Σ clamp(f_j)·beta_j — j=0 은 자르지 않는다(zOf·popModelZ 와 같은 순서) */
export function linPred(beta, f, bounds) {
  const useB = !!(bounds && bounds.length);
  let acc = 0;
  for (let j = 0; j < 8; j++) {
    let v = f[j];
    if (useB && j !== 0) v = Math.max(bounds[j][0], Math.min(bounds[j][1], v));
    acc = acc + v * beta[j];
  }
  return acc;
}
/* 지금 모형의 z — index.html zOf 와 같은 산술 순서: 표준화 A, 표준화 B 의 평균(B 없으면 A 만). 모형이 없으면 null. */
export function zBase(P, f) {
  const A = P && P.A; if (!A) return null;
  const B = P.B || null, b = P.bounds;
  const za = (linPred(A.beta, f, b) - A.predMean) / A.predSD;
  if (!B) return za;
  return (za + (linPred(B.beta, f, b) - B.predMean) / B.predSD) / 2;
}

/* ═════════════ 관측값 ═════════════ */
export function obsOf(d) {
  if (d.sales == null || !(d.sales > 0)) return { ok: false, why: 'sales 없음 또는 0' };
  if (d.w[3] == null || !(d.w[3] > 0)) return { ok: false, why: 'w4 없음 또는 0' };
  if (d.w[4] == null || !(d.w[4] > 0)) return { ok: false, why: 'w5 없음 또는 0' };
  const G = d.sales / CONF.TICKET, W = CONF.WAYS;
  const e = W.map((k) => G * k / CONF.C456);
  if (e[3] < CONF.E4_MIN) return { ok: false, why: 'e4 기준 미달' };
  const m45 = 0.5 * (d.w[3] / e[3]) + 0.5 * (d.w[4] / e[4]);
  const top3 = d.w[0] != null && d.w[1] != null && d.w[2] != null;
  const m123 = top3 ? (d.w[0] + d.w[1] + d.w[2]) / (e[0] + e[1] + e[2]) : null;
  let sw = 0, se = 0; for (let k = 0; k < 5; k++) { sw += d.w[k] == null ? 0 : d.w[k]; se += e[k]; }
  const mp = top3 ? sw / se : null;
  return { ok: true, m45, m123, mp, sumE: se };
}
/* 점수 — 로그 배수 제곱오차 */
export const lg = (pred, obs) => (Math.log(Math.max(pred, CONF.M_FLOOR)) - Math.log(obs)) ** 2;

/* ═════════════ 적합 ═════════════ */
/* 회차 t 의 후보 적합 — t 미만 회차만 쓴다(walk-forward). 학습 표본이 모자라면 null */
function fitCands(t, obs, feat) {
  const X = [], y1 = [], ss = [], X2 = [], y2 = [], se = [];
  for (let s = 1; s < t; s++) {
    const o = obs[s]; if (!o.ok) continue;
    X.push(feat[s]); y1.push(o.m45); ss.push(s);
    if (o.mp != null) { X2.push(feat[s]); y2.push(o.mp); se.push(o.sumE); }       // C2 는 1~3등 당첨자 수가 있는 회차만
  }
  if (X.length < CONF.TRAIN_MIN || X2.length < CONF.TRAIN_MIN) return null;
  const bounds = boundsOf(X);
  const w1 = ss.map((s) => Math.pow(0.5, (t - 1 - s) / CONF.HALF_LIFE));
  const m1 = mean(w1), mE = mean(se);
  const c0 = wls(X, y1, null);
  const c1 = wls(X, y1, w1.map((v) => v / m1));
  const c2 = wls(X2, y2, se.map((v) => v / mE));
  if (!c0 || !c1 || !c2) return null;
  return { n: X.length, bounds, c0, C1: c1.beta, C2: c2.beta };
}
/* base 의 a·b — s 가 FIRST..t-1 인 «그때그때 z» 와 m45 의 단순회귀(validate.calibrate 의 fit) */
function calibAt(t, zs, obs) {
  const zz = [], yy = [];
  for (let s = CONF.FIRST; s < t; s++) if (zs[s] != null && obs[s].ok) { zz.push(zs[s]); yy.push(obs[s].m45); }
  if (zz.length < CONF.CAL_MIN) return null;
  const mz = mean(zz), my = mean(yy);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < zz.length; i++) { const dz = zz[i] - mz; sxy += dz * (yy[i] - my); sxx += dz * dz; }
  if (!sxx) return null;
  const b = sxy / sxx;
  return { a: my - b * mz, b, n: zz.length };
}
const relDiff = (x, y) => Math.abs(x - y) / (Math.abs(y) + 1e-9);

/* 얼린 파라미터로 한 회차의 모형별 예측(저장 정밀도) */
export function predictAll(fit, nums) {
  const f = popFeat(nums);
  const z = zBase(fit.pop, f);
  if (z == null) throw new Fail('얼린 base 파라미터에 A 가 없습니다');
  const fl = (x) => Math.max(x, CONF.M_FLOOR);
  return {
    z,
    base: fl(fit.a + fit.b * z),
    C1: fl(linPred(fit.C1, f, fit.bd)),
    C2: fl(linPred(fit.C2, f, fit.bd))
  };
}

/* ═════════════ 부호 뒤집기 순열 p (한쪽: 후보가 더 나은 쪽) ═════════════ */
export function permP(d, seed, B) {
  let obsSum = 0; for (let i = 0; i < d.length; i++) obsSum += d[i];
  const rng = m32(seed); let cnt = 0;
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += rng() < 0.5 ? -d[i] : d[i];
    if (s <= obsSum + 1e-12) cnt++;
  }
  return (cnt + 1) / (B + 1);
}

/* ═════════════ 모든 회차의 기초 표(관측·특징·그때그때 z) ═════════════ */
function baseTables(D, latest, P) {
  const obs = [null], feat = [null], zs = [null];
  for (let r = 1; r <= latest; r++) {
    obs[r] = obsOf(D[r]); feat[r] = popFeat(D[r].n);
    zs[r] = r >= CONF.FIRST && P[r] ? zBase(P[r], feat[r]) : null;
  }
  return { obs, feat, zs };
}

/* ═════════════ 돌아보기(사후) 재현 ═════════════ */
function buildRecon(D, latest, P, T) {
  const { obs, feat, zs } = T;
  const rows = [], why = [];
  let refitN = 0, refitMax = 0, bdDiff = 0;
  for (let t = CONF.FIRST; t <= latest + 1; t++) {
    const fc = fitCands(t, obs, feat);
    /* 저장 파라미터 rows[t].pop.A 와 내 재적합(가중 없는 OLS)이 같은지 — 입력이 파라미터 생성 때와 같다는 표지 */
    if (fc && P[t] && P[t].A) {
      const A = P[t].A; refitN++;
      for (let j = 0; j < 8; j++) refitMax = Math.max(refitMax, relDiff(fc.c0.beta[j], A.beta[j]));
      refitMax = Math.max(refitMax, relDiff(fc.c0.predMean, A.predMean), relDiff(fc.c0.predSD, A.predSD));
      if (!P[t].bounds || !sameJSON(P[t].bounds, fc.bounds)) bdDiff++;
    }
    if (t > latest) break;
    if (!obs[t].ok) { why.push([t, obs[t].why]); continue; }
    if (obs[t].mp == null) { why.push([t, '1~3등 당첨자 수 없음']); continue; }
    if (!P[t] || !P[t].A) { why.push([t, 'rank-params 행 없음']); continue; }
    const cal = calibAt(t, zs, obs);
    if (!cal) { why.push([t, `보정 쌍 ${CONF.CAL_MIN} 미만`]); continue; }
    if (!fc) { why.push([t, `학습 회차 ${CONF.TRAIN_MIN} 미만`]); continue; }
    const z = zs[t], fl = (x) => Math.max(x, CONF.M_FLOOR);
    rows.push({
      t, z, m45: obs[t].m45, m123: obs[t].m123, mp: obs[t].mp,
      base: fl(cal.a + cal.b * z), C1: fl(linPred(fc.C1, feat[t], fc.bounds)), C2: fl(linPred(fc.C2, feat[t], fc.bounds))
    });
  }
  /* 건너뛴 회차는 같은 이유끼리 연속 구간으로 묶어 모두 적는다 */
  const skipped = [];
  for (const [t, w] of why) {
    const last = skipped[skipped.length - 1];
    if (last && last.why === w && last.to === t - 1) { last.to = t; last.n++; } else skipped.push({ from: t, to: t, n: 1, why: w });
  }
  const n = rows.length;
  const out = {
    from: CONF.FIRST, to: latest, evalFrom: n ? rows[0].t : null, n, skipped,
    baseRefit: { n: refitN, maxRel: refitN ? sig(refitMax, 3) : null, boundsDiff: bdDiff },
    err: null, cand: null, candMp: null, noise: null, recent: []
  };
  if (!n) return { recon: out, rows };
  const errs = (key, tgt) => rows.map((x) => lg(x[key], x[tgt]));
  const eb = errs('base', 'm45'), ebp = errs('base', 'mp');
  out.err = {}; out.cand = {}; out.candMp = {};
  out.err.base = { m45: sig(mean(eb), 9), mp: sig(mean(ebp), 9) };
  CANDS.forEach((c, ci) => {
    const ec = errs(c, 'm45'), ecp = errs(c, 'mp');
    out.err[c] = { m45: sig(mean(ec), 9), mp: sig(mean(ecp), 9) };
    const d = ec.map((v, i) => v - eb[i]), dp = ecp.map((v, i) => v - ebp[i]);
    const md = mean(d);
    out.cand[c] = {
      n, meanDiff: sig(md, 9), better: d.filter((v) => v < 0).length,
      p: sig(permP(d, seedOf(latest, CONF.SALT_RECON + ci), CONF.PERM_B), 6), dir: md < 0 ? 'better' : 'worse'
    };
    out.candMp[c] = { meanDiff: sig(mean(dp), 9), better: dp.filter((v) => v < 0).length };
  });
  const m123 = rows.filter((x) => x.m123 != null).map((x) => x.m123);
  out.noise = {
    m45: { mean: sig(mean(rows.map((x) => x.m45)), 9), sd: sig(sdev(rows.map((x) => x.m45)), 9) },
    m123: m123.length > 1 ? { n: m123.length, mean: sig(mean(m123), 9), sd: sig(sdev(m123), 9) } : null,
    mp: { mean: sig(mean(rows.map((x) => x.mp)), 9), sd: sig(sdev(rows.map((x) => x.mp)), 9) },
    predSd: { base: sig(sdev(rows.map((x) => x.base)), 9), C1: sig(sdev(rows.map((x) => x.C1)), 9), C2: sig(sdev(rows.map((x) => x.C2)), 9) }
  };
  out.recent = rows.slice(-CONF.RECENT).map((x) => ({
    t: x.t, z: o10(x.z), m45: o6(x.m45), m123: x.m123 == null ? null : o6(x.m123), mp: o6(x.mp), base: o6(x.base), C1: o6(x.C1), C2: o6(x.C2)
  }));
  return { recon: out, rows };
}

/* ═════════════ 사전 등록(얼리기) ═════════════ */
const roundPop = (pop) => {
  const m = (o) => o && { beta: o.beta.map((v) => sig(v, CONF.PREC)), predMean: sig(o.predMean, CONF.PREC), predSD: sig(o.predSD, CONF.PREC) };
  return { A: m(pop.A), B: m(pop.B), bounds: (pop.bounds || []).map((b) => [sig(b[0], CONF.PREC), sig(b[1], CONF.PREC)]) };
};
function freezeFit(t, P, T) {
  const { obs, feat, zs } = T;
  if (!P[t] || !P[t].A) throw new Fail(`rank-params 에 ${t}회 인기 모형 행이 없습니다 — 순위 추적이 먼저 돌아야 사전 등록을 할 수 있어 쓰지 않습니다`);
  const fc = fitCands(t, obs, feat), cal = calibAt(t, zs, obs);
  if (!fc) throw new Fail(`${t}회 후보 적합에 학습 회차가 모자랍니다`);
  if (!cal) throw new Fail(`${t}회 base 보정 쌍이 ${CONF.CAL_MIN} 미만입니다`);
  const r = (v) => sig(v, CONF.PREC);
  return {
    nTrain: fc.n, nCal: cal.n, a: r(cal.a), b: r(cal.b), pop: roundPop(P[t]),
    bd: fc.bounds.map((b) => [r(b[0]), r(b[1])]), C1: fc.C1.map(r), C2: fc.C2.map(r)
  };
}
/* 숫자는 상대 tol 안이면 같다고 보는 구조 비교 — 플랫폼의 Math.pow 마지막 비트 차이로 J4 경고가 울리지 않게 */
function closeVal(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol * (Math.abs(b) + 1e-12);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => closeVal(v, b[i], tol));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && closeVal(a[k], b[k], tol));
  }
  return a === b;
}

/* ═════════════ 일지 (J1~J6) ═════════════ */
const cutoffIso = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${String(CONF.CUTOFF_UTC_H).padStart(2, '0')}:00:00.000Z`;
function gradeFrozen(row, D, T) {
  const r = row.r, d = D[r], o = T.obs[r];
  if (!d || !row.fit || !row.fit.pop || !Array.isArray(row.fit.C1)) throw new Fail(`일지 r=${r} 행 형식이 맞지 않습니다(fit)`);
  if (!o.ok) return { skip: o.why };
  if (o.mp == null) return { skip: '1~3등 당첨자 수 없음' };
  const p = predictAll(row.fit, d.n);
  return {
    obs: { m45: o6(o.m45), m123: o.m123 == null ? null : o6(o.m123), mp: o6(o.mp) },
    pred: { base: o6(p.base), C1: o6(p.C1), C2: o6(p.C2) }
  };
}
function buildJournal(D, latest, T, P, prev, nowIso, log) {
  const old = prev ? prev.journal.rows : [];
  const pendMis = [], regrMis = [];
  let graded = 0, added = 0;
  const rows = [];
  for (const row of old) {
    /* J1 채점: r ≤ latest 인 pending → done (얼린 파라미터로) */
    if (row.status === 'pending' && row.r <= latest) {
      const drawDate = D[row.r].date;
      if (!/^\d{8}$/.test(drawDate)) throw new Fail(`일지 r=${row.r}: 이력에 추첨일(date)이 없어 마감 판정(늦음)을 할 수 없습니다`);
      const g = gradeFrozen(row, D, T);
      const late = row.made >= cutoffIso(drawDate);
      const done = Object.assign({}, row, { status: 'done', drawDate, late });
      if (g.skip) done.skip = g.skip; else { done.obs = g.obs; done.pred = g.pred; }
      done.gradedAt = nowIso;
      rows.push(done); graded++;
      continue;
    }
    rows.push(row);
  }
  /* J5 재채점 대조: 이미 done 이던 행만. 다르면 경고만, 처음 값 유지 */
  old.forEach((row) => {
    if (row.status !== 'done') return;
    try {
      const g = gradeFrozen(row, D, T), diffs = [];
      if (g.skip) { if (row.skip !== g.skip) diffs.push(`skip ${row.skip}→${g.skip}`); }
      else if (row.skip || !row.obs || !row.pred) diffs.push('obs/pred 없음→있음');
      else {
        for (const k of ['m45', 'm123', 'mp']) if (!closeVal(row.obs[k], g.obs[k], 2e-6)) diffs.push(`obs.${k} ${row.obs[k]}→${g.obs[k]}`);
        for (const k of ['base', 'C1', 'C2']) if (!closeVal(row.pred[k], g.pred[k], 2e-6)) diffs.push(`pred.${k} ${row.pred[k]}→${g.pred[k]}`);
      }
      if (diffs.length) { regrMis.push(`r=${row.r} ${diffs[0]}`); if (regrMis.length <= WARN_MAX) log.warn(`J5 재채점이 처음 채점과 다름 r=${row.r}: ${diffs.join(' / ')} — 기존 값을 유지합니다`); }
    } catch (e) {
      if (e instanceof Fail) throw e;
      regrMis.push(`r=${row.r} 채점 불가`); if (regrMis.length <= WARN_MAX) log.warn(`J5 r=${row.r} 재채점 실패: ${e.message}`);
    }
  });
  if (regrMis.length > WARN_MAX) log.warn(`J5 재채점 불일치 ${regrMis.length}건 중 ${WARN_MAX}건만 위에 적었습니다 — 모두 처음 값을 유지합니다`);
  /* J2 빠진 주 */
  const missed = prev ? prev.journal.missed.slice() : [];
  const lastR = rows.reduce((m, x) => Math.max(m, x.r), 0);
  for (let r = Math.max(lastR + 1, 1); r <= latest; r++) if (rows.length && !missed.includes(r) && !rows.some((x) => x.r === r)) missed.push(r);
  /* J3 새 제시 / J4 동결 */
  const t = latest + 1, inputDigest = sourceDigest(D, latest), have = rows.find((x) => x.r === t);
  let fit = null;
  try { fit = freezeFit(t, P, T); }
  catch (e) {
    if (!(e instanceof Fail) || !have) throw e;               // 새로 얼려야 하면 실패(쓰기 없음). 이미 얼린 행이 있으면 대조만 건너뛴다
    log.warn(`J4 대조를 건너뜁니다 r=${t}: ${e.message}`);
  }
  const fresh = fit && { r: t, ver: ruleFor(t).ver, status: 'pending', made: nowIso, basedOn: latest, inputDigest, fit };
  if (!have) { rows.push(fresh); added++; }
  else if (fresh && have.status === 'pending' && have.ver === fresh.ver) {
    const diffs = [];
    if (have.basedOn !== fresh.basedOn) diffs.push('basedOn');
    if (have.inputDigest !== fresh.inputDigest) diffs.push('inputDigest');
    for (const k of Object.keys(fresh.fit)) if (!closeVal(have.fit && have.fit[k], fresh.fit[k], 1e-8)) diffs.push('fit.' + k);
    if (diffs.length) { pendMis.push(`r=${t} ${diffs.join(',')}`); log.warn(`J4 얼린 파라미터가 지금 재계산과 다름 r=${t}: ${diffs.join(',')} — 처음 공개한 값을 유지합니다`); }
  }
  const from = prev ? prev.journal.from : t;                 // J6: 처음 값 고정
  return { journal: { from, missed, rows }, checks: { kept: old.length - graded, added, graded, pendingMismatch: pendMis, regradeMismatch: regrMis } };
}

/* ═════════════ 관문 (live 행만) ═════════════ */
function buildGate(rows, recon) {
  const live = rows.filter((x) => x.status === 'done' && x.late === false && x.obs && x.pred);
  const n = live.length;
  const thr = CONF.ALPHA / CONF.NCAND;
  const g = {
    minN: CONF.GATE_MIN, alpha: CONF.ALPHA, nCand: CONF.NCAND, thr,
    n, late: rows.filter((x) => x.status === 'done' && x.late === true).length, skip: rows.filter((x) => x.status === 'done' && x.skip).length,
    status: 'collecting', cands: {}, adopt: []
  };
  const lastR = n ? live[n - 1].r : 0;
  CANDS.forEach((c, ci) => {
    const e = {};
    if (n) {
      const d = live.map((x) => lg(x.pred[c], x.obs.m45) - lg(x.pred.base, x.obs.m45));
      let md = 0; for (const v of d) md += v; md = md / n;
      e.n = n; e.meanDiff = sig(md, 9); e.better = d.filter((v) => v < 0).length;
      e.p = n >= CONF.GATE_MIN ? sig(permP(d, seedOf(lastR, CONF.SALT_LIVE + ci), CONF.PERM_B), 6) : null;
    } else { e.n = 0; e.meanDiff = null; e.better = 0; e.p = null; }
    const rc = recon && recon.cand && recon.cand[c];
    e.reconDir = rc ? rc.dir : null;
    e.ok = !!(n >= CONF.GATE_MIN && e.p != null && e.p <= thr && e.meanDiff < 0 && rc && rc.dir === 'better');
    if (e.ok) g.adopt.push(c);
    g.cands[c] = e;
  });
  g.status = n < CONF.GATE_MIN ? 'collecting' : (g.adopt.length ? 'adopt' : 'none');
  return g;
}

/* ═════════════ 직렬화 — 키 순서는 만든 순서, rows 는 한 줄에 한 행 ═════════════ */
const ROW_PATHS = new Set(['recon.recent', 'journal.rows']);
function ser(v, depth, p) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const pad = (n) => '  '.repeat(n);
  if (Array.isArray(v) && ROW_PATHS.has(p)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => pad(depth + 1) + JSON.stringify(x)).join(',\n') + '\n' + pad(depth) + ']';
  }
  if (!Array.isArray(v) && depth < 2) {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{\n' + ks.map((k) => pad(depth + 1) + JSON.stringify(k) + ': ' + ser(v[k], depth + 1, p ? p + '.' + k : k)).join(',\n') + '\n' + pad(depth) + '}';
  }
  return JSON.stringify(v);
}

/* 기존 out 검증 — 일지를 이어 쓸 수 있는 모양이 아니면 건드리지 않고 실패한다 */
function readPrev(outPath) {
  if (!fs.existsSync(outPath)) return null;
  let text; try { text = fs.readFileSync(outPath, 'utf8'); } catch (e) { throw new Fail(`기존 ${outPath} 를 읽을 수 없어 덮어쓰지 않습니다: ${e.message}`); }
  let j; try { j = JSON.parse(text); } catch (e) { throw new Fail(`기존 ${outPath} 가 JSON 이 아니라 덮어쓰지 않습니다(일지 보호): ${e.message}`); }
  const jr = j && j.journal;
  if (!j || j.kind !== 'pop-learn-lotto' || !jr || !Array.isArray(jr.rows) || !Array.isArray(jr.missed) || !Number.isInteger(jr.from) || !jr.rows.length) {
    throw new Fail(`기존 ${outPath} 의 모양이 당첨금 학습 장부(pop-learn-lotto)가 아니라 덮어쓰지 않습니다`);
  }
  let pr = 0;
  for (const r of jr.rows) {
    if (!r || !Number.isInteger(r.r) || r.r <= pr || (r.status !== 'pending' && r.status !== 'done')) throw new Fail(`기존 일지 행 r=${r && r.r} 이 오름차순·유일·상태(pending/done)가 아니라 덮어쓰지 않습니다`);
    if (!RULES.some((u) => u.ver === r.ver)) throw new Fail(`기존 일지 행 r=${r.r} 의 규칙 ${r.ver} 을 모릅니다(RULES 에 없음) — 덮어쓰지 않습니다`);
    pr = r.r;
  }
  return j;
}
function readParams(p) {
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Fail(`순위 파라미터 ${p} 를 읽을 수 없거나 JSON 이 아닙니다: ${e.message}`); }
  if (!j || typeof j.rows !== 'object' || j.rows === null) throw new Fail(`순위 파라미터 ${p} 에 rows 가 없습니다`);
  const P = [];
  let first = 0, last = 0, count = 0;
  for (const k of Object.keys(j.rows)) {
    const t = Number(k); if (!Number.isInteger(t)) continue;
    const pop = j.rows[k] && j.rows[k].pop;
    if (pop && pop.A && Array.isArray(pop.A.beta) && pop.A.beta.length === 8) {
      P[t] = pop; count++; if (!first || t < first) first = t; if (t > last) last = t;
    }
  }
  return { P, first, last, count };
}

/* 시험용 --now. Date 는 이 함수에만 있다(generated·made·gradedAt 기록용) */
function resolveNow(opt) {
  if (opt == null) return new Date().toISOString();                                   // DATE_OK
  const ms = Date.parse(opt);                                                         // DATE_OK
  if (!Number.isFinite(ms)) throw new Fail(`--now ${opt} 가 ISO 시각이 아닙니다`);
  return new Date(ms).toISOString();                                                  // DATE_OK
}

const state = { wrote: false };                              // finally 에서 $GITHUB_OUTPUT 으로 내보낸다
function parseArgs(argv) {
  const o = { root: '.', history: 'lotto-history.json', params: 'brief/rank-params-lotto.json', out: 'brief/pop-learn-lotto.json', now: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Fail(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break;
      case '--history': o.history = need(); break;
      case '--params': o.params = need(); break;
      case '--out': o.out = need(); break;
      case '--now': o.now = need(); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Fail('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}

/* ═════════════ 본체 ═════════════ */
function main() {
  const t00 = performance.now();
  const log = { warn: (m) => console.log(`::warning title=${TITLE}::${esc(m)}`), info: (m) => console.log(`${TITLE}: ${m}`) };
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log('사용: node scripts/pop-learn.mjs --history lotto-history.json --params brief/rank-params-lotto.json --out brief/pop-learn-lotto.json [--root .] [--now ISO]'); return; }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), paramsPath = res(opt.params), outPath = res(opt.out);
  const nowIso = resolveNow(opt.now);

  /* 1 이력 — 구멍·형식 오류면 exit 1, 출력은 건드리지 않는다 */
  let hist; try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { throw new Fail(`이력 ${histPath} 를 읽을 수 없거나 JSON 이 아닙니다: ${e.message}`); }
  const { D, latest } = parseHistory(hist);
  if (latest < CONF.FIRST + CONF.CAL_MIN) throw new Fail(`이력이 ${latest}회까지뿐이라 계산하지 않습니다`);
  /* 2 최신 회차 이상 — 그 회차로 학습·일지를 쓰지 않는다 */
  const bad = latestAnomaly(D[latest]);
  if (bad.length) { log.warn(`최신 ${latest}회 필드 이상(${bad.join(', ')}) — 이 회차로 학습·일지를 쓰지 않습니다(파일을 쓰지 않음)`); return; }
  /* 3 기존 out · 역행 가드 */
  const prev = readPrev(outPath);
  if (prev) {
    const doneMax = prev.journal.rows.reduce((m, x) => (x.status === 'done' ? Math.max(m, x.r) : m), 0);
    const pendMax = prev.journal.rows.reduce((m, x) => (x.status === 'pending' ? Math.max(m, x.r) : m), 0);
    if (latest < doneMax || pendMax > latest + 1) {
      log.warn(`역행 가드: 이력 latest ${latest} 가 기존 일지(채점 완료 ${doneMax ? '최대 ' + doneMax + '회' : '없음'}, 대기 ${pendMax ? pendMax + '회' : '없음'})보다 뒤처졌습니다 — 파일을 쓰지 않습니다`);
      return;
    }
  }
  const { P, first: pFirst, last: pLast, count: pCount } = readParams(paramsPath);
  const T = baseTables(D, latest, P);
  const lap = {}; let tk = performance.now(); const tick = (k) => { const n = performance.now(); lap[k] = Math.round(n - tk); tk = n; };
  tick('load');

  /* 4 돌아보기(사후) 재현 */
  const { recon } = buildRecon(D, latest, P, T);
  tick('recon');
  if (recon.baseRefit.maxRel != null && recon.baseRefit.maxRel > 1e-6) log.warn(`기본 모형 재적합이 저장 파라미터와 다릅니다(최대 상대차 ${recon.baseRefit.maxRel}) — 입력 이력이 파라미터를 만들 때와 달라졌을 수 있습니다`);
  /* 5 일지 · 관문 */
  const { journal, checks } = buildJournal(D, latest, T, P, prev, nowIso, log);
  const gate = buildGate(journal.rows, recon);
  tick('journal');

  const out = {
    v: 1, kind: 'pop-learn-lotto', ver: VER, generated: nowIso,
    source: { file: path.basename(histPath), latest, count: latest, digest: sourceDigest(D, latest), params: { file: path.basename(paramsPath), first: pFirst, last: pLast, count: pCount } },
    conf: JSON.parse(JSON.stringify(CONF)), rules: JSON.parse(JSON.stringify(RULES)),
    recon, gate, journal, checks
  };
  /* 6 쓰기 — 되읽어 확인 · 크기 확인 · 임시 파일 → rename */
  const text = ser(out, 0, '') + '\n';
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(out)) throw new Fail('직렬화 점검 실패(되읽은 값이 원본과 다름) — 쓰지 않습니다');
  const bytes = Buffer.byteLength(text);
  if (bytes >= MAX_BYTES) throw new Fail(`산출 크기 ${bytes}바이트 ≥ 1MB (CLAUDE.md 규칙 4) — 쓰지 않습니다`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, outPath); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* 임시 파일이 없으면 그만 */ } throw new Fail(`쓰기 실패: ${e.message}`); }
  state.wrote = true;
  tick('write');

  /* 7 알림 */
  const lateN = journal.rows.filter((x) => x.late === true).length;
  log.info(`${(performance.now() - t00) | 0}ms (읽기 ${lap.load} · 재현 ${lap.recon} · 일지 ${lap.journal} · 쓰기 ${lap.write}) · ${bytes}바이트 → ${outPath}`);
  console.log(`::notice title=당첨금 학습::${esc(`${latest + 1}회 사전 등록 · 재현 ${recon.n}회(${recon.evalFrom}~${latest}) · 일지 ${journal.rows.length}행(늦음 ${lateN}) · 추가 ${checks.added} · 채점 ${checks.graded} · 관문 ${gate.n}/${gate.minN}`)}`);
  if (gate.status === 'adopt') console.log(`::notice title=당첨금 학습 채택 조건::${esc(`${gate.adopt.join(', ')} 채택 조건 충족(live ${gate.n}회) — 추천 반영은 소유자 결정입니다(코드는 자동으로 바뀌지 않음)`)}`);
  else if (gate.status === 'none') console.log(`::notice title=당첨금 학습::${esc(`채택 없음(live ${gate.n}회)`)}`);
}

/* $GITHUB_OUTPUT 은 어떤 경로로 끝나든 한 번 쓴다 */
function emitOutput() {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, `wrote=${state.wrote ? 'true' : 'false'}\n`); }
  catch (e) { console.log(`::warning title=${TITLE}::GITHUB_OUTPUT 에 쓸 수 없음: ${esc(e.message)}`); }
}

const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } })();
if (isMain) {
  try { main(); }
  catch (e) {
    if (e instanceof Fail) {
      console.log(`::error title=${TITLE}::${esc(e.message)}`);
      console.error(`${TITLE}: ${e.message}`);
    } else {
      console.log(`::error title=${TITLE}::${esc('예기치 않은 오류: ' + (e && e.message))}`);
      console.error(e && e.stack ? e.stack : String(e));
    }
    process.exitCode = 1;
  }
  emitOutput();
}
