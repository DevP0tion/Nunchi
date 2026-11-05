// bun test tests/topic-format.test.ts
// 주제 블록 렌더링·작업공간 판정(hooks/topic.ts)과 세션 상태 파일(memory/session-state.ts) 단위 테스트.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMemoryEntries, type MemoryEntryLite } from "../hooks/config.ts";
import {
  TOPIC_CLEARED,
  formatCoreBlock,
  formatTopicBlock,
  formatTopicList,
  inWorkspace,
  sessionIdLine,
} from "../hooks/topic.ts";
import {
  readDelivered,
  readSessionState,
  removeSessionFiles,
  sessionsDir,
  writeDelivered,
  writeSessionState,
  type TopicState,
} from "../memory/session-state.ts";

const WIN = process.platform === "win32";
const P = WIN ? "C:/p" : "/p";

test("inWorkspace: 상대·절대·끝 슬래시·역슬래시", () => {
  for (const f of ["memory/dashboard/", "memory/dashboard", "memory\\dashboard", `${P}/memory/dashboard`]) {
    expect(inWorkspace(P, [f], `${P}/memory/dashboard/index.html`)).toBe(true);
    expect(inWorkspace(P, [f], "memory/dashboard/index.html")).toBe(true);
    expect(inWorkspace(P, [f], `${P}/memory/dashboard2/x`)).toBe(false);
    expect(inWorkspace(P, [f], `${P}/memory/dash`)).toBe(false);
  }
  expect(inWorkspace(P, ["memory/dashboard"], `${P}/memory/dashboard`)).toBe(true); // 폴더 자체
  expect(inWorkspace(P, ["a", "memory/dashboard"], `${P}/memory/dashboard/x.ts`)).toBe(true); // 여러 폴더 중 하나
  expect(inWorkspace(P, [], `${P}/아무데나/x.ts`)).toBe(true); // 폴더 없음 → 항상 안
});

test.skipIf(!WIN)("inWorkspace: win32 대소문자", () => {
  expect(inWorkspace(P, ["memory/dashboard"], `${P}/MEMORY/Dashboard/a.ts`)).toBe(true);
});

const topic: TopicState = {
  id: 7,
  name: "대시보드 접근성",
  description: "대비·포커스 개선",
  folders: ["memory/dashboard", "docs"],
  areas: [
    { id: 41, area: "접근성 대비" },
    { id: 57, area: "토큰 우선 CSS" },
  ],
};

test("formatTopicBlock: 형식", () => {
  const b = formatTopicBlock(topic);
  expect(b).toContain("[nunchi] 현재 주제: 대시보드 접근성 — 대비·포커스 개선");
  expect(b).toContain("작업공간: memory/dashboard, docs — 이 폴더들 안에서 작업한다");
  expect(b).toContain("- #41 접근성 대비");
  expect(b).toContain("- #57 토큰 우선 CSS");
  expect(b).toContain("nunchi_list(ids)");
  expect(b).not.toContain("주제 정보가 갱신됨");
  expect(formatTopicBlock(topic, true).split("\n")[0]).toBe("[nunchi] 주제 정보가 갱신됨");
  expect(formatTopicBlock(topic, true)).toContain("현재 주제: 대시보드 접근성");
});

test("formatTopicBlock: 폴더·영역이 비면", () => {
  const b = formatTopicBlock({ ...topic, folders: [], areas: [] });
  expect(b).toContain("작업공간: (지정 없음)");
  expect(b).not.toContain("주제 핵심 영역");
  expect(b).not.toContain("- #");
});

test("formatTopicList: 20개 상한 + 규약 1줄(비어도 규약은 출력)", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `t${i}`, description: `d${i}` }));
  const l = formatTopicList(many);
  expect(l).toContain("- t0 — d0");
  expect(l).toContain("- t19 — d19");
  expect(l).not.toContain("t20");
  expect(l).toContain("nunchi_topic(set)");
  const empty = formatTopicList([]);
  expect(empty).toContain("nunchi_topic(set)");
  expect(empty).not.toContain("- ");
});

test("sessionIdLine·TOPIC_CLEARED 문구", () => {
  expect(sessionIdLine("abc-1")).toBe(
    "[nunchi] 이 세션 id: abc-1 — nunchi_topic·nunchi_record·nunchi_update·nunchi_search 호출 시 session_id로 넘긴다"
  );
  expect(TOPIC_CLEARED).toBe("[nunchi] 현재 주제 없음 — 이전에 주입된 주제 블록은 무효");
});

const e = (id: number, area: string, rule: string): MemoryEntryLite => ({
  id, section: "punish", area, rule, evidence: "근거", confidence: 3,
});
const CORE_HEAD = "[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]";

test("formatCoreBlock: 소속은 전문, 비소속은 #id · area", () => {
  const core = [e(1, "[A: 소속]", "소속 규칙 본문"), e(2, "[B: 밖]", "비소속 규칙 본문")];
  const scoped = formatCoreBlock(core, [1]);
  expect(scoped).toContain("소속 규칙 본문");
  expect(scoped).not.toContain("비소속 규칙 본문");
  expect(scoped).toContain("#2 · [B: 밖]");
  expect(scoped).toContain("[확정 규칙 — 주제 밖, 전문은 nunchi_list(ids)로 조회. 항상 지킨다]");
  const all = formatCoreBlock(core, null);
  expect(all).toContain("소속 규칙 본문");
  expect(all).toContain("비소속 규칙 본문");
  // 주제 없음 = 기존 훅 출력과 동일
  expect(all).toBe(`${CORE_HEAD}\n${formatMemoryEntries(core)}`);
  // 빈 쪽 블록 생략, core가 비면 ""
  expect(formatCoreBlock(core, [1, 2])).not.toContain("주제 밖");
  expect(formatCoreBlock(core, [])).not.toContain(CORE_HEAD);
  expect(formatCoreBlock([], [1])).toBe("");
  expect(formatCoreBlock([], null)).toBe("");
});

test("상태 파일: 원자적 쓰기·깨진 파일 null·delivered 에이전트별", () => {
  const d = mkdtempSync(join(tmpdir(), "nunchi-ss-"));
  try {
    expect(readSessionState(d, "s1")).toBeNull();
    expect(readDelivered(d, "s1")).toBe(0);
    const s = { rev: 4, topic };
    writeSessionState(d, "s1", s);
    expect(readSessionState(d, "s1")).toEqual(s);
    writeSessionState(d, "s1", { rev: 5, topic: null });
    expect(readSessionState(d, "s1")).toEqual({ rev: 5, topic: null });
    writeDelivered(d, "s1", null, 3);
    writeDelivered(d, "s1", "a1", 5);
    expect(readDelivered(d, "s1")).toBe(3);
    expect(readDelivered(d, "s1", null)).toBe(3);
    expect(readDelivered(d, "s1", "a1")).toBe(5);
    expect(readDelivered(d, "s1", "a2")).toBe(0);
    writeSessionState(d, "s2", s);
    writeFileSync(join(sessionsDir(d), "s1.json"), "{");
    expect(readSessionState(d, "s1")).toBeNull();
    removeSessionFiles(d, "s1");
    expect(existsSync(join(sessionsDir(d), "s1.json"))).toBe(false);
    expect(readDelivered(d, "s1")).toBe(0);
    expect(readDelivered(d, "s1", "a1")).toBe(0);
    expect(readSessionState(d, "s2")).toEqual(s); // 다른 세션은 유지
    removeSessionFiles(d, "없는세션"); // 없어도 조용히
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("sid·agentId 경로 탈출 거부", () => {
  const d = mkdtempSync(join(tmpdir(), "nunchi-ss-"));
  try {
    writeSessionState(d, "../x", { rev: 1, topic: null });
    expect(existsSync(join(d, "x.json"))).toBe(false);
    expect(existsSync(join(sessionsDir(d), "..", "x.json"))).toBe(false);
    writeDelivered(d, "s1", "../y", 2);
    expect(existsSync(join(d, "y.delivered"))).toBe(false);
    expect(readDelivered(d, "s1", "../y")).toBe(0);
    expect(readSessionState(d, "../x")).toBeNull();
    removeSessionFiles(d, "../x"); // 무시
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
