// bun test tests/workspace-socket.test.ts
// ws:* 소켓 API + 세션 상태 파일 동기화 + mem:* 주제 확장. 실제 서버를 스폰하는 통합 테스트.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioc, type Socket } from "socket.io-client";
import { loadConfig, resolveDocDir } from "../hooks/config.ts";
import { assignFreePort, connectMemory, type MemoryClient } from "../memory/client.ts";
import { resolveMemoryPort } from "../memory/memory-config.ts";
import { readSessionState, sessionsDir } from "../memory/session-state.ts";
import { rmProject, setTopic } from "./helpers.ts";

type Raw = Socket & { call(ev: string, p?: unknown): Promise<any> };

/** 서버를 띄우고 mem(클라이언트)·raw(대시보드용 원시 소켓)·docDir를 넘긴 뒤 정리한다 */
async function withServer(fn: (c: { A: string; mem: MemoryClient; raw: Raw; docDir: string }) => Promise<void>) {
  const A = mkdtempSync(join(tmpdir(), "nunchi-ws-"));
  await assignFreePort(A);
  const mem = await connectMemory(A);
  const raw = ioc(`http://127.0.0.1:${resolveMemoryPort(A)}`, { reconnection: false }) as Raw;
  // 응답이 없으면 5초 뒤 reject — 테스트가 30초 타임아웃까지 매달리지 않게 (대시보드 req와 같은 방식)
  raw.call = (ev, p) => (p === undefined ? raw.timeout(5000).emitWithAck(ev) : raw.timeout(5000).emitWithAck(ev, p));
  await new Promise<void>((res) => raw.once("connect", () => res()));
  try {
    await fn({ A, mem, raw, docDir: resolveDocDir(A, loadConfig(A)) });
  } finally {
    raw.close();
    await mem.shutdown();
    await rmProject(A);
  }
}
const env = (rule: string, confidence = 1) =>
  ({ section: "env", area: "[환경: 테스트]", rule, evidence: "근거", confidence }) as const;

test("주제 생성·소속·세션 설정 → 상태 파일 rev 1, areas 포함", async () => {
  await withServer(async ({ mem, docDir }) => {
    const m = await mem.add(env("캐시 키 확인", 3));
    const t = await mem.createTopic({ name: "배포", folders: ["src"] });
    expect(await mem.linkTopic(t, [m])).toBe(1);
    const st = await setTopic(mem, "s1", t);
    expect(st.rev).toBe(1);
    expect(st.topic?.areas[0]?.id).toBe(m);
    const file = readSessionState(docDir, "s1");
    expect(file?.rev).toBe(1);
    expect(file?.topic?.areas[0]?.id).toBe(m);
    expect(file?.topic?.folders).toEqual(["src"]);
    const q = await mem.sessionState("s1");
    expect(q.memberIds).toEqual([m]);
    expect((await mem.topics()).map((x) => x.name)).toEqual(["배포"]);
    expect((await mem.topicByName(" 배포 "))?.id).toBe(t);
    expect(await mem.topicByName("없음")).toBe(null);
    expect(await mem.sessionState("none")).toEqual({ rev: 0, topic: null, memberIds: [] });
  });
}, 30000);

test("내용이 그대로면 rev 유지, 바뀌면 증가", async () => {
  await withServer(async ({ mem, raw, docDir }) => {
    const t = await mem.createTopic({ name: "A" });
    await setTopic(mem, "s1", t);
    expect((await setTopic(mem, "s1", t)).rev).toBe(1);
    expect(readSessionState(docDir, "s1")?.rev).toBe(1);
    expect((await raw.call("ws:topic:update", { id: t, folders: ["x/y"] })).updated).toBe(true);
    expect(readSessionState(docDir, "s1")).toMatchObject({ rev: 2, topic: { folders: ["x/y"] } });
    expect((await mem.sessionState("s1")).rev).toBe(2);
  });
}, 30000);

test("사용 중 주제 삭제 → 세션 해제, 상태 파일 topic null, rev 증가", async () => {
  await withServer(async ({ mem, raw, docDir }) => {
    const t = await mem.createTopic({ name: "A" });
    await setTopic(mem, "s1", t);
    const before = readSessionState(docDir, "s1")!.rev;
    expect((await raw.call("ws:topic:remove", { id: t })).removed).toBe(true);
    const after = readSessionState(docDir, "s1");
    expect(after?.topic).toBe(null);
    expect(after!.rev).toBeGreaterThan(before);
    expect((await mem.sessionState("s1")).topic).toBe(null);
    expect((await raw.call("ws:topic:remove", { id: t })).removed).toBe(false);
  });
}, 30000);

test("중복 이름 생성 → ok:false(한국어 메시지), 서버 계속 응답", async () => {
  await withServer(async ({ raw }) => {
    expect((await raw.call("ws:topic:create", { name: "A" })).ok).toBe(true);
    const dup = await raw.call("ws:topic:create", { name: "A" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toContain("이미 있는 주제 이름: A");
    const board = await raw.call("ws:board");
    expect(board.ok).toBe(true);
    expect(board.topics.length).toBe(1);
  });
}, 30000);

test("mem:search topicId: 소속 먼저 채우고 일반으로 보충, topic 표시", async () => {
  await withServer(async ({ mem }) => {
    const a = await mem.add(env("zebra alpha"));
    const b = await mem.add(env("zebra beta"));
    const c = await mem.add(env("zebra gamma"));
    const t = await mem.createTopic({ name: "Z" });
    await mem.linkTopic(t, [b]);
    const rows = await mem.search(["zebra"], { topicId: t, limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ id: b, topic: true });
    expect(rows[1]!.topic).toBeUndefined();
    expect([a, c]).toContain(rows[1]!.id);
    // sessionId로도 같은 경로 (MCP용)
    await setTopic(mem, "s1", t);
    const viaSession = await mem.search(["zebra"], { sessionId: "s1", limit: 2 });
    expect(viaSession[0]).toMatchObject({ id: b, topic: true });
    // 주제 없는 세션·topicId 미지정은 기존 동작
    expect((await mem.search(["zebra"], { sessionId: "nope", limit: 3 })).every((r) => !r.topic)).toBe(true);
    // list ids
    expect((await mem.list({ ids: [a, c] })).map((e) => e.id).sort()).toEqual([a, c].sort());
  });
}, 30000);

test("mem:add sessionId → 자동 소속 / confirm sessionId → 전체·주제 신뢰도 +1", async () => {
  await withServer(async ({ mem, raw }) => {
    const t = await mem.createTopic({ name: "A" });
    await setTopic(mem, "s1", t);
    const m = await mem.add({ ...env("자동 소속"), sessionId: "s1" });
    const members = (await raw.call("ws:topic", { id: t })).members;
    expect(members.map((x: any) => x.id)).toEqual([m]);
    expect(members[0].topic_confidence).toBe(1);
    expect(await mem.update(m, { confirm: true, sessionId: "s1" })).toBe(true);
    expect((await mem.list({ ids: [m] }))[0]!.confidence).toBe(2);
    expect((await raw.call("ws:topic", { id: t })).members[0].topic_confidence).toBe(2);
    // 세션 없는 confirm은 전체 신뢰도만
    await mem.update(m, { confirm: true });
    expect((await mem.list({ ids: [m] }))[0]!.confidence).toBe(3);
    expect((await raw.call("ws:topic", { id: t })).members[0].topic_confidence).toBe(2);
  });
}, 30000);

test("ws:topic:rate / unlink → 상태 파일 areas 갱신", async () => {
  await withServer(async ({ mem, raw, docDir }) => {
    const m = await mem.add(env("규칙"));
    const t = await mem.createTopic({ name: "A" });
    await mem.linkTopic(t, [m]);
    await setTopic(mem, "s1", t);
    expect(readSessionState(docDir, "s1")?.topic?.areas).toEqual([]); // 주제 신뢰도 1 < 3
    await raw.call("ws:topic:rate", { topicId: t, memoryId: m, delta: 1 });
    expect((await raw.call("ws:topic:rate", { topicId: t, memoryId: m, delta: 1 })).confidence).toBe(3);
    expect(readSessionState(docDir, "s1")?.topic?.areas.map((a) => a.id)).toEqual([m]);
    expect((await raw.call("ws:topic:unlink", { topicId: t, memoryIds: [m] })).count).toBe(1);
    expect(readSessionState(docDir, "s1")?.topic?.areas).toEqual([]);
  });
}, 30000);

test("mem:remove → 상태 파일 areas에서 제거", async () => {
  await withServer(async ({ mem, docDir }) => {
    const m = await mem.add(env("사라질 규칙", 3));
    const t = await mem.createTopic({ name: "A" });
    await mem.linkTopic(t, [m]);
    await setTopic(mem, "s1", t);
    expect(readSessionState(docDir, "s1")?.topic?.areas.length).toBe(1);
    expect(await mem.remove(m)).toBe(true);
    expect(readSessionState(docDir, "s1")?.topic?.areas).toEqual([]);
  });
}, 30000);

test("ws:session:end → 행·파일 삭제 / ws:board 라벨", async () => {
  await withServer(async ({ mem, raw, docDir }) => {
    const t = await mem.createTopic({ name: "A" });
    await mem.registerSession({ sessionId: "s1", title: null, cwd: "/p", prompt: "첫 프롬프트" });
    await setTopic(mem, "s1", t);
    expect(existsSync(join(sessionsDir(docDir), "s1.json"))).toBe(true);
    const board = await raw.call("ws:board");
    expect(board.sessions[0]).toMatchObject({ session_id: "s1", topic_id: t, label: "첫 프롬프트 · s1" });
    expect((await raw.call("ws:topic", { id: t })).sessions.length).toBe(1);
    await mem.endSession("s1");
    expect((await raw.call("ws:board")).sessions).toEqual([]);
    expect(existsSync(join(sessionsDir(docDir), "s1.json"))).toBe(false);
  });
}, 30000);

test("ws:session:set: 등록 안 된·종료된 세션은 거부하고 행을 만들지 않는다", async () => {
  await withServer(async ({ mem, raw, docDir }) => {
    const t = await mem.createTopic({ name: "A" });
    const r = await raw.call("ws:session:set", { sessionId: "ghost", topicId: t });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("세션 없음: ghost");
    await setTopic(mem, "s1", t);
    await mem.endSession("s1");
    expect((await raw.call("ws:session:set", { sessionId: "s1", topicId: null })).ok).toBe(false);
    expect((await raw.call("ws:board")).sessions).toEqual([]);
    expect(existsSync(join(sessionsDir(docDir), "s1.json"))).toBe(false);
  });
}, 30000);

test("ws:topic:create/update: 이름 60·설명 200·폴더 200자 상한", async () => {
  await withServer(async ({ raw }) => {
    expect((await raw.call("ws:topic:create", { name: "가".repeat(61) })).error).toContain("60자");
    expect((await raw.call("ws:topic:create", { name: "A", description: "d".repeat(201) })).error).toContain("200자");
    expect((await raw.call("ws:topic:create", { name: "A", folders: ["f".repeat(201)] })).error).toContain("200자");
    const { id } = await raw.call("ws:topic:create", { name: "A" });
    expect((await raw.call("ws:topic:update", { id, name: "가".repeat(61) })).ok).toBe(false);
    expect((await raw.call("ws:board")).topics.map((x: any) => x.name)).toEqual(["A"]);
  });
}, 30000);

test("만료 세션: 서버 기동 시 행과 상태 파일 삭제", async () => {
  const A = mkdtempSync(join(tmpdir(), "nunchi-ws-"));
  await assignFreePort(A);
  const docDir = resolveDocDir(A, loadConfig(A));
  let mem = await connectMemory(A);
  try {
    const t = await mem.createTopic({ name: "A" });
    await setTopic(mem, "old", t);
    await setTopic(mem, "recent", t);
    await mem.shutdown(); // 서버가 db를 닫은 뒤 응답한다 — 직접 열어 last_seen을 25시간 전으로
    const db = new Database(join(docDir, "memory.db"));
    db.run(`UPDATE sessions SET last_seen = strftime('%Y-%m-%d %H:%M:%f','now','-25 hours') WHERE session_id = 'old'`);
    db.close();
    mem = await connectMemory(A); // 새 서버의 기동 시 expire()
    expect(existsSync(join(sessionsDir(docDir), "old.json"))).toBe(false);
    expect(existsSync(join(sessionsDir(docDir), "recent.json"))).toBe(true);
    expect((await mem.sessionState("old")).topic).toBe(null);
    expect((await mem.sessionState("recent")).topic?.id).toBe(t);
  } finally {
    await mem.shutdown();
    await rmProject(A);
  }
}, 30000);

test("ws:changed broadcast / 잘못된 sessionId 거부", async () => {
  await withServer(async ({ raw }) => {
    const changed = new Promise<void>((res) => raw.once("ws:changed", () => res()));
    await raw.call("ws:topic:create", { name: "A" });
    await changed;
    const bad = await raw.call("ws:session:set", { sessionId: "../x", topicId: null });
    expect(bad.ok).toBe(false);
    expect((await raw.call("ws:board")).ok).toBe(true);
  });
}, 30000);

test("mem:update confirm: 잘못된 sessionId는 confirm 적용 전에 거부 (반쯤 적용 금지)", async () => {
  await withServer(async ({ mem, raw }) => {
    const m = await mem.add(env("규칙"));
    const bad = await raw.call("mem:update", { id: m, confirm: true, sessionId: "../x" });
    expect(bad.ok).toBe(false);
    expect((await mem.list({ ids: [m] }))[0]!.confidence).toBe(1);
  });
}, 30000);

test("ws:topic:create/update: null·undefined 필드는 문자열 \"null\"이 되지 않는다", async () => {
  await withServer(async ({ raw }) => {
    const { id } = await raw.call("ws:topic:create", { name: "A", description: null });
    const t = (await raw.call("ws:board")).topics.find((x: any) => x.id === id);
    expect(t.description).toBe("");
    expect((await raw.call("ws:topic:update", { id, name: null, description: "설명" })).updated).toBe(true);
    const u = (await raw.call("ws:board")).topics.find((x: any) => x.id === id);
    expect(u).toMatchObject({ name: "A", description: "설명" });
  });
}, 30000);

test("ws:topic:rate: 1·-1 외의 delta는 거부", async () => {
  await withServer(async ({ mem, raw }) => {
    const m = await mem.add(env("규칙"));
    const t = await mem.createTopic({ name: "A" });
    await mem.linkTopic(t, [m]);
    for (const delta of [0, 2, "x", undefined]) {
      const r = await raw.call("ws:topic:rate", { topicId: t, memoryId: m, delta });
      expect(r.ok).toBe(false);
    }
    expect((await raw.call("ws:topic:rate", { topicId: t, memoryId: m, delta: 1 })).confidence).toBe(2);
    expect((await raw.call("ws:topic:rate", { topicId: t, memoryId: m, delta: -1 })).confidence).toBe(1);
  });
}, 30000);
