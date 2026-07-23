# 이벤트 저널 내장형 메모리 아키텍처 (v0.13)

> 참고 모델: [memory-forest](https://github.com/hyungchulc/memory-forest) — canonical/파생 분리,
> provenance 보존 승격, "index는 지워도 된다" 원칙을 nunchi 규모(프로젝트당 수십~수백 행)에 맞게 압축 적용.

## 목표

1. **Canonical 저널**: 모든 변경을 append-only `events` 테이블에 기록 — 이력 추적·DB 재구축(replay)·내보내기 기반 git/팀 공유.
2. **승격 사다리 3단**: 관찰(observe) → 보정 항목(신뢰도 1~2) → 코어(3+). 확신 없는 어긋남 의심 신호를 부담 없이 기록하고, 반복되면 출처를 보존하며 승격.
3. **트리 연결**: 승격 계보(canonical 단일 부모) + 도메인 계층(area 관례 파싱, 파생) + 자유 참조 링크(비권위 데이터).

비목표: memory-forest식 다층(4층+) 시간 사다리, 파일 트리 canonical화, DB 간 병합(추후 확장 경로만 확보).

## 1. 데이터 모델

`memory.db` 내부를 두 계층으로 나눈다.

**canonical: `events` 테이블 (append-only — UPDATE/DELETE 금지)**

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 전역 순서
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  type       TEXT NOT NULL CHECK (type IN
             ('add','observe','promote','confirm','reverse','edit','remove','link')),
  entry_id   INTEGER NOT NULL,           -- 대상 항목 id
  parent_id  INTEGER,                    -- 승격 계보: 생성된 항목의 canonical 부모
  refs       TEXT NOT NULL DEFAULT '[]', -- 자유 참조 링크 (JSON 배열, 비권위)
  payload    TEXT NOT NULL               -- 이벤트별 데이터 (JSON)
);
```

- 항목 id는 `add`/`observe` 이벤트가 발급한다. `memory` 테이블의 id와 동일 체계.
- `payload` 내용: `add`/`observe` = 전체 필드(section/area/rule/evidence/confidence),
  `edit` = 바뀐 필드만, `confirm` = `{}`, `reverse` = `{evidence}`,
  `promote` = 새 항목 전체 필드 + `sources`(근거 관찰 id 배열), `remove` = `{}`,
  `link` = `{refs}` (추가된 참조 id 배열).

**파생: `memory` 테이블 + FTS5 + 도메인 트리 뷰**

- 전부 `events` replay로 재구축 가능. `memory` 스키마 확장 2건:
  `observe` 섹션 추가(CHECK: `'punish','forgive','env','task','observe'`),
  `promoted_to INTEGER` 컬럼 추가(승격된 관찰이 가리키는 항목 id, 파생 값 — 기본 NULL).
  나머지 컬럼·API 시그니처는 현행 유지.
- 기동 시 무결성 검사: `meta` 테이블(파생 상태 스탬프 = 마지막 반영 seq)과
  `events`의 max(seq) 비교 — 어긋나면 파생 상태를 지우고 replay 재구축.

## 2. 승격 사다리 (관찰 → 항목 → 코어)

- **관찰**: `observe` 이벤트 → `memory`에 `section='observe'`로 파생.
  자동 회수(UserPromptSubmit 검색)와 코어 주입에서 **제외** — 회수 품질 보존.
  `nunchi_search`/`nunchi_list`에서 명시 요청 시에만 조회.
- **승격**: `promote` 이벤트가 새 보정 항목을 만들고 `sources`에 근거 관찰 id를 기록.
  승격된 관찰은 파생 상태에서 `promoted_to`가 채워져 회수·정제 대상에서 영구 제외 (항목이 대표).
- **코어 승격**: 기존 `confirm`(신뢰도 +1) 그대로 — 신뢰도 3+ 도달 이력이 events에 남는다.
- **관찰 retention**: 자동 삭제 없음. `/nunchi` 정제 모드가 30일 경과 또는 60건 초과 미승격
  관찰을 정제 후보로 표시하고, 소멸은 `remove` 이벤트로만.

## 3. 트리 연결 — 간선 3종

| 간선 | 저장 위치 | 권위 | 용도 |
|---|---|---|---|
| 승격 계보 (`parent_id`/`sources`) | events (canonical) | 단일 부모 | 규칙의 출처 사건 추적 |
| 도메인 계층 | 파생 — `area`의 `[도메인: 세부]` 관례 파싱 | 파생 | 영역별 묶음 탐색·대시보드 트리 |
| 자유 참조 (`refs`) | events `link` 이벤트 → 파생 상태에 병합 | 비권위 데이터 | 관련 항목 상호 참조 |

memory-forest 원칙: canonical 트리는 승격 계보 하나. 나머지는 지워도 원본 무손상.

## 4. API·인터페이스 (호환 유지)

- 소켓: 기존 `mem:*` 불변. 관찰 기록은 `mem:add`(section `observe` + 선택적 `parent`)로 통합,
  자유 참조는 `mem:update`의 `link: number[]` 플래그로 통합(confirm/reverse 플래그와 동일 패턴).
  신규 이벤트 — `mem:promote`, `mem:tree`(계보·도메인·참조 조회), `mem:export`(events JSONL 덤프).
- MCP: `nunchi_record`에 `section: "observe"` 허용, `nunchi_update`에 `action: "promote" | "link"` 추가,
  `nunchi_list`/`nunchi_search`에 관찰 포함 옵션. 도구 신설 없음.
- hooks: UserPromptSubmit 변경 없음(관찰 제외는 store 보장). Stop hook 점검 문구에
  "(C) 확신 없는 어긋남 의심 → 관찰 기록" 추가. SessionStart/SubagentStart 규약 요약에 관찰 레인 한 줄.
- store: `add/update/confirm/reverse/remove` 시그니처 유지 — 내부만 "이벤트 append → 파생 갱신"
  단일 트랜잭션으로 재구성. `observe/promote/link/tree/exportEvents` 신설.

## 5. git·팀 공유 레인

- `mem:export` → events JSONL 전체 덤프(사람이 읽는 텍스트, git 커밋 가능). `doc()` markdown 뷰 유지.
- 복원: 빈 DB에 JSONL replay (온보딩). DB 간 병합은 범위 밖 — append-only 구조상 추후 seq 재부여로 확장 가능.

## 6. 마이그레이션

기동 시 1회, 한 트랜잭션: `events` 테이블이 없으면 생성 후 기존 `memory` 행을
`add` 이벤트로 부트스트랩(현재 상태 = 초기 스냅숏, confidence 포함 — 이력은 이 시점부터).
기존 0.8.x→0.9.x 마이그레이션 체인 뒤에 연결. 실패 시 롤백으로 기존 동작 무손상.

## 7. 테스트

- store: append→파생 일치, replay 동등성(재구축 DB = 원본 DB), 관찰 회수 제외,
  promote 계보 무결성, link/refs 병합, 마이그레이션 부트스트랩.
- 소켓: 신규 4 이벤트 라운드트립, 구버전 페이로드 하위 호환.
- hooks: Stop 점검 문구 (C) 항목 렌더링.
