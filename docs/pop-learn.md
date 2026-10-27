# 당첨금 학습 장부 규격 (`pop-1`)

`brief/pop-learn-lotto.json` 의 계산 규격. 코드와 이 문서가 다르면 `scripts/pop-learn.mjs`(생성)·`scripts/check-pop-learn.mjs`(독립 검증)가 기준이다.
표기: 사실 `[근거: 파일]` · 추론 `[추론]` · 불확실 `[확인 필요]`. 매주 바뀌는 실적 숫자는 이 문서에 적지 않는다.

## 1. 무엇이고 왜 만들었나

- **그림자 장부**다. 지금 추천이 쓰는 «사람들이 고르는 조합» 인기 예측(분배지수 A·B → z)은 **바꾸지 않는다**.
  그 옆에서 «매주 등수별 당첨자 수로 인기 예측을 다시 학습하면 더 나은가» 를 사전 등록한 후보 모형 2개로 시험하고, 결과를 쌓는다.
- 대상은 **돈이 아니라 «당첨자 수의 배수»** 다. 배수 1.0 = 그 회차 판매량에서 우연히 기대되는 당첨자 수. 배수가 낮을수록 같은 등수를 나눠 갖는 사람이 적다.
  어느 줄이든 당첨 확률(1/8,145,060)은 같고 이 장부는 그것을 바꾸지 않는다.
- **채택**은 상태 표시와 CI 알림(`::notice`)까지만이다. 추천 코드를 자동으로 바꾸지 않는다 — 반영은 소유자 결정이다.
- 기준선은 «지금 모형(base)» 이다. 화면에 올릴 때 우연 기준선은 **무작위 대조군의 실제 결과**로만 쓴다(CLAUDE.md 규칙 9). 이론값(기대값·σ·p·몬테카를로)은 화면에 두지 않는다. JSON 내부의 p 는 관문 계산용 내부값이다.

## 2. 파일과 데이터 흐름

```
lotto-history.json ─┐
 (동행복권 공식 API   ├─► scripts/pop-learn.mjs ──► brief/pop-learn-lotto.json   (CI 가 씀, 일지 append-only)
  스냅샷, 연속 1..latest)│                                      ▲
brief/rank-params-lotto.json ─┘  scripts/check-pop-learn.mjs ───┘  생성기를 쓰지 않는 독립 재계산 (읽기 전용)
 (rows[t].pop = t-1 까지로 적합한 A·B·bounds)
```

| 파일 | 역할 |
|---|---|
| `scripts/pop-learn.mjs` | 생성기. 외부 접속·Playwright 없음. `index.html`·`rank-core.js` 를 읽지도 가져오지도 않는다(식을 다시 구현했다) |
| `scripts/check-pop-learn.mjs` | 독립 검증기. 생성기·`index.html`·`rank-core.js` 를 가져오지 않는다. Householder QR 로 회귀를 따로 풀고 z 를 두 방식으로 계산한다 |
| `brief/pop-learn-lotto.json` | 산출(봇이 씀, 손으로 고치지 않음). 새 추적 파일 1MB 미만(규칙 4) |
| `docs/pop-learn.md` | 이 문서 |

## 3. 모형

모든 결정 함수는 `t` 미만 회차의 자료만 쓴다(walk-forward). `Math.random`·`Date` 를 쓰지 않는다 — 난수는 `mulberry32` + 회차 시드, `Date` 는 `--now` 를 ISO 로 바꾸는 한 곳(`resolveNow`, 표지 `DATE_OK`)에만 있다.

### 3.1 관측값 (회차 t)
- `e_k = (sales/1000)·WAYS_k/8,145,060`, `WAYS=[1,6,228,11115,182780]`(1~5등 조합 수).
- `m45 = 0.5·w4/e4 + 0.5·w5/e5` — 지금 모형 A 의 정의와 같다 [근거: index.html fitPop].
- `m123 = (w1+w2+w3)/(e1+e2+e3)`, `mp = Σw_k/Σe_k`(1~5등 풀드 배수).
- `sales`·`w4`·`w5` 가 없거나 0 이거나 `e4 < 200`(지금 모형 적합과 같은 표본 조건)이면 그 회차는 **건너뜀**이다. 건너뛴 회차는 이유와 함께 `recon.skipped`(같은 이유의 연속 구간으로 묶음) 또는 일지 행의 `skip` 에 남긴다 — 조용히 빼지 않는다.
- **적합을 못 하는 이유도 구분해서 남긴다**: `학습 회차 60 미만`(표본 부족, `TRAIN_MIN`) · `보정 쌍 60 미만`(`CAL_MIN`) · `회귀 특이 행렬`(정규방정식을 풀 수 없음) · `z 분산 0`(보정 회귀의 분모가 0). 회차마다 바뀌는 수는 문구에 넣지 않는다(같은 이유의 연속 구간으로 묶으려고). 생성기·검증기가 같은 글자를 쓴다. 새로 얼려야 하는 회차(`latest+1`)에서 이 중 하나면 exit 1(쓰기 없음)이고 메시지에 이유가 그대로 나온다.
- **최신 회차 필드 이상**(`w4·w5·sales ≤ 0`, 추첨일 없음, 또는 `t ≥ 262` 에서 `firstType` 합 ≠ `winners.first`)이면 그 회차로 학습도 일지도 쓰지 않는다: `::warning` + `wrote=false` + 출력 파일 불변. 한 번 굳은 done 행은 고칠 수 없으므로 정정되기 전 자료를 굳히지 않으려는 장치다.

### 3.2 특징 (8개, `popFeat`)
`[1, 31 이하 개수, 12 이하 개수, (합−138)/30, 연속쌍 수, 끝수 중복(Σ(c−1), c>1), (최대−최소−33)/8, 사용 10단위 구간 수]`.
학습 구간(`bounds`) = 학습 표본 특징별 2·98 백분위(정렬 인덱스 `floor(len·p)`)이고, 점수를 낼 때 `j ≥ 1` 특징을 이 구간으로 자른다(외삽 방지).

### 3.3 모형 3개
| id | 정의 |
|---|---|
| `base` | 지금 모형. `rank-params-lotto.json` 의 `rows[t].pop`(A·B·bounds, t−1 까지로 적합)로 **당첨번호**의 z 를 `zOf` 와 같은 산술 순서로 구한다: `za=(Σ clamp(f_j)·βA_j − predMeanA)/predSDA`, B 가 있으면 `z=(za+zb)/2`. 예측 `m̂ = a + b·z`, `a·b` 는 `s = 1000..t−1` 회차의 «그때그때 z(rows[s])» 와 `m45` 의 단순회귀(`validate.mjs` `calibrate` 와 같다, 최소 `CAL_MIN=60` 쌍) |
| `C1` | 같은 8특징으로 `m45` 를 **반감기 156회 지수 감쇠 가중 OLS**(가중 `0.5^((t−1−s)/156)`)로 다시 맞춤 — 최근 인기 변화 반영 |
| `C2` | 같은 8특징으로 **1~5등 풀드 배수 `mp`** 를 포아송 가중(`Σe_k`) WLS 로 맞춤 — 1~3등 정보 포함 |

- C1·C2 는 `t−1` 까지 모든 유효 회차(1회부터)로 적합한다. 특징은 base 와 같은 `popFeat`·같은 학습 구간 자르기를 쓴다.
- 지금 모형의 A 는 «가중 없는 OLS(`m45`, `s<t`)» 이므로 생성기가 그 재적합이 저장 파라미터와 같은지 `recon.baseRefit` 에 적는다(같지 않으면 `::warning`).
- 예측 배수는 `0.05` 아래로 내려가지 않게 자른다(`M_FLOOR`).

### 3.4 점수
`(ln 예측 − ln m45)²` — 로그 배수 제곱오차. **주 대상은 `m45`**(추천이 쓰는 값). `mp` 에 대한 같은 점수는 보조(`candMp`)로만 적는다. 후보−base 가 **음수면 후보가 낫다**.

### 3.5 돌아보기(사후) 재현 — `recon`
`t = 1000..latest` 에 대해 위 세 모형의 walk-forward 예측을 다시 만들어 비교한다. base 의 보정 쌍이 60개 쌓이기 전(1000~1059회)은 비교 대상에서 빠지고 `recon.skipped` 에 이유와 함께 남는다.
- `err.{base,C1,C2}.{m45,mp}`: 평균 점수. `cand.C*`: `meanDiff`(후보−base 평균), `better`(후보가 나은 회차 수), `p`(부호 뒤집기 순열 한쪽 p, **내부값**), `dir`(`better`/`worse`). `candMp`: 보조 대상의 같은 값.
- `noise`: 관측 `m45`·`m123`·`mp` 의 평균·표준편차와 세 모형 예측의 표준편차 — 1~3등 `m123` 이 회차마다 얼마나 흔들리는지(포아송 잡음 + 같은 조합에 당첨자가 몰리는 과분산) 가늠하는 값.
- `recent`: 최근 52회의 회차별 원자료 `{t, z, m45, m123, mp, base, C1, C2}`(크기 때문에 더 두지 않는다).
- **이름이 «돌아보면(사후)»** 인 값이다. 결과를 본 뒤 만든 모형이 아니라 «그 회차 이전 자료만 쓴 예측» 이지만, 모형·상수 선택은 이 자료를 본 뒤에 했다. 앞날 성적으로 읽지 않는다.

### 3.6 부호 뒤집기 순열 p (규격 — 두 구현이 같은 값을 내야 한다)
`d_i = 점수(후보)−점수(base)`(회차 순). `obs = Σ d_i`(순서대로 더함). `b = 1..PERM_B(20000)`: `rng = mulberry32(seed)`, 회차 i 마다 `u=rng()`, `s += (u<0.5 ? −d_i : d_i)`, `s ≤ obs + 1e-12` 면 센다. `p = (센 수 + 1)/(PERM_B + 1)`.
- `mulberry32(a)`: `a=(a+0x6D2B79F5)>>>0; t=imul(a^(a>>>15),1|a); t=(t+imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/2^32`.
- 시드 `seedOf(r,salt) = (imul(r,0x9E3779B1)^salt)>>>0`. 돌아보기: `r=latest`, `salt=SALT_RECON+후보번호(C1=0,C2=1)`. 관문: `r=마지막 live 행의 회차`, `salt=SALT_LIVE+후보번호`.

## 4. 일지 (사전 등록) — 매매 일지(규칙 15)와 같은 틀

`journal = {from, missed[], rows[]}`. 행은 한 줄에 한 행.

```
pending: {r, ver, status:"pending", made, basedOn, inputDigest, fit}
done   : pending + {drawDate, late, src:{n[6],sales,w[5]}, obs:{m45,m123,mp}, pred:{base,C1,C2}, gradedAt}   (또는 obs·pred 대신 skip:"이유")
src    : 채점에 쓴 원자료 — 그 회차 당첨번호 n(오름차순)·sales·w=[1~5등 당첨자 수] (없는 값은 null)
fit    : {nTrain, nCal, a, b, pop:{A:{beta[8],predMean,predSD}, B:{…}|null, bounds[8][2]}, bd[8][2], C1[8], C2[8]}   (유효숫자 12자리로 얼림)
```

- `fit` 이 **추첨 전에 얼린 파라미터**, `src` 가 **채점 때 얼린 원자료**다. done 의 `obs`·`pred` 는 얼린 `src`·`fit` 만으로 다시 계산된다(재적합도 이력 조회도 필요 없다). 이력이 나중에 정정돼도 done 행은 이 두 얼린 값으로 스스로 맞는지 검증할 수 있다 — 매매 일지의 `prizeUsed` 와 같은 생각이다.
- 규칙
  | 번호 | 규칙 |
  |---|---|
  | J1 채점 | `r ≤ latest` 인 pending → done. `late = made ≥ 추첨일 11:00Z`(= 20:00 KST, `CUTOFF_UTC_H`; ISO 문자열 비교). late 행은 관문 집계에서 뺀다 |
  | J2 빠진 주 | 마지막 일지 회차+1 … latest 사이에 행이 없으면 `missed` 에 적는다. 소급하지 않는다 |
  | J3 새 제시 | `latest+1` 행이 없으면 pending 추가. 그 회차의 `rank-params` 행이 없으면 **exit 1**(쓰기 없음) — 순위 추적이 먼저 돌아야 한다 |
  | J4 동결 | 같은 `ver` 의 pending 을 다시 계산해 다르면(상대 1e-8) `::warning` + `checks.pendingMismatch`, 처음 값을 유지 |
  | J5 재채점 | done 행을 (a) 얼린 `src`·`fit` 으로 다시 채점해 `obs`·`pred` 와 맞춰 보고 (b) 얼린 `src` 를 지금 이력과 맞춰 본다. 다르면 `::warning`(최대 5건 표기) + `checks.regradeMismatch`, 처음 값을 유지 — (b) 는 자료 사후 정정이다 |
  | J6 불변 | done 행은 바이트 불변. 삭제·재정렬 없음. `journal.from` 은 처음 값 고정 |
  | 역행 가드 | `latest` 가 done 최대 회차보다 작거나 pending 이 `latest+1` 보다 크면 쓰지 않고 `wrote=false`, exit 0, `::warning` |
  | 구멍 | `1..latest` 에 빠진 회차가 있으면 exit 1, 출력 파일을 건드리지 않음 |
- **규칙표 `RULES` 는 덧붙이기만** 한다. `CONF` 상수를 바꾸면 `VER` 을 올리고 `RULES` 에 `{ver, from, …}` 를 더한다 — 이미 쓴 행의 `ver` 로 옛 규칙이 남는다. 후보를 더하면 `NCAND`(본페로니 분모)도 올려야 하니 새 `ver` 이다.
- 쓰기: 임시 파일 → rename, 쓰기 직전 되읽어 같은지 확인하고 크기 < 1MB 확인. LF·UTF-8. `$GITHUB_OUTPUT` 에 `wrote=true|false`.
- 멱등 비교에서 빼는 필드: `generated`, `journal.rows[].made/gradedAt`, `checks`.

## 5. 관문 — `gate` (live 행만)

live = `done && !late && !skip`. 후보마다 `d_i = 점수(후보)−점수(base)`(live 행, `m45` 기준).
- `n < GATE_MIN(52)` → `status:"collecting"`(`p` 는 계산하지 않음).
- `n ≥ 52` 이고 **부호 뒤집기 순열 p ≤ α/후보 수 = 0.05/2**(본페로니)이고 `meanDiff < 0` 이고 **돌아보기에서도 같은 방향**(`recon.cand.C*.dir = better`)이면 그 후보는 `ok`. 하나라도 `ok` 면 `status:"adopt"` 와 `adopt:[…]` + `::notice`(«채택 조건 충족 … 추천 반영은 소유자 결정»), 아니면 `"none"`(«채택 없음»).
- 채택 조건 충족은 상태일 뿐이다. 추천 z·`portfolioPick`·`PORTFOLIO_RULES`·구매 장부를 건드리지 않는다.

## 6. 산출 `brief/pop-learn-lotto.json` (`ver:"pop-1"`)

최상위 키(순서 고정): `v` `kind` `ver` `generated` `source` `conf` `rules` `recon` `gate` `journal` `checks`.
`source = {file, latest, count, digest, params:{file, first, last, count}}`. `source.digest` 는 `fnv( Σ_{r=1..latest} "r:n1,…,n6|sales|w1,…,w5;" )`(FNV-1a 32, ASCII, 없는 값은 빈 문자열) 이고 일지 `inputDigest` 는 `basedOn` 까지의 같은 지문이다. `conf`·`rules` 는 코드의 `CONF`·`RULES` 사본이다.

## 7. CI와 검증

`weekly.yml`(두 사본 `.github/workflows/` · `setup/workflows/` 가 같아야 한다)의 `매매 일지` 단계 묶음 바로 뒤, `결과 요약` 앞:
1. `당첨금 학습`(`id: poplearn`, `continue-on-error`): `node scripts/pop-learn.mjs --root . --history lotto-history.json --params brief/rank-params-lotto.json --out brief/pop-learn-lotto.json`
2. `당첨금 학습 독립 검증`(`id: checkpoplearn`, `poplearn` 성공 + `wrote=true`): `node scripts/check-pop-learn.mjs --root . --file brief/pop-learn-lotto.json --history lotto-history.json --params brief/rank-params-lotto.json --prev-git HEAD`
3. `당첨금 학습 검증 실패 시 되돌림`(`checkpoplearn` 실패): `git checkout HEAD -- brief/pop-learn-lotto.json 2>/dev/null || rm -f brief/pop-learn-lotto.json` — 매매 일지와 같은 이유(append-only 라 잘못 쓰인 장부가 한 번 커밋되면 영구히 굳는다).
4. `매매 일지 실패 표시` 바로 뒤 `당첨금 학습 실패 표시`(`weekly.yml` 의 실패 표시 단계들은 `순위 추적` → `모의 원장` → `검증 보드` → `매매 일지` 순이라 그 맨 끝에 붙는다).

`check-pop-learn.mjs` 검사 표(실패는 `::error title=check-pop-learn::…` 한 줄, 종료 코드 0/1):
| 검사 | 내용 |
|---|---|
| C0 구조 | 최상위 키 순서·`conf`/`rules` 가 검증기 사본과 같음·`rules` 마지막 항목과 `conf` 의 같은 값(반감기·관문 상수·후보 수·최소 쌍 수)이 서로 맞음·크기 < 1MB·LF |
| C1 입력 | 이력 연속·형식, `source.digest`, 최신 회차 필드 이상, `source.params` |
| C2 돌아보기 | 관측·특징·QR 회귀·보정·돌아보기 전체와 `recon` 요약(오차·나은 회차 수·순열 p·잡음·최근 52회)을 다시 계산해 대조. 지금 모형 재적합 ↔ 저장 파라미터는 **이번 주 행(`t=latest+1`)만 오류**, 지난 회차 행은 경고(아래 «경고만 남기는 이유»). 생성기가 적은 `baseRefit.maxRel` 은 검증기 값과 근사 비교 |
| C3 z 대조 | 장부 `recon.recent` 의 첫·가운데·마지막 3회차(세 회차 모두 장부에 `z` 가 있다)를 «직접 식» · «특징 코드 표» · `check-rank.mjs` 의 `zMaker`(소스 텍스트에서 꺼내 격리 실행, 가져오기 아님) 세 가지로 계산해 상대 1e-9 이내, 장부의 `z`(소수 10자리 반올림이라 절대 1e-10 허용)와도 대조. 표본에 장부 `z` 가 없으면 오류, `zMaker` 를 꺼내지 못하면 경고 |
| C4 일지 | 오름차순·유일·pending ≤ 1(마지막이 `latest+1`)·`from`·`missed`·연속성(행 삭제 탐지), 얼린 `fit` 과 `inputDigest` 를 이력 `≤ basedOn` 만으로 다시 계산해 대조(누수 탐지) |
| C5 채점 | done 의 `drawDate`·`late` 와, `obs`·`pred` 를 **얼린 `src`·`fit` 으로** 다시 계산해 대조(다르면 오류 — 값 변조). `src` ↔ 지금 이력이 다르면 경고(J5 사후 정정). pending 에 채점 필드 없음 |
| C6 관문 | `gate` 전체 재계산(순열 p 포함) |
| C7 append-only | `--prev-git HEAD` 또는 `--prev <파일>`: done 행 바이트 불변, pending 얼린 필드 불변, 행 접두·`missed` 접두·`rules` 접두, 생성기 소스 `RULES` 접두 |
| C8 문구 | 금지 문구(JSON·이 문서·생성기), 이 문서의 한계 문구, 생성기에 `Math.random` 0곳·`DATE_OK` 표지 없는 `Date` 0곳 |

**경고만 남기는 이유 (규칙 7·10)**: 일지는 «처음 공개한 값을 동결» 하고, `rank-params` 의 예전 행도 append-only 라 고쳐지지 않는다. 그래서 동행복권 자료의 지난 회차(판매액·당첨자 수)가 한 번 정정되면 «지금 이력으로 다시 계산한 값» 은 예전 행과 달라질 수 있다. 이것을 오류로 보면 정정 한 번에 검증기가 매주 실패하고, CI 가 그때마다 장부를 `HEAD` 로 되돌려 그 주들의 pending 이 영구히 `missed` 가 된다(live 표본 손실). 그래서 다음은 **경고**다.
- 오래된 행(`made ≠ generated`)의 얼린 `fit`·`inputDigest` 가 지금 이력의 재계산과 다름(J4).
- done 행의 얼린 `src` 가 지금 이력과 다름(J5 사후 정정).
- 지난 회차(`t ≤ latest`) `rank-params` 행이 지금 이력의 재적합과 다름.

반대로 **오류**로 남기는 것은 값 변조와 생성기 결함을 가리는 것들이다: done 의 `obs`·`pred` 가 얼린 `src`·`fit` 으로 다시 계산한 값과 다름 · 이번 실행에서 만든 행(`made = generated`)이 재계산과 다름 · 이번 주 `rank-params` 행(`t = latest+1`, 같은 실행의 `rank-track` 이 방금 쓴 행)이 재적합과 다름. 얼린 `src` 까지 함께 고친 변조는 값이 서로 맞아 C5 가 못 잡으므로 `C7`(`--prev-git HEAD`, done 행 바이트 불변)이 잡는다.

로컬 확인(Git Bash, `N=.lab/bin/node`):
```
$N scripts/pop-learn.mjs --history lotto-history.json --params brief/rank-params-lotto.json --out .lab/out-poplearn/brief/pop-learn-lotto.json [--now <ISO>]
$N scripts/check-pop-learn.mjs --root . --file .lab/out-poplearn/brief/pop-learn-lotto.json --history lotto-history.json [--prev <이전 JSON>]
```
**`--out` 을 빼면 추적 장부(`brief/pop-learn-lotto.json`)에 이어 쓴다.** 로컬 시험은 항상 `--out .lab/out-poplearn/…`.

## 8. 크기와 시간

- 첫 장부(1247회 자료)는 약 10KB, 주당 증가는 약 1.3KB(1194→1248회를 한 주씩 순차 실행한 실측 1,277~1,315바이트, 54주 뒤 약 80KB). 1MB 에 닿기까지 십수 년이다 [추론: 1.3KB × 52주 ≈ 67KB/년]. 생성기는 쓰기 직전에 크기를 확인하고 1MB 이상이면 쓰지 않는다.
- **행 크기가 처음 사양(행당 수백 바이트)보다 크다 — 소유자 확인 필요(deviation)**: done 행은 약 1.28KB다. 이유: `fit.pop`(A·B β 16개와 학습 구간 16쌍, 유효숫자 12자리)을 함께 얼리기 때문이다. `rank-params` 의 `rows[latest+1]` 은 추첨 전까지 매주 덮어써지므로 행에 얼려 두지 않으면 나중에 채점의 근거를 다시 만들 수 없다. 거기에 채점 원자료 `src`(약 90바이트)를 더했다. 줄여야 하면 `fit.pop.bounds` 는 원래 값(이미 짧은 십진수) 그대로 두고 β 만 12자리로 얼리는 식으로 바꿀 수 있다 — 바꾸면 `VER` 을 올린다.
- 생성 약 0.7초, 검증 약 1초(1247회 자료, 이 PC). CI 추가 시간은 몇 초 안쪽이다 [추론].

## 9. 한계 — 읽을 때 꼭 알아야 할 것

- 효과는 **확률 아님, 금액**(당첨 시 나눠 갖는 몫) 쪽이다. 이 장부가 직접 재는 것은 그 몫을 정하는 «당첨자 수의 배수» 이며, 어느 줄이든 당첨 확률(1/8,145,060)은 같다. 이 장부의 어떤 숫자도 당첨 확률을 바꾸거나 예측하지 않는다.
- **1~3등 당첨자 수는 포아송 잡음 이상으로 흔들린다**: 1060~1247회 평균 1등 약 14명·2등 약 86명·3등 약 3,265명이다(기대 14.2·85.4·3,244) [근거: lotto-history.json]. 회차별 `m123` 의 순수 포아송 sd 는 약 0.017 이지만 관측 sd 는 약 0.135 로 약 8배다 — 대부분 같은 조합에 당첨자가 몰리는 과분산이다 [추론]. 그래서 점수의 주 대상은 4·5등을 합친 `m45` 이고(`m123` 의 관측 sd 가 `m45` 의 약 2.6배, `recon.noise` 로 확인), `m123` 은 관측으로만 쌓는다. C2 의 «1~3등 정보» 도 풀드 가중에서 거의 4·5등 몫(`Σe` 의 약 94%가 5등)이다.
- **`payoutGain` 은 환산값이다**: 검증 보드의 `payoutGain` 은 «z 이득 × 재보정 기울기(약 0.033)» 로 환산한 값이지 실제로 받은 금액이 아니다 [근거: scripts/validate.mjs payoutGain]. 이 장부가 후보 모형을 채택해도 그 환산값이 돈으로 확인되는 것은 아니다.
- **돈 단위 검증 불가**: 현행 포트폴리오 효과를 돈 단위(주당 환산 수익)로 가려내려면 대응표본 기준 약 1.1e9 주가 필요하다 [근거: brief/validation.json lotto.per.portfolio.weeksForMoney]. 이 장부는 돈이 아니라 «당첨자 수 배수 예측 오차» 로만 모형을 견주며, 그것도 52주 안팎의 live 표본은 작다.
- **표본이 작은 동안**(live 52회 미만) 관문은 계산하지 않는다. «돌아보기(사후)» 값은 상수·모형을 본 뒤 고른 것이라 앞날 성적이 아니다.
- **C2 는 수준 보정이 없다**: C2 는 base 와 달리 `a+b·z` 보정과 시대 가중이 없어, 초기 회차(1~100회, 평균 `m45` 약 0.57)의 낮은 배수가 절편을 끌어내려 예측 수준이 낮게 나온다 [근거: 1247회 자료 측정]. 사전 등록한 정의 그대로 둔다 — 다른 후보는 `RULES` 에 새 항목으로 더한다.
- **지금 모형 입력과 같은 자료**를 쓰므로 base 와 후보의 오차는 서로 독립이 아니다(같은 회차의 같은 잡음). 그래서 부호 뒤집기 순열(대응 차이)로 견준다.
- 자료는 «동행복권 공식 API 스냅샷» 이다. 당첨자 수가 사후 정정되면 done 행은 처음 값(얼린 `src`)을 유지하고 J5 경고만 낸다. 검증기도 경고로 통과시키고 값 변조만 오류로 본다(§7).

## 10. 바꿀 때

- 상수·모형 변경: `VER` 올림 + `RULES` 덧붙임 + `check-pop-learn.mjs` 의 규격 사본(`EXPECT_CONF`·`EXPECT_RULES`)을 같이 고침(독립 구현이라 따로) + 이 문서.
  같은 값(반감기 156·관문 상수·후보 수·최소 쌍 수)이 `CONF`·`RULES`·`CANDS` 에 따로 적혀 있어, 생성기는 계산 전에 서로 맞는지 단언하고(`configProblems`, 어긋나면 exit 1·쓰기 없음) 검증기 C0 도 장부의 `conf` 와 `rules` 마지막 항목을 대조한다. 하나만 고치면 실행 단계에서 걸린다.
- 워크플로를 고치면 두 사본 `diff -q`. 새 추적 파일은 `git add -N` 뒤 `node scripts/check-names.mjs`.
- 화면에 올리게 되면(별도 작업): `sw.js` PRECACHE·`CACHE_NAME`(규칙 13), 문구는 규칙 9 — 기준선은 무작위 대조군의 실제 결과(`대조군 N벌 중 M위` 꼴)로만, 이론값 금지.

작성: 잼족
