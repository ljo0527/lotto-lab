/* rank-worker.js — 무한 순위 탐색기의 전용 워커 (PLAN3 §5, Sonnet-2 소유)
   classic worker (type:'module' 아님) — importScripts 로 rank-core.js(RANKCORE, Fable 소유)를 읽는다.
   무거운 계산(로또 튜플 표 생성 · 임의 순위 페이지 · CSV 생성)은 전부 여기서 돈다 — 메인 스레드는 절대 막지 않는다.

   ── 메시지 프로토콜 (문서 = 진실. 바뀌면 rank-explorer.js 도 같이 고칠 것) ──
   main → worker : { id, cmd, ...args }
     cmd 목록:
       'ensureLotto'                                         → 로또 튜플 표 생성/재사용(회차 무관, 1회)
       'page'    { game, round, model, offset, limit,
                   params, filter, excludeWon,                // 로또
                   ticketParams }                              // 연금(= params 와 동일 자리, 이름만 통일)
       'rankOf'  { game, round, models:[...], combo|ticket, params, excludeWon }
       'findExact' { game, round, model, combo|ticket, params, excludeWon }  → 동점 구간 안에서 그 조합/티켓의 "정확한" 줄 번호
       'exportCsv' { game, round, model, topN, params, filter, excludeWon }
       'cancel'  { targetId }                                  // 다른 요청의 id 를 취소 신호

   ── excludeWon 은 popf 전용(중요) ──
   excludeWon 은 model==='popf' 일 때만 실제로 적용된다 — 이 워커가 다른 모델(pop/hot/cold/연금)에 대해서는
   호출자가 뭘 보내든 항상 빈 배열로 무시한다(2026-09-25 교차검증에서 pop 에도 새어 들어가던 버그를 여기서 막음).
   filter 도 마찬가지로 model 로만 결정한다(model==='popf' → true) — 호출자의 filter 인자는 무시.
   worker → main :
     { id, type:'progress', frac, stage }         — 0 회 이상, frac 0..1
     { id, type:'result', data }                    — 성공 종료(정확히 1회)
     { id, type:'error', message }                  — 실패 종료
     { id, type:'cancelled' }                        — 취소로 종료(ensureLotto/exportCsv 같은 자체 청크 루프만 해당)
     { type:'ready', version }                       — 워커 기동 + rank-core.js 로드 성공(1회)
     { type:'core-error', message }                  — rank-core.js 로드 실패(치명적, 이후 모든 cmd 는 error 응답)

   ── 취소의 한계(정직하게) ──
   pagePop/pageAdditive/rankPop/rankAdditive/P.rank/P.page 는 rank-core.js 의 불투명한 동기 함수라
   그 "내부"를 중간에 멈출 수 없다. 이 워커가 직접 반복하는 두 작업(ensureLotto 의 진행률 콜백,
   exportCsv 의 오프셋 청크 루프)만 진짜 협조적 취소가 된다. 그 외 요청은 "이미 보낸 뒤에 취소" ==
   메인 스레드가 결과를 버리는 방식(별도 처리 없음, main 쪽 책임)이 된다 — 워커는 계속 응답을 보내되
   cancelled 로 표시된 id 는 main 이 무시한다. 어느 쪽이든 메인 스레드(=UI)는 절대 멈추지 않는다. */
'use strict';

var CORE_OK = false;
try {
  importScripts('./rank-core.js');
  if (typeof RANKCORE === 'undefined' || !RANKCORE.lotto || !RANKCORE.pension) {
    throw new Error('RANKCORE 전역이 없거나 lotto/pension 이 없습니다');
  }
  CORE_OK = true;
} catch (e) {
  postMessage({ type: 'core-error', message: '코어 로딩 실패: ' + (e && e.message || e) });
}

/* ── 공용 ── */
var cancelled = new Set();               // 취소 요청된 id
function send(id, type, extra) {
  var m = { id: id, type: type };
  if (extra) for (var k in extra) m[k] = extra[k];
  postMessage(m);
}
function progress(id, frac, stage) { send(id, 'progress', { frac: frac, stage: stage || '' }); }
function ok(id, data) { send(id, 'result', { data: data }); }
function fail(id, err) { send(id, 'error', { message: String(err && err.message || err) }); }
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); } // 이벤트 루프에 양보(취소 메시지 처리 기회)

function CancelledError() { this.message = '취소됨'; this.__cancelled = true; }
CancelledError.prototype = Object.create(Error.prototype);

/* ── 로또: 튜플 표 캐시(회차 무관 — 한 번만 만들고 재사용) ── */
var lottoTable = null;        // RANKCORE.lotto.buildTable() 결과 + totalN/totalF 부가
var lottoBuilding = null;     // 진행 중인 build 의 Promise(중복 빌드 방지)

function sumU32(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

function ensureLottoTable(id) {
  if (lottoTable) return Promise.resolve({ table: lottoTable, cached: true });
  if (lottoBuilding) return lottoBuilding.then(function (t) { return { table: t, cached: true }; });
  var t0 = Date.now();
  lottoBuilding = Promise.resolve().then(function () {
    var L = RANKCORE.lotto;
    var T = L.buildTable({
      progress: function (frac) {
        if (id != null && cancelled.has(id)) throw new CancelledError();
        if (id != null) progress(id, frac, 'buildTable');
      }
    });
    return Promise.resolve(T);
  }).then(function (T) {
    T.totalN = T.count ? sumU32(T.count) : RANKCORE.lotto.N;
    T.totalF = T.countF ? sumU32(T.countF) : 0;
    T.tookMs = Date.now() - t0;
    lottoTable = T;
    lottoBuilding = null;
    return T;
  }).catch(function (e) {
    lottoBuilding = null;
    throw e;
  });
  return lottoBuilding.then(function (T) { return { table: T, cached: false, tookMs: T.tookMs }; });
}

/* ── 로또: 모델별 핸들러 ──
   excludeWon/filter 는 여기서 model 하나로만 결정한다 — 호출자가 무엇을 보내든 popf 가 아니면 항상 무시.
   그래야 rankOf 처럼 여러 모델을 한 번에 계산할 때 pop 에 excludeWon 이 새어 들어가지 않는다. */
function effEx(model, excludeWon) { return model === 'popf' ? (excludeWon || []) : []; }
function effFilter(model) { return model === 'popf'; }

function lottoDenom(T, model, excludeWon) {
  if (model !== 'popf') return RANKCORE.lotto.N;
  var L = RANKCORE.lotto, ex = effEx(model, excludeWon);
  if (!ex.length) return T.totalF;
  var excludedPassing = 0;
  for (var i = 0; i < ex.length; i++) { if (L.filterPass(ex[i])) excludedPassing++; }
  return T.totalF - excludedPassing;
}
function lottoWeights(kind, arr46) { return RANKCORE.lotto.logw(kind, arr46); }

function lottoPage(T, model, params, offset, limit, excludeWon) {
  var L = RANKCORE.lotto;
  if (model === 'pop' || model === 'popf') {
    var rows = L.pagePop(params.pop, T, offset, limit, { filter: effFilter(model), excludeWon: effEx(model, excludeWon) });
    return { rows: rows.map(function (x) { return { r: x.r, c: x.c, score: x.z }; }), of: lottoDenom(T, model, excludeWon) };
  }
  var logw = lottoWeights(model, params[model]);
  var rows2 = L.pageAdditive(logw, offset, limit);
  return { rows: rows2.map(function (x) { return { r: x.r, c: x.c, score: x.s }; }), of: RANKCORE.lotto.N };
}
function lottoRankOne(T, model, params, combo, excludeWon) {
  var L = RANKCORE.lotto;
  if (model === 'pop' || model === 'popf') {
    return L.rankPop(params.pop, T, combo, { filter: effFilter(model), excludeWon: effEx(model, excludeWon) });
  }
  var logw = lottoWeights(model, params[model]);
  return L.rankAdditive(logw, combo);
}

/* ── 연금: 모델/점수 캐시(회차+모델 키로 points() 결과 재사용) ── */
var pensionPtsCache = new Map(); // key: round+'|'+model → {pts,band}
function pensionKey(round, model) { return round + '|' + model; }
function resolveModel(modelKey, params) { return modelKey === 'site' ? (params.site || 'freq') : modelKey; }
function pensionPoints(round, modelKey, params) {
  var real = resolveModel(modelKey, params);
  var key = pensionKey(round, real);
  var hit = pensionPtsCache.get(key);
  if (hit) return hit;
  var S = params.S && params.S[real];
  if (!S) throw new Error('연금 모델 점수 없음: ' + real);
  var pb = RANKCORE.pension.points(S);
  pensionPtsCache.set(key, pb);
  return pb;
}

/* ── cmd: page ── */
function cmdPage(id, m) {
  var t0 = Date.now();
  if (m.game === 'lotto') {
    return ensureLottoTable(id).then(function (r) {
      if (cancelled.has(id)) throw new CancelledError();
      var out = lottoPage(r.table, m.model, m.params, m.offset | 0, m.limit || 20, m.excludeWon);
      ok(id, { rows: out.rows, of: out.of, model: m.model, round: m.round, tookMs: Date.now() - t0, tableTookMs: r.tookMs || 0 });
    });
  }
  if (m.game === 'pension') {
    var pb = pensionPoints(m.round, m.model, m.params);
    var rows = RANKCORE.pension.page(pb, m.offset | 0, m.limit || 20);
    ok(id, { rows: rows, of: RANKCORE.pension.N, model: m.model, round: m.round, tookMs: Date.now() - t0 });
    return Promise.resolve();
  }
  throw new Error('알 수 없는 game: ' + m.game);
}

/* ── cmd: rankOf (여러 모델 한 번에) ── */
function cmdRankOf(id, m) {
  var t0 = Date.now();
  var results = {};
  if (m.game === 'lotto') {
    return ensureLottoTable(id).then(function (r) {
      if (cancelled.has(id)) throw new CancelledError();
      (m.models || []).forEach(function (mk) {
        try { results[mk] = lottoRankOne(r.table, mk, m.params, m.combo, m.excludeWon); }
        catch (e) { results[mk] = { error: String(e && e.message || e) }; }
      });
      ok(id, { results: results, tookMs: Date.now() - t0 });
    });
  }
  if (m.game === 'pension') {
    (m.models || []).forEach(function (mk) {
      try {
        var pb = pensionPoints(m.round, mk, m.params);
        results[mk] = RANKCORE.pension.rank(pb, m.ticket.band, m.ticket.num);
      } catch (e) { results[mk] = { error: String(e && e.message || e) }; }
    });
    ok(id, { results: results, tookMs: Date.now() - t0 });
    return Promise.resolve();
  }
  throw new Error('알 수 없는 game: ' + m.game);
}

/* ── cmd: findExact — 동점 구간 안에서 실제 그 조합/티켓의 "정확한" 줄 번호를 찾는다 ──
   rankPop/rankAdditive/P.rank 는 [best,worst] 동점 구간만 준다(동점이면 수만~수십만 개일 수 있음 — 2026-09-25
   교차검증에서 확인). rank-core.js 에 나중에 posPop/posAdditive/pension.pos(정확한 위치) 가 생기면 그걸 우선
   쓰고, 없으면 [best,worst] 구간을 페이지로 훑어(청크 20,000 · 최대 400,000개) 실제 일치하는 줄을 찾는다
   (Opus-A 교차검증 harness 의 findPos 와 같은 상수 — 검증된 값). 못 찾으면 approx:true 로 best 를 돌려준다. */
var FIND_CHUNK = 20000, FIND_CAP = 400000;
function cmdFindExact(id, m) {
  var t0 = Date.now();
  if (m.game === 'lotto') {
    return ensureLottoTable(id).then(function (r) {
      if (cancelled.has(id)) throw new CancelledError();
      var T = r.table, L = RANKCORE.lotto;
      var rr = lottoRankOne(T, m.model, m.params, m.combo, m.excludeWon);
      if (rr.excluded) { ok(id, rr); return; }
      if (rr.best === rr.worst) { ok(id, withR(rr, rr.best, t0)); return; }
      if (typeof L.posPop === 'function' && (m.model === 'pop' || m.model === 'popf')) {
        var r1 = L.posPop(m.params.pop, T, m.combo, { filter: effFilter(m.model), excludeWon: effEx(m.model, m.excludeWon) });
        ok(id, withR(rr, r1, t0)); return;
      }
      if (typeof L.posAdditive === 'function' && (m.model === 'hot' || m.model === 'cold')) {
        var r2 = L.posAdditive(lottoWeights(m.model, m.params[m.model]), m.combo);
        ok(id, withR(rr, r2, t0)); return;
      }
      scanLottoExact(id, T, m, rr, t0);
    });
  }
  if (m.game === 'pension') {
    var pb = pensionPoints(m.round, m.model, m.params);
    var rr2 = RANKCORE.pension.rank(pb, m.ticket.band, m.ticket.num);
    if (rr2.best === rr2.worst) { ok(id, withR(rr2, rr2.best, t0)); return Promise.resolve(); }
    if (typeof RANKCORE.pension.pos === 'function') {
      var r3 = RANKCORE.pension.pos(pb, m.ticket.band, m.ticket.num);
      ok(id, withR(rr2, r3, t0)); return Promise.resolve();
    }
    scanPensionExact(id, pb, m, rr2, t0);
    return Promise.resolve();
  }
  throw new Error('알 수 없는 game: ' + m.game);
}
function withR(rr, r, t0) { return { best: rr.best, worst: rr.worst, mid: rr.mid, of: rr.of, pct: rr.pct, r: r, tookMs: Date.now() - t0 }; }
function scanLottoExact(id, T, m, rr, t0) {
  var target = m.combo.join(',');
  var lo = rr.best - 1, hi = Math.min(rr.worst, rr.best - 1 + FIND_CAP);
  var off = lo;
  function step() {
    if (cancelled.has(id)) { send(id, 'cancelled'); return; }
    if (off >= hi) { var o = withR(rr, null, t0); o.approx = true; ok(id, o); return; }
    var limit = Math.min(FIND_CHUNK, hi - off);
    var out = lottoPage(T, m.model, m.params, off, limit, m.excludeWon);
    for (var i = 0; i < out.rows.length; i++) {
      if (out.rows[i].c.join(',') === target) { ok(id, withR(rr, out.rows[i].r, t0)); return; }
    }
    if (!out.rows.length) { var o2 = withR(rr, null, t0); o2.approx = true; ok(id, o2); return; }
    off += out.rows.length;
    progress(id, (off - lo) / (hi - lo), 'findExact');
    tick().then(step);
  }
  step();
}
function scanPensionExact(id, pb, m, rr, t0) {
  var target = m.ticket.band + '|' + m.ticket.num;
  var lo = rr.best - 1, hi = Math.min(rr.worst, rr.best - 1 + FIND_CAP);
  var off = lo;
  function step() {
    if (cancelled.has(id)) { send(id, 'cancelled'); return; }
    if (off >= hi) { var o = withR(rr, null, t0); o.approx = true; ok(id, o); return; }
    var limit = Math.min(FIND_CHUNK, hi - off);
    var rows = RANKCORE.pension.page(pb, off, limit);
    for (var i = 0; i < rows.length; i++) {
      if ((rows[i].band + '|' + rows[i].num) === target) { ok(id, withR(rr, rows[i].r, t0)); return; }
    }
    if (!rows.length) { var o2 = withR(rr, null, t0); o2.approx = true; ok(id, o2); return; }
    off += rows.length;
    progress(id, (off - lo) / (hi - lo), 'findExact');
    tick().then(step);
  }
  step();
}

/* ── cmd: exportCsv — 직접 청크 루프(진짜 취소·진행률) ──
   CSV_CHUNK_MIN 은 작은 topN(예 10,000)의 청크 크기(변경 없음). 큰 topN 은 topN/8 로 늘려
   청크 수를 줄인다 — rank-core.js 의 pageAdditive 힙 경로(offset+k≤50,000)는 캐시가 없어
   청크마다 전수(1패스)를 다시 훑고, 임의 offset 경로도 청크마다 구간을 다시 수집하므로
   청크 수가 곧 재계산 횟수다(offset 이 커질수록 개별 청크 비용도 커짐 — 힙 크기·수집 구간이
   growing). 청크를 줄이면(=한 청크당 더 많이) 총 재계산량이 줄어든다(실측 topN=100,000:
   4,000-줄 청크 25개 500ms → topN/8=12,500-줄 청크 8개 150ms, `.lab/perf/out/csv-repro.mjs`
   류 재현). 진행률·취소는 청크마다 그대로 유지(협조적 취소 간격만 조금 넓어짐, 여전히 수백 ms 내). */
var CSV_CHUNK_MIN = 4000;
function csvEscape(v) {
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function cmdExportCsv(id, m) {
  var t0 = Date.now();
  var topN = Math.max(1, Math.min(100000, m.topN | 0 || 1000));
  var csvChunk = Math.max(CSV_CHUNK_MIN, Math.ceil(topN / 8));
  var header, lines = [];
  var game = m.game, model = m.model;

  function pushLotto(rows) {
    rows.forEach(function (x) {
      lines.push([x.r, x.c.join('-'), x.score != null ? String(x.score) : ''].map(csvEscape).join(','));
    });
  }
  function pushPension(rows) {
    rows.forEach(function (x) {
      lines.push([x.r, x.band, x.num, x.s != null ? String(x.s) : ''].map(csvEscape).join(','));
    });
  }

  function loop(tableOrNull) {
    var got = 0;
    function step() {
      if (cancelled.has(id)) { send(id, 'cancelled'); return; }
      var limit = Math.min(csvChunk, topN - got);
      if (limit <= 0) {
        var bom = '﻿';
        var blob = new Blob([bom + header + '\n' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        var filename = 'rank-' + game + '-' + m.round + '-' + model + '-top' + topN + '.csv';
        ok(id, { blob: blob, filename: filename, rows: got, tookMs: Date.now() - t0 });
        return;
      }
      var got0 = got;
      if (game === 'lotto') {
        var out = lottoPage(tableOrNull, model, m.params, got, limit, m.excludeWon);
        pushLotto(out.rows);
        got += out.rows.length;
      } else {
        var pb = pensionPoints(m.round, model, m.params);
        var rows = RANKCORE.pension.page(pb, got, limit);
        pushPension(rows);
        got += rows.length;
      }
      if (got === got0) {                    // 더 줄 데이터가 없음(topN 이 전체 모집단보다 큰 경우) — 여기서 끝
        var bom0 = '﻿';
        var blob0 = new Blob([bom0 + header + '\n' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        var filename0 = 'rank-' + game + '-' + m.round + '-' + model + '-top' + topN + '.csv';
        ok(id, { blob: blob0, filename: filename0, rows: got, tookMs: Date.now() - t0 });
        return;
      }
      progress(id, got / topN, 'exportCsv');
      tick().then(step);
    }
    step();
  }

  if (game === 'lotto') {
    header = 'rank,combo,score';
    return ensureLottoTable(id).then(function (r) {
      if (cancelled.has(id)) { send(id, 'cancelled'); return; }
      loop(r.table);
    });
  }
  if (game === 'pension') {
    header = 'rank,band,num,score';
    loop(null);
    return Promise.resolve();
  }
  throw new Error('알 수 없는 game: ' + game);
}

/* ── 라우팅 ── */
onmessage = function (ev) {
  var m = ev.data || {};
  if (m.cmd === 'cancel') { cancelled.add(m.targetId); return; }
  if (!CORE_OK) { fail(m.id, 'rank-core.js 가 로드되지 않았습니다'); return; }
  var id = m.id;
  try {
    var p;
    if (m.cmd === 'ensureLotto') {
      p = ensureLottoTable(id).then(function (r) {
        var L = RANKCORE.lotto;
        ok(id, { K: r.table.K, N: L.N, totalF: r.table.totalF, tookMs: r.tookMs || 0, cached: !!r.cached });
      });
    } else if (m.cmd === 'page') {
      p = cmdPage(id, m);
    } else if (m.cmd === 'rankOf') {
      p = cmdRankOf(id, m);
    } else if (m.cmd === 'findExact') {
      p = cmdFindExact(id, m);
    } else if (m.cmd === 'exportCsv') {
      p = cmdExportCsv(id, m);
    } else {
      fail(id, '알 수 없는 cmd: ' + m.cmd);
      return;
    }
    Promise.resolve(p).catch(function (e) {
      if (e && e.__cancelled) { send(id, 'cancelled'); return; }
      fail(id, e);
    }).then(function(){ cancelled.delete(id); });
  } catch (e) {
    if (e && e.__cancelled) { send(id, 'cancelled'); } else { fail(id, e); }
  }
};

if (CORE_OK) postMessage({ type: 'ready', version: RANKCORE.version });
