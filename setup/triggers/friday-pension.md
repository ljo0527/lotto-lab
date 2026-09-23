**2026-09 개편: 이 작업은 더 이상 파일을 만들지 않는다.** 연금·로또 계산·커밋·배포는 이제
`.github/workflows/weekly.yml`(GitHub Actions)이 목 21:30·금 09:00 KST 스케줄로 자동으로 한다. 이 작업은
그 결과가 이번 주에도 제대로 나왔는지 **읽고 확인해서 한국어로 보고만** 한다. 소유자가 이 예약 작업을
꺼 두었다면(권장) 이 프롬프트는 실행되지 않는다 — 계속 켜 둔 경우에만 아래를 따른다.
사용자에게 되묻지 말고 끝까지 진행하라. 출력은 한국어, 결론 먼저, 서론 없이.

## 0) 전제

- 사용자는 **매주 추천 상위 5줄(로또 A~E) + 연금 상위 5장**을 실제로 산다. 주 10,000원.
- 「그 회차 추천 = 그 주에 산 것」으로 **자동 기록**된다(`brief/purchases.json`, GitHub Actions 가 씀).
  안 샀다고 말한 주만 예외로 알려준다.
- 연금복권 판매시간: 금~수 24시간, 목(추첨일) 00:00~17:00 및 22:00~24:00.

## 1) 절대 하지 않을 것 (금지)

- `index.html`, `pension.html`, `scripts/*.mjs` 를 가져오거나 실행하지 않는다.
- `weekly-brief.mjs`/`validate.mjs`/`fetch-history.mjs` 를 돌리지 않는다.
- 다음 파일을 쓰거나 깃허브에 올리지 않는다: `brief.html`, `brief/*.html`, `brief/index.html`,
  `brief/latest-summary.json`, `brief/purchases.json`, `brief/validation.json`, `validate.html`,
  `lotto-history.json`. `device_commit_files` 를 호출하지 않는다.
- 이 작업의 결과물은 **채팅 보고 하나뿐**이다. 파일을 만들지도, 저장하지도, 올리지도 않는다.

## 2) 읽기

`device_stage_files` 로 아래만 **읽기 전용**으로 가져온다(전부 GitHub Actions 가 이미 생성·커밋해 둔
파일이다). staged 경로는 `/mnt/user-data/uploads/일확천금/...` 이다.

- `brief/latest-summary.json` — 이번 주 요약(연금 last/next/hits/hitDetail/picks/backtest, 로또도 동일)
- `brief/purchases.json` — 실구매 원장(누적 투입/회수)
- `brief/validation.json` — 검증 보드 수치(calib, per-strategy z이득·p·보정p, ledger 합계)

가능하면 GitHub Actions 실행 이력(Actions 탭 또는 `gh run list` 상당)도 확인해, 목 21:30·금 09:00 KST
스케줄이 이번 주에 성공(초록)했는지 본다.

## 3) 신선도 확인

- `brief/latest-summary.json` 의 `date`/`pension.next` 가 **이번 주 목요일 추첨 다음**에 해당하는 회차와
  맞는지 확인한다. 안 맞으면(며칠 이상 뒤처졌으면) **GitHub Actions 가 실패했거나 아직 안 돌았을 가능성**이
  크다 — 이 경우 **로컬에서 대신 계산하지 않는다.** 「Actions 가 아직 반영되지 않은 것으로 보인다, Actions
  탭을 확인해 달라」고만 보고하고 끝낸다.
- 신선하면 4)로 진행한다.

## 4) 보고 (한국어) — 전부 위에서 읽은 파일의 값을 그대로 옮긴다. 계산하지 않는다.

1. **연금 지난 회차 결과** — `latest-summary.json.pension.last`: 당첨 조·번호·보너스, 1등/2등/보너스
   당첨매수. 1등 0매면 「아무도 그 조합을 사지 않았다」고 적는다
2. **지난주 산 5장 채점** — `pension.hits`/`pension.hitDetail`. 없으면 「전부 미당첨」이라고 그대로 쓴다
3. **로또 지난 회차 결과와 채점** — `latest-summary.json.lotto` 에서 같은 방식으로
4. **실구매 원장 누적** — `purchases.json` 또는 `validation.json.ledger` 의 투입/회수/회수율과 **중앙값**.
   주수가 적으면 «성능 지표가 아니라 가계부» 라고 명시
5. **검증 보드 요약** — `validation.json` 의 모델 R², 현행 규칙(portfolio) z이득과 무작위 대비 p 및
   **보정 p**, 환산 효과(%), 양성 대조군(분배 최대)이 반대로 갈렸는지
6. **이번 주 추천** — `latest-summary.json.pension.next.picks`(1~5순위 5장, `조 + 6자리`)와
   `lotto.next.picks`(A~E 5줄 + 예비 F~J). **이미 계산된 값을 그대로 읽어 전달**한다 — 새로 뽑지 않는다.
7. GitHub Actions 실행이 실패했었다면 그 사실을 같이 보고한다.
8. 마지막 한 줄: 「파일은 만들지 않았다 — 위는 이미 GitHub Actions 가 계산·배포한 결과를 읽은 보고다.」

## 원칙

- **확률은 바뀌지 않는다.** 로또 1등은 1/8,145,060, 연금 1등은 1/5,000,000 고정이다.
  로또에서 바뀌는 건 «나눠 갖는 인원»뿐이고, 연금에서 바뀌는 건 «5장이 흩어지는 분포»뿐이다 —
  둘 다 확률도 기대값도 바꾸지 않는다.
- "확률을 높인다", "다음에 나올 것 같다" 류를 절대 쓰지 마라. **예상이 아니라 규칙에 따른 선택**이다.
- 회수율에는 **반드시 중앙값을 같이 적는다.** 평균은 1등 꼬리가 만들어 거의 아무도 겪지 않는 값이다.
- **한 주 실적으로 규칙을 판단하지 마라.** 판단은 검증 보드 1·2층(모델 R², z 이득)으로 한다.
  낱개 p 가 0.05 미만이어도 **보정 p** 를 같이 본다.
- **번호를 새로 짓거나 다시 계산하지 마라.** 이 작업은 계산기가 아니라 리포터다. 읽은 값만 보고한다.
- 읽을 파일이 없거나 컴퓨터가 꺼져 있어 못 가져오면 그 사실만 알리고 끝낸다.
- **어떤 파일도 만들거나 저장하거나 깃허브에 올리지 않는다.** 생성·커밋·배포는 GitHub Actions 몫이고,
  그 외의 깃허브 작업(설정 변경 등)은 사용자가 직접 한다.
