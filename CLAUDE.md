# 일확천금(lotto-lab) — 작업 지침

한글로 쓰고 답한다. 결론 먼저, 근거 다음. 요청한 것만 핀포인트로.
표기: 사실 `[근거: 파일:줄]` · 추론 `[추론]` · 불확실 `[확인 필요]`.

## 1. 이 저장소

- 서버·DB·빌드 없는 정적 사이트. 로또·연금복권 번호의 **오락용** 추천·기록·검증.
- 계산·커밋·배포는 GitHub Actions 한 파이프라인(`.github/workflows/weekly.yml`: compute → deploy, 주 4회). PC 는 필요 없다.
- 배포 주소 `https://ljo0527.github.io/lotto-lab/`
- **공개 저장소**다. 추적 파일은 전부 인터넷에 나가고 루트 전체가 Pages 로 배포된다.
  이 파일(CLAUDE.md)도 마찬가지 → 여기에 실명·개인 경로·키·계정 비밀을 적지 않는다.
- 지도
  - 페이지: `index` `pension` `brief` `rank` `validate` `record` (.html)
  - 계산: `scripts/` 의 `rank-track` `rank-tiers` `validate` `weekly-brief` `backfill` `trade-ledger` `learn-ledger` `pop-learn` `learn-pension`
  - 독립 검증: `check-rank` `check-tiers` `check-sim` `check-trade` `check-spread` `check-learn` `check-pop-learn` `check-learn-pension` · 가드: `data-guard` `check-names` `check-collect`
  - 매매 일지: 엔진 `lotto-trade.js`(루트, 브라우저·CI 공용 — `rank-core.js` 를 먼저 읽는다) · 산출 `brief/trade-lotto.json` · 규격 `docs/trade-ledger.md` · 규칙은 아래 15번
  - 갈래 배치(이번 주 F~J): `index.html` 의 `LAYOUT_RULES`·`layoutFor`·`spreadComplete` · 독립 검증 `check-spread` · 규격 `docs/spread-layout.md` · 규칙은 아래 16번
  - 학습 장부(기록 › 낙첨 분석·학습 실험실): 생성 `learn-ledger` · 독립 검증 `check-learn` · 산출 `brief/learn-lotto.json` · 규격 `docs/learn-ledger.md` · 규칙은 아래 17번
  - 연금 학습 장부(기록 › 연금 낙첨 분석·학습 실험실): 생성 `learn-pension` · 독립 검증 `check-learn-pension` · 산출 `brief/learn-pension.json` · 규격 `docs/learn-pension.md` · 규칙은 아래 19번
  - 당첨금 학습(그림자 인기 모형, 화면 없음): 생성 `pop-learn` · 독립 검증 `check-pop-learn` · 산출 `brief/pop-learn-lotto.json` · 규격 `docs/pop-learn.md` · 규칙은 아래 18번
  - 봇 산출물: `brief/*.json` · 워크플로 사본: `setup/workflows/`

## 2. 잼족 규칙 (소유자 결정 — 어기지 않는다)

1. **독립**: 이 저장소는 다른 어떤 프로젝트·상점·워크스페이스와도 독립이다.
   - 그쪽 코드·경로·훅·DB·서버·포트를 import/참조하지 않는다.
   - 외부 데이터가 필요하면 요구에 맞게 간추려 **한 번 변환한 정적 JSON** 으로 가져온다. 런타임 의존을 만들지 않는다.
2. **이름**: 작성자 표기는 «잼족». 실명·영문 이름은 코드·문서·주석·커밋 메시지·작성자·파일 이름 어디에도 쓰지 않는다.
   - **금지어 목록은 저장소에 두지 않는다.** 공개라서 목록 자체가 이름을 알려 준다(이스케이프·조각 이어붙이기·해시도 안 된다). 이 파일에도 적지 않는다.
     - CI: Actions 시크릿 `CHECK_NAMES_LIST`(줄바꿈 구분, 사람이 등록). 로컬: git 밖 `.lab/banned-names.txt`(한 줄에 하나, 공백이 든 항목은 붙임·하이픈·밑줄·점 변형으로 자동 확장).
     - 목록이 없을 때 CI 는 경고만 내고 통과한다(소유자 결정 사항). 실패로 막으려면 저장소 변수 `CHECK_NAMES_REQUIRE` 를 `1` 로 둔다.
   - `scripts/check-names.mjs` 는 워크플로 compute·deploy 첫 단계에서 **추적 파일의 내용과 파일 이름**만 검사한다.
     - 출력에는 금지어도 파일 이름 적중 경로도 찍지 않는다(항목 번호·추적 파일 순번만). 로컬에서만 `--show-paths`.
     - **커밋 메시지·작성자(`user.name`/`user.email`)는 검사하지 않는다.** CI 는 푸시 *뒤*에 돌아서, 이미 공개된 다음 계산·배포만 막는다.
     - 그래서 푸시 전에 사람이 확인한다: `git log --all --format='%an %ae %cn %ce%n%B' | node scripts/check-names.mjs --stdin` (0 = 깨끗).
     - 자동으로 막고 싶으면 로컬 `.git/hooks/commit-msg` 를 둔다(설정은 사람이 한다. 에이전트는 만들지 않는다): `{ git var GIT_AUTHOR_IDENT; git var GIT_COMMITTER_IDENT; cat "$1"; } | <node 경로> scripts/check-names.mjs --stdin`
   - 계정명 `ljo0527` 은 주소라서 허용. 과거 git 기록은 다시 쓰지 않는다.
3. **푸시는 사람**: `git push`, GitHub 로그인·계정 전환, Pages/Actions 설정, 워크플로 수동 실행, 예약 작업 변경, 원격 설정.
   - 에이전트는 로컬 작업과 읽기(`gh run list/view`, `gh api`)까지.
   - 커밋은 사람이 «커밋해» 라고 한 뒤에만. 메시지는 `<영역>: <무엇을 왜>`.
4. **무료 한도**: 공개 저장소의 표준 러너(무료)만 쓴다. 유료 기능·유료 API·결제 금지.
   - compute 는 30분 제한 안, 정상 3분대를 유지한다.
   - **새로 추적하는 파일 하나는 1MB 미만**. 기존 큰 JSON 은 예외지만 키우는 변경은 회차당 증가량부터 계산한다.
   - 회차·추천 수 N 에 비례해 커지는 설계는 피한다(저장소·Pages 1GB 한도).
5. **생성물은 손으로 고치지 않는다**: `brief.html` `brief/*` `validate.html` `lotto-history.json` `lotto-order.json` 은 봇이 쓴다.
   - `brief/trade-lotto.json` 도 그 하나다. 특히 `journal.rows` 는 한 번 쓰면 사람도 고치지 않는다(15번).
   - 로컬에서 돌릴 때는 반드시 `--out .lab/out-x` 로. `--out .` 은 `brief/` 를 덮어쓴다.
   - 로컬 계산본을 커밋하지 않는다.
6. **워크플로는 두 곳을 같이**: `.github/workflows/` 와 `setup/workflows/`.
   - `push.ps1` 이 후자로 전자를 덮어쓴다 → 한쪽만 고치면 사라진다. 고친 뒤 `diff -q` 로 같은지 확인.
   - 새 산출물은 weekly.yml 의 `git add` 화이트리스트(`결과 커밋` 단계)에 넣어야 배포된다. `brief/` 아래는 자동 포함.
7. **walk-forward · append-only**: 회차 R 의 계산은 R-1 까지의 자료만 쓴다(미래 누설 금지).
   - 과거 행은 덧붙이기만 한다. 다시 계산해 다르면 `::warning` 만 내고 기존 값을 유지한다.
8. **수집 연속성**: 자료를 받은 직후 `1..latest` 에 빠진 회차가 없음을 단언한다(`scripts/data-guard.mjs`).
   - 구멍이 있으면 계산·커밋 전에 실패한다. 페이지 DB 는 «동행복권 공식 API» 로 자기 수집을 끝낸 것이어야 한다(백업 `lotto-history.json` 으로 채워진 DB 는 연속이어도 막는다). 모의 API 는 실 API 의 하한 이동(center 3 → 1~10)을 따른다(`lottoApiWindow`).
   - 새 «최근 N회차 가져오기» 도 같은 규칙으로 센터를 깐다. 배경은 `docs/bugfix-log.md`.
9. **정직성**: 모든 추천·적중 수치 옆에 **우연 기준선**을 함께 둔다. 화면의 기준선은 **무작위 대조군의 실제 결과**(무작위 종목·무작위 20벌 띠)로 하고, 이론값(기대값·평균 대기·σ·p·몬테카를로)은 화면에 새로 넣지 않는다(2026-10-26 결정. 3단 대상 — 아래 목록 — 은 소유자 판단 전까지 예외). 검증기(`check-*.mjs`) 내부 계산은 제한 없음.
   - **3단 예외 목록**(결정 기록 없이 일부러 남긴 이론값. 소유자가 지우기로 하면 그때 지운다. `ROADMAP.md` 4-1 과 같은 목록): ① 번호 통계 탭(`index.html`) — 출현 번호판 σ·미출현(GAP) «우연일 확률»·동반쌍 «기대»/«편차(σ)»·합계 «이론값은 평균 138, 표준편차»·이월수 «이론 기대값 0.8개». ② 추첨순서 탭(`index.html`) — χ²·p값 표, «이론 1/6 = 16.7%»·«이론 22/45 = 48.9%»·«이론 기대 N회». ③ `rank.html`(`rank-tiers-view.js`) — «점선(기대) ± 몬테카를로 표준편차» 띠와 «몬테카를로 p»(pMC) 표. ④ 검증 보드·carryover — «300주 walk-forward» 문구와 `validate.mjs --window 300`. ⑤ 기록 탭 옛 모의 원장 접기. 이 목록 밖의 화면에는 이론값을 새로 넣지 않는다.
   - «확률을 높인다/잘 나온다» 문구 금지. 당첨 확률 자체(1/8,145,060, 4등(5만원) 한 게임 11,115/8,145,060 = 0.1365%)는 규칙 사실이라 UI 문구의 기준으로 쓴다.
10. **독립 검증기**: 새 계산에는 페이지·엔진 코드를 쓰지 않는 `check-*.mjs` 를 짝으로 둔다.
    - 검증 실패를 «경고만» 으로 두려면 이유를 코드 주석과 여기에 남긴다.
11. **계약 먼저**: 수치 로직을 바꾸기 전에 스키마·함수 이름·시그니처(`weeklyPicks` `PORTFOLIO_RULES` `portfolioOptsFor` 등 backfill 이 부르는 것)를 확인한다.
    - 바꾸면 기록한다. 기존 JSON 은 하위호환(없는 필드는 `typeof` 확인).
    - `--window 300`·50회차 같은 상수를 코드 여기저기에 박지 않는다.
12. **외부 접속**: 동행복권 공식 API 와 이미 쓰는 추첨순서 출처(`fetch-order.mjs`)만. 추가는 소유자 승인.
    - 캐시(`--cache`)를 쓰고 재시도엔 지연을 둔다. 개인 구매 기록은 브라우저 localStorage 에만(커밋 금지).
13. **PWA**: `sw.js` 를 바꾸면 `CACHE_NAME` 을 올리고 프리캐시 목록과 실제 파일을 맞춘다. 로컬 http 에서는 SW 가 켜지지 않으니 배포 뒤 확인.
14. **포트**: 로컬 미리보기는 **8766 이상**만 쓴다(`serve.ps1` 기본 8766). 떠 있는 서버·프로세스를 끄지 않는다.
15. **매매 일지**(`brief/trade-lotto.json` · 기록 › 매매 일지 · 브리핑 «이번엔 이거?» 카드): 규격·스키마·지문 바이트 규격은 `docs/trade-ledger.md`.
    - **append-only 일지**: `journal.rows` 의 done 행은 바이트 불변이다. `trade-ledger` 가 `lotto-history.json` 만으로 `latest+1` 회차 제시를 추첨 **전에** pending 으로 적고, 추첨된 뒤 done 으로 채점한다. 이미 쓴 행을 다시 계산해 다르면 `::warning` 만 내고 처음 값을 유지한다(7번). 행 삭제·재정렬·소급 생성이 없고 `journal.from` 은 처음 값으로 고정한다. `latest` 가 일지보다 뒤처지면(역행) 쓰지 않고 `wrote=false` 로 끝낸다.
    - **마감 = 추첨일 20:00 KST**(11:00Z, `CONF.CUTOFF_UTC_H`). 그 뒤에 만든 행은 `late` 로 표시하고 성적 집계에서 뺀다.
    - **규칙표 `RULES` 는 덧붙이기만** 한다. `LOTTOTRADE.CONF` 의 상수(창·K·종목·시드 소금 등)를 바꾸면 `VER` 을 올리고 `RULES` 에 새 항목을 더한다 — 이미 쓴 행의 `ver` 로 옛 규칙이 남아야 한다. `check-trade` C10 이 HEAD 의 `RULES` 와 접두 일치를 본다(11번의 상수 한 곳 원칙).
    - **시점 누수 금지**: 결정 함수는 `past(D,t)` 로만 읽는다(채점 함수만 `D[t]`). `Math.random`·`Date` 를 쓰지 않는다(mulberry32, 회차·종목 시드). 자료에 구멍이 있으면 계산하지 않는다(8번).
    - **독립 검증**: `scripts/check-trade.mjs` 는 `lotto-trade.js`·`rank-core.js` 를 계산에 쓰지 않는다(10번). 예외는 누수·결정성 탐침(C11·C12)뿐이고, 거기서도 모듈을 «시험 대상»으로만 읽는다.
    - **정직성**: 결과를 본 뒤 찾은 값(최소 장수·최저 순위)에는 «돌아보면(사후)» 을 붙이고 같은 칸에 무작위 20벌의 같은 값 범위를 둔다. «최고 종목» 배지와 앞날 예측을 두지 않는다. 금지 문구는 C13 이 본다.
    - **CI**: `weekly.yml` 의 `로또 전 회차 스냅샷` 바로 뒤에 `매매 일지`(id `trade`) → `매매 일지 독립 검증`(id `checktrade`, `trade` 가 `wrote=true` 일 때만) → `매매 일지 검증 실패 시 되돌림`(`checktrade` 가 실패했을 때만), 끝쪽 `검증 보드 실패 표시` 뒤에 `매매 일지 실패 표시`. 앞 둘은 `continue-on-error` 라 실패해도 브리핑 등 다른 산출물의 커밋·배포는 이어진다(`brief/` 아래라 커밋 화이트리스트는 그대로). **검증 실패 시 일지만 되돌린다**: 되돌림 단계가 `brief/trade-lotto.json` 을 HEAD 것으로 복원하고(HEAD 에 없으면 지움) `결과 커밋` 이 그 파일을 올리지 않게 한다 — 일지는 append-only 이고 C10 은 HEAD 와만 비교하므로, 잘못 쓰인 일지가 한 번 커밋되면 다음 주에 그 상태가 기준이 되어 영구히 굳기 때문이다. 두 워크플로 사본은 `diff -q`(6번).
    - **PWA·크기**: `record.html` 이 `rank-core.js`·`lotto-trade.js` 를 읽으므로 `sw.js` PRECACHE 에 넣고 `CACHE_NAME` 을 올린다(13번). 산출은 1MB 미만이어야 하고(4번) `trade-ledger` 는 쓰기 직전에 되읽어 확인한다.

16. **갈래 배치**(이번 주 추천 F~J · 규격 `docs/spread-layout.md`): 1248회부터 F~J 5줄은 A~E(`portfolioPick`)를 그대로 둔 채 «A~J 10줄이 1~45 를 모두 쓰고, 어느 두 줄도 번호 2개 이상 겹치지 않고, 번호당 2회 이하» 가 되도록 고른다(목적은 F~J 의 인기 점수 u 합 최소).
    - 구매 장부(5줄)·`validate`·`backfill`·`check-sim`·`PORTFOLIO_RULES` 는 이 규칙과 무관하다.
    - **규칙표 `LAYOUT_RULES` 는 덧붙이기만** 한다. from 보다 작은 회차는 옛 `diversifyLegacy` 10줄이 바이트 그대로 나와야 한다(11번). 새 캐시 전역을 만들지 않는다(weekly-brief·backfill·validate 의 reset 목록 불변).
    - **결정성**: 시계·내장 난수·시간 예산을 쓰지 않는다(mulberry32 회차 시드, 고정 반복, 동점은 작은 번호·작은 index).
    - **정직성**: 화면은 구조를 사실로만 적고 확률·기대·«높인다» 류와 이론값을 넣지 않는다(9번). 10줄 «한 줄이라도 3개 이상» 정확 확률은 `check-spread` 의 `::notice` 에만 둔다.
    - A~E 가 한 번호를 3번 쓰는 주(1000~1248회 중 2회)는 F~J 로 못 고쳐 `layout.degraded=true` 로 표시한다.
    - **독립 검증·CI**: `check-spread` 는 `brief/latest-summary.json`·`brief/week.json`·`lotto-history.json` 만으로 10줄 구조를 다시 센다. legacy 이거나 layout 이 없으면 «건너뜀» exit 0.
      - CI 위치: `로또 전 회차 스냅샷` 뒤 `갈래 배치 독립 검증`(id `checkspread`, `continue-on-error`) + 끝쪽 실패 표시. 브리핑은 매 실행 덮어쓰는 파일이라 되돌리지 않는다.
17. **학습 장부**(`brief/learn-lotto.json` · 기록 › 낙첨 분석·학습 실험실 · 규격 `docs/learn-ledger.md`)
    - **append-only 일지**: 매매 일지(15번)와 같은 틀(done 바이트 불변, 같은 `ver` pending 재계산이 다르면 `::warning` 후 처음 값 유지, 마감 11:00Z 뒤 `late`, 빠진 주 `missed`, 역행 `wrote=false`, 구멍 exit 1·출력 불변).
      - `latest+1` 회차에 추천 10줄 `rec` 를 추첨 **전에** 얼린다. `rec` 는 `latest-summary.json` 의 `lotto.next` 가 그 회차일 때만 넣는다.
      - 같은 회차에 후보 신호 4개(hot·cold·gap·repeat, 각 10줄)도 얼리고, 추첨 뒤 채점한다.
    - **기준선 = 같은 주 무작위 대조군의 실제 결과**: 1000벌, 시드 = 회차·벌 번호. 분포만 저장한다.
      - 화면에는 대조군 순위·범위만 쓰고 p·σ·기대값은 넣지 않는다(9번).
      - 재현은 «돌아보면(사후)» 라벨을 달고 관문에 쓰지 않는다.
    - **관문은 매 실행 다시 계산하는 파생값**(live = done 이고 late 아님).
      - 낙첨 경보: 26주 이상 + 추천 누적이 대조군 하위 1% → `::warning`.
      - 채택: 52주 이상 + 상위 꼬리 비율 ≤ α/신호 수(본페로니) → `::notice`.
      - **채택은 표시·알림까지다 — 추천 코드를 자동으로 바꾸지 않는다(반영은 소유자 결정).**
    - **상수 한 곳·VER**: `CONF` 상수를 바꾸면 `VER` 을 올리고 `RULES` 에 덧붙인다. `check-learn` 의 사본 상수도 따로 고친다(10번). 주당 약 1.9KB — 1MB 에 닿기(약 9년) 전에 장부 갈아타기를 소유자와 정한다.
    - **CI**: `매매 일지 검증 실패 시 되돌림` 뒤 `학습 장부`(id `learn`) → `학습 장부 독립 검증`(id `checklearn`, `wrote=true` 일 때) → `학습 장부 검증 실패 시 되돌림`, 끝쪽 실패 표시. 앞 둘은 `continue-on-error`. `weekly-brief` 뒤여야 `rec` 가 얼려진다.
18. **당첨금 학습**(`brief/pop-learn-lotto.json` · 규격 `docs/pop-learn.md`): 등수별 당첨자 수로 인기 예측(m45)을 다시 학습하는 그림자 후보 2개(C1 지수 감쇠 OLS, C2 1~5등 풀드 WLS)를 지금 모형(base)과 walk-forward 로 견준다.
    - **추천은 바꾸지 않는다**: z·`portfolioPick`·구매 장부는 그대로다.
      - 관문: live 52회 이상, 부호 뒤집기 순열 p ≤ 0.05/후보 수, 돌아보기에서도 같은 방향.
      - 관문을 넘으면 «채택 조건 충족» 상태와 `::notice` 까지이고, 반영은 소유자 결정이다.
    - **append-only 일지**: 17번과 같은 틀이다. pending 에 추첨 전 적합 파라미터를 얼리고, done 에 당첨번호의 모형별 예측과 관측 배수를 적는다.
      - 최신 회차 필드 이상(w4·w5·sales ≤ 0, firstType 합 ≠ 1등 수)이면 쓰지 않고 `wrote=false`.
      - `rank-params-lotto.json` 에 `latest+1` 행이 없으면 exit 1 이다(순위 추적이 실패한 주).
    - **독립 검증**: `check-pop-learn` 은 생성기·`index.html`·`rank-core.js` 를 가져오지 않는다. base z 는 `check-rank` `zMaker` 와 상대 1e-9 이내로 대조한다.
    - **화면은 아직 없다**: 올릴 때는 «대조군 N벌 중 M위» 같은 실제 결과형 기준선을 먼저 정한다(9번). 이 장부는 줄을 고르지 않으므로 균등 무작위 줄 대조군은 맞지 않는다.
    - **CI**: 학습 장부 단계 뒤 `당첨금 학습`(id `poplearn`) → `당첨금 학습 독립 검증`(id `checkpoplearn`) → `당첨금 학습 검증 실패 시 되돌림`, 끝쪽 실패 표시. 앞 둘은 `continue-on-error`.

19. **연금 학습 장부**(`brief/learn-pension.json` · 기록 › 연금 낙첨 분석·학습 실험실 · 규격 `docs/learn-pension.md`): 17번(로또 학습 장부)의 연금판이다. 로또 장부·스크립트와 파일을 나누고 서로 import 하지 않는다.
    - 연금에는 펼친 배치(16번)·당첨금 학습(18번)을 만들지 않는다. spread@334 의 구매 5장은 끝자리가 모두 달라 이미 5장 배치의 상한이고, 연금 당첨금은 고정액이다.
    - 점수는 장마다 «끝에서부터 이어서 맞힌 자리 수» L(0~6, 보너스 제외), 한 주 g = 5장 합. rec = `latest-summary` 의 pension 앞 5장(구매분)이고 `next === r`·`rule === 'portfolio'` 일 때만 얼린다.
    - 기준선은 구조를 맞춘 무작위 대조군 하나(`ctrl`, 1000벌, 끝자리 서로 다른 5장)가 rec·신호 모두에 쓰인다. 관문 상수·채택은 알림까지라는 점은 17번과 같다.
    - late = 추첨일 0시 KST 뒤에 얼린 행(판매 마감 시각 미확인이라 보수적 [확인 필요]). 일지 규칙(J1~J6·역행·구멍·기존 파일 보호)은 17번과 같다. 정의 상수를 바꾸면 장부를 갈아탄다(규격 §11).
    - **CI**: 당첨금 학습 단계들 뒤 `연금 학습 장부`(id `learnpen`) → `연금 학습 장부 독립 검증`(id `checklearnpen`, `--prev-git HEAD`) → 되돌림 → 끝쪽 실패 표시. 검증기 종료 코드 2(화면 문구·생성기 소스 점검만 실패)는 **되돌리지 않는다** — 되돌리면 그 주가 영영 `missed` 가 된다. 임시 파일 `*.tmp-*` 는 `.gitignore`.

## 3. 로컬 검증 (이 PC 한정)

- PATH 에 node 가 없다 → 편집기에 내장된 런타임을 `ELECTRON_RUN_AS_NODE=1` 로 Node 22 처럼 실행한다. 셸마다 부르는 법이 다르다.
  - **Git Bash**: `N=.lab/bin/node` (git 밖 래퍼). `#!/usr/bin/env bash` 스크립트라 **PowerShell 에서는 실행되지 않는다**. 아래 `$N …` 예시는 모두 Git Bash 기준.
  - **PowerShell**(이 PC 기본 셸): `$env:ELECTRON_RUN_AS_NODE=1; & "$env:LOCALAPPDATA/Programs/cursor/Cursor.exe" scripts/check-names.mjs | Out-Host; $LASTEXITCODE`
    - GUI 실행 파일이라 `| Out-Host` 가 없으면 출력도 종료 코드도 기다리지 않는다. 다 쓰면 `Remove-Item Env:ELECTRON_RUN_AS_NODE`.
- 문법 `$N --check scripts/<파일>.mjs` · 이름 `$N scripts/check-names.mjs` (0 = 깨끗)
  - 금지어 목록(`.lab/banned-names.txt`)이 없으면 경고만 내고 0 이라 검사가 안 된 것이다. 출력의 «목록 항목 N개» 를 확인한다.
- 수집 회귀 `$N scripts/check-collect.mjs`
  - 최신 끝자리 0~9 × 모의 API 3종(30 시나리오). 가짜 자료라 네트워크 없음.
  - 수정 전 재현은 구멍 나는 시나리오 **하나만** 고른다: `--root <옛 index.html 폴더> --latest 1247 --mock legacy --expect fail` (0 = 구멍이 재현되고 가드가 막음).
    기본 시나리오 전체에 `--expect fail` 만 주면 구멍 없는 29개가 «기대와 다름» 으로 세어져 항상 1 이다. 옛 폴더는 `git archive HEAD | tar -x -C <빈 폴더>`.
- 생성 스크립트 `$N scripts/rank-track.mjs --root . --out .lab/out-x --cache <캐시>`
  - `rank-tiers` `validate` `weekly-brief` `backfill` 도 같은 형식.
- 검증기는 읽기 전용, 종료 코드 0/1. 산출물 폴더 옵션이 스크립트마다 다르다.
  - `check-rank` · `check-sim`: `$N scripts/check-rank.mjs --root . --cache <캐시> --dir .lab/out-x` (`--dir` = `brief/` 의 부모 폴더)
  - `check-tiers`: `--dir` 가 없다 → `$N scripts/check-tiers.mjs --root . --cache <캐시> --tiers-dir .lab/out-x/brief --params-dir .lab/out-x/brief`
- 매매 일지(15번): 캐시도 외부 접속도 없다. 입력은 `lotto-history.json` + (선택) `brief/rank-lotto.json`(`trade-ledger` 가 1등 순위 `win` 을 복사해 오는 데 쓴다. 없으면 직접 계산). `check-trade` 는 여기에 `brief/rank-params-lotto.json`(가중치 대조 C2)도 읽는다. 둘 다 없으면 해당 대조만 건너뛴다.
  - 생성 `$N scripts/trade-ledger.mjs --root . --history lotto-history.json --out .lab/out-trade/brief/trade-lotto.json [--now <ISO>]` → 검사 `$N scripts/check-trade.mjs --root . --file .lab/out-trade/brief/trade-lotto.json --history lotto-history.json` (0 = 통과). 이력만으로 지문 세 개: `--print-digests`.
  - **`--out` 을 빼면 기본값 `brief/trade-lotto.json`(추적 일지)에 이어 쓴다.** 일지는 기존 `--out` 파일을 이어 쓰므로 처음부터 시험하려면 시험 폴더의 파일을 지운다.
  - **완료 기준**(고친 뒤 해당하는 것 모두)
    1. 문법 `$N --check lotto-trade.js scripts/trade-ledger.mjs scripts/check-trade.mjs` 를 파일마다.
    2. 새 파일은 `git add -N <파일>` 뒤 `$N scripts/check-names.mjs` 가 0 이고 «목록 항목 N개» 가 0 이 아니다(check-names 는 추적 파일만 본다. 되돌리기 `git reset -- <파일>`).
    3. 위 생성 → 검사가 둘 다 exit 0. 산출 지문이 `check-trade --print-digests` 와 같다(1247회 자료 기준값: source `fnv:5fa209a1` · window `fnv:0c539d54` · band `fnv:c979e632` — 자료가 늘면 새로 찍는다).
    4. 멱등: 같은 명령 2회 → `generated`·`made`·`gradedAt`·`checks` 를 뺀 나머지가 바이트 동일.
    5. 다음 주 합성: 이력 사본에 가짜 다음 회차를 붙이면 그 회차는 done, 그다음이 pending, 이전 일지 행은 바이트 불변. 이력에서 한 회차를 지우면 exit 1 이고 출력 파일은 그대로.
    6. 화면: `$N .lab/snap.mjs record.html --root <시험 폴더> --w 375 --h 812 --full` 라이트·`--dark` 에서 콘솔 오류 0, 꼬리 줄이 «일치 ✓», K 칩 5개 전환, JSON 을 치운 느린 길도 그려진다.
       - **저장소 루트로 찍으면 안 된다.** 루트에는 `brief/trade-lotto.json` 이 첫 CI 전까지 없어 처음부터 느린 길이라 꼬리가 «이 기기에서 계산한 결과» 로 나오고 «일치 ✓» 는 나오지 않는다.
       - `--root` 에는 `trade-lotto.json` 을 둔 시험 폴더(`.lab/out-trade/site`)를 준다. `snap` 은 `--root` 아래만 서빙하므로 사이트 파일 복사본이 필요하다: `rm -rf .lab/out-trade/site && mkdir -p .lab/out-trade/site/brief && cp record.html rank-core.js rank-worker.js lotto-trade.js site.css site.js lotto-history.json manifest.webmanifest icon.svg apple-touch-icon.png .lab/out-trade/site/ && cp brief/*.json .lab/out-trade/site/brief/ && cp .lab/out-trade/brief/trade-lotto.json .lab/out-trade/site/brief/`(3번의 산출을 그대로 쓴다). 느린 길은 `brief/trade-lotto.json` 만 치운다.
    7. e2e: `$N .lab/e2e/run.mjs` 의 `trade-ledger`·`check-trade` 두 단계가 필수로 통과하고, pass3 증가량 표에서 `journal.rows` +1행·`window.rows` 변화 없음(외부 접속 없이는 `--passes 2,3`).
       - e2e 는 작업 사본의 append-only 산출물(`brief/trade-lotto.json`·`rank-*`·`rank-params-*`·`rank-tiers-*`·`sim-*`)을 지우고 캐시(1242회·합성 1243회)로 처음부터 다시 쌓는다. 저장소 사본이 캐시보다 앞서(1247회) 있으면 `rank-track` 이 «기존 파일이 앞서 있어 쓰지 않습니다» 로 실제 1243회 행을 그대로 둬서 합성 1243회와 어긋나고, pass3 의 `check-trade` C2(가중치)·C6(정확 순위)와 `check-rank`·`check-tiers`·`check-sim` 이 실패한다(결함이 아니라 입력 불일치). `--rank`·`--params` 를 빈 경로로 주면 통과하지만 그 두 대조를 건너뛰므로 쓰지 않는다.
    8. `diff -q` 두 워크플로 사본 · 금지 문구(C13) 0건.
- 갈래 배치(16번): `$N scripts/weekly-brief.mjs --root . --out .lab/out-x --cache <구멍 없는 캐시 사본>` → `$N scripts/check-spread.mjs --summary .lab/out-x/brief/latest-summary.json --week .lab/out-x/brief/week.json --history lotto-history.json` (0 = 통과).
  - 1247회까지 캐시가 필요하면 `lotto-history.json` 을 API 필드명으로 바꾼 사본을 만든다(외부 접속 없음).
  - 게시본(legacy)은 «건너뜀» 이고, `--force-check` 는 옛 10줄에도 구조 검사를 강제한다.
- 학습 장부(17번)·당첨금 학습(18번): 캐시·외부 접속이 없다. `--out` 을 빼면 추적 장부에 이어 쓰니 시험은 반드시 `--out .lab/out-x/brief/…` 로 한다.
  - 학습 장부: 생성 `$N scripts/learn-ledger.mjs --history lotto-history.json --summary <latest-summary.json> --sim brief/sim-lotto.json --out .lab/out-x/brief/learn-lotto.json [--now <ISO>]` → 검사 `$N scripts/check-learn.mjs --root . --file .lab/out-x/brief/learn-lotto.json --history lotto-history.json --summary <같은 파일> --sim brief/sim-lotto.json [--prev <이전 파일>]`.
  - 당첨금 학습: 생성 `$N scripts/pop-learn.mjs --history lotto-history.json --params brief/rank-params-lotto.json --out .lab/out-x/brief/pop-learn-lotto.json [--now <ISO>]` → 검사 `$N scripts/check-pop-learn.mjs --root . --file <그 파일> --history lotto-history.json --params brief/rank-params-lotto.json`.
  - 완료 기준은 매매 일지와 같다: 생성·검사 exit 0, 멱등(시각·checks 제외 바이트 동일), 다음 주 합성(가짜 회차 → done/pending, 구멍 사본 exit 1·출력 불변).
- 연금 학습 장부(19번): 규격 `docs/learn-pension.md` §9.2 의 두 명령(생성 `--out .lab/out-learnpen/brief/learn-pension.json` → 검사 `--prev-git HEAD`). 시험 폴더는 `--root` 안 `.lab/` 아래(밖이면 `--prev-git` 판정이 error). 완료 기준·기준 sha 는 §9.3.
- 작업 트리(`git worktree`)에서 `.lab` 을 주 저장소로 이어 쓸 때 `.lab/snap.mjs` 는 `--root <작업 트리>` 를 줘야 새 코드가 뜬다.
- 캐시 `.lab/lab-data.json` 은 낡을 수 있다(파일이 있으면 신선도 검사 없이 그대로 쓴다).
  - **캐시에 구멍(1..latest 연속성 실패)이 있으면 스크립트가 묻지 않는다.** 가드 예외가 «캐시 읽기 실패, 새로 받습니다» 로 넘어가 동행복권을 약 130회 호출하고 그 파일을 덮어쓴다
    (`rank-track` `rank-tiers` `validate` `weekly-brief` `backfill` 모두).
  - 그러니 원본은 건드리지 말고 **복사본을 `--cache` 로** 준다. 최신 자료로 갱신해야 하면(약 130회 호출) 실행 전에 소유자에게 먼저 묻는다.
- CI 순서 전체 `$N .lab/e2e/run.mjs` · 화면 `$N .lab/snap.mjs index.html --cache <캐시> --out x.png`
  또는 `python -m http.server 8766 --directory .`
  - **`run.mjs` 기본 실행은 pass1 에서 `fetch-order` 가 외부 사이트 2곳(추첨순서 출처)에 접속한다.** 허용된 출처지만 외부 접속(12번)이다. 접속 없이 돌리려면 `--passes 2,3`.
- 워크플로를 고쳤으면 `diff -q .github/workflows/weekly.yml setup/workflows/weekly.yml`.
- 푸시 전 `git status` 로 의도하지 않은 파일이 섞이지 않았는지 본다.

## 4. 편집 주의

- 줄 끝: **저장소 안은 전부 LF** 다(`git ls-files --eol` 의 `i/lf`). 이 PC 는 `core.autocrlf=true` 라 작업 트리에서만 대부분 CRLF 로 보인다(`w/crlf`. 새 파일 몇 개는 LF).
  - 주의할 파일은 **`remind.ics` 하나**: RFC 5545 때문에 `.gitattributes` 의 `-text` 로 저장소에서도 CRLF 를 유지한다. 줄 끝을 바꾸지 않는다.
  - 파일 하나에 CRLF·LF 가 섞이지 않게, 작업 트리의 기존 줄 끝을 보존하는 도구로 고친다. `sed -i` 는 CR 을 지울 수 있으니 CRLF 파일에는 쓰지 않는다.
- `index.html` 은 약 3천 줄 한 파일이다. Grep 으로 위치를 찾고 필요한 범위만 읽는다.
- 큰 JSON 은 대화에 덤프하지 않는다(키·길이·예시 1행만).
- 검증이 실패해도 지금 워크플로는 대부분 커밋·배포를 계속한다(검증 단계 `continue-on-error` + deploy `always()`). **예외 둘**(결과 커밋 단계가 `success()` 조건이라 건너뛰어진다):
  - `check-names` 실패 — compute·deploy 첫 단계라 계산·커밋·배포가 모두 멈춘다.
  - `weekly-brief` 실패(`continue-on-error` 없음) — 커밋이 막힌다. 배포는 `always()` 라 예전 main 을 그대로 배포한다.
  - 수집 연속성 가드는 출력을 쓰기 전에 실패하므로 구멍 난 결과는 커밋에 섞이지 않는다(`weekly-brief` 외 4개는 `continue-on-error` 라 잡은 계속 돈다).
  - 이 구조를 바꿀 때는 소유자와 먼저 정한다.
