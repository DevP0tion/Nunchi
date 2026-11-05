# forgive → recommend(권장) 섹션 전환 설계

- 날짜: 2026-11-05
- 대상 버전: 0.14.0 (섹션 의미 확장 = feat → minor)

## 1. 의도

`forgive`(용서하는 것)는 "과잉이었으니 생략해도 된다"는 허락을 기록하는 섹션이다. 사용자 판단: 과잉 사례에도 "용서"라는 말은 맞지 않는다. 섹션을 **`recommend`(권장)**로 바꾸고, 허락이 아니라 **권고**로 의미를 다시 정한다. 동시에 기록 대상을 성공 사례까지 넓힌다.

## 2. 권장 섹션의 정의 (사용자 결정)

권장 항목은 두 종류(`kind`)로 나뉜다.

| kind | 기록 대상 | rule 형태 | 문제가 생겼을 때 |
|---|---|---|---|
| `level` (강도 권고) | 과잉이었음 — 검증·리서치·방어 코드·추상화가 결과적으로 불필요했음 (기존 forgive) | "이 상황에선 이 수준으로 한다" | **반전**: punish로 이동 + 신뢰도 1 + 근거 교체 (기존 reverse와 동일) |
| `method` (방법 기록) | ① 예측보다 결과가 좋았던 접근 ② 사용자가 좋다고 명시한 작업 방식 | "이렇게 한다" | **반전하지 않는다** — `edit`로 수정하거나 `remove`로 삭제 |

- `method`도 "예측 어긋남만 기록" 원칙을 따른다: ①은 예측보다 좋았던 경우만, ②는 사용자의 명시적 만족·선호 표현이 근거다. 예측대로 흘러간 평범한 성공은 기록하지 않는다.
- `method`와 `task`(작업 기록)의 경계: task는 완결 작업 단위의 절차 플레이북(접근/주의), method는 작업 유형을 가로지르는 개별 방식 1개("이렇게 한다")다.

### 코어(상시 주입) 기준 (사용자 결정)

- 기존: `punish AND confidence >= 3`
- 변경: `(punish AND confidence >= 3) OR (recommend AND kind = 'method' AND confidence >= 3)`
- `level`은 신뢰도와 무관하게 코어에 들어가지 않는다 (기존 forgive와 동일).
- (내 판단) method의 신뢰도 = 그 방식을 다시 썼을 때 다시 좋은 결과가 나왔거나 사용자가 다시 만족을 표현한 횟수. 재확인은 기존처럼 `confirm`.

### 2.1 ponytail 우선 모드에서의 method 3+ (사용자 결정)

- `policy-priority: ponytail`이어도 신뢰도 3+ '권장(방법)'은 '벌주는 것' 3+와 함께 **예외로 지킨다** — 즉 코어 전체가 예외다.
- `hooks/session-start.ts`의 ponytail 분기 문구와 SKILL.md·README의 "고정 강도 정책(ponytail) 공존" 절을 이에 맞춘다. 예외의 근거 문구는 "실제 사고 기록이거나 반복 확인된 사용자 선호이므로".
- `nunchi` 우선 분기의 "'벌주는 것' 항목은 항상 지킨다"는 "코어 항목은 항상 지킨다"로 맞춘다 (내 판단 — 결정의 자연스러운 확장).
- SessionStart·SubagentStart의 코어 블록 제목은 두 종류가 섞이므로 "확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다"로 바꾼다. 각 줄의 라벨은 `formatMemoryEntries`가 붙인다(§4.4).

## 3. 목표 / 비목표 / 실패 기준

- 목표: 용어·의미 전환, 기존 데이터 무손실 이관, 구버전 클라이언트 입력의 하위 호환.
- 비목표: 지난 설계·계획 문서(`docs/superpowers/` 아래 기존 파일) 수정 — 당시 기록이므로 그대로 둔다. 별도 섹션 신설(level과 method를 두 섹션으로 나누는 것)은 하지 않는다 — 사용자는 "권장" 하나를 원했다.
- 실패 기준(기술적으로 동작해도 실패): ① 기존 forgive 항목이 이관 후 reverse 불가가 됨 ② events 저널(append-only)을 UPDATE로 고쳐 씀 ③ replay(`rebuildDerived`) 결과가 이관 전 상태와 달라짐 ④ method 항목이 reverse로 punish에 들어감.

## 4. 결정된 구현 방식

### 4.1 데이터 모델 (store.ts)

- `MemorySection`: `"punish" | "recommend" | "env" | "task" | "observe"`.
- `memory` 테이블에 `kind TEXT` 컬럼 추가. CHECK: `kind IS NULL OR kind IN ('level','method')`. recommend 행만 값을 가지며, 그 외 섹션은 NULL.
- CHECK 변경은 기존 패턴대로 **테이블 재구축** 마이그레이션 블록 하나를 추가한다(감지 조건: DDL에 `'recommend'` 미포함). 재구축 INSERT에서 `section = 'forgive'` → `'recommend'`, `kind = 'level'`로 변환하고 id·keywords·updated_at·promoted_to·refs를 보존한다. 기존 블록(task·observe)과 같은 트랜잭션 안에서 실행된다.
- `MEMORY_COLS_DDL`의 CHECK를 갱신하면, 기존 task·observe 재구축 블록이 구 DB를 바로 신 DDL로 재구축할 때 `'forgive'` 값이 CHECK에 걸린다. 따라서 **모든 재구축 INSERT의 SELECT에서 section을 변환**해야 한다 (`CASE section WHEN 'forgive' THEN 'recommend' ELSE section END`, kind도 같은 규칙). 구 calibration 테이블 이관 INSERT도 동일.
- `COLS`·`MemoryEntry`·`NewMemoryEntry`에 `kind` 포함 (`kind?: "level" | "method" | null`). COLS를 쓰지 않고 컬럼을 직접 나열하는 곳에도 모두 넣는다: `ftsStmt`(FTS 검색 SELECT — 빠지면 search 결과에 kind가 없어 excludeCore·라벨이 깨진다), `likeStmt`, `insStmt`, `updStmt`/`applyFields`, `rebuildDerived`의 INSERT, 기존 재구축 블록 INSERT.
- `memory/client.ts`의 항목 타입·주석(코어 기준 설명)도 갱신한다.

### 4.2 events 저널 — 고쳐 쓰지 않고 읽을 때 변환

- events 행은 append-only이므로 기존 `'forgive'` payload를 UPDATE하지 않는다.
- payload를 읽는 단일 정규화 함수 하나를 두고, `rebuildDerived`(replay)와 `exportEvents`(mem:export)가 둘 다 이 함수를 거친다: `section: 'forgive'` → `section: 'recommend'` + `kind: 'level'`(payload에 kind가 없을 때).
- 새 이벤트(add/observe/promote/edit)의 payload에는 `kind`를 기록한다. replay의 add/promote INSERT와 edit의 필드 목록에 `kind`를 추가한다. 부트스트랩 INSERT(events가 비었을 때 memory → add 이벤트)도 kind를 포함한다.
- reverse replay(`UPDATE ... SET section = 'punish'`)는 `kind = NULL`도 함께 설정한다.
- (내 판단) kind 정합성은 **replay가 규칙으로 강제**한다: 각 이벤트 적용 후 "section ≠ recommend면 kind = NULL, recommend인데 kind가 NULL이면 'level'". 옛 edit 이벤트(forgive → punish·env·task 이동, payload에 kind 없음)도 이 규칙으로 재구축 이관 결과와 같아진다(실패 기준 ③). 신규 이벤트는 store가 계산한 최종 kind를 payload에 남긴다.

### 4.3 서버 규칙 (store.ts / memory/server.ts)

- `reverse`: 대상이 `recommend AND kind = 'level'`일 때만 허용. `kind = 'method'`면 "방법 기록은 reverse 대신 edit·remove" 취지의 명확한 에러로 거부. punish·env·task·observe는 기존처럼 거부. 반전 후 `kind = NULL`.
- 코어 판정은 현재 세 곳에 있다: 코어 SQL(`coreStmt`), `search`의 excludeCore 필터, 대시보드 `isCore`(`memory/dashboard/index.html` — 코어 개수·뱃지, 코어 타일 설명 문구 포함). 세 곳 모두 §2의 새 기준으로 바꾼다. `store.ts`의 `CORE_CONFIDENCE` 주석도 갱신.
- `add`/`promote`: section이 recommend면 kind 필수 아님 — 서버 기본값은 `'level'`(구 클라이언트의 forgive 입력이 곧 level이므로). recommend가 아닌데 kind가 오면 무시(NULL 저장).
- `update(edit)`: `kind` 변경 허용(recommend 항목에 한함). (내 판단) kind를 지정하지 않으면 **현재 kind를 유지**한다 — 대시보드 편집기는 저장할 때마다 section을 함께 보내므로, "section 값이 recommend면 level"로 처리하면 method가 조용히 level로 바뀐다. 규칙은 section이 실제로 바뀔 때만 적용: recommend 밖으로 나가면 NULL, 다른 섹션에서 recommend로 들어오는데 kind 미지정이면 `'level'`.
- (내 판단) kind가 바뀌면 신뢰도를 1로 초기화한다 — 신뢰도 5인 level을 method로 바꿔 곧바로 코어에 넣는 경로를 막는다.
- **하위 호환**: 소켓 입력의 `section: 'forgive'`(add·promote·update·search·list의 section/sections)는 서버 진입점에서 `'recommend'`로 매핑한다. 기존 단수 section → sections 매핑과 같은 위치·방식.

### 4.4 MCP 도구 (mcp/server.ts)

- section enum: `forgive` 제거, `recommend` 추가. 설명: "recommend=권장(이렇게 한다 — kind: level=강도 권고(과잉이었음), method=방법 기록(예측보다 좋았던 접근·사용자가 좋다고 한 방식))".
- `nunchi_record`·`nunchi_update(promote/edit)`에 `kind` 파라미터 추가(`level | method`). section이 recommend일 때 **MCP 스키마 수준에서는 필수**로 안내한다(설명 문구) — 모델이 의식적으로 고르게 한다. 서버 기본값(level)은 구 클라이언트용 안전망이다.
- 도구 설명의 기록 분류 갱신: "과잉이었음→recommend(level), 예측보다 좋았음·사용자가 좋다고 함→recommend(method), 과소였음→punish, 환경 특이사항→env".
- reverse 설명: "권장(level)을 따르다 사고 → punish 이동… method는 reverse 대신 edit·remove".

### 4.5 훅·표시 문구

- `hooks/config.ts` `SECTION_LABEL`: `recommend: "권장"`. `formatMemoryEntries`는 recommend 행에 kind를 붙여 `[권장·강도·신뢰도N]` / `[권장·방법·신뢰도N]`로 렌더링한다 (`MemoryEntryLite`에 `kind` 추가).
- `hooks/user-prompt-submit.ts`: 보정 쿼터 sections를 `["punish", "recommend", "env"]`로.
- `hooks/session-start.ts` 규약 문구: "예측과 실제가 어긋나면(과잉/과소/환경 특이사항) nunchi_record" 줄에 새 기록 대상(예측보다 좋았음·사용자가 좋다고 함)을 추가하고, "'용서하는 것'을 따르다 사고가 나면 reverse" → "'권장(강도)'을 따르다 사고가 나면 reverse, '권장(방법)'이 틀렸으면 edit·remove". 코어 블록 제목 변경(§2). ponytail 공존 문구 3줄은 §2.1 결정대로. `hooks/subagent-start.ts`도 동일.
- `hooks/stop-check.ts` 주기 점검 문구: 점검 항목에 새 기록 대상을 추가하고 reverse 안내를 "권장(강도)만 반전"으로.
- 대시보드 편집기: section이 recommend일 때 kind 선택란(강도 권고 / 방법 기록)을 보이고 저장 시 kind를 보낸다.
- `memory/store.ts` 임포트 매핑(`/용서/`)은 `/용서|권장/ → recommend`(kind level), 렌더 라벨 `recommend: "권장 (이렇게 한다)"`, doc 렌더 섹션 순서에 recommend.
- 대시보드(`memory/dashboard/index.html`, `style.css`): 타일·필터 옵션·섹션 목록·CSS 변수와 클래스명을 recommend로 (`--sec-recommend` 등, 색상값은 그대로). 표시 문구 "recommend · 권장".

### 4.6 문서

- `SKILL.md`: 섹션 정의, 기록 판정(1. 과잉이었음 → 권장(level), 신규: 예측보다 좋았음·사용자가 좋다고 함 → 권장(method)), 반전 규칙(level만 반전, method는 edit·remove), 코어 정의, ponytail 공존 문구(코어 정의 변경 반영), "자기강화 방지" 절의 실패 모드 문구를 권장 기준으로 갱신.
- `README.md`: 같은 내용 반영.
- `docs/perf-test-prompts.md`: 현행 테스트 시나리오 문서이므로 forgive 표기를 recommend로 갱신.

## 5. 빌더 재량

- 정규화 함수의 이름·위치, 마이그레이션 블록의 정확한 감지 조건 표현.
- 에러 메시지 문구.
- 대시보드에서 kind를 표시할지(뱃지 등) 여부 — 하지 않아도 된다.
- 테스트 구성: 최소한 ① 구 DB(forgive 행 + forgive payload events) 기동 → recommend/level 이관, replay 결과 동일 ② method reverse 거부·level reverse 허용 ③ 코어에 method 3+ 포함·level 3+ 미포함, excludeCore 동일 판정 ④ 소켓 forgive 입력 하위 호환 ⑤ export가 recommend로 내보냄.

## 6. 릴리스 메모

- 0.14.0으로 범프, `version-update` 스킬 절차(빌드 → dist 포함 커밋 → main → codex-support). codex-support의 README Codex 섹션에 forgive 표기가 있으면 함께 갱신.
- 신 MCP/훅이 구버전 memory server(구 캐시 경로에 살아 있는 서버)에 `recommend`를 보내면 CHECK 위반으로 실패한다 — 절차 7번(구버전 서버 종료)이 이를 해소한다. 별도 대응은 하지 않는다.
