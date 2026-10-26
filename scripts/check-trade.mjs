#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-trade.mjs — 매매 일지(brief/trade-lotto.json) 독립 재계산 검사기 (설계 .lab/revamp/design-final.md §3·§4·§8·§13, U5)

   원칙 — 이 파일은 설계 문서(§3 모델, §4 자료구조, §8 검사 표, §13 확정 패치)만 보고 쓴 «독립 구현»이다.
     · lotto-trade.js · rank-core.js · data-guard.mjs 를 계산에 쓰지 않는다(조합 index·mulberry32·FNV·정수화·동점 사슬·분기한정 열거를
       모두 이 파일 안에서 다시 만든다). 같은 설계를 읽고 따로 만든 두 구현이 같은 값을 내야 통과다(CLAUDE.md 규칙 10).
     · 예외는 C11(누수 탐침)·C12(결정성) 둘뿐이다. 거기서만 `--module`(기본 <root>/lotto-trade.js)과 <root>/rank-core.js 를
       «시험 대상»으로 읽어 별도 vm 컨텍스트에 올린다(계산 결과를 이 검사기의 값으로 쓰지 않고, 모듈끼리 비교하거나 GOLDEN 과 대조만 한다).
       탐침 코드는 컨텍스트 안에서 돌고, 이 프로세스의 전역(Math.random·Date)은 건드리지 않는다.
     · 읽기 전용이다. 종료 코드 0(통과)/1(실패). 실패는 `::error title=check-trade::…` 한 줄씩.

   사용
     node scripts/check-trade.mjs --root . --file brief/trade-lotto.json --history lotto-history.json
          [--rank brief/rank-lotto.json] [--params brief/rank-params-lotto.json] [--prev-git HEAD]
          [--module <lotto-trade.js 경로>] [--print-digests] [--only C3,C4] [--skip C10]
     --module        C11·C12 탐침이 읽을 lotto-trade.js(기본 <root>/lotto-trade.js). 계산 검사(C0~C10·C13)에는 쓰지 않는다(§13-7).
     --print-digests 이력만으로 자체 구현한 source·window·band 지문 세 줄을 찍고 0 으로 끝낸다(--file 불필요).
     --only/--skip   검사 번호를 쉼표로 고른다(개발·부분 확인용. CI 는 쓰지 않는다).
     --rank/--params 없으면(파일도 없을 때) 해당 대조(C2·C6 의 win)를 건너뛰고 ::notice 한 줄을 낸다.

   검사 표(§8)  C0 구조 · C1 입력(이력·source) · C2 가중치 ↔ rank-params · C3 hot/cold 스트림(정확 열거) · C4 pat/rand 스트림 ·
                C5 집계 · C6 정확 순위(win·xr) · C7 무작위 띠·numBand · C8 지문 · C9 일지 · C10 append-only(git) ·
                C11 누수 탐침 · C12 결정성 · C13 문구

   C3 의 열거 — 설계는 «8,145,060 조합 전수 열거» 다. 여기서는 같은 결과를 내는 정확한 방법인 분기한정 열거(가중치 내림차순 위치에서
     부분합 + 남은 칸의 최댓값으로 가지치기)로 상위 2,000 을 만들고, 최신 2회차×2종목은 진짜 전수 열거(6중 루프)로
     «S ≥ 경계−20 인 조합 수가 후보 수와 같음» 을 교차 확인한다(분기한정이 놓친 조합이 없다는 증명). C6 의 «#{s>S+6}·#{|s−S|≤6}» 도
     같은 분기한정 세기(하위 트리 전체가 구간 안/밖이면 조합 수 C(m,k) 로 한 번에 더함)이며 정수 합이라 전수 열거와 정확히 같다.

   경고만 내는 항목(이유 포함)
     · C9 J4(동결 위반: 같은 ver 의 pending/기존 주문이 지금 재계산과 다름) · J5(상금 사후 정정으로 done 행 ret/prizeUsed 가 지금 이력과 다름)
       — 일지는 «처음 공개한 값 동결» 이 원칙이라 엔진도 ::warning 만 낸다. 사람이 원인을 본다. 단 그 행의 당첨 개수(m)·등수(g)는
       추첨 번호라는 사실이므로 어긋나면 error.
     · 키 순서·한 줄 한 행 형식·journal.checks 의 경고 배열이 비어 있지 않음 — 정형·기록 문제라 계산을 막지는 않는다.
     · C10: done 행이 HEAD 와 값은 같고 원문 글자만 다름.
   C10 은 --prev-git 을 줄 때만 돈다. HEAD 에 일지·모듈이 있든 없든 «현재» lotto-trade.js 의 RULES 배열을 늘 먼저 추출해 본다(못 찾으면 error) —
     `const RULES = deepFreeze([…])` 처럼 함수로 감싼 꼴도 받는다. 그래야 첫 실행에서 추출 정규식과 엔진 코드의 불일치가 드러난다.

   설계 문장이 열어 둔 곳에서 고른 해석(바꾸려면 여기와 해당 검사를 같이 고친다)
     · next.date = 마지막 추첨일 + 7일. story.got = t1 까지 누적 환급(t1 포함), spent = L·1000·주수, (s,j) 는 그 회차에 ≥4개 맞힌 구입 줄이 하나라도 있으면 채택.
     · tiers 5~2등 {s,i,t} = 창 전체에서 «그 등수 이상»(설계 §3.7·§3.11 의 f^m = m개 이상, 코드 ≥ 그 등수의 코드)이 처음 나온 줄 번호가 가장 작은 곳(동률이면 집합으로 허용).
       더 높은 등수 줄(예: 2등 줄·1번째 줄의 4개 일치)이 가장 작은 줄 번호여도 낮은 등수의 최근접이 된다 — 그래서 2등 tier 는 6개 일치(코드 7)도 센다.
       2,000줄 안에 없으면(설계 §3.7: xr 은 «hot/cold 이고 f 가 null 일 때만» 구하는 값) 4개(5만원)·5개(3등)는 창 안 hot/cold xr 최선 순위가 가장 작은 곳 {s,rank:[b,w],t},
       5개+보너스(2등)는 null. 1등은 hot/cold 중 최선 순위가 가장 작은 곳 {s,rank:[b,w],t} 이고, 6개 일치 줄이 2,000줄 안에 있으면 {s,i,t} 꼴도 받는다(엔진·record.html 이 두 꼴을 다 쓴다).
     · patOK 요약 = {"3": 개수}(0~3 키가 더 있으면 같이 검증). 무작위 띠 배열은 시드 순서 또는 정렬된 다중집합 둘 다 허용, kstar4 는 다중집합 비교.
     · xr 키 "4","5" 는 f 가 null 일 때만(없으면 안 됨, "3" 은 선택), f 가 있는데 xr 도 있으면 오류. w 허용오차 ±0.05. res.g 는 등수 또는 코드 표기 둘 다 허용.
     · prizeUsed 는 일부 등수만 적어도 되지만, 대체값(PRIZE_FB)이거나 0 인 등수가 맞힌 줄에 있으면 반드시 적어야 한다.
     · K>20 이고 ≥3개 맞힌 줄이 없으면 best.m 은 ≤2 또는 null 을 허용.
   설계에 없는 추가 검사(전부 오류 쪽으로만 엄격해짐)
     · C12: 문서의 selfTest ↔ 지금 모듈의 selfTest() 일치, runSync.window.digest ↔ 이 파일이 따로 만든 window.digest 일치.
     · C11: 감도 확인(t−1 회차를 바꾸면 결과가 달라져야 함 — 탐침이 아무것도 안 보는 빈 시험이 되는 것을 막음).
     · C0: 최상위 키 순서(경고), 파일 크기 1MB 초과(오류).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ═════════════ 상수 — 설계 §5.1 CONF · §13 (코드를 보지 않고 문서에서 옮김) ═════════════ */
export const VER = 'trade-1';
export const RULES = [{ ver: 'trade-1', from: 1 }];
export const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
export const CONF = {
  WINDOW: 50, WARM: 10, KMAX: 2000, KREF: 100, HEAD: 20,
  KS: [5, 10, 20, 50, 100], K0: 5,
  STRATS: ['pat', 'hot', 'cold', 'rand'],
  LADDER: [5, 10, 20, 50, 100, 200, 500, 1000, 2000],
  PT: { 3: 1, 4: 10, 5: 100, 6: 1000 },
  SALT: { pat: 0x50415454, rand: 0x52414e44 },
  BAND: 20, BAND_MUL: 0x85EBCA6B, NUMSALT: 0x4E554D42,
  PRIZE_FB: { 4: 50000, 5: 5000 },
  CUTOFF_UTC_H: 11, JOURNAL_PRIMARY_MIN: 50,
};
const { WINDOW, WARM, KMAX, KREF, HEAD, STRATS } = CONF;
const LITE = 100;                                            // 일지 재계산용 짧은 스트림(점수는 i ≤ KREF 만 쓴다)
const NCOMBO = 8145060, ATOL = 6, SLACK = 20;                // 조합 수 · 동점 허용 · 분기한정 여유(사슬 폭 6 의 두 배 + 여유)
export const BAND_KS = [...new Set([...CONF.KS, ...CONF.LADDER])].sort((a, b) => a - b);
const CODE_RANK = [0, 0, 0, 5, 4, 3, 2, 1];                  // code(3=3개 … 7=6개) → 등수
const CODE_HIT = [0, 0, 0, 3, 4, 5, 5, 6];                   // code → 일치 개수(5+보너스는 5)
const HINT_KEYS = ['carry', 'rep', 'gap', 'heat', 'sum', 'cons', 'odd'];
const TOP_KEYS = ['v', 'kind', 'ver', 'generated', 'source', 'conf', 'selfTest', 'window', 'summary', 'band', 'journal', 'checks'];

/* ═════════════ 기본 도구 ═════════════ */
const imul = Math.imul;
const isInt = (x) => Number.isInteger(x);
const sumOf = (a) => a.reduce((x, y) => x + y, 0);
export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c > 127) throw new Error('fnv: ASCII 만'); h ^= c; h = imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
export function m32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = imul(a ^ (a >>> 15), 1 | a); t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const seedOf = (t, salt) => (imul(t, 0x9E3779B1) ^ salt) >>> 0;
const BIN = []; for (let n = 0; n <= 46; n++) { BIN[n] = []; for (let k = 0; k <= 6; k++) BIN[n][k] = (k === 0) ? 1 : (n === 0 ? 0 : BIN[n - 1][k - 1] + BIN[n - 1][k]); }
const LEX = [];                                              // 사전식 index: LEX[i][v] = Σ_{u=1..v} C(45−u, 5−i)
for (let i = 0; i < 6; i++) { const row = new Float64Array(46); for (let v = 1; v <= 45; v++) row[v] = row[v - 1] + (5 - i <= 45 - v ? BIN[45 - v][5 - i] : 0); LEX.push(row); }
export function comboIndex(a) {                              // a: 오름차순 6개 → 0..8145059 (중첩 루프 n1<…<n6 의 방문 순번)
  let idx = 0, prev = 0;
  for (let i = 0; i < 6; i++) { const v = a[i]; idx += LEX[i][v - 1] - LEX[i][prev]; prev = v; }
  return idx;
}
const consOf = (n) => { let k = 0; for (let i = 1; i < 6; i++) if (n[i] - n[i - 1] === 1) k++; return k; };
const oddOf = (n) => { let k = 0; for (const x of n) if (x % 2) k++; return k; };
const modeOf = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); let bk = null, bv = -1; for (const [k, v] of m) if (v > bv || (v === bv && k < bk)) { bk = k; bv = v; } return bk; };
const short = (v) => { const s = v === undefined ? '없음' : JSON.stringify(v); return s.length > 72 ? s.slice(0, 69) + '…' : s; };
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const addDays = (yyyymmdd, days) => {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  const u = new Date(Date.UTC(y, m - 1, d + days));
  return String(u.getUTCFullYear()).padStart(4, '0') + String(u.getUTCMonth() + 1).padStart(2, '0') + String(u.getUTCDate()).padStart(2, '0');
};
/* got 이 want 의 «알려진 키»를 모두 같게 갖는지(got 의 여분 키는 무시) 첫 차이를 문자열로. 같으면 null */
export function firstDiff(got, want, p = '') {
  if (want === null || typeof want !== 'object') return got === want ? null : `${p || '값'}: ${short(got)} ≠ 기대 ${short(want)}`;
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return `${p}: 배열 아님(${short(got)})`;
    if (got.length !== want.length) return `${p}: 길이 ${got.length} ≠ 기대 ${want.length}`;
    for (let i = 0; i < want.length; i++) { const d = firstDiff(got[i], want[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  if (got === null || typeof got !== 'object' || Array.isArray(got)) return `${p}: 객체 아님(${short(got)})`;
  for (const k of Object.keys(want)) { if (want[k] === undefined) continue; const d = firstDiff(got[k], want[k], p ? p + '.' + k : k); if (d) return d; }
  return null;
}
const sortedNums = (a) => a.slice().sort((x, y) => (x === null) - (y === null) || x - y);   // null 은 +∞ 로 끝에

/* ═════════════ 이력 적재(C1) ═════════════ */
export function loadHistory(obj) {
  const problems = [], D = []; let latest = 0;
  const draws = obj && Array.isArray(obj.draws) ? obj.draws : null;
  if (!draws) return { D, latest: 0, count: 0, problems: ['draws 배열이 없음'], gaps: [] };
  const seen = new Set();
  for (const d of draws) {
    const r = d && d.round;
    if (!isInt(r) || r < 1) { problems.push(`round 형식 ${short(r)}`); continue; }
    if (seen.has(r)) { problems.push(`회차 중복 ${r}`); continue; }
    seen.add(r); if (r > latest) latest = r;
    const n = d.numbers, b = d.bonus;
    const okN = Array.isArray(n) && n.length === 6 && n.every((x, i) => isInt(x) && x >= 1 && x <= 45 && (i === 0 || x > n[i - 1]));
    if (!okN || !isInt(b) || b < 1 || b > 45 || (okN && n.includes(b))) { problems.push(`bad ${r} (번호 6개 오름차순 1..45·보너스 별개)`); continue; }
    const pz = d.prize || {};
    D[r] = { n: n.slice(), b, date: String(d.date || ''), a: ['first', 'second', 'third', 'fourth', 'fifth'].map((k) => (typeof pz[k] === 'number' && Number.isFinite(pz[k]) && pz[k] > 0 ? pz[k] : 0)) };
  }
  const gaps = []; for (let r = 1; r <= latest; r++) if (!D[r]) gaps.push(r);
  if (gaps.length) problems.push(`gap: 구멍 ${gaps.length}회 (${gaps.slice(0, 6).join(',')}${gaps.length > 6 ? '…' : ''})`);
  if (latest < 111) problems.push(`자료 부족: latest ${latest} < 111 (예열 10 + 창 50 + 문맥 50 + 1)`);
  return { D, latest, count: draws.length, problems, gaps };
}

/* ═════════════ 분기한정 열거: 가산 모델 상위 k 줄(hot/cold) — §13-8 ═════════════ */
/* q: 정수 점수표(Float64Array(46)), 반환 {lines, cutoff, ncand}. lines 는 점수 내림차순 사슬(이웃 차 ≤ 6) 순서, 사슬 안은 index 오름차순. */
export function addTop(q, kmax, label = '') {
  const order = []; for (let n = 1; n <= 45; n++) order.push(n);
  order.sort((x, y) => q[y] - q[x] || x - y);
  const qs = new Float64Array(46), cum = new Float64Array(47);
  for (let p = 0; p < 45; p++) { qs[p] = q[order[p]]; cum[p + 1] = cum[p] + qs[p]; }
  const CAP = Math.max(4 * kmax, 4096);
  let lim = -Infinity, cand = [];
  const compact = () => {
    cand.sort((a, b) => b[0] - a[0]);
    if (cand.length >= kmax) { lim = cand[kmax - 1][0] - SLACK; let k = cand.length; while (k > 0 && cand[k - 1][0] < lim) k--; cand.length = k; }
  };
  for (let p1 = 0; p1 <= 39; p1++) { const s1 = qs[p1]; if (s1 + (cum[p1 + 6] - cum[p1 + 1]) < lim) break;
    for (let p2 = p1 + 1; p2 <= 40; p2++) { const s2 = s1 + qs[p2]; if (s2 + (cum[p2 + 5] - cum[p2 + 1]) < lim) break;
      for (let p3 = p2 + 1; p3 <= 41; p3++) { const s3 = s2 + qs[p3]; if (s3 + (cum[p3 + 4] - cum[p3 + 1]) < lim) break;
        for (let p4 = p3 + 1; p4 <= 42; p4++) { const s4 = s3 + qs[p4]; if (s4 + (cum[p4 + 3] - cum[p4 + 1]) < lim) break;
          for (let p5 = p4 + 1; p5 <= 43; p5++) { const s5 = s4 + qs[p5]; if (s5 + (cum[p5 + 2] - cum[p5 + 1]) < lim) break;
            for (let p6 = p5 + 1; p6 <= 44; p6++) { const s = s5 + qs[p6]; if (s < lim) break;
              cand.push([s, ((((p1 * 45 + p2) * 45 + p3) * 45 + p4) * 45 + p5) * 45 + p6]);
              if (cand.length >= CAP) compact();
            } } } } } }
  compact();
  if (cand.length < kmax) throw new Error(`분기한정 후보 부족 ${cand.length} < ${kmax} ${label}`);
  const decode = (key) => { const ps = []; for (let i = 0; i < 6; i++) { ps.push(key % 45); key = Math.floor(key / 45); } return ps.reverse().map((p) => order[p]).sort((x, y) => x - y); };
  const lines = [];
  let g0 = 0;
  while (g0 < cand.length && lines.length < kmax) {
    let g1 = g0 + 1; while (g1 < cand.length && cand[g1 - 1][0] - cand[g1][0] <= ATOL) g1++;
    if (cand[g0][0] - cand[g1 - 1][0] > ATOL) throw new Error(`사슬 폭 ${cand[g0][0] - cand[g1 - 1][0]} > ${ATOL} (${label})`);
    const grp = []; for (let i = g0; i < g1; i++) { const c = decode(cand[i][1]); grp.push([comboIndex(c), c]); }
    grp.sort((a, b) => a[0] - b[0]);
    for (const [, c] of grp) lines.push(c);
    g0 = g1;
  }
  return { lines: lines.slice(0, kmax), cutoff: lim, ncand: cand.length };
}
/* 진짜 전수 열거: 점수 ≥ T 인 조합 수 (분기한정 후보 수 교차 확인용) */
export function bruteCountGE(q, T) {
  let c = 0;
  for (let n1 = 1; n1 <= 40; n1++) { const s1 = q[n1];
    for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 + q[n2];
      for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 + q[n3];
        for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 + q[n4];
          for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 + q[n5];
            for (let n6 = n5 + 1; n6 <= 45; n6++) if (s5 + q[n6] >= T) c++;
          } } } } }
  return c;
}
/* 점수 S 기준 [#{s>S+6}, #{|s−S|≤6}] 진짜 전수 열거(6중 루프) */
export function bruteCount(q, S) {
  const hi = S + ATOL, lo = S - ATOL; let above = 0, near = 0;
  for (let n1 = 1; n1 <= 40; n1++) { const s1 = q[n1];
    for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 + q[n2];
      for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 + q[n3];
        for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 + q[n4];
          for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 + q[n5];
            for (let n6 = n5 + 1; n6 <= 45; n6++) { const s = s5 + q[n6]; if (s > hi) above++; else if (s >= lo) near++; }
          } } } } }
  return [above, near];
}
/* 점수 S 기준 [#{s>S+6}, #{|s−S|≤6}] — 하위 트리가 통째로 구간 안/밖이면 C(m,k) 를 한 번에 더한다(정수 합이라 전수 열거와 같다).
   S 가 분포 한가운데면 가지치기가 듣지 않으므로 노드 예산(BUDGET)을 넘으면 전수 열거로 넘어간다 — 결과는 같다. */
export function makeCounter(q) {
  const mn = [], mx = [];                                    // mn[s][k] = 번호 s..45 중 q 가장 작은 k개 합, mx = 가장 큰 k개 합
  for (let s = 1; s <= 46; s++) {
    const arr = []; for (let n = s; n <= 45; n++) arr.push(q[n]);
    arr.sort((a, b) => a - b);
    const a1 = [0], a2 = [0];
    for (let k = 1; k <= 6; k++) { a1.push(k <= arr.length ? a1[k - 1] + arr[k - 1] : NaN); a2.push(k <= arr.length ? a2[k - 1] + arr[arr.length - k] : NaN); }
    mn[s] = a1; mx[s] = a2;
  }
  const BUDGET = 60000;
  return (S) => {
    const hi = S + ATOL, lo = S - ATOL; let above = 0, near = 0, nodes = 0;
    const rec = (start, k, ps) => {
      if (++nodes > BUDGET) throw BUDGET_EXCEEDED;
      if (k === 0) { if (ps > hi) above++; else if (ps >= lo) near++; return; }
      const m = 46 - start; if (m < k) return;
      const a = ps + mn[start][k], b = ps + mx[start][k];
      if (a > hi) { above += BIN[m][k]; return; }
      if (b < lo) return;
      if (a >= lo && b <= hi) { near += BIN[m][k]; return; }
      for (let n = start; n <= 46 - k; n++) rec(n + 1, k - 1, ps + q[n]);
    };
    try { rec(1, 6, 0); } catch (e) { if (e !== BUDGET_EXCEEDED) throw e; return bruteCount(q, S); }
    return [above, near];
  };
}
const BUDGET_EXCEEDED = { budget: true };
/* 가중치 → 정수 점수표(§13-8 1~3) */
export function quantize(w) {
  const lw = new Float64Array(46); let M = 0;
  for (let n = 1; n <= 45; n++) { lw[n] = Math.log(w[n]); if (Math.abs(lw[n]) > M) M = Math.abs(lw[n]); }
  let bits = 46; while (bits > 0 && 6 * M * Math.pow(2, bits) >= 9007199254740992) bits--;
  const scale = Math.pow(2, bits), q = new Float64Array(46);
  for (let n = 1; n <= 45; n++) q[n] = Math.round(lw[n] * scale);
  return { q, bits };
}

/* ═════════════ 지문(§13-1) ═════════════ */
export function sourceDigest(D, upto) { let s = ''; for (let r = 1; r <= upto; r++) s += r + ':' + D[r].n.join(',') + '+' + D[r].b + ';'; return fnv(s); }
const CTXs = (c) => [c.carry, c.q1, c.q3, c.cons, c.odd].join(',');
const HVs = (v) => [v.carry, v.rep, v.gap, v.heat, v.sum[0], v.sum[1], v.cons, v.odd].join(',');
export const rowLine = (r) => r.t + '|' + STRATS.map((s) => s + ':' + r.s[s].h.join(',') + ';' + r.s[s].p.join(',')).join('|') + '|' + r.sc.join(',') + '|' + CTXs(r.ctx) + '|' + HVs(r.hint.v) + '|' + r.hint.hit.join('') + '|' + r.patOK + '\n';
export const nextLine = (x) => 'N' + x.t + '|' + STRATS.map((s) => s + ':' + x.s[s].h.join(',') + ';').join('|') + '|' + x.sc.join(',') + '|' + CTXs(x.ctx) + '|' + HVs(x.hint.v) + '\n';
export const windowDigest = (rows, next, ver = VER) => fnv(ver + '\n' + rows.map(rowLine).join('') + nextLine(next));
export function bandDigest(posBand, from, to) {              // posBand[j-1][t] = 희소 기록 배열
  let s = 'band-1\n';
  for (let j = 1; j <= CONF.BAND; j++) for (let t = from; t <= to; t++) s += j + '|' + t + '|' + posBand[j - 1][t].join(',') + '\n';
  return fnv(s);
}

/* ═════════════ 계산기: 이력 한 벌에서 설계 §3 의 모든 값을 다시 만든다 ═════════════ */
export function makeCalc(D, latest) {
  const from = latest - WINDOW + 1;
  const memoCtx = new Map(), memoHint = new Map(), memoScan = new Map(), memoQ = new Map(), memoCounter = new Map();
  const prize = (t, rank) => { if (rank < 1 || rank > 5) return 0; const a = D[t].a[rank - 1]; return a > 0 ? a : (CONF.PRIZE_FB[rank] || 0); };

  /* §3.1 문맥 */
  function ctxAt(t) {
    let c = memoCtx.get(t); if (c) return c;
    const carry = [], sums = [], cons = [], odd = [];
    for (let r = t - WINDOW; r < t; r++) {
      const n = D[r].n, p = D[r - 1].n; let k = 0; for (const x of n) if (p.includes(x)) k++;
      carry.push(k); sums.push(sumOf(n)); cons.push(consOf(n)); odd.push(oddOf(n));
    }
    const s = sums.slice().sort((a, b) => a - b);
    c = { carry: modeOf(carry), q1: s[12], q3: s[37], cons: modeOf(cons), odd: modeOf(odd) };
    memoCtx.set(t, c); return c;
  }
  function histOf(t) {                                        // 문맥 50회의 분포 · 전체 기준선
    const carryH = new Array(7).fill(0), consH = new Array(6).fill(0), oddH = new Array(7).fill(0);
    for (let r = t - WINDOW; r < t; r++) { const n = D[r].n, p = D[r - 1].n; let k = 0; for (const x of n) if (p.includes(x)) k++; carryH[k]++; consH[consOf(n)]++; oddH[oddOf(n)]++; }
    return { carryH, consH, oddH };
  }
  function hintAt(t) {
    let h = memoHint.get(t); if (h) return h;
    const c = ctxAt(t), prev = D[t - 1].n;
    const f10 = new Array(46).fill(0); for (let r = t - 10; r < t; r++) for (const n of D[r].n) f10[n]++;
    const last = new Array(46).fill(0); for (let r = 1; r < t; r++) for (const n of D[r].n) last[n] = r;
    const rep = prev.slice().sort((a, b) => f10[b] - f10[a] || a - b)[0];
    let gap = 1; for (let n = 2; n <= 45; n++) if (last[n] < last[gap]) gap = n;
    let heat = 1; for (let n = 2; n <= 45; n++) if (f10[n] > f10[heat]) heat = n;
    h = { v: { carry: c.carry, rep, gap, heat, sum: [c.q1, c.q3], cons: c.cons, odd: c.odd }, gapOf: t - 1 - last[gap], heatOf: f10[heat] };
    memoHint.set(t, h); return h;
  }
  function hintHits(v, t) {                                   // v 를 t 회 실제 번호로 채점 [7]
    const n = D[t].n, p = D[t - 1].n; let k = 0; for (const x of n) if (p.includes(x)) k++;
    const sm = sumOf(n);
    return [k === v.carry, n.includes(v.rep), n.includes(v.gap), n.includes(v.heat), sm >= v.sum[0] && sm <= v.sum[1], consOf(n) === v.cons, oddOf(n) === v.odd].map(Number);
  }
  function numBand() {                                        // §13-10
    const out = [];
    for (let j = 1; j <= CONF.BAND; j++) {
      const salt = (CONF.NUMSALT ^ imul(j, CONF.BAND_MUL)) >>> 0; let c = 0;
      for (let t = from; t <= latest; t++) { const num = 1 + Math.floor(m32(seedOf(t, salt))() * 45); if (D[t].n.includes(num)) c++; }
      out.push(c);
    }
    return out;
  }

  /* §3.3 스트림 */
  function weights(kind, t) {
    const w = new Array(46).fill(1);
    if (kind === 'hot') {
      const f = new Array(46).fill(0); for (let r = Math.max(1, t - 52); r < t; r++) for (const n of D[r].n) f[n]++;
      for (let n = 1; n <= 45; n++) w[n] = Math.pow(Math.max(1, f[n]), 2.2);
    } else {
      const last = new Array(46).fill(0); for (let r = 1; r < t; r++) for (const n of D[r].n) last[n] = r;
      for (let n = 1; n <= 45; n++) { const g = last[n] ? t - 1 - last[n] : t - 1; w[n] = Math.pow(1 + g, 1.6); }
    }
    return w;
  }
  function quantW(kind, t) { const k = kind + '|' + t; let x = memoQ.get(k); if (!x) { x = quantize(weights(kind, t)); memoQ.set(k, x); } return x; }
  function patLines(t, kmax) {
    const P = ctxAt(t), rng = m32(seedOf(t, CONF.SALT.pat));
    const Pa = D[t - 1].n.slice(), Qa = []; for (let n = 1; n <= 45; n++) if (!Pa.includes(n)) Qa.push(n);
    const out = [], seen = new Set(); let tries = 0;
    while (out.length < kmax) {
      if (++tries > 400 * KMAX) throw new Error('pat stall ' + t);
      const c = [];
      for (let i = 0; i < P.carry; i++) { const j = i + Math.floor(rng() * (6 - i)); const x = Pa[i]; Pa[i] = Pa[j]; Pa[j] = x; c.push(Pa[i]); }
      for (let i = 0; i <= 5 - P.carry; i++) { const j = i + Math.floor(rng() * (39 - i)); const x = Qa[i]; Qa[i] = Qa[j]; Qa[j] = x; c.push(Qa[i]); }
      c.sort((x, y) => x - y);
      const sm = sumOf(c); if (sm < P.q1 || sm > P.q3) continue;
      if (consOf(c) !== P.cons) continue;
      const ix = comboIndex(c); if (seen.has(ix)) continue;
      seen.add(ix); out.push(c);
    }
    return out;
  }
  function randLines(t, salt, kmax) {
    const rng = m32(seedOf(t, salt)), A = []; for (let i = 1; i <= 45; i++) A.push(i);
    const out = [], seen = new Set();
    while (out.length < kmax) {
      for (let i = 0; i < 6; i++) { const j = i + Math.floor(rng() * (45 - i)); const x = A[i]; A[i] = A[j]; A[j] = x; }
      const c = A.slice(0, 6).sort((x, y) => x - y), ix = comboIndex(c);
      if (seen.has(ix)) continue;
      seen.add(ix); out.push(c);
    }
    return out;
  }
  function codeOf(c, W, flag) {
    const h = flag[c[0]] + flag[c[1]] + flag[c[2]] + flag[c[3]] + flag[c[4]] + flag[c[5]];
    if (h < 3) return [h, 0];
    if (h === 6) return [h, 7];
    if (h === 5) return [h, c.includes(W.b) ? 6 : 5];
    return [h, h];
  }
  function gradeLines(lines, t) {                             // → {p, hh}
    const W = D[t], flag = new Uint8Array(46); for (const n of W.n) flag[n] = 1;
    const p = [], hh = [];
    for (let i = 0; i < lines.length; i++) {
      const [h, code] = codeOf(lines[i], W, flag);
      if (i < HEAD) hh.push(h);
      if (code) p.push((i + 1) * 8 + code);
    }
    return { p, hh };
  }
  /* 스캔 기록: {kmax, h[20], hc[20 combos], p?, hh?, q?, bb?} — t > latest 이면 p·hh 없음 */
  function scan(s, t, kmax) {
    const key = s + '|' + t, m = memoScan.get(key);
    if (m && m.kmax >= kmax) return m;
    let lines, extra = {};
    if (s === 'pat') lines = patLines(t, kmax);
    else if (s === 'rand') lines = randLines(t, CONF.SALT.rand, kmax);
    else { const qi = quantW(s, t); const r = addTop(qi.q, kmax, `${s} ${t}`); lines = r.lines; extra = { q: qi.q, bits: qi.bits, bb: { cutoff: r.cutoff, ncand: r.ncand } }; }
    const rec = { kmax, h: lines.slice(0, HEAD).map(comboIndex), hc: lines.slice(0, HEAD), ...extra };
    if (t <= latest) Object.assign(rec, gradeLines(lines, t));
    memoScan.set(key, rec); return rec;
  }
  /* f^m: 스트림에서 m개 이상 일치한 첫 줄 번호(없으면 null) */
  const fOf = (rec, m) => { for (const e of rec.p) if (CODE_HIT[e & 7] >= m) return e >> 3; return null; };

  /* §3.5 점수·배분 */
  const hitScore = (rec) => { let v = 0; for (const e of rec.p) { if ((e >> 3) > KREF) break; v += CONF.PT[CODE_HIT[e & 7]]; } return v; };
  const memoSc = new Map();
  function scOf(t, kmax = LITE) {
    let v = memoSc.get(t); if (v) return v;
    v = STRATS.map((s) => { let x = 0; for (let u = t - WARM; u < t; u++) x += hitScore(scan(s, u, kmax)); return x; });
    memoSc.set(t, v); return v;
  }
  function allocOf(sc, K) {
    const a = [1, 1, 1, 1];
    for (let k = 0; k < K - 4; k++) { let b = 0; for (let x = 1; x < 4; x++) if ((sc[x] + 1) * a[b] > (sc[b] + 1) * a[x]) b = x; a[b]++; }
    return a;
  }
  const wPct = (sc) => { const tot = sumOf(sc) + 4; return sc.map((x) => Math.round(1000 * (x + 1) / tot) / 10); };

  /* §3.6 포트폴리오 실행 */
  function runPortfolio(allocFn) {
    const rows = [];
    for (let t = from; t <= latest; t++) {
      const a = allocFn(t); let ret = 0, n4 = 0, bestPos = 0, bestHead = 0; const cnt = [0, 0, 0, 0, 0, 0], lines4 = [];
      for (let si = 0; si < 4; si++) {
        const s = STRATS[si], rec = scan(s, t, KMAX), lim = a[si];
        for (const e of rec.p) {
          const i = e >> 3; if (i > lim) break;
          const code = e & 7, rk = CODE_RANK[code];
          ret += prize(t, rk); cnt[rk]++;
          if (code >= 4) { n4++; lines4.push({ s, i }); }
          if (CODE_HIT[code] > bestPos) bestPos = CODE_HIT[code];
        }
        for (let i = 0; i < Math.min(lim, HEAD); i++) if (rec.hh[i] > bestHead) bestHead = rec.hh[i];
      }
      rows.push({ t, a, ret, cnt, n4, lines4, bestPos, bestHead });
    }
    return rows;
  }
  const fundAlloc = (K) => (t) => allocOf(scOf(t), K);
  const eqAlloc = (K) => () => allocOf([0, 0, 0, 0], K);
  const soloAlloc = (s, K) => () => STRATS.map((x) => (x === s ? K : 0));
  function summarize(rows, K) {
    let ret = 0, E = 0, Pk = 0, mdd = 0, dry = 0, dryMax = 0, dry4 = 0, first4 = null, n4 = 0;
    const cnt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, first = { 5: null, 4: null, 3: null, 2: null, 1: null }, cum = {};
    let bm = -1, bn = 0;
    for (const r of rows) {
      ret += r.ret; E += r.ret - 1000 * K; if (E > Pk) Pk = E; if (Pk - E > mdd) mdd = Pk - E;
      cum[r.t] = ret;
      dry = r.ret > 0 ? 0 : dry + 1; if (dry > dryMax) dryMax = dry;
      dry4 = r.n4 > 0 ? 0 : dry4 + 1;
      if (r.n4 > 0 && first4 === null) first4 = r.t;
      n4 += r.n4;
      for (let k = 1; k <= 5; k++) { cnt[k] += r.cnt[k]; if (r.cnt[k] > 0 && first[k] === null) first[k] = r.t; }
      const b = K <= HEAD ? Math.max(r.bestHead, r.bestPos) : r.bestPos;
      if (b > bm) { bm = b; bn = 1; } else if (b === bm) bn++;
    }
    return { spend: 1000 * K * rows.length, ret, net: ret - 1000 * K * rows.length, cnt, first, best: { m: bm, n: bn }, mdd, dryMax, dryNow: dry, dry4, first4, n4, cum };
  }
  function kstarOf() {
    const out = {};
    for (const s of STRATS) {
      let k = null, tt = null;
      for (let t = from; t <= latest; t++) { const f = fOf(scan(s, t, KMAX), 4); if (f !== null && (k === null || f < k)) { k = f; tt = t; } }
      out[s] = k === null ? null : { k, t: tt };
    }
    return out;
  }
  /* §3.8 무작위 띠 */
  function bandPos() {
    const pos = [];
    for (let j = 1; j <= CONF.BAND; j++) {
      const salt = (CONF.SALT.rand ^ imul(j, CONF.BAND_MUL)) >>> 0, byT = {};
      for (let t = from; t <= latest; t++) byT[t] = gradeLines(randLines(t, salt, KMAX), t).p;
      pos.push(byT);
    }
    return pos;
  }
  function soloOnPos(byT, K) {
    let net = 0, n4 = 0, f4 = null;
    for (let t = from; t <= latest; t++) {
      let ret = 0;
      for (const e of byT[t]) { const i = e >> 3; if (i > K) break; const code = e & 7; ret += prize(t, CODE_RANK[code]); if (code >= 4) { n4++; if (f4 === null) f4 = t; } }
      net += ret - 1000 * K;
    }
    return { net, n4, first4: f4 };
  }
  function bandOf(pos) {
    const K = {};
    for (const k of BAND_KS) { const xs = pos.map((p) => soloOnPos(p, k)); K[k] = { net: xs.map((x) => x.net), n4: xs.map((x) => x.n4), first4: xs.map((x) => x.first4) }; }
    const kstar4 = pos.map((byT) => {
      let k = null, tt = null;
      for (let t = from; t <= latest; t++) for (const e of byT[t]) if ((e & 7) >= 4) { const i = e >> 3; if (k === null || i < k) { k = i; tt = t; } break; }
      return k === null ? null : { k, t: tt };
    });
    return { n: CONF.BAND, K, kstar4, digest: bandDigest(pos, from, latest) };
  }

  /* §3.7 정확 순위(win·xr) */
  function counterOf(s, t) { const key = s + '|' + t; let c = memoCounter.get(key); if (!c) { c = makeCounter(scan(s, t, KMAX).q); memoCounter.set(key, c); } return c; }
  const memoRank = new Map();
  function rankOfCombo(s, t, c) {
    const q = scan(s, t, KMAX).q; let S = 0; for (const n of c) S += q[n];
    const key = s + '|' + t + '|' + S, m = memoRank.get(key); if (m) return m;
    const [above, near] = counterOf(s, t)(S), r = [above + 1, above + near];
    memoRank.set(key, r); return r;
  }
  function mBest(s, t, m) {                                   // m개 이상 맞는 조합 중 Σq 최대(동률이면 index 작은 것)
    const q = scan(s, t, KMAX).q, W = D[t].n, X = []; for (let n = 1; n <= 45; n++) if (!W.includes(n)) X.push(n);
    const byQ = (a, b) => q[b] - q[a] || a - b;
    const tw = W.slice().sort(byQ), tx = X.sort(byQ);
    let best = null, bs = -Infinity, bi = Infinity;
    for (let j = m; j <= 6; j++) {
      const c = tw.slice(0, j).concat(tx.slice(0, 6 - j)).sort((x, y) => x - y);
      let S = 0; for (const n of c) S += q[n]; const ix = comboIndex(c);
      if (S > bs || (S === bs && ix < bi)) { bs = S; bi = ix; best = c; }
    }
    return best;
  }
  const winRank = (s, t) => rankOfCombo(s, t, D[t].n);
  const xrRank = (s, t, m) => rankOfCombo(s, t, mBest(s, t, m));

  /* 창 행 · 다음 행 · 요약 · 도전 사다리 */
  function rowOf(t) {
    const s = {}; for (const k of STRATS) { const r = scan(k, t, KMAX); s[k] = { h: r.h, p: r.p }; }
    const hv = hintAt(t), hit = hintHits(hv.v, t);
    return { t, date: D[t].date, n: D[t].n.slice(), b: D[t].b, a: D[t].a.slice(), sc: scOf(t), s, ctx: ctxAt(t), hint: { v: hv.v, hit }, patOK: hit[0] + hit[4] + hit[5] };
  }
  function picksFor(t, K, sc) {
    const a = allocOf(sc, K), picks = [];
    STRATS.forEach((s, si) => { const rec = scan(s, t, LITE); for (let i = 1; i <= a[si]; i++) picks.push({ s, i, c: rec.hc[i - 1].slice() }); });
    return { a, picks };
  }
  function nextOf(btRow) {                                    // btRow: 창 50행(hint.hit 합산용)
    const t = latest + 1, s = {}; for (const k of STRATS) s[k] = { h: scan(k, t, KMAX).h };
    const hv = hintAt(t), c = ctxAt(t), H = histOf(t);
    const bt = {}; HINT_KEYS.forEach((k, i) => { bt[k] = sumOf(btRow.map((r) => r.hint.hit[i])); });
    let nC = 0, nS = 0, nK = 0, nO = 0, N = 0;
    for (let r = 2; r <= latest; r++) {
      const n = D[r].n, p = D[r - 1].n; let k = 0; for (const x of n) if (p.includes(x)) k++; N++;
      if (k === c.carry) nC++; const sm = sumOf(n); if (sm >= c.q1 && sm <= c.q3) nS++; if (consOf(n) === c.cons) nK++; if (oddOf(n) === c.odd) nO++;
    }
    const sc = scOf(t);
    return {
      t, date: D[latest].date.length === 8 ? addDays(D[latest].date, 7) : '', sc, s, ctx: c,
      hint: { v: hv.v, stat: { carryHist: H.carryH, consHist: H.consH, oddHist: H.oddH, bt, base: { carry: [nC, N], sum: [nS, N], cons: [nK, N], odd: [nO, N], numBand: numBand() }, gapOf: hv.gapOf, heatOf: hv.heatOf } },
      picks5: picksFor(t, CONF.K0, sc).picks,
    };
  }

  /* 일지 행(기대값) — 설계 §4.1 */
  function journalPending(r, madeIso) {
    const sc = scOf(r), { a, picks } = picksFor(r, CONF.K0, sc);
    const top = {}; for (const s of STRATS) top[s] = scan(s, r, LITE).hc.slice(0, 5).map((c) => c.slice());
    return { r, ver: ruleFor(r).ver, status: 'pending', made: madeIso, basedOn: r - 1, inputDigest: sourceDigest(D, r - 1), K: CONF.K0, alloc: a, w: wPct(sc), picks, top, ctx: ctxAt(r), hint: { v: hintAt(r).v } };
  }
  function hitsAgainst(c, t) { let h = 0; for (const x of c) if (D[t].n.includes(x)) h++; return h; }
  function rankAgainst(c, t) { const h = hitsAgainst(c, t); if (h === 6) return 1; if (h === 5) return c.includes(D[t].b) ? 2 : 3; if (h === 4) return 4; if (h === 3) return 5; return 0; }
  function gradeRow(row) {                                    // row.picks/top/hint.v(얼린 값)를 D[row.r] 로 채점
    const r = row.r, m = row.picks.map((p) => hitsAgainst(p.c, r)), g = row.picks.map((p) => rankAgainst(p.c, r));
    const top = {}; for (const s of STRATS) top[s] = (row.top[s] || []).map((c) => hitsAgainst(c, r));
    const prizeUsed = {}; let ret = 0;
    g.forEach((rk) => { if (rk > 0) { prizeUsed[rk] = prize(r, rk); ret += prizeUsed[rk]; } });
    return { m, g, ret, best: Math.max(0, ...m), top, hintHit: hintHits(row.hint.v, r), prizeUsed };
  }
  const lateOf = (madeIso, drawDate) => Date.parse(madeIso) >= Date.UTC(+drawDate.slice(0, 4), +drawDate.slice(4, 6) - 1, +drawDate.slice(6, 8), CONF.CUTOFF_UTC_H, 0, 0);

  return { D, latest, from, prize, ctxAt, histOf, hintAt, hintHits, numBand, weights, quantW, scan, fOf, scOf, allocOf, wPct, runPortfolio, fundAlloc, eqAlloc, soloAlloc, summarize,
    kstarOf, bandPos, bandOf, soloOnPos, winRank, xrRank, mBest, rowOf, nextOf, picksFor, journalPending, gradeRow, hitsAgainst, rankAgainst, lateOf, patLines, randLines };
}

/* 요약(summary) 기대값 — K 마다 · 사다리 · kstar · tiers · patOK · randTop. band 가 있어야 bandRank 가 채워진다 */
export function buildSummary(C, rows, band) {
  const { latest, from } = C;
  const out = { K: {}, ladder: { fund: {}, pat: {}, hot: {}, cold: {}, rand: {} } };
  const fundRuns = {}, soloRuns = {};
  for (const L of CONF.LADDER) {
    fundRuns[L] = C.runPortfolio(C.fundAlloc(L));
    const sm = C.summarize(fundRuns[L], L); out.ladder.fund[L] = { first4: sm.first4, n4: sm.n4, net: sm.net };
    soloRuns[L] = {};
    for (const s of STRATS) { const r = C.runPortfolio(C.soloAlloc(s, L)), x = C.summarize(r, L); soloRuns[L][s] = r; out.ladder[s][L] = { first4: x.first4, n4: x.n4, net: x.net }; }
  }
  out.kstar = C.kstarOf();
  const storyOf = (K, sm, runs) => {
    const hit = (L) => { const rs = L === K ? runs : fundRuns[L]; return { sm: L === K ? sm : C.summarize(rs, L), rs }; };
    const mk = (tier, L, x) => {
      const t = x.sm.first4, week = t - from + 1, row = x.rs.find((r) => r.t === t);
      return { tier, k: L, t, week, spent: L * 1000 * week, got: x.sm.cum[t], lines: row.lines4 };
    };
    if (sm.first4 !== null) return mk('K', K, { sm, rs: runs });
    for (const L of CONF.LADDER) if (L > K) { const x = hit(L); if (x.sm.first4 !== null) return mk('ladder', L, x); }
    let bk = null;
    for (const s of STRATS) { const ks = out.kstar[s]; if (ks && (bk === null || ks.k < bk.k || (ks.k === bk.k && ks.t < bk.t))) bk = { s, k: ks.k, t: ks.t }; }
    if (bk) { const ties = STRATS.filter((s) => out.kstar[s] && out.kstar[s].k === bk.k && out.kstar[s].t === bk.t); return { tier: 'hindsight', k: bk.k, t: bk.t, ties }; }
    return { tier: 'nearest' };
  };
  const bandNets = band ? band.K : null;
  for (const K of CONF.KS) {
    const runs = fundRuns[K] || C.runPortfolio(C.fundAlloc(K)), sm = C.summarize(runs, K);
    const eq = C.runPortfolio(C.eqAlloc(K)); let er = 0, es = 0;
    runs.forEach((r, i) => { if (r.ret !== eq[i].ret) { er++; es += r.ret - eq[i].ret; } });
    const solo = C.summarize(soloRuns[K] ? soloRuns[K].rand : C.runPortfolio(C.soloAlloc('rand', K)), K);
    out.K[K] = {
      spend: sm.spend, ret: sm.ret, net: sm.net, cnt: sm.cnt, first: sm.first, best: sm.best, mdd: sm.mdd, dryMax: sm.dryMax, dryNow: sm.dryNow, dry4: sm.dry4,
      effect: { rounds: er, sum: es }, randSolo: { net: solo.net, cnt: solo.cnt, first: solo.first },
      bandRank: bandNets ? 1 + bandNets[K].net.filter((x) => x > sm.net).length : null,
      story: storyOf(K, sm, runs),
    };
  }
  /* tiers: 등수별 «2,000줄 안 최근접»(창 전체·4종목) — 그 등수 «이상»(f^m, m개 이상: 코드 ≥ codeOfRank[rk])이었던 줄의 최소 번호(§3.7·§3.11) */
  const codeOfRank = { 5: 3, 4: 4, 3: 5, 2: 6, 1: 7 };
  const nearestIn2000 = (rk) => {
    let mi = null, ties = [];
    for (const s of STRATS) for (let t = from; t <= latest; t++) for (const e of C.scan(s, t, KMAX).p) {
      if ((e & 7) < codeOfRank[rk]) continue;                 // «이상»: 정확히 그 코드만 세면 더 높은 등수 줄이 가장 작은 줄일 때 어긋난다
      const i = e >> 3; if (mi === null || i < mi) { mi = i; ties = []; } if (i === mi) ties.push({ s, i, t });
      break;
    }
    return mi === null ? null : { first: ties.slice().sort((a, b) => a.t - b.t || STRATS.indexOf(a.s) - STRATS.indexOf(b.s))[0], ties };
  };
  out.tiers = {};
  for (const rk of [5, 4, 3, 2]) out.tiers[rk] = nearestIn2000(rk);
  /* 2,000줄 밖 대체(설계 §3.7: 정확한 첫 등장 순위 xr 은 «hot/cold 이고 f 가 null 일 때만» 구하는 값 — 곧 이 최근접이 비었을 때 쓰는 값):
     4개(5만원, m=4)·5개(3등, m=5)는 창 안 hot/cold 의 xr 최선 순위가 가장 작은 곳. 5개+보너스(2등)는 대체가 없다(null). */
  out.tiersFb = {};
  for (const rk of [4, 3]) {
    if (out.tiers[rk] !== null) continue;
    const m = rk === 3 ? 5 : 4; let fb = null;
    for (const s of ['hot', 'cold']) for (let t = from; t <= latest; t++) {
      const x = C.xrRank(s, t, m);
      if (!fb || x[0] < fb.min) fb = { min: x[0], list: [] };
      if (x[0] === fb.min) fb.list.push({ s, t, rank: x });
    }
    out.tiersFb[rk] = fb;
  }
  out.tiersNear1 = nearestIn2000(1);                          // 6개 일치 줄이 2,000줄 안에 있으면 엔진·화면은 {s,i,t} 꼴로 보인다(record.html 은 rank·i 두 꼴을 다 받는다)
  let best1 = null;
  for (const s of ['hot', 'cold']) for (let t = from; t <= latest; t++) {
    const rk = rows ? rows.find((r) => r.t === t).win[s] : C.winRank(s, t);
    if (!best1 || rk[0] < best1.min) best1 = { min: rk[0], list: [] };
    if (rk[0] === best1.min) best1.list.push({ s, t, rank: rk });
  }
  out.tiers[1] = best1 ? { min: best1.min, list: best1.list } : null;
  /* 무작위 종목 단독 1위 회차 · 패턴 3조건 분포 */
  const rowsAll = rows || [];
  out.randTop = rowsAll.filter((r) => { const mx = Math.max(...r.sc); return r.sc[3] === mx && r.sc.filter((x) => x === mx).length === 1; }).length;
  const po = { 0: 0, 1: 0, 2: 0, 3: 0 }; rowsAll.forEach((r) => { po[r.patOK]++; }); out.patOK = po;
  return out;
}

/* ═════════════ 결과 수집 ═════════════ */
const R = { items: [], cur: null };
const err = (m) => R.cur.errors.push(m), wrn = (m) => R.cur.warnings.push(m), note = (m) => R.cur.notices.push(m);
function runCheck(id, title, opt, fn) {
  if (opt.only && !opt.only.includes(id)) return;
  if (opt.skip && opt.skip.includes(id)) { R.items.push({ id, title, errors: [], warnings: [], notices: ['--skip 으로 생략'], skipped: true, ms: 0 }); return; }
  const it = { id, title, errors: [], warnings: [], notices: [], skipped: false, ms: 0 };
  R.cur = it; const t0 = performance.now();
  try { fn(); } catch (e) { it.errors.push('예외: ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' ⏎ ') : e)); }
  it.ms = performance.now() - t0; R.items.push(it); R.cur = null;
}
function skipCheck(id, title, why, opt) { if (opt && opt.only && !opt.only.includes(id)) return; R.items.push({ id, title, errors: [], warnings: [], notices: [why], skipped: true, ms: 0 }); }
const getp = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
/* 같은 종류의 불일치를 모아 «n건: 첫 몇 개» 한 줄로 */
function collect(label, list, max = 3) { if (!list.length) return; err(`${label} ${list.length}건 불일치 — ${list.slice(0, max).join(' / ')}${list.length > max ? ' …' : ''}`); }

/* ═════════════ 검사 본문 ═════════════ */
function checkStructure(J, H, E) {                            // C0
  const need = (c, m) => { if (!c) err(m); };
  need(J.v === 1, `v=${short(J.v)} (1 이어야 함)`); need(J.kind === 'trade-lotto', `kind=${short(J.kind)}`);
  need(J.ver === VER, `ver=${short(J.ver)} (이 검사기는 ${VER} 규칙만 압니다)`);
  need(typeof J.generated === 'string' && !Number.isNaN(Date.parse(J.generated)), 'generated 가 ISO 시각이 아님');
  need(typeof J.selfTest === 'string' && /^fnv:[0-9a-f]{8}$/.test(J.selfTest), `selfTest 형식 ${short(J.selfTest)}`);
  const cd = firstDiff(J.conf, CONF, 'conf'); if (cd) err('conf: ' + cd);
  const keys = Object.keys(J), missing = TOP_KEYS.filter((k) => !(k in J)); if (missing.length) err(`최상위 키 없음: ${missing.join(',')}`);
  const order = keys.filter((k) => TOP_KEYS.includes(k)), want = TOP_KEYS.filter((k) => keys.includes(k));
  if (order.join() !== want.join()) wrn(`최상위 키 순서가 설계와 다름: ${order.join(',')}`);
  const s = J.source || {}, w = J.window || {};
  need(isInt(s.latest) && isInt(s.count), 'source.latest/count 가 정수가 아님');
  const rows = Array.isArray(w.rows) ? w.rows : null;
  if (!rows) { err('window.rows 가 배열이 아님'); return; }
  need(rows.length === WINDOW, `window.rows ${rows.length}개 (${WINDOW}개여야 함)`);
  need(w.from === H.latest - WINDOW + 1 && w.to === H.latest, `window from/to ${w.from}..${w.to} (기대 ${H.latest - WINDOW + 1}..${H.latest})`);
  { const badT = []; rows.forEach((r, i) => { if (r.t !== H.latest - WINDOW + 1 + i) badT.push(`[${i}] t=${short(r.t)} (기대 ${H.latest - WINDOW + 1 + i})`); }); collect('window.rows 의 t 가 연속이 아님(행 누락·순서)', badT); }
  const chkS = (where, st, wantPos) => {
    if (!st || !Array.isArray(st.h) || st.h.length !== HEAD) { err(`${where}: head 가 ${HEAD}줄이 아님`); return; }
    if (new Set(st.h).size !== HEAD) err(`${where}: head 에 같은 조합이 있음`);
    if (!st.h.every((x) => isInt(x) && x >= 0 && x < NCOMBO)) err(`${where}: head index 범위 밖`);
    if (!wantPos) return;
    if (!Array.isArray(st.p)) { err(`${where}: p 가 배열이 아님`); return; }
    let prev = 0;
    for (const e of st.p) { const i = e >> 3, code = e & 7; if (!isInt(e) || i <= prev || i > KMAX || code < 3 || code > 7) { err(`${where}: pos 값 ${short(e)} (i 오름차순 1..${KMAX}, code 3..7)`); return; } prev = i; }
  };
  rows.forEach((r) => { for (const k of STRATS) chkS(`window.rows t=${r.t} ${k}`, r.s && r.s[k], true); });
  const nx = J.window.next;
  if (!nx || typeof nx !== 'object') { err('window.next 가 없음'); } else {
    need(nx.t === H.latest + 1, `next.t=${short(nx.t)} (기대 ${H.latest + 1})`);
    for (const k of STRATS) chkS(`next ${k}`, nx.s && nx.s[k], false);
    need(Array.isArray(nx.picks5) && nx.picks5.length === CONF.K0, `next.picks5 가 ${CONF.K0}장이 아님`);
  }
  for (const k of ['summary', 'band', 'journal', 'checks']) need(J[k] && typeof J[k] === 'object', `${k} 가 객체가 아님`);
  const jr = J.journal && J.journal.rows;
  if (!Array.isArray(jr)) err('journal.rows 가 배열이 아님'); else {
    let prev = 0, pend = 0;
    for (const r of jr) {
      if (!isInt(r.r) || r.r <= prev) err(`journal r=${short(r.r)} 가 오름차순·유일이 아님`); prev = isInt(r.r) ? r.r : prev;
      if (r.status === 'pending') pend++; else if (r.status !== 'done') err(`journal r=${r.r} status=${short(r.status)}`);
    }
    need(pend <= 1, `pending 이 ${pend}개 (1개 이하여야 함)`);
  }
  /* 형식 경고 — 한 줄 한 행 · 크기 */
  if (E.text != null) {
    const lines = E.text.split('\n');
    const wl = lines.filter((l) => /^\s*\{\s*"t"\s*:\s*\d+\s*,/.test(l)).length; if (wl !== WINDOW) wrn(`window.rows 가 한 줄에 한 행이 아님(행으로 시작하는 줄 ${wl} ≠ ${WINDOW})`);
    const jl = lines.filter((l) => /^\s*\{\s*"r"\s*:\s*\d+\s*,/.test(l)).length; if (jl !== (jr ? jr.length : 0)) wrn(`journal.rows 가 한 줄에 한 행이 아님(행으로 시작하는 줄 ${jl} ≠ ${jr ? jr.length : 0})`);
    if (Buffer.byteLength(E.text) >= 1000000) err(`파일 크기 ${Buffer.byteLength(E.text)}바이트 ≥ 1MB (CLAUDE.md 규칙 4)`);
  }
}

function checkInput(J, H, histPath) {                      // C1
  const s = J.source || {};
  if (H.problems.length) { for (const p of H.problems) err('이력: ' + p); return; }
  if (s.latest !== H.latest) err(`source.latest=${short(s.latest)} ≠ 이력 latest ${H.latest}`);
  if (s.count !== H.count) err(`source.count=${short(s.count)} ≠ 이력 ${H.count}`);
  const d = sourceDigest(H.D, H.latest); if (s.digest !== d) err(`source.digest ${short(s.digest)} ≠ 재계산 ${d}`);
  if (s.file !== path.basename(histPath)) wrn(`source.file=${short(s.file)} (이력 파일 이름 ${path.basename(histPath)})`);
}

function checkWeights(C, H, params) {                         // C2
  if (!params) { note('rank-params 가 없어 가중치 대조 생략'); return; }
  const rowsP = params.rows || {}; let n = 0; const bad = [];
  for (let t = C.from - WARM; t <= H.latest + 1; t++) {
    const pr = rowsP[t]; if (!pr) continue;
    for (const kind of ['hot', 'cold']) {
      const mine = C.weights(kind, t), theirs = pr[kind]; if (!theirs) continue; n++;
      for (let k = 1; k <= 45; k++) { const rel = Math.abs(mine[k] - theirs[k]) / Math.max(1e-300, Math.abs(mine[k])); if (!(rel <= 1e-12)) { bad.push(`${kind} ${t} n=${k}: ${mine[k]} vs ${theirs[k]}`); break; } }
    }
  }
  if (!n) note('rank-params 와 겹치는 회차가 없음'); else note(`가중치 ${n}벌 대조`);
  collect('가중치 ↔ rank-params', bad);
}

function checkStreams(J, C, H, kinds, id) {                   // C3(hot,cold) · C4(pat,rand)
  const bad = [], rows = J.window.rows;
  for (const t of Array.from({ length: WINDOW + WARM + 1 }, (_, i) => C.from - WARM + i)) {
    for (const s of kinds) {
      let rec; try { rec = C.scan(s, t, KMAX); } catch (e) { err(`${s} ${t}: ${e.message}`); continue; }
      if (t >= C.from && t <= H.latest) {
        const jr = rows.find((r) => r.t === t); if (!jr || !jr.s || !jr.s[s]) continue;
        const dh = firstDiff(jr.s[s].h, rec.h, 'h'); if (dh) bad.push(`${s} ${t} head ${dh}`);
        const dp = firstDiff(jr.s[s].p, rec.p, 'p'); if (dp) bad.push(`${s} ${t} pos ${dp}`);
      } else if (t === H.latest + 1) {
        const nx = J.window.next; if (!nx || !nx.s || !nx.s[s]) continue;
        const dh = firstDiff(nx.s[s].h, rec.h, 'h'); if (dh) bad.push(`${s} next ${t} head ${dh}`);
      }
    }
  }
  collect(`${id} 스트림`, bad);
  if (id === 'C3') {                                          // 진짜 전수 열거 교차 확인(최신 2회차 × hot/cold)
    for (const t of [H.latest, H.latest + 1]) for (const s of kinds) {
      const rec = C.scan(s, t, KMAX), cut = rec.bb.cutoff, n = bruteCountGE(rec.q, cut);
      if (n !== rec.bb.ncand) err(`${s} ${t}: 전수 열거 ${n}개 ≠ 분기한정 후보 ${rec.bb.ncand}개(경계 ${cut} 이상)`);
    }
    note('전수 열거 교차 확인: 최신 2회차 × hot/cold');
  }
}

function expectedRowsAndNext(C, H) {
  const rows = []; for (let t = C.from; t <= H.latest; t++) rows.push(C.rowOf(t));
  for (const r of rows) { r.win = {}; for (const s of ['hot', 'cold']) r.win[s] = C.winRank(s, r.t); }
  const next = C.nextOf(rows);
  return { rows, next };
}

function checkAggregate(J, C, H, X) {                         // C5
  const jr = J.window.rows, bad = [];
  for (const e of X.rows) {
    const r = jr.find((x) => x.t === e.t); if (!r) { bad.push(`t=${e.t} 행 없음`); continue; }
    for (const k of ['date', 'n', 'b', 'a', 'sc', 'ctx', 'patOK']) { const d = firstDiff(r[k], e[k], k); if (d) bad.push(`t=${e.t} ${d}`); }
    const dh = firstDiff(r.hint, e.hint, 'hint'); if (dh) bad.push(`t=${e.t} ${dh}`);
  }
  collect('행 값(date·n·b·a·sc·ctx·hint·patOK)', bad);
  const nx = J.window.next || {}, en = X.next, nb = [];
  for (const k of ['t', 'date', 'sc', 'ctx']) { const d = firstDiff(nx[k], en[k], k); if (d) nb.push(d); }
  const dv = firstDiff(nx.hint && nx.hint.v, en.hint.v, 'hint.v'); if (dv) nb.push(dv);
  const ds = firstDiff(nx.hint && nx.hint.stat, en.hint.stat, 'hint.stat'); if (ds) nb.push(ds);
  const dp = firstDiff(nx.picks5, en.picks5, 'picks5'); if (dp) nb.push(dp);
  collect('next', nb);
  /* 요약 */
  const S = X.summary, JS = J.summary || {}, sb = [];
  for (const K of CONF.KS) {
    const e = S.K[K], g = JS.K && JS.K[K]; if (!g) { sb.push(`K=${K} 없음`); continue; }
    for (const k of ['spend', 'ret', 'net', 'cnt', 'first', 'mdd', 'dryMax', 'dryNow', 'dry4', 'effect', 'randSolo', 'bandRank']) { if (e[k] === null && !(k in g)) continue; const d = firstDiff(g[k], e[k], `K${K}.${k}`); if (d) sb.push(d); }
    if (K > HEAD && e.best.m <= 2) { if (!(g.best && (g.best.m === null || g.best.m <= 2))) sb.push(`K${K}.best: m=${short(g.best && g.best.m)} (기대 2개 이하)`); }
    else { const d = firstDiff(g.best, e.best, `K${K}.best`); if (d) sb.push(d); }
    const gs = g.story, es = e.story;
    if (!gs) { sb.push(`K${K}.story 없음`); continue; }
    if (gs.tier !== es.tier) { sb.push(`K${K}.story.tier ${short(gs.tier)} ≠ 기대 ${es.tier}`); continue; }
    if (es.tier === 'K' || es.tier === 'ladder') {
      for (const k of ['k', 't', 'week', 'spent', 'got']) if (gs[k] !== es[k]) sb.push(`K${K}.story.${k} ${short(gs[k])} ≠ 기대 ${es[k]}`);
      if (!es.lines.some((l) => l.s === gs.s && l.i === gs.j)) sb.push(`K${K}.story 줄 ${short(gs.s)}#${short(gs.j)} 는 그 회차에 산 4개 이상 일치 줄이 아님(기대 ${es.lines.slice(0, 3).map((l) => l.s + '#' + l.i).join(',')})`);
    } else if (es.tier === 'hindsight') {
      for (const k of ['k', 't']) if (gs[k] !== es[k]) sb.push(`K${K}.story.${k} ${short(gs[k])} ≠ 기대 ${es[k]}`);
      if (gs.s !== undefined && !es.ties.includes(gs.s)) sb.push(`K${K}.story.s ${short(gs.s)} ≠ 기대 ${es.ties.join('|')}`);
    }
  }
  const dl = firstDiff(JS.ladder, S.ladder, 'ladder'); if (dl) sb.push(dl);
  const dk = firstDiff(JS.kstar, S.kstar, 'kstar'); if (dk) sb.push(dk);
  if (JS.randTop !== S.randTop) sb.push(`randTop ${short(JS.randTop)} ≠ 기대 ${S.randTop}`);
  for (const k of Object.keys(JS.patOK || {})) if (JS.patOK[k] !== S.patOK[k]) sb.push(`patOK.${k} ${short(JS.patOK[k])} ≠ 기대 ${S.patOK[k]}`);
  if (!JS.patOK || !('3' in JS.patOK)) sb.push('patOK["3"] 없음');
  /* tiers — 동점이면 후보 집합 안에서 받는다 */
  const T = S.tiers, JT = JS.tiers || {};
  const lineOk = (e, g) => !!g && g.rank === undefined && e.ties.some((x) => x.s === g.s && x.i === g.i && x.t === g.t);                    // {s,i,t} 꼴: 동률 집합 안
  const rankOk = (e, g) => !!g && !!g.rank && g.rank[0] === e.min && e.list.some((x) => x.s === g.s && x.t === g.t && x.rank[0] === g.rank[0] && x.rank[1] === g.rank[1]); // {s,rank:[b,w],t} 꼴: 최선 순위 동률 집합 안
  const showL = (e) => e.ties.slice(0, 3).map((x) => `${x.s}#${x.i}@${x.t}`).join('|'), showR = (e) => `최소 best ${e.min} 중 ${e.list.slice(0, 2).map((x) => `${x.s}@${x.t}[${x.rank}]`).join('|')}`;
  for (const rk of [5, 4, 3, 2]) {
    const g = JT[rk], e = T[rk];
    if (e === null) {
      const fb = S.tiersFb[rk];                                // 2,000줄 안에 없을 때: 4·5개는 xr 순위 꼴, 2등은 null
      if (!fb) { if (g !== null && g !== undefined) sb.push(`tiers.${rk} ${short(g)} (기대 null — 2,000줄 안에 없음)`); }
      else if (!g) sb.push(`tiers.${rk} 없음(2,000줄 안에 없어 xr 순위 꼴 기대: ${showR(fb)})`);
      else if (!rankOk(fb, g)) sb.push(`tiers.${rk} ${short(g)} ≠ 기대(2,000줄 밖) ${showR(fb)}`);
      continue;
    }
    if (!g) { sb.push(`tiers.${rk} 없음(기대 ${e.first.s}#${e.first.i} ${e.first.t}회)`); continue; }
    if (!lineOk(e, g)) sb.push(`tiers.${rk} ${short(g)} ≠ 기대 ${showL(e)}`);
  }
  const g1 = JT[1], e1 = T[1], n1 = S.tiersNear1;
  if (e1 && !g1) sb.push('tiers.1 없음');
  else if (e1 && !(rankOk(e1, g1) || (n1 && lineOk(n1, g1)))) sb.push(`tiers.1 ${short(g1)} ≠ 기대 ${n1 ? `(6개 일치 줄이 2,000줄 안에 있음) ${showL(n1)} 또는 ` : ''}${showR(e1)}`);
  collect('요약', sb, 4);
}

function checkExact(J, C, H, X) {                             // C6
  const bad = [], jr = J.window.rows;
  for (const e of X.rows) {
    const r = jr.find((x) => x.t === e.t); if (!r) continue;
    const dw = firstDiff(r.win, e.win, 'win'); if (dw) bad.push(`t=${e.t} ${dw}`);
    const xr = r.xr || {};
    for (const s of ['hot', 'cold']) {
      const rec = C.scan(s, e.t, KMAX), got = xr[s] || {};
      for (const m of [3, 4, 5, 6]) {
        const f = C.fOf(rec, m), [b, w] = m === 6 ? e.win[s] : C.xrRank(s, e.t, m);
        if (f !== null && !(b <= f && f <= w)) bad.push(`t=${e.t} ${s} m=${m}: f=${f} 가 [${b},${w}] 밖(best ≤ f ≤ worst 위반)`);
        if (m === 3 || m === 6) { if (m === 3 && got['3'] !== undefined && f === null) { const d = firstDiff(got['3'], [b, w], 'xr3'); if (d) bad.push(`t=${e.t} ${s} ${d}`); } continue; }
        if (f === null) { const d = firstDiff(got[m], [b, w], `xr.${s}.${m}`); if (d) bad.push(`t=${e.t} ${d}`); }
        else if (got[m] !== undefined) bad.push(`t=${e.t} xr.${s}.${m} 가 있음(2,000줄 안에 있으면 쓰지 않음, f=${f})`);
      }
    }
  }
  collect('win/xr', bad);
}

function checkRankFile(C, H, rank) {                          // C6 의 rank-lotto.json 대조
  if (!rank) { note('rank-lotto.json 이 없어 win 대조 생략'); return; }
  const bad = []; let n = 0;
  for (const rr of rank.rows || []) {
    if (rr.round < C.from || rr.round > H.latest) continue;
    for (const s of ['hot', 'cold']) { const g = rr.ranks && rr.ranks[s]; if (!g) continue; n++; const [b, w] = C.winRank(s, rr.round); if (g.best !== b || g.worst !== w) bad.push(`${s} ${rr.round}: rank-lotto [${g.best},${g.worst}] ≠ 내 열거 [${b},${w}]`); }
  }
  note(`rank-lotto.json ${n}칸 대조`); collect('win ↔ rank-lotto.json', bad);
}

function checkBand(J, C, H, Bnd) {                            // C7
  const jb = J.band || {}, bad = [];
  if (jb.n !== CONF.BAND) bad.push(`band.n=${short(jb.n)} (기대 ${CONF.BAND})`);
  for (const k of BAND_KS) {
    const g = jb.K && jb.K[k], e = Bnd.K[k]; if (!g) { bad.push(`band.K.${k} 없음`); continue; }
    for (const f of ['net', 'n4', 'first4']) {
      if (!Array.isArray(g[f]) || g[f].length !== CONF.BAND) { bad.push(`band.K.${k}.${f} 길이`); continue; }
      const direct = firstDiff(g[f], e[f]), sorted = firstDiff(sortedNums(g[f]), sortedNums(e[f]));
      if (direct && sorted) bad.push(`band.K.${k}.${f}: ${sorted}`);
    }
  }
  const key = (x) => (x === null ? 'null' : x.k + '@' + x.t);
  if (!Array.isArray(jb.kstar4) || jb.kstar4.length !== CONF.BAND) bad.push('band.kstar4 길이');
  else if (jb.kstar4.map(key).join() !== Bnd.kstar4.map(key).join() && jb.kstar4.map(key).sort().join() !== Bnd.kstar4.map(key).sort().join()) bad.push(`band.kstar4: ${short(jb.kstar4.slice(0, 3))}… ≠ 기대 ${short(Bnd.kstar4.slice(0, 3))}…`);
  collect('띠', bad);
  const nxt = J.window && J.window.next, nb = nxt && nxt.hint && nxt.hint.stat && nxt.hint.stat.base && nxt.hint.stat.base.numBand;
  const dn = firstDiff(nb, C.numBand(), 'numBand'); if (dn) err('numBand ' + dn);
  /* 띠 digest 는 C8 에서 */
}

function checkDigests(J, C, H, X, Bnd) {                      // C8
  const w = J.window || {}, rows = X.rows;
  const wd = windowDigest(rows, X.next);
  if (w.digest !== wd) err(`window.digest ${short(w.digest)} ≠ 재계산 ${wd}`);
  try { const own = windowDigest(w.rows, w.next); if (own !== w.digest) err(`window.digest ${short(w.digest)} ≠ 파일 안 행들로 만든 지문 ${own} (행을 고친 흔적)`); } catch (e) { err('파일 안 행으로 지문을 만들 수 없음: ' + e.message); }
  if (J.band && J.band.digest !== Bnd.digest) err(`band.digest ${short(J.band.digest)} ≠ 재계산 ${Bnd.digest}`);
  note(`source ${sourceDigest(H.D, H.latest)} · window ${wd} · band ${Bnd.digest}`);
}

/* ───────── C9 일지 ───────── */
function checkJournal(J, C, H, X) {
  const j = J.journal || {}, rows = j.rows || [], latest = H.latest, D = H.D;
  const rowsJ = rows.map((r) => r.r), missed = Array.isArray(j.missed) ? j.missed : [];
  if (!Array.isArray(j.missed)) err('journal.missed 가 배열이 아님');
  if (!rows.length) { err('journal.rows 가 비어 있음(첫 실행도 latest+1 pending 1행을 만든다)'); return; }
  if (j.from !== rows[0].r) err(`journal.from=${short(j.from)} ≠ 첫 행 r=${rows[0].r}`);
  /* 연속성(missed 제외) */
  const have = new Set(rowsJ), mset = new Set(missed);
  if (missed.some((x, i) => !isInt(x) || (i && x <= missed[i - 1]))) err('journal.missed 가 오름차순 정수가 아님');
  for (let r = rows[0].r; r <= rows[rows.length - 1].r; r++) { if (have.has(r) && mset.has(r)) err(`r=${r} 이 행과 missed 에 모두 있음`); else if (!have.has(r) && !mset.has(r)) err(`r=${r} 이 행에도 missed 에도 없음(소급 누락)`); }
  for (const m of missed) if (have.has(m) === false && (m < rows[0].r || m > rows[rows.length - 1].r)) err(`missed ${m} 가 일지 범위 밖`);
  /* 마지막 행 = latest+1 pending, 나머지는 done */
  const last = rows[rows.length - 1];
  if (last.r !== latest + 1 || last.status !== 'pending') err(`마지막 행이 ${latest + 1}회 pending 이어야 함(실제 r=${last.r} ${last.status})`);
  rows.slice(0, -1).forEach((r) => { if (r.status !== 'done') err(`r=${r.r} 이 ${r.status} (마지막 행 말고는 done 이어야 함)`); });
  const picksOf = (p) => (p || []).map((x) => `${x.s}#${x.i}:${(x.c || []).join('.')}`).join(' ');
  const J4 = [], J5 = [];
  for (const row of rows) {
    const r = row.r, tag = `r=${r}`;
    if (!isInt(r) || r < 62 || r > latest + 1) { err(`${tag} 범위 밖`); continue; }
    if (row.ver !== ruleFor(r).ver) err(`${tag} ver=${short(row.ver)} ≠ ruleFor(${r})=${ruleFor(r).ver}`);
    if (row.K !== CONF.K0) err(`${tag} K=${short(row.K)} ≠ ${CONF.K0}`);
    if (row.basedOn !== r - 1) err(`${tag} basedOn=${short(row.basedOn)} ≠ ${r - 1}`);
    const idg = sourceDigest(D, r - 1); if (row.inputDigest !== idg) err(`${tag} inputDigest ${short(row.inputDigest)} ≠ 이력 1..${r - 1} 지문 ${idg}`);
    if (typeof row.made !== 'string' || Number.isNaN(Date.parse(row.made))) err(`${tag} made 가 ISO 시각이 아님`);
    /* 얼린 주문의 내부 일관성(error) — alloc 합 = K, picks 수·종목·줄 번호 */
    if (!Array.isArray(row.alloc) || row.alloc.length !== 4 || sumOf(row.alloc) !== CONF.K0 || row.alloc.some((x) => !isInt(x) || x < 1)) err(`${tag} alloc ${short(row.alloc)} 이 K=${CONF.K0} 배분이 아님`);
    const want = []; if (Array.isArray(row.alloc)) STRATS.forEach((s, si) => { for (let i = 1; i <= row.alloc[si]; i++) want.push(s + '#' + i); });
    const gotP = (row.picks || []).map((x) => x.s + '#' + x.i);
    if (gotP.join() !== want.join()) err(`${tag} picks 구성 ${gotP.join(',')} ≠ alloc 기대 ${want.join(',')}`);
    if (!row.top || STRATS.some((s) => !Array.isArray(row.top[s]) || row.top[s].length !== 5)) err(`${tag} top 이 종목마다 5줄이 아님`);
    /* 재계산 대조(J4: 동결 위반은 경고) */
    try {
      const exp = C.journalPending(r, row.made);
      const diffs = ['alloc', 'w', 'picks', 'top', 'ctx', 'hint'].map((k) => {
        if (k === 'w') { const ok = Array.isArray(row.w) && row.w.length === 4 && row.w.every((x, i) => Math.abs(x - exp.w[i]) <= 0.0501); return ok ? null : `w ${short(row.w)} ≠ ${short(exp.w)}`; }
        return firstDiff(row[k], exp[k], k);
      }).filter(Boolean);
      if (diffs.length) J4.push(`r=${r} ${diffs[0]}`);
    } catch (e) { err(`${tag} 재계산 실패: ${e.message}`); }
    if (row.status === 'pending') {
      if (r === latest + 1) {
        const dpn = firstDiff(picksOf(row.picks), picksOf(X.next.picks5)); if (dpn) J4.push(`pending r=${r} 주문이 next.picks5 와 다름`);
      }
      for (const k of ['res', 'gradedAt', 'drawDate', 'late', 'prizeUsed']) if (k in row) err(`${tag} pending 인데 ${k} 가 있음`);
      continue;
    }
    /* done: 채점 필드 */
    for (const k of ['drawDate', 'late', 'prizeUsed', 'res', 'gradedAt']) if (!(k in row)) err(`${tag} done 인데 ${k} 가 없음`);
    if (!row.res) continue;
    if (row.drawDate !== D[r].date) err(`${tag} drawDate=${short(row.drawDate)} ≠ 이력 ${D[r].date}`);
    else if (row.late !== C.lateOf(row.made, row.drawDate)) err(`${tag} late=${short(row.late)} ≠ made ${row.made} vs ${row.drawDate} 20:00 KST 기준 ${C.lateOf(row.made, row.drawDate)}`);
    if (typeof row.gradedAt !== 'string' || Number.isNaN(Date.parse(row.gradedAt))) err(`${tag} gradedAt 이 ISO 시각이 아님`);
    const g = C.gradeRow(row), res = row.res;
    for (const k of ['m', 'best', 'top', 'hintHit']) { const d = firstDiff(res[k], g[k], k); if (d) err(`${tag} res.${d}`); }
    const gOk = Array.isArray(res.g) && res.g.length === g.g.length && (res.g.every((x, i) => x === g.g[i]) || res.g.every((x, i) => x === [0, 7, 6, 5, 4, 3][g.g[i]]));
    if (!gOk) err(`${tag} res.g ${short(res.g)} ≠ 등수 ${short(g.g)} (또는 code)`);
    /* ret: 얼린 prizeUsed(없는 등수는 지금 규칙)로 합산한 값과 같아야 한다(error). 지금 이력의 규칙과 다르면 상금 사후 정정(J5 경고) */
    const pu = row.prizeUsed || {}; let retFrozen = 0;
    for (const rk of g.g) if (rk > 0) retFrozen += (pu[rk] !== undefined ? pu[rk] : C.prize(r, rk));
    if (res.ret !== retFrozen) err(`${tag} res.ret=${short(res.ret)} ≠ prizeUsed 로 합산한 ${retFrozen}`);
    for (const k of Object.keys(pu)) { if (!/^[1-5]$/.test(k)) err(`${tag} prizeUsed 키 ${k}`); else if (pu[k] !== C.prize(r, +k)) J5.push(`r=${r} prizeUsed[${k}]=${pu[k]} ≠ 지금 이력 ${C.prize(r, +k)}`); }
    for (const rk of g.g) if (rk > 0 && pu[rk] === undefined && !(D[r].a[rk - 1] > 0)) err(`${tag} ${rk}등 상금을 대체값(또는 0)으로 쓰는데 prizeUsed[${rk}] 가 없음`);
    if (res.ret !== g.ret && !J5.some((x) => x.startsWith(`r=${r} `))) J5.push(`r=${r} res.ret=${res.ret} ≠ 지금 이력 규칙 ${g.ret}`);
  }
  for (const m of J4.slice(0, 5)) wrn('J4 동결 대조 ' + m); if (J4.length > 5) wrn(`J4 …외 ${J4.length - 5}건`);
  for (const m of J5.slice(0, 5)) wrn('J5 재채점 대조 ' + m); if (J5.length > 5) wrn(`J5 …외 ${J5.length - 5}건`);
  const ck = J.checks || {};
  for (const k of ['kept', 'added', 'graded']) if (!isInt(ck[k])) err(`checks.${k}=${short(ck[k])} 가 정수가 아님`);
  for (const k of ['pendingMismatch', 'regradeMismatch']) { if (!Array.isArray(ck[k])) err(`checks.${k} 가 배열이 아님`); else if (ck[k].length) wrn(`checks.${k} ${short(ck[k])} — 엔진이 동결 불일치를 기록함`); }
  note(`일지 ${rows.length}행(done ${rows.filter((r) => r.status === 'done').length}, 늦음 ${rows.filter((r) => r.late).length}, missed ${missed.length})`);
}

/* ───────── C10 append-only (git) ───────── */
function gitShow(root, ref, rel) {
  try { return execFileSync('git', ['-C', root, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; }
}
/* 소스에서 `RULES` 배열 리터럴을 꺼낸다. RULES = [ · RULES: [ 뿐 아니라 함수 호출로 감싼 꼴(deepFreeze([…]) · Object.freeze([…]) · 중첩 호출)도 받는다.
   엔진은 const RULES = deepFreeze([…]) 다. 감싸는 호출을 못 받으면 HEAD 에 일지가 생긴 다음 회차부터 C10 이 매번 «RULES 를 찾지 못함» 으로 실패한다. */
export function extractRules(src) {
  const m = /\bRULES\s*[:=]\s*(?:[A-Za-z_$][\w$.]*\(\s*)*\[/.exec(src); if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') { depth--; if (depth === 0) break; } }
  if (depth !== 0) return null;
  try { return vm.runInNewContext('(' + src.slice(i, j + 1) + ')', {}, { timeout: 1000 }); } catch { return null; }
}
function checkAppendOnly(J, opt, filePath, modPath) {
  /* 현재 모듈의 RULES 는 HEAD 에 일지·모듈이 있든 없든 늘 먼저 추출해 본다(못 찾으면 오류). 그래야 첫 실행(HEAD 에 JSON 이 아직 없어 git 대조를 건너뛰는 때)에도
     추출 정규식과 엔진 코드의 불일치가 드러나고, 다음 회차부터 갑자기 빨개지지 않는다. */
  let b = null;
  if (!fs.existsSync(modPath)) err('RULES 추출: 현재 ' + modPath + ' 가 없음');
  else {
    b = extractRules(fs.readFileSync(modPath, 'utf8'));
    if (b === null) err('RULES 배열을 찾지 못함(현재 lotto-trade.js — RULES = […] 또는 함수로 감싼 꼴이어야 함)');
    else if (!Array.isArray(b) || !b.length) { err('현재 lotto-trade.js 의 RULES 가 빈 배열이거나 배열이 아님'); b = null; }
    else note('현재 lotto-trade.js RULES ' + b.length + '항목(' + b.map((x) => x && x.ver).join(',') + ')');
  }
  const root = path.resolve(opt.root), rel = path.relative(root, filePath).split(path.sep).join('/');
  if (rel.startsWith('..')) { note(`파일이 root 밖이라 git 대조 생략`); return; }
  const txt = gitShow(root, opt.prevGit, rel);
  if (txt === null) { note(`git ${opt.prevGit}:${rel} 를 읽을 수 없어(git 없음·저장소 아님·HEAD 에 파일 없음) 건너뜀`); return; }
  let H; try { H = JSON.parse(txt); } catch { note(`${opt.prevGit} 의 ${rel} 가 JSON 이 아니라 건너뜀`); return; }
  const cur = new Map((J.journal.rows || []).map((r) => [r.r, r])), prevRows = (H.journal && H.journal.rows) || [];
  if (H.journal && J.journal.from !== H.journal.from) err(`journal.from ${J.journal.from} ≠ ${opt.prevGit} 의 ${H.journal.from}`);
  const FROZEN = ['ver', 'made', 'basedOn', 'inputDigest', 'K', 'alloc', 'w', 'picks', 'top', 'ctx', 'hint'];
  for (const p of prevRows) {
    const c = cur.get(p.r);
    if (!c) { err(`${opt.prevGit} 의 일지 r=${p.r} 가 사라짐(행 삭제 금지)`); continue; }
    if (p.status === 'done') { if (JSON.stringify(c) !== JSON.stringify(p)) err(`done 행 r=${p.r} 이 ${opt.prevGit} 와 다름(made·gradedAt 포함 불변)`); }
    else {
      for (const k of FROZEN) if (JSON.stringify(c[k]) !== JSON.stringify(p[k])) err(`pending→${c.status} 행 r=${p.r} 의 얼린 필드 ${k} 가 바뀜`);
    }
  }
  { /* 값은 같은데 글자(공백·숫자 표기)만 바뀐 done 행 — 한 줄 한 행 원문 비교 */
    const rawRows = (t) => { const m = new Map(); for (const l of t.split('\n')) { const x = /^\s*\{\s*"r"\s*:\s*(\d+)\s*,/.exec(l); if (x) m.set(+x[1], l.trim().replace(/,$/, '')); } return m; };
    const a = rawRows(txt), b = rawRows(opt._text || ''); let n = 0;
    for (const p of prevRows) if (p.status === 'done' && a.has(p.r) && b.has(p.r) && a.get(p.r) !== b.get(p.r) && JSON.stringify(cur.get(p.r)) === JSON.stringify(p)) n++;
    if (n) wrn(`done 행 ${n}개가 값은 같지만 글자(공백·숫자 표기)가 ${opt.prevGit} 와 다름 — 바이트 불변 원칙(§8 C10)`); }
  const order = [...cur.keys()]; const pRs = prevRows.map((r) => r.r);
  if (order.slice(0, pRs.length).join() !== pRs.join()) err('일지 행 순서/접두가 ' + opt.prevGit + ' 와 다름(재정렬·중간 삽입 금지)');
  /* RULES 접두 */
  const headSrc = gitShow(root, opt.prevGit, path.relative(root, modPath).split(path.sep).join('/'));
  if (headSrc === null) { note(`${opt.prevGit} 에 lotto-trade.js 가 없어 RULES 접두 검사 생략`); return; }
  if (b === null) return;                                      // 현재 쪽은 위에서 이미 오류로 적었다
  const a = extractRules(headSrc);
  if (!a || !Array.isArray(a)) { err(`RULES 배열을 찾지 못함(${opt.prevGit} 의 lotto-trade.js)`); return; }
  const pre = firstDiff(b.slice(0, a.length), a, 'RULES'); if (pre || b.length < a.length) err(`RULES 가 ${opt.prevGit} 의 접두 일치가 아님(덧붙이기만 허용): ${pre || '길이 감소'}`);
}

/* ───────── C11·C12 모듈 탐침 — 컨텍스트 안에서 도는 자기완결 함수들 ───────── */
function probeLeakInCtx(histText, KS) {
  const M = globalThis.LOTTOTRADE, out = { errors: [], notes: [], scans: 0 };
  const fail = (m) => { out.errors.push(m); };
  if (!M) { fail('LOTTOTRADE 전역이 없음(모듈이 로드되지 않았거나 이름이 다름)'); return JSON.stringify(out); }
  for (const f of ['normalize', 'scanRound']) if (typeof M[f] !== 'function') { fail(`LOTTOTRADE.${f} 가 함수가 아님`); }
  if (out.errors.length) return JSON.stringify(out);
  const mulb = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  let N; try { N = M.normalize(JSON.parse(histText)); } catch (e) { fail('normalize 실패: ' + e.message); return JSON.stringify(out); }
  const D = N.D, L = N.latest, from = L - 49;
  const clone = (X) => (Array.isArray(X) ? X.slice() : Object.assign({}, X));
  const fake = (r, orig) => {
    const rng = mulb((Math.imul(r, 0x2545F491) ^ 0xFA4E) >>> 0), pool = []; for (let i = 1; i <= 45; i++) pool.push(i);
    for (let i = 0; i < 7; i++) { const j = i + Math.floor(rng() * (45 - i)); const x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
    return Object.assign({}, orig, { n: pool.slice(0, 6).sort((x, y) => x - y), b: pool[6], a: [1 + Math.floor(rng() * 9e9), 1 + Math.floor(rng() * 9e7), 1 + Math.floor(rng() * 9e6), 50000, 5000] });
  };
  const leakedFrom = (t) => { const X = clone(D); for (let r = t; r <= L; r++) X[r] = fake(r, D[r]); return X; };
  const scan = (X, t) => { out.scans++; try { return M.scanRound(X, t); } catch (e1) { try { return M.scanRound(X, t, {}); } catch (e2) { throw e1; } } };
  const view = (row) => JSON.stringify({ h: row && row.s ? ['pat', 'hot', 'cold', 'rand'].map((k) => row.s[k] && row.s[k].h) : null, ctx: row && row.ctx, v: row && row.hint && row.hint.v });
  const base = {};
  for (let t = from - 10; t <= L + 1; t++) {
    try { base[t] = scan(D, t); } catch (e) { fail(`scanRound(D,${t}) 예외: ${e.message}`); return JSON.stringify(out); }
    if (!base[t] || !base[t].s) { fail(`scanRound(D,${t}) 반환에 s 가 없음(설계 §5.1: 행 모양)`); return JSON.stringify(out); }
    if (t > L && !(base[t].hint && base[t].hint.v)) { fail(`scanRound(D,${t}) 의 hint.v 가 없음`); return JSON.stringify(out); }
  }
  { /* 감도 확인 — 과거(t−1) 회차를 바꾸면 결과가 달라져야 한다. 그대로면 이 탐침이 아무것도 못 잡는 상태(모양 불일치)다 */
    const t = from + 20, X = clone(D); X[t - 1] = fake(t - 1, D[t - 1]); let m = null;
    try { m = scan(X, t); } catch (e) { m = null; }
    if (m && view(m) === view(base[t])) fail('탐침이 둔감함: t−1 회차 번호를 바꿔도 head·ctx·hint.v 가 그대로임(모듈이 자료를 읽지 않거나 D 모양이 다름)');
  }
  const leaks = [];
  for (let t = from - 10; t <= L + 1; t++) {
    let mod; try { mod = scan(leakedFrom(t), t); } catch (e) { fail(`누수 자료 t=${t} 스캔 예외: ${e.message}`); continue; }
    if (view(mod) !== view(base[t])) leaks.push(t);
  }
  if (leaks.length) fail(`t 이상 회차 번호를 바꿨더니 head·ctx·hint.v 가 달라진 회차 ${leaks.length}개(${leaks.slice(0, 5).join(',')}) — 시점 누수`);
  /* 10회(5회 간격): t−10..t−1 을 바꾼 자료로 다시 스캔 → 행 전체 같음, 점수·배분(모듈 scores/alloc 이 있으면) 같음 */
  let allocTried = 0, allocNote = null;
  for (let t = from; t < from + 50; t += 5) {
    const X = leakedFrom(t), rowsB = {}, rowsM = {};
    for (let u = t - 10; u < t; u++) {
      rowsB[u] = base[u];
      try { rowsM[u] = scan(X, u); } catch (e) { fail(`재스캔 u=${u} 예외: ${e.message}`); continue; }
      if (JSON.stringify(rowsM[u]) !== JSON.stringify(rowsB[u])) fail(`u=${u}(t=${t} 미래를 바꾼 자료)의 스캔 행이 달라짐 — 시점 누수`);
    }
    if (typeof M.scores === 'function' && typeof M.alloc === 'function') {
      try {
        const sB = M.scores(rowsB, t), sM = M.scores(rowsM, t); allocTried++;
        if (JSON.stringify(sB) !== JSON.stringify(sM)) fail(`t=${t}: scores 가 미래 자료에 따라 달라짐`);
        for (const K of KS) if (JSON.stringify(M.alloc(sB, K)) !== JSON.stringify(M.alloc(sM, K))) fail(`t=${t} K=${K}: alloc 이 미래 자료에 따라 달라짐`);
      } catch (e) { allocNote = 'scores/alloc 호출 모양이 달라 건너뜀(' + e.message + ')'; }
    }
  }
  if (allocNote) out.notes.push(allocNote); else if (!allocTried) out.notes.push('모듈에 scores/alloc 이 없어 행 비교만 함');
  if (typeof M.past === 'function') {
    try {
      const P = M.past(D, 100); let thrown = false;
      try { P.get(100); } catch (e) { thrown = (e instanceof RangeError) || /leak/i.test(String(e && e.message)); }
      if (!thrown) fail('past(D,100).get(100) 이 RangeError 를 던지지 않음');
      try { P.get(99); } catch (e) { fail('past(D,100).get(99) 이 예외: ' + e.message); }
    } catch (e) { out.notes.push('past 호출 모양이 달라 건너뜀(' + e.message + ')'); }
  } else out.notes.push('모듈에 past 가 없어 RangeError 확인 생략');
  return JSON.stringify(out);
}
function probeDeterminismInCtx(histText) {
  const M = globalThis.LOTTOTRADE, out = { errors: [] };
  if (!M) { out.errors.push('LOTTOTRADE 전역이 없음'); return JSON.stringify(out); }
  for (const f of ['normalize', 'runSync', 'selfTest']) if (typeof M[f] !== 'function') out.errors.push(`LOTTOTRADE.${f} 가 함수가 아님`);
  if (!('GOLDEN' in M)) out.errors.push('LOTTOTRADE.GOLDEN 이 없음');
  if (out.errors.length) return JSON.stringify(out);
  try {
    const N = M.normalize(JSON.parse(histText));
    const r1 = M.runSync(N.D, { to: N.latest }), r2 = M.runSync(N.D, { to: N.latest });
    out.fp1 = JSON.stringify(r1); out.fp2 = JSON.stringify(r2);
    out.digest = r1 && r1.window && typeof r1.window.digest === 'string' ? r1.window.digest : null;
    out.selfTest = M.selfTest(); out.golden = M.GOLDEN;
  } catch (e) { out.errors.push('실행 예외: ' + (e && e.message)); }
  return JSON.stringify(out);
}
const POISON = `(function(){
  Math.random = function(){ throw new Error('Math.random 호출 금지(P2)'); };
  var RD = Date;
  function FD(){ if (arguments.length === 0) throw new Error('인자 없는 Date 호출 금지(P2)'); var a = Array.prototype.slice.call(arguments); return new (Function.prototype.bind.apply(RD, [null].concat(a)))(); }
  FD.prototype = RD.prototype; FD.UTC = RD.UTC; FD.parse = RD.parse; FD.now = function(){ throw new Error('Date.now 호출 금지(P2)'); };
  globalThis.Date = FD;
})();`;
function loadModuleContext(rootDir, modPath, poison) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
  const rc = path.join(rootDir, 'rank-core.js');
  if (fs.existsSync(rc)) vm.runInContext(fs.readFileSync(rc, 'utf8'), ctx, { filename: 'rank-core.js' });
  if (poison) vm.runInContext(POISON, ctx);
  vm.runInContext(fs.readFileSync(modPath, 'utf8'), ctx, { filename: 'lotto-trade.js' });
  return ctx;
}
function runProbe(ctx, fn, args) { const f = vm.runInContext('(' + fn.toString() + ')', ctx); return JSON.parse(f(...args)); }

function checkLeak(opt, histText, modPath) {                  // C11
  if (!fs.existsSync(modPath)) { err(`모듈 ${modPath} 가 없음`); return; }
  let ctx; try { ctx = loadModuleContext(path.resolve(opt.root), modPath, false); } catch (e) { err('모듈 로드 실패: ' + e.message); return; }
  const r = runProbe(ctx, probeLeakInCtx, [histText, CONF.KS]);
  for (const e of r.errors.slice(0, 6)) err(e); if (r.errors.length > 6) err(`…외 ${r.errors.length - 6}건`);
  for (const n of r.notes) note(n);
  note(`누수 탐침: 스캔 ${r.scans}회`);
}
function checkDeterminism(opt, histText, modPath, expectDigest, docSelfTest) {   // C12
  if (!fs.existsSync(modPath)) { err(`모듈 ${modPath} 가 없음`); return; }
  let ca, cb; try { ca = loadModuleContext(path.resolve(opt.root), modPath, false); cb = loadModuleContext(path.resolve(opt.root), modPath, true); } catch (e) { err('모듈 로드 실패: ' + e.message); return; }
  const a = runProbe(ca, probeDeterminismInCtx, [histText]);
  for (const e of a.errors) err(e);
  if (a.errors.length) return;
  if (a.fp1 !== a.fp2) err('runSync 를 두 번 돌린 결과가 다름(비결정)');
  if (a.selfTest !== a.golden) err(`selfTest() ${short(a.selfTest)} ≠ GOLDEN ${short(a.golden)}`);
  if (docSelfTest !== undefined && docSelfTest !== a.selfTest) err(`문서의 selfTest ${short(docSelfTest)} ≠ 지금 모듈의 selfTest() ${short(a.selfTest)} (엔진이 바뀌었는데 문서를 다시 만들지 않음)`);
  if (a.digest && expectDigest && a.digest !== expectDigest) err(`runSync 의 window.digest ${a.digest} ≠ 독립 재계산 ${expectDigest}`);
  const b = runProbe(cb, probeDeterminismInCtx, [histText]);
  for (const e of b.errors) err('Math.random·Date 를 막은 실행: ' + e);
  if (!b.errors.length) { if (b.fp1 !== a.fp1) err('Math.random·Date.now 를 throw 로 바꾼 실행의 결과가 다름'); if (b.selfTest !== a.selfTest) err('Math.random·Date.now 를 막은 실행의 selfTest 가 다름'); }
}

/* ───────── C13 문구 ───────── */
const FORBID = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
function checkWording(J, opt, modPath) {
  const strs = []; (function walk(v) { if (typeof v === 'string') strs.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { strs.push(k); walk(v[k]); } })(J);
  const hit = (label, text) => { const m = FORBID.exec(text); if (m) err(`${label} 에 금지 문구 «${m[0]}»`); };
  hit('trade JSON', strs.join('\n'));
  const root = path.resolve(opt.root);
  const rec = path.join(root, 'record.html');
  if (fs.existsSync(rec)) {
    const html = fs.readFileSync(rec, 'utf8'), at = html.search(/<div[^>]*\bid="tradeWrap"/);
    if (at < 0) note('record.html 에 #tradeWrap 이 아직 없음'); else {
      const re = /<div\b|<\/div>/g; re.lastIndex = at; let depth = 0, end = html.length, m;
      while ((m = re.exec(html))) { if (m[0] === '</div>') { depth--; if (depth === 0) { end = m.index + 6; break; } } else depth++; }
      hit('record.html #tradeWrap', html.slice(at, end));
    }
  } else note('record.html 이 없음');
  if (fs.existsSync(modPath)) hit('lotto-trade.js', fs.readFileSync(modPath, 'utf8')); else note('lotto-trade.js 가 없음');
  const wb = path.join(root, 'scripts', 'weekly-brief.mjs');
  if (fs.existsSync(wb)) {
    const ls = fs.readFileSync(wb, 'utf8').split('\n'); let a = -1, b = -1;
    ls.forEach((l, i) => { if (/tradeTip|trade-lotto/.test(l)) { if (a < 0) a = i; b = i; } });
    if (a < 0) note('weekly-brief.mjs 에 tradeTip 블록이 아직 없음'); else hit('weekly-brief tradeTip 블록', ls.slice(a, b + 1).join('\n'));
  } else note('scripts/weekly-brief.mjs 가 없음');
}

/* ═════════════ 진입점 ═════════════ */
function parseArgs(argv) {
  const o = { root: '.', file: 'brief/trade-lotto.json', history: 'lotto-history.json', rank: null, params: null, prevGit: null, module: null, printDigests: false, only: null, skip: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Error(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break; case '--file': o.file = need(); break; case '--history': o.history = need(); break;
      case '--rank': o.rank = need(); break; case '--params': o.params = need(); break; case '--prev-git': o.prevGit = need(); break;
      case '--module': o.module = need(); break; case '--print-digests': o.printDigests = true; break;
      case '--only': o.only = need().split(',').map((x) => x.trim().toUpperCase()); break; case '--skip': o.skip = need().split(',').map((x) => x.trim().toUpperCase()); break;
      case '-h': case '--help': console.log('사용: node scripts/check-trade.mjs --root . --file brief/trade-lotto.json --history lotto-history.json [--rank f] [--params f] [--prev-git HEAD] [--module f] [--print-digests] [--only C3,C4] [--skip C10]'); process.exit(0); break;
      default: throw new Error('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function fatal(msg) { console.log(`::error title=check-trade::${esc(msg)}`); process.exit(1); }

function main() {
  let opt; try { opt = parseArgs(process.argv.slice(2)); } catch (e) { fatal(e.message); }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), filePath = res(opt.file), modPath = opt.module ? path.resolve(opt.module) : path.join(root, 'lotto-trade.js');
  let histText; try { histText = fs.readFileSync(histPath, 'utf8'); } catch (e) { fatal(`이력 ${histPath} 를 읽을 수 없음: ${e.message}`); }
  let H; try { H = loadHistory(JSON.parse(histText)); } catch (e) { fatal(`이력 JSON 파싱 실패: ${e.message}`); }
  const t00 = performance.now();

  if (opt.printDigests) {
    if (H.problems.length) fatal('이력 문제: ' + H.problems.join('; '));
    const C = makeCalc(H.D, H.latest), X = expectedRowsAndNext(C, H), B = C.bandOf(C.bandPos());
    console.log(`source.digest ${sourceDigest(H.D, H.latest)}\nwindow.digest ${windowDigest(X.rows, X.next)}\nband.digest ${B.digest}`);
    process.exit(0);
  }

  const rankPath = opt.rank ? res(opt.rank) : res('brief/rank-lotto.json'), paramsPath = opt.params ? res(opt.params) : res('brief/rank-params-lotto.json');
  const rank = fs.existsSync(rankPath) ? readJSON(rankPath) : null, params = fs.existsSync(paramsPath) ? readJSON(paramsPath) : null;
  let text, J;
  try { text = fs.readFileSync(filePath, 'utf8'); J = JSON.parse(text); } catch (e) { fatal(`${opt.file} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  const state = { J, H, text }; opt._text = text;

  runCheck('C0', '구조', opt, () => checkStructure(J, H, state));
  const fatalStruct = !(J.window && Array.isArray(J.window.rows) && J.window.next && J.source && J.summary && J.band && J.journal && Array.isArray(J.journal.rows));
  let C = null, X = null, Bnd = null;
  runCheck('C1', '입력', opt, () => checkInput(J, H, histPath));
  const usable = !H.problems.length && !fatalStruct;
  const need = (id, title, fn) => { if (!usable) { skipCheck(id, title, '이력 문제 또는 구조 실패로 생략', opt); return; } runCheck(id, title, opt, fn); };
  if (usable) C = makeCalc(H.D, H.latest);
  const lazyX = () => (X || (X = expectedRowsAndNext(C, H)));
  const lazyB = () => (Bnd || (Bnd = C.bandOf(C.bandPos())));
  need('C2', '가중치', () => checkWeights(C, H, params));
  need('C3', 'hot/cold 스트림', () => checkStreams(J, C, H, ['hot', 'cold'], 'C3'));
  need('C4', 'pat/rand 스트림', () => checkStreams(J, C, H, ['pat', 'rand'], 'C4'));
  need('C5', '집계', () => { const x = lazyX(); x.summary = buildSummary(C, x.rows, lazyB()); checkAggregate(J, C, H, x); });
  need('C6', '정확 순위', () => { checkExact(J, C, H, lazyX()); checkRankFile(C, H, rank); });
  need('C7', '무작위 띠', () => checkBand(J, C, H, lazyB()));
  need('C8', '지문', () => checkDigests(J, C, H, lazyX(), lazyB()));
  need('C9', '일지', () => { const x = lazyX(); checkJournal(J, C, H, x); });
  if (!opt.prevGit) skipCheck('C10', 'append-only', '--prev-git 이 없어 생략', opt); else if (!usable) skipCheck('C10', 'append-only', '구조 실패로 생략', opt); else runCheck('C10', 'append-only', opt, () => checkAppendOnly(J, opt, filePath, modPath));
  need('C11', '누수 탐침', () => checkLeak(opt, histText, modPath));
  need('C12', '결정성', () => checkDeterminism(opt, histText, modPath, usable ? windowDigest(lazyX().rows, lazyX().next) : null, J.selfTest));
  runCheck('C13', '문구', opt, () => checkWording(J, opt, modPath));

  /* 출력 */
  let nErr = 0, nWarn = 0;
  for (const it of R.items) {
    nErr += it.errors.length; nWarn += it.warnings.length;
    const st = it.skipped ? '생략' : it.errors.length ? `실패 ${it.errors.length}` : '통과';
    console.log(`[${it.id}] ${it.title} — ${st}${it.warnings.length ? ` · 경고 ${it.warnings.length}` : ''} (${(it.ms / 1000).toFixed(1)}s)`);
    for (const n of it.notices) console.log(`  · ${n}`);
  }
  for (const it of R.items) {
    for (const m of it.errors.slice(0, 12)) console.log(`::error title=check-trade::${esc(`${it.id} ${it.title}: ${m}`)}`);
    if (it.errors.length > 12) console.log(`::error title=check-trade::${esc(`${it.id} …외 ${it.errors.length - 12}건`)}`);
    for (const m of it.warnings.slice(0, 12)) console.log(`::warning title=check-trade::${esc(`${it.id} ${it.title}: ${m}`)}`);
  }
  const secs = ((performance.now() - t00) / 1000).toFixed(1);
  if (nErr) { console.log(`::error title=check-trade::${esc(`매매 일지 독립 검증 실패 — 오류 ${nErr} · 경고 ${nWarn} (${secs}s)`)}`); process.exit(1); }
  console.log(`::notice title=check-trade::${esc(`매매 일지 독립 검증 통과 — ${R.items.filter((i) => !i.skipped).length}개 검사 · 경고 ${nWarn} · ${secs}s`)}`);
  process.exit(0);
}

const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase(); } catch { return false; } })();
if (isMain) main();
export { expectedRowsAndNext, extractRules as _extractRules };
