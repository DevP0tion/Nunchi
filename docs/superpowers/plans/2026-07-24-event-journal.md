# 이벤트 저널 내장형 메모리 아키텍처 구현 계획 (v0.13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `memory.db`에 append-only `events` 테이블(canonical 저널)을 내장하고, 관찰→항목→코어 승격 사다리와 트리 연결(승격 계보·도메인 계층·자유 참조)을 추가한다.

**Architecture:** 모든 변경 연산이 "이벤트 append → 파생 상태 갱신"의 단일 트랜잭션으로 재구성된다. `memory` 테이블·FTS5는 `events` replay(`rebuildDerived`)로 언제든 재구축 가능한 파생 상태가 된다. 스펙: `docs/superpowers/specs/2026-07-24-event-journal-design.md`.

**Tech Stack:** Bun + bun:sqlite + Socket.IO + MCP SDK (기존 그대로, 신규 의존성 없음)

## Global Constraints

- 기존 소켓 `mem:*` 페이로드·`MemoryClient`·MCP 도구 4종의 하위 호환 유지 (도구 신설 금지)
- `events` 테이블은 append-only — UPDATE/DELETE 금지
- 관찰(observe)은 자동 회수(검색 기본값)·코어 주입에서 제외
- replay 재구축 결과는 원본 파생 상태와 완전 동일해야 함 (이벤트 ts = 행 updated_at 동기화)
- 주석·코드 스타일은 기존 파일 관례(한국어 주석, ponytail 표기)를 따른다
- 각 태스크 완료 시 `bun test` 전체 통과 후 커밋

---

### Task 1: store — v0.13 스키마 (events·meta·observe·promoted_to·refs) + 부트스트랩

**Files:**
- Modify: `memory/store.ts` (스키마 영역: MemorySection, MEMORY_COLS_DDL, applyMemorySchemaInner)
- Test: `tests/events.test.ts` (신규)

**Interfaces:**
- Produces: `MemorySection`에 `"observe"` 추가, `EventType`, `MemoryEvent` 타입, `events`/`meta` 테이블, 부트스트랩 마이그레이션. Task 2+가 이 테이블에 이벤트를 기록한다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/events.test.ts` 생성:

```ts
// bun test tests/events.test.ts
// v0.13 이벤트 저널: 스키마·부트스트랩·이벤트 기록·replay·관찰 레인·승격·참조
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMemorySchema, createMemoryStore } from "../memory/store.ts";

const make = () => {
  const db = new Database(":memory:");
  return { db, s: createMemoryStore(db) };
};
const evs = (db: Database) =>
  db.prepare(`SELECT type, entry_id, parent_id, payload FROM events ORDER BY seq`).all() as
  { type: string; entry_id: number; parent_id: number | null; payload: string }[];

test("0.12 DB 마이그레이션: observe CHECK·promoted_to·refs 컬럼 + add 이벤트 부트스트랩", () => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL CHECK (section IN ('punish','forgive','env','task')),
    area TEXT NOT NULL, rule TEXT NOT NULL, evidence TEXT NOT NULL,
    confidence INTEGER NOT NULL DEFAULT 1, keywords TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')))`);
  db.run(`INSERT INTO memory (section, area, rule, evidence, confidence) VALUES ('punish','[a]','r','e',3)`);
  const s = createMemoryStore(db);
  expect(s.get(1)!.confidence).toBe(3); // 기존 행 보존
  const rows = evs(db);
  expect(rows.length).toBe(1); // 부트스트랩: 기존 행 → add 이벤트
  expect(rows[0].type).toBe("add");
  expect(JSON.parse(rows[0].payload).confidence).toBe(3);
});

test("부트스트랩 멱등: events가 있으면 재기동 시 중복 생성하지 않는다", () => {
  const { db } = make();
  const s = createMemoryStore(db); // 재기동 시뮬레이션 (applyMemorySchema 재실행)
  s.add({ section: "punish", area: "[a]", rule: "r", evidence: "e" });
  applyMemorySchema(db);
  expect(evs(db).length).toBe(1);
});
```

- [ ] **Step 2: 실패 확인** — `bun test tests/events.test.ts` → FAIL (`events` 테이블 없음 / add가 이벤트를 안 남김 — 두 번째 테스트는 Task 2에서 통과, 이 태스크에서는 첫 테스트만 대상)
- [ ] **Step 3: 구현** — `memory/store.ts`:

`MemorySection`·타입 추가:

```ts
export type MemorySection = "punish" | "forgive" | "env" | "task" | "observe";

export type EventType =
  | "add" | "observe" | "promote" | "confirm" | "reverse" | "edit" | "remove" | "link";

/** canonical 저널 행 — append-only. 파생 상태(memory·FTS)는 이걸 replay해 재구축한다 */
export interface MemoryEvent {
  seq: number;
  ts: string;
  type: EventType;
  entry_id: number;
  /** 승격 계보의 canonical 부모 (관찰 기록 시 지정) */
  parent_id: number | null;
  /** 자유 참조 링크 (JSON 배열 문자열, 비권위) */
  refs: string;
  /** 이벤트별 데이터 (JSON) */
  payload: string;
}
```

`MEMORY_COLS_DDL`에 observe·promoted_to·refs 반영:

```ts
const MEMORY_COLS_DDL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('punish','forgive','env','task','observe')),
  area TEXT NOT NULL,
  rule TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 1,
  keywords TEXT NOT NULL DEFAULT '',
  promoted_to INTEGER,
  refs TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
`;

const EVENTS_DDL = `
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  type TEXT NOT NULL CHECK (type IN
    ('add','observe','promote','confirm','reverse','edit','remove','link')),
  entry_id INTEGER NOT NULL,
  parent_id INTEGER,
  refs TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}'
`;
```

`applyMemorySchemaInner`의 task 재구축 블록 뒤(0.9~0.12 DB용, `CREATE TABLE IF NOT EXISTS memory` 앞)에 observe 재구축 삽입:

```ts
  // v0.13 마이그레이션 1/2: observe 섹션 + promoted_to/refs 컬럼 — CHECK 변경 = 테이블 재구축.
  // task 블록과 같은 패턴. task 블록이 이미 신 DDL로 재구축한 경우 'observe'가 포함돼 건너뛴다
  const ddl13 = db
    .query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory'`)
    .get() as { sql: string } | null;
  if (ddl13 && !ddl13.sql.includes("'observe'")) {
    db.run(`CREATE TABLE memory_new (${MEMORY_COLS_DDL})`);
    db.run(`
      INSERT INTO memory_new (id, section, area, rule, evidence, confidence, keywords, updated_at)
      SELECT id, section, area, rule, evidence, confidence, keywords, updated_at FROM memory
    `);
    db.run(`DROP TABLE memory`);
    db.run(`ALTER TABLE memory_new RENAME TO memory`);
  }
```

같은 함수 끝(FTS rebuild 앞)에 events·meta·부트스트랩·드리프트 검사 추가:

```ts
  // v0.13 마이그레이션 2/2: canonical 저널(events) + 파생 반영 스탬프(meta).
  // events가 비어 있으면 기존 memory 행을 add 이벤트로 부트스트랩 — 이력은 이 시점부터 시작
  db.run(`CREATE TABLE IF NOT EXISTS events (${EVENTS_DDL})`);
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const hasEvents = db.query(`SELECT 1 AS x FROM events LIMIT 1`).get();
  if (!hasEvents) {
    db.run(`
      INSERT INTO events (ts, type, entry_id, payload)
      SELECT updated_at,
             CASE WHEN section = 'observe' THEN 'observe' ELSE 'add' END,
             id,
             json_object('section', section, 'area', area, 'rule', rule,
                         'evidence', evidence, 'confidence', confidence)
      FROM memory ORDER BY id
    `);
  }
  // 드리프트 검사: 외부 도구가 이벤트만 추가(파생 미반영)한 경우 replay로 자가 치유.
  // 스탬프가 아예 없으면(부트스트랩 직후) 현재 상태가 곧 파생 결과 — 스탬프만 기록
  const maxSeq = (db.query(`SELECT COALESCE(max(seq), 0) AS m FROM events`).get() as { m: number }).m;
  const applied = db.query(`SELECT value FROM meta WHERE key = 'applied_seq'`).get() as
    | { value: string }
    | null;
  if (applied === null) {
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`, [String(maxSeq)]);
  } else if (Number(applied.value) !== maxSeq) {
    rebuildDerived(db);
  }
```

`rebuildDerived`는 Task 3에서 구현 — 이 태스크에서는 임시 스텁을 두지 말고 Task 3까지 한 커밋으로 가지 않도록, 이 시점에는 다음 최소 구현을 추가한다 (Task 3에서 완성):

```ts
/** 파생 상태(memory·FTS)를 events replay로 재구축 — Task 3에서 이벤트 타입별 적용 완성 */
export function rebuildDerived(db: Database): void {
  // v0.13 Task 1 시점: 드리프트 시 스탬프만 재동기화 (replay는 Task 3)
  const max = (db.query(`SELECT COALESCE(max(seq), 0) AS m FROM events`).get() as { m: number }).m;
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`, [String(max)]);
}
```

- [ ] **Step 4: 통과 확인** — `bun test tests/events.test.ts` → 첫 테스트 PASS (두 번째는 Task 2 대상 — `test.todo`가 아닌 실제 실패로 남기지 말고 Task 2 완료까지 주석 처리 대신 **Task 2에서 추가**한다. 이 태스크에서는 첫 테스트만 파일에 넣는다)
- [ ] **Step 5: 전체 테스트** — `bun test` → 기존 테스트 전부 PASS (스키마 확장은 하위 호환)
- [ ] **Step 6: 커밋** — `git add memory/store.ts tests/events.test.ts && git commit -m "feat(store): v0.13 스키마 — events 저널·meta·observe 섹션·promoted_to/refs + 부트스트랩"`

---

### Task 2: store — 변경 연산의 이벤트 기록화

**Files:**
- Modify: `memory/store.ts` (createMemoryStore 내부: add/update/confirm/reverse/remove)
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: Task 1의 events·meta 테이블
- Produces: `add(e: NewMemoryEntry & { parent?: number })` (관찰 canonical 부모), 모든 변경 연산이 이벤트를 남김. `logEvent`는 내부 헬퍼(비공개).

- [ ] **Step 1: 실패 테스트 추가** — `tests/events.test.ts`에:

```ts
test("이벤트 기록: add/edit/confirm/reverse/remove가 events에 남는다", () => {
  const { db, s } = make();
  const f = s.add({ section: "forgive", area: "[a]", rule: "r", evidence: "e" });
  s.update(f, { rule: "r2" });
  s.confirm(f);
  s.reverse(f, "2026-07-24 사고");
  const p = s.add({ section: "punish", area: "[b]", rule: "r", evidence: "e" });
  s.remove(p);
  expect(evs(db).map((e) => e.type)).toEqual(["add", "edit", "confirm", "reverse", "add", "remove"]);
  expect(JSON.parse(evs(db)[1].payload)).toEqual({ rule: "r2" }); // edit payload는 바뀐 필드만
  expect(JSON.parse(evs(db)[3].payload)).toEqual({ evidence: "2026-07-24 사고" });
});

test("observe 기록: 이벤트 타입 observe + parent_id 계보", () => {
  const { db, s } = make();
  const a = s.add({ section: "punish", area: "[a]", rule: "r", evidence: "e" });
  const o = s.add({ section: "observe", area: "[a: 의심]", rule: "r", evidence: "e", parent: a });
  const rows = evs(db);
  expect(rows[1].type).toBe("observe");
  expect(rows[1].parent_id).toBe(a);
  expect(() => s.add({ section: "observe", area: "[x]", rule: "r", evidence: "e", parent: 9999 })).toThrow();
  void o;
});

test("이벤트 ts는 행 updated_at과 동일 (replay 동등성의 전제)", () => {
  const { db, s } = make();
  const id = s.add({ section: "env", area: "[a]", rule: "r", evidence: "e" });
  const row = db.query(`SELECT updated_at FROM memory WHERE id = ?`).get(id) as { updated_at: string };
  const ev = db.query(`SELECT ts FROM events WHERE entry_id = ?`).get(id) as { ts: string };
  expect(ev.ts).toBe(row.updated_at);
});
```

(Task 1 Step 1의 "부트스트랩 멱등" 테스트도 이 시점부터 통과 대상)

- [ ] **Step 2: 실패 확인** — `bun test tests/events.test.ts` → 신규 3개 FAIL
- [ ] **Step 3: 구현** — `createMemoryStore` 내부. prepared statement 추가:

```ts
  const evStmt = db.prepare(
    `INSERT INTO events (ts, type, entry_id, parent_id, refs, payload)
     VALUES (COALESCE(?, strftime('%Y-%m-%d %H:%M:%f','now')), ?, ?, ?, ?, ?) RETURNING seq`
  );
  const metaStmt = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`);
  const rowTsStmt = db.prepare(`SELECT updated_at FROM memory WHERE id = ?`);
  /** canonical 이벤트 기록 + 반영 스탬프. 변경 연산과 같은 트랜잭션 안에서 호출한다.
   *  ts는 행 updated_at과 동기화 — replay가 원본과 동일한 updated_at을 재현하기 위함 */
  const logEvent = (
    type: EventType,
    entryId: number,
    payload: Record<string, unknown>,
    parentId: number | null = null,
    refs: number[] = []
  ) => {
    const ts =
      (rowTsStmt.get(entryId) as { updated_at: string } | null)?.updated_at ?? null;
    const { seq } = evStmt.get(
      ts, type, entryId, parentId, JSON.stringify(refs), JSON.stringify(payload)
    ) as { seq: number };
    metaStmt.run(String(seq));
  };
```

`getStmt`를 `SELECT ${COLS}, keywords, promoted_to, refs FROM memory WHERE id = ?`로 확장하고 내부 행 타입을 도입:

```ts
  type Row = MemoryEntry & { keywords: string; promoted_to: number | null; refs: string };
  const strip = ({ keywords: _k, promoted_to: _p, refs: _r, ...e }: Row): MemoryEntry => e;
```

`get()`은 `strip` 사용. 기존 `update` 본문을 이벤트 없는 내부 헬퍼로 추출:

```ts
  /** 파생 상태 필드 갱신 (이벤트 기록 없음) — update/reverse가 공유.
   *  내용(area/rule/evidence) 변경 시 keywords를 비운다 (보강이 다시 채움) */
  const applyFields = (cur: Row, fields: Partial<NewMemoryEntry>): void => {
    const next = {
      section: fields.section ?? cur.section,
      area: fields.area ?? cur.area,
      rule: fields.rule ?? cur.rule,
      evidence: fields.evidence ?? cur.evidence,
      confidence: fields.confidence ?? cur.confidence,
    };
    const contentChanged =
      next.area !== cur.area || next.rule !== cur.rule || next.evidence !== cur.evidence;
    updStmt.run(next.section, next.area, next.rule, next.evidence, next.confidence,
      contentChanged ? "" : cur.keywords, cur.id);
  };
```

변경 연산 재구성 (전부 `db.transaction(...)()` 래핑):

```ts
    add(e: NewMemoryEntry & { parent?: number }): number {
      return db.transaction(() => {
        if (e.parent != null && !getStmt.get(e.parent))
          throw new Error(`parent #${e.parent} 없음`);
        const id = (insStmt.get(e.section, e.area, e.rule, e.evidence, e.confidence ?? 1) as { id: number }).id;
        logEvent(e.section === "observe" ? "observe" : "add", id, {
          section: e.section, area: e.area, rule: e.rule,
          evidence: e.evidence, confidence: e.confidence ?? 1,
        }, e.parent ?? null);
        return id;
      })();
    },
    update(id: number, fields: Partial<NewMemoryEntry>): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        // payload는 실제 지정된 필드만 — replay가 부분 갱신을 그대로 재현한다
        const clean = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        ) as Partial<NewMemoryEntry>;
        applyFields(cur, clean);
        logEvent("edit", id, clean);
        return true;
      })();
    },
    confirm(id: number): boolean {
      return db.transaction(() => {
        if (confirmStmt.run(id).changes === 0) return false;
        logEvent("confirm", id, {});
        return true;
      })();
    },
    reverse(id: number, evidence: string): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        if (cur.section !== "forgive")
          throw new Error(`reverse는 '용서하는 것'(forgive) 전용 — 대상 항목은 ${cur.section}`);
        applyFields(cur, { section: "punish", confidence: 1, evidence });
        logEvent("reverse", id, { evidence });
        return true;
      })();
    },
    remove(id: number): boolean {
      return db.transaction(() => {
        if (delStmt.run(id).changes === 0) return false;
        logEvent("remove", id, {});
        return true;
      })();
    },
```

주의: `remove`는 행 삭제 후 `rowTsStmt`가 null → 이벤트 ts는 현재 시각 기본값 (의도된 동작).

- [ ] **Step 4: 통과 확인** — `bun test tests/events.test.ts` → PASS
- [ ] **Step 5: 전체 테스트** — `bun test` → PASS (기존 store/socket/mcp 시그니처 불변)
- [ ] **Step 6: 커밋** — `git commit -am "feat(store): 변경 연산 이벤트화 — add/edit/confirm/reverse/remove가 events에 기록"`

---

### Task 3: store — replay 재구축(rebuildDerived) 완성 + 드리프트 자가 치유

**Files:**
- Modify: `memory/store.ts` (rebuildDerived)
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: Task 2의 이벤트 기록 (ts = updated_at 동기화)
- Produces: `rebuildDerived(db: Database): void` — 완전한 replay. Task 5의 promote/link 이벤트 적용 케이스는 이 태스크에서 미리 구현한다 (스위치 케이스 선반영 — Task 5 테스트가 검증).

- [ ] **Step 1: 실패 테스트 추가**:

```ts
import { rebuildDerived } from "../memory/store.ts"; // 상단 import에 추가

test("replay 재구축: 파생 상태 드리프트를 events에서 완전 복원", () => {
  const { db, s } = make();
  const f = s.add({ section: "forgive", area: "[a]", rule: "r", evidence: "e" });
  s.confirm(f);
  s.update(f, { rule: "r2" });
  const x = s.add({ section: "task", area: "[t]", rule: "r", evidence: "e" });
  s.remove(x);
  const before = JSON.stringify(s.list({ withObserve: true }));
  db.run(`DELETE FROM memory WHERE id = ?`, [f]); // 파생 드리프트 시뮬레이션
  rebuildDerived(db);
  expect(JSON.stringify(s.list({ withObserve: true }))).toBe(before);
  expect(s.get(f)!.confidence).toBe(2);
  expect(s.get(f)!.rule).toBe("r2");
});

test("기동 드리프트 검사: applied_seq 불일치 시 자동 재구축", () => {
  const { db, s } = make();
  const id = s.add({ section: "punish", area: "[a]", rule: "r", evidence: "e" });
  // 외부 도구가 이벤트만 추가(파생 미반영)한 상황
  db.run(`INSERT INTO events (type, entry_id, payload) VALUES ('confirm', ?, '{}')`, [id]);
  applyMemorySchema(db);
  expect(s.get(id)!.confidence).toBe(2);
});

test("replay는 keywords(파생 보강)를 보존한다", () => {
  const { db, s } = make();
  const id = s.add({ section: "env", area: "[a]", rule: "r", evidence: "e" });
  const ts = (db.query(`SELECT updated_at FROM memory WHERE id = ?`).get(id) as { updated_at: string }).updated_at;
  s.setKeywords(id, ts, "동의어, synonym");
  rebuildDerived(db);
  expect((db.query(`SELECT keywords FROM memory WHERE id = ?`).get(id) as { keywords: string }).keywords)
    .toBe("동의어, synonym");
});
```

주의: `list({ withObserve: true })`는 Task 4에서 추가되는 옵션 — 이 태스크 시점에는 `s.list({})`로 작성했다가 Task 4에서 함께 바꾸면 재작업이 생기므로, **Task 3~4를 연속 실행**하고 이 테스트는 Task 4 완료 후 최종 형태로 통과시킨다. Task 3 단독 검증은 `s.list({})` 기준으로 한다.

- [ ] **Step 2: 실패 확인** — `bun test tests/events.test.ts` → 신규 3개 FAIL
- [ ] **Step 3: 구현** — Task 1의 스텁을 완전한 replay로 교체:

```ts
/** 파생 상태(memory·FTS)를 events replay로 재구축한다.
 *  keywords는 파생 보강이라 이벤트에 없다 — 재구축 전 스냅숏을 떠 id 기준으로 복원.
 *  이벤트 ts가 행 updated_at으로 재현되므로 결과는 원본 파생 상태와 완전 동일하다 */
export function rebuildDerived(db: Database): void {
  db.transaction(() => {
    const kw = db.prepare(`SELECT id, keywords FROM memory WHERE keywords != ''`).all() as
      { id: number; keywords: string }[];
    db.run(`DELETE FROM memory`);
    const ins = db.prepare(
      `INSERT INTO memory (id, section, area, rule, evidence, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const events = db.prepare(`SELECT * FROM events ORDER BY seq`).all() as MemoryEvent[];
    for (const ev of events) {
      const p = JSON.parse(ev.payload) as Record<string, unknown>;
      switch (ev.type) {
        case "add":
        case "observe":
        case "promote":
          ins.run(ev.entry_id, p.section as string, p.area as string, p.rule as string,
            p.evidence as string, (p.confidence as number) ?? 1, ev.ts);
          if (ev.type === "promote")
            for (const sid of (p.sources as number[]) ?? [])
              db.run(`UPDATE memory SET promoted_to = ? WHERE id = ?`, [ev.entry_id, sid]);
          break;
        case "edit": {
          const sets: string[] = [];
          const args: (string | number)[] = [];
          for (const k of ["section", "area", "rule", "evidence", "confidence"] as const)
            if (p[k] !== undefined) { sets.push(`${k} = ?`); args.push(p[k] as string | number); }
          db.run(`UPDATE memory SET ${sets.concat("updated_at = ?").join(", ")} WHERE id = ?`,
            [...args, ev.ts, ev.entry_id]);
          break;
        }
        case "confirm":
          db.run(`UPDATE memory SET confidence = confidence + 1, updated_at = ? WHERE id = ?`,
            [ev.ts, ev.entry_id]);
          break;
        case "reverse":
          db.run(`UPDATE memory SET section = 'punish', confidence = 1, evidence = ?, updated_at = ? WHERE id = ?`,
            [p.evidence as string, ev.ts, ev.entry_id]);
          break;
        case "remove":
          db.run(`DELETE FROM memory WHERE id = ?`, [ev.entry_id]);
          break;
        case "link": {
          const row = db.query(`SELECT refs FROM memory WHERE id = ?`).get(ev.entry_id) as
            { refs: string } | null;
          if (!row) break;
          const merged = [
            ...new Set([...(JSON.parse(row.refs) as number[]), ...((p.refs as number[]) ?? [])]),
          ];
          db.run(`UPDATE memory SET refs = ? WHERE id = ?`, [JSON.stringify(merged), ev.entry_id]);
          break;
        }
      }
    }
    const restore = db.prepare(`UPDATE memory SET keywords = ? WHERE id = ?`);
    for (const k of kw) restore.run(k.keywords, k.id);
    db.run(`INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`);
    const max = (db.query(`SELECT COALESCE(max(seq), 0) AS m FROM events`).get() as { m: number }).m;
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`, [String(max)]);
  })();
}
```

주의: `DELETE FROM memory`·재INSERT가 FTS 트리거를 타지만 마지막 `'rebuild'`가 정합성을 보장한다. keywords 복원은 replay 결과 내용이 스냅숏 시점과 동일하므로 유효하다.

- [ ] **Step 4: 통과 확인** — `bun test tests/events.test.ts` (드리프트·keywords 테스트 PASS, replay 테스트는 `list({})` 기준)
- [ ] **Step 5: 커밋** — `git commit -am "feat(store): rebuildDerived — events replay로 파생 상태 완전 재구축 + 기동 드리프트 자가 치유"`

---

### Task 4: store — 관찰 레인 회수 제외 (search/list/doc)

**Files:**
- Modify: `memory/store.ts` (search/list/SECTION_TITLE/renderMemoryDoc)
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: Task 1의 observe 섹션
- Produces: `list(opts: { section?; minConfidence?; withObserve?: boolean })`, search 기본값 observe 제외. 훅(UserPromptSubmit·SubagentStart)은 이미 명시 sections를 전달하므로 변경 불필요.

- [ ] **Step 1: 실패 테스트 추가**:

```ts
test("관찰 레인: 기본 회수(search/list)·코어에서 제외, 명시 요청 시 조회", () => {
  const { s } = make();
  const o = s.add({ section: "observe", area: "[검증: 과잉 의심]", rule: "검증 과잉이었을 수도", evidence: "2026-07-24 의심", confidence: 3 });
  s.add({ section: "punish", area: "[검증: 확정]", rule: "검증 생략 금지", evidence: "2026-07-24", confidence: 3 });
  expect(s.search(["검증"]).map((e) => e.section)).not.toContain("observe");
  expect(s.search(["검증"], { sections: ["observe"] }).map((e) => e.id)).toEqual([o]);
  expect(s.list({}).map((e) => e.section)).not.toContain("observe");
  expect(s.list({ section: "observe" }).length).toBe(1);
  expect(s.list({ withObserve: true }).length).toBe(2);
  expect(s.core().map((e) => e.section)).not.toContain("observe"); // core는 punish 전용 — 확인용
});
```

- [ ] **Step 2: 실패 확인** — `bun test tests/events.test.ts` → FAIL
- [ ] **Step 3: 구현**:

`search()`의 sections 필터 분기 교체:

```ts
      // 관찰(observe)은 명시 요청 시에만 — 자동 회수(훅)와 기본 검색을 오염시키지 않는다
      if (opts.sections) out = out.filter((r) => opts.sections!.includes(r.section));
      else out = out.filter((r) => r.section !== "observe");
```

`list()` 시그니처·WHERE 확장:

```ts
    list(opts: { section?: MemorySection; minConfidence?: number; withObserve?: boolean } = {}): MemoryEntry[] {
      // ponytail: 필터 3개뿐이라 동적 WHERE — 쿼리 빌더 불필요
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (opts.section) { where.push("section = ?"); args.push(opts.section); }
      else if (!opts.withObserve) where.push("section != 'observe'");
      if (opts.minConfidence) { where.push("confidence >= ?"); args.push(opts.minConfidence); }
```

`SECTION_TITLE`에 `observe: "관찰 (미승격 신호)"` 추가, `renderMemoryDoc`의 섹션 루프를 `["punish", "forgive", "env", "task", "observe"]`로, `renderMemoryDoc` 내부 `store.list({})`를 `store.list({ withObserve: true })`로 변경.

- [ ] **Step 4: 통과 확인** — Task 3의 replay 테스트도 `withObserve` 최종 형태로 정리 후 `bun test tests/events.test.ts` → PASS
- [ ] **Step 5: 전체 테스트** — `bun test` → PASS
- [ ] **Step 6: 커밋** — `git commit -am "feat(store): 관찰(observe) 레인 — 기본 회수·코어 제외, 명시 조회·문서 뷰 포함"`

---

### Task 5: store — promote / link / tree / exportEvents

**Files:**
- Modify: `memory/store.ts`
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: Task 2의 logEvent·Row·strip, Task 3의 replay(promote/link 케이스 선반영됨)
- Produces:

```ts
export interface MemoryTree {
  entry: MemoryEntry;
  parent: MemoryEntry | null;      // 관찰 기록 시 지정한 canonical 부모
  sources: MemoryEntry[];          // 이 항목으로 승격된 관찰들
  promotedTo: MemoryEntry | null;  // 이 관찰이 승격된 항목
  domain: string | null;           // area "[도메인: …]"의 도메인
  siblings: MemoryEntry[];         // 같은 도메인 항목 (observe 제외, 최대 10)
  refs: MemoryEntry[];             // 자유 참조
}
// store 메서드
promote(sources: number[], e: NewMemoryEntry): number
link(id: number, refIds: number[]): boolean
tree(id: number): MemoryTree | null
exportEvents(): MemoryEvent[]
```

- [ ] **Step 1: 실패 테스트 추가**:

```ts
test("promote: 관찰 → 항목 승격, 계보 보존, 잘못된 대상 거부", () => {
  const { s } = make();
  const o1 = s.add({ section: "observe", area: "[ship: 과잉 의심]", rule: "PR 과잉?", evidence: "2026-07-20" });
  const o2 = s.add({ section: "observe", area: "[ship: 과잉 의심]", rule: "PR 과잉 재발", evidence: "2026-07-24" });
  const id = s.promote([o1, o2], { section: "forgive", area: "[ship: 배포 절차]", rule: "PR 단계 생략 가능", evidence: "2026-07-24 반복 관찰" });
  expect(s.tree(id)!.sources.map((e) => e.id).sort()).toEqual([o1, o2]);
  expect(s.tree(o1)!.promotedTo?.id).toBe(id);
  expect(() => s.promote([o1], { section: "punish", area: "[x]", rule: "r", evidence: "e" })).toThrow(); // 이미 승격됨
  const p = s.add({ section: "punish", area: "[y]", rule: "r", evidence: "e" });
  expect(() => s.promote([p], { section: "punish", area: "[x]", rule: "r", evidence: "e" })).toThrow(); // 관찰 아님
  const o3 = s.add({ section: "observe", area: "[z]", rule: "r", evidence: "e" });
  expect(() => s.promote([o3], { section: "observe", area: "[x]", rule: "r", evidence: "e" })).toThrow(); // observe로 승격 불가
  expect(() => s.promote([], { section: "punish", area: "[x]", rule: "r", evidence: "e" })).toThrow(); // 빈 sources
});

test("tree: 도메인 형제·자유 참조·canonical 부모", () => {
  const { s } = make();
  const a = s.add({ section: "forgive", area: "[ship: 배포 절차]", rule: "r", evidence: "e" });
  const b = s.add({ section: "punish", area: "[ship: 테스트 게이트]", rule: "r", evidence: "e" });
  const c = s.add({ section: "env", area: "[윈도우: 인코딩]", rule: "r", evidence: "e" });
  const o = s.add({ section: "observe", area: "[ship: 의심]", rule: "r", evidence: "e", parent: a });
  const t = s.tree(a)!;
  expect(t.domain).toBe("ship");
  expect(t.siblings.map((e) => e.id)).toEqual([b]); // observe·타 도메인 제외
  expect(s.tree(o)!.parent?.id).toBe(a);
  expect(s.link(a, [c])).toBe(true);
  expect(s.tree(a)!.refs.map((e) => e.id)).toEqual([c]);
  expect(s.link(a, [c, c])).toBe(true); // 중복은 병합
  expect(s.tree(a)!.refs.length).toBe(1);
  expect(() => s.link(a, [9999])).toThrow(); // 없는 참조 대상
  expect(() => s.link(a, [a])).toThrow();    // 자기 참조만 남으면 거부
  expect(s.tree(9999)).toBe(null);
});

test("replay: promote/link 이벤트 재현 + exportEvents 전량 반환", () => {
  const { db, s } = make();
  const o = s.add({ section: "observe", area: "[a: 의심]", rule: "r", evidence: "e" });
  const pr = s.promote([o], { section: "punish", area: "[a: 확정]", rule: "r", evidence: "2026-07-24", confidence: 3 });
  const f = s.add({ section: "forgive", area: "[b]", rule: "r", evidence: "e" });
  s.link(f, [pr]);
  const before = JSON.stringify(s.list({ withObserve: true }));
  rebuildDerived(db);
  expect(JSON.stringify(s.list({ withObserve: true }))).toBe(before);
  expect(s.tree(o)!.promotedTo?.id).toBe(pr);
  expect(s.tree(f)!.refs.map((e) => e.id)).toEqual([pr]);
  expect(s.core().map((e) => e.id)).toEqual([pr]);
  expect(s.exportEvents().map((e) => e.type)).toEqual(["observe", "promote", "add", "link"]);
});
```

- [ ] **Step 2: 실패 확인** — `bun test tests/events.test.ts` → FAIL
- [ ] **Step 3: 구현** — `MemoryTree` 인터페이스(위 Produces 그대로) export, prepared statement 추가:

```ts
  const promoteMark = db.prepare(`UPDATE memory SET promoted_to = ? WHERE id = ?`);
  const linkStmt = db.prepare(`UPDATE memory SET refs = ? WHERE id = ?`);
  const sourcesStmt = db.prepare(`SELECT ${COLS} FROM memory WHERE promoted_to = ? ORDER BY id`);
  const parentEvStmt = db.prepare(
    `SELECT parent_id FROM events WHERE entry_id = ? AND type IN ('add','observe')
     ORDER BY seq DESC LIMIT 1`
  );
  const allStmt = db.prepare(
    `SELECT ${COLS} FROM memory WHERE id != ? AND section != 'observe' ORDER BY updated_at DESC`
  );
  const exportStmt = db.prepare(
    `SELECT seq, ts, type, entry_id, parent_id, refs, payload FROM events ORDER BY seq`
  );
  /** area "[도메인: …]" → 도메인. 관례 밖 표기는 null */
  const domainOf = (area: string): string | null =>
    /^\[([^:\]]+)/.exec(area)?.[1]?.trim() ?? null;
```

store 반환 객체에 메서드 추가:

```ts
    /** 관찰들 → 보정 항목 승격. 출처는 promote 이벤트의 sources와 관찰의 promoted_to로 보존 */
    promote(sources: number[], e: NewMemoryEntry): number {
      if (!sources.length) throw new Error("promote에는 근거 관찰 id가 1개 이상 필요하다");
      if (e.section === "observe") throw new Error("승격 결과 섹션은 observe가 될 수 없다");
      return db.transaction(() => {
        for (const sid of sources) {
          const cur = getStmt.get(sid) as Row | null;
          if (!cur) throw new Error(`관찰 #${sid} 없음`);
          if (cur.section !== "observe") throw new Error(`#${sid}는 관찰(observe)이 아니다 (${cur.section})`);
          if (cur.promoted_to != null) throw new Error(`#${sid}는 이미 #${cur.promoted_to}로 승격됨`);
        }
        const id = (insStmt.get(e.section, e.area, e.rule, e.evidence, e.confidence ?? 1) as { id: number }).id;
        for (const sid of sources) promoteMark.run(id, sid);
        logEvent("promote", id, {
          section: e.section, area: e.area, rule: e.rule,
          evidence: e.evidence, confidence: e.confidence ?? 1, sources,
        });
        return id;
      })();
    },
    /** 자유 참조 링크 병합 (비권위 — 지워도 canonical 훼손 없음) */
    link(id: number, refIds: number[]): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        const clean = [...new Set(refIds.filter((r) => r !== id))];
        if (!clean.length) throw new Error("link에는 자신이 아닌 참조 id가 1개 이상 필요하다");
        for (const r of clean) if (!getStmt.get(r)) throw new Error(`참조 대상 #${r} 없음`);
        const merged = [...new Set([...(JSON.parse(cur.refs) as number[]), ...clean])];
        linkStmt.run(JSON.stringify(merged), id);
        logEvent("link", id, { refs: clean }, null, clean);
        return true;
      })();
    },
    /** 항목의 관계 트리: 승격 계보(canonical) + 도메인 형제(파생) + 자유 참조(비권위) */
    tree(id: number): MemoryTree | null {
      const row = getStmt.get(id) as Row | null;
      if (!row) return null;
      const byId = (i: number | null | undefined): MemoryEntry | null => {
        if (i == null) return null;
        const r = getStmt.get(i) as Row | null;
        return r ? strip(r) : null;
      };
      const parentRow = parentEvStmt.get(id) as { parent_id: number | null } | null;
      const domain = domainOf(row.area);
      // ponytail: 수백 행 규모 — 도메인 형제는 JS 필터로 충분, 인덱스 불필요
      const siblings = domain
        ? (allStmt.all(id) as MemoryEntry[]).filter((e) => domainOf(e.area) === domain).slice(0, 10)
        : [];
      const refs = (JSON.parse(row.refs) as number[])
        .map(byId).filter((e): e is MemoryEntry => e !== null);
      return {
        entry: strip(row),
        parent: byId(parentRow?.parent_id),
        sources: sourcesStmt.all(id) as MemoryEntry[],
        promotedTo: byId(row.promoted_to),
        domain,
        siblings,
        refs,
      };
    },
    /** canonical 저널 전량 — JSONL 내보내기·감사용 */
    exportEvents(): MemoryEvent[] {
      return exportStmt.all() as MemoryEvent[];
    },
```

- [ ] **Step 4: 통과 확인** — `bun test tests/events.test.ts` → PASS, `bun test` 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(store): promote/link/tree/exportEvents — 승격 사다리·트리 연결·저널 내보내기"`

---

### Task 6: 소켓 API + 클라이언트 (mem:promote / mem:tree / mem:export / link 플래그 / add parent)

**Files:**
- Modify: `memory/server.ts` (핸들러·summarize), `memory/client.ts` (MemoryClient)
- Test: `tests/store-socket.test.ts`

**Interfaces:**
- Consumes: Task 5의 store 메서드
- Produces: 소켓 `mem:promote {section,area,rule,evidence,confidence?,sources:number[]} → {id}`, `mem:tree {id} → {tree}`, `mem:export → {count, jsonl}`, `mem:update`에 `link: number[]` 플래그, `mem:add`에 `parent` 필드. 클라이언트:

```ts
add(e: NewMemoryEntry & { parent?: number }): Promise<number>
promote(sources: number[], e: NewMemoryEntry): Promise<number>
link(id: number, refs: number[]): Promise<boolean>
tree(id: number): Promise<MemoryTree | null>
exportEvents(): Promise<{ count: number; jsonl: string }>
```

- [ ] **Step 1: 실패 테스트 추가** — `tests/store-socket.test.ts`에:

```ts
test(
  "v0.13 왕복 — observe/promote/tree/link/export",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-ev-"));
    await assignFreePort(A);
    const mem = await connectMemory(A);
    try {
      const o1 = await mem.add({ section: "observe", area: "[ship: 의심]", rule: "PR 과잉 의심", evidence: "2026-07-20" });
      const o2 = await mem.add({ section: "observe", area: "[ship: 의심]", rule: "PR 과잉 재발", evidence: "2026-07-24" });
      // 관찰은 기본 회수·목록에서 제외
      expect((await mem.search(["의심"])).length).toBe(0);
      expect((await mem.list({})).length).toBe(0);
      expect((await mem.list({ section: "observe" })).length).toBe(2);
      const id = await mem.promote([o1, o2], {
        section: "forgive", area: "[ship: 배포 절차]", rule: "PR 단계 생략 가능", evidence: "2026-07-24 반복 관찰",
      });
      const t = (await mem.tree(id))!;
      expect(t.sources.map((e) => e.id).sort()).toEqual([o1, o2]);
      expect((await mem.tree(o1))!.promotedTo?.id).toBe(id);
      const env = await mem.add({ section: "env", area: "[윈도우: 인코딩]", rule: "BOM 주의", evidence: "2026-07-24 e" });
      expect(await mem.link(id, [env])).toBe(true);
      expect((await mem.tree(id))!.refs.map((e) => e.id)).toEqual([env]);
      const ex = await mem.exportEvents();
      expect(ex.count).toBe(5); // observe×2 + promote + add + link
      expect(ex.jsonl.split("\n").length).toBe(5);
      // 잘못된 promote는 소켓 에러로 전달
      await expect(mem.promote([o1], { section: "punish", area: "[x]", rule: "r", evidence: "e" })).rejects.toThrow();
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);
```

- [ ] **Step 2: 실패 확인** — `bun test tests/store-socket.test.ts` → 신규 테스트 FAIL
- [ ] **Step 3: 서버 구현** — `memory/server.ts`:

`mem:add` 핸들러에 parent 전달·observe 보강 제외:

```ts
    socket.on("mem:add", (p, ack) =>
      handle(`mem:add [${p.area}]`, () => {
        const id = store.add({
          section: p.section, area: String(p.area), rule: String(p.rule),
          evidence: String(p.evidence),
          confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : undefined,
          parent: Number.isFinite(p.parent) ? Number(p.parent) : undefined,
        } as NewMemoryEntry & { parent?: number });
        // 관찰은 자동 회수 제외 대상 — 보강 비용을 쓰지 않는다 (승격 시 promote가 보강)
        if (model && p.section !== "observe") void enrich(id);
        return { id };
      })(ack)
    );
```

`mem:update`에 link 분기 (confirm 분기 다음):

```ts
        if (Array.isArray(p.link))
          return { updated: store.link(id, p.link.map(Number)) };
```

(핸들 라벨도 `p.confirm ? " confirm" : p.reverse ? " reverse" : Array.isArray(p.link) ? " link" : ""`로 갱신)

신규 핸들러 3종 (`mem:list`는 `withObserve: Boolean(p?.withObserve)` 전달 추가):

```ts
    socket.on("mem:promote", (p, ack) =>
      handle(`mem:promote [${p.area}]`, () => {
        const id = store.promote(
          (Array.isArray(p.sources) ? p.sources : []).map(Number),
          {
            section: p.section, area: String(p.area), rule: String(p.rule),
            evidence: String(p.evidence),
            confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : undefined,
          } as NewMemoryEntry
        );
        if (model) void enrich(id);
        return { id };
      })(ack)
    );
    socket.on("mem:tree", (p, ack) =>
      handle(`mem:tree #${p.id}`, () => ({ tree: store.tree(Number(p.id)) }))(ack)
    );
    socket.on("mem:export", (ack) =>
      handle("mem:export", () => {
        const rows = store.exportEvents();
        return { count: rows.length, jsonl: rows.map((e) => JSON.stringify(e)).join("\n") };
      })(ack)
    );
```

`summarize`에 케이스 추가 (rows 분기 아래):

```ts
    if (res.count !== undefined) return `${res.count}건`;
    if ("tree" in res) return res.tree ? "1건" : "없음";
```

- [ ] **Step 4: 클라이언트 구현** — `memory/client.ts`: `MemoryTree` import 추가 (`import type { MemoryEntry, MemorySection, MemoryTree, NewMemoryEntry } from "./store.ts"`), `MemoryClient` 인터페이스에 위 Produces 시그니처 반영 (`add`는 기존 선언 교체), 구현체에:

```ts
    add: async (e) => (await req("mem:add", e)).id, // parent 필드 포함 그대로 전달 (기존 구현 유지)
    promote: async (sources, e) => (await req("mem:promote", { ...e, sources })).id,
    link: async (id, refs) => (await req("mem:update", { id, link: refs })).updated,
    tree: async (id) => (await req("mem:tree", { id })).tree ?? null,
    exportEvents: async () => {
      const r = await req("mem:export");
      return { count: r.count ?? 0, jsonl: r.jsonl ?? "" };
    },
```

`list`는 시그니처에 `withObserve?: boolean` 추가 (구현은 기존 opts 스프레드 그대로).

- [ ] **Step 5: 통과 확인** — `bun test tests/store-socket.test.ts` → PASS, `bun test` 전체 PASS
- [ ] **Step 6: 커밋** — `git commit -am "feat(server,client): 소켓 v0.13 — mem:promote/tree/export, update link 플래그, add parent"`

---

### Task 7: MCP 도구 확장 (observe 섹션·promote/link 액션·tree 조회)

**Files:**
- Modify: `mcp/server.ts`
- Test: `tests/mcp.test.ts`

**Interfaces:**
- Consumes: Task 6의 클라이언트 메서드
- Produces: 기존 도구 4종 확장 — `nunchi_record`(section observe + parent), `nunchi_update`(action promote/link + sources/refs), `nunchi_list`(tree 옵션). 도구 신설 없음 (`tools/list`는 기존 4종 그대로).

- [ ] **Step 1: 실패 테스트 추가** — `tests/mcp.test.ts`의 기존 패턴(send/jsonrpc)을 따라, 기존 테스트가 쓰는 세션 준비 코드와 동일한 구조로:

```ts
// 기존 "MCP tools/call" 테스트와 같은 스폰·초기화 패턴을 사용한다.
// 검증 시나리오: nunchi_record(section: observe) 성공 →
// nunchi_update(action: promote, id: 관찰 id, section/area/rule/evidence) 성공 →
// nunchi_list({ tree: 승격 id }) 응답의 tree.sources에 관찰 id 포함 →
// nunchi_update(action: link, id, refs: [다른 항목]) 성공 →
// nunchi_update(action: promote, id: 일반 항목) → isError.
```

실제 코드는 기존 테스트의 `send`/`recv` 헬퍼 구조를 재사용해 위 5단계를 순서대로 assert한다 (파일 내 기존 테스트 1번을 복제해 시나리오만 교체).

- [ ] **Step 2: 실패 확인** — `bun test tests/mcp.test.ts` → FAIL (observe enum 거부)
- [ ] **Step 3: 구현** — `mcp/server.ts`:

section enum 교체:

```ts
const section = z
  .enum(["punish", "forgive", "env", "task", "observe"])
  .describe(
    "punish=벌주는 것(반드시 한다), forgive=용서하는 것(생략 가능), env=환경 특이사항, task=작업 기록(완결 작업 플레이북), observe=관찰(확신 없는 예측 어긋남 의심 신호 — 자동 회수 제외, 반복 확인 시 update action: promote로 승격)"
  );
```

`nunchi_record`: description 끝에 `" 확신이 없는 어긋남 의심은 section: observe로 관찰만 남긴다(부담 없음). 관련 기존 항목이 있으면 parent로 계보를 연결한다."` 추가, inputSchema에:

```ts
      parent: z.number().int().optional()
        .describe("observe 기록 시 관련 기존 항목 id — 승격 계보의 canonical 부모 (선택)"),
```

`nunchi_update`: action enum `["confirm", "reverse", "edit", "remove", "promote", "link"]`, description에 `"promote=관찰 승격(id=대표 관찰, sources로 추가 관찰, 새 항목의 section/area/rule/evidence 필수 — 출처 계보 보존), link=자유 참조 연결(refs 필수)"` 추가, inputSchema에:

```ts
      sources: z.array(z.number().int()).optional().describe("promote 시 추가 근거 관찰 id들"),
      refs: z.array(z.number().int()).optional().describe("link 시 참조 항목 id들"),
```

핸들러(destructure를 `({ id, action, sources, refs, ...f })`로) confirm 분기 뒤에:

```ts
      if (action === "promote") {
        if (!f.section || !f.area || !f.rule || !f.evidence)
          return fail("promote에는 새 항목의 section/area/rule/evidence가 필수다");
        return ok({
          id: await m.promote([id, ...(sources ?? [])], {
            section: f.section, area: f.area, rule: f.rule,
            evidence: f.evidence, confidence: f.confidence,
          }),
        });
      }
      if (action === "link") {
        if (!refs?.length) return fail("link에는 refs(참조 항목 id 배열)가 필수다");
        return ok({ updated: await m.link(id, refs) });
      }
```

`nunchi_list`: description에 `" tree: id를 지정하면 해당 항목의 관계 트리(승격 계보·도메인 형제·자유 참조)만 반환한다. 관찰은 section: observe로 명시 조회."` 추가, inputSchema에 `tree: z.number().int().optional()`, 핸들러:

```ts
  async ({ tree, ...opts }) => {
    try {
      const m = await mem();
      if (tree !== undefined) return ok({ tree: await m.tree(tree) });
      return ok({ rows: await m.list(opts) });
    } catch (e) {
      return fail(e);
    }
  }
```

- [ ] **Step 4: 통과 확인** — `bun test tests/mcp.test.ts` → PASS (tools/list 4종 assert도 그대로 PASS)
- [ ] **Step 5: 커밋** — `git commit -am "feat(mcp): observe 섹션·promote/link 액션·tree 조회 — 도구 4종 확장"`

---

### Task 8: hooks — 관찰 레인 규약 주입 (stop-check C항·session-start·subagent-start)

**Files:**
- Modify: `hooks/stop-check.ts`, `hooks/session-start.ts`, `hooks/subagent-start.ts`

**Interfaces:**
- Consumes: 없음 (문구만 — 검색 제외는 store가 보장)
- Produces: 주입 규약에 관찰 레인 안내

- [ ] **Step 1: 구현** (문구 변경 — 기존 hooks.test.ts는 문구 비강결합 확인됨):

`hooks/stop-check.ts` reason 문자열 교체:

```ts
      reason:
        `[nunchi] 주기 점검(${CHECK_EVERY}턴): ` +
        `(A) 이번 구간에 예측과 실제가 어긋난 경우가 있었는가? (1) 과잉 대응 (2) 과소 대응 (3) 환경 특이사항 — ` +
        `있었다면 nunchi_record(신규) 또는 nunchi_update(action: confirm 재확인 / reverse 반전). ` +
        `(B) 이번 구간에 완결된 작업(산출물이 남는 요청 단위)이 있는가? — ` +
        `있다면 유사 task 항목을 검색해 nunchi_update(edit 절차 교정 / confirm 재확인), 없으면 nunchi_record(section: task)로 기록. ` +
        `(C) 확신은 없지만 과잉/과소가 의심된 순간이 있었는가? — ` +
        `있다면 nunchi_record(section: observe)로 관찰만 남길 것 (자동 회수 제외 — 부담 없음, 반복되면 promote로 승격). ` +
        `셋 다 없었다면 "보정·작업 특이사항 없음" 한 줄만 답하고 종료할 것.`,
```

`hooks/session-start.ts` lines 배열의 작업 기록 규약 줄 다음에 추가:

```ts
  "관찰 레인: 확신이 없는 예측 어긋남 의심은 nunchi_record(section: observe)로 가볍게 남긴다 (자동 회수 제외). 같은 신호가 반복 확인되면 nunchi_update(action: promote, id: 대표 관찰, sources: 추가 관찰)로 보정 항목으로 승격한다 — 출처가 계보로 보존된다.",
```

`hooks/subagent-start.ts` lines 배열 끝에 추가:

```ts
  "확신 없는 어긋남 의심은 nunchi_record(section: observe)로 관찰만 남긴다 (자동 회수 제외).",
```

- [ ] **Step 2: 검증** — `bun test tests/hooks.test.ts tests/session-start.test.ts` → PASS
- [ ] **Step 3: 커밋** — `git commit -am "feat(hooks): 관찰 레인 규약 주입 — Stop 점검 (C)항, 세션·서브에이전트 안내"`

---

### Task 9: 대시보드 — observe 타일·색·에디터 옵션

**Files:**
- Modify: `memory/dashboard/index.html`, `memory/dashboard/style.css`

**Interfaces:**
- Consumes: Task 6의 `mem:list` withObserve, `mem:search` sections
- Produces: observe 통계 타일(필터 토글), 에디터 observe 옵션

- [ ] **Step 1: 구현** — `index.html`:

task 타일 다음에:

```html
    <button class="tile" data-sec="observe" aria-pressed="false">
      <span class="tile-label"><span class="mark sec-observe" aria-hidden="true"></span>observe · 관찰</span>
      <span class="tile-num" id="n-observe">–</span>
    </button>
```

에디터 select에 `<option value="observe">observe</option>` 추가. 스크립트에서:

- `refresh()`: `req("mem:list", {})` → `req("mem:list", { withObserve: true })`
- `renderStats()`: `$("n-observe").textContent = n("observe");` 추가
- `search()`: 서버 기본 검색이 observe를 제외하므로 명시 sections 전달 —

```js
      render(applyFilters((await req("mem:search", {
        queries,
        sections: secFilter.size ? [...secFilter] : ["punish", "forgive", "env", "task", "observe"],
      })).rows));
```

`style.css`: `:root`에 `--sec-observe: #8250df;`, 다크 블록에 `--sec-observe: #9a6ee8;`, mark 규칙에 `.mark.sec-observe { background: var(--sec-observe); }` 추가.

- [ ] **Step 2: 검증** — `bun test tests/web.test.ts` PASS + 수동: `memory-config.json`의 `web: true`로 서버 기동, 브라우저에서 observe 항목 추가·타일 카운트·필터 토글 확인
- [ ] **Step 3: 커밋** — `git commit -am "feat(dashboard): observe 타일·색·에디터 옵션 — 관찰 레인 표시"`

> ponytail: 승격 UI(관찰 다중 선택 → promote)는 이번 범위 밖 — 승격은 모델(MCP)·정제 모드가 담당. 대시보드 승격 버튼이 필요해지면 추가.

---

### Task 10: 문서 — SKILL.md·README 관찰 레인·트리·저널 반영

**Files:**
- Modify: `SKILL.md`, `README.md`

**Interfaces:**
- Consumes: 최종 동작 (Task 1~9)
- Produces: 사용자·모델용 규약 문서 갱신

- [ ] **Step 1: SKILL.md 갱신**:
  - frontmatter description에 `"관찰(observe) 기록·승격이 필요할 때"` 트리거 추가
  - `## 저장소와 회수`의 section 나열에 `observe=관찰` 추가, 문단 끝에 canonical 저널 한 줄: `모든 변경은 memory.db의 append-only events 테이블(canonical 저널)에 남는다 — 파생 상태(memory 테이블·FTS)는 replay로 재구축 가능하고, 내보내기는 mem:export(JSONL)가 담당한다.`
  - `## 항목 포맷` 다음에 신규 섹션:

```markdown
## 관찰 레인 (observe) — 승격 사다리의 최하층

확신이 없는 예측 어긋남 의심은 보정 항목 대신 **관찰**로 남긴다 — 기록 부담을 없애되 회수 품질을 지킨다.

- 관찰은 자동 회수(코어 주입·매 메시지 검색)에서 제외된다. `nunchi_search`/`nunchi_list`에 `section: observe`를 명시할 때만 조회된다.
- 기록: `nunchi_record(section: observe, ...)`. 관련 기존 항목이 있으면 `parent`로 계보를 연결한다.
- 승격: 같은 신호가 반복 확인되면 `nunchi_update(action: promote, id: 대표 관찰, sources: 추가 관찰 id, section/area/rule/evidence: 새 항목)` — 출처 관찰들이 계보(sources·promoted_to)로 보존된다. 승격 사다리: 관찰 → 보정 항목(신뢰도 1~2) → 코어(3+, confirm으로 승격).
- 트리 조회: `nunchi_list(tree: id)`가 승격 계보·도메인 형제(area "[도메인: …]" 관례)·자유 참조(`nunchi_update(action: link, refs: [...])`)를 반환한다.
- 정제: 30일 경과 또는 60건 초과의 미승격 관찰은 정제(pruning) 후보다. 자동 삭제는 없다 — remove로만 소멸한다.
```

  - `## 정제 (pruning)` 목록에 `6. 미승격 관찰(observe)이 30일 경과 또는 60건을 초과하면 정제 후보로 보고 — 반복 신호는 promote, 나머지는 삭제를 제안한다.` 추가

- [ ] **Step 2: README.md 갱신**:
  - `## 동작` 목록 4번(MCP 도구)에 observe·promote·link·tree 언급 추가, 5번 Stop hook에 `(C) 관찰` 추가
  - `**작업 기록(task)**` 문단 다음에 관찰 레인 요약 문단 1개 추가 (SKILL.md 신규 섹션의 2~3문장 요약)
  - `## Memory server`의 API 줄을 `add(parent 포함) / promote / link(update의 link 플래그) / tree / exportEvents(mem:export JSONL)` 포함으로 갱신
  - 아키텍처 한 줄 추가: `memory.db 내부는 canonical(append-only events 저널)과 파생(memory 테이블·FTS — replay로 재구축 가능)으로 분리된다 (참고: memory-forest의 canonical/파생 원칙).`
- [ ] **Step 3: 최종 검증** — `bun test` 전체 PASS
- [ ] **Step 4: 커밋** — `git commit -am "docs: 관찰 레인·승격 사다리·이벤트 저널 규약 반영 (SKILL.md·README)"`

---

## Self-Review 결과

- 스펙 §1(데이터 모델) → Task 1·2, §2(사다리) → Task 4·5·8, §3(트리) → Task 5, §4(API) → Task 6·7·8, §5(내보내기) → Task 5·6, §6(마이그레이션) → Task 1, §7(테스트) → 각 태스크 Step. 커버리지 공백 없음.
- 버전 범프·CHANGELOG는 릴리스 절차(보정 #6·#10)가 담당 — 이 계획 범위 밖.
- Task 3의 `withObserve` 전방 참조는 Task 3~4 연속 실행으로 해소 (계획에 명시).
