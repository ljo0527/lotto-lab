/* site.js — 일확천금 공유 유틸리티. IIFE 하나, 전역은 window.SITE 뿐.
   PLAN §3 계약: SITE.SCHED, SITE.kst, SITE.countdown, SITE.copy, SITE.share,
   SITE.theme.cycle()+버튼 헬퍼, SITE.markBought/isBought/unmark, SITE.gnav.
   classic <script> 로 로드한다 — type=module 아님, 다른 전역 선언 없음. */
(function(){
"use strict";

/* ── 추첨 일정 상수(KST) ── */
var SCHED={
  lotto:{dow:6, close:'20:00', draw:'20:35', resume:'06:00'},
  pension:{dow:4, stop:'17:00', draw:'19:05', resume:'22:00'}
};

/* ── KST 시각 ── */
function pad2(n){ return (n<10?'0':'')+n; }
function kst(date){
  var base = (date instanceof Date) ? date : new Date();
  var t = new Date(base.getTime() + 9*3600*1000); // KST 는 DST 없음 — UTC+9 고정 오프셋
  var y=t.getUTCFullYear(), mo=t.getUTCMonth()+1, d=t.getUTCDate(),
      h=t.getUTCHours(), mi=t.getUTCMinutes(), s=t.getUTCSeconds(), dow=t.getUTCDay();
  return {
    y:y, mo:mo, d:d, h:h, mi:mi, s:s, dow:dow,
    hm: pad2(h)+':'+pad2(mi),
    ymd: y+'-'+pad2(mo)+'-'+pad2(d),
    weekday: '일월화수목금토'[dow],
    time: base.getTime()
  };
}
// KST 벽시계(연,월,일,시,분)를 실제 UTC ms 로. Date.UTC 는 일/월 오버플로를 알아서 굴려준다.
function kstWallToUtcMs(y,mo,d,h,mi){
  return Date.UTC(y, mo-1, d, h, mi, 0) - 9*3600*1000;
}
function parseYmd(ymd){
  var p = String(ymd||'').split('-').map(Number);
  return {y:p[0], mo:p[1], d:p[2]};
}

/* ── 카운트다운(D2 §2.3) ── */
function fmtLeft(ms){
  if(ms<0) ms=0;
  var totalMin = Math.floor(ms/60000);
  var d = Math.floor(totalMin/1440);
  var h = Math.floor((totalMin%1440)/60);
  var m = totalMin%60;
  if(d>0) return d+'일 '+h+'시간';
  if(h>0) return h+'시간 '+m+'분';
  return m+'분';
}
var URGENT_MS = 3*3600*1000; // 3시간 미만이면 --sig 로 전환(spec)

function countdownLotto(nowMs, ymd){
  var p=parseYmd(ymd);
  var closeAt = kstWallToUtcMs(p.y,p.mo,p.d,20,0);
  var drawAt  = kstWallToUtcMs(p.y,p.mo,p.d,20,35);
  var resumeAt= kstWallToUtcMs(p.y,p.mo,p.d+1,6,0);
  if(nowMs < closeAt){
    var left = closeAt-nowMs;
    return {state:'before-close', text:'판매 마감까지 '+fmtLeft(left), sig: left<URGENT_MS};
  }
  if(nowMs < drawAt){
    return {state:'closing', text:'판매 마감 · 20:35 추첨', sig:true};
  }
  if(nowMs < resumeAt){
    return {state:'post-draw', text:'추첨 끝 · 결과 반영 대기(보통 22:30)', sig:false};
  }
  return {state:'stale', text:'추첨 끝 · 결과 반영 대기(보통 22:30)', sig:false};
}
function countdownPension(nowMs, ymd){
  var p=parseYmd(ymd);
  var stopAt  = kstWallToUtcMs(p.y,p.mo,p.d,17,0);
  var drawAt  = kstWallToUtcMs(p.y,p.mo,p.d,19,5);
  var resumeAt= kstWallToUtcMs(p.y,p.mo,p.d,22,0);
  if(nowMs < stopAt){
    var left = stopAt-nowMs;
    return {state:'before-stop', text:'판매 정지(17:00)까지 '+fmtLeft(left), sig: left<URGENT_MS};
  }
  if(nowMs < drawAt){
    return {state:'closing', text:'판매 정지 · 19:05 추첨', sig:true};
  }
  if(nowMs < resumeAt){
    return {state:'post-draw', text:'추첨 끝 · 22:00 다음 회차 판매', sig:false};
  }
  return {state:'stale', text:'추첨 끝 · 22:00 다음 회차 판매', sig:false};
}
function countdown(el, opt){
  opt = opt || {};
  var kind = opt.kind === 'pension' ? 'pension' : 'lotto';
  var now = opt.now instanceof Date ? opt.now.getTime() : Date.now();
  var r = kind==='pension' ? countdownPension(now, opt.drawYmd) : countdownLotto(now, opt.drawYmd);
  if(el){
    try{
      el.textContent = r.text;
      if(el.classList){ el.classList.toggle('sig', !!r.sig); }
    }catch(e){}
  }
  return r;
}

/* ── 저장소(모든 접근 try/catch) ── */
function storeGet(key, fallback){
  try{ var v=localStorage.getItem(key); return v!=null ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}
function storeSet(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch(e){ return false; }
}

/* ── 클립보드 / 공유 ── */
function fallbackCopy(text){
  try{
    var ta=document.createElement('textarea');
    ta.value=text; ta.setAttribute('readonly','');
    ta.style.position='fixed'; ta.style.top='-9999px'; ta.style.left='-9999px';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try{ ta.setSelectionRange(0, text.length); }catch(e2){}
    var ok=false;
    try{ ok=document.execCommand('copy'); }catch(e3){ ok=false; }
    document.body.removeChild(ta);
    return ok;
  }catch(e){ return false; }
}
function copy(text){
  text = text==null ? '' : String(text);
  try{
    if(typeof navigator!=='undefined' && navigator.clipboard && navigator.clipboard.writeText &&
       (typeof window==='undefined' || window.isSecureContext)){
      navigator.clipboard.writeText(text).catch(function(){ fallbackCopy(text); });
      return true;
    }
  }catch(e){}
  return fallbackCopy(text);
}
function share(title, text){
  try{
    if(typeof navigator!=='undefined' && navigator.share){
      navigator.share({title:title, text:text}).catch(function(){});
      return true;
    }
  }catch(e){}
  return copy(text);
}

/* ── 테마(시스템→라이트→다크) ── */
var THEME_KEY='lottolab.theme';
var THEME_SEQ=['system','light','dark'];
var THEME_LABEL={system:'시스템', light:'라이트', dark:'다크'};
function themeGet(){
  try{
    var t=localStorage.getItem(THEME_KEY);
    if(t==='light'||t==='dark') return t;
  }catch(e){}
  return 'system';
}
function themeApply(t){
  try{
    var root=document.documentElement;
    if(t==='light'||t==='dark') root.dataset.theme=t;
    else delete root.dataset.theme;
  }catch(e){}
}
function themeCycle(){
  var cur=themeGet();
  var idx=THEME_SEQ.indexOf(cur);
  var next=THEME_SEQ[(idx+1)%THEME_SEQ.length];
  try{
    if(next==='system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  }catch(e){}
  themeApply(next);
  return next;
}
function themeLabel(t){ return THEME_LABEL[t] || THEME_LABEL.system; }
// 작은 버튼 헬퍼: 엘리먼트(또는 셀렉터)를 테마 토글 버튼으로 연결한다.
function themeMount(elOrSel){
  var el;
  try{ el = (typeof elOrSel==='string') ? document.querySelector(elOrSel) : elOrSel; }
  catch(e){ el=null; }
  if(!el) return null;
  function paint(){
    var t=themeGet();
    el.textContent = themeLabel(t);
    try{ el.setAttribute('aria-label', '테마: '+themeLabel(t)+' · 탭하여 전환'); }catch(e){}
  }
  paint();
  try{ el.addEventListener('click', function(){ themeCycle(); paint(); }); }catch(e){}
  return el;
}
// 초기 로드 시에도 저장된 값 반영(각 페이지 <head> 사전 페인트 스크립트와 별개로 방어적 재적용)
themeApply(themeGet());

/* ── 내 번호 기록: 기존 저장소 · 기존 모양 그대로 ── */
var LOTTO_MY='lottolab.my.v1';     // [{round, nums:[6 오름차순], cost:1000, at}]
var PENSION_MY='pensionlab.my.v1'; // [{band, num, ep}]

function sortedNums(nums){
  return (nums||[]).slice().sort(function(a,b){ return a-b; });
}
function markBought(kind, round, items){
  items = items || [];
  if(kind==='lotto'){
    var arr = storeGet(LOTTO_MY, []);
    var seen = {};
    arr.forEach(function(t){
      if(t && t.round===round && Array.isArray(t.nums)) seen[sortedNums(t.nums).join(',')] = true;
    });
    var added=0;
    items.forEach(function(nums){
      var s = sortedNums(nums), key = s.join(',');
      if(!s.length || seen[key]) return;
      seen[key]=true;
      arr.push({round:round, nums:s, cost:1000, at:Date.now()});
      added++;
    });
    if(added) storeSet(LOTTO_MY, arr);
    return added;
  }
  if(kind==='pension'){
    var arr2 = storeGet(PENSION_MY, []);
    var seen2 = {};
    arr2.forEach(function(t){ if(t && t.ep===round) seen2[t.band+':'+t.num]=true; });
    var added2=0;
    items.forEach(function(it){
      if(!it) return;
      var key = it.band+':'+it.num;
      if(seen2[key]) return;
      seen2[key]=true;
      arr2.push({band:it.band, num:it.num, ep:round});
      added2++;
    });
    if(added2) storeSet(PENSION_MY, arr2);
    return added2;
  }
  return 0;
}
function isBought(kind, round){
  if(kind==='lotto'){
    var arr=storeGet(LOTTO_MY, []);
    return arr.some(function(t){ return t && t.round===round; });
  }
  if(kind==='pension'){
    var arr2=storeGet(PENSION_MY, []);
    return arr2.some(function(t){ return t && t.ep===round; });
  }
  return false;
}
function unmark(kind, round){
  if(kind==='lotto'){
    var arr=storeGet(LOTTO_MY, []);
    var next=arr.filter(function(t){ return !(t && t.round===round); });
    storeSet(LOTTO_MY, next);
    return arr.length-next.length;
  }
  if(kind==='pension'){
    var arr2=storeGet(PENSION_MY, []);
    var next2=arr2.filter(function(t){ return !(t && t.ep===round); });
    storeSet(PENSION_MY, next2);
    return arr2.length-next2.length;
  }
  return 0;
}

/* ── gnav: 5탭, 20px 인라인 SVG 글리프 ── */
var NAV_ITEMS=[
  {id:'brief',    file:'brief.html',    label:'이번 주', icon:'calendar'},
  {id:'index',    file:'index.html',    label:'로또',    icon:'ball'},
  {id:'pension',  file:'pension.html',  label:'연금',    icon:'ticket'},
  {id:'validate', file:'validate.html', label:'검증',    icon:'check-shield'},
  {id:'record',   file:'record.html',   label:'기록',    icon:'ledger'}
];
var NAV_ICONS={
  calendar:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="5" width="17.6" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.2 9.6h17.6"/></svg>',
  ball:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.3"/><path d="M8.6 8.9a2.4 2.4 0 0 1 2.4-2.3"/></svg>',
  ticket:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.1a2 2 0 0 0 0 3.8v2.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.1a2 2 0 0 0 0-3.8V8.2Z"/><path d="M9.3 6.4v11.3" stroke-dasharray="2.1 2.1"/></svg>',
  'check-shield':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19 6v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-2.8Z"/><path d="M8.7 12.2 11 14.5l4.3-4.3"/></svg>',
  ledger:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.2" y="3" width="15.6" height="18" rx="1.4"/><path d="M7.6 8h8.8M7.6 12h8.8M7.6 16h5.6"/></svg>'
};
function navId(active){
  var s = String(active||'').replace(/^\.?\/*/,'').replace(/\.html$/,'');
  if(s==='lotto') s='index';
  if(s==='이번주'||s==='이번 주'||s==='brief') s='brief';
  return s;
}
function gnav(active, prefix){
  prefix = prefix==null ? './' : prefix;
  var cur = navId(active);
  var html = '<nav class="gnav" aria-label="사이트">';
  NAV_ITEMS.forEach(function(it){
    var isCur = it.id===cur;
    html += '<a href="'+prefix+it.file+'"'+(isCur?' aria-current="page"':'')+'>'+
      NAV_ICONS[it.icon]+'<span>'+it.label+'</span></a>';
  });
  html += '</nav>';
  return html;
}

/* ── 서비스워커 등록: https && 자동화 아님 ── */
try{
  if(typeof window!=='undefined' && typeof navigator!=='undefined' &&
     location.protocol==='https:' && !navigator.webdriver && 'serviceWorker' in navigator){
    window.addEventListener('load', function(){
      try{ navigator.serviceWorker.register('./sw.js'); }catch(e){}
    });
  }
}catch(e){}

/* ── 공개 API ── */
var SITE = {
  SCHED: SCHED,
  kst: kst,
  countdown: countdown,
  copy: copy,
  share: share,
  theme: { cycle:themeCycle, get:themeGet, apply:themeApply, mount:themeMount, label:themeLabel },
  markBought: markBought,
  isBought: isBought,
  unmark: unmark,
  gnav: gnav
};
try{ window.SITE = SITE; }
catch(e){ try{ globalThis.SITE = SITE; }catch(e2){} } /* 비-브라우저 환경(harness) 방어 */

})();
