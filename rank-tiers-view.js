/* rank-tiers-view.js — 등수별 순위 분포 (PLAN3 §10.1 · §10.3, Sonnet-6 소유)
   rank.html 의 <section id="tiers"></section> 를 채운다. 전역은 window.RANKTIERS 하나뿐.
   classic <script defer> 로드. rank-core.js/rank-worker.js 에 의존하지 않는다 — 정적 JSON만 읽는다.
   데이터: ./brief/rank-tiers-lotto.json, ./brief/rank-tiers-pension.json (스키마 PLAN3 §10.1, Fable-2 산출물).
   게임 선택은 이 섹션이 만들지 않는다 — rank.html 상단 토글(#lotto/#pension 해시)을 그대로 따라간다
   (hashchange 를 듣는다). 파일이 없으면(아직 계산 전) 섹션을 조용히 숨긴다 — 에러 배너를 띄우지 않는다. */
(function () {
  "use strict";

  var MOUNT_ID = "tiers";

  var GAMES = {
    lotto: { label: "로또", unit: "개", file: "./brief/rank-tiers-lotto.json" },
    pension: { label: "연금복권", unit: "장", file: "./brief/rank-tiers-pension.json" }
  };

  var MODEL_FALLBACK_NAME = {
    pop: "분배 모델(추천 순서)", popf: "분배 모델 + 주간 필터",
    hot: "빈도 모델(많이 나온 번호)", cold: "미출현 모델(오래 안 나온 번호)",
    freq: "빈도 모델", recent: "최근 가중 모델", gap: "공백 모델",
    rand: "무작위 기준", site: "사이트 설정 모델(별칭)"
  };

  /* ── DOM/포맷 헬퍼 (rank-explorer.js 와 같은 패턴) ── */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function nf(n) { return (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("ko-KR"); }
  function pct1(x) { return (x == null || isNaN(x)) ? "—" : (x * 100).toFixed(1) + "%"; }
  function pFmt(p) {
    if (p == null || isNaN(p)) return "—";
    return p < 0.001 ? "<0.001" : p.toFixed(3);
  }
  /* 칸 개수(비례 규칙으로 소수일 수 있음) 표시용: 정수면 그대로, 아니면 소수 1자리(기대·sd 와 자리수 통일) */
  function cnt(v) {
    if (v == null || isNaN(v)) return "—";
    return (Number.isInteger(v) ? Number(v) : Number(v.toFixed(1))).toLocaleString("ko-KR");
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function get(o) {
    var cur = o;
    for (var i = 1; i < arguments.length; i++) {
      if (cur == null) return undefined;
      cur = cur[arguments[i]];
    }
    return cur;
  }
  function loadJSON(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function labelWrap(text, control) {
    var l = el("label", "rtiers-label");
    l.appendChild(el("span", null, text));
    l.appendChild(control);
    return l;
  }
  function mmdd(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? m[2] + "." + m[3] : "—";
  }

  /* ══════════════════ TiersView 생성자 ══════════════════ */
  function TiersView(root) {
    this.root = root;
    this.data = { lotto: null, pension: null };
    this.sel = { lotto: { model: null, tier: null }, pension: { model: null, tier: null } };
    this._buildDOM();
    this._boot();
    var self = this;
    window.addEventListener("hashchange", function () { self._render(); });
  }

  TiersView.prototype._activeGame = function () {
    return location.hash === "#pension" ? "pension" : "lotto";
  };
  TiersView.prototype._hasData = function (game) {
    var d = this.data[game];
    return !!(d && Array.isArray(d.rows) && d.tiers && Object.keys(d.tiers).length);
  };

  /* ── 모델 목록 정규화: [{key,name}] 또는 ["key",…] 둘 다 받는다 ── */
  function modelList(data) {
    var arr = (data && data.models) || [];
    return arr.map(function (m) {
      if (m && typeof m === "object") return { key: m.key, name: m.name || MODEL_FALLBACK_NAME[m.key] || m.key };
      return { key: m, name: MODEL_FALLBACK_NAME[m] || m };
    }).filter(function (m) { return m.key; });
  }
  function tierKeys(data) {
    return Object.keys((data && data.tiers) || {}).sort(function (a, b) { return Number(a) - Number(b); });
  }
  function defaultTier(data) {
    var ks = tierKeys(data);
    if (!ks.length) return null;
    return ks[ks.length - 1]; // 조합 수가 가장 많은(보통 가장 낮은 등수 이름의) 칸을 기본으로 — 예시 문구와 일치
  }

  /* ══════════════════ 부팅: 두 게임 파일 로드 ══════════════════ */
  TiersView.prototype._boot = function () {
    var self = this;
    Promise.all([loadJSON(GAMES.lotto.file), loadJSON(GAMES.pension.file)]).then(function (r) {
      self.data.lotto = r[0]; self.data.pension = r[1];
      if (!self._hasData("lotto") && !self._hasData("pension")) { self.root.hidden = true; return; }
      self._render();
    });
  };

  /* ══════════════════ DOM 구성(뼈대 — 값은 _render 에서 채움) ══════════════════ */
  TiersView.prototype._buildDOM = function () {
    var root = this.root;
    root.innerHTML = "";
    root.appendChild(this._style());
    var self = this;

    var wrap = el("div", "rtiers");
    wrap.appendChild(el("h2", "rtiers-h2", "등수별 순위 분포"));
    wrap.appendChild(el("p", "rtiers-note",
      "1등 하나가 아니라 <b>그 회차의 등수별 당첨 조합 전체</b>를 순위표 위 백분위(0=1위 방향 · 100=꼴찌 방향) 20칸에 나눠 담았습니다. " +
      "추첨이 공정하면 어느 모델이든 이 분포는 균등해야 합니다 — <b>5등 조합 18만 개도 순위표 전체에 고르게 퍼지는 것이 정상</b>입니다. " +
      "막대(관측)를 점선(기대) ± 몬테카를로 표준편차 띠와 비교하세요. <b>「이 순위권이 잘 나온다」는 뜻이 아닙니다.</b>"));
    wrap.appendChild(el("p", "rtiers-note",
      "한 회차 안의 등수 조합들은 같은 당첨번호를 공유해 서로 강하게 상관됩니다 — 그래서 단순 합산 대신 " +
      "<b>회차 단위 평균 백분위</b>(표의 「회차수준 p」)와 <b>몬테카를로 귀무분포</b>(표의 「pMC」)로만 유의성을 봅니다. " +
      "여러 등수·모델 칸을 한꺼번에 보면 그중 몇 칸은 우연히 벗어나 보이는 것도 정상입니다(다중 검정)."));

    var meta = el("div", "rtiers-meta");
    this.gameBadge = el("span", "rtiers-badge", "");
    this.metaText = el("span", "rtiers-metatext", "");
    meta.appendChild(this.gameBadge); meta.appendChild(this.metaText);
    wrap.appendChild(meta);

    var ctl = el("div", "rtiers-controls");
    var tSel = el("select", "rtiers-sel");
    tSel.addEventListener("change", function () { self._onTierChange(tSel.value); });
    ctl.appendChild(labelWrap("등수", tSel));
    this.tierSel = tSel;

    var mSel = el("select", "rtiers-sel");
    mSel.addEventListener("change", function () { self._onModelChange(mSel.value); });
    ctl.appendChild(labelWrap("모델", mSel));
    this.modelSel = mSel;
    wrap.appendChild(ctl);

    var results = el("div", "rtiers-results");
    results.setAttribute("aria-live", "polite");
    wrap.appendChild(results);

    results.appendChild(el("p", "rtiers-note",
      "아래 「몬테카를로 p」 두 가지: <b>전체</b>는 20칸이 한꺼번에 벗어난 정도(Q=Σz²)의 유의성, " +
      "<b>최대칸</b>은 그중 가장 튀어 보이는 칸 하나만 봤을 때의 유의성입니다(20칸을 다 훑어보고 고른 값이라 다중검정을 이미 감안합니다) — 둘 다 참고용입니다."));

    var kpi = el("div", "rtiers-kpi");
    results.appendChild(kpi);
    this.kpiEl = kpi;

    var binsCard = el("div", "rtiers-card");
    this.binsTitle = el("h3", "rtiers-h3", "");
    binsCard.appendChild(this.binsTitle);
    this.binsChartWrap = el("div", null, "");
    binsCard.appendChild(this.binsChartWrap);
    this.binsLegend = el("div", "rtiers-legend", "");
    binsCard.appendChild(this.binsLegend);
    results.appendChild(binsCard);

    var trendCard = el("div", "rtiers-card");
    trendCard.appendChild(el("h3", "rtiers-h3", "회차별 평균 백분위 추이"));
    this.trendChartWrap = el("div", null, "");
    trendCard.appendChild(this.trendChartWrap);
    results.appendChild(trendCard);

    var tblCard = el("div", "rtiers-card");
    tblCard.appendChild(el("h3", "rtiers-h3", "등수별 요약 (선택한 모델 기준)"));
    this.tblWrap = el("div", "rtiers-tbl", "");
    tblCard.appendChild(this.tblWrap);
    results.appendChild(tblCard);

    this.notFoundEl = el("p", "rtiers-note", "이 게임의 등수별 분포는 아직 계산되지 않았습니다.");
    this.notFoundEl.hidden = true;
    wrap.appendChild(this.notFoundEl);

    this.innerWrap = wrap;
    this.resultsEl = results;
    root.appendChild(wrap);
  };

  TiersView.prototype._style = function () {
    return el("style", null,
      ".rtiers{font:14px/1.55 var(--f-body,system-ui,sans-serif);color:var(--ink,#16302B)}" +
      ".rtiers-h2{font-size:17px;font-weight:800;margin:0 0 8px}" +
      ".rtiers-h3{font-size:13.5px;font-weight:800;margin:0 0 8px}" +
      ".rtiers-note{font-size:12px;line-height:1.6;color:var(--ink-60,rgba(22,48,43,.6));margin:0 0 10px}" +
      ".rtiers-note b{color:var(--ink,#16302B)}" +
      ".rtiers-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}" +
      ".rtiers-badge{font:700 11px var(--f-mono,monospace);letter-spacing:.04em;border:1px solid var(--ink,#16302B);padding:2px 8px;border-radius:2px}" +
      ".rtiers-metatext{font-size:11.5px;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px}" +
      ".rtiers-label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-sel{box-sizing:border-box;min-height:44px;font:600 13px var(--f-mono,monospace);padding:6px 10px;" +
      "border:1.5px solid var(--ink,#16302B);background:var(--paper-2,#F7F8F5);color:var(--ink,#16302B);" +
      "border-radius:2px;max-width:min(100%,260px)}" +
      ".rtiers-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:1px;background:var(--ink-12,rgba(22,48,43,.12));" +
      "border:1.5px solid var(--ink,#16302B);margin-bottom:14px}" +
      ".rtiers-kpi>div{background:var(--paper-2,#F7F8F5);padding:11px 10px}" +
      ".rtiers-kpi>div:last-child:nth-child(odd){grid-column:1/-1}" +
      ".rtiers-k{font-family:ui-monospace,monospace;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-v{font-size:19px;font-weight:800;line-height:1.15;padding-top:3px;letter-spacing:-.01em}" +
      ".rtiers-s{font-size:11px;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-card{border:1.5px solid var(--ink-12,rgba(22,48,43,.12));padding:12px 13px;margin-bottom:14px}" +
      ".rtiers-chart{width:100%;height:auto;display:block}" +
      ".rtiers-bar{fill:var(--ink,#16302B);fill-opacity:.68}" +
      ".rtiers-band{fill:var(--ink-12,rgba(22,48,43,.12));stroke:none}" +
      ".rtiers-expline{fill:none;stroke:var(--ink-40,rgba(22,48,43,.4));stroke-width:1.6;stroke-dasharray:5 4}" +
      ".rtiers-axis{stroke:var(--ink-12,rgba(22,48,43,.12));stroke-width:1}" +
      ".rtiers-axlabel{font:10px var(--f-mono,monospace);fill:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-trendline{fill:none;stroke:var(--ink,#16302B);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}" +
      ".rtiers-refline{stroke:var(--ink-40,rgba(22,48,43,.4));stroke-width:1;stroke-dasharray:5 4}" +
      ".rtiers-legend{display:flex;gap:14px;font-size:11.5px;color:var(--ink-60,rgba(22,48,43,.6));flex-wrap:wrap;margin-top:6px}" +
      ".rtiers-lg{display:flex;align-items:center;gap:6px}" +
      ".rtiers-sw{width:14px;height:0;border-top:2.2px solid var(--ink,#16302B)}" +
      ".rtiers-sw-dash{border-top-style:dashed;border-color:var(--ink-40,rgba(22,48,43,.4))}" +
      ".rtiers-sw-box{width:12px;height:10px;background:var(--ink-12,rgba(22,48,43,.12));border-top:0}" +
      ".rtiers-tbl{display:flex;flex-direction:column;gap:8px}" +
      ".rtiers-trow{background:var(--paper-2,#F7F8F5);border:1px solid var(--ink-12,rgba(22,48,43,.12));padding:9px 11px}" +
      ".rtiers-ttier{font-weight:800;font-size:13px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}" +
      ".rtiers-tsub{font-weight:400;font-size:11px;color:var(--ink-40,rgba(22,48,43,.4))}" +
      ".rtiers-tstats{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:11.5px;color:var(--ink-60,rgba(22,48,43,.6))}" +
      ".rtiers-tstats b{color:var(--ink,#16302B);font-weight:700}" +
      ".rtiers-tstats .rtiers-cur{color:var(--ink,#16302B)}" +
      ".rtiers-trow.rtiers-cur{border-color:var(--ink,#16302B)}" +
      "@media(max-width:480px){.rtiers-controls{gap:8px}.rtiers-sel{max-width:100%}}"
    );
  };

  /* ══════════════════ 렌더 ══════════════════ */
  TiersView.prototype._render = function () {
    var game = this._activeGame();
    var G = GAMES[game];
    this.gameBadge.textContent = G.label;
    if (!this._hasData(game)) {
      this.innerWrap.querySelectorAll(".rtiers-controls,.rtiers-kpi,.rtiers-card").forEach(function (n) { n.hidden = true; });
      this.metaText.textContent = "";
      this.notFoundEl.hidden = false;
      return;
    }
    this.notFoundEl.hidden = true;
    this.innerWrap.querySelectorAll(".rtiers-controls,.rtiers-kpi,.rtiers-card").forEach(function (n) { n.hidden = false; });

    var data = this.data[game];
    this.metaText.textContent = data.from + "~" + data.latest + "회 · 회차 " + (data.rows ? data.rows.length : 0) +
      "개 · 생성 " + mmdd(data.generated);

    var models = modelList(data);
    var tiers = tierKeys(data);
    var st = this.sel[game];
    if (!st.model || !models.some(function (m) { return m.key === st.model; })) st.model = models.length ? models[0].key : null;
    if (!st.tier || tiers.indexOf(st.tier) < 0) st.tier = defaultTier(data);

    this.modelSel.innerHTML = "";
    models.forEach(function (m) { var o = el("option", null, m.name); o.value = m.key; this.modelSel.appendChild(o); }, this);
    this.modelSel.value = st.model;

    this.tierSel.innerHTML = "";
    tiers.forEach(function (t) { var o = el("option", null, t + "등"); o.value = t; this.tierSel.appendChild(o); }, this);
    this.tierSel.value = st.tier;

    if (!models.length || !tiers.length) { this.notFoundEl.hidden = false; this.notFoundEl.textContent = "모델·등수 정보가 비어 있습니다."; return; }

    this._renderModel(game, data, st.model, st.tier, models, tiers, G);
  };

  TiersView.prototype._onModelChange = function (m) { this.sel[this._activeGame()].model = m; this._render(); };
  TiersView.prototype._onTierChange = function (t) { this.sel[this._activeGame()].tier = t; this._render(); };

  TiersView.prototype._renderModel = function (game, data, modelKey, tierKey, models, tiers, G) {
    var modelName = (models.filter(function (m) { return m.key === modelKey; })[0] || {}).name || modelKey;
    var cell = get(data, "summary", "models", modelKey, tierKey) || null;
    var combosPerRound = data.tiers[tierKey];

    /* KPI */
    var n = (data.rows || []).filter(function (r) { return get(r, "m", modelKey, tierKey) != null; }).length;
    var meanPct = cell ? cell.meanPct : null;
    var rm = cell ? cell.roundMean : null;
    var mc = cell ? cell.mc : null;
    var kpis = [
      ["회차 수", n + "회", tierKey + "등 자료가 있는 회차"],
      ["관측 평균 백분위", pct1(meanPct), "기대 50.0%(균등)"],
      ["회차수준 p", pFmt(rm && rm.p), rm ? ("t=" + (rm.t != null ? rm.t.toFixed(2) : "—") + " · n=" + nf(rm.n)) : "—"],
      ["몬테카를로 p(전체)", pFmt(mc && mc.pMC), mc && mc.sims ? "20칸 전체 패턴 · sims=" + nf(mc.sims) : "—"],
      ["몬테카를로 p(최대칸)", pFmt(mc && mc.pMax), mc ? "가장 벗어난 칸 1개 · maxZ=" + (mc.maxZ != null ? mc.maxZ.toFixed(2) : "—") : "—"],
      ["회차당 조합 수", nf(combosPerRound) + G.unit, tierKey + "등 · " + modelName]
    ];
    this.kpiEl.innerHTML = kpis.map(function (it) {
      return '<div><div class="rtiers-k">' + it[0] + '</div><div class="rtiers-v">' + it[1] + '</div><div class="rtiers-s">' + it[2] + '</div></div>';
    }).join("");

    /* 20칸 분포 */
    var tierLabel = tierKey + "등";
    var chartHeading = tierLabel + " · " + modelName;
    this.binsTitle.textContent = "20칸 백분위 분포 — " + chartHeading;
    var binsMeta = { heading: chartHeading, tierLabel: tierLabel, modelName: modelName, combosPerRound: combosPerRound, unit: G.unit };
    if (cell && Array.isArray(cell.bins)) {
      this.binsChartWrap.innerHTML = binsChartSVG(cell.bins, cell.exp, mc && mc.sd, binsMeta);
    } else {
      var pooled = pooledBins(data.rows, modelKey, tierKey, data.bins || 20);
      if (pooled) this.binsChartWrap.innerHTML = binsChartSVG(pooled.bins, pooled.exp, null, binsMeta);
      else this.binsChartWrap.innerHTML = '<p class="rtiers-note">이 등수·모델의 분포 자료가 없습니다.</p>';
    }
    this.binsLegend.innerHTML =
      '<span class="rtiers-lg"><span class="rtiers-sw" style="border-top-width:0;background:var(--ink,#16302B);height:10px;width:12px"></span>관측(전체 회차 합계)</span>' +
      '<span class="rtiers-lg"><span class="rtiers-sw rtiers-sw-dash"></span>기대(균등)</span>' +
      '<span class="rtiers-lg"><span class="rtiers-sw-box"></span>± 몬테카를로 표준편차</span>';

    /* 회차별 평균 백분위 추이 */
    var rowsDesc = (data.rows || []).slice().sort(function (a, b) { return a.round - b.round; });
    var series = rowsDesc.map(function (r) { return { round: r.round, val: get(r, "m", modelKey, tierKey) }; })
      .filter(function (r) { return r.val != null && !isNaN(r.val); });
    this.trendChartWrap.innerHTML = trendChartSVG(series, { heading: chartHeading, tierLabel: tierLabel });

    /* 등수별 요약 표(선택 모델 기준, 모든 등수) */
    this.tblWrap.innerHTML = tiers.map(function (t) {
      var c = get(data, "summary", "models", modelKey, t);
      var r2 = c && c.roundMean, mc2 = c && c.mc;
      var cur = t === tierKey ? " rtiers-cur" : "";
      return '<div class="rtiers-trow' + cur + '">' +
        '<div class="rtiers-ttier">' + t + '등<span class="rtiers-tsub">' + nf(data.tiers[t]) + G.unit + '/회차</span></div>' +
        '<div class="rtiers-tstats">' +
        '<span><b>관측</b> ' + pct1(c && c.meanPct) + ' <span class="rtiers-tsub">(기대 50%)</span></span>' +
        '<span><b>회차수준 p</b> ' + pFmt(r2 && r2.p) + '</span>' +
        '<span><b>몬테카를로 p</b> ' + pFmt(mc2 && mc2.pMC) + ' <span class="rtiers-tsub">(최대칸 ' + pFmt(mc2 && mc2.pMax) + ')</span></span>' +
        '</div></div>';
    }).join("");
  };

  /* ── 요약(summary)이 없을 때의 대비: rows 를 직접 풀링(관측만, sd·pMC 없이) ── */
  function pooledBins(rows, modelKey, tierKey, bins) {
    var sum = null, n = 0;
    (rows || []).forEach(function (r) {
      var h = get(r, "h", modelKey, tierKey);
      if (!Array.isArray(h)) return;
      if (!sum) sum = h.slice().map(function () { return 0; });
      for (var i = 0; i < sum.length && i < h.length; i++) sum[i] += h[i];
      n++;
    });
    if (!sum) return null;
    var total = sum.reduce(function (a, b) { return a + b; }, 0);
    var exp = sum.map(function () { return total / sum.length; });
    return { bins: sum, exp: exp };
  }

  /* ══════════════════ SVG 차트 ══════════════════ */
  function xmlesc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function binsChartSVG(bins, exp, sd, meta) {
    meta = meta || {};
    var k = bins.length;
    exp = exp && exp.length === k ? exp : bins.map(function () { return 0; });
    var hasSd = Array.isArray(sd) && sd.length === k;
    var W = 680, H = 210, padL = 8, padR = 8, padT = 12, padB = 24;
    var maxCandidates = bins.slice();
    exp.forEach(function (e, i) { maxCandidates.push(e + (hasSd ? sd[i] : 0)); });
    var maxV = Math.max.apply(null, maxCandidates);
    if (!isFinite(maxV) || maxV <= 0) maxV = 1;
    var binPct = 100 / k;
    var bw = (W - padL - padR) / k;
    var ys = function (v) { return padT + (H - padT - padB) * (1 - v / maxV); };
    var cx = function (i) { return padL + bw * (i + 0.5); };
    var baseY = H - padB;

    var bars = "";
    for (var i = 0; i < k; i++) {
      var x = padL + i * bw, y = ys(bins[i]), h = baseY - y;
      var lo = Math.round(i * binPct), hi = Math.round((i + 1) * binPct);
      var barTitle = "<title>" + (i + 1) + "번째 20분위(백분위 " + lo + "~" + hi + "%) · 관측 " + cnt(bins[i]) +
        " · 기대 " + Number(exp[i].toFixed(1)).toLocaleString("ko-KR") +
        (hasSd ? " ± " + Number(sd[i].toFixed(1)).toLocaleString("ko-KR") : "") + "</title>";
      bars += '<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.8).toFixed(1) +
        '" height="' + Math.max(0, h).toFixed(1) + '" class="rtiers-bar">' + barTitle + '</rect>';
    }
    var band = "";
    if (hasSd) {
      var top = [], bot = [];
      for (i = 0; i < k; i++) { top.push(cx(i).toFixed(1) + "," + ys(exp[i] + sd[i]).toFixed(1)); }
      for (i = k - 1; i >= 0; i--) { bot.push(cx(i).toFixed(1) + "," + ys(Math.max(0, exp[i] - sd[i])).toFixed(1)); }
      band = '<polygon points="' + top.concat(bot).join(" ") + '" class="rtiers-band"/>';
    }
    var expPts = [];
    for (i = 0; i < k; i++) expPts.push(cx(i).toFixed(1) + "," + ys(exp[i]).toFixed(1));
    var expLine = '<polyline points="' + expPts.join(" ") + '" class="rtiers-expline"/>';
    var axis = '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" class="rtiers-axis"/>';
    var labels = '<text x="' + (padL + 2) + '" y="' + (H - 6) + '" class="rtiers-axlabel">0%(1위 방향)</text>' +
      '<text x="' + (padL + (W - padL - padR) / 2) + '" y="' + (H - 6) + '" class="rtiers-axlabel" text-anchor="middle">백분위 50%</text>' +
      '<text x="' + (W - padR - 2) + '" y="' + (H - 6) + '" class="rtiers-axlabel" text-anchor="end">100%(꼴찌 방향)</text>';
    var svgTitle = meta.heading || "20칸 백분위 분포";
    var svgDesc = "추첨이 공정하면 " + (meta.tierLabel || "이 등수") + " 조합" +
      (meta.combosPerRound != null ? "(회차당 " + nf(meta.combosPerRound) + (meta.unit || "개") + ")" : "") +
      "의 백분위는 20칸에 고르게 흩어져야 합니다. 막대는 관측치, 점선은 기대치, 띠는 몬테카를로 ±표준편차입니다" +
      (meta.modelName ? " (모델: " + meta.modelName + ")" : "") + ".";
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rtiers-chart" role="img" aria-label="' + xmlesc(svgTitle) + '">' +
      '<title>' + xmlesc(svgTitle) + '</title><desc>' + xmlesc(svgDesc) + '</desc>' +
      band + expLine + bars + axis + labels + '</svg>';
  }

  function trendChartSVG(series, meta) {
    meta = meta || {};
    var n = series.length;
    if (!n) return '<p class="rtiers-note">회차별 자료가 없습니다.</p>';
    var W = 680, H = 150, padL = 10, padR = 10, padT = 12, padB = 10;
    var xs = function (i) { return n <= 1 ? (padL + (W - padL - padR) / 2) : padL + (W - padL - padR) * i / (n - 1); };
    var ys = function (v) { return padT + (H - padT - padB) * (1 - clamp01(v)); };
    var path = series.map(function (s, i) { return (i === 0 ? "M" : "L") + xs(i).toFixed(1) + "," + ys(s.val).toFixed(1); }).join(" ");
    var midY = ys(0.5).toFixed(1);
    var last = series[series.length - 1];
    var svgTitle = "회차별 평균 백분위 추이" + (meta.heading ? " — " + meta.heading : "");
    var svgDesc = (meta.roundRange || (series[0].round + "~" + last.round + "회")) +
      ", 회차마다 " + (meta.tierLabel || "이 등수") + " 조합들의 평균 백분위입니다. " +
      "점선은 추첨이 공정하면 기대되는 50%입니다.";
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rtiers-chart" role="img" aria-label="' + xmlesc(svgTitle) + '">' +
      '<title>' + xmlesc(svgTitle) + '</title><desc>' + xmlesc(svgDesc) + '</desc>' +
      '<line x1="' + padL + '" y1="' + midY + '" x2="' + (W - padR) + '" y2="' + midY + '" class="rtiers-refline"/>' +
      '<path d="' + path + '" class="rtiers-trendline"/>' +
      '</svg>' +
      '<div class="rtiers-legend">' +
      '<span class="rtiers-lg"><span class="rtiers-sw"></span>회차별 평균 백분위(' + series[0].round + '~' + last.round + '회 · 최근값 ' + pct1(last.val) + ')</span>' +
      '<span class="rtiers-lg"><span class="rtiers-sw rtiers-sw-dash"></span>기대(추첨이 공정하면 50%)</span>' +
      '</div>';
  }

  /* ══════════════════ 부트스트랩 ══════════════════ */
  function mount() {
    var root = document.getElementById(MOUNT_ID);
    if (!root) return null;
    return new TiersView(root);
  }

  var instance = null;
  function init() { if (!instance) instance = mount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.RANKTIERS = {
    version: 1,
    reload: function () { instance = mount(); }
  };
})();
