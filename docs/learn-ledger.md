# 학습 장부 규격 (`learn-1`)

기록 › «낙첨 분석 · 학습 실험실» 의 계산 규격. 코드와 이 문서가 다르면 코드(`scripts/learn-ledger.mjs`)와 `scripts/check-learn.mjs` 가 기준이다.
표기: 사실 `[근거: 파일]` · 추론 `[추론]` · 불확실 `[확인 필요]`. 화면 숫자는 매주 바뀌므로 이 문서에는 고정 실적을 적지 않는다.
일지 틀은 매매 일지(`docs/trade-ledger.md`, CLAUDE.md 규칙 15)와 같다.

## 1. 무엇이고 왜 만들었나

- **낙첨 분석**: 이번 주 추천 10줄(`rec`)이 «같은 주 무작위 대조군»보다 뚜렷이 나쁜지 본다. 로또는 대부분의 주가 0줄이라 «떨어진 것»만으로는 운인지 버그인지 알 수 없다. 대조군의 실제 결과와 견줘 **버그만 가려낸다**.
- **관문 있는 학습 실험실**: 후보 신호 4개(`hot` `cold` `gap` `repeat`)를 **추첨 전에 사전 등록**하고 추첨 뒤에 채점한다. 52주 이상 쌓이고 대조군의 가장 위쪽 끝에 들 때만 «채택 조건 충족» 을 표시한다.
- 둘은 **하나의 append-only 장부**(`brief/learn-lotto.json`)에 쌓는다. 한 회차 행에 추천 10줄과 신호별 10줄이 함께 얼려진다.
- **«채택» 은 상태 표시와 CI 알림(`::notice`)까지다.** 추천 코드(`portfolioPick`·`PORTFOLIO_RULES`)를 자동으로 바꾸지 않는다 — 반영은 소유자 결정이다.
- 어느 줄이든 당첨 확률은 같다. 이 장부는 확률을 바꾸지 않는다. 앞날 예측은 하지 않는다.
- 화면의 기준선은 **무작위 대조군의 실제 결과**(순위·범위)뿐이다. 이론값(기대값·σ·p값·몬테카를로·정확 확률)은 화면에 두지 않는다(규칙 9). 검증기·JSON 내부의 정수 비교는 제한이 없다.

## 2. 파일과 데이터 흐름

```
lotto-history.json ──┐
brief/latest-summary.json (이번 주 추천 10줄) ──┼─► scripts/learn-ledger.mjs ──► brief/learn-lotto.json ──► record.html (기록 › 낙첨 분석 · 학습 실험실)
brief/sim-lotto.json (재현의 rec = A~E 5줄) ──┘     (CI 가 씀, 일지 append-only)            ▲
                                      scripts/check-learn.mjs ──────────────────────────┘  생성기를 쓰지 않는 독립 재계산 (읽기 전용)
```

| 파일 | 역할 |
|---|---|
| `scripts/learn-ledger.mjs` | CI 생성기. 신호·대조군·채점·관문·재현을 계산하고 일지를 관리하며 원자적으로 쓴다. 외부 접속 없음. import 하면 main 이 바로 돈다 |
| `scripts/check-learn.mjs` | 독립 검증기. 생성기를 import 하지도 실행하지도 않고 §3~§7 을 다시 구현해 대조한다(정적 점검 L8 만 생성기 소스를 «글자로» 읽는다) |
| `brief/learn-lotto.json` | 산출(봇이 씀, 손으로 고치지 않음). 새 추적 파일 1MB 미만(규칙 4) |
| `record.html` | `#learnWrap`(카드 2개). `fetch(no-store)` → 모양 점검 → 채움. 파일이 없거나 모양이 어긋나면 섹션째 숨김 |
| `docs/learn-ledger.md` | 이 문서 |

## 3. 모델

모든 신호 계산은 `past(D,t)` = 1..t-1 회차만 읽는다(t 이상을 읽으면 `RangeError`). 채점만 `D[t]` 를 본다. 결정 함수에서 `Math.random`·`Date` 를 쓰지 않는다. `Date` 는 `generated`·`made`·`gradedAt` 기록과 마감 계산(`Date.UTC`·`Date.parse`)에만 쓰고, 시험용으로 `--now <ISO>` 를 받는다.

### 3.1 자료·줄·기본 식

- `D[r] = {n:[6 오름차순], b:보너스, date:"YYYYMMDD"}`. 입력은 `lotto-history.json` 의 `draws` 이고 `1..latest` 가 연속이어야 한다. 구멍·중복·형식 오류면 계산하지 않는다(`exit 1`, 쓰기 없음).
- **줄** = 1..45 에서 서로 다른 6개, 문자열 `"a,b,c,d,e,f"`(오름차순). 맞힌 개수 `m` = 줄 ∩ 당첨 6개(보너스 제외). 보너스는 `bo`(0/1)로 따로 적는다(5개+보너스 = 2등 구분용).
- **«맞힌 줄»** = `m ≥ MIN_HIT(3)`. 한 주의 점수 `g3` = 그 주 10줄 중 맞힌 줄의 수(0~10).
- 난수: `mulberry32(seed)`(`a=(a+0x6D2B79F5)>>>0; t=imul(a^(a>>>15),1|a); t=(t+imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/2^32`).
  - 신호 시드 `seed(t,salt) = (imul(t,0x9E3779B1) ^ salt) >>> 0`. 소금은 `CONF.SALT` 한 곳(`hot` `cold` `gap` `repeat`).
  - 대조군 시드 `seedCtrl(t,j) = (imul(t,0x9E3779B1) ^ imul(j,CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0`, `j = 1..R`.

### 3.2 신호 4개 (사전 등록 · 정수 연산 · 동점은 작은 번호 우선)

`cnt[n]` = 직전 `W=50`회(`t-50..t-1`)에서 번호 `n` 의 출현 수(보너스 제외). `last[n]` = 1..t-1 에서 `n` 이 마지막으로 나온 회차(한 번도 없으면 0).

| 신호 | 점수(앞 순서) | 풀 |
|---|---|---|
| `hot` 자주 나온 번호 | `cnt` 큰 순 | 상위 15개 |
| `cold` 적게 나온 번호 | `cnt` 작은 순 | 상위 15개 |
| `gap` 오래 쉰 번호 | `last` 작은 순(가장 오래 안 나온 순) | 상위 15개 |
| `repeat` 직전 번호 다시 | 직전 회차(`t-1`) 6개 먼저, 그다음 `cnt` 큰 순 | 직전 6개 + 9개 = 15개 |

- 모든 정렬의 마지막 동점 처리는 번호가 작은 쪽이 앞이다. 풀은 번호 오름차순으로 저장한다(`sig.<s>.pool`).
- **줄 10개**: `rng = mulberry32(seed(t, salt[s]))`. 줄마다 `a = 풀 복사본(15개)`, `i=0..5` 에 대해 `j = i + floor(rng()*(15-i)); swap(a[i],a[j])` 하고 앞 6개를 오름차순으로 적는다. 같은 줄이 이미 있으면 버리고 다시 뽑는다(서로 다른 10줄). 풀 15개에서 나올 수 있는 조합은 5,005 개라 끝난다.

### 3.3 무작위 대조군

- 같은 주마다 `R=1000` 벌. 벌 `j` 는 `rng = mulberry32(seedCtrl(t,j))` 에서 줄 10개를 차례로 뽑는다: 줄마다 `a = [1..45]`, `i=0..5` 에 대해 `k = i + floor(rng()*(45-i)); swap(a[i],a[k])`, 앞 6개가 그 줄이다(균등 무작위·서로 다른 6개). 줄끼리 같은 줄이 나올 수 있고 확률은 무시할 만큼 작아 막지 않는다.
- 벌의 값 = 그 벌 10줄 중 맞힌 줄의 수. **벌별 원값은 저장하지 않는다**(시드로 다시 만든다). 행에는 분포(히스토그램)만 둔다.
- 재현에서 `rec`(A~E 5줄)와 견줄 때는 같은 벌의 **앞 5줄**만 센다(줄 수를 맞춘다).
- 추천 10줄은 «어느 두 줄도 2개 이상 겹치지 않게» 펼친 줄이라 같은 수의 독립 무작위 줄보다 맞힌 줄 수의 흩어짐이 작다 `[추론]` — 대조군이 더 넓게 흩어지므로 경보 쪽에서는 보수적(오경보가 줄어드는 쪽)이다.

### 3.4 누적 대 대조군 `stat` (관문·재현 공통)

내 누적 `cum`(맞힌 줄 수의 합)과 대조군 `R` 벌의 같은 기간 누적 `c_1..c_R` 을 견준다.

| 필드 | 뜻 |
|---|---|
| `weeks` | 집계한 주 수 |
| `cum` | 내 누적 |
| `n` | 대조군 벌 수 `R` |
| `min` `med` `max` | 대조군 누적의 최솟값 · 가운데(정렬 `floor((R-1)/2)` 번째) · 최댓값 |
| `rank` | `1 + #{c_j > cum}` — 큰 값이 앞. `R+1` 이면 대조군 전체보다 낮다 |
| `tie` | `#{c_j == cum}` 같은 값인 벌 수 |
| `le` `ge` | `#{c_j ≤ cum}` · `#{c_j ≥ cum}` |
| `hist` | `[[값, 벌 수], …]` 값 오름차순 |

꼬리 비율은 `(1 + le)/(R+1)`(낮은 쪽) · `(1 + ge)/(R+1)`(높은 쪽)이고 **정수 곱셈으로 견준다**(부동소수 없음).

## 4. 산출 `brief/learn-lotto.json` (v1, `ver:"learn-1"`)

최상위 키(순서 고정): `v` `kind` `ver` `generated` `source` `conf` `rules` `summary` `journal` `checks`.

| 키 | 내용 |
|---|---|
| `kind` | `"learn-lotto"` |
| `source` | `{file, latest, count, digest}` — 입력 이력의 지문(FNV-1a 32: `Σ_{r=1..latest} "r:n1,…,n6+b;"`, `fnv:` + 소문자 16진 8자리. `trade-ledger` 와 같은 규격) |
| `conf` | `CONF` 그대로 |
| `rules` | `RULES` 그대로 `[{ver, from, signals[]}]` — 덧붙이기만 |
| `summary` | `{next, live:{done,late,counted,pending}, gate, replay}` — **매 실행 다시 계산하는 파생값** |
| `journal` | `{from, missed[], rows[]}` — §5. 행은 **한 줄에 한 행** |
| `checks` | 이번 실행의 계수기 `{kept, added, graded, pendingMismatch[], regradeMismatch[]}` |

일지 행(pending): `{r, ver, status:"pending", made, basedOn, inputDigest, rec?:{lines[10]}, sig:{hot:{pool[15],lines[10]}, cold, gap, repeat}}`.
채점되면(done) `drawDate`·`late`·`res`·`gradedAt` 이 **덧붙는다**: `res = {n[6], bonus, rec?:{m[10],bo[10],g3}, sig:{<신호>:{m,bo,g3}}, ctrl:{n:R, h[11]}}`. `ctrl.h[k]` = 그 주 대조군 `R` 벌 중 맞힌 줄이 `k` 개인 벌의 수.

- 쓰기: 임시 파일 → rename. LF·UTF-8. 직렬화 뒤 되읽어 같은지 확인하고 **쓰기 직전에 1MB 미만**인지 본다. `$GITHUB_OUTPUT` 에 `wrote=true|false`.
- 멱등 비교에서 빼는 필드: `generated`, `journal.rows[].made/gradedAt`, `checks`.
- 크기: 한 주에 약 1.9KB 늘어난다(추천 줄이 있을 때, 합성 52주 실측). 1년 뒤 약 105KB, 1MB 에는 약 9~10년 뒤 닿는다 `[추론]`. 닿기 전에 §11 의 «장부 갈아타기» 를 한다.

## 5. 일지 규칙 (append-only)

| 번호 | 규칙 |
|---|---|
| J1 채점 | `r ≤ latest` 인 pending 은 done 으로 바꾼다. `late = made ≥ 추첨일 11:00Z`(= 20:00 KST, `CONF.CUTOFF_UTC_H`). late 행은 관문 집계에서 뺀다 |
| J2 빠진 주 | 마지막 일지 회차+1 … latest 사이에 행이 없으면 `missed[]` 에 적는다. **소급해서 만들지 않는다** |
| J3 새 제시 | `latest+1` 행이 없으면 pending 으로 추가한다. `ver = ruleFor(r).ver`, `inputDigest` = 1..latest 지문, `rec` 는 추천 요약의 `lotto.next === r` 일 때만 넣고 아니면 `rec` 없이 쓰고 `::warning` |
| J4 동결 | 같은 `ver` 의 기존 pending 은 다시 계산해 대조만 한다(신호·`rec`·`inputDigest`). 다르면 `::warning` + `pendingMismatch`, **처음 값을 유지**한다 |
| J5 재채점 | done 행은 매번 다시 채점해 대조만 한다. 다르면 `::warning` + `regradeMismatch` |
| J6 불변 | 행 삭제·재정렬 없음, done 행 바이트 불변. `journal.from` 은 처음 값으로 고정 |
| 역행 가드 | `latest` 가 done 최대 회차보다 작거나 pending 회차가 `latest+1` 보다 크면 쓰지 않고 `wrote=false` 로 exit 0 + `::warning` |
| 구멍 | 이력에 구멍·형식 오류가 있으면 `exit 1`, 출력 파일을 건드리지 않는다 |
| 기존 파일 보호 | 기존 out 이 깨졌거나 모양이 다르면 `exit 1`, 덮어쓰지 않는다 |

- **`rec` 가 없는 행**: 추천 요약이 그 회차 것이 아닐 때(CI 순서·요약 실패) 생긴다. 한 번 `rec` 없이 얼린 pending 에는 나중에 `rec` 를 끼워 넣지 않는다(얼린 뒤 수정 없음). 그 주는 낙첨 분석 집계에서 빠진다.
- **`RULES`**: `{ver, from, signals[]}` 덧붙이기만. `CONF` 의 신호·시드 상수(`W` `POOL` `LINES` `SALT` `CTRL_MUL` `R` `MIN_HIT`)를 바꾸면 `VER` 을 올리고 `RULES` 에 새 항목을 더한다. 신호를 더할 때도 새 항목(`from` = 시작 회차, `signals` = 늘어난 목록)이다. 이미 쓴 행의 `ver` 로 옛 규칙이 남는다.

## 6. 관문 (live = done 이고 late 가 아닌 행) — 매 실행 다시 계산

경보·채택은 일지에 박제하지 않는 **파생값**이다(`summary.gate`). 같은 일지로 언제든 다시 계산된다.

### 6.1 낙첨 분석 (`gate.rec`)

대상: `rec` 가 있는 live 행. 누적 `cum` = 그 행들 `res.rec.g3` 의 합, 대조군 누적 `c_j` = 같은 주들의 대조군 `j` 벌 값의 합.

| 상태 | 조건 |
|---|---|
| `hold` 판단 보류 | `weeks < ALARM_MIN_WEEKS(26)` 또는 대상 주 없음 |
| `alarm` 경보 | `weeks ≥ 26` 이고 `(1+le)·ALARM_P[1] ≤ ALARM_P[0]·(R+1)`(낮은 쪽 꼬리 비율 ≤ 1/100) |
| `above` | 경보가 아니고 `cum > max` |
| `inside` 대조군 범위 안 | 그 밖 |

`alarm` 이면 `gate.alarm = true` 와 `::warning title=낙첨 분석::… 버그 의심` 을 낸다. 화면 문구는 «떨어지는 주가 대부분인 것이 정상 — 대조군과 비교해 버그만 가려냄».

### 6.2 학습 실험실 (`gate.sig.<신호>`)

대상: 그 신호가 있는 live 행(신호별로 주 수가 다를 수 있다).

| 상태 | 조건 |
|---|---|
| `hold` | `weeks < ADOPT_MIN_WEEKS(52)` 또는 주 없음 |
| `adopt` 채택 조건 충족 | `weeks ≥ 52` 이고 `(1+ge)·ALPHA[1]·신호수 ≤ ALPHA[0]·(R+1)` (상위 꼬리 비율 ≤ α/신호 수, α = 1/20, 본페로니) |
| `none` 채택 없음 | 그 밖 |

`adopt` 가 하나라도 있으면 `gate.adopted` 에 이름을 모으고 `::notice title=학습 실험실::신호 … 채택 조건 충족 … 추천 반영은 소유자 결정입니다` 를 낸다. 코드는 바뀌지 않는다.

## 7. 돌아보면(사후) 재현 (`summary.replay`)

- 범위: 최근 `REPLAY=300` 회(`latest-299 … latest`). 각 회차 `r` 에 대해 4신호를 `past(D,r)` 로만 만들어(walk-forward) 채점한다.
- `rec`: 모의 원장(`brief/sim-lotto.json`)의 범위 안 done 행 A~E **5줄**. 대조군은 같은 벌의 앞 5줄로 맞춘다. 모의 원장이 없거나 범위 안 행이 없으면 `rec: null`.
- 요약 = §3.4 `stat`(신호별·`rec`) 와 `{label:"돌아보면(사후)", from, to, rounds, lines, recLines}`. **회차별 원자료는 저장하지 않는다.**
- 화면에서는 반드시 «돌아보면(사후)» 라벨을 단다. 결과를 안 뒤에 계산한 표라 관문(경보·채택)에는 쓰지 않는다 — 관문은 추첨 전에 얼린 live 행만 본다.

## 8. 독립 검증 `scripts/check-learn.mjs`

생성기를 쓰지 않는다(CLAUDE.md 규칙 10). 종료 코드 0/1, 실패는 `::error title=check-learn::…` 한 줄.

| 검사 | 내용 |
|---|---|
| L0 구조 | 키·순서(경고)·`kind/ver`·행 오름차순·유일·pending ≤ 1 이고 마지막·done 필드 완비·`journal.from`·한 줄 한 행(경고) |
| L1 입력 | 이력 연속·형식, `source.digest` 재계산, `conf`·`rules` 가 규격과 같음 |
| L2 신호 | 모든 행의 풀·줄 10개를 과거(1..r-1)만으로 다시 만들어 대조, `inputDigest`·`basedOn`·`ver`, pending 은 `latest+1` |
| L3 rec | 10줄 모양, 추천 요약·모의 원장 A~E 와 대조(다르면 **경고만** — 처음 값 동결 원칙) |
| L4 채점 | `res`(맞힌 개수·보너스·`g3`)·`ctrl.h`(대조군 1000벌 재생성)·`drawDate`·`late`·`gradedAt` |
| L5 요약 | `live`·`gate`(경보·채택 포함)·`replay` 를 처음부터 재계산해 대조 |
| L6 append-only | `--prev-git REF`(또는 `--prev <파일>`)의 done 행 바이트 불변·`journal.from`·`missed` 접두·행 순서/삭제 금지·pending 얼린 필드 불변·`rules` 접두·`conf` 변경 시 `VER` 상승·`latest` 역행 |
| L7 문구·크기 | JSON 문자열과 `record.html` 의 `#learnWrap`·학습 JS 구간(`/* LEARN-BEGIN */`~`/* LEARN-END */`)에 금지 문구 정규식(`/확률을 높\|잘 나오\|당첨 보장\|가능성이? 높\|적중률 높/`)과 화면 이론값 말(p값·σ·표준편차·기대값·몬테카를로·이론 등) 0건, 파일 1MB 미만 |
| L8 정적 | 생성기 소스(주석 제외)에 `Math.random` 0건, `Date` 는 `Date.parse`·`Date.UTC`·ISO 기록 줄에만 |

## 9. CI 와 로컬 실행

CI(`weekly.yml`, 두 사본 `.github/workflows/` · `setup/workflows/` 가 같아야 한다): 매매 일지 단계 바로 뒤에 `학습 장부`(id `learn`, `continue-on-error`) → `학습 장부 독립 검증`(id `checklearn`, `learn` 이 `wrote=true` 일 때) → `학습 장부 검증 실패 시 되돌림`(`checklearn` 실패 시 `brief/learn-lotto.json` 을 HEAD 것으로 복원, HEAD 에 없으면 지움 — 잘못 쓰인 일지가 한 번 커밋되면 다음 주에 그 상태가 기준이 되어 굳는다), 끝쪽 `학습 장부 실패 표시`. 학습 장부는 **추천 요약(`brief/latest-summary.json`)을 쓰는 `주간 브리핑` 단계 뒤**여야 `rec` 가 얼려진다(매매 일지 단계 자리면 만족).

로컬(Git Bash, `N=.lab/bin/node`; 쓰기는 `.lab/out-learn/` 아래만):

```
$N scripts/learn-ledger.mjs --history lotto-history.json --summary brief/latest-summary.json --sim brief/sim-lotto.json --out .lab/out-learn/brief/learn-lotto.json --now <마감 전 ISO>
$N scripts/check-learn.mjs --root . --file .lab/out-learn/brief/learn-lotto.json --history lotto-history.json --summary brief/latest-summary.json --sim brief/sim-lotto.json
```

- **`--out` 을 빼면 기본값 `brief/learn-lotto.json`(추적 일지)에 이어 쓴다.** 처음부터 시험하려면 시험 폴더의 파일을 지운다.
- 합성 시험: 이력 사본에 가짜 다음 회차를 붙이면 그 회차는 done, 그다음이 pending 이다. 이력에서 한 회차를 지우면 exit 1 이고 출력 파일은 그대로다.

## 10. 화면 `record.html#learn`

`#tradeWrap` 뒤·`#simWrap` 앞의 `<section id="learnWrap" hidden>`. 카드 2개.

1. **낙첨 분석**: 지난 회차 10줄 결과(줄마다 맞힌 개수·번호 공 강조, 3개 이상 줄 수)와 같은 주 대조군 1000벌 중 순위·실제 분포, 누적 주 수·추천 누적과 대조군 누적의 범위·순위, 상태(판단 보류/대조군 범위 안/경보), 그리고 «돌아보면(사후)» 모의 원장 A~E 재현.
2. **학습 실험실**: 신호별 표(사전 등록 주 수·3개 이상 줄 누적·대조군 안의 자리·상태). «돌아보면(사후)» 표는 따로 둔다.

`fetch(no-store)` → 모양 점검 → 채움. 파일이 없거나 모양이 어긋나면 섹션째 숨기고, `main()` 에서 한 줄 `try/catch` 로 격리한다. 375px 에서 가로 넘침이 없고(표는 좁은 폭에서 신호마다 카드로 쌓인다) 라이트·다크 토큰을 쓴다. `record.html` 이 바뀌므로 배포 때 `sw.js` 의 `CACHE_NAME` 을 올린다(규칙 13, 리드 몫).

## 11. 바꿀 때 · 고장났을 때

- **상수·신호 변경**: `VER` 올림 + `RULES` 덧붙임 + `check-learn` 의 같은 상수(독립 구현이라 따로 고친다) + 이 문서.
- **새 신호 추가**: `CONF.SALT` 에 소금, `signalPools` 에 점수 정의, `RULES` 새 항목(`from`, 늘어난 `signals`), `check-learn` 의 `expectedPools`·`CONF.SALT`·`RULES`, 화면 `LEARN_SIGS` 이름, 이 문서 §3.2. 본페로니의 신호 수가 늘어 기준이 엄격해진다.
- **경보가 떴다**: 운일 수도 있지만 대조군 하위 1% 는 흔치 않다. 순서대로 본다 — ① `check-learn` 통과 여부 ② `brief/latest-summary.json` 의 `picks`(10줄·서로 다른 6개·1..45) ③ 추천 생성 코드의 최근 변경 ④ 이력 채점과 줄 형식. 이 장부는 추천을 바꾸지 않는다.
- **채택 알림이 떴다**: 상태 표시일 뿐이다. 소유자가 «반영한다» 고 정하면 그때 추천 코드를 따로 바꾼다(그 변경은 장부 밖 — 새 `VER` 로 새 신호를 등록해 앞으로의 성적을 다시 쌓는다).
- **`check-learn` 이 CI 에서 실패**: 되돌림 단계가 일지를 HEAD 것으로 복원한다(커밋되지 않음). 로컬에서 같은 명령으로 재현하고 오류의 `L<번호>` 를 본다. J4·J5 경고는 처음 값 동결 원칙의 알림이라 실패가 아니다.
- **장부 갈아타기(1MB 근처)**: `brief/learn-lotto.json` 을 `brief/learn-lotto-<연도>.json` 으로 보관하고(추적 파일 새로 1MB 미만) 새 파일은 `journal.from` 부터 새로 쌓는다. 이때 관문 집계(52주)가 다시 시작되므로 소유자와 먼저 정한다 `[확인 필요]`.
- 새 추적 파일은 `git add -N` 뒤 `node scripts/check-names.mjs`(추적 파일만 검사).

## 12. 남은 결정·위험

- 첫 일지 행은 첫 CI 실행의 `latest+1` 회차(1248 부터 — `RULES[0].from`)다. 52주가 쌓이기 전에는 모든 신호가 «판단 보류» 이고 «돌아보면(사후)» 표만 채워진다. 그 표를 근거로 읽지 않도록 화면에 라벨과 설명을 상시 둔다.
- `rec` 의 F~J(6~10번째)는 별도 갈래가 새로 고른다. 그 변경이 배포된 주의 pending 은 처음 값을 유지하고 J4 경고가 한 번 날 수 있다.
- 4신호가 같은 대조군을 공유하므로 신호끼리 독립이 아니다(본페로니는 보수적이라 허용된다) `[추론]`.
- 지금 모든 신호는 «과거만 보는 단순 규칙» 이다. 채택되어도 앞날을 보장하지 않는다.

작성: 잼족
