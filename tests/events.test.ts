// bun test tests/events.test.ts
// v0.13 이벤트 저널: 스키마·부트스트랩·이벤트 기록·replay·관찰 레인·승격·참조
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMemorySchema, createMemoryStore, rebuildDerived } from "../memory/store.ts";

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

test("replay 재구축: 파생 상태 드리프트를 events에서 완전 복원", () => {
  const { db, s } = make();
  const f = s.add({ section: "forgive", area: "[a]", rule: "r", evidence: "e" });
  s.confirm(f);
  s.update(f, { rule: "r2" });
  const x = s.add({ section: "task", area: "[t]", rule: "r", evidence: "e" });
  s.remove(x);
  const before = JSON.stringify(s.list({}));
  db.run(`DELETE FROM memory WHERE id = ?`, [f]); // 파생 드리프트 시뮬레이션
  rebuildDerived(db);
  expect(JSON.stringify(s.list({}))).toBe(before);
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

test("이벤트 ts는 행 updated_at과 동일 (replay 동등성의 전제)", () => {
  const { db, s } = make();
  const id = s.add({ section: "env", area: "[a]", rule: "r", evidence: "e" });
  const row = db.query(`SELECT updated_at FROM memory WHERE id = ?`).get(id) as { updated_at: string };
  const ev = db.query(`SELECT ts FROM events WHERE entry_id = ?`).get(id) as { ts: string };
  expect(ev.ts).toBe(row.updated_at);
});

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
