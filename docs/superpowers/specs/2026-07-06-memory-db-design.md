# nunchi v0.8.0 — 보정 DB 전환 설계 (전문 주입 → 검색 회수)

- 날짜: 2026-07-06
- 상태: 사용자 승인됨 (구현 전)
- 대상 브랜치: main (Codex 지원은 codex-support 브랜치 별도 — 이번 범위 아님)

## 목표

calibration.md 전문을 SessionStart에 통째로 주입하는 현행 구조를 폐기하고:

1. **DB 단일 소스** — 항목을 memory.db의 전용 테이블에 행 단위로 저장. 120줄/9,000자 상한 제거.
2. **이벤트별 검색 회수** — SessionStart/UserPromptSubmit/SubagentStart 훅이 관련 항목만 자동 주입.
3. **모델 재량 시맨틱 검색** — MCP 도구로 모델이 직접 확장 쿼리 검색·전량 선별을 수행.

## 결정 사항 (브레인스토밍 합의)

| 쟁점 | 결정 |
|---|---|
| 데이터 소스 | DB 단일 소스. calibration.md는 임포트 원본·내보내기 뷰로만 |
| 기록 경로 | MCP 서버 (파일 Edit 폐기) |
| 상시 주입 코어 | 규약 요약 + '벌주는 것' 고신뢰(3+) 항목 |
| 회수 방식 | 훅 자동 검색-주입(RAG) + 모델 재량 검색(MCP 도구) 병행 |
| 검색 엔진 | 훅: FTS5(trigram, BM25) + 키워드 보강 (접근안 A). 시맨틱 계층은 모델이 수행 — 임베딩 API·sqlite-vec 미도입, 업그레이드 경로만 예약 |
| 오프라인 조건 | 평가 기준에서 제외 (사용자 지시) |

모델은 임베딩 벡터를 계산할 수 없으므로, 벡터 검색이 제공하는 시맨틱 매칭을 두 방법으로 대체한다:

- **방법 1 — 쿼리 확장**: 모델이 유의어·한/영 쿼리 2-5개를 생성해 `nunchi_search`에 배열로 전달, 서버는 FTS OR-병합.
- **방법 2 — 전량 선별**: 항목 전체가 몇 KB 규모이므로 `nunchi_list`로 모두 읽고 인컨텍스트에서 선별 (recall 100%).

| 계층 | 엔진 | 시맨틱 능력 | 비용 |
|---|---|---|---|
| 훅 자동 주입 (매 메시지) | FTS5 + 키워드 보강 | 어휘 수준 | 로컬 <1ms, 모델 개입 0 |
| `nunchi_search` (모델 재량) | 모델 쿼리 확장 → FTS OR-병합 | 유의어·패러프레이즈 | 도구 호출 1회 |
| `nunchi_list` (모델 재량) | 모델 전량 읽기·선별 | 완전 | 항목 전체 몇 KB |

## 1. 데이터 모델

`memory.db`에 전용 테이블 추가. 기존 `memory` key/value 테이블과 `mem:set/get/search`는 변경 없음 (기존 MCP 소비자 호환).

```sql
CREATE TABLE calibration (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section    TEXT NOT NULL CHECK (section IN ('punish','forgive','env')),
             -- punish=벌주는 것, forgive=용서하는 것, env=환경 특이사항
  area       TEXT NOT NULL,      -- "[영역: 짧은 상황 서술]"
  rule       TEXT NOT NULL,      -- 무엇을 한다 / 생략해도 된다
  evidence   TEXT NOT NULL,      -- "YYYY-MM-DD 실제 사건 1줄"
  confidence INTEGER NOT NULL DEFAULT 1,  -- 낮음(1)/중간(2)/높음(3+) = 무사고 관측 횟수
  keywords   TEXT NOT NULL DEFAULT '',    -- 키워드 보강 (기존 enrich 파이프라인 재사용)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- FTS5(trigram) 인덱스: `area, rule, evidence, keywords` — 기존 `memory_fts`와 동일 패턴 (INSERT/DELETE/UPDATE 트리거 + 기동 시 rebuild 자가치유).
- SKILL.md 규약 연산의 SQL 대응:
  - 신뢰도 승격 = `UPDATE confidence = confidence + 1, updated_at = now`
  - 반전 규칙 = `UPDATE section = 'punish', confidence = 1, evidence = <새 사건>`
  - 정제 삭제 = `DELETE`
- **시맨틱 업그레이드 예약**: 추후 `ALTER TABLE calibration ADD COLUMN embedding BLOB` 한 줄로 확장 가능. 검색은 소켓 이벤트 뒤에 있어 엔진 교체가 클라이언트에 보이지 않는다.

## 2. 소켓 API (memory/server.ts 확장)

| 이벤트 | 페이로드 | 역할 |
|---|---|---|
| `mem:add` | `{section, area, rule, evidence}` | 항목 추가. `model` 설정 시 비동기 키워드 보강 |
| `mem:update` | `{id, section?, area?, rule?, evidence?, confidence?}` | 부분 업데이트 — 승격·반전·수정 |
| `mem:remove` | `{id}` | 정제용 삭제 |
| `mem:search` | `{queries: string[], section?, limit?, excludeCore?}` | 다중 쿼리 OR-병합: 각 쿼리를 FTS5 검색, id 중복 제거, BM25 최고 랭크 순 정렬. 3글자 미만 쿼리는 기존 규칙대로 LIKE 폴백. `excludeCore: true`면 코어(`punish AND confidence >= 3`)를 서버가 결과에서 제외 |
| `mem:list` | `{section?, minConfidence?}` | 전량/필터 조회 |
| `mem:core` | — | 상시 주입 대상: `section='punish' AND confidence >= 3` |
| `mem:stamp` | — | `max(updated_at)` — Stop hook 점검용 |
| `mem:doc` | — | 유지하되 DB에서 3섹션 markdown 렌더링으로 변경 (external-address 구버전 클라이언트·내보내기 겸용) |

client.ts의 `MemoryClient` 인터페이스에 대응 메서드 추가 (`add/update/remove/search/list/core/stamp`). 접속·핸드셰이크·스폰 로직은 변경 없음.

## 3. MCP 서버 (mcp/server.ts — 신규)

- stdio MCP. `.claude-plugin/plugin.json`의 `mcpServers`에 등록.
- 내부적으로 `connectMemory()`로 memory server에 접속 — SQLite 단일 소유 유지, 동시 접근 문제 없음.
- 도구 4개:

| 도구 | 입력 | 역할 |
|---|---|---|
| `nunchi_record` | section, area, rule, evidence | 예측 어긋남 신규 기록 (스키마 강제) |
| `nunchi_update` | id, action(`confirm`\|`reverse`\|`edit`\|`remove`), fields? | confirm=신뢰도+1, reverse=반전, edit=수정, remove=삭제 |
| `nunchi_search` | queries[], section?, limit? | 확장 쿼리 검색 — 모델이 유의어·한/영 쿼리 2-5개 생성 |
| `nunchi_list` | section?, minConfidence? | 전량 읽기 + 인컨텍스트 선별 |

- `ProjectMismatchError` 발생 시 도구 에러 메시지로 기존 안내(강제 연결 / `assignFreePort`)를 그대로 전달.

## 4. 훅 4종

| 훅 | 파일 | 동작 |
|---|---|---|
| SessionStart | hooks/session-start.ts (개정) | 전문 주입 제거. ① 규약 요약 + 에스컬레이션 안내("부족하면 `nunchi_search`, 애매하면 `nunchi_list`") ② `mem:core` 결과 주입 ③ 서버 auto-start, ponytail 우선순위 핸드셰이크, external-address 처리(코어를 외부 서버에서 조회, 실패 시 로컬 폴백)는 기존 유지 |
| UserPromptSubmit | hooks/user-prompt-submit.ts (신규) | 프롬프트 토큰화(공백·기호 분리, 2자 이상 어절, 등장 순 최대 8개) → `mem:search(excludeCore: true)` → 상위 3건 additionalContext 주입 (코어는 SessionStart에서 이미 주입됨). 결과 0건이면 출력 없음. 서버 미접속·1.5s 타임아웃 시 조용히 통과 |
| SubagentStart | hooks/subagent-start.ts (신규) | 서브에이전트는 SessionStart 주입을 못 받으므로: 규약 1줄 + `mem:core` + 서브에이전트 프롬프트 기준 `mem:search(excludeCore: true)` 상위 3건 (코어와의 중복 방지) |
| Stop | hooks/stop-check.ts (개정) | mtime 비교 → `mem:stamp` 비교. 주기(기본 10턴, `NUNCHI_CHECK_EVERY`)·`stop_hook_active` 가드·구간 내 기록 시 생략은 그대로. 점검 메시지의 기록 지시를 "calibration.md에 기록" → "`nunchi_record`로 기록"으로 변경. 서버 미접속 시에도 점검 메시지는 내보냄 |

hooks/hooks.json에 UserPromptSubmit·SubagentStart 등록 추가.

## 5. 마이그레이션·하위 호환

- **임포트**: 서버 기동 시 `calibration` 테이블이 비어 있고 `{path}/calibration.md`가 존재하면 파싱해 임포트 후 파일을 `calibration.md.imported`로 리네임 (재임포트 방지 + 원본 보존).
  - 파서: `##` 섹션 헤더 → section 매핑, `###` → area, `- 규칙:`/`- 근거:`/`- 신뢰도:` 3필드. 신뢰도는 괄호 숫자 추출 (`높음(3)` → 3).
  - 파싱 불가 항목은 건너뛰고 stderr 로그 (임포트 전체를 중단하지 않는다).
- **내보내기**: `mem:doc`이 DB에서 기존 3섹션 문서 형식을 렌더링 — external-address로 붙는 구버전 SessionStart 클라이언트가 계속 동작.
- `memory` 테이블·`mem:set/get/search`·프로젝트 검증 핸드셰이크·포트 재할당: 변경 없음.

## 6. 문서 개정

- **SKILL.md**: 기록 절차를 MCP 도구 기준으로 재서술 (`nunchi_record`/`nunchi_update`). 에스컬레이션 규약(주입 → search → list) 추가. 정제 기준 120줄 → 항목 60건 초과. 반전·승격·정제 절차를 도구 호출로 기술. 현행 용어(벌주는 것/용서하는 것/환경 특이사항, 예측 어긋남, 신뢰도, 반전 규칙, 정제) 유지.
- **README**: 동작 절(훅 4종), Memory server 절(cal API·MCP 도구), 구조도, 튜닝 절 갱신. 응용 섹션들(gstack/bkit/superpowers/ponytail)의 "calibration.md 전문 상시 주입" 서술을 "보정 DB + 검색 회수(코어 상시 주입 + 관련 항목 자동 회수)"로 정정.
- **plugin.json**: version 0.8.0, `mcpServers` 등록, userConfig 서술 갱신.

## 7. 테스트

기존 패턴(tests/client.test.ts, tests/search.test.ts) 위에:

- cal CRUD·`mem:search` 다중 쿼리 병합·`mem:core` 필터 — 실서버 기동 통합 테스트
- 마이그레이션 파서 — 정상 문서, 필드 누락 항목, 빈 문서 케이스 단위 테스트
- 훅 스모크 — stdin에 hook JSON을 넣고 stdout(additionalContext / decision:block) 검증

## 범위 밖 (명시적 제외)

- sqlite-vec·임베딩 도입 (스키마·인터페이스에 경로만 예약)
- Codex 브랜치(codex-support) 반영
- 기존 `memory` key/value API의 변경·정리

## 구현 편차 (사용자 승인, 2026-07-06)

- SessionStart/SubagentStart 코어 블록 8,000자 슬라이스 캡 — additionalContext 10,000자 플랫폼 상한 준수 (계획의 MAX_CHARS 삭제 문구보다 우선).
- Stop 훅 recorded 판정은 기준선 `stamp`가 null이면 기록으로 치지 않음 — 과검(false positive) 우선 설계 보장.
- SessionStart external-address 접속 실패 시 로컬 DB 폴백 제거 — 낡은 로컬 데이터 주입 방지, 규약만 주입.
