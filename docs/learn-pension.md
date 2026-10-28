# 연금 학습 장부 규격 (`learn-pension-1`)

기록 › «연금 낙첨 분석 · 학습 실험실» 의 계산 규격. 로또 학습 장부(`docs/learn-ledger.md`, CLAUDE.md 규칙 17)를 연금복권720+ 에 옮긴 **별도 장부**다. 로또 쪽 파일(`scripts/learn-ledger.mjs` `scripts/check-learn.mjs` `brief/learn-lotto.json` `docs/learn-ledger.md`, `record.html` 의 `#learnWrap`·`LEARN-BEGIN~END` 구간)은 한 글자도 바꾸지 않는다.
생성기·독립 검증기·화면은 서로 다른 작업자가 **이 문서만 보고** 따로 만든다. 그래서 두 계산 구현(생성기·검증기)이 **바이트 단위로 같은 JSON** 에 이르도록 키 순서·숫자 표기·난수 소비 순서·동점·경계를 모두 적는다. 구현 전에는 이 문서가 기준이고, 구현 뒤 셋이 어긋나면 버그로 보고 문서·생성기·검증기를 함께 맞춘다.
표기: 사실 `[근거: 파일:줄]` · 추론 `[추론]` · 불확실 `[확인 필요]`. 화면 숫자는 매주 바뀌므로 고정 실적을 적지 않는다(§9.3 의 기준값은 입력을 고정한 시험용 값이다).

## 1. 무엇이고 왜 만들었나

- **낙첨 분석(연금)**: 이번 주 구매 5장(`rec`)의 결과를 «같은 주 무작위 대조군» 과 견준다. 연금도 대부분의 주가 낙첨이라 떨어진 것만으로는 운인지 버그인지 알 수 없다.
- **관문 있는 학습 실험실(연금)**: 후보 신호 4개(`hot` `cold` `gap` `repeat` — 이름은 로또와 같고 정의는 연금용)를 **추첨 전에 사전 등록**하고 추첨 뒤에 채점한다. 52주 이상 쌓이고 대조군의 가장 위쪽 끝에 들 때만 «채택 조건 충족» 을 표시한다.
- 둘은 **하나의 append-only 장부** `brief/learn-pension.json` 에 쌓는다. 한 회차 행에 구매 5장과 신호별 5장이 함께 얼려진다.
- **«채택» 은 상태 표시와 CI 알림(`::notice`)까지다.** 추천 코드(`pension.html` 의 `PENSION_RULES`·`pensionPortfolio`)를 자동으로 바꾸지 않는다. 반영은 소유자 결정이다.
- 어느 장이든 당첨 확률은 같다. 이 장부는 확률을 바꾸지 않고 앞날을 예측하지 않는다.
- 화면의 기준선은 **무작위 대조군의 실제 결과**(순위·범위·실제 분포)뿐이다. 아래 §1.1·§3.3 의 이론 수치(1/2, `5·10^(−k)` 등)는 이 문서와 검증기 내부까지만 쓰고 **화면과 JSON 에 두지 않는다**(규칙 9).

### 1.1 로또에서 옮기지 않는 것

| 로또 쪽 | 연금에서 | 근거 |
|---|---|---|
| 펼친 배치(갈래 배치, 규칙 16) | 새로 만들지 않는다 | 1~7등은 모두 끝자리가 맞아야 나온다(3~7등 = 뒤 5~1자리 일치, 1·2등 = 6자리 일치) [근거: pension.html:688-694 `gradeOf`]. 한 장이 끝자리를 맞힐 확률은 1/10 이라 5장 중 «7등 이상» 이 한 장이라도 나올 확률은 (서로 다른 끝자리 수)/10 이고 상한은 1/2 이다. 끝자리 5개가 모두 다를 때만 상한에 닿는다. 334회부터 규칙 `spread@334` 가 구매 5장의 끝자리를 «일» 자리 점수 상위 5개(서로 다른 숫자)로 고른다 [근거: pension.html:705 `PENSION_RULES` · :605 `topIdx` · :807 `lastRank` · :821-824 구매 5장] → 이미 상한이라 펼쳐서 더 얻을 것이 없다. 같은 이유로 «뒤 k자리(k = 1..6) 이상 맞힌 장이 하나라도 있을 확률» 도 끝자리가 서로 다르면 사건들이 서로 배타적이라 합집합 상한 `5·10^(−k)` 에 모두 동시에 닿는다(보너스 일치·1등도 같은 논리) — 다른 배치로 어느 등급도 올릴 수 없다 [추론 — 검수 확인 2026-10-28. 이 문단의 수치는 문서 안에만 둔다, 규칙 9] |
| 당첨금 학습(규칙 18) | 하지 않는다 | 연금 당첨금은 등수별 고정액이고 당첨자 수와 무관하다 [근거: pension.html:454-463 `RANKS` · :699-700 주석]. 나눠 갖는 인원을 줄일 대상이 없으니 인기 모형을 학습할 이유가 없다 |
| 대조군 두 가지(`ctrl`·`ctrlSig`) | 하나(`ctrl`) | §3.3 — 끝자리가 서로 다른 5장은 정보가 없으면 점수 분포가 모두 같다 |

### 1.2 이 장부가 가려낼 수 있는 것 [추론]

- 추첨 전에 정한, 끝자리가 서로 다른 5장은 **무엇이든** 점수 분포가 대조군과 같다(§3.3). 그래서 «구매 5장이 대조군보다 뚜렷이 나쁨(경보)» 은 우연이 아니라면 ① 5장의 구조가 깨졌거나(끝자리가 겹치면 맞히는 주가 드물어져 아래쪽 끝에 자주 걸린다) ② 기록·채점이 틀린 것이다. ②는 독립 검증(§8)이 직접 잡고, ①은 생성기·검증기가 매주 경고로 알린다(§5 J3 · §8 P3). 정상 구조에서는 경보가 우연으로만 뜬다(검출력이 낮다).
- 신호의 «채택» 도 같은 대조군과 견준다. 채택은 «반영을 검토할 후보» 이지 앞날 예측이 아니다.

## 2. 파일과 데이터 흐름

```
brief/pension-history.json ──────────────┐
brief/latest-summary.json (pension.picks 앞 5장) ──┼─► scripts/learn-pension.mjs ──► brief/learn-pension.json ──► record.html (기록 › 연금 낙첨 분석 · 학습 실험실)
brief/sim-pension.json (재현의 rec = 채점된 5장) ──┘    (CI 가 씀, 일지 append-only)              ▲
                                     scripts/check-learn-pension.mjs ─────────────────────────┘  생성기를 쓰지 않는 독립 재계산 (읽기 전용)
```

| 파일 | 역할 |
|---|---|
| `scripts/learn-pension.mjs` | CI 생성기. 신호·대조군·채점·관문·재현을 계산하고 일지를 관리하며 원자적으로 쓴다. 외부 접속 없음. import 는 `node:fs`·`node:path` 뿐(P8). import 하면 main 이 바로 돈다 — 가져다 쓰지 않는다 |
| `scripts/check-learn-pension.mjs` | 독립 검증기. 생성기를 import 하지도 실행하지도 않고 §3~§7 을 다시 구현해 대조한다(정적 점검 P8 만 생성기 소스를 «글자로» 읽는다) |
| `brief/learn-pension.json` | 산출(봇이 씀, 손으로 고치지 않음 — 규칙 5). 새 추적 파일 1MB 미만(규칙 4) |
| `record.html` | `#learnPenWrap`(카드 2개)과 JS 구간 `/* LEARNPEN-BEGIN */`~`/* LEARNPEN-END */`. 파일이 없거나 모양이 어긋나면 섹션째 숨김(§10) |
| `docs/learn-pension.md` | 이 문서 |

- 읽는 입력: `brief/pension-history.json`·`brief/latest-summary.json`(둘 다 `주간 브리핑` 단계가 매 실행 씀) · `brief/sim-pension.json`(`모의 원장 적재` 단계).
- 공용 도구(mulberry32·FNV·`stat`·직렬화)는 각 구현이 로또 쪽 **자기 짝**에서 옮겨 와도 된다 — 생성기는 `learn-ledger.mjs` 에서, 검증기는 `check-learn.mjs` 에서. **import 는 하지 않는다**(로또 스크립트는 import 하면 main 이 돈다). 생성기와 검증기가 같은 원본을 복사하지 않게 해서 독립성(규칙 10)을 지킨다.

### 2.1 생성기 사용법 (CLI)

```
node scripts/learn-pension.mjs [--root .] [--history brief/pension-history.json] [--summary brief/latest-summary.json]
     [--sim brief/sim-pension.json] [--out brief/learn-pension.json] [--now <ISO>] [-h | --help]
```

| 옵션 | 기본값 | 뜻 |
|---|---|---|
| `--root` | `.` | 아래 모든 상대 경로를 이 폴더 기준으로 푼다(`path.resolve(root, p)`). 절대 경로는 그대로 |
| `--history` | `brief/pension-history.json` | 이력(§3.1). 없거나 읽을 수 없으면 실패. `source.file` = 이 경로의 basename(`path.basename`) |
| `--summary` | `brief/latest-summary.json` | 추천 요약(§3.5) |
| `--sim` | `brief/sim-pension.json` | 모의 원장(§7) |
| `--out` | `brief/learn-pension.json` | 산출. 있으면 이전 판으로 읽고 이어 쓴다(§5) |
| `--now` | 없음(지금 시각) | §4.2 `generated` |
| `-h` `--help` | — | 사용법을 stdout 에 쓰고 exit 0, 아무 파일도 쓰지 않는다 |

- **`--summary`·`--sim` 은 주지 않아도 기본 경로를 읽는다**(검증기와 같은 규칙, §8.1). 파일이 없을 때: 명시한 경로면 `::warning`. 기본 경로면 `--summary` 는 `::warning`(J3 의 «rec 없음» 경고와 같은 줄로 내도 된다)·`--sim` 은 조용히 넘어간다. 어느 쪽이든 결과는 §3.5 표 그대로(rec 없음 / `replay.rec = null`)이고 산출 바이트는 «명시·기본» 과 무관하다.
- 모르는 옵션 · 값이 빠진 옵션(`--out` 이 마지막 인자 등) · 같은 옵션 두 번 → `::error` 한 줄 + exit 1, 쓰기 없음.
- `$GITHUB_OUTPUT` 은 `-h`·옵션 오류로 끝날 때도 `wrote=false` 를 한 번 쓴다(§4.5).
- 출력 폴더가 없으면 만든다: 임시 파일을 쓰기 직전에 `fs.mkdirSync(path.dirname(out), { recursive: true })`(쓰기 없음으로 끝나는 경로 — 실패·역행 가드 — 에서는 만들지 않는다). 그래서 §9.3 ③ 의 «빈 시험 폴더» 는 아직 없어도 된다.
- 종료 코드: 0(썼거나 역행 가드로 쓰지 않음) · 1(실패, 쓰기 없음). 그 밖의 값은 쓰지 않는다.
- CI 명령은 §9.1, 로컬 명령은 §9.2.

## 3. 모델

모든 신호 계산은 `past(D,t)` = 1..t−1 회차만 읽는다(t 이상을 읽으면 `RangeError`). 채점과 대조군 점수만 `D[t]` 를 본다. 결정 함수에서 `Math.random`·`Date` 를 쓰지 않는다. `Date` 는 `generated`·`made`·`gradedAt` 기록과 마감 계산(`Date.UTC`·`Date.parse`)에만 쓰고, 시험용으로 `--now <ISO>` 를 받는다. 생성기 소스에서 `Date` 가 든 코드 줄은 모두 §8.2 의 `DATE_OK` 에 맞아야 한다(P8): 시각 기록은 `new Date().toISOString()` 또는 `new Date(<변수 이름 하나>).toISOString()`(예 `new Date(ms).toISOString()`), `--now` 정규화는 `new Date(Date.parse(now)).toISOString()`, 마감·비교는 `Date.UTC(…)`·`Date.parse(…)`. 생성기는 `import.meta`·동적 `import()`·`require()` 를 쓰지 않는다(P8).

### 3.1 자료·표·기본 식

**이력 정규화** (`brief/pension-history.json` — 생성기·검증기 같음)

1. 최상위가 비어 있지 않은 **배열**이 아니면 실패.
2. 행마다 먼저 **일반 객체**인지 본다(`r !== null && typeof r === 'object' && !Array.isArray(r)`). 아니면(`null`·숫자·문자열·배열) 실패. 이어서 `Number.isInteger(ep) && ep ≥ 1` 이 아니면 실패. 같은 `ep` 가 두 번이면 실패. 배열 순서는 상관없다(`ep` 로 찾는다).
3. `latest` = 최대 `ep`. `r = 1..latest` 가 모두 있어야 한다(구멍이면 실패).
4. 형식: `Number.isInteger(band) && 1 ≤ band ≤ 5` · `typeof num === 'string' && /^\d{6}$/.test(num)` · `bonus` 도 같은 식 · `typeof date === 'string' && /^\d{8}$/.test(date)`. 하나라도 어긋나면 실패. 그 밖의 키(`cnt` `net` 등)는 읽지 않고 지문에도 넣지 않는다. `num === bonus` 는 허용한다(등수 규칙이 처리). `date` 는 정규식만 보고 **달력 유효성(`20261399` 등)은 보지 않는다** — 두 구현 모두 더하지 않는다(`cutoffMs` 는 `Date.UTC` 의 넘김 계산 그대로).
5. `latest < CONF.W + 1`(= 51) 이면 실패(신호 창을 채울 수 없다).

- 형식 검사는 `Number.isInteger`·`typeof`·정규식으로만 한다. 키가 없으면(`undefined`) 같은 검사에서 걸려 같은 실패 경로로 간다.
- 실패 = `::error` 한 줄 + exit 1, **어떤 파일도 쓰지 않는다**(규칙 8). 생성기·검증기 모두 main 전체를 `try/catch` 로 감싸, 잡히지 않은 예외(`TypeError` 등)도 `::error` 한 줄 + exit 1 로 끝낸다(생성기는 쓰기 전이면 쓰기 없음).
- `D[r] = {band, num, bonus, date}`. 자리 `p = 0..5` 는 문자열 위치(0 = 십만, 5 = 일·끝자리), 자리 숫자 = `num.charCodeAt(p) − 48`(0..9).

**표·점수**

- **표** = `{band, num}`. 문자열 `"<band>조 <num>"`, 정규식 `/^([1-5])조 (\d{6})$/` — `latest-summary.json` 의 `pension.picks` 와 `sim-pension.json` 의 `picks` 가 이 모양이다 [근거: scripts/weekly-brief.mjs:1315]. «조» 는 U+C870 한 글자, 사이는 ASCII 공백 하나. 읽을 때 `band = Number(m[1])`, `num = m[2]`.
- **자리 점수** `L(num, wn)` = 끝에서부터 연속으로 같은 자리 수(0..6): `L = 0; while (L < 6 && num[5−L] === wn[5−L]) L++`. 메인 당첨번호 `wn = D[r].num` 과만 견준다. **보너스는 점수에 넣지 않는다.**
- **등수** `gr(band, num, D[r])` = pension.html `gradeOf` 그대로 [근거: pension.html:688-694]: `num === D[r].num` 이면 `band === D[r].band ? 1 : 2`; 아니고 `num === D[r].bonus` 면 `8`; 아니면 `n = 5,4,3,2,1` 순서로 `num.slice(6−n) === D[r].num.slice(6−n)` 인 첫 n 에서 `8−n`(3~7등); 없으면 `0`. 등수는 기록용이고 점수·관문에 쓰지 않는다.
- **한 주 점수** `g` = 그 주 5장의 `L` 합(정수). 끝자리가 서로 다른 5장이면 0..6.

**난수·시드·지문·마감** (로또 §3.1 과 같은 식, 소금 값만 연금용)

- `mulberry32(seed)`: `a = seed >>> 0`; 부를 때마다 `a = (a + 0x6D2B79F5) >>> 0; t = imul(a ^ (a >>> 15), 1 | a); t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296`.
- `seedCtrl(t, j) = (imul(t, 0x9E3779B1) ^ imul(j, CONF.CTRL_MUL) ^ CONF.SALT.ctrl) >>> 0`, `j = 1..R`. 신호는 난수를 쓰지 않는다(§3.2).
- `fnv(s)`: `h = 0x811c9dc5`; 글자마다 `h ^= s.charCodeAt(i); h = imul(h, 0x01000193) >>> 0`; 결과 `"fnv:" + h.toString(16).padStart(8, '0')`(소문자 16진 8자리). 로또와 같은 함수.
- `digest(u) = fnv(Σ_{r=1..u} r + ":" + band + "," + num + "+" + bonus + ";")` — 예 `"1:4,162132+278239;2:2,450558+154457;…"`. ASCII 만 들어간다.
- 마감 `cutoffMs(date) = Date.UTC(+date.slice(0,4), +date.slice(4,6) − 1, +date.slice(6,8)) + CONF.CUTOFF_UTC_H × 3600000`. `CUTOFF_UTC_H = −9` → **추첨일 0시 KST = 추첨일 전날 15:00Z**. `late = Date.parse(made) ≥ cutoffMs(drawDate)`(같은 시각이면 late — `≥`). 확인값: `new Date(cutoffMs('20261029')).toISOString() === '2026-10-28T15:00:00.000Z'`(`Date.UTC(2026, 9, 29) − 32400000`).

### 3.2 신호 4개 (사전 등록 · 정수 연산 · 난수 없음)

회차 `t`(`t ≥ W+1`), `W = 50`:

- `cnt[p][d]` = 창 `t−W .. t−1`(정확히 W회)에서 자리 p 숫자가 d 인 회차 수. `last[p][d]` = `1..t−1` 에서 자리 p 에 d 가 마지막으로 나온 회차(한 번도 없으면 0).
- 조 `b = 1..5`: `bandCnt[b]` = 창 안에서 `band === b` 인 회차 수, `bandLast[b]` = `1..t−1` 에서 마지막 회차(없으면 0).
- `prev = D[t−1]`.

자리마다 숫자 0..9 의 순위(10개 순열), 조 1..5 의 순위(5개 순열)를 아래 비교로 정한다. **모든 비교의 마지막 동점 처리는 작은 숫자(작은 조)가 앞**이라 순위가 하나로 정해진다(정렬 알고리즘과 무관).

| 신호 | 자리 p 의 숫자 순위(앞 순서) | 조 순위(앞 순서) |
|---|---|---|
| `hot` 자주 나온 숫자 | `cnt[p][d]` 큰 순 → d 작은 순 | `bandCnt` 큰 순 → b 작은 순 |
| `cold` 적게 나온 숫자 | `cnt[p][d]` 작은 순 → d 작은 순 | `bandCnt` 작은 순 → b 작은 순 |
| `gap` 오래 쉰 숫자 | `last[p][d]` 작은 순 → d 작은 순 | `bandLast` 작은 순 → b 작은 순 |
| `repeat` 직전 번호 다시 | `d` 가 `prev` 의 자리 p 숫자이면 먼저 → `cnt[p][d]` 큰 순 → d 작은 순 | `b === prev.band` 먼저 → `bandCnt` 큰 순 → b 작은 순 |

**5장**: `rk[p]` = 자리 p 의 숫자 순위, `br` = 조 순위. `i = 0..4` 에 대해 `num_i` = `rk[0][0] rk[1][0] rk[2][0] rk[3][0] rk[4][0] rk[5][i]` 를 이어 쓴 6자 문자열, `band_i = br[i]`, 표 문자열 `` `${band_i}조 ${num_i}` ``.
→ 앞 5자리는 5장이 같고, 끝자리 5개와 조 5개는 늘 서로 다르다. 행에는 `sig.<신호> = {picks:[5장]}` 을 i 순서로 저장한다.

- 신호는 `t ≥ W+1` 일 때만 만든다. `latest ≥ W+1` 을 요구하므로(§3.1) 일지 행(`r = latest+1 ≥ W+2`)과 재현(`r ≥ W+1`, §7)은 늘 해당한다.

### 3.3 무작위 대조군 `ctrl` (하나 — rec·신호 공통)

같은 주마다 `R = 1000` 벌. 벌 `j = 1..R`:

```
rng = mulberry32(seedCtrl(t, j))
a = [0,1,2,3,4,5,6,7,8,9]
for i = 0..4:  k = i + floor(rng()*(10−i));  swap(a[i], a[k])     // 난수 5번 → 장 i 의 끝자리 = a[i]
g = 0
for i = 0..4:                                                    // 장마다 난수 6번
  for p = 0..4:  d[p] = floor(rng()*10)                          //   앞 5자리, p 순서대로
  band = 1 + floor(rng()*5)                                      //   점수엔 안 쓰지만 반드시 이 자리에서 소비
  g += L(d[0]d[1]d[2]d[3]d[4]a[i], D[t].num)
c_j(t) = g                                                       // 벌 하나 = 난수 정확히 35번, 값 0..6
```

- 행에는 분포만 둔다: `h[k] = #{j : c_j(t) = k}`, `k = 0..6`(길이 7, 합 R). 벌별 원값은 시드로 다시 만든다.
- **rec·신호 모두 이 `ctrl` 이 기준선이다.** 이유 [추론 — §12 귀무 시뮬로 확인]: 끝자리가 서로 다른 5장은 당첨번호 끝자리와 같은 장이 많아야 하나라서 그 장만 점수가 난다. 당첨번호가 자리마다 균등·독립이면 추첨 전에 정한 어떤 5장이든 `P(g ≥ k) = 5·10^(−k)`(k = 1..6, `P(g = 0) = 1/2`)이고 앞 5자리·조와 무관하다. 대조군 벌도 끝자리가 서로 다른 5장이고, 대조군 표는 당첨번호를 보지 않고(시드 = 회차·벌 번호) 모든 자리를 균등하게 고르므로 대조군 벌 값은 당첨번호와 독립이고 분포가 같다. 그래서 정보 없는 rec·신호의 g 와 대조군 R 벌의 g 는 같은 분포이고 서로 독립(교환 가능)이며 주끼리도 독립이다 → §3.4 의 꼬리 비율이 정확한(동점 때문에 보수적인) 기준이 된다. 로또처럼 대조군을 둘로 나눌 필요가 없다(로또 신호의 10줄은 한 풀에서 나와 함께 오르내렸다).
- rec 의 끝자리가 서로 다르지 않으면(추천 규칙이 바뀐 주) 이 기준선은 정확하지 않다 → §3.5 · §5 J3 · §8 P3 경고, §11.

### 3.4 누적 대 대조군 `stat` (관문·재현 공통 — 로또 §3.4 와 같다)

내 누적 `cum`(대상 주들의 g 합)과 대조군 R 벌의 같은 주들 누적 `c_j = Σ_t c_j(t)` 를 견준다.

| 필드 | 뜻 |
|---|---|
| `weeks` | 집계한 주 수 |
| `cum` | 내 누적 |
| `n` | 대조군 벌 수 `R` |
| `min` `med` `max` | 대조군 누적의 최솟값 · 오름차순 정렬의 `floor((R−1)/2)` 번째(0부터 — R=1000 이면 499번째) · 최댓값 |
| `rank` | `1 + #{c_j > cum}` — 큰 값이 앞. `R+1` 이면 대조군 전체보다 낮다 |
| `tie` | `#{c_j == cum}` |
| `le` `ge` | `#{c_j ≤ cum}` · `#{c_j ≥ cum}` |
| `hist` | `[[값, 벌 수], …]` — 나온 값만, 값 오름차순 |

- 키 순서 `weeks, cum, n, min, med, max, rank, tie, le, ge, hist`. 꼬리 비율 `(1+le)/(R+1)`(낮은 쪽) · `(1+ge)/(R+1)`(높은 쪽)은 **정수 곱셈으로 견준다**(부동소수 없음).

### 3.5 경계

| 상황 | 처리 |
|---|---|
| `latest < W+1` | exit 1, 쓰기 없음 |
| 추천 요약 파일 없음·JSON 아님 · `pension` 없음 · `pension.next !== r`(숫자 엄격 비교) · `pension.rule !== 'portfolio'` · `picks` 가 배열이 아니거나 5개 미만 · 앞 5개 중 하나라도 문자열이 아니거나 표 정규식에 안 맞음 | 그 행은 `rec` 키 **없이** 쓰고 `::warning` |
| rec 앞 5장의 끝자리가 서로 다르지 않음 | 그대로 얼리고 `::warning`(대조군이 정확한 기준선이 아님) |
| 모의 원장 파일 없음 · 읽을 수 없음(JSON 아님) · 최상위가 일반 객체가 아님 · `rows` 가 배열이 아님 · 채택된 행(§7) 없음 | `replay.rec = null`. 파일 없음의 알림은 §2.1(명시면 `::warning`, 기본이면 조용히), 읽을 수 없음은 `::warning`. 검증기도 같은 규칙으로 null 을 다시 만든다(§8.1) |
| 관문 대상 주 0 | `{"state":"hold","weeks":0}`(stat 필드 없음) |
| `num === bonus` 인 회차 | 메인 우선(gr 1·2), 보너스 등수 아님 — gradeOf 그대로 |

## 4. 산출 `brief/learn-pension.json` (v1, `ver:"learn-pension-1"`)

### 4.1 상수 (생성기·검증기에 각각 같은 값으로 둔다)

```js
const VER = 'learn-pension-1';
const RULES = [{ ver: 'learn-pension-1', from: 339, signals: ['hot', 'cold', 'gap', 'repeat'] }];   // 덧붙이기만
const ruleFor = (r) => { let x = RULES[0]; for (const u of RULES) if (u.from <= r) x = u; return x; };
const CONF = {
  W: 50,                      // 신호 창(직전 W회)
  TICKETS: 5,                 // 주당 장 수(구매·신호·대조군 공통)
  SALT: { ctrl: 0x5043544C }, // "PCTL" = 1346589772 — 대조군 시드 소금(연금용 새 값)
  CTRL_MUL: 0x85EBCA6B,       // 벌 번호 혼합 상수(로또와 같은 값) = 2246822507
  R: 1000,                    // 대조군 벌 수
  ALARM_MIN_WEEKS: 26, ALARM_P: [1, 100],   // 낙첨 경보: 주 수 ≥ 26 이고 하위 꼬리 비율 ≤ 1/100
  ADOPT_MIN_WEEKS: 52, ALPHA: [1, 20],      // 채택: 주 수 ≥ 52 이고 상위 꼬리 비율 ≤ α/신호 수, α = 1/20
  REPLAY: 300,                // 돌아보면(사후) 재현 범위(최근 회차 수, t ≥ W+1 인 것만)
  CUTOFF_UTC_H: -9            // 마감 = 추첨일 00:00Z − 9시간 = 추첨일 0시 KST [확인 필요 §12]
};
```

- `conf` 는 위 키 순서 그대로, `SALT` 안은 `ctrl` 하나. JSON 에서는 10진수(`1346589772` `2246822507` `-9`).
- `RULES[0].from` = 첫 일지 행으로 예상하는 회차(339). 첫 CI 실행의 `latest+1` 이 달라도 무해하다(`ruleFor` 는 `from` 보다 이른 회차에도 `RULES[0]` 을 준다). 첫 커밋 뒤에는 바꾸지 않는다(P6 접두 일치).

### 4.2 최상위·키 순서 (모든 객체의 키 순서를 고정한다)

```
{ v:1, kind:"learn-pension", ver:VER, generated:<ISO>,
  source:{ file, latest, count, digest },
  conf:CONF, rules:RULES,
  summary:{ next, live:{ done, late, counted, pending }, gate:{ alarm, adopted, rec, sig }, replay:{ label, from, to, rounds, tickets, rec, sig } },
  journal:{ from, missed:[…], rows:[…] },
  checks:{ kept, added, graded, pendingMismatch:[…], regradeMismatch:[…] } }
```

| 키 | 내용 |
|---|---|
| `generated` | 이번 실행 시각 `new Date().toISOString()`. `--now` 가 있으면 `new Date(Date.parse(now)).toISOString()`(밀리초 3자리 `…Z` 로 정규화, 해석 불가면 실패) |
| `source` | `file` = `--history` 경로의 파일 이름(basename) · `latest` · `count` = latest · `digest` = `digest(latest)` |
| `summary.next` | `latest + 1` |
| `summary.live` | `done` = done 행 수 · `late` = `late === true` 인 행 수 · `counted` = done 이고 `late === false` 인 행 수 · `pending` = pending 행 수 |
| `summary.gate` | §6. `sig` 키는 `ruleFor(next).signals` 순서 |
| `summary.replay` | §7 |
| `journal` | §5. `from` = 처음 값 고정 · `missed` = 오름차순 정수 배열 · `rows` = 회차 오름차순 |
| `checks` | 이번 실행의 계수기(멱등 비교에서 뺀다). `kept` = 이전 판 행 수 − `graded` · `added` = 새로 만든 행 수(0/1) · `graded` = 이번에 pending→done 한 수 · `pendingMismatch` = `"r=<회차> <다른 필드,…>"` 문자열 배열 · `regradeMismatch` = `"r=<회차> <처음 다른 res 키>"` 문자열 배열 |

### 4.3 일지 행

- **pending**: `{r, ver, status:"pending", made, basedOn, inputDigest, rec?, sig}`
  - `ver = ruleFor(r).ver` · `made` = 만든 실행의 `generated` **와 같은 문자열** · `basedOn = r−1` · `inputDigest = digest(r−1)`.
  - `rec = {picks:[5장]}` — 추천 요약 `pension.picks` 의 **앞 5개 문자열 그대로**(6~10번째는 품절 대체라 넣지 않는다). §3.5 조건이 안 맞으면 키 자체가 없다.
  - `sig = {hot:{picks:[5]}, cold:{picks:[5]}, gap:{picks:[5]}, repeat:{picks:[5]}}` — `ruleFor(r).signals` 순서.
- **done**: pending 행에 `drawDate, late, res, gradedAt` 이 **이 순서로 뒤에 덧붙는다**(`status` 는 제자리에서 값만 `"done"` — `Object.assign({}, row, {status:'done', drawDate, late, res, gradedAt})` 와 같은 결과). 전체 키 순서: `r, ver, status, made, basedOn, inputDigest, [rec], sig, drawDate, late, res, gradedAt`.
  - `drawDate = D[r].date` · `late = Date.parse(made) ≥ cutoffMs(drawDate)` · `gradedAt` = 채점한(pending→done 으로 바꾼) 실행의 `generated` **와 같은 문자열**.
  - 그래서 모든 done 행은 `Date.parse(made) ≤ Date.parse(gradedAt) ≤ Date.parse(generated)` 이다(P4 가 본다).
  - `res = {band, num, bonus, [rec], sig, ctrl}`
    - `band` `num` `bonus` = `D[r]` 값(정수 · 6자 문자열 · 6자 문자열).
    - `rec = {L:[5], gr:[5], g}`(rec 가 있는 행만) · `sig = {<신호>: {L:[5], gr:[5], g}}`(행의 `sig` 키 순서 그대로). `L`·`gr` 은 picks 순서.
    - `ctrl = {n:R, h:[7]}` — §3.3.

합성 339회(§9.3 ⑤) done 행의 `res` 예:

```
"res":{"band":2,"num":"173851","bonus":"631315","rec":{"L":[0,0,0,0,0],"gr":[0,0,0,0,0],"g":0},"sig":{"hot":{"L":[0,0,0,1,0],"gr":[0,8,0,7,0],"g":1},"cold":{"L":[0,0,0,6,0],"gr":[0,0,0,2,0],"g":6},"gap":{…},"repeat":{…}},"ctrl":{"n":1000,"h":[499,451,40,10,0,0,0]}}
```

### 4.4 직렬화 (바이트 규격 — 로또 생성기와 같은 함수)

```js
const ROW_PATHS = new Set(['journal.rows']);
const EXPAND_PATHS = new Set(['summary.gate', 'summary.replay', 'summary.gate.sig', 'summary.replay.sig']);
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
// 파일 내용 = ser(out, 0, '') + '\n'
```

- 결과: 최상위와 그 바로 아래 객체(`source` `conf` `summary` `journal` `checks`), `summary.gate`·`summary.gate.sig`·`summary.replay`·`summary.replay.sig` 는 키마다 한 줄(깊이당 공백 2칸). 그 밖의 값은 `JSON.stringify` 한 덩어리(공백 없음 — 예 `"SALT": {"ctrl":1346589772}`, `"live": {"done":0,…}`). `journal.rows` 는 **한 줄에 한 행**(공백 6칸 + 행 JSON, 줄 사이 `,\n`, 닫는 `]` 앞 공백 4칸). 파일 끝 `\n` 하나. 줄 끝 LF, UTF-8(BOM 없음), 한글은 이스케이프하지 않는다(`JSON.stringify` 기본).
- 숫자는 **모두 정수**다(부동소수 없음). `JSON.stringify` 기본 10진 표기. 정수 모양 키(`"1"` 같은)는 어디에도 두지 않는다(`JSON.parse` 가 키 순서를 바꾼다).

### 4.5 쓰기·크기

- 임시 파일: 이름은 정확히 `` `${out}.tmp-${process.pid}` ``(예 `brief/learn-pension.json.tmp-1234`) — `out` 과 **같은 폴더**에 둔다(다른 장치로의 rename 은 실패할 수 있어 `os.tmpdir()`·`$RUNNER_TEMP` 는 쓰지 않는다). 그 대신 커밋 영역으로 새지 않게 두 겹으로 막는다:
  - ① 생성기는 이력 정규화가 끝난 뒤(쓰기 여부와 무관하게) `path.dirname(out)` 의 파일 중 이름이 `` `${path.basename(out)}.tmp-` `` 로 시작하고 나머지가 `/^\d+$/` 인 것을 모두 지운다(폴더가 없거나 지우기 실패는 조용히 무시). 시간 초과·러너 종료로 남은 지난 실행의 찌꺼기를 치운다.
  - ② 저장소 루트 `.gitignore` 에 `*.tmp-*` 한 줄을 둔다(리드 몫 — §9.1). CI 커밋 단계의 `git add -A -- … brief …` 는 무시 파일을 올리지 않는다.
- 쓰기: 임시 파일에 쓰고 → `fs.renameSync(tmp, out)`(실패하면 `fs.rmSync(tmp, { force: true })` 로 임시 파일을 지우고 실패). 쓰기 전에 `JSON.stringify(JSON.parse(text)) === JSON.stringify(out)` 로 되읽어 확인하고 `Buffer.byteLength(text) < 1000000` 인지 본다(아니면 실패, 쓰기 없음). `$GITHUB_OUTPUT` 이 있으면 어떤 경로로 끝나든 `wrote=true|false` 를 한 번 쓴다.
- **역행 가드(§5)·실패가 아니면 매 실행 쓴다**(`wrote=true`). 내용이 이전 판과 같아도 쓴다 — «같으면 건너뛰기» 를 넣지 않는다(§9.3 ④ 의 기대 sha 와 `checklearnpen` 단계 조건이 이것을 전제로 한다).
- 멱등 비교에서 빼는 필드: `generated`, `journal.rows[].made`·`gradedAt`, `checks`. 이것은 시험(§9.3 ④)과 사람이 두 산출을 견줄 때 빼는 목록일 뿐, 쓰기 여부를 정하는 기준이 아니다.
- 크기 [근거: 설계 원형 실측 — §9.3 의 입력]: 첫 파일 5,091B(대부분 재현 stat 5개의 `hist`), 합성 1주 뒤 6,714B(관문 stat 이 처음 채워지는 몫 포함). 이후 주당 약 1.0~1.1KB(done 행 약 1.0KB) [추론]. 1년 뒤 약 60KB, 1MB 까지 약 17년 [추론]. §9.3 ⑫ 에서 52주 합성으로 다시 잰다.

## 5. 일지 규칙 (append-only — 로또 §5 와 같은 틀)

처리 순서: ① 이력 정규화 ② 기존 out 읽기 ③ 역행 가드 ④ 추천 요약에서 rec 읽기 ⑤ J1 → J5 → J2 → J3/J4 ⑥ 관문(§6) ⑦ 재현(§7) ⑧ 쓰기 ⑨ `$GITHUB_OUTPUT` ⑩ 알림. `rows` = 이전 판 행을 순서 그대로(J1 로 바뀐 행은 제자리) + 끝에 새 pending.

| 번호 | 규칙 |
|---|---|
| J1 채점 | `r ≤ latest` 인 pending 은 done 으로 바꾼다(§4.3). `late` 행은 관문 집계에서 뺀다. 마감 = 추첨일 0시 KST(§3.1) |
| J2 빠진 주 | J1 뒤 일지의 최대 회차 `lastR` 에 대해 `r = lastR+1 .. latest` 중 행이 없고 `missed` 에 없는 회차를 오름차순으로 `missed` 에 덧붙인다(일지 행이 하나도 없으면 건너뜀). **소급해서 만들지 않는다** |
| J3 새 제시 | `latest+1` 행이 없으면 pending 으로 추가한다. rec 는 §3.5 조건일 때만 넣고 아니면 rec 없이 + `::warning`. rec 의 끝자리 5개가 서로 다르지 않으면 `::warning` |
| J4 동결 | `latest+1` pending 이 이미 있으면 **새로 만들지 않고** 다시 만들어 대조만 한다. 대조 필드와 적는 순서: ① `inputDigest`(다르면) ② `rec` — 지금 요약에서 rec 가 만들어지고, 얼린 행에 rec 가 없거나 `picks` 가 다르면 적는다(지금 rec 가 안 만들어지면 대조하지 않는다) ③ `sig.<신호>` — 얼린 행 `sig` 의 키 순서대로, 다시 만든 5장과 다르면. 하나라도 다르면 `::warning` + `pendingMismatch` 에 `"r=<r> inputDigest,rec,sig.gap"` 꼴(쉼표 구분, 공백 없음)을 하나 넣고 **처음 값을 유지**한다(rec 를 끼워 넣지도 고치지도 않는다). 단 그 행의 `ver` 가 `ruleFor(latest+1).ver` 와 다르면 대조하지 않고 `::warning` 한 줄만 낸다(`pendingMismatch` 에 넣지 않음, 처음 값 유지) |
| J5 재채점 | 이전 판에서 이미 done 이던 행은 다시 채점해 `res` 를 대조만 한다. 다시 만든 `res` 의 키 순서(`band` `num` `bonus` `[rec]` `sig` `ctrl`)로 훑어 `JSON.stringify(파일 값) !== JSON.stringify(새 값)` 인 첫 키를 고르고, 그런 키가 없는데 파일 `res` 에만 있는 키가 있으면 파일 순서로 그 첫 키를 고른다. 있으면 `::warning` + `regradeMismatch` 에 `"r=<r> <그 키>"`, 처음 값 유지 |
| J6 불변 | 행 삭제·재정렬 없음, done 행 바이트 불변. `journal.from` 은 처음 값(첫 실행의 `latest+1`)으로 고정 |
| 역행 가드 | 이전 판의 done 최대 회차 > `latest` 이거나 pending 회차 > `latest+1` 이면 쓰지 않고 `wrote=false` 로 exit 0 + `::warning` |
| 구멍 | 이력에 구멍·형식 오류가 있으면 exit 1, 출력 파일을 건드리지 않는다 |
| 기존 파일 보호 | 기존 out 이 JSON 이 아니거나 `kind !== 'learn-pension'` 이거나 `journal.rows`(비어 있지 않은 배열)·`journal.missed`(배열)·`journal.from`(정수) 모양이 아니거나 행이 «정수 `r` 오름차순·유일·status `pending`/`done`» 이 아니거나, 행의 얼린 표(`rec.picks` — 키가 있을 때, `sig.<신호>.picks` — `sig` 는 일반 객체)가 «배열 정확히 5개 · 모두 문자열 · 표 정규식» 이 아니거나, done 행에 `made`·`gradedAt` 문자열과 `res` 객체가 없으면 `::error` + exit 1, 덮어쓰지 않는다(J1·J4·J5 가 깨진 표로 채점·대조하지 않게). 행이 일반 객체가 아니어도 같다 |

- **rec 가 없는 행**: 추천 요약이 그 회차 것이 아닐 때(CI 순서·요약 실패) 생긴다. 한 번 rec 없이 얼린 pending 에는 나중에 rec 를 끼워 넣지 않는다. 그 주는 낙첨 분석 집계에서 빠진다.
- **`RULES`**: `{ver, from, signals[]}` 덧붙이기만. 신호를 더할 때 새 항목(`from` = 시작 회차, `signals` = 늘어난 목록)을 더하고 `VER` 을 올린다. **새 항목의 `from` 은 이전 판 `journal.rows` 의 최대 `r` 보다 커야 한다**(보통 지금 pending 회차 + 1 = `latest + 2` 이상). 이미 얼린 행의 `ver` 는 어떤 경우에도 바뀌지 않는다. 이미 얼린 회차를 덮으면 그 행의 `ver` 가 `ruleFor(r).ver` 와 영영 달라져 P2 가 계속 실패한다 — P6 이 막는다.
- **같은 이름 신호의 정의는 바꾸지 않는다**: 정의 상수 `W` `TICKETS` `CTRL_MUL` `R` `CUTOFF_UTC_H` 와 이미 있는 `SALT.*`, 그리고 §3.1~§3.3 의 식은 모든 행에 똑같이 적용되는 한 벌이다. 바꾸면 옛 행을 새 정의로 다시 계산해 P2·P4 가 실패하고, 정의가 다른 행이 한 누적으로 합쳐진다. P6 이 이전 판과 이 상수들이 다르면 오류로 막는다. 바꾸고 싶으면 새 이름의 신호로 더하거나 장부를 갈아탄다(§11).
- **알림**(바이트와 무관):
  - 매 실행 `::notice title=연금 학습 장부::<next>회 사전 등록 · 일지 <행 수>행(집계 <counted>주, 늦음 <late>) · 추가 <added> · 채점 <graded>`.
  - 경보 `::warning title=연금 낙첨 분석::구매 5장의 <weeks>주 누적(<cum>)이 같은 주 무작위 대조군 <R>벌 중 <rank>위(대조군 범위 <min>~<max>) — 하위 1% 안입니다. 점검: 구매 5장의 끝자리 구조·채점·입력` (`rank > R` 이면 «대조군 <R>벌 모두보다 낮음»).
  - 채택 `::notice title=연금 학습 실험실::신호 <s> 채택 조건 충족(<weeks>주 · 누적 <cum> · 대조군 <R>벌 중 <rank>위) — 추천 반영은 소유자 결정입니다(코드는 자동으로 바뀌지 않습니다)`.
  - 그 밖의 경고 `::warning title=learn-pension::…`, 실패 `::error title=learn-pension::…`.

## 6. 관문 (live = `status === 'done' && late === false` 인 행) — 매 실행 다시 계산

경보·채택은 일지에 박제하지 않는 **파생값**이다(`summary.gate`). 모양 `{alarm, adopted, rec, sig}`. `rec`·`sig.<s>` 값은 `{state, …stat}`(키 순서 `state` 다음 §3.4 순서) 또는 대상 주가 없으면 `{"state":"hold","weeks":0}`.

### 6.1 낙첨 분석 (`gate.rec`)

대상: live 이고 `rec` 가 있는 행. `cum` = 그 행들 `res.rec.g` 의 합, 대조군 누적 `c_j` = 같은 주들의 `c_j(r)` 합(§3.3, 시드로 다시 만든다).

| 상태 | 조건 |
|---|---|
| `hold` 판단 보류 | `weeks < ALARM_MIN_WEEKS(26)` 또는 대상 주 없음 |
| `alarm` 경보 | `weeks ≥ 26` 이고 `(1+le)·ALARM_P[1] ≤ ALARM_P[0]·(R+1)` |
| `inside` | 그 밖 |

- `gate.alarm = (rec.state === 'alarm')`. 경보면 §5 의 `::warning` 을 낸다.
- 화면은 `inside` 이면서 `cum > max` 일 때만 «대조군 범위 안» 대신 중립색 «경보 없음» 으로 보인다(§10).

### 6.2 학습 실험실 (`gate.sig.<신호>`)

대상: live 이고 그 신호가 있는 행. 대조군은 6.1 과 **같은 `ctrl`** 이다(§3.3). 신호 수 `nSig = ruleFor(next).signals.length`.

| 상태 | 조건 |
|---|---|
| `hold` | `weeks < ADOPT_MIN_WEEKS(52)` 또는 주 없음 |
| `adopt` 채택 조건 충족 | `weeks ≥ 52` 이고 `(1+ge)·ALPHA[1]·nSig ≤ ALPHA[0]·(R+1)`(상위 꼬리 비율 ≤ α/신호 수, 본페로니) |
| `none` 채택 없음 | 그 밖 |

`gate.adopted` = `adopt` 인 신호 이름(신호 순서). 하나라도 있으면 §5 의 `::notice` 를 낸다. 코드는 바뀌지 않는다.

## 7. 돌아보면(사후) 재현 (`summary.replay`)

- 범위: `from = max(W+1, latest − REPLAY + 1)`, `to = latest`, `rounds = to − from + 1`. (338회 자료면 51..338 = 288회. `latest ≥ 350` 부터 300회.)
- 각 회차 `r` 에 신호 4개를 `past(D, r)` 로만 만들어(walk-forward) 채점한다: `cum_s += g`. 신호의 대조군 누적 = 범위 전체 `Σ_r c_j(r)`.
- `rec`: 모의 원장(`--sim`)을 읽는다. 파일 없음·읽을 수 없음(JSON 아님)·최상위가 일반 객체가 아님·`rows` 가 배열이 아님 → 행이 없는 것으로 보고 `rec: null`(§3.5). 행 `x` 는 다음을 **모두** 만족할 때만 **채택**한다:
  `x` 가 일반 객체 · `x.status === 'done'` · `Number.isInteger(x.round)` · `from ≤ x.round ≤ latest` · `Array.isArray(x.picks) && x.picks.length === 5` · `x.picks` 원소가 모두 `typeof === 'string'` 이고 표 정규식 `/^([1-5])조 (\d{6})$/` 에 맞음.
  배열을 앞에서부터 훑어 채택한 행으로 `round → picks` 를 덮어쓴다 — 같은 `round` 를 채택한 행이 여럿이면 **배열에서 가장 뒤의 채택 행**이 이긴다. 채택되지 않은 뒤 행은 앞의 채택 행을 지우지 않는다(로또 `readSimPicks` 와 같은 순서). 그렇게 남은 회차들(오름차순)의 g 합을 `cum`, 같은 회차들의 `Σ c_j(r)` 를 대조군으로 `stat`. 남은 회차가 없으면 `rec: null`. 모의 원장은 지금 규칙(`spread@334`)을 100회부터 매주 적용했다고 «가정» 한 장부다 [근거: brief/sim-pension.json `rule`·`note`].
- 요약 = `{label:"돌아보면(사후)", from, to, rounds, tickets: CONF.TICKETS, rec, sig:{<신호>: stat}}` — `sig` 키는 `ruleFor(next).signals` 순서. **회차별 원자료는 저장하지 않는다.**
- 화면에서는 반드시 «돌아보면(사후)» 라벨을 단다. 결과를 안 뒤에 계산한 표라 관문에 쓰지 않는다 — 관문은 추첨 전에 얼린 live 행만 본다.

## 8. 독립 검증 `scripts/check-learn-pension.mjs`

### 8.1 원칙·사용

- 생성기를 import 하지도 실행하지도 않는다. `pension.html`·`record.html` 의 코드도 가져오지 않는다(규칙 10). §3~§7 을 이 문서대로 다시 구현한다. 읽기 전용. 실패는 `::error title=check-learn-pension::P<번호> …` 한 줄씩(검사당 최대 12줄 + «…외 N건»), 경고는 `::warning title=check-learn-pension::…`.

```
node scripts/check-learn-pension.mjs --root . --file brief/learn-pension.json --history brief/pension-history.json
     [--summary brief/latest-summary.json] [--sim brief/sim-pension.json] [--prev-git HEAD | --prev <이전 파일>]
     [--page record.html] [--gen scripts/learn-pension.mjs] [--only P2,P4] [--skip P6]
```

- **종료 코드** (CI 되돌림이 이것으로 갈린다 — §9.1):

| 코드 | 뜻 | CI 되돌림 |
|---|---|---|
| `0` | 고른 검사 모두 통과(경고는 있어도 됨) | 없음 |
| `1` | **장부 데이터 실패**: P0~P6·P9 중 하나라도 실패, 또는 옵션 오류·입력(이력·`--file`) 읽기 실패·잡히지 않은 예외 | 장부를 HEAD 로 되돌림 |
| `2` | **장부 데이터는 맞고 화면·소스 점검만 실패**: P0~P6·P9 가 모두 통과(또는 옵션으로 생략)이고 P7·P8 중 하나 이상 실패 | 없음(실패 표시만) |

  - 판정 순서: 1 의 조건이 하나라도 있으면 1, 아니면 P7·P8 실패가 있으면 2, 아니면 0. 2 는 이 경우 말고는 쓰지 않는다.
  - 이유: P7(`record.html` 문구)·P8(생성기 소스)은 장부 바이트와 무관하다. 이것 때문에 장부를 되돌리면 그 주 pending 이 사라지고 다음 주 J2 로 `missed` 가 되어 **영영 채워지지 않는다**(소급 생성 금지).
- 기본값: `--root .` · `--file brief/learn-pension.json` · `--history brief/pension-history.json` · `--summary brief/latest-summary.json` · `--sim brief/sim-pension.json` · `--page record.html` · `--gen scripts/learn-pension.mjs`. 모든 상대 경로는 생성기와 같이 `--root` 기준이다(`path.resolve(root, p)`). 모르는 옵션·값이 빠진 옵션·같은 옵션 두 번·`--prev` 와 `--prev-git` 을 함께 줌 → `::error` + exit 1.
- `--only <목록>` · `--skip <목록>`: 쉼표로 나눈 검사 이름(`P0`…`P9`, 대소문자 무시, 공백 허용). 그 밖의 이름이 있으면 옵션 오류(exit 1). 둘 다 주면 `--only` 로 고른 것에서 `--skip` 을 뺀다. 고르지 않은 검사는 **판정만 하지 않는다**: 입력 읽기·이력 정규화·이전 판 읽기는 늘 하고, 고르지 않은 검사는 «생략(옵션)» 한 줄로 표시하며 종료 코드에 넣지 않는다. 아래 실행 순서의 «P0 모양 실패» 조건은 P0 을 골랐는지와 무관하게 늘 계산한다(고르지 않았으면 보고·종료 코드에만 안 넣는다). 로컬 진단용이다 — CI 는 쓰지 않는다(§9.1, 종료 코드 2 로 가른다).
- **`--summary`·`--sim` 은 생성기와 같은 규칙으로 읽는다**(§2.1·§3.5): 주지 않아도 기본 경로를 읽고, 파일이 없으면(명시든 기본이든) `::warning` 한 줄. 없음·읽을 수 없음·모양 어긋남도 **정해진 입력 상태**다 — sim 이면 `replay.rec = null`, summary 면 `want` 없음(P3). 건너뛰는 대조는 없다: P5·P9 는 늘 검증기가 읽은 대로 `replay.rec` 를 다시 만든다. 그래서 생성기는 sim 을 읽어 `replay.rec` 를 썼는데 검증기가 sim 을 읽지 못했으면 P5·P9 가 **오류**다(입력 불일치 — 오류 줄에 «검증기가 sim 을 읽지 못함» 을 붙인다). CI 는 두 단계에 같은 경로를 명시한다(§9.1).
- **이전 판 읽기** — 결과는 정확히 넷 중 하나다: `none` · `ok` · `absent` · `error`.
  1. `--prev`·`--prev-git` 둘 다 없음 → `none`.
  2. `--prev <파일>`: `path.resolve(root, 파일)` 을 읽는다. 없거나 읽을 수 없으면 `error`. 읽었으면 4 로.
  3. `--prev-git REF`: 먼저 `rel = path.relative(path.resolve(root), path.resolve(root, file)).split(path.sep).join('/')`. `rel === ''` 이거나 `rel === '..'` 이거나 `rel.startsWith('../')` 이거나 `path.isAbsolute(rel)`(Windows 의 다른 드라이브) 이면 `error`(`--file` 이 `--root` 밖). git 은 셸 없이 `child_process.execFileSync('git', [인자…], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })` 로 부르고 종료 코드 ≠ 0 이면 실패로 본다:
     - `git rev-parse --verify --quiet <REF>^{commit}` 실패 → `error`(REF 없음·얕은 체크아웃에 없음·git 없음).
     - `git cat-file -e <REF>:./<rel>` 실패 → `absent`(그 판에 파일이 없음 — 첫 실행·`.lab/` 같은 무시 폴더의 시험 산출). `./` 는 `--root` 가 저장소 최상위가 아니어도 `rel` 을 `--root` 기준으로 풀게 한다.
     - `git show <REF>:./<rel>` 실패 → `error`. 성공하면 그 글(`utf8`)로 4 로.
  4. (2·3 공통) 읽은 글의 `\r\n` → `\n`(아래 «줄 끝»).
  5. `JSON.parse` 실패, 또는 일반 객체가 아니거나 `kind !== 'learn-pension'` 이거나 `journal.rows` 가 배열이 아니면 `error`. 아니면 `ok`.
- **이전 판을 «앎»** = `ok` 또는 `absent`. `absent` 는 **행 0개인 빈 장부**로 다룬다: P2 는 모든 행을 «이전 판에 없던 행» 으로, P3 은 `latest+1` pending 행을 «이번 실행에서 새로 얼린 행» 으로, P4 는 «이전 판에서 pending 이던 행» 이 없는 것으로 본다. **«모름» 은 `none` 뿐이다.** `error` 면 P6 이 실패(`P6 이전 판을 읽지 못함: <이유>`, exit 1)하고, 나머지 검사는 «모름» 처럼 돈다(오류 줄을 겹치지 않게).
- 실행 순서: P0 · P1 → (이력 문제나 P0 모양 실패가 없을 때만) P2 · P3 · P4 · P5 · P9 → P6 → P7 · P8. P6 은 이전 판이 `ok` 이고 이력 문제·P0 모양 실패가 없을 때만 대조한다. 그 밖에는 앞의 것부터 하나만 적용한다: `error` → 실패(위 — 지금 판 모양과 무관) · `none` → «생략(이전 판 없음)» · `absent` → «생략(이전 판에 파일 없음)» · 이력 문제나 P0 모양 실패 → «생략(지금 판 모양 실패)». 생략은 종료 코드에 영향이 없다.
- 줄 끝: 바이트 비교(P0 재직렬화 · P6 행 줄 · P9) 전에 읽은 글(지금 판·이전 판)의 `\r\n` 을 `\n` 으로 바꾼다. `\r` 이 있었으면 경고만 낸다 — 이 PC 는 `core.autocrlf=true` 라 체크아웃한 작업 트리 사본이 CRLF 일 수 있다(CLAUDE.md §4). 생성기는 늘 LF 로 쓰고, 저장소·CI 사본은 LF 다. 크기 검사는 원래 바이트로 한다.

### 8.2 검사

- **깊은 비교** = 객체는 키 집합과 키마다의 값이 같으면 같다(**객체 키 순서는 보지 않는다**), 배열은 길이와 순서까지 같아야 한다, 원시값은 `===`. `JSON.stringify` 대조로 짜지 않는다. 키 순서는 P9(바이트)만 본다.
- **ISO** = `typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && new Date(Date.parse(s)).toISOString() === s` — 생성기가 쓰는 `toISOString()` 모양(밀리초 3자리·`Z`)만 통과한다. 날짜만 있는 값(`'2026-10-28'`)·시간대 표기(`+09:00`)·밀리초 없는 값은 실패. `generated`·`made`·`gradedAt` 에 똑같이 쓴다.

| 검사 | 내용(정확한 비교 대상) |
|---|---|
| P0 구조 | 최상위 키 10개가 §4.2 순서 그대로 · `v === 1` · `kind === "learn-pension"` · `ver === VER` · `generated` 가 ISO(위 정의) · `journal`(`from` 정수, `missed`·`rows` 배열)·`summary`(`gate`·`replay`) 모양 · 행 `r` 정수 오름차순·유일 · status `pending`/`done` · pending ≤ 1 이고 마지막 행 · done 행에 `drawDate` `late` `res` `gradedAt` 이 있고 pending 행에는 없음 · `journal.from === 첫 행 r` · `checks` 모양(정수 3개 + 문자열 배열 2개) · 파일 < 1MB · **재직렬화 일치** `ser(JSON.parse(text)) + '\n' === text`(§4.4 — 한 줄 한 행·공백·LF·끝 줄바꿈까지). 경고: `checks.pendingMismatch`·`regradeMismatch` 가 비어 있지 않음 |
| P1 입력 | 이력 정규화(§3.1) 문제가 있으면 오류 · `source.file` = 이력 파일 이름 · `source.latest === source.count === latest` · `source.digest === digest(latest)` · `conf` 가 §4.1 `CONF` 와 값이 같음(깊은 비교) · `rules` 가 `RULES` 와 같음 · `summary.next === latest + 1` |
| P2 신호·일지 연속 | 모든 행: `W+2 ≤ r ≤ latest+1` · pending 은 `r = latest+1` 만 · done 은 `r ≤ latest` · `ver === ruleFor(r).ver` · `basedOn === r−1` · `inputDigest === digest(r−1)` · `made` 가 ISO · 이전 판을 알 때(§8.1 — 빈 장부 포함) **이전 판에 없던 행은 `made === generated`**(문자열 비교 — 미래 누설·late 우회 막기) · `sig` 키 = `ruleFor(r).signals`(순서까지) · 신호마다 `picks` = **`D` 의 1..r−1 만 잘라 넘긴 배열**로 다시 만든 5장(§3.2)과 같음. **마지막 행 = `latest+1` 인 pending**(없으면 오류 — 이번 주 사전 등록이 조용히 사라지는 회귀). `journal.missed` = `from..latest` 중 행이 없는 회차(오름차순, 순서까지) |
| P3 rec | rec 가 있는 행: `picks` 가 정확히 5개, 모두 표 정규식(아니면 오류) · 끝자리 5개가 서로 다르지 않으면 경고. 추천 요약 대조 — `want` = §3.5 조건을 만족하는 요약의 앞 5장(그 회차 것일 때만): **이번 실행에서 새로 얼린 행**(이전 판을 앎 — `--prev-git` 의 파일 없음 = 빈 장부 포함, §8.1 · pending · `r = latest+1` · 이전 판에 같은 회차 행 없음)인데 `want` 가 있고 rec 가 없거나 `want` 와 다르면 **오류**. 이전 판에 이미 있던 행이 `want` 와 다르면 경고(처음 값 동결). 이전 판을 모르면(옵션을 주지 않음) 경고로 낮추고 안내. 요약을 읽지 못해 `want` 가 없으면 이 대조는 안내 한 줄만. 모의 원장 대조 — §7 의 행 채택 조건에서 **`status` 조건과 범위 조건만 뺀** 같은 식(일반 객체 · 정수 `round` · picks 배열 정확히 5개 · 모두 문자열·표 정규식)으로 채택하고, 같은 `round` 의 채택 행이 여럿이면 배열에서 가장 뒤 채택 행. 그 picks 가 행 r 의 rec 와 다르면 경고 |
| P4 채점 | done 행마다: `drawDate === D[r].date` · `late === (Date.parse(made) ≥ cutoffMs(D[r].date))` · `gradedAt` ISO · `Date.parse(made) ≤ Date.parse(gradedAt) ≤ Date.parse(generated)` · 이전 판을 알고 그 판에서 pending 이던 행이면 `gradedAt === generated`(이번 실행이 채점) · `res` = `{band, num, bonus, rec?(rec 있는 행만), sig(행 sig 키마다 §3.1 L·gr·g), ctrl:{n:R, h}}` 깊은 비교 — `h` 는 R 벌을 §3.3 대로 다시 만들어 센다 |
| P5 요약 | `summary.live` 재계산 · `summary.gate` 를 **picks 로 다시 채점한 g** 와 다시 만든 대조군으로 처음부터 재계산(상태·`alarm`·`adopted` 포함) · `summary.replay` 재계산(`rec` 까지 — 검증기가 §7 규칙으로 읽은 sim 으로. 못 읽었으면 `rec = null` 로 다시 만든 것과 견준다, §8.1) |
| P6 append-only | 이전 판이 `ok` 일 때만 대조(그 밖은 §8.1 실행 순서 — `error` 면 실패, 나머지는 생략): **`source.latest` 역행 금지**를 먼저 본다 — 이전 판 `source.latest` 가 정수가 아니거나 지금 `latest` 보다 크면 오류 한 줄을 내고 이력 정정 감지는 하지 않는다. 그렇지 않을 때만 **이력 정정 감지**(이전 판의 `source.digest` ≠ 지금 이력의 `digest(이전 판 source.latest)`) · `journal.from` 같음 · 이전 판 행 회차 목록이 지금 행의 접두(삭제·재정렬·중간 삽입 금지) · 이전 판 done 행은 값이 같고 **줄 글자도 같음**(행 줄 = `/^\s*\{"r":(\d+),/` 에 맞는 줄에서 앞 공백과 끝 쉼표를 뗀 글 — 글자만 달라도 오류) · 이전 판 pending 행의 얼린 필드(`ver` `made` `basedOn` `inputDigest` `rec` `sig`) 불변 · `missed` 접두 일치 · `rules` 접두 일치 · 이전 판보다 늘어난 `rules` 항목의 `from` ≤ 이전 판 행의 최대 `r` 이면 오류(§5 `RULES`) · `rules` 길이가 같은데 `conf` 가 다르면 오류(VER·rules 를 올리지 않음) · 정의 상수(`W` `TICKETS` `CTRL_MUL` `R` `CUTOFF_UTC_H` 와 이전 판에 있던 `SALT.*`) 불변 |
| P7 문구 | JSON 의 모든 문자열(키 포함)에 `FORBID` 0건. `record.html`(`--page`)의 `pageSections(html)` 두 구간(`#learnPenWrap` 섹션 · JS 구간 `LEARNPEN-BEGIN~END`, 주석 포함 전체)에 `FORBID`·`THEORY_PEN` 0건. 페이지 파일·섹션·구간이 아직 없으면 그 부분은 안내만. 정규식과 구간 자르기는 아래 코드 블록 그대로. (크기 검사는 P0 한 곳에만 둔다.) 실패하면 종료 코드 2(§8.1) |
| P8 정적 | 생성기 소스(`--gen`)를 `stripComments` 로 주석을 걷어낸 코드에: `RANDOM` 0건 · `DATE_LINE` 에 맞는 줄은 모두 `DATE_OK` 에 맞음 · `DYNAMIC` 0건 · `IMPORT_FROM` 으로 찾은 모듈 이름이 모두 `IMPORT_OK` 안(다른 스크립트·페이지·검증기 import 금지). 정규식은 아래 코드 블록 그대로. 파일이 없으면 안내만. 실패하면 종료 코드 2(§8.1) |
| P9 바이트 재구성 | 기대 문서 E 를 만든다. **파일에서 가져오는 것** — 문서 단위: 최상위 `generated`·`checks`, `journal.from`, `journal.rows` 의 행 목록(어떤 `r` 이 어느 순서로 있는지). 행 단위: `status`·`made`·`gradedAt`(done 행만)·`rec`(**키의 유무와 값 그대로** — 얼린 입력이고 P3 가 따로 본다. 다시 만들지 않는다). **그 밖의 모든 값은 §3~§7 로 다시 만든다**: 행의 `ver`·`basedOn`·`inputDigest`·`sig`, 파일에서 `status` 가 done 인 행의 `drawDate`·`late`·`res`, `journal.missed`, `source`·`conf`·`rules`·`summary` 전체(`summary.gate`·`summary.live` 는 E 의 행 — 파일에서 가져온 `status`·`made`·`rec` 와 다시 만든 `sig`·`late`·`res` — 으로 다시 계산, `summary.replay.rec` 는 검증기가 읽은 sim 으로 — §8.1). 행 객체는 §4.3 의 키 순서로, 최상위는 §4.2 순서로 담는다. `ser(E, 0, '') + '\n'` 이 파일과 **바이트 단위로 같아야** 한다. 다르면 첫 다른 줄 번호와 양쪽 90자를 적는다. 키 순서·표기 차이를 잡는 마지막 관문. 파일에서 가져온 `r` 목록이 타당한지는 P0(오름차순·유일)·P2(범위·마지막 pending·`missed`)가 본다 |

**P7·P8 의 정규식·자르기 원문** — 표 칸 안에서는 `|` 를 `\|` 로 이스케이프해야 해서 원문이 흐려진다. 그래서 **이 코드 블록이 유일한 원문**이다. 검증기는 글자 그대로 옮긴다(표의 이름은 이 블록을 가리킨다).

```js
// P7 — JSON 문자열 전체에 FORBID, 화면 두 구간에 FORBID·THEORY_PEN
const FORBID = /확률을 높|잘 나오|당첨 보장|가능성이? 높|적중률 높/;
const THEORY_PEN = /p값|σ|표준편차|기대|몬테카를로|정확 확률|이론|상한|평균/;
function pageSections(html) {            // 없는 구간은 null
  const out = { section: null, js: null };
  const at = html.indexOf('id="learnPenWrap"');
  if (at >= 0) {
    const s = html.lastIndexOf('<section', at), e = html.indexOf('</section>', at);
    if (s >= 0 && e > at) out.section = html.slice(s, e + '</section>'.length);
  }
  const b = html.indexOf('/* LEARNPEN-BEGIN */'), f = html.indexOf('/* LEARNPEN-END */');
  if (b >= 0 && f > b) out.js = html.slice(b, f + '/* LEARNPEN-END */'.length);
  return out;
}

// P8 — 생성기 소스 정적 점검(주석을 걷어낸 코드만 본다)
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const RANDOM = /Math\s*\.\s*random/;                     // 0건
const DATE_LINE = /\bDate\b/;                            // 이 줄들은 모두 DATE_OK 에 맞아야 한다
const DATE_OK = /Date\.parse|Date\.UTC|new Date\((?:[A-Za-z_$][\w$]*)?\)\.toISOString\(\)/;
const DYNAMIC = /\bimport\s*\(|\bimport\s*\.\s*meta\b|\brequire\s*\(/;   // 0건
const IMPORT_FROM = /^\s*import\b[^;'"]*['"]([^'"]+)['"]/gm;            // 정적 import 의 모듈 이름(1번 묶음)
const IMPORT_OK = new Set(['node:fs', 'node:path']);
```

- `DATE_OK` 는 `new Date()` 와 `new Date(<변수 이름 하나>)` 의 `.toISOString()` 을 허용한다(`ms` 같은 특정 이름에 묶지 않는다 — §3 머리). `new Date(Date.parse(now)).toISOString()` 은 `Date.parse` 로 맞는다.
- 소스·페이지 글은 읽은 뒤 `\r\n` → `\n` 으로 바꾸고 본다.

### 8.3 경고만 내는 것 (이유)

- P3 «이전 판에 이미 있던 행» 의 rec 가 지금 요약과 다름 — 처음 공개한 값 동결 원칙이라 생성기도 `::warning` 만 낸다. 이전 판을 모를 때는 새 행을 가려낼 수 없어 경고로 둔다.
- P3 rec 끝자리 겹침 — 소유자가 추천 규칙을 바꾼 정상 상황일 수 있다(§11). 그 대신 매주 경고로 남긴다.
- P3 모의 원장과 다름 — 모의 원장은 «가정» 장부라 참고 대조다.
- P0 `checks` 의 불일치 배열이 비어 있지 않음 — 생성기가 이미 경고했다. 원인은 사람이 본다.
- `--summary`·`--sim` 파일 없음 — 생성기도 같은 규칙으로 경고만 내고 «없음» 을 정해진 입력 상태로 다룬다(§2.1·§8.1). 다만 생성기와 검증기가 받은 입력이 달라 결과가 갈리면 P5·P9 가 오류로 잡는다.
- **이력 정정(과거 회차 값이 바뀜)은 경고가 아니라 오류다**: 생성기는 J4·J5 로 `::warning` 만 내고 처음 값을 유지하지만, 검증기는 P2(`inputDigest`·신호)·P4(채점)·P6(이력 정정 감지)·P9 가 실패한다. CI 되돌림이 장부를 HEAD 로 복원해 장부가 멈춘다(§11 수리 절차).

### 8.4 주입 시험 (검출 확인 — 시험 폴더의 사본에만, 추적 파일 금지)

기준 산출: §9.3 ⑤ 의 합성 2주차 파일 `w2.json`(339 done · 340 pending)과 그 직전 판 `w1.json`. 수정 전 사본이 exit 0 인지 먼저 본다.

| 번호 | 주입 | 기대 |
|---|---|---|
| I1 done 행 변조 | 339 행 `res.sig.hot.g` 1→2 | P4·P9 실패(P5 는 picks 로 다시 채점하므로 통과). 합성 3주차(340 채점)에서 `--prev w2` 로 같은 변조를 하면 P6(done 불변)도 실패 |
| I2 대조군 분포 변조 | 339 행 `res.ctrl.h` 의 0번·1번 칸 맞바꿈(합 1000 유지) | P4·P9 실패 |
| I3 상수 변경 | 파일의 `conf.SALT.ctrl` 을 1 늘림 | P1·P9 실패, `--prev w1` 이면 P6(정의 상수·VER 미변경)도 |
| I3b 상수 변경(생성기) | `CONF.R = 999` 로 고친 생성기 사본으로 ③→⑤ 를 다시 만든 파일 | P1(conf)·P4(`ctrl.n`·`h`)·P5(stat 의 `n`)·P9 실패 |
| I4 rec 가 요약과 다름 | 340 행 `rec.picks[0]` 을 `"2조 873869"` 로(검사는 ⑤ 의 요약 사본을 `--summary` 로) | `--prev w1`(340 행이 없는 판): P3 오류. 이전 판 없이: P3 경고만이고 exit 0(설계대로) |
| I5 pending 신호 변조 | 340 행 `sig.gap.picks` 의 두 장 순서 교환 | P2·P9 실패 |
| I6 행 삭제 | 339 행을 지우고 `missed` 에 339 를 넣음 | P0(`from` ≠ 첫 행)·P5(`live`)·P9 실패, `--prev w1` 이면 P6(행 사라짐)도 |
| I7 late 뒤집기 | 339 행 `late` false→true | P4·P5(`live`·`gate`)·P9 실패 |
| I8 키 순서만 | 339 행 `res` 의 `band`·`num` 순서 교환(값 같음) | P9 실패(P0 재직렬화·P4 깊은 비교는 통과 — 키 순서는 P9 가 잡는다) |
| I9 이번 주 등록 삭제 | 마지막 행(340)을 지우고 앞 줄의 쉼표를 정리 | P2(마지막 행 ≠ latest+1 pending)·P5(`live`)·P9 실패 |
| I10 생성기 결정성 | `--gen` 에 `Math.random()` 한 줄 넣은 생성기 사본 | P8 실패, **exit 2**(장부 데이터 검사는 통과) |
| I11 표기 | 파일 끝 줄바꿈 제거, 또는 한 행을 두 줄로 | P0·P9 실패 |
| I12 made 앞당김 | 340 행 `made` 를 하루 앞 ISO 로(그 밖 그대로) | `--prev w1`(340 이 없던 판): P2 실패(`made !== generated`). P9 는 `made` 를 파일에서 가져오므로 통과 |
| I13 RULES 가 얼린 회차를 덮음 | 생성기·검증기 사본 둘 다 `RULES` 에 `{ver:'learn-pension-2', from:340, signals:[4개 그대로]}` 를 덧붙이고 `VER` 을 올린 뒤 합성 3주차(340 채점) 실행 | `--prev w2`: P6 실패(새 항목 `from` 340 ≤ 이전 판 최대 r 340) · P2 실패(340 행 `ver`) |
| I14a 이전 판 REF 없음 | 수정 없는 `w2` 를 `--prev-git NOSUCHREF` 로 검사 | P6 실패(이전 판 `error` — REF 없음), exit 1 |
| I14b 이전 판 파일 없음 | 수정 없는 `w2` 를 `--prev <없는 경로>.json` 으로 검사 | P6 실패(이전 판 `error`), exit 1 |
| I14c 첫 실행의 rec 변조 | ③ 의 산출(`.lab/out-learnpen/` 아래 — HEAD 에 없음)에서 339 `rec.picks[0]` 의 **첫 자리 숫자만** 다른 숫자로 바꾸고, ③ 과 같은 입력으로 `--prev-git HEAD` 검사 | 이전 판 `absent`(빈 장부를 앎) → P3 오류(새로 얼린 행의 rec ≠ 요약 앞 5장), exit 1. P6 은 «생략(이전 판에 파일 없음)», P9 는 rec 를 파일에서 가져오므로 통과 |
| I14d `--file` 이 `--root` 밖 | `w2` 사본을 `--root` 밖(예 `--file ../w2.json`)에 두고 `--prev-git HEAD` 검사 | P6 실패(이전 판 `error` — `--file` 이 `--root` 밖), exit 1. 조용히 «생략» 되면 안 된다 |
| I15 얼린 rec 재작성(채점 때) | `w2` 의 339 행(done) `rec.picks[0]` 의 **첫 자리 숫자만** 다른 숫자로 바꾼다. 끝자리를 그대로 두므로 이 행의 `res.rec`(L 0 · gr 0)·`summary` 는 고칠 필요가 없다(바뀐 표가 당첨 `173851`·보너스 `631315` 와 같아지지 않게 고른다) — «생성기가 J1 때 rec 를 지금 값으로 바꿔 쓰고 res 까지 맞춘» 회귀를 흉내 낸다 | `--prev w1`(339 가 pending 이던 판): P6 실패(pending 얼린 필드 `rec`), exit 1. 이전 판 없이: exit 0 — P3 은 339 가 요약 회차(340)가 아니라 대조하지 않고 P4·P5·P9 는 자기 일관이라 통과(설계대로 — **이 회귀는 P6 만 잡는다**, 그래서 CI 는 `--prev-git HEAD` 필수) |
| I16 얼린 made 재작성(채점 때) | `w2` 의 339 행(done) `made` 를 1시간 앞당긴 ISO 로(그 밖 그대로 — `late` 는 false 그대로 맞다) | `--prev w1`: P6 실패(pending 얼린 필드 `made`), exit 1. 이전 판 없이: exit 0(P4 의 `late`·시각 순서는 그대로 맞고 P9 는 `made` 를 파일에서 가져온다) |
| I17 화면 문구 | 시험 사이트 사본의 `record.html` `#learnPenWrap` 안 문장 하나에 «평균» 을 넣고 `--page <그 사본>` 으로 수정 없는 `w2` 를 검사 | P7 실패, **exit 2**(장부 데이터 검사는 통과 — CI 라면 되돌리지 않는다) |

## 9. CI 와 로컬 실행

### 9.1 CI (배선·CLAUDE.md 규칙·`sw.js` 캐시 이름은 리드)

- 위치: `weekly.yml`(두 사본 `.github/workflows/`·`setup/workflows/` 같게)에서 로또 학습 장부 단계들(`learn` → `checklearn` → 되돌림 → `poplearn` → `checkpoplearn` → 되돌림) **바로 뒤**. `주간 브리핑`(`pension-history.json`·`latest-summary.json` 을 씀)과 `모의 원장 적재`(`sim-pension.json`)보다 뒤여야 rec·재현이 채워진다.
- 단계 id: `learnpen`(생성, `continue-on-error`) → `checklearnpen`(독립 검증, `learnpen` 이 성공하고 `wrote=true` 일 때, `continue-on-error`, **`--prev-git HEAD` 필수** — 없으면 이전 판이 `none` 이라 P6 이 생략되고 P3 가 새 행을 가려내지 못한다) → **종료 코드가 2 가 아닌 실패일 때만** `brief/learn-pension.json` 을 HEAD 것으로 되돌림(HEAD 에 없으면 지움) → 끝쪽 실패 표시(종료 코드 1·2 모두). `brief/` 아래라 커밋 화이트리스트는 그대로.
- 되돌림 조건은 `steps.checklearnpen.outcome == 'failure' && steps.checklearnpen.outputs.code != '2'` 이다. 종료 코드 2(P7·P8 만 실패 — §8.1)는 장부 데이터가 맞다는 뜻이라 되돌리지 않는다: 화면 문구 하나 때문에 그 주 pending 이 되돌려지면 다음 주 `missed` 가 되어 영영 채워지지 않는다. `code` 가 비어 있으면(단계가 echo 전에 죽음) `'' != '2'` 라 되돌린다(안전한 쪽).
- 리드 몫 하나 더: 저장소 루트 `.gitignore` 에 `*.tmp-*` 한 줄(§4.5 ② — 남은 임시 파일이 `git add -A -- … brief …` 로 커밋되지 않게).
- 단계(두 단계 모두 `--summary`·`--sim` 을 **명시** — 기본값에 기대지 않는다. 형식은 로또 `learn`·`checklearn` 단계와 같다 [근거: .github/workflows/weekly.yml:192-208]):

```yaml
      - name: 연금 학습 장부 (brief/learn-pension.json)
        id: learnpen
        continue-on-error: true
        run: |
          set -o pipefail
          node scripts/learn-pension.mjs --root . --history brief/pension-history.json --summary brief/latest-summary.json --sim brief/sim-pension.json --out brief/learn-pension.json 2> >(tee /tmp/learnpen.err >&2) || {
            echo "::error title=learn-pension 실패::$(tail -c 1800 /tmp/learnpen.err | tr -s '\r\n' '  ')"; exit 1; }

      - name: 연금 학습 장부 독립 검증
        id: checklearnpen
        if: steps.learnpen.outcome == 'success' && steps.learnpen.outputs.wrote == 'true'
        continue-on-error: true
        run: |
          set +e
          node scripts/check-learn-pension.mjs --root . --file brief/learn-pension.json --history brief/pension-history.json --summary brief/latest-summary.json --sim brief/sim-pension.json --prev-git HEAD
          code=$?
          echo "code=$code" >> "$GITHUB_OUTPUT"
          exit $code

      # 장부 데이터 실패(종료 코드 1)만 되돌린다. 2(화면 문구·생성기 소스 점검만 실패)는 장부를 커밋하고 실패 표시만 한다.
      - name: 연금 학습 장부 검증 실패 시 되돌림
        if: steps.checklearnpen.outcome == 'failure' && steps.checklearnpen.outputs.code != '2'
        run: git checkout HEAD -- brief/learn-pension.json 2>/dev/null || rm -f brief/learn-pension.json
```

- 끝쪽 실패 표시는 `steps.learnpen.outcome == 'failure' || steps.checklearnpen.outcome == 'failure'` 로 묶는다(종료 코드 2 도 여기서 빨갛게 보인다 — 고칠 대상이 `record.html`·생성기 소스임을 알린다).
- 정규 CI 시각(목 12:30Z · 금 00:00Z · 토 13:30Z · 일 00:00Z) [근거: .github/workflows/weekly.yml:25-29]: 연금 추첨(목 19:05 KST) 뒤 목·금 실행이 다음 회차 행을 얼리므로 그 회차 마감(다음 주 수 15:00Z)보다 6일 가까이 앞선다 → 평소엔 late 가 생기지 않는다. 토·일 실행은 연금 `latest` 가 그대로라 J4 대조만 한다. 목·금·토·일이 모두 실패하고 다음 목요일 0시 KST 이후에 처음 얼리면 그 행은 late 로 집계에서 빠진다(의도).

### 9.2 로컬 (Git Bash, `N=.lab/bin/node`; 쓰기는 `.lab/out-learnpen/` 아래만)

```
$N scripts/learn-pension.mjs --root . --history brief/pension-history.json --summary brief/latest-summary.json --sim brief/sim-pension.json --out .lab/out-learnpen/brief/learn-pension.json --now <마감 전 ISO>
$N scripts/check-learn-pension.mjs --root . --file .lab/out-learnpen/brief/learn-pension.json --history brief/pension-history.json --summary brief/latest-summary.json --sim brief/sim-pension.json --prev-git HEAD
```

- **`--out` 을 빼면 기본값 `brief/learn-pension.json`(추적 장부)에 이어 쓴다.** 처음부터 시험하려면 시험 폴더의 파일을 지운다.
- 시험 폴더는 **`--root` 안의 `.lab/` 아래**에 둔다(`.lab/` 은 `.gitignore` 에 있어 HEAD 에 없다). `--root` 밖(스크래치 폴더 등)에 두면 `--prev-git` 이 `error`(§8.1)라 P6 이 실패한다.
- 시험 폴더의 파일은 HEAD 에 없으니 `--prev-git HEAD` 는 이전 판 `absent` = «빈 장부를 앎»(§8.1, P6 «생략») 이 된다. 첫 판에만 맞는다 — 두 번째 판부터는 앞 판에서 만든 행이 «이전 판에 없던 행» 으로 보여 P2(`made === generated`)가 실패하므로, 이전 출력 사본을 `--prev <파일>` 로 준다.
- 합성 이력 사본은 **파일 이름을 `pension-history.json` 으로** 둔다(`source.file` 이 basename 이다).

### 9.3 완료 기준 (해당하는 것 모두, 숫자로)

기준값은 main `a744cf4` 의 입력 3개(`brief/pension-history.json` 338회 · `brief/latest-summary.json` · `brief/sim-pension.json`) 기준이다 [근거: 설계 원형 실측 2026-10-28 — 원형 스크립트는 저장소에 두지 않음. 구현과 다르면 규격 문장을 기준으로 원인을 찾고, 규격이 모호했으면 문서를 고친다].

| 항목 | 기준값 |
|---|---|
| `digest(338)` · `digest(337)` | `fnv:1f58bfab` · `fnv:76954b84` |
| 339회 신호(1..338 로 만듦) | `hot` `["3조 631310","4조 631315","2조 631319","5조 631311","1조 631312"]` · `cold` `["1조 173858","2조 173854","5조 173856","4조 173851","3조 173852"]` · `gap` `["2조 873668","4조 873667","5조 873666","3조 873665","1조 873660"]` · `repeat` `["1조 354154","3조 354150","4조 354155","2조 354159","5조 354151"]` |
| 대조군 t=338 (난수 소비 순서 확인) | `c_1..c_5 = 1,0,0,2,1` · `h = [484,470,40,4,2,0,0]` |
| 재현 | `from 51 · to 338 · rounds 288 · tickets 5` · `rec.weeks 239` |

1. 문법: `$N --check scripts/learn-pension.mjs` · `$N --check scripts/check-learn-pension.mjs`.
2. 이름: 새 파일 `git add -N` 뒤 `$N scripts/check-names.mjs` 가 0 이고 «목록 항목 N개» 의 N ≠ 0.
3. 실자료: 빈 시험 폴더(`.lab/out-learnpen/` 아래 — §9.2. 폴더가 아직 없어도 생성기가 만든다, §2.1)에 `--now 2026-10-28T01:00:00Z` 로 생성 → exit 0, **5,091바이트, sha256 `075afbe59ec13545c39897909c3b350c6659ae78de4d984b0547dbc76b016099`**. 검사(`--prev-git HEAD` — HEAD 에 파일 없음 = 빈 장부를 앎, P6 생략) exit 0. 행 1개(339 pending, `rec.picks` = 요약 `pension.picks` 앞 5장). P3: 339 는 새 행이고 rec = 요약 앞 5장이라 통과. P2: 339 `made === generated`.
4. 멱등: 같은 명령을 한 번 더 → `checks` 만 달라지고(`kept 1 · added 0`) sha256 `40860a1b2091e5d154924d0805969613f696a3775529d3af0095da6a1595555e`. `--now` 를 바꾸면 `generated`·`made`·`gradedAt`·`checks` 를 뺀 나머지가 바이트 동일.
   - ④b J4 동결: ③ 의 산출 사본에 요약 사본(`pension.picks[0]` 만 `"2조 873869"` 로 바꿈, `next` 339 그대로)으로 같은 이력·`--now 2026-10-28T02:00:00Z` 로 이어 실행 → exit 0, `checks.pendingMismatch = ["r=339 rec"]`, `checks.added = 0`, 339 행 줄이 ③ 과 **바이트가 같다**(rec 를 고치지 않는다). 검사(바꾼 요약 사본 · `--prev <③ 사본>`) exit 0 + 경고(P0 불일치 배열 · P3 이미 있던 행의 rec ≠ 요약).
5. 다음 주 합성: 이력 사본 끝에 `{"ep":339,"date":"20261029","band":2,"num":"173851","bonus":"631315"}`, 요약 사본은 `pension.last = 339`·`pension.next = 340`(picks 그대로). ③ 의 산출을 이어 `--now 2026-10-29T12:30:00Z` → exit 0, **6,714바이트, sha256 `f800311c931113be3ebf5afdcee1fcc53f47ed1a56e19e41a1ebec87caae2fd9`**. 339 done(`late:false`, `res.ctrl.h = [499,451,40,10,0,0,0]`), 340 pending(`inputDigest fnv:ea5455a0`), `missed []`, 339 행의 얼린 필드는 ③ 과 같다. 검사 `--prev <③ 사본>` exit 0(P6 통과).
   - ⑤b J5 재채점·이력 정정: ⑤ 의 산출 사본에, 339 `num` 을 `"173850"` 으로 바꾼 이력 사본으로 `--now 2026-10-29T13:00:00Z` 이어 실행 → 생성기 exit 0(씀), `checks.regradeMismatch = ["r=339 num"]`, `checks.pendingMismatch` 의 항목 하나가 `"r=340 inputDigest"` 로 시작, 339·340 행 줄이 ⑤ 와 바이트가 같다(처음 값 유지). 검사(바꾼 이력 사본 · `--prev <⑤ 사본>`) → **exit 1** 이고 실패 줄에 P4(339 `res`)·P6(이력 정정 감지)가 들어 있다(P2·P5·P9 도 실패할 수 있다) — CI 라면 되돌림으로 장부가 멈추는 의도된 정지(§8.3·§11).
6. 늦은 행: 빈 폴더에서 ③ 을 `--now 2026-10-28T15:00:00Z`(339 마감과 같은 시각 → late) 로 하고 ⑤ 를 이으면 339 `late:true`, `live = {done:1, late:1, counted:0, pending:1}`, `gate.rec = {"state":"hold","weeks":0}`. 검사(`--prev <이 시험의 ③ 사본>`) exit 0. 짝 시험(경계 바로 앞): 빈 폴더에서 ③ 을 `--now 2026-10-28T14:59:59.999Z` 로 하고 ⑤ 를 이으면 339 `late:false`, `live = {done:1, late:0, counted:1, pending:1}`. 검사 exit 0. 두 시험이 함께 `≥` 비교와 `CUTOFF_UTC_H` 부호를 고정한다(§3.1 확인값).
7. 빠진 주: ③ 의 산출에 이력 사본(339·340 두 회차를 붙임, 요약 `next = 341`)으로 이으면 339 done · `missed [340]` · 341 pending. 검사(`--prev <③ 사본>`) exit 0.
8. 구멍·형식: 이력 사본에서 ep 200 을 지우거나 한 행의 `band` 를 6 으로 → exit 1, 출력 파일 sha256 이 전후 같음.
9. 역행: ③ 의 산출에 이력 337회까지 사본 → `wrote=false`, exit 0, 출력 sha256 불변.
10. 기존 파일 보호: 출력 파일을 반쯤 잘라 깨뜨린 뒤 실행 → exit 1, 파일 그대로. 또 ③ 의 산출 사본에서 339 `sig.hot.picks` 를 4장으로 줄이고 ⑤ 의 입력으로 이으면 → exit 1(`::error`), 파일 sha256 그대로(J1 이 깨진 표로 채점하지 않는다).
11. 주입: §8.4 의 I1·I2·I3·I4·I14c·I15 는 필수, 나머지 권장. 기대한 검사 번호와 기대한 종료 코드(대부분 1, I10·I17 은 2, I4·I15·I16 의 «이전 판 없이» 는 0)로 끝나야 한다.
12. 크기: 합성 52주(매주 무작위 유효 행 하나를 붙이고 마감 전 `--now` 로 이어 실행)로 주당 증가량 평균·최소·최대와 52주 뒤 크기를 잰다. 기대 [추론]: 주당 약 1.0~1.1KB, 52주 뒤 약 60KB. 1MB 에 닿는 해수를 이 문서 §4.5 에 고쳐 적는다.
13. 귀무 시뮬: §12 방법대로 구현의 대조군·`stat`·관문 코드를 `.lab/` 스크립트에 **복사**해(생성기는 import 하면 main 이 돈다) 잰다. 통과: 신호 하나 52주 한 번 거짓 채택률 ≤ 1.25%(정확 한계 12/1001 = 1.20%), 신호 4개 가족 ≤ 5%, rec 26주 한 번 오경보율 ≤ 1%(정확 한계 10/1001 = 0.999%) — **이 세 절대 한계만 필수**다. 원형(§12)과의 일치는 보고 항목: 세트 안의 묶음은 같은 대조군을 나눠 쓰므로 유효 표본은 세트 수다. 지표마다 세트별 비율의 표준편차 ÷ √세트 수 로 표준오차 SE 를 함께 적고, 원형과의 차이가 `3·√(SE_원형² + SE_구현²)` 이내인지 본다(신호 하나 기준 세트 100개면 약 ±0.15%p). 벗어나면 구현의 대조군·`stat`·관문 식을 이 문서와 다시 맞춰 본다.
14. 화면: `$N .lab/snap.mjs record.html --root <시험 사이트 폴더> --w 360 --h 800 --full` 라이트·`--dark` 에서 콘솔 오류 0, `#learnPenWrap` 이 보이고 ⑤ 의 파일로 «339회 결과» 와 5장·대조군 분포가 그려진다. 가로 넘침 없음(`document.documentElement.scrollWidth ≤ 360`). `brief/learn-pension.json` 을 치우거나 `kind` 를 바꾸면 섹션째 숨고 다른 섹션(로또 `#learnWrap` 포함)은 그대로. 시험 사이트 폴더는 CLAUDE.md §3 매매 일지 ⑥ 처럼 사이트 파일 사본 + `brief/` 사본에 시험 산출을 덮어 만든다(저장소 루트로 찍지 않는다).
15. 로또 불변: `git diff --stat a744cf4 -- scripts/learn-ledger.mjs scripts/check-learn.mjs docs/learn-ledger.md brief/learn-lotto.json` 이 비어 있고, `$N scripts/check-learn.mjs --root . --file brief/learn-lotto.json --history lotto-history.json --summary brief/latest-summary.json --sim brief/sim-lotto.json` 이 그대로 exit 0(L7 — 바뀐 `record.html` 에서도 `#learnWrap`·`LEARN-BEGIN~END` 구간이 그대로).
16. 시간: 생성 < 2초, 검사 < 5초(로컬) [추론 — 원형의 재현 계산 0.2초].
17. `diff -q` 두 워크플로 사본(리드가 배선한 뒤).

## 10. 화면 `record.html#learnpen`

### 10.1 자리·마크업

- `#learnWrap` 섹션 **바로 뒤**, `#simWrap` 앞:

```html
<a id="learnpen"></a>
<section id="learnPenWrap" hidden>
<h2>연금 낙첨 분석 · 학습 실험실</h2>
<p class="note" id="learnPenIntro"></p>
<h3>연금 낙첨 분석<span class="sub">— 이번 주 구매 표가 같은 주 무작위 표보다 뚜렷이 나쁜가(운인가 버그인가)</span></h3>
<div class="card" id="learnPenLoss"></div>
<h3>연금 학습 실험실<span class="sub">— 후보 신호를 추첨 전에 등록하고, 추첨 뒤 채점해 대조군과 견줍니다</span></h3>
<div class="card flat" id="learnPenLab"></div>
<p class="note mono" id="learnPenMeta" style="padding-top:6px"></p>
</section>
```

- JS: `/* LEARN-END */` **뒤**에 `/* LEARNPEN-BEGIN */` … `/* LEARNPEN-END */`(로또 검사기 L7 의 구간을 건드리지 않는다). 이름은 `learnPen…` 접두로 로또 학습 JS 와 겹치지 않게 한다. 구간 밖 전역 도구 `fetchJSON` `nf` `pensionTicketHTML` `PENSION_NAME` 만 쓰고, `LEARN-BEGIN~END` 안의 함수(`learnEsc` 등)는 부르지 않는다(로또 구간이 따로 바뀌어도 무사하게).
- `main()` 에서 `renderLearn()` 줄 바로 뒤에 한 줄 격리: `try{ renderLearnPen(); }catch(e){ var lpw=document.getElementById('learnPenWrap'); if(lpw) lpw.hidden=true; }`.
- CSS: `#learnWrap` 규칙 옆에 `#learnPenWrap .crossval{white-space:normal;overflow-wrap:anywhere}#learnPenWrap .kpi .v{font-size:21px;overflow-wrap:anywhere}`. 나머지는 기존 `.card .kpi .tag .crossrow .crossgrid .crosshead .lhead .lrow .lbl .lcnt .lsub .ltab .tk .dg .bnd` 를 재사용한다. 새 색을 만들지 않는다(라이트·다크 토큰).

### 10.2 모양 점검 — 하나라도 어긋나면 섹션째 숨김

`fetch('./brief/learn-pension.json', {cache:'no-store'})` 실패·`null` · `kind !== 'learn-pension'` · `v !== 1` · `conf` 의 `W` `TICKETS` `R` `ALARM_MIN_WEEKS` `ADOPT_MIN_WEEKS` 중 유한한 숫자가 아닌 것 · `ALARM_P` 가 숫자 2개가 아니거나 `[1] ≤ 0` · `summary.gate.rec` 의 `weeks` 숫자·`state` 문자열이 아님 · `summary.gate.sig` 의 항목 중 같은 모양이 아닌 것 · `summary.replay.sig` 가 객체가 아님 · `journal.rows` 가 배열이 아님 · 그리는 중 예외. 첫 CI 전(파일 404)에도 숨는다.

### 10.3 카드 1 — 연금 낙첨 분석 (`#learnPenLoss`)

`T = conf.TICKETS`, «차 있는 stat» = `weeks > 0` 이고 `cum n min med max rank tie` 가 숫자.

1. **마지막 done 행**(있으면):
   - 머리 «<r>회 결과», `late === true` 면 태그 «마감 뒤 등록 · 집계 제외».
   - 당첨 줄: «당첨» + `pensionTicketHTML(res.band, res.num, 0)` + «보너스 <res.bonus>».
   - `rec`·`res.rec`·`res.ctrl` 이 없으면 «이 주는 구매 표가 추첨 전에 기록되지 않아 대조군과 견줄 수 없습니다.» 로 끝.
   - 장마다 `.lrow`: 순번 `1..T`(`.lbl`) + `pensionTicketHTML(band, num, L[i])`(끝 L자리 강조) + 오른쪽 `.lcnt` «끝 <L>자리»(L > 0 이면 `.hit`), `gr[i] > 0` 이면 « · <PENSION_NAME[gr]>».
   - KPI 2칸: [«끝자리부터 맞힌 자리 합», `g + '자리'`, «구매 <T>장 합»] · [«같은 주 대조군», `(1 + Σ_{k>g} h[k]) + '위'`, «대조군 <n>벌 중 · 같은 값 <h[g] 또는 0>벌»].
   - 실제 분포: «같은 주 대조군 <n>벌(각 <T>장)의 실제 분포 — <b>0자리 <h[0]>벌 · 1자리 <h[1]>벌 · …</b>»(0 인 칸은 뺀다).
2. done 행이 없으면: «아직 채점된 주가 없습니다. <pending r>회 구매 <T>장과 신호 <신호 수>개(<T>장씩)가 추첨 전에 기록되어 있습니다 — 추첨 뒤 첫 채점이 쌓입니다.»(pending 에 rec 가 없으면 «구매 <T>장과» 를 뺀다).
3. **누적**(머리 «누적 — 추첨 전에 기록한 구매 표만 집계»): «집계한 주 <weeks>주»; 차 있으면 «구매 누적(맞힌 자리 합) <cum>자리» · «같은 기간 대조군 범위 <min>~<max>자리 (가운데 <med>)» · «대조군 안의 자리 <순위 글>» ; «상태 <태그>».
   - 순위 글: `rank > n` → «대조군 <n>벌 모두보다 낮음», `rank === 1 && tie === 0` → «대조군 <n>벌 모두보다 높음», 그 밖 «대조군 <n>벌 중 <rank>위»(+ `tie > 0` 이면 « (같은 값 <tie>벌)»).
   - 태그: `hold` «판단 보류 · <weeks>/<ALARM_MIN_WEEKS>주» · `inside` 이고 `cum ≤ max` «대조군 범위 안» · `inside` 이고 `cum > max` 중립색 «경보 없음» · `alarm` «경보 · 버그 의심».
   - 끝자리 겹침 안내: 집계 대상 행(done · `late === false` · `rec` 있음) 중 `new Set(rec.picks.map((s) => s.slice(-1))).size < T` 인 행이 `n ≥ 1` 개면 누적 블록 끝에 중립 문구 «끝자리가 겹친 주 <n>주 포함 — 이 주들은 대조군과 구조가 달라 비교가 정확하지 않음» 을 단다. 화면에서 picks 로 세고 JSON 은 바꾸지 않는다(§3.3·§11).
   - 문장: «<b>0자리인 주가 흔한 것이 정상</b> — 대조군과 비교해 버그만 가려냄. 구매 누적이 같은 기간 대조군의 아래쪽 <ALARM_P[0]/ALARM_P[1] 을 %로>% 안으로 내려가면 경보를 냅니다.»
4. **돌아보면(사후)**(`replay.rec` 가 차 있을 때만): 태그 «돌아보면(사후)» + «모의 원장 <T>장을 매주 샀다면» — «기간 <weeks>주 (최근 <rounds>회 안)» · «누적(맞힌 자리 합) <cum>자리» · «같은 기간 대조군(<T>장씩) 범위» · «대조군 안의 자리».

### 10.4 카드 2 — 연금 학습 실험실 (`#learnPenLab`)

- 설명: «신호 <신호 수>개는 <b>그 직전 회차까지의 당첨번호만</b> 보고 자리마다 숫자 순위를 매겨 매주 <T>장을 만듭니다 — 끝자리를 뺀 자리는 자리마다 1위 숫자, 끝자리는 1~<T>위 숫자를 한 장씩, 조도 1~<T>위를 한 장씩. 비교 기준(대조군)은 같은 주에 <b>끝자리가 서로 다른 <T>장을 무작위로</b> 고른 <R>벌의 실제 결과입니다. 사전 등록 주 수가 <ADOPT_MIN_WEEKS>주 이상이고 같은 기간 대조군의 가장 위쪽에 들 때만 «채택 조건 충족» 으로 표시합니다. 이 표시는 상태일 뿐이고, <b>추천에 반영할지는 소유자가 정합니다</b>(코드는 저절로 바뀌지 않습니다).»
- 표(`.ltab`, 559px 이하에서 기존 미디어 쿼리로 신호마다 카드로 쌓임, 칸마다 `data-l`): 신호(이름 + `<small>` 설명) | 사전 등록 «<weeks>주» | 맞힌 자리 누적 «<cum>자리» 또는 «—» | 대조군 안의 자리(순위 글 또는 «—») | 상태 태그(`adopt` «채택 조건 충족» · `none` «채택 없음» · `hold` «판단 보류 · <weeks>/<ADOPT_MIN_WEEKS>주»). 행 순서 = `gate.sig` 키 순서.
- 돌아보면(사후) 표: 머리 태그 «돌아보면(사후)» + «최근 <rounds>회에 같은 규칙을 적용해 보면», 설명 «결과를 알고 난 뒤 다시 계산한 표입니다. 채택 판단에는 쓰지 않고, 위 표(추첨 전 등록)만 관문에 씁니다.» 칸: 신호 | 주 수 | 맞힌 자리 누적 | 같은 기간 대조군 범위 | 대조군 안의 자리. 차 있지 않은 신호는 뺀다.
- 신호 이름·설명(숫자는 `conf` 에서 조립; 모르는 키는 이름 = 키, 설명 빈칸; HTML 이스케이프):

| 키 | 이름 | 설명 |
|---|---|---|
| `hot` | 자주 나온 숫자 | 자리마다 최근 <W>회에 가장 많이 나온 숫자 |
| `cold` | 적게 나온 숫자 | 자리마다 최근 <W>회에 가장 적게 나온 숫자 |
| `gap` | 오래 쉰 숫자 | 자리마다 마지막으로 나온 지 가장 오래된 숫자 |
| `repeat` | 직전 번호 다시 | 자리마다 직전 회차 숫자 먼저, 그다음 최근 <W>회에 많이 나온 숫자 |

### 10.5 머리말·꼬리

- `#learnPenIntro`: «매주 추첨 <b>전에</b> 이번 주 구매 <T>장과 후보 신호 <신호 수>개(<T>장씩)를 기록해 두고, 추첨 <b>뒤에</b> 장마다 끝자리부터 몇 자리가 당첨번호와 같은지 채점합니다(보너스 번호는 점수에 넣지 않습니다). 비교의 기준선은 같은 주에 무작위로 고른 <b>대조군의 실제 결과</b>입니다. 어느 장이든 당첨 확률은 같습니다.»
- `#learnPenMeta`(textContent): «이력 <source.latest>회 기준 · 집계 <live.counted>주(마감 뒤 등록 <live.late>주 제외 — late 가 0 이면 괄호째 뺀다) · 매주 대조군 <R>벌 · 생성 <generated 앞 10자>».

### 10.6 금지·폭

- 보일 숫자: 실제 결과(맞힌 자리·등수 이름·g·누적), 대조군의 순위·범위·가운데·실제 분포, `conf` 의 설정값(주 수·장 수·벌 수·경보 %)뿐. 이론값(1/2·`5·10^(−k)`·기대·평균·σ·p값·확률 수치)은 넣지 않는다(규칙 9). 숫자를 화면 코드에 따로 박지 않는다(규칙 11) — `conf` 에 해당 키가 없으면 숨김(§10.2).
- P7 이 섹션과 JS 구간 전체(주석 포함)에 `FORBID`·`THEORY_PEN` 을 건다. 주석에도 «기대»·«평균»·«상한»·«이론» 같은 말을 쓰지 않는다.
- 360px 폭에서 가로 넘침 없음(`.tk` 는 줄바꿈 허용, 긴 값은 `overflow-wrap:anywhere`). 라이트·다크 둘 다.
- `record.html` 이 바뀌므로 배포 때 `sw.js` 의 `CACHE_NAME` 을 올린다(규칙 13, 리드 몫).

## 11. 바꿀 때 · 고장났을 때

- **상수 변경**: 정의 상수(`W` `TICKETS` `CTRL_MUL` `R` `CUTOFF_UTC_H` 와 이미 있는 `SALT.*`)와 §3.1~§3.3 의 식은 같은 이름 신호가 있는 동안 바꾸지 않는다(§5 — P6 이 오류로 막는다). 바꿔야 하면 새 이름의 신호로 더하거나 장부를 갈아탄다(아래). 경보·채택 임계(`ALARM_*` `ADOPT_*` `ALPHA` `REPLAY`)는 파생값에만 영향을 주므로 `VER` 올림 + `RULES` 덧붙임 + 검증기의 같은 상수(독립 구현이라 따로 고친다) + 이 문서.
- **새 신호 추가**: 점수 정의(§3.2 표에 새 줄), `RULES` 새 항목(`from`, 늘어난 `signals`)과 `VER` 올림 — **`from` 은 덧붙이는 시점 장부(`journal.rows`)의 최대 `r` 보다 커야 한다(= `latest + 2` 이상, §5 `RULES` · P6). 이미 얼린 행의 `ver` 는 바뀌지 않는다** — 검증기의 신호 재구현·`RULES`, 화면 신호 이름표(§10.4), 이 문서. 난수를 쓰는 신호면 `SALT` 에 새 키를 더한다(있던 키는 그대로). 본페로니의 신호 수가 늘어 기준이 엄격해지고, 새 신호는 옛 행에 없어 0주부터 쌓인다.
- **연금 추천 규칙이 바뀜**(`PENSION_RULES` 새 항목): 끝자리 5개가 서로 다르면 아무것도 바꿀 필요 없다(§3.3 의 기준선이 그대로 정확하다). 다르면(예: 같은 번호 1~5조 «세트») 매주 J3·P3 경고가 나고, 화면 카드 1 누적 블록에 «끝자리가 겹친 주 <n>주 포함» 안내가 붙으며(§10.3), `ctrl` 은 rec 의 정확한 기준선이 아니다 — 흩어짐이 더 큰 쪽이 아래쪽 끝에 더 자주 걸려 오경보가 늘어난다 [추론]. 소유자가 정한다: 경고를 안고 계속 쌓거나, rec 구조에 맞춘 대조군으로 장부를 갈아탄다(새 장부·새 `VER`).
- **경보가 떴다**: 순서대로 본다 — ① `check-learn-pension` 통과 여부 ② `brief/latest-summary.json` 의 `pension.picks` 앞 5장(표 모양·끝자리 서로 다름) ③ `pension.html` 의 `PENSION_RULES`·`pensionPortfolio` 최근 변경 ④ 이력(`pension-history.json`)의 채점 입력. 이 장부는 추천을 바꾸지 않는다.
- **채택 알림이 떴다**: 상태 표시일 뿐이다. 소유자가 «반영한다» 고 정하면 그때 추천 코드를 따로 바꾼다(장부 밖의 변경 — 그 뒤 성적은 새 `VER` 의 새 신호로 다시 쌓는다).
- **`check-learn-pension` 이 CI 에서 실패**: 종료 코드로 갈린다(§8.1·§9.1).
  - **1(장부 데이터 실패)**: 되돌림 단계가 장부를 HEAD 것으로 복원한다(커밋되지 않음). 로컬에서 같은 명령으로 재현하고 오류의 `P<번호>` 를 본다. 고치기 전까지 매주 그 주 pending 이 사라지고 다음 주 `missed` 로 남는다(소급 생성 금지) — 빨리 고친다.
  - **2(P7 화면 문구·P8 생성기 소스만 실패)**: 장부는 그대로 커밋되고 실패 표시만 뜬다. `record.html` 의 `#learnPenWrap`·`LEARNPEN-BEGIN~END` 문구나 생성기 소스를 고친다. 장부 행은 잃지 않는다.
- **과거 이력이 정정됐을 때(장부가 매주 멈춘다)**: 생성기는 J4·J5 로 경고만 내고 처음 값을 유지하지만(규칙 7) 검증기는 실패로 본다(§8.3). CI 되돌림으로 새 회차가 쌓이지 않고 매주 실패 표시가 뜬다 — 의도된 정지다. 수리: ① `git log -p brief/pension-history.json` 으로 바뀐 회차를 찾는다. 실수면 이력을 되돌리는 것이 먼저다(이 파일은 `주간 브리핑` 이 매 실행 다시 쓴다 — 원인이 수집 쪽이면 거기부터). ② 정정이 맞으면 소유자 승인 뒤 **장부를 갈아탄다**: 옛 파일을 `brief/learn-pension-<연도>.json` 으로 보관하고 `brief/learn-pension.json` 은 지운다. 다음 실행이 `journal.from` 을 새로 잡는다(관문 주 수가 0부터 — 소유자와 먼저 정한다 `[확인 필요]`). 옛 행을 고쳐 쓰지 않는다.
- **장부 갈아타기(1MB 근처, 약 17년 뒤 [추론])**: 위와 같은 방법. 정의 상수를 바꾸는 경우도 같다.
- 새 추적 파일은 `git add -N` 뒤 `node scripts/check-names.mjs`(추적 파일만 검사).

## 12. 남은 결정·위험

- **첫 일지 행**은 첫 CI 실행의 `latest+1`(339 예상 — `RULES[0].from`)이다. 52주(약 1년)가 쌓이기 전에는 모든 신호가 «판단 보류» 이고 «돌아보면(사후)» 표만 채워진다. 그 표를 근거로 읽지 않도록 화면에 라벨과 설명을 상시 둔다.
  - **첫 실행이 339 마감(2026-10-28T15:00Z = 10-29 0시 KST) 뒤면** 339 는 `late:true` 로 기록되고(화면 «마감 뒤 등록 · 집계 제외») 집계는 340 부터 시작한다 — **정상**이다(버그 아님. `RULES[0].from` 에도 영향 없음, §4.1). 리드는 병합 시점을 정할 때 참고한다: 339 를 집계에 넣으려면 그 시각 전에 첫 `learnpen` 이 돌아야 한다.
- **마감 시각** `[확인 필요]`: 연금복권720+ 판매 마감 시각을 공식 출처로 확인하지 않았다. 추첨(목 19:05 KST [근거: pension.html:943])보다 넉넉히 이른 «추첨일 0시 KST» 로 보수적으로 잡았다. 실제 마감이 더 늦어도 이 값은 «추첨 전에 얼렸다» 는 보장을 해치지 않는다(더 많은 행을 late 로 뺄 뿐이다). 정의 상수라 바꾸면 장부를 갈아타야 하므로, 확인 뒤에도 정규 CI 가 늘 목·금에 얼리는 한 바꿀 이유가 약하다.
- **귀무 시뮬(관문의 정직성 점검, 설계 원형 2026-10-28)** `[근거: 시뮬 실측 — 원형 스크립트는 저장소에 두지 않음]`: 대조군 세트 200개(세트마다 무작위 당첨번호 104주, 대조군은 실제 식 `seedCtrl` 로 세트·주마다 다른 t) × 세트당 정보 없는 5장 묶음 1,000개(끝자리 서로 다른 무작위 5장, 대조군과 다른 난수열) = 200,000개. 판정은 §6 의 정수식 그대로.
  - 신호 하나, 52주째 한 번: 거짓 채택 **0.92%**(SE ≈ 0.03%p — 세트별 표준편차 약 0.43%p ÷ √200)(명목 α/4 = 1.25%, 정확 한계 1.20%).
  - 신호 4개 중 하나라도(가족, 52주째 한 번): **3.61%**(명목 5% 이내).
  - rec, 26주째 한 번: 오경보 **0.65%**(명목 1%, 정확 한계 0.999%).
  - 검수 재현(2026-10-28, 같은 식·세트 100개 × 묶음 1,000): 신호 하나 0.921% · rec 0.703% — 원형과 표본 오차 안에서 맞다 `[근거: 검수 재현 실측 — 스크립트는 저장소에 두지 않음]`. 가족·rec 지표의 SE 는 원형에서 따로 적지 않았다 — 구현 쪽이 ⑬ 에서 함께 보고한다.
  - 방법(완료 기준 ⑬): 구현의 `ctrl` 생성·`stat`·관문 판정 코드를 `.lab/` 스크립트에 복사하고, 위와 같은 구성(세트 ≥ 100 × 묶음 1,000)으로 잰다. 필수는 ⑬ 의 절대 한계 셋이고, 원형과의 일치는 SE 를 붙여 `3·√(SE_원형² + SE_구현²)` 로 본다(±0.05%p 같은 고정 폭을 쓰지 않는다 — 1σ 수준이라 맞는 구현도 자주 벗어난다). 선택: 진짜 신호 4개를 무작위 합성 이력(≥ 150개 × 52주) 위에서 돌려 채택률이 명목 이하인지 방향만 본다.
- **반복 관찰 위험**: 관문은 매주 다시 판정한다. 같은 시뮬에서 52~104주 사이 한 번이라도 채택될 비율은 신호 하나당 **3.30%**, 신호 4개 가족으로 **12.5%**, rec 경보는 26~104주 사이 한 번이라도 **4.16%** 다. 채택 알림은 «반영을 검토할 후보» 일 뿐이다. **소유자 결정 항목** `[확인 필요]`(로또 §12 와 같은 셋): ① 52주 배수 시점에만 판정 ② 관찰 횟수만큼 임계를 엄격하게 ③ 지금대로 두고 알림만 본다. 이 규격은 ③이다.
- **신호끼리 독립이 아니다**: 4신호가 같은 당첨번호·같은 대조군으로 채점되고, 앞 5자리가 겹칠 수 있다(예: `hot`·`repeat`). 본페로니는 이런 상관에서도 보수적이다. 추천 모형(설정 `gap`, `brief/sim-pension.json` 의 `rule.settings`)과 `gap` 신호는 비슷한 끝자리를 고르는 경향이 있다 [추론] — 둘의 성적이 같이 움직여도 이상이 아니다.
- **점수의 모양**: 한 주에 많아야 한 장만 점수가 나므로(끝자리 서로 다름) 관문은 사실상 «끝자리를 맞힌 주의 수 + 맞힌 장의 뒷자리 길이» 를 본다 [추론]. 앞 5자리에 정보가 있어도 끝자리가 맞은 주에만 드러난다.
- **보너스 등수(gr 8)는 점수 밖**이다. 기록(`gr`)과 화면 등수 이름에만 나온다.
- **입력 모양 의존**: `brief/pension-history.json` 은 `주간 브리핑` 이 원본 행을 그대로 쓴다 [근거: scripts/weekly-brief.mjs:1274-1276]. 최상위가 배열이 아니게 바뀌거나 `band` 가 문자열로 바뀌면 이 장부는 exit 1 로 멈춘다(의도 — §3.1). `pension.picks` 문자열 모양이 바뀌면 rec 없이 쓰고 경고한다.
- 모든 신호는 «과거만 보는 단순 규칙» 이다. 채택되어도 앞날을 보장하지 않는다.

작성: 잼족
