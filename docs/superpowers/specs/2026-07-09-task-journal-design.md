# 작업 기록 (task journal) 설계 — memory 테이블 section 확장

- 날짜: 2026-07-09
- 상태: 설계 확정 (사용자 승인 후 구현 대기)
- 구현 대상 브랜치: dev
- 이 문서는 새 세션이 사전 대화 없이 구현할 수 있도록 결정 이력·전 접점·초안 문구를 포함한다.

## 1. 배경과 목표

nunchi는 현재 **예측과 실제가 어긋난 순간만** 보정 DB에 기록한다 (SKILL.md: "예측대로 흘러간 평범한 작업은 기록하지 않는다"). 사용자 요청은 여기에 새 축을 추가하는 것이다:

> 한 작업을 마무리했을 때 메모리에 기록하고, 이후 유사한 작업을 할 때 개선토록 하고 싶다. 유사 작업 완료 시 기존 기억에 문제가 있다면 수정하고, 새로운 작업이라면 새로 기록한다. 스킬이 특정 작업을 문서로 기록해 쓰는 것이라면, 이 기능은 **모든 작업**을 기록하게끔 동작해야 한다.

즉 **작업 완주 자체를 플레이북으로 축적**하고, 유사 작업 재수행 시 회수해 접근 절차·주의점을 재사용하며, 실제와 어긋난 플레이북은 그 자리에서 교정한다.

### 성공 기준

1. 완결된 작업이 끝나면 (모델 재량 + Stop hook 보완으로) task 항목이 기록·갱신된다.
2. 유사 작업 프롬프트에서 UserPromptSubmit이 관련 task 항목을 자동 주입한다 — 보정 항목 회수를 밀어내지 않는다.
3. 플레이북이 틀렸음이 드러나면 해당 항목이 수정(edit)되고, 유효했으면 confirm으로 신뢰도가 오른다.
4. 기존 DB는 자동·멱등 마이그레이션된다. 사용자 개입 없음.

## 2. 결정 이력 (사용자 확정 사항 — 재론하지 않는다)

| 결정 | 선택 | 기각 대안 |
|---|---|---|
| 구현 위치 | **nunchi 플러그인 확장** (이 저장소) | 별도 플러그인 신규 제작, Claude Code 설정만 |
| 기록 트리거 | **모델 재량(1차) + Stop hook 주기 점검(2차 보완)** | Stop hook 단독, 사용자 명시 호출만 |
| 기록 스키마 | **플레이북형** — 작업 유형 + 접근 절차 + 주의점 + 결과 + 재확인 횟수 | 일지형(요약+참조), 자유 서술 |
| 저장 구조 | **접근 A: 기존 `memory` 테이블에 section `'task'` 추가** (최소 diff) | 접근 B: 별도 `task` 테이블 + 전용 도구 |

접근 A의 알려진 트레이드오프(사용자가 인지하고 선택함): 플레이북 4필드를 기존 3필드에 매핑해야 하고, 보정 항목과 검색 경로를 공유한다. 후자는 §7의 **쿼터 분리**로 완화한다.

## 3. 개념 모델

- **보정 항목** (punish/forgive/env): 예측 어긋남만. 반증 가능한 가설 — confirm/reverse 수명 관리. 기존 규약 그대로.
- **작업 기록** (task): 완결된 작업의 플레이북. "어떻게 했고 뭘 조심해야 하는가". reverse 개념 없음(반전할 방향이 없다) — confirm(재수행 무사고 +1)과 edit(절차 교정)만.
- 한 작업에서 둘 다 나올 수 있다. 예: 대시보드 리디자인 완료 → task 기록 + "대비 검증 생략했다 재작업" punish 기록.

### '한 작업'의 정의 (기록 판정 기준)

**기록한다**: 사용자 요청 단위의 완결된 산출물이 남는 작업 — 기능 구현, 버그 수정, 리팩토링, 문서 작성, 설계, 배포/릴리스, 마이그레이션 등.

**기록하지 않는다**: 산출물이 없는 단발 질문/조회/설명, 진행 중(미완결) 작업, 이미 있는 task 항목과 동일 유형의 단순 반복(대신 confirm). — "모든 작업 기록"의 취지는 재사용 가치가 있는 완주 경험의 전수 축적이지, 대화 로그가 아니다.

## 4. 데이터 모델 — 필드 매핑

`memory` 테이블 재사용. section에 `'task'` 추가. 플레이북 필드는 다음과 같이 매핑한다 (SKILL.md 규약으로 고정):

| 플레이북 필드 | DB 필드 | 형식 |
|---|---|---|
| 작업 유형 + 상황 | `area` | `"[작업유형: 짧은 상황 서술]"` — 기존 area 포맷 동일, FTS 매칭 키 |
| 접근 절차 | `rule` | `"접근: {절차 요약}"` |
| 주의점 (함정·재작업 원인) | `rule` (이어서) | `" / 주의: {함정}"` — 주의점이 없으면 생략 가능 |
| 결과 | `evidence` | `"YYYY-MM-DD 결과 1줄"` — 갱신 시 최신 수행 결과로 교체 |
| 재확인 횟수 | `confidence` | 같은 플레이북으로 무사고 재수행한 횟수. confirm +1 |

예:

```
section:   task
area:      [대시보드 UI 리디자인: 통계 타일·필터 추가]
rule:      접근: 디자인 스펙 문서 먼저 → 정적 CSS → JS 바인딩 순 / 주의: 라이트 모드 대비 4.5:1 확인을 마지막에 검수
evidence:  2026-07-09 1차 완료, 대비 수정 1회 재작업
confidence: 2
```

`keywords` 컬럼(보강 모델 유의어)은 기존 mem:add/update 백그라운드 보강 경로가 task에도 자동 적용된다 — 추가 작업 없음.

## 5. 저장 계층 (`memory/store.ts`)

### 5.1 타입·상수

- `MemorySection`(store.ts:8) → `"punish" | "forgive" | "env" | "task"`.
- `SECTION_TITLE`(store.ts:250) 에 `task: "작업 기록"` 추가.
- 헤더 주석(store.ts:2)의 "규약 연산(승격·반전·정제)" 서술에 맞게 반전(reverse)을 store로 이관한다 (§5.4).

### 5.2 DDL 변경 + 기존 DB 마이그레이션 (핵심)

CHECK 제약을 `IN ('punish','forgive','env','task')`로 확장한다. SQLite는 CHECK 변경이 불가하므로 **테이블 재구축**이 필요하다. `applyMemorySchemaInner`에 다음을 추가한다:

1. memory 테이블 DDL 본문을 상수로 추출한다 (`MEMORY_DDL` 등) — 신규 생성과 재구축이 같은 문자열을 쓰도록. CHECK 문자열이 두 곳에 흩어지면 안 된다.
2. 기존 `CREATE TABLE IF NOT EXISTS memory` 직전에 재구축 블록:

```
const ddl = db.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='memory'`).get()
if (ddl && ddl.sql에 "'task'" 부재) {
  CREATE TABLE memory_new ( ...MEMORY_DDL — 새 CHECK... )
  INSERT INTO memory_new (id, section, area, rule, evidence, confidence, keywords, updated_at)
    SELECT id, section, area, rule, evidence, confidence, keywords, updated_at FROM memory
  DROP TABLE memory          -- 트리거 3종(memory_fts_ai/ad/au)도 함께 삭제된다
  ALTER TABLE memory_new RENAME TO memory
}
```

3. 이후 흐름은 기존 그대로: 트리거 3종은 `CREATE TRIGGER IF NOT EXISTS`가 재생성하고, 함수 끝의 `INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`가 FTS를 재동기화한다.

주의사항:

- 전체가 이미 `db.transaction()` 안이므로(store.ts:36-38) 재구축 도중 크래시로 두 테이블이 공존하는 상태는 남지 않는다 — v0.9 마이그레이션과 동일 보장.
- `id`를 보존해야 한다 (주입/조회 결과의 `(#id)`가 갱신 대상 식별자).
- `keywords`, `updated_at`도 보존 — 보강 결과와 stamp 연속성 유지.
- 멱등성: 재구축 후 DDL에 `'task'`가 포함되므로 재기동 시 블록이 건너뛰어진다.
- 순서: 기존 v0.9 kv-memory 제거 블록(key 컬럼 감지) **뒤**, `CREATE TABLE IF NOT EXISTS` **앞**에 둔다. sqlite_master 조회를 kv 블록 **이후에** 수행하면 kv 케이스는 그 시점에 memory 테이블이 이미 DROP되어 조회 결과가 없으므로(ddl = null) 재구축 블록이 자연히 건너뛰어진다 — 별도 오탐 방어가 필요 없다.

### 5.3 검색 — `sections` 배열 필터

`store.search` opts(store.ts:201)의 `section?: MemorySection` (단수)을 `sections?: MemorySection[]`로 교체한다:

- 필터(store.ts:232): `if (opts.sections) out = out.filter((r) => opts.sections.includes(r.section));`
- 내부 호출자 전수: memory/server.ts의 `mem:search` 핸들러 1곳뿐(§6). MCP·훅은 서버 경유라 서버에서 매핑한다.
- `excludeCore`는 보정(punish) 전용 로직이므로 그대로 둔다 — task에는 영향 없음.

### 5.4 반전(reverse)의 store 이관 + task 보호

현재 reverse는 MCP 계층(mcp/server.ts:75-80)에서 `update(id, {section:'punish', confidence:1, evidence})`로 구현되어 있어, (a) store 헤더 주석과 어긋나고 (b) 대상 section을 검증할 수 없다. task 항목에 reverse는 무의미하므로 first-class 연산으로 이관한다:

```ts
/** 반전: forgive 전용 — punish 이동 + 신뢰도 1 리셋 + 근거 교체 */
reverse(id: number, evidence: string): boolean {
  const cur = this.get(id)  // 실제로는 getStmt
  if (!cur) return false
  if (cur.section !== "forgive")
    throw new Error(`reverse는 '용서하는 것'(forgive) 전용 — 대상 항목은 ${cur.section}`)
  return this.update(id, { section: "punish", confidence: 1, evidence })
}
```

env·task·punish 대상 reverse가 모두 명확한 에러로 거부된다 (기존에도 env/punish reverse는 규약 위반이었으나 조용히 통과했다 — 이번에 함께 막는다).

## 6. 서버·클라이언트 프로토콜

### 6.1 `memory/server.ts`

- `mem:search` 핸들러(server.ts:305-313): `section: p.section` 전달을 다음으로 교체 —
  `sections: Array.isArray(p.sections) ? p.sections : p.section ? [p.section] : undefined`
  (구 클라이언트의 단수 `section` 페이로드 하위 호환).
- `mem:update` 핸들러(server.ts:286): 기존 `p.confirm` 분기 패턴과 나란히 `p.reverse` 분기 추가 — `store.reverse(Number(p.id), String(p.evidence))`. evidence 부재 시 에러 (`handle` 래퍼가 에러를 ack로 전달하는 기존 경로 재사용).

### 6.2 `memory/client.ts`

- `MemoryClient.search` opts(client.ts:89-92): `section?: MemorySection` → `sections?: MemorySection[]` (전송은 기존 spread 그대로라 코드 변경은 타입 시그니처뿐).
- `MemoryClient.update` fields(client.ts:87): `{ confirm?: boolean }` → `{ confirm?: boolean; reverse?: boolean }`.

### 6.3 하위 호환 매트릭스

| 조합 | 동작 |
|---|---|
| 신 클라이언트 → 신 서버 | 정상 |
| 구 클라이언트(단수 section) → 신 서버 | 서버가 `[p.section]`으로 매핑 — 정상 |
| 신 클라이언트 → 구 외부 서버 (`external-address`) | `sections` 무시 → 필터 없는 결과 (품질 저하, 오동작 아님). task INSERT는 구 CHECK로 명확히 실패 — 에러가 그대로 도구 응답에 노출되어 서버 업그레이드 필요를 안내. `reverse` 플래그는 구 서버가 무시하고 evidence만 갱신하는 **무해하지 않은 부분 적용**이 가능 — 알려진 제약으로 README의 external-address 항목에 1줄 명시한다 |

## 7. 회수 파이프라인

### 7.1 `hooks/user-prompt-submit.ts` — 이중 쿼터 (핵심 완화책)

모든 작업을 기록하면 task가 보정 항목보다 빠르게 늘어난다. 단일 상위 3건 검색에 섞으면 보정 회수가 밀리므로 **쿼터를 분리**한다. 기존 단일 `mem.search` 호출(user-prompt-submit.ts:21)을 한 연결에서 두 호출로:

```ts
const [cal, tasks] = await Promise.all([
  mem.search(tokens, { limit: 3, excludeCore: true, sections: ["punish", "forgive", "env"] }),
  mem.search(tokens, { limit: 2, sections: ["task"] }),
])
```

출력은 하나의 additionalContext에 두 블록 (어느 한쪽이 0건이면 그 블록 생략, 둘 다 0건이면 기존처럼 출력 없음):

```
[nunchi] 이번 요청 관련 보정 항목:
- (#id) [벌주는 것·신뢰도N] ...
[nunchi] 이번 요청 관련 작업 기록 (유사 작업 플레이북 — 절차가 실제와 다르면 nunchi_update로 교정할 것):
- (#id) [작업 기록·신뢰도N] ...
```

쿼터 3+2는 고정값 — 설정화하지 않는다 (비범위 §15).

### 7.2 `hooks/config.ts`

- `SECTION_LABEL`에 `task: "작업 기록"` 추가. `formatMemoryEntries`는 무수정으로 task를 렌더링한다.

### 7.3 SessionStart / SubagentStart 규약 요약

`hooks/session-start.ts:44-45`의 요약 줄들에 다음 1줄 추가 (subagent-start.ts의 동일 요약에도):

> "작업 기록 규약: 완결된 작업(산출물이 남는 요청 단위)을 마무리하면 nunchi_search로 유사 task 항목을 찾아 — 절차가 어긋났으면 nunchi_update(edit)로 교정, 그대로 유효했으면 nunchi_update(confirm), 없으면 nunchi_record(section: task)로 신규 기록한다."

SessionStart의 코어 주입(punish 신뢰도 3+)은 **변경 없음** — task는 상시 주입 대상이 아니다 (검색 회수 전용).

### 7.4 Stop hook (`hooks/stop-check.ts`)

카운트·stamp 비교 로직은 무수정 — task 기록도 같은 테이블의 `updated_at`을 갱신하므로, task를 기록한 구간은 기존 로직이 자동으로 점검을 생략한다. `reason` 문구만 교체:

> `[nunchi] 주기 점검(${CHECK_EVERY}턴): (A) 이번 구간에 예측과 실제가 어긋난 경우가 있었는가? (1) 과잉 대응 (2) 과소 대응 (3) 환경 특이사항 — 있었다면 nunchi_record(신규) 또는 nunchi_update(confirm/reverse). (B) 이번 구간에 완결된 작업이 있는가? — 있다면 유사 task 항목을 검색해 edit(절차 교정)/confirm(재확인), 없으면 nunchi_record(section: task)로 기록. 둘 다 없었다면 "보정·작업 특이사항 없음" 한 줄만 답하고 종료할 것.`

## 8. MCP 도구 (`mcp/server.ts`)

신규 도구 없음. 기존 4종 수정:

- **section enum**(mcp/server.ts:28-30): `["punish","forgive","env","task"]`, describe에 `task=작업 기록(완결 작업 플레이북)` 추가.
- **nunchi_record** description에 추가: "완결된 작업의 플레이북은 section: task로 기록한다 — area='[작업유형: 상황]', rule='접근: 절차 / 주의: 함정', evidence='YYYY-MM-DD 결과 1줄'. 유사 task 항목이 이미 있으면 record 대신 nunchi_update(edit 교정 / confirm 재확인)."
- **nunchi_update**: reverse 경로를 `m.update(id, { reverse: true, evidence: f.evidence })`로 교체 (§5.4 서버 검증 경유). description에 "reverse는 보정(forgive) 전용 — task 항목에는 사용 불가" 추가.
- **nunchi_search / nunchi_list**: inputSchema 무수정 (단수 `section` 파라미터가 task 값을 자동 수용). description에 task 검색 용례 1구절 추가.

## 9. SKILL.md 변경

1. **frontmatter description**: 트리거 열거에 "작업을 마무리해 기록/갱신이 필요할 때, 유사 작업의 플레이북(작업 기록)을 회수할 때" 추가.
2. **"저장소와 회수"**: section 열거에 task 추가, UserPromptSubmit 주입이 보정 3건 + 작업 기록 2건임을 반영.
3. **신설 섹션 "작업 기록 (task) — 완결 작업 플레이북"** (기록 절차 섹션 뒤에 배치). 초안 전문:

```markdown
## 작업 기록 (task) — 완결 작업 플레이북

보정 항목이 "예측 어긋남"만 남긴다면, 작업 기록은 **완결된 작업 자체**를 플레이북으로 남긴다 —
유사 작업 재수행 시 접근 절차와 주의점을 재사용하고, 어긋난 플레이북은 그 자리에서 교정한다.

- 포맷: area `"[작업유형: 짧은 상황 서술]"` / rule `"접근: {절차 요약} / 주의: {함정}"` /
  evidence `"YYYY-MM-DD 결과 1줄"` / confidence = 무사고 재수행 횟수.
- **기록 시점**: 한 작업(산출물이 남는 사용자 요청 단위 — 구현·수정·리팩토링·문서·설계·릴리스)을
  마무리하면 즉시:
  1. `nunchi_search`로 유사 task 항목 검색 (유의어·한/영 확장 쿼리 2-5개)
  2. 있음 + 절차·주의점이 이번 실제와 어긋남 → `nunchi_update(edit)`로 rule 교정 + evidence 교체
  3. 있음 + 그대로 유효했음 → `nunchi_update(confirm)` (+1, 날짜 갱신)
  4. 없음 → `nunchi_record(section: task)` 신규
  5. 한 줄 고지: `[nunchi] 작업 기록: {유형 요약}`
- **기록하지 않는다**: 산출물 없는 단발 질문·조회, 미완결 작업, 동일 유형 단순 반복(→ confirm).
- 보정 항목과 독립이다: 같은 작업에서 task 기록과 예측 어긋남 기록이 함께 나올 수 있다.
- `reverse`는 task에 쓰지 않는다 (보정 forgive 전용 — 서버가 거부한다). 플레이북이 틀렸으면 edit다.
```

4. **정제 섹션**: "task 항목도 동일 기준으로 정제한다 — 유사 작업유형 통합(신뢰도 최댓값 유지), 신뢰도 1로 6주 미갱신 삭제. 60건 초과 기준은 전체 항목 수(보정+task 합산)" 추가.
5. **"하지 말 것"**: "산출물 없는 대화·조회를 task로 기록하지 않는다" 추가.

## 10. 대시보드 (`memory/dashboard/`)

기존 3섹션 패턴 그대로 1종 추가:

- `index.html`: task 통계 타일 (`data-sec="task"`, `n-task`), 필터 select `<option value="task">`, 편집 폼 select option.
- `style.css`: `--sec-task` 색 1종 추가 — 기존 팔레트 주석(dataviz 검증) 규칙 준수: 텍스트에 쓰지 않는 마크 색, 라이트·다크 각각 지정. 값 선정 시 dataviz 스킬의 팔레트 검증을 통과할 것.
- 인라인 스크립트: 타일 카운트(`n("task")`), 코어 판정(`isCore`)은 punish 전용이라 무수정.

## 11. doc() 내보내기 (`renderMemoryDoc`, store.ts:298-312)

- 섹션 루프(store.ts:303)에 `"task"` 추가, `SECTION_TITLE.task = "작업 기록"`.
- `parseLegacyDoc`은 무수정 — 구버전 calibration.md에 task 섹션은 존재하지 않는다.

## 12. README

- 항목 포맷·동작 섹션에 task 요약 반영 (기록 대상 표의 "의도적으로 좁음" 서술도 task 축 추가로 갱신).
- external-address 알려진 제약 1줄 (§6.3).

## 13. 엣지 케이스 정리

- **구 CHECK DB에 task INSERT**: 재구축 마이그레이션(§5.2)이 서버 기동 시 선행되므로 발생하지 않는다. 예외는 구버전 **외부** 서버뿐 — 명확한 CHECK 에러로 표면화.
- **stamp 연속성**: 재구축이 `updated_at`을 보존하므로 Stop hook 기준선이 흔들리지 않는다.
- **FTS 정합**: DROP TABLE로 트리거가 사라진 사이의 변경은 없고(같은 트랜잭션), 마지막 rebuild가 전체 재색인한다.
- **excludeCore와 task**: core 정의(punish AND 3+)에 task가 걸리지 않아 상호 간섭 없음.
- **보강(keywords) 경로**: mem:add/update 공통 훅이라 task에도 자동 적용 — 표현이 달라도 회수된다.

## 14. 테스트 계획 (기존 파일별)

- `tests/store.test.ts`
  - 구 DDL(CHECK 3종)로 만든 DB에 `applyMemorySchema` → task INSERT 성공, 기존 행의 id·keywords·updated_at 보존, 재적용 멱등.
  - `search(sections: ["task"])` / `(["punish","forgive","env"])` 필터 동작.
  - `reverse`: forgive → punish·신뢰도1·근거 교체. punish/env/task 대상 → throw.
- `tests/store-socket.test.ts` (또는 client.test.ts): `mem:search`의 `sections` 배열·단수 `section` 하위 호환, `mem:update { reverse: true }` 왕복, evidence 누락 에러.
- `tests/mcp.test.ts`: `nunchi_record(section: task)` 성공, task 대상 `nunchi_update(reverse)`가 isError로 거부 메시지 반환.
- `tests/hooks.test.ts`: user-prompt-submit이 보정·task 두 블록을 각 쿼터로 출력, 한쪽 0건 시 해당 블록 생략. stop-check reason에 작업 점검(B) 문구 포함.
- doc(): task 항목 포함 DB에서 "## 작업 기록" 섹션 렌더링.

## 15. 비범위 (이번 릴리스에서 하지 않는다)

- 별도 task 테이블·전용 MCP 도구 (접근 B — 기각됨. 승격 조건: task 필드가 3필드 매핑으로 감당 불가하게 늘어나거나 쿼터 분리로도 보정 회수 간섭이 관측될 때)
- task 상시(코어) 주입 — 검색 회수로 충분
- 쿼터(3+2)·점검 주기의 설정화
- Codex 브랜치(`codex-support`) 반영 — 후속 작업
- 대시보드의 task 전용 뷰·통계 고도화

## 16. 릴리스 메모

- 새 기능이므로 **minor 범프** 대상. 단 버전 결정 시 보정 항목 #6 준수: 마지막 main 릴리스 이후 dev 전체 델타(`git log <last-merge>..dev`)를 확인하고 결정한다 — 이번 세션 변경만 보고 판단하지 않는다.
- MCP 서버 version 문자열(mcp/server.ts:32, 현재 "0.9.0")도 함께 갱신.
