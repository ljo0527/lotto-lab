#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-learn-pension.mjs — 연금 학습 장부(brief/learn-pension.json) 독립 재계산 검사기 (규격 docs/learn-pension.md §8)

   원칙 — 이 파일은 규격 문서만 보고 쓴 «독립 구현»이다(CLAUDE.md 규칙 10).
     · scripts/learn-pension.mjs 를 import 하지도 실행하지도 않는다. 이력 정규화·신호·대조군·채점·꼬리 비율·관문·재현·지문·직렬화를
       이 파일 안에서 다시 만든다. 같은 규격을 읽고 따로 만든 두 구현이 바이트까지 같아야 통과다(P9).
       (정적 점검 P8 만 생성기 소스를 «글자 그대로 읽어» 난수·시계·import 쓰임을 센다 — 실행·import 없음.)
     · 로또 짝 check-learn.mjs 도 import 하지 않는다(필요한 도구는 복사했다). pension.html·record.html 코드도 가져오지 않는다.
     · 읽기 전용이다. 실패는 `::error title=check-learn-pension::P<번호> …` 한 줄씩, 경고는 `::warning …`.

   사용
     node scripts/check-learn-pension.mjs --root . --file brief/learn-pension.json --history brief/pension-history.json
          [--summary brief/latest-summary.json] [--sim brief/sim-pension.json] [--prev-git HEAD | --prev <이전 파일>]
          [--page record.html] [--gen scripts/learn-pension.mjs] [--only P2,P4] [--skip P6]

   종료 코드 (CI 되돌림이 이것으로 갈린다 — 규격 §8.1 · §9.1)
     0  고른 검사 모두 통과(경고는 있어도 됨)
     1  장부 데이터 실패: P0~P6·P9 중 하나라도 실패, 또는 옵션 오류·입력(이력·--file) 읽기 실패·잡히지 않은 예외
     2  장부 데이터는 맞고 P7(화면 문구)·P8(생성기 소스)만 실패 — 장부를 되돌리지 않는다(되돌리면 그 주 pending 이 영영 사라진다)

   경고만 내는 항목(이유)
     · P3 «이전 판에 이미 있던 행» 의 rec 가 지금 추천 요약과 다름 — 처음 공개한 값 동결 원칙(생성기도 ::warning 만). 이전 판을 모를 때는 새 행을 가려낼 수 없어 경고로 낮춘다.
     · P3 rec 끝자리 겹침 — 소유자가 추천 규칙을 바꾼 정상 상황일 수 있다(규격 §11). 대신 매주 경고로 남긴다.
     · P3 모의 원장과 다름 — 모의 원장은 «가정» 장부라 참고 대조다.
     · P0 checks 의 불일치 배열이 비어 있지 않음 — 생성기가 이미 경고했다. 원인은 사람이 본다.
     · --summary·--sim 파일 없음 — 생성기도 경고만 내고 «없음» 을 정해진 입력 상태로 다룬다(다만 받은 입력이 갈려 결과가 다르면 P5·P9 가 오류).
   이력 정정(과거 회차 값이 바뀜)은 경고가 아니라 오류다(P2·P4·P6·P9) — 장부가 멈추는 의도된 정지, 수리 절차는 규격 §11.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* ═════════════ 규격 상수 (docs/learn-pension.md §4.1 — 생성기 코드를 보지 않고 문서에서 옮김) ═════════════ */
const VER = 'learn-pension-1';
const RULES = [{ ver: 'learn-pension-1', from: 339, signals: ['hot', 'cold', 'gap', 'repeat'] }];   // 덧붙이기만
const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
const CONF = {
  W: 50,
  TICKETS: 5,
  SALT: { ctrl: 0x5043544C },
  CTRL_MUL: 0x85EBCA6B,
  R: 1000,
  ALARM_MIN_WEEKS: 26, ALARM_P: [1, 100],
  ADOPT_MIN_WEEKS: 52, ALPHA: [1, 20],
  REPLAY: 300,
  CUTOFF_UTC_H: -9
};
const MAX_BYTES = 1000000;
const TOP_KEYS = ['v', 'kind', 'ver', 'generated', 'source', 'conf', 'rules', 'summary', 'journal', 'checks'];
const CHECKS_KEYS = ['kept', 'added', 'graded', 'pendingMismatch', 'regradeMismatch'];
const CHECK_IDS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];
const TICKET_RE = /^([1-5])조 (\d{6})$/;
const TITLE = 'check-learn-pension';

/* ── §8.2 P7·P8 정규식·자르기 원문(규격의 코드 블록 그대로) ── */
const FORBID = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
const THEORY_PEN = /p값|σ|표준편차|기대|몬테카를로|정확 확률|이론|상한|평균/;
function pageSections(html) {            // 없는 구간은 null
  const out = { section: null, js: null };
  const at = html.indexOf('id="learnPenWrap"');
  if (at >= 0) {
    const s = html.lastIndexOf('<section', at), e = html.indexOf('</section>', at);
    if (s >= 0 && e > at) out.section = html.slice(s, e + '</section>'.length);
  }
  const b = html.indexOf('/* LEARNPEN-BEGIN */'), f = html.indexOf('/* LEARNPEN-END */');
  if (b >= 0 && f > b) out.js = html.slice(b, f + '/* LEARNPEN-END */'.length);
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const RANDOM = /Math\s*\.\s*random/;
const DATE_LINE = /\bDate\b/;
const DATE_OK = /Date\.parse|Date\.UTC|new Date\((?:[A-Za-z_$][\w$]*)?\)\.toISOString\(\)/;
const DYNAMIC = /\bimport\s*\(|\bimport\s*\.\s*meta\b|\brequire\s*\(/;
const IMPORT_FROM = /^\s*import\b[^;'"]*['"]([^'"]+)['"]/gm;
const IMPORT_OK = new Set(['node:fs', 'node:path']);

/* ═════════════ 도구 ═════════════ */
const imul = Math.imul;
const asc = (a, b) => a - b;
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = imul(h, 0x01000193) >>> 0; } return 'fnv:' + h.toString(16).padStart(8, '0'); }
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = imul(a ^ (a >>> 15), 1 | a);
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedCtrl = (t, j) => (imul(t, 0x9E3779B1) ^ imul(j, CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0;
const cutoffMs = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) + CONF.CUTOFF_UTC_H * 3600000;
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const short = (v) => { const s = v === undefined ? '없음' : JSON.stringify(v); return s.length > 90 ? s.slice(0, 87) + '…' : s; };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const lf = (s) => s.replace(/\r\n/g, '\n');
function isISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && new Date(ms).toISOString() === s;
}

/* 깊은 비교 — 객체는 키 집합과 값(키 순서는 안 본다), 배열은 길이·순서, 원시값은 === (JSON.stringify 대조 아님) */
function deepEq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!has(b, k) || !deepEq(a[k], b[k])) return false;
  return true;
}
function firstDiff(got, want, p) {           // 첫 차이 경로(진단용)
  if (want === null || typeof want !== 'object' || got === null || typeof got !== 'object') return got === want ? null : `${p || '값'}: ${short(got)} ≠ 기대 ${short(want)}`;
  if (Array.isArray(want) !== Array.isArray(got)) return `${p}: 모양(배열/객체)이 다름`;
  if (Array.isArray(want) && got.length !== want.length) return `${p}: 길이 ${got.length} ≠ 기대 ${want.length}`;
  const ks = new Set([...Object.keys(want), ...Object.keys(got)]);
  for (const k of ks) { const d = firstDiff(got[k], want[k], p ? p + '.' + k : k); if (d) return d; }
  return null;
}

/* ── §4.4 직렬화 (바이트 규격) ── */
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

/* ═════════════ 결과 수집 ═════════════ */
const R_ = { items: [], crashed: false };
let cur = null;
const err = (m) => cur.errors.push(m), wrn = (m) => cur.warnings.push(m), note = (m) => cur.notices.push(m);
function runCheck(id, title, selected, fn) {
  const it = { id, title, errors: [], warnings: [], notices: [], skipped: false, ms: 0 };
  R_.items.push(it);
  if (!selected) { it.skipped = true; it.notices.push('생략(옵션)'); return it; }
  cur = it; const t0 = performance.now();
  try { fn(); } catch (e) { R_.crashed = true; err('검사 중 예외: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  it.ms = performance.now() - t0; cur = null;
  return it;
}
function skipCheck(id, title, why) { R_.items.push({ id, title, errors: [], warnings: [], notices: ['생략: ' + why], skipped: true, ms: 0 }); }

/* ═════════════ §3.1 이력 정규화 ═════════════ */
function loadHistory(raw) {
  const problems = [], D = [null];
  if (!Array.isArray(raw) || raw.length === 0) return { problems: ['최상위가 비어 있지 않은 배열이 아님'], D, latest: 0 };
  const by = new Map(); let latest = 0;
  for (const r of raw) {
    if (!isObj(r)) { problems.push('행이 일반 객체가 아님'); continue; }
    if (!Number.isInteger(r.ep) || r.ep < 1) { problems.push(`ep 형식 ${short(r.ep)}`); continue; }
    if (by.has(r.ep)) { problems.push(`중복 ${r.ep}회`); continue; }
    by.set(r.ep, r); if (r.ep > latest) latest = r.ep;
  }
  if (problems.length) return { problems, D, latest };
  for (let r = 1; r <= latest; r++) {
    const x = by.get(r);
    if (!x) { problems.push(`구멍 ${r}회`); D.push(null); continue; }
    const ok = Number.isInteger(x.band) && x.band >= 1 && x.band <= 5 && typeof x.num === 'string' && /^\d{6}$/.test(x.num) &&
      typeof x.bonus === 'string' && /^\d{6}$/.test(x.bonus) && typeof x.date === 'string' && /^\d{8}$/.test(x.date);
    if (!ok) { problems.push(`형식 ${r}회`); D.push(null); continue; }
    D.push({ band: x.band, num: x.num, bonus: x.bonus, date: x.date });
  }
  if (!problems.length && latest < CONF.W + 1) problems.push(`latest ${latest} < ${CONF.W + 1} (신호 창을 채울 수 없음)`);
  return { problems, D, latest };
}
function digestUpto(D, u) {
  let s = '';
  for (let r = 1; r <= u; r++) s += r + ':' + D[r].band + ',' + D[r].num + '+' + D[r].bonus + ';';
  return fnv(s);
}

/* ═════════════ §3.1 표·점수·등수 ═════════════ */
function parseTickets(picks) {                // 5장 표 배열이면 [{band,num}]×5, 아니면 null
  if (!Array.isArray(picks) || picks.length !== CONF.TICKETS) return null;
  const out = [];
  for (const s of picks) { const m = typeof s === 'string' ? TICKET_RE.exec(s) : null; if (!m) return null; out.push({ band: Number(m[1]), num: m[2] }); }
  return out;
}
function scoreL(num, wn) { let L = 0; while (L < 6 && num[5 - L] === wn[5 - L]) L++; return L; }
function gradeOne(band, num, d) {             // pension.html gradeOf 와 같은 규칙(코드는 가져오지 않음)
  if (num === d.num) return band === d.band ? 1 : 2;
  if (num === d.bonus) return 8;
  for (let n = 5; n >= 1; n--) if (num.slice(6 - n) === d.num.slice(6 - n)) return 8 - n;
  return 0;
}
function gradeSet(tickets, d) {
  const L = tickets.map((t) => scoreL(t.num, d.num));
  return { L, gr: tickets.map((t) => gradeOne(t.band, t.num, d)), g: L.reduce((a, b) => a + b, 0) };
}

/* ═════════════ §3.2 신호 — 1..t-1 만 담은 배열 P(P[i] = i+1 회차)로만 계산한다 ═════════════ */
function expectedSigPicks(D, t, names) {
  const P = D.slice(1, t);                    // t 이후는 아예 넘기지 않는다
  const n = P.length, win = P.slice(n - CONF.W);
  const cnt = [], last = [];
  for (let p = 0; p < 6; p++) { cnt.push(new Array(10).fill(0)); last.push(new Array(10).fill(0)); }
  const bandCnt = new Array(6).fill(0), bandLast = new Array(6).fill(0);
  for (const d of win) { for (let p = 0; p < 6; p++) cnt[p][d.num.charCodeAt(p) - 48]++; bandCnt[d.band]++; }
  P.forEach((d, i) => { for (let p = 0; p < 6; p++) last[p][d.num.charCodeAt(p) - 48] = i + 1; bandLast[d.band] = i + 1; });
  const prev = P[n - 1];
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], bands = [1, 2, 3, 4, 5];
  const cmpFor = {
    hot: (p) => (a, b) => (cnt[p][b] - cnt[p][a]) || (a - b),
    cold: (p) => (a, b) => (cnt[p][a] - cnt[p][b]) || (a - b),
    gap: (p) => (a, b) => (last[p][a] - last[p][b]) || (a - b),
    repeat: (p) => { const pd = prev.num.charCodeAt(p) - 48; return (a, b) => ((a === pd ? 0 : 1) - (b === pd ? 0 : 1)) || (cnt[p][b] - cnt[p][a]) || (a - b); }
  };
  const bandCmp = {
    hot: (a, b) => (bandCnt[b] - bandCnt[a]) || (a - b),
    cold: (a, b) => (bandCnt[a] - bandCnt[b]) || (a - b),
    gap: (a, b) => (bandLast[a] - bandLast[b]) || (a - b),
    repeat: (a, b) => ((a === prev.band ? 0 : 1) - (b === prev.band ? 0 : 1)) || (bandCnt[b] - bandCnt[a]) || (a - b)
  };
  const out = {};
  for (const s of names) {
    const rk = []; for (let p = 0; p < 6; p++) rk.push(digits.slice().sort(cmpFor[s](p)));
    const br = bands.slice().sort(bandCmp[s]);
    const head = rk[0][0] + '' + rk[1][0] + rk[2][0] + rk[3][0] + rk[4][0];
    const picks = []; for (let i = 0; i < CONF.TICKETS; i++) picks.push(`${br[i]}조 ${head}${rk[5][i]}`);
    out[s] = picks;
  }
  return out;
}

/* ═════════════ §3.3 무작위 대조군 ═════════════ */
const ctrlMemo = new Map();
function ctrlOf(D, t) {                       // Int8Array(R): c_j(t), 벌 하나 = 난수 정확히 35번
  const key = t + ':' + D[t].num;
  if (ctrlMemo.has(key)) return ctrlMemo.get(key);
  const wn = new Array(6); for (let p = 0; p < 6; p++) wn[p] = D[t].num.charCodeAt(p) - 48;
  const out = new Int8Array(CONF.R), a = new Array(10), d = new Array(6);
  for (let j = 1; j <= CONF.R; j++) {
    const rng = mulberry32(seedCtrl(t, j));
    for (let i = 0; i < 10; i++) a[i] = i;
    for (let i = 0; i < 5; i++) { const k = i + Math.floor(rng() * (10 - i)); const tmp = a[i]; a[i] = a[k]; a[k] = tmp; }
    let g = 0;
    for (let i = 0; i < 5; i++) {
      for (let p = 0; p < 5; p++) d[p] = Math.floor(rng() * 10);
      rng();                                  // band = 1 + floor(rng()*5) — 점수엔 안 쓰지만 이 자리에서 소비
      d[5] = a[i];
      let L = 0; while (L < 6 && d[5 - L] === wn[5 - L]) L++;
      g += L;
    }
    out[j - 1] = g;
  }
  ctrlMemo.set(key, out); return out;
}
function weekHist(D, t) { const h = new Array(7).fill(0); for (const v of ctrlOf(D, t)) h[v]++; return h; }
function ctrlSum(D, rounds) { const acc = new Int32Array(CONF.R); for (const t of rounds) { const c = ctrlOf(D, t); for (let j = 0; j < CONF.R; j++) acc[j] += c[j]; } return acc; }

/* ═════════════ §3.4 누적 대 대조군 stat — 정렬·이분 탐색(정직한 두 번째 구현) ═════════════ */
function statOf(weeks, cum, cums) {
  const s = Array.from(cums).sort(asc), R = s.length;
  const lowerBound = (v) => { let lo = 0, hi = R; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] < v) lo = mid + 1; else hi = mid; } return lo; };
  const lb = lowerBound(cum), ub = lowerBound(cum + 1);
  const hist = []; for (let i = 0; i < R;) { let k = i; while (k < R && s[k] === s[i]) k++; hist.push([s[i], k - i]); i = k; }
  return { weeks, cum, n: R, min: s[0], med: s[Math.floor((R - 1) / 2)], max: s[R - 1], rank: 1 + (R - ub), tie: ub - lb, le: ub, ge: R - lb, hist };
}

/* ═════════════ §6 관문 · §7 재현 ═════════════
   rows 는 «정보 행»: { r, status, late, rec: 표배열|undefined, sig: { 신호: 표배열 } } — 표는 picks 로 다시 채점한다(res 는 믿지 않는다). */
function computeLive(infos) {
  return {
    done: infos.filter((x) => x.status === 'done').length,
    late: infos.filter((x) => x.late === true).length,
    counted: infos.filter((x) => x.status === 'done' && x.late === false).length,
    pending: infos.filter((x) => x.status === 'pending').length
  };
}
function computeGate(D, infos, names) {
  const R = CONF.R, nSig = names.length;
  const live = infos.filter((x) => x.status === 'done' && x.late === false);
  const gOf = (tickets, r) => gradeSet(tickets, D[r]).g;
  let rec = { state: 'hold', weeks: 0 };
  const recRows = live.filter((x) => x.rec);
  if (recRows.length) {
    const st = statOf(recRows.length, recRows.reduce((a, x) => a + gOf(x.rec, x.r), 0), ctrlSum(D, recRows.map((x) => x.r)));
    const state = st.weeks < CONF.ALARM_MIN_WEEKS ? 'hold' : ((1 + st.le) * CONF.ALARM_P[1] <= CONF.ALARM_P[0] * (R + 1) ? 'alarm' : 'inside');
    rec = Object.assign({ state }, st);
  }
  const sig = {}, adopted = [];
  for (const s of names) {
    const rs = live.filter((x) => x.sig && x.sig[s]);
    if (!rs.length) { sig[s] = { state: 'hold', weeks: 0 }; continue; }
    const st = statOf(rs.length, rs.reduce((a, x) => a + gOf(x.sig[s], x.r), 0), ctrlSum(D, rs.map((x) => x.r)));
    let state;
    if (st.weeks < CONF.ADOPT_MIN_WEEKS) state = 'hold';
    else if ((1 + st.ge) * CONF.ALPHA[1] * nSig <= CONF.ALPHA[0] * (R + 1)) { state = 'adopt'; adopted.push(s); } else state = 'none';
    sig[s] = Object.assign({ state }, st);
  }
  return { alarm: rec.state === 'alarm', adopted, rec, sig };
}
/* 모의 원장 행 채택 — replay: true 면 §7(status·범위 포함), false 면 P3 대조용(status·범위 조건 뺌). 같은 round 는 배열에서 가장 뒤 채택 행이 이긴다. */
function adoptSim(rows, replay, from, latest) {
  const m = new Map();
  if (!Array.isArray(rows)) return m;
  for (const x of rows) {
    if (!isObj(x)) continue;
    if (replay && x.status !== 'done') continue;
    if (!Number.isInteger(x.round)) continue;
    if (replay && !(from <= x.round && x.round <= latest)) continue;
    if (!Array.isArray(x.picks) || x.picks.length !== CONF.TICKETS) continue;
    if (!x.picks.every((p) => typeof p === 'string' && TICKET_RE.test(p))) continue;
    m.set(x.round, x.picks.slice());
  }
  return m;
}
function computeReplay(D, latest, names, simRows /* 모의 원장 rows 배열|null */) {
  const from = Math.max(CONF.W + 1, latest - CONF.REPLAY + 1), rounds = [];
  for (let r = from; r <= latest; r++) rounds.push(r);
  const cum = {}; names.forEach((s) => { cum[s] = 0; });
  for (const r of rounds) {
    const picks = expectedSigPicks(D, r, names);
    names.forEach((s) => { cum[s] += gradeSet(parseTickets(picks[s]), D[r]).g; });
  }
  const base = ctrlSum(D, rounds), sig = {};
  names.forEach((s) => { sig[s] = statOf(rounds.length, cum[s], base); });
  let rec = null;
  const sm = adoptSim(simRows, true, from, latest), rr = [...sm.keys()].sort(asc);
  if (rr.length) rec = statOf(rr.length, rr.reduce((a, r) => a + gradeSet(parseTickets(sm.get(r)), D[r]).g, 0), ctrlSum(D, rr));
  return { label: '돌아보면(사후)', from, to: latest, rounds: rounds.length, tickets: CONF.TICKETS, rec, sig };
}

/* ═════════════ 행 → 정보 행 / 기대 행(P9) ═════════════ */
function infoOf(x) {                          // 파일 행 → 정보 행. 표가 5장 표가 아니면 Error
  const info = { r: x.r, status: x.status, late: x.late, rec: undefined, sig: {} };
  if (has(x, 'rec')) { const t = parseTickets(isObj(x.rec) ? x.rec.picks : null); if (!t) throw new Error(`r=${x.r} rec.picks 가 5장 표가 아님`); info.rec = t; }
  if (!isObj(x.sig)) throw new Error(`r=${x.r} sig 가 객체가 아님`);
  for (const s of Object.keys(x.sig)) { const t = parseTickets(isObj(x.sig[s]) ? x.sig[s].picks : null); if (!t) throw new Error(`r=${x.r} sig.${s}.picks 가 5장 표가 아님`); info.sig[s] = t; }
  return info;
}
function expectedRes(D, x) {                  // done 행의 res — 행(파일)의 rec·sig 표를 다시 채점
  const d = D[x.r], res = { band: d.band, num: d.num, bonus: d.bonus };
  if (has(x, 'rec')) res.rec = gradeSet(parseTickets(x.rec.picks), d);
  res.sig = {}; for (const s of Object.keys(x.sig)) res.sig[s] = gradeSet(parseTickets(x.sig[s].picks), d);
  res.ctrl = { n: CONF.R, h: weekHist(D, x.r) };
  return res;
}
/* P9 기대 문서 E — 파일에서 가져오는 것: generated·checks·journal.from·행 목록·행의 status/made/gradedAt/rec. 나머지는 모두 다시 만든다. */
function buildExpected(J, D, latest, histFile) {
  const rows = J.journal.rows, names = ruleFor(latest + 1).signals;
  const erows = [], infos = [];
  for (const x of rows) {
    if (!isObj(x) || !Number.isInteger(x.r) || x.r < CONF.W + 1 || x.r > latest + 1) throw new Error(`행 r=${x && x.r} 를 다시 만들 수 없음(범위 ${CONF.W + 1}..${latest + 1} 밖)`);
    if (x.status !== 'pending' && x.status !== 'done') throw new Error(`행 r=${x.r} status 가 pending/done 이 아님`);
    const rule = ruleFor(x.r), pk = expectedSigPicks(D, x.r, rule.signals), sig = {};
    for (const s of rule.signals) sig[s] = { picks: pk[s] };
    const row = { r: x.r, ver: rule.ver, status: x.status, made: x.made, basedOn: x.r - 1, inputDigest: digestUpto(D, x.r - 1) };
    if (has(x, 'rec')) row.rec = x.rec;
    row.sig = sig;
    if (x.status === 'done') {
      if (x.r > latest) throw new Error(`done 행 r=${x.r} 가 latest 보다 뒤`);
      row.drawDate = D[x.r].date;
      row.late = Date.parse(x.made) >= cutoffMs(D[x.r].date);
      row.res = expectedRes(D, row);
      row.gradedAt = x.gradedAt;
    }
    erows.push(row); infos.push(infoOf(row));
  }
  const have = new Set(rows.map((x) => x.r)), missed = [];
  for (let r = J.journal.from; r <= latest; r++) if (!have.has(r)) missed.push(r);
  return {
    v: 1, kind: 'learn-pension', ver: VER, generated: J.generated,
    source: { file: histFile, latest, count: latest, digest: digestUpto(D, latest) },
    conf: CONF, rules: RULES,
    summary: { next: latest + 1, live: computeLive(infos), gate: computeGate(D, infos, names), replay: null },
    journal: { from: J.journal.from, missed, rows: erows },
    checks: J.checks
  };
}

/* ═════════════ 입력 읽기 ═════════════ */
const readText = (p) => fs.readFileSync(p, 'utf8');
function readJSONSoft(p, label, warn) {       // 없음·JSON 아님 → { obj: null } + 경고 (정해진 입력 상태)
  if (!fs.existsSync(p)) { warn(`${label} 파일이 없음(${p}) — 없는 입력으로 다룸`); return { obj: null, missing: true }; }
  try { return { obj: JSON.parse(readText(p)) }; } catch (e) { warn(`${label} 파일을 읽을 수 없음(${e.message}) — 없는 입력으로 다룸`); return { obj: null, broken: true }; }
}
function wantFor(summary, r) {                // §3.5 — 요약이 그 회차 것이고 모양이 맞으면 앞 5장 표 문자열, 아니면 null
  const p = isObj(summary) ? summary.pension : null;
  if (!isObj(p) || p.next !== r || p.rule !== 'portfolio' || !Array.isArray(p.picks) || p.picks.length < CONF.TICKETS) return null;
  const f = p.picks.slice(0, CONF.TICKETS);
  return f.every((s) => typeof s === 'string' && TICKET_RE.test(s)) ? f : null;
}

/* ═════════════ 검사 ═════════════ */
/* P0 — 반환 { bad }: 이후 검사를 못 돌릴 «모양 실패». from ≠ 첫 행·재직렬화 불일치 같은 것은 bad 가 아니다(P5·P9 가 이어서 본다). */
function checkStructure(J, text, rawLen) {
  const st = { bad: false };
  if (!isObj(J)) { err('최상위가 객체가 아님'); st.bad = true; return st; }
  if (rawLen >= MAX_BYTES) err(`파일 크기 ${rawLen}바이트 ≥ 1MB`);
  if (Object.keys(J).join() !== TOP_KEYS.join()) err('최상위 키가 규격 순서의 10개가 아님: ' + Object.keys(J).join(','));
  if (J.v !== 1) err(`v=${short(J.v)} (기대 1)`);
  if (J.kind !== 'learn-pension') err(`kind=${short(J.kind)}`);
  if (J.ver !== VER) err(`ver=${short(J.ver)} (기대 ${VER})`);
  if (!isISO(J.generated)) err(`generated 가 ISO(밀리초 3자리 Z)가 아님: ${short(J.generated)}`);
  const jr = J.journal;
  if (!isObj(jr) || !Array.isArray(jr.rows) || !Array.isArray(jr.missed) || !Number.isInteger(jr.from)) { err('journal 모양(from 정수·missed[]·rows[])이 맞지 않음'); st.bad = true; }
  if (!isObj(J.summary) || !isObj(J.summary.gate) || !isObj(J.summary.replay)) { err('summary(gate·replay) 모양이 맞지 않음'); st.bad = true; }
  if (!isObj(J.source)) { err('source 가 객체가 아님'); st.bad = true; }
  const c = J.checks;
  if (!isObj(c)) err('checks 가 객체가 아님');
  else {
    if (Object.keys(c).join() !== CHECKS_KEYS.join()) err('checks 키가 kept,added,graded,pendingMismatch,regradeMismatch 순서가 아님: ' + Object.keys(c).join(','));
    for (const k of ['kept', 'added', 'graded']) if (!Number.isInteger(c[k])) err(`checks.${k} 가 정수가 아님`);
    for (const k of ['pendingMismatch', 'regradeMismatch']) {
      if (!Array.isArray(c[k]) || !c[k].every((s) => typeof s === 'string')) err(`checks.${k} 가 문자열 배열이 아님`);
      else if (c[k].length) wrn(`checks.${k} 가 비어 있지 않음(생성기가 J4/J5 불일치를 기록): ${short(c[k])}`);
    }
  }
  if (!isObj(jr) || !Array.isArray(jr.rows)) return st;
  let pr = 0, pend = 0;
  jr.rows.forEach((x, i) => {
    if (!isObj(x)) { err(`일지 행 #${i} 가 일반 객체가 아님`); st.bad = true; return; }
    if (!Number.isInteger(x.r)) { err(`일지 행 #${i} r 가 정수가 아님`); st.bad = true; return; }
    if (x.r <= pr) err(`일지 행 #${i} 회차 ${x.r} 가 오름차순·유일이 아님`);
    pr = x.r;
    if (x.status !== 'pending' && x.status !== 'done') { err(`일지 r=${x.r} 상태 ${short(x.status)} 가 pending/done 이 아님`); st.bad = true; return; }
    const doneKeys = ['drawDate', 'late', 'res', 'gradedAt'];
    if (x.status === 'pending') { pend++; if (i !== jr.rows.length - 1) err(`pending r=${x.r} 이 마지막 행이 아님`); for (const k of doneKeys) if (has(x, k)) err(`pending r=${x.r} 에 ${k} 가 있음`); }
    else for (const k of doneKeys) if (!has(x, k)) err(`done r=${x.r} 에 ${k} 없음`);
  });
  if (pend > 1) err(`pending 이 ${pend}개`);
  if (jr.rows.length && isObj(jr.rows[0]) && jr.rows[0].r !== jr.from) err(`journal.from ${jr.from} ≠ 첫 행 ${jr.rows[0].r}`);
  if (!jr.rows.length) err('일지 행이 하나도 없음');
  const re = ser(J, 0, '') + '\n';
  if (re !== text) {
    const a = re.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    err(`재직렬화 불일치(§4.4 — 한 줄 한 행·공백·LF·끝 줄바꿈): 첫 다른 줄 ${i + 1}번 — 파일 «${short(b[i] === undefined ? '(없음)' : b[i].slice(0, 90))}» ≠ 규격 «${short(a[i] === undefined ? '(없음)' : a[i].slice(0, 90))}»`);
  }
  return st;
}

function checkInput(J, H, histFile) {
  if (H.problems.length) { err('이력 문제: ' + H.problems.slice(0, 6).join('; ') + (H.problems.length > 6 ? ` …외 ${H.problems.length - 6}건` : '')); return; }
  const s = J.source;
  if (!isObj(s)) { err('source 가 객체가 아님'); return; }
  if (s.file !== histFile) err(`source.file ${short(s.file)} ≠ 이력 파일 이름 ${short(histFile)}`);
  if (s.latest !== H.latest || s.count !== H.latest) err(`source.latest/count ${short(s.latest)}/${short(s.count)} ≠ 이력 ${H.latest}`);
  const dg = digestUpto(H.D, H.latest);
  if (s.digest !== dg) err(`source.digest ${short(s.digest)} ≠ 재계산 ${dg}`);
  const cd = firstDiff(J.conf, CONF, 'conf'); if (cd) err('conf 가 §4.1 CONF 와 다름 — ' + cd);
  const rd = firstDiff(J.rules, RULES, 'rules'); if (rd) err('rules 가 §4.1 RULES 와 다름 — ' + rd);
  if (!isObj(J.summary) || J.summary.next !== H.latest + 1) err(`summary.next ${short(J.summary && J.summary.next)} ≠ ${H.latest + 1}`);
}

const HINT_FIX = ' (과거 이력이 정정됐다면 docs/learn-pension.md §11 의 수리 절차)';
function checkSignals(J, H, prev) {
  const rows = J.journal.rows;
  const known = prev.kind === 'ok' || prev.kind === 'absent';
  const prevR = new Set(prev.kind === 'ok' ? prev.json.journal.rows.map((r) => r && r.r) : []);
  if (!known) note('이전 판(--prev/--prev-git)을 몰라 «이번 실행에서 새로 만든 행의 made === generated» 대조는 생략');
  rows.forEach((x) => {
    if (x.r < CONF.W + 2 || x.r > H.latest + 1) { err(`r=${x.r} 가 W+2(${CONF.W + 2})..latest+1(${H.latest + 1}) 범위 밖`); return; }
    if (x.status === 'pending' && x.r !== H.latest + 1) err(`pending r=${x.r} 가 latest+1(${H.latest + 1}) 이 아님`);
    if (x.status === 'done' && x.r > H.latest) err(`done r=${x.r} 가 latest 보다 뒤`);
    const rule = ruleFor(x.r);
    if (x.ver !== rule.ver) err(`r=${x.r} ver ${short(x.ver)} ≠ 규칙표 ${rule.ver}`);
    if (x.basedOn !== x.r - 1) err(`r=${x.r} basedOn ${short(x.basedOn)} ≠ ${x.r - 1}`);
    const dg = digestUpto(H.D, x.r - 1);
    if (x.inputDigest !== dg) err(`r=${x.r} inputDigest ${short(x.inputDigest)} ≠ 재계산 ${dg}` + HINT_FIX);
    if (!isISO(x.made)) err(`r=${x.r} made 가 ISO 시각이 아님: ${short(x.made)}`);
    if (known && !prevR.has(x.r) && x.made !== J.generated) err(`r=${x.r} 은 이전 판에 없던 행인데 made ${short(x.made)} ≠ generated ${short(J.generated)} (미래 누설·late 우회 방지)`);
    if (!isObj(x.sig) || Object.keys(x.sig).join() !== rule.signals.join()) { err(`r=${x.r} sig 신호 목록 ${short(isObj(x.sig) ? Object.keys(x.sig) : x.sig)} ≠ ${rule.signals.join()}`); return; }
    const want = expectedSigPicks(H.D, x.r, rule.signals);
    for (const s of rule.signals) {
      const d = firstDiff(x.sig[s], { picks: want[s] }, `r=${x.r} sig.${s}`);
      if (d) err('신호 5장이 과거만으로 재계산한 값과 다름 — ' + d);
    }
  });
  const last = rows[rows.length - 1];
  if (!last) err('일지 행이 하나도 없음');
  else if (last.status !== 'pending' || last.r !== H.latest + 1) err(`마지막 행이 latest+1(${H.latest + 1}) pending 이 아님 — r=${last.r} ${last.status} (이번 주 사전 등록이 사라짐)`);
  const have = new Set(rows.map((x) => x.r)), wantMissed = [];
  for (let r = J.journal.from; r <= H.latest; r++) if (!have.has(r)) wantMissed.push(r);
  if (!deepEq(J.journal.missed, wantMissed)) err(`journal.missed [${J.journal.missed.join(',')}] ≠ from(${J.journal.from})..latest(${H.latest}) 중 행이 없는 회차 [${wantMissed.join(',')}]`);
}

const lastDigit = (picks) => picks.map((s) => s[s.length - 1]);
function checkRec(J, H, summary, simRows, prev) {
  const rows = J.journal.rows;
  const known = prev.kind === 'ok' || prev.kind === 'absent';
  const prevR = new Set(prev.kind === 'ok' ? prev.json.journal.rows.map((r) => r && r.r) : []);
  if (!known) note('이전 판(--prev/--prev-git)을 몰라 «이번에 새로 얼린 행» 을 가려낼 수 없음 — 추천 요약과의 불일치는 경고로 둠');
  if (summary === null) note('추천 요약을 읽지 못해 추천 요약 대조는 생략');
  const simMap = adoptSim(simRows, false, 0, 0);
  let withRec = 0, fresh = 0;
  rows.forEach((x) => {
    const want = summary === null ? null : wantFor(summary, x.r);
    const candidateNew = x.status === 'pending' && x.r === H.latest + 1;
    const isNew = known && candidateNew && !prevR.has(x.r);
    if (isNew && want) fresh++;
    if (!has(x, 'rec')) {
      if (want && candidateNew) {
        if (isNew) err(`r=${x.r} 이번에 새로 얼린 행에 rec 가 없음 — 추천 요약(pension.next=${x.r})에는 앞 5장이 있음(생성기 회귀 의심 — 커밋되면 영구 동결)`);
        else if (!known) wrn(`r=${x.r} 행에 rec 가 없는데 추천 요약에는 앞 5장이 있음(이전 판을 몰라 새 행인지 가릴 수 없음)`);
      }
      return;
    }
    withRec++;
    const rc = x.rec;
    if (!isObj(rc) || !Array.isArray(rc.picks) || rc.picks.length !== CONF.TICKETS) { err(`r=${x.r} rec.picks 가 정확히 ${CONF.TICKETS}개 배열이 아님`); return; }
    if (Object.keys(rc).join() !== 'picks') err(`r=${x.r} rec 의 키가 picks 하나가 아님: ${Object.keys(rc).join(',')}`);
    if (!rc.picks.every((s) => typeof s === 'string' && TICKET_RE.test(s))) { err(`r=${x.r} rec.picks 에 표 정규식(/^([1-5])조 (\\d{6})$/)에 안 맞는 항목이 있음`); return; }
    if (new Set(lastDigit(rc.picks)).size < CONF.TICKETS) wrn(`r=${x.r} rec 5장의 끝자리가 서로 다르지 않음(대조군이 정확한 기준선이 아님 — 추천 규칙 변경 여부 확인)`);
    if (want && !deepEq(rc.picks, want)) {
      if (isNew) err(`r=${x.r} 이번에 새로 얼린 행의 rec 가 추천 요약 pension.picks 앞 5장과 다름 — 새 행은 같아야 함(커밋되면 영구 동결)`);
      else wrn(`r=${x.r} rec 가 지금 추천 요약 pension.picks 앞 5장과 다름(처음 공개한 값 동결 원칙 — 원인 확인)`);
    }
    if (simMap.has(x.r) && !deepEq(simMap.get(x.r), rc.picks)) wrn(`r=${x.r} rec 가 모의 원장 picks 와 다름(모의 원장은 가정 장부라 참고 대조)`);
  });
  note(`rec 가 있는 행 ${withRec}/${rows.length}` + (known ? ` · 이번에 새로 얼린 행 대조 ${fresh}개` : ''));
}

function checkGrading(J, H, prev) {
  const prevPending = new Set(prev.kind === 'ok' ? prev.json.journal.rows.filter((r) => r && r.status === 'pending').map((r) => r.r) : []);
  J.journal.rows.forEach((x) => {
    if (x.status !== 'done') return;
    const d = H.D[x.r];
    if (!d) { err(`done r=${x.r} 의 이력 없음`); return; }
    if (x.drawDate !== d.date) err(`r=${x.r} drawDate ${short(x.drawDate)} ≠ 이력 ${d.date}`);
    const lateWant = Date.parse(x.made) >= cutoffMs(d.date);
    if (x.late !== lateWant) err(`r=${x.r} late ${short(x.late)} ≠ 재계산 ${lateWant} (made ${short(x.made)} · 마감 ${new Date(cutoffMs(d.date)).toISOString()})`);
    if (!isISO(x.gradedAt)) err(`r=${x.r} gradedAt 이 ISO 시각이 아님: ${short(x.gradedAt)}`);
    const tm = Date.parse(x.made), tg = Date.parse(x.gradedAt), tn = Date.parse(J.generated);
    if (!(tm <= tg && tg <= tn)) err(`r=${x.r} 시각 순서 위반: made ≤ gradedAt ≤ generated 가 아님 (${short(x.made)} / ${short(x.gradedAt)} / ${short(J.generated)})`);
    if (prevPending.has(x.r) && x.gradedAt !== J.generated) err(`r=${x.r} 은 이전 판에서 pending 이었는데 gradedAt ${short(x.gradedAt)} ≠ generated ${short(J.generated)} (이번 실행이 채점)`);
    let want;
    try { want = expectedRes(H.D, x); } catch (e) { err(`r=${x.r} 표를 해석할 수 없어 채점 재계산 불가: ${e.message}`); return; }
    const df = firstDiff(x.res, want, `r=${x.r} res`);
    if (df) err('채점 결과가 재계산과 다름 — ' + df + HINT_FIX);
  });
}

function checkSummary(J, H, simInfo) {
  const rows = J.journal.rows, S = J.summary, names = ruleFor(H.latest + 1).signals;
  const orphan = rows.find((x) => x.status === 'done' && !H.D[x.r]);
  if (orphan) { err(`done r=${orphan.r} 의 이력이 없어 요약을 다시 계산할 수 없음`); return; }
  let infos;
  try { infos = rows.map(infoOf); } catch (e) { err('표를 해석할 수 없어 요약 재계산 불가: ' + e.message); return; }
  const live = computeLive(infos), dl = firstDiff(S.live, live, 'summary.live'); if (dl) err(dl);
  const gate = computeGate(H.D, infos, names), dg = firstDiff(S.gate, gate, 'summary.gate'); if (dg) err('관문(경보·채택)이 picks 로 다시 채점·대조군 재생성한 값과 다름 — ' + dg);
  const rp = computeReplay(H.D, H.latest, names, simInfo.rows), dr = firstDiff(S.replay, rp, 'summary.replay');
  if (dr) err('돌아보면(사후) 재현이 재계산과 다름 — ' + dr + (simInfo.rows === null ? ' [검증기가 sim 을 읽지 못함 — replay.rec 를 null 로 다시 만들어 견줌(입력 불일치)]' : ''));
  note(`관문: 경보 ${gate.alarm} · 채택 [${gate.adopted.join(',')}] · 집계 ${live.counted}주`);
}

/* 이전 판 읽기 — kind: none · ok · absent · error (규격 §8.1) */
const gitRun = (root, args) => {
  try { return { ok: true, out: execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { const er = e && e.stderr ? String(e.stderr).trim().split('\n')[0] : ''; return { ok: false, why: (e && e.code) || er || (e && e.status != null ? `종료 코드 ${e.status}` : 'git 실패') }; }
};
function parsePrev(text0, label) {
  const text = lf(text0);
  let json; try { json = JSON.parse(text); } catch { return { kind: 'error', label, why: `이전 판 ${label} 가 JSON 이 아님` }; }
  if (!isObj(json) || json.kind !== 'learn-pension' || !isObj(json.journal) || !Array.isArray(json.journal.rows)) return { kind: 'error', label, why: `이전 판 ${label} 의 모양이 연금 학습 장부가 아님` };
  return { kind: 'ok', label, text, json };
}
function loadPrev(opt, filePath, root) {
  if (opt.prev) {
    let text; try { text = readText(path.resolve(root, opt.prev)); } catch (e) { return { kind: 'error', label: opt.prev, why: `--prev ${opt.prev} 를 읽을 수 없음(${e.code || e.message})` }; }
    return parsePrev(text, opt.prev);
  }
  if (!opt.prevGit) return { kind: 'none' };
  const rel = path.relative(path.resolve(root), filePath).split(path.sep).join('/'), label = `${opt.prevGit}:${rel}`;
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return { kind: 'error', label, why: '--file 이 --root 밖이라 git 판과 대조할 수 없음' };
  const v = gitRun(root, ['rev-parse', '--verify', '--quiet', `${opt.prevGit}^{commit}`]);
  if (!v.ok) return { kind: 'error', label, why: `--prev-git ${opt.prevGit} 를 git 에서 찾을 수 없음(저장소가 아니거나 REF 없음·얕은 체크아웃, git 실행 실패: ${v.why})` };
  if (!gitRun(root, ['cat-file', '-e', `${opt.prevGit}:./${rel}`]).ok) return { kind: 'absent', label };
  const g = gitRun(root, ['show', `${opt.prevGit}:./${rel}`]);
  if (!g.ok) return { kind: 'error', label, why: `${label} 를 읽지 못함(${g.why})` };
  return parsePrev(g.out, label);
}

/* append-only (P6) — 규격 §8.2 표 */
const rawRows = (t) => { const m = new Map(); for (const l of t.split('\n')) { const x = /^\s*\{"r":(\d+),/.exec(l); if (x) m.set(+x[1], l.trim().replace(/,$/, '')); } return m; };
const DEF_KEYS = ['W', 'TICKETS', 'CTRL_MUL', 'R', 'CUTOFF_UTC_H'];
function checkAppendOnly(J, text, H0, prev) {
  const P = prev.json, label = prev.label;
  const ps = P.source;
  if (!isObj(ps) || !Number.isInteger(ps.latest) || ps.latest > H0.latest) {
    err(`source.latest 역행 — 이전 판 ${short(isObj(ps) ? ps.latest : undefined)} → 지금 ${H0.latest}(정수가 아니거나 지금보다 큼)`);
  } else if (ps.digest !== digestUpto(H0.D, ps.latest)) {
    err(`이력 정정 감지 — 이전 판이 기록한 1..${ps.latest}회 지문 ${short(ps.digest)} ≠ 지금 이력 ${digestUpto(H0.D, ps.latest)}. 과거 회차 값이 바뀌었다(docs/learn-pension.md §11 수리 절차)`);
  }
  if (J.journal.from !== P.journal.from) err(`journal.from ${J.journal.from} ≠ 이전 판 ${P.journal.from}`);
  const curBy = new Map(J.journal.rows.map((r) => [r.r, r]));
  const prow = P.journal.rows.filter(isObj);
  const pr = prow.map((r) => r.r), cr = J.journal.rows.map((r) => r.r);
  if (!deepEq(cr.slice(0, pr.length), pr)) err(`일지 행 회차 목록이 이전 판의 접두가 아님(행 삭제·재정렬·중간 삽입 금지) — 이전 [${pr.join(',')}] / 지금 앞 ${Math.min(pr.length, cr.length)}개 [${cr.slice(0, pr.length).join(',')}]`);
  const FROZEN = ['ver', 'made', 'basedOn', 'inputDigest', 'rec', 'sig'];
  const a = rawRows(prev.text), b = rawRows(text);
  for (const p of prow) {
    const c = curBy.get(p.r);
    if (!c) { err(`이전 판의 일지 r=${p.r} 가 사라짐(행 삭제 금지)`); continue; }
    if (p.status === 'done') {
      if (!deepEq(c, p)) err(`done 행 r=${p.r} 이 이전 판과 다름(불변 위반): ${firstDiff(c, p, 'r=' + p.r) || ''}`);
      else if (a.get(p.r) !== b.get(p.r)) err(`done 행 r=${p.r} 이 값은 같지만 줄 글자가 이전 판과 다름(바이트 불변 위반)`);
    } else if (p.status === 'pending') {
      for (const k of FROZEN) if (!deepEq(c[k], p[k])) err(`이전 판 pending 행 r=${p.r} 의 얼린 필드 ${k} 가 바뀜(${firstDiff(c[k], p[k], k) || '있음/없음'})`);
    }
  }
  const pm = Array.isArray(P.journal.missed) ? P.journal.missed : [];
  if (!deepEq(J.journal.missed.slice(0, pm.length), pm)) err('missed 가 이전 판의 접두 일치가 아님(소급 수정 금지)');
  if (Array.isArray(P.rules)) {
    if (!Array.isArray(J.rules) || !deepEq(J.rules.slice(0, P.rules.length), P.rules)) err('rules 가 이전 판의 접두 일치가 아님(덧붙이기만 허용)');
    else {
      const maxR = prow.reduce((m, r) => Math.max(m, r.r), 0);
      for (let i = P.rules.length; i < J.rules.length; i++) if (!(J.rules[i].from > maxR)) err(`새 rules 항목(${J.rules[i].ver}) from ${J.rules[i].from} ≤ 이전 판 행의 최대 r ${maxR} — 이미 얼린 회차를 덮음(§5 RULES)`);
      if (J.rules.length === P.rules.length && isObj(P.conf) && !deepEq(J.conf, P.conf)) err('rules 길이가 같은데 conf 가 바뀜(VER·rules 를 올리지 않음)');
    }
  }
  if (isObj(P.conf) && isObj(J.conf)) {
    const changed = DEF_KEYS.filter((k) => !deepEq(J.conf[k], P.conf[k]));
    for (const k of Object.keys(P.conf.SALT || {})) if (!deepEq((J.conf.SALT || {})[k], P.conf.SALT[k])) changed.push('SALT.' + k);
    if (changed.length) err(`신호·대조군의 정의 상수가 이전 판과 다름(${changed.join(',')}) — 같은 이름 신호의 정의는 바꿀 수 없다(새 이름 신호로 추가하거나 장부를 갈아타세요, docs §11)`);
  }
  note(`이전 판(${label}) 일지 ${prow.length}행 대조`);
}

function checkWording(J, opt, root) {
  const strs = []; (function walk(v) { if (typeof v === 'string') strs.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { strs.push(k); walk(v[k]); } })(J);
  const m = FORBID.exec(strs.join('\n')); if (m) err(`JSON 문자열에 금지 문구 «${m[0]}»`);
  const page = path.resolve(root, opt.page || 'record.html');
  if (!fs.existsSync(page)) { note(`${opt.page || 'record.html'} 가 아직 없음 — 화면 점검은 안내만`); return; }
  const sec = pageSections(lf(readText(page)));
  if (!sec.section) note('record.html 에 #learnPenWrap 섹션이 아직 없음');
  if (!sec.js) note('record.html 에 JS 구간(LEARNPEN-BEGIN~LEARNPEN-END)이 아직 없음');
  for (const [label, t] of [['#learnPenWrap 섹션', sec.section], ['LEARNPEN JS 구간', sec.js]]) {
    if (!t) continue;
    const f = FORBID.exec(t); if (f) err(`record.html ${label} 에 금지 문구 «${f[0]}»`);
    const th = THEORY_PEN.exec(t); if (th) err(`record.html ${label} 에 화면 이론값 말 «${th[0]}» (규칙 9)`);
  }
}
function checkStatic(opt, root) {
  const p = path.resolve(root, opt.gen || 'scripts/learn-pension.mjs');
  if (!fs.existsSync(p)) { note(`${path.relative(root, p) || p} 가 없어 정적 점검은 안내만`); return; }
  const src = stripComments(lf(readText(p)));
  if (RANDOM.test(src)) err('생성기가 Math.random 을 씀(결정 함수 금지)');
  const dates = src.split('\n').filter((l) => DATE_LINE.test(l));
  const bad = dates.filter((l) => !DATE_OK.test(l));
  if (bad.length) err(`생성기의 Date 쓰임이 허용 모양(Date.parse·Date.UTC·ISO 기록) 밖: ${bad.slice(0, 2).map((l) => l.trim().slice(0, 60)).join(' | ')}`);
  if (DYNAMIC.test(src)) err('생성기가 import()·import.meta·require() 를 씀');
  const bads = [];
  for (const m of src.matchAll(IMPORT_FROM)) if (!IMPORT_OK.has(m[1])) bads.push(m[1]);
  if (bads.length) err(`생성기가 허용 밖 모듈을 import 함: ${bads.join(', ')}`);
  note(`생성기 Date 쓰임 ${dates.length}줄(모두 허용 모양)`);
}

function checkBytes(J, text, H, histFile, simInfo) {
  let E;
  try { E = buildExpected(J, H.D, H.latest, histFile); } catch (e) { err('기대 문서를 다시 만들 수 없음: ' + e.message); return; }
  E.summary.replay = computeReplay(H.D, H.latest, ruleFor(H.latest + 1).signals, simInfo.rows);
  const want = ser(E, 0, '') + '\n';
  if (want === text) { note(`기대 문서와 바이트 동일(${Buffer.byteLength(text)}바이트)`); return; }
  const a = want.split('\n'), b = text.split('\n'); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  err(`기대 문서와 바이트가 다름 — 첫 다른 줄 ${i + 1}번. 파일 «${(b[i] === undefined ? '(없음)' : b[i]).slice(0, 90)}» ≠ 기대 «${(a[i] === undefined ? '(없음)' : a[i]).slice(0, 90)}»` +
    (simInfo.rows === null ? ' [검증기가 sim 을 읽지 못함 — replay.rec 를 null 로 다시 만들어 견줌(입력 불일치)]' : '') + HINT_FIX);
}

/* ═════════════ 진입점 ═════════════ */
const OPTS = ['--root', '--file', '--history', '--summary', '--sim', '--prev-git', '--prev', '--page', '--gen', '--only', '--skip'];
function parseList(s, flag) {
  const names = s.split(',').map((x) => x.trim().toUpperCase());
  const badName = names.find((n) => !CHECK_IDS.includes(n));
  if (badName !== undefined) throw new Error(`${flag} 에 알 수 없는 검사 이름 «${badName}» (P0..P9)`);
  return names;
}
function parseArgs(argv) {
  const o = { root: '.', file: 'brief/learn-pension.json', history: 'brief/pension-history.json', summary: null, sim: null, prevGit: null, prev: null, page: null, gen: null, only: null, skip: null };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log('사용: node scripts/check-learn-pension.mjs --root . --file brief/learn-pension.json --history brief/pension-history.json [--summary f] [--sim f] [--prev-git HEAD | --prev f] [--page record.html] [--gen scripts/learn-pension.mjs] [--only P2,P4] [--skip P6]\n종료 코드: 0 통과 · 1 장부 데이터 실패/옵션·입력 오류 · 2 P7·P8 만 실패');
      process.exit(0);
    }
    if (!OPTS.includes(a)) throw new Error('알 수 없는 옵션 ' + a);
    if (seen.has(a)) throw new Error(`${a} 가 두 번 주어짐`);
    seen.add(a);
    if (i + 1 >= argv.length || OPTS.includes(argv[i + 1]) || argv[i + 1] === '-h' || argv[i + 1] === '--help') throw new Error(`${a} 값이 없습니다`);
    const v = argv[++i];
    switch (a) {
      case '--root': o.root = v; break; case '--file': o.file = v; break; case '--history': o.history = v; break;
      case '--summary': o.summary = v; break; case '--sim': o.sim = v; break; case '--prev-git': o.prevGit = v; break; case '--prev': o.prev = v; break;
      case '--page': o.page = v; break; case '--gen': o.gen = v; break;
      case '--only': o.only = parseList(v, a); break; case '--skip': o.skip = parseList(v, a); break;
    }
  }
  if (o.prev !== null && o.prevGit !== null) throw new Error('--prev 와 --prev-git 을 함께 줄 수 없음');
  return o;
}
function fatal(msg) { console.log(`::error title=${TITLE}::${esc(msg)}`); process.exit(1); }

function main() {
  let opt; try { opt = parseArgs(process.argv.slice(2)); } catch (e) { fatal(e.message); }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), filePath = res(opt.file);
  let raw; try { raw = JSON.parse(readText(histPath)); } catch (e) { fatal(`이력 ${opt.history} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  const H = loadHistory(raw);
  let rawText, J; try { rawText = readText(filePath); J = JSON.parse(rawText); } catch (e) { fatal(`${opt.file} 를 읽을 수 없거나 JSON 이 아님: ${e.message}`); }
  const rawLen = Buffer.byteLength(rawText), text = lf(rawText);
  const t00 = performance.now();
  const pre = { warnings: [] }, softWarn = (m) => pre.warnings.push(m);
  const summary = readJSONSoft(res(opt.summary || 'brief/latest-summary.json'), '추천 요약', softWarn).obj;
  const simR = readJSONSoft(res(opt.sim || 'brief/sim-pension.json'), '모의 원장', softWarn);
  const simInfo = { rows: isObj(simR.obj) && Array.isArray(simR.obj.rows) ? simR.obj.rows : null };
  const sel = (id) => (!opt.only || opt.only.includes(id)) && !(opt.skip && opt.skip.includes(id));
  const histFile = path.basename(histPath);
  const prev = loadPrev(opt, filePath, root);

  const p0 = runCheck('P0', '구조', true, () => { cur.shape = checkStructure(J, text, rawLen); if (rawText.includes('\r')) wrn('파일에 CRLF 가 있음 — LF 로 바꿔 비교함(체크아웃 사본일 수 있음, 규격 §8.1)'); });
  const shapeBad = !!(p0.shape && p0.shape.bad) || R_.crashed;
  if (!sel('P0')) { p0.skipped = true; p0.errors = []; p0.warnings = []; p0.notices = ['생략(옵션)']; }
  runCheck('P1', '입력', sel('P1'), () => checkInput(J, H, histFile));
  const usable = !H.problems.length && !shapeBad;
  const need = (id, title, fn) => { if (!sel(id)) { runCheck(id, title, false, fn); return; } if (!usable) { skipCheck(id, title, H.problems.length ? '이력 문제' : '지금 판 모양 실패'); return; } runCheck(id, title, true, fn); };
  need('P2', '신호·일지 연속', () => checkSignals(J, H, prev));
  need('P3', 'rec', () => checkRec(J, H, summary, simInfo.rows, prev));
  need('P4', '채점', () => checkGrading(J, H, prev));
  need('P5', '요약', () => checkSummary(J, H, simInfo));
  if (!sel('P6')) runCheck('P6', 'append-only', false, null);
  else if (prev.kind === 'error') runCheck('P6', 'append-only', true, () => err(`이전 판을 읽지 못함: ${prev.why}`));
  else if (prev.kind === 'none') skipCheck('P6', 'append-only', '이전 판 없음(--prev-git 또는 --prev 가 없음)');
  else if (prev.kind === 'absent') skipCheck('P6', 'append-only', `이전 판에 파일 없음(${prev.label})`);
  else if (!usable) skipCheck('P6', 'append-only', '지금 판 모양 실패');
  else runCheck('P6', 'append-only', true, () => checkAppendOnly(J, text, H, prev));
  runCheck('P7', '문구·화면', sel('P7'), () => checkWording(J, opt, root));
  runCheck('P8', '정적', sel('P8'), () => checkStatic(opt, root));
  need('P9', '바이트 재구성', () => checkBytes(J, text, H, histFile, simInfo));
  R_.items.sort((x, y) => CHECK_IDS.indexOf(x.id) - CHECK_IDS.indexOf(y.id));

  let nErr = 0, nWarn = 0, dataFail = R_.crashed, tailFail = false;
  for (const it of R_.items) {
    nErr += it.errors.length; nWarn += it.warnings.length;
    if (it.errors.length) { if (it.id === 'P7' || it.id === 'P8') tailFail = true; else dataFail = true; }
    const s = it.skipped ? '생략' : it.errors.length ? `실패 ${it.errors.length}` : '통과';
    console.log(`[${it.id}] ${it.title} — ${s}${it.warnings.length ? ` · 경고 ${it.warnings.length}` : ''} (${(it.ms / 1000).toFixed(1)}s)`);
    for (const n of it.notices) console.log(`  · ${n}`);
  }
  for (const m of pre.warnings) console.log(`::warning title=${TITLE}::${esc(m)}`);
  for (const it of R_.items) {
    for (const m of it.errors.slice(0, 12)) console.log(`::error title=${TITLE}::${esc(`${it.id} ${m}`)}`);
    if (it.errors.length > 12) console.log(`::error title=${TITLE}::${esc(`${it.id} …외 ${it.errors.length - 12}건`)}`);
    for (const m of it.warnings.slice(0, 12)) console.log(`::warning title=${TITLE}::${esc(`${it.id} ${m}`)}`);
  }
  const secs = ((performance.now() - t00) / 1000).toFixed(1);
  if (dataFail) { console.log(`::error title=${TITLE}::${esc(`연금 학습 장부 독립 검증 실패(장부 데이터, 종료 코드 1) — 오류 ${nErr} · 경고 ${nWarn} (${secs}s)`)}`); process.exit(1); }
  if (tailFail) { console.log(`::error title=${TITLE}::${esc(`연금 학습 장부 데이터는 맞지만 화면 문구(P7)·생성기 소스(P8) 점검 실패(종료 코드 2) — 오류 ${nErr} · 경고 ${nWarn} (${secs}s)`)}`); process.exit(2); }
  console.log(`::notice title=${TITLE}::${esc(`연금 학습 장부 독립 검증 통과 — ${R_.items.filter((i) => !i.skipped).length}개 검사 · 경고 ${nWarn} · ${secs}s`)}`);
  process.exit(0);
}
try { main(); } catch (e) { console.log(`::error title=${TITLE}::${esc('잡히지 않은 예외: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))}`); process.exit(1); }
