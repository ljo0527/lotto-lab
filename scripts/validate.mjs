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

   [2026-09 개편] (PLAN §1.6, D1 §5·§6, D2 §3.D)
     · 로또 5게임 구조 — portfolio / portfolio_carry / disjoint / weekly_v1 을 같은 후보 풀에서 비교.
       회차별 P(1게임 이상 당첨)·EV/5,000원·전주 겹침을 기록하고, 전주 회피(carry) 효과를 walk-forward 로 잰다.
     · 연금 5장 구조 — 분산·세트·구 방식을 회차별 as-of 로 만들어 페이지의 gradeOf 로 채점.
     · 추천 원장 — 현재 대상 회차(pending)는 현재 추천으로 갱신, 결과가 나온 pending 은 전부 채점(페이지 rankOf/gradeOf).
     · 새 페이지 함수는 전부 typeof 로 확인하고 없으면 옛 경로로 간다(하위호환).
   [2026-09 2차] 규칙 이력표(C1) — 설정을 바꿔도 지난 회차 재현이 깨지지 않게.
     · 로또 재현은 그 회차 규칙으로: 페이지의 weeklyPicks()(내부에서 portfolioOptsFor(R))를 DB 를 R−1 로 자른 채 부른다.
       현재 상수(PORTFOLIO)로 재현하지 않는다. 원장 행에 rule 이 적혀 있으면 그 규칙을 존중한다.
     · 연금 재현은 pensionModeFor(ep) 로 그 회차 방식을 정한다(원장 행의 mode/rule 이 있으면 그쪽 우선).
     · pension.structure 는 pensionPortfolio(…,{noDist:true}) 로 5장만 받고, 분포는 «구조가 같은 5장»끼리
       한 번만 계산해 재사용한다(분포는 번호 값이 아니라 끝자리 공유 구조·조 구성에만 달려 있다 — distSig 참고).
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
/* --no-dist-memo : 연금 구조 점검에서 분포를 서명 캐시 없이 매 회차 다시 계산한다(대조 실험용, 느림) */
const DIST_MEMO=!process.argv.includes('--no-dist-memo');

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
/* 서비스워커 차단(D2 §3.D.6) — 페이지가 sw.js 를 등록해 응답을 캐시에서 주면 목업이 무력화된다. */
const CTX_OPTS={serviceWorkers:'block'};

/* 채점기 가드(D2 §3.D.5) — record.html 은 rankOf/gradeOf 를 «복사해서» 쓴다(오프라인·가벼움).
   복사본이 원본과 어긋나면 «기록» 페이지의 당첨 판정이 조용히 틀리므로, 시드 고정 벡터로 매주 대조한다.
   벡터: 최근 50회 추첨 × 2,000개 조합/티켓. 조합은 그 회차 번호를 0~6개(연금은 뒷자리 0~6자리·보너스·조)
   섞어 만들어 모든 등수가 고르게 나오게 한다. */
function mulberry32N(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function graderVectors(lotto, pension, seed=20260923){
  const rnd=mulberry32N(seed), ri=n=>Math.floor(rnd()*n);
  const draws=(lotto.rows||[]).slice(-50).map(x=>({
    n:[x.tm1WnNo,x.tm2WnNo,x.tm3WnNo,x.tm4WnNo,x.tm5WnNo,x.tm6WnNo].map(Number), b:+x.bnsWnNo}));
  const combos=[];
  for(let i=0;i<2000;i++){
    const d=draws[i%draws.length], k=i%7, s=new Set();
    const win=d.n.slice().sort(()=>rnd()-0.5).slice(0,k); win.forEach(v=>s.add(v));
    if(k===5 && (i&8)) s.add(d.b);
    while(s.size<6){ const v=1+ri(45); if(!d.n.includes(v)) s.add(v); }
    combos.push([...s].sort((a,b)=>a-b));
  }
  const rounds=(pension||[]).slice(-50).map(r=>({band:r.band,num:r.num,bonus:r.bonus}));
  const digit=c=>{ let v; do v=String(ri(10)); while(v===c); return v; };
  const tickets=[];
  for(let i=0;i<2000;i++){
    const r=rounds[i%rounds.length], m=i%9;
    let band=1+ri(5), num='';
    if(m===0){ num=r.num; band=r.band; }
    else if(m===1){ num=r.num; band=(r.band%5)+1; }
    else if(m===2){ num=r.bonus; }
    else if(m<=7){ const L=m-2; /* 뒤 L자리 일치(1..5) */
      num=Array.from({length:6-L},()=>String(ri(10))).join('');
      num=num.slice(0,-1)+digit(r.num[5-L]); num+=r.num.slice(6-L); }
    else num=Array.from({length:6},()=>String(ri(10))).join('');
    tickets.push({band,num});
  }
  return {lotto:{draws,combos}, pension:{rounds,tickets}};
}
/* 원본(index/pension)과 사본(record)이 같은 식으로 채점한 결과를 «등수 숫자 문자열»로 받아 비교한다:
     로또  gv.lotto.draws.map(d=>gv.lotto.combos.map(c=>rankOf(c,d)).join('')).join('|')
     연금  gv.pension.rounds.map(r=>gv.pension.tickets.map(t=>gradeOf(t.band,t.num,r)).join('')).join('|') */
async function readRecordGuard(browser, base, root, gv, pension, lotto){
  if(!fs.existsSync(path.join(root,'record.html'))) return {skipped:'record.html 없음'};
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  try{
    const p=await ctx.newPage();
    await p.goto(base+'/record.html',{waitUntil:'load'});
    await p.waitForTimeout(300);
    return await p.evaluate(gv=>({
      lotto: typeof rankOf==='function'
        ? gv.lotto.draws.map(d=>gv.lotto.combos.map(c=>rankOf(c,d)).join('')).join('|') : null,
      pension: typeof gradeOf==='function'
        ? gv.pension.rounds.map(r=>gv.pension.tickets.map(t=>gradeOf(t.band,t.num,r)).join('')).join('|') : null,
      amt: typeof PENSION_AMT!=='undefined' ? PENSION_AMT : null }), gv);
  } finally { await ctx.close(); }
}
function compareGuard(orig, copy, amtOrig){
  const cmp=(a,b)=>{
    if(a==null||b==null) return {ok:null, n:0};
    const A=a.split('|'), B=b.split('|'); let n=0, bad=0, first=null;
    for(let i=0;i<A.length;i++) for(let j=0;j<A[i].length;j++){ n++;
      if(!B[i]||A[i][j]!==B[i][j]){ bad++; if(!first) first={draw:i,item:j,orig:A[i][j],copy:B[i]?B[i][j]:null}; } }
    const hist={}; for(const ch of a.replace(/\|/g,'')) hist[ch]=(hist[ch]||0)+1;
    return {ok:bad===0, n, mismatch:bad, first, gradeHist:hist};
  };
  const out={ lotto:cmp(orig.lotto, copy&&copy.lotto), pension:cmp(orig.pension, copy&&copy.pension) };
  if(copy&&copy.amt&&amtOrig){ const ks=Object.keys(amtOrig);
    out.pensionAmt={ok:ks.every(k=>+copy.amt[k]===+amtOrig[k]) && Object.keys(copy.amt).length===ks.length}; }
  if(copy&&copy.skipped) out.skipped=copy.skipped;
  return out;
}


/* ── 3. 로또 : 세 층을 한 번에 잰다 ───────────────────────────────
   같은 회차에서 **같은 후보 풀**을 만들고 선택 규칙만 갈아끼운다.
   풀 생성이 비용의 대부분이므로 싸고, 무엇보다 «같은 후보에서 무엇을 골랐나» 라는
   공정한 비교가 된다.

   [2026-09 개편] 후보 풀 = weeklyPicks() 의 풀과 **바이트 단위로 같은 풀**.
     · 목표 3,000개 · 시도 상한 200,000회 (weeklyPicks 와 같은 상수).
     · 예전의 «800ms 시간 예산»을 없앴다. 시간 예산은 기계 속도에 따라 풀 크기가 달라져
       같은 회차·같은 데이터인데 CI 러너마다 결과가 달라질 수 있었다(재현성 파괴).
       이제 풀은 (데이터, 회차) 만의 함수다. 3,000개를 채우는 데 보통 1~2만 회 시도면 충분하다.
     · 예전 풀(목표 2,000)은 새 풀의 앞 2,000개와 같다(같은 시드·같은 필터 → 같은 수열).
       풀이 커져서 minshare 등 옛 규칙의 z 이득은 조금 커질 수 있다(상위 5가 더 극단적).
     · 이렇게 해야 weekly_v1 이 «그 주에 실제로 추천된 A~E»(원장)를, portfolio 가
       «새 규칙이 그 주에 추천했을 A~E»를 그대로 재현한다(아래 repro 점검). */
const POOL_N=3000, POOL_TRIES=200000;
const ALL_STRATS=['portfolio','portfolio_carry','disjoint','weekly_v1','minshare','maxshare','random','hot','cold'];

async function readLotto(browser, base, pension, lotto, WIN, ledger, calibFn, gv){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/index.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.latest>100&&DB.draws&&DB.draws[DB.latest],{timeout:120000});
  await p.waitForTimeout(1500);

  const out = await p.evaluate(async ({WIN, POOL_N, POOL_TRIES, ALL_STRATS, pend, ledPicks, ledRules, gv})=>{
    const reset=()=>{ WEEKLY=null; WEEKLY_R=0; POPFIT=null; POPFIT_N=0; WINSET=null; WINSET_N=0; };
    const tick=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r();c.port2.postMessage(0);});
    const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
    /* 새 페이지 함수 — 없으면(옛 index.html) 해당 기능만 빠진다 */
    const has={
      pp: typeof portfolioPick==='function' && typeof PORTFOLIO!=='undefined',
      pa: typeof pAnyApprox==='function' && typeof lineMask==='function',
      zo: typeof zOf==='function',
      zf: typeof zFloorOf==='function',
      co: typeof carryOf==='function',
      dl: typeof diversifyLegacy==='function',
      ev: typeof lineEV==='function',
      cx: typeof coverExact==='function',
      pof: typeof portfolioOptsFor==='function',
    };
    /* PF = «현재» 규칙(규칙표의 마지막 항목 = PORTFOLIO 별칭). walk-forward 의 portfolio 행은
       «지금 설정을 과거 300주에 적용하면»을 잰다. 지난 회차 재현은 PF 가 아니라 optsFor(R) 로 한다. */
    const PF=has.pp?Object.assign({},PORTFOLIO):null;
    const PFROM=(typeof PORTFOLIO_FROM!=='undefined')?PORTFOLIO_FROM:null;
    const RULES=(typeof PORTFOLIO_RULES!=='undefined'&&Array.isArray(PORTFOLIO_RULES))
      ? PORTFOLIO_RULES.map(r=>({from:r.from, opts:Object.assign({},r.opts)})) : null;
    const carryF=has.co ? carryOf : (c,prev)=>prev?c.filter(n=>prev.includes(n)).length:0;
    const ovF=(a,b)=>a.filter(n=>b.includes(n)).length;
    const errors={};
    const noteErr=(k,e)=>{ if(!errors[k]) errors[k]=String(e&&e.message||e).slice(0,200); };
    /* 회차 R 의 규칙(C1) — null 이면 옛 규칙(legacy). 규칙표가 없는 옛 페이지는 단일 상수(PORTFOLIO_FROM·PORTFOLIO)로 */
    const optsFor=R=>{
      if(has.pof){ try{ const o=portfolioOptsFor(R); return o?Object.assign({},o):null; }catch(e){ noteErr('portfolioOptsFor',e); } }
      return (PF && PFROM!=null && R>=PFROM) ? PF : null;
    };
    const sameOpts=(a,b)=>{ if(!a||!b) return a===b;
      const ks=new Set([...Object.keys(a),...Object.keys(b)]);
      for(const k of ks) if(a[k]!==b[k]) return false; return true; };

    /* 구 주간규칙(겹침 ≤2/≤3/≤4 3단계) — 페이지의 diversifyLegacy 가 있으면 그걸 쓰고,
       없거나(옛 페이지) 모양이 다르면 옛 weeklyPicks 의 선택부를 그대로 옮긴 사본으로. */
    const legacyLocal=(pool,WANT)=>{
      const out=[], useCnt={};
      const fits=(c,ov,mx)=>out.every(o=>o.filter(n=>c.includes(n)).length<=ov) && c.every(n=>(useCnt[n]||0)<mx);
      for(const [ov,mx] of [[2,2],[3,3],[4,4]]){
        if(out.length>=WANT) break;
        for(const c of pool.slice(0,1500)){
          if(out.length>=WANT) break;
          if(out.some(o=>o.join()===c.join())) continue;
          if(!fits(c,ov,mx)) continue;
          out.push(c); c.forEach(n=>useCnt[n]=(useCnt[n]||0)+1);
        }
      }
      for(let i=0;out.length<WANT && i<pool.length;i++){
        const c=pool[i]; if(out.some(o=>o.join()===c.join())) continue;
        out.push(c); c.forEach(n=>useCnt[n]=(useCnt[n]||0)+1);
      }
      return out;
    };
    let dlMode=has.dl?'page':'local';
    const legacyPick=(combos,want)=>{
      if(dlMode==='page'){
        try{
          const o=[], r=diversifyLegacy(combos,o,want), arr=(r&&r.combos)||r||o;
          const cs=Array.isArray(arr)?arr.slice(0,want).map(x=>Array.isArray(x)?x:(x&&x.c)):[];
          if(cs.length===want && cs.every(c=>Array.isArray(c)&&c.length===6)) return cs;
          noteErr('diversifyLegacy','unexpected shape'); dlMode='local';
        }catch(e){ noteErr('diversifyLegacy',e); dlMode='local'; }
      }
      return legacyLocal(combos,want);
    };

    const latest=DB.latest, from=Math.max(300, latest-WIN+1);
    const orig=DB.draws, origLatest=DB.latest, work=orig.slice();
    const STRATS=ALL_STRATS.filter(k=>has.pp || !['portfolio','portfolio_carry','disjoint'].includes(k));
    const rows=[], repro=[], EVS=[];
    let skipped=0, triesMax=0, poolShort=0;
    const t0=performance.now();
    try{
      DB.draws=work;
      for(let R=from; R<=latest; R++){
        if(!orig[R]) continue;
        for(let j=1;j<orig.length;j++) work[j]=orig[j];
        for(let j=R;j<work.length;j++) work[j]=undefined;
        DB.latest=R-1; bumpDB(); reset();

        /* 재현 점검 — 원장에 적힌 그 회차 A~E 를 «그 회차 규칙»으로 다시 만들 수 있는가.
           사이트가 실제로 부르는 weeklyPicks() 를 DB 를 R−1 로 자른 채 부른다(target=R → 내부에서 portfolioOptsFor(R)).
           원장 행에 rule 이 적혀 있고 규칙표와 다르면 그 규칙으로 강제(force)해 «기록된 것»을 재현하고, 차이를 표시한다.
           아래 풀 비교(rp.pool)는 이 검증 보드의 후보 풀이 사이트 추천 풀과 같은지(=보드가 사이트 규칙을 재는지) 본다. */
        let rp=null;
        const lp=ledPicks[R];
        if(lp){
          const tOpts=optsFor(R), table=tOpts?'portfolio':'legacy';
          const recd=(ledRules[R]==='portfolio'||ledRules[R]==='legacy')?ledRules[R]:null;
          const want=recd||table;
          rp={R, rule:want, table, recorded:recd, via:null, order:false, set:false, pool:null};
          try{
            const W2=(want!==table)?weeklyPicks(want):weeklyPicks();
            const cs=W2&&Array.isArray(W2.combos)?W2.combos.slice(0,lp.length).map(c=>c.join(',')):[];
            if(cs.length===lp.length){
              rp.via='weeklyPicks'; if(W2.rule) rp.rule=W2.rule;
              rp.order=cs.join('|')===lp.join('|');
              rp.set=cs.slice().sort().join('|')===lp.slice().sort().join('|');
            }
          }catch(e){ noteErr('weeklyPicks.repro',e); }
          repro.push(rp);
        }

        const F=fitPop(); if(!F.A) continue;

        /* 후보 풀 — weeklyPicks() 와 같은 시드·필터·상수. 시간 예산 없음(재현성) */
        const save=RNG; RNG=mulberry32(R*2654435761);
        const FIL={lo:100,hi:175,cons:2,odd:'234',strat:'minshare'};
        const w=weightsFor('minshare'), pool=[], seen=new Set();
        let tries=0;
        try{
          while(pool.length<POOL_N && tries<POOL_TRIES){
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
        } finally { RNG=save; }
        if(tries>triesMax) triesMax=tries;
        if(pool.length<POOL_N) poolShort++;
        if(pool.length<60) continue;

        const zLoc=c=>{ const a=popScoreA(c); if(a==null) return null;
          const za=(a-F.A.predMean)/F.A.predSD;
          const b=F.B?popScoreB(c):null;
          const zb=(F.B&&b!=null)?(b-F.B.predMean)/F.B.predSD:za;
          return (za+zb)/2; };
        const zFn=has.zo ? (c=>{ const z=zOf(c); return (z==null||!isFinite(z))?null:z; }) : zLoc;
        const P=pool.map(c=>({c,z:zFn(c)})).filter(x=>x.z!=null);
        if(P.length<60) continue;
        const Ps=P.slice().sort((a,b)=>a.z-b.z);           // z 오름차순(안정 정렬 = weeklyPicks 의 순서)
        const poolZ=avg(P.map(x=>x.z));
        const prevN=orig[R-1]&&orig[R-1].n;
        let zFl=null; if(has.zf){ try{ zFl=zFloorOf(); }catch(e){ noteErr('zFloorOf',e); } }

        const freq=freqOf(52,false).f, gaps={}; gapsOf().forEach(g=>gaps[g.n]=g.gap);
        const sumF=x=>x.c.reduce((a,n)=>a+(freq[n]||0),0);
        const sumG=x=>x.c.reduce((a,n)=>a+(gaps[n]||0),0);
        const rng2=mulberry32(R*7919);
        const shuffled=P.slice(); for(let i=shuffled.length-1;i>0;i--){const j=(rng2()*(i+1))|0;[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}

        const sel={
          minshare: Ps.slice(0,5),
          maxshare: P.slice().sort((a,b)=>b.z-a.z).slice(0,5),
          random:   shuffled.slice(0,5),
          hot:      P.slice().sort((a,b)=>sumF(b)-sumF(a)).slice(0,5),
          cold:     P.slice().sort((a,b)=>sumG(b)-sumG(a)).slice(0,5),
        };
        /* 새 규칙 — 같은 풀 P 에서 (D1 §5) */
        const meta={};
        if(has.pp){
          const run=(k,o)=>{
            try{ const r=portfolioPick(Ps,Object.assign({},PF,{prevN},o));
              sel[k]=r&&r.picks; meta[k]={u:r.u,uStar:r.uStar,cap:r.cap,degraded:!!r.degraded};
            }catch(e){ noteErr(k,e); sel[k]=null; }
          };
          run('portfolio',{});
          run('portfolio_carry',{carry:true});
          run('disjoint',{maxOv:0,dz:Infinity});
        }
        { const byKey=new Map(Ps.map(x=>[x.c.join(','),x]));
          const cs=legacyPick(Ps.map(x=>x.c),5);
          sel.weekly_v1=cs.map(c=>byKey.get(c.join(','))||{c,z:zFn(c)}); }

        /* 한 규칙이라도 5줄을 못 내면 그 회차는 통째로 뺀다(대응 비교가 깨지지 않게) */
        if(STRATS.some(k=>!Array.isArray(sel[k])||sel[k].length!==5||sel[k].some(x=>!x||!x.c||x.z==null))){ skipped++; continue; }

        const actual=orig[R];
        const rec={R, y:actual.ymd, poolZ:+poolZ.toFixed(4), pool:P.length, tries, s:{}};
        const evRec={R, zFl, prevN, G:null, s:{}};
        /* G = 최근 52회 판매량 중앙값(게임 수) — D1 §1 정의. ₩ 모형에만 쓴다 */
        { const ss=[]; for(let j=R-1;j>=1&&ss.length<52;j--){ const d=orig[j]; if(d&&d.s) ss.push(d.s/TICKET); }
          ss.sort((a,b)=>a-b); const n=ss.length; evRec.G=n?(n%2?ss[(n-1)/2]:(ss[n/2-1]+ss[n/2])/2):null; }
        for(const k of STRATS){
          const g=sel[k];
          const zs=g.map(x=>x.z), mz=avg(zs);
          const ranks=g.map(x=>rankOf(x.c,actual));
          let ret=0, hits=0, fixed=0;
          ranks.forEach(r=>{ if(r){ const a=actual.a[r-1]||0; ret+=a; if(r>=4) fixed+=a; } });
          g.forEach(x=>{ hits += x.c.filter(n=>actual.n.includes(n)).length; });
          const cs=g.map(x=>prevN?carryF(x.c,prevN):0);
          let ovMax=0; for(let i=0;i<5;i++) for(let j=i+1;j<5;j++){ const o=ovF(g[i].c,g[j].c); if(o>ovMax) ovMax=o; }
          const o={ z:+mz.toFixed(4), gain:+(poolZ-mz).toFixed(4), ret, hits, ranks:ranks.filter(Boolean),
                    anyHit:ranks.some(Boolean)?1:0, fixed, carry:avg(cs), ovMax };
          if(zFl!=null) o.u=+avg(zs.map(z=>Math.max(z,zFl))).toFixed(4);
          if(has.pa){ try{ o.pAny=pAnyApprox(g.map(x=>lineMask(x.c))); }catch(e){ noteErr('pAnyApprox',e); } }
          if(meta[k]){ o.degraded=meta[k].degraded;
            if(meta[k].u!=null&&meta[k].cap!=null) o.budgetOK=meta[k].u<=meta[k].cap+1e-9; }
          rec.s[k]=o;
          evRec.s[k]={z:zs, carry:cs};
        }
        /* 이 회차 실제 당첨번호의 «실제 초과배수» — 1층 모델 검증용 (+ 등위별, 전주 겹침) */
        if(actual.s && actual.w[3] && actual.w[4]){
          const gm=actual.s/TICKET, e4=gm*WAYS[4]/C456, e5=gm*WAYS[5]/C456;
          if(e4>=200){
            const zt=zFn(actual.n);
            if(zt!=null){
              rec.zTrue=+zt.toFixed(4);
              rec.rTrue=+(0.5*(actual.w[3]/e4)+0.5*(actual.w[4]/e5)).toFixed(5);
              rec.rT=[1,2,3].map(k=>+((actual.w[k-1]||0)/(gm*WAYS[k]/C456)).toFixed(5));
              if(prevN) rec.carryTrue=carryF(actual.n,prevN);
            }
          }
        }
        rec.chance=Math.round(5*chanceEV(actual));
        rec.a=actual.a.slice();
        rows.push(rec); EVS.push(evRec);

        /* 풀 비교 — 같은 규칙(그 회차의 opts)을 이 보드의 풀 P 에 적용한 A~E 가 원장과 같은가.
           weeklyPicks 가 없거나 실패한 옛 페이지에서는 이 값이 재현 판정을 대신한다. */
        if(rp){
          let mine=null;
          if(rp.rule==='portfolio' && has.pp){
            const o=optsFor(R)||PF;
            if(sameOpts(o,PF)) mine=sel.portfolio;
            else { try{ const r=portfolioPick(Ps,Object.assign({},o,{prevN})); mine=r&&r.picks; }catch(e){ noteErr('portfolioPick.repro',e); } }
          } else if(rp.rule!=='portfolio') mine=sel.weekly_v1;
          if(Array.isArray(mine)&&mine.length===lp.length){
            const cs=mine.map(x=>x.c.join(','));
            rp.pool=cs.slice().sort().join('|')===lp.slice().sort().join('|');
            if(!rp.via){ rp.via='pool'; rp.order=cs.join('|')===lp.join('|'); rp.set=rp.pool; }
          }
        }
        if(rows.length%25===0) await tick();
      }
    } finally { DB.draws=orig; DB.latest=origLatest; bumpDB(); reset(); }
    const loopMs=Math.round(performance.now()-t0);
    globalThis.__VAL_EVS=EVS;

    /* 현재 회차 추천(=이번 주 추천 원장 기록분) — weeklyPicks 가 규칙표(portfolioOptsFor)대로 골랐는지도 본다 */
    const W=weeklyPicks();
    const buy=W.combos.slice(0,5);
    const wOpts=optsFor(W.round), wTable=wOpts?'portfolio':'legacy';
    const wRule=W.rule||(has.pp&&PFROM!=null&&W.round>=PFROM?'portfolio':'legacy');
    const weeklyRule={ round:W.round, rule:wRule, table:wTable,
      /* opts 는 규칙표의 키만 대조한다(페이지가 opts 에 진단용 키를 더 얹어도 실패로 보지 않게) */
      ok: wRule===wTable && (wTable!=='portfolio' || !(W.portfolio&&W.portfolio.opts) || !wOpts ||
          Object.keys(wOpts).every(k=>W.portfolio.opts[k]===wOpts[k])),
      opts: wOpts };

    /* pending 채점 — 결과가 나온 회차는 전부. 페이지의 rankOf 로(Node 복제 금지, R4 §7) */
    const graded={};
    for(const e of pend){
      const d=DB.draws[e.round]; if(!d) continue;
      let ret=0;
      const result=e.picks.map(s=>{ const c=String(s).split(',').map(Number);
        const g=rankOf(c,d)||0; if(g) ret+=d.a[g-1]||0;
        return {hit:c.filter(n=>d.n.includes(n)).length, bonus:c.includes(d.b), grade:g}; });
      graded[e.round]={date:d.ymd, result, return:ret};
    }

    /* 자기 점검 — D1 §7 의 정확 계산 값 */
    const checks={};
    if(has.cx){
      try{
        const q=performance.now();
        const dis=[[1,2,3,4,5,6],[7,8,9,10,11,12],[13,14,15,16,17,18],[19,20,21,22,23,24],[25,26,27,28,29,30]];
        checks.cover5disjoint=Math.round(coverExact(dis).pAny*C456);
        checks.cover1=Math.round(coverExact([dis[0]]).pAny*C456);
        const ex=coverExact(buy).pAny;
        checks.buyPAnyExact=ex;
        if(has.pa) checks.buyPAnyApproxErr=Math.abs(pAnyApprox(buy.map(lineMask))-ex);
        checks.coverMs=Math.round((performance.now()-q)/3);
      }catch(e){ noteErr('coverExact',e); }
    }
    if(has.ev){
      try{ checks.lineEV1=lineEV(0,0,{G:121085706, calib:{a:1,b:0}, zFloor:-99, prevN:null}); }
      catch(e){ noteErr('lineEV',e); }
    }

    return { latest, from, strats:STRATS, rows, repro, has, dlMode, errors, checks, skipped,
             poolN:POOL_N, triesMax, poolShort, loopMs,
             portfolio:PF, portfolioFrom:PFROM, portfolioRules:RULES, weeklyRule,
             target:W.round, picks:W.combos.slice(0,10), buy:buy.map(c=>c.slice()),
             rule:wRule,
             weeklyMeta:W.portfolio||null, graded,
             guard: gv ? gv.lotto.draws.map(d=>gv.lotto.combos.map(c=>rankOf(c,d)).join('')).join('|') : null,
             lastDraw:{r:orig[latest].r,ymd:orig[latest].ymd,n:orig[latest].n,b:orig[latest].b,
                       w:orig[latest].w,a:orig[latest].a,s:orig[latest].s} };
  }, {WIN, POOL_N, POOL_TRIES, ALL_STRATS, pend:ledger.pend('lotto'), ledPicks:ledger.picksByRound('lotto'),
      ledRules:Object.fromEntries(Object.entries(ledger.rulesByRound('lotto')).map(([k,v])=>[k,v.rule||null])), gv:gv||null});

  /* 2차 패스 — 최종 재보정(calib)을 페이지에 넘겨 EV/5,000원을 페이지의 lineEV 로 계산.
     ₩ 공식은 Node 에 다시 쓰지 않는다(PLAN §1.4). */
  if(calibFn){
    const cal=calibFn(out.rows);
    out.cal=cal;
    if(out.has.ev && cal.calib && cal.calib.ready){
      try{
        /* ev5  = 보수적 모형 m = a + b·max(z, zFloor)            (사이트 표시와 같은 식)
           ev5c = 전주 겹침 모형 m = a + b·max(z, zFloor) + γ·min(carry,2)  (그림자 · 참고용)
                  lineEV 의 ctx.carry 경로를 쓴다 — 식은 페이지 한 곳에만 있다. */
        out.ev=await p.evaluate(({c1,c2})=>{
          const S=globalThis.__VAL_EVS||[], res={};
          const cal1={a:c1.a,b:c1.b};
          const cal2=c2?{a:c2.a,b:c2.b,gamma:c2.gamma}:null;
          for(const r of S){
            if(!r.G) continue;
            const o={}, zF=(r.zFl==null)?-99:r.zFl;
            for(const k in r.s){
              const {z,carry}=r.s[k]; let e=0, e2=0, ok=true, ok2=!!cal2;
              for(let i=0;i<z.length;i++){
                const v=lineEV(z[i],0,{G:r.G,calib:cal1,zFloor:zF,prevN:r.prevN});
                if(v==null||!isFinite(v)){ ok=false; break; }
                e+=v;
                if(ok2){ const v2=lineEV(z[i],carry[i],{G:r.G,calib:cal2,zFloor:zF,prevN:r.prevN,carry:true});
                  if(v2==null||!isFinite(v2)) ok2=false; else e2+=v2; }
              }
              if(ok) o[k]=[+e.toFixed(2), ok2?+e2.toFixed(2):null];
            }
            res[r.R]=o;
          }
          return res;
        },{c1:cal.calib, c2:(cal.calib2&&cal.calib2.ready)?cal.calib2:null});
      }catch(e){ out.errors.lineEV2=String(e.message||e).slice(0,200); }
    }
  }
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
}

/* ── 4. 연금 : 모델 × K 전수 백테스트 (검정력 낮음을 그대로 보여준다) ──
   + 5장 구조(D1 §6) — 분산·세트·구 방식을 회차별 «그때 데이터»로 만들어 페이지 gradeOf 로 채점.
   이건 구현 점검이지 실력 주장이 아니다(기대값은 구조와 무관하게 3,750원). */
async function readPension(browser, base, pension, lotto, ledger, gv){
  const ctx=await browser.newContext(CTX_OPTS); await mockRoutes(ctx,pension,lotto);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+'/pension.html',{waitUntil:'load'});
  await p.waitForFunction(()=>typeof DB!=='undefined'&&DB.rounds&&DB.rounds.length>50,{timeout:90000});
  await p.waitForTimeout(1200);
  const out=await p.evaluate(async ({pend, ledPicks, ledRules, gv, DIST_MEMO})=>{
    const rows=R(), start=Math.min(100,Math.floor(rows.length*0.3));
    const MODELS=['freq','cold','recent','gap','rand'];
    const grid=[];
    for(const m of MODELS) for(let K=1;K<=5;K++){
      const b=backtest(m,K,2,start);
      grid.push({model:m,K,rate:b.rateD,base:b.baseD,ci:b.ciD,p:b.pD,n:b.totD,
                 bandRate:b.rateB,bandBase:b.baseB,bandP:b.pB});
    }
    const S=predSettings(), nx=nextDraw(), last=rows[rows.length-1];
    const has={ pw:typeof pensionWeekly==='function', pp:typeof pensionPortfolio==='function',
                pd:typeof pensionDist==='function', pmf:typeof pensionModeFor==='function' };
    const MODE=(typeof PENSION_MODE!=='undefined')?PENSION_MODE:null;
    const PFROM=(typeof PENSION_PORTFOLIO_FROM!=='undefined')?PENSION_PORTFOLIO_FROM:null;
    const RULES=(typeof PENSION_RULES!=='undefined'&&Array.isArray(PENSION_RULES))
      ? PENSION_RULES.map(r=>({from:r.from, mode:r.mode})) : null;
    const errors={}; const noteErr=(k,e)=>{ if(!errors[k]) errors[k]=String(e&&e.message||e).slice(0,200); };
    const tk=c=>({band:+c.band,num:String(c.num)});
    const label=c=>c.band+'조 '+c.num;
    /* 회차 ep 의 방식(C1) — null 이면 옛 방식(legacy). 규칙표가 없는 옛 페이지는 단일 상수(PENSION_PORTFOLIO_FROM·PENSION_MODE)로 */
    const modeFor=ep=>{
      if(has.pmf){ try{ return pensionModeFor(ep)||null; }catch(e){ noteErr('pensionModeFor',e); } }
      return (MODE && PFROM!=null && ep>=PFROM) ? MODE : null;
    };

    /* 분포 서명 — pensionDist 의 결과는 번호 «값»이 아니라 구조에만 달려 있다.
         ① 번호를 뒷자리부터 읽은 트라이의 모양 — 어느 장끼리 뒤 몇 자리를 공유하나(3~7등은 전부 «뒤 n자리 일치»)
         ② 같은 번호를 가진 장들의 조 구성(몇 장씩 같은 조인가 — 1·2등)   ③ 같은 번호의 장 수(보너스)
       추첨 W 는 000000~999999 균등이라, 트라이 각 갈래의 숫자를 서로 바꿔 붙이는 자리별 순열은 모든 장의
       «뒤 몇 자리 일치»를 그대로 보존하는 전단사다. 그래서 서명이 같으면 pensionDist 의 히스토그램이 같고,
       결과(EV·SD·pAny·표)가 비트 단위로 같다. 분산 5장(끝자리 모두 다름)·세트(한 번호 × 조 1~5)는 회차가
       바뀌어도 서명이 하나다. 실측(2026-09-23, 연금 100~333회): 분포 702번 중 실제 계산 73번(구 방식 71종 + 분산 1 + 세트 1),
       구조 점검 67초 → 8초.
       --no-dist-memo 로 돌리면 매 회차 다시 계산한다(이 가정의 대조 실험용 — 결과 JSON 이 같아야 한다). */
    const distSig=tks=>{
      const root={};
      for(const t of tks){ const s=String(t.num).padStart(6,'0'); let n=root;
        for(let i=5;i>=0;i--){ const d=s[i]; n=n[d]||(n[d]={}); }
        (n.$b||(n.$b=[])).push(+t.band); }
      const canon=(n,dep)=>{
        if(dep===6){ const c={}; n.$b.forEach(b=>{ c[b]=(c[b]||0)+1; }); return Object.values(c).sort((a,b)=>a-b).join('.'); }
        return '('+Object.keys(n).map(k=>canon(n[k],dep+1)).sort().join(',')+')';
      };
      return canon(root,0);
    };
    const DM={memo:!!DIST_MEMO, calls:0, calc:0, map:new Map()};
    /* 분포 — 페이지가 이미 준 것(r.dist)이 있으면 그걸, 아니면 서명 캐시, 없으면 pensionDist 로 계산.
       반환 {D, ms} — ms 는 실제로 계산했을 때만 0 보다 크다 */
    const distOf=(tks, given)=>{
      DM.calls++;
      const key=DM.memo?distSig(tks):null;
      if(given&&given.pAny!=null){ if(key&&!DM.map.has(key)) DM.map.set(key,given); return {D:given, ms:0}; }
      if(key&&DM.map.has(key)) return {D:DM.map.get(key), ms:0};
      if(!has.pd) return {D:null, ms:0};
      const q=performance.now(); const D=pensionDist(tks); const ms=performance.now()-q;
      DM.calc++; if(key) DM.map.set(key,D);
      return {D, ms};
    };

    /* 이번 주 추천 — pensionWeekly() 가 있으면 그 buy(5장), 없으면 옛 경로 상위 5 */
    const legacy10=generate(S.model,S.K,S.J,10,nx.ep*7919);
    let W=null;
    if(has.pw){ try{ W=pensionWeekly(); }catch(e){ noteErr('pensionWeekly',e); } }
    const picks=(W&&Array.isArray(W.picks)&&W.picks.length?W.picks:legacy10).map(tk);
    const buy=(W&&Array.isArray(W.buy)&&W.buy.length===5?W.buy:picks.slice(0,5)).map(tk);
    const mode=(W&&W.mode)||'legacy';
    const rule=(W&&W.rule)||(W&&W.buy?'portfolio':'legacy');
    /* 이번 주 방식이 규칙표(pensionModeFor)와 같은가 — pensionWeekly 의 게이팅 점검 */
    const weeklyMode={ ep:nx.ep, mode, table:modeFor(nx.ep)||'legacy' };
    weeklyMode.ok = weeklyMode.mode===weeklyMode.table;

    /* 등수별 금액·이론 기대값은 페이지의 RANKS 에서(Node 에 따로 적지 않는다) */
    const amt={}; RANKS.forEach(r=>{ amt[r.k]=r.amt; });
    const evTheory=5*RANKS.reduce((a,r)=>a+r.p*r.amt,0);

    /* pending 채점 — 결과가 나온 회차 전부, 페이지 gradeOf 로 */
    const byEp=new Map(rows.map(r=>[r.ep,r]));
    const graded={};
    for(const e of pend){
      const d=byEp.get(e.round); if(!d) continue;
      let ret=0;
      const result=e.picks.map(s=>{ const m=String(s).match(/^(\d)조 (\d{6})$/); if(!m) return {grade:0};
        const g=gradeOf(+m[1],m[2],d)||0; ret+=amt[g]||0; return {grade:g}; });
      graded[e.round]={date:d.date, result, return:ret};
    }

    /* 5장 구조 as-of 백테스트 */
    const modes=has.pp?['spread','set','legacy']:['legacy'];
    const st={}; modes.forEach(m=>st[m]={n:0,any:0,ret:0,retSq:0,grades:{},distN:0,pAny:0,EV:0,SD:0,
      distinctFail:0,distMs:0,distCalc:0});
    const repro=[];
    const saveRounds=DB.rounds, T0=performance.now();
    /* 5장만 필요하고 분포는 distOf 가 (서명 캐시로) 따로 구한다 → pensionPortfolio 에 noDist(C1).
       noDist 를 모르는 옛 페이지는 분포를 붙여 돌려주고, distOf 가 그걸 그대로 쓴다. */
    const PP_OPTS={noDist:true};
    const ppBuy=(m,seed)=>{
      try{ const r=pensionPortfolio(m,S,seed,PP_OPTS);
        if(r&&Array.isArray(r.buy)&&r.buy.length===5) return {buy:r.buy.map(tk), dist:r.dist||null}; }
      catch(e){ noteErr('pensionPortfolio.'+m,e); }
      return null;
    };
    /* 5회마다 DB 를 원래대로 돌려놓고 이벤트 루프에 한 번 양보한다(로또 루프의 tick 과 같은 이유 —
       분포를 매번 계산하던 때는 한 덩어리로 돌리면 렌더러가 1분 넘게 응답하지 않았다). */
    const tick=()=>new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>r();c.port2.postMessage(0);});
    try{
      for(let t=start;t<rows.length;t++){
        if(t>start && (t-start)%5===0){ DB.rounds=saveRounds; await tick(); }
        DB.rounds=rows.slice(0,t);
        const tgt=rows[t], seed=tgt.ep*7919;
        const sets={legacy:generate(S.model,S.K,S.J,10,seed).slice(0,5).map(tk)}, given={};
        if(has.pp){
          for(const m of ['spread','set']){
            const r=ppBuy(m,seed); if(r){ sets[m]=r.buy; if(r.dist) given[m]=r.dist; }
          }
        }
        for(const m of modes){
          const tks=sets[m]; if(!tks) continue;
          const o=st[m];
          const gs=tks.map(x=>gradeOf(x.band,x.num,tgt)||0);
          const r=gs.reduce((a,g)=>a+(amt[g]||0),0);
          o.n++; o.ret+=r; o.retSq+=r*r; if(gs.some(g=>g>0)) o.any++;
          gs.forEach(g=>{ if(g) o.grades[g]=(o.grades[g]||0)+1; });
          if(m==='spread' && new Set(tks.map(x=>x.num.slice(-1))).size!==5) o.distinctFail++;
          let D=null;
          try{ const x=distOf(tks, given[m]); D=x.D; if(x.ms>0){ o.distMs+=x.ms; o.distCalc++; } }
          catch(e){ noteErr('pensionDist',e); D=null; }
          if(D){ o.distN++; o.pAny+=D.pAny; o.EV+=D.EV; o.SD+=D.SD; }
        }
        /* 재현 점검 — 원장에 적힌 그 회차 5장을 «그 회차 방식»으로 다시 만들 수 있는가.
           방식 = 원장 행에 적힌 mode/rule(있으면) → 없으면 규칙표 pensionModeFor(ep) → 없으면 옛 방식.
           pensionWeekly() 는 DB 를 자른 상태에서 pensionPortfolio(pensionModeFor(ep), predSettings(), ep·7919) 이므로
           같은 S·같은 시드의 sets[방식] 과 같다(분포 계산만 뺀 것). */
        const lp=ledPicks[tgt.ep];
        if(lp){
          const rec=ledRules[tgt.ep]||{};
          const table=modeFor(tgt.ep)||'legacy';
          const recd=rec.rule==='legacy'?'legacy':(rec.mode&&rec.mode!=='legacy'?rec.mode:null);
          const rm=recd||table;
          if(rm!=='legacy' && !sets[rm] && has.pp){ const r=ppBuy(rm,seed); if(r) sets[rm]=r.buy; }
          const mine=(sets[rm]||[]).map(label);
          repro.push({ep:tgt.ep, rule:rm, table, recorded:recd, order:mine.length>0&&mine.join('|')===lp.join('|'),
                      set:mine.length>0&&mine.slice().sort().join('|')===lp.slice().sort().join('|')});
        }
      }
    } finally { DB.rounds=saveRounds; }
    const structMs=Math.round(performance.now()-T0);

    return { grid, rounds:rows.length, from:rows[start].ep, to:last.ep,
             settings:S, next:{ep:nx.ep,date:nx.date}, has, mode, rule, pensionMode:MODE, portfolioFrom:PFROM,
             pensionRules:RULES, weeklyMode,
             picks, buy, weeklyDist:(W&&W.dist)?{pAny:W.dist.pAny,EV:W.dist.EV,SD:W.dist.SD}:null,
             evTheory, amt, graded, errors,
             guard: gv ? gv.pension.rounds.map(r=>gv.pension.tickets.map(t=>gradeOf(t.band,t.num,r)).join('')).join('|') : null,
             structure:{from:rows[start].ep, to:last.ep, modes:st, repro, ms:structMs,
                        dist:{memo:DM.memo, calls:DM.calls, calc:DM.calc, unique:DM.map.size}},
             last:{ep:last.ep,date:last.date,band:last.band,num:last.num,bonus:last.bonus,cnt:last.cnt||{}} };
  }, {pend:ledger.pend('pension'), ledPicks:ledger.picksByRound('pension'), ledRules:ledger.rulesByRound('pension'),
      gv:gv||null, DIST_MEMO});
  await ctx.close();
  if(errs.length) out.pageErrors=errs.slice(0,5);
  return out;
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
/* 비율의 Wilson 95% 구간 — 0·1 근처에서도 뒤집히지 않는다 */
function wilson(x,n,z=1.96){
  if(!n) return null;
  const p=x/n, d=1+z*z/n, c=(p+z*z/(2*n))/d, h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Math.max(0,c-h), Math.min(1,c+h)];
}
/* 최소제곱 (절편 포함 설계행렬 X) — 계수·표준오차. 작은 k 라 가우스-조르단으로 충분 */
function ols(X, y){
  const n=X.length, k=X[0].length; if(n<=k) return null;
  const A=Array.from({length:k},()=>new Array(2*k).fill(0));
  for(let r=0;r<n;r++) for(let i=0;i<k;i++) for(let j=0;j<k;j++) A[i][j]+=X[r][i]*X[r][j];
  for(let i=0;i<k;i++) A[i][k+i]=1;
  for(let c=0;c<k;c++){
    let piv=c; for(let r=c+1;r<k;r++) if(Math.abs(A[r][c])>Math.abs(A[piv][c])) piv=r;
    if(Math.abs(A[piv][c])<1e-12) return null;
    [A[c],A[piv]]=[A[piv],A[c]];
    const d=A[c][c]; for(let j=0;j<2*k;j++) A[c][j]/=d;
    for(let r=0;r<k;r++) if(r!==c){ const f=A[r][c]; if(f) for(let j=0;j<2*k;j++) A[r][j]-=f*A[c][j]; }
  }
  const inv=A.map(r=>r.slice(k));
  const Xty=new Array(k).fill(0); for(let r=0;r<n;r++) for(let i=0;i<k;i++) Xty[i]+=X[r][i]*y[r];
  const beta=inv.map(row=>row.reduce((a,v,j)=>a+v*Xty[j],0));
  let sse=0; for(let r=0;r<n;r++){ const e=y[r]-X[r].reduce((a,v,j)=>a+v*beta[j],0); sse+=e*e; }
  const s2=sse/(n-k);
  return { beta, se:inv.map((row,i)=>Math.sqrt(Math.max(0,s2*row[i]))), n };
}
/* 확장창 walk-forward 로 OOS R² — i번째는 0..i-1 로만 적합한 계수로 예측 */
function wfR2(X, y, start=60){
  const pr=[], ys=[];
  for(let i=start;i<X.length;i++){
    const f=ols(X.slice(0,i), y.slice(0,i)); if(!f) continue;
    pr.push(X[i].reduce((a,v,j)=>a+v*f.beta[j],0)); ys.push(y[i]);
  }
  if(ys.length<2) return {r2:null, n:ys.length, pr, ys};
  const my=mean(ys), sst=ys.reduce((a,v)=>a+(v-my)**2,0);
  return { r2: sst?1-pr.reduce((a,v,i)=>a+(v-ys[i])**2,0)/sst:null, n:ys.length, pr, ys };
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
  if(ys.length<10) return {ready:false,n:ok.length};     // 작은 --window: OOS 예측이 없으면 R² 가 NaN 이 된다
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
/* 전주 겹침(carry) 을 더한 2변수 재보정 — rA ~ a + b·z + γ·carry (D1 §3).
   γ<0 이면 «직전 회차 번호가 섞인 조합은 나눠 갖는 인원이 적다»(사람들이 직전 번호를 피한다).
   당첨 확률과는 무관하다. 채택 게이트: 전체표본 t < −3 이고 walk-forward ΔR² > 0.
   후보 특징 3개를 시험했으므로 p 는 Bonferroni ×3 도 함께 낸다. */
function calibrate2(rows){
  const ok=rows.filter(r=>r.zTrue!=null&&r.rTrue!=null&&r.carryTrue!=null);
  if(ok.length<80) return {ready:false,n:ok.length};
  const y=ok.map(r=>r.rTrue);
  const X1=ok.map(r=>[1,r.zTrue]), X2=ok.map(r=>[1,r.zTrue,r.carryTrue]);
  const w1=wfR2(X1,y), w2=wfR2(X2,y), f=ols(X2,y);
  if(!f||w1.r2==null||w2.r2==null) return {ready:false,n:ok.length};
  const gamma=f.beta[2], se=f.se[2], t=se?gamma/se:0, p=2*normSf(Math.abs(t));
  const dR2=w2.r2-w1.r2;
  return { ready:true, n:ok.length, nOOS:w2.n, a:f.beta[0], b:f.beta[1], gamma, se, t, p,
           pBonf:Math.min(1,3*p), r2Base:w1.r2, r2:w2.r2, dR2, kappa:f.beta[1]?gamma/f.beta[1]:null,
           carryMean:mean(ok.map(r=>r.carryTrue)), adoptCarry: t<-3 && dR2>0 };
}
/* 등위별 기울기 — 실제 당첨자수/무작위 기대 를 z 에 회귀 (D1 §1 «tier slopes»).
   1~2등은 λ≈15·89 라 푸아송 잡음이 커서 회차별 OOS R² 는 ~0 이 정상이다. */
function tierSlopes(rows, calib){
  const ok=rows.filter(r=>r.zTrue!=null&&Array.isArray(r.rT));
  if(ok.length<80) return null;
  const X=ok.map(r=>[1,r.zTrue]), out={};
  [1,2,3].forEach((k,i)=>{
    const y=ok.map(r=>r.rT[i]), f=ols(X,y); if(!f) return;
    const w=wfR2(X,y);
    out['b'+k]={ a:f.beta[0], b:f.beta[1], se:f.se[1], t:f.se[1]?f.beta[1]/f.se[1]:null, r2oos:w.r2, n:ok.length };
  });
  { const y=ok.map(r=>r.rTrue), f=ols(X,y);
    if(f) out.b45={ a:f.beta[0], b:f.beta[1], se:f.se[1], t:f.se[1]?f.beta[1]/f.se[1]:null,
                    r2oos:calib&&calib.ready?calib.r2:null, n:ok.length }; }
  return out;
}
/* 판별에 필요한 표본 수 — 대응표본, 양측 5%, 검정력 80% */
function weeksNeeded(effect, sdDiff){
  if(!effect || !sdDiff || effect<=0) return null;
  return Math.ceil(Math.pow((1.96+0.8416)*sdDiff/effect, 2));   // 대응표본, 양측 5%, 검정력 80%
}

const C456_L=8145060;
const PROB_L={1:1/C456_L, 2:6/C456_L, 3:228/C456_L, 4:11115/C456_L, 5:182780/C456_L};

/* ── 6. 집계 ─────────────────────────────────────────────────── */
const SNAME={
  portfolio:'포트폴리오 (신규 기본)', portfolio_carry:'포트폴리오+전주회피 (그림자)',
  disjoint:'완전분산 (커버리지 대조군)', weekly_v1:'구 주간규칙',
  minshare:'분배 최소 5줄 (겹침 무시)', maxshare:'분배 최대 (양성 대조군)', random:'무작위 (음성 대조군)',
  hot:'최근 빈출', cold:'오래 미출현'};
const CTL=new Set(['random','maxshare','disjoint']);
function analyzeLotto(L, cal){
  const rows=L.rows, S=L.strats;
  const calib=cal&&cal.calib || calibrate(rows.filter(r=>r.zTrue!=null).map(r=>({z:r.zTrue,r:r.rTrue})));
  const calib2=cal&&cal.calib2 || calibrate2(rows);
  calib.tiers=tierSlopes(rows, calib);
  const CUR=S.includes('portfolio')?'portfolio':'weekly_v1';

  /* 주당 회수금의 이론 표준편차 — 관측 SD 는 1등이 한 번도 안 나와 과소평가된다.
     Var ≈ 5 × Σ_k p_k·a_k²  (p 가 매우 작아 평균² 항은 무시 가능) */
  const varPerWeek=mean(rows.filter(r=>r.a).map(r=>
    5*[1,2,3,4,5].reduce((a,k)=>a+PROB_L[k]*Math.pow(r.a[k-1]||0,2),0)));
  const sdWeek=Math.sqrt(varPerWeek);
  const chanceMean=mean(rows.map(r=>r.chance));
  const EV=L.ev||null;
  const evOf=(r,k,i)=>EV&&EV[r.R]&&EV[r.R][k]?EV[r.R][k][i]:null;

  const per={};
  const pAnyMean=k=>{ const v=rows.map(r=>r.s[k].pAny).filter(x=>x!=null); return v.length===rows.length?mean(v):null; };
  const pAnyR=S.includes('random')?pAnyMean('random'):null;
  const ev5R=(()=>{ const v=rows.map(r=>evOf(r,'random',0)).filter(x=>x!=null); return v.length?mean(v):null; })();
  for(const k of S){
    const gains=rows.map(r=>r.s[k].gain);
    const vsR=rows.map(r=>r.s[k].gain-r.s.random.gain);
    const ret=rows.map(r=>r.s[k].ret);
    const cnt={}; rows.forEach(r=>r.s[k].ranks.forEach(x=>cnt[x]=(cnt[x]||0)+1));
    const t=pairedTest(vsR);
    const payoutGain=calib.ready? mean(gains)*calib.b : null;
    const any=rows.map(r=>r.s[k].anyHit), anyN=any.reduce((a,b)=>a+b,0);
    const pAnyTheory=pAnyMean(k);
    const anyVs=k==='random'?null:pairedTest(rows.map(r=>r.s[k].anyHit-r.s.random.anyHit));
    const ev5=rows.map(r=>evOf(r,k,0)).filter(x=>x!=null);
    const ev5c=rows.map(r=>evOf(r,k,1)).filter(x=>x!=null);
    const ev5Model=ev5.length?mean(ev5):null;
    const us=rows.map(r=>r.s[k].u).filter(x=>x!=null);
    per[k]={
      name:SNAME[k]||k,
      zGain:mean(gains), zGainSD:sd(gains), vsRandom:t,
      payoutGain,
      spend:rows.length*5000, retTotal:ret.reduce((a,b)=>a+b,0), retMedian:median(ret),
      hitsPerGame:mean(rows.map(r=>r.s[k].hits/5)), ranks:cnt,
      weeksForZ: k==='random'?null:weeksNeeded(Math.abs(t.mean), t.sd),
      weeksForMoney: (payoutGain&&payoutGain>0)? weeksNeeded(payoutGain*chanceMean, sdWeek) : null,
      /* 5게임 구조(D1 §2·§5) */
      pAnyTheory, anyHits:anyN, anyHitRate:anyN/rows.length, anyHitCI:wilson(anyN,rows.length), anyVsRandom:anyVs,
      /* 커버리지 차이를 «당첨 주 비율»로 판별하는 데 필요한 주 — 이론 효과, 독립 근사 SD */
      weeksForAny: (k==='random'||pAnyTheory==null||pAnyR==null)?null:
        weeksNeeded(pAnyTheory-pAnyR, Math.sqrt(pAnyTheory*(1-pAnyTheory)+pAnyR*(1-pAnyR))),
      ev5Model, evVsRandomPct:(ev5Model!=null&&ev5R)?ev5Model/ev5R-1:null,
      ev5CarryModel: ev5c.length?mean(ev5c):null,
      fixedMean:mean(rows.map(r=>r.s[k].fixed)),
      u: us.length?mean(us):null, carry:mean(rows.map(r=>r.s[k].carry)),
      ovMax:Math.max(...rows.map(r=>r.s[k].ovMax)),
      degraded: rows.filter(r=>r.s[k].degraded).length
    };
  }

  /* D1 §7 수용 기준을 매주 다시 확인 — hard 실패는 CI 에 ::warning 으로 올린다.
     soft(참고) 는 설계상 경계에 걸릴 수 있는 기준이라 보드·JSON 에만 적는다:
       zGain — portfolio 는 zFloor 아래를 구별하지 않으므로(데이터 밖 ₩ 주장 금지) 원 z 이득이
               minshare 보다 작은 것이 설계다. 돈 기준은 ev5VsMinshare(hard)가 본다. */
  const checks={};
  const chk=(name,ok,value,want,soft)=>{ checks[name]={ok:ok==null?null:!!ok,value,want,...(soft?{soft:true}:{})}; };
  if(per.portfolio){
    const maxOv=(L.portfolio&&L.portfolio.maxOv!=null)?L.portfolio.maxOv:1;
    const bad=rows.filter(r=>r.s.portfolio.ovMax>maxOv||r.s.portfolio.degraded).length;
    chk('constraint', bad===0, `${rows.length-bad}/${rows.length}`, `모든 회차 A~E 쌍별 겹침 ≤${maxOv} · degraded 없음`);
    const bud=rows.filter(r=>r.s.portfolio.budgetOK!=null);
    chk('budget', bud.length?bud.every(r=>r.s.portfolio.budgetOK):null, `${bud.filter(r=>r.s.portfolio.budgetOK).length}/${bud.length}`, 'mean u ≤ max(u_stage1, u*+dz)');
    if(per.portfolio.pAnyTheory!=null){
      const w=rows.filter(r=>r.s.portfolio.pAny>r.s.minshare.pAny).length/rows.length;
      chk('pAnyBeatsMinshare', w>=0.95, (w*100).toFixed(1)+'% 회차', '≥ 95% 회차');
    }
    chk('zGain', per.portfolio.zGain>=per.minshare.zGain-0.30, +(per.portfolio.zGain-per.minshare.zGain).toFixed(4), '≥ −0.30 (vs minshare)', true);
    const rat=rows.map(r=>{ const a=evOf(r,'portfolio',0), b=evOf(r,'minshare',0); return a!=null&&b?a/b:null; }).filter(x=>x!=null);
    if(rat.length) chk('ev5VsMinshare', median(rat)>=0.993, +median(rat).toFixed(4), '중앙값 ≥ 0.993');
  }
  /* 게임당 일치 수 — 어떤 규칙도 번호를 예측하지 못하므로 기대값은 정확히 36/45=0.8.
     D1 은 «±0.05» 로 적었지만 300주에서 규칙 하나의 표준오차가 약 0.02 라 고정 폭은 너무 빡빡하다
     (규칙 9개 중 하나가 2.5σ 에 걸리는 일은 흔하다). 그래서 규칙 수로 Bonferroni 보정한
     양측 1% 검정(|t| < 3.26)으로 본다. 값에는 평균과 t 를 함께 적는다. */
  { const tcrit=3.26;
    const hp=S.map(k=>{ const v=rows.map(r=>r.s[k].hits/5), m=mean(v), se=sd(v)/Math.sqrt(v.length);
      return [k, m, se?(m-0.8)/se:0]; });
    chk('hitsPerGame', hp.every(x=>Math.abs(x[2])<tcrit),
        Object.fromEntries(hp.map(([k,m,t])=>[k,`${m.toFixed(3)} (t ${t.toFixed(1)})`])),
        '모든 규칙 0.8 과 구별 안 됨 (|t|<3.26, 규칙 수 Bonferroni)'); }
  const C=L.checks||{};
  if(C.cover5disjoint!=null) chk('cover5disjoint', C.cover5disjoint===966650, C.cover5disjoint, 966650);
  if(C.cover1!=null) chk('cover1', C.cover1===194130, C.cover1, 194130);
  if(C.buyPAnyApproxErr!=null) chk('pAnyApprox', C.buyPAnyApproxErr<=1e-4, (C.buyPAnyApproxErr*100).toFixed(5)+'pp', '≤ 0.01pp');
  if(C.lineEV1!=null) chk('lineEV1', Math.abs(C.lineEV1-500)<=0.05, +(+C.lineEV1).toFixed(3), '500.00 ± 0.05');
  /* 재현 — 그 회차 규칙(규칙표 portfolioOptsFor(R), 원장 행에 rule 이 있으면 그것)으로 사이트의 weeklyPicks() 를 다시 불러 대조 */
  if(L.repro&&L.repro.length){
    const rn=x=>x.rule==='portfolio'?'포트폴리오':'구 규칙';
    chk('repro', L.repro.every(x=>x.set), L.repro.map(x=>`${x.R}회 ${rn(x)} ${x.order?'일치':(x.set?'순서만 다름':'불일치')}`+
      (x.via==='pool'?' (보드 풀로)':'')+(x.recorded&&x.recorded!==x.table?' (기록 규칙≠규칙표)':'')).join(' · '),
      '원장 A~E 재현 (그 회차 규칙 · weeklyPicks)');
    /* 보드의 후보 풀이 사이트 추천 풀과 같은가 — 다르면 위 «포트폴리오» 행이 사이트 규칙을 재는 게 아니다 */
    const pc_=L.repro.filter(x=>x.pool!=null);
    if(pc_.length) chk('reproPool', pc_.every(x=>x.pool), `${pc_.filter(x=>x.pool).length}/${pc_.length}`, '보드 풀에 같은 규칙 → 원장 A~E');
  }
  if(L.weeklyRule) chk('weeklyRule', L.weeklyRule.ok, `${L.weeklyRule.round}회 ${L.weeklyRule.rule} (규칙표 ${L.weeklyRule.table})`, '이번 주 추천 규칙 = 규칙표');

  return { n:rows.length, from:L.from, to:L.latest, calib, calib2, per, cur:CUR,
           sdWeek, chanceMean, hitBaseline:6*6/45, checks };
}
function analyzePension(P){
  const g=P.grid.map(x=>({...x, corrP: Math.min(1, x.p*P.grid.length)}));
  const sig=g.filter(x=>x.p<0.05), sigC=g.filter(x=>x.corrP<0.05);
  const ctrl=g.filter(x=>x.model==='rand'&&x.p<0.05);
  /* 5장 구조 — 실측 «1장 이상 당첨» 비율 vs 이론, 평균 수령 vs 3,750 */
  const S=P.structure||{modes:{}}, structure={from:S.from, to:S.to, mode:P.pensionMode, rows:{}, ms:S.ms};
  for(const [m,o] of Object.entries(S.modes||{})){
    if(!o.n) continue;
    const pTh=o.distN?o.pAny/o.distN:null, sdTh=o.distN?o.SD/o.distN:null;
    const evTh=o.distN?o.EV/o.distN:P.evTheory;
    const rate=o.any/o.n, meanRet=o.ret/o.n;
    const z=pTh!=null?(rate-pTh)/Math.sqrt(pTh*(1-pTh)/o.n):null;
    structure.rows[m]={ n:o.n, anyHits:o.any, anyHitRate:rate, anyHitCI:wilson(o.any,o.n),
      pAnyTheory:pTh, z, within99: z==null?null:Math.abs(z)<2.576,
      meanRet, evTheory:evTh, sdTheory:sdTh,
      /* 평균 수령의 95% 구간은 이론 SD 로 — 표본 SD 는 1·2등이 안 나와 과소평가 */
      retCI: sdTh!=null?[meanRet-1.96*sdTh/Math.sqrt(o.n), meanRet+1.96*sdTh/Math.sqrt(o.n)]:null,
      grades:o.grades, distinctFail:o.distinctFail,
      /* 분포 1회 계산에 든 평균 시간 — 서명 캐시로 재사용한 회차는 빼고 «실제로 계산한 횟수»로 나눈다 */
      distMs:o.distCalc?Math.round(o.distMs/o.distCalc):null, distCalc:o.distCalc||0 };
  }
  structure.repro=S.repro||[];
  structure.dist=S.dist||null;
  structure.weeklyMode=P.weeklyMode||null;
  return { grid:g, tested:g.length, sig:sig.length, sigCorrected:sigC.length,
           expectedByChance:+(g.length*0.05).toFixed(1), controlSig:ctrl.length,
           rounds:P.rounds, from:P.from, to:P.to, evTheory:P.evTheory, structure };
}

/* ── 7. 추천 원장 ─────────────────────────────────────────────────
   CI 는 내가 실제로 무엇을 샀는지 모른다. 이 원장은 «그 주 추천 5+5 를 샀다면» 의 기록이다.
   추천이 회차 시드로 결정되므로 그 회차 추천을 자동 기록한다.
   [2026-09 PLAN §1.6]
     · 현재 대상 회차가 pending 이면 picks 를 현재 추천으로 갱신한다(알고리즘 변경 반영).
     · done 회차는 절대 건드리지 않는다.
     · 채점은 «마지막 회차»만이 아니라 결과가 알려진 모든 pending 회차(CI 가 한 주를 건너뛰어도).
       채점은 페이지의 rankOf/gradeOf 로(readLotto/readPension 안), Node 쪽 사다리는 교차 점검·예비용.
     · 새 필드(rule, mode)는 추가만 — 기존 필드는 그대로(하위호환).
     · [C1] rule/mode 는 «그 회차에 쓴 규칙»의 기록이다. 재현 점검(readLotto/readPension)은 이 값을 존중해 다시 만든다.
       pending 행은 추첨 전이라 현재 규칙표가 그 회차에 주는 규칙으로 picks·rule·mode 를 함께 덮어쓴다(PLAN §1.6). */
function ledgerIndex(prev){
  const rounds=prev && Array.isArray(prev.rounds) ? prev.rounds : [];
  return {
    rounds,
    pend:kind=>rounds.filter(r=>r.kind===kind&&r.status==='pending'&&Array.isArray(r.picks))
                     .map(r=>({round:r.round, picks:r.picks})),
    picksByRound:kind=>Object.fromEntries(rounds.filter(r=>r.kind===kind&&Array.isArray(r.picks)).map(r=>[r.round,r.picks])),
    /* 그 회차에 기록된 규칙 — 재현할 때 존중한다(없으면 undefined → 규칙표대로). 옛 행에는 없다. */
    rulesByRound:kind=>Object.fromEntries(rounds.filter(r=>r.kind===kind&&Array.isArray(r.picks))
                                                .map(r=>[r.round,{rule:r.rule||null, mode:r.mode||null}]))
  };
}
/* Node 예비 채점 — 페이지 채점이 없을 때만 쓰고, 둘 다 있으면 서로 대조한다 */
function nodeGradeLotto(picks, raw){
  const d={n:[raw.tm1WnNo,raw.tm2WnNo,raw.tm3WnNo,raw.tm4WnNo,raw.tm5WnNo,raw.tm6WnNo].map(Number), b:+raw.bnsWnNo,
           a:[raw.rnk1WnAmt,raw.rnk2WnAmt,raw.rnk3WnAmt,raw.rnk4WnAmt,raw.rnk5WnAmt].map(Number)};
  let ret=0;
  const result=picks.map(s=>{ const c=s.split(',').map(Number);
    const hit=c.filter(n=>d.n.includes(n)).length, bo=c.includes(d.b);
    let g=0; if(hit===6)g=1; else if(hit===5&&bo)g=2; else if(hit===5)g=3; else if(hit===4)g=4; else if(hit===3)g=5;
    if(g) ret+=d.a[g-1]||0;
    return {hit,bonus:bo,grade:g}; });
  return {date:String(raw.ltRflYmd), result, return:ret};
}
function nodeGradePension(picks, d, AMT){
  let ret=0;
  const result=picks.map(s=>{ const m=s.match(/^(\d)조 (\d{6})$/); if(!m) return {grade:0};
    const band=+m[1], num=m[2]; let g=0;
    if(num===d.num) g = band===d.band?1:2;
    else if(num===d.bonus) g=8;
    else for(let n=5;n>=1;n--) if(num.slice(6-n)===d.num.slice(6-n)){ g=8-n; break; }
    if(g) ret+=AMT[g]||0;
    return {grade:g}; });
  return {date:d.date, result, return:ret};
}
function mergePurchases(prev, L, P, cfg, raw){
  const led = prev && Array.isArray(prev.rounds) ? prev.rounds.map(r=>({...r})) : [];
  const byKey = new Map(led.map(r=>[r.kind+':'+r.round, r]));
  const log=[];
  const upsertPending=(kind,round,date,picks,extra)=>{
    const key=kind+':'+round, cur=byKey.get(key);
    if(cur){
      if(cur.status!=='pending') return cur;                 // done 은 불변
      const changed=JSON.stringify(cur.picks)!==JSON.stringify(picks);
      Object.assign(cur, {picks, spend:picks.length*1000, ...extra});
      if(cur.date==null && date!=null) cur.date=date;
      if(changed) log.push(`${kind} ${round}회 pending 추천 갱신`);
      return cur;
    }
    const r={kind,round,date,picks,spend:picks.length*1000,status:'pending',...extra};
    byKey.set(key,r); led.push(r); return r;
  };
  // 이번 주(아직 추첨 전) — 현재 추천으로
  upsertPending('lotto', L.target, null, L.buy.slice(0,cfg.lottoGames).map(c=>c.join(',')), {rule:L.rule});
  upsertPending('pension', P.next.ep, P.next.date, P.buy.slice(0,cfg.pensionTickets).map(c=>c.band+'조 '+c.num),
                {rule:P.rule, mode:P.mode});
  // 채점 — 결과가 알려진 모든 pending
  const AMT=Object.keys(P.amt||{}).length?P.amt:{1:1_680_000_000,2:120_000_000,3:1_000_000,4:100_000,5:50_000,6:5_000,7:1_000,8:120_000_000};
  const lRaw=new Map((raw.lotto.rows||[]).map(x=>[+x.ltEpsd,x]));
  const pRaw=new Map((raw.pension||[]).map(x=>[x.ep,x]));
  const same=(a,b)=>JSON.stringify(a.result)===JSON.stringify(b.result)&&a.return===b.return;
  for(const r of led){
    if(r.status!=='pending') continue;
    let g=null, n=null;
    if(r.kind==='lotto'){
      g=L.graded&&L.graded[r.round];
      if(lRaw.has(r.round)) n=nodeGradeLotto(r.picks, lRaw.get(r.round));
    } else if(r.kind==='pension'){
      g=P.graded&&P.graded[r.round];
      if(pRaw.has(r.round)) n=nodeGradePension(r.picks, pRaw.get(r.round), AMT);
    }
    if(g&&n&&!same(g,n)) console.log(`::warning title=원장 채점 불일치::${r.kind} ${r.round}회 — 페이지 채점과 Node 사다리가 다릅니다. 페이지 값을 씁니다.`);
    const use=g||n;
    if(!use) continue;
    r.status='done'; r.date=use.date; r.result=use.result; r.return=use.return;
    log.push(`${r.kind} ${r.round}회 채점(${g?'페이지':'Node 예비'}) → ${use.return.toLocaleString('ko-KR')}원`);
  }
  led.sort((a,b)=> a.kind===b.kind ? a.round-b.round : (a.kind<b.kind?-1:1));
  return { v:1, updated:new Date().toISOString(), config:cfg, rounds:led, _log:log };
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
const pc=(x,d=2)=>x==null||isNaN(x)?'—':(x*100).toFixed(d)+'%';
const sgn=(x,d=3)=>x==null||isNaN(x)?'—':(x>=0?'+':'')+x.toFixed(d);
const dS=s=>s?`${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`:'—';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
function bigWeeks(w){
  if(w==null) return '—';
  if(w<520) return fmtN(w)+'주';
  const y=w/52;
  if(y<10000) return fmtN(y)+'년';
  return (y/1e4).toFixed(y<1e6?1:0)+'만 년';
}
function pTag(p){ return p==null?'—':p<0.001?'<span class="tg s">p&lt;0.001</span>'
  : p<0.05?`<span class="tg s">p=${p.toFixed(3)}</span>`
  : `<span class="tg n">p=${p.toFixed(3)}</span>`; }
const ciTxt=(ci,f=pc,d=1)=>ci?`[${f(ci[0],d)}, ${f(ci[1],d)}]`:'—';

/* 공유 디자인(site.css + gnav) — scripts/site-shared.mjs 가 있으면 그걸 인라인하고,
   없으면(구 체크아웃·파일 누락) 아래 최소 토큰으로 대신한다. 보드는 스스로 완결된 한 파일이어야 한다. */
const FALLBACK_CSS=`
:root{--paper:#EEF0EB;--paper-2:#F7F8F5;--paper-3:#E4E7E0;--ink:#16302B;--ink-60:rgba(22,48,43,.60);--ink-40:rgba(22,48,43,.40);
--ink-30:rgba(22,48,43,.30);--ink-12:rgba(22,48,43,.12);--ink-06:rgba(22,48,43,.06);--sig:#B0281A;--ok:#1F6F4A;--gutter:16px;
--nav-h:58px;--maxw:940px;--f-mono:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
--f-body:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;color-scheme:light}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#12181A;--paper-2:#182022;--paper-3:#1F2A2C;--ink:#E6EDE9;
--ink-60:rgba(230,237,233,.62);--ink-40:rgba(230,237,233,.40);--ink-30:rgba(230,237,233,.28);--ink-12:rgba(230,237,233,.14);
--ink-06:rgba(230,237,233,.06);--sig:#FF8A78;--ok:#7FD8A8;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#12181A;--paper-2:#182022;--paper-3:#1F2A2C;--ink:#E6EDE9;--ink-60:rgba(230,237,233,.62);
--ink-40:rgba(230,237,233,.40);--ink-30:rgba(230,237,233,.28);--ink-12:rgba(230,237,233,.14);--ink-06:rgba(230,237,233,.06);
--sig:#FF8A78;--ok:#7FD8A8;color-scheme:dark}
html,body{overflow-x:clip}
body{background:var(--paper);color:var(--ink);padding-bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 24px)}
.wrap{padding-left:var(--gutter)!important;padding-right:var(--gutter)!important}
.gnav{position:fixed;inset:auto 0 0 0;z-index:50;display:grid;grid-template-columns:repeat(5,1fr);
height:calc(var(--nav-h) + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--paper-2);border-top:1.5px solid var(--ink)}
.gnav a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:44px;
font:700 12px/1.2 var(--f-body);color:var(--ink-60);text-decoration:none}
.gnav a[aria-current="page"]{color:var(--ink);box-shadow:inset 0 3px 0 var(--ink)}
.theme-btn{font:700 11px var(--f-mono);color:var(--ink-60);background:none;border:1px solid var(--ink-30);padding:4px 9px;cursor:pointer;border-radius:2px}
@media(min-width:720px){body{padding-bottom:70px}
.gnav{position:static;display:flex;justify-content:flex-end;gap:2px;height:auto;max-width:var(--maxw);margin:0 auto;
padding:6px var(--gutter);background:none;border:0;border-bottom:1px solid var(--ink-12)}
.gnav a{flex-direction:row;gap:6px;padding:6px 10px;min-height:36px}
.gnav a[aria-current="page"]{box-shadow:inset 0 -3px 0 var(--ink)}}
@media print{.gnav,.no-print{display:none!important}body{padding-bottom:0}}`;
const FALLBACK_GNAV=active=>'<nav class="gnav" aria-label="사이트">'+
  [['brief','이번 주'],['index','로또'],['pension','연금'],['validate','검증'],['record','기록']]
  .map(([f,l])=>`<a href="./${f}.html"${f===active?' aria-current="page"':''}><span>${l}</span></a>`).join('')+'</nav>';
async function loadShared(root){
  try{
    const m=await import(new URL('./site-shared.mjs', import.meta.url).href);
    const css=m.siteCSS(root), nav=m.gnav('validate','./');
    if(!css||!nav) throw new Error('빈 출력');
    return {css, nav, foot:m.FOOT||null, src:'site-shared'};
  }catch(e){
    console.error('      공유 디자인(site-shared.mjs/site.css) 없음 — 내장 최소 토큰 사용: '+e.message);
    return {css:FALLBACK_CSS, nav:FALLBACK_GNAV('validate'), foot:null, src:'fallback'};
  }
}

/* 추천 원장 누적 그래프 — 투입(계단, 점선) vs 회수(계단, 실선). 한 축(원), 이중축 없음.
   SVG 는 비율 무시(preserveAspectRatio=none)로 폭을 채우고 선 굵기는 non-scaling-stroke,
   글자는 HTML 로 얹어 폰에서도 작아지지 않게 한다. */
function cumChart(led){
  const done=led.rounds.filter(r=>r.status==='done'&&r.date)
    .slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))||(a.kind<b.kind?-1:1));
  if(done.length<2) return `<p class="note">채점된 회차가 2건 이상 쌓이면 누적 그래프가 그려집니다(지금 ${done.length}건).</p>`;
  let cs=0, cr=0;
  const pts=done.map(r=>{ cs+=r.spend; cr+=(r.return||0); return {r, cs, cr}; });
  const top=Math.max(cs, cr);
  const step=Math.pow(10,Math.floor(Math.log10(top))), niceMax=Math.ceil(top*1.08/step)*step;
  const n=pts.length, X=i=>+(i/n*100).toFixed(3), Y=v=>+(100-v/niceMax*100).toFixed(3);
  const path=key=>{ let d=`M0,100`; pts.forEach((p,i)=>{ d+=` H${X(i)} V${Y(p[key])}`; }); return d+' H100'; };
  const hits=pts.map((p,i)=>`<rect class="hit" x="${X(i)}" y="0" width="${+(100/n).toFixed(3)}" height="100"><title>${dS(p.r.date)} ${p.r.kind==='lotto'?'로또':'연금'} ${p.r.round}회 · 이번 ${fmtN(p.r.return||0)}원 · 누적 투입 ${fmtN(p.cs)}원 · 누적 회수 ${fmtN(p.cr)}원</title></rect>`).join('');
  const grid=[0,0.5,1].map(f=>`<line class="gl" x1="0" x2="100" y1="${Y(niceMax*f)}" y2="${Y(niceMax*f)}" vector-effect="non-scaling-stroke"/>`).join('');
  const yl=[0,0.5,1].map(f=>`<span class="yl" style="top:${Y(niceMax*f)}%">${fmtN(niceMax*f)}</span>`).join('');
  const last=pts[n-1];
  return `<figure class="cum">
<div class="legend"><span><i class="rt"></i>누적 회수 <b>${fmtN(last.cr)}원</b></span><span><i class="sp"></i>누적 투입 <b>${fmtN(last.cs)}원</b></span></div>
<div class="plot">${yl}
<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="추천 원장 누적 투입 ${fmtN(last.cs)}원, 누적 회수 ${fmtN(last.cr)}원 (${n}건)">
${grid}<path class="sp" d="${path('cs')}" vector-effect="non-scaling-stroke"/><path class="rt" d="${path('cr')}" vector-effect="non-scaling-stroke"/>${hits}</svg></div>
<div class="xl"><span>${dS(pts[0].r.date)}</span><span>${dS(last.r.date)}</span></div>
<figcaption>채점된 ${n}건(로또·연금 추첨일 순, 5,000원씩). 그래프를 짚거나 마우스를 올리면 그 회차 값이 나옵니다. 아래 «최근 기록» 표가 같은 자료입니다.</figcaption>
</figure>`;
}

function buildBoard(A, PA, led, tot, meta, shared){
const css=`
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f-body);font-size:15px;line-height:1.68;letter-spacing:-.01em}
.wrap{max-width:var(--maxw);margin:0 auto;padding-top:18px}
header{border-bottom:1.5px solid var(--ink);padding-bottom:12px;margin-bottom:20px}
.eb{font-family:var(--f-mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-60);
display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.eb a{color:var(--ink-60)}
h1{font-size:clamp(28px,6.5vw,42px);line-height:1.08;font-weight:800;padding:12px 0 4px;letter-spacing:-.02em}
h1 small{display:block;font-size:.34em;font-weight:600;color:var(--ink-60);padding-top:8px;letter-spacing:.02em}
h2{font-family:var(--f-mono);font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
padding:0 0 12px;display:flex;align-items:center;gap:10px;margin-top:36px}
h2::after{content:"";flex:1;height:1px;background:var(--ink-12)}
h3{font-size:14px;font-weight:700;padding:16px 0 8px;color:var(--ink-60)}
p.note{font-size:13.5px;color:var(--ink-60);padding-bottom:12px;line-height:1.72}
p.note b{color:var(--ink)}
p.note a,.vd a{color:var(--ink);text-underline-offset:2px}
.card{background:var(--paper-2);border:1.5px solid var(--ink);padding:16px 15px;margin-bottom:12px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--ink-12);
border:1.5px solid var(--ink);margin-bottom:16px}
.kpi>div{background:var(--paper-2);padding:12px 11px;min-width:0}
.kpi .k{font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60)}
.kpi .v{font-size:26px;font-weight:800;line-height:1.14;padding-top:3px;letter-spacing:-.02em;overflow-wrap:anywhere}
.kpi .s{font-size:12px;color:var(--ink-60)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:8px 6px;text-align:left;border-bottom:1px solid var(--ink-12);vertical-align:middle}
th{font-family:var(--f-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60)}
td.num,th.num{text-align:right;font-family:var(--f-mono);white-space:nowrap}
tr.me td{background:var(--ink-06);font-weight:600}
tr.ctl td{color:var(--ink-60)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table.wide{min-width:600px}
table.wide td:first-child,table.wide th:first-child{min-width:128px}
table.led{min-width:540px}
table.led td:first-child,table.led th:first-child{min-width:0}
@media(max-width:480px){.kpi>div:last-child:nth-child(odd){grid-column:1/-1}}
.tg{font-family:var(--f-mono);font-size:10px;padding:2px 6px;border:1px solid currentColor;white-space:nowrap}
.tg.s{color:var(--sig)}.tg.n{color:var(--ink-40)}.tg.o{color:var(--ok)}
.vd{border-left:3px solid var(--ink);padding:10px 0 10px 12px;margin:12px 0;font-size:13.5px;color:var(--ink-60)}
.vd b{color:var(--ink)}.vd.ok{border-color:var(--ok)}.vd.sig{border-color:var(--sig)}
.cum{margin:6px 0 4px}
.cum .legend{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-60);padding:0 0 10px}
.cum .legend b{color:var(--ink)}
.cum .legend i{display:inline-block;width:20px;height:0;vertical-align:middle;margin-right:6px}
.cum .legend i.rt{border-top:2px solid var(--ink)}
.cum .legend i.sp{border-top:2px dashed var(--ink-40)}
.cum .plot{position:relative;height:170px;margin-left:56px}
.cum svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cum .gl{stroke:var(--ink-12);stroke-width:1}
.cum .sp{fill:none;stroke:var(--ink-40);stroke-width:2;stroke-dasharray:5 4}
.cum .rt{fill:none;stroke:var(--ink);stroke-width:2}
.cum .hit{fill:transparent}
.cum .hit:hover{fill:var(--ink-06)}
.cum .yl{position:absolute;left:-56px;width:50px;text-align:right;transform:translateY(-50%);
font:11px/1 var(--f-mono);color:var(--ink-60)}
.cum .xl{display:flex;justify-content:space-between;margin-left:56px;padding-top:6px;font:11px var(--f-mono);color:var(--ink-60)}
.cum figcaption{font-size:12px;color:var(--ink-40);padding-top:8px}
.cks{margin-top:10px;font-size:13px}
.cks summary{cursor:pointer;color:var(--ink-60);font-weight:700;padding:6px 0;min-height:32px}
.cks summary b{color:var(--sig)}
.cks td.ck{font-size:12px;color:var(--ink-60);min-width:180px}
.cks td.ck small{color:var(--ink-40)}
td small{font-size:11px;color:var(--ink-40)}
.foot{font-size:12px;color:var(--ink-40);border-top:1px solid var(--ink-12);margin-top:32px;padding-top:14px;line-height:1.8}
@media print{body{background:#fff;padding:0}.card{break-inside:avoid}}`;

const P=A.per, cal=A.calib, c2=A.calib2||{ready:false}, CUR=A.cur, cur=P[CUR];
const has=k=>A.strats.includes(k);
const stratRows=A.strats.map(k=>{
  const s=P[k], me=k===CUR, ctl=CTL.has(k);
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

const structRows=A.strats.map(k=>{
  const s=P[k], me=k===CUR, ctl=CTL.has(k);
  return `<tr class="${me?'me':(ctl?'ctl':'')}">
    <td>${s.name}</td>
    <td class="num">${pc(s.pAnyTheory,2)}</td>
    <td class="num">${pc(s.anyHitRate,1)} <small>${ciTxt(s.anyHitCI)}</small></td>
    <td class="num">${k==='random'?'기준':pTag(s.anyVsRandom&&s.anyVsRandom.p)}</td>
    <td class="num">${k==='random'?'—':bigWeeks(s.weeksForAny)}</td>
    <td class="num">${s.ev5Model==null?'—':fmtN(s.ev5Model)+'원'}</td>
    <td class="num">${k==='random'?'기준':(s.evVsRandomPct==null?'—':sgn(s.evVsRandomPct*100,1)+'%')}</td>
    <td class="num">${s.carry.toFixed(2)}</td>
  </tr>`;}).join('');
const anyStruct=A.strats.some(k=>P[k].pAnyTheory!=null||P[k].ev5Model!=null);
const pR=P.random;
const CKN={constraint:'A~E 쌍별 겹침 · 완화 없음',budget:'EV 예산 (평균 u ≤ 상한)',pAnyBeatsMinshare:'P(1게임↑) > 분배 최소 5줄',
  zGain:'원 z 이득 손실 (참고)',ev5VsMinshare:'EV/5,000원 ÷ 분배 최소 5줄',hitsPerGame:'게임당 일치 = 0.8',
  cover5disjoint:'정확 계산 · 완전분산 5줄',cover1:'정확 계산 · 1줄',pAnyApprox:'근사 오차 (이번 주 A~E)',
  lineEV1:'₩ 공식 · 평균 인기 1줄 = 500원',repro:'원장의 A~E 재현 (그 회차 규칙)',reproPool:'검증 풀 = 사이트 추천 풀',
  weeklyRule:'이번 주 규칙 = 규칙표',recordGrader:'기록 페이지 채점기 = 원본'};
const ckVal=v=>v==null?'—':(typeof v==='object'?Object.entries(v).map(([k,x])=>`${SNAME[k]?SNAME[k].replace(/ \(.*\)$/,''):k} ${x}`).join(' · '):String(v));
const ckList=Object.entries(A.checks||{});
const ckPass=ckList.filter(([,c])=>c.ok===true).length, ckHardFail=ckList.filter(([,c])=>c.ok===false&&!c.soft).length;
const checkRows=ckList.map(([k,c])=>`<tr><td>${CKN[k]||k}</td>
  <td class="num">${c.ok==null?'—':c.ok?'<span class="tg o">통과</span>':(c.soft?'<span class="tg n">참고</span>':'<span class="tg s">실패</span>')}</td>
  <td class="ck">${esc(ckVal(c.value))}<br><small>기준 ${esc(c.want)}</small></td></tr>`).join('');

const tiers=cal.tiers||{};
const tierRow=(lab,t)=>t?`<tr><td>${lab}</td><td class="num">${sgn(t.b,3)}</td><td class="num">${t.se.toFixed(3)}</td>
  <td class="num">${t.t==null?'—':t.t.toFixed(1)}</td><td class="num">${t.r2oos==null?'—':t.r2oos.toFixed(3)}</td></tr>`:'';

const powerRows=A.strats.filter(k=>k!=='random').map(k=>{
  const s=P[k];
  return `<tr class="${k===CUR?'me':''}"><td>${s.name}</td>
    <td class="num">${bigWeeks(s.weeksForZ)}</td>
    <td class="num">${bigWeeks(s.weeksForMoney)}</td></tr>`;}).join('');

const penRows=PA.grid.slice().sort((a,b)=>a.p-b.p).slice(0,8).map(x=>
  `<tr class="${x.model==='rand'?'ctl':''}"><td>${({freq:'빈도',cold:'역빈도',recent:'최근가중',gap:'갭',rand:'무작위(대조군)'})[x.model]}</td>
   <td class="num">상위 ${x.K}</td><td class="num">${pc(x.rate)}</td><td class="num">${pc(x.base,0)}</td>
   <td class="num">${pTag(x.p)}</td><td class="num">${x.corrP>=0.999?'1.000':x.corrP.toFixed(3)}</td></tr>`).join('');

const PS=PA.structure||{rows:{}}, PSN={spread:'분산 5장 (끝자리 모두 다름)',set:'세트 1세트 (같은 번호 × 1~5조)',legacy:'구 방식 (모델 상위 5장)'};
const psRows=['spread','set','legacy'].filter(m=>PS.rows[m]).map(m=>{
  const s=PS.rows[m], me=m===(PS.mode||'legacy');
  return `<tr class="${me?'me':''}"><td>${PSN[m]}</td>
    <td class="num">${pc(s.pAnyTheory,2)}</td>
    <td class="num">${pc(s.anyHitRate,1)} <small>${ciTxt(s.anyHitCI)}</small></td>
    <td class="num">${s.within99==null?'—':(s.within99?'<span class="tg o">이론과 일치</span>':'<span class="tg s">벗어남</span>')}</td>
    <td class="num">${fmtN(s.meanRet)}원</td>
    <td class="num">${s.retCI?`[${fmtN(s.retCI[0])}, ${fmtN(s.retCI[1])}]`:'—'}</td>
    <td class="num">${s.n}</td></tr>`;}).join('');
const sp=PS.rows.spread;

const RULE={portfolio:'포트폴리오',legacy:'구 규칙'}, MODE={spread:'분산',set:'세트',legacy:'구 방식'};
const ledRows=led.rounds.slice().sort((a,b)=>String(b.date||'99999999').localeCompare(String(a.date||'99999999'))||b.round-a.round).slice(0,24).map(r=>{
  const hit=(r.result||[]).filter(x=>x.grade).length;
  const how=r.kind==='lotto'?(RULE[r.rule]||'구 규칙'):(MODE[r.mode]||'구 방식');
  return `<tr><td>${r.kind==='lotto'?'로또':'연금'}</td><td class="num">${r.round}회</td>
    <td>${how}</td><td class="num">${dS(r.date)}</td><td class="num">${fmtN(r.spend)}</td>
    <td class="num">${r.status==='pending'?'<span class="tg n">추첨 대기</span>':fmtN(r.return)}</td>
    <td class="num">${r.status==='pending'?'—':(hit?hit+(r.kind==='lotto'?'게임':'장')+' 당첨':'—')}</td></tr>`;}).join('');

const allSpend=tot.lotto.spend+tot.pension.spend, allRet=tot.lotto.ret+tot.pension.ret;
const themeJS=`(function(){var b=document.getElementById('themeBtn');if(!b)return;
var K='lottolab.theme',S=['system','light','dark'],L={system:'시스템',light:'라이트',dark:'다크'};
function g(){try{var t=localStorage.getItem(K);return t==='light'||t==='dark'?t:'system'}catch(e){return 'system'}}
function a(t){var r=document.documentElement;if(t==='light'||t==='dark')r.dataset.theme=t;else delete r.dataset.theme}
function p(){var t=g();b.textContent='테마 · '+L[t];b.setAttribute('aria-label','테마: '+L[t]+' · 눌러서 전환')}
p();b.addEventListener('click',function(){var n=S[(S.indexOf(g())+1)%3];try{if(n==='system')localStorage.removeItem(K);else localStorage.setItem(K,n)}catch(e){}a(n);p()})})();`;

return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<script>try{var t=localStorage.getItem('lottolab.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#16302B">
<title>로직 검증 보드 · ${meta.date}</title>
<link rel="icon" href="./icon.svg" type="image/svg+xml"><link rel="manifest" href="./manifest.webmanifest">
<style>${shared.css}
${css}</style></head><body>
${shared.nav}
<div class="wrap">
<header><div class="eb"><span>검증 · Logic Validation Board</span>
<button class="theme-btn" id="themeBtn" type="button">테마</button></div>
<h1>로직 검증 보드<small>${meta.date} 자동 갱신 · 로또 ${A.from}~${A.to}회 ${A.n}주 · 연금 ${PA.from}~${PA.to}회</small></h1></header>

<div class="vd"><b>이 보드가 답하는 질문 하나.</b> 「우리가 쓰는 규칙이 우연과 구별되는가」.
당첨 결과로는 영원히 답할 수 없어서(1등 1/8,145,060) <b>세 층으로 나눠</b> 잽니다 —
모델이 맞는가 / 우리가 고른 조합이 실제로 덜 인기있는가 / 그래서 돈이 됐는가.
앞의 둘은 매주 표본이 쌓이고, 마지막은 쌓이지 않습니다. <b>어떤 규칙도 당첨 확률을 바꾸지 않습니다.</b></div>

<div class="kpi">
  <div><div class="k">추천 원장 누적</div><div class="v">${tot.lotto.weeks+tot.pension.weeks}<span style="font-size:15px;color:var(--ink-60)">건</span></div>
    <div class="s">추천 5+5를 매주 샀다면 · 투입 ${fmtN(allSpend)}원</div></div>
  <div><div class="k">추천 원장 회수</div><div class="v">${fmtN(allRet)}<span style="font-size:15px">원</span></div>
    <div class="s">추천 5+5를 매주 샀다면 · ${allSpend?pc(allRet/allSpend,1):'—'}</div></div>
  <div><div class="k">모델 설명력 R²</div><div class="v">${cal.ready?cal.r2.toFixed(3):'—'}</div>
    <div class="s">순진예측 대비 오차 ${cal.ready?pc(1-cal.mae/cal.maeNaive,0):'—'} 감소</div></div>
  <div><div class="k">현행 규칙 효과</div><div class="v">${cur.payoutGain==null?'—':sgn(cur.payoutGain*100,1)+'%'}</div>
    <div class="s">${esc(cur.name)} · 기대 수령액 기준</div></div>
  <div><div class="k">돈으로 판별하려면</div><div class="v" style="font-size:20px">${bigWeeks(cur.weeksForMoney)}</div>
    <div class="s">z 이득으로는 ${bigWeeks(cur.weeksForZ)}</div></div>
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
  : `표본 ${cal.n}개로는 아직 판정할 수 없습니다(70개 이상 필요).`}</div>
${tiers.b1?`<h3>등위별 기울기 — 1~3등도 같은 방향인가</h3>
<p class="note">회차별 «실제 당첨자 수 ÷ 무작위라면 기대 인원»을 당첨 조합의 z 에 회귀했습니다. 기울기가 양수면 인기 있는 조합일수록
그 등위를 나눠 갖는 사람이 많다는 뜻입니다. ₩ 모형은 4·5등 기울기를 모든 등위에 쓰므로, 1~3등 기울기가 더 크면 그 모형은 <b>보수적</b>입니다.
1·2등은 회차당 당첨자가 적어(무작위 기대 약 15명·90명) 회차별 OOS R² 가 0 근처인 것이 정상입니다.</p>
<div class="scroll"><table>
<tr><th>등위</th><th class="num">기울기</th><th class="num">표준오차</th><th class="num">t</th><th class="num">OOS R²</th></tr>
${tierRow('1등',tiers.b1)}${tierRow('2등',tiers.b2)}${tierRow('3등',tiers.b3)}${tierRow('4·5등 (모형 기준)',tiers.b45)}
</table></div>`:''}
${c2.ready?`<h3>전주 번호 겹침 — 그림자 규칙</h3>
<p class="note">직전 회차 당첨번호와 겹치는 개수(전주 겹침)를 모델에 더해 보았습니다. 계수 γ 가 음수면 <b>사람들이 직전 번호를 피한다</b> —
직전 번호가 섞인 조합은 당첨 시 <b>나눠 갖는 인원이 조금 적다</b>는 뜻입니다. 당첨 확률과는 무관합니다.
사이트의 추천은 아직 이 규칙을 쓰지 않고(포트폴리오+전주회피 행으로만 잽니다), 아래 게이트가 계속 통과하면 운영자가 켤지 정합니다.</p>
<div class="scroll"><table>
<tr><th>지표</th><th class="num">값</th><th>읽는 법</th></tr>
<tr><td>γ (전주 번호 1개당)</td><td class="num">${sgn(c2.gamma,4)}</td><td>초과배수 변화. z 로 환산 κ = ${c2.kappa==null?'—':sgn(c2.kappa,2)}</td></tr>
<tr><td>t · p (Bonferroni ×3)</td><td class="num">${c2.t.toFixed(1)} · ${c2.pBonf<0.001?'&lt;0.001':c2.pBonf.toFixed(3)}</td><td>후보 특징 3개를 시험한 것에 대한 보정</td></tr>
<tr><td>OOS R² (z만 → z+전주)</td><td class="num">${c2.r2Base.toFixed(3)} → ${c2.r2.toFixed(3)}</td><td>ΔR² ${sgn(c2.dR2,4)}</td></tr>
</table></div>
<div class="vd ${c2.adoptCarry?'ok':''}">채택 게이트(t &lt; −3 이고 walk-forward ΔR² &gt; 0): <b>${c2.adoptCarry?'통과':'미통과'}</b>.
${c2.adoptCarry?'통과해도 자동으로 켜지지 않습니다 — 5줄이 같은 직전 번호를 나눠 가져 «1게임 이상 당첨» 비율이 조금 줄어드는 대가가 있습니다.':'지금은 켤 근거가 부족합니다.'}</div>`:''}
</div>

<h2>2층 · 우리가 고른 조합이 실제로 덜 인기있는가</h2>
<p class="note">같은 회차, <b>같은 후보 풀</b>(이번 주 추천과 같은 3,000개)에서 선택 규칙만 갈아끼워 비교합니다. 회차별 공통 변동이 상쇄되도록
<b>대응표본</b>으로 검정했습니다. <b>양성 대조군(분배 최대)</b>이 반대 방향으로 뚜렷하게 갈리지 않으면 모델은 잡음입니다.</p>
<div class="card"><div class="scroll"><table class="wide">
<tr><th>선택 규칙</th><th class="num">z 이득</th><th class="num">무작위 대비</th><th class="num">95% 신뢰구간</th><th class="num">p</th><th class="num">보정 p</th><th class="num">환산 효과</th><th class="num">게임당 일치</th></tr>
${stratRows}
</table></div>
<p class="note" style="padding:10px 0 0">「z 이득」은 후보 풀 평균보다 얼마나 덜 인기있는 쪽을 골랐는가(클수록 좋음).
「환산 효과」는 1층의 재보정 기울기를 곱한 값 — 기대 수령액이 몇 % 늘어나는가.
「게임당 일치」의 우연 기준선은 <b>${A.hitBaseline.toFixed(3)}개</b>이고, 어떤 규칙도 이걸 바꾸지 못합니다(당연합니다).<br>
「보정 p」는 규칙 ${A.strats.length-1}개를 동시에 검정한 것에 대한 Bonferroni 보정입니다. <b>보정 p 가 0.05 를 넘으면 유의하지 않습니다</b> —
낱개 p 만 보면 여러 규칙을 훑는 것만으로 «유의한» 규칙이 만들어집니다.</p>
<div class="vd ${P.maxshare.vsRandom.p<0.05&&cur.vsRandom.p<0.05?'ok':'sig'}">
${P.maxshare.vsRandom.p<0.05&&cur.vsRandom.p<0.05
 ? `<b>양성 대조군이 작동합니다.</b> 일부러 인기 조합을 고르는 규칙은 ${sgn(P.maxshare.vsRandom.mean)}, 현행 규칙은 ${sgn(cur.vsRandom.mean)} 로 반대 방향으로 갈립니다. 모델이 실제로 무언가를 잡고 있다는 뜻입니다.`
 : `<b>대조군이 갈리지 않습니다.</b> 인기 조합을 일부러 고르든 피하든 차이가 없다면, 이 모델은 잡음입니다.`}</div></div>

${anyStruct?`<h2>2층 보강 · 5게임을 어떻게 나눠 담는가</h2>
<p class="note">5게임의 <b>1등 확률은 어떤 규칙이든 5/8,145,060</b>으로 같습니다. 줄끼리 번호를 덜 공유하면 «그 주에 1게임 이상 당첨(5등 이상)»
확률이 조금 커지지만(이론 상한 11.92%), <b>기대 수령액은 바뀌지 않습니다</b> — 당첨 주가 조금 잦아지는 대신 한 주에 여러 줄이 함께 맞는 일이 줄 뿐입니다.
기대 수령액을 바꾸는 것은 인기도(나눠 갖는 인원)뿐입니다. 「EV/5,000원」은 1층 재보정을 4·5등 기울기 그대로 1~3등에도 적용한
<b>보수적 모형값</b>이며 실제 수령이 아닙니다(완전 무작위 5게임 = 2,500원).</p>
<div class="card"><div class="scroll"><table class="wide">
<tr><th>선택 규칙</th><th class="num">P(1게임↑) 이론</th><th class="num">실측 당첨 주 [95%]</th><th class="num">무작위 대비</th><th class="num">판별에 필요</th><th class="num">EV/5,000원</th><th class="num">무작위 대비</th><th class="num">전주 겹침</th></tr>
${structRows}
</table></div>
<div class="vd">커버리지 차이를 «당첨 주 비율»로 실측 판별하려면 ${bigWeeks(cur.weeksForAny)}이 필요합니다 — 그래서 이 칸은 <b>이론값(정확 계산)</b>으로 봅니다.
실측 당첨 주 비율이 이론값의 95% 구간 안에 있으면 구현이 맞다는 뜻일 뿐, 실력의 증거가 아닙니다.${pR&&pR.pAnyTheory!=null?` 같은 풀의 무작위 5줄은 이론 ${pc(pR.pAnyTheory,2)}.`:''}
${cur.ev5CarryModel!=null&&P.portfolio_carry?` 참고: 전주 겹침 모형(그림자)으로 계산하면 ${esc(P.portfolio_carry.name)}의 EV/5,000원은 ${fmtN(P.portfolio_carry.ev5CarryModel)}원, 현행은 ${fmtN(cur.ev5CarryModel)}원입니다.`:''}</div>
${ckList.length?`<details class="cks"><summary>자동 점검 — 통과 ${ckPass} / ${ckList.length}${ckHardFail?` · <b>실패 ${ckHardFail}</b>`:''}</summary>
<p class="note" style="padding-top:8px">설계 문서(D1 §7)의 수용 기준을 매주 다시 확인합니다. «참고»는 설계상 경계에 걸릴 수 있어 경고하지 않는 기준입니다.</p>
<div class="scroll"><table><tr><th>기준</th><th class="num">결과</th><th>값</th></tr>${checkRows}</table></div></details>`:''}</div>`:''}

<h2>3층 · 그래서 돈이 됐는가 — 그리고 언제쯤 알 수 있는가</h2>
<p class="note">여기가 이 프로젝트에서 가장 오해하기 쉬운 곳입니다. 회수율은 <b>1등 꼬리가 지배</b>하므로
성능 지표가 될 수 없습니다. 아래는 «지금 관측된 효과 크기가 진짜라고 가정할 때, 그것을 그 지표로 판별하는 데 몇 주가 필요한가»입니다.</p>
<div class="card"><div class="scroll"><table>
<tr><th>선택 규칙</th><th class="num">z 이득으로 판별</th><th class="num">실제 회수금으로 판별</th></tr>
${powerRows}
</table></div>
<div class="vd sig">주당 회수금의 이론 표준편차는 <b>${fmtN(A.sdWeek)}원</b>인데 기대 회수금은 <b>${fmtN(A.chanceMean)}원</b>입니다.
잡음이 신호의 ${Math.round(A.sdWeek/A.chanceMean)}배라, 돈으로 검증하려면 <b>${bigWeeks(cur.weeksForMoney)}</b>이 걸립니다.
같은 효과를 z 이득으로 재면 <b>${bigWeeks(cur.weeksForZ)}</b>면 됩니다.
<b>그래서 이 보드는 돈이 아니라 메커니즘을 봅니다.</b></div></div>

<h2>연금복권 · 규칙 전수 검정</h2>
<p class="note">모델 5종 × 상위 K 5단계 = <b>${PA.tested}개</b> 조합을 전부 돌렸습니다.
균일한 추첨이라면 우연히 <b>${PA.expectedByChance}개</b>가 p&lt;0.05를 넘습니다. 다중검정 보정 후에도 남는 게 있는지가 관건입니다.</p>
<div class="card"><div class="scroll"><table class="wide">
<tr><th>모델</th><th class="num">K</th><th class="num">적중률</th><th class="num">우연 기준선</th><th class="num">p</th><th class="num">보정 p</th></tr>
${penRows}
</table></div>
<div class="vd ${PA.sigCorrected?'sig':'ok'}">
p&lt;0.05 인 조합 <b>${PA.sig}개</b>(우연 기대 ${PA.expectedByChance}개) · 보정 후 살아남은 것 <b>${PA.sigCorrected}개</b>.
${PA.controlSig?`그중 <b>무작위 대조군에서도 ${PA.controlSig}개</b>가 «유의»하게 나왔습니다 — 다중검정이 가짜 신호를 만드는 장면 그 자체입니다.`:''}
${PA.sigCorrected?'':'보정 후 남는 것이 없습니다. <b>연금복권에는 번호를 고르는 규칙이 없습니다.</b> 고정 당첨금이라 애초에 바꿀 것도 없습니다.'}</div></div>

${psRows?`<h2>연금복권 · 5장을 어떻게 나눠 사는가</h2>
<p class="note">번호 선택은 확률도 당첨금도 바꾸지 못합니다. 5장의 <b>결과가 어떻게 흩어지는지</b>만 고릅니다 — 기대값은 어떤 구조든
<b>${fmtN(PA.evTheory)}원</b>(5,000원당, 세전)입니다. ${PS.from}~${PS.to}회 각 회차를 <b>그때까지의 데이터로</b> 다시 만들어 페이지의 등수 판정으로 채점했습니다.
<b>구현 점검용</b>이며 실력 주장이 아닙니다.</p>
<div class="card"><div class="scroll"><table class="wide">
<tr><th>구조</th><th class="num">P(1장↑) 이론</th><th class="num">실측 [95%]</th><th class="num">점검</th><th class="num">평균 수령</th><th class="num">이론 95% 범위</th><th class="num">회차</th></tr>
${psRows}
</table></div>
<div class="vd">${sp?`분산 5장의 실측 «1장 이상 당첨» ${pc(sp.anyHitRate,1)} — 이론 ${pc(sp.pAnyTheory,1)}${sp.within99==null?'':(sp.within99?'의 99% 범위 안(구현이 맞음)':'의 99% 범위 <b>밖</b> — 구현을 확인해야 합니다')}.
${sp.distinctFail?`<b>끝자리 중복 ${sp.distinctFail}회</b> — 분산 규칙이 지켜지지 않은 회차가 있습니다.`:'모든 회차에서 5장의 끝자리가 서로 달랐습니다.'} `:''}
평균 수령의 이론 범위가 넓은 것은 1·2등(수억~수십억) 꼬리 때문입니다 — 수백 주로는 평균 수령을 판별할 수 없습니다.</div></div>`:''}

<h2>추천 원장 — 추천 5+5를 매주 샀다면</h2>
<p class="note">자동 계산은 내가 실제로 무엇을 샀는지 모릅니다. 이 원장은 <b>«그 주 추천(로또 A~E 5게임 + 연금 1~5 5장)을 샀다면»</b>의 기록입니다.
추천이 회차 번호를 시드로 결정되므로 자동으로 적히고, 추첨이 끝나면 페이지의 등수 판정으로 채점됩니다.
내가 실제로 산 기록은 <a href="./record.html">기록</a>에서 봅니다. 주간 ${led.config.lottoGames}게임 + 연금 ${led.config.pensionTickets}장 = ${fmtN((led.config.lottoGames+led.config.pensionTickets)*1000)}원.</p>
<div class="card"><div class="scroll"><table>
<tr><th>구분</th><th class="num">투입</th><th class="num">회수</th><th class="num">회수율</th><th class="num">중앙값</th><th class="num">주수</th></tr>
<tr class="me"><td>로또 6/45</td><td class="num">${fmtN(tot.lotto.spend)}</td><td class="num">${fmtN(tot.lotto.ret)}</td>
  <td class="num">${pc(tot.lotto.rate,1)}</td><td class="num">${fmtN(tot.lotto.median)}</td><td class="num">${tot.lotto.weeks}</td></tr>
<tr class="me"><td>연금복권720+</td><td class="num">${fmtN(tot.pension.spend)}</td><td class="num">${fmtN(tot.pension.ret)}</td>
  <td class="num">${pc(tot.pension.rate,1)}</td><td class="num">${fmtN(tot.pension.median)}</td><td class="num">${tot.pension.weeks}</td></tr>
</table></div>
<h3>누적 투입과 회수</h3>
${cumChart(led)}
<h3>최근 기록</h3>
<div class="scroll"><table class="wide led">
<tr><th>구분</th><th class="num">회차</th><th>추천 방식</th><th class="num">추첨일</th><th class="num">투입</th><th class="num">회수</th><th class="num">결과</th></tr>
${ledRows}
</table></div>
<div class="vd">${tot.lotto.weeks<20
 ? `아직 <b>${tot.lotto.weeks}주</b>입니다. 원장 기록만으로 규칙을 판단하려면 위 3층 표의 «실제 회수금으로 판별» 칸만큼 걸립니다. <b>이 원장은 성능 측정용이 아니라 가계부입니다.</b>`
 : `${tot.lotto.weeks}주 누적. 회수율은 여전히 성능 지표가 아닙니다 — 판단은 1·2층으로 하세요.`}</div></div>

<div class="foot">동행복권 공식 API 자료로 자동 생성 · ${meta.stamp} (KST) · 로또 ${A.n}주 walk-forward, 연금 ${PA.tested}개 조합 전수<br>
확률은 어떤 규칙으로도 바뀌지 않습니다. 이 보드가 재는 것은 «당첨됐을 때 나눠 갖는 인원»(로또)과 «당첨이 흩어지는 모양»(연금)뿐입니다.<br>
${shared.foot||'복권 구매는 감당할 수 있는 범위 안에서. 만 19세 미만은 구매할 수 없습니다.'}</div>
</div>
<script>${themeJS}</script>
</body></html>`;
}

/* ── 9. main ─────────────────────────────────────────────────── */
(async function main(){
  const t0=Date.now();
  const WIN=+(arg('--window','300'));
  const CFG={ lottoGames:+(arg('--lotto-games','5')), pensionTickets:+(arg('--pension-tickets','5')) };
  const prevPath=arg('--purchases', path.join(OUT,'brief','purchases.json'));

  console.error('[1/5] 데이터 수집…');
  const [pension, lotto] = await getData();
  console.error(`      연금 ${pension.length}회(최신 ${pension.at(-1).ep}) · 로또 ${lotto.rows.length}회(최신 ${lotto.latest})`);

  for(const f of ['pension.html','index.html'])
    if(!fs.existsSync(path.join(ROOT,f))) throw new Error(`${f} 를 ${ROOT} 에서 찾을 수 없습니다 (--root 확인)`);

  /* 원장을 먼저 읽는다 — pending 회차를 페이지 안에서 채점하기 위해 */
  let prev=null;
  try{ if(fs.existsSync(prevPath)) prev=JSON.parse(fs.readFileSync(prevPath,'utf8')); }
  catch(e){ console.error('      기존 원장 읽기 실패, 새로 만듭니다:',e.message); }
  const ledger=ledgerIndex(prev);

  console.error('[2/5] 로또 — 후보 풀 공유 규칙 walk-forward (연금과 동시에)…');
  const {srv,port}=await serve(ROOT); const base='http://127.0.0.1:'+port;
  let L,P;
  const calibFn=rows=>({ calib:calibrate(rows.filter(r=>r.zTrue!=null).map(r=>({z:r.zTrue,r:r.rTrue}))),
                         calib2:calibrate2(rows) });
  /* 로또·연금은 서로 독립인 두 페이지(컨텍스트)라 동시에 돌린다 — 브라우저가 페이지마다 프로세스를 따로 써서
     벽시계 시간이 «합»이 아니라 «긴 쪽»이 된다. 결과는 각자 결정적이라 순서와 무관하다. */
  const gv=graderVectors(lotto, pension);
  let RG=null;
  try{
    await withBrowser(async b=>{
      console.error('[3/5] 연금 — 모델 5종 × K 5단계 전수 + 5장 구조 (로또와 동시에)…');
      const tL=Date.now();
      [L,P,RG]=await Promise.all([
        readLotto(b,base,pension,lotto,WIN,ledger,calibFn,gv).then(x=>{ x.sec=Math.round((Date.now()-tL)/1000); return x; }),
        readPension(b,base,pension,lotto,ledger,gv).then(x=>{ x.sec=Math.round((Date.now()-tL)/1000); return x; }),
        readRecordGuard(b,base,ROOT,gv,pension,lotto).catch(e=>({skipped:'record.html 읽기 실패: '+String(e.message||e).slice(0,160)}))
      ]);
      console.error(`      로또 ${L.rows.length}주 채점 · 규칙 ${L.strats.length}개 · 다음 ${L.target}회(${L.rule}) · ${L.sec}초`+
        ` (루프 ${Math.round(L.loopMs/1000)}초, 풀 ${L.poolN}·최대 시도 ${L.triesMax}${L.poolShort?`, 풀 미달 ${L.poolShort}회`:''}${L.skipped?`, 건너뜀 ${L.skipped}회`:''})`);
      if(!L.has.pp) console.error('      [하위호환] portfolioPick 없음 — 새 규칙(portfolio/carry/disjoint) 없이 진행');
      if(L.pageErrors) console.error('      로또 page errors:',L.pageErrors);
      if(Object.keys(L.errors||{}).length) console.error('      로또 page 함수 오류:',L.errors);
      { const d=P.structure.dist||{};
        console.error(`      연금 ${P.grid.length}개 조합 · 다음 ${P.next.ep}회(${P.mode}) · 구조 ${Math.round(P.structure.ms/1000)}초`+
          ` (분포 ${d.calls||0}회 중 계산 ${d.calc||0}회${d.memo?` · 서명 ${d.unique||0}종`:' · 캐시 끔'}) · ${P.sec}초`); }
      if(!P.has.pp) console.error('      [하위호환] pensionPortfolio 없음 — 구조 점검은 구 방식만');
      if(P.pageErrors) console.error('      연금 page errors:',P.pageErrors);
      if(Object.keys(P.errors||{}).length) console.error('      연금 page 함수 오류:',P.errors);
    });
  } finally { srv.close(); }
  if(!L.rows.length) throw new Error('로또 walk-forward 결과가 비었습니다');

  console.error('[4/5] 집계·원장…');
  const A=analyzeLotto(L, L.cal); A.strats=L.strats;
  const PA=analyzePension(P);
  const led=mergePurchases(prev,L,P,CFG,{lotto,pension});
  (led._log||[]).forEach(s=>console.error('      '+s)); delete led._log;
  const tot=ledgerTotals(led);
  /* 수용 기준 실패는 CI 주석으로 — 잡을 죽이지는 않는다(보드·원장은 그대로 쓴다) */
  for(const [k,c] of Object.entries(A.checks)) if(c.ok===false && !c.soft)
    console.log(`::warning title=검증 점검 ${k}::${JSON.stringify(c.value).slice(0,300)} (기대 ${c.want})`);
  for(const [m,s] of Object.entries(PA.structure.rows)) if(s.within99===false||s.distinctFail)
    console.log(`::warning title=연금 구조 점검 ${m}::실측 ${pc(s.anyHitRate,2)} vs 이론 ${pc(s.pAnyTheory,2)} · 끝자리 중복 ${s.distinctFail}회`);
  if((PA.structure.repro||[]).some(x=>!x.set))
    console.log(`::warning title=연금 원장 재현 실패::${PA.structure.repro.filter(x=>!x.set).map(x=>x.ep+':'+x.rule).join(' ')}`);
  /* 원장에 적힌 규칙과 규칙표가 그 회차에 주는 규칙이 다르면 — 재현은 기록대로 했지만, 규칙표의 과거 항목이
     고쳐졌을 가능성이 크다(C1: 새 설정은 뒤에 «추가»만). 잡을 죽이지는 않고 알린다. */
  { const mm=[...(L.repro||[]).filter(x=>x.recorded&&x.recorded!==x.table).map(x=>`로또 ${x.R}회 기록 ${x.recorded}·규칙표 ${x.table}`),
              ...(PA.structure.repro||[]).filter(x=>x.recorded&&x.recorded!==x.table).map(x=>`연금 ${x.ep}회 기록 ${x.recorded}·규칙표 ${x.table}`)];
    if(mm.length) console.log(`::warning title=원장 기록 규칙 ≠ 규칙표::${mm.join(' / ')} — 재현은 기록된 규칙으로 했습니다. 규칙표의 과거 항목을 고쳤다면 되돌리고 새 항목을 뒤에 추가하세요.`); }
  if(PA.structure.weeklyMode && PA.structure.weeklyMode.ok===false)
    console.log(`::warning title=연금 이번 주 방식 ≠ 규칙표::${PA.structure.weeklyMode.ep}회 ${PA.structure.weeklyMode.mode} (규칙표 ${PA.structure.weeklyMode.table})`);
  /* 채점기 가드 — record.html 의 복사본이 원본과 다르면 ::error (D2 §3.D.5) */
  const guard=compareGuard({lotto:L.guard, pension:P.guard}, RG, P.amt);
  delete L.guard; delete P.guard;
  for(const k of ['lotto','pension']){
    const g=guard[k];
    if(g.ok===false) console.log(`::error title=기록 채점기 불일치(${k})::record.html 의 ${k==='lotto'?'rankOf':'gradeOf'} 가 원본과 ${g.mismatch}/${g.n}건 다릅니다. 첫 불일치 ${JSON.stringify(g.first)}`);
  }
  if(guard.pensionAmt&&guard.pensionAmt.ok===false) console.log('::error title=기록 채점기 불일치(연금 금액)::record.html 의 PENSION_AMT 가 pension.html RANKS 와 다릅니다');
  if(!guard.skipped && (guard.lotto.ok!=null || guard.pension.ok!=null))
    A.checks.recordGrader={ ok: guard.lotto.ok!==false && guard.pension.ok!==false && !(guard.pensionAmt&&guard.pensionAmt.ok===false),
      value:`로또 ${guard.lotto.n-(guard.lotto.mismatch||0)}/${guard.lotto.n} · 연금 ${guard.pension.n-(guard.pension.mismatch||0)}/${guard.pension.n}${guard.pensionAmt?` · 금액 ${guard.pensionAmt.ok?'일치':'불일치'}`:''}`,
      want:'record.html 의 복사본 = index.html rankOf · pension.html gradeOf (최근 50회 × 2,000개)' };
  console.error(`      채점기 가드: ${guard.skipped||`로또 ${guard.lotto.ok==null?'—':guard.lotto.ok?'일치':'불일치'}(${guard.lotto.n}) · 연금 ${guard.pension.ok==null?'—':guard.pension.ok?'일치':'불일치'}(${guard.pension.n})${guard.pensionAmt?` · 연금 금액 ${guard.pensionAmt.ok?'일치':'불일치'}`:''}`}`);

  console.error('[5/5] 저장…');
  const shared=await loadShared(ROOT);
  const now=KST(); const meta={date:kstStr(now), stamp:now.toISOString().slice(0,16).replace('T',' ')};
  fs.mkdirSync(path.join(OUT,'brief'),{recursive:true});
  fs.writeFileSync(path.join(OUT,'validate.html'), buildBoard(A,PA,led,tot,meta,shared));
  fs.writeFileSync(path.join(OUT,'brief','purchases.json'), JSON.stringify(led,null,1));
  const r4=x=>x==null||!isFinite(x)?null:+x.toFixed(4), r6=x=>x==null||!isFinite(x)?null:+x.toFixed(6);
  const ci=(c,f=r4)=>c?[f(c[0]),f(c[1])]:null;
  const val={ generated:new Date().toISOString(), window:WIN,
    lotto:{ n:A.n, from:A.from, to:A.to, current:A.cur, pool:L.poolN,
      calib:A.calib, calib2:A.calib2, sdWeek:A.sdWeek, chanceMean:A.chanceMean,
      portfolio:L.portfolio, portfolioFrom:L.portfolioFrom, portfolioRules:L.portfolioRules, weeklyRule:L.weeklyRule,
      per:Object.fromEntries(Object.entries(A.per).map(([k,v])=>[k,{
        zGain:+v.zGain.toFixed(4), vsRandomMean:+v.vsRandom.mean.toFixed(4), p:+v.vsRandom.p.toFixed(5),
        payoutGain:v.payoutGain==null?null:+v.payoutGain.toFixed(4),
        hitsPerGame:+v.hitsPerGame.toFixed(4), weeksForZ:v.weeksForZ, weeksForMoney:v.weeksForMoney,
        pAnyTheory:r6(v.pAnyTheory), anyHitRate:r4(v.anyHitRate), anyHitCI:ci(v.anyHitCI),
        anyVsRandom:v.anyVsRandom?{mean:r4(v.anyVsRandom.mean),p:r4(v.anyVsRandom.p),ci:ci(v.anyVsRandom.ci)}:null,
        weeksForAny:v.weeksForAny, ev5Model:v.ev5Model==null?null:+v.ev5Model.toFixed(1),
        evVsRandomPct:r4(v.evVsRandomPct), ev5CarryModel:v.ev5CarryModel==null?null:+v.ev5CarryModel.toFixed(1),
        fixedMean:+v.fixedMean.toFixed(1), u:r4(v.u), carry:r4(v.carry), ovMax:v.ovMax, degraded:v.degraded }])),
      checks:A.checks, repro:L.repro, selfCheck:L.checks },
    pension:{ tested:PA.tested, sig:PA.sig, sigCorrected:PA.sigCorrected,
      expectedByChance:PA.expectedByChance, controlSig:PA.controlSig, evTheory:PA.evTheory,
      rules:P.pensionRules, weeklyMode:PA.structure.weeklyMode,
      structure:{ from:PA.structure.from, to:PA.structure.to, mode:PA.structure.mode, dist:PA.structure.dist,
        ...Object.fromEntries(Object.entries(PA.structure.rows).map(([m,s])=>[m,{
          n:s.n, anyHits:s.anyHits, anyHitRate:r4(s.anyHitRate), anyHitCI:ci(s.anyHitCI), pAnyTheory:r6(s.pAnyTheory),
          within99:s.within99, meanRet:+s.meanRet.toFixed(1), evTheory:s.evTheory==null?null:+s.evTheory.toFixed(2),
          sdTheory:s.sdTheory==null?null:Math.round(s.sdTheory), retCI:s.retCI?s.retCI.map(Math.round):null,
          grades:s.grades, distinctFail:s.distinctFail }])),
        repro:PA.structure.repro } },
    ledger:tot,
    guard:{ record: guard.skipped?{skipped:guard.skipped}:{
      lotto:{ok:guard.lotto.ok, n:guard.lotto.n, mismatch:guard.lotto.mismatch, gradeHist:guard.lotto.gradeHist},
      pension:{ok:guard.pension.ok, n:guard.pension.n, mismatch:guard.pension.mismatch, gradeHist:guard.pension.gradeHist},
      pensionAmt:guard.pensionAmt||null } } };
  fs.writeFileSync(path.join(OUT,'brief','validation.json'), JSON.stringify(val,null,1));

  const S=A.per, CUR=A.cur;
  console.log(JSON.stringify({
    date:meta.date, seconds:Math.round((Date.now()-t0)/1000),
    files:[path.join(OUT,'validate.html'), path.join(OUT,'brief','purchases.json'), path.join(OUT,'brief','validation.json')],
    모델:{ 표본:A.calib.n, R2:A.calib.ready?+A.calib.r2.toFixed(3):null,
           기울기:A.calib.ready?+A.calib.b.toFixed(4):null,
           오차개선:A.calib.ready?+(1-A.calib.mae/A.calib.maeNaive).toFixed(3):null,
           전주겹침:A.calib2&&A.calib2.ready?{γ:+A.calib2.gamma.toFixed(4),t:+A.calib2.t.toFixed(2),ΔR2:+A.calib2.dR2.toFixed(4),게이트:A.calib2.adoptCarry}:null },
    선택규칙:Object.fromEntries(A.strats.map(k=>[SNAME[k],
      `z이득 ${S[k].zGain.toFixed(3)} · 무작위대비 ${k==='random'?'기준':sgn(S[k].vsRandom.mean)} (p=${S[k].vsRandom.p.toFixed(4)}) · 환산 ${S[k].payoutGain==null?'—':sgn(S[k].payoutGain*100,1)+'%'}`+
      (S[k].pAnyTheory!=null?` · P(1게임↑) ${pc(S[k].pAnyTheory,2)}`:'')+(S[k].ev5Model!=null?` · EV5 ${fmtN(S[k].ev5Model)}원`:'')])),
    판별소요:{ z이득:bigWeeks(S[CUR].weeksForZ), 회수금:bigWeeks(S[CUR].weeksForMoney) },
    점검:Object.fromEntries(Object.entries(A.checks).map(([k,c])=>[k,c.ok])),
    연금:{ 검정조합:PA.tested, 유의:PA.sig, 우연기대:PA.expectedByChance, 보정후:PA.sigCorrected, 대조군유의:PA.controlSig,
          구조:Object.fromEntries(Object.entries(PA.structure.rows).map(([m,s])=>[m,`실측 ${pc(s.anyHitRate,1)} / 이론 ${pc(s.pAnyTheory,1)} · 평균 ${fmtN(s.meanRet)}원`])) },
    원장:tot,
    이번주추천:{ 로또:L.buy.map(c=>c.join(',')), 로또규칙:L.rule,
                 연금:P.buy.map(c=>c.band+'조 '+c.num), 연금방식:P.mode }
  },null,1));
  console.error(`완료 · ${Math.round((Date.now()-t0)/1000)}초`);
})().catch(e=>{ console.error('실패:',e.stack||e.message); process.exit(1); });
