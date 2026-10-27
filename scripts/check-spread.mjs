#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-spread.mjs — 갈래(spread) 배치(로또 이번 주 추천 A~J 10줄)의 독립 검증기 (CLAUDE.md 규칙 10, docs/spread-layout.md)

   원칙 — 이 파일은 index.html·rank-core.js·lotto-trade.js 를 import·실행하지 않는다. 산출물(JSON)과 역대 이력만 보고
     10줄의 구조를 자기 코드로 다시 센다. index.html·weekly-brief.mjs 는 «문구 검사»를 위해 글자로만 읽는다(실행하지 않음).
     읽기 전용이다. 종료 코드 0(통과·건너뜀)/1(실패). 실패는 `::error title=check-spread::…` 한 줄씩.

   사용
     node scripts/check-spread.mjs --summary brief/latest-summary.json --week brief/week.json --history lotto-history.json
          [--root .] [--index index.html] [--src scripts/weekly-brief.mjs] [--force-check] [--prob-only] [--no-prob]
     --summary/--week  weekly-brief 산출. 줄 순서의 정본은 summary.lotto.picks(10개) 이고 week.lotto.buy/spares 와 일치해야 한다.
     --history         lotto-history.json — «역대 1등 조합 아님» 검사에 쓴다.
     --index/--src     문구 검사 대상(기본 <root>/index.html, <root>/scripts/weekly-brief.mjs). 시험용으로 다른 파일을 줄 수 있다.
     --force-check     layout 이 legacy 이거나 없어도 구조 검사를 강제로 돈다(자기 확인용: 옛 10줄은 구조 불변식에서 실패하는 게 정상).
     --prob-only       정확 확률만 찍고 0 으로 끝낸다(전수 구현의 자기 확인용, 구조 판정 없음).
     --no-prob         정확 확률 전수 계산을 생략한다(빠른 시험).

   layout.name !== 'spread' 이거나 layout 이 없으면 «건너뜀» ::notice 를 내고 구조 검사는 하지 않는다(문구 검사는 늘 한다).

   검사 표 (spread 일 때)
     S0 입력      summary.lotto.picks 10개 · week.lotto.buy 5 + spares 5 · 모든 줄이 «6개 서로 다른 1..45 오름차순»
     S1 순서      picks[0..4] = week.buy, picks[5..9] = week.spares (줄 순서까지 같음) · summary.next = week.round
     S2 사용      1..45 를 모두 쓴다 · 어느 번호도 1~2번(3번 이상·0번 금지) · 2번 쓰인 번호가 정확히 15개
     S3 겹침      어느 두 줄도 2개 이상 겹치지 않는다(45쌍 전수) · 겹침이 1인 쌍이 정확히 15개 · A~E 쌍 ≤1 · F~J 끼리는 0
     S4 이력      10줄 모두 역대 1등 조합이 아니다
     S5 필드      layout.{name,used,maxOv,pairs,degraded} 가 실측과 일치 · from <= 대상 회차 · degraded 는 구조를 다 지키면 false
     S6 문구      summary·week 의 모든 문자열 + index.html·weekly-brief.mjs 의 spread 문구 줄에 금지 문구(규칙 9) 없음
   정보(::notice, 화면·JSON 에는 쓰지 않음): 10줄 중 «한 줄이라도 3개 이상»(5등 이상) 정확 확률 — C(45,6)=8,145,060 전수 세기.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const ROOT = path.resolve(arg('--root', process.cwd()));
const rel = (p) => path.resolve(ROOT, p);
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const errors = [];
const err = (id, m) => errors.push(`${id} ${m}`);
const notice = (m) => console.log(`::notice title=check-spread::${esc(m)}`);

if (has('-h') || has('--help')) {
  console.log('사용: node scripts/check-spread.mjs --summary brief/latest-summary.json --week brief/week.json --history lotto-history.json [--root .] [--index f] [--src f] [--force-check] [--prob-only] [--no-prob]');
  process.exit(0);
}

/* 금지 문구(규칙 9) · 화면에 새로 넣지 않는 이론값 낱말 */
const BAN = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
const THEORY = /기대값|표준편차|σ|p값|몬테카를로|정확 확률|이론값/;
/* index.html·weekly-brief.mjs 에서 갈래 배치 문구가 들어 있는 줄을 가려내는 표지 */
const SPREAD_LINE = /갈래|F~J|펼침|펼친|45개 번호|LAYOUT_RULES|layoutFor|layoutStats|spreadComplete|spreadOn|spareTitle|spareLabel|\blayout\b/;

function fatal(msg) { console.log(`::error title=check-spread::${esc(msg)}`); process.exit(1); }
function readJSON(p, label) {
  let t;
  try { t = fs.readFileSync(p, 'utf8'); } catch (e) { fatal(`${label} 을(를) 읽을 수 없습니다: ${p}`); }
  try { return JSON.parse(t); } catch (e) { fatal(`${label} 이(가) JSON 이 아닙니다: ${p}`); }
}

/* ── 정확 확률: 10줄 중 한 줄이라도 추첨 번호 6개 중 3개 이상 맞힐 확률 ──────────────────────────────
   C(45,6) 모든 추첨(a<b<c<d<e<f)을 직접 세어, 줄마다 «맞힌 번호 수»를 한 칸씩 올리며 내려가고 마지막 칸에서 3 이상인 줄이
   하나라도 있으면 센다. 공식·근사 없음 — 센 추첨 수가 8,145,060 인지 같이 확인한다. */
function exactAny3(lines) {
  const m = lines.length, has = new Uint8Array(m * 46);
  lines.forEach((c, i) => c.forEach((n) => { has[i * 46 + n] = 1; }));
  const lv = Array.from({ length: 7 }, () => new Int8Array(m));
  let hit = 0, total = 0;
  for (let a = 1; a <= 40; a++) {
    for (let i = 0; i < m; i++) lv[1][i] = has[i * 46 + a];
    for (let b = a + 1; b <= 41; b++) {
      for (let i = 0; i < m; i++) lv[2][i] = lv[1][i] + has[i * 46 + b];
      for (let c = b + 1; c <= 42; c++) {
        for (let i = 0; i < m; i++) lv[3][i] = lv[2][i] + has[i * 46 + c];
        for (let d = c + 1; d <= 43; d++) {
          for (let i = 0; i < m; i++) lv[4][i] = lv[3][i] + has[i * 46 + d];
          for (let e = d + 1; e <= 44; e++) {
            for (let i = 0; i < m; i++) lv[5][i] = lv[4][i] + has[i * 46 + e];
            for (let f = e + 1; f <= 45; f++) {
              total++;
              for (let i = 0; i < m; i++) if (lv[5][i] + has[i * 46 + f] >= 3) { hit++; break; }
            }
          }
        }
      }
    }
  }
  return { p: hit / total, hit, total };
}

/* ── 줄 해석 ───────────────────────────────────────────────────────────────────────────── */
const asLine = (x) => (typeof x === 'string' ? x.split(',').map((s) => +s.trim()) : Array.isArray(x) ? x.map(Number) : null);
const validLine = (c) => Array.isArray(c) && c.length === 6 && c.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 45 && (i === 0 || n > c[i - 1]));
const ov = (a, b) => { let k = 0; for (const n of a) if (b.includes(n)) k++; return k; };
const stringsOf = (o, out = []) => {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => stringsOf(x, out));
  else if (o && typeof o === 'object') for (const v of Object.values(o)) stringsOf(v, out);
  return out;
};

/* ── 문구 검사 (S6의 파일 쪽) ────────────────────────────────────────────────────────────── */
function checkSourceText(file, label) {
  let t;
  try { t = fs.readFileSync(file, 'utf8'); } catch (e) { err('S6', `${label} 을(를) 읽을 수 없습니다: ${file}`); return 0; }
  let n = 0;
  t.split(/\r?\n/).forEach((ln, i) => {
    if (!SPREAD_LINE.test(ln)) return;
    n++;
    if (BAN.test(ln)) err('S6', `${label}:${i + 1} 금지 문구`);
    if (THEORY.test(ln)) err('S6', `${label}:${i + 1} 화면에 새로 넣지 않는 이론값 낱말`);
  });
  return n;
}

/* ═════════════════════════════ 실행 ═════════════════════════════ */
const summaryP = rel(arg('--summary', 'brief/latest-summary.json'));
const weekP = rel(arg('--week', 'brief/week.json'));
const historyP = rel(arg('--history', 'lotto-history.json'));
const indexP = rel(arg('--index', 'index.html'));
const srcP = rel(arg('--src', 'scripts/weekly-brief.mjs'));

const summary = readJSON(summaryP, 'summary');
const week = readJSON(weekP, 'week');
const SL = summary && summary.lotto, WL = week && week.lotto;
if (!SL) fatal('summary.lotto 가 없습니다');
if (!WL) fatal('week.lotto 가 없습니다');
const layout = (SL.layout !== undefined && SL.layout !== null) ? SL.layout : (WL.layout || null);
const force = has('--force-check');
const isSpread = !!(layout && layout.name === 'spread');

const picksRaw = Array.isArray(SL.picks) ? SL.picks : [];
const picks = picksRaw.map(asLine);

/* 정확 확률 — 구조 판정과 무관한 정보. 줄이 해석되면 늘 찍는다(--no-prob 제외). */
if (!has('--no-prob') && picks.length === 10 && picks.every(validLine)) {
  const r = exactAny3(picks);
  notice(`내부 정확 확률(10줄 중 한 줄이라도 3개 이상) = ${r.p.toFixed(6)} (${r.hit.toLocaleString('en-US')} / ${r.total.toLocaleString('en-US')} 추첨 전수)`);
  if (r.total !== 8145060) err('S0', `전수 세기 구현 오류: 추첨 수 ${r.total} ≠ 8145060`);
  if (has('--prob-only')) process.exit(r.total === 8145060 ? 0 : 1);
} else if (has('--prob-only')) {
  fatal('정확 확률을 셀 수 있는 10줄이 없습니다');
}

/* S6 문구 — 산출 JSON 의 모든 문자열 + 소스의 spread 문구 줄 (spread 여부와 무관하게 늘 본다) */
for (const s of stringsOf(summary).concat(stringsOf(week))) {
  if (BAN.test(s)) err('S6', `산출 JSON 에 금지 문구: ${s.slice(0, 40)}`);
}
const nLinesIdx = checkSourceText(indexP, 'index.html');
const nLinesSrc = checkSourceText(srcP, 'weekly-brief.mjs');

if (!isSpread && !force) {
  const why = layout ? `layout.name=${JSON.stringify(layout.name)}` : 'layout 필드 없음';
  notice(`건너뜀 — 갈래 배치 회차가 아닙니다(${why}). 구조 검사는 하지 않습니다.`);
} else {
  /* S0 입력 */
  const buy = (WL.buy || []).map(asLine), spares = (WL.spares || []).map(asLine);
  if (picks.length !== 10) err('S0', `summary.lotto.picks 가 ${picks.length}개 (10개여야 함)`);
  if (buy.length !== 5) err('S0', `week.lotto.buy 가 ${buy.length}개 (5개여야 함)`);
  if (spares.length !== 5) err('S0', `week.lotto.spares 가 ${spares.length}개 (5개여야 함)`);
  picks.forEach((c, i) => { if (!validLine(c)) err('S0', `picks[${i}] 이(가) «6개 서로 다른 1..45 오름차순» 이 아님: ${JSON.stringify(picksRaw[i])}`); });
  buy.concat(spares).forEach((c, i) => { if (!validLine(c)) err('S0', `week 의 ${i < 5 ? 'buy' : 'spares'}[${i % 5}] 이(가) «6개 서로 다른 1..45 오름차순» 이 아님`); });

  const okAll = picks.length === 10 && picks.every(validLine);
  /* S1 순서 */
  if (picks.length === 10 && buy.length === 5 && spares.length === 5) {
    const w10 = buy.concat(spares);
    for (let i = 0; i < 10; i++) {
      if (!picks[i] || !w10[i] || picks[i].join() !== w10[i].join())
        err('S1', `줄 ${'ABCDEFGHIJ'[i]}: summary.picks 와 week.${i < 5 ? 'buy' : 'spares'} 가 다름`);
    }
  }
  if (SL.next !== WL.round) err('S1', `summary.lotto.next(${SL.next}) ≠ week.lotto.round(${WL.round})`);

  /* 실측 (okAll 일 때만 의미가 있다) */
  let used = 0, maxOv = 0, pairs = 0, maxUse = 0;
  if (okAll) {
    const cnt = new Uint8Array(46);
    picks.forEach((c) => c.forEach((n) => { cnt[n]++; }));
    const twice = [], missing = [], over = [];
    for (let n = 1; n <= 45; n++) {
      if (cnt[n]) used++;
      if (cnt[n] > maxUse) maxUse = cnt[n];
      if (cnt[n] === 0) missing.push(n);
      if (cnt[n] >= 3) over.push(n);
      if (cnt[n] === 2) twice.push(n);
    }
    /* S2 사용 */
    if (missing.length) err('S2', `쓰지 않은 번호 ${missing.length}개: ${missing.join(',')}`);
    if (over.length) err('S2', `3번 이상 쓴 번호: ${over.join(',')}`);
    if (!missing.length && !over.length && twice.length !== 15) err('S2', `2번 쓰인 번호가 ${twice.length}개 (15개여야 함)`);
    /* S3 겹침 — 45쌍 전수 */
    const bad = [];
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
      const o = ov(picks[i], picks[j]);
      if (o > maxOv) maxOv = o;
      if (o === 1) pairs++;
      if (o >= 2) bad.push(`${'ABCDEFGHIJ'[i]}${'ABCDEFGHIJ'[j]}=${o}`);
      if (i >= 5 && o > 0) err('S3', `F~J 끼리 번호가 겹침: ${'ABCDEFGHIJ'[i]}${'ABCDEFGHIJ'[j]}=${o}`);
    }
    if (bad.length) err('S3', `두 줄 겹침 ≥2: ${bad.slice(0, 8).join(' ')}${bad.length > 8 ? ' …' : ''}`);
    if (!bad.length && pairs !== 15) err('S3', `겹침이 1인 쌍이 ${pairs}개 (15개여야 함)`);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const o = ov(picks[i], picks[j]);
      if (o > 1) err('S3', `A~E 쌍 ${'ABCDE'[i]}${'ABCDE'[j]} 겹침 ${o} (≤1 이어야 함)`);
    }

    /* S4 이력 */
    const H = readJSON(historyP, 'history');
    const won = new Set((H.draws || []).map((d) => (d.numbers || []).slice().sort((a, b) => a - b).join(',')));
    if (won.size < 100) err('S4', `이력이 너무 짧음(${won.size}회) — 역대 1등 조합 대조 불가`);
    picks.forEach((c, i) => { if (won.has(c.join(','))) err('S4', `${'ABCDEFGHIJ'[i]} 줄이 역대 1등 조합: ${c.join(',')}`); });
    const hLatest = H.meta && H.meta.latest;
    if (hLatest != null && SL.last != null && +hLatest !== +SL.last)
      notice(`참고 — 이력 최신 ${hLatest}회 ≠ summary.lotto.last ${SL.last}회(이력 갱신 순서 차이일 수 있음)`);
  }

  /* S5 필드 */
  if (!layout) {
    err('S5', 'layout 필드가 없습니다(--force-check)');
  } else {
    if (layout.name !== 'spread') err('S5', `layout.name=${JSON.stringify(layout.name)} (spread 가 아님; --force-check)`);
    if (!Number.isInteger(layout.from)) err('S5', `layout.from 이 정수가 아님: ${JSON.stringify(layout.from)}`);
    else if (Number.isInteger(SL.next) && layout.from > SL.next) err('S5', `layout.from(${layout.from}) > 대상 회차(${SL.next})`);
    if (okAll) {
      const structOk = used === 45 && maxUse <= 2 && maxOv <= 1;
      for (const [k, v] of [['used', used], ['maxOv', maxOv], ['pairs', pairs]])
        if (layout[k] !== v) err('S5', `layout.${k}=${JSON.stringify(layout[k])} ≠ 실측 ${v}`);
      if (layout.degraded !== !structOk) err('S5', `layout.degraded=${JSON.stringify(layout.degraded)} ≠ 실측 판정 ${!structOk}`);
    }
  }
}

console.log(`[S0~S6] ${isSpread || force ? '구조 검사' : '건너뜀(문구만)'} · 문구 대상 줄: index.html ${nLinesIdx} · weekly-brief.mjs ${nLinesSrc}`);
if (errors.length) {
  for (const m of errors.slice(0, 20)) console.log(`::error title=check-spread::${esc(m)}`);
  if (errors.length > 20) console.log(`::error title=check-spread::${esc(`…외 ${errors.length - 20}건`)}`);
  console.log(`::error title=check-spread::${esc(`갈래 배치 독립 검증 실패 — 오류 ${errors.length}건`)}`);
  process.exit(1);
}
notice(isSpread || force ? `갈래 배치 독립 검증 통과` : `문구 검사 통과 · 구조 검사 건너뜀`);
process.exit(0);
