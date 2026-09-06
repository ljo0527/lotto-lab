매주 금요일 아침에 도는 작업이다. 목요일 연금복권 추첨(19:05)이 끝난 다음 날이라, **연금 채점 + 구매 직전 추천 재생성 + 검증 보드 갱신**이 목적이다. `C:\workstation\일확천금` (GitHub 저장소 lotto-lab 루트)를 갱신한다. 사용자에게 되묻지 말고 끝까지 진행하라. 출력은 한국어, 결론 먼저, 서론 없이.

## 0) 전제

- 사용자는 **매주 추천 상위 5줄(로또 A~E) + 연금 상위 5장**을 실제로 산다. 주 10,000원.
- 「그 회차 추천 = 그 주에 산 것」으로 **자동 기록**된다(`brief/purchases.json`). 안 샀다고 말한 주만 예외 처리한다.
- 연금복권 판매시간: 금~수 24시간, 목(추첨일) 00:00~17:00 및 22:00~24:00. **금요일 아침이 구매 적기다.**
- 연금은 (조, 6자리) 조합 하나에 실물이 판매점 1장 + 인터넷 1장뿐이라 **품절될 수 있다.** 그래서 10순위까지 낸다.

## 1) 파일 가져오기

`device_stage_files` 로 아래를 가져온다. staged 경로는 `/mnt/user-data/uploads/일확천금/...` 이다.

- `index.html`, `pension.html`
- `scripts/weekly-brief.mjs`, `scripts/validate.mjs`
- `brief/purchases.json`
- `brief/` 안의 `YYYY-MM-DD.html` 최근 12개 (없으면 건너뛴다)

**`index.html` 과 `pension.html` 은 반드시 같은 폴더에 있어야 한다.** `/tmp/lab` 으로 복사하고,
ESM 이 NODE_PATH 를 무시하므로 **`ln -sfn /home/claude/.npm-global/lib/node_modules /tmp/lab/node_modules`** 를 걸어 둔다.
`playwright install` 은 절대 돌리지 마라 — 크로미움은 이미 있다.

## 2) 실행

```
mkdir -p /tmp/lab /tmp/out /tmp/seed
node /tmp/lab/scripts/weekly-brief.mjs --root /tmp/lab --out /tmp/out --seed-archive /tmp/seed
node /tmp/lab/scripts/validate.mjs   --root /tmp/lab --out /tmp/out --window 300 \
     --purchases /tmp/seed/purchases.json
```

두 스크립트 모두 동행복권 공식 API 에서 직접 데이터를 받고, 헤드리스 크로미움으로 `index.html`·`pension.html` 을
실제로 띄워 그 안의 함수를 불러 값을 꺼낸다. 각각 40~120초. **타임아웃 600000ms.** stdout 으로 JSON 요약이 나온다.
`--purchases` 에는 **가져온 기존 `purchases.json` 경로**를 준다. 빠뜨리면 원장이 매주 초기화된다.

## 3) 저장

SendUserFile 로 `/tmp/out/brief.html` 과 `/tmp/out/validate.html` 을 보내고, `device_commit_files`(force: true) 로 저장한다.

- `/tmp/out/brief.html` → `C:\workstation\일확천금\brief.html`
- `/tmp/out/brief/<오늘 KST 날짜>.html` → `C:\workstation\일확천금\brief\<같은 이름>.html`
- `/tmp/out/brief/index.html` → `C:\workstation\일확천금\brief\index.html`
- `/tmp/out/brief/latest-summary.json` → 같은 이름으로
- `/tmp/out/validate.html` → `C:\workstation\일확천금\validate.html`
- `/tmp/out/brief/purchases.json` → 같은 이름으로
- `/tmp/out/brief/validation.json` → 같은 이름으로

## 4) 보고 (한국어)

1. **연금 지난 회차 결과** — 당첨 조·번호·보너스, 1등/2등/보너스 당첨매수. 1등 0매면 「아무도 그 조합을 사지 않았다」고 적는다
2. **지난주 산 5장 채점** — 등수와 회수금. 없으면 「전부 미당첨」이라고 그대로 쓴다
3. **로또 지난 회차 결과와 채점** (토요일 추첨분이므로 6일 전 회차다)
4. **실구매 원장 누적** — 투입/회수/회수율, 그리고 **중앙값**. 주수가 적으면 «성능 지표가 아니라 가계부» 라고 명시
5. **검증 보드 요약** — 모델 R², 현행 규칙 z 이득과 무작위 대비 p 및 **보정 p**, 환산 효과(%), 양성 대조군(분배 최대)이 반대로 갈렸는지
6. **이번 주에 살 것**
   - 로또 A~E 5줄 (예비 F~J 는 아래에)
   - 연금 1~5순위 5장 (`조 + 6자리`). **품절이면 6~10순위로 내려가라**고 한 줄 덧붙인다
7. 마지막 한 줄: 「`깃허브-올리기.bat` 을 실행하면 배포됩니다」

## 원칙

- **확률은 바뀌지 않는다.** 로또 1등은 1/8,145,060, 연금 1등은 1/5,000,000 고정이다.
  로또에서 바뀌는 건 «나눠 갖는 인원»뿐이고 실측 효과는 walk-forward 300주로 **약 +7%**.
  **연금은 당첨금이 고정액이라 바꿀 수 있는 것이 아예 없다** — 10개 목록은 품절 대비 대안일 뿐이다.
- "확률을 높인다", "다음에 나올 것 같다" 류를 절대 쓰지 마라. **예상이 아니라 규칙에 따른 선택**이다.
- 회수율에는 **반드시 중앙값을 같이 적는다.** 평균은 1등 꼬리가 만들어 거의 아무도 겪지 않는 값이다.
- **한 주 실적으로 규칙을 판단하지 마라.** 회수금으로 +7% 를 판별하려면 약 1,700만 년이 걸린다(검증 보드 3층).
  판단은 1·2층(모델 R², z 이득)으로 한다. 낱개 p 가 0.05 미만이어도 **보정 p** 를 같이 본다.
- 스크립트가 실패하면 **번호를 지어내지 마라.** 오류를 그대로 보고하고 끝낸다.
- 컴퓨터가 꺼져 있어 파일을 못 가져오면 그 사실만 알리고 끝낸다.
- 파일 생성까지만 한다. 깃허브 푸시는 사용자가 직접 한다.
