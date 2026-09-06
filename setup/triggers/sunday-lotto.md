토요일 추첨이 끝난 다음 날 아침에 도는 작업이다. `C:\workstation\일확천금` (GitHub 저장소 lotto-lab 의 루트)를 갱신한다. 사용자에게 되묻지 말고 끝까지 진행하라. 출력은 한국어, 결론 먼저, 사실과 추론 구분, 서론 없이.

하는 일은 넷이다. **① 지난 추천 채점 ② 데이터 갱신 ③ 다음 회차 추천 재생성 ④ 검증 보드·실구매 원장 갱신.**

## 0) 전제

- 사용자는 **매주 추천 상위 5줄(A~E)을 실제로 산다.** 연금복권도 상위 5장을 산다. 주 10,000원.
- 그래서 「그 회차 추천 = 그 주에 산 것」으로 **자동 기록**된다(`brief/purchases.json`). 사용자가 안 샀다고 말한 주만 예외 처리한다.
- 이 PC 에는 device_bash 가 없다. `lotto-history.json` 의 유일한 생산자가 이 PC 다.
- 파일: `index.html`(로또) `pension.html`(연금) `validate.html`(검증 보드) `brief.html`(주간 브리핑)
  `scripts/weekly-brief.mjs` `scripts/validate.mjs` `brief/{purchases,validation,latest-summary}.json`

## 1) 최신 회차 확인

내장 브라우저(`mcp__remote-devices__Claude_Browser__*`)로 `https://www.dhlottery.co.kr/lt645/result` 를 열고
그 페이지 안에서 `javascript_tool` 로 `/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=<회차>` 를 fetch 한다(같은 오리진).

지정 회차 중심 `center-5 … center+4` 를 최신순으로 준다. 필드: `ltEpsd` `ltRflYmd` `tm1~tm6WnNo`(**정렬값이지 추첨순서가 아니다**)
`bnsWnNo` `rnk1~5WnNope` `rnk1~5WnAmt` `wholEpsdSumNtslAmt` `winType1/2/3`(1등 자동/수동/반자동).

**⚠️ 최신 회차 탐지는 보폭 +1 로 한다.** `best+5` 를 찌르면 새 회차가 1~4개만 쌓인 상태에서 빈 응답이 와 낡은 값을 그대로 반환한다. 주 1회 갱신이라 이 버그는 매번 재현된다.

## 2) 지난 추천 채점

`device_stage_files` 로 `brief/latest-summary.json` 을 가져온다. `lotto.next` 가 이번에 추첨된 회차와 같으면 `lotto.picks` 를 실제 당첨번호와 대조한다.

- **상위 5줄(A~E)이 실제로 산 용지다.** A~E 를 먼저 채점하고 예비 F~J 는 따로 적는다
- 줄마다 일치 개수와 등수(6=1등 / 5+보너스=2등 / 5=3등 / 4=4등 / 3=5등), 총 일치와 게임당 평균
- **우연 기준선을 반드시 같이 적는다: 게임당 기대 일치 = 6 × 6/45 = 0.80개**
- 기준선보다 낮으면 낮다고 그대로 쓴다. 표본이 1회라는 점을 명시하고, 한 주 결과로 추세를 말하지 않는다

## 3) 데이터 갱신

1회~최신까지 전량 수집(회차 10씩 감소, 병렬 6)해 `lotto-history.json` 을 만든다.
형식: `{"meta":{"generated","latest","count","source"},"draws":[{"round","date","numbers"[6],"bonus","winners":{first..fifth},"prize":{first..fifth},"sales","firstType":{auto,manual,semi}}]}`

**1~최신이 빠짐없이 연속인지 검증**하고 누락은 재시도한다.
**저장 전 첫 줄이 `<<<<<<<` 로 시작하지 않는지 확인한다** — 병합 충돌 표식이 박힌 채 배포된 적이 있다(2026-09-03). 표식이 보이면 회차 수가 많은 쪽을 남긴다.

## 4) 추천 재생성 + 검증 보드 (한 번에)

`device_stage_files` 로 `index.html`, `pension.html`, `scripts/weekly-brief.mjs`, `scripts/validate.mjs`,
`brief/purchases.json`, 그리고 `brief/` 안의 `YYYY-MM-DD.html` 최근 12개를 가져온다.
staged 경로는 `/mnt/user-data/uploads/일확천금/...` 이다.

**`index.html` 과 `pension.html` 은 반드시 같은 폴더에 있어야 한다.** `/tmp/lab` 으로 복사하고,
ESM 이 NODE_PATH 를 무시하므로 **`ln -sfn /home/claude/.npm-global/lib/node_modules /tmp/lab/node_modules`** 를 걸어 둔다.
`playwright install` 은 절대 돌리지 마라 — 크로미움은 이미 있다.

```
mkdir -p /tmp/lab /tmp/out /tmp/seed
node /tmp/lab/scripts/weekly-brief.mjs --root /tmp/lab --out /tmp/out --seed-archive /tmp/seed
node /tmp/lab/scripts/validate.mjs   --root /tmp/lab --out /tmp/out --window 300 \
     --purchases /tmp/seed/purchases.json
```
각각 40~120초. 타임아웃 600000ms. 둘 다 stdout 으로 JSON 요약을 낸다.
`--purchases` 에는 **가져온 기존 `purchases.json` 경로**를 준다. 빠뜨리면 원장이 매주 초기화된다.

성공하면 SendUserFile 로 `/tmp/out/validate.html` 과 `/tmp/out/brief.html` 을 보내고, `device_commit_files`(force: true) 로 저장한다.

- `/tmp/out/brief.html` → `C:\workstation\일확천금\brief.html`
- `/tmp/out/brief/<오늘 KST 날짜>.html` → `C:\workstation\일확천금\brief\<같은 이름>.html`
- `/tmp/out/brief/index.html` → `C:\workstation\일확천금\brief\index.html`
- `/tmp/out/brief/latest-summary.json` → 같은 이름으로
- `/tmp/out/validate.html` → `C:\workstation\일확천금\validate.html`
- `/tmp/out/brief/purchases.json` → 같은 이름으로
- `/tmp/out/brief/validation.json` → 같은 이름으로

## 5) 보고 (한국어)

1. 이번 회차 당첨번호·보너스, 1등 당첨자수와 1게임당 당첨금, 총판매액, **1등 자동/수동/반자동 구성**
2. **지난 추천 채점** — A~E 기준 최고 일치, 게임당 평균, 우연 기준선 0.80개 대비
3. **실구매 원장 누적** — 투입/회수/회수율, 그리고 **중앙값**. 주수가 적으면 «성능 지표가 아니라 가계부» 라고 명시
4. **검증 보드 요약** — 모델 R², 현행 규칙의 z 이득과 무작위 대비 p, **보정 p**, 환산 효과(%), 양성 대조군(분배 최대)이 반대로 갈렸는지
5. 데이터 갱신 결과 (보유 회차, 누락, 충돌 표식)
6. **다음 회차 추천** — 「이번 주 용지 A~E」 5줄 먼저, 「예비 F~J」 아래
7. 마지막 한 줄: 「`깃허브-올리기.bat` 을 실행하면 배포됩니다」

## 원칙

- **확률은 바뀌지 않는다.** 1등은 어떤 번호를 고르든 1/8,145,060. 이 추천이 바꾸는 건 «당첨됐을 때 나눠 갖는 인원»뿐이다.
  실측 효과는 walk-forward 300주로 **약 +7%**. «10~15%» 는 재보정 전 과대평가이니 쓰지 마라.
- "확률을 높인다", "다음에 나올 것 같다" 류를 절대 쓰지 마라. **예상이 아니라 규칙에 따른 선택**이다.
- 회수율에는 **반드시 중앙값을 같이 적는다.** 무작위 5게임 × 300주 평균 회수율 54.5% / 중앙값 18.0%.
  차이는 전부 1등 꼬리가 만든다(1,500게임에서 1등 확률 0.018%). 평균만 말하면 거짓말이 된다.
- **한 주 실적으로 규칙을 판단하지 마라.** 회수금으로 +7% 를 판별하려면 약 1,700만 년이 걸린다(검증 보드 3층).
  판단은 1·2층(모델 R², z 이득)으로 한다.
- 낱개 p 가 0.05 미만이어도 **보정 p** 를 같이 보고 판단한다.
- 스크립트가 실패하면 **번호를 지어내지 마라.** 오류를 그대로 보고하고 끝낸다.
- 컴퓨터가 꺼져 있어 파일을 못 가져오면 그 사실만 알리고 끝낸다.
- 파일 생성까지만 한다. 깃허브 푸시는 사용자가 직접 한다.
- 금요일 08:00 작업과 같은 스크립트를 쓴다. 추천이 회차 시드로 결정적이라 두 번 돌아도 값이 달라지지 않는다.
  금요일은 연금 채점 + 구매 직전 재생성, 일요일(이 작업)은 로또 채점과 데이터 갱신이 목적이다.
