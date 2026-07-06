---
name: nunchi
description: 작업 강도 보정("적당히") 규약. 프로젝트별 .claude/nunchi/calibration.md 에 예측-실제 불일치(surprise)를 기록하고 재귀 개선한다. 다음 상황에서 반드시 이 스킬을 사용할 것 - 사용자가 "눈치", "적당히", "보정", "캘리브레이션", "calibration"을 언급할 때, 과잉/과소 대응(over/under-engineering) 판단이 필요할 때, calibration.md 의 생성·기록·정제(pruning)가 필요할 때, Stop hook 점검([nunchi] 주기 점검)에 응답할 때, 검증 깊이·테스트 범위·리서치 강도를 어느 수준으로 할지 애매할 때.
---

# nunchi — 작업 강도 보정

"적당히"는 고정 규칙이 아니라 **환경별로 학습되는 다이얼**이다. 어떤 환경은 테스트 생략을 벌주고, 어떤 환경은 과잉 검증이 시간 낭비다. 이 스킬은 그 다이얼의 위치를 프로젝트 경험으로 학습해 `.claude/nunchi/calibration.md` 에 축적하고, 매 세션 시작 시 자동 주입(SessionStart hook)하여 작업 강도 결정의 기준으로 삼는다.

## 문서 위치와 구조

- 위치: `{path 폴더}/calibration.md` (프로젝트별 독립). 기본 `{프로젝트 루트}/.claude/nunchi/calibration.md`. config의 `path`(폴더)로 위치 변경 가능 — 변경 시 SessionStart 주입 메시지에 실제 경로가 명시된다. 폴더는 SessionStart 시 없으면 자동 생성된다.
- 3개 섹션 고정:

```markdown
# Calibration — {프로젝트명}

## 벌주는 것 (반드시 한다)
<!-- 생략했다가 실제로 문제가 발생한 것들 -->

## 용서하는 것 (생략 가능)
<!-- 해봤더니 불필요했던 검증/방어/절차들 -->

## 환경 특이사항
<!-- 이 환경 고유의 동작, 함정, 제약 -->
```

## 엔트리 포맷

```markdown
### [영역: 짧은 상황 서술]
- 규칙: {무엇을 한다 / 생략해도 된다}
- 근거: {YYYY-MM-DD} {실제로 있었던 일 1줄}
- 신뢰도: 낮음(1) | 중간(2) | 높음(3+)
```

- 괄호 숫자 = 규칙을 따라서 무사고였던 관측 횟수. 같은 규칙이 재확인될 때마다 +1 하고 날짜를 갱신한다.
- 근거는 반드시 **실제 사건**이어야 한다. 일반론("보통 테스트는 중요하다")은 기록하지 않는다.

## Surprise 판정 — 기록할 것과 기록하지 않을 것

**기록한다** (예측과 실제의 불일치만):

1. **과잉이었음**: 검증/리서치/방어 코드/추상화를 했는데 결과적으로 불필요했음 → "용서하는 것"에 추가
2. **과소였음**: 생략하거나 가볍게 처리한 것 때문에 실제 문제가 발생했음 → "벌주는 것"에 추가
3. **환경 특이사항**: 문서/상식과 다른 이 환경 고유의 동작을 발견했음 → "환경 특이사항"에 추가

**기록하지 않는다**:

- 예측대로 흘러간 평범한 작업 (신호가 아니라 노이즈다)
- 일회성 오타·단순 실수 (환경의 속성이 아니다)
- 이미 있는 엔트리와 동일한 내용 (대신 해당 엔트리의 신뢰도 +1, 날짜 갱신)

## 기록 절차

1. surprise 인지 시점에 현재 작업 단락을 먼저 마무리한다 (작업 흐름을 끊지 않는다).
2. 단락이 끝나면 즉시 해당 섹션에 엔트리 1개(3줄)를 추가한다. 문서가 없으면 위 구조로 생성한다.
3. 기록 사실을 사용자에게 한 줄로 알린다: `[nunchi] 기록: {규칙 요약}`
4. Stop hook의 `[nunchi] 주기 점검` 메시지를 받으면: 이번 구간의 surprise 유무를 점검하고, 있으면 기록, 없으면 "보정 특이사항 없음" 한 줄로 종료한다.

## 신뢰도와 반전 — 자기강화 방지 (핵심)

이 시스템의 최대 실패 모드는 "용서하는 것"이 반증 기회를 없애며 게으름으로 고착되는 것이다. 다음 규칙으로 방지한다:

- **반전 규칙**: "용서하는 것" 엔트리를 따르다 문제가 발생하면, 즉시 그 엔트리를 "벌주는 것"으로 이동하고 신뢰도를 낮음(1)로 리셋, 근거를 새 사건으로 교체한다. 예외 없음.
- **가설 취급**: 신뢰도 낮음(1) 엔트리는 확정 규칙이 아니라 가설이다. 따르되, 결과가 조금이라도 이상하면 규칙보다 관찰을 우선한다.
- **승격**: 높음(3+)으로 승격된 엔트리만 확정 규칙으로 취급한다.
- **사용자 지시 우선**: 사용자의 명시적 지시는 항상 calibration 규칙보다 우선한다. 충돌 시 지시를 따르고, 반복되는 충돌이면 엔트리를 갱신한다.

## 정제 (pruning) — `/nunchi` 수동 호출 시

문서가 120줄을 초과했거나 사용자가 정제를 요청하면:

1. 동일 영역의 유사 엔트리를 하나로 통합한다 (신뢰도는 합산하지 않고 최댓값 유지).
2. 신뢰도 낮음(1) 상태로 6주 이상 갱신이 없는 엔트리를 삭제한다.
3. 신뢰도 높음(3+) 엔트리는 보존한다. 단 근거 사건이 리팩토링 등으로 무효화되었으면 사용자에게 확인 후 삭제한다.
4. 정제 결과(통합 n건, 삭제 n건)를 사용자에게 보고한다.

## 설정 (config)

우선순위: 프로젝트 `.claude/nunchi.json` > plugin userConfig(환경 변수 `CLAUDE_PLUGIN_OPTION_*`) > 내장 기본값. userConfig는 `.claude-plugin/plugin.json`에 선언되며 Claude Code plugin 설정 UI에서 값을 지정한다. 변경은 plugin 재로드 없이 다음 hook 실행부터 반영된다.

| userConfig 키 | 환경 변수 | nunchi.json 키 | 기본값 | 설명 |
|---|---|---|---|---|
| `auto_start` | `CLAUDE_PLUGIN_OPTION_AUTO_START` | `auto-start` | `true` | `true`면 SessionStart 시 memory server 자동 시작 |
| `path` | `CLAUDE_PLUGIN_OPTION_PATH` | `path` | `.claude/nunchi` | calibration.md가 저장될 폴더 (프로젝트 루트 기준 상대 또는 절대). 초기화 시 없으면 생성 |
| `port` | `CLAUDE_PLUGIN_OPTION_PORT` | `port` | `null` | memory server(Socket.IO) 포트. 미설정 시 memory-config.json의 port(기본 41720) 사용 |
| `external_address` | `CLAUDE_PLUGIN_OPTION_EXTERNAL_ADDRESS` | `external-address` | `null` | 설정 시 로컬 서버 대신 이 주소의 외부 memory server에 연결. 로컬 자동 스폰 생략. SessionStart는 외부 서버의 calibration 문서를 우선 주입 (실패 시 로컬 폴백) |
| `policy_priority` | `CLAUDE_PLUGIN_OPTION_POLICY_PRIORITY` | `policy-priority` | `null` | ponytail 활성 시 calibration과 충돌하면 우선할 쪽 (`calibration` \| `ponytail`). 미결정(null)이면 첫 충돌 시 사용자에게 질문 |

## 고정 강도 정책(ponytail) 공존

SessionStart hook이 `enabledPlugins`에서 ponytail 활성 여부를 감지하고, `policy-priority` 상태에 따라 컨텍스트에 한 줄을 주입한다:

- **미결정(null)**: 이번 세션에서 작업 강도 판단이 처음 충돌하면(ponytail은 생략을 권하는데 calibration은 반대, 또는 그 역) `AskUserQuestion`으로 어느 쪽을 우선할지 묻는다. 답을 프로젝트 `.claude/nunchi.json`의 `policy-priority`에 `"calibration"` 또는 `"ponytail"`로 저장하고 사용자에게 저장 사실을 한 줄로 알린다. **충돌이 없으면 묻지 않는다.**
- **`calibration`**: 충돌 시 calibration 문서가 우선. '벌주는 것' 엔트리는 항상 지킨다.
- **`ponytail`**: 충돌 시 최소화 규칙이 우선. 단 신뢰도 높음(3+)의 '벌주는 것' 엔트리는 실제 사고 기록이므로 예외로 지킨다. 생략이 사고로 이어지면 반전 규칙대로 기록한다 — 사용자 결정도 calibration 축적을 멈추지 않는다.

## 하지 말 것

- calibration.md 에 코드 스타일 가이드, TODO, 아키텍처 문서를 넣지 않는다 (그건 CLAUDE.md 와 docs 의 몫이다). 이 문서는 오직 **작업 강도 다이얼**만 다룬다.
- 사용자 확인 없이 "벌주는 것" 엔트리를 삭제하지 않는다.
- surprise 가 없는데 억지로 기록을 만들지 않는다. 빈 구간이 정상이다.
