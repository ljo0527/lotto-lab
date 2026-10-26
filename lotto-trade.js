/* lotto-trade.js — 매매 일지 엔진 (설계 .lab/revamp/design-final.md §3·§4·§5.1·§13). 브라우저·워커·Node 공통, DOM 없음.
   Node: vm.runInThisContext(rank-core.js) → vm.runInThisContext(lotto-trade.js)  ·  전역은 LOTTOTRADE 하나. 의존: RANKCORE.lotto 만(rank-core.js 는 수정하지 않음).

   ── 규약 (설계 §2 원칙의 코드 쪽 요약) ──
   P1 시점 누수 없음  : 결정 함수(ctx·hotW·coldW·stream·hints)는 past(D,t) 의 get(r) 로만 읽는다(r ≥ t 이면 RangeError('leak')).
                         D[t] 를 직접 읽는 곳은 «채점» 쪽(scanRound 의 known 행·band·exactRank·sourceDigest)뿐이다.
   P2 결정적          : Math.random·Date·시간 컷 없음. 난수는 mulberry32(m32), 시드 = seed(t,salt). 날짜 덧셈도 직접 계산(addDays).
                         배분 비교는 정수 교차곱. 객체 키 순서에 의존하지 않는다(직렬화는 배열·고정 순서로만).
   P3 입력 = 당첨번호·보너스. 상금(a)은 «채점 금액(prize)»에만 쓴다.
   P8 상수는 CONF 한 곳. 바꾸면 VER 를 올리고 RULES 에 덧붙인다(append-only).

   ── 자료 모양 ──
   D = [null, {n:[6 오름차순], b, a:[1~5등 1게임당 실제 당첨금(원)], date:'YYYYMMDD'|''}, …]  (normalize 결과의 D, D.length-1 = latest)
   행(row): §4 window.rows[] 모양에서 CI 전용(win·xr)을 뺀 것.
     known  행: {t,date,n,b,a,sc,s:{pat|hot|cold|rand:{h:[head20],p:[i*8+code…]}},ctx,hint:{v,hit},patOK}   (sc 는 예열 행에서 null)
     next   행: {t,date,sc,s:{…:{h}},ctx,hint:{v,stat},picks5}
   pos 코드: 3=3개 4=4개 5=5개 6=5개+보너스 7=6개(1등).  등수: 코드 7→1, 6→2, 5→3, 4→4, 3→5.

   ── 이 파일이 설계 §5.1 표에 더한 것(표에 없는 내보내기) ──
   fund·summarize·band·exactRank·weights·picks·topLines·prizeInfo·rankOfCode·hitOfCode·addDays·digestString·rowLine·nextLine·BAND_KS.
   (CI 스크립트·기록 화면이 같은 식을 다시 짜지 않게 하려는 것. 계산 식은 모두 §3·§13 그대로.)
*/
(function (G) {
  'use strict';
  const RC = G.RANKCORE;
  if (!RC || !RC.lotto) throw new Error('lotto-trade: rank-core.js 를 먼저 읽어야 합니다 (RANKCORE.lotto 없음)');
  const LT = RC.lotto;

  /* ═══════════════════════ 상수 ═══════════════════════ */
  const deepFreeze = (o) => { Object.getOwnPropertyNames(o).forEach((k) => { const v = o[k]; if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
  const VER = 'trade-1';
  const RULES = deepFreeze([{ ver: 'trade-1', from: 1 }]);   // 덧붙이기만 한다(중간 삽입·수정 금지)
  const CONF = deepFreeze({
    WINDOW: 50, WARM: 10, KMAX: 2000, KREF: 100, HEAD: 20,
    KS: [5, 10, 20, 50, 100], K0: 5,
    STRATS: ['pat', 'hot', 'cold', 'rand'],
    LADDER: [5, 10, 20, 50, 100, 200, 500, 1000, 2000],
    PT: { 3: 1, 4: 10, 5: 100, 6: 1000 },
    SALT: { pat: 0x50415454, rand: 0x52414e44 },
    BAND: 20, BAND_MUL: 0x85EBCA6B, NUMSALT: 0x4E554D42,
    PRIZE_FB: { 4: 50000, 5: 5000 },
    CUTOFF_UTC_H: 11, JOURNAL_PRIMARY_MIN: 50
  });
  const BAND_KS = Object.freeze(Array.from(new Set(CONF.KS.concat(CONF.LADDER))).sort((a, b) => a - b));   // §13-3: KS ∪ LADDER
  const GOLDEN = 'fnv:1e4425a5';   // selfTest() 의 기준값(합성 자료 · Node 계산). 엔진이 달라 hot/cold 순서가 흔들리면 달라진다.
  const STRATS = CONF.STRATS, NS = STRATS.length;
  const HINT_KEYS = ['carry', 'rep', 'gap', 'heat', 'sum', 'cons', 'odd'];
  const num = (a, b) => a - b;

  function ruleFor(r) {
    let x = RULES[0];
    for (let i = 0; i < RULES.length; i++) if (RULES[i].from <= r) x = RULES[i];
    return { ver: x.ver, from: x.from };
  }

  /* ═══════════════════════ 결정성 장치 (§3.2) ═══════════════════════ */
  function m32(sd) {
    let a = sd >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seed(t, salt) { return (Math.imul(t, 0x9E3779B1) ^ salt) >>> 0; }
  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 127) throw new Error('fnv: ASCII only');
      h ^= c; h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'fnv:' + h.toString(16).padStart(8, '0');
  }

  /* 날짜 덧셈 — 'YYYYMMDD' 문자열 + n일. Date 를 쓰지 않는 순수 달력 계산(Howard Hinnant 알고리즘). 형식이 아니면 '' */
  function addDays(ymd, n) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(ymd == null ? '' : ymd));
    if (!m) return '';
    let y = +m[1]; const mo = +m[2], d = +m[3];
    y -= mo <= 2 ? 1 : 0;
    const era = Math.floor(y / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    const z = era * 146097 + doe - 719468 + n + 719468;
    const e2 = Math.floor(z / 146097), do2 = z - e2 * 146097;
    const yo2 = Math.floor((do2 - Math.floor(do2 / 1460) + Math.floor(do2 / 36524) - Math.floor(do2 / 146096)) / 365);
    const dy = do2 - (365 * yo2 + Math.floor(yo2 / 4) - Math.floor(yo2 / 100));
    const mp = Math.floor((5 * dy + 2) / 153);
    const dd = dy - Math.floor((153 * mp + 2) / 5) + 1;
    const mm = mp + (mp < 10 ? 3 : -9);
    const yy = yo2 + e2 * 400 + (mm <= 2 ? 1 : 0);
    return String(yy).padStart(4, '0') + String(mm).padStart(2, '0') + String(dd).padStart(2, '0');
  }

  /* ═══════════════════════ 자료 정규화·시점 (§3.1, P1·P4) ═══════════════════════ */
  /* src: lotto-history.json 객체({draws:[…]}) · draws 배열 · lottoMap({회차:{n,b,a,date?}}). 1..latest 연속이 아니면 던진다. */
  function normalize(src) {
    let list;
    if (src && Array.isArray(src.draws)) list = src.draws.map((d) => [d && d.round, d]);
    else if (Array.isArray(src)) list = src.map((d) => [d && d.round, d]);
    else if (src && typeof src === 'object') list = Object.keys(src).map((k) => [Number(k), src[k]]);
    else throw new Error('bad input');
    if (!list.length) throw new Error('empty');
    const byR = new Map(); let latest = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i][0], d = list[i][1];
      if (!Number.isInteger(r) || r < 1 || !d || typeof d !== 'object' || byR.has(r)) throw new Error('bad ' + r);
      const nn = d.numbers !== undefined ? d.numbers : d.n;
      if (!Array.isArray(nn) || nn.length !== 6) throw new Error('bad ' + r);
      const n = nn.slice().sort(num);
      for (let k = 0; k < 6; k++) { const v = n[k]; if (!Number.isInteger(v) || v < 1 || v > 45 || (k && v === n[k - 1])) throw new Error('bad ' + r); }
      const b = d.bonus !== undefined ? d.bonus : d.b;
      if (!Number.isInteger(b) || b < 1 || b > 45 || n.indexOf(b) >= 0) throw new Error('bad ' + r);
      let raw;
      if (Array.isArray(d.a)) { if (d.a.length !== 5) throw new Error('bad ' + r); raw = d.a; }
      else if (d.prize && typeof d.prize === 'object') raw = [d.prize.first, d.prize.second, d.prize.third, d.prize.fourth, d.prize.fifth];
      else raw = [0, 0, 0, 0, 0];
      const a = raw.map((v) => {
        if (v === undefined || v === null) return 0;      // 키가 없으면 0 → prize() 가 PRIZE_FB 로 대체
        if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error('bad ' + r);
        return v;
      });
      byR.set(r, { n, b, a, date: d.date == null ? '' : String(d.date) });
      if (r > latest) latest = r;
    }
    const D = [null];
    for (let r = 1; r <= latest; r++) { const x = byR.get(r); if (!x) throw new Error('gap ' + r); D.push(x); }
    return { D, latest };
  }
  const unwrapD = (x) => (x && x.D && typeof x.latest === 'number') ? x.D : x;

  /* past(D,t) — 회차 t 를 «모르는» 시점의 읽기 창. r ≥ t 이면 RangeError('leak'). D 는 배열이거나 다른 past 객체. */
  function past(D, t) {
    if (!Number.isInteger(t) || t < 1) throw new RangeError('past: t must be a positive integer');
    let raw, lim = t;
    if (D && typeof D.get === 'function' && typeof D.t === 'number') { raw = D.get; lim = Math.min(t, D.t); }
    else raw = (r) => D[r];
    return {
      t: lim,
      memo: {},
      get(r) {
        if (r >= lim) throw new RangeError('leak: round ' + r + ' >= ' + lim);
        if (!(r >= 1) || r !== Math.floor(r)) throw new RangeError('past: round out of range ' + r);
        const x = raw(r);
        if (!x) throw new Error('gap ' + r);
        return x;
      }
    };
  }

  /* ═══════════════════════ 문맥·가중치 (§3.1, §3.3) ═══════════════════════ */
  const modeOf = (h) => { let b = 0; for (let i = 1; i < h.length; i++) if (h[i] > h[b]) b = i; return b; };   // 동률이면 작은 값

  function ctx(P, t) {
    const key = 'ctx' + t;
    if (P.memo && P.memo[key]) return P.memo[key];
    const W = CONF.WINDOW;
    const hc = new Array(7).fill(0), hk = new Array(6).fill(0), ho = new Array(7).fill(0), sums = new Array(W);
    for (let k = 0; k < W; k++) {
      const r = t - W + k, n = P.get(r).n, p = P.get(r - 1).n;
      let c = 0, sm = 0, cs = 0, od = 0;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) if (n[i] === p[j]) c++;
        sm += n[i]; if (n[i] & 1) od++;
        if (i && n[i] - n[i - 1] === 1) cs++;
      }
      hc[c]++; hk[cs]++; ho[od]++; sums[k] = sm;
    }
    sums.sort(num);
    const f10 = new Int32Array(46), last = new Int32Array(46), gap = new Int32Array(46);
    for (let r = 1; r < t; r++) { const n = P.get(r).n; for (let i = 0; i < 6; i++) last[n[i]] = r; }
    for (let r = t - 10; r < t; r++) { const n = P.get(r).n; for (let i = 0; i < 6; i++) f10[n[i]]++; }
    for (let n = 1; n <= 45; n++) gap[n] = t - 1 - last[n];
    const out = {
      carry: modeOf(hc), q1: sums[Math.floor(W / 4)], q3: sums[Math.floor(3 * W / 4)], cons: modeOf(hk), odd: modeOf(ho),
      f10, last, gap, hist: { carry: hc, cons: hk, odd: ho }
    };
    if (P.memo) P.memo[key] = out;
    return out;
  }
  const ctxKey = (c) => ({ carry: c.carry, q1: c.q1, q3: c.q3, cons: c.cons, odd: c.odd });

  function hotW(P, t) {
    const f = new Int32Array(46);
    for (let r = Math.max(1, t - 52); r < t; r++) { const n = P.get(r).n; for (let i = 0; i < 6; i++) f[n[i]]++; }
    const w = new Float64Array(46); w[0] = 1;
    for (let n = 1; n <= 45; n++) w[n] = Math.pow(Math.max(1, f[n]), 2.2);
    return w;
  }
  function coldW(P, t) {
    const g = ctx(P, t).gap, w = new Float64Array(46); w[0] = 1;
    for (let n = 1; n <= 45; n++) w[n] = Math.pow(1 + g[n], 1.6);
    return w;
  }

  /* ═══════════════════════ 종목 스트림 (§3.3) ═══════════════════════ */
  const consOf = (c) => { let k = 0; for (let i = 1; i < 6; i++) if (c[i] - c[i - 1] === 1) k++; return k; };

  function genHotCold(s, P, t, kmax) {
    const page = LT.pageAdditive(LT.logw(s, s === 'hot' ? hotW(P, t) : coldW(P, t)), 0, kmax);
    const ix = new Int32Array(page.length), cs = new Array(page.length);
    for (let k = 0; k < page.length; k++) { ix[k] = page[k].i; cs[k] = page[k].c; }
    return { ix, cs };
  }
  function genPat(P, t, kmax) {
    const cx = ctx(P, t), rng = m32(seed(t, CONF.SALT.pat));
    const prev = P.get(t - 1).n.slice(), np = [];
    for (let n = 1; n <= 45; n++) if (prev.indexOf(n) < 0) np.push(n);
    const ix = new Int32Array(kmax), cs = [], seen = new Set(), lim = 400 * kmax, nq = 6 - cx.carry;
    let tries = 0, got = 0;
    while (got < kmax) {
      if (++tries > lim) throw new Error('pat stall ' + t);
      const c = [];
      for (let i = 0; i < cx.carry; i++) { const j = i + Math.floor(rng() * (6 - i)); const x = prev[i]; prev[i] = prev[j]; prev[j] = x; c.push(prev[i]); }
      for (let i = 0; i < nq; i++) { const j = i + Math.floor(rng() * (39 - i)); const x = np[i]; np[i] = np[j]; np[j] = x; c.push(np[i]); }
      c.sort(num);
      const sm = c[0] + c[1] + c[2] + c[3] + c[4] + c[5];
      if (sm < cx.q1 || sm > cx.q3 || consOf(c) !== cx.cons) continue;
      const id = LT.index(c);
      if (seen.has(id)) continue;
      seen.add(id); ix[got++] = id; cs.push(c);
    }
    return { ix, cs };
  }
  function genRand(t, salt, kmax) {
    const rng = m32(seed(t, salt)), A = [];
    for (let i = 1; i <= 45; i++) A.push(i);
    const ix = new Int32Array(kmax), cs = [], seen = new Set();
    let got = 0;
    while (got < kmax) {
      for (let i = 0; i < 6; i++) { const j = i + Math.floor(rng() * (45 - i)); const x = A[i]; A[i] = A[j]; A[j] = x; }
      const c = A.slice(0, 6).sort(num), id = LT.index(c);
      if (seen.has(id)) continue;
      seen.add(id); ix[got++] = id; cs.push(c);
    }
    return { ix, cs };
  }
  function genLines(s, P, t, kmax) {
    if (s === 'pat') return genPat(P, t, kmax);
    if (s === 'hot' || s === 'cold') return genHotCold(s, P, t, kmax);
    if (s === 'rand') return genRand(t, CONF.SALT.rand, kmax);
    throw new RangeError('unknown strategy ' + s);
  }
  /* 회차 t 의 종목 s 스트림(조합 index, 매수 = 앞 k줄). P = past(D,t). */
  function stream(s, P, t, kmax) { return genLines(s, P, t, kmax || CONF.KMAX).ix; }
  /* 띠용 무작위 스트림 — salt 만 다르고 절차는 rand 종목과 같다. */
  function randStream(t, salt, kmax) { return genRand(t, salt, kmax || CONF.KMAX).ix; }

  /* ═══════════════════════ 채점·상금 (§3.4) ═══════════════════════ */
  const hitOfCode = (code) => code === 7 ? 6 : code === 6 ? 5 : code;
  const rankOfCode = (code) => code === 7 ? 1 : code === 6 ? 2 : code === 5 ? 3 : code === 4 ? 4 : code === 3 ? 5 : 0;
  const CODE_OF_RANK = { 5: 3, 4: 4, 3: 5, 2: 6, 1: 7 };
  function codeOf(h, c, b) { return h < 3 ? 0 : h === 6 ? 7 : h === 5 ? (c.indexOf(b) >= 0 ? 6 : 5) : h; }
  function grade(c, d) {
    let hit = 0;
    for (let i = 0; i < c.length; i++) if (d.n.indexOf(c[i]) >= 0) hit++;
    const bonus = c.indexOf(d.b) >= 0, code = codeOf(hit, c, d.b);
    return { hit, bonus, code, rank: rankOfCode(code) };
  }
  const enc = (i, code) => i * 8 + code;
  const dec = (v) => ({ i: v >> 3, code: v & 7 });
  function maskOf(d) { const m = new Uint8Array(46); for (let i = 0; i < 6; i++) m[d.n[i]] = 1; return m; }
  /* 줄 목록 → 3개 이상 맞은 줄의 희소 기록 [i*8+code…] (i 오름차순, i 는 1-기반) */
  function posOf(cs, mask, b) {
    const p = [];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], h = mask[c[0]] + mask[c[1]] + mask[c[2]] + mask[c[3]] + mask[c[4]] + mask[c[5]];
      if (h >= 3) p.push((i + 1) * 8 + codeOf(h, c, b));
    }
    return p;
  }
  /* 등수 상금 = 자료의 실제 1게임당 당첨금(a[rank-1]) > 0 이면 그 값. 0/없음일 때만 PRIZE_FB(4·5등). 1~3등 0 은 0원 + unk(금액 미상 «?») */
  function prizeInfo(d, rank) {
    if (!(rank >= 1 && rank <= 5)) return { v: 0, fb: false, unk: false };
    const x = d && d.a ? d.a[rank - 1] : 0;
    if (x > 0) return { v: x, fb: false, unk: false };
    const fb = CONF.PRIZE_FB[rank];
    return fb ? { v: fb, fb: true, unk: false } : { v: 0, fb: false, unk: true };
  }
  const prize = (d, rank) => prizeInfo(d, rank).v;

  /* ═══════════════════════ 힌트 7줄 (§3.10, §13-10) ═══════════════════════ */
  const consN = consOf;
  function gradeHints(v, d, prev) {
    const pn = Array.isArray(prev) ? prev : (prev && prev.n) ? prev.n : d.prev;
    if (!Array.isArray(pn)) throw new RangeError('gradeHints: 직전 회차 번호가 필요합니다(carry 채점)');
    const n = d.n; let c = 0, sm = 0, od = 0;
    for (let i = 0; i < 6; i++) { if (pn.indexOf(n[i]) >= 0) c++; sm += n[i]; if (n[i] & 1) od++; }
    return [c === v.carry, n.indexOf(v.rep) >= 0, n.indexOf(v.gap) >= 0, n.indexOf(v.heat) >= 0,
      sm >= v.sum[0] && sm <= v.sum[1], consN(n) === v.cons, od === v.odd].map(Number);
  }
  /* hints(P,t[,{stat:false}]) → {v, stat?}. stat 은 «다음 회차» 카드용 사후 채점·기준선(P.t === t 일 때 의미). */
  function hints(P, t, o) {
    const cx = ctx(P, t), prev = P.get(t - 1).n;
    let rep = prev[0];
    for (let i = 1; i < 6; i++) { const n = prev[i]; if (cx.f10[n] > cx.f10[rep] || (cx.f10[n] === cx.f10[rep] && n < rep)) rep = n; }
    let gp = 1, heat = 1;
    for (let n = 2; n <= 45; n++) { if (cx.last[n] < cx.last[gp]) gp = n; if (cx.f10[n] > cx.f10[heat]) heat = n; }
    const v = { carry: cx.carry, rep, gap: gp, heat, sum: [cx.q1, cx.q3], cons: cx.cons, odd: cx.odd };
    if (o && o.stat === false) return { v };
    const W = CONF.WINDOW, bt = {};
    HINT_KEYS.forEach((k) => { bt[k] = 0; });
    for (let u = t - W; u < t; u++) {          // 지난 50회 «같은 규칙으로 냈다면» — 각 회차는 그 회차 직전까지만 본다
      const vu = hints(past(P, u), u, { stat: false }).v;
      const hit = gradeHints(vu, P.get(u), P.get(u - 1));
      for (let i = 0; i < 7; i++) bt[HINT_KEYS[i]] += hit[i];
    }
    let bc = 0, bs = 0, bk = 0, bo = 0, N = 0;     // 기준선: 2..t-1 전체에서 같은 값이 나온 횟수
    for (let r = 2; r < t; r++) {
      const n = P.get(r).n, p = P.get(r - 1).n; let c = 0, sm = 0, od = 0;
      for (let i = 0; i < 6; i++) { if (p.indexOf(n[i]) >= 0) c++; sm += n[i]; if (n[i] & 1) od++; }
      N++;
      if (c === v.carry) bc++;
      if (sm >= v.sum[0] && sm <= v.sum[1]) bs++;
      if (consN(n) === v.cons) bk++;
      if (od === v.odd) bo++;
    }
    const numBand = [];
    for (let j = 1; j <= CONF.BAND; j++) {         // 무작위 번호 20벌(§13-10)
      const salt = (CONF.NUMSALT ^ Math.imul(j, CONF.BAND_MUL)) >>> 0;
      let cnt = 0;
      for (let u = t - W; u < t; u++) { const x = 1 + Math.floor(m32(seed(u, salt))() * 45); if (P.get(u).n.indexOf(x) >= 0) cnt++; }
      numBand.push(cnt);
    }
    return {
      v,
      stat: {
        carryHist: cx.hist.carry.slice(), consHist: cx.hist.cons.slice(), oddHist: cx.hist.odd.slice(),
        bt,
        base: { carry: [bc, N], sum: [bs, N], cons: [bk, N], odd: [bo, N], numBand },
        gapOf: cx.gap[gp], heatOf: cx.f10[heat]
      }
    };
  }

  /* ═══════════════════════ 비중·배분 (§3.5) ═══════════════════════ */
  /* sc_s(t) = Σ_{u=t-10}^{t-1} Σ_{e∈pos_s(u), i≤KREF} PT[hit(e)] . byT: t→행(배열·객체·Map). 필요한 행이 없으면 null. */
  function scores(byT, t) {
    const out = [0, 0, 0, 0], isMap = typeof Map !== 'undefined' && byT instanceof Map;
    for (let u = t - CONF.WARM; u < t; u++) {
      const r = isMap ? byT.get(u) : byT[u];
      if (!r || !r.s) return null;
      for (let k = 0; k < NS; k++) {
        const p = r.s[STRATS[k]] && r.s[STRATS[k]].p;
        if (!p) return null;
        for (let q = 0; q < p.length; q++) { const e = p[q]; if ((e >> 3) > CONF.KREF) break; out[k] += CONF.PT[hitOfCode(e & 7)]; }
      }
    }
    return out;
  }
  /* 정수 교차곱 배분. 모든 종목 1장씩 먼저, 남은 K-4 장은 (sc+1)/a 가 가장 큰 종목(동률이면 앞 종목)에 한 장씩. */
  function alloc(sc, K) {
    if (!Number.isInteger(K) || K < NS) throw new RangeError('alloc: K must be an integer >= ' + NS);
    const a = [1, 1, 1, 1];
    for (let n = NS; n < K; n++) {
      let b = 0;
      for (let x = 1; x < NS; x++) if ((sc[x] + 1) * a[b] > (sc[b] + 1) * a[x]) b = x;
      a[b]++;
    }
    return a;
  }
  /* 비중 표시(% 소수 1자리) — 표시 전용 */
  function weights(sc) {
    let s = 0; for (let k = 0; k < NS; k++) s += sc[k] + 1;
    return sc.map((v) => Math.round((v + 1) / s * 1000) / 10);
  }
  /* 행의 head 로 만든 주문: [{s,i,c}] (STRATS 순서, 줄 오름차순). a_s 가 head(20)를 넘으면 RangeError */
  function picks(row, K) {
    const a = alloc(row.sc, K), out = [];
    for (let k = 0; k < NS; k++) {
      const h = row.s[STRATS[k]].h;
      if (a[k] > h.length) throw new RangeError('picks: head ' + h.length + '줄을 넘는 주문(' + STRATS[k] + ' ' + a[k] + '장)');
      for (let i = 0; i < a[k]; i++) out.push({ s: STRATS[k], i: i + 1, c: LT.combo(h[i]) });
    }
    return out;
  }
  function topLines(row, n) {
    const out = {};
    for (let k = 0; k < NS; k++) out[STRATS[k]] = row.s[STRATS[k]].h.slice(0, n).map((ix) => LT.combo(ix));
    return out;
  }

  /* ═══════════════════════ 회차 스캔 (§5.1 scanRound) ═══════════════════════ */
  /* scanRound(D,t,{kmax,latest,byT}) — t ≤ latest 면 채점(pos·hint.hit·patOK), t = latest+1 이면 head·ctx·hint(v,stat)·picks5. */
  function scanRound(src, t, o) {
    const D = unwrapD(src); o = o || {};
    const kmax = o.kmax || CONF.KMAX, latest = o.latest != null ? o.latest : D.length - 1, known = t <= latest;
    const P = past(D, t), cx = ctx(P, t), hv = hints(P, t, { stat: !known });
    const d = known ? D[t] : null, mask = known ? maskOf(d) : null, s = {};
    for (let k = 0; k < NS; k++) {
      let L;
      try { L = genLines(STRATS[k], P, t, kmax); }
      catch (e) { if (e instanceof RangeError) e.message += ' [t=' + t + ' ' + STRATS[k] + ']'; throw e; }
      const h = Array.prototype.slice.call(L.ix, 0, CONF.HEAD);
      s[STRATS[k]] = known ? { h, p: posOf(L.cs, mask, d.b) } : { h };
    }
    const sc = o.byT ? scores(o.byT, t) : null;
    if (known) {
      const hit = gradeHints(hv.v, d, D[t - 1]);
      return { t, date: d.date, n: d.n.slice(), b: d.b, a: d.a.slice(), sc, s, ctx: ctxKey(cx), hint: { v: hv.v, hit }, patOK: hit[0] + hit[4] + hit[5] };
    }
    const row = { t, date: D[t - 1] ? addDays(D[t - 1].date, 7) : '', sc, s, ctx: ctxKey(cx), hint: { v: hv.v, stat: hv.stat }, picks5: null };
    if (sc) row.picks5 = picks(row, CONF.K0);
    return row;
  }

  /* ═══════════════════════ 지문 (§13-1) ═══════════════════════ */
  const CTXS = (c) => [c.carry, c.q1, c.q3, c.cons, c.odd].join(',');
  const HVS = (v) => [v.carry, v.rep, v.gap, v.heat, v.sum[0], v.sum[1], v.cons, v.odd].join(',');
  function rowLine(r) {
    let s = r.t + '|';
    for (let k = 0; k < NS; k++) s += STRATS[k] + ':' + r.s[STRATS[k]].h.slice(0, CONF.HEAD).join(',') + ';' + r.s[STRATS[k]].p.join(',') + '|';
    return s + r.sc.join(',') + '|' + CTXS(r.ctx) + '|' + HVS(r.hint.v) + '|' + r.hint.hit.join('') + '|' + r.patOK + '\n';
  }
  function nextLine(x) {
    let s = 'N' + x.t + '|';
    for (let k = 0; k < NS; k++) s += STRATS[k] + ':' + x.s[STRATS[k]].h.slice(0, CONF.HEAD).join(',') + ';' + '|';
    return s + x.sc.join(',') + '|' + CTXS(x.ctx) + '|' + HVS(x.hint.v) + '\n';
  }
  function digestString(rows, next, ver) {
    let s = (ver || VER) + '\n';
    for (let i = 0; i < rows.length; i++) s += rowLine(rows[i]);
    return s + nextLine(next);
  }
  function digest(rows, next, ver) { return fnv(digestString(rows, next, ver)); }
  /* source.digest — 1..upto 의 «r:n1,…,n6+b;» 이어붙임 */
  function sourceDigest(src, upto) {
    const D = unwrapD(src); let s = '';
    for (let r = 1; r <= upto; r++) {
      if (!D[r]) throw new Error('gap ' + r);
      s += r + ':' + D[r].n.join(',') + '+' + D[r].b + ';';
    }
    return fnv(s);
  }

  /* ═══════════════════════ 실행 (§5.1 runSync / runAsync) ═══════════════════════ */
  function* runGen(src, o) {
    const D = unwrapD(src); o = o || {};
    const latest0 = D.length - 1, to = o.to != null ? o.to : latest0;
    if (!Number.isInteger(to) || to > latest0 || to < 1) throw new RangeError('runSync: to=' + to + ' (latest ' + latest0 + ')');
    const W = CONF.WINDOW, from = to - W + 1, t0 = from - CONF.WARM, total = to - t0 + 2;
    if (t0 < W + 2) throw new Error('short: 최근 ' + (W + CONF.WARM) + '회 + 문맥 ' + W + '회가 필요합니다 (latest ' + to + ')');
    const kmax = o.kmax || CONF.KMAX, byT = {}, rows = [];
    for (let t = t0; t <= to; t++) {
      const row = scanRound(D, t, { kmax, latest: to, byT });
      byT[t] = row; rows.push(row);
      yield { done: rows.length, total, t };
    }
    const next = scanRound(D, to + 1, { kmax, latest: to, byT });
    yield { done: total, total, t: to + 1 };
    const wrows = rows.slice(CONF.WARM);
    const window = { from, to, digest: digest(wrows, next), rows: wrows, next };
    return { ver: VER, from, to, t0, rows: rows.concat([next]), window, next };
  }
  function runSync(src, o) {
    const g = runGen(src, o);
    for (;;) { const r = g.next(); if (r.done) return r.value; }
  }
  /* 숨은 탭에서도 도는 양보 (setTimeout 은 억제된다 — index.html ledTick 관례) */
  function tick() {
    if (typeof MessageChannel === 'function') return new Promise((res) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); res(); }; c.port2.postMessage(0); });
    return new Promise((res) => setTimeout(res, 0));
  }
  /* runAsync(D,{to,kmax,isCancelled},onRound(done,total,t)) → Promise<runSync 결과>. 회차마다 양보한다. */
  function runAsync(src, o, onRound) {
    o = o || {};
    return new Promise((resolve, reject) => {
      const g = runGen(src, o);
      const step = () => {
        let r;
        try { r = g.next(); } catch (e) { reject(e); return; }
        if (r.done) { resolve(r.value); return; }
        if (o.isCancelled && o.isCancelled()) { reject(new Error('cancel')); return; }
        if (onRound) { try { onRound(r.value.done, r.value.total, r.value.t); } catch (e) { /* 진행 표시 실패가 계산을 막지 않는다 */ } }
        tick().then(step);
      };
      step();
    });
  }

  /* ═══════════════════════ 손익·집계 (§3.6~3.9, §3.11) ═══════════════════════ */
  /* fund(rows,K[,mode]) — 회차별 매수 결과. mode: 'fund'(기본, 비중 배분) · 'eq'(균등 배분) · 종목 이름(그 종목만 K장).
     항목: {t,a:[4],ret,net,cum,cnt:[0,1등..5등],wins:[{s,i,code,rank,prize}],best,bestLe,unk} */
  function fund(rows, K, mode) {
    mode = mode || 'fund';
    let fixed = null;
    if (mode === 'eq') fixed = alloc([0, 0, 0, 0], K);
    else if (mode !== 'fund') {
      const si = STRATS.indexOf(mode);
      if (si < 0) throw new RangeError('fund: unknown mode ' + mode);
      fixed = [0, 0, 0, 0]; fixed[si] = K;
    }
    const out = []; let cum = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      let a = fixed;
      if (!a) { if (!row.sc) throw new RangeError('fund: sc 없음 (t=' + row.t + ')'); a = alloc(row.sc, K); }
      let ret = 0, unk = 0, bp = 0; const cnt = [0, 0, 0, 0, 0, 0], wins = [];
      for (let si = 0; si < NS; si++) {
        const lim = a[si]; if (!lim) continue;
        const p = row.s[STRATS[si]].p;
        for (let k = 0; k < p.length; k++) {
          const e = p[k], i = e >> 3; if (i > lim) break;
          const code = e & 7, rk = rankOfCode(code), pi = prizeInfo(row, rk);
          ret += pi.v; cnt[rk]++; if (pi.unk) unk++;
          wins.push({ s: STRATS[si], i, code, rank: rk, prize: pi.v });
          const h = hitOfCode(code); if (h > bp) bp = h;
        }
      }
      let best, bestLe = false;
      if (K <= CONF.HEAD) {                         // K ≤ 20: head 를 그 자리에서 채점
        best = 0;
        const d = { n: row.n, b: row.b };
        for (let si = 0; si < NS; si++) { const h = row.s[STRATS[si]].h; for (let i = 0; i < a[si]; i++) { const g = grade(LT.combo(h[i]), d); if (g.hit > best) best = g.hit; } }
      } else { best = Math.max(bp, 2); bestLe = bp < 3; }   // K > 20: pos 의 최대. 없으면 «2개 이하»
      cum += ret - K * 1000;
      out.push({ t: row.t, a, ret, net: ret - K * 1000, cum, cnt, wins, best, bestLe, unk });
    }
    return out;
  }
  function tally(items) {
    const cnt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, first = { 5: null, 4: null, 3: null, 2: null, 1: null }; let ret = 0, spend = 0;
    items.forEach((it) => {
      ret += it.ret;
      for (let r = 1; r <= 5; r++) { cnt[r] += it.cnt[r]; if (it.cnt[r] && first[r] === null) first[r] = it.t; }
    });
    return { ret, cnt, first, spend };
  }
  const firstWin4 = (items) => {          // 4개 이상(4등 이상)이 처음 나온 회차의 항목 위치와 줄(STRATS 순서·줄 오름차순 첫 번째)
    for (let k = 0; k < items.length; k++) for (let q = 0; q < items[k].wins.length; q++) if (items[k].wins[q].rank <= 4) return { k, w: items[k].wins[q] };
    return null;
  };
  /* kstar(rows) → {종목:{k,t}|null} — 사후 최소 장수 min_t f_s^4(t) (동률이면 이른 회차) */
  function kstar(rows) {
    const out = {};
    STRATS.forEach((s) => {
      let k = null, tt = null;
      for (let ri = 0; ri < rows.length; ri++) {
        const p = rows[ri].s[s].p;
        for (let q = 0; q < p.length; q++) if ((p[q] & 7) >= 4) { const i = p[q] >> 3; if (k === null || i < k) { k = i; tt = rows[ri].t; } break; }
      }
      out[s] = k === null ? null : { k, t: tt };
    });
    return out;
  }
  /* 2,000줄 안 최근접: 등수 r 이상(코드 CODE_OF_RANK[r] 이상)이 나온 가장 작은 줄 번호(동률이면 이른 회차, 그다음 STRATS 순서) */
  function nearestTier(rows, rank) {
    const thr = CODE_OF_RANK[rank]; let best = null;
    for (let ri = 0; ri < rows.length; ri++) for (let k = 0; k < NS; k++) {
      const p = rows[ri].s[STRATS[k]].p;
      for (let q = 0; q < p.length; q++) if ((p[q] & 7) >= thr) { const i = p[q] >> 3; if (best === null || i < best.i) best = { s: STRATS[k], i, t: rows[ri].t }; break; }
    }
    return best;
  }
  const winOf = (rows, extra, row) => (extra && extra.win && extra.win[row.t]) || row.win || null;
  const xrOf = (rows, extra, row) => (extra && extra.xr && extra.xr[row.t]) || row.xr || null;
  /* tiers(rows,K,extra) → {"5".."1": {s,i,t} | {s,rank:[b,w],t} | null} — 등수별 최근접. K 는 호환용(미사용: 최근접은 K 와 무관). */
  function tiers(rows, K, extra) {
    const out = {};
    for (let r = 5; r >= 1; r--) {
      let x = nearestTier(rows, r);
      if (!x && (r === 1 || r === 3 || r === 4)) {          // 2,000줄 밖: CI 가 구한 정확한 첫 등장 순위(win=1등, xr=4·5개)로 대체
        let bb = null;
        rows.forEach((row) => {
          const cand = [];
          if (r === 1) { const w = winOf(rows, extra, row); if (w) ['hot', 'cold'].forEach((s) => { if (w[s]) cand.push({ s, rank: w[s].slice(), t: row.t }); }); }
          else { const xr = xrOf(rows, extra, row), m = r === 3 ? '5' : '4'; if (xr) ['hot', 'cold'].forEach((s) => { if (xr[s] && xr[s][m]) cand.push({ s, rank: xr[s][m].slice(), t: row.t }); }); }
          cand.forEach((c) => { if (!bb || c.rank[0] < bb.rank[0]) bb = c; });
        });
        x = bb;
      }
      out[r] = x;
    }
    return out;
  }
  /* ladder(rows) → {fund|pat|hot|cold|rand: {"장수": {first4,n4,net}}} — 미리 정한 장수 LADDER 별. */
  function ladder(rows) {
    const out = { fund: {}, pat: {}, hot: {}, cold: {}, rand: {} };
    const stat = (items, K) => {
      let n4 = 0, first4 = null, net = 0;
      items.forEach((it) => {
        net += it.net;
        const c = it.cnt[1] + it.cnt[2] + it.cnt[3] + it.cnt[4];
        if (c) { n4 += c; if (first4 === null) first4 = it.t; }
      });
      return { first4, n4, net };
    };
    CONF.LADDER.forEach((L) => {
      out.fund[L] = stat(fund(rows, L), L);
      STRATS.forEach((s) => { out[s][L] = stat(fund(rows, L, s), L); });
    });
    return out;
  }
  /* 근접 지표: 창 전체 2,000줄 안 최고 코드 (④ 최근접 이야기) */
  function nearestAny(rows) {
    let best = null;
    for (let ri = 0; ri < rows.length; ri++) for (let k = 0; k < NS; k++) {
      const p = rows[ri].s[STRATS[k]].p;
      for (let q = 0; q < p.length; q++) {
        const code = p[q] & 7, i = p[q] >> 3;
        if (!best || code > best.code || (code === best.code && i < best.i)) best = { code, i, s: STRATS[k], t: rows[ri].t };
      }
    }
    return best;
  }
  /* aggregate(rows,K,extra) → summary.K[K]. extra={band,win,xr} 가 없으면 해당 칸은 null(bandRank). */
  function aggregate(rows, K, extra) {
    extra = extra || {};
    const N = rows.length, F = fund(rows, K), E = fund(rows, K, 'eq'), R = fund(rows, K, 'rand');
    const tl = tally(F), spend = N * K * 1000, net = tl.ret - spend;
    let pk = 0, mdd = 0, dryMax = 0, run = 0, lastRet = -1, last4 = -1, bm = -1, bn = 0, eRounds = 0, eSum = 0;
    F.forEach((it, k) => {
      pk = Math.max(pk, it.cum); mdd = Math.max(mdd, pk - it.cum);
      if (it.ret > 0) { run = 0; lastRet = k; } else { run++; if (run > dryMax) dryMax = run; }
      if (it.cnt[1] + it.cnt[2] + it.cnt[3] + it.cnt[4]) last4 = k;
      if (it.best > bm) { bm = it.best; bn = 1; } else if (it.best === bm) bn++;
      if (it.ret !== E[k].ret) { eRounds++; eSum += it.ret - E[k].ret; }
    });
    const rt = tally(R);
    const bk = extra.band && extra.band.K && extra.band.K[K];
    const bandRank = bk && Array.isArray(bk.net) ? 1 + bk.net.filter((x) => x > net).length : null;
    return {
      spend, ret: tl.ret, net, cnt: tl.cnt, first: tl.first, best: { m: bm, n: bn },
      mdd, dryMax, dryNow: lastRet < 0 ? N : N - 1 - lastRet, dry4: last4 < 0 ? N : N - 1 - last4,
      effect: { rounds: eRounds, sum: eSum },
      randSolo: { net: rt.ret - spend, cnt: rt.cnt, first: rt.first },
      bandRank,
      story: story(rows, K, F, extra)
    };
  }
  /* §3.9 5만원 이야기 4단 — 위에서부터 처음 채워지는 것 */
  function story(rows, K, F, extra) {
    const t0 = rows[0].t;
    const mk = (tier, items, L, hit) => {
      const week = items[hit.k].t - t0 + 1; let got = 0;
      for (let q = 0; q <= hit.k; q++) got += items[q].ret;
      return { tier, k: L, t: items[hit.k].t, week, s: hit.w.s, j: hit.w.i, spent: L * 1000 * week, got };
    };
    const h1 = firstWin4(F);
    if (h1) return mk('K', F, K, h1);
    for (let q = 0; q < CONF.LADDER.length; q++) {
      const L = CONF.LADDER[q]; if (L <= K) continue;
      const FL = fund(rows, L), hl = firstWin4(FL);
      if (hl) return mk('ladder', FL, L, hl);
    }
    const ks = kstar(rows); let hs = null;
    STRATS.forEach((s) => { const x = ks[s]; if (x && (!hs || x.k < hs.k)) hs = { s, k: x.k, t: x.t }; });
    if (hs) return { tier: 'hindsight', k: hs.k, t: hs.t, week: hs.t - t0 + 1, s: hs.s, j: hs.k, spent: null, got: null };
    const na = nearestAny(rows);
    if (na) return { tier: 'nearest', k: null, t: na.t, week: na.t - t0 + 1, s: na.s, j: na.i, spent: null, got: null, m: hitOfCode(na.code), rank: rankOfCode(na.code) };
    return null;
  }
  /* summarize(rows,extra) → §4 summary 전체 */
  function summarize(rows, extra) {
    const K = {};
    CONF.KS.forEach((k) => { K[k] = aggregate(rows, k, extra); });
    let randTop = 0; const pat = { 3: 0 };
    rows.forEach((r) => {
      const mx = Math.max.apply(null, r.sc);
      if (r.sc[3] === mx && r.sc.filter((x) => x === mx).length === 1) randTop++;
      if (r.patOK === 3) pat[3]++;
    });
    return { K, ladder: ladder(rows), kstar: kstar(rows), tiers: tiers(rows, CONF.K0, extra), randTop, patOK: pat };
  }

  /* ═══════════════════════ CI 전용 보조: 무작위 20벌 띠 (§3.8, §13-3) ═══════════════════════ */
  /* band(D,{to,kmax,n}) → {n, K:{"장수":{net:[n],n4:[n],first4:[n]}}, kstar4:[{k,t}|null ×n], digest}. 브라우저에서는 부르지 않는다(§13-4). */
  function band(src, o) {
    const D = unwrapD(src); o = o || {};
    const to = o.to != null ? o.to : D.length - 1, from = to - CONF.WINDOW + 1, kmax = o.kmax || CONF.KMAX, nb = o.n || CONF.BAND;
    const K = {}; BAND_KS.forEach((k) => { K[k] = { net: [], n4: [], first4: [] }; });
    const kstar4 = [], parts = ['band-1\n'];
    for (let j = 1; j <= nb; j++) {
      const salt = (CONF.SALT.rand ^ Math.imul(j, CONF.BAND_MUL)) >>> 0;
      const net = BAND_KS.map(() => 0), n4 = BAND_KS.map(() => 0), f4 = BAND_KS.map(() => null);
      let kmin = null, kt = null;
      for (let t = from; t <= to; t++) {
        const d = D[t], p = posOf(genRand(t, salt, kmax).cs, maskOf(d), d.b);
        parts.push(j + '|' + t + '|' + p.join(',') + '\n');
        for (let q = 0; q < BAND_KS.length; q++) {
          let ret = 0;
          for (let z = 0; z < p.length; z++) {
            const i = p[z] >> 3; if (i > BAND_KS[q]) break;
            const code = p[z] & 7; ret += prize(d, rankOfCode(code));
            if (code >= 4) { n4[q]++; if (f4[q] === null) f4[q] = t; }
          }
          net[q] += ret - BAND_KS[q] * 1000;
        }
        for (let z = 0; z < p.length; z++) if ((p[z] & 7) >= 4) { const i = p[z] >> 3; if (kmin === null || i < kmin) { kmin = i; kt = t; } break; }
      }
      BAND_KS.forEach((k, q) => { K[k].net.push(net[q]); K[k].n4.push(n4[q]); K[k].first4.push(f4[q]); });
      kstar4.push(kmin === null ? null : { k: kmin, t: kt });
    }
    return { n: nb, K, kstar4, digest: fnv(parts.join('')) };
  }

  /* exactRank(P,d,t,s,m) → [best,worst] — hot/cold 에서 «m개 이상 맞는 조합» 의 첫 등장 순위(정확값, §3.7). 건당 약 15ms(CI 전용).
     P = past(D,t)(가중치용), d = 그 회차 실제 당첨(채점 쪽), s='hot'|'cold', m = 3..6. */
  function exactRank(P, d, t, s, m) {
    if (s !== 'hot' && s !== 'cold') throw new RangeError('exactRank: hot/cold only');
    if (!(m >= 3 && m <= 6)) throw new RangeError('exactRank: m must be 3..6');
    const lw = LT.logw(s, s === 'hot' ? hotW(P, t) : coldW(P, t)), q = LT.quantize(lw);
    const Wn = d.n.slice(), X = [];
    for (let n = 1; n <= 45; n++) if (Wn.indexOf(n) < 0) X.push(n);       // 보너스 포함 나머지 39개
    const top = (arr, k) => arr.slice().sort((x, y) => (q[y] - q[x]) || (x - y)).slice(0, k);
    let M = null, ms = -Infinity, mi = Infinity;
    for (let k = m; k <= 6; k++) {
      const c = top(Wn, k).concat(top(X, 6 - k)).sort(num);
      let sm = 0; for (let i = 0; i < 6; i++) sm += q[c[i]];
      const ix = LT.index(c);
      if (sm > ms || (sm === ms && ix < mi)) { M = c; ms = sm; mi = ix; }
    }
    const r = LT.rankAdditive(lw, M);
    return [r.best, r.worst];
  }

  /* ═══════════════════════ selfTest (§3.2) ═══════════════════════ */
  function synthD(nr) {
    const rng = m32(0x5EED), D = [null];
    for (let r = 1; r <= nr; r++) {
      const A = []; for (let i = 1; i <= 45; i++) A.push(i);
      for (let i = 0; i < 7; i++) { const j = i + Math.floor(rng() * (45 - i)); const x = A[i]; A[i] = A[j]; A[j] = x; }
      D.push({ n: A.slice(0, 6).sort(num), b: A[6], a: [1500000000 + r * 1000003, 50000000 + r, 1500000 + r, 50000, 5000], date: '' });
    }
    return D;
  }
  /* 고정 합성 자료 120회(시드 0x5EED), KMAX=200 으로 runSync → window.digest. GOLDEN 과 같아야 한다(hot/cold 의 Math.pow/log 엔진 차이 감시). */
  function selfTest() { return runSync(synthD(120), { kmax: 200 }).window.digest; }

  const T = {
    VER, RULES, CONF, BAND_KS, GOLDEN, ruleFor,
    normalize, past, ctx, hotW, coldW, m32, seed, fnv, addDays,
    stream, randStream, grade, enc, dec, prize, prizeInfo, rankOfCode, hitOfCode,
    hints, gradeHints, scanRound, scores, alloc, weights, picks, topLines,
    fund, aggregate, ladder, kstar, tiers, summarize,
    digest, digestString, rowLine, nextLine, sourceDigest,
    band, exactRank, selfTest, runSync, runAsync
  };
  G.LOTTOTRADE = T;
})(typeof globalThis !== 'undefined' ? globalThis : self);
