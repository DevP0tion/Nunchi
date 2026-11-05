// bun test tests/topics.test.ts
// 주제·작업공간·세션 저장소 검증 (소켓 계층 제외) — store.test.ts와 같은 패턴.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createMemoryStore, rebuildDerived } from "../memory/store.ts";
import { createTopicStore, sessionLabel } from "../memory/topics.ts";

const setup = () => {
  const db = new Database(":memory:");
  const mem = createMemoryStore(db);
  const topics = createTopicStore(db);
  return { db, mem, topics };
};
const add = (mem: ReturnType<typeof createMemoryStore>, over: Partial<Parameters<ReturnType<typeof createMemoryStore>["add"]>[0]> = {}) =>
  mem.add({ section: "env", area: "[환경: 테스트]", rule: "규칙", evidence: "근거", ...over });

test("create: 빈 이름·중복 이름 throw", () => {
  const { topics } = setup();
  expect(() => topics.create({ name: "  " })).toThrow();
  topics.create({ name: "대시보드" });
  expect(() => topics.create({ name: "대시보드" })).toThrow();
});

test("create/get/update/list: 폴더는 입력 순서, update는 폴더 전체 교체", () => {
  const { topics } = setup();
  const t = topics.create({ name: " UI ", description: "d", folders: ["b/x", "a/y"] });
  expect(topics.get(t)?.name).toBe("UI");
  expect(topics.get(t)?.folders).toEqual(["b/x", "a/y"]);
  expect(topics.byName("UI")?.id).toBe(t);
  expect(topics.update(t, { folders: ["c"] })).toBe(true);
  expect(topics.get(t)?.folders).toEqual(["c"]);
  expect(topics.update(999, { name: "x" })).toBe(false);
  expect(topics.list()[0]?.memberCount).toBe(0);
});

test("link: 초기 주제 신뢰도 = 전체 신뢰도, 중복 무시", () => {
  const { mem, topics } = setup();
  const m = add(mem, { confidence: 3 });
  const t = topics.create({ name: "A" });
  expect(topics.link(t, [m])).toBe(1);
  expect(topics.members(t)[0]?.topic_confidence).toBe(3);
  expect(topics.link(t, [m])).toBe(0);
  expect(topics.topicsOf(m)).toEqual([t]);
  expect(() => topics.link(999, [m])).toThrow();
  expect(() => topics.link(t, [999])).toThrow();
});

test("rate: 하한 1", () => {
  const { mem, topics } = setup();
  const m = add(mem);
  const other = add(mem);
  const t = topics.create({ name: "A" });
  topics.link(t, [m]);
  expect(topics.rate(t, m, -1)).toBe(1);
  expect(topics.rate(t, m, 1)).toBe(2);
  expect(topics.rate(t, other, 1)).toBe(null);
});

test("areas: 3+·observe 제외·코어 제외·30개 상한", () => {
  const { mem, topics } = setup();
  const t = topics.create({ name: "A" });
  const core = add(mem, { section: "punish", area: "코어", confidence: 3 });
  const env = add(mem, { area: "환경영역", confidence: 3 });
  const obs = add(mem, { section: "observe", area: "관찰영역", confidence: 3 });
  topics.link(t, [core, env, obs]);
  expect(topics.areas(t).map((a) => a.area)).toEqual(["환경영역"]);
  const many = Array.from({ length: 35 }, (_, i) => add(mem, { area: `영역${i}`, confidence: 3 }));
  topics.link(t, many);
  expect(topics.areas(t)).toHaveLength(30);
});

test("remove(기억): 소속 행 정리", () => {
  const { mem, topics } = setup();
  const m = add(mem);
  const t = topics.create({ name: "A" });
  topics.link(t, [m]);
  mem.remove(m);
  expect(topics.memberIds(t)).not.toContain(m);
});

test("replay 후 소속·주제 신뢰도 보존", () => {
  const { db, mem, topics } = setup();
  const m = add(mem);
  const t = topics.create({ name: "A" });
  topics.link(t, [m]);
  topics.rate(t, m, 1);
  const before = topics.members(t).map((x) => [x.id, x.topic_confidence]);
  rebuildDerived(db);
  expect(topics.members(t).map((x) => [x.id, x.topic_confidence])).toEqual(before);
  expect(before).toEqual([[m, 2]]);
});

test("remove(주제): 기억 보존·세션 해제", () => {
  const { mem, topics } = setup();
  const m = add(mem);
  const t = topics.create({ name: "A", folders: ["f"] });
  topics.link(t, [m]);
  topics.registerSession({ sessionId: "s1", prompt: "hi" });
  topics.setSessionTopic("s1", t);
  expect(topics.remove(t)).toEqual(["s1"]);
  expect(topics.session("s1")?.topic_id).toBe(null);
  expect(mem.get(m)).not.toBe(null);
  expect(topics.get(t)).toBe(null);
  expect(topics.memberIds(t)).toEqual([]);
});

test("registerSession: first_prompt는 처음 값 유지, title은 갱신 / sessionLabel 폴백", () => {
  const { topics } = setup();
  topics.registerSession({ sessionId: "abcd1234", prompt: "첫 프롬프트" });
  topics.registerSession({ sessionId: "abcd1234", prompt: "두번째" });
  expect(topics.session("abcd1234")?.first_prompt).toBe("첫 프롬프트");
  expect(sessionLabel(topics.session("abcd1234")!)).toBe("첫 프롬프트 · abcd");
  topics.registerSession({ sessionId: "abcd1234", title: "이름" });
  topics.registerSession({ sessionId: "abcd1234" });
  expect(topics.session("abcd1234")?.title).toBe("이름");
  expect(sessionLabel(topics.session("abcd1234")!)).toBe("이름");
  expect(() => topics.setSessionTopic("abcd1234", 999)).toThrow();
});

test("setSessionTopic: 행 없으면 생성, bumpRev, endSession", () => {
  const { topics } = setup();
  const t = topics.create({ name: "A" });
  topics.setSessionTopic("new", t);
  expect(topics.session("new")?.topic_id).toBe(t);
  expect(topics.bumpRev("new")).toBe(1);
  expect(topics.sessions().map((s) => s.session_id)).toEqual(["new"]);
  topics.endSession("new");
  expect(topics.session("new")).toBe(null);
});

test("expireSessions: 24시간 초과만 삭제", () => {
  const { db, topics } = setup();
  topics.registerSession({ sessionId: "old" });
  topics.registerSession({ sessionId: "recent" });
  const set = (id: string, h: number) =>
    db.run(`UPDATE sessions SET last_seen = strftime('%Y-%m-%d %H:%M:%f','now','-${h} hours') WHERE session_id = ?`, [id]);
  set("old", 25);
  set("recent", 23);
  expect(topics.expireSessions()).toEqual(["old"]);
  expect(topics.session("recent")).not.toBe(null);
});

test("confirmInTopic: 소속만 +1", () => {
  const { mem, topics } = setup();
  const a = add(mem);
  const b = add(mem);
  const t = topics.create({ name: "A" });
  topics.link(t, [a]);
  topics.setSessionTopic("s", t);
  expect(topics.confirmInTopic("s", a)).toBe(true);
  expect(topics.members(t)[0]?.topic_confidence).toBe(2);
  expect(topics.confirmInTopic("s", b)).toBe(false);
  expect(topics.confirmInTopic("none", a)).toBe(false);
});

test("store.search onlyIds/excludeIds, list ids", () => {
  const { mem } = setup();
  const a = add(mem, { rule: "캐시 키 확인" });
  const b = add(mem, { rule: "캐시 무효화", section: "observe" });
  expect(mem.search(["캐시"], { sections: ["env", "observe"] }).map((e) => e.id).sort()).toEqual([a, b]);
  expect(mem.search(["캐시"], { onlyIds: [a], sections: ["env", "observe"] }).map((e) => e.id)).toEqual([a]);
  expect(mem.search(["캐시"], { excludeIds: [a], sections: ["env", "observe"] }).map((e) => e.id)).toEqual([b]);
  expect(mem.list({ ids: [b] }).map((e) => e.id)).toEqual([b]);
  expect(mem.list({ ids: [] })).toEqual([]);
});
