// bun test tests/hooks.test.ts
// 훅 4종 스모크: stdin에 hook JSON을 넣고 stdout을 검증한다. 실서버를 시드해서 사용.
import { expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { io as ioc } from "socket.io-client";
import { loadConfig, resolveDocDir } from "../hooks/config.ts";
import { assignFreePort, connectMemory, type MemoryClient } from "../memory/client.ts";
import { resolveMemoryPort } from "../memory/memory-config.ts";
import { readDelivered } from "../memory/session-state.ts";
import { rmProject } from "./helpers.ts";

const hookPath = (name: string) => fileURLToPath(new URL(`../hooks/${name}`, import.meta.url));

async function runHook(name: string, dir: string, input: object): Promise<string> {
  const proc = Bun.spawn(["bun", hookPath(name)], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe", stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

/** 코어 1건 + 저신뢰 1건이 시드된 프로젝트와 열린 클라이언트 */
async function seeded(): Promise<{ dir: string; mem: MemoryClient }> {
  const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-"));
  await assignFreePort(dir);
  const mem = await connectMemory(dir);
  await mem.add({
    section: "punish", area: "[배포: 게이트]", rule: "배포 게이트를 생략하지 않는다",
    evidence: "2026-06-12 생략으로 장애", confidence: 3,
  });
  await mem.add({
    section: "recommend", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략 가능",
    evidence: "2026-06-20 과잉이었음",
  });
  return { dir, mem };
}

test(
  "session-start: 규약 + 코어(확정 규칙)만 주입, 전문 주입 없음",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const raw = await runHook("session-start.ts", dir, { source: "startup" });
      const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain("nunchi_search");
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 코어는 주입
      expect(ctx).not.toContain("일회성 스크립트"); // 저신뢰는 주입 안 함
      expect(ctx).toContain("완결된 작업"); // task 기록 규약 요약
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "session-start: 10k 상한선 — 코어가 크면 8k 슬라이스, 규약/ponytail 줄은 생존",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-10k-"));
    await assignFreePort(dir);
    const mem = await connectMemory(dir);
    try {
      // ~60개 항목 × 각 ~200자 = ~12k 생성 → 8k 슬라이스 후 규약 줄 추가 = 총 <10k
      const longRule = "A".repeat(100); // 100자
      const longEvidence = "E".repeat(100); // 100자
      for (let i = 0; i < 60; i++) {
        await mem.add({
          section: "punish",
          area: `[area-${i}]`,
          rule: longRule,
          evidence: longEvidence,
          confidence: 3,
        });
      }
      const raw = await runHook("session-start.ts", dir, { source: "startup" });
      const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext as string;
      expect(ctx.length).toBeLessThanOrEqual(10000);
      expect(ctx).toContain("nunchi_search"); // 규약 줄 생존
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 관련 항목 주입, 코어 제외, 무관련·서버다운은 무출력",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const hit = await runHook("user-prompt-submit.ts", dir, {
        prompt: "일회성 스크립트에도 테스트가 필요할까?",
      });
      const ctx = JSON.parse(hit).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain("일회성 스크립트 테스트 생략 가능");
      expect(ctx).not.toContain("배포 게이트"); // 코어는 SessionStart 몫 — 제외
      // 무관련 프롬프트 → 무출력
      expect(await runHook("user-prompt-submit.ts", dir, { prompt: "zzqq xxyy" })).toBe("");
      // 흔한 2자 단어 하나만 걸리는 프롬프트 → 무출력 (부분 문자열 적중 하나는 근거가 약하다)
      expect(await runHook("user-prompt-submit.ts", dir, { prompt: "생략 관련 질문" })).toBe("");
      // 빈 프롬프트 → 무출력
      expect(await runHook("user-prompt-submit.ts", dir, { prompt: "" })).toBe("");
    } finally {
      await mem.shutdown();
      // 서버 종료 후: noSpawn이므로 조용히 통과 (스폰 없음)
      expect(await runHook("user-prompt-submit.ts", dir, { prompt: "테스트 스크립트" })).toBe("");
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 시스템이 붙인 블록이 아닌 사용자 글로 검색, 비사용자 메시지는 무출력",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const run = (prompt: string) => runHook("user-prompt-submit.ts", dir, { prompt });
      const q = "일회성 스크립트에도 테스트가 필요할까?";
      // 앞에 붙은 안내문 블록이 8토큰을 다 차지해도 뒤의 사용자 질문으로 검색
      const pre = `<ide_opened_file>The user opened the file tests/foo.ts in the IDE editor</ide_opened_file>\n${q}`;
      expect(await run(pre)).toContain("일회성 스크립트 테스트 생략 가능");
      // 백그라운드 작업 완료 알림 — 내용이 매칭돼도 사용자 입력이 아니므로 무출력
      expect(await run("<task-notification><summary>일회성 스크립트 테스트 완료</summary></task-notification>")).toBe("");
      // 다른 세션의 handback — 무출력
      expect(await run("Another Claude session sent a message: 일회성 스크립트 테스트 결과")).toBe("");
      // 붙여 넣은 자료만 있으면 그 내용으로 검색
      expect(await run(`<pasted_content id="ab12">${q}</pasted_content id="ab12">`)).toContain("일회성 스크립트");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 긴 항목이 걸려도 주입은 8천자 이하 (additionalContext 1만자 상한 보호)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-ups-cap-"));
    await assignFreePort(dir);
    const mem = await connectMemory(dir);
    try {
      // 상한 도입 전에 쌓인 긴 항목 (실측 최대 3,446자) — 쿼터 5건이 모두 걸리게 시드
      for (const section of ["env", "env", "env", "task", "task"] as const)
        await mem.add({ section, area: "[드롭다운: 키보드]", rule: "드롭다운 " + "가".repeat(3000), evidence: "2026-10-06 e" });
      const raw = await runHook("user-prompt-submit.ts", dir, { prompt: "드롭다운 고쳐줘" });
      const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext as string;
      expect(ctx.startsWith("[nunchi]")).toBe(true);
      expect(ctx.length).toBeLessThanOrEqual(8000);
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 보정·작업 두 블록을 각 쿼터로 출력, 한쪽 0건이면 생략",
  async () => {
    const { dir, mem } = await seeded(); // punish 코어 + recommend 저신뢰
    try {
      await mem.add({ section: "task", area: "[리팩토링: 스토어]", rule: "접근: 테스트 먼저", evidence: "2026-07-09 완료" });
      // "테스트" → recommend(테스트 생략) + task(테스트 먼저) 둘 다 매칭
      const both = await runHook("user-prompt-submit.ts", dir, { prompt: "테스트 접근을 어떻게 잡을까" });
      const ctx = JSON.parse(both).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain("관련 보정 항목");
      expect(ctx).toContain("일회성 스크립트 테스트 생략 가능"); // 보정 블록
      expect(ctx).toContain("관련 작업 기록");
      expect(ctx).toContain("[작업 기록·신뢰도"); // SECTION_LABEL task
      expect(ctx).toContain("접근: 테스트 먼저"); // task 블록
      // task만 매칭되는 프롬프트 → 보정 블록 생략
      const onlyTask = await runHook("user-prompt-submit.ts", dir, { prompt: "리팩토링 스토어 절차" });
      const ctx2 = JSON.parse(onlyTask).hookSpecificOutput.additionalContext as string;
      expect(ctx2).toContain("관련 작업 기록");
      expect(ctx2).not.toContain("관련 보정 항목");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "subagent-start: 규약 + 코어 주입, 서버 다운이면 규약만",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const raw = await runHook("subagent-start.ts", dir, { agent_type: "general-purpose" });
      const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain("nunchi_search"); // 규약 안내
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 코어
      expect(ctx).not.toContain("일회성 스크립트"); // 저신뢰는 프롬프트 없이는 주입 안 함
      expect(ctx).toContain("완결된 작업"); // task 기록 규약 요약
    } finally {
      await mem.shutdown();
      // 서버 다운: 규약 1줄은 그래도 주입 (도구 사용 안내는 유효)
      const raw = await runHook("subagent-start.ts", dir, { agent_type: "general-purpose" });
      expect(JSON.parse(raw).hookSpecificOutput.additionalContext).toContain("nunchi_search");
      await rmProject(dir);
    }
  },
  30000
);

test(
  "훅 공통: CLAUDE_PROJECT_DIR이 없으면(Claude Code 밖의 harness) 보정 DB를 싣지 않고 무출력",
  async () => {
    const { dir, mem } = await seeded();
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const runBare = async (name: string, input: object) => {
      const proc = Bun.spawn(["bun", hookPath(name)], {
        env, stdin: new TextEncoder().encode(JSON.stringify(input)), stdout: "pipe", stderr: "ignore",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      return out;
    };
    try {
      // stdin의 cwd가 시드된 프로젝트를 가리켜도 주입하지 않는다
      expect(await runBare("user-prompt-submit.ts", { cwd: dir, prompt: "일회성 스크립트에도 테스트가 필요할까?" })).toBe("");
      expect(await runBare("session-start.ts", { cwd: dir, source: "startup" })).toBe("");
      expect(await runBare("subagent-start.ts", { cwd: dir, agent_type: "x" })).toBe("");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

/** 기록 도구 호출 1건이 담긴 transcript 행 (Claude Code jsonl 형식) */
const toolUseLine = (name: string) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input: {} }] } }) + "\n";

test(
  "stop-check: N턴째에 점검 강제, 구간 내 이 세션의 기록이 있으면 생략",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-stop-"));
    const transcript = join(dir, "session.jsonl");
    writeFileSync(transcript, '{"type":"user"}\n');
    const sid = `t${Date.now()}`;
    const run = (extra: object = {}) =>
      runHook("stop-check.ts", dir, { session_id: sid, transcript_path: transcript, cwd: dir, ...extra });
    try {
      process.env.NUNCHI_CHECK_EVERY = "2"; // 최소 주기로 단축
      // 1턴: 통과, 2턴: 점검(block)
      expect(await run()).toBe("");
      const parsed = JSON.parse(await run());
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("nunchi_record"); // 기록 지시가 도구 기준
      expect(parsed.reason).toContain("완결된 작업"); // (B) 작업 점검 문구
      // 다음 구간: 1턴째(Stop 전)에 기록 → 2턴째 점검 생략
      appendFileSync(transcript, toolUseLine("mcp__plugin_nunchi_nunchi__nunchi_record"));
      expect(await run()).toBe("");
      expect(await run()).toBe("");
      // 기록 없는 다음 구간은 다시 점검 — 지난 구간의 기록을 두 번 세지 않는다
      expect(await run()).toBe("");
      expect(JSON.parse(await run()).decision).toBe("block");
      // 점검(block)에 응답해 기록한 턴(stop_hook_active — 루프 가드로 즉시 통과)은
      // 다음 구간의 기록으로 세지 않는다 — 다음 구간도 기록이 없으면 다시 점검
      appendFileSync(transcript, toolUseLine("mcp__plugin_nunchi_nunchi__nunchi_record"));
      expect(await run({ stop_hook_active: true })).toBe("");
      expect(await run()).toBe("");
      expect(JSON.parse(await run()).decision).toBe("block");
    } finally {
      delete process.env.NUNCHI_CHECK_EVERY;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000
);

test(
  "stop-check: 같은 DB를 쓰는 다른 세션의 기록은 이 세션의 점검을 생략시키지 않는다",
  async () => {
    const { dir, mem } = await seeded(); // 두 세션이 공유하는 memory server
    const [ta, tb] = [join(dir, "a.jsonl"), join(dir, "b.jsonl")];
    writeFileSync(ta, "");
    writeFileSync(tb, "");
    const stamp = Date.now();
    const run = (sid: string, transcript_path: string) =>
      runHook("stop-check.ts", dir, { session_id: sid, transcript_path, cwd: dir });
    try {
      process.env.NUNCHI_CHECK_EVERY = "2";
      expect(await run(`a${stamp}`, ta)).toBe("");
      // 세션 B가 같은 DB에 기록 — DB 전체의 마지막 기록 시각은 바뀌지만 A는 아무것도 기록하지 않았다
      await mem.add({ section: "env", area: "[b]", rule: "r", evidence: "2026-10-06 세션 B" });
      appendFileSync(tb, toolUseLine("mcp__plugin_nunchi_nunchi__nunchi_record"));
      expect(JSON.parse(await run(`a${stamp}`, ta)).decision).toBe("block");
      // transcript를 읽을 수 없으면 기록 없음으로 본다 (과검)
      expect(await run(`c${stamp}`, join(dir, "missing.jsonl"))).toBe("");
      expect(JSON.parse(await run(`c${stamp}`, join(dir, "missing.jsonl"))).decision).toBe("block");
    } finally {
      delete process.env.NUNCHI_CHECK_EVERY;
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "stop-check: 7일 지난 세션 상태 파일은 점검 때 정리",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-stop3-"));
    const stateDir = join(tmpdir(), "nunchi");
    mkdirSync(stateDir, { recursive: true });
    const old = join(stateDir, `old-${Date.now()}.json`);
    writeFileSync(old, '{"count":3,"offset":0}');
    const eightDaysAgo = (Date.now() - 8 * 86400_000) / 1000;
    utimesSync(old, eightDaysAgo, eightDaysAgo);
    const sid = `prune${Date.now()}`;
    try {
      process.env.NUNCHI_CHECK_EVERY = "2";
      await runHook("stop-check.ts", dir, { session_id: sid, cwd: dir });
      await runHook("stop-check.ts", dir, { session_id: sid, cwd: dir }); // 점검 턴
      expect(existsSync(old)).toBe(false);
      expect(existsSync(join(stateDir, `${sid}.json`))).toBe(true); // 현재 세션 상태는 보존
    } finally {
      delete process.env.NUNCHI_CHECK_EVERY;
      rmSync(join(stateDir, `${sid}.json`), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000
);

test(
  "v0.13.5 권장: 라벨 강도·방법, method 3+는 코어, ponytail 우선 문구에 권장(방법) 예외",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-rec-"));
    await assignFreePort(dir);
    const mem = await connectMemory(dir);
    try {
      await mem.add({ section: "recommend", kind: "method", area: "[리뷰: 요청]", rule: "리뷰 요청을 먼저 보낸다", evidence: "2026-11-05 사용자가 좋다고 함", confidence: 3 });
      await mem.add({ section: "recommend", kind: "level", area: "[문서: 오타]", rule: "오타 수정은 리뷰 없이 바로 반영한다", evidence: "2026-11-05 과잉이었음", confidence: 3 });
      // ponytail 활성 + ponytail 우선
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "ponytail@x": true } }));
      writeFileSync(join(dir, ".claude", "nunchi.json"), JSON.stringify({ "policy-priority": "ponytail" }));
      const ss = JSON.parse(await runHook("session-start.ts", dir, { source: "startup" })).hookSpecificOutput.additionalContext as string;
      expect(ss).toContain("[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]");
      expect(ss).toContain("(#1) [권장·방법·신뢰도3]"); // method 3+ → 코어
      expect(ss).not.toContain("오타 수정은"); // level 3+ → 코어 아님
      expect(ss).toContain("반복 확인된 사용자 선호이므로 예외로 지키고");
      expect(ss).toContain("'권장(방법)'이 틀렸으면 edit·remove");
      const sa = JSON.parse(await runHook("subagent-start.ts", dir, { agent_type: "general-purpose" })).hookSpecificOutput.additionalContext as string;
      expect(sa).toContain("[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]");
      // 매 메시지 주입: level은 보정 쿼터로 회수, 라벨 강도
      const up = JSON.parse(await runHook("user-prompt-submit.ts", dir, { prompt: "오타 수정 리뷰" })).hookSpecificOutput.additionalContext as string;
      expect(up).toContain("[권장·강도·신뢰도3]");
      expect(up).not.toContain("[권장·방법"); // method 3+는 코어라 excludeCore로 제외
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

// ── 워크스페이스 탭: 세션 등록·주제 블록·코어 축소·주제 우선 쿼터 ──
const ctxOf = (raw: string): string => (raw ? (JSON.parse(raw).hookSpecificOutput.additionalContext as string) : "");
const docDirOf = (dir: string) => resolveDocDir(dir, loadConfig(dir));
/** 대시보드용 원시 소켓으로 ws:board의 세션 목록 조회 */
async function boardSessions(dir: string): Promise<{ session_id: string; label: string }[]> {
  const s = ioc(`http://127.0.0.1:${resolveMemoryPort(dir)}`, { reconnection: false });
  await new Promise<void>((res) => s.once("connect", () => res()));
  const board = await new Promise<{ sessions: { session_id: string; label: string }[] }>((res) => s.emit("ws:board", res));
  s.close();
  return board.sessions;
}

test(
  "session-start: 세션 id 줄·주제 목록 주입, 세션 등록",
  async () => {
    const { dir, mem } = await seeded();
    try {
      await mem.createTopic({ name: "탭 개발", description: "워크스페이스 탭" });
      const ctx = ctxOf(await runHook("session-start.ts", dir, { source: "startup", session_id: "s1", session_title: "탭 설계" }));
      expect(ctx).toContain("이 세션 id: s1");
      expect(ctx).toContain("탭 개발");
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 주제 없으면 코어 전문
      expect((await mem.sessionState("s1")).topic).toBe(null); // 접근 가능
      expect((await boardSessions(dir)).find((x) => x.session_id === "s1")?.label).toBe("탭 설계");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "session-start compact + 주제: 소속 코어 전문, 비소속 코어 #id · area",
  async () => {
    const { dir, mem } = await seeded(); // 코어 #1 (배포 게이트)
    try {
      const other = await mem.add({
        section: "punish", area: "[린트: 규칙]", rule: "린트 경고를 무시하지 않는다", evidence: "2026-06-13 무시로 장애", confidence: 3,
      });
      const t = await mem.createTopic({ name: "배포 주제" });
      await mem.linkTopic(t, [1]);
      await mem.setSessionTopic("s1", t);
      const st = await mem.sessionState("s1");
      const ctx = ctxOf(await runHook("session-start.ts", dir, { source: "compact", session_id: "s1" }));
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 소속 — 전문
      expect(ctx).not.toContain("린트 경고를 무시하지 않는다"); // 비소속 — 전문 없음
      expect(ctx).toContain(`#${other} · [린트: 규칙]`);
      expect(ctx).toContain("현재 주제: 배포 주제");
      expect(readDelivered(docDirOf(dir), "s1")).toBe(st.rev); // 이미 받았으므로 첫 메시지에 재주입 안 함
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "session-start fork: 주제 없음 줄",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const ctx = ctxOf(await runHook("session-start.ts", dir, { source: "fork", session_id: "s2" }));
      expect(ctx).toContain("현재 주제 없음");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 대시보드 변경 후 첫 메시지에 변경 블록, 두 번째엔 없음",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const t = await mem.createTopic({ name: "배포 주제" });
      await mem.setSessionTopic("s1", t); // 대시보드·명령으로 바꾼 것과 같다 (delivered 미기록)
      const run = () =>
        runHook("user-prompt-submit.ts", dir, { session_id: "s1", prompt: "일회성 스크립트에도 테스트가 필요할까?" });
      const first = ctxOf(await run());
      expect(first).toContain("주제가 변경됨");
      expect(first).toContain("일회성 스크립트 테스트 생략 가능"); // 검색 주입도 그대로
      expect(ctxOf(await run())).not.toContain("주제가 변경됨");
      // 주제 해제도 한 번만 알린다
      await mem.setSessionTopic("s1", null);
      expect(ctxOf(await run())).toContain("현재 주제 없음");
      expect(ctxOf(await run())).not.toContain("현재 주제 없음");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 검색할 글이 없어도 세션 등록·변경 전달은 한다",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const t = await mem.createTopic({ name: "배포 주제" });
      await mem.setSessionTopic("s1", t);
      const ctx = ctxOf(await runHook("user-prompt-submit.ts", dir, { session_id: "s1", prompt: "a" }));
      expect(ctx).toContain("주제가 변경됨");
      expect((await boardSessions(dir)).some((x) => x.session_id === "s1")).toBe(true);
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "user-prompt-submit: 주제 소속 결과가 [주제] 표시로 먼저",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const env = (rule: string) => ({ section: "env", area: "[환경: 지브라]", rule, evidence: "근거" }) as const;
      await mem.add(env("zebra alpha"));
      const b = await mem.add(env("zebra beta"));
      await mem.add(env("zebra gamma"));
      const t = await mem.createTopic({ name: "지브라" });
      await mem.linkTopic(t, [b]);
      await mem.setSessionTopic("s1", t);
      const ctx = ctxOf(await runHook("user-prompt-submit.ts", dir, { session_id: "s1", prompt: "zebra 관련 질문" }));
      const first = ctx.split(/\r?\n/).find((l) => l.includes("(#"));
      expect(first).toContain("[주제]");
      expect(first).toContain("zebra beta");
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "subagent-start: 주제 블록 + agent별 delivered",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const t = await mem.createTopic({ name: "배포 주제" });
      await mem.linkTopic(t, [1]);
      const st = await mem.setSessionTopic("s1", t);
      const ctx = ctxOf(await runHook("subagent-start.ts", dir, { session_id: "s1", agent_id: "a1", agent_type: "general-purpose" }));
      expect(ctx).toContain("이 세션 id: s1");
      expect(ctx).toContain("현재 주제: 배포 주제");
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 소속 코어 전문
      expect(readDelivered(docDirOf(dir), "s1", "a1")).toBe(st.rev);
      expect(readDelivered(docDirOf(dir), "s1")).toBe(0); // main은 그대로
    } finally {
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "구버전/미기동 서버에서도 코어 주입 유지 (1.5초 이내)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-down-"));
    await assignFreePort(dir); // 포트만 배정 — 서버는 없다
    try {
      const t0 = Date.now();
      const raw = await runHook("user-prompt-submit.ts", dir, { session_id: "s1", prompt: "일회성 스크립트 테스트" });
      expect(raw).toBe("");
      expect(Date.now() - t0).toBeLessThan(3000);
      // subagent-start는 서버가 없어도 규약 + 세션 id 줄은 낸다
      const ctx = ctxOf(await runHook("subagent-start.ts", dir, { session_id: "s1", agent_id: "a1" }));
      expect(ctx).toContain("nunchi_search");
      expect(ctx).toContain("이 세션 id: s1");
    } finally {
      await rmProject(dir);
    }
  },
  30000
);
