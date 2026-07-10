#!/usr/bin/env bun
// nunchi UserPromptSubmit hook (Bun)
// 프롬프트 어절로 보정 DB를 검색해 관련 항목만 조용히 주입한다.
// 매 메시지 경로 — 서버 미기동이면 스폰하지 않고 즉시 통과한다 (noSpawn).
// 코어(벌주는 것 3+)는 SessionStart가 이미 주입했으므로 제외(excludeCore).
import { readStdinJson, formatMemoryEntries } from "./config.ts";

const input = await readStdinJson();
const prompt = String(input.prompt ?? input.user_input ?? "").trim();
if (!prompt) process.exit(0);

// 토큰화: 문자·숫자 연속만, 2자 이상, 중복 제거, 등장 순 최대 8개
const tokens = [...new Set(prompt.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))].slice(0, 8);
if (!tokens.length) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    // 쿼터 분리: 모든 작업을 기록하면 task가 보정 항목보다 빠르게 늘어난다 —
    // 단일 검색에 섞으면 보정 회수가 밀리므로 3(보정)+2(작업) 고정 쿼터로 나눈다
    const [cal, tasks] = await Promise.all([
      mem.search(tokens, { limit: 3, excludeCore: true, sections: ["punish", "forgive", "env"] }),
      mem.search(tokens, { limit: 2, sections: ["task"] }),
    ]);
    const blocks: string[] = [];
    if (cal.length) blocks.push(`[nunchi] 이번 요청 관련 보정 항목:\n${formatMemoryEntries(cal)}`);
    if (tasks.length)
      blocks.push(
        `[nunchi] 이번 요청 관련 작업 기록 (유사 작업 플레이북 — 절차가 실제와 다르면 nunchi_update로 교정할 것):\n${formatMemoryEntries(tasks)}`
      );
    if (blocks.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: blocks.join("\n"),
          },
        })
      );
    }
  } finally {
    mem.close();
  }
} catch {
  /* 서버 미기동·타임아웃 — 조용히 통과, 세션을 막지 않는다 */
}
process.exit(0);
