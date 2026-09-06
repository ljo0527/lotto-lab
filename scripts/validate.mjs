#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   로직 검증 보드 — 「이 규칙들이 진짜인가」를 매주 다시 채점한다

   핵심 설계: **무엇을 검증하면 표본이 쌓이는가.**
   당첨 결과로 검증하면 영원히 판별 불가다(1등 1/8,145,060). 대신 두 층을 나눠 잰다.

     1층 모델 — 분배지수 예측이 실제와 맞는가?        회차당 1표본, 이미 300+
     2층 선택 — 우리가 고른 조합이 실제로 덜 인기있나?  회차당 1표본, 검정력 높음
     3층 결과 — 실제로 얼마 벌었나?                    검정력 사실상 0 → 그렇다고 명시

   2층에는 **양성 대조군(maxshare)** 을 넣는다. 일부러 인기 조합을 고르는 규칙이
   반대 방향으로 뚜렷하게 갈리지 않으면 모델은 잡음이다.

   추천 로직은 여기에 다시 구현하지 않는다. index.html·pension.html 을 헤드리스로
   띄우고 그 안의 함수를 직접 부른다 — 도구를 고치면 검증도 따라온다.
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

async function jget(url,tries=6){
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){ if(i===tries-1) throw e; await sleep(500*(i+1)); }
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


/* ── 3. 로또 : 세 층을 한 번에 잰다 ───────────────────────────────
   같은 회차에서 **같은 후보 풀**을 만들고 선택 규칙만 갈아끼운다.
   풀 생성이 비용의 대부분이므로 싸고, 무엇보다 «같은 후보에서 무엇을 골랐나» 라는
   공정한 비교가 된다. */
async function readLotto(browser, base, pension, lotto, WIN){
  const ctx=await browser.newContext(); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/index.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100&&DB.draws&&DB.draws[DB.latest],{timeout:120000});
  await p.waitForTimeout(1500);

  const out = await p.evaluate(async (WIN)=>{
    const reset=()=>{ WEEKLY=null; WEEKLY_R=0; POPFIT=null; POPFIT_N=0; WINSET=null; WINSET_N=0; };
    const tick=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r();c.port2.postMessage(0);});
    const latest=DB.latest, from=Math.max(300, latest-WIN+1);
    const orig=DB.draws, origLatest=DB.latest, work=orig.slice();
    const STRATS=['minshare','maxshare','random','hot','cold'];
    const rows=[];
    try{
      DB.draws=work;
      for(let R=from; R<=latest; R++){
        if(!orig[R]) continue;
        for(let j=1;j<orig.length;j++) work[j]=orig[j];
        for(let j=R;j<work.length;j++) work[j]=undefined;
        DB.latest=R-1; bumpDB(); reset();

        const F=fitPop(); if(!F.A) continue;

        const save=RNG; RNG=mulberry32(R*2654435761);
        const FIL={lo:100,hi:175,cons:2,odd:'234',strat:'minshare'};
        const w=weightsFor('minshare'), pool=[], seen=new Set();
        let tries=0; const t0=Date.now();
        while(pool.length<2000 && tries<150000 && Date.now()-t0<800){
          tries++;
          const c=pickWeighted(w,new Set(),6).sort((a,b)=>a-b);
          if(c.length!==6) continue;
          const key=c.join(','); if(seen.has(key)) continue;
          if(!passFilter(c,FIL)) continue;
          const bands=[0,0,0,0,0]; c.forEach(n=>bands[Math.min(4,Math.floor((n-1)/10))]++);
          if(Math.max(...bands)>3) continue;
          if(everWon(c)) continue;
          seen.add(key); pool.push(c);
        }
        RNG=save;
        if(pool.length<60) continue;

        const zOf=c=>{ const a=popScoreA(c); if(a==null) return null;
          const za=(a-F.A.predMean)/F.A.predSD;
          const b=F.B?popScoreB(c):null;
          const zb=(F.B&&b!=null)?(b-F.B.predMean)/F.B.predSD:za;
          return (za+zb)/2; };
        const P=pool.map(c=>({c,z:zOf(c)})).filter(x=>x.z!=null);
        if(P.length<60) continue;
        const poolZ=P.reduce((a,x)=>a+x.z,0)/P.length;

        const freq=freqOf(52,false).f, gaps={}; gapsOf().forEach(g=>gaps[g.n]=g.gap);
        const sumF=x=>x.c.reduce((a,n)=>a+(freq[n]||0),0);
        const sumG=x=>x.c.reduce((a,n)=>a+(gaps[n]||0),0);
        const rng2=mulberry32(R*7919);
        const shuffled=P.slice(); for(let i=shuffled.length-1;i>0;i--){const j=(rng2()*(i+1))|0;[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}

        const sel={
          minshare: P.slice().sort((a,b)=>a.z-b.z).slice(0,5),
          maxshare: P.slice().sort((a,b)=>b.z-a.z).slice(0,5),
          random:   shuffled.slice(0,5),
          hot:      P.slice().sort((a,b)=>sumF(b)-sumF(a)).slice(0,5),
          cold:     P.slice().sort((a,b)=>sumG(b)-sumG(a)).slice(0,5),
        };
        const actual=orig[R];
        const rec={R, y:actual.ymd, poolZ:+poolZ.toFixed(4), pool:P.length, s:{}};
        for(const k of STRATS){
          const g=sel[k];
          const mz=g.reduce((a,x)=>a+x.z,0)/g.length;
          const ranks=g.map(x=>rankOf(x.c,actual));
          let ret=0, hits=0;
          ranks.forEach(r=>{ if(r) ret+=actual.a[r-1]||0; });
          g.forEach(x=>{ hits += x.c.filter(n=>actual.n.includes(n)).length; });
          rec.s[k]={ z:+mz.toFixed(4), gain:+(poolZ-mz).toFixed(4), ret, hits,
                     ranks:ranks.filter(Boolean) };
        }
        /* 이 회차 실제 당첨번호의 «실제 초과배수» — 1층 모델 검증용 */
        if(actual.s && actual.w[3] && actual.w[4]){
          const gm=actual.s/TICKET, e4=gm*WAYS[4]/C456, e5=gm*WAYS[5]/C456;
          if(e4>=200){
            rec.zTrue=+zOf(actual.n).toFixed(4);
            rec.rTrue=+(0.5*(actual.w[3]/e4)+0.5*(actual.w[4]/e5)).toFixed(5);
          }
        }
        rec.chance=Math.round(5*chanceEV(actual));
        rec.a=actual.a.slice();
        rows.push(rec);
        if(rows.length%25===0) await tick();
      }
    } finally { DB.draws=orig; DB.latest=origLatest; bumpDB(); reset(); }

    /* 현재 회차 추천(=이번 주 실제 구매분) */
    const W=weeklyPicks();
    return { latest, from, strats:STRATS, rows, target:W.round, picks:W.combos.slice(0,10),
             lastDraw:{r:orig[latest].r,ymd:orig[latest].ymd,n:orig[latest].n,b:orig[latest].b,
                       w:orig[latest].w,a:orig[latest].a,s:orig[latest].s} };
  }, WIN);

  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 4. 연금 : 모델 × K 전수 백테스트 (검정력 낮음을 그대로 보여준다) ── */
async function readPension(browser, base, pension, lotto){
  const ctx=await browser.newContext(); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1200);
  const out=await p.evaluate(()=>{
    const rows=R(), start=Math.min(100,Math.floor(rows.length*0.3));
    const MODELS=['freq','cold','recent','gap','rand'];
    const grid=[];
    for(const m of MODELS) for(let K=1;K<=5;K++){
      const b=backtest(m,K,2,start);
      grid.push({model:m,K,rate:b.rateD,base:b.baseD,ci:b.ciD,p:b.pD,n:b.totD,
                 bandRate:b.rateB,bandBase:b.baseB,bandP:b.pB});
    }
    const S=predSettings(), nx=nextDraw(), last=rows[rows.length-1];
    return { grid, rounds:rows.length, from:rows[start].ep, to:last.ep,
             settings:S, next:{ep:nx.ep,date:nx.date},
             picks:generate(S.model,S.K,S.J,10,nx.ep*7919),
             last:{ep:last.ep,date:last.date,band:last.band,num:last.num,bonus:last.bonus,cnt:last.cnt||{}} };
  });
  await ctx.close(); return out;
}

/* ── 5. 통계 ─────────────────────────────────────────────────────
   근거: 짝지은 관측(같은 회차·같은 후보 풀)이므로 대조군과의 비교는 **대응표본**이다.
   독립표본으로 보면 회차별 공통 변동이 잡음으로 남아 검정력을 잃는다. */
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const sd=a=>{ const m=mean(a); return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1)); };
const median=a=>{ const s=a.slice().sort((x,y)=>x-y), n=s.length;
  return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2; };
/* 정규 상측꼬리 — 표본 200+ 이라 t 대신 z 로 충분하다 */
function normSf(z){ const t=1/(1+0.2316419*Math.abs(z));
  const d=0.3989423*Math.exp(-z*z/2);
  let p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return z>0?p:1-p; }
function pairedTest(diffs){
  const n=diffs.length, m=mean(diffs), s=sd(diffs), se=s/Math.sqrt(n);
  const t=se?m/se:0;
  return { n, mean:m, sd:s, se, t, p:2*normSf(Math.abs(t)), ci:[m-1.96*se, m+1.96*se] };
}
/* 확장창 walk-forward 재보정 — i번째는 0..i-1 로만 적합한 계수로 예측 */
function calibrate(pairs){
  const ok=pairs.filter(p=>p.z!=null&&p.r!=null);
  if(ok.length<60) return {ready:false,n:ok.length};
  const fit=arr=>{ const n=arr.length, mz=mean(arr.map(a=>a.z)), my=mean(arr.map(a=>a.r));
    let sxy=0,sxx=0; arr.forEach(a=>{const d=a.z-mz; sxy+=d*(a.r-my); sxx+=d*d;});
    return sxx?{a:my-(sxy/sxx)*mz,b:sxy/sxx}:null; };
  const pr=[],ys=[];
  for(let i=60;i<ok.length;i++){ const f=fit(ok.slice(0,i)); if(!f) continue;
    pr.push(f.a+f.b*ok[i].z); ys.push(ok[i].r); }
  const full=fit(ok);
  const my=mean(ys), sst=ys.reduce((a,v)=>a+(v-my)**2,0);
  const r2=1-pr.reduce((a,v,i)=>a+(v-ys[i])**2,0)/sst;
  const mae=mean(pr.map((v,i)=>Math.abs(v-ys[i])));
  const maeNaive=mean(ys.map(v=>Math.abs(v-my)));
  const mz=mean(ok.map(a=>a.z));
  let nu=0,dz=0,dy=0; const myAll=mean(ok.map(a=>a.r));
  ok.forEach(a=>{const u=a.z-mz,v=a.r-myAll; nu+=u*v; dz+=u*u; dy+=v*v;});
  return { ready:true, n:ok.length, nOOS:ys.length, a:full.a, b:full.b, r2, mae, maeNaive,
           corr:(dz&&dy)?nu/Math.sqrt(dz*dy):null };
}
/* 판별에 필요한 표본 수 — 대응표본, 양측 5%, 검정력 80% */
function weeksNeeded(effect, sdDiff){
  if(!effect || !sdDiff || effect<=0) return null;
  return Math.ceil(Math.pow((1.96+0.8416)*sdDiff/effect, 2));   // 대응표본, 양측 5%, 검정력 80%
}

const C456_L=8145060;
const PROB_L={1:1/C456_L, 2:6/C456_L, 3:228/C456_L, 4:11115/C456_L, 5:182780/C456_L};

/* ── 6. 집계 ─────────────────────────────────────────────────── */
const SNAME={minshare:'분배 최소 (현행)',maxshare:'분배 최대 (양성 대조군)',random:'무작위 (음성 대조군)',
             hot:'최근 빈출',cold:'오래 미출현'};
function analyzeLotto(L){
  const rows=L.rows, S=L.strats;
  const calib=calibrate(rows.filter(r=>r.zTrue!=null).map(r=>({z:r.zTrue,r:r.rTrue})));

  /* 주당 회수금의 이론 표준편차 — 관측 SD 는 1등이 한 번도 안 나와 과소평가된다.
     Var ≈ 5 × Σ_k p_k·a_k²  (p 가 매우 작아 평균² 항은 무시 가능) */
  const varPerWeek=mean(rows.filter(r=>r.a).map(r=>
    5*[1,2,3,4,5].reduce((a,k)=>a+PROB_L[k]*Math.pow(r.a[k-1]||0,2),0)));
  const sdWeek=Math.sqrt(varPerWeek);
  const chanceMean=mean(rows.map(r=>r.chance));

  const per={};
  for(const k of S){
    const gains=rows.map(r=>r.s[k].gain);
    const vsR=rows.map(r=>r.s[k].gain-r.s.random.gain);
    const ret=rows.map(r=>r.s[k].ret);
    const cnt={}; rows.forEach(r=>r.s[k].ranks.forEach(x=>cnt[x]=(cnt[x]||0)+1));
    const t=pairedTest(vsR);
    const payoutGain=calib.ready? mean(gains)*calib.b : null;
    per[k]={
      name:SNAME[k]||k,
      zGain:mean(gains), zGainSD:sd(gains), vsRandom:t,
      payoutGain,
      spend:rows.length*5000, retTotal:ret.reduce((a,b)=>a+b,0), retMedian:median(ret),
      hitsPerGame:mean(rows.map(r=>r.s[k].hits/5)), ranks:cnt,
      weeksForZ: k==='random'?null:weeksNeeded(Math.abs(t.mean), t.sd),
      weeksForMoney: (payoutGain&&payoutGain>0)? weeksNeeded(payoutGain*chanceMean, sdWeek) : null
    };
  }
  return { n:rows.length, from:L.from, to:L.latest, calib, per,
           sdWeek, chanceMean, hitBaseline:6*6/45 };
}
function analyzePension(P){
  const g=P.grid.map(x=>({...x, corrP: Math.min(1, x.p*P.grid.length)}));
  const sig=g.filter(x=>x.p<0.05), sigC=g.filter(x=>x.corrP<0.05);
  const ctrl=g.filter(x=>x.model==='rand'&&x.p<0.05);
  return { grid:g, tested:g.length, sig:sig.length, sigCorrected:sigC.length,
           expectedByChance:+(g.length*0.05).toFixed(1), controlSig:ctrl.length,
           rounds:P.rounds, from:P.from, to:P.to };
}

/* ── 7. 실구매 원장 ───────────────────────────────────────────────
   추천이 회차 시드로 결정되므로 «그 회차 추천 = 그 주에 산 것» 으로 자동 기록한다.
   기존 파일이 있으면 이어붙이고, 이미 있는 회차는 건드리지 않는다. */
function mergePurchases(prev, L, P, cfg){
  const led = prev && Array.isArray(prev.rounds) ? prev.rounds.slice() : [];
  const byKey = new Map(led.map(r=>[r.kind+':'+r.round, r]));
  const add=(kind,round,date,picks,extra)=>{
    const key=kind+':'+round;
    if(byKey.has(key)) return byKey.get(key);
    const r={kind,round,date,picks,spend:picks.length*1000,...extra};
    byKey.set(key,r); led.push(r); return r;
  };
  // 이번 주 구매분 (아직 추첨 전)
  add('lotto', L.target, null, L.picks.slice(0,cfg.lottoGames).map(c=>c.join(',')), {status:'pending'});
  add('pension', P.next.ep, P.next.date, P.picks.slice(0,cfg.pensionTickets).map(c=>c.band+'조 '+c.num), {status:'pending'});
  // 채점 — 추첨이 끝난 회차
  for(const r of led){
    if(r.status!=='pending') continue;
    if(r.kind==='lotto' && r.round===L.lastDraw.r){
      const d=L.lastDraw; let ret=0; const res=[];
      r.picks.forEach(s=>{ const c=s.split(',').map(Number);
        const hit=c.filter(n=>d.n.includes(n)).length, bo=c.includes(d.b);
        let g=0; if(hit===6)g=1; else if(hit===5&&bo)g=2; else if(hit===5)g=3; else if(hit===4)g=4; else if(hit===3)g=5;
        if(g) ret+=d.a[g-1]||0;
        res.push({hit,bonus:bo,grade:g});
      });
      r.status='done'; r.date=d.ymd; r.result=res; r.return=ret;
    }
    if(r.kind==='pension' && r.round===P.last.ep){
      const d=P.last; let ret=0; const res=[];
      const AMT={1:1_680_000_000,2:120_000_000,3:1_000_000,4:100_000,5:50_000,6:5_000,7:1_000,8:120_000_000};
      r.picks.forEach(s=>{ const m=s.match(/^(\d)조 (\d{6})$/); if(!m){res.push({grade:0});return;}
        const band=+m[1], num=m[2];
        let g=0;
        if(num===d.num) g = band===d.band?1:2;
        else if(num===d.bonus) g=8;
        else for(let n=5;n>=1;n--) if(num.slice(6-n)===d.num.slice(6-n)){ g=8-n; break; }
        if(g) ret+=AMT[g]||0;
        res.push({grade:g});
      });
      r.status='done'; r.date=d.date; r.result=res; r.return=ret;
    }
  }
  led.sort((a,b)=> a.kind===b.kind ? a.round-b.round : (a.kind<b.kind?-1:1));
  return { v:1, updated:new Date().toISOString(), config:cfg, rounds:led };
}
function ledgerTotals(led){
  const t={};
  for(const kind of ['lotto','pension']){
    const done=led.rounds.filter(r=>r.kind===kind && r.status==='done');
    const spend=done.reduce((a,r)=>a+r.spend,0), ret=done.reduce((a,r)=>a+(r.return||0),0);
    const grades={}; done.forEach(r=>(r.result||[]).forEach(x=>{ if(x.grade) grades[x.grade]=(grades[x.grade]||0)+1; }));
    t[kind]={weeks:done.length, spend, ret, rate:spend?ret/spend:null,
             median: done.length? median(done.map(r=>r.return||0)) : null, grades};
  }
  return t;
}

/* ── 8. 보드 HTML ─────────────────────────────────────────────── */
const fmtN=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ko-KR');
const pc=(x,d=2)=>x==null?'—':(x*100).toFixed(d)+'%';
const sgn=(x,d=3)=>x==null?'—':(x>=0?'+':'')+x.toFixed(d);
const dS=s=>s?`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`:'—';
function bigWeeks(w){
  if(w==null) return '—';
  if(w<520) return fmtN(w)+'주';
  const y=w/52;
  if(y<10000) return fmtN(y)+'년';
  return (y/1e4).toFixed(y<1e6?1:0)+'만 년';
}
function pTag(p){ return p<0.001?'<span class="tg s">p&lt;0.001</span>'
  : p<0.05?`<span class="tg s">p=${p.toFixed(3)}</span>`
  : `<span class="tg n">p=${p.toFixed(3)}</span>`; }

function buildBoard(A, PA, led, tot, meta){
const css=`
:root{--paper:#EEF0EB;--paper-2:#F7F8F5;--ink:#16302B;--ink-60:rgba(22,48,43,.6);--ink-40:rgba(22,48,43,.4);
--ink-12:rgba(22,48,43,.12);--ink-06:rgba(22,48,43,.06);--sig:#B0281A;--ok:#1F6F4A}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#12181A;--paper-2:#182022;--ink:#E6EDE9;
--ink-60:rgba(230,237,233,.62);--ink-40:rgba(230,237,233,.4);--ink-12:rgba(230,237,233,.14);
--ink-06:rgba(230,237,233,.06);--sig:#FF8A78;--ok:#7FD8A8}}
:root[data-theme="dark"]{--paper:#12181A;--paper-2:#182022;--ink:#E6EDE9;--ink-60:rgba(230,237,233,.62);
--ink-40:rgba(230,237,233,.4);--ink-12:rgba(230,237,233,.14);--ink-06:rgba(230,237,233,.06);--sig:#FF8A78;--ok:#7FD8A8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
font-size:15px;line-height:1.68;letter-spacing:-.01em;padding:0 0 70px}
.wrap{max-width:1000px;margin:0 auto;padding:18px 14px 0}
header{border-bottom:1.5px solid var(--ink);padding-bottom:12px;margin-bottom:20px}
.eb{font-family:ui-monospace,monospace;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-60);
display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.eb a{color:var(--ink-60)}
h1{font-size:clamp(28px,6.5vw,42px);line-height:1.08;font-weight:800;padding:12px 0 4px;letter-spacing:-.02em}
h1 small{display:block;font-size:.34em;font-weight:600;color:var(--ink-60);padding-top:8px;letter-spacing:.02em}
h2{font-family:ui-monospace,monospace;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
padding:0 0 12px;display:flex;align-items:center;gap:10px;margin-top:36px}
h2::after{content:"";flex:1;height:1px;background:var(--ink-12)}
h3{font-size:14px;font-weight:700;padding:16px 0 8px;color:var(--ink-60)}
p.note{font-size:13.5px;color:var(--ink-60);padding-bottom:12px;line-height:1.72}
p.note b{color:var(--ink)}
.card{background:var(--paper-2);border:1.5px solid var(--ink);padding:16px 15px;margin-bottom:12px}
.card.flat{border-width:1px;border-color:var(--ink-12)}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--ink-12);
border:1.5px solid var(--ink);margin-bottom:16px}
.kpi>div{background:var(--paper-2);padding:12px 11px}
.kpi .k{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60)}
.kpi .v{font-size:26px;font-weight:800;line-height:1.14;padding-top:3px;letter-spacing:-.02em}
.kpi .s{font-size:12px;color:var(--ink-60)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:8px 6px;text-align:left;border-bottom:1px solid var(--ink-12);vertical-align:middle}
th{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60)}
td.num,th.num{text-align:right;font-family:ui-monospace,monospace}
tr.me td{background:var(--ink-06);font-weight:600}
tr.ctl td{color:var(--ink-60)}
.scroll{overflow-x:auto}
.tg{font-family:ui-monospace,monospace;font-size:10px;padding:2px 6px;border:1px solid currentColor;white-space:nowrap}
.tg.s{color:var(--sig)}.tg.n{color:var(--ink-40)}.tg.o{color:var(--ok)}
.vd{border-left:3px solid var(--ink);padding:10px 0 10px 12px;margin:12px 0;font-size:13.5px;color:var(--ink-60)}
.vd b{color:var(--ink)}.vd.ok{border-color:var(--ok)}.vd.sig{border-color:var(--sig)}
.bar{height:9px;background:var(--ink-12);position:relative;overflow:hidden;min-width:60px}
.bar i{display:block;height:100%;background:var(--ink)}
.foot{font-size:12px;color:var(--ink-40);border-top:1px solid var(--ink-12);margin-top:32px;padding-top:14px;line-height:1.8}
@media print{body{background:#fff;padding:0}.card{break-inside:avoid}}`;

const P=A.per, cal=A.calib;
const stratRows=A.strats.map(k=>{
  const s=P[k], me=k==='minshare', ctl=k==='random'||k==='maxshare';
  return `<tr class="${me?'me':(ctl?'ctl':'')}">
    <td>${s.name}</td>
    <td class="num">${sgn(s.zGain)}</td>
    <td class="num">${k==='random'?'기준':sgn(s.vsRandom.mean)}</td>
    <td class="num">${k==='random'?'—':`[${s.vsRandom.ci[0].toFixed(3)}, ${s.vsRandom.ci[1].toFixed(3)}]`}</td>
    <td class="num">${k==='random'?'—':pTag(s.vsRandom.p)}</td>
    <td class="num">${k==='random'?'—':(Math.min(1,s.vsRandom.p*(A.strats.length-1))).toFixed(3)}</td>
    <td class="num">${s.payoutGain==null?'—':sgn(s.payoutGain*100,1)+'%'}</td>
    <td class="num">${s.hitsPerGame.toFixed(3)}</td>
  </tr>`;}).join('');

const powerRows=A.strats.filter(k=>k!=='random').map(k=>{
  const s=P[k];
  return `<tr class="${k==='minshare'?'me':''}"><td>${s.name}</td>
    <td class="num">${bigWeeks(s.weeksForZ)}</td>
    <td class="num">${bigWeeks(s.weeksForMoney)}</td></tr>`;}).join('');

const penRows=PA.grid.slice().sort((a,b)=>a.p-b.p).slice(0,8).map(x=>
  `<tr class="${x.model==='rand'?'ctl':''}"><td>${({freq:'빈도',cold:'역빈도',recent:'최근가중',gap:'갭',rand:'무작위(대조군)'})[x.model]}</td>
   <td class="num">상위 ${x.K}</td><td class="num">${pc(x.rate)}</td><td class="num">${pc(x.base,0)}</td>
   <td class="num">${pTag(x.p)}</td><td class="num">${x.corrP>=0.999?'1.000':x.corrP.toFixed(3)}</td></tr>`).join('');

const ledRows=led.rounds.slice().reverse().slice(0,24).map(r=>{
  const hit=(r.result||[]).filter(x=>x.grade).length;
  return `<tr><td class="num">${r.kind==='lotto'?'로또':'연금'}</td><td class="num">${r.round}회</td>
    <td class="num">${dS(r.date)}</td><td class="num">${fmtN(r.spend)}</td>
    <td class="num">${r.status==='pending'?'<span class="tg n">추첨 대기</span>':fmtN(r.return)}</td>
    <td class="num">${r.status==='pending'?'—':(hit?hit+'게임 당첨':'—')}</td></tr>`;}).join('');

return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>로직 검증 보드 · ${meta.date}</title><style>${css}</style></head><body><div class="wrap">
<header><div class="eb"><span>Logic Validation Board</span>
<span><a href="./index.html">LOTTO LAB</a> · <a href="./pension.html">PENSION LAB</a> · <a href="./brief.html">주간 브리핑</a></span></div>
<h1>로직 검증 보드<small>${meta.date} 자동 갱신 · 로또 ${A.from}~${A.to}회 ${A.n}주 · 연금 ${PA.from}~${PA.to}회</small></h1></header>

<div class="vd"><b>이 보드가 답하는 질문 하나.</b> 「우리가 쓰는 규칙이 우연과 구별되는가」.
당첨 결과로는 영원히 답할 수 없어서(1등 1/8,145,060) <b>세 층으로 나눠</b> 잽니다 —
모델이 맞는가 / 우리가 고른 조합이 실제로 덜 인기있는가 / 그래서 돈이 됐는가.
앞의 둘은 매주 표본이 쌓이고, 마지막은 쌓이지 않습니다.</div>

<div class="kpi">
  <div><div class="k">실구매 누적</div><div class="v">${tot.lotto.weeks+tot.pension.weeks}<span style="font-size:15px;color:var(--ink-60)">건</span></div>
    <div class="s">투입 ${fmtN(tot.lotto.spend+tot.pension.spend)}원</div></div>
  <div><div class="k">실구매 회수</div><div class="v">${fmtN(tot.lotto.ret+tot.pension.ret)}<span style="font-size:15px">원</span></div>
    <div class="s">${(tot.lotto.spend+tot.pension.spend)?pc((tot.lotto.ret+tot.pension.ret)/(tot.lotto.spend+tot.pension.spend),1):'—'}</div></div>
  <div><div class="k">모델 설명력 R²</div><div class="v">${cal.ready?cal.r2.toFixed(3):'—'}</div>
    <div class="s">순진예측 대비 오차 ${cal.ready?pc(1-cal.mae/cal.maeNaive,0):'—'} 감소</div></div>
  <div><div class="k">현행 규칙 효과</div><div class="v">${P.minshare.payoutGain==null?'—':sgn(P.minshare.payoutGain*100,1)+'%'}</div>
    <div class="s">기대 수령액 기준</div></div>
  <div><div class="k">돈으로 판별하려면</div><div class="v" style="font-size:20px">${bigWeeks(P.minshare.weeksForMoney)}</div>
    <div class="s">z 이득으로는 ${bigWeeks(P.minshare.weeksForZ)}</div></div>
</div>

<h2>1층 · 모델은 맞는가</h2>
<p class="note">분배지수 예측이 <b>실제 초과배수</b>와 맞는지. 매 회차 1표본씩 쌓이고 지금 <b>${cal.n}개</b>입니다.
확장창 walk-forward — i번째 예측은 그 이전 데이터로만 적합한 계수를 씁니다.</p>
<div class="card"><div class="scroll"><table>
<tr><th>지표</th><th class="num">값</th><th>읽는 법</th></tr>
<tr><td>상관</td><td class="num">${cal.ready?cal.corr.toFixed(3):'—'}</td><td>예측과 실제가 같은 방향으로 움직이는 정도</td></tr>
<tr class="me"><td>out-of-sample R²</td><td class="num">${cal.ready?cal.r2.toFixed(3):'—'}</td><td>0보다 크면 «항상 평균» 보다 낫다는 뜻</td></tr>
<tr><td>평균오차 (모델 / 순진)</td><td class="num">${cal.ready?cal.mae.toFixed(4)+' / '+cal.maeNaive.toFixed(4):'—'}</td><td>낮을수록 좋음</td></tr>
<tr><td>재보정 기울기</td><td class="num">${cal.ready?cal.b.toFixed(4):'—'}</td><td>z 1σ 당 초과배수 변화. 효과 크기의 환산 계수</td></tr>
</table></div>
<div class="vd ${cal.ready&&cal.r2>0?'ok':'sig'}">${cal.ready
  ? (cal.r2>0 ? `R²가 0보다 큽니다 — 이 모델은 «항상 평균값을 말하는 것»보다 낫습니다. 다만 설명력은 ${pc(cal.r2,1)}뿐이고, 나머지는 설명되지 않습니다.`
              : `R²가 음수입니다 — <b>순진 예측보다 나쁩니다.</b> 이 모델을 쓸 근거가 없습니다.`)
  : `표본 ${cal.n}개로는 아직 판정할 수 없습니다(60개 필요).`}</div></div>

<h2>2층 · 우리가 고른 조합이 실제로 덜 인기있는가</h2>
<p class="note">같은 회차, <b>같은 후보 풀</b>에서 선택 규칙만 갈아끼워 비교합니다. 회차별 공통 변동이 상쇄되도록
<b>대응표본</b>으로 검정했습니다. <b>양성 대조군(분배 최대)</b>이 반대 방향으로 뚜렷하게 갈리지 않으면 모델은 잡음입니다.</p>
<div class="card"><div class="scroll"><table>
<tr><th>선택 규칙</th><th class="num">z 이득</th><th class="num">무작위 대비</th><th class="num">95% 신뢰구간</th><th class="num">p</th><th class="num">보정 p</th><th class="num">환산 효과</th><th class="num">게임당 일치</th></tr>
${stratRows}
</table></div>
<p class="note" style="padding:10px 0 0">「z 이득」은 후보 풀 평균보다 얼마나 덜 인기있는 쪽을 골랐는가(클수록 좋음).
「환산 효과」는 1층의 재보정 기울기를 곱한 값 — 기대 수령액이 몇 % 늘어나는가.
「게임당 일치」의 우연 기준선은 <b>${A.hitBaseline.toFixed(3)}개</b>이고, 어떤 규칙도 이걸 바꾸지 못합니다(당연합니다).<br>
「보정 p」는 규칙 ${A.strats.length-1}개를 동시에 검정한 것에 대한 Bonferroni 보정입니다. <b>보정 p 가 0.05 를 넘으면 유의하지 않습니다</b> —
낱개 p 만 보면 여러 규칙을 훑는 것만으로 «유의한» 규칙이 만들어집니다.</p>
<div class="vd ${P.maxshare.vsRandom.p<0.05&&P.minshare.vsRandom.p<0.05?'ok':'sig'}">
${P.maxshare.vsRandom.p<0.05&&P.minshare.vsRandom.p<0.05
 ? `<b>양성 대조군이 작동합니다.</b> 일부러 인기 조합을 고르는 규칙은 ${sgn(P.maxshare.vsRandom.mean)}, 현행 규칙은 ${sgn(P.minshare.vsRandom.mean)} 로 반대 방향으로 갈립니다. 모델이 실제로 무언가를 잡고 있다는 뜻입니다.`
 : `<b>대조군이 갈리지 않습니다.</b> 인기 조합을 일부러 고르든 피하든 차이가 없다면, 이 모델은 잡음입니다.`}</div></div>

<h2>3층 · 그래서 돈이 됐는가 — 그리고 언제쯤 알 수 있는가</h2>
<p class="note">여기가 이 프로젝트에서 가장 오해하기 쉬운 곳입니다. 회수율은 <b>1등 꼬리가 지배</b>하므로
성능 지표가 될 수 없습니다. 아래는 «지금 관측된 효과 크기가 진짜라고 가정할 때, 그것을 그 지표로 판별하는 데 몇 주가 필요한가»입니다.</p>
<div class="card"><div class="scroll"><table>
<tr><th>선택 규칙</th><th class="num">z 이득으로 판별</th><th class="num">실제 회수금으로 판별</th></tr>
${powerRows}
</table></div>
<div class="vd sig">주당 회수금의 이론 표준편차는 <b>${fmtN(A.sdWeek)}원</b>인데 기대 회수금은 <b>${fmtN(A.chanceMean)}원</b>입니다.
잡음이 신호의 ${Math.round(A.sdWeek/A.chanceMean)}배라, 돈으로 검증하려면 <b>${bigWeeks(P.minshare.weeksForMoney)}</b>이 걸립니다.
같은 효과를 z 이득으로 재면 <b>${bigWeeks(P.minshare.weeksForZ)}</b>면 됩니다.
<b>그래서 이 보드는 돈이 아니라 메커니즘을 봅니다.</b></div></div>

<h2>연금복권 · 규칙 전수 검정</h2>
<p class="note">모델 5종 × 상위 K 5단계 = <b>${PA.tested}개</b> 조합을 전부 돌렸습니다.
균일한 추첨이라면 우연히 <b>${PA.expectedByChance}개</b>가 p&lt;0.05를 넘습니다. 다중검정 보정 후에도 남는 게 있는지가 관건입니다.</p>
<div class="card"><div class="scroll"><table>
<tr><th>모델</th><th class="num">K</th><th class="num">적중률</th><th class="num">우연 기준선</th><th class="num">p</th><th class="num">보정 p</th></tr>
${penRows}
</table></div>
<div class="vd ${PA.sigCorrected?'sig':'ok'}">
p&lt;0.05 인 조합 <b>${PA.sig}개</b>(우연 기대 ${PA.expectedByChance}개) · 보정 후 살아남은 것 <b>${PA.sigCorrected}개</b>.
${PA.controlSig?`그중 <b>무작위 대조군에서도 ${PA.controlSig}개</b>가 «유의»하게 나왔습니다 — 다중검정이 가짜 신호를 만드는 장면 그 자체입니다.`:''}
${PA.sigCorrected?'':'보정 후 남는 것이 없습니다. <b>연금복권에는 쓸 수 있는 규칙이 없습니다.</b> 고정 당첨금이라 애초에 바꿀 것도 없습니다.'}</div></div>

<h2>실구매 원장</h2>
<p class="note">추천이 회차 번호를 시드로 결정되므로 <b>«그 회차 추천 = 그 주에 산 것»</b>으로 자동 기록됩니다.
안 샀거나 품절된 주가 있으면 알려 주시면 고칩니다. 주간 ${led.config.lottoGames}줄 + 연금 ${led.config.pensionTickets}장 = ${fmtN((led.config.lottoGames+led.config.pensionTickets)*1000)}원.</p>
<div class="card"><div class="scroll"><table>
<tr><th>구분</th><th class="num">투입</th><th class="num">회수</th><th class="num">회수율</th><th class="num">중앙값</th><th class="num">주수</th></tr>
<tr class="me"><td>로또 6/45</td><td class="num">${fmtN(tot.lotto.spend)}</td><td class="num">${fmtN(tot.lotto.ret)}</td>
  <td class="num">${pc(tot.lotto.rate,1)}</td><td class="num">${fmtN(tot.lotto.median)}</td><td class="num">${tot.lotto.weeks}</td></tr>
<tr class="me"><td>연금복권720+</td><td class="num">${fmtN(tot.pension.spend)}</td><td class="num">${fmtN(tot.pension.ret)}</td>
  <td class="num">${pc(tot.pension.rate,1)}</td><td class="num">${fmtN(tot.pension.median)}</td><td class="num">${tot.pension.weeks}</td></tr>
</table></div>
<h3>최근 기록</h3>
<div class="scroll"><table>
<tr><th>구분</th><th class="num">회차</th><th class="num">추첨일</th><th class="num">투입</th><th class="num">회수</th><th class="num">결과</th></tr>
${ledRows}
</table></div>
<div class="vd">${tot.lotto.weeks<20
 ? `아직 <b>${tot.lotto.weeks}주</b>입니다. 실구매 기록만으로 규칙을 판단하려면 위 3층 표의 «실제 회수금으로 판별» 칸만큼 걸립니다. <b>이 원장은 성능 측정용이 아니라 가계부입니다.</b>`
 : `${tot.lotto.weeks}주 누적. 회수율은 여전히 성능 지표가 아닙니다 — 판단은 1·2층으로 하세요.`}</div></div>

<div class="foot">동행복권 공식 API 자료로 자동 생성 · ${meta.stamp} (KST) · 로또 ${A.n}주 walk-forward, 연금 ${PA.tested}개 조합 전수<br>
확률은 어떤 규칙으로도 바뀌지 않습니다. 이 보드가 재는 것은 «당첨됐을 때 나눠 갖는 인원»뿐입니다.<br>
복권 구매는 감당할 수 있는 범위 안에서. 만 19세 미만은 구매할 수 없습니다.</div>
</div></body></html>`;
}

/* ── 9. main ─────────────────────────────────────────────────── */
(async function main(){
  const t0=Date.now();
  const WIN=+(arg('--window','300'));
  const CFG={ lottoGames:+(arg('--lotto-games','5')), pensionTickets:+(arg('--pension-tickets','5')) };
  const prevPath=arg('--purchases', path.join(OUT,'brief','purchases.json'));

  console.error('[1/5] 데이터 수집…');
  const [pension, lotto] = await Promise.all([getPension(), getLotto()]);
  console.error(`      연금 ${pension.length}회(최신 ${pension.at(-1).ep}) · 로또 ${lotto.rows.length}회(최신 ${lotto.latest})`);

  for(const f of ['pension.html','index.html'])
    if(!fs.existsSync(path.join(ROOT,f))) throw new Error(`${f} 를 ${ROOT} 에서 찾을 수 없습니다 (--root 확인)`);

  console.error('[2/5] 로또 — 후보 풀 공유 5개 규칙 walk-forward…');
  const {srv,port}=await serve(ROOT); const base='http://127.0.0.1:'+port;
  let L,P;
  try{
    await withBrowser(async b=>{
      L=await readLotto(b,base,pension,lotto,WIN);
      console.error(`      ${L.rows.length}주 채점 · 다음 ${L.target}회`);
      if(L.pageErrors) console.error('      page errors:',L.pageErrors);
      console.error('[3/5] 연금 — 모델 5종 × K 5단계 전수…');
      P=await readPension(b,base,pension,lotto);
      console.error(`      ${P.grid.length}개 조합 · 다음 ${P.next.ep}회`);
    });
  } finally { srv.close(); }
  if(!L.rows.length) throw new Error('로또 walk-forward 결과가 비었습니다');

  console.error('[4/5] 집계·원장…');
  const A=analyzeLotto(L); A.strats=L.strats;
  const PA=analyzePension(P);
  let prev=null;
  try{ if(fs.existsSync(prevPath)) prev=JSON.parse(fs.readFileSync(prevPath,'utf8')); }
  catch(e){ console.error('      기존 원장 읽기 실패, 새로 만듭니다:',e.message); }
  const led=mergePurchases(prev,L,P,CFG);
  const tot=ledgerTotals(led);

  console.error('[5/5] 저장…');
  const now=KST(); const meta={date:kstStr(now), stamp:now.toISOString().slice(0,16).replace('T',' ')};
  fs.mkdirSync(path.join(OUT,'brief'),{recursive:true});
  fs.writeFileSync(path.join(OUT,'validate.html'), buildBoard(A,PA,led,tot,meta));
  fs.writeFileSync(path.join(OUT,'brief','purchases.json'), JSON.stringify(led,null,1));
  const val={ generated:new Date().toISOString(), window:WIN,
    lotto:{ n:A.n, from:A.from, to:A.to, calib:A.calib, sdWeek:A.sdWeek, chanceMean:A.chanceMean,
      per:Object.fromEntries(Object.entries(A.per).map(([k,v])=>[k,{
        zGain:+v.zGain.toFixed(4), vsRandomMean:+v.vsRandom.mean.toFixed(4), p:+v.vsRandom.p.toFixed(5),
        payoutGain:v.payoutGain==null?null:+v.payoutGain.toFixed(4),
        hitsPerGame:+v.hitsPerGame.toFixed(4), weeksForZ:v.weeksForZ, weeksForMoney:v.weeksForMoney }])) },
    pension:{ tested:PA.tested, sig:PA.sig, sigCorrected:PA.sigCorrected,
      expectedByChance:PA.expectedByChance, controlSig:PA.controlSig },
    ledger:tot };
  fs.writeFileSync(path.join(OUT,'brief','validation.json'), JSON.stringify(val,null,1));

  const S=A.per;
  console.log(JSON.stringify({
    date:meta.date, seconds:Math.round((Date.now()-t0)/1000),
    files:[path.join(OUT,'validate.html'), path.join(OUT,'brief','purchases.json'), path.join(OUT,'brief','validation.json')],
    모델:{ 표본:A.calib.n, R2:A.calib.ready?+A.calib.r2.toFixed(3):null,
           기울기:A.calib.ready?+A.calib.b.toFixed(4):null,
           오차개선:A.calib.ready?+(1-A.calib.mae/A.calib.maeNaive).toFixed(3):null },
    선택규칙:Object.fromEntries(A.strats.map(k=>[SNAME[k],
      `z이득 ${S[k].zGain.toFixed(3)} · 무작위대비 ${k==='random'?'기준':sgn(S[k].vsRandom.mean)} (p=${S[k].vsRandom.p.toFixed(4)}) · 환산 ${S[k].payoutGain==null?'—':sgn(S[k].payoutGain*100,1)+'%'}`])),
    판별소요:{ z이득:bigWeeks(S.minshare.weeksForZ), 회수금:bigWeeks(S.minshare.weeksForMoney) },
    연금:{ 검정조합:PA.tested, 유의:PA.sig, 우연기대:PA.expectedByChance, 보정후:PA.sigCorrected, 대조군유의:PA.controlSig },
    원장:tot,
    이번주구매:{ 로또:L.picks.slice(0,CFG.lottoGames).map(c=>c.join(',')),
                 연금:P.picks.slice(0,CFG.pensionTickets).map(c=>c.band+'조 '+c.num) }
  },null,1));
  console.error(`완료 · ${Math.round((Date.now()-t0)/1000)}초`);
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
