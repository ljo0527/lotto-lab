#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   주간 복권 브리핑 생성기 — 연금복권720+ / 로또 6/45
   매주 실행. 결과물: <out>/brief.html (= «이번 주», 새 홈) + <out>/brief/<날짜>.html
   + <out>/brief/index.html(지난 호) + <out>/brief/latest-summary.json
   + <out>/brief/week.json(같은 데이터 blob) + <out>/brief/pension-history.json

   설계 핵심 — 추천 번호 로직을 여기에 다시 구현하지 않는다.
   pension.html·index.html 을 헤드리스 브라우저에 실제로 띄우고,
   네트워크만 로컬에서 받아온 데이터로 가로채 먹인 뒤 결과를 꺼낸다.
   → 도구를 고치면 브리핑도 자동으로 따라온다. 두 벌 관리가 생기지 않는다.

   «지난주 추천» 은 페이지 안에서 DB 를 한 회차 잘라내고 다시 계산시킨다.
   추천이 회차번호 시드로 결정되므로 지난주에 보였던 것과 동일하게 재현된다.

   [2026-09] PLAN §2 신규 함수(코드 지도 R1/R3, D1/D2)는 이 스크립트와 병행해
   다른 작업자가 index.html/pension.html 에 추가하는 중이다. 모두 typeof 로
   존재를 먼저 확인하고, 없으면 예전 방식(legacy)으로 그대로 동작한다 —
   이 스크립트가 실행되는 시점에 어느 쪽이 아직 반영 전이어도 죽지 않는다.
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { siteCSS, siteJS, gnav as sharedGnav, FOOT } from './site-shared.mjs';

const arg=(k,d)=>{ const i=process.argv.indexOf(k); return i>0?process.argv[i+1]:d; };
const ROOT=path.resolve(arg('--root', process.cwd()));
const OUT =path.resolve(arg('--out', ROOT));
const KST =()=>new Date(Date.now()+9*3600e3);
const kstStr=d=>d.toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const WEEKDAY_KO='일월화수목금토';

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
  // D2 D6 / PLAN: 두 스크립트 모두 서비스워커를 막는다(생성 실행에 캐시가 끼어들지 않게).
  const ctx=await browser.newContext({serviceWorkers:'block'}); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{
    const S=predSettings(), nx=nextDraw(), rows=R();
    const last=rows[rows.length-1];
    const start=Math.min(100,Math.floor(rows.length*0.3));
    const bt=backtest(S.model,S.K,S.J,start);

    const hasWeekly = typeof pensionWeekly==='function';
    const hasPortfolio = typeof pensionPortfolio==='function';
    const modeConst = (typeof PENSION_MODE!=='undefined') ? PENSION_MODE : 'spread';
    const seedNext = nx.ep*7919;

    // 이번 주 추천 — PLAN §1.1/§1.3: pensionWeekly() 가 있으면 그걸(=포트폴리오 규칙),
    // 없으면 예전 generate() top-10 (앞 5장=구매, 뒤 5장=예비) 그대로.
    let nextW;
    if(hasWeekly){
      try{ nextW = pensionWeekly(); }catch(e){ nextW=null; }
    }
    if(!nextW){
      const picks10 = generate(S.model,S.K,S.J,10,seedNext);
      nextW = {mode:null, seed:seedNext, buy:picks10.slice(0,5), alts:picks10.slice(5,10),
        fallback:null, picks:picks10, dist:null, rule:'legacy'};
    }

    // 두 매수 구조(분산/세트) 미리보기 — D2 §2.2 토글용. 있으면 둘 다 계산해 embed.
    let planSpread=null, planSet=null;
    if(hasPortfolio){
      try{ planSpread = pensionPortfolio('spread', S, seedNext); }catch(e){}
      try{ planSet   = pensionPortfolio('set',   S, seedNext); }catch(e){}
    }

    const {pos,band}=currentScores(S.model,seedNext);
    const tops=pos.map(s=>topIdx(s,S.K).map(d=>({d,v:s[d]})));
    const bTop=topIdx(band,S.J).map(i=>({b:i+1,v:band[i]}));

    // 지난주 재현 — 마지막 회차를 빼고 같은 규칙으로 다시 뽑는다
    const keep=rows.slice();
    DB.rounds=rows.slice(0,-1);
    let prevW;
    if(hasWeekly){
      try{ prevW = pensionWeekly(); }catch(e){ prevW=null; }
    }
    if(!prevW){
      const prevPicks10 = generate(S.model,S.K,S.J,10,last.ep*7919);
      prevW = {buy:prevPicks10.slice(0,5), alts:prevPicks10.slice(5,10), picks:prevPicks10};
    }
    const btPrev=backtest(S.model,S.K,S.J,Math.min(100,Math.floor(DB.rounds.length*0.3)));
    DB.rounds=keep;

    const gradeIt=c=>({...c, g:gradeOf(c.band,c.num,last)});
    const prevBuyGraded = (prevW.buy||[]).map(gradeIt);
    const prevAltsGraded = (prevW.alts||[]).map(gradeIt);
    const prevAllGraded = (prevW.picks||prevW.buy.concat(prevW.alts||[])).map(gradeIt);

    const cnt=last.cnt||{};
    return {
      settings:S, last, next:{ep:nx.ep,date:nx.date},
      mode: nextW.mode || modeConst, rule: nextW.rule || 'portfolio',
      buy: nextW.buy, alts: nextW.alts||[], fallback: nextW.fallback||null,
      planSpread, planSet,
      prevPicks: prevAllGraded, prevBuy: prevBuyGraded, prevAlts: prevAltsGraded,
      bt:{rate:bt.rateD,base:bt.baseD,ci:bt.ciD,p:bt.pD,n:bt.totD,from:bt.start,to:bt.end},
      btPrevRate: btPrev? btPrev.rateD : null,
      tops, bTop, rounds: rows.length,
      sold: cnt[7]!=null ? cnt[7]/9e-2 : null,
      w1: cnt[1], w2: cnt[2], wB: cnt[8],
      ranks: RANKS.map(x=>({name:x.name,p:x.p,amt:x.amt}))
    };
  });
  await ctx.close(); return r;
}
async function readLotto(browser, base, pension, lotto){
  const ctx=await browser.newContext({serviceWorkers:'block'}); await mockRoutes(ctx,pension,lotto);
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
    const C456v=(typeof C456!=='undefined')?C456:8145060;
    const TICKETv=(typeof TICKET!=='undefined')?TICKET:1000;
    const P_LINEv=(typeof P_LINE!=='undefined')?P_LINE:194130/C456v;

    const W=weeklyPicks();                       // L+1 회차 대상
    const F=(typeof fitPop==='function')?fitPop():{};

    // 지난주 재현
    const savedRow=DB.draws[L];
    DB.draws[L]=undefined; DB.latest=L-1; reset();
    const prev=weeklyPicks();                    // L 회차 대상
    DB.draws[L]=savedRow; DB.latest=L; reset();

    const gradeLine=(c,d)=>{
      if(typeof rankOf==='function') return rankOf(c,d);
      const hit=c.filter(n=>d.n.includes(n)).length, bonus=c.includes(d.b);
      if(hit===6) return 1; if(hit===5&&bonus) return 2; if(hit===5) return 3;
      if(hit===4) return 4; if(hit===3) return 5; return 0;
    };
    const graded = prev.combos.map(c=>{
      const hit=c.filter(n=>last.n.includes(n)).length;
      const bonus=c.includes(last.b);
      const g=gradeLine(c,last);
      return {c,hit,bonus,g};
    });
    const prevBuyGraded=graded.slice(0,5), prevSparesGraded=graded.slice(5,10);

    // 이번 주 구매 5게임(A~E) / 예비 5게임(F~J)
    const buy5=W.combos.slice(0,5), spares5=W.combos.slice(5,10);

    // 정확 분포(coverExact) — PORTFOLIO 로직이 반영된 뒤에만(typeof 가드). D1 §2/§4.
    let cover=null;
    if(typeof coverExact==='function'){
      try{ cover=coverExact(buy5); }catch(e){}
    }
    const p0 = 1-Math.pow(1-P_LINEv,5);   // 아무렇게나 고른 5게임의 이론적 P(any) — 페이지 상수만 사용, 로직 재구현 아님

    // 라인당 EV(₩) — zOf/lineEV/lottoEVctx 가 모두 있을 때만(그 전엔 —).
    let evBuy=null, evCalib=null;
    if(typeof lineEV==='function' && typeof lottoEVctx==='function' && typeof zOf==='function'){
      try{
        const ctxEV=lottoEVctx();
        evCalib = !!ctxEV.calib;
        const prevN = last ? last.n : null;
        const evs = buy5.map(c=>{
          const z=zOf(c);
          const carry=(typeof carryOf==='function' && prevN) ? carryOf(c,prevN) : 0;
          return lineEV(z,carry,ctxEV);
        });
        if(evs.every(x=>x!=null && !isNaN(x))) evBuy = evs.reduce((a,b)=>a+b,0);
      }catch(e){}
    }

    // 전주 반영 §2.5.1 — λ(무작위 기대 1등 인원), 1인 수령액과 최근 52회 중앙값
    const lambda = (last && last.s!=null) ? last.s/TICKETv/C456v : null;
    let med52=null;
    if(typeof rows==='function'){
      try{
        const a0=rows(52).map(x=>x.a&&x.a[0]).filter(x=>x!=null).sort((a,b)=>a-b);
        if(a0.length) med52=a0[Math.floor((a0.length-1)/2)];
      }catch(e){}
    }
    // 겹침 — 이번 주 추천(A~E) 번호 전체와 직전 당첨번호 6개의 교집합 크기
    const buyUnion=new Set(buy5.flat());
    const overlapK = last ? last.n.filter(n=>buyUnion.has(n)).length : 0;

    return {
      latest:L, last:{r:last.r,ymd:last.ymd,n:last.n,b:last.b,w:last.w,a:last.a,s:last.s,t:last.t},
      target:W.round, picks:W.combos, buy:buy5, spares:spares5,
      rule: W.rule || (W.portfolio ? 'portfolio' : 'legacy'), degraded: W.portfolio ? !!W.portfolio.degraded : null,
      prevPicks: graded, prevBuy:prevBuyGraded, prevSpares:prevSparesGraded, prevTarget:prev.round,
      agree: F&&F.agree!=null?F.agree:null,
      cover, p0, evBuy, evRandom: 5*500, evCalib,
      lambda, med52, overlapK,
      C456:C456v, TICKET:TICKETv
    };
  });
  await ctx.close(); return r;
}

/* ── 4. 브리핑 HTML ─────────────────────────────────────────── */
const fmt=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ko-KR');
const pctS=(x,d=2)=>(x==null||isNaN(x))?'—':(x*100).toFixed(d)+'%';
const eok=(n,d=1)=>(n==null||isNaN(n))?'—':(n/1e8).toFixed(d)+'억';
const mmdd=s=>s?`${s.slice(4,6)}.${s.slice(6,8)}`:'—';
const wdOf=ymd=>{ if(!ymd) return ''; const y=+ymd.slice(0,4),m=+ymd.slice(4,6),d=+ymd.slice(6,8);
  return WEEKDAY_KO[new Date(Date.UTC(y,m-1,d)).getUTCDay()]; };
const ballVar=n=>n<=10?'var(--b-yellow)':n<=20?'var(--b-blue)':n<=30?'var(--b-red)':n<=40?'var(--b-grey)':'var(--b-green)';
const ball=(n,hit)=>`<span class="ball" style="background:${ballVar(n)};${hit?'':'opacity:.28'}">${n}</span>`;
const digits=(num,hi)=>String(num).padStart(6,'0').split('')
  .map((c,i)=>`<span class="dg${hi&&hi.includes(i)?' hi':''}">${c}</span>`).join('');
const GRADE=['미당첨','1등','2등','3등','4등','5등','6등','7등','보너스'];
const esc=s=>String(s).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'); // JSON-in-<script> 이스케이프(</script> 탈출 방지) 전용
const escAttr=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); // HTML 속성값 이스케이프

/* {g} — 정직 문구의 효과 수치. PLAN §1.7: validation.json.lotto.per.portfolio.payoutGain,
   없으면 per.minshare.payoutGain, 그것도 없으면 고정 문구 "약 +7%". 이전 실행(=이미 커밋된 값)만 읽는다 —
   이 스크립트가 새로 계산하지 않는다(그건 validate.mjs 의 역할). */
function readHonestyG(){
  try{
    const vp=path.join(ROOT,'brief','validation.json');
    if(!fs.existsSync(vp)) return {g:null, label:'약 +7%'};
    const v=JSON.parse(fs.readFileSync(vp,'utf8'));
    const per=v&&v.lotto&&v.lotto.per;
    const pg = per && ((per.portfolio&&per.portfolio.payoutGain) ?? (per.minshare&&per.minshare.payoutGain));
    if(pg==null || isNaN(pg)) return {g:null, label:'약 +7%'};
    const pct=(pg*100);
    return {g:pct, label:(pct>=0?'+':'')+pct.toFixed(1)+'%'};
  }catch(e){ return {g:null, label:'약 +7%'}; }
}

function median(arr){
  if(!arr.length) return null;
  const s=arr.slice().sort((a,b)=>a-b);
  return s[Math.floor((s.length-1)/2)];
}

/* 카드 하나(로또 또는 연금)의 슬립/토글/액션을 담는 마크업 조각들을 만든다. */
function lottoBuyCard(L, meta, honesty){
  const rows5=L.buy.map((c,i)=>{
    const s=c.reduce((a,b)=>a+b,0), odd=c.filter(n=>n%2).length;
    return `<div class="slip-row"><span class="slip-k">${'ABCDE'[i]}</span>
      <span class="balls">${c.map(n=>ball(n,true)).join('')}</span>
      <span class="slip-meta mono">합 ${s} · 홀${odd}:짝${6-odd}</span></div>`;
  }).join('');
  const spareRows=L.spares.map((c,i)=>{
    const s=c.reduce((a,b)=>a+b,0), odd=c.filter(n=>n%2).length;
    return `<div class="slip-row"><span class="slip-k">${'FGHIJ'[i]}</span>
      <span class="balls">${c.map(n=>ball(n,true)).join('')}</span>
      <span class="slip-meta mono">합 ${s} · 홀${odd}:짝${6-odd}</span></div>`;
  }).join('');
  const drawYmd=meta.lottoDrawYmd;
  const copyText=[`로또 6/45 제${L.target}회 (${mmdd(drawYmd)} ${wdOf(drawYmd)})`,
    ...L.buy.map((c,i)=>`${'ABCDE'[i]} ${c.map(n=>String(n).padStart(2,'0')).join(' ')}`)].join('\\n');

  let distHTML='';
  if(L.cover){
    distHTML=`<div class="dist-row">5게임 중 1개 이상 5등 이상 <b>${pctS(L.cover.pAny)}</b> · 아무렇게나 고른 5게임 ${pctS(L.p0)}</div>
      <div class="dist-row">4등 이상 <b>${pctS(L.cover.pAny4,3)}</b></div>
      <div class="dist-row">기대 수령액은 번호와 무관</div>`;
  } else {
    distHTML=`<div class="dist-row">정확 분포는 이번 계산에 아직 반영되지 않았습니다(로또 로직 갱신 대기). 아무렇게나 고른 5게임 기준 이론값은 ${pctS(L.p0)}.</div>`;
  }

  return `
<section class="card buycard" data-kind="lotto" data-draw="${drawYmd}" data-draw-kind="lotto">
  <div class="card-head">
    <div><b>로또 6/45</b> · 제${L.target}회 · ${mmdd(drawYmd)}(${wdOf(drawYmd)}) 20:35 추첨</div>
    <span class="chip" data-countdown data-kind="lotto" data-drawymd="${drawYmd}">계산 중…</span>
  </div>
  <div class="slip-hd mono">A~E 5게임 · 5,000원</div>
  <div class="slip">${rows5}</div>
  <div class="actions">
    <button class="btn" data-act="copy" data-kind="lotto" data-text="${escAttr(copyText)}">번호 복사</button>
    <button class="btn" data-act="share" data-kind="lotto" data-title="로또 6/45 제${L.target}회" data-text="${escAttr(copyText)}" hidden>공유</button>
    <button class="btn" data-act="buy" data-kind="lotto" data-round="${L.target}">샀어요</button>
    <a class="btn" href="./index.html#sheet">마크시트</a>
  </div>
  <details><summary>예비 F~J — A~E 중 마음에 안 드는 줄 대신</summary><div class="slip">${spareRows}</div></details>
  <p class="honest">1등 확률은 1/8,145,060 그대로입니다. 바뀌는 건 당첨 시 나눠 갖는 인원이며,
    300주 walk-forward 실측 효과는 <b>${honesty.label}</b>입니다 → <a href="./validate.html">검증</a>.
    ${L.degraded?'<span class="tag sig">주의 · 이번 주는 다양성 제약을 일부 완화했습니다</span>':''}</p>
  <details><summary>결과 분포</summary>${distHTML}</details>
</section>`;
}

function pensionBuyCard(P, meta){
  const drawYmd=meta.pensionDrawYmd;
  const hasPlans = !!(P.planSpread && P.planSet);
  const spreadBuy = (P.planSpread && P.planSpread.buy) || (P.mode==='spread'? P.buy : null);
  const setBuy = (P.planSet && P.planSet.buy) || (P.mode==='set'? P.buy : null);
  const spreadAlts = (P.planSpread && P.planSpread.alts) || (P.mode==='spread'? P.alts : []);
  const setAlts = (P.planSet && P.planSet.alts) || (P.mode==='set'? P.alts : []);

  const ticketRows=(list,hiLast)=>(list||[]).map((t,i)=>
    `<div class="slip-row"><span class="slip-k">${i+1}</span>
      <span class="tk"><span class="bnd">${t.band}</span><span class="bndlabel">조</span>
      ${digits(t.num, hiLast?[5]:null)}</span></div>`).join('');

  const distTable=(d)=>d?`<tr><td>1장 이상 당첨</td><td class="num">${pctS(d.pAny,2)}</td></tr>
    <tr><td>기대값</td><td class="num">${fmt(d.EV)}원</td></tr>
    <tr><td>최대 당첨금</td><td class="num">${eok(d.max)}</td></tr>` :
    `<tr><td colspan="2">아직 계산되지 않았습니다</td></tr>`;

  const copyText=(mode,list)=>[`연금복권720+ 제${P.next.ep}회 (${mmdd(drawYmd)} ${wdOf(drawYmd)}) — ${mode==='set'?'세트':'분산'}`,
    ...(list||[]).map((t,i)=>`${i+1} ${t.band}조 ${t.num}`)].join('\\n');

  return `
<section class="card buycard" data-kind="pension" data-draw="${drawYmd}" data-draw-kind="pension">
  <div class="card-head">
    <div><b>연금복권720+</b> · 제${P.next.ep}회 · ${mmdd(drawYmd)}(${wdOf(drawYmd)}) 19:05 추첨</div>
    <span class="chip" data-countdown data-kind="pension" data-drawymd="${drawYmd}">계산 중…</span>
  </div>
  ${hasPlans ? `<div class="seg" role="radiogroup" aria-label="구매 방식" data-pension-toggle>
    <button role="radio" aria-checked="${P.mode!=='set'}" data-mode="spread">분산 5장</button>
    <button role="radio" aria-checked="${P.mode==='set'}" data-mode="set">세트 1세트</button>
  </div>` : `<div class="slip-hd mono">${P.mode==='set'?'세트 1세트':'분산 5장'} · 5,000원</div>`}
  <div class="slip" data-pension-tickets
    data-spread='${JSON.stringify(spreadBuy||[])}' data-set='${JSON.stringify(setBuy||[])}'>
    ${ticketRows(P.mode==='set'?setBuy:spreadBuy, P.mode!=='set')}
  </div>
  <div class="actions">
    <button class="btn" data-act="copy" data-kind="pension" data-copy-spread="${escAttr(copyText('spread',spreadBuy))}" data-copy-set="${escAttr(copyText('set',setBuy))}">번호 복사</button>
    <button class="btn" data-act="share" data-kind="pension" data-title="연금복권720+ 제${P.next.ep}회" hidden>공유</button>
    <button class="btn" data-act="buy" data-kind="pension" data-round="${P.next.ep}">샀어요</button>
    <a class="btn" href="./pension.html">연금 상세</a>
  </div>
  <details><summary>품절 시 대체 6~10</summary>
    <div class="slip" data-pension-alts data-spread='${JSON.stringify(spreadAlts||[])}' data-set='${JSON.stringify(setAlts||[])}'>
      ${ticketRows(P.mode==='set'?setAlts:spreadAlts, P.mode!=='set')}
    </div>
    <p class="note">실시간 재고 조회는 불가 — 매진이면 대체 번호로.</p>
  </details>
  <table class="dist-table" data-pension-dist
    data-spread='${hasPlans?JSON.stringify(P.planSpread.dist||null):'null'}'
    data-set='${hasPlans?JSON.stringify(P.planSet.dist||null):'null'}'>
    <tbody>${distTable(P.mode==='set'?(P.planSet&&P.planSet.dist):(P.planSpread&&P.planSpread.dist))}</tbody>
  </table>
  <p class="note">번호 선택은 확률도 당첨금도 바꾸지 못합니다. 5장의 결과가 어떻게 흩어지는지만 고릅니다.</p>
</section>`;
}

function lastWeekLotto(L){
  const buyRows=L.prevBuy.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+1}</td>
    <td><span class="balls">${x.c.map(n=>ball(n, L.last.n.includes(n)||n===L.last.b)).join('')}</span></td>
    <td class="num">${x.hit}개${(x.bonus&&x.hit===5)?'+보너스':''} ${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');
  const spareRows=L.prevSpares.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+6}</td>
    <td><span class="balls">${x.c.map(n=>ball(n, L.last.n.includes(n)||n===L.last.b)).join('')}</span></td>
    <td class="num">${x.hit}개${(x.bonus&&x.hit===5)?'+보너스':''} ${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');
  const hitBuy=L.prevBuy.filter(x=>x.g>0);
  return `
<div class="card flat">
  <h3>로또 · ${L.last.r}회</h3>
  <div class="balls" style="padding-bottom:8px">${L.last.n.map(n=>ball(n,true)).join('')}
    <span style="color:var(--ink-40);padding:0 4px">+</span>${ball(L.last.b,true)}</div>
  <p class="note" style="padding:0 0 8px">산 5장 중 <b>${hitBuy.length}</b> · 예비 <b>${L.prevSpares.filter(x=>x.g>0).length}</b>
    ${hitBuy.length?'· '+hitBuy.map(x=>GRADE[x.g]).join(', '):''}</p>
  <div class="scroll"><table><tr><th>순위</th><th>번호</th><th class="num">결과</th></tr>${buyRows}</table></div>
  <details><summary>예비였다면(F~J)</summary><div class="scroll"><table>${spareRows}</table></div></details>
</div>`;
}
function lastWeekPension(P){
  const buyRows=P.prevBuy.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+1}</td>
    <td><span class="tk"><span class="bnd" style="font-size:15px">${x.band}</span><span class="bndlabel">조</span>
    ${digits(x.num, x.g>=3&&x.g<=7?Array.from({length:8-x.g},(_,k)=>5-k):(x.g&&x.g!==0?[0,1,2,3,4,5]:null))}</span></td>
    <td class="num">${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');
  const altRows=P.prevAlts.map((x,i)=>`<tr class="${x.g?'win':''}"><td class="rk">${i+6}</td>
    <td><span class="tk"><span class="bnd" style="font-size:15px">${x.band}</span><span class="bndlabel">조</span>
    ${digits(x.num, x.g>=3&&x.g<=7?Array.from({length:8-x.g},(_,k)=>5-k):(x.g&&x.g!==0?[0,1,2,3,4,5]:null))}</span></td>
    <td class="num">${x.g?`<span class="tag sig">${GRADE[x.g]}</span>`:'<span class="tag noi">미당첨</span>'}</td></tr>`).join('');
  const hitBuy=P.prevBuy.filter(x=>x.g>0);
  return `
<div class="card flat">
  <h3>연금 · ${P.last.ep}회</h3>
  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding-bottom:8px">
    <span class="tk"><span class="bnd">${P.last.band}</span><span class="bndlabel">조</span>${digits(P.last.num)}</span>
    <span style="font-size:12px;color:var(--ink-60)">보너스 ${digits(P.last.bonus)}</span>
  </div>
  <p class="note" style="padding:0 0 8px">산 5장 중 <b>${hitBuy.length}</b> · 예비 <b>${P.prevAlts.filter(x=>x.g>0).length}</b>
    ${hitBuy.length?'· '+hitBuy.map(x=>GRADE[x.g]).join(', '):''}</p>
  <div class="scroll"><table><tr><th>순위</th><th>조 · 번호</th><th class="num">결과</th></tr>${buyRows}</table></div>
  <details><summary>예비였다면(6~10)</summary><div class="scroll"><table>${altRows}</table></div></details>
</div>`;
}

function carryoverSection(L,P){
  const w1flag = P.w1===0 ? ' <b>(1등 미판매 — 그 조합을 아무도 사지 않았습니다)</b>' : '';
  return `
<section>
  <h2>전주 반영</h2>
  <div class="card flat">
    <h3>로또 · ${L.last.r}회</h3>
    <p class="note">1등 ${fmt(L.last.w[0])}명 — 무작위로 샀다면 기대 <b>${L.lambda!=null?L.lambda.toFixed(2):'—'}명</b><br>
      1인 ${fmt(L.last.a[0])}원 (최근 52회 중앙값 ${fmt(L.med52)}원)</p>
    <p class="note">이번 주 추천과 직전 당첨번호의 겹침 <b>${L.overlapK}개</b><br>
      직전 번호를 따르거나 피하는 규칙은 확률을 바꾸지 않습니다.</p>
  </div>
  <div class="card flat">
    <h3>연금 · ${P.last.ep}회</h3>
    <p class="note">1등 ${P.w1!=null?P.w1+'매':'—'} · 2등 ${P.w2!=null?P.w2+'매':'—'} · 보너스 ${P.wB!=null?P.wB+'매':'—'}${w1flag}<br>
      추정 판매 ${P.sold?pctS(P.sold/1e7,0):'—'}</p>
  </div>
</section>`;
}

function staleBannerPlaceholder(){
  return `<div class="stale" data-stale hidden></div>`;
}

function buildHTML(P,L,meta,honesty){
  const css=siteCSS(ROOT);
  const js=siteJS(ROOT);
  const gnavHTML=sharedGnav('brief','./');
  const lottoDrawYmd=meta.lottoDrawYmd, pensionDrawYmd=meta.pensionDrawYmd;

  const week={
    generated:meta.stamp, date:meta.date, weekday:meta.weekday,
    lotto:{round:L.target, drawDate:lottoDrawYmd, buy:L.buy, target:L.target},
    pension:{round:P.next.ep, drawDate:pensionDrawYmd, mode:P.mode}
  };
  const weekJSON=esc(JSON.stringify(week));

  const extraCSS=`
*{box-sizing:border-box}
body{font-family:var(--f-body);font-size:15px;line-height:1.62;letter-spacing:-.01em}
.wrap{max-width:var(--maxw);margin:0 auto;padding:16px var(--gutter) 0}
.mono{font-family:var(--f-mono)}
header.top{border-bottom:1.5px solid var(--ink);padding-bottom:12px;margin-bottom:18px}
.eyebrow{font-family:var(--f-mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60);
 display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.eyebrow .links{display:flex;gap:10px;align-items:center}
.eyebrow a{color:var(--ink-60)}
h1{font-size:clamp(26px,7.4vw,40px);line-height:1.08;font-weight:800;padding:10px 0 4px;letter-spacing:-.02em}
h1 small{display:block;font-size:.36em;font-weight:600;color:var(--ink-60);letter-spacing:.02em;padding-top:6px}
h2{font-family:var(--f-mono);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
 padding:0 0 10px;display:flex;align-items:center;gap:10px;margin-top:28px}
h2::after{content:"";flex:1;height:1px;background:var(--ink-12)}
h3{font-size:14px;font-weight:700;padding:0 0 8px;color:var(--ink-60)}
.cards2{display:flex;flex-direction:column;gap:12px}
.card{background:var(--paper-2);border:1.5px solid var(--ink);padding:14px;margin-bottom:12px}
.card.flat{border-width:1px;border-color:var(--ink-12)}
.buycard{margin-bottom:0}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:10px}
.chip{font:700 11px/1 var(--f-mono);border:1px solid var(--ink-30);padding:5px 8px;white-space:nowrap;border-radius:2px}
.chip.sig{color:var(--sig);border-color:var(--sig)}
.slip-hd{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60);padding-bottom:6px}
.slip{display:flex;flex-direction:column;gap:6px}
.slip-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.slip-k{font-weight:800;font-size:14px;width:16px;flex:none}
.slip-meta{font-size:11px;color:var(--ink-60);margin-left:auto}
.ball{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
 font-family:var(--f-mono);font-weight:700;font-size:12px;color:#16302B;flex:none}
.balls{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.dg{width:23px;height:29px;border:1px solid var(--ink-40);display:inline-flex;align-items:center;justify-content:center;
 font-family:var(--f-mono);font-weight:700;font-size:13px;background:var(--paper);flex:none}
.dg.hi{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tk{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap}
.bnd{font-weight:800;font-size:17px;border:1.5px solid var(--ink);padding:1px 7px;line-height:1.25}
.bndlabel{font-size:10px;color:var(--ink-60)}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:12px}
.actions .btn[hidden]{display:none}
.btn{min-height:44px;display:flex;align-items:center;justify-content:center;text-align:center;
 border:1.5px solid var(--ink);background:var(--paper);color:var(--ink);font:700 13px var(--f-body);
 text-decoration:none;cursor:pointer;padding:6px 8px}
.btn:active{background:var(--ink-12)}
.btn.on{background:var(--ink);color:var(--paper)}
details{margin-top:10px;border-top:1px solid var(--ink-12);padding-top:8px}
details summary{cursor:pointer;font-size:12.5px;color:var(--ink-60);font-weight:700}
.honest{font-size:12.5px;color:var(--ink-60);padding-top:10px;line-height:1.6}
.honest b{color:var(--ink)}
.dist-row{font-size:12.5px;color:var(--ink-60);padding:3px 0}
.dist-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.dist-table td{padding:5px 2px;border-bottom:1px solid var(--ink-12)}
.dist-table td.num{text-align:right;font-family:var(--f-mono)}
.seg{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid var(--ink);margin-bottom:12px}
.seg button{min-height:40px;border:0;background:var(--paper);color:var(--ink-60);font:700 12.5px var(--f-body);cursor:pointer}
.seg button+button{border-left:1.5px solid var(--ink)}
.seg button[aria-checked="true"]{background:var(--ink);color:var(--paper)}
.note{font-size:12.5px;color:var(--ink-60);line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 5px;text-align:left;border-bottom:1px solid var(--ink-12);vertical-align:middle}
th{font-family:var(--f-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-60)}
td.num,th.num{text-align:right;font-family:var(--f-mono)}
tr.win td{background:var(--ink-06)}
.rk{font-weight:800;font-size:16px;width:24px;color:var(--ink-40)}
.scroll{overflow-x:auto}
.tag{font-family:var(--f-mono);font-size:10px;letter-spacing:.05em;padding:2px 6px;border:1px solid currentColor;white-space:nowrap}
.tag.sig{color:var(--sig)}.tag.noi{color:var(--ink-40)}.tag.ok{color:var(--ok)}
.verdict{border-left:3px solid var(--ink);padding:8px 0 8px 12px;margin:10px 0;font-size:13px;color:var(--ink-60);line-height:1.6}
.verdict b{color:var(--ink)}
.verdict.ok{border-color:var(--ok)}
.stale{background:var(--sig);color:#fff;font-size:12.5px;padding:10px 12px;margin-bottom:14px;line-height:1.5}
.mymoney{display:flex;flex-direction:column;gap:4px;font-size:13px}
.mymoney a{color:var(--ink)}
.foot{font-size:12px;color:var(--ink-40);border-top:1px solid var(--ink-12);margin-top:24px;padding-top:14px;line-height:1.8}
.foot a{color:var(--ink-40)}
@media(min-width:640px){.cards2{flex-direction:row}.cards2>*{flex:1}}
@media print{.stale,.actions,details summary~*{}}
`;

  const cardLotto=lottoBuyCard(L,meta,honesty);
  const cardPension=pensionBuyCard(P,meta);

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#16302B">
<title>이번 주 · 일확천금</title>
<meta name="description" content="이번 주 로또 6/45 · 연금복권720+ 5,000원+5,000원 추천과 지난주 결과">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<script>try{var t=localStorage.getItem('lottolab.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${css}
${extraCSS}</style></head><body>
${gnavHTML}
<div class="wrap">
<header class="top">
  <div class="eyebrow"><span>일확천금 · 이번 주</span>
    <span class="links"><button class="theme-btn" data-theme-btn type="button">테마</button><a href="./brief/index.html">지난 호</a></span></div>
  <h1>이번 주 5,000원 + 5,000원<small>로또 ${L.target}회 · 연금 ${P.next.ep}회 · ${meta.stamp} KST (${meta.weekday})</small></h1>
</header>

${staleBannerPlaceholder()}

<div class="cards2" data-cards>${cardLotto}${cardPension}</div>

<h2>지난주 결과</h2>
<div class="cards2">${lastWeekLotto(L)}${lastWeekPension(P)}</div>

${carryoverSection(L,P)}

<h2>내 돈</h2>
<div class="card flat mymoney" data-mymoney>
  <div>내 기록 · <span data-my-record>불러오는 중…</span></div>
  <div>추천 원장(추천대로 샀다면) · <span data-my-ledger>불러오는 중…</span></div>
  <div><a href="./record.html">기록 →</a></div>
</div>

<h2>기억할 것</h2>
<div class="verdict ok">
  <b>연금복권</b> — 당첨금이 고정액이라 당첨자가 여럿이어도 각자 정해진 금액을 그대로 받습니다.
  번호 선택은 «어떻게 흩어지는지»만 바꿉니다. 이 설정의 백테스트 적중률 ${pctS(P.bt.rate)} · 우연 기준선 ${pctS(P.bt.base,0)} (p=${P.bt.p.toFixed(3)}).
</div>
<div class="verdict">
  <b>로또</b> — 여기서는 «분배 인원»만 바꿀 수 있습니다. 1등 확률은 고정이고, 효과는 300주 walk-forward 실측으로 <b>${honesty.label}</b>입니다 → <a href="./validate.html">검증</a>.
</div>

<div class="foot">
  동행복권 공식 API 자료로 자동 생성 · 생성 시각 ${meta.stamp} (KST)<br>
  연금복권 ${P.rounds}회 / 로또 ${L.latest}회 전수 반영. 번호는 예측이 아니라 규칙에 따른 선택입니다.<br>
  <a href="./remind.ics">캘린더에 알림 추가</a> · <a href="./brief/index.html">지난 호</a><br>
  ${FOOT}
</div>
</div>

<script type="application/json" id="week">${weekJSON}</script>
<script>${js}</script>
<script>
(function(){
"use strict";
try{
  var SITE = window.SITE || {};
  var weekEl = document.getElementById('week');
  var WEEK = {}; try{ WEEK = JSON.parse(weekEl.textContent||'{}'); }catch(e){}

  // 테마 버튼
  if(SITE.theme && SITE.theme.mount) SITE.theme.mount('[data-theme-btn]');

  // 카운트다운 칩 + 카드 순서(마감 임박 우선)
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-countdown]'));
  var deadlineMs = {};
  function toDash(ymd){ return ymd ? (ymd.slice(0,4)+'-'+ymd.slice(4,6)+'-'+ymd.slice(6,8)) : ymd; }
  function refreshCountdowns(){
    var now = Date.now();
    chips.forEach(function(el){
      var kind = el.getAttribute('data-kind'), ymd = el.getAttribute('data-drawymd');
      // site.js 의 SITE.countdown/parseYmd 는 'YYYY-MM-DD'(대시 포함)를 기대한다 —
      // data-drawymd 는 나머지 코드(week.json 등)와 맞추려고 'YYYYMMDD'로 두므로 여기서만 변환.
      var r = SITE.countdown ? SITE.countdown(el, {kind:kind, drawYmd:toDash(ymd), now:new Date(now)}) : null;
      if(r){
        var sec = SITE.SCHED ? SITE.SCHED[kind] : null;
        var d = ymd ? {y:+ymd.slice(0,4),mo:+ymd.slice(4,6),d:+ymd.slice(6,8)} : null;
        var ms = Infinity;
        if(d){
          function wallMs(h,mi){ return Date.UTC(d.y,d.mo-1,d.d,h,mi,0) - 9*3600*1000; }
          if(r.state==='before-close'||r.state==='before-stop'){
            ms = kind==='pension' ? wallMs(17,0)-now : wallMs(20,0)-now;
          } else if(r.state==='closing'){ ms = 0; }
          else { ms = Infinity; }
        }
        deadlineMs[kind]=ms;
      }
    });
    var cardWrap = document.querySelector('[data-cards]');
    if(cardWrap){
      var lottoMs = deadlineMs.lotto==null?Infinity:deadlineMs.lotto;
      var pensionMs = deadlineMs.pension==null?Infinity:deadlineMs.pension;
      var cards = Array.prototype.slice.call(cardWrap.children);
      cards.sort(function(a,b){
        var av = a.getAttribute('data-draw-kind')==='lotto'?lottoMs:pensionMs;
        var bv = b.getAttribute('data-draw-kind')==='lotto'?lottoMs:pensionMs;
        return av-bv;
      });
      cards.forEach(function(c,i){ c.style.order=i; });
    }
  }
  refreshCountdowns();
  setInterval(refreshCountdowns, 30000);

  // 마감 안내 배너 — 생성 시각 이후 추첨이 끝났는데도 이 페이지가 그대로면(자동 계산 실패 가능성)
  (function staleCheck(){
    var banner = document.querySelector('[data-stale]');
    if(!banner) return;
    var now = Date.now();
    function wallMs(ymd,h,mi){
      var y=+ymd.slice(0,4),mo=+ymd.slice(4,6),d=+ymd.slice(6,8);
      return Date.UTC(y,mo-1,d,h,mi,0) - 9*3600*1000;
    }
    var lotto = WEEK.lotto, pension = WEEK.pension;
    var staleMsg = null;
    if(lotto && lotto.drawDate && now > wallMs(lotto.drawDate,20,35) + 3*3600*1000){
      staleMsg = {kind:'로또', round:lotto.round};
    } else if(pension && pension.drawDate && now > wallMs(pension.drawDate,19,5) + 3*3600*1000){
      staleMsg = {kind:'연금', round:pension.round};
    }
    if(staleMsg){
      banner.hidden = false;
      banner.textContent = '이 페이지는 '+(WEEK.date||'')+' 계산본입니다. '+staleMsg.kind+' '+staleMsg.round+'회 추첨이 끝났지만 아직 갱신되지 않았어요 — 자동 계산이 실패했을 수 있습니다. 최신 계산은 로또/연금 탭에서 직접 할 수 있습니다.';
    }
  })();

  // 복사 / 공유
  document.querySelectorAll('[data-act="copy"]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var text = btn.getAttribute('data-text');
      if(text==null && btn.getAttribute('data-kind')==='pension'){
        var toggle = document.querySelector('[data-pension-toggle]');
        var mode = toggle && toggle.querySelector('[aria-checked="true"]');
        var m = mode ? mode.getAttribute('data-mode') : 'spread';
        text = btn.getAttribute(m==='set'?'data-copy-set':'data-copy-spread');
      }
      if(text!=null && SITE.copy){ SITE.copy(text.replace(/\\\\n/g,'\\n')); btn.textContent='복사됨'; setTimeout(function(){btn.textContent='번호 복사';},1200); }
    });
  });
  document.querySelectorAll('[data-act="share"]').forEach(function(btn){
    if(!(typeof navigator!=='undefined' && navigator.share)) return;
    btn.hidden = false;
    btn.addEventListener('click', function(){
      var title = btn.getAttribute('data-title')||'';
      var text = btn.getAttribute('data-text')||'';
      if(SITE.share) SITE.share(title, text);
    });
  });

  // 샀어요 토글
  function syncBuyBtn(btn){
    var kind = btn.getAttribute('data-kind'), round = +btn.getAttribute('data-round');
    var bought = SITE.isBought ? SITE.isBought(kind, round) : false;
    btn.textContent = bought ? '기록됨 · 취소' : '샀어요';
    btn.classList.toggle('on', bought);
  }
  document.querySelectorAll('[data-act="buy"]').forEach(function(btn){
    syncBuyBtn(btn);
    btn.addEventListener('click', function(){
      var kind = btn.getAttribute('data-kind'), round = +btn.getAttribute('data-round');
      var bought = SITE.isBought ? SITE.isBought(kind, round) : false;
      if(bought){ if(SITE.unmark) SITE.unmark(kind, round); syncBuyBtn(btn); return; }
      var items;
      if(kind==='lotto'){
        var slip = document.querySelector('.buycard[data-kind="lotto"] .slip');
        items = (WEEK.lotto && WEEK.lotto.buy) || [];
      } else {
        var toggle = document.querySelector('[data-pension-toggle]');
        var cur = toggle && toggle.querySelector('[aria-checked="true"]');
        var m = cur ? cur.getAttribute('data-mode') : 'spread';
        var tksEl = document.querySelector('[data-pension-tickets]');
        try{ items = JSON.parse(tksEl.getAttribute('data-'+m)||'[]'); }catch(e){ items=[]; }
      }
      if(SITE.markBought) SITE.markBought(kind, round, items);
      syncBuyBtn(btn);
    });
  });

  // 연금 분산/세트 토글 — 표시 전용(localStorage['pensionlab.buymode.v1'])
  (function pensionToggle(){
    var wrap = document.querySelector('[data-pension-toggle]');
    if(!wrap) return;
    var KEY='pensionlab.buymode.v1';
    function get(){ try{ var v=localStorage.getItem(KEY); return v==='set'?'set':(v==='spread'?'spread':null); }catch(e){ return null; } }
    function set(m){ try{ localStorage.setItem(KEY, m); }catch(e){} }
    function apply(mode){
      wrap.querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-checked', String(b.getAttribute('data-mode')===mode)); });
      var tks = document.querySelector('[data-pension-tickets]');
      var alts = document.querySelector('[data-pension-alts]');
      [tks, alts].forEach(function(box){
        if(!box) return;
        var arr; try{ arr = JSON.parse(box.getAttribute('data-'+mode)||'[]'); }catch(e){ arr=[]; }
        var hiLast = mode!=='set';
        box.innerHTML = arr.map(function(t,i){
          var num = String(t.num).padStart(6,'0').split('').map(function(c,di){
            return '<span class="dg'+(hiLast&&di===5?' hi':'')+'">'+c+'</span>';
          }).join('');
          return '<div class="slip-row"><span class="slip-k">'+(i+1)+'</span>'+
            '<span class="tk"><span class="bnd">'+t.band+'</span><span class="bndlabel">조</span>'+num+'</span></div>';
        }).join('');
      });
      var dt = document.querySelector('[data-pension-dist]');
      if(dt){
        var d; try{ d=JSON.parse(dt.getAttribute('data-'+mode)||'null'); }catch(e){ d=null; }
        var tb=dt.querySelector('tbody');
        if(tb) tb.innerHTML = d ?
          ('<tr><td>1장 이상 당첨</td><td class="num">'+(d.pAny*100).toFixed(2)+'%</td></tr>'+
           '<tr><td>기대값</td><td class="num">'+Math.round(d.EV).toLocaleString('ko-KR')+'원</td></tr>'+
           '<tr><td>최대 당첨금</td><td class="num">'+(d.max/1e8).toFixed(1)+'억</td></tr>')
          : '<tr><td colspan="2">아직 계산되지 않았습니다</td></tr>';
      }
    }
    var initial = get() || (WEEK.pension && WEEK.pension.mode) || 'spread';
    apply(initial);
    wrap.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){ var m=b.getAttribute('data-mode'); set(m); apply(m); });
    });
  })();

  // 내 돈 peek
  (function myMoney(){
    var recEl = document.querySelector('[data-my-record]');
    var ledEl = document.querySelector('[data-my-ledger]');
    function storeGet(key){ try{ var v=localStorage.getItem(key); return v!=null?JSON.parse(v):[]; }catch(e){ return []; } }
    var lotto = storeGet('lottolab.my.v1'), pension = storeGet('pensionlab.my.v1');
    var weeks = {}; lotto.forEach(function(t){ weeks['l'+t.round]=1; }); pension.forEach(function(t){ weeks['p'+t.ep]=1; });
    var spend = lotto.length*1000 + pension.length*1000;
    if(recEl) recEl.textContent = Object.keys(weeks).length+'주 · 투입 '+spend.toLocaleString('ko-KR')+'원';
    if(ledEl){
      fetch('./brief/purchases.json').then(function(r){ return r.json(); }).then(function(j){
        var rounds=(j&&j.rounds)||[];
        var done=rounds.filter(function(r){ return r.status==='done'; });
        var sp=done.reduce(function(s,r){ return s+(r.spend||0); },0);
        var rt=done.reduce(function(s,r){ return s+(r.return||0); },0);
        ledEl.textContent = done.length+'건 · 투입 '+sp.toLocaleString('ko-KR')+'원 · 수령 '+rt.toLocaleString('ko-KR')+'원';
      }).catch(function(){ ledEl.textContent='—'; });
    }
  })();
}catch(e){}
})();
</script>
</body></html>`;
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
  for(const f of ['site.css','site.js']){
    if(!fs.existsSync(path.join(ROOT,f))) throw new Error(`${f} 를 ${ROOT} 에서 찾을 수 없습니다 (WP-C 산출물 확인)`);
  }
  console.error('[2/4] 도구 구동…');
  const {srv,port}=await serve(ROOT);
  const base='http://127.0.0.1:'+port;
  let P,L;
  try{
    await withBrowser(async b=>{
      P=await readPension(b,base,pension,lotto);
      console.error('      연금 OK · 다음 '+P.next.ep+'회 · 구매 '+P.buy.length+'장 · 규칙 '+P.rule);
      L=await readLotto(b,base,pension,lotto);
      console.error('      로또 OK · 다음 '+L.target+'회 · 구매 '+L.buy.length+'게임 · 규칙 '+L.rule);
    });
  } finally { srv.close(); }

  console.error('[3/4] 브리핑 작성…');
  const now=KST();
  const meta={
    date:kstStr(now), stamp:now.toISOString().slice(0,16).replace('T',' '),
    weekday:WEEKDAY_KO[now.getUTCDay()],
  };
  // 로또 추첨일(다음 토요일) / 연금 추첨일(다음 목요일) — 최신 회차 날짜에서 역산
  function nextDow(ymd, targetDow){
    const y=+ymd.slice(0,4), m=+ymd.slice(4,6), d=+ymd.slice(6,8);
    const dt=new Date(Date.UTC(y,m-1,d));
    let cur=dt.getUTCDay();
    let add=(targetDow-cur+7)%7; if(add===0) add=7;
    dt.setUTCDate(dt.getUTCDate()+add);
    return dt.toISOString().slice(0,10).replace(/-/g,'');
  }
  meta.lottoDrawYmd = nextDow(L.last.ymd, 6);     // 토요일
  meta.pensionDrawYmd = nextDow(P.last.date, 4);  // 목요일
  const honesty=readHonestyG();
  const html=buildHTML(P,L,meta,honesty);

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
  // (사이트 자산 · gnav · manifest 등 href="./..." 전부 동일 규칙으로 걸린다.)
  fs.writeFileSync(archPath, html.replace(/href="\.\/(?!\d{4}-)/g,'href="../'));

  // week.json — 브리핑에 embed 한 것과 같은 blob(추가 소비자를 위한 별도 파일)
  const weekBlob={
    generated:meta.stamp, date:meta.date, weekday:meta.weekday,
    lotto:{round:L.target, drawDate:meta.lottoDrawYmd, buy:L.buy, spares:L.spares, rule:L.rule,
      cover:L.cover, evBuy:L.evBuy, lambda:L.lambda, med52:L.med52, overlapK:L.overlapK},
    pension:{round:P.next.ep, drawDate:meta.pensionDrawYmd, mode:P.mode, buy:P.buy, alts:P.alts,
      planSpread:P.planSpread, planSet:P.planSet},
    honesty
  };
  fs.writeFileSync(path.join(OUT,'brief','week.json'), JSON.stringify(weekBlob,null,1));

  // pension-history.json — Node 에서 이미 받아온 연금 원본 rows 그대로(회차 오름차순).
  // pension.html 의 API 실패 폴백(D2 §3.B.7)이 이 파일을 읽는다.
  fs.writeFileSync(path.join(OUT,'brief','pension-history.json'), JSON.stringify(pension));

  // 아카이브 목차 — 각 항목에 회차 정보(§C.7): 각 아카이브의 #week 를 읽어 표시, 없으면 날짜만.
  const files=fs.readdirSync(path.join(OUT,'brief')).filter(f=>/^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
  const rowsHTML=files.map(f=>{
    let sub='';
    try{
      const body=fs.readFileSync(path.join(OUT,'brief',f),'utf8');
      const m=body.match(/<script type="application\/json" id="week">([\s\S]*?)<\/script>/);
      if(m){
        const w=JSON.parse(m[1]);
        if(w.lotto&&w.pension) sub=` · 로또 ${w.lotto.round}회 / 연금 ${w.pension.round}회`;
      }
    }catch(e){}
    return `<li><a href="./${f}">${f.replace('.html','')}</a>${sub}</li>`;
  }).join('');
  fs.writeFileSync(path.join(OUT,'brief','index.html'),
`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>지난 호 · 일확천금</title>
<script>try{var t=localStorage.getItem('lottolab.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${siteCSS(ROOT)}
body{font-family:var(--f-body);line-height:1.7}
.wrap{max-width:640px;margin:0 auto;padding:24px var(--gutter) 0}
h1{font-size:22px;padding-bottom:6px}a{color:var(--ink)}
ul{list-style:none;padding:0}li{border-bottom:1px solid var(--ink-12);padding:11px 0;font-size:14px}
</style></head><body>
${sharedGnav('brief','../')}
<div class="wrap"><h1>지난 호</h1>
<p><a href="../brief.html">→ 최신 호</a></p>
<ul>${rowsHTML}</ul>
</div></body></html>`);

  const pHit=P.prevPicks.filter(x=>x.g>0), lHit=L.prevPicks.filter(x=>x.g>0);
  const rel=p=>path.relative(ROOT,p).split(path.sep).join('/');
  const summary={
    date:meta.date, seconds:Math.round((Date.now()-t0)/1000),
    files:[rel(latestPath),rel(archPath),rel(path.join(OUT,'brief','index.html'))],
    pension:{last:P.last.ep, next:P.next.ep, hits:pHit.length,
      hitDetail:pHit.map(x=>`${x.band}조 ${x.num} → ${GRADE[x.g]}`),
      picks:P.buy.concat(P.alts).map(c=>`${c.band}조 ${c.num}`),   // 앞 5=구매(PENSION_MODE), 뒤 5=대체
      backtest:`${pctS(P.bt.rate)} (기준선 ${pctS(P.bt.base,0)}, p=${P.bt.p.toFixed(3)})`,
      mode:P.mode, rule:P.rule},
    lotto:{last:L.last.r, next:L.target, hits:lHit.length,
      hitDetail:lHit.map(x=>`${x.c.join(',')} → ${GRADE[x.g]}`),
      picks:L.picks.map(c=>c.join(',')),
      rule:L.rule, degraded:L.degraded}
  };
  fs.writeFileSync(path.join(OUT,'brief','latest-summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
  console.error(`완료 · ${summary.seconds}초 · ${latestPath}`);
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
