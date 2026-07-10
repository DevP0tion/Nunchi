// bun test tests/hooks.test.ts
// 훅 4종 스모크: stdin에 hook JSON을 넣고 stdout을 검증한다. 실서버를 시드해서 사용.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
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
  "stop-check: N턴째에 점검 강제, 구간 내 DB 기록이 있으면 생략",
  async () => {
    const { dir, mem } = await seeded();
    const sid = `t${Date.now()}`;
    const run = (id: string) => runHook("stop-check.ts", dir, { session_id: id, cwd: dir });
    try {
      process.env.NUNCHI_CHECK_EVERY = "2"; // 최소 주기로 단축
      // 1턴: 통과, 2턴: 점검(block)
      expect(await run(sid)).toBe("");
      const out = await run(sid);
      const parsed = JSON.parse(out);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("nunchi_record"); // 기록 지시가 도구 기준
      expect(parsed.reason).toContain("완결된 작업"); // (B) 작업 점검 문구
      // 다음 구간: 1턴째에 기록 발생 → 2턴째 점검 생략
      expect(await run(sid)).toBe("");
      await mem.add({ section: "env", area: "[x]", rule: "r", evidence: "2026-07-06 e" });
      expect(await run(sid)).toBe("");
      // stop_hook_active 가드
      const guarded = await runHook("stop-check.ts", dir, {
        session_id: sid, cwd: dir, stop_hook_active: true,
      });
      expect(guarded).toBe("");
    } finally {
      delete process.env.NUNCHI_CHECK_EVERY;
      await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);

test(
  "stop-check: null 기준선(서버 미접속 턴1) → 서버 접속(턴2) 시 과검 강제",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-null-baseline-"));
    const sid = `null-baseline-${Date.now()}`;
    const run = (id: string) => runHook("stop-check.ts", dir, { session_id: id, cwd: dir });
    let mem: MemoryClient | null = null;
    try {
      process.env.NUNCHI_CHECK_EVERY = "2"; // 최소 주기
      await assignFreePort(dir); // 포트 할당

      // Turn 1: 서버 미접속 → stamp=null, state.stamp=null
      expect(await run(sid)).toBe("");

      // 서버 기동: 기존 항목 1개 있음 (DB 구성하되 서버는 계속 켜 둠)
      mem = await connectMemory(dir);
      await mem.add({
        section: "punish", area: "[setup]", rule: "baseline-entry",
        evidence: "2026-07-06 pre-exist", confidence: 2,
      });

      // Turn 2: 서버는 접속 가능하지만 baseline은 여전히 null
      // stamp는 변하지 않음 (새 항목 없음), 하지만 state.stamp=null이므로
      // 기록이 없다고 판단 → block=true (과검)
      const out = await run(sid);
      const parsed = JSON.parse(out);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("nunchi_record");
    } finally {
      delete process.env.NUNCHI_CHECK_EVERY;
      if (mem) await mem.shutdown();
      await rmProject(dir);
    }
  },
  30000
);
