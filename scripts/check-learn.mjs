#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-learn.mjs — 학습 장부(brief/learn-lotto.json) 독립 재계산 검사기 (규격 docs/learn-ledger.md)

   원칙 — 이 파일은 규격 문서만 보고 쓴 «독립 구현»이다(CLAUDE.md 규칙 10).
     · scripts/learn-ledger.mjs 를 import 하지도 실행하지도 않는다. 이력 정규화·신호 풀과 줄·대조군·채점·꼬리 비율·관문·재현 요약·지문을
       이 파일 안에서 다시 만든다. 같은 규격을 읽고 따로 만든 두 구현이 같은 값을 내야 통과다.
       (정적 점검 L8 만 learn-ledger.mjs 를 «글자 그대로 읽어» Math.random·Date 쓰임을 센다 — 실행·import 없음.)
     · 읽기 전용이다. 종료 코드 0(통과)/1(실패). 실패는 `::error title=check-learn::…` 한 줄씩.

   사용
     node scripts/check-learn.mjs --root . --file brief/learn-lotto.json --history lotto-history.json
          [--summary brief/latest-summary.json] [--sim brief/sim-lotto.json] [--prev-git HEAD | --prev <이전 파일>]
          [--page record.html] [--ledger scripts/learn-ledger.mjs] [--only L2,L4] [--skip L6]
     --summary/--sim   없으면 해당 대조(rec ↔ 추천 요약 · 돌아보면의 rec ↔ 모의 원장)만 건너뛴다.
     --prev-git REF    REF 의 같은 경로 파일과 append-only 를 대조한다(git 이 없거나 REF 에 파일이 없으면 건너뜀). --prev 는 파일 직접 지정.

   검사 표
     L0 구조 · L1 입력(이력·source·conf·rules) · L2 신호 풀과 줄(과거만) · L3 rec(모양·추천 요약·모의 원장 대조) · L4 채점(res·late·drawDate·대조군 분포)
     L5 요약(live·관문·돌아보면 재계산) · L6 append-only(done 바이트 불변·from·missed·rules 접두·행 삭제/재정렬 금지·pending 얼린 필드)
     L7 문구·크기(JSON 문자열 + record.html #learnWrap · 학습 JS 구간에 금지 문구·화면 이론값 0건, 1MB 미만) · L8 정적(Math.random·Date)

   경고만 내는 항목(이유 포함)
     · L3 rec 가 지금 추천 요약·모의 원장과 다름: 일지는 «처음 공개한 값 동결» 이 원칙이라 생성기도 ::warning 만 낸다. 사람이 원인을 본다.
     · L6 done 행이 값은 같고 글자(공백·숫자 표기)만 다름 · 키 순서 · journal.checks 의 경고 배열이 비어 있지 않음.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ═════════════ 규격 상수 (docs/learn-ledger.md §3 — 생성기 코드를 보지 않고 문서에서 옮김) ═════════════ */
const VER = 'learn-1';
const RULES = [{ ver: 'learn-1', from: 1248, signals: ['hot', 'cold', 'gap', 'repeat'] }];
const CONF = {
  W: 50, POOL: 15, LINES: 10, MIN_HIT: 3,
  SALT: { hot: 0x484F545F, cold: 0x434F4C44, gap: 0x4741505F, repeat: 0x52455054, ctrl: 0x4354524C },
  CTRL_MUL: 0x85EBCA6B, R: 1000,
  ALARM_MIN_WEEKS: 26, ALARM_P: [1, 100], ADOPT_MIN_WEEKS: 52, ALPHA: [1, 20],
  REPLAY: 300, SIM_LINES: 5, CUTOFF_UTC_H: 11
};
const MAX_BYTES = 1000000;
const TOP_KEYS = ['v', 'kind', 'ver', 'generated', 'source', 'conf', 'rules', 'summary', 'journal', 'checks'];
const FORBID = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
const THEORY = /p값|σ|표준편차|기대값|몬테카를로|정확 확률|이론/;       // 화면(#learnWrap · 학습 JS)에 새로 넣지 않는 이론값 말(규칙 9)
const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };

/* ═════════════ 도구 ═════════════ */
const imul = Math.imul;
const num = (a, b) => a - b;
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h = imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; } return 'fnv:' + ('00000000' + h.toString(16)).slice(-8); }
function rng32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let z = imul(s ^ (s >>> 15), 1 | s);
    z = (z + imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
const sigSeed = (t, salt) => (imul(t, 0x9E3779B1) ^ salt) >>> 0;
const ctrlSeed = (t, j) => (imul(t, 0x9E3779B1) ^ imul(j, CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0;
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const short = (v) => { const s = v === undefined ? '없음' : JSON.stringify(v); return s.length > 90 ? s.slice(0, 87) + '…' : s; };
function canon(v) {                                          // 키 순서와 무관한 비교용 정규형
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const same = (a, b) => canon(a) === canon(b);
function firstDiff(got, want, p) {                           // 첫 차이 경로(진단용)
  if (want === null || typeof want !== 'object' || got === null || typeof got !== 'object') return got === want ? null : `${p || '값'}: ${short(got)} ≠ 기대 ${short(want)}`;
  if (Array.isArray(want) !== Array.isArray(got)) return `${p}: 모양(배열/객체)이 다름`;
  const ks = new Set([...Object.keys(want), ...Object.keys(got)]);
  for (const k of ks) { const d = firstDiff(got[k], want[k], p ? p + '.' + k : k); if (d) return d; }
  return null;
}
function lineToNums(s) {
  if (typeof s !== 'string' || !/^[1-9]\d?(,[1-9]\d?){5}$/.test(s)) return null;
  const a = s.split(',').map(Number);
  return a.every((x) => x >= 1 && x <= 45) && new Set(a).size === 6 && a.every((x, i) => i === 0 || a[i - 1] < x) ? a : null;
}

/* ═════════════ 결과 수집 ═════════════ */
const R_ = { items: [] };
let cur = null;
const err = (m) => cur.errors.push(m), wrn = (m) => cur.warnings.push(m), note = (m) => cur.notices.push(m);
function runCheck(id, title, opt, fn) {
  const it = { id, title, errors: [], warnings: [], notices: [], skipped: false, ms: 0 };
  R_.items.push(it);
  if ((opt.only && !opt.only.includes(id)) || (opt.skip && opt.skip.includes(id))) { it.skipped = true; return; }
  cur = it; const t0 = performance.now();
  try { fn(); } catch (e) { err('검사 중 예외: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  it.ms = performance.now() - t0; cur = null;
}
function skipCheck(id, title, why) { R_.items.push({ id, title, errors: [], warnings: [], notices: ['생략: ' + why], skipped: true, ms: 0 }); }

/* ═════════════ 이력 ═════════════ */
function loadHistory(h) {
  const problems = [], D = [null];
  const ds = h && Array.isArray(h.draws) ? h.draws : null;
  if (!ds || !ds.length) return { problems: ['draws 배열 없음'], D, latest: 0 };
  const by = new Map(); let latest = 0;
  for (const d of ds) { if (!d || !Number.isInteger(d.round) || d.round < 1) { problems.push('round 형식'); continue; } if (by.has(d.round)) problems.push(`중복 ${d.round}회`); by.set(d.round, d); latest = Math.max(latest, d.round); }
  for (let r = 1; r <= latest; r++) {
    const d = by.get(r);
    if (!d) { problems.push(`구멍 ${r}회`); D.push(null); continue; }
    const n = Array.isArray(d.numbers) ? d.numbers.slice().sort(num) : [];
    const ok = n.length === 6 && n.every((x) => Number.isInteger(x) && x >= 1 && x <= 45) && new Set(n).size === 6 && Number.isInteger(d.bonus) && d.bonus >= 1 && d.bonus <= 45 && !n.includes(d.bonus) && /^\d{8}$/.test(String(d.date));
    if (!ok) problems.push(`형식 ${r}회`);
    D.push({ n, b: d.bonus, date: String(d.date) });
  }
  return { problems, D, latest };
}
function digestUpto(D, upto) {
  const parts = [];
  for (let r = 1; r <= upto; r++) parts.push(r + ':' + D[r].n.join(',') + '+' + D[r].b + ';');
  return fnv(parts.join(''));
}
const cutoffOf = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), CONF.CUTOFF_UTC_H);

/* ═════════════ 신호 — 1..t-1 만 담은 배열 P 로만 계산한다(t 이후는 아예 넘기지 않는다) ═════════════ */
function expectedPools(D, t) {
  const P = D.slice(1, t);                                   // P[i] = i+1 회차
  const win = P.slice(Math.max(0, P.length - CONF.W));
  const cnt = {}, last = {}, prevSet = {};
  for (let n = 1; n <= 45; n++) { cnt[n] = 0; last[n] = 0; prevSet[n] = 0; }
  for (const d of win) for (const x of d.n) cnt[x]++;
  P.forEach((d, i) => { for (const x of d.n) last[x] = i + 1; });
  for (const x of P[P.length - 1].n) prevSet[x] = 1;
  const pick = (key) => {                                    // key 가 클수록 앞. 동점은 (63-n) 항으로 작은 번호가 앞
    const all = []; for (let n = 1; n <= 45; n++) all.push({ n, k: key(n) * 64 + (63 - n) });
    all.sort((a, b) => b.k - a.k);
    return all.slice(0, CONF.POOL).map((e) => e.n).sort(num);
  };
  return {
    hot: pick((n) => cnt[n]),
    cold: pick((n) => 100 - cnt[n]),
    gap: pick((n) => 10000000 - last[n]),
    repeat: pick((n) => prevSet[n] * 100000 + cnt[n])
  };
}
function expectedLines(pool, t, name) {
  const rnd = rng32(sigSeed(t, CONF.SALT[name])), have = new Set(), out = [];
  while (out.length < CONF.LINES) {
    const a = pool.slice();
    for (let i = 0; i < 6; i++) { const k = i + Math.floor(rnd() * (a.length - i)); const tmp = a[k]; a[k] = a[i]; a[i] = tmp; }
    const s = a.slice(0, 6).sort(num).join(',');
    if (!have.has(s)) { have.add(s); out.push(s); }
  }
  return out;
}
function expectedSig(D, t, names) {
  const pools = expectedPools(D, t), o = {};
  for (const s of names) o[s] = { pool: pools[s], lines: expectedLines(pools[s], t, s) };
  return o;
}

/* ═════════════ 채점 · 대조군 ═════════════ */
function gradeSet(lines, d) {
  const inD = new Set(d.n), m = [], bo = []; let g3 = 0;
  for (const s of lines) {
    const a = lineToNums(s); let h = 0;
    for (const x of a) if (inD.has(x)) h++;
    m.push(h); bo.push(a.indexOf(d.b) >= 0 ? 1 : 0);
    if (h >= CONF.MIN_HIT) g3++;
  }
  return { m, bo, g3 };
}
const ctrlMemo = new Map();
function ctrlOf(D, t) {
  if (ctrlMemo.has(t)) return ctrlMemo.get(t);
  const flag = new Uint8Array(46); for (const x of D[t].n) flag[x] = 1;
  const full = new Int32Array(CONF.R), half = new Int32Array(CONF.R), deck = new Uint8Array(45);
  for (let j = 1; j <= CONF.R; j++) {
    const rnd = rng32(ctrlSeed(t, j)); let a10 = 0, a5 = 0;
    for (let L = 0; L < CONF.LINES; L++) {
      for (let i = 0; i < 45; i++) deck[i] = i + 1;
      let h = 0;
      for (let i = 0; i < 6; i++) { const k = i + Math.floor(rnd() * (45 - i)); const v = deck[k]; deck[k] = deck[i]; deck[i] = v; h += flag[v]; }
      if (h >= CONF.MIN_HIT) { a10++; if (L < CONF.SIM_LINES) a5++; }
    }
    full[j - 1] = a10; half[j - 1] = a5;
  }
  const o = { full, half }; ctrlMemo.set(t, o); return o;
}
function weekHist(D, t) { const h = new Array(CONF.LINES + 1).fill(0); for (const k of ctrlOf(D, t).full) h[k]++; return h; }
function sumCtrl(D, rounds, which) { const acc = new Int32Array(CONF.R); for (const t of rounds) { const c = ctrlOf(D, t)[which]; for (let j = 0; j < CONF.R; j++) acc[j] += c[j]; } return acc; }

/* 내 누적 cum 을 대조군 누적 배열과 견준 요약 — 정렬·이분 탐색으로(생성기와 다른 방식) */
function describe(weeks, cum, cums) {
  const s = Array.from(cums).sort(num), R = s.length;
  const lowerBound = (v) => { let lo = 0, hi = R; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  const lb = lowerBound(cum), ub = lowerBound(cum + 1);
  const hist = []; for (let i = 0; i < R;) { let k = i; while (k < R && s[k] === s[i]) k++; hist.push([s[i], k - i]); i = k; }
  return { weeks, cum, n: R, min: s[0], med: s[Math.floor((R - 1) / 2)], max: s[R - 1], rank: 1 + (R - ub), tie: ub - lb, le: ub, ge: R - lb, hist };
}
function expectedGate(D, rows, names) {
  const live = rows.filter((x) => x.status === 'done' && x.late === false);
  const R = CONF.R, nSig = names.length;
  const g3Of = (x, lines) => gradeSet(lines, D[x.r]).g3;
  const recRows = live.filter((x) => x.rec);
  let rec = { weeks: 0, state: 'hold' };
  if (recRows.length) {
    const d = describe(recRows.length, recRows.reduce((s, x) => s + g3Of(x, x.rec.lines), 0), sumCtrl(D, recRows.map((x) => x.r), 'full'));
    const state = d.weeks < CONF.ALARM_MIN_WEEKS ? 'hold' : ((1 + d.le) * CONF.ALARM_P[1] <= CONF.ALARM_P[0] * (R + 1) ? 'alarm' : (d.cum > d.max ? 'above' : 'inside'));
    rec = Object.assign({ state }, d);
  }
  const sig = {}, adopted = [];
  for (const s of names) {
    const rs = live.filter((x) => x.sig && x.sig[s]);
    if (!rs.length) { sig[s] = { weeks: 0, state: 'hold' }; continue; }
    const d = describe(rs.length, rs.reduce((a, x) => a + g3Of(x, x.sig[s].lines), 0), sumCtrl(D, rs.map((x) => x.r), 'full'));
    let state;
    if (d.weeks < CONF.ADOPT_MIN_WEEKS) state = 'hold';
    else if ((1 + d.ge) * CONF.ALPHA[1] * nSig <= CONF.ALPHA[0] * (R + 1)) { state = 'adopt'; adopted.push(s); } else state = 'none';
    sig[s] = Object.assign({ state }, d);
  }
  return { alarm: rec.state === 'alarm', adopted, rec, sig };
}
function expectedReplay(D, latest, names, simRows /* Map|null */) {
  const from = Math.max(2, latest - CONF.REPLAY + 1), rounds = [];
  for (let r = from; r <= latest; r++) rounds.push(r);
  const cum = {}; names.forEach((s) => { cum[s] = 0; });
  let recCum = 0; const recRounds = [];
  for (const r of rounds) {
    const ss = expectedSig(D, r, names);
    names.forEach((s) => { cum[s] += gradeSet(ss[s].lines, D[r]).g3; });
    if (simRows && simRows.has(r)) { recCum += gradeSet(simRows.get(r), D[r]).g3; recRounds.push(r); }
  }
  const base = sumCtrl(D, rounds, 'full'), sig = {};
  names.forEach((s) => { sig[s] = describe(rounds.length, cum[s], base); });
  const rec = recRounds.length ? describe(recRounds.length, recCum, sumCtrl(D, recRounds, 'half')) : null;
  return { label: '돌아보면(사후)', from, to: latest, rounds: rounds.length, lines: CONF.LINES, recLines: CONF.SIM_LINES, rec, sig };
}
function loadSimPicks(sim, latest) {                          // Map(회차 → 줄 5개) — done 행·재현 범위만
  const from = Math.max(2, latest - CONF.REPLAY + 1), m = new Map();
  for (const r of (sim && Array.isArray(sim.rows) ? sim.rows : [])) {
    if (!r || r.status !== 'done' || !Number.isInteger(r.round) || r.round < from || r.round > latest) continue;
    if (!Array.isArray(r.picks) || r.picks.length !== CONF.SIM_LINES) continue;
    const ls = r.picks.map((p) => lineToNums(typeof p === 'string' ? p.split(',').map(Number).sort(num).join(',') : p));
    if (ls.every((x) => x)) m.set(r.round, ls.map((a) => a.join(',')));
  }
  return m;
}

/* ═════════════ 검사 ═════════════ */
function checkStructure(J, text, state) {
  if (!J || typeof J !== 'object') { err('최상위가 객체가 아님'); return; }
  if (Buffer.byteLength(text) >= MAX_BYTES) err(`파일 크기 ${Buffer.byteLength(text)}바이트 ≥ 1MB`);
  if (J.v !== 1) err(`v=${short(J.v)} (기대 1)`);
  if (J.kind !== 'learn-lotto') err(`kind=${short(J.kind)}`);
  if (J.ver !== VER) err(`ver=${short(J.ver)} (기대 ${VER})`);
  if (Object.keys(J).join() !== TOP_KEYS.join()) wrn('최상위 키 순서/구성이 규격과 다름: ' + Object.keys(J).join(','));
  if (typeof J.generated !== 'string' || !Number.isFinite(Date.parse(J.generated))) err('generated 가 ISO 시각이 아님');
  const jr = J.journal;
  if (!jr || !Array.isArray(jr.rows) || !Array.isArray(jr.missed) || !Number.isInteger(jr.from)) { err('journal 모양(from·missed[]·rows[])이 맞지 않음'); state.bad = true; return; }
  if (!J.summary || !J.summary.gate || !J.summary.replay) { err('summary(gate·replay) 없음'); state.bad = true; return; }
  let pr = 0, pend = 0;
  jr.rows.forEach((r, i) => {
    if (!r || !Number.isInteger(r.r) || r.r <= pr) err(`일지 행 #${i} 회차가 오름차순·유일이 아님`);
    if (r) pr = r.r;
    if (!r || (r.status !== 'pending' && r.status !== 'done')) err(`일지 r=${r && r.r} 상태가 pending/done 이 아님`);
    if (r && r.status === 'pending') { pend++; if (i !== jr.rows.length - 1) err(`pending r=${r.r} 이 마지막 행이 아님`); }
    if (r && r.status === 'done') for (const k of ['drawDate', 'late', 'res', 'gradedAt']) if (r[k] === undefined) err(`done r=${r.r} 에 ${k} 없음`);
    if (r && r.status === 'pending') for (const k of ['drawDate', 'late', 'res', 'gradedAt']) if (r[k] !== undefined) err(`pending r=${r.r} 에 ${k} 가 있음`);
  });
  if (pend > 1) err(`pending 이 ${pend}개`);
  if (jr.rows.length && jr.rows[0].r !== jr.from) err(`journal.from ${jr.from} ≠ 첫 행 ${jr.rows[0].r}`);
  const lines = text.split('\n').filter((l) => /^\s*\{"r":\d+,/.test(l)).length;
  if (lines !== jr.rows.length) wrn(`journal.rows 가 한 줄에 한 행이 아님(줄 ${lines} ≠ 행 ${jr.rows.length})`);
  const c = J.checks;
  if (c && ((c.pendingMismatch && c.pendingMismatch.length) || (c.regradeMismatch && c.regradeMismatch.length))) wrn('checks 에 J4/J5 불일치 기록이 있음: ' + short(c));
}

function checkInput(J, H) {
  if (H.problems.length) { err('이력 문제: ' + H.problems.slice(0, 6).join('; ')); return; }
  const s = J.source;
  if (!s || s.latest !== H.latest || s.count !== H.latest) err(`source.latest/count ${short(s && s.latest)}/${short(s && s.count)} ≠ 이력 ${H.latest}`);
  if (!s || s.digest !== digestUpto(H.D, H.latest)) err(`source.digest ${short(s && s.digest)} ≠ 재계산 ${digestUpto(H.D, H.latest)}`);
  const cd = firstDiff(J.conf, CONF, 'conf'); if (cd) err('conf 가 규격과 다름 — ' + cd);
  const rd = firstDiff(J.rules, RULES, 'rules'); if (rd || !Array.isArray(J.rules) || J.rules.length !== RULES.length) err('rules 가 규격과 다름 — ' + (rd || '길이'));
  if (J.summary && J.summary.next !== H.latest + 1) err(`summary.next ${short(J.summary.next)} ≠ ${H.latest + 1}`);
}

function checkSignals(J, H, state) {
  const rows = J.journal.rows;
  rows.forEach((x) => {
    if (x.r < 2 || x.r > H.latest + 1) { err(`r=${x.r} 가 이력 범위 밖`); return; }
    if (x.status === 'pending' && x.r !== H.latest + 1) err(`pending r=${x.r} 가 latest+1(${H.latest + 1}) 이 아님`);
    if (x.status === 'done' && x.r > H.latest) err(`done r=${x.r} 가 latest 보다 뒤`);
    const rule = ruleFor(x.r);
    if (x.ver !== rule.ver) err(`r=${x.r} ver ${short(x.ver)} ≠ 규칙표 ${rule.ver}`);
    if (x.basedOn !== x.r - 1) err(`r=${x.r} basedOn ${short(x.basedOn)} ≠ ${x.r - 1}`);
    if (x.inputDigest !== digestUpto(H.D, x.r - 1)) err(`r=${x.r} inputDigest ${short(x.inputDigest)} ≠ 재계산 ${digestUpto(H.D, x.r - 1)}`);
    if (typeof x.made !== 'string' || !Number.isFinite(Date.parse(x.made))) err(`r=${x.r} made 가 ISO 시각이 아님`);
    const want = expectedSig(H.D, x.r, rule.signals);
    if (!x.sig || Object.keys(x.sig).join() !== rule.signals.join()) { err(`r=${x.r} sig 신호 목록 ${short(x.sig && Object.keys(x.sig))} ≠ ${rule.signals.join()}`); return; }
    for (const s of rule.signals) {
      const d = firstDiff(x.sig[s], want[s], `r=${x.r} sig.${s}`);
      if (d) err('신호 풀/줄이 과거만으로 재계산한 값과 다름 — ' + d);
      else if (new Set(x.sig[s].lines).size !== CONF.LINES) err(`r=${x.r} sig.${s} 줄이 서로 다르지 않음`);
    }
    state.signalsOk = true;
  });
}

function checkRec(J, H, opt, summary, simRows) {
  const rows = J.journal.rows; let withRec = 0;
  rows.forEach((x) => {
    if (x.rec === undefined) return;
    withRec++;
    if (!x.rec || !Array.isArray(x.rec.lines) || x.rec.lines.length !== CONF.LINES || !x.rec.lines.every(lineToNums)) { err(`r=${x.r} rec.lines 가 서로 다른 6개(1..45, 오름차순)의 ${CONF.LINES}줄이 아님`); return; }
    if (new Set(x.rec.lines).size !== CONF.LINES) wrn(`r=${x.r} rec 에 같은 줄이 있음`);
    if (summary && summary.lotto && summary.lotto.next === x.r && Array.isArray(summary.lotto.picks)) {
      const want = summary.lotto.picks.map((p) => (lineToNums(p) ? p : String(p).split(',').map(Number).sort(num).join(',')));
      if (!same(want, x.rec.lines)) wrn(`r=${x.r} rec 가 지금 추천 요약 lotto.picks 와 다름(처음 공개한 값 유지 원칙 — 원인 확인)`);
    }
    if (simRows && simRows.has(x.r) && !same(simRows.get(x.r), x.rec.lines.slice(0, CONF.SIM_LINES))) wrn(`r=${x.r} rec 의 앞 5줄이 모의 원장 A~E 와 다름`);
  });
  note(`rec 가 있는 행 ${withRec}/${rows.length}`);
}

function checkGrading(J, H) {
  J.journal.rows.forEach((x) => {
    if (x.status !== 'done') return;
    const d = H.D[x.r];
    if (!d) { err(`done r=${x.r} 의 이력 없음`); return; }
    if (x.drawDate !== d.date) err(`r=${x.r} drawDate ${short(x.drawDate)} ≠ 이력 ${d.date}`);
    const lateWant = Date.parse(x.made) >= cutoffOf(d.date);
    if (x.late !== lateWant) err(`r=${x.r} late ${short(x.late)} ≠ 재계산 ${lateWant} (made ${short(x.made)} · 마감 ${new Date(cutoffOf(d.date)).toISOString()})`);
    if (typeof x.gradedAt !== 'string' || !Number.isFinite(Date.parse(x.gradedAt))) err(`r=${x.r} gradedAt 이 ISO 시각이 아님`);
    const want = { n: d.n, bonus: d.b };
    if (x.rec) want.rec = gradeSet(x.rec.lines, d);
    want.sig = {}; for (const s of Object.keys(x.sig || {})) want.sig[s] = gradeSet(x.sig[s].lines, d);
    want.ctrl = { n: CONF.R, h: weekHist(H.D, x.r) };
    const df = firstDiff(x.res, want, `r=${x.r} res`);
    if (df) err('채점 결과가 재계산과 다름 — ' + df);
    else if (Object.keys(x.res).join() !== Object.keys(want).join()) wrn(`r=${x.r} res 키 순서가 규격과 다름`);
  });
}

function checkSummary(J, H, simRows) {
  const rows = J.journal.rows, S = J.summary;
  const names = ruleFor(H.latest + 1).signals;
  const wantLive = { done: rows.filter((x) => x.status === 'done').length, late: rows.filter((x) => x.late === true).length, counted: rows.filter((x) => x.status === 'done' && x.late === false).length, pending: rows.filter((x) => x.status === 'pending').length };
  const dl = firstDiff(S.live, wantLive, 'summary.live'); if (dl) err(dl);
  const gate = expectedGate(H.D, rows, names), dg = firstDiff(S.gate, gate, 'summary.gate'); if (dg) err('관문(경보·채택)이 재계산과 다름 — ' + dg);
  else if (Object.keys(S.gate.sig).join() !== names.join()) wrn('gate.sig 키 순서가 규격과 다름');
  const rp = expectedReplay(H.D, H.latest, names, simRows || new Map());
  if (!simRows) { // 모의 원장을 못 읽었으면 재현의 rec 는 대조하지 못한다
    const got = Object.assign({}, S.replay), want = Object.assign({}, rp); delete got.rec; delete want.rec;
    const dr = firstDiff(got, want, 'summary.replay'); if (dr) err('돌아보면(사후) 재현이 재계산과 다름 — ' + dr);
    note('모의 원장을 읽지 못해 재현의 rec 대조 생략');
  } else { const dr = firstDiff(S.replay, rp, 'summary.replay'); if (dr) err('돌아보면(사후) 재현이 재계산과 다름 — ' + dr); }
  note(`관문: 경보 ${gate.alarm} · 채택 [${gate.adopted.join(',')}] · 집계 ${wantLive.counted}주`);
}

/* append-only */
function gitShow(root, ref, rel) { try { return execFileSync('git', ['-C', root, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; } }
const rawRows = (t) => { const m = new Map(); for (const l of t.split('\n')) { const x = /^\s*\{"r":(\d+),/.exec(l); if (x) m.set(+x[1], l.trim().replace(/,$/, '')); } return m; };
function checkAppendOnly(J, text, opt, filePath, root) {
  let prevText = null, label;
  if (opt.prev) { try { prevText = fs.readFileSync(path.resolve(root, opt.prev), 'utf8'); } catch { prevText = null; } label = opt.prev; }
  else { const rel = path.relative(root, filePath).split(path.sep).join('/'); label = `${opt.prevGit}:${rel}`; prevText = rel.startsWith('..') ? null : gitShow(root, opt.prevGit, rel); }
  if (prevText === null) { note(`이전 판 ${label} 를 읽을 수 없어(git 없음·저장소 아님·그 판에 파일 없음) 건너뜀`); return; }
  let H; try { H = JSON.parse(prevText); } catch { note(`이전 판 ${label} 가 JSON 이 아니라 건너뜀`); return; }
  if (!H.journal || !Array.isArray(H.journal.rows)) { note('이전 판에 일지가 없어 건너뜀'); return; }
  if (J.journal.from !== H.journal.from) err(`journal.from ${J.journal.from} ≠ 이전 판 ${H.journal.from}`);
  const curBy = new Map(J.journal.rows.map((r) => [r.r, r]));
  const pr = H.journal.rows.map((r) => r.r), cr = J.journal.rows.map((r) => r.r);
  if (cr.slice(0, pr.length).join() !== pr.join()) err(`일지 행 순서/접두가 이전 판과 다름(행 삭제·재정렬·중간 삽입 금지) — 이전 ${pr.length}행, 지금 앞 ${Math.min(pr.length, cr.length)}행`);
  const FROZEN = ['ver', 'made', 'basedOn', 'inputDigest', 'rec', 'sig'];
  const a = rawRows(prevText), b = rawRows(text); let textOnly = 0;
  for (const p of H.journal.rows) {
    const c = curBy.get(p.r);
    if (!c) { err(`이전 판의 일지 r=${p.r} 가 사라짐(행 삭제 금지)`); continue; }
    if (p.status === 'done') {
      if (!same(c, p)) err(`done 행 r=${p.r} 이 이전 판과 다름(불변 위반)`);
      else if (a.has(p.r) && b.has(p.r) && a.get(p.r) !== b.get(p.r)) textOnly++;
    } else for (const k of FROZEN) if (!same(c[k], p[k])) err(`pending→${c.status} 행 r=${p.r} 의 얼린 필드 ${k} 가 바뀜`);
  }
  if (textOnly) wrn(`done 행 ${textOnly}개가 값은 같지만 글자가 이전 판과 다름 — 바이트 불변 원칙`);
  if (H.journal.missed.join() !== J.journal.missed.slice(0, H.journal.missed.length).join()) err('missed 가 이전 판의 접두 일치가 아님(소급 수정 금지)');
  if (Array.isArray(H.rules)) { if (!same(J.rules.slice(0, H.rules.length), H.rules)) err('rules 가 이전 판의 접두 일치가 아님(덧붙이기만 허용)'); else if (J.rules.length === H.rules.length && H.conf && !same(J.conf, H.conf)) err('conf 가 바뀌었는데 VER·rules 를 올리지 않음'); }
  if (H.source && J.source.latest < H.source.latest) err(`source.latest 가 줄었음 ${H.source.latest}→${J.source.latest}(역행)`);
  note(`이전 판(${label}) 일지 ${H.journal.rows.length}행 대조`);
}

/* 문구 · 화면 */
function blockOf(html, openRe, openTag, closeTag) {
  const m = openRe.exec(html); if (!m) return null;
  const re = new RegExp(`<${openTag}\\b|</${openTag}>`, 'g'); re.lastIndex = m.index; let depth = 0, end = html.length, x;
  while ((x = re.exec(html))) { if (x[0][1] === '/') { depth--; if (depth === 0) { end = x.index + closeTag.length; break; } } else depth++; }
  return html.slice(m.index, end);
}
function checkWording(J, opt, root) {
  const strs = []; (function walk(v) { if (typeof v === 'string') strs.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { strs.push(k); walk(v[k]); } })(J);
  const m = FORBID.exec(strs.join('\n')); if (m) err(`JSON 문자열에 금지 문구 «${m[0]}»`);
  const page = path.resolve(root, opt.page || 'record.html');
  if (!fs.existsSync(page)) { if (opt.page) err(`${opt.page} 가 없음`); else note('record.html 이 없음'); return; }
  const html = fs.readFileSync(page, 'utf8');
  const sec = blockOf(html, /<section\b[^>]*\bid="learnWrap"/, 'section', '</section>');
  const js = (() => { const a = html.indexOf('/* LEARN-BEGIN'), b = html.indexOf('/* LEARN-END'); return a >= 0 && b > a ? html.slice(a, b) : null; })();
  if (!sec) note('record.html 에 #learnWrap 이 아직 없음');
  if (!js) note('record.html 에 학습 JS 구간(LEARN-BEGIN~LEARN-END)이 아직 없음');
  for (const [label, t] of [['#learnWrap', sec], ['학습 JS 구간', js]]) {
    if (!t) continue;
    const f = FORBID.exec(t); if (f) err(`record.html ${label} 에 금지 문구 «${f[0]}»`);
    const th = THEORY.exec(t); if (th) err(`record.html ${label} 에 화면 이론값 말 «${th[0]}» (규칙 9)`);
  }
}
function checkStatic(opt, root) {
  const p = path.resolve(root, opt.ledger || 'scripts/learn-ledger.mjs');
  if (!fs.existsSync(p)) { note(`${path.relative(root, p)} 가 없어 정적 점검 생략`); return; }
  const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');   // 주석을 걷어낸 코드만 본다
  if (/Math\s*\.\s*random/.test(src)) err('생성기가 Math.random 을 씀(결정 함수 금지)');
  const dates = src.split('\n').filter((l) => /\bDate\b/.test(l));
  const bad = dates.filter((l) => !/Date\.parse|Date\.UTC|new Date\(\)\.toISOString\(\)|new Date\(ms\)\.toISOString\(\)/.test(l));
  if (bad.length) err(`생성기의 Date 쓰임이 made·generated·마감 계산 밖: ${bad.slice(0, 2).map((l) => l.trim().slice(0, 60)).join(' | ')}`);
  note(`생성기 Date 쓰임 ${dates.length}줄(모두 Date.parse·Date.UTC·ISO 기록)`);
}

/* ═════════════ 진입점 ═════════════ */
function parseArgs(argv) {
  const o = { root: '.', file: 'brief/learn-lotto.json', history: 'lotto-history.json', summary: null, sim: null, prevGit: null, prev: null, page: null, ledger: null, only: null, skip: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Error(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break; case '--file': o.file = need(); break; case '--history': o.history = need(); break;
      case '--summary': o.summary = need(); break; case '--sim': o.sim = need(); break; case '--prev-git': o.prevGit = need(); break; case '--prev': o.prev = need(); break;
      case '--page': o.page = need(); break; case '--ledger': o.ledger = need(); break;
      case '--only': o.only = need().split(',').map((x) => x.trim().toUpperCase()); break; case '--skip': o.skip = need().split(',').map((x) => x.trim().toUpperCase()); break;
      case '-h': case '--help': console.log('사용: node scripts/check-learn.mjs --root . --file brief/learn-lotto.json --history lotto-history.json [--summary f] [--sim f] [--prev-git HEAD | --prev f] [--page record.html] [--only L2] [--skip L6]'); process.exit(0); break;
      default: throw new Error('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function fatal(msg) { console.log(`::error title=check-learn::${esc(msg)}`); process.exit(1); }

function main() {
  let opt; try { opt = parseArgs(process.argv.slice(2)); } catch (e) { fatal(e.message); }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), filePath = res(opt.file);
  let H; try { H = loadHistory(readJSON(histPath)); } catch (e) { fatal(`이력 ${histPath} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  let text, J; try { text = fs.readFileSync(filePath, 'utf8'); J = JSON.parse(text); } catch (e) { fatal(`${opt.file} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  const t00 = performance.now();
  const summaryPath = res(opt.summary || 'brief/latest-summary.json'), simPath = res(opt.sim || 'brief/sim-lotto.json');
  let summary = null, simRows = null;
  try { if (fs.existsSync(summaryPath)) summary = readJSON(summaryPath); else if (opt.summary) fatal(`--summary ${opt.summary} 가 없음`); } catch (e) { fatal(`추천 요약을 읽을 수 없음: ${e.message}`); }
  try { if (fs.existsSync(simPath)) simRows = loadSimPicks(readJSON(simPath), H.latest); else if (opt.sim) fatal(`--sim ${opt.sim} 가 없음`); } catch (e) { fatal(`모의 원장을 읽을 수 없음: ${e.message}`); }

  const st = { bad: false };
  runCheck('L0', '구조', opt, () => checkStructure(J, text, st));
  runCheck('L1', '입력', opt, () => checkInput(J, H));
  const usable = !H.problems.length && !st.bad;
  const need = (id, title, fn) => { if (!usable) { skipCheck(id, title, '이력 문제 또는 구조 실패'); return; } runCheck(id, title, opt, fn); };
  need('L2', '신호 풀·줄', () => checkSignals(J, H, st));
  need('L3', 'rec', () => checkRec(J, H, opt, summary, simRows));
  need('L4', '채점', () => checkGrading(J, H));
  need('L5', '요약·관문·재현', () => checkSummary(J, H, simRows));
  if (!opt.prevGit && !opt.prev) skipCheck('L6', 'append-only', '--prev-git 또는 --prev 가 없음'); else if (!usable) skipCheck('L6', 'append-only', '구조 실패'); else runCheck('L6', 'append-only', opt, () => checkAppendOnly(J, text, opt, filePath, root));
  runCheck('L7', '문구·화면', opt, () => checkWording(J, opt, root));
  runCheck('L8', '정적', opt, () => checkStatic(opt, root));

  let nErr = 0, nWarn = 0;
  for (const it of R_.items) {
    nErr += it.errors.length; nWarn += it.warnings.length;
    const s = it.skipped ? '생략' : it.errors.length ? `실패 ${it.errors.length}` : '통과';
    console.log(`[${it.id}] ${it.title} — ${s}${it.warnings.length ? ` · 경고 ${it.warnings.length}` : ''} (${(it.ms / 1000).toFixed(1)}s)`);
    for (const n of it.notices) console.log(`  · ${n}`);
  }
  for (const it of R_.items) {
    for (const m of it.errors.slice(0, 12)) console.log(`::error title=check-learn::${esc(`${it.id} ${it.title}: ${m}`)}`);
    if (it.errors.length > 12) console.log(`::error title=check-learn::${esc(`${it.id} …외 ${it.errors.length - 12}건`)}`);
    for (const m of it.warnings.slice(0, 12)) console.log(`::warning title=check-learn::${esc(`${it.id} ${it.title}: ${m}`)}`);
  }
  const secs = ((performance.now() - t00) / 1000).toFixed(1);
  if (nErr) { console.log(`::error title=check-learn::${esc(`학습 장부 독립 검증 실패 — 오류 ${nErr} · 경고 ${nWarn} (${secs}s)`)}`); process.exit(1); }
  console.log(`::notice title=check-learn::${esc(`학습 장부 독립 검증 통과 — ${R_.items.filter((i) => !i.skipped).length}개 검사 · 경고 ${nWarn} · ${secs}s`)}`);
  process.exit(0);
}
main();
