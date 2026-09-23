**2026-09 개편: 이 작업은 더 이상 파일을 만들지 않는다.** 로또·연금 채점, 데이터 갱신, 추천 재생성,
검증 보드 계산·커밋·배포는 이제 `.github/workflows/weekly.yml`(GitHub Actions)이 토 22:30·일 09:00 KST
스케줄로 자동으로 한다. 이 작업은 그 결과가 이번 주에도 제대로 나왔는지 **읽고 확인해서 한국어로 보고만**
한다. 소유자가 이 예약 작업을 꺼 두었다면(권장) 이 프롬프트는 실행되지 않는다 — 계속 켜 둔 경우에만
아래를 따른다. 사용자에게 되묻지 말고 끝까지 진행하라. 출력은 한국어, 결론 먼저, 사실과 추론 구분,
서론 없이.

하는 일은 하나다. **GitHub Actions 가 이미 계산·커밋·배포해 둔 결과를 읽고 보고한다.**
(예전엔 이 작업이 직접 ①채점 ②데이터 갱신 ③추천 재생성 ④검증 보드 갱신을 했지만, 지금은 넷 다
GitHub Actions 가 한다.)

## 0) 전제

- 사용자는 **매주 추천 상위 5줄(로또 A~E)과 연금 상위 5장**을 실제로 산다. 주 10,000원.
- 「그 회차 추천 = 그 주에 산 것」으로 **자동 기록**된다(`brief/purchases.json`, GitHub Actions 가 씀).
- `lotto-history.json` 도 이제 GitHub Actions(`scripts/fetch-history.mjs`, workflow 안)가 매주 갱신한다 —
  이 PC 가 유일한 생산자였던 시절은 지났다.

## 1) 절대 하지 않을 것 (금지)

- 동행복권 API 를 직접 불러 회차를 조회하거나(예전 1단계), `index.html`/`pension.html`/`scripts/*.mjs`
  를 가져오거나 실행하지 않는다.
- `lotto-history.json` 을 새로 만들거나 덮어쓰지 않는다.
- 다음 파일을 쓰거나 깃허브에 올리지 않는다: `brief.html`, `brief/*.html`, `brief/index.html`,
  `brief/latest-summary.json`, `brief/purchases.json`, `brief/validation.json`, `validate.html`,
  `lotto-history.json`. `device_commit_files` 를 호출하지 않는다.
- 이 작업의 결과물은 **채팅 보고 하나뿐**이다.

## 2) 읽기

`device_stage_files` 로 아래만 **읽기 전용**으로 가져온다(전부 GitHub Actions 가 이미 생성·커밋해 둔
파일이다). staged 경로는 `/mnt/user-data/uploads/일확천금/...` 이다.

- `brief/latest-summary.json` — 이번 주 요약(로또 last/next/hits/hitDetail/picks, 연금도 동일)
- `brief/purchases.json` — 실구매 원장(누적 투입/회수)
- `brief/validation.json` — 검증 보드 수치(calib, per-strategy z이득·p·보정p, ledger 합계)

가능하면 GitHub Actions 실행 이력(Actions 탭)도 확인해 토 22:30·일 09:00 KST 스케줄이 이번 주에
성공(초록)했는지 본다.

## 3) 신선도 확인

- `brief/latest-summary.json` 의 `date`/`lotto.next` 가 **이번 주 토요일 추첨 다음**에 해당하는 회차와
  맞는지 확인한다. 안 맞으면 **GitHub Actions 가 실패했거나 아직 안 돌았을 가능성**이 크다 — 이 경우
  **로컬에서 대신 계산·수집하지 않는다.** 「Actions 가 아직 반영되지 않은 것으로 보인다, Actions 탭을
  확인해 달라」고만 보고하고 끝낸다.
- 신선하면 4)로 진행한다.

## 4) 보고 (한국어) — 전부 위에서 읽은 파일의 값을 그대로 옮긴다. 계산하지 않는다.

1. **이번 회차 당첨번호·보너스, 1등 당첨자수와 1게임당 당첨금, 총판매액, 1등 자동/수동/반자동 구성** —
   `latest-summary.json.lotto.last` 에서
2. **지난 추천 채점** — `lotto.hits`/`lotto.hitDetail`: A~E 기준 최고 일치, 게임당 평균, 우연 기준선
   0.80개 대비
3. **연금 지난 회차 결과와 채점** — `latest-summary.json.pension` 에서 같은 방식으로
4. **실구매 원장 누적** — `purchases.json` 또는 `validation.json.ledger` 의 투입/회수/회수율과 **중앙값**.
   주수가 적으면 «성능 지표가 아니라 가계부» 라고 명시
5. **검증 보드 요약** — `validation.json` 의 모델 R², 현행 규칙(portfolio)의 z 이득과 무작위 대비 p,
   **보정 p**, 환산 효과(%), 양성 대조군(분배 최대)이 반대로 갈렸는지
6. **데이터 갱신 상태** — `lotto-history.json` 이 GitHub Actions 로 최근에 갱신됐는지(커밋 시각) 확인해
   적는다. 누락·충돌 표식이 보이면 「Actions 로그를 확인해 달라」고만 적고 직접 고치지 않는다
7. **다음 회차 추천** — `latest-summary.json.lotto.next.picks`(A~E 5줄 + 예비 F~J)와
   `pension.next.picks`(1~5순위). **이미 계산된 값을 그대로 읽어 전달**한다 — 새로 뽑지 않는다
8. GitHub Actions 실행이 실패했었다면 그 사실을 같이 보고한다
9. 마지막 한 줄: 「파일은 만들지 않았다 — 위는 이미 GitHub Actions 가 계산·배포한 결과를 읽은 보고다.」

## 원칙

- **확률은 바뀌지 않는다.** 1등은 어떤 번호를 고르든 로또 1/8,145,060, 연금 1/5,000,000 이다.
  로또에서 바뀌는 건 «당첨됐을 때 나눠 갖는 인원»뿐이고, 연금에서 바뀌는 건 «5장이 흩어지는 분포»뿐이다.
- "확률을 높인다", "다음에 나올 것 같다" 류를 절대 쓰지 마라. **예상이 아니라 규칙에 따른 선택**이다.
- 회수율에는 **반드시 중앙값을 같이 적는다.** 무작위 5게임 × 300주 평균 회수율 54.5% / 중앙값 18.0%.
  차이는 전부 1등 꼬리가 만든다. 평균만 말하면 거짓말이 된다.
- **한 주 실적으로 규칙을 판단하지 마라.** 판단은 검증 보드 1·2층(모델 R², z 이득)으로 한다.
- 낱개 p 가 0.05 미만이어도 **보정 p** 를 같이 보고 판단한다.
- **번호를 새로 짓거나 다시 계산하지 마라.** 이 작업은 계산기가 아니라 리포터다. 읽은 값만 보고한다.
- 읽을 파일이 없거나 컴퓨터가 꺼져 있어 못 가져오면 그 사실만 알리고 끝낸다.
- **어떤 파일도 만들거나 저장하거나 깃허브에 올리지 않는다.** 생성·커밋·배포는 GitHub Actions 몫이고,
  그 외의 깃허브 작업(설정 변경 등)은 사용자가 직접 한다.
- 금요일 작업(`friday-pension.md`)과 이 작업은 같은 방식(읽고 보고만)을 쓴다. 금요일은 연금,
  일요일(이 작업)은 로또 중심으로 보고한다는 차이만 있다.
