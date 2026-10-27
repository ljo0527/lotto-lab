#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   learn-ledger.mjs — 낙첨 분석 + 관문 있는 학습 실험실 CI 생성 스크립트 (규격 docs/learn-ledger.md)

   하는 일: 이번 주 추천 10줄(rec)과 사전 등록 후보 신호 4개(hot·cold·gap·repeat)의 10줄씩을 «추첨 전에» 일지(pending)에 얼리고,
            추첨 뒤 «3개 이상 맞힌 줄 수» 로 채점(done)하며, 같은 주 무작위 대조군 R벌과 견줘 관문(경보·채택)을 파생값으로 낸다.
     · 외부 접속·Playwright 없음. 읽는 파일 = 이력(lotto-history.json) · (선택) brief/latest-summary.json · brief/sim-lotto.json · 기존 out.
     · 일지 틀은 매매 일지(scripts/trade-ledger.mjs, CLAUDE.md 규칙 15)와 같다: 추첨 전 pending → 추첨 뒤 done, done 행은 불변.
     · 독립 검증은 scripts/check-learn.mjs 가 한다(이 파일을 import 하지 않고 신호·대조군·채점·관문을 다시 구현해 대조).
     · import 하면 main 이 바로 돈다 — 가져다 쓰지 않는다.

   사용
     node scripts/learn-ledger.mjs --root . --history lotto-history.json --summary brief/latest-summary.json \
          --sim brief/sim-lotto.json --out brief/learn-lotto.json [--now ISO]
       --root     상대 경로 옵션의 기준.                                   기본 .
       --history  로또 전 회차 스냅샷.                                      기본 lotto-history.json
       --summary  이번 주 추천 10줄(lotto.next · lotto.picks).              기본 brief/latest-summary.json (없으면 rec 없이 쓰고 ::warning)
       --sim      모의 원장(돌아보면 재현의 rec = A~E 5줄).                 기본 brief/sim-lotto.json   (없으면 재현의 rec 만 비움)
       --out      쓸 곳. 기존 파일이 있으면 일지를 이어 쓴다.              기본 brief/learn-lotto.json
       --now      시험용 고정 시각(ISO). generated·made·gradedAt 에 쓴다. 기본 실제 현재 시각(Date 는 이 기록에만 쓴다).
     종료 코드: 0 = 정상 또는 «역행 가드로 쓰지 않음»(wrote=false) · 1 = 실패(쓰기 없음).
     $GITHUB_OUTPUT 이 있으면 wrote=true|false 를 쓴다(워크플로의 독립 검증 단계 조건).

   절차
     1 이력 읽기·정규화(구멍·형식 오류면 exit 1, 쓰기 없음)  2 기존 out 읽기(깨졌으면 exit 1, 덮어쓰지 않음 — 일지 보호)
     3 역행 가드  4 신호 풀·줄(회차 t=latest+1, past 만 사용)  5 일지 J1~J6  6 관문(live = done && !late)  7 돌아보면(사후) 재현
     8 직렬화 → 크기 < 1MB 확인 → 임시 파일 → rename  9 $GITHUB_OUTPUT  10 ::warning(경보) · ::notice(채택)

   고른 해석(바꾸려면 여기와 검사기를 같이 고친다)
     · 줄 = «1..45 에서 서로 다른 6개», 문자열 "a,b,c,d,e,f"(오름차순). 맞힌 개수 m = 줄 ∩ 당첨 6개(보너스 제외), 보너스는 bo(0/1)로 따로.
     · 신호 풀 = 점수 상위 15개 번호. 줄 10개 = 풀에서 회차·신호 시드로 뽑은 서로 다른 조합. 같은 줄이 나오면 다시 뽑는다.
     · 대조군은 두 가지다(같은 주, 시드 (회차 t, 벌 번호 j=1..R), 벌별 값은 저장하지 않고 시드로 다시 만든다).
         ctrl    = 균등 무작위 줄 10개              → 추천 10줄(낙첨 분석·재현의 rec)의 기준선.
         ctrlSig = 무작위 15개 번호 풀에서 신호와 같은 절차로 뽑은 서로 다른 10줄 → 신호(관문·재현의 sig)의 기준선.
       신호의 10줄은 한 풀에서 나와 함께 오르내리므로(맞힌 줄 수의 흩어짐이 균등 줄보다 크다) 같은 구조의 대조군과 견줘야 기준선이 정확하다.
       정해진 풀의 맞힌 수 분포는 무작위 풀과 같아서, 정보 없는 신호에는 ctrlSig 가 정확한 기준선이다(docs §3.3·§12).
     · 꼬리 비율은 (1 + 대조군 중 같거나 나쁜/좋은 벌 수) / (R + 1) 을 정수 곱셈으로 견준다(부동소수 없음).
     · 순위 = 1 + (대조군 중 내 값보다 큰 벌 수). 같은 값은 같은 순위를 나눠 갖고 tie 에 그 벌 수를 적는다.
     · 낙첨 분석 상태는 hold(보류) · alarm(경보) · inside(그 밖) 셋이다. 대조군 위쪽 바깥은 정보 가치가 없어 따로 두지 않는다.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const TITLE = 'learn-ledger';
const MAX_BYTES = 1000000;                                   // CLAUDE.md 규칙 4: 새로 추적하는 파일 하나는 1MB 미만
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

class Fail extends Error {}                                  // 예상된 실패: ::error 한 줄 + exit 1, 쓰기 없음
const state = { wrote: false };                              // finally 에서 $GITHUB_OUTPUT 으로 내보낸다

/* ═════════════ 상수 — 한 곳. 바꾸면 VER 을 올리고 RULES 에 덧붙인다(docs/learn-ledger.md §9) ═════════════ */
const VER = 'learn-1';
const RULES = [{ ver: 'learn-1', from: 1248, signals: ['hot', 'cold', 'gap', 'repeat'] }];   // 덧붙이기만. 신호를 더하면 from 과 함께 새 항목
const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
const CONF = {
  W: 50,                                                     // 신호 창: 직전 W회 출현 수
  POOL: 15,                                                  // 신호 풀 크기(점수 상위 번호 수)
  LINES: 10,                                                 // 주당 줄 수(추천·신호·대조군 공통)
  MIN_HIT: 3,                                                // «맞힌 줄» = 일치 개수 ≥ 3
  SALT: { hot: 0x484F545F, cold: 0x434F4C44, gap: 0x4741505F, repeat: 0x52455054, ctrl: 0x4354524C, ctrlPool: 0x43504F4C },
  CTRL_MUL: 0x85EBCA6B,                                      // 대조군 벌 번호 혼합 상수
  R: 1000,                                                   // 대조군 벌 수(관문 해상도 1/(R+1))
  ALARM_MIN_WEEKS: 26, ALARM_P: [1, 100],                    // 낙첨 경보: 주 수 ≥ 26 이고 하위 꼬리 비율 ≤ 1/100
  ADOPT_MIN_WEEKS: 52, ALPHA: [1, 20],                       // 채택: 주 수 ≥ 52 이고 상위 꼬리 비율 ≤ α/신호 수(본페로니), α = 1/20
  REPLAY: 300,                                               // 돌아보면(사후) 재현 범위(최근 회차 수)
  SIM_LINES: 5,                                              // 재현의 rec = 모의 원장 A~E 5줄
  CUTOFF_UTC_H: 11                                           // 마감 = 추첨일 11:00Z(= 20:00 KST)
};
const NSET = CONF.R;

/* ═════════════ 기본 도구 ═════════════ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedOf = (t, salt) => (Math.imul(t, 0x9E3779B1) ^ salt) >>> 0;
const seedCtrl = (t, j) => (Math.imul(t, 0x9E3779B1) ^ Math.imul(j, CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0;
const seedCtrlPool = (t, j) => (seedCtrl(t, j) ^ CONF.SALT.ctrlPool) >>> 0;       // 신호 대조군: 벌 시드에 풀 소금을 섞는다
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asc = (a, b) => a - b;

function parseLine(s) {                                      // "a,b,c,d,e,f" → 번호 6개(정수·1..45·서로 다름) 또는 null
  if (typeof s !== 'string' || !/^\d{1,2}(,\d{1,2}){5}$/.test(s)) return null;
  const n = s.split(',').map(Number);
  if (n.some((x) => x < 1 || x > 45) || new Set(n).size !== 6) return null;
  return n;
}
const normLine = (n) => n.slice().sort(asc).join(',');

/* ═════════════ 이력 ═════════════ */
function normalize(hist) {
  const ds = hist && hist.draws;
  if (!Array.isArray(ds) || !ds.length) throw new Fail('이력에 draws 배열이 없습니다');
  const by = new Map();
  for (const d of ds) {
    if (!d || !Number.isInteger(d.round) || d.round < 1) throw new Fail('자료 형식 오류 — round 가 양의 정수가 아닙니다');
    if (by.has(d.round)) throw new Fail(`자료 형식 오류 ${d.round}회 — 같은 회차가 두 번 있습니다`);
    by.set(d.round, d);
  }
  let latest = 0; for (const r of by.keys()) if (r > latest) latest = r;
  const D = [null];
  for (let r = 1; r <= latest; r++) {
    const d = by.get(r);
    if (!d) throw new Fail(`자료 구멍 ${r}회 — 1..latest 가 연속이 아니어서 계산하지 않습니다`);
    const n = Array.isArray(d.numbers) ? d.numbers.slice().sort(asc) : null;
    const ok = n && n.length === 6 && n.every((x) => Number.isInteger(x) && x >= 1 && x <= 45) && new Set(n).size === 6
      && Number.isInteger(d.bonus) && d.bonus >= 1 && d.bonus <= 45 && !n.includes(d.bonus) && /^\d{8}$/.test(String(d.date));
    if (!ok) throw new Fail(`자료 형식 오류 ${r}회 — 번호·보너스·추첨일 형식이 맞지 않아 계산하지 않습니다`);
    D.push({ n, b: d.bonus, date: String(d.date) });
  }
  return { D, latest };
}
function sourceDigest(D, upto) {
  let s = '';
  for (let r = 1; r <= upto; r++) s += `${r}:${D[r].n.join(',')}+${D[r].b};`;
  return fnv(s);
}
const cutoffMs = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), CONF.CUTOFF_UTC_H, 0, 0);

/* ═════════════ 신호 — past(D,t) = 1..t-1 회차만 읽는다. 정수 연산·동점은 작은 번호 우선 ═════════════ */
function signalPools(D, t) {
  const get = (r) => { if (!(r >= 1 && r < t)) throw new RangeError(`누수 방지: ${r}회는 ${t}회 계산에서 읽을 수 없습니다`); return D[r].n; };
  const cnt = new Array(46).fill(0), last = new Array(46).fill(0);
  for (let r = 1; r < t; r++) {
    const n = get(r);
    for (const x of n) last[x] = r;
    if (r >= t - CONF.W) for (const x of n) cnt[x]++;
  }
  const prev = new Array(46).fill(0); for (const x of get(t - 1)) prev[x] = 1;
  const nums = []; for (let n = 1; n <= 45; n++) nums.push(n);
  const top = (cmp) => nums.slice().sort(cmp).slice(0, CONF.POOL).sort(asc);
  return {
    hot: top((a, b) => (cnt[b] - cnt[a]) || (a - b)),        // 최근 W회 출현 많은 순
    cold: top((a, b) => (cnt[a] - cnt[b]) || (a - b)),       // 적은 순
    gap: top((a, b) => (last[a] - last[b]) || (a - b)),      // 마지막 출현이 오래된 순(한 번도 없으면 0회 = 가장 오래됨)
    repeat: top((a, b) => (prev[b] - prev[a]) || (cnt[b] - cnt[a]) || (a - b))   // 직전 회차 6개 먼저, 그다음 출현 많은 순
  };
}
function drawLines(pool, rng, nLines) {                       // 풀에서 서로 다른 줄 nLines 개(오름차순 번호 배열) — 신호와 신호 대조군이 같이 쓴다
  const keys = [], lines = [];
  for (let guard = 0; lines.length < nLines; guard++) {
    if (guard > 100000) throw new Fail('신호 줄을 만들지 못했습니다(풀이 너무 좁음)');
    const a = pool.slice();
    for (let i = 0; i < 6; i++) { const j = i + Math.floor(rng() * (a.length - i)); const v = a[i]; a[i] = a[j]; a[j] = v; }
    const line = a.slice(0, 6).sort(asc), key = line.join(',');
    if (keys.includes(key)) continue;
    keys.push(key); lines.push(line);
  }
  return lines;
}
function pickLines(pool, t, salt, nLines) {
  return drawLines(pool, mulberry32(seedOf(t, salt)), nLines).map((l) => l.join(','));
}
function signalSet(D, t, names) {
  const pools = signalPools(D, t), out = {};
  for (const s of names) {
    if (!pools[s] || CONF.SALT[s] === undefined) throw new Fail(`알 수 없는 신호 ${s}`);
    out[s] = { pool: pools[s], lines: pickLines(pools[s], t, CONF.SALT[s], CONF.LINES) };
  }
  return out;
}

/* ═════════════ 채점 · 대조군 ═════════════ */
const marksOf = (n) => { const m = new Uint8Array(46); for (const x of n) m[x] = 1; return m; };
function gradeLines(lines, d) {                              // d = {n,b} → {m:[맞힌 개수], bo:[보너스 0/1], g3}
  const mk = marksOf(d.n), m = [], bo = []; let g3 = 0;
  for (const ln of lines) {
    const nums = parseLine(ln); let h = 0;
    for (const x of nums) h += mk[x];
    m.push(h); bo.push(nums.includes(d.b) ? 1 : 0);
    if (h >= CONF.MIN_HIT) g3++;
  }
  return { m, bo, g3 };
}
const ctrlCache = new Map();
function ctrlWeek(D, t) {                                    // 같은 주 대조군 R벌 → 벌마다 «3개 이상 줄 수»: c10(균등 10줄) · c5(그 앞 5줄) · s10(무작위 풀의 신호식 10줄)
  let c = ctrlCache.get(t); if (c) return c;
  const mk = marksOf(D[t].n), c10 = new Uint8Array(NSET), c5 = new Uint8Array(NSET), s10 = new Uint8Array(NSET);
  const base = new Uint8Array(45); for (let i = 0; i < 45; i++) base[i] = i + 1;
  const a = new Uint8Array(45);
  for (let j = 1; j <= NSET; j++) {
    const rng = mulberry32(seedCtrl(t, j));
    let k10 = 0, k5 = 0;
    for (let L = 0; L < CONF.LINES; L++) {
      a.set(base);
      let h = 0;
      for (let i = 0; i < 6; i++) { const q = i + Math.floor(rng() * (45 - i)); const v = a[q]; a[q] = a[i]; a[i] = v; h += mk[v]; }
      if (h >= CONF.MIN_HIT) { k10++; if (L < CONF.SIM_LINES) k5++; }
    }
    c10[j - 1] = k10; c5[j - 1] = k5;

    /* 신호 대조군: 벌 시드 + 풀 소금 → 1..45 에서 무작위 풀 POOL 개 → 같은 풀에서 신호와 같은 절차(drawLines)로 서로 다른 LINES 줄 */
    const rp = mulberry32(seedCtrlPool(t, j));
    a.set(base);
    for (let i = 0; i < CONF.POOL; i++) { const q = i + Math.floor(rp() * (45 - i)); const v = a[q]; a[q] = a[i]; a[i] = v; }
    const pool = Array.from(a.subarray(0, CONF.POOL)).sort(asc);
    let ks = 0;
    for (const line of drawLines(pool, rp, CONF.LINES)) { let h = 0; for (const x of line) h += mk[x]; if (h >= CONF.MIN_HIT) ks++; }
    s10[j - 1] = ks;
  }
  c = { c10, c5, s10 }; ctrlCache.set(t, c);
  return c;
}
function ctrlHist(D, t, key) {                               // 그 주 대조군 R벌의 «3개 이상 줄 수» 분포(0..LINES). key = c10(추천) | s10(신호)
  const h = new Array(CONF.LINES + 1).fill(0);
  for (const k of ctrlWeek(D, t)[key]) h[k]++;
  return h;
}

/* ═════════════ 누적 대 대조군 (관문·재현 공통) ═════════════ */
function statOf(weeks, cum, cums) {                          // cums = 대조군 R벌의 누적(Int32Array)
  const R = cums.length;
  let le = 0, ge = 0, eq = 0, mn = Infinity, mx = -Infinity;
  const hm = new Map();
  for (let j = 0; j < R; j++) {
    const v = cums[j];
    if (v <= cum) le++;
    if (v >= cum) ge++;
    if (v === cum) eq++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    hm.set(v, (hm.get(v) || 0) + 1);
  }
  const sorted = Int32Array.from(cums).sort();
  return { weeks, cum, n: R, min: mn, med: sorted[(R - 1) >> 1], max: mx, rank: 1 + (R - le), tie: eq, le, ge, hist: [...hm].sort((x, y) => x[0] - y[0]) };
}
function ctrlCum(D, rounds, key) {                           // 대조군 R벌마다 rounds 의 «3개 이상 줄 수» 합
  const acc = new Int32Array(NSET);
  for (const t of rounds) { const c = ctrlWeek(D, t)[key]; for (let j = 0; j < NSET; j++) acc[j] += c[j]; }
  return acc;
}

/* ═════════════ 일지 (J1~J6) ═════════════ */
function lineListOk(a, n) { return Array.isArray(a) && a.length === n && a.every((x) => parseLine(x) !== null); }
function checkRowShape(row) {
  const bad = (m) => { throw new Fail(`일지 r=${row && row.r} 행 형식이 맞지 않습니다(${m})`); };
  if (!row.sig || typeof row.sig !== 'object') bad('sig');
  for (const s of Object.keys(row.sig)) if (!row.sig[s] || !lineListOk(row.sig[s].lines, CONF.LINES)) bad(`sig.${s}.lines`);
  if (row.rec !== undefined && !(row.rec && lineListOk(row.rec.lines, CONF.LINES))) bad('rec.lines');
}
function gradeRow(D, row) {
  const d = D[row.r];
  const res = { n: d.n.slice(), bonus: d.b };
  if (row.rec) res.rec = gradeLines(row.rec.lines, d);
  res.sig = {};
  for (const s of Object.keys(row.sig)) res.sig[s] = gradeLines(row.sig[s].lines, d);
  res.ctrl = { n: NSET, h: ctrlHist(D, row.r, 'c10') };         // 추천 10줄의 기준선(균등 무작위 줄)
  res.ctrlSig = { n: NSET, h: ctrlHist(D, row.r, 's10') };      // 신호의 기준선(무작위 풀에서 같은 절차로 뽑은 줄)
  return res;
}

function buildJournal(D, latest, prev, next, recLines, nowIso, log) {
  const old = prev ? prev.journal.rows : [];
  const pendMis = [], regrMis = [];
  let graded = 0, added = 0;

  const freshPending = () => {
    const rule = ruleFor(next);
    const row = { r: next, ver: rule.ver, status: 'pending', made: nowIso, basedOn: next - 1, inputDigest: sourceDigest(D, next - 1) };
    if (recLines) row.rec = { lines: recLines };
    row.sig = signalSet(D, next, rule.signals);
    return row;
  };

  const rows = [];
  for (const row of old) {
    /* J1 채점: r ≤ latest 인 pending → done (얼린 줄로, 처음 공개한 값 그대로) */
    if (row.status === 'pending' && row.r <= latest) {
      checkRowShape(row);
      const drawDate = D[row.r].date;
      rows.push(Object.assign({}, row, {
        status: 'done', drawDate, late: Date.parse(row.made) >= cutoffMs(drawDate), res: gradeRow(D, row), gradedAt: nowIso
      }));
      graded++;
      continue;
    }
    rows.push(row);
  }

  /* J5 재채점 대조: 이미 done 이던 행만. 처음 공개한 값은 그대로 두고 경고만 */
  for (const row of old) {
    if (row.status !== 'done' || !row.res) continue;
    try {
      checkRowShape(row);
      const g = gradeRow(D, row), diffs = [];
      for (const k of Object.keys(g)) if (!sameJSON(row.res[k], g[k])) diffs.push(k);
      if (diffs.length) { regrMis.push(`r=${row.r} ${diffs[0]}`); log.warn(`J5 재채점이 처음 채점과 다름 r=${row.r}: ${diffs.join(',')} — 기존 값을 유지합니다`); }
    } catch (e) {
      if (e instanceof Fail) throw e;
      regrMis.push(`r=${row.r} 채점 불가`); log.warn(`J5 r=${row.r} 재채점 실패: ${e.message}`);
    }
  }

  /* J2 빠진 주: 마지막 일지 회차+1 .. latest 에 행이 없으면 missed (소급해서 만들지 않는다) */
  const missed = prev ? prev.journal.missed.slice() : [];
  const lastR = rows.reduce((m, x) => Math.max(m, x.r), 0);
  for (let r = Math.max(lastR + 1, 1); r <= latest; r++) if (rows.length && !missed.includes(r) && !rows.some((x) => x.r === r)) missed.push(r);

  /* J3 새 제시 / J4 동결: latest+1 행이 있으면 다시 계산해 대조만 한다 */
  const have = rows.find((x) => x.r === next);
  if (!have) { rows.push(freshPending()); added++; }
  else if (have.status === 'pending' && have.ver === ruleFor(next).ver) {
    const fresh = freshPending(), diffs = [];
    if (have.inputDigest !== fresh.inputDigest) diffs.push('inputDigest');
    if (fresh.rec && !sameJSON(have.rec, fresh.rec)) diffs.push('rec');
    for (const s of Object.keys(have.sig || {})) if (!fresh.sig[s] || !sameJSON(have.sig[s], fresh.sig[s])) diffs.push('sig.' + s);
    if (diffs.length) { pendMis.push(`r=${next} ${diffs.join(',')}`); log.warn(`J4 얼린 제시가 지금 재계산과 다름 r=${next}: ${diffs.join(',')} — 처음 공개한 값을 유지합니다`); }
  }

  const from = prev ? prev.journal.from : next;             // J6: 처음 값 고정
  return { journal: { from, missed, rows }, checks: { kept: old.length - graded, added, graded, pendingMismatch: pendMis, regradeMismatch: regrMis } };
}

function readPrev(outPath) {
  if (!fs.existsSync(outPath)) return null;
  let text; try { text = fs.readFileSync(outPath, 'utf8'); } catch (e) { throw new Fail(`기존 ${outPath} 를 읽을 수 없어 덮어쓰지 않습니다: ${e.message}`); }
  let j; try { j = JSON.parse(text); } catch (e) { throw new Fail(`기존 ${outPath} 가 JSON 이 아니라 덮어쓰지 않습니다(일지 보호): ${e.message}`); }
  const jr = j && j.journal;
  if (!j || j.kind !== 'learn-lotto' || !jr || !Array.isArray(jr.rows) || !Array.isArray(jr.missed) || !Number.isInteger(jr.from) || !jr.rows.length) {
    throw new Fail(`기존 ${outPath} 의 모양이 학습 장부(learn-lotto)가 아니라 덮어쓰지 않습니다`);
  }
  let pr = 0;
  for (const r of jr.rows) {
    if (!r || !Number.isInteger(r.r) || r.r <= pr || (r.status !== 'pending' && r.status !== 'done')) throw new Fail(`기존 일지 행 r=${r && r.r} 이 오름차순·유일·상태(pending/done)가 아니라 덮어쓰지 않습니다`);
    pr = r.r;
  }
  return j;
}

/* ═════════════ 입력: 이번 주 추천 10줄 · 모의 원장 ═════════════ */
function readRec(summaryPath, explicit, next, log) {
  if (!fs.existsSync(summaryPath)) { log.warn(`${explicit ? '--summary ' : ''}${summaryPath} 가 없어 ${next}회 rec 없이 씁니다`); return null; }
  let s; try { s = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch (e) { log.warn(`${summaryPath} 를 읽을 수 없어 rec 없이 씁니다: ${e.message}`); return null; }
  const L = s && s.lotto;
  if (!L || L.next !== next) { log.warn(`추천 요약의 lotto.next=${L && L.next} 이 ${next} 와 달라 ${next}회 rec 없이 씁니다`); return null; }
  const picks = Array.isArray(L.picks) ? L.picks : null;
  const nums = picks && picks.length === CONF.LINES ? picks.map(parseLine) : null;
  if (!nums || nums.some((x) => x === null)) { log.warn(`추천 요약의 picks 가 ${CONF.LINES}줄(서로 다른 6개, 1..45)이 아니라 ${next}회 rec 없이 씁니다`); return null; }
  return nums.map(normLine);
}
function readSimPicks(simPath, explicit, latest, log) {      // 재현 범위 안 done 행의 A~E 5줄 → Map(회차 → 줄 5개)
  const out = new Map();
  if (!fs.existsSync(simPath)) { if (explicit) log.warn(`--sim ${simPath} 가 없어 돌아보면의 rec 를 비웁니다`); return out; }
  let s; try { s = JSON.parse(fs.readFileSync(simPath, 'utf8')); } catch (e) { log.warn(`${simPath} 를 읽을 수 없어 돌아보면의 rec 를 비웁니다: ${e.message}`); return out; }
  const from = Math.max(2, latest - CONF.REPLAY + 1);
  for (const r of (s && Array.isArray(s.rows) ? s.rows : [])) {
    if (!r || r.status !== 'done' || !Number.isInteger(r.round) || r.round < from || r.round > latest) continue;
    const nums = Array.isArray(r.picks) && r.picks.length === CONF.SIM_LINES ? r.picks.map(parseLine) : null;
    if (nums && nums.every((x) => x !== null)) out.set(r.round, nums.map(normLine));
  }
  return out;
}

/* ═════════════ 관문 (live = done && !late) — 매 실행 다시 계산하는 파생값 ═════════════ */
function buildGate(D, rows, nextRule) {
  const live = rows.filter((x) => x.status === 'done' && x.late === false && x.res);
  const nSig = nextRule.signals.length, R = NSET;
  const sumG3 = (rs, pick) => rs.reduce((s, x) => s + pick(x).g3, 0);

  const recRows = live.filter((x) => x.rec && x.res.rec);
  let rec;
  if (!recRows.length) rec = { weeks: 0, state: 'hold' };
  else {
    const st = statOf(recRows.length, sumG3(recRows, (x) => x.res.rec), ctrlCum(D, recRows.map((x) => x.r), 'c10'));
    let state;
    if (st.weeks < CONF.ALARM_MIN_WEEKS) state = 'hold';
    else if ((1 + st.le) * CONF.ALARM_P[1] <= CONF.ALARM_P[0] * (R + 1)) state = 'alarm';
    else state = 'inside';
    rec = Object.assign({ state }, st);
  }

  const sig = {}, adopted = [];
  for (const s of nextRule.signals) {
    const rs = live.filter((x) => x.sig && x.sig[s] && x.res.sig && x.res.sig[s]);
    if (!rs.length) { sig[s] = { weeks: 0, state: 'hold' }; continue; }
    const st = statOf(rs.length, sumG3(rs, (x) => x.res.sig[s]), ctrlCum(D, rs.map((x) => x.r), 's10'));
    let state;
    if (st.weeks < CONF.ADOPT_MIN_WEEKS) state = 'hold';
    else if ((1 + st.ge) * CONF.ALPHA[1] * nSig <= CONF.ALPHA[0] * (R + 1)) { state = 'adopt'; adopted.push(s); }
    else state = 'none';
    sig[s] = Object.assign({ state }, st);
  }
  return { alarm: rec.state === 'alarm', adopted, rec, sig };
}

/* ═════════════ 돌아보면(사후) 재현 — 최근 REPLAY 회에 4신호를 walk-forward 로 ═════════════ */
function buildReplay(D, latest, simPicks, names) {
  const from = Math.max(2, latest - CONF.REPLAY + 1), to = latest, rounds = [];
  for (let r = from; r <= to; r++) rounds.push(r);
  const cum = {}; for (const s of names) cum[s] = 0;
  let recCum = 0; const recRounds = [];
  for (const r of rounds) {
    const ss = signalSet(D, r, names);
    for (const s of names) cum[s] += gradeLines(ss[s].lines, D[r]).g3;
    const rp = simPicks.get(r);
    if (rp) { recCum += gradeLines(rp, D[r]).g3; recRounds.push(r); }
  }
  const sigBase = ctrlCum(D, rounds, 's10');
  const sig = {};
  for (const s of names) sig[s] = statOf(rounds.length, cum[s], sigBase);
  const rec = recRounds.length ? statOf(recRounds.length, recCum, ctrlCum(D, recRounds, 'c5')) : null;
  return { label: '돌아보면(사후)', from, to, rounds: rounds.length, lines: CONF.LINES, recLines: CONF.SIM_LINES, rec, sig };
}

/* ═════════════ 직렬화 — 키 순서는 만든 순서 그대로, journal.rows 는 한 줄에 한 행 ═════════════ */
const ROW_PATHS = new Set(['journal.rows']);
const EXPAND_PATHS = new Set(['summary.gate', 'summary.replay', 'summary.gate.sig', 'summary.replay.sig']);   // 신호마다 한 줄(git 차이를 작게)
function ser(v, depth, p) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const pad = (n) => '  '.repeat(n);
  if (Array.isArray(v) && ROW_PATHS.has(p)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => pad(depth + 1) + JSON.stringify(x)).join(',\n') + '\n' + pad(depth) + ']';
  }
  if (!Array.isArray(v) && (depth < 2 || EXPAND_PATHS.has(p))) {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{\n' + ks.map((k) => pad(depth + 1) + JSON.stringify(k) + ': ' + ser(v[k], depth + 1, p ? p + '.' + k : k)).join(',\n') + '\n' + pad(depth) + '}';
  }
  return JSON.stringify(v);
}

/* ═════════════ 인자 · 본체 ═════════════ */
function parseArgs(argv) {
  const o = { root: '.', history: 'lotto-history.json', summary: null, sim: null, out: 'brief/learn-lotto.json', now: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Fail(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break;
      case '--history': o.history = need(); break;
      case '--summary': o.summary = need(); break;
      case '--sim': o.sim = need(); break;
      case '--out': o.out = need(); break;
      case '--now': o.now = need(); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Fail('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}

function main() {
  const t00 = performance.now(), lap = {};
  const tick = (k) => { const t = performance.now(); lap[k] = Math.round(t - (tick.t || t00)); tick.t = t; };
  const log = {
    warn: (m) => console.log(`::warning title=${TITLE}::${esc(m)}`),
    info: (m) => console.log(`${TITLE}: ${m}`)
  };
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log('사용: node scripts/learn-ledger.mjs --root . --history lotto-history.json --summary brief/latest-summary.json --sim brief/sim-lotto.json --out brief/learn-lotto.json [--now ISO]'); return; }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), outPath = res(opt.out);
  let nowIso;
  if (opt.now == null) nowIso = new Date().toISOString();
  else { const ms = Date.parse(opt.now); if (!Number.isFinite(ms)) throw new Fail(`--now ${opt.now} 가 ISO 시각이 아닙니다`); nowIso = new Date(ms).toISOString(); }

  /* 1 이력 */
  let hist; try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { throw new Fail(`이력 ${histPath} 를 읽을 수 없거나 JSON 이 아닙니다: ${e.message}`); }
  const { D, latest } = normalize(hist);
  const next = latest + 1;
  tick('load');

  /* 2~3 기존 out · 역행 가드 */
  const prev = readPrev(outPath);
  if (prev) {
    const doneMax = prev.journal.rows.reduce((m, x) => (x.status === 'done' ? Math.max(m, x.r) : m), 0);
    const pendMax = prev.journal.rows.reduce((m, x) => (x.status === 'pending' ? Math.max(m, x.r) : m), 0);
    if (latest < doneMax || pendMax > next) {
      log.warn(`역행 가드: 이력 latest ${latest} 가 기존 일지(채점 완료 ${doneMax ? '최대 ' + doneMax + '회' : '없음'}, 대기 ${pendMax ? pendMax + '회' : '없음'})보다 뒤처졌습니다 — 파일을 쓰지 않습니다`);
      return;
    }
  }

  /* 4~5 일지 */
  const recLines = readRec(opt.summary ? res(opt.summary) : res('brief/latest-summary.json'), !!opt.summary, next, log);
  const nextRule = ruleFor(next);
  const { journal, checks } = buildJournal(D, latest, prev, next, recLines, nowIso, log);
  tick('journal');

  /* 6~7 관문 · 돌아보면 */
  const gate = buildGate(D, journal.rows, nextRule);
  tick('gate');
  const simPicks = readSimPicks(opt.sim ? res(opt.sim) : res('brief/sim-lotto.json'), !!opt.sim, latest, log);
  const replay = buildReplay(D, latest, simPicks, nextRule.signals);
  tick('replay');

  const liveN = journal.rows.filter((x) => x.status === 'done' && x.late === false).length;
  const out = {
    v: 1, kind: 'learn-lotto', ver: VER, generated: nowIso,
    source: { file: path.basename(histPath), latest, count: latest, digest: sourceDigest(D, latest) },
    conf: JSON.parse(JSON.stringify(CONF)), rules: JSON.parse(JSON.stringify(RULES)),
    summary: {
      next, live: { done: journal.rows.filter((x) => x.status === 'done').length, late: journal.rows.filter((x) => x.late === true).length, counted: liveN, pending: journal.rows.filter((x) => x.status === 'pending').length },
      gate, replay
    },
    journal, checks
  };

  /* 8 쓰기 — 직렬화가 값을 바꾸지 않았는지 되읽어 확인하고, 크기를 보고, 임시 파일 → rename */
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

  /* 10 알림 */
  log.info(`${(performance.now() - t00) | 0}ms (읽기 ${lap.load} · 일지 ${lap.journal} · 관문 ${lap.gate} · 재현 ${lap.replay} · 쓰기 ${lap.write}) · ${bytes}바이트 → ${outPath}`);
  console.log(`::notice title=학습 장부::${esc(`${next}회 사전 등록 · 일지 ${journal.rows.length}행(집계 ${liveN}주, 늦음 ${out.summary.live.late}) · 추가 ${checks.added} · 채점 ${checks.graded}`)}`);
  if (gate.alarm) {
    const r = gate.rec;
    const where = r.rank > r.n ? `대조군 ${r.n}벌 모두보다 낮음` : `대조군 ${r.n}벌 중 ${r.rank}위`;
    console.log(`::warning title=낙첨 분석::${esc(`추천 10줄의 ${r.weeks}주 누적(${r.cum})이 같은 주 무작위 ${where}(대조군 범위 ${r.min}~${r.max}) — 하위 1% 안입니다. 버그 의심: 추천 줄 생성·채점·입력을 점검하세요`)}`);
  }
  for (const s of gate.adopted) {
    const g = gate.sig[s];
    const where = g.rank === 1 && g.tie === 0 ? `대조군 ${g.n}벌 모두보다 높음` : `대조군 ${g.n}벌 중 ${g.rank}위`;
    console.log(`::notice title=학습 실험실::${esc(`신호 ${s} 채택 조건 충족(${g.weeks}주 · 누적 ${g.cum} · ${where}) — 추천 반영은 소유자 결정입니다(코드는 자동으로 바뀌지 않습니다)`)}`);
  }
}

/* 9 $GITHUB_OUTPUT 은 어떤 경로로 끝나든 한 번 쓴다 */
function emitOutput() {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, `wrote=${state.wrote ? 'true' : 'false'}\n`); }
  catch (e) { console.log(`::warning title=${TITLE}::GITHUB_OUTPUT 에 쓸 수 없음: ${esc(e.message)}`); }
}

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
