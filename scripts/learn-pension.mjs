#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   learn-pension.mjs — 연금 낙첨 분석 + 관문 있는 학습 실험실 CI 생성 스크립트 (규격 docs/learn-pension.md)

   하는 일: 이번 주 구매 5장(rec)과 사전 등록 후보 신호 4개(hot·cold·gap·repeat)의 5장씩을 «추첨 전에» 일지(pending)에 얼리고,
            추첨 뒤 «끝에서부터 연속으로 맞힌 자리 수의 합» 으로 채점(done)하며, 같은 주 무작위 대조군 R벌과 견줘
            관문(경보·채택)을 파생값으로 낸다. 하나의 append-only 장부(brief/learn-pension.json)에 쌓는다.
     · 외부 접속 없음. 읽는 파일 = 이력(pension-history.json) · 추천 요약(latest-summary.json) · 모의 원장(sim-pension.json) · 기존 out.
     · 독립 검증은 scripts/check-learn-pension.mjs 가 한다(이 파일을 import 하지 않고 §3~§7 을 다시 구현해 대조).
     · import 하면 main 이 바로 돈다 — 가져다 쓰지 않는다.

   사용
     node scripts/learn-pension.mjs [--root .] [--history brief/pension-history.json] [--summary brief/latest-summary.json]
          [--sim brief/sim-pension.json] [--out brief/learn-pension.json] [--now <ISO>] [-h | --help]
     종료 코드: 0 = 정상 또는 «역행 가드로 쓰지 않음»(wrote=false) · 1 = 실패(쓰기 없음).
     $GITHUB_OUTPUT 이 있으면 어떤 경로로 끝나든 wrote=true|false 를 한 번 쓴다.

   고른 해석(규격이 모호한 곳 — 바꾸려면 규격·검증기와 같이 고친다)
     · 기존 파일 보호의 «행이 일반 객체가 아니면 같다» 는 모든 행에 적용하고, 모든 행의 sig 가 일반 객체이고 신호마다 picks 가 5장 표여야 한다.
     · J1 로 채점할 pending 행의 made 가 해석 가능한 시각 문자열이 아니면 마감 판정을 못 하므로 실패(쓰기 없음)로 둔다.
     · done 행은 res.rec(rec 가 있으면)·res.sig.<신호>(sig 의 모든 신호)가 객체이고 g 가 정수여야 한다 — 관문이 g 를 그대로 더하므로. 어긋나면 실패(쓰기 없음).
     · rec 끝자리 겹침 경고는 추천 요약에서 rec 가 만들어진 모든 실행에서 낸다(J3 새 행이든 J4 대조든).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const TITLE = 'learn-pension';
const MAX_BYTES = 1000000;                                   // CLAUDE.md 규칙 4: 새로 추적하는 파일 하나는 1MB 미만
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

class Fail extends Error {}                                  // 예상된 실패: ::error 한 줄 + exit 1, 쓰기 없음
const state = { wrote: false };                              // finally 에서 $GITHUB_OUTPUT 으로 내보낸다

/* ═════════════ 상수 — 한 곳. 바꾸면 VER 을 올리고 RULES 에 덧붙인다(docs/learn-pension.md §4.1·§11) ═════════════ */
const VER = 'learn-pension-1';
const RULES = [{ ver: 'learn-pension-1', from: 339, signals: ['hot', 'cold', 'gap', 'repeat'] }];   // 덧붙이기만
const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
const CONF = {
  W: 50,                                                     // 신호 창(직전 W회)
  TICKETS: 5,                                                // 주당 장 수(구매·신호·대조군 공통)
  SALT: { ctrl: 0x5043544C },                                // "PCTL" — 대조군 시드 소금
  CTRL_MUL: 0x85EBCA6B,                                      // 벌 번호 혼합 상수
  R: 1000,                                                   // 대조군 벌 수
  ALARM_MIN_WEEKS: 26, ALARM_P: [1, 100],                    // 낙첨 경보: 주 수 ≥ 26 이고 하위 꼬리 비율 ≤ 1/100
  ADOPT_MIN_WEEKS: 52, ALPHA: [1, 20],                       // 채택: 주 수 ≥ 52 이고 상위 꼬리 비율 ≤ α/신호 수, α = 1/20
  REPLAY: 300,                                               // 돌아보면(사후) 재현 범위(최근 회차 수, t ≥ W+1 인 것만)
  CUTOFF_UTC_H: -9                                           // 마감 = 추첨일 00:00Z − 9시간 = 추첨일 0시 KST
};
const NSET = CONF.R;
const TICKET_RE = /^([1-5])조 (\d{6})$/;

/* ═════════════ 기본 도구 ═════════════ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedCtrl = (t, j) => (Math.imul(t, 0x9E3779B1) ^ Math.imul(j, CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0;
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function parseTicket(s) {                                    // "<band>조 <num>" → {band, num} 또는 null
  if (typeof s !== 'string') return null;
  const m = TICKET_RE.exec(s);
  return m ? { band: Number(m[1]), num: m[2] } : null;
}
const picksOk = (a) => Array.isArray(a) && a.length === CONF.TICKETS && a.every((x) => parseTicket(x) !== null);

/* ═════════════ 이력 (§3.1) ═════════════ */
function normalize(hist) {
  if (!Array.isArray(hist) || !hist.length) throw new Fail('이력의 최상위가 비어 있지 않은 배열이 아닙니다');
  const by = new Map();
  for (const r of hist) {
    if (!isObj(r)) throw new Fail('자료 형식 오류 — 이력의 행이 일반 객체가 아닙니다');
    if (!Number.isInteger(r.ep) || r.ep < 1) throw new Fail('자료 형식 오류 — ep 가 1 이상의 정수가 아닙니다');
    if (by.has(r.ep)) throw new Fail(`자료 형식 오류 ${r.ep}회 — 같은 회차가 두 번 있습니다`);
    by.set(r.ep, r);
  }
  let latest = 0; for (const r of by.keys()) if (r > latest) latest = r;
  const D = [null];
  for (let r = 1; r <= latest; r++) {
    const x = by.get(r);
    if (!x) throw new Fail(`자료 구멍 ${r}회 — 1..latest 가 연속이 아니어서 계산하지 않습니다`);
    const ok = Number.isInteger(x.band) && x.band >= 1 && x.band <= 5
      && typeof x.num === 'string' && /^\d{6}$/.test(x.num)
      && typeof x.bonus === 'string' && /^\d{6}$/.test(x.bonus)
      && typeof x.date === 'string' && /^\d{8}$/.test(x.date);
    if (!ok) throw new Fail(`자료 형식 오류 ${r}회 — 조·번호·보너스·추첨일 형식이 맞지 않아 계산하지 않습니다`);
    D.push({ band: x.band, num: x.num, bonus: x.bonus, date: x.date });
  }
  if (latest < CONF.W + 1) throw new Fail(`이력 ${latest}회 — 신호 창(${CONF.W}회)을 채우려면 ${CONF.W + 1}회 이상이 필요합니다`);
  return { D, latest };
}
function digest(D, upto) {
  let s = '';
  for (let r = 1; r <= upto; r++) s += `${r}:${D[r].band},${D[r].num}+${D[r].bonus};`;
  return fnv(s);
}
const cutoffMs = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) + CONF.CUTOFF_UTC_H * 3600000;

/* ═════════════ 채점 (§3.1) ═════════════ */
function lastDigits(num, wn) {                               // L — 끝에서부터 연속으로 같은 자리 수(0..6), 메인 번호와만 견준다
  let L = 0;
  while (L < 6 && num.charCodeAt(5 - L) === wn.charCodeAt(5 - L)) L++;
  return L;
}
function gradeOf(band, num, d) {                             // pension.html gradeOf 와 같은 등수(기록용)
  if (num === d.num) return band === d.band ? 1 : 2;
  if (num === d.bonus) return 8;
  for (let n = 5; n >= 1; n--) if (num.slice(6 - n) === d.num.slice(6 - n)) return 8 - n;
  return 0;
}
function gradePicks(picks, d) {                              // 표 문자열 5장 → {L, gr, g}
  const L = [], gr = []; let g = 0;
  for (const s of picks) {
    const tk = parseTicket(s);
    const l = lastDigits(tk.num, d.num);
    L.push(l); gr.push(gradeOf(tk.band, tk.num, d)); g += l;
  }
  return { L, gr, g };
}

/* ═════════════ 신호 — past(D,t) = 1..t-1 회차만 읽는다. 정수 연산·동점은 작은 숫자(조) 우선 (§3.2) ═════════════ */
function signalPicks(D, t, names) {
  if (t < CONF.W + 1) throw new RangeError(`신호는 ${CONF.W + 1}회부터 만듭니다(t=${t})`);
  const get = (r) => { if (!(r >= 1 && r < t)) throw new RangeError(`누수 방지: ${r}회는 ${t}회 계산에서 읽을 수 없습니다`); return D[r]; };
  const cnt = [], last = [];
  for (let p = 0; p < 6; p++) { cnt.push(new Array(10).fill(0)); last.push(new Array(10).fill(0)); }
  const bandCnt = new Array(6).fill(0), bandLast = new Array(6).fill(0);
  for (let r = 1; r < t; r++) {
    const x = get(r), inWin = r >= t - CONF.W;
    for (let p = 0; p < 6; p++) { const d = x.num.charCodeAt(p) - 48; last[p][d] = r; if (inWin) cnt[p][d]++; }
    bandLast[x.band] = r; if (inWin) bandCnt[x.band]++;
  }
  const prev = get(t - 1);
  const dig = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], bands = [1, 2, 3, 4, 5];
  const order = {                                            // 신호별 (자리 p, 숫자 순위) · (조 순위) 비교 — 마지막 동점은 작은 쪽이 앞
    hot: [(p) => (a, b) => (cnt[p][b] - cnt[p][a]) || (a - b), () => (a, b) => (bandCnt[b] - bandCnt[a]) || (a - b)],
    cold: [(p) => (a, b) => (cnt[p][a] - cnt[p][b]) || (a - b), () => (a, b) => (bandCnt[a] - bandCnt[b]) || (a - b)],
    gap: [(p) => (a, b) => (last[p][a] - last[p][b]) || (a - b), () => (a, b) => (bandLast[a] - bandLast[b]) || (a - b)],
    repeat: [
      (p) => { const pd = prev.num.charCodeAt(p) - 48; return (a, b) => ((b === pd ? 1 : 0) - (a === pd ? 1 : 0)) || (cnt[p][b] - cnt[p][a]) || (a - b); },
      () => (a, b) => ((b === prev.band ? 1 : 0) - (a === prev.band ? 1 : 0)) || (bandCnt[b] - bandCnt[a]) || (a - b)
    ]
  };
  const out = {};
  for (const s of names) {
    if (!order[s]) throw new Fail(`알 수 없는 신호 ${s}`);
    const rk = []; for (let p = 0; p < 6; p++) rk.push(dig.slice().sort(order[s][0](p)));
    const br = bands.slice().sort(order[s][1]());
    const picks = [];
    for (let i = 0; i < CONF.TICKETS; i++) picks.push(`${br[i]}조 ${rk[0][0]}${rk[1][0]}${rk[2][0]}${rk[3][0]}${rk[4][0]}${rk[5][i]}`);
    out[s] = { picks };
  }
  return out;
}

/* ═════════════ 무작위 대조군 ctrl (§3.3) — 벌 하나 = 난수 정확히 35번 ═════════════ */
const ctrlCache = new Map();
function ctrlWeek(D, t) {                                    // 그 주 대조군 R벌의 점수 c_j(t) (Uint8Array, 값 0..6)
  let c = ctrlCache.get(t); if (c) return c;
  const wd = []; for (let p = 0; p < 6; p++) wd.push(D[t].num.charCodeAt(p) - 48);
  c = new Uint8Array(NSET);
  const a = new Array(10), d = new Array(5);
  for (let j = 1; j <= NSET; j++) {
    const rng = mulberry32(seedCtrl(t, j));
    for (let i = 0; i < 10; i++) a[i] = i;
    for (let i = 0; i < 5; i++) { const k = i + Math.floor(rng() * (10 - i)); const v = a[i]; a[i] = a[k]; a[k] = v; }
    let g = 0;
    for (let i = 0; i < 5; i++) {
      for (let p = 0; p < 5; p++) d[p] = Math.floor(rng() * 10);
      rng();                                                 // 조 — 점수엔 안 쓰지만 이 자리에서 소비한다
      if (a[i] === wd[5]) {
        let L = 1;
        for (let p = 4; p >= 0 && d[p] === wd[p]; p--) L++;
        g += L;
      }
    }
    c[j - 1] = g;
  }
  ctrlCache.set(t, c);
  return c;
}
function ctrlHist(D, t) {                                    // 값 0..6 의 벌 수 (길이 7, 합 R)
  const h = new Array(7).fill(0);
  for (const k of ctrlWeek(D, t)) h[k]++;
  return h;
}
function ctrlCum(D, rounds) {                                // 대조군 R벌마다 rounds 의 점수 합
  const acc = new Int32Array(NSET);
  for (const t of rounds) { const c = ctrlWeek(D, t); for (let j = 0; j < NSET; j++) acc[j] += c[j]; }
  return acc;
}

/* ═════════════ 누적 대 대조군 stat (§3.4) ═════════════ */
function statOf(weeks, cum, cums) {
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

/* ═════════════ 일지 (§4.3·§5) ═════════════ */
function buildRes(D, row) {                                  // 얼린 표로 채점한 res — 키 순서 band, num, bonus, [rec], sig, ctrl
  const d = D[row.r];
  const res = { band: d.band, num: d.num, bonus: d.bonus };
  if (hasOwn(row, 'rec')) res.rec = gradePicks(row.rec.picks, d);
  res.sig = {};
  for (const s of Object.keys(row.sig)) res.sig[s] = gradePicks(row.sig[s].picks, d);
  res.ctrl = { n: NSET, h: ctrlHist(D, row.r) };
  return res;
}

function readPrev(outPath) {
  if (!fs.existsSync(outPath)) return null;
  let text; try { text = fs.readFileSync(outPath, 'utf8'); } catch (e) { throw new Fail(`기존 ${outPath} 를 읽을 수 없어 덮어쓰지 않습니다: ${e.message}`); }
  let j; try { j = JSON.parse(text); } catch (e) { throw new Fail(`기존 ${outPath} 가 JSON 이 아니라 덮어쓰지 않습니다(일지 보호): ${e.message}`); }
  const jr = isObj(j) ? j.journal : null;
  if (!isObj(j) || j.kind !== 'learn-pension' || !isObj(jr) || !Array.isArray(jr.rows) || !jr.rows.length || !Array.isArray(jr.missed) || !Number.isInteger(jr.from)) {
    throw new Fail(`기존 ${outPath} 의 모양이 연금 학습 장부(learn-pension)가 아니라 덮어쓰지 않습니다`);
  }
  let pr = 0;
  for (const r of jr.rows) {
    const bad = (m) => { throw new Fail(`기존 일지 행 r=${isObj(r) ? r.r : '?'} 이 ${m} 덮어쓰지 않습니다`); };
    if (!isObj(r)) bad('일반 객체가 아니라');
    if (!Number.isInteger(r.r) || r.r <= pr || (r.status !== 'pending' && r.status !== 'done')) bad('오름차순·유일·상태(pending/done)가 아니라');
    pr = r.r;
    if (hasOwn(r, 'rec') && !(isObj(r.rec) && picksOk(r.rec.picks))) bad('rec.picks(5장 표)가 아니라');
    if (!isObj(r.sig)) bad('sig 가 일반 객체가 아니라');
    for (const s of Object.keys(r.sig)) if (!(isObj(r.sig[s]) && picksOk(r.sig[s].picks))) bad(`sig.${s}.picks(5장 표)가 아니라`);
    if (r.status === 'done' && !(typeof r.made === 'string' && typeof r.gradedAt === 'string' && isObj(r.res))) bad('done 인데 made·gradedAt·res 가 없어');
    if (r.status === 'done') {
      const gOk = (x) => isObj(x) && Number.isInteger(x.g);
      if (hasOwn(r, 'rec') && !gOk(r.res.rec)) bad('done 행의 res 점수 모양이 아니라(res.rec.g)');
      for (const s of Object.keys(r.sig)) if (!(isObj(r.res.sig) && gOk(r.res.sig[s]))) bad(`done 행의 res 점수 모양이 아니라(res.sig.${s}.g)`);
    }
  }
  return j;
}

function buildJournal(D, latest, prev, next, rec, nowIso, log) {
  const old = prev ? prev.journal.rows : [];
  const pendMis = [], regrMis = [];
  let graded = 0, added = 0;

  const freshPending = () => {
    const rule = ruleFor(next);
    const row = { r: next, ver: rule.ver, status: 'pending', made: nowIso, basedOn: next - 1, inputDigest: digest(D, next - 1) };
    if (rec) row.rec = { picks: rec.slice() };
    row.sig = signalPicks(D, next, rule.signals);
    return row;
  };

  /* J1 채점: r ≤ latest 인 pending → done (얼린 표로, 처음 공개한 값 그대로) */
  const rows = [];
  for (const row of old) {
    if (row.status === 'pending' && row.r <= latest) {
      if (typeof row.made !== 'string' || !Number.isFinite(Date.parse(row.made))) throw new Fail(`일지 r=${row.r} 의 made 가 해석 가능한 시각 문자열이 아니라 마감 판정을 못 합니다`);
      const drawDate = D[row.r].date;
      rows.push(Object.assign({}, row, { status: 'done', drawDate, late: Date.parse(row.made) >= cutoffMs(drawDate), res: buildRes(D, row), gradedAt: nowIso }));
      graded++;
      continue;
    }
    rows.push(row);
  }

  /* J5 재채점 대조: 이전 판에서 이미 done 이던 행만. 처음 공개한 값은 그대로 두고 경고만 */
  for (const row of old) {
    if (row.status !== 'done') continue;
    const g = buildRes(D, row);
    let diff = null;
    for (const k of Object.keys(g)) if (JSON.stringify(row.res[k]) !== JSON.stringify(g[k])) { diff = k; break; }
    if (diff === null) for (const k of Object.keys(row.res)) if (!hasOwn(g, k)) { diff = k; break; }
    if (diff !== null) { regrMis.push(`r=${row.r} ${diff}`); log.warn(`J5 재채점이 처음 채점과 다름 r=${row.r}: ${diff} — 기존 값을 유지합니다`); }
  }

  /* J2 빠진 주: 일지 최대 회차+1 .. latest 에 행이 없고 missed 에 없으면 덧붙인다(소급해서 만들지 않는다) */
  const missed = prev ? prev.journal.missed.slice() : [];
  if (rows.length) {
    const lastR = rows.reduce((m, x) => Math.max(m, x.r), 0);
    for (let r = lastR + 1; r <= latest; r++) if (!missed.includes(r) && !rows.some((x) => x.r === r)) missed.push(r);
  }

  /* J3 새 제시 / J4 동결: latest+1 행이 있으면 다시 만들어 대조만 한다 */
  const have = rows.find((x) => x.r === next);
  if (!have) rows.push(freshPending()), added++;
  else if (have.ver !== ruleFor(next).ver) log.warn(`J4 r=${next} 얼린 행의 ver(${have.ver})가 지금 규칙(${ruleFor(next).ver})과 달라 대조하지 않습니다 — 처음 값을 유지합니다`);
  else {
    const fresh = freshPending(), diffs = [];
    if (have.inputDigest !== fresh.inputDigest) diffs.push('inputDigest');
    if (fresh.rec && !(hasOwn(have, 'rec') && sameJSON(have.rec.picks, fresh.rec.picks))) diffs.push('rec');
    for (const s of Object.keys(have.sig)) if (!fresh.sig[s] || !sameJSON(have.sig[s].picks, fresh.sig[s].picks)) diffs.push('sig.' + s);
    if (diffs.length) { pendMis.push(`r=${next} ${diffs.join(',')}`); log.warn(`J4 얼린 제시가 지금 재계산과 다름 r=${next}: ${diffs.join(',')} — 처음 공개한 값을 유지합니다`); }
  }

  const from = prev ? prev.journal.from : next;             // J6: 처음 값 고정
  return { journal: { from, missed, rows }, checks: { kept: old.length - graded, added, graded, pendingMismatch: pendMis, regradeMismatch: regrMis } };
}

/* ═════════════ 입력: 이번 주 구매 5장 · 모의 원장 (§3.5) ═════════════ */
function readRec(summaryPath, next, log) {
  if (!fs.existsSync(summaryPath)) { log.warn(`${summaryPath} 가 없어 ${next}회 rec 없이 씁니다`); return null; }
  let s; try { s = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch (e) { log.warn(`${summaryPath} 를 읽을 수 없어 ${next}회 rec 없이 씁니다: ${e.message}`); return null; }
  const P = isObj(s) ? s.pension : null;
  if (!isObj(P)) { log.warn(`추천 요약에 pension 이 없어 ${next}회 rec 없이 씁니다`); return null; }
  if (P.next !== next) { log.warn(`추천 요약의 pension.next=${P.next} 이 ${next} 와 달라 ${next}회 rec 없이 씁니다`); return null; }
  if (P.rule !== 'portfolio') { log.warn(`추천 요약의 pension.rule=${P.rule} 이 portfolio 가 아니라 ${next}회 rec 없이 씁니다`); return null; }
  const five = Array.isArray(P.picks) && P.picks.length >= CONF.TICKETS ? P.picks.slice(0, CONF.TICKETS) : null;
  if (!five || !picksOk(five)) { log.warn(`추천 요약의 pension.picks 앞 ${CONF.TICKETS}장이 표 모양이 아니라 ${next}회 rec 없이 씁니다`); return null; }
  if (new Set(five.map((x) => x.slice(-1))).size !== CONF.TICKETS) log.warn(`rec 앞 ${CONF.TICKETS}장의 끝자리가 서로 다르지 않습니다 — 대조군이 정확한 기준선이 아닙니다`);
  return five;
}
function readSim(simPath, explicit, from, latest, log) {     // 채택한 done 행의 picks → Map(회차 → 표 5장). 못 읽으면 빈 Map
  const out = new Map();
  if (!fs.existsSync(simPath)) { if (explicit) log.warn(`--sim ${simPath} 가 없어 돌아보면의 rec 를 비웁니다`); return out; }
  let s; try { s = JSON.parse(fs.readFileSync(simPath, 'utf8')); } catch (e) { log.warn(`${simPath} 를 읽을 수 없어 돌아보면의 rec 를 비웁니다: ${e.message}`); return out; }
  if (!isObj(s) || !Array.isArray(s.rows)) { log.warn(`${simPath} 의 모양이 모의 원장이 아니라 돌아보면의 rec 를 비웁니다`); return out; }
  for (const x of s.rows) {
    if (!isObj(x) || x.status !== 'done' || !Number.isInteger(x.round) || x.round < from || x.round > latest) continue;
    if (!picksOk(x.picks)) continue;
    out.set(x.round, x.picks.slice());
  }
  return out;
}

/* ═════════════ 관문 (live = done && late === false) — 매 실행 다시 계산하는 파생값 (§6) ═════════════ */
function buildGate(D, rows, nextRule) {
  const live = rows.filter((x) => x.status === 'done' && x.late === false);
  const nSig = nextRule.signals.length, R = NSET;
  const sum = (rs, pick) => rs.reduce((s, x) => s + pick(x).g, 0);

  const recRows = live.filter((x) => hasOwn(x, 'rec') && isObj(x.res) && isObj(x.res.rec));
  let rec;
  if (!recRows.length) rec = { state: 'hold', weeks: 0 };
  else {
    const st = statOf(recRows.length, sum(recRows, (x) => x.res.rec), ctrlCum(D, recRows.map((x) => x.r)));
    let stt;
    if (st.weeks < CONF.ALARM_MIN_WEEKS) stt = 'hold';
    else if ((1 + st.le) * CONF.ALARM_P[1] <= CONF.ALARM_P[0] * (R + 1)) stt = 'alarm';
    else stt = 'inside';
    rec = Object.assign({ state: stt }, st);
  }

  const sig = {}, adopted = [];
  for (const s of nextRule.signals) {
    const rs = live.filter((x) => isObj(x.sig) && hasOwn(x.sig, s) && isObj(x.res) && isObj(x.res.sig) && isObj(x.res.sig[s]));
    if (!rs.length) { sig[s] = { state: 'hold', weeks: 0 }; continue; }
    const st = statOf(rs.length, sum(rs, (x) => x.res.sig[s]), ctrlCum(D, rs.map((x) => x.r)));
    let stt;
    if (st.weeks < CONF.ADOPT_MIN_WEEKS) stt = 'hold';
    else if ((1 + st.ge) * CONF.ALPHA[1] * nSig <= CONF.ALPHA[0] * (R + 1)) { stt = 'adopt'; adopted.push(s); }
    else stt = 'none';
    sig[s] = Object.assign({ state: stt }, st);
  }
  return { alarm: rec.state === 'alarm', adopted, rec, sig };
}

/* ═════════════ 돌아보면(사후) 재현 (§7) — 최근 REPLAY 회에 신호를 walk-forward 로 ═════════════ */
function buildReplay(D, latest, simMap, names) {
  const from = Math.max(CONF.W + 1, latest - CONF.REPLAY + 1), to = latest, rounds = [];
  for (let r = from; r <= to; r++) rounds.push(r);
  const cum = {}; for (const s of names) cum[s] = 0;
  for (const r of rounds) {
    const ss = signalPicks(D, r, names);
    for (const s of names) cum[s] += gradePicks(ss[s].picks, D[r]).g;
  }
  const base = ctrlCum(D, rounds), sig = {};
  for (const s of names) sig[s] = statOf(rounds.length, cum[s], base);
  const recRounds = rounds.filter((r) => simMap.has(r));
  let rec = null;
  if (recRounds.length) {
    let recCum = 0;
    for (const r of recRounds) recCum += gradePicks(simMap.get(r), D[r]).g;
    rec = statOf(recRounds.length, recCum, ctrlCum(D, recRounds));
  }
  return { label: '돌아보면(사후)', from, to, rounds: rounds.length, tickets: CONF.TICKETS, rec, sig };
}

/* ═════════════ 직렬화 — 키 순서는 만든 순서 그대로, journal.rows 는 한 줄에 한 행 (§4.4) ═════════════ */
const ROW_PATHS = new Set(['journal.rows']);
const EXPAND_PATHS = new Set(['summary.gate', 'summary.replay', 'summary.gate.sig', 'summary.replay.sig']);
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
const USAGE = '사용: node scripts/learn-pension.mjs [--root .] [--history brief/pension-history.json] [--summary brief/latest-summary.json] [--sim brief/sim-pension.json] [--out brief/learn-pension.json] [--now <ISO>] [-h | --help]';
function parseArgs(argv) {
  const o = { root: '.', history: 'brief/pension-history.json', summary: null, sim: null, out: 'brief/learn-pension.json', now: null, help: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Fail(`${a} 값이 없습니다`); return argv[++i]; };
    const key = a === '-h' ? '--help' : a;
    if (['--root', '--history', '--summary', '--sim', '--out', '--now', '--help'].includes(key)) {
      if (seen.has(key)) throw new Fail(`${a} 옵션이 두 번 나왔습니다`);
      seen.add(key);
    }
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
function cleanTmp(outPath) {                                 // 지난 실행이 남긴 임시 파일 정리(없거나 실패해도 조용히)
  try {
    const dir = path.dirname(outPath), pre = path.basename(outPath) + '.tmp-';
    for (const f of fs.readdirSync(dir)) if (f.startsWith(pre) && /^\d+$/.test(f.slice(pre.length))) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* 무시 */ } }
  } catch { /* 폴더가 없으면 그만 */ }
}

function main() {
  const t00 = performance.now();
  const log = {
    warn: (m) => console.log(`::warning title=${TITLE}::${esc(m)}`),
    info: (m) => console.log(`${TITLE}: ${m}`)
  };
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log(USAGE); return; }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), outPath = res(opt.out);
  let nowIso;
  if (opt.now == null) nowIso = new Date().toISOString();
  else {
    const ms = Date.parse(opt.now);
    if (!Number.isFinite(ms)) throw new Fail(`--now ${opt.now} 가 ISO 시각이 아닙니다`);
    nowIso = new Date(Date.parse(opt.now)).toISOString();
  }

  /* 1 이력 */
  let hist; try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { throw new Fail(`이력 ${histPath} 를 읽을 수 없거나 JSON 이 아닙니다: ${e.message}`); }
  const { D, latest } = normalize(hist);
  const next = latest + 1;
  cleanTmp(outPath);

  /* 2~3 기존 out · 역행 가드 */
  const prev = readPrev(outPath);
  if (prev) {
    const doneMax = prev.journal.rows.reduce((m, x) => (x.status === 'done' ? Math.max(m, x.r) : m), 0);
    const pendMax = prev.journal.rows.reduce((m, x) => (x.status === 'pending' ? Math.max(m, x.r) : m), 0);
    if (doneMax > latest || pendMax > next) {
      log.warn(`역행 가드: 이력 latest ${latest} 가 기존 일지(채점 완료 ${doneMax ? '최대 ' + doneMax + '회' : '없음'}, 대기 ${pendMax ? pendMax + '회' : '없음'})보다 뒤처졌습니다 — 파일을 쓰지 않습니다`);
      return;
    }
  }

  /* 4~5 일지 */
  const rec = readRec(res(opt.summary || 'brief/latest-summary.json'), next, log);
  const nextRule = ruleFor(next);
  const { journal, checks } = buildJournal(D, latest, prev, next, rec, nowIso, log);

  /* 6~7 관문 · 돌아보면 */
  const gate = buildGate(D, journal.rows, nextRule);
  const simMap = readSim(res(opt.sim || 'brief/sim-pension.json'), !!opt.sim, Math.max(CONF.W + 1, latest - CONF.REPLAY + 1), latest, log);
  const replay = buildReplay(D, latest, simMap, nextRule.signals);

  const rowsAll = journal.rows;
  const live = { done: rowsAll.filter((x) => x.status === 'done').length, late: rowsAll.filter((x) => x.late === true).length, counted: rowsAll.filter((x) => x.status === 'done' && x.late === false).length, pending: rowsAll.filter((x) => x.status === 'pending').length };
  const out = {
    v: 1, kind: 'learn-pension', ver: VER, generated: nowIso,
    source: { file: path.basename(histPath), latest, count: latest, digest: digest(D, latest) },
    conf: JSON.parse(JSON.stringify(CONF)), rules: JSON.parse(JSON.stringify(RULES)),
    summary: { next, live, gate, replay },
    journal, checks
  };

  /* 8 쓰기 — 직렬화가 값을 바꾸지 않았는지 되읽어 확인하고, 크기를 보고, 임시 파일 → rename. 같아도 매번 쓴다 */
  const text = ser(out, 0, '') + '\n';
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(out)) throw new Fail('직렬화 점검 실패(되읽은 값이 원본과 다름) — 쓰지 않습니다');
  const bytes = Buffer.byteLength(text);
  if (bytes >= MAX_BYTES) throw new Fail(`산출 크기 ${bytes}바이트 ≥ 1MB (CLAUDE.md 규칙 4) — 쓰지 않습니다`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, outPath); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* 임시 파일이 없으면 그만 */ } throw new Fail(`쓰기 실패: ${e.message}`); }
  state.wrote = true;

  /* 10 알림 */
  log.info(`${(performance.now() - t00) | 0}ms · ${bytes}바이트 → ${outPath}`);
  console.log(`::notice title=연금 학습 장부::${esc(`${next}회 사전 등록 · 일지 ${rowsAll.length}행(집계 ${live.counted}주, 늦음 ${live.late}) · 추가 ${checks.added} · 채점 ${checks.graded}`)}`);
  if (gate.alarm) {
    const r = gate.rec;
    const where = r.rank > r.n ? `대조군 ${r.n}벌 모두보다 낮음` : `대조군 ${r.n}벌 중 ${r.rank}위`;
    console.log(`::warning title=연금 낙첨 분석::${esc(`구매 ${CONF.TICKETS}장의 ${r.weeks}주 누적(${r.cum})이 같은 주 무작위 ${where}(대조군 범위 ${r.min}~${r.max}) — 하위 ${CONF.ALARM_P[0] * 100 / CONF.ALARM_P[1]}% 안입니다. 점검: 구매 ${CONF.TICKETS}장의 끝자리 구조·채점·입력`)}`);
  }
  for (const s of gate.adopted) {
    const g = gate.sig[s];
    console.log(`::notice title=연금 학습 실험실::${esc(`신호 ${s} 채택 조건 충족(${g.weeks}주 · 누적 ${g.cum} · 대조군 ${g.n}벌 중 ${g.rank}위) — 추천 반영은 소유자 결정입니다(코드는 자동으로 바뀌지 않습니다)`)}`);
  }
}

/* $GITHUB_OUTPUT 은 어떤 경로로 끝나든 한 번 쓴다 */
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
