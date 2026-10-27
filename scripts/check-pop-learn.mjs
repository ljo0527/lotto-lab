#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-pop-learn.mjs — 당첨금 학습 장부(brief/pop-learn-lotto.json) 독립 재계산 검사기

   원칙(CLAUDE.md 규칙 10) — 이 파일은 docs/pop-learn.md 의 규격만 보고 쓴 «독립 구현»이다.
     · scripts/pop-learn.mjs · index.html · rank-core.js 를 가져오지(import) 않고 계산에도 쓰지 않는다.
       특징·회귀(Householder QR)·보정·돌아보기·관문·순열 p·지문을 이 파일 안에서 다시 만든다.
       생성기는 가우스-조던 + 직접 z 식, 여기는 QR + (직접 식 · 특징 코드 표) 두 가지라서 같은 값이 나오면 구현이 서로를 확인해 준다.
     · 읽기 전용. 종료 코드 0(통과)/1(실패). 실패는 `::error title=check-pop-learn::…` 한 줄씩.
     · 소스 텍스트로만 읽는 것: scripts/pop-learn.mjs(RULES 접두·Math.random·Date 점검), docs/pop-learn.md(필수 문구·금지 문구).

   사용
     node scripts/check-pop-learn.mjs --root . --file brief/pop-learn-lotto.json --history lotto-history.json
          [--params brief/rank-params-lotto.json] [--prev-git HEAD] [--prev <이전 JSON 경로>] [--only C2,C3] [--skip C7]
     --prev-git  HEAD 의 같은 경로 파일과 대조(append-only). 파일이 HEAD 에 없거나 git 이 없으면 건너뛴다.
     --prev      이전 JSON 파일을 직접 준다(시험·추적 밖 경로용).

   검사 표  C0 구조·규칙표·크기 · C1 입력(이력·지문) · C2 돌아보기 재계산 · C3 z 두 구현 대조(표본 3회차, 상대 1e-9) ·
            C4 일지 구조·얼린 파라미터 재계산 · C5 채점(관측·예측·늦음) · C6 관문 · C7 append-only · C8 문구·결정성 표지
   경고만 내는 것(이유): 오래된 행의 얼린 파라미터가 지금 이력으로 다시 계산한 값과 다름 — 일지는 «처음 공개한 값 동결» 이 원칙이라
     이력이 사후 정정된 경우일 수 있다(J4). 단 이번 실행에서 만든 행(made = generated)이 다르면 생성기 결함이라 오류다.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TITLE = 'check-pop-learn';
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const FORBID = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;

/* ───────── 규격 상수 (docs/pop-learn.md §3 — 생성기의 CONF 와 따로 적은 사본) ───────── */
const EXPECT_CONF = {
  WAYS: [1, 6, 228, 11115, 182780], C456: 8145060, TICKET: 1000, E4_MIN: 200, FIRST: 1000, RECENT: 52, CAL_MIN: 60, TRAIN_MIN: 60,
  HALF_LIFE: 156, BOUND_LO: 0.02, BOUND_HI: 0.98, M_FLOOR: 0.05, PREC: 12, PERM_B: 20000, SALT_RECON: 0x50504C31, SALT_LIVE: 0x50504C32,
  ALPHA: 0.05, NCAND: 2, GATE_MIN: 52, CUTOFF_UTC_H: 11, FT_CHECK_FROM: 262
};
const EXPECT_RULES = [
  { ver: 'pop-1', from: 1248,
    models: [
      { id: 'base', kind: 'z-calib', cal: 'a+b*z (rank-params rows[t], 단순회귀, 최소 60쌍)' },
      { id: 'C1', kind: 'wls-decay', target: 'm45', halfLife: 156, feats: 8 },
      { id: 'C2', kind: 'wls-pooled', target: 'mp', weight: 'sumE', feats: 8 }
    ],
    score: 'logsq-m45', gate: { minN: 52, alpha: 0.05, nCand: 2, perm: 'sign-flip' } }
];
const CF = EXPECT_CONF;
const ruleVer = (r) => { let x = EXPECT_RULES[0]; for (const u of EXPECT_RULES) if (u.from <= r) x = u; return x.ver; };
const TOP_KEYS = ['v', 'kind', 'ver', 'generated', 'source', 'conf', 'rules', 'recon', 'gate', 'journal', 'checks'];
const MAX_BYTES = 1000000;
const CANDS = ['C1', 'C2'];

/* ───────── 결과 모음 ───────── */
const R = { items: [] };
let cur = null;
const err = (m) => cur.errors.push(m), wrn = (m) => cur.warnings.push(m), note = (m) => cur.notices.push(m);
function runCheck(id, title, opt, fn) {
  const it = { id, title, errors: [], warnings: [], notices: [], ms: 0, skipped: false };
  R.items.push(it);
  const sel = (opt.only && !opt.only.includes(id)) || (opt.skip && opt.skip.includes(id));
  if (sel) { it.skipped = true; return; }
  cur = it; const t0 = performance.now();
  try { fn(); } catch (e) { it.errors.push('검사 중 예외: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  it.ms = performance.now() - t0;
}
function skipCheck(id, title, why) { R.items.push({ id, title, errors: [], warnings: [], notices: [why], ms: 0, skipped: true }); }
const near = (a, b, abs, rel) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= abs + rel * Math.abs(b);
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ───────── 결정성 장치 (§3.1) ───────── */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedFor = (r, salt) => (Math.imul(r, 0x9E3779B1) ^ salt) >>> 0;
function fnv32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
function signFlipP(d, seed) {
  let tot = 0; for (const v of d) tot += v;
  const rng = mulberry(seed); let c = 0;
  for (let b = 0; b < CF.PERM_B; b++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += (rng() < 0.5) ? -d[i] : d[i];
    if (s <= tot + 1e-12) c++;
  }
  return (c + 1) / (CF.PERM_B + 1);
}

/* ───────── 이력 (§2) ───────── */
function loadHistory(j) {
  const probs = [];
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.draws) ? j.draws : null);
  if (!list) return { probs: ['draws 배열 없음'], D: [], latest: 0 };
  const by = new Map();
  for (const x of list) { if (!x || !Number.isInteger(x.round) || x.round < 1 || by.has(x.round)) { probs.push(`회차 오류 ${x && x.round}`); continue; } by.set(x.round, x); }
  let latest = 0; for (const r of by.keys()) latest = Math.max(latest, r);
  const D = [null];
  for (let r = 1; r <= latest; r++) {
    const x = by.get(r);
    if (!x) { probs.push(`구멍 ${r}회`); D[r] = null; continue; }
    const n = (x.numbers || []).slice().sort((p, q) => p - q);
    const okN = n.length === 6 && n.every((v, i) => Number.isInteger(v) && v >= 1 && v <= 45 && (i === 0 || v > n[i - 1]));
    if (!okN) probs.push(`번호 오류 ${r}회`);
    const wn = x.winners || {}, ft = x.firstType;
    const nn = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    D[r] = { r, n, date: typeof x.date === 'string' ? x.date : '', sales: nn(x.sales), w: [wn.first, wn.second, wn.third, wn.fourth, wn.fifth].map(nn), ft: ft && typeof ft === 'object' ? [nn(ft.auto) || 0, nn(ft.manual) || 0, nn(ft.semi) || 0] : null };
  }
  return { probs, D, latest };
}
function digestOf(D, upto) {
  const parts = [];
  for (let r = 1; r <= upto; r++) {
    const d = D[r];
    parts.push(r + ':' + d.n.join(',') + '|' + (d.sales === null ? '' : d.sales) + '|' + d.w.map((v) => (v === null ? '' : v)).join(',') + ';');
  }
  return fnv32(parts.join(''));
}

/* ───────── 특징 (§3.2) — 마지막 숫자 중복은 «6 − 서로 다른 끝자리 수» 로 센다 ───────── */
function feats(n) {
  let s = 0, c31 = 0, c12 = 0, cons = 0;
  const last = new Set(), dec = new Set();
  n.forEach((v, i) => {
    s += v; if (v <= 31) c31++; if (v <= 12) c12++;
    if (i > 0 && v - n[i - 1] === 1) cons++;
    last.add(v % 10); dec.add(Math.floor((v - 1) / 10));
  });
  return [1, c31, c12, (s - 138) / 30, cons, 6 - last.size, (n[5] - n[0] - 33) / 8, dec.size];
}
/* check-rank 의 zMaker 와 같은 방식: 특징을 정수 코드로 묶고(c31|c12<<3|합<<6|연속<<14|끝수<<17|범위<<20|구간<<26) 표를 더한다 */
function featCode(n) {
  const f = feats(n);
  return f[1] | (f[2] << 3) | ((n.reduce((a, b) => a + b, 0)) << 6) | (f[4] << 14) | (f[5] << 17) | ((n[5] - n[0]) << 20) | (f[7] << 26);
}
function zByTable(P, n) {
  const A = P.A, B = P.B || null, bd = P.bounds && P.bounds.length ? P.bounds : null;
  const cl = (j, v) => (j === 0 || !bd) ? v : Math.max(bd[j][0], Math.min(bd[j][1], v));
  const lin = (M, x) => {
    let acc = 0;
    acc = acc + cl(0, 1) * M.beta[0];
    acc = acc + cl(1, x & 7) * M.beta[1];
    acc = acc + cl(2, (x >>> 3) & 7) * M.beta[2];
    acc = acc + cl(3, (((x >>> 6) & 255) - 138) / 30) * M.beta[3];
    acc = acc + cl(4, (x >>> 14) & 7) * M.beta[4];
    acc = acc + cl(5, (x >>> 17) & 7) * M.beta[5];
    acc = acc + cl(6, (((x >>> 20) & 63) - 33) / 8) * M.beta[6];
    acc = acc + cl(7, (x >>> 26) & 7) * M.beta[7];
    return acc;
  };
  const x = featCode(n), za = (lin(A, x) - A.predMean) / A.predSD;
  return B ? (za + (lin(B, x) - B.predMean) / B.predSD) / 2 : za;
}
function zDirect(P, n) {
  const f = feats(n), bd = P.bounds && P.bounds.length ? P.bounds : null;
  const sc = (M) => { let a = 0; for (let j = 0; j < 8; j++) { const v = (j > 0 && bd) ? Math.min(bd[j][1], Math.max(bd[j][0], f[j])) : f[j]; a = a + v * M.beta[j]; } return a; };
  const za = (sc(P.A) - P.A.predMean) / P.A.predSD;
  return P.B ? (za + (sc(P.B) - P.B.predMean) / P.B.predSD) / 2 : za;
}

/* ───────── 가중최소자승 — Householder QR (§3.3) ───────── */
function wlsQR(X, y, w) {
  const n = X.length, k = X[0].length;
  const A = X.map((row, i) => { const s = Math.sqrt(w ? w[i] : 1); return row.map((v) => v * s); });
  const b = y.map((v, i) => v * Math.sqrt(w ? w[i] : 1));
  for (let j = 0; j < k; j++) {
    let nrm = 0; for (let i = j; i < n; i++) nrm += A[i][j] * A[i][j];
    nrm = Math.sqrt(nrm); if (!nrm) return null;
    const alpha = A[j][j] > 0 ? -nrm : nrm;
    const v = new Array(n).fill(0);
    for (let i = j; i < n; i++) v[i] = A[i][j];
    v[j] -= alpha;
    let vv = 0; for (let i = j; i < n; i++) vv += v[i] * v[i];
    if (!vv) continue;
    for (let c = j; c < k; c++) {
      let dot = 0; for (let i = j; i < n; i++) dot += v[i] * A[i][c];
      const f = 2 * dot / vv; for (let i = j; i < n; i++) A[i][c] -= f * v[i];
    }
    let dot = 0; for (let i = j; i < n; i++) dot += v[i] * b[i];
    const f = 2 * dot / vv; for (let i = j; i < n; i++) b[i] -= f * v[i];
  }
  const beta = new Array(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    let s = b[j]; for (let c = j + 1; c < k; c++) s -= A[j][c] * beta[c];
    if (!A[j][j]) return null;
    beta[j] = s / A[j][j];
  }
  return beta;
}
const dotp = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function pctBounds(X) {
  const out = [];
  for (let j = 0; j < 8; j++) {
    const c = X.map((x) => x[j]).sort((p, q) => p - q), L = c.length;
    out.push([c[Math.floor(L * CF.BOUND_LO)], c[Math.floor(L * CF.BOUND_HI)]]);
  }
  return out;
}
const clampF = (f, bd) => f.map((v, j) => (j === 0 ? v : Math.min(bd[j][1], Math.max(bd[j][0], v))));

/* ───────── 관측값 (§3.2) ───────── */
function observe(d) {
  if (d.sales === null || !(d.sales > 0)) return { why: 'sales 없음 또는 0' };
  if (d.w[3] === null || !(d.w[3] > 0)) return { why: 'w4 없음 또는 0' };
  if (d.w[4] === null || !(d.w[4] > 0)) return { why: 'w5 없음 또는 0' };
  const G = d.sales / CF.TICKET, e = CF.WAYS.map((k) => G * k / CF.C456);
  if (e[3] < CF.E4_MIN) return { why: 'e4 기준 미달' };
  const m45 = (d.w[3] / e[3] + d.w[4] / e[4]) / 2;
  const t3 = d.w[0] !== null && d.w[1] !== null && d.w[2] !== null;
  const sumE = e[0] + e[1] + e[2] + e[3] + e[4];
  return {
    m45, sumE, m123: t3 ? (d.w[0] + d.w[1] + d.w[2]) / (e[0] + e[1] + e[2]) : null,
    mp: t3 ? (d.w[0] + d.w[1] + d.w[2] + d.w[3] + d.w[4]) / sumE : null
  };
}
const logsq = (pred, obs) => { const p = Math.max(pred, CF.M_FLOOR); return (Math.log(p) - Math.log(obs)) * (Math.log(p) - Math.log(obs)); };

/* ───────── 모형 한 회차 t 의 적합 (t 미만 회차만) ───────── */
function makeModel(H, PR) {
  const L = H.latest, ob = [null], ft = [null], zs = [null];
  for (let r = 1; r <= L; r++) {
    ob[r] = observe(H.D[r]); ft[r] = feats(H.D[r].n);
    zs[r] = (r >= CF.FIRST && PR.P[r]) ? zDirect(PR.P[r], H.D[r].n) : null;
  }
  const fitAt = (t) => {
    const X = [], y1 = [], ss = [], X2 = [], y2 = [], we = [];
    for (let s = 1; s < t; s++) {
      if (ob[s].why) continue;
      X.push(ft[s]); y1.push(ob[s].m45); ss.push(s);
      if (ob[s].mp !== null) { X2.push(ft[s]); y2.push(ob[s].mp); we.push(ob[s].sumE); }
    }
    if (X.length < CF.TRAIN_MIN || X2.length < CF.TRAIN_MIN) return null;
    const c0 = wlsQR(X, y1, null);
    const c1 = wlsQR(X, y1, ss.map((s) => Math.pow(0.5, (t - 1 - s) / CF.HALF_LIFE)));
    const c2 = wlsQR(X2, y2, we);
    if (!c0 || !c1 || !c2) return null;
    const yh = X.map((x) => dotp(x, c0)), mu = yh.reduce((a, b) => a + b, 0) / yh.length;
    const sd = Math.sqrt(yh.reduce((a, b) => a + (b - mu) * (b - mu), 0) / yh.length);
    return { n: X.length, bd: pctBounds(X), C0: { beta: c0, predMean: mu, predSD: sd }, C1: c1, C2: c2 };
  };
  const calAt = (t) => {
    const z = [], y = [];
    for (let s = CF.FIRST; s < t; s++) if (zs[s] !== null && !ob[s].why) { z.push(zs[s]); y.push(ob[s].m45); }
    if (z.length < CF.CAL_MIN) return null;
    const mz = z.reduce((a, b) => a + b, 0) / z.length, my = y.reduce((a, b) => a + b, 0) / y.length;
    let sxy = 0, sxx = 0; for (let i = 0; i < z.length; i++) { sxy += (z[i] - mz) * (y[i] - my); sxx += (z[i] - mz) * (z[i] - mz); }
    if (!sxx) return null;
    return { a: my - (sxy / sxx) * mz, b: sxy / sxx, n: z.length };
  };
  return { ob, ft, zs, fitAt, calAt };
}

/* ───────── C2 돌아보기 재계산 (§3.5) ───────── */
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
function reconOwn(H, PR, M) {
  const L = H.latest, rows = [], why = [];
  let refN = 0, refMax = 0, bdDiff = 0;
  const rel = (x, y) => Math.abs(x - y) / (Math.abs(y) + 1e-9);
  for (let t = CF.FIRST; t <= L + 1; t++) {
    const fc = M.fitAt(t);
    if (fc && PR.P[t]) {
      refN++;
      for (let j = 0; j < 8; j++) refMax = Math.max(refMax, rel(fc.C0.beta[j], PR.P[t].A.beta[j]));
      refMax = Math.max(refMax, rel(fc.C0.predMean, PR.P[t].A.predMean), rel(fc.C0.predSD, PR.P[t].A.predSD));
      if (!jeq(PR.P[t].bounds, fc.bd)) bdDiff++;
    }
    if (t > L) break;
    const o = M.ob[t];
    if (o.why) { why.push([t, o.why]); continue; }
    if (o.mp === null) { why.push([t, '1~3등 당첨자 수 없음']); continue; }
    if (!PR.P[t]) { why.push([t, 'rank-params 행 없음']); continue; }
    const cal = M.calAt(t);
    if (!cal) { why.push([t, `보정 쌍 ${CF.CAL_MIN} 미만`]); continue; }
    if (!fc) { why.push([t, `학습 회차 ${CF.TRAIN_MIN} 미만`]); continue; }
    const f = M.ft[t], fl = (x) => Math.max(x, CF.M_FLOOR);
    rows.push({ t, z: M.zs[t], m45: o.m45, m123: o.m123, mp: o.mp, base: fl(cal.a + cal.b * M.zs[t]), C1: fl(dotp(clampF(f, fc.bd), fc.C1)), C2: fl(dotp(clampF(f, fc.bd), fc.C2)) });
  }
  const skipped = [];
  for (const [t, w] of why) { const l = skipped[skipped.length - 1]; if (l && l.why === w && l.to === t - 1) { l.to = t; l.n++; } else skipped.push({ from: t, to: t, n: 1, why: w }); }
  return { rows, skipped, refN, refMax, bdDiff };
}
function checkRecon(J, H, PR, M, st) {
  const X = st.recon = reconOwn(H, PR, M), RC = J.recon;
  if (!RC || typeof RC !== 'object') { err('recon 이 없음'); return; }
  const rows = X.rows, n = rows.length;
  if (RC.from !== CF.FIRST || RC.to !== H.latest) err(`recon 범위 ${RC.from}~${RC.to} ≠ ${CF.FIRST}~${H.latest}`);
  if (RC.n !== n) err(`recon.n ${RC.n} ≠ 재계산 ${n}`);
  if ((RC.evalFrom ?? null) !== (n ? rows[0].t : null)) err(`recon.evalFrom ${RC.evalFrom} ≠ ${n ? rows[0].t : null}`);
  if (!jeq(RC.skipped, X.skipped)) err(`recon.skipped 가 재계산과 다름: ${JSON.stringify(RC.skipped).slice(0, 160)} ≠ ${JSON.stringify(X.skipped).slice(0, 160)}`);
  const br = RC.baseRefit || {};
  if (br.n !== X.refN) err(`baseRefit.n ${br.n} ≠ ${X.refN}`);
  if (br.boundsDiff !== X.bdDiff) err(`baseRefit.boundsDiff ${br.boundsDiff} ≠ ${X.bdDiff}`);
  if (X.refMax > 1e-6) err(`내 재적합이 저장 파라미터 rows[t].pop.A 와 다름(최대 상대차 ${X.refMax.toExponential(2)}) — 입력 이력과 파라미터가 어긋남`);
  if (!(typeof br.maxRel === 'number' && br.maxRel <= 1e-6)) err(`baseRefit.maxRel ${br.maxRel} 이 1e-6 보다 큼`);
  note(`기본 모형 재적합 ↔ 저장 파라미터: ${X.refN}행 최대 상대차 ${X.refMax.toExponential(2)} (생성기 기록 ${br.maxRel}) · 학습 구간 불일치 ${X.bdDiff}행`);
  if (!n) return;
  const lgs = (key, tgt) => rows.map((x) => logsq(x[key], x[tgt]));
  const eb = lgs('base', 'm45'), ebp = lgs('base', 'mp');
  const T = 1e-8;
  const cmp = (label, a, b) => { if (!near(a, b, 1e-12, T)) err(`${label} ${a} ≠ 재계산 ${b}`); };
  cmp('err.base.m45', RC.err && RC.err.base && RC.err.base.m45, mean(eb));
  cmp('err.base.mp', RC.err && RC.err.base && RC.err.base.mp, mean(ebp));
  CANDS.forEach((c, ci) => {
    const ec = lgs(c, 'm45'), ecp = lgs(c, 'mp'), d = ec.map((v, i) => v - eb[i]), dp = ecp.map((v, i) => v - ebp[i]);
    cmp(`err.${c}.m45`, RC.err && RC.err[c] && RC.err[c].m45, mean(ec));
    cmp(`err.${c}.mp`, RC.err && RC.err[c] && RC.err[c].mp, mean(ecp));
    const rc = RC.cand && RC.cand[c] || {}, md = mean(d);
    if (rc.n !== n) err(`cand.${c}.n ${rc.n} ≠ ${n}`);
    cmp(`cand.${c}.meanDiff`, rc.meanDiff, md);
    const better = d.filter((v) => v < 0).length;
    if (rc.better !== better) err(`cand.${c}.better ${rc.better} ≠ ${better}`);
    const p = signFlipP(d, seedFor(H.latest, CF.SALT_RECON + ci));
    if (!near(rc.p, p, 1e-6, 0)) err(`cand.${c}.p ${rc.p} ≠ 재계산 ${p}`);
    if (rc.dir !== (md < 0 ? 'better' : 'worse')) err(`cand.${c}.dir ${rc.dir} ≠ ${md < 0 ? 'better' : 'worse'}`);
    const cp = RC.candMp && RC.candMp[c] || {};
    cmp(`candMp.${c}.meanDiff`, cp.meanDiff, mean(dp));
    if (cp.better !== dp.filter((v) => v < 0).length) err(`candMp.${c}.better ${cp.better} ≠ ${dp.filter((v) => v < 0).length}`);
    st.recDiff = st.recDiff || {}; st.recDiff[c] = md;
    note(`${c}: base 대비 평균 점수차 ${md.toExponential(3)} · 나은 회차 ${better}/${n} · p ${p.toFixed(4)}`);
  });
  const NZ = RC.noise || {};
  cmp('noise.m45.mean', NZ.m45 && NZ.m45.mean, mean(rows.map((x) => x.m45)));
  cmp('noise.m45.sd', NZ.m45 && NZ.m45.sd, sdev(rows.map((x) => x.m45)));
  cmp('noise.mp.mean', NZ.mp && NZ.mp.mean, mean(rows.map((x) => x.mp)));
  cmp('noise.mp.sd', NZ.mp && NZ.mp.sd, sdev(rows.map((x) => x.mp)));
  const m3 = rows.filter((x) => x.m123 !== null).map((x) => x.m123);
  if (m3.length > 1) { cmp('noise.m123.mean', NZ.m123 && NZ.m123.mean, mean(m3)); cmp('noise.m123.sd', NZ.m123 && NZ.m123.sd, sdev(m3)); if (NZ.m123 && NZ.m123.n !== m3.length) err('noise.m123.n 불일치'); }
  ['base', 'C1', 'C2'].forEach((k) => cmp(`noise.predSd.${k}`, NZ.predSd && NZ.predSd[k], sdev(rows.map((x) => x[k]))));
  const rec = RC.recent || [], want = rows.slice(-CF.RECENT);
  if (rec.length !== want.length) err(`recent 행 수 ${rec.length} ≠ ${want.length}`);
  rec.forEach((x, i) => {
    const w = want[i]; if (!w) return;
    if (x.t !== w.t) { err(`recent[${i}].t ${x.t} ≠ ${w.t}`); return; }
    if (!near(x.z, w.z, 2e-10, 1e-9)) err(`recent t=${x.t} z ${x.z} ≠ ${w.z}`);
    for (const k of ['m45', 'mp', 'base', 'C1', 'C2']) if (!near(x[k], w[k], 1.5e-6, 0)) err(`recent t=${x.t} ${k} ${x[k]} ≠ ${w[k]}`);
    if (w.m123 === null ? x.m123 !== null : !near(x.m123, w.m123, 1.5e-6, 0)) err(`recent t=${x.t} m123 ${x.m123} ≠ ${w.m123}`);
  });
}

/* ───────── C3 z 두 구현 대조 (표본 3회차, 상대 1e-9) ───────── */
/* check-rank.mjs 의 zMaker 를 «소스 텍스트로만» 꺼내 격리 컨텍스트에서 실행한다(가져오기 아님). 꺼내지 못하면 경고만 — 그 파일이 고쳐졌다는 뜻이라 사람이 본다. */
function loadRankZMaker(root) {
  const p = path.join(path.resolve(root), 'scripts', 'check-rank.mjs');
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8').split(String.fromCharCode(13)).join(''), at = src.indexOf('function zMaker(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  if (depth !== 0) return null;
  try { return vm.runInNewContext(src.slice(at, j + 1) + ';zMaker', { Float64Array, Math, Array }, { timeout: 2000 }); } catch { return null; }
}
function checkZ(J, H, PR, M, opt) {
  const ts = []; for (let t = CF.FIRST; t <= H.latest; t++) if (PR.P[t]) ts.push(t);
  if (ts.length < 3) { note('표본 회차가 3개 미만이라 건너뜀'); return; }
  const pick = [ts[0], ts[Math.floor(ts.length / 2)], ts[ts.length - 1]];
  const zm = loadRankZMaker(opt.root);
  if (!zm) wrn('scripts/check-rank.mjs 에서 zMaker 를 꺼내지 못해 그쪽과의 대조를 건너뜀(파일이 바뀌었는지 확인)');
  let worst = 0, worstRank = 0;
  for (const t of pick) {
    const a = zDirect(PR.P[t], H.D[t].n), b = zByTable(PR.P[t], H.D[t].n);
    const rel = Math.abs(a - b) / Math.max(Math.abs(b), 1e-12); worst = Math.max(worst, rel);
    if (rel > 1e-9) err(`z(${t}회) 직접식 ${a} ↔ 특징 코드 표 ${b} 상대차 ${rel.toExponential(2)} > 1e-9`);
    if (zm) {
      const c = zm(PR.P[t])(featCode(H.D[t].n)), r2 = Math.abs(a - c) / Math.max(Math.abs(c), 1e-12); worstRank = Math.max(worstRank, r2);
      if (!(r2 <= 1e-9)) err(`z(${t}회) 직접식 ${a} ↔ check-rank zMaker ${c} 상대차 ${r2.toExponential(2)} > 1e-9`);
    }
    const rr = (J.recon && J.recon.recent || []).find((x) => x.t === t);
    if (rr && !near(rr.z, a, 2e-10, 1e-9)) err(`z(${t}회) 장부 값 ${rr.z} ↔ 재계산 ${a}`);
  }
  note(`z 직접식 ↔ 특징 코드 표: 표본 ${pick.join(',')}회 최대 상대차 ${worst.toExponential(2)}${zm ? ` · ↔ check-rank zMaker ${worstRank.toExponential(2)}` : ''}`);
}

/* ───────── C0 구조·규칙표·크기 ───────── */
function checkStructure(J, opt, text, H) {
  if (!J || typeof J !== 'object') { err('최상위가 객체가 아님'); return; }
  const ks = Object.keys(J);
  if (!jeq(ks, TOP_KEYS)) err(`최상위 키 ${ks.join(',')} ≠ ${TOP_KEYS.join(',')}`);
  if (J.v !== 1 || J.kind !== 'pop-learn-lotto') err(`v/kind ${J.v}/${J.kind}`);
  if (J.ver !== EXPECT_RULES[EXPECT_RULES.length - 1].ver) err(`ver ${J.ver} ≠ ${EXPECT_RULES[EXPECT_RULES.length - 1].ver}`);
  const bytes = Buffer.byteLength(text);
  if (bytes >= MAX_BYTES) err(`파일 크기 ${bytes}바이트 ≥ 1MB (규칙 4)`);
  note(`크기 ${bytes}바이트`);
  if (text.charCodeAt(0) === 0xFEFF) err('BOM 이 있음');
  if (text.includes('\r')) wrn('CR 이 있음 — 생성기는 LF 만 쓴다(autocrlf 로 작업 트리에서 바뀐 사본일 수 있음, 값 비교에는 영향 없음)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(J.generated || '')) err(`generated 형식 ${J.generated}`);
  if (!jeq(J.conf, JSON.parse(JSON.stringify(EXPECT_CONF)))) err('conf 가 규격 상수와 다름(상수를 바꿨다면 VER·RULES·이 검사기를 같이 고쳐야 함)');
  if (!jeq(J.rules, EXPECT_RULES)) err('rules 가 이 검사기의 규칙표와 다름(덧붙이기만 허용, 검사기도 같이 고친다)');
  const S = J.source || {};
  if (S.latest !== H.latest || S.count !== H.latest) err(`source.latest/count ${S.latest}/${S.count} ≠ 이력 ${H.latest}`);
  if (!J.recon || !J.gate || !J.journal || !Array.isArray(J.journal.rows) || !Array.isArray(J.journal.missed)) { err('recon/gate/journal 구조가 맞지 않음'); return; }
  const ck = J.checks || {};
  for (const k of ['kept', 'added', 'graded']) if (!Number.isInteger(ck[k])) err(`checks.${k} 정수 아님`);
  if (Array.isArray(ck.pendingMismatch) && ck.pendingMismatch.length) wrn(`checks.pendingMismatch ${ck.pendingMismatch.join('; ')}`);
  if (Array.isArray(ck.regradeMismatch) && ck.regradeMismatch.length) wrn(`checks.regradeMismatch ${ck.regradeMismatch.join('; ')}`);
}
/* ───────── C1 입력 ───────── */
function checkInput(J, H, PR) {
  if (H.probs.length) { err('이력 문제: ' + H.probs.slice(0, 5).join('; ')); return; }
  const S = J.source || {};
  const dg = digestOf(H.D, H.latest);
  if (S.digest !== dg) err(`source.digest ${S.digest} ≠ 재계산 ${dg}`);
  if (typeof S.file !== 'string') err('source.file 없음');
  const a = H.D[H.latest];
  const bad = []; if (!(a.sales > 0)) bad.push('sales'); if (!(a.w[3] > 0)) bad.push('w4'); if (!(a.w[4] > 0)) bad.push('w5');
  if (bad.length) err(`최신 ${H.latest}회 필드 이상(${bad.join(',')}) — 이 상태로 장부가 쓰이면 안 됨`);
  if (H.latest >= CF.FT_CHECK_FROM) { const f = a.ft || [0, 0, 0]; if (f[0] + f[1] + f[2] !== (a.w[0] === null ? 0 : a.w[0])) err(`최신 ${H.latest}회 firstType 합 ≠ 1등 당첨자 수`); }
  if (!PR) { err('rank-params 를 읽지 못함'); return; }
  const sp = S.params || {};
  if (sp.first !== PR.first || sp.last !== PR.last || sp.count !== PR.count) err(`source.params ${JSON.stringify(sp)} ≠ ${JSON.stringify({ first: PR.first, last: PR.last, count: PR.count })}`);
}

/* ───────── C4 일지 구조·얼린 파라미터 ───────── */
const r12 = (v) => Number(v.toPrecision(CF.PREC));
function freezeOwn(t, M, PR) {
  const fc = M.fitAt(t), cal = M.calAt(t);
  if (!fc || !cal || !PR.P[t]) return null;
  const P = PR.P[t], m = (o) => o && { beta: o.beta.map(r12), predMean: r12(o.predMean), predSD: r12(o.predSD) };
  return {
    nTrain: fc.n, nCal: cal.n, a: r12(cal.a), b: r12(cal.b),
    pop: { A: m(P.A), B: m(P.B), bounds: (P.bounds || []).map((b) => [r12(b[0]), r12(b[1])]) },
    bd: fc.bd.map((b) => [r12(b[0]), r12(b[1])]), C1: fc.C1.map(r12), C2: fc.C2.map(r12)
  };
}
function fitClose(a, b, path, out) {
  if (typeof a === 'number' && typeof b === 'number') { if (!(Math.abs(a - b) <= 1e-7 * Math.max(Math.abs(b), 1e-2))) out.push(`${path} ${a} ≠ ${b}`); return; }
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) { out.push(`${path} 길이 ${a.length} ≠ ${b.length}`); return; } a.forEach((v, i) => fitClose(v, b[i], `${path}[${i}]`, out)); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { const ka = Object.keys(a), kb = Object.keys(b); if (!jeq(ka, kb)) { out.push(`${path} 키 ${ka} ≠ ${kb}`); return; } for (const k of ka) fitClose(a[k], b[k], `${path}.${k}`, out); return; }
  if (a !== b) out.push(`${path} ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function checkJournal(J, H, PR, M) {
  const JR = J.journal, rows = JR.rows;
  if (!rows.length) { err('journal.rows 가 비어 있음'); return; }
  if (!Number.isInteger(JR.from) || JR.from !== rows[0].r) err(`journal.from ${JR.from} ≠ 첫 행 ${rows[0].r}(행 삭제 또는 from 변경)`);
  let prev = 0, pend = 0;
  for (const x of rows) {
    if (!Number.isInteger(x.r) || x.r <= prev) err(`일지 r=${x.r} 이 오름차순·유일이 아님`);
    prev = x.r;
    if (x.status !== 'pending' && x.status !== 'done') err(`r=${x.r} 상태 ${x.status}`);
    if (x.status === 'pending') pend++;
    if (x.ver !== ruleVer(x.r)) err(`r=${x.r} ver ${x.ver} ≠ 규칙표 ${ruleVer(x.r)}`);
    if (x.basedOn !== x.r - 1) err(`r=${x.r} basedOn ${x.basedOn} ≠ ${x.r - 1}`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.made || '')) err(`r=${x.r} made 형식`);
  }
  if (pend > 1) err(`pending 이 ${pend}개(최대 1)`);
  const last = rows[rows.length - 1];
  if (last.status !== 'pending' || last.r !== H.latest + 1) err(`마지막 행은 latest+1=${H.latest + 1} 의 pending 이어야 함(현재 r=${last.r} ${last.status})`);
  for (const x of rows) if (x.status === 'done' && x.r > H.latest) err(`done r=${x.r} 가 latest ${H.latest} 보다 뒤`);
  /* 연속성: from..latest+1 의 모든 회차는 행이거나 missed */
  const have = new Set(rows.map((x) => x.r)), ms = JR.missed;
  if (!ms.every((v, i) => Number.isInteger(v) && (i === 0 || v > ms[i - 1]))) err('missed 가 오름차순 정수가 아님');
  for (const v of ms) if (have.has(v)) err(`missed ${v} 가 행으로도 있음`);
  for (let r = JR.from; r <= H.latest + 1; r++) if (!have.has(r) && !ms.includes(r)) err(`회차 ${r} 가 행도 missed 도 아님(행 삭제 의심)`);
  for (const v of ms) if (v < JR.from || v > H.latest) err(`missed ${v} 가 범위 밖`);
  /* 얼린 파라미터 재계산 + 입력 지문 */
  for (const x of rows) {
    if (!x.fit) { err(`r=${x.r} fit 없음`); continue; }
    const dg = digestOf(H.D, Math.min(x.basedOn, H.latest));
    if (x.inputDigest !== dg) { (x.made === J.generated ? err : wrn)(`r=${x.r} inputDigest ${x.inputDigest} ≠ 재계산 ${dg}`); }
    const own = freezeOwn(x.r, M, PR);
    if (!own) { wrn(`r=${x.r} 얼린 파라미터를 재계산할 수 없음(rank-params 행·표본)`); continue; }
    const d = []; fitClose(x.fit, own, 'fit', d);
    if (d.length) (x.made === J.generated ? err : wrn)(`r=${x.r} 얼린 파라미터가 재계산과 다름: ${d.slice(0, 3).join(' / ')}${d.length > 3 ? ` …외 ${d.length - 3}` : ''}`);
  }
  /* 행 키 순서(경고) */
  const KEY_P = ['r', 'ver', 'status', 'made', 'basedOn', 'inputDigest', 'fit'];
  for (const x of rows) if (!jeq(Object.keys(x).slice(0, KEY_P.length), KEY_P)) { wrn(`r=${x.r} 행 키 순서가 규격과 다름`); break; }
}

/* ───────── C5 채점 ───────── */
const cutoff = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${String(CF.CUTOFF_UTC_H).padStart(2, '0')}:00:00.000Z`;
function checkGrade(J, H, M) {
  let nDone = 0;
  for (const x of J.journal.rows) {
    if (x.status === 'pending') {
      for (const k of ['drawDate', 'late', 'obs', 'pred', 'skip', 'gradedAt']) if (k in x) err(`pending r=${x.r} 에 ${k} 가 있음`);
      continue;
    }
    nDone++;
    const d = H.D[x.r];
    if (x.drawDate !== d.date) err(`done r=${x.r} drawDate ${x.drawDate} ≠ 이력 ${d.date}`);
    if (!/^\d{8}$/.test(d.date)) { err(`r=${x.r} 이력에 추첨일 없음`); continue; }
    if (x.late !== (x.made >= cutoff(d.date))) err(`done r=${x.r} late ${x.late} ≠ ${x.made >= cutoff(d.date)}(made ${x.made}, 마감 ${cutoff(d.date)})`);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(x.gradedAt || '')) err(`done r=${x.r} gradedAt 없음`);
    const o = M.ob[x.r], skipWhy = o.why || (o.mp === null ? '1~3등 당첨자 수 없음' : null);
    if (skipWhy) { if (x.skip !== skipWhy || x.obs || x.pred) err(`done r=${x.r} 는 건너뜀 «${skipWhy}» 이어야 함(skip=${x.skip})`); continue; }
    if (x.skip || !x.obs || !x.pred) { err(`done r=${x.r} 에 obs/pred 가 있어야 함`); continue; }
    const f = x.fit, nums = d.n, F = feats(nums);
    const z = zDirect(f.pop, nums), fl = (v) => Math.max(v, CF.M_FLOOR);
    const pr = { base: fl(f.a + f.b * z), C1: fl(dotp(clampF(F, f.bd), f.C1)), C2: fl(dotp(clampF(F, f.bd), f.C2)) };
    for (const k of ['base', 'C1', 'C2']) if (!near(x.pred[k], pr[k], 1.5e-6, 0)) err(`done r=${x.r} pred.${k} ${x.pred[k]} ≠ 얼린 파라미터로 재계산 ${pr[k].toFixed(6)}`);
    for (const k of ['m45', 'm123', 'mp']) { const w = o[k]; if (w === null ? x.obs[k] !== null : !near(x.obs[k], w, 1.5e-6, 0)) err(`done r=${x.r} obs.${k} ${x.obs[k]} ≠ 이력에서 재계산 ${w}`); }
  }
  note(`done ${nDone}행 재채점 완료`);
}

/* ───────── C6 관문 (§3.7) ───────── */
function checkGate(J) {
  const G = J.gate, rows = J.journal.rows, RC = J.recon;
  if (!G) { err('gate 없음'); return; }
  const live = rows.filter((x) => x.status === 'done' && x.late === false && x.obs && x.pred);
  const thr = CF.ALPHA / CF.NCAND, n = live.length;
  if (G.n !== n) err(`gate.n ${G.n} ≠ live ${n}`);
  if (G.minN !== CF.GATE_MIN || G.alpha !== CF.ALPHA || G.nCand !== CF.NCAND || G.thr !== thr) err('gate 상수가 규격과 다름');
  const lateN = rows.filter((x) => x.status === 'done' && x.late === true).length, skN = rows.filter((x) => x.status === 'done' && x.skip).length;
  if (G.late !== lateN) err(`gate.late ${G.late} ≠ ${lateN}`);
  if (G.skip !== skN) err(`gate.skip ${G.skip} ≠ ${skN}`);
  const adopt = [];
  CANDS.forEach((c, ci) => {
    const e = (G.cands || {})[c] || {};
    let md = null, better = 0, p = null;
    if (n) {
      const d = live.map((x) => logsq(x.pred[c], x.obs.m45) - logsq(x.pred.base, x.obs.m45));
      md = mean(d); better = d.filter((v) => v < 0).length;
      if (n >= CF.GATE_MIN) p = signFlipP(d, seedFor(live[n - 1].r, CF.SALT_LIVE + ci));
    }
    if (e.n !== n) err(`gate.${c}.n ${e.n} ≠ ${n}`);
    if (md === null ? e.meanDiff !== null : !near(e.meanDiff, md, 1e-12, 1e-8)) err(`gate.${c}.meanDiff ${e.meanDiff} ≠ ${md}`);
    if (e.better !== better) err(`gate.${c}.better ${e.better} ≠ ${better}`);
    if (p === null ? e.p !== null : !near(e.p, p, 1e-6, 0)) err(`gate.${c}.p ${e.p} ≠ ${p}`);
    const rd = RC && RC.cand && RC.cand[c] ? RC.cand[c].dir : null;
    if (e.reconDir !== rd) err(`gate.${c}.reconDir ${e.reconDir} ≠ ${rd}`);
    const ok = !!(n >= CF.GATE_MIN && p !== null && p <= thr && md < 0 && rd === 'better');
    if (e.ok !== ok) err(`gate.${c}.ok ${e.ok} ≠ ${ok}`);
    if (ok) adopt.push(c);
  });
  if (!jeq(G.adopt, adopt)) err(`gate.adopt ${JSON.stringify(G.adopt)} ≠ ${JSON.stringify(adopt)}`);
  const status = n < CF.GATE_MIN ? 'collecting' : (adopt.length ? 'adopt' : 'none');
  if (G.status !== status) err(`gate.status ${G.status} ≠ ${status}`);
  note(`관문: live ${n}/${CF.GATE_MIN} · 상태 ${status}`);
}

/* ───────── C7 append-only ───────── */
function gitShow(root, ref, rel) {
  try { return execFileSync('git', ['-C', root, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; }
}
export function extractRules(src) {
  const m = /\bRULES\s*[:=]\s*(?:[A-Za-z_$][\w$.]*\(\s*)*\[/.exec(src); if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') { depth--; if (depth === 0) break; } }
  if (depth !== 0) return null;
  try { return vm.runInNewContext('(' + src.slice(i, j + 1) + ')', {}, { timeout: 1000 }); } catch { return null; }
}
const rawRows = (t) => { const m = new Map(); for (const l of t.split('\n')) { const x = /^\s*\{\s*"r"\s*:\s*(\d+)\s*,/.exec(l); if (x) m.set(+x[1], l.trim().replace(/,$/, '')); } return m; };
function checkAppend(J, opt, filePath, curText) {
  /* 현재 생성기 소스의 RULES 는 늘 꺼내 본다(꺼내지 못하면 오류). 검증기 사본·JSON 과도 같아야 한다 */
  const genPath = path.join(path.resolve(opt.root), 'scripts', 'pop-learn.mjs');
  let cur = null;
  if (!fs.existsSync(genPath)) err('scripts/pop-learn.mjs 가 없음'); else {
    cur = extractRules(fs.readFileSync(genPath, 'utf8'));
    if (!Array.isArray(cur) || !cur.length) err('pop-learn.mjs 의 RULES 배열을 꺼내지 못함');
    else if (!jeq(cur, EXPECT_RULES)) err('pop-learn.mjs 의 RULES 가 이 검사기의 규칙표와 다름(둘을 같이 고친다)');
    else note(`pop-learn.mjs RULES ${cur.length}항목(${cur.map((x) => x.ver).join(',')})`);
  }
  let prevText = null, label = '';
  if (opt.prev) { try { prevText = fs.readFileSync(path.resolve(opt.prev), 'utf8'); label = opt.prev; } catch (e) { err(`--prev ${opt.prev} 를 읽을 수 없음`); return; } }
  else if (opt.prevGit) {
    const root = path.resolve(opt.root), rel = path.relative(root, filePath).split(path.sep).join('/');
    if (rel.startsWith('..')) { note('파일이 root 밖이라 git 대조 생략'); return; }
    /* 생성기 소스의 RULES 접두 — 장부 파일이 HEAD 에 없어도(첫 장부) 소스가 HEAD 에 있으면 본다 */
    const hs = gitShow(root, opt.prevGit, 'scripts/pop-learn.mjs');
    if (hs !== null && cur) {
      const a = extractRules(hs);
      if (!Array.isArray(a)) err(`${opt.prevGit} 의 pop-learn.mjs RULES 를 꺼내지 못함`);
      else if (!jeq(cur.slice(0, a.length), a) || cur.length < a.length) err(`RULES 가 ${opt.prevGit} 의 접두 일치가 아님(덧붙이기만 허용)`);
    }
    prevText = gitShow(root, opt.prevGit, rel); label = `${opt.prevGit}:${rel}`;
    if (prevText === null) { note(`git ${label} 를 읽을 수 없어(git 없음·HEAD 에 파일 없음) 건너뜀`); return; }
  }
  if (prevText === null) { note('이전 장부가 없어 append-only 대조 생략'); return; }
  let H; try { H = JSON.parse(prevText); } catch { note(`${label} 가 JSON 이 아니라 건너뜀`); return; }
  if (!H.journal || !Array.isArray(H.journal.rows)) { note(`${label} 에 journal 이 없어 건너뜀`); return; }
  if (J.journal.from !== H.journal.from) err(`journal.from ${J.journal.from} ≠ ${label} 의 ${H.journal.from}`);
  const cm = new Map(J.journal.rows.map((r) => [r.r, r]));
  const ra = rawRows(prevText), rb = rawRows(curText);
  const FROZEN = ['ver', 'made', 'basedOn', 'inputDigest', 'fit'];
  for (const p of H.journal.rows) {
    const c = cm.get(p.r);
    if (!c) { err(`${label} 의 일지 r=${p.r} 가 사라짐(행 삭제 금지)`); continue; }
    if (p.status === 'done') {
      if (JSON.stringify(c) !== JSON.stringify(p)) err(`done 행 r=${p.r} 이 ${label} 와 다름(made·gradedAt 포함 불변)`);
      else if (ra.get(p.r) !== rb.get(p.r)) wrn(`done 행 r=${p.r} 이 값은 같지만 글자가 다름(바이트 불변 원칙)`);
    } else for (const k of FROZEN) if (JSON.stringify(c[k]) !== JSON.stringify(p[k])) err(`pending→${c.status} 행 r=${p.r} 의 얼린 필드 ${k} 가 바뀜`);
  }
  const pr = H.journal.rows.map((r) => r.r);
  if (J.journal.rows.map((r) => r.r).slice(0, pr.length).join() !== pr.join()) err('일지 행 순서/접두가 이전과 다름(재정렬·중간 삽입 금지)');
  const pm = H.journal.missed || [];
  if (J.journal.missed.slice(0, pm.length).join() !== pm.join()) err('missed 접두가 이전과 다름');
  if (Array.isArray(H.rules) && !jeq(J.rules.slice(0, H.rules.length), H.rules)) err('rules 가 이전 장부의 접두 일치가 아님');
}

/* ───────── C8 문구·결정성 표지 ───────── */
function checkWording(J, opt) {
  const strs = []; (function walk(v) { if (typeof v === 'string') strs.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { strs.push(k); walk(v[k]); } })(J);
  const hit = (label, t) => { const m = FORBID.exec(t); if (m) err(`${label} 에 금지 문구 «${m[0]}»`); };
  hit('장부 JSON', strs.join('\n'));
  const root = path.resolve(opt.root);
  const doc = path.join(root, 'docs', 'pop-learn.md'), gen = path.join(root, 'scripts', 'pop-learn.mjs');
  if (fs.existsSync(doc)) {
    const t = fs.readFileSync(doc, 'utf8'); hit('docs/pop-learn.md', t);
    for (const need of ['1~3등', '포아송', 'payoutGain', '돈 단위', '확률 아님, 금액']) if (!t.includes(need)) err(`docs/pop-learn.md 의 한계 문구에 «${need}» 가 없음`);
  } else err('docs/pop-learn.md 가 없음');
  if (fs.existsSync(gen)) {
    const t = fs.readFileSync(gen, 'utf8').replace(/\r/g, ''); hit('scripts/pop-learn.mjs', t);          // autocrlf 로 CRLF 가 된 작업 트리도 같게 읽는다
    /* 블록 주석을 지우고, 줄 뒤쪽 // 주석은 코드와 나눠 본다(DATE_OK 표지는 주석 안에 있다) */
    const lines = t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
    const codeOf = (l) => l.replace(/\/\/.*$/, '');
    const rnd = lines.filter((l) => /Math\s*\.\s*random/.test(codeOf(l))); if (rnd.length) err(`pop-learn.mjs 에 Math.random ${rnd.length}곳`);
    const dt = lines.filter((l) => /\bDate\b/.test(codeOf(l)) && !/DATE_OK/.test(l)); if (dt.length) err(`pop-learn.mjs 에 표지(DATE_OK) 없는 Date ${dt.length}곳: ${dt[0].trim().slice(0, 80)}`);
    const dn = lines.filter((l) => /\bDate\b/.test(codeOf(l)) && /DATE_OK/.test(l)).length; note(`pop-learn.mjs 의 Date 는 --now 처리(DATE_OK) ${dn}곳뿐, Math.random 0곳`);
  } else err('scripts/pop-learn.mjs 가 없음');
}

/* ═════════════ 진입점 ═════════════ */
function parseArgs(argv) {
  const o = { root: '.', file: 'brief/pop-learn-lotto.json', history: 'lotto-history.json', params: 'brief/rank-params-lotto.json', prevGit: null, prev: null, only: null, skip: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Error(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break; case '--file': o.file = need(); break; case '--history': o.history = need(); break; case '--params': o.params = need(); break;
      case '--prev-git': o.prevGit = need(); break; case '--prev': o.prev = need(); break;
      case '--only': o.only = need().split(',').map((x) => x.trim().toUpperCase()); break; case '--skip': o.skip = need().split(',').map((x) => x.trim().toUpperCase()); break;
      case '-h': case '--help': console.log('사용: node scripts/check-pop-learn.mjs --root . --file brief/pop-learn-lotto.json --history lotto-history.json [--params f] [--prev-git HEAD] [--prev f] [--only C2,C3] [--skip C7]'); process.exit(0); break;
      default: throw new Error('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}
function fatal(msg) { console.log(`::error title=${TITLE}::${esc(msg)}`); process.exit(1); }
function loadParams(p) {
  let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  if (!j || !j.rows) return null;
  const P = []; let first = 0, last = 0, count = 0;
  for (const k of Object.keys(j.rows)) {
    const t = Number(k), pop = j.rows[k] && j.rows[k].pop;
    if (Number.isInteger(t) && pop && pop.A && Array.isArray(pop.A.beta) && pop.A.beta.length === 8) { P[t] = pop; count++; if (!first || t < first) first = t; if (t > last) last = t; }
  }
  return { P, first, last, count };
}
function main() {
  let opt; try { opt = parseArgs(process.argv.slice(2)); } catch (e) { fatal(e.message); }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const filePath = res(opt.file);
  let text, J; try { text = fs.readFileSync(filePath, 'utf8'); J = JSON.parse(text); } catch (e) { fatal(`${opt.file} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  let H; try { H = loadHistory(JSON.parse(fs.readFileSync(res(opt.history), 'utf8'))); } catch (e) { fatal(`이력 ${opt.history} 를 읽을 수 없음: ${e.message}`); }
  const PR = loadParams(res(opt.params));
  const t00 = performance.now(), st = {};
  runCheck('C0', '구조·규칙표·크기', opt, () => checkStructure(J, opt, text, H));
  runCheck('C1', '입력', opt, () => checkInput(J, H, PR));
  const usable = !H.probs.length && PR && J && J.recon && J.journal && Array.isArray(J.journal.rows) && H.latest > CF.FIRST + CF.CAL_MIN;
  let M = null; if (usable) M = makeModel(H, PR);
  const need = (id, title, fn) => { if (!usable) { skipCheck(id, title, '이력·파라미터 문제 또는 구조 실패로 생략'); return; } runCheck(id, title, opt, fn); };
  need('C2', '돌아보기 재계산', () => checkRecon(J, H, PR, M, st));
  need('C3', 'z 두 구현 대조', () => checkZ(J, H, PR, M, opt));
  need('C4', '일지·얼린 파라미터', () => checkJournal(J, H, PR, M));
  need('C5', '채점', () => checkGrade(J, H, M));
  need('C6', '관문', () => checkGate(J));
  if (!opt.prevGit && !opt.prev) skipCheck('C7', 'append-only', '--prev-git/--prev 가 없어 생략'); else need('C7', 'append-only', () => checkAppend(J, opt, filePath, text));
  runCheck('C8', '문구·결정성 표지', opt, () => checkWording(J, opt));

  let nErr = 0, nWarn = 0;
  for (const it of R.items) {
    nErr += it.errors.length; nWarn += it.warnings.length;
    const s = it.skipped ? '생략' : it.errors.length ? `실패 ${it.errors.length}` : '통과';
    console.log(`[${it.id}] ${it.title} — ${s}${it.warnings.length ? ` · 경고 ${it.warnings.length}` : ''} (${(it.ms / 1000).toFixed(1)}s)`);
    for (const n of it.notices) console.log(`  · ${n}`);
  }
  for (const it of R.items) {
    for (const m of it.errors.slice(0, 12)) console.log(`::error title=${TITLE}::${esc(`${it.id} ${it.title}: ${m}`)}`);
    if (it.errors.length > 12) console.log(`::error title=${TITLE}::${esc(`${it.id} …외 ${it.errors.length - 12}건`)}`);
    for (const m of it.warnings.slice(0, 12)) console.log(`::warning title=${TITLE}::${esc(`${it.id} ${it.title}: ${m}`)}`);
  }
  const secs = ((performance.now() - t00) / 1000).toFixed(1);
  if (nErr) { console.log(`::error title=${TITLE}::${esc(`당첨금 학습 독립 검증 실패 — 오류 ${nErr} · 경고 ${nWarn} (${secs}s)`)}`); process.exit(1); }
  console.log(`::notice title=${TITLE}::${esc(`당첨금 학습 독립 검증 통과 — ${R.items.filter((i) => !i.skipped).length}개 검사 · 경고 ${nWarn} · ${secs}s`)}`);
  process.exit(0);
}
const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } })();
if (isMain) main();
