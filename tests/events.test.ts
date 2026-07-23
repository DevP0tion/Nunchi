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
  const { db, s } = make();
  s.add({ section: "punish", area: "[a]", rule: "r", evidence: "e" });
  applyMemorySchema(db); // 재기동 시뮬레이션
  expect(evs(db).length).toBe(1);
});

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
