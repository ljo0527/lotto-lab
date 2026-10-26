#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════
   trade-ledger.mjs — 매매 일지 CI 생성 스크립트 (설계 .lab/revamp/design-final.md §3·§4·§4.1·§5.3·§7·§13, U4)

   하는 일: lotto-history.json 만으로 «최근 50회 재현 + 다음 회차 제시» 를 만들어 brief/trade-lotto.json 에 쓴다.
     · Playwright·외부 접속 없음. 읽는 파일 = 이력(lotto-history.json) · rank-core.js · lotto-trade.js · (선택) brief/rank-lotto.json · 기존 out.
     · 계산은 모두 lotto-trade.js(엔진)가 한다. 이 파일은 CI 전용 부분(정확 순위 win·xr, 무작위 20벌 띠)을 엔진 함수로 모으고,
       일지(J1~J6, append-only)를 관리하고, 원자적으로 쓴다.
     · 독립 검증은 scripts/check-trade.mjs(엔진을 계산에 쓰지 않음)가 따로 한다.

   사용
     node scripts/trade-ledger.mjs --root . --history lotto-history.json --out brief/trade-lotto.json [--rank brief/rank-lotto.json] [--now ISO]
       --root     저장소 루트(rank-core.js · lotto-trade.js 가 있는 곳). 상대 경로 옵션은 모두 이 루트 기준.
       --history  로또 전 회차 스냅샷.                              기본 lotto-history.json
       --out      쓸 곳. 기존 파일이 있으면 일지를 이어 쓴다.        기본 brief/trade-lotto.json
       --rank     win(1등 순위)을 복사해 올 순위 추적 JSON.          기본 <root>/brief/rank-lotto.json (없으면 전부 직접 계산)
       --now      시험용 고정 시각(ISO). generated·made·gradedAt 에 쓴다. 기본 실제 현재 시각.
     종료 코드: 0 = 정상 또는 «역행 가드로 쓰지 않음»(wrote=false) · 1 = 실패(쓰기 없음).
     $GITHUB_OUTPUT 이 있으면 wrote=true|false 를 쓴다(워크플로의 독립 검증 단계 조건).

   절차(§5.3)
     1 엔진 로드(vm)   2 이력 normalize(구멍·형식 오류면 exit 1, 쓰기 없음)   3 기존 out 읽기(깨졌으면 exit 1, 덮어쓰지 않음 — 일지 보호)
     4 역행 가드(§4.1)  5 runSync   6 win(rank-lotto 복사, 없는 회차만 rankAdditive)   7 xr(f 가 null 인 칸만) · band(무작위 20벌)
     8 summary(KS 마다) + ladder·kstar·tiers   9 일지 J1~J5   10 원자적 쓰기(임시 파일 → rename)   11 $GITHUB_OUTPUT   12 ::notice

   설계 문장이 열어 둔 곳에서 고른 해석(바꾸려면 여기와 검사기를 같이 고친다)
     · checks.kept = 이번 실행 전에 있던 일지 행 중 이번에 채점·수정하지 않고 그대로 둔 행 수. 첫 실행은 0.
       checks 는 «이번 실행의 계수기» 라서 같은 입력의 두 번째 실행에서 kept·added 가 달라진다(멱등 비교 대상은 generated·made·gradedAt·checks 를 뺀 나머지).
     · checks.pendingMismatch / regradeMismatch = 문자열 배열("r=1248 picks" 꼴). 비어 있지 않으면 ::warning 도 낸다(J4·J5).
     · 일지 res.g = 등수(0 = 3개 미만, 1~5). prizeUsed = 맞힌 줄이 있는 등수 → 채점 때 쓴 1게임 상금(원). 1~3등 금액 미상이면 0.
     · selfTest() ≠ GOLDEN 이면 쓰지 않고 exit 1(일지는 한번 쓰면 못 고치므로, 엔진이 흔들린 채 동결하지 않는다).
     · 파일은 LF · UTF-8(BOM 없음). window.rows 와 journal.rows 는 한 줄에 한 행, 나머지는 2단까지 줄바꿈(git 차이를 작게).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const TITLE = 'trade-ledger';
const MAX_BYTES = 1000000;                                   // CLAUDE.md 규칙 4: 새로 추적하는 파일 하나는 1MB 미만
const NCOMBO = 8145060;
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

class Fail extends Error {}                                  // 예상된 실패: ::error 한 줄 + exit 1, 쓰기 없음

const state = { wrote: false };                              // finally 에서 $GITHUB_OUTPUT 으로 내보낸다

function parseArgs(argv) {
  const o = { root: '.', history: 'lotto-history.json', out: 'brief/trade-lotto.json', rank: null, now: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Fail(`${a} 값이 없습니다`); return argv[++i]; };
    switch (a) {
      case '--root': o.root = need(); break;
      case '--history': o.history = need(); break;
      case '--out': o.out = need(); break;
      case '--rank': o.rank = need(); break;
      case '--now': o.now = need(); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Fail('알 수 없는 옵션 ' + a);
    }
  }
  return o;
}

/* ═════════════ 엔진 로드 ═════════════ */
function loadEngine(root) {
  for (const f of ['rank-core.js', 'lotto-trade.js']) {
    const p = path.join(root, f);
    let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { throw new Fail(`${f} 를 읽을 수 없음: ${e.message}`); }
    try { vm.runInThisContext(src, { filename: p }); } catch (e) { throw new Fail(`${f} 로드 실패: ${e.message}`); }
  }
  const T = globalThis.LOTTOTRADE;
  if (!T || typeof T.runSync !== 'function') throw new Fail('LOTTOTRADE 전역이 없습니다(lotto-trade.js 로드 실패)');
  return T;
}

/* ═════════════ 직렬화 — 키 순서는 만든 순서 그대로, rows 는 한 줄에 한 행 ═════════════ */
const ROW_PATHS = new Set(['window.rows', 'journal.rows']);
const EXPAND_PATHS = new Set(['summary.K', 'band.K']);       // 한 단계 더 펼쳐서 K 칸마다 한 줄
function ser(v, depth, p) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const pad = (n) => '  '.repeat(n);
  if (Array.isArray(v) && ROW_PATHS.has(p)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => pad(depth + 1) + JSON.stringify(x)).join(',\n') + '\n' + pad(depth) + ']';
  }
  if (!Array.isArray(v) && (depth < 2 || EXPAND_PATHS.has(p))) {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{\n' + ks.map((k) => pad(depth + 1) + JSON.stringify(k) + ': ' + ser(v[k], depth + 1, p ? p + '.' + k : k)).join(',\n') + '\n' + pad(depth) + '}';
  }
  return JSON.stringify(v);
}

/* ═════════════ 일지 (J1~J6, 설계 §4.1) ═════════════ */
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arr = (a) => Array.from(a);

function buildJournal(T, D, latest, prev, next, nowIso, log) {
  const K0 = T.CONF.K0, STR = T.CONF.STRATS;
  const old = prev ? prev.journal.rows : [];
  const pendMis = [], regrMis = [];
  let graded = 0, added = 0;

  /* 얼린 주문(picks·top·hint.v)을 D[r] 로 채점 — 모든 값은 사실(맞힌 개수)이거나 현재 이력의 상금 */
  const gradeFrozen = (row) => {
    const r = row.r, d = D[r];
    if (!d || !Array.isArray(row.picks) || !row.top || !row.hint || !row.hint.v) throw new Fail(`일지 r=${r} 행 형식이 맞지 않습니다(picks·top·hint)`);
    const m = [], g = [];
    row.picks.forEach((p) => { const x = T.grade(p.c, d); m.push(x.hit); g.push(x.rank); });
    const prizeUsed = {};
    g.forEach((rk) => { if (rk > 0) prizeUsed[rk] = T.prize(d, rk); });
    let ret = 0; g.forEach((rk) => { if (rk > 0) ret += prizeUsed[rk]; });
    const top = {}; STR.forEach((s) => { top[s] = (row.top[s] || []).map((c) => T.grade(c, d).hit); });
    return { m, g, ret, best: Math.max(0, ...m), top, hintHit: T.gradeHints(row.hint.v, d, D[r - 1]), prizeUsed };
  };

  /* 새 제시(pending) 행 — 엔진의 next 행에서 만든다 */
  const pendingFrom = (nx) => ({
    r: nx.t, ver: T.ruleFor(nx.t).ver, status: 'pending', made: nowIso, basedOn: nx.t - 1,
    inputDigest: T.sourceDigest(D, nx.t - 1), K: K0, alloc: T.alloc(nx.sc, K0), w: T.weights(nx.sc),
    picks: nx.picks5.map((p) => ({ s: p.s, i: p.i, c: arr(p.c) })),
    top: T.topLines(nx, 5), ctx: { carry: nx.ctx.carry, q1: nx.ctx.q1, q3: nx.ctx.q3, cons: nx.ctx.cons, odd: nx.ctx.odd },
    hint: { v: JSON.parse(JSON.stringify(nx.hint.v)) }
  });

  const rows = [];
  for (const row of old) {
    /* J1 채점: r ≤ latest 인 pending → done (얼린 주문으로, 처음 공개한 값 그대로) */
    if (row.status === 'pending' && row.r <= latest) {
      const drawDate = D[row.r].date;
      if (!/^\d{8}$/.test(String(drawDate))) throw new Fail(`일지 r=${row.r}: 이력에 추첨일(date)이 없어 마감 판정(늦음)을 할 수 없습니다`);
      const cutoff = Date.UTC(+drawDate.slice(0, 4), +drawDate.slice(4, 6) - 1, +drawDate.slice(6, 8), T.CONF.CUTOFF_UTC_H, 0, 0);
      const g = gradeFrozen(row);
      rows.push(Object.assign({}, row, {
        status: 'done', drawDate, late: Date.parse(row.made) >= cutoff, prizeUsed: g.prizeUsed,
        res: { m: g.m, g: g.g, ret: g.ret, best: g.best, top: g.top, hintHit: g.hintHit }, gradedAt: nowIso
      }));
      graded++;
      continue;
    }
    rows.push(row);
  }

  /* J5 재채점 대조: 이미 done 이던 행만(방금 채점한 행은 같은 입력이라 대조할 필요가 없다). 처음 공개한 값은 그대로 두고 경고만 */
  old.forEach((row) => {
    if (row.status !== 'done' || !row.res) return;
    try {
      const g = gradeFrozen(row), res = row.res, diffs = [];
      ['m', 'g', 'best', 'top', 'hintHit'].forEach((k) => { if (!sameJSON(res[k], g[k])) diffs.push(k + ' ' + JSON.stringify(res[k]) + '→' + JSON.stringify(g[k])); });
      if (res.ret !== g.ret) diffs.push(`ret ${res.ret}→${g.ret}`);
      Object.keys(row.prizeUsed || {}).forEach((k) => { if (g.prizeUsed[k] !== undefined && row.prizeUsed[k] !== g.prizeUsed[k]) diffs.push(`prizeUsed[${k}] ${row.prizeUsed[k]}→${g.prizeUsed[k]}`); });
      if (diffs.length) { regrMis.push(`r=${row.r} ${diffs[0]}`); log.warn(`J5 재채점이 처음 채점과 다름 r=${row.r}: ${diffs.join(' / ')} — 기존 값을 유지합니다`); }
    } catch (e) {
      if (e instanceof Fail) throw e;
      regrMis.push(`r=${row.r} 채점 불가`); log.warn(`J5 r=${row.r} 재채점 실패: ${e.message}`);
    }
  });

  /* J2 빠진 주: 마지막 일지 회차+1 .. latest 에 행이 없으면 missed (소급해서 만들지 않는다) */
  const missed = prev ? prev.journal.missed.slice() : [];
  const lastR = rows.reduce((m, x) => Math.max(m, x.r), 0);
  for (let r = Math.max(lastR + 1, 1); r <= latest; r++) if (rows.length && !missed.includes(r) && !rows.some((x) => x.r === r)) missed.push(r);

  /* J3 새 제시 / J4 동결: latest+1 행이 있으면 다시 계산해 대조만 한다 */
  const fresh = pendingFrom(next), have = rows.find((x) => x.r === next.t);
  if (!have) { rows.push(fresh); added++; }
  else if (have.status === 'pending' && have.ver === fresh.ver) {
    const diffs = ['inputDigest', 'alloc', 'w', 'picks', 'top', 'ctx', 'hint'].filter((k) => !sameJSON(have[k], fresh[k]));
    if (diffs.length) { pendMis.push(`r=${have.r} ${diffs.join(',')}`); log.warn(`J4 얼린 제시가 지금 재계산과 다름 r=${have.r}: ${diffs.join(',')} — 처음 공개한 값을 유지합니다`); }
  }

  const from = prev ? prev.journal.from : next.t;           // J6: 처음 값 고정
  return {
    journal: { from, missed, rows },
    checks: { kept: old.length - graded, added, graded, pendingMismatch: pendMis, regradeMismatch: regrMis }
  };
}

/* 기존 out 검증 — 일지를 이어 쓸 수 있는 모양이 아니면 건드리지 않고 실패한다 */
function readPrev(outPath) {
  if (!fs.existsSync(outPath)) return null;
  let text; try { text = fs.readFileSync(outPath, 'utf8'); } catch (e) { throw new Fail(`기존 ${outPath} 를 읽을 수 없어 덮어쓰지 않습니다: ${e.message}`); }
  let j; try { j = JSON.parse(text); } catch (e) { throw new Fail(`기존 ${outPath} 가 JSON 이 아니라 덮어쓰지 않습니다(일지 보호): ${e.message}`); }
  const jr = j && j.journal;
  if (!j || j.kind !== 'trade-lotto' || !jr || !Array.isArray(jr.rows) || !Array.isArray(jr.missed) || !Number.isInteger(jr.from) || !jr.rows.length) {
    throw new Fail(`기존 ${outPath} 의 모양이 매매 일지(trade-lotto)가 아니라 덮어쓰지 않습니다`);
  }
  let pr = 0;
  for (const r of jr.rows) {
    if (!r || !Number.isInteger(r.r) || r.r <= pr || (r.status !== 'pending' && r.status !== 'done')) throw new Fail(`기존 일지 행 r=${r && r.r} 이 오름차순·유일·상태(pending/done)가 아니라 덮어쓰지 않습니다`);
    pr = r.r;
  }
  return j;
}

/* ═════════════ 본체 ═════════════ */
function main() {
  const t00 = performance.now(), lap = {};
  const tick = (k) => { const t = performance.now(); lap[k] = Math.round(t - (tick.t || t00)); tick.t = t; };
  const log = {
    warn: (m) => console.log(`::warning title=${TITLE}::${esc(m)}`),
    info: (m) => console.log(`${TITLE}: ${m}`)
  };

  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log('사용: node scripts/trade-ledger.mjs --root . --history lotto-history.json --out brief/trade-lotto.json [--rank brief/rank-lotto.json] [--now ISO]'); return; }
  const root = path.resolve(opt.root), res = (p) => path.resolve(root, p);
  const histPath = res(opt.history), outPath = res(opt.out);
  let nowIso;
  if (opt.now == null) nowIso = new Date().toISOString();
  else { const ms = Date.parse(opt.now); if (!Number.isFinite(ms)) throw new Fail(`--now ${opt.now} 가 ISO 시각이 아닙니다`); nowIso = new Date(ms).toISOString(); }

  /* 1~2 엔진 · 이력 */
  const T = loadEngine(root);
  let hist; try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { throw new Fail(`이력 ${histPath} 를 읽을 수 없거나 JSON 이 아닙니다: ${e.message}`); }
  let D, latest;
  try { ({ D, latest } = T.normalize(hist)); }
  catch (e) {
    const m = /^(gap|bad) (\d+)$/.exec(e.message);
    throw new Fail(m ? (m[1] === 'gap' ? `자료 구멍 ${m[2]}회 — 1..latest 가 연속이 아니어서 계산하지 않습니다` : `자료 형식 오류 ${m[2]}회 — 번호·보너스·당첨금 형식이 맞지 않아 계산하지 않습니다`) : `이력을 읽을 수 없습니다: ${e.message}`);
  }
  tick('load');

  /* 3~4 기존 out · 역행 가드 */
  const prev = readPrev(outPath);
  if (prev) {
    const doneMax = prev.journal.rows.reduce((m, x) => (x.status === 'done' ? Math.max(m, x.r) : m), 0);
    const pendMax = prev.journal.rows.reduce((m, x) => (x.status === 'pending' ? Math.max(m, x.r) : m), 0);
    if (latest < doneMax || pendMax > latest + 1) {
      log.warn(`역행 가드: 이력 latest ${latest} 가 기존 일지(채점 완료 ${doneMax ? '최대 ' + doneMax + '회' : '없음'}, 대기 ${pendMax ? pendMax + '회' : '없음'})보다 뒤처졌습니다 — 파일을 쓰지 않습니다`);
      return;
    }
  }

  /* 5 본 계산 */
  const st = T.selfTest();
  if (st !== T.GOLDEN) throw new Fail(`selfTest ${st} ≠ GOLDEN ${T.GOLDEN} — 엔진 계산이 기준과 달라 일지를 동결하지 않습니다`);
  let run;
  try { run = T.runSync(D, { to: latest }); }
  catch (e) { throw new Fail(`계산 실패: ${e.message}`); }
  const W = run.window, wrows = W.rows, next = W.next;
  tick('scan');

  /* 6 win — rank-lotto.json 복사, 없거나 어긋난 회차만 직접 */
  let rankBy = new Map();
  const rankPath = opt.rank ? res(opt.rank) : res('brief/rank-lotto.json');
  if (fs.existsSync(rankPath)) {
    try {
      const rk = JSON.parse(fs.readFileSync(rankPath, 'utf8'));
      for (const rr of (rk && Array.isArray(rk.rows) ? rk.rows : [])) if (rr && Number.isInteger(rr.round)) rankBy.set(rr.round, rr);
    } catch (e) { log.warn(`순위 추적 ${rankPath} 를 읽을 수 없어 win 을 전부 직접 계산합니다: ${e.message}`); rankBy = new Map(); }
  } else if (opt.rank) log.warn(`--rank ${rankPath} 가 없어 win 을 전부 직접 계산합니다`);
  let nCopy = 0, nCalc = 0;
  const winOf = (t, s) => {
    const rr = rankBy.get(t), g = rr && rr.ranks && rr.ranks[s];
    if (g && Number.isInteger(g.best) && Number.isInteger(g.worst) && g.best >= 1 && g.best <= g.worst && g.worst <= NCOMBO
        && (!Array.isArray(rr.win) || rr.win.join() === D[t].n.join())) { nCopy++; return [g.best, g.worst]; }
    nCalc++; return T.exactRank(T.past(D, t), D[t], t, s, 6);
  };

  /* 7 xr — 2,000줄 안에 m개 이상이 없는 hot/cold 칸만 정확한 첫 등장 순위 */
  const fOf = (p, m) => { for (let q = 0; q < p.length; q++) if (T.hitOfCode(p[q] & 7) >= m) return p[q] >> 3; return null; };
  let nXr = 0;
  const rows = wrows.map((r) => {
    const win = {}, xr = {};
    const P = T.past(D, r.t);
    for (const s of ['hot', 'cold']) {
      win[s] = winOf(r.t, s);
      const x = {};
      for (const m of [4, 5]) if (fOf(r.s[s].p, m) === null) { x[m] = T.exactRank(P, D[r.t], r.t, s, m); nXr++; }
      if (Object.keys(x).length) xr[s] = x;
    }
    return { t: r.t, date: r.date, n: r.n, b: r.b, a: r.a, sc: r.sc, s: r.s, ctx: r.ctx, hint: r.hint, patOK: r.patOK, win, xr };
  });
  tick('exact');
  const band = T.band(D, { to: latest });
  tick('band');

  /* 8 요약 */
  const summary = T.summarize(rows, { band });
  tick('summary');

  /* 9 일지 */
  const { journal, checks } = buildJournal(T, D, latest, prev, next, nowIso, log);

  /* 조립 — 키 순서는 설계 §4 */
  const out = {
    v: 1, kind: 'trade-lotto', ver: T.VER, generated: nowIso,
    source: { file: path.basename(histPath), latest, count: latest, digest: T.sourceDigest(D, latest) },
    conf: JSON.parse(JSON.stringify(T.CONF)), selfTest: st,
    window: { from: W.from, to: W.to, digest: W.digest, rows, next },
    summary, band, journal, checks
  };

  /* 10 쓰기 — 직렬화가 값을 바꾸지 않았는지 되읽어 확인하고, 크기를 보고, 임시 파일 → rename */
  const text = ser(out, 0, '') + '\n';
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(out)) throw new Fail('직렬화 점검 실패(되읽은 값이 원본과 다름) — 쓰지 않습니다');
  const bytes = Buffer.byteLength(text);
  if (bytes >= MAX_BYTES) throw new Fail(`산출 크기 ${bytes}바이트 ≥ 1MB (CLAUDE.md 규칙 4) — 쓰지 않습니다`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, outPath); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* 임시 파일이 없으면 그만 */ } throw new Fail(`쓰기 실패: ${e.message}`); }
  state.wrote = true;
  tick('write');

  /* 12 알림 */
  const late = journal.rows.filter((x) => x.late === true).length;
  log.info(`${(performance.now() - t00 | 0)}ms (읽기 ${lap.load} · 스캔 ${lap.scan} · 정확순위 ${lap.exact} · 띠 ${lap.band} · 요약 ${lap.summary} · 쓰기 ${lap.write}) · win 복사 ${nCopy}/직접 ${nCalc} · xr ${nXr}칸 · ${bytes}바이트 → ${outPath}`);
  console.log(`::notice title=매매 일지::${esc(`${next.t}회 제시 · 창 ${W.from}~${W.to} · 지문 ${W.digest} · 일지 ${journal.rows.length}행(늦음 ${late}) · 추가 ${checks.added} · 채점 ${checks.graded}`)}`);
}

/* 11 $GITHUB_OUTPUT 은 어떤 경로로 끝나든 한 번 쓴다 */
function emitOutput() {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, `wrote=${state.wrote ? 'true' : 'false'}\n`); }
  catch (e) { console.log(`::warning title=${TITLE}::GITHUB_OUTPUT 에 쓸 수 없음: ${esc(e.message)}`); }
}

try { main(); }
catch (e) {
  if (e instanceof Fail) {
    console.log(`::error title=${TITLE}::${esc(e.message)}`);
    console.error(`${TITLE}: ${e.message}`);
  } else {
    console.log(`::error title=${TITLE}::${esc('예기치 않은 오류: ' + (e && e.message))}`);
    console.error(e && e.stack ? e.stack : String(e));
  }
  process.exitCode = 1;
}
emitOutput();
