# 매매 일지 규격 (`trade-1`)

기록 › 매매 일지의 계산 규격. 코드와 이 문서가 다르면 코드(`lotto-trade.js`)와 `scripts/check-trade.mjs` 가 기준이다.
표기: 사실 `[근거: 파일]` · 추론 `[추론]` · 불확실 `[확인 필요]`. 화면 숫자는 매주 바뀌므로 이 문서에는 고정 실적을 적지 않는다.

## 1. 무엇이고 왜 만들었나

- **재미용 모의 매매**다. 종목 4개가 매 회차 «그 직전 회차까지의 당첨번호만» 보고 줄을 내고, 펀드는 비중대로 K장을 산 셈 친다.
  - 최근 50회는 «지금 규칙을 과거에 적용한 재현(창)», 앞으로는 «추첨 전에 CI 가 적어 두는 일지»가 쌓인다.
- 어느 줄이든 당첨 확률은 같다(1/8,145,060). 이 일지는 확률을 바꾸지 않는다. 이번 주 A~E(나눠 갖는 인원을 줄이는 기존 추천)와는 별개다.
- 기준선은 **무작위 대조군의 실제 결과**다(무작위 종목, 무작위 20벌 띠). 이론값(기대값·평균 대기·σ·p·몬테카를로)은 화면에 두지 않는다(CLAUDE.md 규칙 9, 2026-10-26).
- 앞날 예측(«몇 회 뒤에 몇 등»)은 하지 않는다.

## 2. 파일과 데이터 흐름

```
lotto-history.json ──► scripts/trade-ledger.mjs ──► brief/trade-lotto.json ──► record.html  (기록 › 매매 일지)
 (동행복권 공식 API       (엔진 lotto-trade.js +                (CI 가 씀, 일지 append-only)  └► brief.html 「이번엔 이거?」 카드 (런타임 fetch)
  스냅샷, 연속 1..latest)   rank-core.js, vm 로드)                          ▲
                                            scripts/check-trade.mjs ───────┘ 엔진을 쓰지 않는 독립 재계산·탐침 (읽기 전용)
```

| 파일 | 역할 |
|---|---|
| `lotto-trade.js` | 엔진(루트). IIFE, `LOTTOTRADE` 전역. DOM 없음, `rank-core.js`(`RANKCORE.lotto`)에만 의존. 브라우저와 CI 가 같은 코드를 쓴다 |
| `scripts/trade-ledger.mjs` | CI 생성기. 정확 순위(`win`·`xr`)·무작위 20벌 띠를 모으고 일지를 관리하며 원자적으로 쓴다. 외부 접속·Playwright 없음 |
| `scripts/check-trade.mjs` | 독립 검증기. 엔진·`rank-core.js`·`data-guard.mjs` 를 계산에 쓰지 않고 §3 을 다시 구현해 대조한다 |
| `brief/trade-lotto.json` | 산출(봇이 씀, 손으로 고치지 않음). 새 추적 파일 1MB 미만 |
| `record.html` | `#trade` 섹션(빠른 길: JSON 즉시, 느린 길: 이 기기 재계산) |
| `scripts/weekly-brief.mjs` | 브리핑 카드 `#tradeTip`(런타임에 JSON 을 읽어 회차가 맞을 때만 보임) |
| `sw.js` | `lotto-trade.js` 를 PRECACHE 에 포함 |
| `.lab/e2e/run.mjs`(git 밖) | `trade-ledger`·`check-trade` 필수 단계, pass3 에서 `journal.rows` +1행 점검. 시작 전 작업 사본의 append-only 산출물(`brief/trade-lotto.json`·`rank-*`·`rank-params-*`·`rank-tiers-*`·`sim-*`)을 지워 캐시(1242회·합성 1243회)로 다시 쌓는다 — 저장소 사본(1247회)이 남으면 `rank-track` 이 건너뛰어 C2·C6 대조가 어긋난다 |

## 3. 모델

모든 결정은 `past(D,t)` 로만 읽는다(t 이상 회차를 읽으면 `RangeError`). 채점 함수만 `D[t]` 를 본다. 모듈 안에서 `Math.random`·`Date`·시간 예산 컷을 쓰지 않는다.

### 3.1 자료·범위
- `D[r] = {n:[6], b, a:[1~5등 1게임당 당첨금(원)], date}`. 입력은 `lotto-history.json` 의 `draws` 뿐이고 `1..latest` 가 연속이어야 한다. 구멍·형식 오류면 계산하지 않는다(CI 는 `exit 1`, 쓰기 없음).
- 계산 범위 `t = latest-59 … latest+1` = 예열 10 + 창 50 + 다음 1. 창은 `latest-49 … latest`.
- 패턴 문맥: 직전 50회의 겹침 수·합계·연속쌍 수·홀수 개수의 최빈값, 합계의 사분위(`q1=s[12]`, `q3=s[37]`).

### 3.2 종목 4개 = 스트림 (회차당 서로 다른 조합 최대 `KMAX=2000`줄, 매수 = 앞 k줄)

| 키 | 화면 이름 | 정의 |
|---|---|---|
| `pat` | 패턴 | 직전 회차 번호 중 `carry`개를 다시 쓰고 나머지는 새 번호, 합계 ∈ [q1,q3], 연속쌍 수 = 최빈값을 만족하는 조합을 시드 난수로 뽑는다 |
| `hot` | 자주 나온 번호 | 순위 탭과 같은 순서(`pageAdditive`). `w[n] = max(1, 최근 52회 출현 수)^2.2` |
| `cold` | 오래 쉰 번호 | 같은 방식, `w[n] = (1 + 쉰 회차 수)^1.6` |
| `rand` | 무작위(대조) | 시드 난수로 뽑은 6개. 규칙이 없는 대조 종목 — 다른 종목이 이것과 비슷하면 규칙이 한 일은 없는 것이다 |

- 난수는 `mulberry32`(회차·종목 시드, `seed(t,salt)=(imul(t,0x9E3779B1)^salt)>>>0`). 시드 소금과 모든 상수는 `LOTTOTRADE.CONF` 한 곳에 있다.
- 종목끼리 같은 조합이 나오면 그대로 산다(종목마다 따로 산 줄이라 장수에 모두 센다). 화면은 줄마다 종목 태그를 달아 나열할 뿐이고 «겹침» 같은 표시는 없다 [근거: record.html `tradeLines`·`tradeRoundCard`].

### 3.3 채점·상금
- 등수: 6개=1등, 5개+보너스=2등, 5개=3등, 4개=4등, 3개=5등(`rankOf` 와 같다).
- 상금은 **자료의 실제 등수 당첨금** `a[등수-1]` 이다. 0 이거나 없을 때만 `PRIZE_FB={4:50000, 5:5000}`(4·5등 정액)을 쓰고, 쓴 금액은 일지 행 `prizeUsed` 에 남긴다. 1~3등이 0(그 회차 해당 당첨자 없음)이면 금액 미상으로 보고 0원으로 센다(`fund` 의 `unk` 계수). 화면은 값 옆에 «?» 를 달지 않고, 누적 손익 그래프 아래 각주에만 «당첨자 없던 회차의 금액은 미상(?)이라 0원으로 셉니다(n건)» 을 적는다 [근거: record.html `tradeChartHTML`].
- 내 표가 당첨 분배를 바꾸는 효과는 무시한다(각주).

### 3.4 비중·배분 (종목 → 비중 → 주문)
- 점수 `sc_s(t)` = 직전 10회에서 기준 100줄 안의 3개 이상 일치를 `PT={3:1, 4:10, 5:100, 6:1000}` 로 센 합. 상금은 쓰지 않는다(사후 정정 위험, 입력은 당첨번호·보너스뿐).
- 비중 표시 `w_s=(sc_s+1)/Σ(sc_x+1)`(표시 전용).
- 배분 `alloc(sc,K)`: 종목마다 1장을 먼저 주고, 남은 `K-4`장을 한 장씩 점수가 높은 종목에 준다. 비교는 정수 교차곱이고 동률이면 앞 종목(`pat→hot→cold→rand`).
- K 칩은 `5·10·20·50·100`(기본 5). 1장 1,000원.
- **비중 효과**: 고르게 샀을 때(`alloc(0,K)`)와 회수금이 달랐던 회차 수·차액. K 가 작으면 거의 바뀌지 않는다는 사실을 숨기지 않는다.

### 3.5 손익·낙폭·가뭄·근사치
- `ret_t` = 산 줄의 상금 합, `net_t = ret_t - 1,000·K`, 누적 `E_t`. 최대 낙폭 `MDD = max(최고점 - E_t)`. 가뭄 = 마지막 회수 뒤 지난 회차 수(현재·최장·4등 이상).
- 회차마다 `f_s^m(t)` = 종목 스트림에서 m개 이상 일치가 처음 나온 줄 번호(2,000줄 안에 없으면 `null`). hot/cold 가 `null` 일 때만 CI 가 **정확한 첫 등장 순위** `xr` 를 구한다(`RANKCORE.lotto.rankAdditive`, 탐욕 최고점 조합). 1등 순위 `win` 은 `brief/rank-lotto.json` 에서 복사하고 없는 회차만 직접 구한다.

### 3.6 무작위 20벌 띠 (CI 전용)
- 창 50회 × 시드 20개 × 2,000줄 무작위 스트림. 시드마다 `BAND_KS = KS ∪ LADDER = [5,10,20,50,100,200,500,1000,2000]` 9칸별 «무작위만 K장» 손익·4등 횟수·첫 4등 회차, 그리고 사후 최소 장수 `k*`.
- 쓰임: ① 펀드 손익이 21개(무작위 20 + 펀드) 중 몇 위인지 ② 사후값의 무작위 범위. 띠가 없는 느린 길에서는 사후 줄을 숨기고 «CI 기록 뒤 표시» 문구를 둔다.

### 3.7 «5만원 이야기»·도전 사다리
- 이야기 4단(모두 실제 기록): 고른 K 의 첫 4개 이상 일치 → 미리 정한 장수 사다리(`LADDER`)에서 4등이 나온 가장 작은 장수 → **돌아보면(사후)** 종목별 최소 장수(옆에 무작위 20벌의 같은 값 범위) → 최근접. 쓴 돈을 함께 적는다.
- 도전 사다리: 5등→1등 각 줄에 고른 K 펀드의 첫 회차·횟수 또는 «아직 + 2,000줄 안 최근접».

### 3.8 «이번엔 이거?» 힌트 7줄
`carry`(재출현 개수) · `rep`(재출현 번호) · `gap`(가장 오래 쉰 번호) · `heat`(최근 10회 최다 번호) · `sum`(합계 구간) · `cons`(연속쌍) · `odd`(홀수 개수). 줄마다 제시, 근거 수치, **지난 50회 매 회차 같은 규칙으로 냈다면 몇 번 맞았나**(사후 채점), 기준선을 붙인다.
- 번호 힌트(`rep`·`gap`·`heat`)의 기준선은 **무작위 번호 20벌**(`numBand`)이다. 그 밖은 1..t-1 전체에서 실제로 센 빈도.
- 일지 행마다 7개 적중 여부를 남겨 «운빨 제시의 누적 성적»이 매주 쌓인다.

## 4. 산출 `brief/trade-lotto.json` (v1, `ver:"trade-1"`)

최상위 키(순서 고정): `v` `kind` `ver` `generated` `source` `conf` `selfTest` `window` `summary` `band` `journal` `checks`.

| 키 | 내용 |
|---|---|
| `source` | `{file, latest, count, digest}` — 입력 이력의 지문 |
| `conf` | `LOTTOTRADE.CONF` 그대로 |
| `selfTest` | 고정 합성 자료로 돌린 지문. 코드 상수 `GOLDEN` 과 같아야 한다(`Math.pow/log` 엔진 차이 감시) |
| `window` | `{from, to, digest, rows[50], next}` — 행은 종목별 head 20줄·희소 적중 기록·점수·문맥·힌트·`win`/`xr`, `next` 는 다음 회차 제시(주문 5장 `picks5` 포함) |
| `summary` | `K{5,10,20,50,100}`(손익·회수·최고 일치·MDD·가뭄·비중 효과·무작위 종목 단독·이야기), `ladder` `kstar` `tiers` |
| `band` | 무작위 20벌 `{n, K{9칸}, kstar4, digest}` |
| `journal` | `{from, missed[], rows[]}` — 아래 §5 |
| `checks` | 이번 실행의 계수기 `{kept, added, graded, pendingMismatch[], regradeMismatch[]}` |

- 쓰기: 임시 파일 → rename. 키 순서 고정, `window.rows`·`journal.rows` 는 **한 줄에 한 행**(git 차이를 작게). LF·UTF-8. 쓰기 직전 되읽어 같은지 확인하고 1MB 이상이면 쓰지 않는다.
- 멱등 비교에서 빼는 필드: `generated`, `journal.rows[].made/gradedAt`, `checks`.

## 5. 일지 규칙 (append-only)

일지 행: `{r, ver, status:"pending", made, basedOn, inputDigest, K, alloc, w, picks, top, ctx, hint}`. 채점되면 `drawDate`·`late`·`prizeUsed`·`res`·`gradedAt` 이 **덧붙는다**.

| 번호 | 규칙 |
|---|---|
| J1 채점 | `r ≤ latest` 인 pending 은 done 으로 바꾼다. `late = made ≥ 추첨일 20:00 KST`(= 같은 날 11:00Z, `CUTOFF_UTC_H`). late 행은 성적 집계에서 뺀다 |
| J2 빠진 주 | 마지막 일지 회차+1 … latest 사이에 행이 없으면 `missed[]` 에 적는다. 소급해서 만들지 않는다 |
| J3 새 제시 | `latest+1` 행이 없으면 pending 으로 추가한다. `ver = ruleFor(r).ver`, `inputDigest` = 1..latest 지문 |
| J4 동결 | 같은 `ver` 의 기존 pending 은 다시 계산해 대조만 한다. 다르면 `::warning` + `pendingMismatch`, 처음 공개한 값을 유지한다 |
| J5 재채점 | done 행은 매번 다시 채점해 대조만 한다(상금 사후 정정 포함). 다르면 `::warning` + `regradeMismatch` |
| J6 불변 | 행 삭제·재정렬 없음. `journal.from` 은 처음 값으로 고정 |
| 역행 가드 | `latest` 가 done 최대 회차보다 작거나 pending 회차가 `latest+1` 보다 크면 쓰지 않고 `wrote=false` 로 exit 0 + `::warning` |

- **규칙표 `RULES`** 는 덧붙이기만 한다. `LOTTOTRADE.CONF` 를 바꾸면 `VER` 을 올리고 `RULES` 에 `{ver, from}` 을 더한다 — 이미 쓴 행의 `ver` 로 옛 규칙이 남는다.
- 표본이 작은 동안(첫 기록 뒤 50회 전)에는 «재현(창)»을 주 화면으로, 일지 done 이 50회(`JOURNAL_PRIMARY_MIN`) 이상이면 일지를 주 화면으로 올린다.

## 6. 지문 (FNV-1a 32)

- `fnv(s)`: ASCII 만, `h=0x811c9dc5; h^=c; h=imul(h,0x01000193)>>>0` → `'fnv:'+소문자 16진 8자리`. 숫자는 10진 정수만. 구분자 `|` `:` `;` `,` `+` `\n`.
- `source.digest` = `fnv( Σ_{r=1..latest} "r:n1,n2,n3,n4,n5,n6+b;" )`. 일지 `inputDigest` 는 `basedOn` 까지의 같은 지문.
- `window.digest` = `fnv( VER "\n" + 창 50행(t 오름차순) + next 1행 )`. 행 = `t|pat:head,…;pos,…|hot:…|cold:…|rand:…|sc 4개|ctx 5개|hint.v 8개|적중 7자리|patOK\n`, `next` 행은 `N t|…` 에 head 까지만. `date`·`a`·`win`·`xr`·`hint.stat`·`picks5` 는 넣지 않는다. 브라우저가 재계산해 CI 값과 대조한다.
- `band.digest` = `fnv( "band-1\n" + Σ_j Σ_t "j|t|pos…\n" )`. CI 전용.
- 1247회 자료 기준 값: source `fnv:5fa209a1` · window `fnv:0c539d54` · band `fnv:c979e632`. 자료가 늘면 `node scripts/check-trade.mjs --root . --history lotto-history.json --print-digests` 로 새로 찍는다.

## 7. CI와 검증

`weekly.yml`(두 사본 `.github/workflows/` · `setup/workflows/` 가 같아야 한다):

1. `로또 전 회차 스냅샷` 바로 뒤 — `매매 일지`(`id: trade`, `continue-on-error`): `node scripts/trade-ledger.mjs --root . --history lotto-history.json --out brief/trade-lotto.json`. 같은 실행에서 막 갱신된 이력을 읽는다. `$GITHUB_OUTPUT` 에 `wrote=true|false`.
2. `매매 일지 독립 검증`(`id: checktrade`, `trade` 성공 + `wrote=true` 일 때): `node scripts/check-trade.mjs --root . --file brief/trade-lotto.json --history lotto-history.json --prev-git HEAD`.
3. `매매 일지 독립 검증` 바로 뒤, `결과 커밋` 앞 — `매매 일지 검증 실패 시 되돌림`(`if: steps.checktrade.outcome == 'failure'`): `git checkout HEAD -- brief/trade-lotto.json 2>/dev/null || rm -f brief/trade-lotto.json`. 독립 검증이 거부한 일지는 커밋하지 않는다 — 일지는 append-only 이고 C10 은 HEAD 와만 비교하므로, 잘못 쓰인 일지(done 행 변경·행 삭제·누수 산출)가 한 번 커밋되면 다음 주에는 그 상태가 기준이 되어 통과하고 잘못이 영구히 굳는다. 일지 파일만 HEAD 것으로 되돌리고(HEAD 에 없으면 — 첫 실행 — 지움) 브리핑 등 다른 산출물은 그대로 커밋된다.
4. `검증 보드 실패 표시` 뒤 — `매매 일지 실패 표시`: 둘 중 하나가 실패하면 `::error` 와 함께 잡을 실패로 표시(브리핑·검증은 커밋됨, 검증이 실패한 일지는 되돌려 커밋하지 않음).

- 커밋 화이트리스트는 그대로다(`brief/` 아래라 자동 포함). 추가 시간은 약 20초 안쪽 `[추론]`.

`check-trade.mjs` 검사 표(실패는 `::error title=check-trade::…` 한 줄, 종료 코드 0/1):

| 검사 | 내용 |
|---|---|
| C0 구조 | 키·창 50행 연속·head 20줄 서로 다름·pos 정렬·일지 순서/유일/pending ≤ 1 |
| C1 입력 | 이력 연속·형식, `source.digest` 재계산 |
| C2 가중치 | hot/cold 가중치 ↔ `rank-params-lotto.json` 상대오차 ≤ 1e-12 |
| C3 hot/cold 스트림 | 정수화(`2^bits`, 동점 사슬 ±6) 후 정확 열거로 head·pos·sc 재도출 |
| C4 pat/rand 스트림 | §3.2 절차를 자체 구현해 61회×2,000줄 재생성 |
| C5 집계 | sc·alloc·손익·MDD·가뭄·비중 효과·ladder·kstar·tiers·story·힌트 재계산 |
| C6 정확 순위 | `xr` 재구성·`win` ↔ `rank-lotto.json`·`best ≤ f ≤ worst` |
| C7 무작위 띠 | 20시드 재생성, 9칸·`band.digest`·`numBand` |
| C8 지문 | `source`·`window` 지문을 §6 바이트 규격으로 재계산 |
| C9 일지 | 연속성·상태 전이·done 재채점·`late`·`inputDigest`·`ver`. J4·J5 불일치는 경고만(처음 공개값 동결 원칙) |
| C10 append-only | `git show HEAD:brief/trade-lotto.json` 의 done 행과 바이트 동일, `journal.from` 동일, HEAD 의 `lotto-trade.js` `RULES` 와 접두 일치. git 이 없거나 HEAD 에 파일이 없으면 건너뜀 |
| C11 누수 탐침 | 61회 전부: t 이상 회차를 가짜로 바꿔도 head·ctx·hint 가 같아야 한다 (엔진 모듈을 «시험 대상»으로만 로드) |
| C12 결정성 | `runSync` 두 번 지문 동일, `Math.random`·`Date` 차단 후 동일, `selfTest()===GOLDEN` |
| C13 문구 | JSON·`record.html #tradeWrap`·`lotto-trade.js`·브리핑 `tradeTip` 에 금지 문구 0건 |

로컬 확인 순서와 완료 기준은 `CLAUDE.md` 3절 «매매 일지». 시험 산출은 `--out .lab/out-trade/…` 로 — `--out` 기본값은 추적 일지다.

## 8. 화면 `record.html#trade` (재사용 부품만, 표 없음)

제목·설명 → K 칩 5개 → KPI(투입·회수·손익·최고 일치·최대 낙폭·비중 효과) → 5만원 이야기 → 누적 손익 두 선(펀드 / 무작위만 K장) → 도전 사다리 → 종목 비중(같은 카드 안에 접이식 장수 사다리) → 이번엔 이거?(주문 5장·힌트 7줄) → 회차 카드(최근 10 + 더 보기 40) → 실제 제시 일지 → 꼬리(`#tradeMeta`).

- **빠른 길**: `ver` 과 `source.latest` 가 맞는 JSON 이면 즉시 그리고, 유휴 시간에 이 기기 재계산 지문을 `window.digest` 와 대조한다(«일치 ✓»). 불일치여도 표는 CI 값 그대로이고 꼬리에 «엔진 차이 가능» 을 쓴다.
- **느린 길**: JSON 이 없거나 낡았으면 «계산 중 n/61회차» 로 이 기기에서 계산한다. 이때 띠가 없으므로 사후 줄은 숨긴다.
- 자료 구멍이면 «자료 구멍 r회 — 계산하지 않습니다».
- 화면에서 뺀 것(10-26): 로또 탭 «300주 재현» 원장·등수 첫 도달 이론값 표·시뮬레이터 몬테카를로·평균 대기·이번 주 «기대 수령»/«한 장이라도 %»·백테스트 기대/σ, 기록 탭 모의 원장·교차 적중의 기대·p. `chanceEV` 등 CI 가 페이지 안에서 부르는 함수는 남겼다. `index.html#ledger` 링크는 `record.html#trade` 로 보낸다.

## 9. 바꿀 때

- 상수·규칙 변경: `VER` 올림 + `RULES` 덧붙임 + `GOLDEN` 재계산 + `check-trade` 같은 변경(독립 구현이라 따로 고친다) + 이 문서.
- 새 정적 파일을 `record.html` 이 읽게 되면 `sw.js` PRECACHE 와 `CACHE_NAME`.
- 워크플로를 고치면 두 사본 `diff -q`.
- 새 추적 파일은 `git add -N` 뒤 `node scripts/check-names.mjs`(추적 파일만 검사).

## 10. 남은 결정·위험

- 정수 로그표(엔진 독립 hot/cold 순서)로 바꿀 시점 — 보류. 휴대폰 등에서 «이 기기 재계산과 다름» 이 관측되면 `VER` 을 올려 도입한다 `[확인 필요: 실기기]`.
- 3단(소유자 판단 대기, 목록 정본은 `ROADMAP.md` 4-1 · `CLAUDE.md` 규칙 9): 번호 통계 탭의 출현 번호판 σ·미출현(GAP) 우연일 확률·동반쌍 기대/편차(σ)·합계 이론값(평균 138, 표준편차)·이월수 이론 기대값(0.8개), 추첨순서 탭의 χ²·p 표와 1/6·22/45 이론값·이론 기대 N회, `rank.html`(`rank-tiers-view.js`)의 점선(기대) ± 몬테카를로 표준편차 띠·pMC 표, 검증 보드·carryover 의 «300주 walk-forward» 문구, `validate.mjs --window 300`, 기록 탭 옛 모의 원장 접기. 모의 원장·교차 적중은 이론 기준선을 뺀 뒤 기준선 없는 관측값이다 `[확인 필요: 무작위 대조 원장은 backfill·check-sim 변경이라 3단]`.
- 첫 일지 행은 첫 CI 실행의 `latest+1` 회차다. 표본이 작은 동안 «백테스트를 실적처럼 읽는» 위험은 화면에 «재현(현 규칙을 과거에 적용)» 과 «n회 쌓임» 을 상시 두어 줄인다.

설계 정본(로컬, git 밖): `.lab/revamp/design-final.md` — 맨 끝 §13 «확정 패치» 가 앞 절보다 우선한다.

작성: 잼족
