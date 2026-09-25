#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   당첨 순위 추적 (walk-forward) — «매 회차 모든 조합에 순위를 매겼다면, 실제 당첨번호는 몇 위였나»

   결과물(모두 --out 기준, 형식: .lab/PLAN3.md §3 v1)
     brief/rank-lotto.json          회차별 당첨 조합의 순위(모델 pop·popf·hot·cold) + 요약 통계 + 다음 회차 상위 20
     brief/rank-params-lotto.json   회차별 모델 파라미터(탐색기가 과거 회차 순위표를 그대로 재현)
     brief/rank-pension.json        회차별 1등 티켓(조+6자리)의 순위(모델 freq·cold·recent·gap·rand·site) + 요약 + 다음 회차
     brief/rank-params-pension.json 회차별 currentScores() 원점수

   정직성
     · walk-forward: 회차 R 의 순위표는 페이지 DB 를 R−1 회까지 잘라서(미래 자료 없음) 페이지 함수로 얻은 파라미터로만 만든다.
         로또  fitPop() 의 A/B/bounds · weightsFor('hot') · weightsFor('cold')
         연금  currentScores(m, ep·7919) (m = freq·cold·recent·gap·rand) · predSettings().model(= site 별칭)
       파라미터 추출 로직은 여기에 다시 구현하지 않는다(backfill·validate 와 같은 원칙). 순위는 rank-core.js(공용 엔진)로 센다.
     · 추첨이 공정하면 어떤 순위표든 당첨 백분위는 0~100% 에 균등하게 흩어진다(귀무가설 = 균등).
       모든 요약 수치는 그 기준선(기대값·p)과 나란히 적는다. 분배 모델 순서는 «나눠 갖는 인원이 적은 순서»이지
       «맞을 가능성» 순서가 아니다. hot·cold·연금 모델은 «잘 맞는다»는 주장을 검정하는 대상이다.

   적재(append-only) — 기존 행은 그대로 둔다. 마지막 4개 행은 다시 계산해(파라미터 추출부터) 다르면 ::warning 만
   남기고 저장값을 유지한다(결정성 감시). 다음 회차(latest+1)의 파라미터·상위 목록은 매번 새로 계산한다.
   요약(summary)은 최종 행들로 매번 다시 계산한다.

   CLI: node scripts/rank-track.mjs --root . --out . [--cache <file>] [--lotto-from 1000] [--pension-from 100]
                                    [--only lotto|pension] [--core <rank-core.js 경로; 기본 <root>/rank-core.js>]
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';
import vm from 'vm';

const arg=(k,d)=>{ const i=process.argv.indexOf(k); return i>0?process.argv[i+1]:d; };
const ROOT=path.resolve(arg('--root', process.cwd()));
const OUT =path.resolve(arg('--out', ROOT));
const LOTTO_FROM=Math.max(2, parseInt(arg('--lotto-from','1000'),10)||1000);
const PENSION_FROM=Math.max(2, parseInt(arg('--pension-from','100'),10)||100);
const ONLY=arg('--only',null);
const CORE=path.resolve(arg('--core', path.join(ROOT,'rank-core.js')));
const RECHECK=4, WARMUP=20, TOPN=20;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>Number(process.hrtime.bigint()/1000000n);

async function jget(url,tries=8){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (lotto-lab)'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await sleep(Math.min(20000,1000*2**i)); }
  }
}

/* ── 1. 데이터 (validate·backfill 와 같은 코드·같은 --cache 형식) ─────── */
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

/* ── 2. 페이지 띄우기 (backfill 과 같은 serve / mockRoutes) ───────────── */
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

/* ── 3. 로또 — 페이지 안에서 회차별 파라미터만 추출 (한 번의 evaluate 가 회차를 돈다) ─── */
async function lottoParams(browser, base, pension, lotto, rounds){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/index.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100&&DB.draws&&DB.draws[DB.latest],{timeout:120000});
  await p.waitForTimeout(1500);
  const out=await p.evaluate(({rounds})=>{
    if(typeof fitPop!=='function'||typeof weightsFor!=='function'||typeof bumpDB!=='function'||typeof allRows!=='function')
      return {error:'index.html 에 fitPop/weightsFor/bumpDB/allRows 가 없습니다'};
    /* 스크립트가 모르는 캐시는 DB.rev 로 무효화된다(bumpDB). 이름 있는 캐시는 직접 비운다(backfill 과 같음). */
    const reset=()=>{ try{ POPFIT=null; POPFIT_N=-1; }catch(e){} try{ WINSET=null; WINSET_N=-1; }catch(e){} };
    const pk=m=>m?{beta:Array.from(m.beta), predMean:m.predMean, predSD:m.predSD}:null;
    const snap=()=>{ const F=fitPop();
      return { pop: F&&F.A ? {A:pk(F.A), B:pk(F.B), bounds:(F.bounds||[]).map(b=>[b[0],b[1]])} : null,
               hot: Array.from(weightsFor('hot')), cold: Array.from(weightsFor('cold')) }; };
    const orig=DB.draws, L=DB.latest, work=orig.slice();
    const params={}, missing=[];
    const t0=performance.now();
    try{
      DB.draws=work;
      for(const R of rounds){
        if(R<=L && !orig[R]){ missing.push(R); continue; }
        for(let j=1;j<orig.length;j++) work[j]=orig[j];
        for(let j=R;j<work.length;j++) work[j]=undefined;
        DB.latest=R-1; bumpDB(); reset();
        params[R]=snap();
      }
    } finally { DB.draws=orig; DB.latest=L; bumpDB(); reset(); }
    const ms=performance.now()-t0;
    /* 라이브 동일성 — 전체 DB 그대로(사이트가 지금 쓰는 값) = 다음 회차 파라미터여야 한다 */
    let live=null; try{ live=snap(); }catch(e){ live={error:String(e&&e.message||e)}; }
    const draws=[];
    for(let r=1;r<=L;r++){ const d=orig[r]; if(d) draws.push([r, String(d.ymd), d.n.slice().sort((a,b)=>a-b), d.b]); }
    return {L, lastYmd:String(orig[L].ymd), params, live, missing, draws, ms:Math.round(ms)};
  }, {rounds});
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 4. 연금 — 페이지 안에서 회차별 currentScores 추출 ───────────────── */
const PMODELS=['freq','cold','recent','gap','rand'];
async function pensionParams(browser, base, pension, lotto, eps){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1200);
  const out=await p.evaluate(({eps, M})=>{
    if(typeof currentScores!=='function'||typeof predSettings!=='function'||typeof nextDraw!=='function')
      return {error:'pension.html 에 currentScores/predSettings/nextDraw 가 없습니다'};
    const save=DB.rounds;
    const all=save.slice().sort((a,b)=>a.ep-b.ep), L=all[all.length-1].ep;
    const byEp=new Set(all.map(r=>r.ep));
    const site=predSettings().model;
    const cp=s=>({pos:s.pos.map(a=>Array.from(a)), band:Array.from(s.band)});
    const params={}, missing=[], odd=[];
    let nextDate=null;
    const t0=performance.now();
    try{
      for(const ep of eps){
        if(ep<=L && !byEp.has(ep)){ missing.push(ep); continue; }
        DB.rounds=all.filter(r=>r.ep<ep);
        const nx=nextDraw();
        if(!nx||nx.ep!==ep) odd.push(ep);
        if(ep===L+1&&nx) nextDate=nx.date;
        const S={}; for(const m of M) S[m]=cp(currentScores(m, ep*7919));
        params[ep]={site:predSettings().model, S};
      }
    } finally { DB.rounds=save; }
    const ms=performance.now()-t0;
    let live=null;
    try{ const nx=nextDraw(); const S={}; for(const m of M) S[m]=cp(currentScores(m, nx.ep*7919)); live={ep:nx.ep, site, S}; }
    catch(e){ live={error:String(e&&e.message||e)}; }
    const draws=all.map(r=>[r.ep, String(r.date), +r.band, String(r.num).padStart(6,'0')]);
    return {L, site, params, live, missing, odd, nextDate, draws, ms:Math.round(ms)};
  }, {eps, M:PMODELS});
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 5. 통계 ─────────────────────────────────────────────────────── */
const r6=x=>x==null||!isFinite(x)?null:+x.toFixed(6);
const sig6=x=>x==null||!isFinite(x)?null:(x===0?0:+x.toPrecision(6));
const clamp01=x=>x<0?0:x>1?1:x;
const median=a=>{ if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), n=s.length; return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };
function gammaln(x){                                    // Lanczos (index.html 과 같은 계수)
  const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let y=x, t=x+5.5; t-=(x+0.5)*Math.log(t);
  let s=1.000000000190015; for(let j=0;j<6;j++) s+=c[j]/++y;
  return -t+Math.log(2.5066282746310005*s/x);
}
function gser(a,x){ let ap=a, sum=1/a, del=sum;
  for(let n=0;n<500;n++){ ap++; del*=x/ap; sum+=del; if(Math.abs(del)<Math.abs(sum)*1e-15) break; }
  return sum*Math.exp(-x+a*Math.log(x)-gammaln(a)); }
function gcf(a,x){ const FP=1e-300; let b=x+1-a, c=1/FP, d=1/b, h=d;
  for(let i=1;i<=500;i++){ const an=-i*(i-a); b+=2; d=an*d+b; if(Math.abs(d)<FP)d=FP;
    c=b+an/c; if(Math.abs(c)<FP)c=FP; d=1/d; const del=d*c; h*=del; if(Math.abs(del-1)<1e-15) break; }
  return Math.exp(-x+a*Math.log(x)-gammaln(a))*h; }
function chi2p(x,k){ if(x<=0) return 1; const a=k/2, y=x/2; return clamp01(y<a+1 ? 1-gser(a,y) : gcf(a,y)); }   // 상측
/* 이항 양측 정확검정 — pension.html binomTest 와 같은 정의(관측 확률 이하인 칸의 합).
   k 가 정수가 아니면(동점 비율 합) 관측 확률만 감마함수로 연장해 같은 규칙을 쓴다 — 정수 k 에서는 정확검정 그대로. */
function binomTest(k,n,p){
  if(n===0) return 1;
  const lpmf=i=>gammaln(n+1)-gammaln(i+1)-gammaln(n-i+1)+i*Math.log(p)+(n-i)*Math.log1p(-p);
  const obs=Math.exp(lpmf(k)), tol=obs*(1+1e-7);
  let s=0; for(let i=0;i<=n;i++){ const v=Math.exp(lpmf(i)); if(v<=tol) s+=v; }
  return Math.min(1,s);
}
/* KS(균등 대비) — D = sup|F_n(x) − x|. p: n ≤ 2000 이고 행렬이 작으면 정확(Marsaglia·Tsang·Wang 2003), 아니면 점근(Stephens 보정). */
function mmul(A,B,m){ const C=new Float64Array(m*m);
  for(let i=0;i<m;i++) for(let k=0;k<m;k++){ const a=A[i*m+k]; if(a===0) continue; const ro=k*m, co=i*m; for(let j=0;j<m;j++) C[co+j]+=a*B[ro+j]; }
  return C; }
function mpow(A,m,n){
  if(n===1) return {V:A.slice(), e:0};
  const h=mpow(A,m,Math.floor(n/2));
  const B=mmul(h.V,h.V,m); let eB=2*h.e, V, eV;
  if(n%2===0){ V=B; eV=eB; } else { V=mmul(A,B,m); eV=eB; }
  if(V[Math.floor(m/2)*m+Math.floor(m/2)]>1e140){ for(let i=0;i<m*m;i++) V[i]*=1e-140; eV+=140; }
  return {V, e:eV};
}
function ksCdfExact(n,d){                               // P(D_n < d)
  const k=Math.floor(n*d)+1, m=2*k-1, h=k-n*d;
  const H=new Float64Array(m*m);
  for(let i=0;i<m;i++) for(let j=0;j<m;j++) H[i*m+j]= i-j+1<0 ? 0 : 1;
  for(let i=0;i<m;i++){ H[i*m]-=Math.pow(h,i+1); H[(m-1)*m+i]-=Math.pow(h,m-i); }
  H[(m-1)*m]+= 2*h-1>0 ? Math.pow(2*h-1,m) : 0;
  for(let i=0;i<m;i++) for(let j=0;j<m;j++) if(i-j+1>0) for(let g=1;g<=i-j+1;g++) H[i*m+j]/=g;
  const {V,e}=mpow(H,m,n);
  let s=V[(k-1)*m+k-1], eQ=e;
  for(let i=1;i<=n;i++){ s=s*i/n; if(s<1e-140){ s*=1e140; eQ-=140; } }
  return s*Math.pow(10,eQ);
}
function ksP(n,D){
  if(!(n>0)) return null;
  if(D<=0) return 1;
  const k=Math.floor(n*D)+1;
  if(n<=2000 && 2*k-1<=301) return clamp01(1-ksCdfExact(n,D));
  const lam=(Math.sqrt(n)+0.12+0.11/Math.sqrt(n))*D;
  let s=0; for(let j=1;j<=100;j++){ const t=2*(j%2?1:-1)*Math.exp(-2*j*j*lam*lam); s+=t; if(Math.abs(t)<1e-16) break; }
  return clamp01(s);
}
/* 동점 처리 — 비무작위 PIT(Czado·Gneiting·Held 2009). 순위 구간 [best,worst] 를 연속 구간 (best−1, worst] 로 보고
   그 안에 균등하게 펼쳐 센다. 무작위 추첨이면 어떤 백분위 구간이든 기대 비율 = 구간 길이(정확, 동점 크기와 무관).
   가운데값(mid) 하나로 10분위를 정하면 큰 동점 구간(연금: 전체의 2~5%)이 한 칸에 몰려 χ²·구간 전략이 가짜로 유의해진다.
   이 방식의 χ²·KS p 는 동점이 클수록 보수적(크게)이다. 동점이 없으면 보통의 백분위 통계와 같다. */
function decFrac(b,w,of){                               // 10분위별 비율(합 1)
  const f=new Array(10).fill(0), lo=b-1, g=w-b+1;
  for(let k=0;k<10;k++){ const a=Math.max(lo, of*k/10), z=Math.min(w, of*(k+1)/10); if(z>a) f[k]=(z-a)/g; }
  return f;
}
/* KS D — 펼친 경험분포 F̄(x) = mean clamp((x·of − (best−1))/(worst−best+1), 0, 1) 와 x 의 최대 차이(꺾이는 점에서만 확인하면 충분) */
function ksDbar(items){
  const n=items.length, xs=[0,1];
  for(const it of items){ xs.push((it.r.best-1)/it.of, it.r.worst/it.of); }
  let D=0;
  for(const x of xs){ let F=0; for(const it of items) F+=clamp01((x*it.of-(it.r.best-1))/(it.r.worst-it.r.best+1)); D=Math.max(D, Math.abs(F/n-x)); }
  return D;
}
const EPS=1e-9;
/* 「상위 N 안」 — 동점 구간 [best,worst] 가 N 을 걸치면 비율로 센다. % 는 of 의 비율(소수 N 허용 → 기대값 정확히 N/of). */
const TOPS=[['10',10,false],['100',100,false],['1000',1000,false],['1%',1,true],['10%',10,true]];
const topThr=(of,v,isPct)=>isPct ? of*v/100 : v;
const topFrac=(b,w,thr)=>clamp01((thr-b+1)/(w-b+1));

/* 한 모델의 요약. items = [{round, r:{best,worst,mid,pct}, of}] (회차 오름차순, 제외 행 없음) */
function summarize(items, opt){
  opt=opt||{};
  const n=items.length;
  const o={n};
  if(!n){ Object.assign(o,{meanPct:null, meanCI:null, medianPct:null, deciles:new Array(10).fill(0), expDecile:0,
    chi2:{stat:null,df:9,p:null}, ks:{D:null,p:null}, top:{}, topExp:{}}); if(!opt.lite){ o.best=null; o.band={warmup:WARMUP,n:0,hits:0,rate:null,exp:0.1,p:null}; } return o; }
  const pcts=items.map(x=>x.r.pct);
  const mean=pcts.reduce((a,b)=>a+b,0)/n, hw=1.96*Math.sqrt(1/12/n);
  const fr=items.map(x=>decFrac(x.r.best, x.r.worst, x.of));
  const dec=new Array(10).fill(0); fr.forEach(f=>{ for(let k=0;k<10;k++) dec[k]+=f[k]; });
  const e=n/10, chi=dec.reduce((a,x)=>a+(x-e)*(x-e)/e,0);
  const D=ksDbar(items);
  const top={}, topExp={};
  for(const [k,v,isPct] of TOPS){
    let ob=0, ex=0;
    for(const x of items){ const thr=topThr(x.of,v,isPct); ob+=topFrac(x.r.best,x.r.worst,thr); ex+= isPct ? 0 : thr/x.of; }
    if(isPct) ex=n*v/100;
    top[k]=r6(ob); topExp[k]=r6(ex);
  }
  Object.assign(o,{ meanPct:r6(mean), meanCI:[r6(mean-hw), r6(mean+hw)], medianPct:r6(median(pcts)),
    deciles:dec.map(r6), expDecile:r6(e), chi2:{stat:r6(chi), df:9, p:sig6(chi2p(chi,9))}, ks:{D:r6(D), p:sig6(ksP(n,D))}, top, topExp });
  if(opt.lite) return o;
  /* 가장 위에 왔던 회차 — 백분위 최소(같으면 best 작은 쪽, 그다음 이른 회차) */
  let bi=0; for(let i=1;i<n;i++){ const a=items[i].r, b=items[bi].r; if(a.pct<b.pct || (a.pct===b.pct && a.best<b.best)) bi=i; }
  o.best={round:items[bi].round, best:items[bi].r.best, pct:r6(items[bi].r.pct)};
  /* 구간 전략(walk-forward) — 회차 R 에서 R 이전 행들의 10분위 최다 칸(동률 1e-9 이내는 낮은 칸)을 고르고,
     R 의 당첨 순위 구간이 그 칸에 든 비율을 적중으로 센다(동점 없으면 0/1). 무작위면 회차마다 기대 0.1 정확. */
  const cnt=new Array(10).fill(0); let bn=0, hits=0;
  for(let i=0;i<n;i++){
    if(i>=WARMUP){ let arg=0; for(let j=1;j<10;j++) if(cnt[j]>cnt[arg]+EPS) arg=j; bn++; hits+=fr[i][arg]; }
    for(let k=0;k<10;k++) cnt[k]+=fr[i][k];
  }
  o.band={warmup:WARMUP, n:bn, hits:r6(hits), rate:bn?r6(hits/bn):null, exp:0.1, p:bn?sig6(binomTest(hits,bn,0.1)):null};
  return o;
}

/* ── 6. 공용 엔진 ──────────────────────────────────────────────── */
function loadCore(){
  if(!fs.existsSync(CORE)) throw new Error('rank-core.js 없음: '+CORE);
  vm.runInThisContext(fs.readFileSync(CORE,'utf8'), {filename:CORE});
  const RC=globalThis.RANKCORE;
  if(!RC||!RC.lotto||!RC.pension) throw new Error('rank-core.js 가 RANKCORE.lotto/pension 을 내보내지 않습니다');
  return RC;
}
const pick4=r=>({best:r.best, worst:r.worst, mid:r.mid, pct:r.pct});
const pick5=r=>({best:r.best, worst:r.worst, mid:r.mid, of:r.of, pct:r.pct});
function warn(title, msg){ console.log(`::warning title=${title}::${msg}`); }
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rankKey=r=>r==null?null:(r.excluded?{x:1,of:r.of}:{b:r.best,w:r.worst,of:r.of,n:r.numRank?[r.numRank.best,r.numRank.worst]:undefined});
function addDays(ymd, d){ const t=new Date(Date.UTC(+ymd.slice(0,4),+ymd.slice(4,6)-1,+ymd.slice(6,8)+d)); return t.toISOString().slice(0,10).replace(/-/g,''); }

function loadJSON(file, check){
  if(!fs.existsSync(file)) return null;
  try{ const o=JSON.parse(fs.readFileSync(file,'utf8')); if(check(o)) return o;
    warn('순위 추적 형식', `${path.basename(file)} 가 v1 형식이 아니라 새로 만듭니다`); return null; }
  catch(e){ warn('순위 추적 읽기 실패', `${path.basename(file)}: ${e.message} — 새로 만듭니다`); return null; }
}

/* 직렬화 — rows 는 한 행 한 줄(깃 diff 가 읽히게). 나머지 키는 고정 순서. */
function serialize(o, keys){
  const parts=keys.map(k=>{
    const v=o[k];
    if(k==='rows' && Array.isArray(v)) return '"rows":[\n'+v.map(r=>JSON.stringify(r)).join(',\n')+'\n]';
    if(k==='rows' && v && typeof v==='object') return '"rows":{\n'+Object.keys(v).sort((a,b)=>a-b).map(r=>JSON.stringify(r)+':'+JSON.stringify(v[r])).join(',\n')+'\n}';
    if(k==='models') return '"models":[\n'+v.map(m=>JSON.stringify(m)).join(',\n')+'\n]';
    if(k==='next') return '"next":{"round":'+v.round+',"date":'+JSON.stringify(v.date)+',"top":{\n'+
      Object.keys(v.top).map(m=>JSON.stringify(m)+':[\n'+v.top[m].map(x=>JSON.stringify(x)).join(',\n')+'\n]').join(',\n')+'\n}}';
    if(k==='summary') return '"summary":'+JSON.stringify(v,null,1);
    return JSON.stringify(k)+':'+JSON.stringify(v);
  });
  return '{'+parts.join(',\n')+'}\n';
}

/* ── 7. 로또 ──────────────────────────────────────────────────── */
const LOTTO_MODELS=[
  {key:'pop',  name:'분배 모델 (추천 순서)', dir:'asc', claims:'none',
   desc:'당첨되면 나눠 갖는 인원이 적을 것으로 추정되는 조합부터 셉니다(분배 z 오름차순). 맞을 가능성의 순서가 아닙니다 — 추첨이 공정하면 당첨 조합의 백분위는 0~100%에 균등하게 흩어집니다.'},
  {key:'popf', name:'분배 모델 + 주간 필터', dir:'asc', claims:'none',
   desc:'분배 순서 가운데 추천 필터(합 100~175 · 홀수 2~4개 · 연속쌍 2개 이하 · 한 구간 3개 이하 · 그 회차 이전 1등 조합 제외)를 통과한 조합만 셉니다. 당첨 조합이 필터 밖이면 «제외»로 표시하고 순위 통계에서 뺍니다. 필터도 당첨 확률을 바꾸지 않습니다.'},
  {key:'hot',  name:'빈도 모델 (많이 나온 번호)', dir:'desc', claims:'hit',
   desc:'직전 52회에 많이 나온 번호로 이루어진 조합일수록 위입니다(가중치 max(1,출현수)^2.2 의 로그 합). «많이 나온 번호가 또 나온다»는 주장을 검정하는 대상 — 추첨이 공정하면 당첨 백분위는 균등합니다.'},
  {key:'cold', name:'미출현 모델 (오래 안 나온 번호)', dir:'desc', claims:'hit',
   desc:'오래 안 나온 번호로 이루어진 조합일수록 위입니다(가중치 (1+미출현 회차)^1.6 의 로그 합). «나올 때가 됐다»는 주장을 검정하는 대상 — 추첨이 공정하면 당첨 백분위는 균등합니다.'}];
const LOTTO_NOTE='매 회차 R 의 순위표는 R−1회까지의 자료로만 만들었습니다(walk-forward, 미래 자료 없음). 추첨이 공정하면 어떤 순위표든 당첨 조합의 백분위는 0~100%에 균등하게 흩어집니다 — 평균 50%, 각 10분위 10%, 상위 N 안 기대 개수 = 회차 수 × N/전체. 분배 모델(pop·popf)의 순서는 «당첨되면 나눠 갖는 인원이 적을 것으로 추정되는 순서»이지 맞을 가능성의 순서가 아닙니다. 빈도·미출현 모델(hot·cold)은 «그런 번호가 더 잘 나온다»는 주장을 검정하는 대상입니다. 구간 전략(과거에 가장 많이 들어간 10분위를 고르기)은 walk-forward 로만 평가했고, 모델·구간을 여러 개 동시에 보면 몇 개는 우연히 p 가 작게 나옵니다(다중검정). 어떤 순위표도 1게임 1등 확률 1/8,145,060 을 바꾸지 않습니다. 같은 점수(동점)인 조합은 같은 순위 구간을 갖고, 10분위·KS·구간 전략은 그 구간을 균등하게 나눠 셉니다(동점이 크면 p 가 보수적).';

async function runLotto(browser, base, pension, lotto, RC, T, NF){
  const Lc=RC.lotto;
  const file=path.join(OUT,'brief','rank-lotto.json'), pfile=path.join(OUT,'brief','rank-params-lotto.json');
  const stored=loadJSON(file, o=>o.v===1&&o.kind==='lotto'&&Array.isArray(o.rows));
  const storedP=loadJSON(pfile, o=>o.v===1&&o.rows&&typeof o.rows==='object');
  const from=stored&&stored.from?Math.min(LOTTO_FROM, stored.from):LOTTO_FROM;
  const L=lotto.latest||Math.max(...lotto.rows.map(x=>+x.ltEpsd));
  if(stored && stored.latest>L){
    warn('순위 추적 건너뜀', `lotto: 기존 파일(최신 ${stored.latest}회)이 지금 데이터(최신 ${L}회)보다 앞서 있어 쓰지 않습니다`);
    return {kind:'lotto', skipped:true};
  }
  const have=new Set(lotto.rows.map(x=>+x.ltEpsd));
  const keptRows=new Map(); (stored?stored.rows:[]).forEach(r=>{ if(r&&r.round>=from&&r.round<=L&&r.ranks) keptRows.set(r.round,r); });
  const sp=(storedP&&storedP.rows)||{};
  const newRounds=[]; for(let R=from;R<=L;R++) if(have.has(R)&&!keptRows.has(R)) newRounds.push(R);
  const keptList=[...keptRows.keys()].sort((a,b)=>a-b);
  const recheck=keptList.slice(-RECHECK);
  const noParams=keptList.filter(R=>!sp[R]);
  const want=[...new Set([...newRounds, ...recheck, ...noParams, L+1])].sort((a,b)=>a-b);

  const tPage=now();
  const page=await lottoParams(browser, base, pension, lotto, want);
  if(page.error) throw new Error(page.error);
  if(page.L!==L) throw new Error(`페이지 최신 회차(${page.L}) ≠ 데이터 최신 회차(${L})`);
  const msPage=now()-tPage;
  if(page.pageErrors) console.error('      페이지 오류(lotto): '+page.pageErrors.join(' | '));
  if(page.missing.length) warn('순위 추적 자료 빠짐(lotto)', `${page.missing.join(', ')}회 추첨 자료가 페이지에 없어 건너뜀`);
  if(!page.live||page.live.error||!same(page.live, page.params[L+1]))
    warn('순위 추적 라이브 동일성(lotto)', `다음 회차 ${L+1} 파라미터 ≠ 페이지가 지금 쓰는 fitPop/weightsFor`);

  const drawBy=new Map(page.draws.map(d=>[d[0],d]));
  const wins=page.draws.map(d=>d[2]);                 // 회차 오름차순 1등 조합
  const winIdx=new Map(page.draws.map((d,i)=>[d[0],i]));
  const wonBefore=R=>{ let k=0; for(const d of page.draws){ if(d[0]<R) k++; else break; } return wins.slice(0,k); };
  /* wonIdx[i] = (i+1)회 1등 조합의 사전식 index(RANKCORE.lotto.index). 회차 R 의 popf 제외 목록 = wonIdx.slice(0, R−1).map(L.combo)
     — 탐색기가 lotto-history.json 없이 과거 회차 popf 를 추적기와 똑같이 재현하게 한다. 자료가 빠진 회차는 null. */
  const wonIdx=[]; for(let r=1;r<=L;r++){ const d=drawBy.get(r); wonIdx.push(d?Lc.index(d[2]):null); }
  if(wonIdx.some(x=>x==null)) warn('순위 추적 wonIdx(lotto)', `1등 조합이 빠진 회차: ${wonIdx.map((x,i)=>x==null?i+1:0).filter(Boolean).slice(0,20).join(', ')} — null 로 둡니다`);

  const tRank=now();
  const compute=(R, pr)=>{
    const d=drawBy.get(R); const win=d[2];
    const ranks={};
    if(pr.pop){
      ranks.pop=pick4(Lc.rankPop(pr.pop, T, win, {filter:false}));
      const f=Lc.rankPop(pr.pop, T, win, {filter:true, excludeWon:wonBefore(R)});
      ranks.popf=f.excluded?{excluded:true, of:f.of}:pick5(f);
    } else { ranks.pop=null; ranks.popf=null; }
    ranks.hot=pick4(Lc.rankAdditive(Lc.logw('hot', pr.hot), win));
    ranks.cold=pick4(Lc.rankAdditive(Lc.logw('cold', pr.cold), win));
    return {round:R, date:d[1], win:win.slice(), bonus:d[3], ranks};
  };
  const fresh=new Map();
  for(const R of [...newRounds, ...recheck]){
    if(!page.params[R]||!drawBy.has(R)) continue;
    fresh.set(R, compute(R, page.params[R]));
  }
  const msRank=now()-tRank;

  /* 결정성 — 마지막 RECHECK 개 행 */
  const det={compared:0, mismatch:[], paramsMismatch:[]};
  for(const R of recheck){
    const f=fresh.get(R), s=keptRows.get(R); if(!f) continue;
    det.compared++;
    const a={win:s.win, bonus:s.bonus, date:s.date, r:Object.fromEntries(['pop','popf','hot','cold'].map(k=>[k,rankKey(s.ranks[k])]))};
    const b={win:f.win, bonus:f.bonus, date:f.date, r:Object.fromEntries(['pop','popf','hot','cold'].map(k=>[k,rankKey(f.ranks[k])]))};
    if(!same(a,b)) det.mismatch.push(R);
    if(sp[R] && !same(sp[R], page.params[R])) det.paramsMismatch.push(R);
  }
  if(det.mismatch.length) warn('순위 추적 결정성(lotto)', `기존 행과 다시 계산한 순위가 다릅니다: ${det.mismatch.join(', ')} — 기존 행을 그대로 둡니다`);
  if(det.paramsMismatch.length) warn('순위 추적 파라미터(lotto)', `기존 파라미터와 다시 추출한 값이 다릅니다: ${det.paramsMismatch.join(', ')} — 기존 값을 그대로 둡니다`);

  /* 최종 행·파라미터 */
  const rows=[], params={};
  for(let R=from;R<=L;R++){
    if(keptRows.has(R)){ rows.push(keptRows.get(R)); params[R]=sp[R]||page.params[R]; }
    else if(fresh.has(R)){ rows.push(fresh.get(R)); params[R]=page.params[R]; }
    else if(sp[R]) params[R]=sp[R];
  }
  params[L+1]=page.params[L+1];
  for(const R of Object.keys(params)) if(!params[R]) delete params[R];

  /* 다음 회차 상위 목록 */
  const tNext=now();
  const pn=page.params[L+1];
  const allWon=wins.slice();
  const nextTop={
    pop:  pn.pop ? Lc.pagePop(pn.pop, T, 0, TOPN, {filter:false}).map(x=>({r:x.r, c:Array.from(x.c), z:x.z})) : [],
    popf: pn.pop ? Lc.pagePop(pn.pop, T, 0, TOPN, {filter:true, excludeWon:allWon}).map(x=>({r:x.r, c:Array.from(x.c), z:x.z})) : [],
    hot:  Lc.pageAdditive(Lc.logw('hot', pn.hot), 0, TOPN).map(x=>({r:x.r, c:Array.from(x.c), s:x.s})),
    cold: Lc.pageAdditive(Lc.logw('cold', pn.cold), 0, TOPN).map(x=>({r:x.r, c:Array.from(x.c), s:x.s}))};
  const msNext=now()-tNext;

  /* 요약 */
  const models={};
  for(const m of LOTTO_MODELS){
    const items=rows.filter(r=>r.ranks[m.key]&&!r.ranks[m.key].excluded)
                    .map(r=>({round:r.round, r:r.ranks[m.key], of:m.key==='popf'?r.ranks.popf.of:Lc.N}));
    models[m.key]=summarize(items);
  }
  const pf=rows.filter(r=>r.ranks.popf);
  const passed=pf.filter(r=>!r.ranks.popf.excluded).length;
  /* 기대 통과율 = 무작위 조합이 필터를 통과하고 그 회차 이전 1등 조합도 아닐 확률의 회차 평균 = mean(of_R)/N */
  const expPass=pf.length ? pf.reduce((a,r)=>a+r.ranks.popf.of,0)/pf.length/Lc.N : null;
  const summary={ n:rows.length, models,
    popf:{ passed, n:pf.length, rate:pf.length?r6(passed/pf.length):null, exp:r6(expPass),
           p:pf.length?sig6(binomTest(passed,pf.length,expPass)):null } };

  const o={ v:1, kind:'lotto', N:Lc.N, NF, from, latest:L, generated:new Date().toISOString(), note:LOTTO_NOTE,
    models:LOTTO_MODELS, rows, summary, next:{round:L+1, date:addDays(page.lastYmd,7), top:nextTop}, wonIdx };
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file, serialize(o, ['v','kind','N','NF','from','latest','generated','note','models','rows','summary','next','wonIdx']));
  fs.writeFileSync(pfile, serialize({v:1, rows:params}, ['v','rows']));
  return { kind:'lotto', from, latest:L, rows:rows.length, added:[...fresh.keys()].filter(R=>!keptRows.has(R)).length,
    kept:keptRows.size, determinism:`${det.compared-det.mismatch.length}/${det.compared}`+(det.paramsMismatch.length?` (params ≠ ${det.paramsMismatch.join(',')})`:''),
    NF, popf:summary.popf, models:brief(models),
    next:{round:L+1, pop1:nextTop.pop[0]&&nextTop.pop[0].c.join(','), hot1:nextTop.hot[0]&&nextTop.hot[0].c.join(',')},
    ms:{page:msPage, pageLoop:page.ms, rank:msRank, next:msNext} };
}

/* ── 8. 연금 ──────────────────────────────────────────────────── */
const PNAME={freq:'빈도',cold:'역빈도',recent:'최근가중',gap:'갭',rand:'무작위(대조군)'};          // pension.html MODELNAME 과 같은 이름
const PWHAT={freq:'많이 나온 숫자',cold:'적게 나온 숫자',recent:'최근에 자주 나온 숫자',gap:'오래 안 나온 숫자'};
const PDESC={
  freq:'각 자리·조에서 그때까지 많이 나온 숫자일수록 높은 점수를 줍니다.',
  cold:'각 자리·조에서 그때까지 적게 나온 숫자일수록 높은 점수를 줍니다.',
  recent:'각 자리·조에서 최근에 자주 나온 숫자일수록 높은 점수를 줍니다(출현마다 가중치 0.5^(경과 회차/52) 를 더한 값 — 반감기 52회).',
  gap:'각 자리·조에서 마지막으로 나온 뒤 오래 안 나온 숫자일수록 높은 점수를 줍니다(경과 회차).',
  rand:'회차마다 시드(회차×7919)로 정한 무작위 순서 — 비교용 대조군입니다.'};
const PRULE=' 점수는 순위만 반영합니다: 자리마다 1위 10점 … 10위 1점, 조는 1위 5점 … 5위 1점(동점은 평균), 티켓 점수 = 합, 높은 순.';
function pensionModels(site){
  const nm=k=>k==='rand'?PNAME.rand:`${PNAME[k]} 모델 (${PWHAT[k]})`;
  const ms=PMODELS.map(k=>({key:k, name:nm(k), dir:'desc', claims:k==='rand'?'none':'hit',
    desc:PDESC[k]+PRULE+(k==='rand'?'':' «이 모델이 잘 맞는다»는 주장을 검정하는 대상 — 추첨이 공정하면 당첨 백분위는 균등합니다.')}));
  ms.push({key:'site', name:`사이트 설정 모델 (= ${PWHAT[site]?PNAME[site]+' · '+PWHAT[site]:(PNAME[site]||site)})`, dir:'desc', claims:site==='rand'?'none':'hit',
    desc:`연금 페이지 예상번호가 그 회차에 쓰던 모델(predSettings().model — 지금은 ${PNAME[site]||site})과 같은 순위표입니다(별칭).`+PRULE});
  return ms;
}
const PENSION_NOTE='매 회차의 순위표는 그 직전 회차까지의 자료로만 만들었습니다(walk-forward, 미래 자료 없음). 순위는 1등 티켓(조+6자리, 5,000,000장 중)과 번호만(6자리, 1,000,000개 중 — 2등 기준) 두 가지입니다. 추첨이 공정하면 어떤 순위표든 당첨 백분위는 0~100%에 균등하게 흩어집니다 — 평균 50%, 각 10분위 10%. 빈도·역빈도·최근가중·갭 모델은 «잘 맞는다»는 주장을 검정하는 대상이고, 무작위 모델은 대조군입니다. 구간 전략은 walk-forward 로만 평가했고, 모델·구간을 여러 개 동시에 보면 몇 개는 우연히 p 가 작게 나옵니다(다중검정). 어떤 순위표도 1장당 1등 확률 1/5,000,000 을 바꾸지 않습니다. 같은 점수(동점)인 조합은 같은 순위 구간을 갖고, 10분위·KS·구간 전략은 그 구간을 균등하게 나눠 셉니다(동점이 크면 p 가 보수적).';

async function runPension(browser, base, pension, lotto, RC){
  const Pc=RC.pension;
  const file=path.join(OUT,'brief','rank-pension.json'), pfile=path.join(OUT,'brief','rank-params-pension.json');
  const stored=loadJSON(file, o=>o.v===1&&o.kind==='pension'&&Array.isArray(o.rows));
  const storedP=loadJSON(pfile, o=>o.v===1&&o.rows&&typeof o.rows==='object');
  const from=stored&&stored.from?Math.min(PENSION_FROM, stored.from):PENSION_FROM;
  const L=Math.max(...pension.map(r=>+r.ep));
  if(stored && stored.latest>L){
    warn('순위 추적 건너뜀', `pension: 기존 파일(최신 ${stored.latest}회)이 지금 데이터(최신 ${L}회)보다 앞서 있어 쓰지 않습니다`);
    return {kind:'pension', skipped:true};
  }
  const have=new Set(pension.map(r=>+r.ep));
  const keptRows=new Map(); (stored?stored.rows:[]).forEach(r=>{ if(r&&r.round>=from&&r.round<=L&&r.ranks) keptRows.set(r.round,r); });
  const sp=(storedP&&storedP.rows)||{};
  const newEps=[]; for(let e=from;e<=L;e++) if(have.has(e)&&!keptRows.has(e)) newEps.push(e);
  const keptList=[...keptRows.keys()].sort((a,b)=>a-b);
  const recheck=keptList.slice(-RECHECK);
  const noParams=keptList.filter(e=>!sp[e]);
  const want=[...new Set([...newEps, ...recheck, ...noParams, L+1])].sort((a,b)=>a-b);

  const tPage=now();
  const page=await pensionParams(browser, base, pension, lotto, want);
  if(page.error) throw new Error(page.error);
  if(page.L!==L) throw new Error(`페이지 최신 회차(${page.L}) ≠ 데이터 최신 회차(${L})`);
  const msPage=now()-tPage;
  if(page.pageErrors) console.error('      페이지 오류(pension): '+page.pageErrors.join(' | '));
  if(page.missing.length) warn('순위 추적 자료 빠짐(pension)', `${page.missing.join(', ')}회 추첨 자료가 페이지에 없어 건너뜀`);
  if(page.odd.length) warn('순위 추적 회차(pension)', `nextDraw 가 기대와 다른 회차: ${page.odd.slice(0,20).join(', ')}`);
  const pl=page.live, pn=page.params[L+1];
  if(!pl||pl.error||pl.ep!==L+1||!same(pl.S, pn&&pn.S)||pl.site!==(pn&&pn.site))
    warn('순위 추적 라이브 동일성(pension)', `다음 회차 ${L+1} 점수 ≠ 페이지가 지금 쓰는 currentScores`);

  const drawBy=new Map(page.draws.map(d=>[d[0],d]));
  const ptsOf=pr=>{ const o={}; for(const m of PMODELS) o[m]=Pc.points(pr.S[m]); return o; };
  const tRank=now();
  let siteOdd=[];
  const compute=(ep, pr)=>{
    const d=drawBy.get(ep); const win={band:d[2], num:d[3]};
    const pts=ptsOf(pr); const ranks={};
    const one=m=>{ const r=Pc.rank(pts[m], win.band, win.num);
      return {best:r.best, worst:r.worst, mid:r.mid, pct:r.pct, numRank:pick5(r.numRank)}; };
    for(const m of PMODELS) ranks[m]=one(m);
    if(PMODELS.includes(pr.site)) ranks.site=ranks[pr.site]; else { ranks.site=null; siteOdd.push(ep); }
    return {round:ep, date:d[1], win, ranks};
  };
  const fresh=new Map();
  for(const e of [...newEps, ...recheck]){
    if(!page.params[e]||!drawBy.has(e)) continue;
    fresh.set(e, compute(e, page.params[e]));
  }
  const msRank=now()-tRank;
  if(siteOdd.length) warn('순위 추적 site 모델(pension)', `predSettings().model 이 알 수 없는 모델인 회차: ${siteOdd.slice(0,20).join(', ')}`);

  const det={compared:0, mismatch:[], paramsMismatch:[]};
  for(const e of recheck){
    const f=fresh.get(e), s=keptRows.get(e); if(!f) continue;
    det.compared++;
    const K=[...PMODELS,'site'];
    const a={win:s.win, date:s.date, r:Object.fromEntries(K.map(k=>[k,rankKey(s.ranks[k])]))};
    const b={win:f.win, date:f.date, r:Object.fromEntries(K.map(k=>[k,rankKey(f.ranks[k])]))};
    if(!same(a,b)) det.mismatch.push(e);
    if(sp[e] && !same(sp[e], page.params[e])) det.paramsMismatch.push(e);
  }
  if(det.mismatch.length) warn('순위 추적 결정성(pension)', `기존 행과 다시 계산한 순위가 다릅니다: ${det.mismatch.join(', ')} — 기존 행을 그대로 둡니다`);
  if(det.paramsMismatch.length) warn('순위 추적 파라미터(pension)', `기존 점수와 다시 추출한 값이 다릅니다: ${det.paramsMismatch.join(', ')} — 기존 값을 그대로 둡니다`);

  const rows=[], params={};
  for(let e=from;e<=L;e++){
    if(keptRows.has(e)){ rows.push(keptRows.get(e)); params[e]=sp[e]||page.params[e]; }
    else if(fresh.has(e)){ rows.push(fresh.get(e)); params[e]=page.params[e]; }
    else if(sp[e]) params[e]=sp[e];
  }
  params[L+1]=pn;
  for(const e of Object.keys(params)) if(!params[e]) delete params[e];

  const tNext=now();
  const ptsN=ptsOf(pn), nextTop={};
  for(const m of PMODELS) nextTop[m]=Pc.page(ptsN[m], 0, TOPN).map(x=>({r:x.r, band:x.band, num:String(x.num).padStart(6,'0'), s:x.s}));
  nextTop.site=PMODELS.includes(pn.site)?nextTop[pn.site]:[];
  const msNext=now()-tNext;

  const site=pn.site;
  const models={};
  for(const k of [...PMODELS,'site']){
    const sel=rows.filter(r=>r.ranks[k]);
    const o=summarize(sel.map(r=>({round:r.round, r:r.ranks[k], of:Pc.N})));
    o.num=summarize(sel.map(r=>({round:r.round, r:r.ranks[k].numRank, of:r.ranks[k].numRank.of})), {lite:true});   // 번호만(2등 기준, 10^6)
    models[k]=o;
  }
  const summary={n:rows.length, models};
  const o={ v:1, kind:'pension', N:Pc.N, from, latest:L, generated:new Date().toISOString(), note:PENSION_NOTE,
    models:pensionModels(site), rows, summary,
    next:{round:L+1, date:page.nextDate||(page.draws.length?addDays(page.draws[page.draws.length-1][1],7):null), top:nextTop} };
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file, serialize(o, ['v','kind','N','from','latest','generated','note','models','rows','summary','next']));
  fs.writeFileSync(pfile, serialize({v:1, rows:params}, ['v','rows']));
  return { kind:'pension', from, latest:L, rows:rows.length, added:[...fresh.keys()].filter(e=>!keptRows.has(e)).length,
    kept:keptRows.size, determinism:`${det.compared-det.mismatch.length}/${det.compared}`+(det.paramsMismatch.length?` (params ≠ ${det.paramsMismatch.join(',')})`:''),
    site, models:brief(models),
    next:{round:L+1, site1:nextTop.site[0]&&(nextTop.site[0].band+'조 '+nextTop.site[0].num)},
    ms:{page:msPage, pageLoop:page.ms, rank:msRank, next:msNext} };
}

/* stdout 요약용 — 모델별 핵심 수치 */
function brief(models){
  const o={};
  for(const [k,m] of Object.entries(models)){
    o[k]={n:m.n, meanPct:m.meanPct, ci:m.meanCI, medianPct:m.medianPct, deciles:m.deciles.join(' '), chi2p:m.chi2.p, ksD:m.ks.D, ksP:m.ks.p,
      top:Object.fromEntries(Object.keys(m.top).map(t=>[t, `${m.top[t]} / ${m.topExp[t]}`])),
      best:m.best, band:m.band&&`${m.band.hits}/${m.band.n} (p=${m.band.p})`};
    if(m.num) o[k].num={meanPct:m.num.meanPct, ksP:m.num.ks.p, chi2p:m.num.chi2.p};
  }
  return o;
}

/* ── 9. 실행 ─────────────────────────────────────────────────── */
(async()=>{
  const t0=now();
  console.error('[1/4] 데이터…');
  const [pension, lotto] = await getData();
  console.error('[2/4] 순위 엔진…');
  const RC=loadCore();
  let T=null, NF=0, msTable=0;
  if(ONLY!=='pension'){
    const tt=now();
    T=RC.lotto.buildTable({withIndex:true});
    for(let t=0;t<T.K;t++) NF+=T.countF[t];
    msTable=now()-tt;
    console.error(`      튜플 표 K=${T.K} · 필터 통과 ${NF} · ${msTable}ms`);
  }
  console.error('[3/4] 페이지 파라미터 · 순위…');
  const {srv,port}=await serve(ROOT);
  const base=`http://127.0.0.1:${port}`;
  const res=[];
  try{
    await withBrowser(async browser=>{
      if(ONLY!=='pension'){ console.error(`      로또 ${LOTTO_FROM}회~`); res.push(await runLotto(browser, base, pension, lotto, RC, T, NF)); }
      if(ONLY!=='lotto'){ console.error(`      연금 ${PENSION_FROM}회~`); res.push(await runPension(browser, base, pension, lotto, RC)); }
    });
  } finally { srv.close(); }
  console.error('[4/4] 저장 완료');
  console.log(JSON.stringify({seconds:+((now()-t0)/1000).toFixed(1), out:OUT, core:{version:RC.version, stub:!!RC._stub, tableMs:msTable}, results:res},null,1));
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
