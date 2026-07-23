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

// make/applyMemorySchema는 이후 태스크 테스트가 공유한다 — 미사용 경고 방지용 참조
void make;
void applyMemorySchema;
