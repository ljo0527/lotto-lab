#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   주간 복권 브리핑 생성기 — 연금복권720+ / 로또 6/45
   매주 금요일 아침 실행. 결과물: <root>/brief.html (최신) + <root>/brief/<날짜>.html

   설계 핵심 — 추천 번호 로직을 여기에 다시 구현하지 않는다.
   pension.html·index.html 을 헤드리스 브라우저에 실제로 띄우고,
   네트워크만 로컬에서 받아온 데이터로 가로채 먹인 뒤 결과를 꺼낸다.
   → 도구를 고치면 브리핑도 자동으로 따라온다. 두 벌 관리가 생기지 않는다.

   «지난주 추천» 은 페이지 안에서 DB 를 한 회차 잘라내고 다시 계산시킨다.
   추천이 회차번호 시드로 결정되므로 지난주에 보였던 것과 동일하게 재현된다.
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';

const arg=(k,d)=>{ const i=process.argv.indexOf(k); return i>0?process.argv[i+1]:d; };
const ROOT=path.resolve(arg('--root', process.cwd()));
const OUT =path.resolve(arg('--out', ROOT));
const KST =()=>new Date(Date.now()+9*3600e3);
const kstStr=d=>d.toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function jget(url,tries=8){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (lotto-lab)'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await sleep(Math.min(20000,1000*2**i)); }
  }
}

/* ── 1. 데이터 수집 ─────────────────────────────────────────── */
const P720='https://www.dhlottery.co.kr/pt720/';
const L645='https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=';

async function getPension(){
  const list=(await jget(P720+'selectPstPt720WnList.do')).data.result;
  const rows=list.map(r=>({ep:+r.psltEpsd,date:String(r.psltRflYmd),band:+r.wnBndNo,
    num:String(r.wnRnkVl).padStart(6,'0'),bonus:String(r.bnsRnkVl).padStart(6,'0')}))
    .sort((a,b)=>a.ep-b.ep);
  // 당첨매수는 브리핑에 쓰는 최근 12회만 (전량은 느리고 브리핑에 불필요)
  const recent=rows.slice(-12);
  for(const r of recent){
    try{
      const j=await jget(P720+'selectPstPt720WnInfo.do?srchPsltEpsd='+r.ep);
      const cnt={},net={};
      (j.data.result||[]).forEach(x=>{ cnt[x.wnRnk]=x.wnTotalCnt; net[x.wnRnk]=x.wnInternetCnt; });
      if(Object.keys(cnt).length){ r.cnt=cnt; r.net=net; }
    }catch(e){}
  }
  return rows;
}
/* 최신 회차 탐지
   근거 — API 는 center-5..center+4 를 주고 center 가 아직 없으면 빈 배열을 준다.
          따라서 «center=latest+1 이 비었다» == «latest 가 마지막 회차» 다.

   [2026-08-30 버그 수정] 구버전은 상수 1238 에서 시작해 latest+5 를 찔렀다.
   주 1회 추첨이라 실제로는 늘 1회만 뒤처지고, 그 +5 자리는 아직 비어 있으므로
   첫 반복에서 곧바로 break → latest 가 1238 에 영구 고정됐다.
   brief.html 이 계속 «최신 1238회 / 다음 1239회» 로 나온 직접 원인이다.
   시작점도 상수 대신 추첨 달력(1회차 2002-12-07, 주 1회)에서 추정한다. */
async function getLotto(){
  const est=Math.floor((Date.now()-Date.UTC(2002,11,7))/(7*864e5))+1;
  let latest=0;
  for(let g=est+5,t=0; g>=1 && t<12; g-=5,t++){
    const l=(await jget(L645+g)).data.list||[];
    if(l.length){ latest=Math.max(...l.map(x=>+x.ltEpsd)); break; }
  }
  if(!latest) throw new Error('최신 회차 탐지 실패 — API 응답이 모두 비어 있습니다');
  for(let i=0;i<20;i++){
    const l=(await jget(L645+(latest+1))).data.list||[];
    if(!l.length) break;
    const m=Math.max(...l.map(x=>+x.ltEpsd));
    if(m>latest) latest=m; else break;
  }
  const all={};
  for(let c=latest;c>-4;c-=10){
    const l=(await jget(L645+Math.max(c,3))).data.list||[];
    l.forEach(x=>{ all[+x.ltEpsd]=x; });
    await sleep(50);
  }
  const eps=Object.keys(all).map(Number).sort((a,b)=>a-b);
  return {latest, rows:eps.map(e=>all[e])};
}

/* 데이터 캐시 — 같은 실행(Actions 한 잡) 안에서 스크립트끼리 한 번 받은 데이터를 나눠 쓴다.
   [2026-09-23] weekly-brief → validate 가 연달아 동행복권을 수백 번 부르자
   세 번째 호출자(validate)가 «fetch failed» 로 죽었다. --cache 를 주면 먼저 받은 쪽이 저장하고
   다음 쪽은 네트워크 없이 그대로 읽는다. 주지 않으면 예전처럼 직접 받는다. */
async function getData(){
  const cache=arg('--cache',null);
  if(cache && fs.existsSync(cache)){
    try{
      const o=JSON.parse(fs.readFileSync(cache,'utf8'));
      if(o.pension&&o.pension.length&&o.lotto&&o.lotto.rows&&o.lotto.rows.length){
        console.error('      데이터 캐시 사용: '+cache); return [o.pension,o.lotto];
      }
    }catch(e){ console.error('      캐시 읽기 실패, 새로 받습니다: '+e.message); }
  }
  const [pension, lotto] = await Promise.all([getPension(), getLotto()]);
  if(cache){ try{ fs.writeFileSync(cache, JSON.stringify({at:new Date().toISOString(),pension,lotto})); }catch(e){} }
  return [pension, lotto];
}

/* ── 2. 도구를 실제로 띄워 추천을 꺼낸다 ─────────────────────── */
async function withBrowser(fn){
  let chromium;
  for(const p of ['playwright','/home/claude/.npm-global/lib/node_modules/playwright/index.mjs',
                  '/usr/lib/node_modules/playwright/index.mjs']){
    try{ ({chromium}=await import(p)); break; }catch(e){}
  }
  if(!chromium) throw new Error('playwright 없음');
  const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  try{ return await fn(b); } finally{ await b.close(); }
}
function serve(dir){
  const types={'.html':'text/html; charset=utf-8','.json':'application/json','.js':'text/javascript'};
  const s=http.createServer((q,res)=>{
    const f=path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html');
    if(!f.startsWith(dir)||!fs.existsSync(f)){ res.statusCode=404; return res.end('nf'); }
    res.setHeader('Content-Type', types[path.extname(f)]||'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
  return new Promise(r=>s.listen(0,'127.0.0.1',()=>r({srv:s,port:s.address().port})));
}
async function mockRoutes(ctx, pension, lotto){
  const pRows=pension.slice().sort((a,b)=>b.ep-a.ep);
  await ctx.route('**dhlottery.co.kr/**', route=>{
    const u=route.request().url();
    const json=o=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
    if(u.includes('selectPstPt720WnList')) return json({data:{result:pRows.map(r=>({
      psltEpsd:r.ep,psltRflYmd:r.date,wnBndNo:String(r.band),wnRnkVl:r.num,bnsRnkVl:r.bonus}))}});
    if(u.includes('selectPstPt720WnInfo')){
      const ep=+(u.match(/srchPsltEpsd=(\d+)/)||[])[1];
      const r=pension.find(x=>x.ep===ep);
      if(!r||!r.cnt) return json({data:{result:[]}});
      return json({data:{result:Object.keys(r.cnt).map(k=>({wnRnk:+k,
        wnTotalCnt:r.cnt[k], wnInternetCnt:(r.net||{})[k]||0, wnStoreCnt:0}))}});
    }
    if(u.includes('selectPstLt645InfoNew')){
      const c=+(u.match(/srchLtEpsd=(\d+)/)||[])[1];
      let l=lotto.rows.filter(x=>+x.ltEpsd>=c-5 && +x.ltEpsd<=c+4);
      if(!l.length) l=lotto.rows.slice(-10);
      return json({data:{list:l.slice().sort((a,b)=>b.ltEpsd-a.ltEpsd)}});
    }
    return json({data:{}});
  });
  await ctx.route('**fonts.googleapis.com/**', r=>r.abort());
  await ctx.route('**fonts.gstatic.com/**', r=>r.abort());
}

/* ── 3. 페이지에서 값 꺼내기 ─────────────────────────────────── */
async function readPension(browser, base, pension, lotto){
  const ctx=await browser.newContext(); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{
    const S=predSettings(), nx=nextDraw(), rows=R();
    const last=rows[rows.length-1];
    const start=Math.min(100,Math.floor(rows.length*0.3));
    const bt=backtest(S.model,S.K,S.J,start);
    const next=generate(S.model,S.K,S.J,10,nx.ep*7919);
    const {pos,band}=currentScores(S.model,nx.ep*7919);
    const tops=pos.map(s=>topIdx(s,S.K).map(d=>({d,v:s[d]})));
    const bTop=topIdx(band,S.J).map(i=>({b:i+1,v:band[i]}));
    // 지난주 재현 — 마지막 회차를 빼고 같은 규칙으로 다시 뽑는다
    const keep=rows.slice();
    DB.rounds=rows.slice(0,-1);
    const prev=generate(S.model,S.K,S.J,10,last.ep*7919);
    const btPrev=backtest(S.model,S.K,S.J,Math.min(100,Math.floor(DB.rounds.length*0.3)));
    DB.rounds=keep;
    const graded=prev.map(c=>({...c, g:gradeOf(c.band,c.num,last)}));
    const cnt=last.cnt||{};
    return {
      settings:S, last, next:{ep:nx.ep,date:nx.date}, picks:next, prevPicks:graded,
      bt:{rate:bt.rateD,base:bt.baseD,ci:bt.ciD,p:bt.pD,n:bt.totD,from:bt.start,to:bt.end},
      btPrevRate: btPrev? btPrev.rateD : null,
      tops, bTop, rounds:rows.length,
      sold: cnt[7]!=null ? cnt[7]/9e-2 : null,
      w1: cnt[1], w2: cnt[2], wB: cnt[8],
      ranks: RANKS.map(x=>({name:x.name,p:x.p,amt:x.amt}))
    };
  });
  await ctx.close(); return r;
}
async function readLotto(browser, base, pension, lotto){
  const ctx=await browser.newContext(); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  await p.goto(base+'/index.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100
    &&DB.draws&&DB.draws[DB.latest],{timeout:120000});
  await p.waitForTimeout(2000);
  const r=await p.evaluate(()=>{
    /* [2026-09-03] index.html 이 캐시를 DB.rev 로 무효화하도록 바뀌었다.
       rows(0) 결과를 담는 ROWS_CACHE 가 새로 생겼는데 이 함수는 그걸 모른다 →
       DB 를 잘라도 낡은 배열이 그대로 나와 «지난주 추천»이 조용히 틀린다.
       페이지가 제공하는 bumpDB() 를 쓰는 것이 정답이고, 옛 index.html 과도 호환되게 fallback 을 둔다. */
    const reset=()=>{
      WEEKLY=null; WEEKLY_R=0; POPFIT=null; POPFIT_N=-1; WINSET=null; WINSET_N=-1;
      if(typeof WEEKLY_REV!=='undefined') WEEKLY_REV=-1;
      if(typeof bumpDB==='function') bumpDB();
      else if(typeof ROWS_CACHE!=='undefined') ROWS_CACHE=null;
    };
    reset();
    const L=DB.latest, last=DB.draws[L];
    const W=weeklyPicks();                       // L+1 회차 대상
    const F=(typeof fitPop==='function')?fitPop():{};
    // 지난주 재현
    const savedRow=DB.draws[L];
    DB.draws[L]=undefined; DB.latest=L-1; reset();
    const prev=weeklyPicks();                    // L 회차 대상
    DB.draws[L]=savedRow; DB.latest=L; reset();
    const wn=last.n.slice(), bn=last.b;
    const graded=prev.combos.map(c=>{
      const hit=c.filter(n=>wn.includes(n)).length;
      const bonus=c.includes(bn);
      let g=0;
      if(hit===6) g=1; else if(hit===5&&bonus) g=2; else if(hit===5) g=3;
      else if(hit===4) g=4; else if(hit===3) g=5;
      return {c,hit,bonus,g};
    });
    return {
      latest:L, last:{r:last.r,ymd:last.ymd,n:last.n,b:last.b,w:last.w,a:last.a,s:last.s,t:last.t},
      target:W.round, picks:W.combos, prevPicks:graded, prevTarget:prev.round,
      agree: F&&F.agree!=null?F.agree:null
    };
  });
  await ctx.close(); return r;
}

/* ── 4. 브리핑 HTML ─────────────────────────────────────────── */
const fmt=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ko-KR');
const pctS=(x,d=2)=>(x*100).toFixed(d)+'%';
const dstr=s=>s?`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`:'—';
const ballColor=n=>n<=10?'#FBC400':n<=20?'#69C8F2':n<=30?'#FF7272':n<=40?'#A0A6A2':'#B0D840';
const ball=(n,hit)=>`<span class="ball" style="background:${ballColor(n)};${hit?'':'opacity:.28'}">${n}</span>`;
const digits=(num,hi)=>String(num).padStart(6,'0').split('')
  .map((c,i)=>`<span class="dg${hi&&hi.includes(i)?' hi':''}">${c}</span>`).join('');
const GRADE=['미당첨','1등','2등','3등','4등','5등','6등','7등','보너스'];
const MODELNAME={freq:'빈도',cold:'역빈도',recent:'최근가중',gap:'갭',rand:'무작위'};

function buildHTML(P,L,meta){
  const pHit=P.prevPicks.filter(x=>x.g>0);
  const lHit=L.prevPicks.filter(x=>x.g>0);
  const css=`
:root{--paper:#EEF0EB;--paper-2:#F7F8F5;--ink:#16302B;--ink-60:rgba(22,48,43,.60);--ink-40:rgba(22,48,43,.40);
 --ink-12:rgba(22,48,43,.12);--ink-06:rgba(22,48,43,.06);--sig:#B0281A;--ok:#1F6F4A}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#12181A;--paper-2:#182022;
 --ink:#E6EDE9;--ink-60:rgba(230,237,233,.62);--ink-40:rgba(230,237,233,.40);
 --ink-12:rgba(230,237,233,.14);--ink-06:rgba(230,237,233,.06);--sig:#FF8A78;--ok:#7FD8A8}}
:root[data-theme="dark"]{--paper:#12181A;--paper-2:#182022;--ink:#E6EDE9;--ink-60:rgba(230,237,233,.62);
 --ink-40:rgba(230,237,233,.40);--ink-12:rgba(230,237,233,.14);--ink-06:rgba(230,237,233,.06);--sig:#FF8A78;--ok:#7FD8A8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
 font-size:15px;line-height:1.68;letter-spacing:-.01em;padding:0 0 70px}
.wrap{max-width:940px;margin:0 auto;padding:18px 14px 0}
.mono{font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
header{border-bottom:1.5px solid var(--ink);padding-bottom:12px;margin-bottom:22px}
.eyebrow{font-family:ui-monospace,monospace;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-60);
 display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.eyebrow a{color:var(--ink-60)}
h1{font-size:clamp(30px,7vw,46px);line-height:1.06;font-weight:800;padding:12px 0 4px;letter-spacing:-.02em}
h1 small{display:block;font-size:.34em;font-weight:600;color:var(--ink-60);letter-spacing:.04em;padding-top:8px}
h2{font-family:ui-monospace,monospace;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
 padding:0 0 12px;display:flex;align-items:center;gap:10px;margin-top:34px}
h2::after{content:"";flex:1;height:1px;background:var(--ink-12)}
h3{font-size:14px;font-weight:700;padding:16px 0 8px;color:var(--ink-60)}
p.note{font-size:13.5px;color:var(--ink-60);padding-bottom:12px;line-height:1.7}
p.note b{color:var(--ink)}
.card{background:var(--paper-2);border:1.5px solid var(--ink);padding:16px 15px;margin-bottom:12px}
.card.flat{border-width:1px;border-color:var(--ink-12)}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px;background:var(--ink-12);
 border:1.5px solid var(--ink);margin-bottom:16px}
.kpi>div{background:var(--paper-2);padding:12px 11px}
.kpi .k{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60)}
.kpi .v{font-size:27px;font-weight:800;line-height:1.12;padding-top:3px;letter-spacing:-.02em}
.kpi .s{font-size:12px;color:var(--ink-60)}
.ball{width:31px;height:31px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
 font-family:ui-monospace,monospace;font-weight:700;font-size:12.5px;color:#16302B;flex:none}
.balls{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.dg{width:25px;height:31px;border:1px solid var(--ink-40);display:inline-flex;align-items:center;justify-content:center;
 font-family:ui-monospace,monospace;font-weight:700;font-size:14px;background:var(--paper-2);flex:none}
.dg.hi{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tk{display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap}
.bnd{font-weight:800;font-size:19px;border:1.5px solid var(--ink);padding:2px 8px;line-height:1.25}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:8px 6px;text-align:left;border-bottom:1px solid var(--ink-12);vertical-align:middle}
th{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60)}
td.num,th.num{text-align:right;font-family:ui-monospace,monospace}
tr.win td{background:var(--ink-06)}
.rk{font-weight:800;font-size:19px;width:30px;color:var(--ink-40)}
.rk.top{color:var(--ink)}
.scroll{overflow-x:auto}
.tag{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.06em;padding:2px 6px;border:1px solid currentColor;white-space:nowrap}
.tag.sig{color:var(--sig)}.tag.noi{color:var(--ink-40)}.tag.ok{color:var(--ok)}
.verdict{border-left:3px solid var(--ink);padding:10px 0 10px 12px;margin:12px 0;font-size:13.5px;color:var(--ink-60)}
.verdict b{color:var(--ink)}
.verdict.ok{border-color:var(--ok)}
.foot{font-size:12px;color:var(--ink-40);border-top:1px solid var(--ink-12);margin-top:30px;padding-top:14px;line-height:1.8}
@media print{body{background:#fff;padding:0}.card{break-inside:avoid}h2{break-after:avoid}}
@page{margin:14mm}`;

  const pRows=P.picks.map((c,i)=>`<tr><td class="rk ${i<3?'top':''}">${i+1}</td>
    <td><span class="tk"><span class="bnd">${c.band}</span><span style="font-size:11px;color:var(--ink-60)">조</span>
    &nbsp;${digits(c.num)}</span></td>
    <td class="num" style="font-size:12px;color:var(--ink-60)">${c.band}조 ${c.num}</td></tr>`).join('');

  const pPrev=P.prevPicks.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+1}</td>
    <td><span class="tk"><span class="bnd" style="font-size:15px">${x.band}</span>
    <span style="font-size:11px;color:var(--ink-60)">조</span>&nbsp;${digits(x.num, x.g>=3&&x.g<=7?Array.from({length:8-x.g},(_,k)=>5-k):(x.g&&x.g!==0?[0,1,2,3,4,5]:null))}</span></td>
    <td class="num">${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');

  const lRows=L.picks.map((c,i)=>{
    const s=c.reduce((a,b)=>a+b,0), odd=c.filter(n=>n%2).length;
    return `<tr><td class="rk ${i<3?'top':''}">${i+1}</td>
      <td><span class="balls">${c.map(n=>ball(n,true)).join('')}</span></td>
      <td class="num" style="font-size:12px;color:var(--ink-60)">합 ${s}<br>홀${odd}:짝${6-odd}</td></tr>`;}).join('');

  const lPrev=L.prevPicks.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+1}</td>
    <td><span class="balls">${x.c.map(n=>ball(n, L.last.n.includes(n)||n===L.last.b)).join('')}</span></td>
    <td class="num">${x.hit}개${(x.bonus&&x.hit===5)?'+보너스':''} ${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');

  const topRow=P.tops.map((t,i)=>`<tr><td>${['십만','만','천','백','십','일'][i]}</td>`+
    t.map(o=>`<td class="num"><b>${o.d}</b> <span style="color:var(--ink-60);font-size:11px">${o.v}회</span></td>`).join('')+`</tr>`).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>주간 복권 브리핑 · ${meta.date}</title><style>${css}</style></head><body>
<div class="wrap">
<header>
  <div class="eyebrow"><span>Weekly Lottery Brief</span>
    <span><a href="./carryover.html">전주 반영 분석</a> · <a href="./validate.html">검증 보드</a> · <a href="./pension.html">PENSION LAB</a> · <a href="./index.html">LOTTO LAB</a></span></div>
  <h1>주간 복권 브리핑<small>${meta.date} (금) 작성 · 연금복권720+ ${P.next.ep}회 / 로또 6/45 ${L.target}회 대상</small></h1>
</header>

<div class="kpi">
  <div><div class="k">연금 지난 회차</div><div class="v">${P.last.ep}회</div><div class="s">${dstr(P.last.date)}</div></div>
  <div><div class="k">연금 지난주 적중</div><div class="v">${pHit.length}<span style="font-size:16px;color:var(--ink-60)">/10</span></div><div class="s">${pHit.length?pHit.map(x=>GRADE[x.g]).join(', '):'없음'}</div></div>
  <div><div class="k">로또 지난 회차</div><div class="v">${L.last.r}회</div><div class="s">${dstr(L.last.ymd)}</div></div>
  <div><div class="k">로또 지난주 적중</div><div class="v">${lHit.length}<span style="font-size:16px;color:var(--ink-60)">/10</span></div><div class="s">${lHit.length?lHit.map(x=>GRADE[x.g]).join(', '):'없음'}</div></div>
  <div><div class="k">연금 추정 판매</div><div class="v">${P.sold?(P.sold/1e6).toFixed(2):'—'}<span style="font-size:16px">백만</span></div><div class="s">발행 1,000만매 대비 ${P.sold?pctS(P.sold/1e7,0):'—'}</div></div>
</div>

<h2>연금복권 720+ · ${P.next.ep}회 (${dstr(P.next.date)} 목 추첨)</h2>
<div class="card">
  <p class="note">공식 안내: 「복권 번호는 한 회차당 1개 번호만 인쇄됩니다」 · 「인쇄된 번호와 동일한 번호를 인터넷에서도 판매하고 있습니다」.<br>  즉 (조, 6자리) 조합 하나에 실물은 <b>판매점 1장 + 인터넷 1장</b>뿐이라 원하는 번호가 이미 팔렸을 수 있습니다. <b>1순위부터 시도하고 안 되면 다음 순위로</b> 내려가세요. 조가 걸리면 <b>세트</b>(같은 번호 1~5조 5장, 5,000원)로 사면 조를 고르지 않아도 됩니다 — 번호가 1등이면 한 장이 1등, 나머지 넷이 2등이 되어 <b>월 700만원×20년 + 월 400만원×10년</b>입니다.</p>
  <div class="scroll"><table><tr><th>순위</th><th>조 · 번호</th><th class="num">표기</th></tr>${pRows}</table></div>
</div>
<h3>자리별 상위 ${P.settings.K} — «${MODELNAME[P.settings.model]||P.settings.model}» 모델 기준 (괄호는 미출현 회차)</h3>
<div class="card flat"><div class="scroll"><table>
  <tr><th>자리</th><th class="num">1순위</th><th class="num">2순위</th><th class="num">3순위</th></tr>${topRow}
  <tr><td><b>조</b></td>${P.bTop.map(o=>`<td class="num"><b>${o.b}조</b> <span style="color:var(--ink-60);font-size:11px">${o.v}회</span></td>`).join('')}${'<td></td>'.repeat(Math.max(0,3-P.bTop.length))}</tr>
</table></div></div>

<h3>지난 회차 결과 · ${P.last.ep}회</h3>
<div class="card flat">
  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding-bottom:10px">
    <span class="tk"><span class="bnd">${P.last.band}</span><span style="font-size:11px;color:var(--ink-60)">조</span>&nbsp;${digits(P.last.num)}</span>
    <span style="font-size:12px;color:var(--ink-60)">보너스 ${digits(P.last.bonus)}</span>
  </div>
  <p class="note" style="padding:0">1등 ${P.w1!=null?P.w1+'매':'—'} · 2등 ${P.w2!=null?P.w2+'매':'—'} · 보너스 ${P.wB!=null?P.wB+'매':'—'}
    ${P.w1===0?'<b>(1등 미판매 — 그 조합을 아무도 사지 않았습니다)</b>':''}</p>
</div>
<h3>지난주에 낸 10개는 어땠나</h3>
<div class="card flat"><div class="scroll"><table><tr><th>순위</th><th>조 · 번호</th><th class="num">결과</th></tr>${pPrev}</table></div>
  <p class="note" style="padding:10px 0 0">${P.last.ep}회를 대상으로 <b>지난주와 같은 규칙</b>으로 다시 뽑은 목록입니다(회차 번호가 시드라 재현됩니다).</p></div>

<h2>로또 6/45 · ${L.target}회 (토 추첨)</h2>
<div class="card">
  <div class="scroll"><table><tr><th>순위</th><th>번호</th><th class="num">특성</th></tr>${lRows}</table></div>
  <p class="note" style="padding:10px 0 0">분배 인원 모델 점수가 낮은 순. ${L.agree!=null?`두 모델 교차검증 상관 <b>${L.agree.toFixed(3)}</b>.`:''}
    1등 확률은 1/8,145,060 그대로이고, 바뀌는 것은 당첨 시 나눠 갖는 인원뿐입니다.</p>
</div>
<h3>지난 회차 결과 · ${L.last.r}회</h3>
<div class="card flat">
  <div class="balls" style="padding-bottom:10px">${L.last.n.map(n=>ball(n,true)).join('')}
    <span style="color:var(--ink-40);padding:0 4px">+</span>${ball(L.last.b,true)}</div>
  <p class="note" style="padding:0">1등 ${fmt(L.last.w[0])}명 · 1인 ${fmt(L.last.a[0])}원 · 총 판매 ${L.last.s?fmt(L.last.s/1e8)+'억원':'—'}</p>
</div>
<h3>지난주에 낸 10개는 어땠나</h3>
<div class="card flat"><div class="scroll"><table><tr><th>순위</th><th>번호</th><th class="num">결과</th></tr>${lPrev}</table></div></div>

<h2>이번 주에 기억할 것</h2>
<div class="verdict ok">
  <b>연금복권</b> — 당첨금이 고정액이라 당첨자가 2명이어도 각자 월 700만원을 그대로 받습니다.
  번호 선택으로 확률도 당첨금도 바뀌지 않습니다. 위 10개는 «규칙이 정해진 선택»일 뿐입니다.<br>
  낱장 5장과 세트 5장은 <b>기대값이 정확히 같습니다</b>(둘 다 5,000원에 3,750원, 환급률 75%).
  세트는 대박이 21.6억으로 크고, 낱장은 2등 단독 당첨 같은 중간 기회가 더 자주 옵니다. 취향의 문제입니다.<br>
  이 설정의 백테스트 적중률 <b>${pctS(P.bt.rate)}</b> · 우연 기준선 ${pctS(P.bt.base,0)} ·
  95% 신뢰구간 [${pctS(P.bt.ci[0],1)}, ${pctS(P.bt.ci[1],1)}] · p=${P.bt.p.toFixed(3)}
  (${P.bt.from}~${P.bt.to}회, 표본 ${fmt(P.bt.n)}건)
</div>
<div class="verdict">
  <b>로또</b> — 여기서는 «분배 인원»만 바꿀 수 있습니다. 확률은 고정이고, 효과는 walk-forward 300주로 실측해 <b>약 +7%</b> 입니다.
  (이전에 적었던 ±10~15% 는 재보정 전 계수로 계산한 과대평가였습니다.)
</div>

<div class="foot">
  동행복권 공식 API 자료로 자동 생성 · 생성 시각 ${meta.stamp} (KST)<br>
  연금복권 ${P.rounds}회 / 로또 ${L.latest}회 전수 반영. 번호는 예측이 아니라 규칙에 따른 선택입니다.<br>
  복권 구매는 감당할 수 있는 범위 안에서. 만 19세 미만은 구매할 수 없습니다.
</div>
</div></body></html>`;
}

/* ── 5. main ────────────────────────────────────────────────── */
(async function main(){
  const t0=Date.now();
  console.error('[1/4] 데이터 수집…');
  const [pension, lotto] = await getData();
  console.error(`      연금 ${pension.length}회(최신 ${pension.at(-1).ep}) · 로또 ${lotto.rows.length}회(최신 ${lotto.latest})`);

  for(const f of ['pension.html','index.html']){
    if(!fs.existsSync(path.join(ROOT,f))) throw new Error(`${f} 를 ${ROOT} 에서 찾을 수 없습니다 (--root 확인)`);
  }
  console.error('[2/4] 도구 구동…');
  const {srv,port}=await serve(ROOT);
  const base='http://127.0.0.1:'+port;
  let P,L;
  try{
    await withBrowser(async b=>{
      P=await readPension(b,base,pension,lotto);
      console.error('      연금 OK · 다음 '+P.next.ep+'회 · 추천 '+P.picks.length+'개');
      L=await readLotto(b,base,pension,lotto);
      console.error('      로또 OK · 다음 '+L.target+'회 · 추천 '+L.picks.length+'개');
    });
  } finally { srv.close(); }

  console.error('[3/4] 브리핑 작성…');
  const now=KST();
  const meta={date:kstStr(now), stamp:now.toISOString().slice(0,16).replace('T',' ')};
  const html=buildHTML(P,L,meta);

  console.error('[4/4] 저장…');
  fs.mkdirSync(path.join(OUT,'brief'),{recursive:true});
  /* 예약 실행은 매번 빈 폴더에서 시작한다. 지난 호를 먼저 옮겨와야 목차가 끊기지 않는다. */
  const seed=arg('--seed-archive',null);
  if(seed && fs.existsSync(seed)){
    for(const f of fs.readdirSync(seed)){
      if(!/^\d{4}-\d{2}-\d{2}\.html$/.test(f)) continue;
      const dst=path.join(OUT,'brief',f);
      if(!fs.existsSync(dst)) fs.copyFileSync(path.join(seed,f),dst);
    }
  }
  const latestPath=path.join(OUT,'brief.html');
  const archPath=path.join(OUT,'brief',`${meta.date}.html`);
  fs.writeFileSync(latestPath,html);
  // 아카이브 사본은 brief/ 안에 놓이므로 루트 상대경로를 한 단계 올려준다.
  // (./pension.html 은 brief/pension.html 로 404, ./index.html 은 아카이브 목차로 잘못 연결됐음)
  fs.writeFileSync(archPath, html.replace(/href="\.\/(?!\d{4}-)/g,'href="../'));

  // 아카이브 목차
  const files=fs.readdirSync(path.join(OUT,'brief')).filter(f=>/^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
  fs.writeFileSync(path.join(OUT,'brief','index.html'),
`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>주간 복권 브리핑 · 지난 호</title><style>
body{font-family:"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;max-width:640px;margin:0 auto;padding:28px 16px;
background:#EEF0EB;color:#16302B;line-height:1.7}
@media(prefers-color-scheme:dark){body{background:#12181A;color:#E6EDE9}a{color:#E6EDE9}}
h1{font-size:24px;padding-bottom:6px}a{color:#16302B}
ul{list-style:none;padding:0}li{border-bottom:1px solid rgba(128,128,128,.25);padding:11px 0}
</style></head><body><h1>주간 복권 브리핑</h1>
<p><a href="../brief.html">→ 최신 호</a> · <a href="../pension.html">PENSION LAB</a> · <a href="../index.html">LOTTO LAB</a></p>
<ul>${files.map(f=>`<li><a href="./${f}">${f.replace('.html','')}</a></li>`).join('')}</ul>
</body></html>`);

  const pHit=P.prevPicks.filter(x=>x.g>0), lHit=L.prevPicks.filter(x=>x.g>0);
  const summary={
    date:meta.date, seconds:Math.round((Date.now()-t0)/1000),
    files:[latestPath,archPath,path.join(OUT,'brief','index.html')],
    pension:{last:P.last.ep, next:P.next.ep, hits:pHit.length,
      hitDetail:pHit.map(x=>`${x.band}조 ${x.num} → ${GRADE[x.g]}`),
      picks:P.picks.map(c=>`${c.band}조 ${c.num}`),
      backtest:`${pctS(P.bt.rate)} (기준선 ${pctS(P.bt.base,0)}, p=${P.bt.p.toFixed(3)})`},
    lotto:{last:L.last.r, next:L.target, hits:lHit.length,
      hitDetail:lHit.map(x=>`${x.c.join(',')} → ${GRADE[x.g]}`),
      picks:L.picks.map(c=>c.join(','))}
  };
  fs.writeFileSync(path.join(OUT,'brief','latest-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  console.error(`완료 · ${summary.seconds}초 · ${latestPath}`);
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
