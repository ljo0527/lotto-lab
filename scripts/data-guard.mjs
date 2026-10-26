// scripts/data-guard.mjs — 로또 자료 수집 가드. «빠진 회차가 있는 자료로 추천·검증·커밋하지 않는다.»
//
// 왜 있나(2026-10-26): 최신 회차 끝자리가 7(1247 …)일 때 11회가 비는 자료로 추천·순위·모의 원장이 계산돼
// 과거 142회차의 추천이 달라지고 검증기가 줄줄이 실패했는데도 커밋·배포까지 갔다. 자세한 원인은 docs/bugfix-log.md.
//
// 쓰는 곳: rank-track · rank-tiers · validate · weekly-brief · backfill (계산 스크립트 5개).
//   · lottoApiWindow   — 모의 동행복권 API 의 창 계산. 실 API 처럼 하한(1회)에서 창을 위로 밀어 항상 10건을 준다.
//   · assertLottoRows  — 수집 직후(캐시를 읽은 직후에도) 1..latest 연속성 단언. 구멍이 있으면 Error.
//   · assertPageDb     — index.html 이 모의 API 로 채운 DB 가 1..latest 연속인지 단언. 구멍/최신 불일치면 Error.
//                        DB 의 출처(DB.source)가 «동행복권 공식 API», 곧 페이지 자신의 수집이 끝난 상태여야 한다.
// 이 파일은 Node 내장 모듈만 쓴다. check-*.mjs(독립 검증기)는 일부러 이 파일을 쓰지 않는다 — 검증기는 자기 코드로 센다.

/** 모의 API: center 의 창 = [lo, lo+9], lo = max(1, center-5). 실 API 는 center 3 → 1~10, center 7 → 2~11 을 준다. */
export function lottoApiWindow(rows, center) {
  const lo = Math.max(1, center - 5);
  return rows.filter((x) => +x.ltEpsd >= lo && +x.ltEpsd < lo + 10);
}

/** 1..latest 중 없는 정수 회차(오름차순). rounds 는 Set 또는 배열. */
export function findHoles(rounds, latest) {
  const set = rounds instanceof Set ? rounds : new Set(rounds);
  const out = [];
  for (let i = 1; i <= latest; i++) if (!set.has(i)) out.push(i);
  return out;
}

/** [6,7,8,11] → '6~8, 11' (너무 길면 앞 12덩어리만). */
export function fmtHoles(holes) {
  const parts = [];
  for (let i = 0; i < holes.length; ) {
    let j = i;
    while (j + 1 < holes.length && holes[j + 1] === holes[j] + 1) j++;
    parts.push(j > i ? holes[i] + '~' + holes[j] : String(holes[i]));
    i = j + 1;
  }
  return parts.slice(0, 12).join(', ') + (parts.length > 12 ? ' …' : '');
}

/** 수집한 {latest, rows} 가 1..latest 를 빠짐없이 담았는지. 통과하면 {latest, count}, 아니면 Error. */
export function assertLottoRows(lotto, label) {
  const rows = lotto && lotto.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error('[자료 구멍] ' + label + ': 로또 자료가 비어 있습니다');
  const set = new Set(rows.map((x) => +x.ltEpsd));
  let max = 0;
  for (const r of set) if (r > max) max = r;
  const latest = Math.max(+lotto.latest || 0, max);
  const holes = findHoles(set, latest);
  if (holes.length) {
    throw new Error('[자료 구멍] ' + label + ': 로또 1~' + latest + '회 중 빠진 회차 ' + holes.length + '개 (' + fmtHoles(holes)
      + ') — 이 자료로는 추천·검증·커밋을 하지 않습니다');
  }
  return { latest, count: set.size };
}

/** index.html 이 자기 수집(syncData)을 구멍 없이 끝냈을 때 DB.source 에 넣는 값(index.html 과 같아야 한다). */
export const PAGE_SOURCE = '동행복권 공식 API';

/**
 * index.html 을 띄운 page 의 DB 가 «모의 API 가 가진 전 회차» 와 같은지 본다.
 * 페이지는 수집(syncData)을 비동기로 하므로 최대 timeoutMs 동안 0.4초마다 다시 보고,
 * 끝내 구멍이 있거나 DB.latest 가 자료의 최신과 다르면 Error. (Playwright·shim 모두 쓰는 page.evaluate 만 사용)
 *
 * 출처 조건(PAGE_SOURCE): 페이지는 새 컨텍스트에서 수집(syncData)이 실패하면 init 이 loadLocalJSON() 으로 넘어가
 * 정적 서버가 내주는 커밋된 lotto-history.json 으로 DB 를 통째로 바꾼다. 그 파일이 연속이고 최신 회차가 같으면
 * 구멍·최신 검사만으로는 통과해 «수집 회귀» 가 가려진다. 그래서 페이지가 «자기 수집을 끝냈다» 는 표지
 * (index.html 은 구멍 없이 끝났을 때만 DB.source='동행복권 공식 API' 로 둔다)까지 요구한다.
 */
export async function assertPageDb(page, lotto, label, timeoutMs = 30000) {
  const expect = assertLottoRows(lotto, label + ' 자료').latest;
  const probe = ({ exp, src }) => {
    if (typeof DB === 'undefined' || !DB.draws) return { ok: false, latest: 0, n: -1, miss: [], source: '' };
    const miss = [];
    for (let i = 1; i <= exp; i++) if (!DB.draws[i]) miss.push(i);
    return { ok: miss.length === 0 && DB.latest === exp && DB.source === src, latest: DB.latest, n: miss.length, miss: miss.slice(0, 400), source: String(DB.source) };
  };
  const arg = { exp: expect, src: PAGE_SOURCE };
  const t0 = Date.now();
  let r = await page.evaluate(probe, arg);
  while (!r.ok && Date.now() - t0 < timeoutMs) {
    await new Promise((res) => setTimeout(res, 400));
    r = await page.evaluate(probe, arg);
  }
  if (!r.ok) {
    const why = r.n > 0
      ? '빠진 회차 ' + r.n + '개 (' + fmtHoles(r.miss) + ')'
      : r.n < 0 ? 'DB 가 만들어지지 않았습니다'
        : r.latest !== expect ? 'DB.latest=' + r.latest + ' ≠ 자료 최신 ' + expect
          : 'DB 출처가 «' + r.source + '» 입니다(페이지 자신의 수집이 끝나지 않았거나 백업 JSON 으로 대신 채워짐)';
    throw new Error('[자료 구멍] ' + label + ': 페이지 DB 1~' + expect + '회 — ' + why + ' (' + Math.round((Date.now() - t0) / 1000)
      + '초 기다림). 이 상태로는 추천·검증·커밋을 하지 않습니다');
  }
  return { latest: expect };
}
