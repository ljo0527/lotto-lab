/* rank-explorer.js — 무한 순위 탐색기 (PLAN3 §5, Sonnet-2 소유)
   #explorer 안에만 그린다. 전역은 window.RANKEXPLORER 하나뿐(다른 전역 선언 없음).
   무거운 계산은 전부 rank-worker.js(importScripts rank-core.js)에서 — 메인 스레드는 막지 않는다.
   classic <script defer> 로 로드(모듈 아님), rank-core.js 다음 순서. */
(function () {
  "use strict";

  var MOUNT_ID = "explorer";
  var LIMIT = 20;
  var HEAVY_OFFSET = 20000;          // 이 이상 점프하면 "무거운 작업"으로 취급
  var NARROW = 700;                  // 이 아래 폭이면 모바일 경고 대상

  /* 모델 "키" 목록(=프로토콜)은 여기 고정. 표시용 "이름"은 brief/rank-*.json 의 models[] 를 우선 쓰고
     (2026-09-25 교차검증: 하드코딩한 연금 cold/gap 이름이 실제와 달랐음), 그 파일이 아직 없거나 그 키가
     없을 때만 아래 fallbackNames 로 대체한다. */
  var GAMES = {
    lotto: {
      label: "로또",
      of: 8145060,
      modelKeys: ["pop", "popf", "hot", "cold"],
      fallbackNames: { pop: "분배 모델(추천 순서)", popf: "분배 모델 + 주간 필터", hot: "빈도 모델(많이 나온 번호)", cold: "미출현 모델(오래 안 나온 번호)" },
      paramsFile: "./brief/rank-params-lotto.json",
      dataFile: "./brief/rank-lotto.json"
    },
    pension: {
      label: "연금복권",
      of: 5000000,
      modelKeys: ["site", "freq", "cold", "recent", "gap", "rand"],
      fallbackNames: { site: "사이트 설정 모델", freq: "빈도 모델", cold: "미출현 모델", recent: "최근 가중 모델", gap: "공백 모델", rand: "무작위 기준" },
      paramsFile: "./brief/rank-params-pension.json",
      dataFile: "./brief/rank-pension.json"
    }
  };

  /* ── DOM 헬퍼 ── */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function fmt(n) { return (n == null || isNaN(n)) ? "-" : Number(n).toLocaleString("ko-KR"); }
  function pct1(p) { return (p == null || isNaN(p)) ? "-" : (p * 100).toFixed(2) + "%"; }
  function parseNums(s) { return (s || "").split(/[^0-9]+/).filter(Boolean).map(Number); }

  /* ── JSON 로드(없으면 null, 던지지 않음) ── */
  function loadJSON(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ══════════════════ Explorer 생성자 ══════════════════ */
  function Explorer(root) {
    this.root = root;
    this.game = (location.hash === "#pension") ? "pension" : "lotto";
    this.model = null;
    this.round = null;
    this.offset = 0;
    this.of = null;
    this.rows = [];
    this.highlightR = null;
    this.data = { paramsLotto: null, paramsPension: null, rankLotto: null, rankPension: null };
    this.seq = 0;
    this.pending = new Map();          // id → {resolve, reject, onProgress}
    this.busyId = null;                // 취소 가능한 현재 작업 id
    this.warnedHeavy = false;          // 이번 세션에 모바일 경고를 이미 확인했는지
    this.worker = null;
    this.coreError = null;
    this._buildDOM();
    this._boot();
  }

  Explorer.prototype._boot = function () {
    var self = this;
    try {
      this.worker = new Worker("./rank-worker.js");
    } catch (e) {
      this._fatal("워커를 시작할 수 없습니다: " + (e && e.message || e));
      return;
    }
    this.worker.onmessage = function (ev) { self._onWorkerMessage(ev.data || {}); };
    this.worker.onerror = function (e) {
      self._fatal("워커 오류: " + (e && e.message || "알 수 없는 오류"));
    };
    Promise.all([
      loadJSON(GAMES.lotto.paramsFile), loadJSON(GAMES.pension.paramsFile),
      loadJSON(GAMES.lotto.dataFile), loadJSON(GAMES.pension.dataFile)
    ]).then(function (r) {
      self.data.paramsLotto = r[0]; self.data.paramsPension = r[1];
      self.data.rankLotto = r[2]; self.data.rankPension = r[3];
      self._afterData();
    });
  };

  Explorer.prototype._fatal = function (msg) {
    this.statusEl.hidden = false;
    this.statusEl.className = "rankx-status rankx-status-err";
    this.statusEl.textContent = msg;
    this.listWrap.hidden = true;
  };

  Explorer.prototype._afterData = function () {
    var P = this.data["params" + cap(this.game)];
    if (!P || !P.rows || !Object.keys(P.rows).length) {
      this._fatal("아직 계산 전입니다 — brief/rank-params-" + this.game + ".json 이 아직 없습니다. 파이프라인이 처음 도는 뒤 다시 확인해 주세요.");
      return;
    }
    this.statusEl.hidden = true;
    this.listWrap.hidden = false;
    this._syncGameUI();
    this._syncRoundOptions();
    this.model = GAMES[this.game].modelKeys[0];
    this.modelSel.value = this.model;
    this._updateModelNote();
    this.round = this._defaultRound();
    this.roundSel.value = String(this.round);
    this._loadPage(0);
  };

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* 표시용 모델 이름 — brief/rank-*.json 의 models[] 우선, 없으면 fallbackNames, 그마저 없으면 key 그대로. */
  Explorer.prototype._modelName = function (game, key) {
    var d = this.data["rank" + cap(game)];
    if (d && d.models) {
      for (var i = 0; i < d.models.length; i++) if (d.models[i].key === key) return d.models[i].name || key;
    }
    return (GAMES[game].fallbackNames && GAMES[game].fallbackNames[key]) || key;
  };
  /* 모델 설명 — brief/rank-*.json 의 models[].desc 만 있음(고정 대체 문구 없음, 데이터 없으면 빈 문자열). */
  Explorer.prototype._modelDesc = function (game, key) {
    var d = this.data["rank" + cap(game)];
    if (d && d.models) {
      for (var i = 0; i < d.models.length; i++) if (d.models[i].key === key) return d.models[i].desc || "";
    }
    return "";
  };
  Explorer.prototype._updateModelNote = function () {
    if (!this.modelNote) return;
    this.modelNote.textContent = this.model ? this._modelDesc(this.game, this.model) : "";
  };

  /* ── 회차 목록/기본값 ── */
  Explorer.prototype._paramsRows = function (game) {
    var P = this.data["params" + cap(game)];
    return (P && P.rows) || {};
  };
  Explorer.prototype._roundList = function () {
    return Object.keys(this._paramsRows(this.game)).map(Number).sort(function (a, b) { return a - b; });
  };
  Explorer.prototype._defaultRound = function () {
    var list = this._roundList();
    return list.length ? list[list.length - 1] : null; // params 는 from..latest+1 전부 → 마지막 = 다음 회차
  };
  Explorer.prototype._latest = function () {
    var d = this.data["rank" + cap(this.game)];
    return d ? d.latest : null;
  };
  Explorer.prototype._roundParams = function (round) {
    return this._paramsRows(this.game)[String(round)] || null;
  };
  Explorer.prototype._roundRow = function (round) {
    var d = this.data["rank" + cap(this.game)];
    if (!d || !d.rows) return null;
    for (var i = 0; i < d.rows.length; i++) if (d.rows[i].round === round) return d.rows[i];
    return null;
  };
  /* popf 의 «R 이전 1등 조합 제외»는 로또 1회부터 전부를 봐야 한다(rank-lotto.json 의 rows 는 보통 from 이후만
     담겨 있어 그것만 쓰면 이른 회차에서 과소 제외됨 — 2026-09-25 교차검증에서 확인, .lab/out-opusA/xv/run1.json).
     단일 출처: rank-lotto.json 최상위 wonIdx(1회~latest, RANKCORE.lotto.index() 값, STATUS-track.md 참고) —
     wonIdx[i] = (i+1)회 1등 조합의 index. wonIdx.slice(0, round-1) 를 RANKCORE.lotto.combo() 로 복원하면
     추적기(rank-track.mjs)와 완전히 같은 목록이 된다(교차검증 confirm() 243/243 일치) — lotto-history.json 은
     쓰지 않는다(추가 fetch·페이지 계약 의존을 없애고 단일 출처로 승격, 2026-09-26). 자료가 빠진 회차는
     wonIdx 안에서 null 로 저장되므로 건너뛴다. */
  Explorer.prototype._excludeWon = function (round) {
    var rl = this.data.rankLotto;
    var idx = rl && rl.wonIdx;
    if (!idx || !idx.length) return [];
    var n = Math.max(0, Math.min(idx.length, round - 1));
    var out = [];
    for (var i = 0; i < n; i++) {
      if (idx[i] != null) out.push(RANKCORE.lotto.combo(idx[i]));
    }
    return out;
  };

  /* ══════════════════ DOM 구성 ══════════════════ */
  Explorer.prototype._buildDOM = function () {
    var root = this.root;
    root.innerHTML = "";
    root.appendChild(this._style());

    var wrap = el("div", "rankx");
    wrap.appendChild(el("h2", "rankx-h2", "무한 순위 탐색기"));
    wrap.appendChild(el("p", "rankx-note",
      "추첨이 공정하면 모든 조합이 똑같은 확률입니다. 아래 순서는 각 모델이 매긴 <b>추천 순서</b>일 뿐, " +
      "맞을 가능성 순서가 아닙니다. 과거 당첨이 몇 위였는지의 분포·우연 기준선은 위쪽 표·차트를 보세요."));

    /* 상태(진행률/에러/모바일 경고) */
    this.statusEl = el("div", "rankx-status", "");
    this.statusEl.hidden = true;
    this.statusEl.setAttribute("aria-live", "polite");
    this.statusEl.setAttribute("role", "status");
    wrap.appendChild(this.statusEl);

    /* 선택 컨트롤 */
    var ctl = el("div", "rankx-controls");
    var self = this;

    var gSel = el("select", "rankx-sel");
    Object.keys(GAMES).forEach(function (k) { var o = el("option", null, GAMES[k].label); o.value = k; gSel.appendChild(o); });
    gSel.value = this.game;
    gSel.addEventListener("change", function () { self._onGameChange(gSel.value); });
    ctl.appendChild(labelWrap("게임", gSel));
    this.gameSel = gSel;

    var mSel = el("select", "rankx-sel");
    mSel.addEventListener("change", function () { self._onModelChange(mSel.value); });
    ctl.appendChild(labelWrap("모델", mSel));
    this.modelSel = mSel;

    var rSel = el("select", "rankx-sel");
    rSel.addEventListener("change", function () { self._onRoundChange(+rSel.value); });
    ctl.appendChild(labelWrap("회차", rSel));
    this.roundSel = rSel;

    wrap.appendChild(ctl);
    this.modelNote = el("p", "rankx-note rankx-model-note", "");
    wrap.appendChild(this.modelNote);
    this.roundNote = el("p", "rankx-note rankx-round-note", "");
    wrap.appendChild(this.roundNote);

    /* 목록 */
    var listWrap = el("div", "rankx-listwrap");
    var table = el("table", "rankx-table");
    this.theadRow = el("tr");
    table.appendChild(el("thead", null)).appendChild(this.theadRow);
    this.tbody = el("tbody");
    table.appendChild(this.tbody);
    listWrap.appendChild(table);

    var pager = el("div", "rankx-pager");
    var prevBtn = el("button", "rankx-btn", "◀ 이전");
    var nextBtn = el("button", "rankx-btn", "다음 ▶");
    prevBtn.addEventListener("click", function () { self._loadPage(Math.max(0, self.offset - LIMIT)); });
    nextBtn.addEventListener("click", function () { self._loadPage(self.offset + LIMIT); });
    this.pagerInfo = el("span", "rankx-pager-info", "");
    pager.appendChild(prevBtn); pager.appendChild(this.pagerInfo); pager.appendChild(nextBtn);
    listWrap.appendChild(pager);
    this.prevBtn = prevBtn; this.nextBtn = nextBtn;

    /* 이동 컨트롤 */
    var jump = el("div", "rankx-jump");
    var jumpN = el("input", "rankx-input"); jumpN.type = "number"; jumpN.min = "1"; jumpN.placeholder = "예: 12345";
    var jumpGo = el("button", "rankx-btn", "N위로 이동");
    jumpGo.addEventListener("click", function () {
      var n = parseInt(jumpN.value, 10);
      if (!n || n < 1) { self._toast("1 이상의 순위를 입력하세요."); return; }
      self._loadPage(n - 1);
    });
    jump.appendChild(labelWrap("이동할 순위", jumpN)); jump.appendChild(jumpGo);
    var winBtn = el("button", "rankx-btn rankx-btn-2", "당첨번호 위치로 이동");
    winBtn.hidden = true;
    winBtn.addEventListener("click", function () { self._jumpToWinner(); });
    jump.appendChild(winBtn);
    listWrap.appendChild(jump);
    this.jumpN = jumpN; this.winBtn = winBtn;

    wrap.appendChild(listWrap);
    this.listWrap = listWrap;

    /* 내 번호 순위 */
    var mine = el("div", "rankx-card");
    mine.appendChild(el("h3", "rankx-h3", "내 번호 순위"));
    mine.appendChild(el("p", "rankx-note", "선택한 회차·모든 모델 기준으로 내 번호의 순위·백분위를 보여줍니다(참고용 — 확률과 무관)."));
    var mineRow = el("div", "rankx-controls");
    var lottoIn = el("input", "rankx-input rankx-input-wide"); lottoIn.type = "text"; lottoIn.placeholder = "예: 1,7,13,22,31,45";
    var bandSel = el("select", "rankx-sel"); [1, 2, 3, 4, 5].forEach(function (b) { var o = el("option", null, b + "조"); o.value = b; bandSel.appendChild(o); });
    var numIn = el("input", "rankx-input"); numIn.type = "text"; numIn.placeholder = "6자리 예: 012345"; numIn.maxLength = 6;
    var mineGo = el("button", "rankx-btn", "조회");
    mineRow.appendChild(labelWrap("로또 번호 6개", lottoIn));
    mineRow.appendChild(labelWrap("조", bandSel));
    mineRow.appendChild(labelWrap("연금 번호 6자리", numIn));
    mineRow.appendChild(mineGo);
    mine.appendChild(mineRow);
    this.mineResult = el("div", "rankx-mine-result");
    this.mineResult.setAttribute("aria-live", "polite");
    mine.appendChild(this.mineResult);
    wrap.appendChild(mine);
    this.lottoIn = lottoIn; this.bandSel = bandSel; this.numIn = numIn;
    mineGo.addEventListener("click", function () { self._lookupMine(); });

    /* CSV 내보내기 */
    var exp = el("div", "rankx-card");
    exp.appendChild(el("h3", "rankx-h3", "상위 N개 CSV 내보내기"));
    var expRow = el("div", "rankx-controls");
    var expN = el("input", "rankx-input"); expN.type = "number"; expN.min = "1"; expN.max = "100000"; expN.value = "1000";
    var expGo = el("button", "rankx-btn", "CSV 내보내기");
    var expCancel = el("button", "rankx-btn rankx-btn-2", "취소"); expCancel.hidden = true;
    expRow.appendChild(labelWrap("N(≤100,000)", expN)); expRow.appendChild(expGo); expRow.appendChild(expCancel);
    exp.appendChild(expRow);
    this.expProgress = el("div", "rankx-progress"); this.expProgress.hidden = true;
    this.expProgress.setAttribute("aria-live", "polite");
    this.expBar = el("div", "rankx-progress-bar"); this.expProgress.appendChild(this.expBar);
    exp.appendChild(this.expProgress);
    wrap.appendChild(exp);
    this.expN = expN; this.expGo = expGo; this.expCancel = expCancel;
    expGo.addEventListener("click", function () { self._exportCsv(); });
    expCancel.addEventListener("click", function () { self._cancelBusy(); });

    root.appendChild(wrap);
    this._syncGameUI();
  };

  function labelWrap(text, control) {
    var l = el("label", "rankx-label");
    l.appendChild(el("span", null, text));
    l.appendChild(control);
    return l;
  }

  Explorer.prototype._style = function () {
    var s = el("style", null,
      ".rankx{font:14px/1.5 var(--f-body,system-ui,sans-serif);color:var(--ink,#16302B)}" +
      ".rankx-h2{font-size:17px;font-weight:800;margin:0 0 6px}" +
      ".rankx-h3{font-size:14px;font-weight:800;margin:0 0 8px}" +
      ".rankx-note{font-size:12px;color:var(--ink-60,rgba(22,48,43,.6));margin:0 0 10px}" +
      ".rankx-status{padding:10px 12px;border:1.5px solid var(--ink,#16302B);background:var(--paper-2,#F7F8F5);margin-bottom:10px;font-size:13px}" +
      ".rankx-status-err{border-color:var(--sig,#B0281A);color:var(--sig,#B0281A)}" +
      ".rankx-status-warn{border-color:var(--b-yellow,#FBC400)}" +
      ".rankx-status-actions{margin-top:8px;display:flex;gap:8px}" +
      ".rankx-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:8px}" +
      ".rankx-label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rankx-sel,.rankx-input{font:600 13px var(--f-mono,monospace);padding:6px 8px;border:1.5px solid var(--ink,#16302B);" +
      "background:var(--paper-2,#F7F8F5);color:var(--ink,#16302B);border-radius:2px;min-height:44px;box-sizing:border-box}" +
      ".rankx-input{width:90px}.rankx-input-wide{width:160px}" +
      ".rankx-btn{font:700 12.5px var(--f-body,system-ui,sans-serif);color:var(--ink,#16302B);background:var(--paper-2,#F7F8F5);" +
      "border:1.5px solid var(--ink,#16302B);padding:7px 12px;cursor:pointer;border-radius:2px;min-height:44px;box-sizing:border-box}" +
      ".rankx-btn:hover{background:var(--ink,#16302B);color:var(--paper,#EEF0EB)}" +
      ".rankx-btn:disabled{opacity:.4;cursor:not-allowed}" +
      ".rankx-btn-2{border-style:dashed}" +
      ".rankx-round-note{margin-top:-2px}" +
      ".rankx-listwrap{border:1.5px solid var(--ink,#16302B);background:var(--paper-2,#F7F8F5);padding:10px;margin-bottom:14px;overflow-x:auto}" +
      ".rankx-table{border-collapse:collapse;width:100%;font-size:12.5px}" +
      ".rankx-table th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-60,rgba(22,48,43,.6));padding:4px 6px;border-bottom:1px solid var(--ink-12,rgba(22,48,43,.12))}" +
      ".rankx-table td{padding:5px 6px;border-bottom:1px solid var(--ink-06,rgba(22,48,43,.06));font-family:var(--f-mono,monospace);white-space:nowrap}" +
      ".rankx-table tr.rankx-hit td{background:rgba(251,196,0,.28);font-weight:800}" +
      ".rankx-pct{display:inline-block;height:6px;background:var(--ink-12,rgba(22,48,43,.12));width:60px;vertical-align:middle;margin-right:6px;position:relative}" +
      ".rankx-pct i{display:block;height:100%;background:var(--ok,#1F6F4A)}" +
      ".rankx-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;font-size:12px}" +
      ".rankx-jump{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}" +
      ".rankx-card{border:1.5px solid var(--ink-12,rgba(22,48,43,.12));padding:12px;margin-bottom:14px}" +
      ".rankx-mine-result{margin-top:10px;font-size:12.5px}" +
      ".rankx-mine-result table{border-collapse:collapse;width:100%}" +
      ".rankx-mine-result td,.rankx-mine-result th{padding:4px 6px;border-bottom:1px solid var(--ink-06,rgba(22,48,43,.06));font-family:var(--f-mono,monospace)}" +
      ".rankx-progress{height:8px;background:var(--ink-12,rgba(22,48,43,.12));margin-top:10px}" +
      ".rankx-progress-bar{height:100%;width:0%;background:var(--ok,#1F6F4A);transition:width .15s}" +
      "@media(max-width:480px){.rankx-controls{gap:8px}.rankx-input{width:76px}}"
    );
    return s;
  };

  /* ══════════════════ 워커 통신 ══════════════════ */
  Explorer.prototype._call = function (cmd, args, onProgress) {
    var self = this;
    var id = "e" + (this.seq++);
    var pr = new Promise(function (resolve, reject) {
      self.pending.set(id, { resolve: resolve, reject: reject, onProgress: onProgress });
      var msg = { id: id, cmd: cmd };
      for (var k in args) msg[k] = args[k];
      self.worker.postMessage(msg);
    });
    pr.id = id; // 취소 대상 지정용(문서: .lab/STATUS-explorer.md)
    return pr;
  };
  Explorer.prototype._onWorkerMessage = function (m) {
    if (m.type === "ready") return;
    if (m.type === "core-error") { this._fatal("rank-core.js 로딩 실패 — 코어가 아직 준비되지 않았습니다. 잠시 후 새로고침해 주세요. (" + m.message + ")"); return; }
    var p = this.pending.get(m.id);
    if (!p) return; // 취소되어 이미 정리된 요청
    if (m.type === "progress") { if (p.onProgress) p.onProgress(m.frac, m.stage); return; }
    this.pending.delete(m.id);
    if (m.type === "result") p.resolve(m.data);
    else if (m.type === "cancelled") p.reject(Object.assign(new Error("취소됨"), { __cancelled: true }));
    else p.reject(new Error(m.message || "워커 오류"));
  };
  Explorer.prototype._cancelBusy = function () {
    if (this.busyId) { this.worker.postMessage({ cmd: "cancel", targetId: this.busyId }); }
  };

  /* ── 모바일/무거운 작업 경고 ── */
  Explorer.prototype._confirmHeavy = function (msg) {
    var self = this;
    var narrow = window.innerWidth > 0 && window.innerWidth < NARROW;
    if (!narrow || this.warnedHeavy) return Promise.resolve(true);
    return new Promise(function (resolve) {
      self.statusEl.hidden = false;
      self.statusEl.className = "rankx-status rankx-status-warn";
      self.statusEl.textContent = "";
      self.statusEl.appendChild(document.createTextNode(msg || "데스크톱 권장 · 몇 초 걸림"));
      var actions = el("div", "rankx-status-actions");
      var go = el("button", "rankx-btn", "계속");
      var stop = el("button", "rankx-btn rankx-btn-2", "취소");
      go.addEventListener("click", function () { self.warnedHeavy = true; self.statusEl.hidden = true; resolve(true); });
      stop.addEventListener("click", function () { self.statusEl.hidden = true; resolve(false); });
      actions.appendChild(go); actions.appendChild(stop);
      self.statusEl.appendChild(actions);
    });
  };
  Explorer.prototype._toast = function (msg) {
    this.statusEl.hidden = false;
    this.statusEl.className = "rankx-status";
    this.statusEl.textContent = msg;
    var self = this;
    setTimeout(function () { if (self.statusEl.textContent === msg) self.statusEl.hidden = true; }, 3500);
  };
  Explorer.prototype._busy = function (on) {
    this.prevBtn.disabled = this.nextBtn.disabled = this.expGo.disabled = on;
  };

  /* ══════════════════ 게임/모델/회차 전환 ══════════════════ */
  Explorer.prototype._syncGameUI = function () {
    var G = GAMES[this.game], self = this;
    this.modelSel.innerHTML = "";
    G.modelKeys.forEach(function (k) { var o = el("option", null, self._modelName(self.game, k)); o.value = k; self.modelSel.appendChild(o); });
    this.theadRow.innerHTML = this.game === "lotto"
      ? "<th>순위</th><th>조합</th><th>점수</th><th>백분위</th>"
      : "<th>순위</th><th>조</th><th>번호</th><th>점수</th><th>백분위</th>";
    this.lottoIn.style.display = this.game === "lotto" ? "" : "none";
    this.bandSel.style.display = this.numIn.style.display = this.game === "pension" ? "" : "none";
  };
  Explorer.prototype._syncRoundOptions = function () {
    var self = this;
    var list = this._roundList();
    var latest = this._latest();
    this.roundSel.innerHTML = "";
    list.forEach(function (r) {
      var isNext = r === list[list.length - 1];
      var label = isNext ? r + "회 (다음 회차)" : r + "회" + ((latest != null && r <= latest) ? "" : " (과거)");
      var o = el("option", null, label); o.value = r;
      self.roundSel.appendChild(o);
    });
  };
  Explorer.prototype._onGameChange = function (g) {
    this.game = g;
    location.hash = "#" + g;
    this._syncGameUI();
    this._syncRoundOptions();
    this.model = GAMES[g].modelKeys[0]; this.modelSel.value = this.model;
    this._updateModelNote();
    this.round = this._defaultRound(); this.roundSel.value = String(this.round);
    this.highlightR = null;
    this.mineResult.innerHTML = "";           // 이전 게임의 "내 번호 순위" 결과가 남아 헷갈리지 않도록 비운다
    this.lottoIn.value = ""; this.numIn.value = "";
    this._loadPage(0);
  };
  Explorer.prototype._onModelChange = function (m) {
    this.model = m; this.highlightR = null; this._updateModelNote(); this._loadPage(0);
  };
  Explorer.prototype._onRoundChange = function (r) {
    this.round = r; this.highlightR = null; this._loadPage(0);
  };

  /* ══════════════════ 페이지 로드 ══════════════════ */
  Explorer.prototype._loadPage = function (offset) {
    var self = this;
    if (offset == null || offset < 0) offset = 0;
    var params = this._roundParams(this.round);
    if (!params) { this._toast("이 회차의 파라미터가 없습니다."); return; }
    var heavy = offset >= HEAVY_OFFSET || (this.game === "lotto" && !this._tableEnsured);
    var go = function () {
      self._busy(true);
      self.tbody.innerHTML = "";
      self.pagerInfo.textContent = "불러오는 중...";
      var reqId = null;
      var args = {
        game: self.game, round: self.round, model: self.model, offset: offset, limit: LIMIT,
        params: params, filter: self.model === "popf",
        excludeWon: self.model === "popf" ? self._excludeWon(self.round) : []
      };
      var t0 = performance.now();
      var call = self._call("page", args, function (frac) { self._progressStatus(frac, "순위표 준비 중"); });
      self.busyId = call.id;
      call.then(function (data) {
        self._tableEnsured = true;
        self.rows = data.rows; self.of = data.of; self.offset = offset;
        self._renderRows();
        self._busy(false);            // prevBtn/nextBtn 를 먼저 일반 해제한 뒤
        self._updatePager();          // 경계(offset 0 / 끝) 기준 disabled 를 최종적으로 덮어쓴다
        self._perfLog("page(" + self.game + "/" + self.model + ", offset=" + offset + ")", performance.now() - t0, data.tookMs);
        self.statusEl.hidden = true;
      }).catch(function (e) {
        self._busy(false);
        self._updatePager();          // 실패/취소 시에도 이전 offset 기준 경계 상태로 복원
        if (!(e && e.__cancelled)) self._toast("불러오기 실패: " + (e && e.message || e));
        else self.statusEl.hidden = true;
      }).then(function () { self.busyId = null; });
    };
    if (heavy) {
      this._confirmHeavy(this.game === "lotto" && !this._tableEnsured
        ? "첫 조회는 로또 전체 조합표를 만듭니다 · 데스크톱 권장 · 몇 초 걸림"
        : "먼 순위로 이동합니다 · 데스크톱 권장 · 몇 초 걸림").then(function (yes) { if (yes) go(); });
    } else go();
  };

  Explorer.prototype._progressStatus = function (frac, label) {
    this.statusEl.hidden = false;
    this.statusEl.className = "rankx-status";
    this.statusEl.textContent = (label || "계산 중") + " " + Math.round((frac || 0) * 100) + "%";
  };
  Explorer.prototype._perfLog = function (label, wallMs, coreMs) {
    // 개발/QA 용 콘솔 타이밍 로그 — UI에는 노출하지 않는다.
    if (window.console) console.debug("[rank-explorer]", label, Math.round(wallMs) + "ms(wall)", coreMs != null ? Math.round(coreMs) + "ms(core)" : "");
  };

  Explorer.prototype._renderRows = function () {
    var self = this;
    this.tbody.innerHTML = "";
    this.rows.forEach(function (row) {
      var tr = el("tr");
      if (self.highlightR != null && row.r === self.highlightR) tr.className = "rankx-hit";
      var pct = self.of ? (row.r - 0.5) / self.of : null;
      var pctCell = "<span class=\"rankx-pct\"><i style=\"width:" + Math.min(100, Math.max(0, (pct || 0) * 100)) + "%\"></i></span>" + pct1(pct);
      if (self.game === "lotto") {
        tr.innerHTML = "<td>" + fmt(row.r) + "</td><td>" + row.c.join("-") + "</td><td>" + (row.score != null ? row.score.toFixed(4) : "-") + "</td><td>" + pctCell + "</td>";
      } else {
        tr.innerHTML = "<td>" + fmt(row.r) + "</td><td>" + row.band + "조</td><td>" + row.num + "</td><td>" + (row.s != null ? row.s : "-") + "</td><td>" + pctCell + "</td>";
      }
      self.tbody.appendChild(tr);
    });
    var latest = this._latest();
    var known = latest != null && this.round <= latest && this._roundRow(this.round);
    this.winBtn.hidden = !known;
  };
  Explorer.prototype._updatePager = function () {
    var of = this.of || GAMES[this.game].of;
    var from = this.offset + 1, to = Math.min(of, this.offset + this.rows.length);
    this.pagerInfo.textContent = fmt(from) + "–" + fmt(to) + " / " + fmt(of);
    this.prevBtn.disabled = this.offset <= 0;
    this.nextBtn.disabled = this.offset + LIMIT >= of;
  };

  /* ══════════════════ 당첨번호 위치로 이동 ══════════════════ */
  /* 당첨 조합이 동점 구간([best,worst]) 안 어디에 있는지는 findExact 로 정확히 찾는다(best 로 어림잡으면
     동점 구간이 수만~수십만 개일 때 완전히 다른 조합을 강조하게 됨 — 2026-09-25 교차검증에서 확인). */
  Explorer.prototype._jumpToWinner = function () {
    var self = this;
    var row = this._roundRow(this.round);
    if (!row) { this._toast("이 회차의 당첨 결과가 없습니다."); return; }
    var params = this._roundParams(this.round);
    var args = { game: this.game, round: this.round, model: this.model, params: params, excludeWon: this._excludeWon(this.round) };
    if (this.game === "lotto") { args.combo = row.win; } else { args.ticket = row.win; }
    this._busy(true);
    this._call("findExact", args, function (frac) { self._progressStatus(frac, "당첨번호 위치 찾는 중"); }).then(function (data) {
      self._busy(false); self.statusEl.hidden = true;
      if (data.excluded) { self._toast("이 모델의 필터를 통과하지 못한 조합입니다(순위 없음)."); return; }
      if (data.r == null) {
        self.highlightR = null;
        self._loadPage(Math.max(0, Math.floor((data.best - 1) / LIMIT) * LIMIT));
        self._toast("당첨번호: " + fmt(data.best) + "~" + fmt(data.worst) + "위(동점 구간이 너무 커서 정확한 줄은 못 찾음) · 백분위 " + pct1(data.pct));
        return;
      }
      self.highlightR = data.r;
      self._loadPage(Math.max(0, Math.floor((data.r - 1) / LIMIT) * LIMIT));
      self._toast("당첨번호: " + fmt(data.r) + "위 · 백분위 " + pct1(data.pct));
    }).catch(function (e) { self._busy(false); if (!(e && e.__cancelled)) self._toast("실패: " + (e && e.message || e)); });
  };

  /* ══════════════════ 내 번호 순위 ══════════════════ */
  Explorer.prototype._lookupMine = function () {
    var self = this;
    this.statusEl.hidden = true;   // 이전 검증 오류 토스트가 남아 헷갈리지 않도록 새 시도 시작 시 지운다
    var params = this._roundParams(this.round);
    if (!params) { this._toast("이 회차의 파라미터가 없습니다."); return; }
    var models = GAMES[this.game].modelKeys;
    var args = { game: this.game, round: this.round, models: models, params: params };
    if (this.game === "lotto") {
      var nums = parseNums(this.lottoIn.value);
      var uniq = Array.from(new Set(nums)).sort(function (a, b) { return a - b; });
      if (uniq.length !== 6 || uniq.some(function (n) { return n < 1 || n > 45; }) || uniq.length !== nums.length) {
        this._toast("로또 번호 6개(1~45, 중복 없이)를 입력하세요."); return;
      }
      args.combo = uniq;
      args.excludeWon = this._excludeWon(this.round);
    } else {
      var band = +this.bandSel.value;
      var num = (this.numIn.value || "").trim();
      if (!/^\d{1,6}$/.test(num)) { this._toast("6자리 숫자를 입력하세요."); return; }
      num = num.padStart(6, "0");
      args.ticket = { band: band, num: num };
    }
    this.mineResult.textContent = "조회 중...";
    this._call("rankOf", args).then(function (data) {
      self._renderMineResult(data.results);
    }).catch(function (e) { self.mineResult.textContent = "실패: " + (e && e.message || e); });
  };
  Explorer.prototype._renderMineResult = function (results) {
    var self = this;
    var names = {};
    GAMES[this.game].modelKeys.forEach(function (k) { names[k] = self._modelName(self.game, k); });
    var html = "<table><thead><tr><th>모델</th><th>순위</th><th>백분위</th>" +
      (this.game === "pension" ? "<th>번호만(2등 기준)</th>" : "") + "</tr></thead><tbody>";
    Object.keys(results).forEach(function (k) {
      var r = results[k];
      if (!r || r.error) { html += "<tr><td>" + names[k] + "</td><td colspan=\"3\">실패</td></tr>"; return; }
      if (r.excluded) { html += "<tr><td>" + names[k] + "</td><td colspan=\"3\">필터 밖(순위 없음) · 전체 " + fmt(r.of) + "개 중</td></tr>"; return; }
      var rankTxt = r.best === r.worst ? fmt(r.best) + "위" : fmt(r.best) + "~" + fmt(r.worst) + "위(동점)";
      var numRank = (self.game === "pension" && r.numRank) ? (fmt(r.numRank.best) + "위/" + fmt(r.numRank.of) + " · " + pct1(r.numRank.pct)) : "";
      html += "<tr><td>" + names[k] + "</td><td>" + rankTxt + " / " + fmt(r.of) + "</td><td>" + pct1(r.pct) + "</td>" +
        (self.game === "pension" ? "<td>" + numRank + "</td>" : "") + "</tr>";
    });
    html += "</tbody></table><p class=\"rankx-note\">백분위는 0%가 모델 순서 맨 위, 100%가 맨 아래입니다 — 확률이 아니라 <b>이 모델이 매긴 순서 안에서의 위치</b>입니다.</p>";
    this.mineResult.innerHTML = html;
  };

  /* ══════════════════ CSV 내보내기 ══════════════════ */
  Explorer.prototype._exportCsv = function () {
    var self = this;
    var topN = Math.max(1, Math.min(100000, parseInt(this.expN.value, 10) || 1000));
    var params = this._roundParams(this.round);
    if (!params) { this._toast("이 회차의 파라미터가 없습니다."); return; }
    var run = function () {
      self.expGo.disabled = true; self.expCancel.hidden = false;
      self.expProgress.hidden = false; self.expBar.style.width = "0%";
      var args = {
        game: self.game, round: self.round, model: self.model, topN: topN, params: params,
        filter: self.model === "popf", excludeWon: self.model === "popf" ? self._excludeWon(self.round) : []
      };
      var t0 = performance.now();
      var call = self._call("exportCsv", args, function (frac) { self.expBar.style.width = Math.round(frac * 100) + "%"; });
      self.busyId = call.id;
      call.then(function (data) {
        self._perfLog("exportCsv(" + self.game + "/" + self.model + ", topN=" + topN + ")", performance.now() - t0, data.tookMs);
        self._downloadBlob(data.blob, data.filename);
        self._toast(fmt(data.rows) + "개 행을 " + data.filename + " 로 내보냈습니다.");
      }).catch(function (e) {
        if (!(e && e.__cancelled)) self._toast("내보내기 실패: " + (e && e.message || e));
        else self._toast("취소되었습니다.");
      }).then(function () {
        self.busyId = null;
        self.expGo.disabled = false; self.expCancel.hidden = true; self.expProgress.hidden = true;
      });
    };
    var narrow = window.innerWidth > 0 && window.innerWidth < NARROW;
    if (narrow && !this.warnedHeavy) {
      this._confirmHeavy("CSV " + fmt(topN) + "개 내보내기 · 데스크톱 권장 · 몇 초~수십 초 걸릴 수 있음").then(function (yes) { if (yes) run(); });
    } else run();
  };
  Explorer.prototype._downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  /* ══════════════════ 부트스트랩 ══════════════════ */
  function mount() {
    var root = document.getElementById(MOUNT_ID);
    if (!root) return null;
    return new Explorer(root);
  }

  var instance = null;
  function init() { if (!instance) instance = mount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.RANKEXPLORER = {
    version: 1,
    reload: function () { instance = mount(); },
    // 디버그/QA 전용 — 내부 상태 읽기 전용 스냅샷(전역은 여전히 RANKEXPLORER 하나뿐).
    debugState: function () {
      if (!instance) return null;
      return {
        game: instance.game, model: instance.model, round: instance.round,
        offset: instance.offset, of: instance.of, rowCount: instance.rows.length,
        highlightR: instance.highlightR, tableEnsured: !!instance._tableEnsured
      };
    }
  };
})();
