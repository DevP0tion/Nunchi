# forgive → recommend(권장) 섹션 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보정 섹션 `forgive`(용서하는 것)를 `recommend`(권장)로 바꾸고, `kind`(level=강도 권고 / method=방법 기록)로 성공 사례까지 담는다.

**Architecture:** 저장소(`memory/store.ts`)가 스키마·이관·replay 정규화·규약 규칙(반전·코어)을 소유한다. 소켓 서버는 구 입력 `forgive`를 진입점에서 `recommend`로 매핑한다. MCP·훅·대시보드·문서는 새 섹션과 kind를 표시·입력한다.

**Tech Stack:** Bun, bun:sqlite(FTS5 trigram), Socket.IO 4.8.3, @modelcontextprotocol/sdk, zod 3, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-05-recommend-section-design.md`

## Global Constraints

- 섹션 값: `"punish" | "recommend" | "env" | "task" | "observe"`. `forgive`는 저장 값에서 사라지고, 입력 하위 호환으로만 받는다.
- `kind`: `'level' | 'method' | NULL`. recommend 행만 값을 가지며, 그 외 섹션은 항상 NULL. 이관된 forgive 행은 `'level'`.
- 코어: `(section='punish' AND confidence>=3) OR (section='recommend' AND kind='method' AND confidence>=3)`. `CORE_CONFIDENCE = 3` 유지.
- events 테이블은 append-only — 기존 행을 UPDATE하지 않는다. 옛 payload는 읽을 때 정규화한다.
- 표시 라벨: 섹션 `권장`, kind `강도`(level)·`방법`(method). 훅 줄 형식 `[권장·강도·신뢰도N]` / `[권장·방법·신뢰도N]`.
- 한글이 든 파일은 Edit 도구로만 수정한다 (PowerShell Get/Set-Content 왕복은 CP949 파손).
- 커밋 메시지: 타입 접두사만 영문, 제목·본문은 한글. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `tests/dist.test.ts`는 소스가 바뀌면 입력 해시 불일치로 실패한다 — Task 1~6에서는 각 단계에 적힌 테스트 파일만 실행하고, Task 7에서 빌드 후 전체(`bun test`)를 통과시킨다.
- 지난 설계·계획 문서(`docs/superpowers/` 아래 이 계획과 스펙 외 파일)는 수정하지 않는다.

## Review Focus

1. 0.12 이전 DB(observe 없음)에 forgive 행이 있을 때 — task·observe 재구축 블록이 신 DDL로 바로 재구축하므로 그 INSERT에서 변환이 빠지면 CHECK 위반으로 기동 실패. → Task 1 테스트 `0.12 DB + forgive 행 이관`.
2. 대시보드 편집 저장(section=recommend 재전송, kind 미지정)이 method를 level로 바꾸지 않아야 한다. → Task 2 테스트 `update: kind 미지정 시 현재 kind 유지`.
3. 옛 edit 이벤트(forgive → punish 이동, payload에 kind 없음)의 replay 결과 kind가 NULL이어야 한다. → Task 1 테스트 `replay: 옛 forgive 이벤트 정규화`.
4. FTS 경로와 LIKE 경로 모두 search 결과에 kind가 실려 excludeCore가 method 3+를 뺀다. → Task 2 테스트 `search excludeCore: method 3+ 제외 (FTS·LIKE)`.
5. 구 클라이언트가 `sections: ["forgive"]`로 검색하면 recommend 행이 나와야 한다. → Task 3 테스트 `forgive 입력 하위 호환`.

---

### Task 1: 스키마·이관·replay 정규화

**Files:**
- Modify: `memory/store.ts` (타입 1-45, `COLS` 67, `MEMORY_COLS_DDL` 71-82, `applyMemorySchemaInner` 103-210, `rebuildDerived` 215-275, `exportStmt`/`exportEvents`)
- Test: `tests/events.test.ts`

**Interfaces:**
- Produces:
  - `export type MemorySection = "punish" | "recommend" | "env" | "task" | "observe"`
  - `export type MemoryKind = "level" | "method"`
  - `MemoryEntry.kind: MemoryKind | null`, `NewMemoryEntry.kind?: MemoryKind | null`
  - `export function normalizePayload(p: Record<string, unknown>): Record<string, unknown>` — `section === "forgive"`면 `section: "recommend"`, payload에 kind가 없으면 `kind: "level"`. 그 외는 그대로.
  - `export function fixKind(section: MemorySection, kind: MemoryKind | null | undefined): MemoryKind | null` — section≠recommend → null, recommend + 없음 → `"level"`, 그 외 kind 그대로.
  - `exportEvents()`는 각 행 payload를 `normalizePayload`를 거친 JSON 문자열로 반환.

- [ ] **Step 1: 실패 테스트 작성** (`tests/events.test.ts`, 기존 `0.12 DB 마이그레이션` 테스트의 구 DDL 작성 패턴을 따른다)

```ts
test("0.12 DB + forgive 행 이관: recommend/level, id·keywords 보존", () => {
  // 0.12 DDL(observe 없음, CHECK에 'forgive')로 memory 생성 + forgive 행(id 7, keywords 'k') + punish 행
  // createMemoryStore(db) 후:
  expect(s.get(7)?.section).toBe("recommend");
  expect(s.get(7)?.kind).toBe("level");
  expect(s.get(punishId)?.kind).toBe(null);
  // keywords 보존: db.query("SELECT keywords FROM memory WHERE id=7").get().keywords === "k"
});
test("현행 DB(observe 있음) + forgive 행 이관", () => { /* 0.13 DDL로 같은 검증 — 신규 재구축 블록 경로 */ });
test("replay: 옛 forgive 이벤트 정규화 — add는 recommend/level, forgive→punish edit는 kind NULL", () => {
  // events에 직접 INSERT: add {section:'forgive',...} (entry 1), add forgive (entry 2), edit {section:'punish'} (entry 2)
  // rebuildDerived(db) 후:
  expect(s.get(1)).toMatchObject({ section: "recommend", kind: "level" });
  expect(s.get(2)).toMatchObject({ section: "punish", kind: null });
});
test("reverse replay는 kind를 NULL로", () => { /* add forgive + reverse 이벤트 → punish, kind null */ });
test("exportEvents: 옛 forgive payload를 recommend/level로 내보낸다, 원본 events 행은 그대로", () => {
  // JSON.parse(exportEvents()[0].payload).section === "recommend"
  // db.query("SELECT payload FROM events WHERE seq=1").get().payload에 'forgive' 포함
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/events.test.ts` / Expected: 새 테스트 FAIL (`kind` undefined, CHECK 위반 등)

- [ ] **Step 3: 구현** (`memory/store.ts`)
  - DDL: `section ... CHECK (section IN ('punish','recommend','env','task','observe'))`, 새 줄 `kind TEXT CHECK (kind IS NULL OR kind IN ('level','method'))`. `COLS`에 `kind` 추가.
  - 기존 task·observe 재구축 블록과 calibration 이관 INSERT: SELECT의 section을 `CASE section WHEN 'forgive' THEN 'recommend' ELSE section END`로, kind 컬럼을 `CASE section WHEN 'forgive' THEN 'level' END`로 넣는다.
  - 신규 재구축 블록(observe 블록 뒤): 감지 `ddl && !ddl.sql.includes("'recommend'")`. id·section·area·rule·evidence·confidence·keywords·promoted_to·refs·updated_at + kind를 같은 CASE 변환으로 복사.
  - 부트스트랩 INSERT의 `json_object`에 `'kind', kind` 추가.
  - `rebuildDerived`: payload를 `normalizePayload`로 읽고, INSERT에 kind(`fixKind`), edit 필드 목록에 `kind`, 각 add/promote/edit 적용 후 해당 행에 `fixKind` 규칙 적용(`UPDATE memory SET kind = ... WHERE id = ?` — section을 읽어 계산), reverse는 `kind = NULL` 포함.
  - `exportEvents`: `normalizePayload` 적용.

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/events.test.ts tests/store.test.ts` / Expected: PASS. store.test.ts의 기존 `section: "forgive"` 사용처는 이 단계에서 `"recommend"`로 바꾼다(타입 에러·CHECK 위반 해소). reverse 관련 기존 단언은 Task 2에서 다룬다 — 여기서 깨지면 recommend로 바꾼 것만으로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add memory/store.ts tests/events.test.ts tests/store.test.ts
git commit -m "feat(memory): forgive를 recommend로 이관 — kind 컬럼, replay·export 정규화"
```

### Task 2: 규약 규칙 — kind 입력, 반전, 코어

**Files:**
- Modify: `memory/store.ts` (`insStmt`, `applyFields`/`updStmt`, `add`, `update`, `reverse`, `promote`, `coreStmt`/`core`, `search`의 excludeCore, `ftsStmt`·`likeStmt` SELECT, `CORE_CONFIDENCE` 주석, `SECTION_OF`·`SECTION_TITLE`·`renderMemoryDoc` 섹션 순서, 파일 머리 주석)
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: Task 1의 `MemoryKind`, `fixKind`, `MemoryEntry.kind`
- Produces:
  - `export function isCore(e: Pick<MemoryEntry, "section" | "kind" | "confidence">): boolean` — 코어 판정 유일 함수. `core()` SQL은 같은 조건을 SQL로 쓴다(주석으로 `isCore`와 짝임을 명시).
  - `add`/`promote`: `e.kind`를 `fixKind(e.section, e.kind)`로 저장, 이벤트 payload에 최종 kind.
  - `update(id, fields)`: `fields.kind` 허용. kind 미지정이면 section이 실제로 바뀔 때만 `fixKind(새 section, 현재 kind)`, 바뀌지 않으면 현재 kind 유지. kind가 실제로 바뀌면 confidence를 1로. edit 이벤트 payload에 최종 kind(변경됐을 때)·confidence(초기화됐을 때) 포함.
  - `reverse(id, evidence)`: `section === "recommend" && kind === "level"`만 허용. method → `Error("reverse는 권장(강도) 전용 — 방법 기록(method)은 edit·remove로 고친다")`. 그 외 섹션 → `Error(\`reverse는 권장(강도) 전용 — 대상 항목은 ${section}\`)`. 결과 kind NULL.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test("add: recommend kind 기본 level, 비recommend의 kind는 NULL", () => {
  expect(s.get(s.add({ section: "recommend", area: "[a: b]", rule: "r", evidence: "e" }))?.kind).toBe("level");
  expect(s.get(s.add({ section: "recommend", kind: "method", area: "[a: b]", rule: "r", evidence: "e" }))?.kind).toBe("method");
  expect(s.get(s.add({ section: "punish", kind: "method", area: "[a: b]", rule: "r", evidence: "e" }))?.kind).toBe(null);
});
test("update: kind 미지정 시 현재 kind 유지 (대시보드 재저장)", () => {
  // method 항목에 update(id, { section: "recommend", area: "[a: c]" }) → kind "method", confidence 유지
});
test("update: kind 변경 시 신뢰도 1, recommend 밖으로 나가면 kind NULL, 들어오면 level", () => {});
test("reverse: level만 허용, method·punish 거부", () => {
  // level → section punish, kind null, confidence 1
  // method → toThrow("방법 기록(method)은 edit·remove")
  // punish → toThrow("reverse는 권장(강도) 전용")
});
test("core: punish 3+와 method 3+ 포함, level 3+ 미포함", () => {});
test("search excludeCore: method 3+ 제외 (FTS·LIKE)", () => {
  // 3글자 이상 단어(FTS 경로)와 2글자 단어(LIKE 경로) 각각으로 method 3+ 항목이 제외되고 level 3+는 남는다
  // 결과 행에 kind 필드가 실려 있다
});
test("parseLegacyDoc: '용서'·'권장' 제목 모두 recommend", () => {});
test("renderMemoryDoc: recommend 섹션 제목 '권장 (이렇게 한다)'", () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/store.test.ts` / Expected: 새 테스트 FAIL
- [ ] **Step 3: 구현** — Interfaces대로. `SECTION_OF`의 `[/용서/, "forgive"]` → `[/용서|권장/, "recommend"]`, `SECTION_TITLE.recommend = "권장 (이렇게 한다)"`, 렌더 순서 `["punish", "recommend", "env", "task", "observe"]`. 기존 reverse 테스트의 에러 문구 단언을 새 문구로 갱신.
- [ ] **Step 4: 통과 확인** — Run: `bun test tests/store.test.ts tests/events.test.ts tests/search.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(memory): 권장 kind 규칙 — level만 반전, method 3+ 코어 편입`

### Task 3: 소켓 서버·클라이언트 — 하위 호환과 kind 전달

**Files:**
- Modify: `memory/server.ts` (mem:add 226-238, mem:promote 239-252, mem:update 262-287, mem:search 291-302, mem:list 303-311, reverse 주석 269)
- Modify: `memory/client.ts` (항목 타입·`search`/`list`/`add`/`promote`/`update` 시그니처의 section 타입, 코어 주석 101)
- Test: `tests/store-socket.test.ts`

**Interfaces:**
- Consumes: Task 2의 store API
- Produces: `memory/server.ts`의 `const sec = (s: unknown) => s === "forgive" ? "recommend" : s` — mem:add·promote·update의 `section`, mem:search의 `section`/`sections` 각 원소, mem:list의 `section`에 적용. `kind`는 add·promote·update에서 `p.kind`가 `"level" | "method"`면 전달, 그 외 undefined.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test("forgive 입력 하위 호환: add·search(sections·section)·list·update", async () => {
  // mem.add({ section: "forgive" as never, ... }) → get 결과 section "recommend", kind "level"
  // mem.search(["단어"], { sections: ["forgive"] as never }) → 그 행 반환
  // mem.list({ section: "forgive" as never }) → 그 행 반환
});
test("kind 왕복: add method → search 결과 kind method, update kind 변경", async () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/store-socket.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — Interfaces대로. 기존 테스트의 `forgive` 사용처(store-socket.test.ts·client.test.ts)는 `recommend`로 바꾸되, 하위 호환 테스트 1건(`{ section: "forgive" } as never`, 81행)은 의도된 구 입력이므로 유지하고 기대값을 recommend 행으로.
- [ ] **Step 4: 통과 확인** — Run: `bun test tests/store-socket.test.ts tests/client.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(memory): 소켓 forgive 입력을 recommend로 매핑, kind 전달`

### Task 4: MCP 도구

**Files:**
- Modify: `mcp/server.ts` (`section` 41-43, `rule` 설명 47, nunchi_record 51-74, nunchi_update 76-122)
- Test: `tests/mcp.test.ts`

**Interfaces:**
- Consumes: Task 3의 소켓 kind 전달
- Produces: `const kind = z.enum(["level", "method"]).describe("section: recommend일 때 필수로 고른다 — level=강도 권고(과잉이었음: 이 상황에선 이 수준으로 한다), method=방법 기록(예측보다 결과가 좋았던 접근·사용자가 좋다고 한 방식: 이렇게 한다)")`. nunchi_record `kind: kind.optional()`, nunchi_update `kind: kind.optional()`(edit·promote에서 전달).

- [ ] **Step 1: 실패 테스트 작성** — `tests/mcp.test.ts`의 기존 패턴대로: nunchi_record(section recommend, kind method) 후 nunchi_search 결과에 kind method / nunchi_update(reverse)가 method 대상에 isError true / 도구 목록의 section enum에 `forgive` 없음·`recommend` 있음.
- [ ] **Step 2: 실패 확인** — Run: `bun test tests/mcp.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — section enum·설명 교체: `recommend=권장(이렇게 한다 — kind로 강도 권고·방법 기록 구분)`. `rule` 설명 `"무엇을 한다 / 이 수준으로 한다 — 500자 이내"`. record 설명의 분류: `과잉이었음→recommend(kind: level), 예측보다 결과가 좋았음·사용자가 좋다고 함→recommend(kind: method), 과소였음→punish, 환경 특이사항→env`. update 설명의 reverse: `reverse=반전 규칙('권장(강도)'을 따르다 사고 → punish로 이동+신뢰도 1 리셋+근거 교체, evidence 필수, recommend·level 전용 — 방법 기록(method)과 task는 edit·remove)`. 113행 주석 갱신. 기존 mcp.test.ts의 forgive 사용처(64·71·143행)를 갱신 — 71행의 에러 문구 단언은 `toContain("권장(강도) 전용")`으로.
- [ ] **Step 4: 통과 확인** — Run: `bun test tests/mcp.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(mcp): recommend 섹션과 kind 파라미터`

### Task 5: 훅 문구·라벨

**Files:**
- Modify: `hooks/config.ts` (`MemoryEntryLite` 171-178, `SECTION_LABEL` 180-185, `formatMemoryEntries` 187-194)
- Modify: `hooks/session-start.ts` (규약 46행, 코어 블록 제목 52행, ponytail 분기 61-72행)
- Modify: `hooks/subagent-start.ts` (규약 줄, 코어 블록 제목 23행)
- Modify: `hooks/user-prompt-submit.ts:33` (sections)
- Modify: `hooks/stop-check.ts:104` 부근 (주기 점검 문구)
- Test: `tests/hooks.test.ts`, `tests/session-start.test.ts`

**Interfaces:**
- Consumes: Task 3의 항목 `kind`
- Produces: `MemoryEntryLite.kind?: string | null`. `formatMemoryEntries` 라벨: recommend면 `권장·${kind === "method" ? "방법" : "강도"}`, 그 외 `SECTION_LABEL`.

- [ ] **Step 1: 실패 테스트 작성** — hooks.test.ts: recommend method 항목이 주입 출력에 `[권장·방법·신뢰도1]`로, level은 `[권장·강도·신뢰도1]`로 나온다 / session-start.test.ts: method 3+가 코어 블록에 들어가고 블록 제목이 아래 문구와 같다 / ponytail 우선 분기 문구에 "권장(방법)"이 포함된다.
- [ ] **Step 2: 실패 확인** — Run: `bun test tests/hooks.test.ts tests/session-start.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 고정 문구(스펙 §2·§2.1·§4.5):
  - 코어 블록 제목(session-start·subagent-start): `[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]`
  - 규약 46행: `예측과 실제가 어긋나면(과잉/과소/환경 특이사항/예측보다 좋았음) 또는 사용자가 작업 방식을 좋다고 하면 nunchi_record로 기록한다. 기존 항목 재확인은 nunchi_update(action: confirm), '권장(강도)'을 따르다 사고가 나면 nunchi_update(action: reverse)로 즉시 반전하고, '권장(방법)'이 틀렸으면 edit·remove로 고친다.`
  - ponytail `nunchi` 분기: `'벌주는 것' 항목은 항상 지킨다` → `코어 항목('벌주는 것'·'권장(방법)' 3+)은 항상 지킨다`
  - ponytail `ponytail` 분기: `단 신뢰도 높음(3+)의 '벌주는 것' 항목은 실제 사고 기록이므로 예외로 지키고` → `단 코어 항목(신뢰도 높음(3+)의 '벌주는 것'·'권장(방법)')은 실제 사고 기록이거나 반복 확인된 사용자 선호이므로 예외로 지키고`
  - user-prompt-submit sections: `["punish", "recommend", "env"]`
  - stop-check: 점검 항목에 `(4) 예측보다 좋았던 접근·사용자가 좋다고 한 방식(→ 권장·method)`을 추가하고, reverse 안내를 `'권장(강도)'을 따르다 사고 → reverse, '권장(방법)'이 틀렸으면 edit·remove`로.
  - 기존 테스트의 forgive 사용처를 recommend로.
- [ ] **Step 4: 통과 확인** — Run: `bun test tests/hooks.test.ts tests/session-start.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(hooks): 권장 라벨·코어 문구·ponytail 예외 갱신`

### Task 6: 대시보드

**Files:**
- Modify: `memory/dashboard/index.html` (타일 19-27, 코어 타일 설명 41, 필터 옵션 74, 편집기 67-95, `CORE_MIN` 118, `isCore` 147, 통계 198-204, 섹션 목록 221, 편집 열기 257-262, 저장 268-280)
- Modify: `memory/dashboard/style.css` (주석 3, `--sec-forgive` 17·38, 89, `.mark.sec-forgive` 134)
- Test: `tests/web.test.ts`

**Interfaces:**
- Consumes: Task 3의 소켓 kind
- Produces: 편집기 `<select id="f-kind">`(옵션 `level` "강도 권고", `method` "방법 기록") — `#f-section`이 recommend일 때만 보임. 저장 payload에 recommend일 때만 `kind` 포함.

- [ ] **Step 1: 실패 테스트 작성** — web.test.ts에 `readFileSync`로 `memory/dashboard/index.html`·`style.css`를 읽는 새 테스트 1건(기존 테스트는 설정·서빙 검사라 정적 파일 단언이 없다): index.html에 `forgive` 문자열 없음, `data-sec="recommend"`·`id="f-kind"` 존재 / style.css에 `--sec-recommend` 존재·`forgive` 없음 / `isCore`가 `e.kind === "method"` 조건을 포함.
- [ ] **Step 2: 실패 확인** — Run: `bun test tests/web.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 타일 라벨 `recommend · 권장`, 색상값 그대로 변수명만 `--sec-recommend`·`.mark.sec-recommend`. `isCore = (e) => e.confidence >= CORE_MIN && (e.section === "punish" || (e.section === "recommend" && e.kind === "method"))`. 코어 타일 설명 `punish 또는 권장(방법)이면서 신뢰도 3 이상`. 편집 열기 시 `f-kind` 값 = `e?.kind ?? "level"`.
- [ ] **Step 4: 통과 확인** — Run: `bun test tests/web.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(dashboard): 권장 섹션·kind 선택·코어 판정 갱신`

### Task 7: 문서·dist 빌드·전체 검증

**Files:**
- Modify: `SKILL.md` (12, 21, 23, 25, 41-43, 74, 78-80, 113-114행 부근)
- Modify: `README.md` (forgive·용서 13곳)
- Modify: `docs/perf-test-prompts.md` (forgive 6곳)
- Modify: `tests/dist.test.ts` (forgive 1곳)
- Modify: `dist/` (빌드 산출물)

- [ ] **Step 1: SKILL.md 갱신** — 섹션 정의 `recommend=권장(kind: level=강도 권고 / method=방법 기록)`. 항목 포맷에 `kind` 줄. rule `무엇을 한다 / 이 수준으로 한다`. 신뢰도 정의에 method 문장(스펙 §2의 내 판단 문구). 판정: `1. 과잉이었음 → 권장(level)`, 신규 `4. 예측보다 결과가 좋았음 → 권장(method)`, `5. 사용자가 작업 방식을 좋다고 함 → 권장(method)`. 74행 `reverse는 task에 쓰지 않는다 (권장·level 전용)`. 78-80행 실패 모드·반전 규칙을 권장(강도) 기준으로, method는 edit·remove. 코어 정의(14행 자동 주입 설명)와 ponytail 공존 절(113-114)을 Task 5 문구와 같은 의미로.
- [ ] **Step 2: README.md·docs/perf-test-prompts.md·tests/dist.test.ts** — 같은 용어로 치환. 의미가 바뀐 문장(반전·코어 설명)은 SKILL.md와 같은 내용으로.
- [ ] **Step 3: 잔존 확인** — Run: `rg -n "forgive|용서" --glob '!docs/superpowers/**' --glob '!node_modules/**' --glob '!dist/**'` / Expected: 하위 호환 코드(`memory/server.ts`의 매핑, `store.ts`의 `normalizePayload`·재구축 CASE·`/용서|권장/`)와 그 테스트만 남는다.
- [ ] **Step 4: 빌드** — Run: `bun run build` / Expected: 성공, `dist/` 갱신
- [ ] **Step 5: 전체 테스트** — Run: `bun test` / Expected: 전체 PASS (dist.test 포함)
- [ ] **Step 6: 커밋** — `docs: 권장 섹션 규약 반영, dist 재빌드` (`git add SKILL.md README.md docs/perf-test-prompts.md tests/dist.test.ts dist`)

버전 범프(0.14.0)와 main·codex-support 반영은 이 계획 밖이다 — 완료 후 `version-update` 스킬로 진행한다(스펙 §6).
