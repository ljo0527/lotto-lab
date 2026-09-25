#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   등수별 순위 분포 — «당첨 조합 전체(로또 2~5등 · 연금 2~7등)는 순위표의 어디에 퍼져 있나»  (PLAN3 §10.1)

   결과물(--out 기준): brief/rank-tiers-lotto.json · brief/rank-tiers-pension.json

   무엇을 세나
     매 회차 R, 모델 m 에 대해 R−1 회까지의 자료로 만든 순위표(walk-forward) 위에
       로또  2등 6 · 3등 228 · 4등 11,115 · 5등 182,780 조합  (당첨번호·보너스로 직접 열거)
       연금  2등 4 · 3등 45 · 4등 450 · 5등 4,500 · 6등 45,000 · 7등 450,000 장 (뒤 k 자리 일치 & 뒤 k+1 불일치)
     을 놓고 각 조합의 순위 백분위를 20칸 히스토그램에 넣는다. 1등은 rank-lotto/pension.json 에 이미 있다.

   순위 정의 — rank-core.js(공용 엔진)의 정의 그대로. 파라미터는 brief/rank-params-*.json(rank-track 산출물)에서 읽고,
     없으면 rank-track 과 같은 방식으로 페이지에서 직접 추출한다. 순위표 자체를 다시 정의하지 않는다:
       pop   z = popModelZ(P, popFeat) 오름차순, 동점 = z 가 부동소수점으로 같음 (튜플 표 + 그룹)
       hot/cold  Σ q[n] (q = quantize(logw)) 내림차순, 동점 = |Δ| ≤ ATOL(6) (rank-core 규칙)
       연금  자리 순위 점수 합 + 조 점수 내림차순, 동점 = 같은 점수
     같은 순위표를 조합 하나씩이 아니라 «점수 분포 전체»로 한 번에 만들고(가산 모델은 가중치 동치류의 개수 벡터 열거, 연금은 합성곱)
     등수 조합은 그 분포에서 조회한다. 결과의 [best,worst] 는 rank-core 의 rankPop/rankAdditive/rank 와 같다(--verify 로 대조).

   칸 배정(비례 규칙 — .lab/STATUS-track.md 와 같은 정의; 계약)
     조합의 동점 구간 [best,worst] 를 연속 구간 (best−1, worst] 로 보고 20칸에 길이 비례로 나눠 넣는다:
       frac[k] = max(0, min(worst, N·(k+1)/20) − max(best−1, N·k/20)) / (worst−best+1)
     → 칸 수는 소수일 수 있다. 추첨이 공정하면 칸 기대값 = 회차 수 × 등수 조합 수 ÷ 20 (정확히 평평).
     회차별 평균 백분위(m)는 mid 기준 pct = (mid−0.5)/N 의 평균(기대 0.5, 동점이 있어도 정확히 불편).

   정직성 — 상관
     한 회차의 등수 조합들은 당첨번호를 공유해 강하게 상관된다(5등 18만 개가 사실상 «같은 사건»). 칸 합계를 독립 표본처럼
     세어 χ² 를 구하면 과대. 그래서
       ① 회차 단위: 회차별 평균 백분위(독립 표본, 기대 0.5)의 t 검정 → summary.roundMean
       ② 몬테카를로 귀무: 모델(순위표)은 고정, 각 회차의 «추첨»만 무작위로 바꿔(시드 고정, 회차마다 sims 회) 같은 히스토그램을 다시 만들고
          회차별 칸 공분산을 더한다(회차는 귀무 아래 독립). sd = √(대각), z = (관측 − 기대)/sd.
          전역 p: 귀무 공분산의 정규근사(CLT, 회차 수 백 단위)에서 Q = Σ z² 와 max|z| 의 귀무분포를 재표집(20,000회, 시드 고정) → pMC · pMax.
     모델·등수를 여러 개 동시에 보면 몇 개는 우연히 p 가 작게 나온다(다중검정). 어떤 순위표도 당첨 확률을 바꾸지 않는다.

   적재(append-only) — 기존 행(h·m)은 그대로 둔다. 마지막 2행은 다시 계산해 다르면 ::warning 만 남기고 저장값을 유지한다.
     MC 공분산·평균은 회차별로 더한 누적값을 summary 에 **배정밀도 그대로**(반올림 없이) 보관하고(mc.mean·mc.cov, summary.mc.rounds),
     새 회차만 더한다 → 주간 증분 실행의 결과가 처음부터 다시 계산한 결과와 generated 만 빼고 바이트 단위로 같다.
     누적값이 행과 맞지 않으면(엔진 버전·sims·회차 집합 불일치) 전부 다시 계산한다(--full 로 강제).

   검증(--verify K, 기본 3) — MC 를 도는 회차 중 처음·끝·고르게 K 회차를 골라(결정적)
     로또: 2등 6개 전부 + 3·4·5등 각 2개(시드 고정 표본) 의 [best,worst] 를 rank-core rankPop / rankAdditive 와 대조,
           pop 의 모의 경로(binOf 표)와 조합별 세기, 가산의 구간 세기(addHistRange)와 조합별 세기(addHistEach)가 같은지 확인.
     연금: 2등 4장 전부 + 3~7등 각 2장(시드 고정) 의 [best,worst] 를 rank-core pension.rank 와 대조.
     불일치 → ::error + exit 1.

   CLI: node scripts/rank-tiers.mjs --root . --out . [--cache <file>] [--lotto-from 1000] [--pension-from 100] [--only lotto|pension]
          [--core <rank-core.js>] [--params <dir; 기본 <out>/brief → <root>/brief>] [--sims-lotto 16] [--sims-pension 64]
          [--null-draws 20000] [--verify 3] [--full]
   ═══════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import http from 'http';
import vm from 'vm';

const arg=(k,d)=>{ const i=process.argv.indexOf(k); return i>0?process.argv[i+1]:d; };
const has=k=>process.argv.includes(k);
const ROOT=path.resolve(arg('--root', process.cwd()));
const OUT =path.resolve(arg('--out', ROOT));
const LOTTO_FROM=Math.max(2, parseInt(arg('--lotto-from','1000'),10)||1000);
const PENSION_FROM=Math.max(2, parseInt(arg('--pension-from','100'),10)||100);
const ONLY=arg('--only',null);
const CORE=path.resolve(arg('--core', path.join(ROOT,'rank-core.js')));
const PARAMS_DIR=arg('--params',null);
const SIMS_L=Math.max(2, parseInt(arg('--sims-lotto','16'),10)||16);
const SIMS_P=Math.max(2, parseInt(arg('--sims-pension','64'),10)||64);
const NULL_DRAWS=Math.max(1000, parseInt(arg('--null-draws','20000'),10)||20000);
const VERIFY=Math.max(0, parseInt(arg('--verify','3'),10)||0);
const FULL=has('--full');
const ENGINE='tiers-2';                 // 계산·누적 규칙 버전 — 바뀌면 누적값을 다시 만든다 (tiers-2: 누적값 배정밀도 저장)
const BINS=20, RECHECK=2;
const LTIERS={2:6, 3:228, 4:11115, 5:182780};
const PTIERS={2:4, 3:45, 4:450, 5:4500, 6:45000, 7:450000};
const LMODELS=['pop','hot','cold'];
const PMODELS=['freq','cold','recent','gap','rand'], PALL=[...PMODELS,'site'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>Number(process.hrtime.bigint()/1000000n);
const r6=x=>x==null||!isFinite(x)?null:+x.toFixed(6);
const r4=x=>x==null||!isFinite(x)?null:+x.toFixed(4);
const sig6=x=>x==null||!isFinite(x)?null:(x===0?0:+x.toPrecision(6));
const sig9=x=>x==null||!isFinite(x)?null:(x===0?0:+x.toPrecision(9));
const clamp01=x=>x<0?0:x>1?1:x;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function warn(title,msg){ console.log(`::warning title=${title}::${msg}`); }

async function jget(url,tries=8){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (lotto-lab)'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await sleep(Math.min(20000,1000*2**i)); }
  }
}

/* ── 1. 데이터 (rank-track·backfill 와 같은 코드·같은 --cache 형식) ─────── */
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

/* ── 2. 파라미터 파일이 없을 때의 대체 경로 — rank-track 과 같은 방식으로 페이지에서 추출 ─── */
async function withBrowser(fn){
  let chromium;
  for(const p of ['playwright','/home/claude/.npm-global/lib/node_modules/playwright/index.mjs',
                  '/usr/lib/node_modules/playwright/index.mjs']){
    try{ ({chromium}=await import(p)); break; }catch(e){}
  }
  if(!chromium) throw new Error('playwright 없음 — brief/rank-params-*.json(rank-track 산출물)이 있으면 필요 없습니다');
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
async function extractLottoParams(pension, lotto, rounds){
  const {srv,port}=await serve(ROOT);
  try{
    return await withBrowser(async browser=>{
      const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
      const p=await ctx.newPage();
      await p.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'load'});
      await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100&&DB.draws&&DB.draws[DB.latest],{timeout:120000});
      await p.waitForTimeout(1500);
      const out=await p.evaluate(({rounds})=>{
        if(typeof fitPop!=='function'||typeof weightsFor!=='function'||typeof bumpDB!=='function') return {error:'index.html 에 fitPop/weightsFor/bumpDB 가 없습니다'};
        const reset=()=>{ try{ POPFIT=null; POPFIT_N=-1; }catch(e){} try{ WINSET=null; WINSET_N=-1; }catch(e){} };
        const pk=m=>m?{beta:Array.from(m.beta), predMean:m.predMean, predSD:m.predSD}:null;
        const snap=()=>{ const F=fitPop();
          return { pop: F&&F.A ? {A:pk(F.A), B:pk(F.B), bounds:(F.bounds||[]).map(b=>[b[0],b[1]])} : null,
                   hot: Array.from(weightsFor('hot')), cold: Array.from(weightsFor('cold')) }; };
        const orig=DB.draws, L=DB.latest, work=orig.slice(); const params={};
        try{
          DB.draws=work;
          for(const R of rounds){
            if(R<=L && !orig[R]) continue;
            for(let j=1;j<orig.length;j++) work[j]=orig[j];
            for(let j=R;j<work.length;j++) work[j]=undefined;
            DB.latest=R-1; bumpDB(); reset();
            params[R]=snap();
          }
        } finally { DB.draws=orig; DB.latest=L; bumpDB(); reset(); }
        return {params};
      },{rounds});
      await ctx.close();
      if(out.error) throw new Error(out.error);
      return out.params;
    });
  } finally { srv.close(); }
}
async function extractPensionParams(pension, lotto, eps){
  const {srv,port}=await serve(ROOT);
  try{
    return await withBrowser(async browser=>{
      const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
      const p=await ctx.newPage();
      await p.goto(`http://127.0.0.1:${port}/pension.html`,{waitUntil:'load'});
      await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
      await p.waitForTimeout(1200);
      const out=await p.evaluate(({eps,M})=>{
        if(typeof currentScores!=='function'||typeof predSettings!=='function') return {error:'pension.html 에 currentScores/predSettings 가 없습니다'};
        const save=DB.rounds, all=save.slice().sort((a,b)=>a.ep-b.ep), byEp=new Set(all.map(r=>r.ep)), L=all[all.length-1].ep;
        const cp=s=>({pos:s.pos.map(a=>Array.from(a)), band:Array.from(s.band)}); const params={};
        try{
          for(const ep of eps){
            if(ep<=L && !byEp.has(ep)) continue;
            DB.rounds=all.filter(r=>r.ep<ep);
            const S={}; for(const m of M) S[m]=cp(currentScores(m, ep*7919));
            params[ep]={site:predSettings().model, S};
          }
        } finally { DB.rounds=save; }
        return {params};
      },{eps, M:PMODELS});
      await ctx.close();
      if(out.error) throw new Error(out.error);
      return out.params;
    });
  } finally { srv.close(); }
}
function loadParams(kind){
  const dirs=[PARAMS_DIR, path.join(OUT,'brief'), path.join(ROOT,'brief')].filter(Boolean);
  for(const d of dirs){
    const f=path.join(d,`rank-params-${kind}.json`);
    if(!fs.existsSync(f)) continue;
    try{ const o=JSON.parse(fs.readFileSync(f,'utf8')); if(o.v===1&&o.rows&&typeof o.rows==='object') return {rows:o.rows, file:f}; }
    catch(e){ warn('등수 분포 파라미터', `${f}: ${e.message}`); }
  }
  return null;
}

/* ── 3. 수학 ───────────────────────────────────────────────────── */
function gammaln(x){
  const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let y=x, t=x+5.5; t-=(x+0.5)*Math.log(t);
  let s=1.000000000190015; for(let j=0;j<6;j++) s+=c[j]/++y;
  return -t+Math.log(2.5066282746310005*s/x);
}
function betacf(a,b,x){
  const MAXIT=400, EPS=3e-14, FPMIN=1e-300, qab=a+b, qap=a+1, qam=a-1;
  let c=1, d=1-qab*x/qap; if(Math.abs(d)<FPMIN) d=FPMIN; d=1/d; let h=d;
  for(let m=1;m<=MAXIT;m++){
    const m2=2*m; let aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN) d=FPMIN; c=1+aa/c; if(Math.abs(c)<FPMIN) c=FPMIN; d=1/d; h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d; if(Math.abs(d)<FPMIN) d=FPMIN; c=1+aa/c; if(Math.abs(c)<FPMIN) c=FPMIN; d=1/d;
    const del=d*c; h*=del; if(Math.abs(del-1)<EPS) break;
  }
  return h;
}
function betai(a,b,x){                     // 정규화 불완전 베타 I_x(a,b)
  if(x<=0) return 0; if(x>=1) return 1;
  const bt=Math.exp(gammaln(a+b)-gammaln(a)-gammaln(b)+a*Math.log(x)+b*Math.log(1-x));
  return x<(a+1)/(a+b+2) ? bt*betacf(a,b,x)/a : 1-bt*betacf(b,a,1-x)/b;
}
function tTestP(t, df){ if(!(df>0)||!isFinite(t)) return null; return clamp01(betai(df/2, 0.5, df/(df+t*t))); }   // 양측
/* 대칭 행렬 고유분해(순환 Jacobi). A: Float64Array(n*n). → {val, vec} (vec 의 열 = 고유벡터) */
function jacobiEig(A, n){
  const a=Float64Array.from(A), v=new Float64Array(n*n); for(let i=0;i<n;i++) v[i*n+i]=1;
  for(let sweep=0;sweep<200;sweep++){
    let off=0; for(let p=0;p<n;p++) for(let q=p+1;q<n;q++) off+=a[p*n+q]*a[p*n+q];
    if(off<1e-24) break;
    for(let p=0;p<n;p++) for(let q=p+1;q<n;q++){
      const apq=a[p*n+q]; if(Math.abs(apq)<1e-300) continue;
      const theta=(a[q*n+q]-a[p*n+p])/(2*apq);
      const t=(theta>=0?1:-1)/(Math.abs(theta)+Math.sqrt(theta*theta+1)), c=1/Math.sqrt(t*t+1), s=t*c;
      for(let k=0;k<n;k++){ const akp=a[k*n+p], akq=a[k*n+q]; a[k*n+p]=c*akp-s*akq; a[k*n+q]=s*akp+c*akq; }
      for(let k=0;k<n;k++){ const apk=a[p*n+k], aqk=a[q*n+k]; a[p*n+k]=c*apk-s*aqk; a[q*n+k]=s*apk+c*aqk; }
      for(let k=0;k<n;k++){ const vkp=v[k*n+p], vkq=v[k*n+q]; v[k*n+p]=c*vkp-s*vkq; v[k*n+q]=s*vkp+c*vkq; }
    }
  }
  const val=new Float64Array(n); for(let i=0;i<n;i++) val[i]=a[i*n+i];
  return {val, vec:v};
}
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function seedOf(kindId, round, sim){          // 결정적 시드 — (게임, 회차, 모의 번호)
  let h=0x811C9DC5|0;
  for(const v of [kindId, round, sim, 20260925]){ h=Math.imul(h^v, 0x01000193); h^=h>>>13; h=Math.imul(h, 0x5BD1E995); h^=h>>>15; }
  return h>>>0;
}
function gaussPair(rng, out){ let u=rng(); if(u<1e-300) u=1e-300; const r=Math.sqrt(-2*Math.log(u)), th=2*Math.PI*rng(); out[0]=r*Math.cos(th); out[1]=r*Math.sin(th); }

/* ── 4. 비례 규칙 — 동점 구간 (best−1, worst] 를 20칸에 길이 비례로 ──────────── */
/* 그룹 g: gt = #{더 좋은 조합}, eq = 동점 개수 → 구간 (gt, gt+eq]. 첫 칸 k0·끝 칸 k1·첫/중간/끝 칸 비율. */
function mkSpread(G){ return {k0:new Uint8Array(G), k1:new Uint8Array(G), f0:new Float64Array(G), fm:new Float64Array(G), f1:new Float64Array(G)}; }
function setSpread(S, g, gt, eq, E, of){
  const b1=gt, w=gt+eq;
  let k0=Math.min(BINS-1, Math.floor(b1*BINS/of)); while(k0<BINS-1 && E[k0+1]<=b1) k0++; while(k0>0 && E[k0]>b1) k0--;
  let k1=Math.min(BINS-1, Math.max(0, Math.ceil(w*BINS/of)-1)); while(k1>0 && E[k1]>=w) k1--; while(k1<BINS-1 && E[k1+1]<w) k1++;
  S.k0[g]=k0; S.k1[g]=k1;
  if(k0===k1){ S.f0[g]=1; S.fm[g]=0; S.f1[g]=0; return; }
  S.f0[g]=(E[k0+1]-b1)/eq; S.fm[g]=(E[1]-E[0])/eq; S.f1[g]=(w-E[k1])/eq;
}
function spreadInto(h, S, g, mult){
  const k0=S.k0[g], k1=S.k1[g];
  if(k0===k1){ h[k0]+=mult; return; }
  h[k0]+=S.f0[g]*mult; const fm=S.fm[g]*mult; for(let k=k0+1;k<k1;k++) h[k]+=fm; h[k1]+=S.f1[g]*mult;
}
function binEdges(of){ const E=new Float64Array(BINS+1); for(let k=0;k<=BINS;k++) E[k]=of*k/BINS; return E; }
/* 오름차순 Float64Array 에서 개수 */
function cntLE(a, x){ let lo=0, hi=a.length; while(lo<hi){ const m=(lo+hi)>>>1; if(a[m]<=x) lo=m+1; else hi=m; } return lo; }
function cntLT(a, x){ let lo=0, hi=a.length; while(lo<hi){ const m=(lo+hi)>>>1; if(a[m]<x) lo=m+1; else hi=m; } return lo; }

/* ── 5. 로또 엔진 ────────────────────────────────────────────────── */
function lottoEngine(RC){
  const L=RC.lotto, N=L.N;
  const tT=now();
  const T=L.buildTable({withIndex:true});
  const msTable=now()-tT;
  const K=T.K, tupleOf=T.tupleOf;
  const E=binEdges(N);
  let nSelf=0;                                             // 내부 정합 검사 횟수(검증 회차에서만)
  /* 사전식 index 의 증분 계산표(rank-core 와 같은 정의) — L.index 와 표본 대조 */
  const BINC=[]; for(let n=0;n<=45;n++){ const row=new Float64Array(7); row[0]=1; for(let k=1;k<=6;k++) row[k]= n===0?0:BINC[n-1][k-1]+BINC[n-1][k]; BINC.push(row); }
  const LEXS=[]; for(let i=0;i<6;i++){ const row=new Float64Array(46); for(let v=1;v<=45;v++) row[v]=row[v-1]+BINC[45-v][5-i]; LEXS.push(row); }
  { const rng=mulberry32(7); for(let s=0;s<2000;s++){ const c=randDraw(rng).win; let idx=0, prev=0; for(let i=0;i<6;i++){ idx+=LEXS[i][c[i]-1]-LEXS[i][prev]; prev=c[i]; }
      if(idx!==L.index(c)) throw new Error('index 표가 rank-core 와 다릅니다'); } }
  const binOf=new Uint8Array(N);

  /* pop — rank-core 의 z 그룹(L.popGroups: scoreTuples 의 z, 동점 = 부동소수점 동일, 그룹 id = z 오름차순) → 그룹 순위·비례 칸.
     rankPop/pagePop 이 쓰는 바로 그 그룹이라 [best,worst] 정의가 코어와 같다. */
  function popPrep(pop){
    const P={A:pop.A, B:pop.B, bounds:pop.bounds};
    const g0=L.popGroups(P,T), G=g0.G, gidT=g0.gid, cntG=g0.cnt, zU=g0.zU;
    for(let g=0;g<G;g++) if(!isFinite(zU[g])) throw new Error('pop z 가 유한하지 않습니다');
    const gtG=new Float64Array(G), eqG=new Float64Array(G), pctG=new Float64Array(G);
    let acc=0; for(let g=0;g<G;g++){ gtG[g]=acc; eqG[g]=cntG[g]; pctG[g]=(acc+cntG[g]/2)/N; acc+=cntG[g]; }
    if(acc!==N) throw new Error('pop 그룹 합계 ≠ N');
    const S=mkSpread(G); for(let g=0;g<G;g++) setSpread(S,g,gtG[g],eqG[g],E,N);
    const binT=new Uint8Array(K); for(let t=0;t<K;t++){ const g=gidT[t]; binT[t]= S.k0[g]===S.k1[g] ? S.k0[g] : 255; }
    return {kind:'pop', gidT, gtG, eqG, pctG, S, binT, G, P};
  }
  function popBinOf(pp){ const binT=pp.binT; for(let i=0;i<N;i++) binOf[i]=binT[tupleOf[i]]; }

  /* 가산(hot/cold) — q 동치류의 개수 벡터 열거 → 점수(정확한 정수) 분포 → ATOL 규칙의 gt/eq → 비례 칸 */
  function addPrep(w46){
    const q=L.quantize(L.logw('x', w46));
    const cm=new Map(); for(let n=1;n<=45;n++) cm.set(q[n],(cm.get(q[n])||0)+1);
    const vals=[...cm.keys()], mult=vals.map(v=>cm.get(v)), G=vals.length;
    const remCap=new Array(G+1).fill(0); for(let g=G-1;g>=0;g--) remCap[g]=remCap[g+1]+mult[g];
    const km=new Map();
    (function rec(g, rem, key, cnt){
      if(rem===0){ km.set(key,(km.get(key)||0)+cnt); return; }
      if(g===G) return;
      const mg=mult[g], kmax=Math.min(mg,rem);
      for(let k=0;k<=kmax;k++){ if(remCap[g+1]<rem-k) continue; rec(g+1, rem-k, key+k*vals[g], cnt*BINC[mg][k]); }
    })(0,6,0,1);
    const D=km.size, keys=Float64Array.from(km.keys()).sort().reverse();   // 내림차순 = 순위 순
    const cnt=new Float64Array(D), cum=new Float64Array(D+1);
    for(let i=0;i<D;i++){ cnt[i]=km.get(keys[i]); cum[i+1]=cum[i]+cnt[i]; }
    if(cum[D]!==N) throw new Error('가산 분포 합계 ≠ N');
    const TOL=L.ATOL;
    const gt=new Float64Array(D), eq=new Float64Array(D), pct=new Float64Array(D);
    for(let i=0,j=0,l=0;i<D;i++){
      while(keys[j]>keys[i]+TOL) j++;                       // 첫 index with key ≤ sc+TOL
      while(l+1<D && keys[l+1]>=keys[i]-TOL) l++;           // 끝 index with key ≥ sc−TOL
      gt[i]=cum[j]; eq[i]=cum[l+1]-cum[j]; pct[i]=(gt[i]+eq[i]/2)/N;
    }
    const S=mkSpread(D); for(let i=0;i<D;i++) setSpread(S,i,gt[i],eq[i],E,N);
    /* 칸별 키 구간: 겹치는 키 [ia,ib], 그중 온전히 들어가는 키 [pa,pb](비율 1), 나머지는 부분(비율 개별).
       gt·w=gt+eq 가 i 에 단조라 네 경계 모두 k 에 단조 → 포인터를 칸 사이에 이어 쓴다. */
    const bins=[];
    for(let k=0,ia=0,fa=0,fb=0,ic=0;k<BINS;k++){
      const lo=E[k], hi=E[k+1];
      while(ia<D && gt[ia]+eq[ia]<=lo) ia++;        // 첫 i with w>lo
      while(fa<D && gt[fa]<lo) fa++;                // 첫 i with gt≥lo   (= 온전 구간 시작)
      while(fb<D && gt[fb]<hi) fb++;                // 첫 i with gt≥hi   → ib=fb−1
      while(ic<D && gt[ic]+eq[ic]<=hi) ic++;        // 첫 i with w>hi    → pb=ic−1
      const ib=fb-1, pa=fa, pb=ic-1;
      const part=[], pf=[];
      for(let i=ia;i<=ib;i++){ if(i>=pa && i<=pb) continue; const w=gt[i]+eq[i]; const f=(Math.min(w,hi)-Math.max(gt[i],lo))/eq[i]; if(f>0){ part.push(i); pf.push(f); } }
      bins.push({pa, pb, part:Int32Array.from(part), pf:Float64Array.from(pf)});
    }
    return {kind:'add', q, keys, cnt, gt, eq, pct, S, bins, D};
  }
  function keyIndex(ap, key){            // 내림차순 keys 에서 정확 일치 index
    const keys=ap.keys; let lo=0, hi=ap.D-1;
    while(lo<=hi){ const m=(lo+hi)>>>1, v=keys[m]; if(v===key) return m; if(v>key) lo=m+1; else hi=m-1; }
    throw new Error('가산 키를 분포에서 찾지 못했습니다');
  }
  /* 등수 조합의 히스토그램(비례) — A 합(당첨번호 부분집합) × B 정렬합(나머지 부분집합): 칸별 키 구간 개수 세기 */
  function addHistRange(ap, Asums, Bs, h){
    const keys=ap.keys, bins=ap.bins;
    for(let a=0;a<Asums.length;a++){
      const sA=Asums[a];
      for(let k=0;k<BINS;k++){
        const b=bins[k]; let v=0;
        if(b.pa<=b.pb) v+=cntLE(Bs, keys[b.pa]-sA)-cntLT(Bs, keys[b.pb]-sA);
        const part=b.part, pf=b.pf;
        for(let j=0;j<part.length;j++){ const x=keys[part[j]]-sA; const c=cntLE(Bs,x)-cntLT(Bs,x); if(c) v+=pf[j]*c; }
        h[k]+=v;
      }
    }
  }
  /* 조합 하나씩(검증·평균용) */
  function addHistEach(ap, Asums, Bs, h){
    let sum=0;
    for(let a=0;a<Asums.length;a++){ const sA=Asums[a]; for(let j=0;j<Bs.length;j++){ const i=keyIndex(ap, sA+Bs[j]); spreadInto(h, ap.S, i, 1); sum+=ap.pct[i]; } }
    return sum;
  }
  function subsetSums(vals, k){
    const n=vals.length, out=[];
    if(k===1){ for(let i=0;i<n;i++) out.push(vals[i]); }
    else if(k===2){ for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) out.push(vals[i]+vals[j]); }
    else if(k===3){ for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){ const s=vals[i]+vals[j]; for(let l=j+1;l<n;l++) out.push(s+vals[l]); } }
    return Float64Array.from(out);
  }
  /* 등수별 (A 크기, B 크기, B 풀) — 2등: 5+보너스 · 3등: 5+(보너스 제외 38) · 4등: 4+2(39) · 5등: 3+3(39) */
  function addTierSets(ap, W, bonus){
    const q=ap.q, qW=W.map(n=>q[n]), tot=qW.reduce((a,b)=>a+b,0);
    const A5=Float64Array.from(qW.map(v=>tot-v));
    const A4=[]; for(let i=0;i<6;i++) for(let j=i+1;j<6;j++) A4.push(tot-qW[i]-qW[j]);
    const A3=subsetSums(qW,3);
    const inW=new Uint8Array(46); for(const n of W) inW[n]=1;
    const O39=[], O38=[]; for(let n=1;n<=45;n++){ if(inW[n]) continue; O39.push(q[n]); if(n!==bonus) O38.push(q[n]); }
    const s1=Float64Array.from(O38).sort(), s2=subsetSums(O39,2).sort(), s3=subsetSums(O39,3).sort();
    return {2:[A5, Float64Array.of(q[bonus])], 3:[A5, s1], 4:[Float64Array.from(A4), s2], 5:[A3, s3]};
  }
  /* pop — 사전식 열거(당첨번호 a개 + 나머지 b개), index 증분 */
  function enumLex(cls, a, b, leaf){
    const Wl=[], Ol=[]; for(let n=1;n<=45;n++){ if(cls[n]===1) Wl.push(n); else if(cls[n]===0) Ol.push(n); }
    const nW=Wl.length, nO=Ol.length;
    function rec(i, prev, pw, po, w, o, acc){
      const needW=a-w, needO=b-o;
      if(nW-pw<needW || nO-po<needO) return;
      for(;;){
        const cw= needW>0 && pw<nW ? Wl[pw] : 99, co= needO>0 && po<nO ? Ol[po] : 99;
        if(cw===99 && co===99) return;
        let v, isW; if(cw<co){ v=cw; isW=1; pw++; } else { v=co; isW=0; po++; }
        const acc2=acc+LEXS[i][v-1]-LEXS[i][prev];
        if(i===5) leaf(acc2); else rec(i+1, v, pw, po, w+isW, o+1-isW, acc2);
        if(isW){ if(needW===1) { /* W 더 못 씀 → O 만 */ } }
      }
    }
    rec(0,0,0,0,0,0,0);
  }
  function popTierCls(W, bonus, tier){
    const cls=new Uint8Array(46);                           // 0=O 1=W 2=제외
    if(tier===2){ cls.fill(2); for(const n of W) cls[n]=1; cls[bonus]=0; }
    else if(tier===3){ for(const n of W) cls[n]=1; cls[bonus]=2; }
    else { for(const n of W) cls[n]=1; }
    return cls;
  }
  const POP_AB={2:[5,1], 3:[5,1], 4:[4,2], 5:[3,3]};
  function popHistReal(pp, W, bonus, tier, h){
    const cls=popTierCls(W,bonus,tier), [a,b]=POP_AB[tier], gidT=pp.gidT, S=pp.S, pctG=pp.pctG; let sum=0, n=0;
    enumLex(cls,a,b,idx=>{ const g=gidT[tupleOf[idx]]; spreadInto(h,S,g,1); sum+=pctG[g]; n++; });
    if(n!==LTIERS[tier]) throw new Error(`pop ${tier}등 조합 수 ${n} ≠ ${LTIERS[tier]}`);
    return sum;
  }
  function popHistSim(pp, W, bonus, tier, h){
    const cls=popTierCls(W,bonus,tier), [a,b]=POP_AB[tier], gidT=pp.gidT, S=pp.S;
    enumLex(cls,a,b,idx=>{ const k=binOf[idx]; if(k!==255) h[k]+=1; else spreadInto(h,S,gidT[tupleOf[idx]],1); });
  }
  /* 실제 순위 대조용 — [best,worst] */
  function rankOf(pp, c){
    if(pp.kind==='pop'){ const g=pp.gidT[tupleOf[L.index(c)]]; return {best:pp.gtG[g]+1, worst:pp.gtG[g]+pp.eqG[g]}; }
    const key=c.reduce((s,n)=>s+pp.q[n],0), i=keyIndex(pp,key); return {best:pp.gt[i]+1, worst:pp.gt[i]+pp.eq[i]};
  }

  /* 한 회차 — h·m(실제 추첨) + (sims>0) MC 회차 공분산 */
  function round(R, pr, draw, sims, checks){
    const W=draw.win, bonus=draw.bonus;
    const preps={};
    if(pr.pop) preps.pop=popPrep(pr.pop);
    preps.hot=addPrep(pr.hot); preps.cold=addPrep(pr.cold);
    const h={}, m={}, tiers=Object.keys(LTIERS).map(Number);
    for(const mk of LMODELS){
      if(!preps[mk]){ h[mk]=null; m[mk]=null; continue; }
      h[mk]={}; m[mk]={};
      const pp=preps[mk];
      if(pp.kind==='pop'){
        if(checks) popBinOf(pp);
        for(const t of tiers){
          const hh=new Float64Array(BINS); const sum=popHistReal(pp,W,bonus,t,hh);
          /* 모의 경로(binOf 표 + 걸침 그룹만 비례 분배)가 조합별 세기와 같은지 — MC 귀무도 같은 비례 규칙임을 확인 */
          if(checks){ const h2=new Float64Array(BINS); popHistSim(pp,W,bonus,t,h2); nSelf++;
            for(let k=0;k<BINS;k++) if(Math.abs(h2[k]-hh[k])>1e-9*LTIERS[t]+1e-9) throw new Error(`pop ${t}등: 모의 경로(binOf)와 조합별 세기가 다릅니다 (칸 ${k})`); }
          h[mk][t]=Array.from(hh,r6); m[mk][t]=r6(sum/LTIERS[t]);
        }
      } else {
        const sets=addTierSets(pp,W,bonus);
        for(const t of tiers){
          const [As,Bs]=sets[t], hh=new Float64Array(BINS); const sum=addHistEach(pp,As,Bs,hh);
          if(As.length*Bs.length!==LTIERS[t]) throw new Error(`${mk} ${t}등 조합 수 ≠ ${LTIERS[t]}`);
          /* 구간 세기(MC 귀무가 쓰는 경로)가 조합별 세기와 같은지 */
          if(checks){ const h2=new Float64Array(BINS); addHistRange(pp,As,Bs,h2); nSelf++;
            for(let k=0;k<BINS;k++) if(Math.abs(h2[k]-hh[k])>1e-9*LTIERS[t]+1e-9) throw new Error(`${mk} ${t}등: 구간 세기와 조합별 세기가 다릅니다 (칸 ${k})`); }
          h[mk][t]=Array.from(hh,r6); m[mk][t]=r6(sum/LTIERS[t]);
        }
      }
    }
    const out={round:R, date:draw.date, h, m};
    if(checks){ const smp=sampleCombos(W,bonus,R); out.check={}; for(const mk of LMODELS) if(preps[mk]) out.check[mk]=smp.map(({t,c})=>({t, c, r:rankOf(preps[mk],c)})); }
    if(sims>0){
      const mc={}; const buf={};
      for(const mk of LMODELS){ if(!preps[mk]) continue; buf[mk]={}; for(const t of tiers) buf[mk][t]=new Float64Array(sims*BINS); }
      if(preps.pop) popBinOf(preps.pop);
      for(let s=0;s<sims;s++){
        const d=randDraw(mulberry32(seedOf(1,R,s)));
        for(const mk of LMODELS){
          const pp=preps[mk]; if(!pp) continue;
          if(pp.kind==='pop'){ for(const t of tiers) popHistSim(pp,d.win,d.bonus,t,buf[mk][t].subarray(s*BINS,(s+1)*BINS)); }
          else { const sets=addTierSets(pp,d.win,d.bonus); for(const t of tiers){ const [As,Bs]=sets[t]; addHistRange(pp,As,Bs,buf[mk][t].subarray(s*BINS,(s+1)*BINS)); } }
        }
      }
      for(const mk of LMODELS){ if(!preps[mk]) continue; mc[mk]={}; for(const t of tiers) mc[mk][t]=momentsOf(buf[mk][t], sims); }
      out.mc=mc;
    }
    return out;
  }
  return {round, msTable, K, NF:T.NF, T, stats:()=>({selfChecks:nSelf})};
}
const POOL45=Array.from({length:45},(_,i)=>i+1);
function randDraw(rng){ const a=POOL45.slice(); for(let i=0;i<7;i++){ const j=i+Math.floor(rng()*(45-i)); const t=a[i]; a[i]=a[j]; a[j]=t; } const win=a.slice(0,6).sort((x,y)=>x-y); return {win, bonus:a[6]}; }
function tier2Combos(W, bonus){ const out=[]; for(let i=0;i<6;i++){ const c=W.filter((_,j)=>j!==i).concat([bonus]).sort((a,b)=>a-b); out.push(c); } return out; }
/* 검증 표본(로또): 2등 6개 전부 + 3등(5+38 중 1)·4등(4+39 중 2)·5등(3+39 중 3) 각 2개 — 회차 시드 고정 */
function sampleCombos(W, bonus, R){
  const out=tier2Combos(W,bonus).map(c=>({t:2, c}));
  const rng=mulberry32(seedOf(3,R,0));
  const pick=(arr,k)=>{ const a=arr.slice(); for(let i=0;i<k;i++){ const j=i+Math.floor(rng()*(a.length-i)); const t=a[i]; a[i]=a[j]; a[j]=t; } return a.slice(0,k); };
  const O39=[], O38=[]; for(let n=1;n<=45;n++){ if(W.includes(n)) continue; O39.push(n); if(n!==bonus) O38.push(n); }
  for(const [t,a,b,pool] of [[3,5,1,O38],[4,4,2,O39],[5,3,3,O39]]) for(let s=0;s<2;s++) out.push({t, c:pick(W,a).concat(pick(pool,b)).sort((x,y)=>x-y)});
  return out;
}
/* 검증 표본(연금): 2등 4장 전부 + 3~7등 각 2장(뒤 8−t 자리 일치, 그 앞 자리 불일치, 조 무작위) — 회차 시드 고정 */
function sampleTickets(ep, draw){
  const out=[]; for(let b=1;b<=5;b++) if(b!==draw.band) out.push({t:2, band:b, num:draw.num});
  const rng=mulberry32(seedOf(4,ep,0)), d=draw.num;
  for(let t=3;t<=7;t++){ const p0=t-3;                                  // p0 = 달라야 하는 자리(0..4), 그 뒤는 일치
    for(let s=0;s<2;s++){ let num=''; for(let p=0;p<p0;p++) num+=Math.floor(rng()*10);
      num+=(d.charCodeAt(p0)-48+1+Math.floor(rng()*9))%10; num+=d.slice(p0+1);
      out.push({t, band:1+Math.floor(rng()*5), num}); } }
  return out;
}
/* 검증 회차 — MC 를 도는 회차 중 처음·끝·고르게 VERIFY 개(결정적) */
function pickVerify(compute){
  const mc=compute.filter(c=>c.mc).map(c=>c.R), out=new Set();
  if(!mc.length||!VERIFY) return out;
  for(let i=0;i<VERIFY;i++) out.add(mc[VERIFY===1?0:Math.round(i*(mc.length-1)/(VERIFY-1))]);
  return out;
}
/* sims × 20 히스토그램 → 평균(20) · 표본 공분산 상삼각(210) */
function momentsOf(buf, sims){
  const mean=new Float64Array(BINS);
  for(let s=0;s<sims;s++) for(let k=0;k<BINS;k++) mean[k]+=buf[s*BINS+k];
  for(let k=0;k<BINS;k++) mean[k]/=sims;
  const cov=new Float64Array(BINS*(BINS+1)/2);
  for(let s=0;s<sims;s++){ const o=s*BINS; let p=0; for(let i=0;i<BINS;i++){ const di=buf[o+i]-mean[i]; for(let j=i;j<BINS;j++) cov[p++]+=di*(buf[o+j]-mean[j]); } }
  for(let p=0;p<cov.length;p++) cov[p]/=(sims-1);
  return {mean, cov};
}

/* ── 6. 연금 엔진 ────────────────────────────────────────────────── */
function pensionEngine(RC){
  const P=RC.pension, of=P.N, E=binEdges(of), SMAX=130;
  function prep(Sraw){
    const pts=P.points(Sraw);
    const P2=[]; for(let p=0;p<6;p++){ const row=new Int32Array(10); for(let d=0;d<10;d++) row[d]=Math.round(pts.pos[p][d]*2); P2.push(row); }
    const B2=new Int32Array(5); for(let b=0;b<5;b++) B2[b]=Math.round(pts.band[b]*2);
    const pref=[new Float64Array([1])];                      // pref[p] = 자리 0..p−1 합의 분포
    for(let p=0;p<6;p++){ const prev=pref[p], nx=new Float64Array(prev.length+20); for(let s=0;s<prev.length;s++){ const v=prev[s]; if(!v) continue; for(let d=0;d<10;d++) nx[s+P2[p][d]]+=v; } pref.push(nx); }
    const nh=pref[6], th=new Float64Array(SMAX+1);
    for(let s=0;s<nh.length;s++){ const v=nh[s]; if(!v) continue; for(let b=0;b<5;b++) th[s+B2[b]]+=v; }
    const gt=new Float64Array(SMAX+1), pct=new Float64Array(SMAX+1); let acc=0;
    for(let s=SMAX;s>=0;s--){ gt[s]=acc; pct[s]=(acc+th[s]/2)/of; acc+=th[s]; }
    if(acc!==of) throw new Error('연금 분포 합계 ≠ N');
    const S=mkSpread(SMAX+1); for(let s=0;s<=SMAX;s++) if(th[s]) setSpread(S,s,gt[s],th[s],E,of);
    return {pts, P2, B2, pref, th, gt, pct, S};
  }
  const tiers=Object.keys(PTIERS).map(Number);
  const tmpA=new Float64Array(SMAX+1), tmpB=new Float64Array(SMAX+1);
  /* h[t] (Float64Array 20) 채우고 m[t] 반환(평균 pct) */
  function tiersOf(pp, band, num, h, m){
    const d=[]; for(let p=0;p<6;p++) d.push(num.charCodeAt(p)-48);
    const P2=pp.P2, B2=pp.B2; let ns=0; for(let p=0;p<6;p++) ns+=P2[p][d[p]];
    { const hh=h[2]; let sum=0; for(let b=0;b<5;b++){ if(b===band-1) continue; const s=ns+B2[b]; spreadInto(hh,pp.S,s,1); sum+=pp.pct[s]; } m[2]=sum/4; }
    for(const t of tiers){
      if(t===2) continue;
      const sfx=8-t, p0=5-sfx; let F=0; for(let p=p0+1;p<6;p++) F+=P2[p][d[p]];
      const pre=pp.pref[p0]; tmpA.fill(0);
      for(let s=0;s<pre.length;s++){ const v=pre[s]; if(!v) continue; for(let x=0;x<10;x++){ if(x===d[p0]) continue; tmpA[s+P2[p0][x]]+=v; } }
      tmpB.fill(0);
      for(let s=0;s<=SMAX;s++){ const v=tmpA[s]; if(!v) continue; for(let b=0;b<5;b++) tmpB[s+F+B2[b]]+=v; }
      const hh=h[t]; let sum=0, n=0;
      for(let s=0;s<=SMAX;s++){ const v=tmpB[s]; if(!v) continue; spreadInto(hh,pp.S,s,v); sum+=v*pp.pct[s]; n+=v; }
      if(n!==PTIERS[t]) throw new Error(`연금 ${t}등 장수 ${n} ≠ ${PTIERS[t]}`);
      m[t]=sum/n;
    }
  }
  function rankOf(pp, band, num){ let s=0; for(let p=0;p<6;p++) s+=pp.P2[p][num.charCodeAt(p)-48]; s+=pp.B2[band-1]; return {best:pp.gt[s]+1, worst:pp.gt[s]+pp.th[s]}; }
  function round(ep, pr, draw, sims, checks){
    const preps={}; for(const mk of PMODELS) preps[mk]=prep(pr.S[mk]);
    const site=PMODELS.includes(pr.site)?pr.site:null;
    const h={}, m={}, hb={}, mb={};
    for(const mk of PMODELS){
      hb[mk]={}; mb[mk]={}; for(const t of tiers) hb[mk][t]=new Float64Array(BINS);
      tiersOf(preps[mk], draw.band, draw.num, hb[mk], mb[mk]);
      h[mk]={}; m[mk]={}; for(const t of tiers){ h[mk][t]=Array.from(hb[mk][t],r6); m[mk][t]=r6(mb[mk][t]); }
    }
    h.site= site? h[site] : null; m.site= site? m[site] : null;
    const out={round:ep, date:draw.date, h, m, site};
    if(checks){ const smp=sampleTickets(ep, draw); out.check={}; for(const mk of PMODELS) out.check[mk]=smp.map(x=>({t:x.t, band:x.band, num:x.num, r:rankOf(preps[mk],x.band,x.num)})); }
    if(sims>0){
      const buf={}; for(const mk of PMODELS){ buf[mk]={}; for(const t of tiers) buf[mk][t]=new Float64Array(sims*BINS); }
      const hs={}, ms={};
      for(let s=0;s<sims;s++){
        const rng=mulberry32(seedOf(2,ep,s)); const band=1+Math.floor(rng()*5), num=String(Math.floor(rng()*1e6)).padStart(6,'0');
        for(const mk of PMODELS){ for(const t of tiers) hs[t]=buf[mk][t].subarray(s*BINS,(s+1)*BINS); tiersOf(preps[mk], band, num, hs, ms); }
      }
      const mc={}; for(const mk of PMODELS){ mc[mk]={}; for(const t of tiers) mc[mk][t]=momentsOf(buf[mk][t], sims); }
      mc.site= site? mc[site] : null;
      out.mc=mc;
    }
    return out;
  }
  return {round};
}

/* ── 7. 요약 통계 ────────────────────────────────────────────────── */
const TRI=(i,j)=> i<=j ? i*BINS-(i*(i-1))/2+(j-i) : j*BINS-(j*(j-1))/2+(i-j);   // 상삼각 index
/* 누적 공분산(합) → sd·z·Q·pMC·pMax. obs/exp: 20. rngSeed: 결정적. */
function mcStats(acc, obs, exp, rngSeed){
  const cov=acc.cov, sd=new Float64Array(BINS), z=new Float64Array(BINS);
  for(let k=0;k<BINS;k++){ const v=cov[TRI(k,k)]; sd[k]=v>0?Math.sqrt(v):0; z[k]= sd[k]>0 ? (obs[k]-exp[k])/sd[k] : 0; }
  let Q=0, mx=0; for(let k=0;k<BINS;k++){ Q+=z[k]*z[k]; mx=Math.max(mx,Math.abs(z[k])); }
  /* 상관 행렬 → 고유분해 → Q = Σ λ_i Z_i² · X = V√Λ Z 재표집 */
  const R=new Float64Array(BINS*BINS);
  for(let i=0;i<BINS;i++) for(let j=0;j<BINS;j++) R[i*BINS+j]= i===j ? 1 : (sd[i]>0&&sd[j]>0 ? cov[TRI(i,j)]/(sd[i]*sd[j]) : 0);
  const {val,vec}=jacobiEig(R,BINS);
  const lam=Array.from(val,v=>v>0?v:0), sq=lam.map(Math.sqrt);
  const rng=mulberry32(rngSeed), Z=new Float64Array(BINS), pair=[0,0]; let geQ=0, geM=0;
  for(let d=0;d<NULL_DRAWS;d++){
    for(let i=0;i<BINS;i+=2){ gaussPair(rng,pair); Z[i]=pair[0]; if(i+1<BINS) Z[i+1]=pair[1]; }
    let q=0; for(let i=0;i<BINS;i++) q+=lam[i]*Z[i]*Z[i];
    let m=0; for(let b=0;b<BINS;b++){ let x=0; for(let i=0;i<BINS;i++) x+=vec[b*BINS+i]*sq[i]*Z[i]; const ax=Math.abs(x); if(ax>m) m=ax; }
    if(q>=Q) geQ++; if(m>=mx) geM++;
  }
  return {sd:Array.from(sd,sig6), z:Array.from(z,r4), Q:r4(Q), maxZ:r4(mx), pMC:sig6((geQ+1)/(NULL_DRAWS+1)), pMax:sig6((geM+1)/(NULL_DRAWS+1)), nullDraws:NULL_DRAWS};
}
function roundMeanStats(ms){
  const n=ms.length; if(!n) return {mean:null, sd:null, n:0, t:null, p:null};
  const mean=ms.reduce((a,b)=>a+b,0)/n;
  if(n<2) return {mean:r6(mean), sd:null, n, t:null, p:null};
  const sd=Math.sqrt(ms.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1));
  const t= sd>0 ? (mean-0.5)/(sd/Math.sqrt(n)) : null;
  return {mean:r6(mean), sd:r6(sd), n, t:r4(t), p: t==null?null:sig6(tTestP(t,n-1))};
}
/* rows(h·m) + 누적 MC(acc[m][t] = {n, mean[20], cov[210]}) → summary
   귀무 재표집 시드는 (게임, 등수) 로만 정한다 — 같은 등수의 모든 모델이 같은 난수를 쓰므로, 입력(bins·cov)이 같은 두 칸(예: 연금 site 별칭과
   그 원본 모델)은 pMC·pMax 도 정확히 같다. 모델별 순번을 시드에 섞으면 같은 자료에 다른 p 가 붙는다. */
function summarize(kindId, rows, acc, models, TIERS, sims){
  const out={models:{}};
  for(const mk of models){
    out.models[mk]={};
    for(const t of Object.keys(TIERS)){
      const sel=rows.filter(r=>r.h[mk]&&r.h[mk][t]); const n=sel.length, size=TIERS[t];
      const bins=new Array(BINS).fill(0); for(const r of sel) for(let k=0;k<BINS;k++) bins[k]+=r.h[mk][t][k];
      const exp=new Array(BINS).fill(n*size/BINS);
      const a=acc[mk]&&acc[mk][t];
      const o={ n, size, bins:bins.map(r6), exp:exp.map(r6), meanPct: n? r6(sel.reduce((s,r)=>s+r.m[mk][t],0)/n) : null,
                roundMean: roundMeanStats(sel.map(r=>r.m[mk][t])) };
      if(a && a.n===n && n>1){
        const st=mcStats(a, bins, exp, seedOf(kindId, 999999, +t));
        /* mean·cov 는 누적값 그대로(배정밀도) — 다음 실행이 이 값에 새 회차만 더해도 처음부터 계산한 것과 비트 단위로 같다 */
        o.mc={ sims, n:a.n, mean:Array.from(a.mean), ...st, cov:Array.from(a.cov) };
      } else if(a && a.n===n && n===1){
        /* 회차 1개: 공분산(sims−1)은 있지만 sd·p 는 내지 않는다. 누적값은 그대로 보관해 다음 실행이 되살려 이어 더할 수 있게 한다 */
        o.mc={ sims, n:1, mean:Array.from(a.mean), cov:Array.from(a.cov), note:'회차가 1개뿐이라 sd·p 를 내지 않습니다' };
      } else o.mc={ sims, n:a?a.n:0, note: a?'누적 회차 수가 행과 다릅니다':'누적 없음' };
      out.models[mk][t]=o;
    }
  }
  return out;
}

/* ── 8. 적재(append-only) 공통 ───────────────────────────────────── */
function loadJSON(file, check){
  if(!fs.existsSync(file)) return null;
  try{ const o=JSON.parse(fs.readFileSync(file,'utf8')); if(check(o)) return o;
    warn('등수 분포 형식', `${path.basename(file)} 가 v1 형식이 아니라 새로 만듭니다`); return null; }
  catch(e){ warn('등수 분포 읽기 실패', `${path.basename(file)}: ${e.message} — 새로 만듭니다`); return null; }
}
function validRow(r, models, TIERS){
  if(!r||typeof r.round!=='number'||!r.h||!r.m) return false;
  for(const mk of models){ if(!(mk in r.h)||!(mk in r.m)) return false; if(r.h[mk]===null) continue;
    for(const t of Object.keys(TIERS)){ const a=r.h[mk][t]; if(!Array.isArray(a)||a.length!==BINS||typeof (r.m[mk]||{})[t]!=='number') return false; } }
  return true;
}
/* 저장된 summary 에서 누적 MC 를 되살린다(엔진·sims·회차 집합이 맞을 때만) */
function restoreAcc(stored, models, TIERS, sims, keptRounds){
  if(!stored||FULL||stored.engine!==ENGINE||stored.bins!==BINS||!stored.summary||!stored.summary.mc) return null;
  const sm=stored.summary.mc; if(sm.sims!==sims||!Array.isArray(sm.rounds)) return null;
  if(!same(sm.rounds, keptRounds)) return null;
  const acc={};
  for(const mk of models){ acc[mk]={}; for(const t of Object.keys(TIERS)){
    const o=stored.summary.models&&stored.summary.models[mk]&&stored.summary.models[mk][t]&&stored.summary.models[mk][t].mc;
    if(!o||!Array.isArray(o.mean)||o.mean.length!==BINS||!Array.isArray(o.cov)||o.cov.length!==BINS*(BINS+1)/2||typeof o.n!=='number') return null;
    acc[mk][t]={n:o.n, mean:Float64Array.from(o.mean), cov:Float64Array.from(o.cov)};
  } }
  return acc;
}
function addAcc(acc, res, models, TIERS){
  for(const mk of models){ const src=res.mc&&res.mc[mk]; if(!src) continue;
    for(const t of Object.keys(TIERS)){ const a=acc[mk][t]||(acc[mk][t]={n:0, mean:new Float64Array(BINS), cov:new Float64Array(BINS*(BINS+1)/2)});
      a.n++; for(let k=0;k<BINS;k++) a.mean[k]+=src[t].mean[k]; for(let p=0;p<a.cov.length;p++) a.cov[p]+=src[t].cov[p]; } }
}
function stripRow(res){ const o={round:res.round, date:res.date, h:res.h, m:res.m}; if(res.site!==undefined) o.site=res.site; return o; }
const rowKey=r=>({h:r.h, m:r.m});
/* 계산 계획: 누적이 살아 있으면 새 회차(+MC) 와 마지막 RECHECK 행(재확인, MC 없음), 아니면 전부(+MC) */
function plan(want, kept, accOK){
  if(accOK){
    const fresh=want.filter(R=>!kept.has(R)), keptList=[...kept.keys()].sort((a,b)=>a-b);
    return {compute:fresh.map(R=>({R, mc:true})).concat(keptList.slice(-RECHECK).map(R=>({R, mc:false}))), full:false};
  }
  return {compute:want.map(R=>({R, mc:true})), full:true};
}

/* ── 9. 직렬화 — rows 는 한 행 한 줄, summary 는 숫자 배열 한 줄 ────────── */
function ser(v, ind){
  if(Array.isArray(v)){ if(v.every(x=>typeof x!=='object'||x===null)) return JSON.stringify(v); return '[\n'+v.map(x=>ind+' '+ser(x,ind+' ')).join(',\n')+'\n'+ind+']'; }
  if(v&&typeof v==='object'){ const ks=Object.keys(v); if(!ks.length) return '{}'; return '{\n'+ks.map(k=>ind+' '+JSON.stringify(k)+':'+ser(v[k],ind+' ')).join(',\n')+'\n'+ind+'}'; }
  return JSON.stringify(v);
}
function serialize(o){
  const keys=['v','kind','engine','N','from','latest','generated','bins','tiers','sims','note','models','rows','summary'];
  const parts=keys.filter(k=>k in o).map(k=>{
    const v=o[k];
    if(k==='rows') return '"rows":[\n'+v.map(r=>JSON.stringify(r)).join(',\n')+'\n]';
    if(k==='models') return '"models":[\n'+v.map(m=>JSON.stringify(m)).join(',\n')+'\n]';
    if(k==='summary') return '"summary":'+ser(v,'');
    return JSON.stringify(k)+':'+JSON.stringify(v);
  });
  return '{'+parts.join(',\n')+'}\n';
}

/* ── 10. 로또 ─────────────────────────────────────────────────── */
const LOTTO_MODELS=[
  {key:'pop',  name:'분배 모델 (추천 순서)', dir:'asc', claims:'none',
   desc:'당첨되면 나눠 갖는 인원이 적을 것으로 추정되는 조합부터 셉니다(분배 z 오름차순). 맞을 가능성의 순서가 아닙니다 — 추첨이 공정하면 당첨 조합들은 순위표 전체에 고르게 퍼집니다.'},
  {key:'hot',  name:'빈도 모델 (많이 나온 번호)', dir:'desc', claims:'hit',
   desc:'직전 52회에 많이 나온 번호로 이루어진 조합일수록 위입니다(가중치 max(1,출현수)^2.2 의 로그 합). «많이 나온 번호가 또 나온다»는 주장을 검정하는 대상입니다.'},
  {key:'cold', name:'미출현 모델 (오래 안 나온 번호)', dir:'desc', claims:'hit',
   desc:'오래 안 나온 번호로 이루어진 조합일수록 위입니다(가중치 (1+미출현 회차)^1.6 의 로그 합). «나올 때가 됐다»는 주장을 검정하는 대상입니다.'}];
const NOTE_COMMON='동점 구간 [best,worst] 에 걸친 조합은 구간 길이에 비례해 칸에 나눠 넣습니다(비례 규칙 — 칸 수는 소수일 수 있음). 추첨이 공정하면 어떤 순위표든 당첨 조합은 순위표 전체에 고르게 퍼집니다: 칸마다 기대(exp) = 회차 수 × 등수 조합 수 ÷ 20, 회차별 평균 백분위(m)의 기대 = 0.5. 한 회차의 등수 조합들은 당첨번호를 공유해 강하게 상관되므로(사실상 하나의 사건) 칸 합계를 독립 표본처럼 세어 χ² 를 구하면 안 됩니다. 그래서 ① 회차별 평균 백분위(회차 = 독립 표본)의 t 검정(roundMean), ② 몬테카를로 귀무 — 순위표(모델)는 그대로 두고 각 회차의 추첨만 무작위로 바꿔(시드 고정, 회차마다 sims 회) 같은 계산을 한 뒤 회차별 칸 공분산을 더한 값 — 에서 칸별 sd 와 z = (관측 − 기대)/sd, 그리고 귀무 공분산의 정규근사에서 재표집한 Q = Σz² 의 p(pMC)·max|z| 의 p(pMax)를 씁니다. 모델·등수를 여러 개 동시에 보면 몇 개는 우연히 p 가 작게 나옵니다(다중검정). 어떤 순위표도 당첨 확률을 바꾸지 않습니다.';
const LOTTO_NOTE='매 회차 R 의 순위표는 R−1회까지의 자료로만 만들었습니다(walk-forward). 이 파일은 1등 1개가 아니라 그 회차의 2~5등 당첨 조합 전체(6 · 228 · 11,115 · 182,780개)가 8,145,060개 순위표의 어디에 놓였는지를 20칸으로 셉니다. 분배 모델(pop)의 순서는 «당첨되면 나눠 갖는 인원이 적을 것으로 추정되는 순서»이지 맞을 가능성의 순서가 아니고, 빈도·미출현 모델(hot·cold)은 «그런 번호가 더 잘 나온다»는 주장을 검정하는 대상입니다. '+NOTE_COMMON;

async function runLotto(pension, lotto, RC, ENG){
  const file=path.join(OUT,'brief','rank-tiers-lotto.json');
  const stored=loadJSON(file, o=>o.v===1&&o.kind==='lotto'&&Array.isArray(o.rows));
  const L=lotto.latest||Math.max(...lotto.rows.map(x=>+x.ltEpsd));
  if(stored && stored.latest>L){ warn('등수 분포 건너뜀', `lotto: 기존 파일(최신 ${stored.latest}회)이 지금 데이터(최신 ${L}회)보다 앞서 있어 쓰지 않습니다`); return {kind:'lotto', skipped:true}; }
  const from=stored&&stored.from?Math.min(LOTTO_FROM, stored.from):LOTTO_FROM;
  const draws=new Map(); for(const x of lotto.rows){ const R=+x.ltEpsd; if(R<from||R>L) continue;
    draws.set(R,{date:String(x.ltRflYmd), win:[x.tm1WnNo,x.tm2WnNo,x.tm3WnNo,x.tm4WnNo,x.tm5WnNo,x.tm6WnNo].map(Number).sort((a,b)=>a-b), bonus:+x.bnsWnNo}); }
  /* 파라미터 */
  let pf=loadParams('lotto'), params=pf?pf.rows:{}, extracted=false;
  let need=[]; for(let R=from;R<=L;R++) if(draws.has(R)&&!params[R]) need.push(R);
  if(need.length){
    console.error(`      로또 파라미터 ${need.length}회차 없음 → 페이지에서 추출`);
    const ex=await extractLottoParams(pension, lotto, need); extracted=true;
    for(const R of need) if(ex[R]) params[R]=ex[R];
  }
  const want=[]; for(let R=from;R<=L;R++) if(draws.has(R)&&params[R]&&params[R].hot&&params[R].cold) want.push(R);
  const wantSet=new Set(want);
  const kept=new Map(); if(stored&&!FULL) for(const r of stored.rows) if(validRow(r,LMODELS,LTIERS)&&wantSet.has(r.round)) kept.set(r.round,r);
  const keptRounds=[...kept.keys()].sort((a,b)=>a-b);
  let acc=restoreAcc(stored, LMODELS, LTIERS, SIMS_L, keptRounds);
  const accOK=!!acc; if(!acc){ acc={}; for(const mk of LMODELS) acc[mk]={}; }
  const {compute, full}=plan(want, kept, accOK);
  if(stored&&!accOK&&!FULL) console.error('      로또: 누적 MC 를 되살릴 수 없어 전부 다시 계산합니다');
  const t0=now(); const fresh=new Map(); const checks=[]; let done=0;
  const verifyRounds=pickVerify(compute);
  for(const {R,mc} of compute){
    const res=ENG.round(R, params[R], draws.get(R), mc?SIMS_L:0, verifyRounds.has(R));
    if(res.check){ checks.push({R, check:res.check, params:params[R]}); delete res.check; }
    fresh.set(R,res); if(mc && !(kept.has(R)&&accOK)) addAcc(acc,res,LMODELS,LTIERS);
    if(++done%25===0) console.error(`      로또 ${done}/${compute.length} (${((now()-t0)/1000).toFixed(1)}s)`);
  }
  const msRank=now()-t0;
  /* 결정성 — 기존 행과 비교 */
  const det={compared:0, mismatch:[]};
  for(const [R,res] of fresh){ const s=kept.get(R); if(!s) continue; det.compared++; if(!same(rowKey(s),rowKey(stripRow(res)))) det.mismatch.push(R); }
  if(det.mismatch.length) warn('등수 분포 결정성(lotto)', `기존 행과 다시 계산한 값이 다릅니다: ${det.mismatch.join(', ')} — 기존 행을 그대로 둡니다`);
  /* rank-core 대조 */
  const ver=verifyLotto(RC, ENG, checks);
  const rows=[]; for(const R of want){ if(kept.has(R)) rows.push(kept.get(R)); else if(fresh.has(R)) rows.push(stripRow(fresh.get(R))); }
  const mcRounds=rows.map(r=>r.round);
  const summary=summarize(1, rows, acc, LMODELS, LTIERS, SIMS_L);
  summary.n=rows.length; summary.mc={sims:SIMS_L, rounds:mcRounds, nullDraws:NULL_DRAWS};
  const o={ v:1, kind:'lotto', engine:ENGINE, N:RC.lotto.N, from, latest:L, generated:new Date().toISOString(), bins:BINS, tiers:LTIERS, sims:SIMS_L,
    note:LOTTO_NOTE, models:LOTTO_MODELS, rows, summary };
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file, serialize(o));
  return { kind:'lotto', from, latest:L, rows:rows.length, added:[...fresh.keys()].filter(R=>!kept.has(R)).length, kept:kept.size, full,
    determinism:`${det.compared-det.mismatch.length}/${det.compared}`, verify:ver, selfChecks:ENG.stats().selfChecks,
    params:pf?path.relative(ROOT,pf.file):'(페이지 추출)', extracted,
    models:brief(summary.models), ms:{table:ENG.msTable, rank:msRank} };
}
/* rank-core 대조 — 검증 회차의 표본 조합(2등 6개 + 3·4·5등 각 2개) × 모델: 내 [best,worst] 와 rankPop / rankAdditive 가 같아야 한다 */
function verifyLotto(RC, ENG, checks){
  const L=RC.lotto; let n=0, bad=[], rounds=[];
  for(const {R,check,params} of checks){
    rounds.push(R);
    for(const mk of Object.keys(check)){
      const P= mk==='pop' ? {A:params.pop.A, B:params.pop.B, bounds:params.pop.bounds} : null;
      const lw= mk==='pop' ? null : L.logw(mk, params[mk]);
      for(const {t,c,r} of check[mk]){
        const ref= P ? L.rankPop(P, ENG.T, c, {filter:false}) : L.rankAdditive(lw, c);
        n++; if(ref.best!==r.best||ref.worst!==r.worst) bad.push(`${R} ${mk} ${t}등 [${c}] ${r.best}-${r.worst} ≠ ${ref.best}-${ref.worst}`);
      }
    }
  }
  return {n, rounds, bad};
}

/* ── 11. 연금 ─────────────────────────────────────────────────── */
/* 모델 이름·설명은 scripts/rank-track.mjs(rank-pension.json 의 models[]) 와 글자 단위로 같게 유지한다 —
   rank.html 은 두 파일의 이름을 한 화면(모델 토글 · 등수 분포 select)에 같이 보여준다. 바꿀 때는 두 스크립트를 함께 바꿀 것. */
const PNAME={freq:'빈도',cold:'역빈도',recent:'최근가중',gap:'갭',rand:'무작위(대조군)'};          // pension.html MODELNAME 과 같은 이름
const PWHAT={freq:'많이 나온 숫자',cold:'적게 나온 숫자',recent:'최근에 자주 나온 숫자',gap:'오래 안 나온 숫자'};
const PDESC={
  freq:'각 자리·조에서 그때까지 많이 나온 숫자일수록 높은 점수를 줍니다.',
  cold:'각 자리·조에서 그때까지 적게 나온 숫자일수록 높은 점수를 줍니다.',
  recent:'각 자리·조에서 최근에 자주 나온 숫자일수록 높은 점수를 줍니다(출현마다 가중치 0.5^(경과 회차/52) 를 더한 값 — 반감기 52회).',
  gap:'각 자리·조에서 마지막으로 나온 뒤 오래 안 나온 숫자일수록 높은 점수를 줍니다(경과 회차).',
  rand:'회차마다 시드(회차×7919)로 정한 무작위 순서 — 비교용 대조군입니다.'};
const PRULE=' 점수는 순위만 반영합니다: 자리마다 1위 10점 … 10위 1점, 조는 1위 5점 … 5위 1점(동점은 평균), 티켓 점수 = 합, 높은 순.';
const pensionName=k=> k==='rand' ? PNAME.rand : `${PNAME[k]} 모델 (${PWHAT[k]})`;
const siteName=site=> `사이트 설정 모델 (= ${PWHAT[site]?PNAME[site]+' · '+PWHAT[site]:(PNAME[site]||site)})`;
function pensionModels(site){
  const ms=PMODELS.map(k=>({key:k, name:pensionName(k), dir:'desc', claims:k==='rand'?'none':'hit',
    desc:PDESC[k]+PRULE+(k==='rand'?'':' «이 모델이 잘 맞는다»는 주장을 검정하는 대상 — 추첨이 공정하면 당첨 티켓들은 순위표 전체에 고르게 퍼집니다.')}));
  ms.push({key:'site', name:siteName(site), dir:'desc', claims:site==='rand'?'none':'hit',
    desc:`연금 페이지 예상번호가 그 회차에 쓰던 모델(predSettings().model — 지금은 ${PNAME[site]||site})과 같은 순위표입니다(별칭 — 행마다 site 키에 그 회차의 모델 이름).`+PRULE});
  return ms;
}
/* 정직성 — 모델·등수 칸 36개가 독립 검정 36개는 아니다: cold 는 freq 의 정확한 역순(점수 = −출현수), site 는 그 회차 모델의 사본.
   아래 문구가 주장하는 «역순»은 runPension 이 실제 행에서 확인한다(rows 의 h.cold = reverse(h.freq), m.cold = 1 − m.freq) — 깨지면 ::warning. */
const PENSION_PAIRS='역빈도 모델(cold)의 순위표는 빈도 모델(freq)을 정확히 뒤집은 것이라(점수 = −출현수) 두 모델의 칸은 서로의 역순이고 회차별 평균 백분위는 합이 1 — 같은 검정의 양면입니다. 사이트 설정 모델(site)은 그 회차 모델의 사본(별칭)이라 별도 검정이 아닙니다. 그래서 모델·등수 칸의 수보다 독립적인 검정의 수가 적습니다. ';
const PENSION_NOTE='매 회차의 순위표는 그 직전 회차까지의 자료로만 만들었습니다(walk-forward). 이 파일은 1등 1장이 아니라 그 회차의 2~7등 당첨 티켓 전체(4 · 45 · 450 · 4,500 · 45,000 · 450,000장 — 뒤 k자리 일치 & 뒤 k+1자리 불일치, 조 무관)가 5,000,000장 순위표의 어디에 놓였는지를 20칸으로 셉니다. 빈도·역빈도·최근가중·갭 모델은 «잘 맞는다»는 주장을 검정하는 대상이고 무작위 모델은 대조군입니다. 연금 순위표는 동점 구간이 큽니다(같은 점수의 티켓이 전체의 수 %) — 그래서 비례 규칙이 특히 중요합니다. '+PENSION_PAIRS+NOTE_COMMON;
/* note 의 «cold = freq 의 역순» 주장을 행에서 확인 — h.cold[t] = reverse(h.freq[t]) (6자리 반올림 값), m.cold[t] = 1 − m.freq[t] */
function mirrorCheck(rows){
  let ok=0, tot=0, bad=[];
  for(const r of rows){ if(!r.h.freq||!r.h.cold) continue;
    for(const t of Object.keys(PTIERS)){ tot++;
      const a=r.h.freq[t], b=r.h.cold[t]; let same=a.length===b.length;
      for(let k=0;k<BINS&&same;k++) if(Math.abs(a[k]-b[BINS-1-k])>2e-6) same=false;
      if(same && Math.abs(r.m.freq[t]+r.m.cold[t]-1)<=2e-6) ok++; else if(bad.length<10) bad.push(`${r.round}/${t}등`);
    } }
  return {ok, tot, bad};
}

async function runPension(pension, lotto, RC, ENG){
  const file=path.join(OUT,'brief','rank-tiers-pension.json');
  const stored=loadJSON(file, o=>o.v===1&&o.kind==='pension'&&Array.isArray(o.rows));
  const L=Math.max(...pension.map(r=>+r.ep));
  if(stored && stored.latest>L){ warn('등수 분포 건너뜀', `pension: 기존 파일(최신 ${stored.latest}회)이 지금 데이터(최신 ${L}회)보다 앞서 있어 쓰지 않습니다`); return {kind:'pension', skipped:true}; }
  const from=stored&&stored.from?Math.min(PENSION_FROM, stored.from):PENSION_FROM;
  const draws=new Map(); for(const r of pension){ const ep=+r.ep; if(ep<from||ep>L) continue; draws.set(ep,{date:String(r.date), band:+r.band, num:String(r.num).padStart(6,'0')}); }
  let pf=loadParams('pension'), params=pf?pf.rows:{}, extracted=false;
  const okP=p=>p&&p.S&&PMODELS.every(m=>p.S[m]&&p.S[m].pos&&p.S[m].band);
  let need=[]; for(let e=from;e<=L;e++) if(draws.has(e)&&!okP(params[e])) need.push(e);
  if(need.length){
    console.error(`      연금 파라미터 ${need.length}회차 없음 → 페이지에서 추출`);
    const ex=await extractPensionParams(pension, lotto, need); extracted=true;
    for(const e of need) if(ex[e]) params[e]=ex[e];
  }
  const want=[]; for(let e=from;e<=L;e++) if(draws.has(e)&&okP(params[e])) want.push(e);
  const wantSet=new Set(want);
  const kept=new Map(); if(stored&&!FULL) for(const r of stored.rows) if(validRow(r,PALL,PTIERS)&&wantSet.has(r.round)) kept.set(r.round,r);
  const keptRounds=[...kept.keys()].sort((a,b)=>a-b);
  let acc=restoreAcc(stored, PALL, PTIERS, SIMS_P, keptRounds);
  const accOK=!!acc; if(!acc){ acc={}; for(const mk of PALL) acc[mk]={}; }
  const {compute, full}=plan(want, kept, accOK);
  if(stored&&!accOK&&!FULL) console.error('      연금: 누적 MC 를 되살릴 수 없어 전부 다시 계산합니다');
  const t0=now(); const fresh=new Map(); const checks=[]; let done=0, siteOdd=[];
  const verifyRounds=pickVerify(compute);
  for(const {R,mc} of compute){
    const res=ENG.round(R, params[R], draws.get(R), mc?SIMS_P:0, verifyRounds.has(R));
    if(!res.site) siteOdd.push(R);
    if(res.check){ checks.push({R, check:res.check, params:params[R]}); delete res.check; }
    fresh.set(R,res); if(mc && !(kept.has(R)&&accOK)) addAcc(acc,res,PALL,PTIERS);
    if(++done%50===0) console.error(`      연금 ${done}/${compute.length} (${((now()-t0)/1000).toFixed(1)}s)`);
  }
  const msRank=now()-t0;
  if(siteOdd.length) warn('등수 분포 site 모델(pension)', `predSettings().model 이 알 수 없는 모델인 회차: ${siteOdd.slice(0,20).join(', ')}`);
  const det={compared:0, mismatch:[]};
  for(const [R,res] of fresh){ const s=kept.get(R); if(!s) continue; det.compared++; if(!same(rowKey(s),rowKey(stripRow(res)))) det.mismatch.push(R); }
  if(det.mismatch.length) warn('등수 분포 결정성(pension)', `기존 행과 다시 계산한 값이 다릅니다: ${det.mismatch.join(', ')} — 기존 행을 그대로 둡니다`);
  const ver=verifyPension(RC, checks);
  const rows=[]; for(const R of want){ if(kept.has(R)) rows.push(kept.get(R)); else if(fresh.has(R)) rows.push(stripRow(fresh.get(R))); }
  const site=(params[L+1]&&params[L+1].site)||(rows.length&&rows[rows.length-1].site)||'gap';
  const mirror=mirrorCheck(rows);
  if(mirror.ok!==mirror.tot) warn('등수 분포 note(pension)', `cold 가 freq 의 역순이 아닌 칸 ${mirror.tot-mirror.ok}/${mirror.tot} (${mirror.bad.join(', ')}) — note 의 «같은 검정의 양면» 문구가 이 자료에는 맞지 않습니다(pension.html 의 cold 정의 확인)`);
  const summary=summarize(2, rows, acc, PALL, PTIERS, SIMS_P);
  summary.n=rows.length; summary.mc={sims:SIMS_P, rounds:rows.map(r=>r.round), nullDraws:NULL_DRAWS};
  const o={ v:1, kind:'pension', engine:ENGINE, N:RC.pension.N, from, latest:L, generated:new Date().toISOString(), bins:BINS, tiers:PTIERS, sims:SIMS_P,
    note:PENSION_NOTE, models:pensionModels(site), rows, summary };
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file, serialize(o));
  return { kind:'pension', from, latest:L, rows:rows.length, added:[...fresh.keys()].filter(R=>!kept.has(R)).length, kept:kept.size, full,
    determinism:`${det.compared-det.mismatch.length}/${det.compared}`, verify:ver, params:pf?path.relative(ROOT,pf.file):'(페이지 추출)', extracted, site,
    mirror:`${mirror.ok}/${mirror.tot}`, models:brief(summary.models), ms:{rank:msRank} };
}
/* rank-core 대조 — 검증 회차의 표본 티켓(2등 4장 + 3~7등 각 2장) × 모델: 내 [best,worst] 와 pension.rank 가 같아야 한다 */
function verifyPension(RC, checks){
  const P=RC.pension; let n=0, bad=[], rounds=[];
  for(const {R,check,params} of checks){
    rounds.push(R);
    for(const mk of Object.keys(check)){
      const pts=P.points(params.S[mk]);
      for(const {t,band,num,r} of check[mk]){ const ref=P.rank(pts,band,num); n++; if(ref.best!==r.best||ref.worst!==r.worst) bad.push(`${R} ${mk} ${t}등 ${band}조 ${num} ${r.best}-${r.worst} ≠ ${ref.best}-${ref.worst}`); }
    }
  }
  return {n, rounds, bad};
}

/* stdout 요약 — 모델·등수별 핵심 수치 */
function brief(models){
  const o={};
  for(const [mk,tiers] of Object.entries(models)){
    o[mk]={};
    for(const [t,s] of Object.entries(tiers)){
      const mc=s.mc||{};
      o[mk][t]={ n:s.n, meanPct:s.meanPct, tP:s.roundMean.p, maxZ:mc.maxZ, pMC:mc.pMC, pMax:mc.pMax,
        bins:s.bins.map(x=>Math.round(x)).join(' '), expBin:r4(s.exp[0]), sdBin:mc.sd?`${r4(Math.min(...mc.sd))}~${r4(Math.max(...mc.sd))}`:null };
    }
  }
  return o;
}

/* ── 12. 실행 ─────────────────────────────────────────────────── */
function loadCore(){
  if(!fs.existsSync(CORE)) throw new Error('rank-core.js 없음: '+CORE);
  vm.runInThisContext(fs.readFileSync(CORE,'utf8'), {filename:CORE});
  const RC=globalThis.RANKCORE;
  if(!RC||!RC.lotto||!RC.pension) throw new Error('rank-core.js 가 RANKCORE.lotto/pension 을 내보내지 않습니다');
  return RC;
}
(async()=>{
  const t0=now();
  console.error('[1/3] 데이터…');
  const [pension, lotto]=await getData();
  console.error('[2/3] 순위 엔진…');
  const RC=loadCore();
  const res=[];
  console.error('[3/3] 등수별 분포…');
  if(ONLY!=='pension'){
    const ENG=lottoEngine(RC);
    console.error(`      튜플 표 K=${ENG.K} · ${ENG.msTable}ms · 로또 ${LOTTO_FROM}회~ (sims ${SIMS_L})`);
    res.push(await runLotto(pension, lotto, RC, ENG));
  }
  if(ONLY!=='lotto'){
    const ENG=pensionEngine(RC);
    console.error(`      연금 ${PENSION_FROM}회~ (sims ${SIMS_P})`);
    res.push(await runPension(pension, lotto, RC, ENG));
  }
  let bad=0; for(const r of res){ if(r.verify&&r.verify.bad&&r.verify.bad.length){ bad++; for(const b of r.verify.bad) console.log(`::error title=등수 분포 대조(${r.kind})::${b}`); } }
  console.log(JSON.stringify({seconds:+((now()-t0)/1000).toFixed(1), out:OUT, engine:ENGINE, core:{version:RC.version}, results:res},null,1));
  if(bad) process.exit(1);
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
