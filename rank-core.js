/* rank-core.js — 무한 순위 공용 엔진 (PLAN3 §2). 브라우저·워커·Node 공통. DOM 없음, 의존성 없음.
   Node: vm.runInThisContext(fs.readFileSync('rank-core.js','utf8'))  ·  워커: importScripts('./rank-core.js')
   전역은 RANKCORE 하나만 만든다. 모든 함수는 결정적·순수(캐시는 입력 «내용» 기준 소형 LRU — postMessage 복제본도 적중).

   ── 정의 요약 (STATUS-core.md 와 같음) ──
   로또 index: 오름차순 6개 ↔ 사전식(조합수 체계) 0..8145059. [1..6]=0, [40..45]=N-1.
   popFeat: index.html popFeat 와 같은 코드(비트 단위 동일). popModelZ: zOf 와 같은 산술 순서
     (bounds 로 j≥1 clamp → Σ v·beta 누적(j=0..7) → (score−predMean)/predSD → A,B 평균).
   pop 순위: z 오름차순. 동점 = z 가 부동소수점으로 정확히 같은 조합(같은 원시 튜플 또는 clamp 후 같은 벡터).
   가산(hot/cold) 순위: q[n] = Math.round(logw[n]·2^46) (정수), 점수 = Σq (정확한 정수, 순서 무관).
     동점 = |Δ점수| ≤ 6 단위(≈ 8.5e-14) — 곱이 수학적으로 같은 조합(예 2·6 = 3·4)이 반올림으로 갈라지지 않게.
     rank: best = 1 + #{s > sc+6}, worst = best−1 + #{|s−sc| ≤ 6}. 탐색 순서: 동점 구간(서로 6 이내로 이어진 점수 묶음) 내림차순,
     구간 안은 index 오름차순 — 그래서 참 동점(2·6 = 3·4)도 index 순이고, 엔진별 Math.log 1 ulp 차이에도 순서가 같다.
     전제: 모든 동점 사슬의 폭 ≤ 6 (hot/cold 1000~1243회 전 회차 확인: 같은 곱 퍼짐 ≤ 4, 다른 곱 간격 ≥ 29,380,053 단위). 폭 > 6 인 사슬을
     만나면 rankAdditive/posAdditive(그 조합의 사슬)·pageAdditive(힙: 방문한 레벨, 수집: 수집 창 안의 사슬) 는 RangeError 를 던진다 —
     경로끼리 조용히 다른 답을 주지 않는다(던지지 않고 돌아온 페이지·pos·rank 는 서로 일치).
   연금: 자리 점수 = 순위 점수(1위 10 … 10위 1, 동점 평균; 조 1위 5 … 5위 1), 티켓 점수 = Σ자리 + 조, 내림차순, 동점 = 같은 점수.
     티켓 index = (조−1)·10^6 + 번호. 탐색 순서 동점은 index 오름차순.
   입력 검증: 조합·조·번호는 정수만(숫자 문자열 허용) — 비정수·NaN·범위 밖·중복은 RangeError(조용한 절삭 없음). 가중치·logw 는 유한값만.
     연금 pts 는 P.points(S) 의 순위 점수만(자리 1..10·조 1..5 의 반 단위) — 원시 점수 S·음수·반 단위가 아닌 값은 RangeError.
     페이지 offset/k 만 floor·0 이상으로 보정한다. L.popFeat 는 입력을 정렬해 계산(순서 무관), 페이지 원문 그대로는 L.popFeatRaw(오름차순 전제).
   메모리: 튜플 표 ≈ 7 MB(+ tupleOf 32 MB 는 withIndex/pagePop 때, T.feat 30 MB 는 첫 접근 때만) · pop 캐시 ≤ 4 회차 · 가산 임의 offset 은
     2^20 구간 누적표 8 MB × 2(LRU) + 수집 항목 28 B × M(M ≈ 페이지가 걸친 구간 ± ceil(12/W) 구간의 조합 수 — 실제 hot/cold 는 W = 2^30 이라
     ±1 구간, ≤ 수십만). */
(function (G) {
  'use strict';
  const RC = {};
  RC.version = 1;

  /* ═══════════════════════ 로또 ═══════════════════════ */
  const N = 8145060;
  const BIN = [];                       // BIN[n][k], n 0..45, k 0..6
  for (let n = 0; n <= 45; n++) {
    const row = new Float64Array(7); row[0] = 1;
    for (let k = 1; k <= 6; k++) row[k] = n === 0 ? 0 : BIN[n - 1][k - 1] + BIN[n - 1][k];
    BIN.push(row);
  }
  // LEXS[i][v] = Σ_{u=1..v} C(45−u, 5−i): i 번째 자리(0-based)의 값이 v 이하일 때 앞에 오는 조합 수 누적
  const LEXS = [];
  for (let i = 0; i < 6; i++) {
    const row = new Float64Array(46);
    for (let v = 1; v <= 45; v++) row[v] = row[v - 1] + BIN[45 - v][5 - i];
    LEXS.push(row);
  }
  const LD = new Uint8Array(46), DEC = new Uint8Array(46), BANDBIT = new Int32Array(46);
  for (let n = 1; n <= 45; n++) { LD[n] = n % 10; DEC[n] = Math.floor((n - 1) / 10); BANDBIT[n] = 1 << (3 * DEC[n]); }

  /* 입력 검증: 정수 1..45 여섯 개(숫자 문자열 허용, 비정수·NaN·범위 밖·중복은 throw — 조용히 절삭하지 않음) → 오름차순 새 배열 */
  function sorted6(c) {
    if (!c || c.length !== 6) throw new RangeError('combo must have 6 numbers');
    const a = new Array(6);
    for (let i = 0; i < 6; i++) { const v = +c[i]; if (!Number.isInteger(v)) throw new RangeError('combo must be integers: ' + Array.from(c)); a[i] = v; }
    a.sort((x, y) => x - y);
    for (let i = 0; i < 6; i++) if (a[i] < 1 || a[i] > 45 || (i && a[i] === a[i - 1])) throw new RangeError('invalid combo ' + Array.from(c));
    return a;
  }
  function index(c) {
    const a = sorted6(c);
    let idx = 0, prev = 0;
    for (let i = 0; i < 6; i++) { const v = a[i]; idx += LEXS[i][v - 1] - LEXS[i][prev]; prev = v; }
    return idx;
  }
  function combo(idx) {
    if (!(idx >= 0 && idx < N) || idx !== Math.floor(idx)) throw new RangeError('index out of range: ' + idx);
    let rem = idx, prev = 0; const out = new Array(6);
    for (let i = 0; i < 6; i++) {
      let v = prev + 1;
      while (v <= 40 + i && BIN[45 - v][5 - i] <= rem) { rem -= BIN[45 - v][5 - i]; v++; }
      out[i] = v; prev = v;
    }
    return out;
  }

  /* index.html popFeat 와 글자 단위로 같은 코드 (비트 단위 동일성 보장). 페이지처럼 «오름차순 입력» 전제(연속쌍·범위).
     공개 L.popFeat 는 먼저 sorted6 로 정렬·검증하므로 순서 무관(정렬된 입력엔 비트 동일); L.popFeatRaw 는 페이지 원문 그대로. */
  function popFeat(c) { return popFeatRaw(sorted6(c)); }
  function popFeatRaw(n) {
    const s = n.reduce((a, b) => a + b, 0);
    let cons = 0; for (let i = 1; i < 6; i++) if (n[i] === n[i - 1] + 1) cons++;
    const ld = {}; n.forEach(x => ld[x % 10] = (ld[x % 10] || 0) + 1);
    const sameLast = Object.values(ld).reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
    const dec = {}; n.forEach(x => dec[Math.floor((x - 1) / 10)] = 1);
    return [1, n.filter(x => x <= 31).length, n.filter(x => x <= 12).length,
      (s - 138) / 30, cons, sameLast, (n[5] - n[0] - 33) / 8, Object.keys(dec).length];
  }
  /* 원시 특징 → 29비트 키. c31 | c12<<3 | s<<6 | cons<<14 | same<<17 | range<<20 | ndec<<26 */
  function featKey(a) {
    let s = 0, c31 = 0, c12 = 0, cons = 0, ld = 0, dist = 0, dc = 0, nd = 0;
    for (let i = 0; i < 6; i++) {
      const x = a[i]; s += x; if (x <= 31) c31++; if (x <= 12) c12++;
      if (i && x === a[i - 1] + 1) cons++;
      if (!((ld >> LD[x]) & 1)) { ld |= 1 << LD[x]; dist++; }
      if (!((dc >> DEC[x]) & 1)) { dc |= 1 << DEC[x]; nd++; }
    }
    return c31 | (c12 << 3) | (s << 6) | (cons << 14) | ((6 - dist) << 17) | ((a[5] - a[0]) << 20) | (nd << 26);
  }
  function keyFeat(key, out, off) {
    out[off] = 1;
    out[off + 1] = key & 7;
    out[off + 2] = (key >> 3) & 7;
    out[off + 3] = (((key >> 6) & 255) - 138) / 30;
    out[off + 4] = (key >> 14) & 7;
    out[off + 5] = (key >> 17) & 7;
    out[off + 6] = (((key >> 20) & 63) - 33) / 8;
    out[off + 7] = (key >> 26) & 7;
    return out;
  }
  /* 주간 필터(1등 이력 제외는 별도): 합 100~175 · 홀 2~4 · 연속쌍 ≤2 · 한 구간 ≤3 */
  function filterPass(c) {
    const a = sorted6(c);
    let s = 0, o = 0, cons = 0, bb = 0;
    for (let i = 0; i < 6; i++) { const x = a[i]; s += x; o += x & 1; if (i && x === a[i - 1] + 1) cons++; bb += BANDBIT[x]; }
    return s >= 100 && s <= 175 && o >= 2 && o <= 4 && cons <= 2 && (bb & 0x4924) === 0;
  }

  /* 전수 사전식 열거. cb(i, key, pass) — i 는 사전식 index. progress(frac) 선택. */
  function enumerate(cb, progress) {
    let i = 0;
    for (let n1 = 1; n1 <= 40; n1++) {
      if (progress) progress((n1 - 1) / 40);
      const s1 = n1, a1 = n1 <= 31 ? 1 : 0, b1 = n1 <= 12 ? 1 : 0, ld1 = 1 << LD[n1], d1 = 1, dc1 = 1 << DEC[n1], nd1 = 1, o1 = n1 & 1, bb1 = BANDBIT[n1];
      for (let n2 = n1 + 1; n2 <= 41; n2++) {
        const s2 = s1 + n2, a2 = a1 + (n2 <= 31 ? 1 : 0), b2 = b1 + (n2 <= 12 ? 1 : 0), c2 = (n2 === n1 + 1 ? 1 : 0),
          ld2 = ld1 | (1 << LD[n2]), d2 = d1 + (((ld1 >> LD[n2]) & 1) ^ 1), dc2 = dc1 | (1 << DEC[n2]), nd2 = nd1 + (((dc1 >> DEC[n2]) & 1) ^ 1),
          o2 = o1 + (n2 & 1), bb2 = bb1 + BANDBIT[n2];
        for (let n3 = n2 + 1; n3 <= 42; n3++) {
          const s3 = s2 + n3, a3 = a2 + (n3 <= 31 ? 1 : 0), b3 = b2 + (n3 <= 12 ? 1 : 0), c3 = c2 + (n3 === n2 + 1 ? 1 : 0),
            ld3 = ld2 | (1 << LD[n3]), d3 = d2 + (((ld2 >> LD[n3]) & 1) ^ 1), dc3 = dc2 | (1 << DEC[n3]), nd3 = nd2 + (((dc2 >> DEC[n3]) & 1) ^ 1),
            o3 = o2 + (n3 & 1), bb3 = bb2 + BANDBIT[n3];
          for (let n4 = n3 + 1; n4 <= 43; n4++) {
            const s4 = s3 + n4, a4 = a3 + (n4 <= 31 ? 1 : 0), b4 = b3 + (n4 <= 12 ? 1 : 0), c4 = c3 + (n4 === n3 + 1 ? 1 : 0),
              ld4 = ld3 | (1 << LD[n4]), d4 = d3 + (((ld3 >> LD[n4]) & 1) ^ 1), dc4 = dc3 | (1 << DEC[n4]), nd4 = nd3 + (((dc3 >> DEC[n4]) & 1) ^ 1),
              o4 = o3 + (n4 & 1), bb4 = bb3 + BANDBIT[n4];
            for (let n5 = n4 + 1; n5 <= 44; n5++) {
              const s5 = s4 + n5, a5 = a4 + (n5 <= 31 ? 1 : 0), b5 = b4 + (n5 <= 12 ? 1 : 0), c5 = c4 + (n5 === n4 + 1 ? 1 : 0),
                ld5 = ld4 | (1 << LD[n5]), d5 = d4 + (((ld4 >> LD[n5]) & 1) ^ 1), dc5 = dc4 | (1 << DEC[n5]), nd5 = nd4 + (((dc4 >> DEC[n5]) & 1) ^ 1),
                o5 = o4 + (n5 & 1), bb5 = bb4 + BANDBIT[n5];
              for (let n6 = n5 + 1; n6 <= 45; n6++) {
                const s = s5 + n6, cons = c5 + (n6 === n5 + 1 ? 1 : 0), same = 6 - d5 - (((ld5 >> LD[n6]) & 1) ^ 1),
                  nd = nd5 + (((dc5 >> DEC[n6]) & 1) ^ 1), o = o5 + (n6 & 1);
                const key = (a5 + (n6 <= 31 ? 1 : 0)) | ((b5 + (n6 <= 12 ? 1 : 0)) << 3) | (s << 6) | (cons << 14) | (same << 17) | ((n6 - n1) << 20) | (nd << 26);
                const pass = (s >= 100 && s <= 175 && cons <= 2 && o >= 2 && o <= 4 && ((bb5 + BANDBIT[n6]) & 0x4924) === 0) ? 1 : 0;
                cb(i, key, pass); i++;
              }
            }
          }
        }
      }
    }
    if (progress) progress(1);
  }

  const HCAPB = 21, HCAP = 1 << HCAPB, HMASK = HCAP - 1, HSHIFT = 32 - HCAPB;   // K = 470,942 → 적재율 ≈ 0.22
  /* 회차 무관 튜플 표 — 1회 생성. opts.withIndex → tupleOf(Uint32Array N). pass = 필터 통과 비트셋(항상). */
  function buildTable(opts) {
    opts = opts || {};
    const HK = new Int32Array(HCAP).fill(-1), HC = new Uint32Array(HCAP), HF = new Uint32Array(HCAP);
    const withIndex = !!opts.withIndex;
    const slotOf = withIndex ? new Uint32Array(N) : null;
    const pass = new Uint8Array((N >> 3) + 1);
    let K = 0;
    const prog = opts.progress ? (f => opts.progress(f * 0.85)) : null;
    enumerate(function (i, key, p) {
      let h = Math.imul(key, 0x9E3779B1) >>> HSHIFT;
      for (;;) { const kk = HK[h]; if (kk === key) break; if (kk === -1) { HK[h] = key; K++; break; } h = (h + 1) & HMASK; }
      HC[h]++;
      if (p) { HF[h]++; pass[i >> 3] |= 1 << (i & 7); }
      if (slotOf) slotOf[i] = h;
    }, prog);
    const packed = new Float64Array(K); let m = 0;
    for (let h = 0; h < HCAP; h++) if (HK[h] !== -1) packed[m++] = HK[h] * HCAP + h;   // key<2^29 · slot<2^21 → <2^50 정확
    packed.sort();
    const key = new Uint32Array(K), count = new Uint32Array(K), countF = new Uint32Array(K);
    const slot2id = slotOf ? new Int32Array(HCAP) : null;
    let NF = 0;
    for (let t = 0; t < K; t++) {
      const v = packed[t], slot = v % HCAP, k = (v - slot) / HCAP;
      key[t] = k; count[t] = HC[slot]; countF[t] = HF[slot]; NF += HF[slot];
      if (slot2id) slot2id[slot] = t;
    }
    let tupleOf = null;
    if (slotOf) { tupleOf = slotOf; for (let i = 0; i < N; i++) tupleOf[i] = slot2id[tupleOf[i]]; }
    if (opts.progress) opts.progress(1);
    const T = { K, N, NF, key, count, countF, pass, tupleOf };
    /* T.feat(F64 K*8, 30 MB) 는 첫 접근 때 key 에서 만든다(엔진 내부는 key 만 씀 → 모바일 메모리 절약). 값은 이전과 비트 동일. */
    let feat = null;
    Object.defineProperty(T, 'feat', { enumerable: true, configurable: true, get() {
      if (!feat) { feat = new Float64Array(K * 8); for (let t = 0; t < K; t++) keyFeat(key[t], feat, t * 8); }
      return feat;
    } });
    return T;
  }
  function bsearchU32(arr, v) {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >>> 1, x = arr[mid]; if (x === v) return mid; if (x < v) lo = mid + 1; else hi = mid - 1; }
    return -1;
  }
  function tupleId(T, c) { return bsearchU32(T.key, featKey(sorted6(c))); }
  /* tupleOf 가 없는 표에 지연 생성(캐시). */
  function ensureTupleOf(T) {
    if (T.tupleOf) return T.tupleOf;
    const HK = new Int32Array(HCAP).fill(-1), HI = new Int32Array(HCAP);
    for (let t = 0; t < T.K; t++) {
      const key = T.key[t]; let h = Math.imul(key, 0x9E3779B1) >>> HSHIFT;
      while (HK[h] !== -1) h = (h + 1) & HMASK;
      HK[h] = key; HI[h] = t;
    }
    const tupleOf = new Uint32Array(N);
    enumerate(function (i, key) {
      let h = Math.imul(key, 0x9E3779B1) >>> HSHIFT;
      while (HK[h] !== key) h = (h + 1) & HMASK;
      tupleOf[i] = HI[h];
    });
    T.tupleOf = tupleOf;
    return tupleOf;
  }
  function passBit(T, i) { return (T.pass[i >> 3] >> (i & 7)) & 1; }

  /* zOf 와 같은 산술: clamp(j≥1) → Σ v·beta 누적 → 표준화 → A/B 평균. P.A 없으면 null. */
  function popModelZ(P, f) {
    const A = P.A; if (!A) return null;
    const B = P.B || null, b = P.bounds, useB = !!(b && b.length), ba = A.beta, bb = B ? B.beta : null;
    let sa = 0, sb = 0;
    for (let j = 0; j < 8; j++) {
      let v = f[j];
      if (useB && j !== 0) v = Math.max(b[j][0], Math.min(b[j][1], v));
      sa = sa + v * ba[j];
      if (bb) sb = sb + v * bb[j];
    }
    const za = (sa - A.predMean) / A.predSD;
    if (!B) return za;
    return (za + (sb - B.predMean) / B.predSD) / 2;
  }
  function zOfCombo(P, c) { return popModelZ(P, popFeatRaw(sorted6(c))); }

  /* (P 내용, T identity) 기준 소형 LRU — P 가 postMessage 복제본이어도(워커) 적중, 회차마다 새 P 여도(rank-track) 메모리 상한 4개 */
  const ZCACHE = [], ZCACHE_MAX = 4;
  const pm = o => o ? [Array.from(o.beta), o.predMean, o.predSD] : null;
  function pkeyOf(P) { return JSON.stringify([pm(P.A), pm(P.B), P.bounds || null]); }
  function cacheFor(P, T) {
    const key = pkeyOf(P);
    for (let j = 0; j < ZCACHE.length; j++) {
      const e = ZCACHE[j];
      if (e.key === key && e.T === T) { if (j) { ZCACHE.splice(j, 1); ZCACHE.unshift(e); } return e; }
    }
    const e = { key, T };
    ZCACHE.unshift(e); if (ZCACHE.length > ZCACHE_MAX) ZCACHE.pop();
    return e;
  }
  function scoreTuples(P, T) {
    if (!P || !P.A) throw new Error('scoreTuples: P.A missing');
    const e = cacheFor(P, T);
    if (e.z) return e.z;
    const K = T.K, key = T.key, z = new Float64Array(K), tmp = new Array(8);
    for (let t = 0; t < K; t++) { keyFeat(key[t], tmp, 0); z[t] = popModelZ(P, tmp); }   // T.feat 와 같은 값(둘 다 keyFeat)
    e.z = z;
    return z;
  }
  /* 제외 목록 → 사전식 index 의 중복 없는 배열 */
  function excludeIdx(list) {
    if (!list || !list.length) return null;
    const seen = new Set(); const out = [];
    for (const c of list) { const i = index(c); if (!seen.has(i)) { seen.add(i); out.push(i); } }
    return out;
  }
  function rankPop(P, T, c, opts) {
    opts = opts || {};
    const filter = !!opts.filter, a = sorted6(c), z = scoreTuples(P, T);
    const ci = index(a), t = tupleId(T, a);
    if (t < 0) throw new Error('rankPop: tuple not found');
    const ex = excludeIdx(opts.excludeWon);
    let of = filter ? T.NF : N;
    if (filter && !filterPass(a)) return { excluded: true, of: of - (ex ? ex.filter(i => passBit(T, i)).length : 0) };
    const zc = z[t], cnt = filter ? T.countF : T.count;
    let less = 0, eq = 0;
    for (let u = 0; u < T.K; u++) { const zu = z[u]; if (zu < zc) less += cnt[u]; else if (zu === zc) eq += cnt[u]; }
    let self = false;
    if (ex) {
      const tupleOf = T.tupleOf;
      for (const i of ex) {
        if (filter && !passBit(T, i)) continue;
        of--;
        if (i === ci) { self = true; continue; }
        const zi = z[tupleOf ? tupleOf[i] : tupleId(T, combo(i))];
        if (zi < zc) less--; else if (zi === zc) eq--;
      }
    }
    if (self) return { excluded: true, of };
    const best = less + 1, worst = less + eq, mid = (best + worst) / 2;
    return { best, worst, mid, of, pct: (mid - 0.5) / of, z: zc };
  }
  /* 튜플을 z 값별 그룹으로: gid[t], zU[g](오름차순), 그룹별 count/countF */
  function popGroups(P, T) {
    const e = cacheFor(P, T);
    if (e.groups) return e.groups;
    const z = scoreTuples(P, T), K = T.K;
    const zs = Float64Array.from(z).sort();
    let G = 0; for (let t = 0; t < K; t++) if (t === 0 || zs[t] !== zs[t - 1]) G++;
    const zU = new Float64Array(G); G = 0;
    for (let t = 0; t < K; t++) if (t === 0 || zs[t] !== zs[t - 1]) zU[G++] = zs[t];
    const gid = new Uint32Array(K), cnt = new Float64Array(G), cntF = new Float64Array(G);
    for (let t = 0; t < K; t++) {
      const v = z[t]; let lo = 0, hi = G - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (zU[mid] < v) lo = mid + 1; else hi = mid; }
      gid[t] = lo; cnt[lo] += T.count[t]; cntF[lo] += T.countF[t];
    }
    e.groups = { G, zU, gid, cnt, cntF };
    return e.groups;
  }
  /* 순위 offset+1..offset+k 의 조합 — z 오름차순, 동점(같은 z)은 index 오름차순 */
  function pagePop(P, T, offset, k, opts) {
    opts = opts || {};
    offset = Math.max(0, Math.floor(offset || 0)); k = Math.max(0, Math.floor(k || 0));
    const filter = !!opts.filter, tupleOf = ensureTupleOf(T), g0 = popGroups(P, T);
    const G = g0.G, gid = g0.gid, zU = g0.zU;
    const gcnt = Float64Array.from(filter ? g0.cntF : g0.cnt);
    const ex = excludeIdx(opts.excludeWon);
    let exSet = null;
    if (ex) { exSet = new Set(); for (const i of ex) { if (filter && !passBit(T, i)) continue; exSet.add(i); gcnt[gid[tupleOf[i]]]--; } }
    let of = 0; for (let g = 0; g < G; g++) of += gcnt[g];
    if (offset >= of || k === 0) return [];
    k = Math.min(k, of - offset);
    let acc = 0, gStart = -1, gEnd = -1, skip = 0;
    for (let g = 0; g < G; g++) {
      if (gStart < 0 && acc + gcnt[g] > offset) { gStart = g; skip = offset - acc; }
      acc += gcnt[g];
      if (gStart >= 0 && acc >= offset + k) { gEnd = g; break; }
    }
    if (gEnd < 0) gEnd = G - 1;
    const want = new Uint8Array(T.K);
    for (let t = 0; t < T.K; t++) { const g = gid[t]; if (g >= gStart && g <= gEnd) want[t] = 1; }
    const nb = gEnd - gStart + 1, buf = new Array(nb); for (let b = 0; b < nb; b++) buf[b] = [];
    const pass = T.pass; let skipped = 0;
    for (let i = 0; i < N; i++) {
      const t = tupleOf[i]; if (!want[t]) continue;
      if (filter && !((pass[i >> 3] >> (i & 7)) & 1)) continue;
      if (exSet && exSet.has(i)) continue;
      const b = gid[t] - gStart;
      if (b === 0) { if (skipped < skip) { skipped++; continue; } if (buf[0].length >= k) break; }
      else if (buf[b].length >= k) continue;
      buf[b].push(i);
    }
    const out = [];
    for (let b = 0; b < nb && out.length < k; b++) {
      const zz = zU[gStart + b], arr = buf[b];
      for (let j = 0; j < arr.length && out.length < k; j++) out.push({ r: offset + out.length + 1, c: combo(arr[j]), z: zz, i: arr[j] });
    }
    return out;
  }

  /* 탐색 순서상의 정확한 위치(1-based) = rankPop().best + #{같은 z · index 더 작음 · 우주 안}. 제외되면 null. pagePop 와 같은 순서. */
  function posPop(P, T, c, opts) {
    opts = opts || {};
    const r = rankPop(P, T, c, opts);
    if (r.excluded) return null;
    const filter = !!opts.filter, a = sorted6(c), ci = index(a), z = scoreTuples(P, T), zc = z[tupleId(T, a)];
    const tupleOf = ensureTupleOf(T), same = new Uint8Array(T.K);
    for (let t = 0; t < T.K; t++) if (z[t] === zc) same[t] = 1;
    const ex = excludeIdx(opts.excludeWon); let exSet = null;
    if (ex) { exSet = new Set(); for (const i of ex) if (i < ci && same[tupleOf[i]] && (!filter || passBit(T, i))) exSet.add(i); }
    const pass = T.pass; let tb = 0;
    for (let i = 0; i < ci; i++) {
      if (!same[tupleOf[i]]) continue;
      if (filter && !((pass[i >> 3] >> (i & 7)) & 1)) continue;
      tb++;
    }
    if (exSet) tb -= exSet.size;
    return r.best + tb;
  }

  /* ─── 가산 모델(hot/cold) ─── */
  const ASCALE_BITS = 46, ATOL = 6;
  function logw(kind, arr) {
    const out = new Float64Array(46);
    if (!arr || (arr.length !== 46 && arr.length !== 45)) throw new RangeError('logw: expected 45/46 weights');
    const off = arr.length === 46 ? 0 : -1;
    for (let n = 1; n <= 45; n++) { const w = +arr[n + off]; if (!(w > 0) || !Number.isFinite(w)) throw new RangeError('logw: weight must be finite and > 0 (n=' + n + ')'); out[n] = Math.log(w); }
    return out;
  }
  /* 정수 점수표: q[n] = round(logw[n]·2^bits). 오버플로(6·max·2^46 > 2^53)면 bits 를 낮춘다. 비유한(±Infinity·NaN)은 throw. */
  function quantize(lw) {
    if (!lw || (lw.length !== 46 && lw.length !== 45)) throw new RangeError('logw46 expected');
    const off = lw.length === 46 ? 0 : -1;
    let mx = 0; for (let n = 1; n <= 45; n++) { const v = Math.abs(+lw[n + off]); if (!Number.isFinite(v)) throw new RangeError('logw must be finite (n=' + n + ')'); if (v > mx) mx = v; }
    let bits = ASCALE_BITS;
    while (bits > 0 && 6 * mx * Math.pow(2, bits) >= 9007199254740992) bits--;
    const scale = Math.pow(2, bits), q = new Float64Array(46);
    for (let n = 1; n <= 45; n++) q[n] = Math.round(lw[n + off] * scale);
    q.scale = scale; q.bits = bits;
    return q;
  }
  function qsum(q, a) { return q[a[0]] + q[a[1]] + q[a[2]] + q[a[3]] + q[a[4]] + q[a[5]]; }
  function additiveScore(lw, c) { const q = quantize(lw); return qsum(q, sorted6(c)) / q.scale; }
  /* 동점 사슬 전제(폭 ≤ ATOL) 위반 → 순서·pos·rank 정의가 서로 어긋나므로 조용히 답하지 않고 던진다 */
  function chainThrow() { throw new RangeError('additive: tie chain wider than ATOL(' + ATOL + ') — rank/browse order undefined for these weights'); }
  /* 조합 c 의 사슬 = ±ATOL 창에서 6 이내로 이어진 점수들. 창 안 폭 ≤ ATOL 이고 창 밖 이웃(위 mnA·아래 mxB)이 6 넘게 떨어져 있을 때만 사슬 = 창. */
  function chainCheck(loW, hiW, mxB, mnA) { if (hiW - loW > ATOL || mxB >= loW - ATOL || mnA <= hiW + ATOL) chainThrow(); }
  function rankAdditive(lw, c, opts) {
    const q = quantize(lw), a = sorted6(c), sc = qsum(q, a), hi = sc + ATOL, lo = sc - ATOL;
    let g = 0, t = 0, loW = sc, hiW = sc, mxB = -Infinity, mnA = Infinity;   // loW/hiW: 창 안 최소·최대, mxB: 창 아래 최대, mnA: 창 위 최소
    const progress = opts && opts.progress;
    for (let n1 = 1; n1 <= 40; n1++) {
      if (progress) progress((n1 - 1) / 40);
      const s1 = q[n1];
      for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 + q[n2];
        for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 + q[n3];
          for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 + q[n4];
            for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 + q[n5];
              for (let n6 = n5 + 1; n6 <= 45; n6++) {
                const s = s5 + q[n6];
                if (s > hi) { g++; if (s < mnA) mnA = s; }
                else if (s >= lo) { t++; if (s < loW) loW = s; else if (s > hiW) hiW = s; }
                else if (s > mxB) mxB = s;
              }
            } } } }
    }
    chainCheck(loW, hiW, mxB, mnA);
    const best = g + 1, worst = g + t, mid = (best + worst) / 2;
    return { best, worst, mid, of: N, pct: (mid - 0.5) / N, s: sc / q.scale };
  }
  /* ── k-best(최상위 탐색): 가중치 내림차순 위치 p1<…<p6, 자식 = p_j+1 (j ≤ m) — 각 조합 정확히 1회 생성 ── */
  function pageAdditiveHeap(q, offset, k, budget) {
    const nums = []; for (let n = 1; n <= 45; n++) nums.push(n);
    nums.sort((x, y) => (q[y] - q[x]) || (x - y));
    const qs = new Float64Array(45); for (let p = 0; p < 45; p++) qs[p] = q[nums[p]];
    let cap = 1 << 16, hs = new Float64Array(cap), hlo = new Int32Array(cap), hhi = new Int32Array(cap), hn = 0;
    function push(s, lo, hi) {
      if (hn === cap) { cap *= 2; const a = new Float64Array(cap); a.set(hs); hs = a; const b = new Int32Array(cap); b.set(hlo); hlo = b; const c = new Int32Array(cap); c.set(hhi); hhi = c; }
      let i = hn++;
      while (i > 0) { const p = (i - 1) >> 1; if (hs[p] >= s) break; hs[i] = hs[p]; hlo[i] = hlo[p]; hhi[i] = hhi[p]; i = p; }
      hs[i] = s; hlo[i] = lo; hhi[i] = hi;
    }
    let ps = 0, plo = 0, phi = 0;
    function pop() {
      ps = hs[0]; plo = hlo[0]; phi = hhi[0]; hn--;
      if (hn === 0) return;
      const s = hs[hn], lo = hlo[hn], hi = hhi[hn]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hs[c + 1] > hs[c]) c++; if (hs[c] <= s) break; hs[i] = hs[c]; hlo[i] = hlo[c]; hhi[i] = hhi[c]; i = c; }
      hs[i] = s; hlo[i] = lo; hhi[i] = hi;
    }
    const p = new Int32Array(7);
    push(qs[0] + qs[1] + qs[2] + qs[3] + qs[4] + qs[5], 0 | (1 << 6) | (2 << 12) | (3 << 18) | (4 << 24), 5 | (6 << 6));
    let pos = 0, pops = 0; const out = [], want = offset + k;
    const c6 = [0, 0, 0, 0, 0, 0];
    while (pos < want && hn > 0) {
      const s0 = hs[0], level = [];
      while (hn > 0 && hs[0] >= s0 - ATOL) {          // 동점 구간(최대값 −ATOL 까지) 전체를 모은 뒤 index 순으로
        pop(); pops++;
        if (pops > budget) return null;
        const lo = plo, hi = phi, s = ps;
        p[0] = lo & 63; p[1] = (lo >> 6) & 63; p[2] = (lo >> 12) & 63; p[3] = (lo >> 18) & 63; p[4] = (lo >> 24) & 63; p[5] = hi & 63; p[6] = 45;
        const m = (hi >> 6) & 7;
        for (let j = 0; j < 6; j++) c6[j] = nums[p[j]];
        level.push({ i: index(c6), s });
        for (let j = 1; j <= m; j++) {
          const pj = p[j - 1];
          if (pj + 1 < p[j]) {
            const cs = s - qs[pj] + qs[pj + 1];
            let nlo = lo, nhi = hi;
            if (j <= 5) nlo = lo + (1 << (6 * (j - 1))); else nhi = (hi & 63) + 1;
            nhi = (nhi & 63) | (j << 6);
            push(cs, nlo, nhi);
          }
        }
      }
      // 남은 최대값(hs[0])이 이 레벨의 최솟값(ps) 에서 6 이내 → 사슬이 앵커 창 밖으로 이어짐(폭 > ATOL). 힙은 남은 조합의 최대값을 항상 알므로 정확한 검출.
      if (hn > 0 && hs[0] >= ps - ATOL) chainThrow();
      level.sort((x, y) => x.i - y.i);
      for (const it of level) {
        if (pos >= offset && pos < want) out.push({ r: pos + 1, c: combo(it.i), s: it.s / q.scale, i: it.i });
        pos++;
        if (pos >= want) break;
      }
    }
    return out;
  }
  /* ── 임의 offset 페이지: 정수 점수 키(maxB−s)의 2^20 구간 히스토그램(가중치별 1회, 4 MB 캐시)
       → offset..offset+k 가 든 구간만 1패스로 수집 → 구간 안에서 (점수 내림차순, index 오름차순). 전수 정렬·해시 없음. ── */
  const ABITS = 20, ANB = 1 << ABITS;
  const AHIST = [], AHIST_MAX = 2;   // 가중치 내용 기준 LRU 2개(hot·cold 번갈아 넘겨도 적중) — 항목 { qk, maxB, W, cum:F64(ANB+1) ≈ 8 MB }
  function qRange(q) {                // 최대/최소 6개 합
    const srt = Array.from(q.subarray(1)).sort((x, y) => x - y);
    let maxB = 0, minB = 0; for (let j = 0; j < 6; j++) { maxB += srt[44 - j]; minB += srt[j]; }
    return { maxB, minB };
  }
  function additiveHist(q, progress) {
    const qk = q.bits + ':' + Array.prototype.join.call(q, ',');
    for (let j = 0; j < AHIST.length; j++) if (AHIST[j].qk === qk) { const e = AHIST[j]; if (j) { AHIST.splice(j, 1); AHIST.unshift(e); } return e; }
    const { maxB, minB } = qRange(q);
    let W = 1; while (Math.floor((maxB - minB) / W) >= ANB) W *= 2;       // 구간 폭(2의 거듭제곱) → 구간 번호 < 2^20
    const hist = new Uint32Array(ANB);
    for (let n1 = 1; n1 <= 40; n1++) {
      if (progress) progress(0.5 * (n1 - 1) / 40);
      const s1 = maxB - q[n1];
      for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 - q[n2];
        for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 - q[n3];
          for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 - q[n4];
            for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 - q[n5];
              for (let n6 = n5 + 1; n6 <= 45; n6++) hist[((s5 - q[n6]) / W) | 0]++;
            } } } }
    }
    const cum = new Float64Array(ANB + 1);
    for (let b = 0; b < ANB; b++) cum[b + 1] = cum[b] + hist[b];
    const e = { qk, maxB, W, cum };
    AHIST.unshift(e); if (AHIST.length > AHIST_MAX) AHIST.pop();
    return e;
  }
  /* 구간 [bStart, bEnd] 의 조합을 index 순으로 수집 → 점수 내림차순·동점 index 오름차순으로 배열한 {sc, ix, ord} */
  function additiveCollect(q, H, bStart, bEnd, progress) {
    const maxB = H.maxB, W = H.W, M = H.cum[bEnd + 1] - H.cum[bStart];
    const sc = new Float64Array(M), ix = new Uint32Array(M);
    let m = 0, i = 0, smin = Infinity, smax = -Infinity;
    for (let n1 = 1; n1 <= 40; n1++) {
      if (progress) progress(0.5 + 0.4 * (n1 - 1) / 40);
      const s1 = q[n1];
      for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 + q[n2];
        for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 + q[n3];
          for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 + q[n4];
            for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 + q[n5];
              for (let n6 = n5 + 1; n6 <= 45; n6++) {
                const s = s5 + q[n6], b = ((maxB - s) / W) | 0;
                if (b >= bStart && b <= bEnd) { sc[m] = s; ix[m] = i; m++; if (s < smin) smin = s; if (s > smax) smax = s; }
                i++;
              }
            } } } }
    }
    const ord = new Uint32Array(M);
    if (smax - smin <= ATOL) { for (let j = 0; j < M; j++) ord[j] = j; return { sc, ix, ord, M }; }   // 전부 한 동점 구간 → index 순 그대로
    const asc = Float64Array.from(sc).sort();
    let D = 0; for (let j = 0; j < M; j++) if (j === 0 || asc[j] !== asc[j - 1]) asc[D++] = asc[j];
    // 동점 구간 = 서로 ATOL 이내로 이어진 점수 묶음(hot/cold 는 구간 안 폭 ≤ 4, 구간 사이 ≥ 2.9e7 단위라 ±ATOL 규칙과 같다).
    // 수집 창 안의 사슬 폭이 ATOL 을 넘으면 전제 위반 → throw. 창 가장자리에서 잘린 사슬(보이는 폭 ≤ ATOL)은 pageAdditive 의 ±ceil(2·ATOL/W) 여유 덕에
    // 페이지 구간(bStart..bEnd)에 닿지 못하므로, 던지지 않고 돌아온 페이지는 정확하다.
    const grp = new Int32Array(D); let G = 0, g0 = 0;
    for (let j = 0; j < D; j++) { if (j && asc[j] - asc[j - 1] > ATOL) { if (asc[j - 1] - asc[g0] > ATOL) chainThrow(); G++; g0 = j; } grp[j] = G; }
    if (asc[D - 1] - asc[g0] > ATOL) chainThrow();
    G++;
    const cnt = new Float64Array(G + 1), lvl = new Int32Array(M);
    for (let j = 0; j < M; j++) {
      const v = sc[j]; let lo = 0, hi = D - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (asc[mid] < v) lo = mid + 1; else hi = mid; }
      const L = G - 1 - grp[lo]; lvl[j] = L; cnt[L + 1]++;                 // 내림차순 구간 번호
    }
    for (let L = 0; L < G; L++) cnt[L + 1] += cnt[L];
    for (let j = 0; j < M; j++) ord[cnt[lvl[j]]++] = j;               // 안정 → 같은 동점 구간 안은 index 순
    return { sc, ix, ord, M };
  }
  const HEAP_LIMIT = 50000, HEAP_BUDGET = 3000000;
  function pageAdditive(lw, offset, k, opts) {
    opts = opts || {};
    offset = Math.max(0, Math.floor(offset || 0)); k = Math.max(0, Math.floor(k || 0));
    if (offset >= N || k === 0) return [];
    k = Math.min(k, N - offset);
    const q = quantize(lw);
    { const { maxB, minB } = qRange(q);                      // 퇴화(전부 한 동점 구간, 예: 가중치 전부 같음) → 그냥 index 순
      if (maxB - minB <= ATOL) { const out = []; for (let i = offset; i < offset + k; i++) { const c = combo(i); out.push({ r: i + 1, c, s: qsum(q, c) / q.scale, i }); } if (opts.progress) opts.progress(1); return out; } }
    if (offset + k <= HEAP_LIMIT && !opts.full) {
      const r = pageAdditiveHeap(q, offset, k, HEAP_BUDGET);
      if (r) return r;
    }
    const H = additiveHist(q, opts.progress), cum = H.cum;
    let lo = 0, hi = ANB - 1;                                     // bStart: cum[b] ≤ offset < cum[b+1]
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cum[mid + 1] > offset) hi = mid; else lo = mid + 1; }
    const bStart = lo, want = offset + k;
    lo = bStart; hi = ANB - 1;                                    // bEnd: 첫 b with cum[b+1] ≥ offset+k
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cum[mid + 1] >= want) hi = mid; else lo = mid + 1; }
    const bEnd = lo;
    // 동점 구간(폭 ≤ ATOL)은 최대 ceil(ATOL/W)+1 개 구간에 걸치므로 양옆 ceil(ATOL/W) 구간이 필요하고(W ≤ ATOL 이면 ±1 로는 부족),
    // 두 배(ceil(2·ATOL/W))로 잡으면 수집 창 가장자리에서 잘린 사슬이 페이지 구간에 닿지 못해 additiveCollect 의 사슬 폭 검사가 페이지에 대해 정확해진다.
    // 실제 hot/cold 는 W = 2^30 → ±1 구간(이전과 동일).
    const ext = Math.max(1, Math.ceil(2 * ATOL / H.W)), b0 = Math.max(0, bStart - ext), b1 = Math.min(ANB - 1, bEnd + ext);
    const C = additiveCollect(q, H, b0, b1, opts.progress);
    const skip = offset - cum[b0], out = [];
    for (let j = skip; j < C.M && out.length < k; j++) { const e = C.ord[j], i = C.ix[e]; out.push({ r: offset + out.length + 1, c: combo(i), s: C.sc[e] / q.scale, i }); }
    if (opts.progress) opts.progress(1);
    return out;
  }
  /* 탐색 순서상의 정확한 위치(1-based) = rankAdditive().best + #{|s−sc| ≤ ATOL · index < i} — pageAdditive 와 같은 순서(사슬 전제 검사도 같음) */
  function posAdditive(lw, c) {
    const q = quantize(lw), a = sorted6(c), sc = qsum(q, a), ci = index(a), hi = sc + ATOL, lo = sc - ATOL;
    let g = 0, tb = 0, i = 0, loW = sc, hiW = sc, mxB = -Infinity, mnA = Infinity;
    for (let n1 = 1; n1 <= 40; n1++) { const s1 = q[n1];
      for (let n2 = n1 + 1; n2 <= 41; n2++) { const s2 = s1 + q[n2];
        for (let n3 = n2 + 1; n3 <= 42; n3++) { const s3 = s2 + q[n3];
          for (let n4 = n3 + 1; n4 <= 43; n4++) { const s4 = s3 + q[n4];
            for (let n5 = n4 + 1; n5 <= 44; n5++) { const s5 = s4 + q[n5];
              for (let n6 = n5 + 1; n6 <= 45; n6++) {
                const s = s5 + q[n6];
                if (s > hi) { g++; if (s < mnA) mnA = s; }
                else if (s >= lo) { if (i < ci) tb++; if (s < loW) loW = s; else if (s > hiW) hiW = s; }
                else if (s > mxB) mxB = s;
                i++;
              }
            } } } }
    }
    chainCheck(loW, hiW, mxB, mnA);
    return g + tb + 1;
  }
  function rankAdditiveCached(lw, c) { return rankAdditive(lw, c); }   // 하위호환 별칭

  RC.lotto = {
    N, index, combo, popFeat, popFeatRaw, featKey, keyFeat, filterPass, enumerate, buildTable, tupleId, ensureTupleOf,
    popModelZ, zOfCombo, scoreTuples, rankPop, pagePop, popGroups,
    posPop,
    logw, quantize, additiveScore, rankAdditive, rankAdditiveCached, pageAdditive, posAdditive, additiveHist,
    ATOL, ASCALE_BITS
  };

  /* ═══════════════════════ 연금 ═══════════════════════ */
  const PN = 5000000, PM = 1000000;
  function rankPoints(scores, M) {
    const idx = []; for (let i = 0; i < M; i++) idx.push(i);
    idx.sort((a, b) => (scores[b] - scores[a]) || (a - b));
    const pts = new Array(M).fill(0);
    let r = 0;
    while (r < M) {
      let r2 = r; while (r2 + 1 < M && scores[idx[r2 + 1]] === scores[idx[r]]) r2++;
      const p = M + 1 - ((r + 1) + (r2 + 1)) / 2;
      for (let j = r; j <= r2; j++) pts[idx[j]] = p;
      r = r2 + 1;
    }
    return pts;
  }
  /* currentScores() 결과 → 자리별 순위 점수 */
  function points(S) {
    if (!S || !S.pos || S.pos.length !== 6 || !S.band || S.band.length !== 5) throw new RangeError('points: S={pos[6][10],band[5]} expected');
    return { pos: S.pos.map(s => rankPoints(s, 10)), band: rankPoints(S.band, 5) };
  }
  /* 내부 정수화(×2) 표와 히스토그램. pts 는 P.points(S) 의 순위 점수여야 한다(자리 1..10 · 조 1..5 의 반 단위 → ×2 가 정확한 정수) —
     원시 점수 S·음수·반 단위가 아닌 값은 표 범위(0..SMAX) 밖 기록이 조용히 사라지거나 반올림되므로 RangeError. */
  function ptab(pts) {
    const h2 = (v, hi) => { const x = +v * 2; if (!Number.isInteger(x) || x < 2 || x > hi) throw new RangeError('pts must be P.points(S) rank points (half steps: pos 1..10, band 1..5): ' + v); return x; };
    if (pts.pos.length !== 6 || pts.band.length !== 5) throw new RangeError('pts={pos[6][10],band[5]} expected');
    const P2 = [];
    for (let p = 0; p < 6; p++) {
      if (!pts.pos[p] || pts.pos[p].length !== 10) throw new RangeError('pts.pos[' + p + '] must have 10 entries');
      const row = new Int32Array(10); for (let d = 0; d < 10; d++) row[d] = h2(pts.pos[p][d], 20); P2.push(row);
    }
    const B2 = new Int32Array(5); for (let b = 0; b < 5; b++) B2[b] = h2(pts.band[b], 10);
    const SMAX = 130;
    let nh = new Float64Array(SMAX + 1); nh[0] = 1;
    for (let p = 0; p < 6; p++) {
      const nx = new Float64Array(SMAX + 1);
      for (let s = 0; s <= SMAX; s++) { const v = nh[s]; if (!v) continue; for (let d = 0; d < 10; d++) nx[s + P2[p][d]] += v; }
      nh = nx;
    }
    const th = new Float64Array(SMAX + 1);
    for (let s = 0; s <= SMAX; s++) { const v = nh[s]; if (!v) continue; for (let b = 0; b < 5; b++) th[s + B2[b]] += v; }
    // 접미 경우의 수 cnt[p][s] = 자리 p..5 로 점수 s 를 만드는 번호 수
    const cnt = []; for (let p = 0; p <= 6; p++) cnt.push(new Float64Array(SMAX + 1));
    cnt[6][0] = 1;
    for (let p = 5; p >= 0; p--) for (let s = 0; s <= SMAX; s++) { let v = 0; for (let d = 0; d < 10; d++) { const r = s - P2[p][d]; if (r >= 0) v += cnt[p + 1][r]; } cnt[p][s] = v; }
    return { P2, B2, nh, th, cnt, SMAX };
  }
  const PCACHE = new Map(), PCACHE_MAX = 8;      // pts 내용 기준(복제본도 적중) LRU
  function tab(pts) {
    if (!pts || !pts.pos || !pts.band) throw new RangeError('pts={pos[6][10],band[5]} expected');
    const key = JSON.stringify([pts.pos, pts.band]);
    let t = PCACHE.get(key);
    if (t) { PCACHE.delete(key); PCACHE.set(key, t); return t; }
    t = ptab(pts); PCACHE.set(key, t);
    if (PCACHE.size > PCACHE_MAX) PCACHE.delete(PCACHE.keys().next().value);
    return t;
  }
  /* 입력 검증(조용한 절삭 없음): 번호 = 0..999999 정수 또는 1~6자리 숫자 문자열(앞 0 허용) → 6자리 문자열. 조 = 정수 1..5(숫자 문자열 허용). */
  function digits6(num) {
    if (typeof num === 'number') { if (!Number.isInteger(num) || num < 0 || num > 999999) throw new RangeError('pension number must be an integer 0..999999: ' + num); return String(num).padStart(6, '0'); }
    const s = String(num).trim();
    if (!/^\d{1,6}$/.test(s)) throw new RangeError('pension number must be 6 digits: ' + num);
    return s.padStart(6, '0');
  }
  function bandNo(band) { const b = +band; if (!Number.isInteger(b) || b < 1 || b > 5) throw new RangeError('band must be an integer 1..5: ' + band); return b; }
  function numScore2(T, ds) { let s = 0; for (let p = 0; p < 6; p++) s += T.P2[p][ds.charCodeAt(p) - 48]; return s; }
  function prank(pts, band, num) {
    const T = tab(pts), ds = digits6(num); band = bandNo(band);
    const ns = numScore2(T, ds), ts = ns + T.B2[band - 1];
    let g = 0; for (let s = ts + 1; s <= T.SMAX; s++) g += T.th[s];
    const best = g + 1, worst = g + T.th[ts], mid = (best + worst) / 2;
    let gn = 0; for (let s = ns + 1; s <= T.SMAX; s++) gn += T.nh[s];
    const nb = gn + 1, nw = gn + T.nh[ns], nm = (nb + nw) / 2;
    return { best, worst, mid, of: PN, pct: (mid - 0.5) / PN, s: ts / 2,
      numRank: { best: nb, worst: nw, mid: nm, of: PM, pct: (nm - 0.5) / PM, s: ns / 2 } };
  }
  function unrank(T, target, j) {
    let rem = target, out = '';
    for (let p = 0; p < 6; p++) {
      const row = T.P2[p], nxt = T.cnt[p + 1];
      let d = 0;
      for (; d < 10; d++) { const r = rem - row[d]; if (r < 0) continue; const c = nxt[r]; if (j < c) { rem = r; break; } j -= c; }
      if (d === 10) throw new Error('unrank: inconsistent');
      out += d;
    }
    return out;
  }
  function ppage(pts, offset, k) {
    const T = tab(pts);
    offset = Math.max(0, Math.floor(offset || 0)); k = Math.max(0, Math.floor(k || 0));
    if (offset >= PN || k === 0) return [];
    k = Math.min(k, PN - offset);
    const out = []; let acc = 0;
    for (let ts = T.SMAX; ts >= 0 && out.length < k; ts--) {
      const c = T.th[ts]; if (!c) continue;
      if (acc + c <= offset) { acc += c; continue; }
      let skip = Math.max(0, offset - acc); acc += c;
      for (let b = 0; b < 5 && out.length < k; b++) {
        const nsum = ts - T.B2[b]; if (nsum < 0 || nsum > T.SMAX) continue;
        const cb = T.nh[nsum]; if (!cb) continue;
        if (skip >= cb) { skip -= cb; continue; }
        for (let j = skip; j < cb && out.length < k; j++) out.push({ r: offset + out.length + 1, band: b + 1, num: unrank(T, nsum, j), s: ts / 2 });
        skip = 0;
      }
    }
    return out;
  }
  /* 탐색 순서(P.page)상의 정확한 위치(1-based): #{점수 >} + #{같은 점수 · 앞 조} + #{같은 조 · 같은 자리점수합 · 번호 더 작음} + 1 */
  function ppos(pts, band, num) {
    const T = tab(pts), ds = digits6(num); band = bandNo(band);
    const ns = numScore2(T, ds), ts = ns + T.B2[band - 1];
    let g = 0; for (let s = ts + 1; s <= T.SMAX; s++) g += T.th[s];
    for (let b = 0; b < band - 1; b++) { const v = ts - T.B2[b]; if (v >= 0 && v <= T.SMAX) g += T.nh[v]; }
    let rem = ns;                                                  // 같은 조: 자리점수합 = ns 인 번호 중 ds 보다 작은 번호 수
    for (let p = 0; p < 6; p++) {
      const row = T.P2[p], nxt = T.cnt[p + 1], dp = ds.charCodeAt(p) - 48;
      for (let d = 0; d < dp; d++) { const r = rem - row[d]; if (r >= 0) g += nxt[r]; }
      rem -= row[dp];
    }
    return g + 1;
  }
  function pindex(band, num) { return (bandNo(band) - 1) * PM + (+digits6(num)); }
  function pticket(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= PN) throw new RangeError('ticket index out of range: ' + idx);
    return { band: Math.floor(idx / PM) + 1, num: String(idx % PM).padStart(6, '0') };
  }
  function pscore(pts, band, num) { const T = tab(pts), b = bandNo(band); return (numScore2(T, digits6(num)) + T.B2[b - 1]) / 2; }

  RC.pension = { N: PN, NUM: PM, points, rank: prank, page: ppage, pos: ppos, index: pindex, ticket: pticket, score: pscore };

  G.RANKCORE = RC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
