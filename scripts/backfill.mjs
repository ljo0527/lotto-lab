#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   모의 원장(가정) — «로또 1000회·연금 100회부터 매주 현재 규칙대로 5장씩 샀다면»

   결과물: <out>/brief/sim-lotto.json · <out>/brief/sim-pension.json  (형식: maps/SIM-SCHEMA.md v1)

   정직성 — 이 파일은 실제 구매 기록이 아니라 «가정»이다.
     · walk-forward: 회차 R 의 번호는 페이지 DB 를 R−1 까지 잘라서(미래 자료 없음) 페이지 함수로 뽑는다.
         로또  weeklyPicks('portfolio').combos[0..4]   (R ≥ 규칙표 첫 from 이면 그 회차 규칙 = 사이트 추천과 같다)
         연금  pensionPortfolio(pensionModeFor(ep)||PENSION_MODE, predSettings(), ep·7919, {noDist:true}).buy
       선택 로직은 여기에 다시 구현하지 않는다(validate.mjs·weekly-brief.mjs 와 같은 원칙).
     · 채점도 페이지 함수: 로또 rankOf + 그 회차 상금표 a[], 연금 gradeOf + RANKS 금액(명목·세전).
     · 교차 적중(산 줄 × 다른 회차 추첨)은 우연이다. 관측 개수는 항상 «우연의 기대 개수»와 나란히 적는다.
       before(산 회차보다 이전 추첨)는 선택이 이미 본 자료라 증거가 아니고, after 만 표본 밖이다.

   적재(append-only) — 기존 파일의 done 행(번호·규칙·날짜·결과)은 그대로 둔다. 다시 계산해 보고
   다르면 바꾸지 않고 ::warning 만 남긴다(결정성 감시). pending 행은 매번 새로 계산한다.
   파생 필드(carry·prevHit·cum·cross·summary)는 최종 행들로 매번 다시 계산한다.

   CLI: node scripts/backfill.mjs --root . --out . [--cache <file>] [--lotto-from 1000] [--pension-from 100]
                                  [--purchases <brief/purchases.json>] [--only lotto|pension]
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';

const arg=(k,d)=>{ const i=process.argv.indexOf(k); return i>0?process.argv[i+1]:d; };
const ROOT=path.resolve(arg('--root', process.cwd()));
const OUT =path.resolve(arg('--out', ROOT));
const LOTTO_FROM=Math.max(2, parseInt(arg('--lotto-from','1000'),10)||1000);
const PENSION_FROM=Math.max(2, parseInt(arg('--pension-from','100'),10)||100);
const ONLY=arg('--only',null);
const SIMS=Math.max(50, parseInt(arg('--sims','1000'),10)||1000);   // 교차 적중 우연 분포 모의 횟수
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const GAMES=5, TICKET=1000;

async function jget(url,tries=8){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (lotto-lab)'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await sleep(Math.min(20000,1000*2**i)); }
  }
}

/* ── 1. 데이터 (validate.mjs 와 같은 코드·같은 --cache 형식) ─────────── */
const P720='https://www.dhlottery.co.kr/pt720/';
const L645='https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=';
async function getPension(){
  const list=(await jget(P720+'selectPstPt720WnList.do')).data.result;
  const rows=list.map(r=>({ep:+r.psltEpsd,date:String(r.psltRflYmd),band:+r.wnBndNo,
    num:String(r.wnRnkVl).padStart(6,'0'),bonus:String(r.bnsRnkVl).padStart(6,'0')}))
    .sort((a,b)=>a.ep-b.ep);
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

/* ── 2. 페이지 띄우기 (validate.mjs 와 같은 serve / mockRoutes) ───────── */
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
  const types={'.html':'text/html; charset=utf-8','.json':'application/json','.js':'text/javascript',
               '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  const s=http.createServer((q,res)=>{
    const f=path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,'')||'index.html');
    if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.statusCode=404; return res.end('nf'); }
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
const CTX_OPTS={serviceWorkers:'block'};

/* ── 3. 로또 — 페이지 안에서 walk-forward · 채점 · 교차 대조 ─────────── */
async function readLotto(browser, base, pension, lotto, from, stored){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/index.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100&&DB.draws&&DB.draws[DB.latest],{timeout:120000});
  await p.waitForTimeout(1500);
  const out=await p.evaluate(async ({from, stored})=>{
    if(typeof weeklyPicks!=='function'||typeof rankOf!=='function'||typeof bumpDB!=='function'
       ||typeof portfolioOptsFor!=='function'||typeof PORTFOLIO_RULES==='undefined')
      return {error:'index.html 에 weeklyPicks/rankOf/bumpDB/portfolioOptsFor/PORTFOLIO_RULES 가 없습니다'};
    /* 스크립트가 모르는 캐시는 DB.rev 로 무효화된다(bumpDB). 이름 있는 캐시는 직접 비운다. */
    const reset=()=>{ WEEKLY=null; WEEKLY_R=0; if(typeof WEEKLY_REV!=='undefined') WEEKLY_REV=-1;
      POPFIT=null; POPFIT_N=-1; WINSET=null; WINSET_N=-1; };
    const tick=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r();c.port2.postMessage(0);});
    const RL=PORTFOLIO_RULES, LAST=RL[RL.length-1];
    /* 회차 R 에 실제로 쓰인 규칙 항목: portfolioOptsFor(R) 이 주는 opts 의 주인, 없으면(첫 from 이전) 최신 규칙 */
    const ruleEnt=R=>{ const ro=portfolioOptsFor(R); if(!ro) return LAST;
      let e=null; for(const r of RL) if(r.opts===ro) e=r; if(e) return e;
      for(const r of RL) if(r.from<=R) e=r; return e||LAST; };
    const sameOpts=(a,b)=>{ if(!a||!b) return a===b; const ks=new Set([...Object.keys(a),...Object.keys(b)]);
      for(const k of ks) if(a[k]!==b[k]) return false; return true; };
    const orig=DB.draws, L=DB.latest, work=orig.slice();
    const fresh={}, missing=[], degraded=[], ruleOdd=[];
    const t0=performance.now();
    try{
      DB.draws=work;
      for(let R=from; R<=L+1; R++){
        if(R<=L && !orig[R]){ missing.push(R); continue; }
        for(let j=1;j<orig.length;j++) work[j]=orig[j];
        for(let j=R;j<work.length;j++) work[j]=undefined;
        DB.latest=R-1; bumpDB(); reset();
        const W=weeklyPicks('portfolio');
        const ent=ruleEnt(R);
        if(W.rule!=='portfolio'||!W.portfolio||!sameOpts(W.portfolio.opts, ent.opts)) ruleOdd.push(R);
        if(W.portfolio&&W.portfolio.degraded) degraded.push(R);
        fresh[R]={picks:W.combos.slice(0,5).map(c=>c.join(',')), rule:'portfolio@'+ent.from};
        if((R-from)%5===4) await tick();
      }
    } finally { DB.draws=orig; DB.latest=L; bumpDB(); reset(); }
    const pickMs=performance.now()-t0;

    /* 라이브 동일성 — 전체 DB 로 사이트가 실제로 부르는 weeklyPicks() (강제 없음) */
    let live=null;
    try{ const W=weeklyPicks(); live={round:W.round, rule:W.rule, picks:W.combos.slice(0,5).map(c=>c.join(','))}; }
    catch(e){ live={error:String(e&&e.message||e)}; }

    /* 최종 번호: 기존 done 행은 보존(결정성 비교만), 나머지는 새로 계산한 것 */
    const det={compared:0, mismatch:[], ruleChanged:[]};
    const rounds=[];
    for(let R=from; R<=L+1; R++){
      const f=fresh[R]; if(!f) continue;
      const s=stored[R];
      let picks=f.picks, rule=f.rule, kept=false;
      if(s && s.status==='done' && R<=L && Array.isArray(s.picks) && s.picks.length===5){
        kept=true;
        if(s.rule===f.rule){ det.compared++; if(s.picks.join('|')!==f.picks.join('|')) det.mismatch.push(R); }
        else det.ruleChanged.push(R);
        picks=s.picks.slice(); rule=s.rule;
      }
      const lines=picks.map(x=>String(x).split(',').map(Number));
      const d=R<=L?orig[R]:null, pv=orig[R-1];
      const carry=pv ? lines.map(c=>typeof carryOf==='function'?carryOf(c,pv.n):c.filter(n=>pv.n.includes(n)).length) : null;
      let result=null, ret=null, ev=null, evSmall=null, pAny=null;
      if(d){
        result=lines.map(c=>({hit:c.filter(n=>d.n.includes(n)).length, bonus:c.includes(d.b), rank:rankOf(c,d)}));
        ret=result.reduce((a,x)=>a+(x.rank?(d.a[x.rank-1]||0):0),0);
        /* 무작위 5줄의 기대 수령(그 회차 상금표) — 전체 / 4·5등만 */
        ev=5*[1,2,3,4,5].reduce((a,k)=>a+WAYS[k]/C456*(d.a[k-1]||0),0);
        evSmall=5*[4,5].reduce((a,k)=>a+WAYS[k]/C456*(d.a[k-1]||0),0);
        /* 이 5줄로 «한 줄이라도 5등 이상» 정확 확률(페이지 coverExact — 줄 사이 겹침 반영) */
        if(typeof coverExact==='function'){ try{ const cx=coverExact(lines); pAny=cx?cx.pAny:null; }catch(e){ pAny=null; } }
      }
      rounds.push({round:R, date:d?String(d.ymd):null, status:d?'done':'pending', rule, picks, result, ret, carry, ev, evSmall, pAny, kept});
    }
    const lastYmd=String(orig[L].ymd);

    /* 교차 대조 — 산 모든 줄(pending 포함) × 추첨 1..L. before d<b · same d=b · after d>b */
    const LN=[]; rounds.forEach(r=>r.picks.forEach(s=>LN.push({b:r.round, s:String(s), c:String(s).split(',').map(Number)})));
    const nL=LN.length;
    const mk=()=>({pairs:0, obs:{'3':0,'4':0,'5':0,'5b':0,'6':0,ge3:0}});
    const cls={before:mk(), same:mk(), after:mk()};
    const bestAll=new Array(nL).fill(-1), bestB=new Array(nL).fill(-1), bestA=new Array(nL).fill(-1);
    const nAll=new Array(nL).fill(0), nB=new Array(nL).fill(0), nA=new Array(nL).fill(0);
    const notable=[], rowX={}, rankOdd=[];
    const doneSet=new Set(rounds.filter(r=>r.status==='done').map(r=>r.round));
    const mark=new Uint8Array(46);
    const t1=performance.now();
    for(let dI=1; dI<=L; dI++){
      const d=orig[dI]; if(!d) continue;
      mark.fill(0); for(const n of d.n) mark[n]=1;
      const X=doneSet.has(dI) ? (rowX[dI]={pairs:0, n:{'3':0,'4':0,'5':0,'5b':0,'6':0}, any:0, top:[]}) : null;
      for(let i=0;i<nL;i++){
        const ln=LN[i], c=ln.c;
        const hit=mark[c[0]]+mark[c[1]]+mark[c[2]]+mark[c[3]]+mark[c[4]]+mark[c[5]];
        const k=dI<ln.b?'before':dI===ln.b?'same':'after';
        const C=cls[k]; C.pairs++;
        nAll[i]++; if(hit>bestAll[i]) bestAll[i]=hit;
        if(k==='before'){ nB[i]++; if(hit>bestB[i]) bestB[i]=hit; }
        else if(k==='after'){ nA[i]++; if(hit>bestA[i]) bestA[i]=hit; }
        if(hit<3){ if(X&&k==='after') X.pairs++; continue; }
        const bonus=c.includes(d.b), rank=rankOf(c,d);
        const key=hit===6?'6':hit===5?(bonus?'5b':'5'):String(hit);
        const want=hit===6?1:hit===5?(bonus?2:3):hit===4?4:5;
        if(rank!==want && rankOdd.length<5) rankOdd.push({draw:dI, line:ln.s, hit, bonus, rank});
        C.obs[key]++; C.obs.ge3++;
        if(rank>=1 && rank<=3) notable.push({draw:dI, boughtIn:ln.b, line:ln.s, hit, bonus, rank, cls:k});
        if(X && k==='after'){ X.pairs++; X.n[key]++; X.any++; X.top.push({boughtIn:ln.b, line:ln.s, hit, bonus, rank}); }
      }
      if(X){ X.top.sort((a,b)=>a.rank-b.rank||b.hit-a.hit||b.boughtIn-a.boughtIn); X.top=X.top.slice(0,5); }
    }
    const crossMs=performance.now()-t1;
    return { L, lastYmd, rounds, det, live, missing, degraded, ruleOdd, rankOdd,
             rules:RL.map(r=>({from:r.from, opts:Object.assign({},r.opts)})),
             WAYS:Object.assign({},WAYS), C456, TICKET:(typeof TICKET!=='undefined'?TICKET:1000),
             cross:{ lines:nL, drawList:(()=>{ const a=[]; for(let i=1;i<=L;i++) if(orig[i]) a.push(i); return a; })(), cls, notable, rowX,
                     perLine:LN.map((ln,i)=>[ln.b, bestAll[i], bestB[i], bestA[i], nAll[i], nB[i], nA[i]]) },
             ms:{pick:Math.round(pickMs), cross:Math.round(crossMs)} };
  }, {from, stored});
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 4. 연금 — 페이지 안에서 walk-forward · 채점 · 교차 대조 ─────────── */
async function readPension(browser, base, pension, lotto, from, stored){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1200);
  const out=await p.evaluate(async ({from, stored})=>{
    if(typeof pensionPortfolio!=='function'||typeof gradeOf!=='function'||typeof predSettings!=='function'
       ||typeof nextDraw!=='function'||typeof RANKS==='undefined'||typeof PENSION_MODE==='undefined')
      return {error:'pension.html 에 pensionPortfolio/gradeOf/predSettings/nextDraw/RANKS/PENSION_MODE 가 없습니다'};
    const tick=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r();c.port2.postMessage(0);});
    const S=predSettings();
    const save=DB.rounds;
    const all=save.slice().sort((a,b)=>a.ep-b.ep), L=all[all.length-1].ep;
    const byEp=new Map(all.map(r=>[r.ep,r]));
    const RL=(typeof PENSION_RULES!=='undefined'&&Array.isArray(PENSION_RULES)&&PENSION_RULES.length)
      ? PENSION_RULES : [{from:(typeof PENSION_PORTFOLIO_FROM!=='undefined'?PENSION_PORTFOLIO_FROM:0), mode:PENSION_MODE}];
    const LAST=RL[RL.length-1];
    const modeFor=ep=>((typeof pensionModeFor==='function')&&pensionModeFor(ep))||PENSION_MODE;
    const entFor=ep=>{ let e=null; for(const r of RL) if(r.from<=ep) e=r; return e||LAST; };
    const label=c=>c.band+'조 '+c.num;
    const fresh={}, missing=[], odd=[];
    const t0=performance.now();
    try{
      for(let ep=from; ep<=L+1; ep++){
        if(ep<=L && !byEp.has(ep)){ missing.push(ep); continue; }
        DB.rounds=all.filter(r=>r.ep<ep);
        const nx=nextDraw();
        if(!nx||nx.ep!==ep) odd.push(ep);
        const mode=modeFor(ep), ent=entFor(ep);
        if(ent.mode!==mode) odd.push(ep);
        const r=pensionPortfolio(mode, S, ep*7919, {noDist:true});
        fresh[ep]={picks:r.buy.map(label), rule:mode+'@'+ent.from, date:ep>L&&nx?nx.date:null};
        if((ep-from)%5===4){ DB.rounds=save; await tick(); }
      }
    } finally { DB.rounds=save; }
    const pickMs=performance.now()-t0;

    /* 라이브 동일성 — 전체 DB 로 pensionWeekly().buy */
    let live=null;
    try{ const nx=nextDraw(); const W=(typeof pensionWeekly==='function')?pensionWeekly():null;
      const buy=W?(Array.isArray(W.buy)&&W.buy.length?W.buy:(W.picks||[]).slice(0,5)):[];
      live={round:nx?nx.ep:null, rule:W&&W.rule, mode:W&&W.mode, picks:buy.map(label)}; }
    catch(e){ live={error:String(e&&e.message||e)}; }

    const amt={}; RANKS.forEach(r=>{ amt[r.k]=r.amt; });
    const parse=s=>{ const m=String(s).match(/^(\d)조 (\d{6})$/); return m?{band:+m[1],num:m[2]}:null; };
    const det={compared:0, mismatch:[], ruleChanged:[]};
    const rounds=[], bad=[];
    for(let ep=from; ep<=L+1; ep++){
      const f=fresh[ep]; if(!f) continue;
      const s=stored[ep];
      let picks=f.picks, rule=f.rule, kept=false;
      if(s && s.status==='done' && ep<=L && Array.isArray(s.picks) && s.picks.length===5){
        kept=true;
        if(s.rule===f.rule){ det.compared++; if(s.picks.join('|')!==f.picks.join('|')) det.mismatch.push(ep); }
        else det.ruleChanged.push(ep);
        picks=s.picks.slice(); rule=s.rule;
      }
      const tks=picks.map(parse);
      if(tks.some(t=>!t)){ bad.push(ep); continue; }
      const d=ep<=L?byEp.get(ep):null, pv=byEp.get(ep-1);
      const carry=pv ? tks.map(t=>{ let k=0; for(let i=0;i<6;i++) if(t.num[i]===pv.num[i]) k++; return k; }) : null;
      let result=null, ret=null;
      if(d){
        result=tks.map(t=>({grade:gradeOf(t.band,t.num,d)||0}));
        ret=result.reduce((a,x)=>a+(amt[x.grade]||0),0);
      }
      rounds.push({round:ep, date:d?String(d.date):f.date, status:d?'done':'pending', rule, picks, result, ret, carry, kept});
    }

    /* 교차 대조 — 산 모든 표(pending 포함) × 추첨 1..L */
    const LN=[]; rounds.forEach(r=>r.picks.forEach(s=>{ const t=parse(s); LN.push({b:r.round, s:String(s), band:t.band, num:t.num}); }));
    const nL=LN.length, G=['1','2','3','4','5','6','7','8'];
    const mk=()=>{ const o={pairs:0, obs:{}}; G.forEach(g=>o.obs[g]=0); o.obs.any=0; return o; };
    const cls={before:mk(), same:mk(), after:mk()};
    const bestAll=new Array(nL).fill(-1), bestB=new Array(nL).fill(-1), bestA=new Array(nL).fill(-1);
    const nAll=new Array(nL).fill(0), nB=new Array(nL).fill(0), nA=new Array(nL).fill(0);
    const ORDER=[1,2,8,3,4,5,6,7], ordIx=g=>{ const i=ORDER.indexOf(g); return i<0?99:i; };
    const notable=[], rowX={};
    const doneSet=new Set(rounds.filter(r=>r.status==='done').map(r=>r.round));
    const t1=performance.now();
    for(const d of all){
      if(d.ep<1||d.ep>L) continue;
      const w=d.num;
      const X=doneSet.has(d.ep) ? (rowX[d.ep]={pairs:0, n:(()=>{const o={}; G.forEach(g=>o[g]=0); return o;})(), any:0, top:[]}) : null;
      for(let i=0;i<nL;i++){
        const ln=LN[i], num=ln.num;
        let t=0; while(t<6 && num[5-t]===w[5-t]) t++;          // 뒤에서부터 연속 일치 자리 수(조 무관)
        const k=d.ep<ln.b?'before':d.ep===ln.b?'same':'after';
        const C=cls[k]; C.pairs++;
        nAll[i]++; if(t>bestAll[i]) bestAll[i]=t;
        if(k==='before'){ nB[i]++; if(t>bestB[i]) bestB[i]=t; }
        else if(k==='after'){ nA[i]++; if(t>bestA[i]) bestA[i]=t; }
        const g=gradeOf(ln.band,num,d)||0;
        if(X&&k==='after') X.pairs++;
        if(!g) continue;
        C.obs[g]++; C.obs.any++;
        if(ordIx(g)<=4) notable.push({draw:d.ep, boughtIn:ln.b, line:ln.s, grade:g, cls:k});
        if(X&&k==='after'){ X.n[g]++; X.any++; X.top.push({boughtIn:ln.b, line:ln.s, grade:g}); }
      }
      if(X){ X.top.sort((a,b)=>(amt[b.grade]||0)-(amt[a.grade]||0)||ordIx(a.grade)-ordIx(b.grade)||b.boughtIn-a.boughtIn); X.top=X.top.slice(0,5); }
    }
    const crossMs=performance.now()-t1;
    return { L, rounds, det, live, missing, odd, bad,
             settings:S, rules:RL.map(r=>({from:r.from, mode:r.mode})),
             ranks:RANKS.map(r=>({k:r.k, p:r.p, amt:r.amt})), TICKET:(typeof TICKET!=='undefined'?TICKET:1000),
             cross:{ lines:nL, drawList:all.filter(d=>d.ep>=1&&d.ep<=L).map(d=>d.ep), cls, notable, rowX,
                     perLine:LN.map((ln,i)=>[ln.b, bestAll[i], bestB[i], bestA[i], nAll[i], nB[i], nA[i]]) },
             ms:{pick:Math.round(pickMs), cross:Math.round(crossMs)} };
  }, {from, stored});
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 5. 통계 도우미 ────────────────────────────────────────────── */
const r4=x=>x==null||!isFinite(x)?null:+x.toFixed(4);
const r6=x=>x==null||!isFinite(x)?null:+x.toFixed(6);
const sig4=x=>x==null||!isFinite(x)?null:(x===0?0:+x.toPrecision(4));
const median=a=>{ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };
/* 푸아송 양측 p — min(1, 2·min(P[X≤k], P[X≥k])), X~Poisson(λ). 로그 공간 합(λ 수만까지 안정). */
function poisP(lam, k){
  if(!(lam>0)) return k>0?0:1;
  const K=Math.ceil(Math.max(k, lam+12*Math.sqrt(lam)+30));
  const lf=new Float64Array(K+2); for(let j=1;j<=K+1;j++) lf[j]=lf[j-1]+Math.log(j);
  const lg=Math.log(lam), lp=j=>-lam+j*lg-lf[j];
  const lse=(a,b)=>{ let m=-Infinity; for(let j=a;j<=b;j++){ const v=lp(j); if(v>m) m=v; }
    if(m===-Infinity) return 0; let s=0; for(let j=a;j<=b;j++) s+=Math.exp(lp(j)-m); return Math.exp(m)*s; };
  const lo=Math.min(1, lse(0,k));
  const hi=k<=0?1:Math.min(1, lse(k,K));
  return Math.min(1, 2*Math.min(lo,hi));
}
/* 로또 한 줄 vs 무작위 추첨의 본번호 일치 개수 분포 (C456 분모): C(6,k)·C(39,6−k) */
const HYP=[3262623,3454542,1233765,182780,11115,234,1];

/* 교차 적중의 «우연» 분포 — 몬테카를로.
   푸아송 근사는 쌍을 서로 독립으로 본다. 실제로는 한 추첨이 수백 줄과 동시에 대조되고 줄끼리 번호(연금은 끝자리)를
   공유하므로 개수의 흔들림이 훨씬 크다. 그래서 «줄은 그대로, 추첨만 무작위(균등·독립)»로 M번 다시 뽑아
   각 칸 개수의 분포를 만든다 → sd(우연의 흔들림)·pMC(양측). 시드 고정이라 결정적이다.
   (선택 로직이 아니라 귀무모형이므로 Node 에서 센다. 실제 추첨 대조 개수는 페이지 rankOf/gradeOf 값이다.) */
function mulberry32N(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const LKEYS=['3','4','5','5b','6','ge3'], PKEYS=['1','2','3','4','5','6','7','8','any'];
/* lines: [{b, c:[6]}] (로또) · [{b, band, num:'dddddd'}] (연금). draws: 대조한 추첨 회차 목록.
   반환 cnt[cls] = Int32Array(M*K) — sim s 의 key k 개수 = cnt[cls][s*K+k] */
function mcCross(kind, lines, draws, M, seed, actual){
  const isL=kind==='lotto', K=isL?LKEYS.length:PKEYS.length, nL=lines.length;
  const cnt={before:new Int32Array(M*K), same:new Int32Array(M*K), after:new Int32Array(M*K)};
  const B=Int32Array.from(lines.map(x=>x.b)), rng=mulberry32N(seed);
  const clsOf=(d,b)=>d<b?cnt.before:d===b?cnt.same:cnt.after;
  if(isL){
    const byNum=Array.from({length:46},()=>[]);
    lines.forEach((x,i)=>x.c.forEach(n=>byNum[n].push(i)));
    const idx=byNum.map(a=>Int32Array.from(a));
    const hits=new Uint8Array(nL), touched=new Int32Array(nL*6+6), isBon=new Uint8Array(nL);
    const pool=Uint8Array.from({length:45},(_,i)=>i+1);
    for(let s=0;s<M;s++){
      const o=s*K;
      for(const d of draws){
        if(actual){ const a=actual.get(d); for(let i=0;i<6;i++) pool[i]=a.n[i]; pool[6]=a.b; }
        else for(let i=0;i<7;i++){ const j=i+Math.floor(rng()*(45-i)); const t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
        let nt=0;
        for(let q=0;q<6;q++){ const a=idx[pool[q]]; for(let u=0;u<a.length;u++){ const li=a[u]; if(hits[li]++===0) touched[nt++]=li; } }
        const bl=idx[pool[6]]; for(let u=0;u<bl.length;u++) isBon[bl[u]]=1;
        for(let u=0;u<nt;u++){
          const li=touched[u], h=hits[li]; hits[li]=0;
          if(h<3) continue;
          const k=h===6?4:h===5?(isBon[li]?3:2):h===4?1:0;
          const C=clsOf(d,B[li]); C[o+k]++; C[o+5]++;
        }
        for(let u=0;u<bl.length;u++) isBon[bl[u]]=0;
      }
    }
  } else {
    const nums=lines.map(x=>+x.num), bands=lines.map(x=>+x.band);
    const byLast=Array.from({length:10},()=>[]); nums.forEach((v,i)=>byLast[v%10].push(i));
    const byNum=new Map(); nums.forEach((v,i)=>{ if(!byNum.has(v)) byNum.set(v,[]); byNum.get(v).push(i); });
    const P10=[1,10,100,1000,10000,100000,1000000], GI={1:0,2:1,3:2,4:3,5:4,6:5,7:6,8:7};
    const bonusHit=new Uint8Array(nL);
    for(let s=0;s<M;s++){
      const o=s*K;
      for(const d of draws){
        let w, wb, bn;
        if(actual){ const a=actual.get(d); w=a.w; wb=a.wb; bn=a.bn; }
        else { w=Math.floor(rng()*1e6); wb=1+Math.floor(rng()*5); bn=Math.floor(rng()*1e6); }
        const bset=(bn!==w)?byNum.get(bn):null;              // 보너스 번호와 같은 표(주번호와 같으면 1·2등이 우선)
        if(bset) for(const li of bset){ bonusHit[li]=1; const C=clsOf(d,B[li]); C[o+GI[8]]++; C[o+8]++; }
        for(const li of byLast[w%10]){
          if(bonusHit[li]) continue;
          const v=nums[li]; let t=1; while(t<6 && v%P10[t+1]===w%P10[t+1]) t++;
          const g=t===6?(bands[li]===wb?1:2):8-t;
          const C=clsOf(d,B[li]); C[o+GI[g]]++; C[o+8]++;
        }
        if(bset) for(const li of bset) bonusHit[li]=0;
      }
    }
  }
  return {cnt, K, keys:isL?LKEYS:PKEYS};
}
/* 모의 분포 → 평균·sd·양측 p  (p = min(1, 2·min((1+#≤obs)/(M+1), (1+#≥obs)/(M+1)))) */
function mcStats(arr, K, k, M, obs){
  let s1=0, s2=0, le=0, ge=0;
  for(let s=0;s<M;s++){ const v=arr[s*K+k]; s1+=v; s2+=v*v; if(v<=obs) le++; if(v>=obs) ge++; }
  const mean=s1/M, sd=Math.sqrt(Math.max(0,(s2-M*mean*mean)/(M-1)));
  return {mean, sd, p:Math.min(1, 2*Math.min((1+le)/(M+1),(1+ge)/(M+1)))};
}

/* ── 6. 조립 — 행(cum·prevHit·cross) · 요약 · 교차 요약 ───────────── */
function warn(title, msg){ console.log(`::warning title=${title}::${msg}`); }

function bestBlock(perLine, col, ncol, F){
  const hist={}, exp={}; for(let k=0;k<=6;k++){ hist[k]=0; exp[k]=0; }
  let lines=0;
  for(const row of perLine){
    const b=row[col], N=row[ncol]; if(N<=0||b<0) continue;
    lines++; hist[b]++;
    for(let k=0;k<=6;k++) exp[k]+=Math.pow(F[k],N)-(k?Math.pow(F[k-1],N):0);
  }
  for(let k=0;k<=6;k++) exp[k]=r4(exp[k]);
  return {lines, hist, exp};
}

function build(kind, page, storedFile, from, ledger, raw){
  const isL=kind==='lotto';
  const L=page.L, rowsIn=page.rounds;
  const ORDER=[1,2,8,3,4,5,6,7];
  const better=isL ? (a,b)=>(b>0&&(a===0||b<a)) : (a,b)=>(b>0&&(a===0||ORDER.indexOf(b)<ORDER.indexOf(a)));
  const RK=isL?['1','2','3','4','5']:['1','2','3','4','5','6','7','8'];
  const P={};    // 등수별 1줄 확률
  let Pany, amtOf=null;
  if(isL){ const C=page.C456; RK.forEach(k=>P[k]=page.WAYS[k]/C); Pany=194130/C; }
  else { amtOf={}; page.ranks.forEach(r=>{ P[String(r.k)]=r.p; amtOf[r.k]=r.amt; }); Pany=page.ranks.reduce((a,r)=>a+r.p,0); }
  const storedBy=new Map(((storedFile&&storedFile.rows)||[]).map(r=>[r.round,r]));
  const regrade=[];
  const rows=[];
  const cum={weeks:0, spend:0, ret:0, ranks:Object.fromEntries(RK.map(k=>[k,0])), anyWeeks:0, lastPrizeRound:null, bestRank:0};
  const weekly=[]; let bestRound=null, dryRun=0, dryMax=0, expRet=0, expSmall=0, expAny=0;
  /* 연금 1장 기대값(전체 / 4~7등만) — RANKS 에서 */
  const pEV=isL?0:page.ranks.reduce((a,x)=>a+x.p*x.amt,0);
  const pEVs=isL?0:page.ranks.filter(x=>[4,5,6,7].includes(x.k)).reduce((a,x)=>a+x.p*x.amt,0);
  let prev=null;
  for(const r of rowsIn){
    let result=r.result, ret=r.ret, date=r.date;
    const s=storedBy.get(r.round);
    if(r.kept && s){
      if(s.date) date=s.date;
      if(Array.isArray(s.result) && s.result.length===5){
        if(JSON.stringify(s.result)!==JSON.stringify(result) || s.ret!==ret){ regrade.push(r.round); result=s.result; ret=s.ret; }
      }
    }
    if(r.status==='pending' && isL && !date){
      const y=page.lastYmd, dt=new Date(Date.UTC(+y.slice(0,4),+y.slice(4,6)-1,+y.slice(6,8)+7));
      date=dt.toISOString().slice(0,10).replace(/-/g,'');
    }
    const done=r.status==='done';
    if(done){
      cum.weeks++; cum.spend+=GAMES*TICKET; cum.ret+=ret;
      let any=false, best=0;
      result.forEach(x=>{ const g=isL?x.rank:x.grade; if(g>0){ any=true; cum.ranks[g]=(cum.ranks[g]||0)+1; if(better(best,g)) best=g; } });
      if(any){ cum.anyWeeks++; cum.lastPrizeRound=r.round; dryRun=0; } else { dryRun++; if(dryRun>dryMax) dryMax=dryRun; }
      if(better(cum.bestRank,best)){ cum.bestRank=best; bestRound=r.round; }
      weekly.push(ret);
      if(isL){
        expRet+=r.ev||0; expSmall+=r.evSmall||0;
        expAny+= r.pAny!=null ? r.pAny : 1-Math.pow(1-Pany,GAMES);
      } else {
        expRet+=GAMES*pEV; expSmall+=GAMES*pEVs;
        /* 연금 «한 장이라도» 정확 확률: 주번호 끝자리가 5장 끝자리 중 하나(dL/10) 이거나, 보너스가 5장 번호 중 하나(dN/10^6).
           두 추첨은 독립이고, 끝자리가 안 맞으면 1~7등이 모두 불가능하므로 P(없음)=(1−dL/10)(1−dN/10^6). */
        const nums=r.picks.map(x=>String(x).slice(-6));
        const dL=new Set(nums.map(x=>x.slice(-1))).size, dN=new Set(nums).size;
        expAny+=1-(1-dL/10)*(1-dN/1e6);
      }
    }
    const prevHit = prev ? (isL
      ? {round:prev.round, hits:prev.result?prev.result.map(x=>x.hit):null, ranks:prev.result?prev.result.map(x=>x.rank):null, ret:prev.ret}
      : {round:prev.round, grades:prev.result?prev.result.map(x=>x.grade):null, ret:prev.ret}) : null;
    let cross=null;
    const X=page.cross.rowX[r.round];
    if(done && X) cross={pairs:X.pairs, n:X.n, any:X.any, exp:r4(X.pairs*Pany), top:X.top};
    else if(done) cross={pairs:0, n:Object.fromEntries((isL?['3','4','5','5b','6']:RK).map(k=>[k,0])), any:0, exp:0, top:[]};
    const row={round:r.round, date, status:r.status, rule:r.rule, picks:r.picks,
      result:done?result:null, ret:done?ret:null, carry:r.carry, prevHit,
      cum:{weeks:cum.weeks, spend:cum.spend, ret:cum.ret, net:cum.ret-cum.spend, roi:cum.spend?r6(cum.ret/cum.spend):0,
           ranks:Object.assign({},cum.ranks), anyWeeks:cum.anyWeeks, lastPrizeRound:cum.lastPrizeRound, bestRank:cum.bestRank},
      cross};
    rows.push(row); prev=row;
  }
  const pend=rows[rows.length-1];
  const W=cum.weeks;
  /* 교차 요약 */
  const C=page.cross, cls={};
  const EXPK=isL ? {'3':HYP[3],'4':HYP[4],'5':228,'5b':6,'6':1,ge3:194130} : null;
  /* 우연 분포(몬테카를로) — 줄은 최종 원장 그대로, 추첨만 무작위. 먼저 실제 추첨으로 한 번 «재생»해
     Node 셈이 페이지 rankOf/gradeOf 셈과 같은지 확인한다(다르면 귀무모형을 믿을 수 없다). */
  const mcLines=[];
  rows.forEach(r=>r.picks.forEach(x=>{
    if(isL) mcLines.push({b:r.round, c:String(x).split(',').map(Number)});
    else { const m=String(x).match(/^(\d)조 (\d{6})$/); mcLines.push({b:r.round, band:+m[1], num:m[2]}); }
  }));
  const draws=C.drawList;
  const actual=new Map();
  if(isL) raw.rows.forEach(o=>actual.set(+o.ltEpsd,{n:[o.tm1WnNo,o.tm2WnNo,o.tm3WnNo,o.tm4WnNo,o.tm5WnNo,o.tm6WnNo].map(Number), b:+o.bnsWnNo}));
  else raw.forEach(o=>actual.set(+o.ep,{w:+o.num, wb:+o.band, bn:+o.bonus}));
  let replayOk=true;
  if(draws.every(d=>actual.has(d))){
    const rp=mcCross(kind, mcLines, draws, 1, 1, actual);
    for(const k of ['before','same','after']) rp.keys.forEach((key,i)=>{ if(rp.cnt[k][i]!==C.cls[k].obs[key]) replayOk=false; });
  } else replayOk=null;
  if(replayOk===false) warn(`모의 원장 교차 재생(${kind})`, '실제 추첨을 Node 로 다시 센 개수가 페이지 채점과 다릅니다 — pMC 를 믿지 마세요');
  const tMC=Date.now();
  const mc=mcCross(kind, mcLines, draws, SIMS, isL?20260924:20260925);
  const mcMs=Date.now()-tMC;
  const mcOdd=[];
  for(const k of ['before','same','after']){
    const c=C.cls[k], obs=c.obs, exp={}, sd={}, p={}, pMC={};
    for(const key of Object.keys(obs)){
      const e= isL ? c.pairs*EXPK[key]/page.C456 : c.pairs*(key==='any'?Pany:P[key]);
      exp[key]=r4(e); p[key]=sig4(poisP(e, obs[key]));
      const ki=mc.keys.indexOf(key), st=mcStats(mc.cnt[k], mc.K, ki, SIMS, obs[key]);
      sd[key]=r4(st.sd); pMC[key]=sig4(st.p);
      /* 모의 평균이 해석적 기대와 크게 어긋나면(>6 표준오차) 귀무모형 구현을 의심 */
      if(Math.abs(st.mean-e) > 6*Math.max(st.sd,0.05)/Math.sqrt(SIMS) + 1e-9 && e>0.5) mcOdd.push(`${k}.${key} 모의평균 ${st.mean.toFixed(2)} vs 기대 ${e.toFixed(2)}`);
    }
    cls[k]={pairs:c.pairs, obs, exp, sd, p, pMC};
  }
  if(mcOdd.length) warn(`모의 원장 우연 분포(${kind})`, mcOdd.slice(0,6).join(' · '));
  const gOrd=g=>{ const i=ORDER.indexOf(g); return i<0?99:i; };
  const notable=C.notable.slice().sort(isL
    ? (a,b)=>a.rank-b.rank||b.draw-a.draw||b.boughtIn-a.boughtIn
    : (a,b)=>(amtOf[b.grade]-amtOf[a.grade])||gOrd(a.grade)-gOrd(b.grade)||b.draw-a.draw||b.boughtIn-a.boughtIn);
  let F;
  if(isL){ F=[]; let acc=0; for(let k=0;k<=6;k++){ acc+=HYP[k]; F.push(acc/page.C456); } F[6]=1; }
  else { F=[0,1,2,3,4,5].map(k=>1-Math.pow(10,-(k+1))); F.push(1); }
  const best={ all:bestBlock(C.perLine,1,4,F), before:bestBlock(C.perLine,2,5,F), after:bestBlock(C.perLine,3,6,F) };
  const crossNote = isL
    ? '산 모든 줄(대기 중인 이번 주 줄 포함) × 1회부터 모든 추첨. before(산 회차보다 이전 추첨)는 선택이 이미 본 자료라 증거가 아닙니다 — 추천은 과거 1등 조합을 빼고 고르므로 before 의 6개 일치 0 은 구조적입니다. same 은 실제 모의 원장, after 만 표본 밖입니다. 기대 개수는 무작위 추첨 가정(C(45,6)). 한 추첨이 수백 줄과 동시에 대조되고 줄끼리 번호를 공유해 개수는 푸아송보다 크게 흔들립니다 — sd·pMC 는 «줄은 그대로, 추첨만 무작위»로 다시 뽑은 모의 분포, p 는 참고용 푸아송 근사입니다. 여러 칸을 동시에 보면 몇 칸은 우연히 p 가 작습니다.'
    : '산 모든 표(대기 중인 이번 주 표 포함) × 1회부터 모든 추첨. before(산 회차보다 이전 추첨)는 번호 모델이 이미 본 자료라 증거가 아닙니다. same 은 실제 모의 원장, after 만 표본 밖입니다. 기대 개수는 RANKS 의 1장당 확률. 한 추첨이 수백 장과 동시에 대조되고 끝자리를 공유하는 표가 많아 개수는 푸아송보다 크게 흔들립니다 — sd·pMC 는 «표는 그대로, 추첨만 무작위»로 다시 뽑은 모의 분포, p 는 참고용 푸아송 근사입니다. 여러 칸을 동시에 보면 몇 칸은 우연히 p 가 작습니다.';
  const summary={
    weeks:W, spend:cum.spend, ret:cum.ret, net:cum.ret-cum.spend, roi:cum.spend?r6(cum.ret/cum.spend):0,
    mean:W?+(cum.ret/W).toFixed(1):null, median:median(weekly),
    ranks:Object.assign({},cum.ranks), anyWeeks:cum.anyWeeks, anyRate:W?r6(cum.anyWeeks/W):null,
    bestRank:cum.bestRank, bestRound, lastPrizeRound:cum.lastPrizeRound,
    dry:{max:dryMax, current:dryRun},
    exp:{ ret:Math.round(expRet), ranks:Object.fromEntries(RK.map(k=>[k,r4(W*GAMES*P[k])])),
          retSmall:Math.round(expSmall), anyWeeks:r4(expAny) },
    pending: pend&&pend.status==='pending' ? {round:pend.round, date:pend.date, picks:pend.picks} : null,
    cross:{ lines:C.lines, draws:draws.length, sims:SIMS, replay:replayOk, classes:cls, notable, best, note:crossNote }
  };
  /* 점검 */
  const liveOk = !!(page.live && !page.live.error && pend && pend.status==='pending' && page.live.round===pend.round
                    && Array.isArray(page.live.picks) && page.live.picks.join('|')===pend.picks.join('|'));
  let led=null;
  if(ledger){
    const firstFrom=(page.rules&&page.rules.length)?page.rules[0].from:Infinity;
    const simBy=new Map(rows.map(r=>[r.round,r]));
    const compared=[], mismatch=[];
    for(const e of (ledger.data.rounds||[])){
      if(e.kind!==kind || e.round<firstFrom || !simBy.has(e.round) || !Array.isArray(e.picks)) continue;
      compared.push(e.round);
      if(e.picks.slice(0,5).join('|')!==simBy.get(e.round).picks.join('|')) mismatch.push(e.round);
    }
    led={file:ledger.rel, compared, mismatch};
  }
  const checks={
    live:{round:pend?pend.round:null, ok:liveOk, ledger:led},
    determinism:{compared:page.det.compared, mismatch:page.det.mismatch, ruleChanged:page.det.ruleChanged, regrade},
    kept:rowsIn.filter(r=>r.kept).length, added:rows.filter(r=>!storedBy.has(r.round)||storedBy.get(r.round).status!=='done').length
  };
  const RL=page.rules, LASTR=RL[RL.length-1];
  const rule = isL
    ? {name:'portfolio@'+LASTR.from, from:LASTR.from, opts:LASTR.opts}
    : {name:LASTR.mode+'@'+LASTR.from, from:LASTR.from, mode:LASTR.mode,
       settings:{model:page.settings.model, K:page.settings.K, J:page.settings.J}, seed:'ep*7919'};
  const note = isL
    ? `가정 — 로또 ${from}회부터 매주 현재 추천 규칙의 5게임(A~E)을 샀다면. 매 회차 번호는 그 직전 회차까지의 자료만으로 뽑았습니다(미래 자료 없음). 실제 구매 기록이 아니며, 어떤 규칙도 당첨 확률을 바꾸지 않습니다(1게임 1등 1/8,145,060). 교차 적중은 우연이므로 기대 개수와 함께 봅니다.`
    : `가정 — 연금복권 ${from}회부터 매주 현재 추천 규칙(${LASTR.mode==='spread'?'분산 5장':LASTR.mode==='set'?'세트 5장':LASTR.mode})을 샀다면. 매 회차 번호는 그 직전 회차까지의 자료만으로 뽑았습니다(미래 자료 없음). 실제 구매 기록이 아니며, 금액은 명목·세전입니다. 어떤 규칙도 1장당 기대값(750원)을 바꾸지 않습니다. 교차 적중은 우연이므로 기대 개수와 함께 봅니다.`;
  return { v:1, kind, from, to:rows.length?rows[rows.length-1].round:null, latest:L,
           generated:new Date().toISOString(), rule, games:GAMES, ticket:TICKET, note, checks, rows, summary, _ms:{mc:mcMs} };
}

/* 직렬화 — rows 는 한 행 한 줄(깃 diff 가 읽히게). 나머지 키는 고정 순서. */
function serialize(o){
  const keys=['v','kind','from','to','latest','generated','rule','games','ticket','note','checks','rows','summary'];
  const parts=keys.map(k=>{
    if(k==='rows') return '"rows":[\n'+o.rows.map(r=>JSON.stringify(r)).join(',\n')+'\n]';
    if(k==='summary'||k==='checks') return JSON.stringify(k)+':'+JSON.stringify(o[k],null,1);
    return JSON.stringify(k)+':'+JSON.stringify(o[k]);
  });
  return '{'+parts.join(',\n')+'}\n';
}

function loadStored(file, kind){
  if(!fs.existsSync(file)) return null;
  try{
    const o=JSON.parse(fs.readFileSync(file,'utf8'));
    if(o.v!==1||o.kind!==kind||!Array.isArray(o.rows)){ warn('모의 원장 형식', `${path.basename(file)} 가 v1/${kind} 형식이 아니라 새로 만듭니다`); return null; }
    return o;
  }catch(e){ warn('모의 원장 읽기 실패', `${path.basename(file)}: ${e.message} — 새로 만듭니다`); return null; }
}
function loadLedger(){
  const cands=[arg('--purchases',null), path.join(OUT,'brief','purchases.json'), path.join(ROOT,'brief','purchases.json')].filter(Boolean);
  for(const f of cands){
    if(!fs.existsSync(f)) continue;
    try{ const data=JSON.parse(fs.readFileSync(f,'utf8'));
      return {data, rel:path.relative(OUT,f).split(path.sep).join('/')||f}; }catch(e){}
  }
  return null;
}

async function runKind(kind, browser, base, pension, lotto, argFrom, ledger){
  const file=path.join(OUT,'brief',`sim-${kind}.json`);
  const stored=loadStored(file, kind);
  const from=stored&&stored.from?Math.min(argFrom, stored.from):argFrom;
  const storedMap={};
  if(stored) for(const r of stored.rows) if(r&&r.status==='done') storedMap[r.round]={status:'done', picks:r.picks, rule:r.rule};
  const t=Date.now();
  const page = kind==='lotto'
    ? await readLotto(browser, base, pension, lotto, from, storedMap)
    : await readPension(browser, base, pension, lotto, from, storedMap);
  if(page.error) throw new Error(page.error);
  if(stored && stored.latest>page.L){
    warn('모의 원장 건너뜀', `${kind}: 기존 파일(최신 ${stored.latest}회)이 지금 데이터(최신 ${page.L}회)보다 앞서 있어 쓰지 않습니다`);
    return {kind, skipped:true};
  }
  const o=build(kind, page, stored, from, ledger, kind==='lotto'?lotto:pension);
  /* 경고 — 결정성·라이브 동일성·채점 */
  const ck=o.checks;
  if(ck.determinism.mismatch.length) warn(`모의 원장 결정성(${kind})`, `기존 done 행과 다시 계산한 번호가 다릅니다: ${ck.determinism.mismatch.slice(0,20).join(', ')} — 기존 행을 그대로 둡니다`);
  if(ck.determinism.regrade.length) warn(`모의 원장 채점(${kind})`, `기존 채점과 다시 채점한 결과가 다릅니다: ${ck.determinism.regrade.slice(0,20).join(', ')} — 기존 값을 그대로 둡니다`);
  if(!ck.live.ok) warn(`모의 원장 라이브 동일성(${kind})`, `대기 행 ${ck.live.round}회 번호 ≠ 페이지 이번 주 추천 (${JSON.stringify(page.live).slice(0,200)})`);
  if(ck.live.ledger&&ck.live.ledger.mismatch.length) warn(`모의 원장 ≠ 추천 원장(${kind})`, `${ck.live.ledger.mismatch.join(', ')}회 번호가 ${ck.live.ledger.file} 와 다릅니다`);
  if(page.missing&&page.missing.length) warn(`모의 원장 자료 빠짐(${kind})`, `${page.missing.join(', ')}회 추첨 자료가 없어 건너뜀`);
  if(page.ruleOdd&&page.ruleOdd.length) warn(`모의 원장 규칙(${kind})`, `weeklyPicks('portfolio') 규칙이 규칙표와 다른 회차: ${page.ruleOdd.slice(0,20).join(', ')}`);
  if(page.odd&&page.odd.length) warn(`모의 원장 회차(${kind})`, `nextDraw/규칙표가 기대와 다른 회차: ${page.odd.slice(0,20).join(', ')}`);
  if(page.rankOdd&&page.rankOdd.length) warn(`모의 원장 rankOf(${kind})`, JSON.stringify(page.rankOdd).slice(0,300));
  if(page.pageErrors) console.error(`      페이지 오류(${kind}): ${page.pageErrors.join(' | ')}`);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file, serialize(o));
  const S=o.summary, X=S.cross.classes;
  const keyAny=kind==='lotto'?'ge3':'any';
  return { kind, file:path.relative(OUT,file).split(path.sep).join('/'), from:o.from, to:o.to, weeks:S.weeks,
    spend:S.spend, ret:S.ret, roi:S.roi, mean:S.mean, median:S.median, ranks:S.ranks, anyWeeks:S.anyWeeks,
    exp:S.exp, bestRank:S.bestRank, bestRound:S.bestRound,
    cross:Object.fromEntries(Object.entries(X).map(([k,c])=>[k,{pairs:c.pairs, obs:c.obs[keyAny], exp:c.exp[keyAny], sd:c.sd[keyAny], pMC:c.pMC[keyAny], pPois:c.p[keyAny]}])),
    replay:S.cross.replay,
    notable:S.cross.notable.length, notableAfter:S.cross.notable.filter(n=>n.cls==='after').length,
    checks:{live:ck.live.ok, ledger:ck.live.ledger?`${ck.live.ledger.compared.length - ck.live.ledger.mismatch.length}/${ck.live.ledger.compared.length}`:null,
            determinism:`${ck.determinism.compared-ck.determinism.mismatch.length}/${ck.determinism.compared}`, kept:ck.kept, added:ck.added},
    degraded:page.degraded?page.degraded.length:undefined,
    ms:{...page.ms, mc:o._ms.mc, total:Date.now()-t} };
}

/* ── 7. 실행 ─────────────────────────────────────────────────── */
(async()=>{
  const t0=Date.now();
  console.error('[1/3] 데이터…');
  const [pension, lotto] = await getData();
  const ledger=loadLedger();
  console.error('[2/3] 페이지 walk-forward…');
  const {srv,port}=await serve(ROOT);
  const base=`http://127.0.0.1:${port}`;
  const res=[];
  try{
    await withBrowser(async browser=>{
      if(ONLY!=='pension'){ console.error(`      로또 ${LOTTO_FROM}회~`); res.push(await runKind('lotto', browser, base, pension, lotto, LOTTO_FROM, ledger)); }
      if(ONLY!=='lotto'){ console.error(`      연금 ${PENSION_FROM}회~`); res.push(await runKind('pension', browser, base, pension, lotto, PENSION_FROM, ledger)); }
    });
  } finally { srv.close(); }
  console.error('[3/3] 저장 완료');
  console.log(JSON.stringify({seconds:+((Date.now()-t0)/1000).toFixed(1), out:OUT, results:res},null,1));
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
