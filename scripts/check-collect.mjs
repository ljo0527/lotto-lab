#!/usr/bin/env node
// scripts/check-collect.mjs — index.html 의 자료 수집(syncData·fetchRange)이 «최신 회차 끝자리가 무엇이든»
// 1..latest 를 빠짐없이 채우는지 본다. 11회 구멍(최신 끝자리 7) 재발 방지용 회귀 검사.
//
// 방법: 가짜 로또 자료(1..N, 결정적)를 만들어 index.html 을 헤드리스 브라우저로 띄우고 동행복권 API 만 모의한다.
//       빈 DB 에서 시작하므로 «전체 수집 + 누락 재시도» 경로를 그대로 탄다. 끝나면 DB.draws 가 1..N 연속인지 센다.
//       이 검사는 페이지·스크립트의 수집 코드를 쓰지 않고 DB 만 직접 센다(data-guard 의 assertPageDb 와 별개의 눈).
// 모의 API 3종:
//   legacy — 예전 CI 스크립트가 쓰던 창: center-5..center+4 를 그대로 자른다(하한 밀림 없음). 11회 구멍을 만든 모의.
//   real   — 실 API 처럼 하한(1회)에서 창을 위로 밀어 항상 10건(data-guard.lottoApiWindow). 지금 스크립트가 쓰는 모의.
//   strict — real + «center 회차가 아직 없으면 빈 응답»(index.html detectLatest 주석이 근거). 가장 실제에 가까운 쪽.
// 수정 전 index.html 로 돌리려면 --root 에 옛 index.html 을 둔 폴더(저장소 복사본)를 준다.
//   수정 전 재현은 구멍이 나는 시나리오 하나만 골라 준다: --root <옛 폴더> --latest 1247 --mock legacy --expect fail
//   (기본값 전체를 --expect fail 로 돌리면 구멍 없는 시나리오가 «기대와 다름» 으로 세어져 항상 종료 코드 1 이 난다.)
//
// 사용: node scripts/check-collect.mjs [--root .] [--latest 1247[,1248,…]] [--mock legacy,real,strict] [--expect pass|fail]
//   기본: latest 1240~1249(끝자리 0~9 전부) × 모의 3종. --expect fail 은 «구멍이 나야 정상»인 수정 전 재현용(구멍이 없으면 1).
//   종료 코드: 0 = 기대대로, 1 = 기대와 다름, 2 = 실행 오류

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { lottoApiWindow, fmtHoles, assertLottoRows, assertPageDb } from './data-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('--root', path.join(here, '..')));
const LATESTS = arg('--latest', Array.from({ length: 10 }, (_, i) => 1240 + i).join(',')).split(',').map(Number);
const MOCKS = arg('--mock', 'legacy,real,strict').split(',');
const EXPECT = arg('--expect', 'pass');
const WAIT_MS = +arg('--wait', 12000);

/* ── 가짜 자료: 회차 1..n, 결정적 ─────────────────────────────────────── */
function makeRows(n) {
  let s = 20260101;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const base = Date.UTC(2002, 11, 7);
  const rows = [];
  for (let r = 1; r <= n; r++) {
    const pool = Array.from({ length: 45 }, (_, i) => i + 1);
    const pick = [];
    for (let k = 0; k < 7; k++) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const nums = pick.slice(0, 6).sort((a, b) => a - b);
    const ymd = new Date(base + (r - 1) * 7 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    rows.push({
      ltEpsd: r, ltRflYmd: ymd,
      tm1WnNo: nums[0], tm2WnNo: nums[1], tm3WnNo: nums[2], tm4WnNo: nums[3], tm5WnNo: nums[4], tm6WnNo: nums[5], bnsWnNo: pick[6],
      rnk1WnNope: 5, rnk2WnNope: 50, rnk3WnNope: 1500, rnk4WnNope: 70000, rnk5WnNope: 1200000,
      rnk1WnAmt: 2e9, rnk2WnAmt: 5e7, rnk3WnAmt: 1.5e6, rnk4WnAmt: 5e4, rnk5WnAmt: 5e3,
      wholEpsdSumNtslAmt: 1e11, winType1: 3, winType2: 1, winType3: 1,
    });
  }
  return rows;
}

/* Node 쪽 가드 단위 확인: 연속 자료는 통과, 11회를 뺀 자료는 막아야 한다(네트워크·브라우저 없음). */
function selfTestLottoRows() {
  const rows = makeRows(47);
  assertLottoRows({ latest: 47, rows }, 'selftest');
  for (const [name, bad] of [['중간 구멍', rows.filter((x) => x.ltEpsd !== 11)], ['끝 구멍', rows.slice(0, 45)], ['앞 구멍', rows.slice(1)]]) {
    let blocked = false;
    try { assertLottoRows({ latest: 47, rows: bad }, 'selftest'); } catch (e) { blocked = /자료 구멍/.test(e.message); }
    if (!blocked) throw new Error('assertLottoRows 가 ' + name + ' 을 막지 못했습니다');
  }
  console.log('  assertLottoRows 단위 확인: 연속 자료 통과 · 중간/끝/앞 구멍 3종 차단');
}

const MOCK_FN = {
  legacy: (rows, c) => { let l = rows.filter((x) => x.ltEpsd >= c - 5 && x.ltEpsd <= c + 4); if (!l.length) l = rows.slice(-10); return l; },
  real: (rows, c) => { const l = lottoApiWindow(rows, c); return l.length ? l : rows.slice(-10); },
  strict: (rows, c) => (c > rows[rows.length - 1].ltEpsd ? [] : lottoApiWindow(rows, c)),
};

/* ── 브라우저·정적 서버 (계산 스크립트들과 같은 방식) ─────────────────── */
async function withBrowser(fn) {
  let chromium;
  for (const p of ['playwright', '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs', '/usr/lib/node_modules/playwright/index.mjs']) {
    try { ({ chromium } = await import(p)); break; } catch (e) { /* 다음 후보 */ }
  }
  if (!chromium) throw new Error('playwright 없음');
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try { return await fn(b); } finally { await b.close(); }
}
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const s = http.createServer((q, res) => {
    const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ srv: s, port: s.address().port })));
}

/* ── 한 시나리오: (latest, mock) ───────────────────────────────────────── */
async function scenario(browser, base, rows, mockName) {
  const mock = MOCK_FN[mockName];
  const N = rows[rows.length - 1].ltEpsd;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  let calls = 0;
  await ctx.route('**dhlottery.co.kr/**', (route) => {
    const u = route.request().url();
    const body = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('selectPstLt645InfoNew')) {
      calls++;
      const c = +(u.match(/srchLtEpsd=(\d+)/) || [])[1];
      return body({ data: { list: mock(rows, c).slice().sort((a, b) => b.ltEpsd - a.ltEpsd) } });
    }
    return body({ data: {} });
  });
  await ctx.route('**fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('**fonts.gstatic.com/**', (r) => r.abort());
  // 백업 JSON 으로 구멍이 가려지지 않게 한다(페이지는 수집 실패 시 ./lotto-history.json 을 대신 읽는다)
  await ctx.route('**/lotto-history.json', (r) => r.fulfill({ status: 404, body: 'nf' }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/index.html', { waitUntil: 'load' });
  const probe = (n) => {
    if (typeof DB === 'undefined' || !DB.draws) return { ok: false, latest: 0, miss: [], n: -1 };
    const miss = [];
    for (let i = 1; i <= n; i++) if (!DB.draws[i]) miss.push(i);
    return { ok: miss.length === 0 && DB.latest === n, latest: DB.latest, miss: miss.slice(0, 400), n: miss.length };
  };
  const t0 = Date.now();
  let r = await p.evaluate(probe, N);
  while (!r.ok && Date.now() - t0 < WAIT_MS) { await new Promise((res) => setTimeout(res, 300)); r = await p.evaluate(probe, N); }
  // 가드(assertPageDb)도 같은 판정을 내려야 한다: 구멍이 있으면 막고(guard=차단), 없으면 통과. 다르면 가드가 고장난 것.
  let guard = 'pass';
  try { await assertPageDb(p, { latest: N, rows }, 'check-collect', 1500); } catch (e) { guard = /자료 구멍/.test(e.message) ? 'block' : 'error:' + e.message; }
  await ctx.close();
  return { N, mockName, ok: r.ok, holes: r.miss, n: r.n, domLatest: r.latest, calls, guard, errs: errs.slice(0, 2) };
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error('index.html 이 없습니다: ' + ROOT);
  for (const m of MOCKS) if (!MOCK_FN[m]) throw new Error('모르는 모의 API: ' + m);
  selfTestLottoRows();
  const { srv, port } = await serve(ROOT);
  const results = [];
  try {
    await withBrowser(async (browser) => {
      for (const N of LATESTS) {
        const rows = makeRows(N);
        for (const m of MOCKS) results.push(await scenario(browser, 'http://127.0.0.1:' + port, rows, m));
      }
    });
  } finally { srv.close(); }

  let bad = 0;
  console.log('check-collect — root=' + ROOT + ' · 기대=' + EXPECT);
  if (EXPECT === 'fail' && !process.argv.includes('--latest')) console.log('안내: --expect fail 은 구멍이 나는 시나리오 하나(예: --latest 1247 --mock legacy)와 함께 쓰세요. 기본 시나리오 전체에는 구멍 없는 것도 있어 종료 코드 1 이 납니다.');
  for (const r of results) {
    const verdict = (r.guard === 'block' ? '[가드 차단] ' : '[가드 통과] ') + (r.ok ? '구멍 없음' : (r.n > 0 ? '구멍 ' + r.n + '개 (' + fmtHoles(r.holes) + ')' : r.n < 0 ? 'DB 없음' : 'DB.latest=' + r.domLatest));
    const wantOk = EXPECT === 'pass';
    const guardOk = r.guard === (r.ok ? 'pass' : 'block');
    const good = r.ok === wantOk && guardOk;
    if (!good) bad++;
    console.log('  최신 ' + r.N + '(끝자리 ' + (r.N % 10) + ') · 모의 ' + r.mockName.padEnd(6) + ' · API ' + String(r.calls).padStart(3) + '회 · ' + verdict + (good ? '' : '   <-- 기대와 다름' + (guardOk ? '' : ' (가드 판정 ' + r.guard + ' 불일치)')) + (r.errs.length ? ' · pageerror: ' + r.errs[0] : ''));
  }
  if (bad) {
    console.log('::error title=check-collect 실패::' + bad + '/' + results.length + ' 시나리오가 기대(' + EXPECT + ')와 다릅니다');
    process.exit(1);
  }
  console.log('check-collect ' + (EXPECT === 'pass' ? '통과' : '(기대한 실패 재현 확인)') + ': ' + results.length + ' 시나리오');
})().catch((e) => { console.error('실패:', e.stack || e.message); process.exit(2); });
