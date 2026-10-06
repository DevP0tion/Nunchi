// bun test tests/hooks.test.ts
// 훅 4종 스모크: stdin에 hook JSON을 넣고 stdout을 검증한다. 실서버를 시드해서 사용.
import { expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignFreePort, connectMemory, type MemoryClient } from "../memory/client.ts";
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
    section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략 가능",
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
    const { dir, mem } = await seeded(); // punish 코어 + forgive 저신뢰
    try {
      await mem.add({ section: "task", area: "[리팩토링: 스토어]", rule: "접근: 테스트 먼저", evidence: "2026-07-09 완료" });
      // "테스트" → forgive(테스트 생략) + task(테스트 먼저) 둘 다 매칭
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
