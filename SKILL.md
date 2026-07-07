---
name: nunchi
description: 작업 강도 보정("적당히") 규약. 프로젝트별 보정 DB(memory.db memory 테이블)에 예측-실제 불일치(예측 어긋남)를 기록하고 재귀 개선한다. 다음 상황에서 반드시 이 스킬을 사용할 것 - 사용자가 "눈치", "적당히", "보정", "캘리브레이션", "calibration"을 언급할 때, 과잉/과소 대응(over/under-engineering) 판단이 필요할 때, 보정 항목의 기록·갱신·정제(pruning)가 필요할 때, Stop hook 점검([nunchi] 주기 점검)에 응답할 때, 검증 깊이·테스트 범위·리서치 강도를 어느 수준으로 할지 애매할 때.
---

# nunchi — 작업 강도 보정

"적당히"는 고정 규칙이 아니라 **환경별로 학습되는 판단 기준**이다. 어떤 환경은 테스트 생략을 벌주고, 어떤 환경은 과잉 검증이 시간 낭비다. 이 스킬은 그 기준을 프로젝트 경험으로 학습해 보정 DB(`memory.db`의 `memory` 테이블)에 축적하고, 세션 시작 시 자동 주입과 매 메시지 검색 회수로 불러와 작업 강도 결정의 기준으로 삼는다.

## 저장소와 회수

- 저장소: `{path 폴더}/memory.db`의 `memory` 테이블 (프로젝트별 독립, memory server가 단일 소유). 항목 필드: section(punish=벌주는 것 / forgive=용서하는 것 / env=환경 특이사항), area("[영역: 짧은 상황 서술]"), rule, evidence, confidence.
- 회수 3계층:
  1. **자동 주입** — SessionStart가 규약 요약 + 코어('벌주는 것' 신뢰도 3+)를, UserPromptSubmit이 프롬프트 관련 상위 3건을, SubagentStart가 서브에이전트에 규약+코어를 주입한다. 모델 개입 없음.
  2. **`nunchi_search`** — 주입으로 부족할 때. 원문 어휘에 얽매이지 말고 유의어·관련어·한/영 변형 쿼리 2-5개를 배열로 전달한다 (시맨틱 매칭은 쿼리를 만드는 쪽의 몫).
  3. **`nunchi_list`** — 판단이 중요하거나 검색이 애매할 때. 전량(몇 KB)을 읽고 인컨텍스트에서 직접 선별한다 — recall 100%.
- 기존 calibration.md는 서버 기동 시 1회 자동 임포트되고 `.imported`로 보존된다. 내보내기가 필요하면 memory client의 `doc()`이 DB에서 markdown을 렌더링한다.

## 항목 포맷 (nunchi_record 입력)

- `section`: punish(벌주는 것) | forgive(용서하는 것) | env(환경 특이사항)
- `area`: "[영역: 짧은 상황 서술]"
- `rule`: 무엇을 한다 / 생략해도 된다
- `evidence`: "YYYY-MM-DD 실제로 있었던 일 1줄" — 반드시 실제 사건. 일반론("보통 테스트는 중요하다")은 기록하지 않는다.
- 신뢰도(confidence)는 규칙을 따라서 무사고였던 관측 횟수. 같은 규칙이 재확인되면 새 항목을 만들지 말고 `nunchi_update(action: confirm)`으로 +1 한다 (날짜 자동 갱신). 주입·조회 결과의 `(#id)`가 갱신 대상 id다.

## 예측 어긋남 판정 — 기록할 것과 기록하지 않을 것

**기록한다** (예측과 실제의 불일치만):

1. **과잉이었음**: 검증/리서치/방어 코드/추상화를 했는데 결과적으로 불필요했음 → "용서하는 것"에 추가
2. **과소였음**: 생략하거나 가볍게 처리한 것 때문에 실제 문제가 발생했음 → "벌주는 것"에 추가
3. **환경 특이사항**: 문서/상식과 다른 이 환경 고유의 동작을 발견했음 → "환경 특이사항"에 추가

**기록하지 않는다**:

- 예측대로 흘러간 평범한 작업 (신호가 아니라 노이즈다)
- 일회성 오타·단순 실수 (환경의 속성이 아니다)
- 이미 있는 항목과 동일한 내용 (대신 해당 항목의 신뢰도 +1, 날짜 갱신)

## 기록 절차

1. 예측 어긋남 인지 시점에 현재 작업 단락을 먼저 마무리한다 (작업 흐름을 끊지 않는다).
2. 단락이 끝나면 즉시 기록한다: 신규는 `nunchi_record`, 기존 항목 재확인은 `nunchi_update(action: confirm)`.
3. 기록 사실을 사용자에게 한 줄로 알린다: `[nunchi] 기록: {규칙 요약}`
4. Stop hook의 `[nunchi] 주기 점검` 메시지를 받으면: 이번 구간의 예측 어긋남 유무를 점검하고, 있으면 기록, 없으면 "보정 특이사항 없음" 한 줄로 종료한다.

## 신뢰도와 반전 — 자기강화 방지 (핵심)

이 시스템의 최대 실패 모드는 "용서하는 것"이 반증 기회를 없애며 게으름으로 고착되는 것이다. 다음 규칙으로 방지한다:

- **반전 규칙**: "용서하는 것" 항목을 따르다 문제가 발생하면, 즉시 `nunchi_update(action: reverse, evidence: 새 사건)`으로 반전한다 — punish로 이동 + 신뢰도 낮음(1) 리셋 + 근거 교체. 예외 없음.
- **가설 취급**: 신뢰도 낮음(1) 항목은 확정 규칙이 아니라 가설이다. 따르되, 결과가 조금이라도 이상하면 규칙보다 관찰을 우선한다.
- **승격**: 높음(3+)으로 승격된 항목만 확정 규칙으로 취급한다.
- **사용자 지시 우선**: 사용자의 명시적 지시는 항상 보정 규칙보다 우선한다. 충돌 시 지시를 따르고, 반복되는 충돌이면 항목을 갱신한다.

## 정제 (pruning) — `/nunchi` 수동 호출 시

항목이 60건을 초과했거나 사용자가 정제를 요청하면 `nunchi_list`로 전량을 읽고:

1. 동일 영역의 유사 항목을 하나로 통합한다 (`nunchi_update(edit)` + `nunchi_update(remove)`, 신뢰도는 합산하지 않고 최댓값 유지).
2. 신뢰도 낮음(1) 상태로 6주 이상 갱신이 없는 항목을 삭제한다.
3. 신뢰도 높음(3+) 항목은 보존한다. 단 근거 사건이 리팩토링 등으로 무효화되었으면 사용자에게 확인 후 삭제한다.
4. 정제 결과(통합 n건, 삭제 n건)를 사용자에게 보고한다.

## 설정 (config)

우선순위: 프로젝트 `.claude/nunchi.json` > plugin userConfig(환경 변수 `CLAUDE_PLUGIN_OPTION_*`) > 내장 기본값. userConfig는 `.claude-plugin/plugin.json`에 선언되며 Claude Code plugin 설정 UI에서 값을 지정한다. 변경은 plugin 재로드 없이 다음 hook 실행부터 반영된다.

| userConfig 키 | 환경 변수 | nunchi.json 키 | 기본값 | 설명 |
|---|---|---|---|---|
| `auto_start` | `CLAUDE_PLUGIN_OPTION_AUTO_START` | `auto-start` | `true` | `true`면 SessionStart 시 memory server 자동 시작 |
| `path` | `CLAUDE_PLUGIN_OPTION_PATH` | `path` | `.claude/nunchi` | 보정 DB(memory.db)가 저장될 폴더 (프로젝트 루트 기준 상대 또는 절대). 초기화 시 없으면 생성 |
| `port` | `CLAUDE_PLUGIN_OPTION_PORT` | `port` | `null` | memory server(Socket.IO) 포트. 미설정 시 memory-config.json의 port(기본 41720) 사용 |
| `external_address` | `CLAUDE_PLUGIN_OPTION_EXTERNAL_ADDRESS` | `external-address` | `null` | 설정 시 로컬 서버 대신 이 주소의 외부 memory server에 연결. 로컬 자동 스폰 생략 |
| `policy_priority` | `CLAUDE_PLUGIN_OPTION_POLICY_PRIORITY` | `policy-priority` | `null` | ponytail 활성 시 보정 DB와 충돌하면 우선할 쪽 (`calibration` \| `ponytail`). 미결정(null)이면 첫 충돌 시 사용자에게 질문 |

## 고정 강도 정책(ponytail) 공존

SessionStart hook이 `enabledPlugins`에서 ponytail 활성 여부를 감지하고, `policy-priority` 상태에 따라 컨텍스트에 한 줄을 주입한다:

- **미결정(null)**: 이번 세션에서 작업 강도 판단이 처음 충돌하면(ponytail은 생략을 권하는데 보정 DB는 반대, 또는 그 역) `AskUserQuestion`으로 어느 쪽을 우선할지 묻는다. 답을 프로젝트 `.claude/nunchi.json`의 `policy-priority`에 `"calibration"` 또는 `"ponytail"`로 저장하고 사용자에게 저장 사실을 한 줄로 알린다. **충돌이 없으면 묻지 않는다.**
- **`calibration`**: 충돌 시 보정 DB가 우선. '벌주는 것' 항목은 항상 지킨다.
- **`ponytail`**: 충돌 시 최소화 규칙이 우선. 단 신뢰도 높음(3+)의 '벌주는 것' 항목은 실제 사고 기록이므로 예외로 지킨다. 생략이 사고로 이어지면 반전 규칙대로 기록한다 — 사용자 결정도 보정 기록 축적을 멈추지 않는다.

## 하지 말 것

- 보정 DB에 코드 스타일 가이드, TODO, 아키텍처 문서를 넣지 않는다 (그건 CLAUDE.md 와 docs 의 몫이다). 이 저장소는 오직 **작업 강도 판단**만 다룬다.
- 사용자 확인 없이 "벌주는 것" 항목을 삭제하지 않는다.
- 예측 어긋남이 없는데 억지로 기록을 만들지 않는다. 빈 구간이 정상이다.
