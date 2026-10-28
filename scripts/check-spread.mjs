#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   check-spread.mjs — 갈래(spread) 배치(로또 이번 주 추천 A~J 10줄)의 독립 검증기 (CLAUDE.md 규칙 10, docs/spread-layout.md)

   원칙 — 이 파일은 index.html·rank-core.js·lotto-trade.js 를 import·실행하지 않는다. 산출물(JSON)과 역대 이력만 보고
     10줄의 구조를 자기 코드로 다시 센다. index.html·weekly-brief.mjs 는 «문구 검사»를 위해 글자로만 읽는다(실행하지 않음).
     읽기 전용이다. 종료 코드 0(통과·건너뜀)/1(실패). 실패는 `::error title=check-spread::…` 한 줄씩.

   사용
     node scripts/check-spread.mjs --summary brief/latest-summary.json --week brief/week.json --history lotto-history.json
          [--root .] [--index index.html] [--src scripts/weekly-brief.mjs] [--force-check] [--expect-spread-from N] [--prob-only] [--no-prob]
     --summary/--week  weekly-brief 산출. 줄 순서의 정본은 summary.lotto.picks(10개) 이고 week.lotto.buy/spares 와 일치해야 한다.
                       summary.lotto.layout 과 week.lotto.layout 은 둘 다 있으면 같아야 하고, 한쪽만 있으면 오류다(S5).
     --history         lotto-history.json — «역대 1등 조합 아님» 검사에 쓴다.
     --index/--src     문구 검사 대상(기본 <root>/index.html, <root>/scripts/weekly-brief.mjs). 시험용으로 다른 파일을 줄 수 있다.
     --force-check     layout 이 legacy 이거나 없어도 구조 검사를 강제로 돈다(자기 확인용: 옛 10줄은 구조 불변식에서 실패하는 게 정상).
     --expect-spread-from N  대상 회차(summary.lotto.next)가 N 이상인데 layout 이 없거나 spread 가 아니면 오류(S5). 엔진 회귀로 layout 이 빠지거나
                       legacy 로 잘못 찍혀 구조 검사가 조용히 꺼지는 것을 막는다. 옵션이 없으면(기본) 예전처럼 «건너뜀».
     --prob-only       정확 확률만 찍고 0 으로 끝낸다(전수 구현의 자기 확인용, 구조 판정 없음).
     --no-prob         정확 확률 전수 계산을 생략한다(빠른 시험).

   layout.name !== 'spread' 이거나 layout 이 없으면 «건너뜀» ::notice 를 내고 구조 검사는 하지 않는다(문구 검사는 늘 한다).

   검사 표 (spread 일 때)
     S0 입력      summary.lotto.picks 10개 · week.lotto.buy 5 + spares 5 · 모든 줄이 «6개 서로 다른 1..45 오름차순»
     S1 순서      picks[0..4] = week.buy, picks[5..9] = week.spares (줄 순서까지 같음) · summary.next = week.round
     S2 사용      1..45 를 모두 쓴다 · 어느 번호도 1~2번(3번 이상·0번 금지) · 2번 쓰인 번호가 정확히 15개
     S3 겹침      어느 두 줄도 2개 이상 겹치지 않는다(45쌍 전수) · 겹침이 1인 쌍이 정확히 15개 · A~E 쌍 ≤1 · F~J 끼리는 0
     S4 이력      10줄 모두 역대 1등 조합이 아니다
     S5 필드      layout.{name,used,maxOv,pairs,degraded} 가 실측과 일치 · from <= 대상 회차 · degraded 는 구조(역대 1등 제외 포함)를 다 지키면 false
                  · summary 와 week 의 layout 이 같음 · (--expect-spread-from 이면) 대상 회차 ≥ N 에서 layout 이 spread
     S6 문구      summary·week 의 모든 문자열 + index.html·weekly-brief.mjs 의 spread 문구 줄에 금지 문구(규칙 9) 없음.
                  spread 문구를 정의·선택하는 줄(const spareLabel·spareTitle·spNote·prevSp·spreadOn·SP, dashSpareNote, SP 분기)과 그다음 2줄에는
                  «확률·기대·높인·높여·올려·올라» 도 없다(F~J 문구는 구조를 사실 그대로 적을 뿐 효과를 말하지 않는다).

   degraded 주 — A~E 가 한 번호를 3번 이상 쓰거나 A~E 안에서 두 줄이 2개 이상 겹치는 주(실측 1097·1171 유형, 약 0.8%)는 F~J 로 고칠 수 없다.
     엔진은 layout.degraded=true 로 정직하게 알리고 F~J 쪽 구조는 지킨다. 이 검증기는 «layout.degraded 가 true 이고 S5 필드(used·maxOv·pairs)가 실측과
     정확히 같고 구조가 실제로 안 지켜졌을 때»에 한해, 아래 «A~E 원인» 위반만 ::warning 으로 세고 exit 0 으로 둔다(::notice 에 «degraded 주 — A~E 원인 위반 N건»).
       A~E 원인(경고): A~E 안에서 두 줄 겹침 ≥2 · A~E 가 3번 이상 쓴 번호 · 그 결과로 따라오는 «겹침 1인 쌍 ≠ 15».
       F~J 쪽(계속 오류): 쓰지 않은 번호 · F~J 끼리 겹침 · F~J–A~E 겹침 ≥2 · F~J 때문에 3번 이상 쓰인 번호 · 역대 1등 줄 · 필드 불일치.
     degraded=false 인데 구조가 어긋나면(엔진이 거짓으로 알림) 모두 오류다. 이유: 기준을 낮추는 것이므로 범위를 «엔진이 스스로 밝히고 실측과 일치하는 A~E 몫»으로
     좁혔다. 이 주는 A~E(소유 범위 밖 규칙)가 정한 것이라 F~J 쪽 CI 를 빨갛게 하면 원인이 틀리게 표시된다.
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
const aeWarn = [];                             // degraded 주의 «A~E 원인» 위반 — 경고(exit 0)로만 센다(아래 S2·S3)
const err = (id, m) => errors.push(`${id} ${m}`);
const notice = (m) => console.log(`::notice title=check-spread::${esc(m)}`);

if (has('-h') || has('--help')) {
  console.log('사용: node scripts/check-spread.mjs --summary brief/latest-summary.json --week brief/week.json --history lotto-history.json [--root .] [--index f] [--src f] [--force-check] [--prob-only] [--no-prob]');
  process.exit(0);
}

/* 금지 문구(규칙 9) · 화면에 새로 넣지 않는 이론값 낱말.
   BAN 은 check-trade.mjs 의 FORBID 와 같은 값이다 — 독립성 원칙(규칙 10)상 일부러 복사해 뒀으니 바꿀 때 둘을 같이 바꾼다. */
const BAN = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
const THEORY = /기대값|표준편차|σ|p값|몬테카를로|정확 확률|이론값/;
/* spread 문구에만 더 엄격하게 거는 낱말(효과를 말하는 표현). 이 말들이 정당하게 쓰이는 기존 줄(1등 확률 규칙 사실 등)은 대상이 아니다 —
   SPREAD_MARK — spread 문구를 «정의하는» 줄(const spareLabel 등)과 문구를 «고르는» 줄(SP 분기·prevSp?…)에 표지가 있고, 그 줄과 그다음 2줄에만 건다.
   (변수를 단순히 «쓰는» 줄 — 예: <summary>${spareTitle}</summary> — 은 표지가 아니다. 그 뒤에 이어지는 1등 확률 설명 같은 기존 문구가 걸리면 안 된다.) */
const STRICT = /확률|기대|높인|높여|올려|올라/;
const SPREAD_MARK = /\bconst\s+(?:spareLabel|spareTitle|spNote|prevSp|spreadOn|SP)\b|\bdashSpareNote\b|\bprevSp\s*\?|\(SP\s*\?|\(SP\s*$|\bSP\s*\?|\bSP\.degraded\b/;
const MARK_SPAN = 2;
/* index.html·weekly-brief.mjs 에서 갈래 배치 문구가 들어 있는 줄을 가려내는 표지 */
const SPREAD_LINE = /갈래|F~J|펼침|펼친|45개 번호|LAYOUT_RULES|layoutFor|layoutStats|spreadComplete|spreadOn|spareTitle|spareLabel|\blayout\b/;

const srcStrict = {};                          // 파일별 STRICT 대상 줄 수(0 이면 표지가 사라진 것 — 아래에서 알린다)
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
  let n = 0, nStrict = 0;
  let strictUntil = -1;                        // 이 줄 번호(0부터)까지 STRICT 를 건다
  t.split(/\r?\n/).forEach((ln, i) => {
    if (SPREAD_MARK.test(ln)) strictUntil = i + MARK_SPAN;
    const strict = i <= strictUntil;
    if (strict) nStrict++;
    if (!SPREAD_LINE.test(ln) && !strict) return;
    n++;
    if (BAN.test(ln)) err('S6', `${label}:${i + 1} 금지 문구`);
    if (THEORY.test(ln)) err('S6', `${label}:${i + 1} 화면에 새로 넣지 않는 이론값 낱말`);
    if (strict && STRICT.test(ln)) err('S6', `${label}:${i + 1} spread 문구에 효과를 말하는 낱말(확률·기대·높인·높여·올려·올라)`);
  });
  srcStrict[label] = nStrict;
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
/* layout: summary 와 week 가 둘 다 있으면 같아야 하고, 한쪽만 있으면 오류다(엔진 회귀로 한쪽만 빠지거나 다르게 찍히는 것을 드러낸다). */
const nz = (x) => (x === undefined || x === null) ? null : x;
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map((q) => [q, v[q]])) : v);
const layoutS = nz(SL.layout), layoutW = nz(WL.layout);
if (layoutS && layoutW && canon(layoutS) !== canon(layoutW)) err('S5', `summary.lotto.layout 과 week.lotto.layout 이 다름: ${canon(layoutS)} ≠ ${canon(layoutW)}`);
else if ((layoutS === null) !== (layoutW === null)) err('S5', `layout 이 ${layoutS ? 'summary' : 'week'} 에만 있음 (둘 다 있거나 둘 다 없어야 함)`);
const layout = layoutS || layoutW;
const force = has('--force-check');
const isSpread = !!(layout && layout.name === 'spread');
/* --expect-spread-from N: 대상 회차가 N 이상이면 spread 여야 한다(조용한 «건너뜀» 방지). */
const expectArg = arg('--expect-spread-from', null);
if (has('--expect-spread-from')) {
  const N = expectArg === null ? NaN : Number(expectArg);
  if (!Number.isInteger(N) || N < 1) fatal(`--expect-spread-from 값이 정수가 아님: ${JSON.stringify(expectArg)}`);
  if (!Number.isInteger(SL.next)) err('S5', `--expect-spread-from 인데 summary.lotto.next 가 정수가 아님: ${JSON.stringify(SL.next)}`);
  else if (SL.next >= N && !isSpread)
    err('S5', `대상 ${SL.next}회 ≥ ${N} 인데 layout 이 ${layout ? 'spread 가 아님(' + JSON.stringify(layout.name) + ')' : '없음'} — 구조 검사가 꺼져 있다`);
}

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
  let used = 0, maxOv = 0, pairs = 0, maxUse = 0, structOk = false;
  if (okAll) {
    const cnt = new Uint8Array(46), aCnt = new Uint8Array(46);
    picks.forEach((c, i) => c.forEach((n) => { cnt[n]++; if (i < 5) aCnt[n]++; }));
    const twice = [], missing = [], over = [], overAE = [], overFJ = [];
    for (let n = 1; n <= 45; n++) {
      if (cnt[n]) used++;
      if (cnt[n] > maxUse) maxUse = cnt[n];
      if (cnt[n] === 0) missing.push(n);
      if (cnt[n] >= 3) { over.push(n); (aCnt[n] >= 3 ? overAE : overFJ).push(n); }
      if (cnt[n] === 2) twice.push(n);
    }
    /* 45쌍 전수 겹침 */
    const bad = [], badAE = [], badFJ = [];
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
      const o = ov(picks[i], picks[j]);
      if (o > maxOv) maxOv = o;
      if (o === 1) pairs++;
      if (o >= 2) { const s = `${'ABCDEFGHIJ'[i]}${'ABCDEFGHIJ'[j]}=${o}`; bad.push(s); (j < 5 ? badAE : badFJ).push(s); }
      if (i >= 5 && o > 0) err('S3', `F~J 끼리 번호가 겹침: ${'ABCDEFGHIJ'[i]}${'ABCDEFGHIJ'[j]}=${o}`);
    }
    /* S4 이력 */
    const H = readJSON(historyP, 'history');
    const won = new Set((H.draws || []).map((d) => (d.numbers || []).slice().sort((a, b) => a - b).join(',')));
    if (won.size < 100) err('S4', `이력이 너무 짧음(${won.size}회) — 역대 1등 조합 대조 불가`);
    const wonIdx = [];
    picks.forEach((c, i) => { if (won.has(c.join(','))) { wonIdx.push(i); err('S4', `${'ABCDEFGHIJ'[i]} 줄이 역대 1등 조합: ${c.join(',')}`); } });
    const hLatest = H.meta && H.meta.latest;
    if (hLatest != null && SL.last != null && +hLatest !== +SL.last)
      notice(`참고 — 이력 최신 ${hLatest}회 ≠ summary.lotto.last ${SL.last}회(이력 갱신 순서 차이일 수 있음)`);

    structOk = used === 45 && maxUse <= 2 && maxOv <= 1 && wonIdx.length === 0;
    /* degraded 주 판정 — 엔진이 degraded=true 로 알렸고, 필드가 실측과 정확히 같고, 구조가 실제로 안 지켜졌을 때만(위 머리 설명).
       이때에 한해 «A~E 원인» 위반을 경고로 센다. 그 밖(degraded=false 인데 어긋남 포함)은 모두 오류다. */
    const degradedOk = !!(layout && layout.name === 'spread' && layout.degraded === true && !structOk &&
      layout.used === used && layout.maxOv === maxOv && layout.pairs === pairs);
    const aeNote = (id, m) => { if (degradedOk) aeWarn.push(`${id} ${m}`); else err(id, m); };

    /* S2 사용 */
    if (missing.length) err('S2', `쓰지 않은 번호 ${missing.length}개: ${missing.join(',')}`);
    if (overAE.length) aeNote('S2', `A~E 가 3번 이상 쓴 번호: ${overAE.join(',')}`);
    if (overFJ.length) err('S2', `F~J 때문에 3번 이상 쓰인 번호: ${overFJ.join(',')}`);
    if (!missing.length && !over.length && twice.length !== 15) err('S2', `2번 쓰인 번호가 ${twice.length}개 (15개여야 함)`);
    /* S3 겹침 */
    if (badFJ.length) err('S3', `F~J 가 낀 두 줄 겹침 ≥2: ${badFJ.slice(0, 8).join(' ')}${badFJ.length > 8 ? ' …' : ''}`);
    if (badAE.length) aeNote('S3', `A~E 쌍 겹침 ≥2 (≤1 이어야 함): ${badAE.slice(0, 8).join(' ')}${badAE.length > 8 ? ' …' : ''}`);
    /* «겹침이 1인 쌍 = 15» 는 A~E 가 정상(번호 ≤2번·겹침 ≤1)일 때의 결과값이다 — A~E 원인 위반이 이미 세어졌으면 따라오는 값이라 다시 세지 않는다. */
    const derived = degradedOk && (overAE.length > 0 || badAE.length > 0);
    if (!bad.length && pairs !== 15 && !derived) err('S3', `겹침이 1인 쌍이 ${pairs}개 (15개여야 함)`);
  }

  /* S5 필드 */
  if (!layout) {
    err('S5', 'layout 필드가 없습니다(--force-check)');
  } else {
    if (layout.name !== 'spread') err('S5', `layout.name=${JSON.stringify(layout.name)} (spread 가 아님; --force-check)`);
    if (!Number.isInteger(layout.from)) err('S5', `layout.from 이 정수가 아님: ${JSON.stringify(layout.from)}`);
    else if (Number.isInteger(SL.next) && layout.from > SL.next) err('S5', `layout.from(${layout.from}) > 대상 회차(${SL.next})`);
    if (okAll) {
      for (const [k, v] of [['used', used], ['maxOv', maxOv], ['pairs', pairs]])
        if (layout[k] !== v) err('S5', `layout.${k}=${JSON.stringify(layout[k])} ≠ 실측 ${v}`);
      if (layout.degraded !== !structOk) err('S5', `layout.degraded=${JSON.stringify(layout.degraded)} ≠ 실측 판정 ${!structOk}`);
    }
  }
}

/* 표지가 사라지면 STRICT 검사가 조용히 꺼진다 — 대상 줄이 0줄이면 오류로 드러낸다 */
for (const [label, c] of Object.entries(srcStrict)) if (c === 0) err('S6', `${label} 에서 spread 문구 표지(const spareLabel·spareTitle·spNote·prevSp·spreadOn·SP, dashSpareNote, SP 분기)를 찾지 못함 — 엄격 문구 검사 대상 0줄`);

console.log(`[S0~S6] ${isSpread || force ? '구조 검사' : '건너뜀(문구만)'} · 문구 대상 줄: index.html ${nLinesIdx}(엄격 ${srcStrict['index.html'] || 0}) · weekly-brief.mjs ${nLinesSrc}(엄격 ${srcStrict['weekly-brief.mjs'] || 0})`);
if (aeWarn.length) {
  for (const m of aeWarn.slice(0, 10)) console.log(`::warning title=check-spread::${esc('degraded 주 — A~E 원인 ' + m)}`);
  notice(`degraded 주 — A~E 원인 위반 ${aeWarn.length}건 (layout.degraded=true 이고 필드가 실측과 일치. 경고로만 세고${errors.length ? ' 다른 오류가 있어 실패' : ' F~J 쪽 불변식은 모두 통과해 exit 0'})`);
}
if (errors.length) {
  for (const m of errors.slice(0, 20)) console.log(`::error title=check-spread::${esc(m)}`);
  if (errors.length > 20) console.log(`::error title=check-spread::${esc(`…외 ${errors.length - 20}건`)}`);
  console.log(`::error title=check-spread::${esc(`갈래 배치 독립 검증 실패 — 오류 ${errors.length}건`)}`);
  process.exit(1);
}
notice(isSpread || force ? (aeWarn.length ? `갈래 배치 독립 검증 통과(degraded 주 — A~E 원인 경고 ${aeWarn.length}건)` : '갈래 배치 독립 검증 통과') : '문구 검사 통과 · 구조 검사 건너뜀');
process.exit(0);
