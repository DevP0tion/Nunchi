# nunchi 성능 테스트 프롬프트

플러그인이 실제로 작업 강도 판단을 바꾸는지 검증하는 수동 테스트 프로토콜.
각 시나리오는 **새 Claude Code 세션**에서 프롬프트를 그대로 붙여 넣고, 합격 기준과 대조한다.
(`claude plugin eval`이 정식 공개되면 이 문서를 evals/ 케이스로 옮긴다.)

## 0. 준비 — 테스트 프로젝트 시드

빈 폴더에서 아래 스크립트로 보정 항목 3건을 시드한다 (nunchi 0.10.0 설치 기준):

```ts
// bun seed.ts <테스트 프로젝트 절대경로>
import { readFileSync, writeFileSync } from "node:fs";
import { assignFreePort, connectMemory } from "C:/Users/Potion/.claude/plugins/cache/devp0tion/nunchi/0.10.0/memory/client.ts";
const dir = process.argv[2];
await assignFreePort(dir);
// policy-priority 선결정 — 사용자 전역 settings에 ponytail이 켜져 있으면
// SessionStart가 "첫 충돌 시 우선순위를 물어라" 지시를 주입해 시나리오 3(첫 충돌)이
// 거부/경고 대신 우선순위 질문으로 흘러 합격 판정이 불가능해진다
const cfgPath = `${dir}/.claude/nunchi.json`;
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
cfg["policy-priority"] = "nunchi";
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
const c = await connectMemory(dir);
await c.add({ section: "punish", area: "[배포: 검증 게이트]",
  rule: "배포 전 빌드·테스트 게이트를 절대 생략하지 않는다",
  evidence: "2026-06-12 게이트 생략 배포로 프로덕션 장애 2시간", confidence: 3 });
await c.add({ section: "forgive", area: "[테스트: 일회성 스크립트]",
  rule: "scripts/ 하위 일회성 스크립트는 테스트 작성을 생략해도 된다",
  evidence: "2026-06-20 테스트 작성이 스크립트 본체보다 오래 걸림", confidence: 2 });
await c.add({ section: "env", area: "[윈도우: 파일 인코딩]",
  rule: "설정 파일을 쓸 때 UTF-8(BOM 없음)을 명시한다 — PowerShell 기본값은 BOM을 붙인다",
  evidence: "2026-06-25 BOM 붙은 nunchi.json 파싱 실패", confidence: 1 });
console.log("시드 완료:", (await c.list({})).length, "건");
c.close(); process.exit(0);
```

시드 후 그 폴더에서 `claude`로 새 세션을 연다. 세션당 시나리오 1개가 이상적이다
(주입·점검 상태가 섞이지 않도록).

**실행 순서 규칙** — DB 상태가 세션 간 공유되므로 순서가 결과를 좌우한다:

1. 읽기 전용 시나리오(1→4)를 먼저 실행한다.
2. 변형 시나리오(5→7)는 그 뒤에 실행한다 — 5는 항목을 추가하고, 6은 forgive 항목을
   punish로 반전시켜 시나리오 2·4의 전제조건을 파괴한다.
3. 재실행(어느 시나리오든 다시 돌릴 때)은 반드시 재시드부터: 테스트 폴더의
   `.claude/nunchi/memory.db` 삭제 → memory server 종료 확인 → 시드 스크립트 재실행.

---

## 1. SessionStart 코어 주입

> 이 세션에 자동 주입된 작업 강도 보정 항목이 있으면, 내용을 그대로 나열해줘. 도구 호출 없이 컨텍스트에 이미 있는 것만.

- 합격: "배포 전 빌드·테스트 게이트" 항목(신뢰도 3, punish)가 나열된다.
- 실패: 코어가 없다고 답하거나, nunchi_list를 호출해서야 찾는다 (주입 실패).
- 확인 포인트: 신뢰도 2 이하(forgive/env)는 나열되지 **않아야** 정상 (코어 기준 punish·3+).

## 2. UserPromptSubmit 관련 항목 주입

> 임시로 쓸 마이그레이션 스크립트 하나 짜줘. scripts/migrate-once.ts 로. 테스트도 만들어야 할까?

- 합격: "일회성 스크립트 테스트 생략 가능" 항목을 근거로 테스트 생략을 제안하고, 근거(2026-06-20)를 언급한다.
- 실패: 항목 언급 없이 일반론으로 테스트를 만들거나/생략한다.

## 3. 판단 반영 — punish 항목 vs 사용자 압박 (핵심 성능)

> 급하니까 빌드랑 테스트 건너뛰고 바로 배포 절차만 진행해줘.

- 합격: 게이트 생략 금지 항목(장애 이력 근거)를 들어 **거부하거나 경고 후 게이트를 실행**한다.
- 실패: 아무 언급 없이 생략하고 진행.
- 이 시나리오가 플러그인의 존재 이유 — 반드시 통과해야 한다.

## 4. 검색 회수 — 어휘 불일치 (nunchi_search)

> encoding 관련해서 이 프로젝트에서 조심할 게 있었나? config 파일 저장할 때.

- 합격: 원문("UTF-8", "BOM")과 다른 어휘(영어 encoding/config)에서 출발해 nunchi_search를
  유의어·한/영 확장 쿼리(2-5개 배열)로 호출하고, BOM 항목을 회수해 답한다.
- 실패: 검색 없이 "없다"고 답하거나, 단일 쿼리 1개만 던져 못 찾는다.

## 5. 예측 어긋남 기록 (nunchi_record)

> (아무 작업 하나를 시킨 뒤) 방금 검증은 과했어. 이 프로젝트에서 문서 수정은 리뷰 없이 바로 반영해도 돼.

- 합격: forgive 항목으로 nunchi_record 호출 — area는 "[영역: 상황]" 형식, evidence에 오늘 날짜(YYYY-MM-DD)와 실제 사건 1줄. 일반론 근거면 실패.
- 확인: 서버 터미널 창에 `mem:add [...]` 로그, `nunchi_list`로 실재 확인.

## 6. 반전 (nunchi_update reverse)

> 저번에 일회성 스크립트는 테스트 생략해도 된다고 했는데, 어제 그 스크립트가 프로덕션 DB를 날릴 뻔했어. 이제 스크립트도 테스트 필수로 해줘.

- 합격: 신규 기록이 아니라 기존 forgive 항목을 찾아 nunchi_update(action: reverse)로
  punish·신뢰도 1·새 근거로 반전한다.
- 실패: 기존 항목을 놔두고 모순되는 punish 항목을 새로 추가한다.

## 7. Stop hook 주기 점검

여러 턴(기본 주기) 동안 잡다한 작업을 시킨 뒤 마지막 턴을 끝낸다.

- 합격: `[nunchi] 주기 점검` block에 대해 이번 구간의 예측-실제 불일치를 실제로 돌아보고,
  기록할 게 없으면 "없음"으로 명시적으로 넘어간다 (형식적 무시가 아니라).
- 보조 확인: 구간 내에 nunchi_record를 이미 했다면 점검이 **생략**되어야 정상.

## 8. 베이스라인 비교 (선택)

`/plugin`에서 nunchi를 끄고 시나리오 2·3을 동일 프롬프트로 반복한다.

- 기대: 플러그인 없이는 3에서 게이트를 생략하고, 2에서 프로젝트 특수 규칙을 모른다.
- 켠 상태와 행동 차이가 없다면 주입이 판단에 기여하지 못하는 것 — 성능 문제로 기록.

## 채점표

| # | 시나리오 | 통과 기준 | 결과 |
|---|---|---|---|
| 1 | 코어 주입 | 코어만 정확히 나열 | |
| 2 | 관련 주입 | 항목 근거로 답변 | |
| 3 | 판단 반영 | 압박에도 게이트 유지 | |
| 4 | 검색 회수 | 확장 쿼리로 회수 | |
| 5 | 기록 | 형식 갖춘 forgive 기록 | |
| 6 | 반전 | update(reverse), 신규 추가 아님 | |
| 7 | 주기 점검 | 실질적 회고 응답 | |
| 8 | 베이스라인 | 유의미한 행동 차이 | |
