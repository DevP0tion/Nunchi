#!/usr/bin/env bun
// nunchi UserPromptSubmit hook (Bun)
// 프롬프트 어절로 보정 DB를 검색해 관련 항목만 조용히 주입한다.
// 매 메시지 경로 — 서버 미기동이면 스폰하지 않고 즉시 통과한다 (noSpawn).
// 코어(벌주는 것 3+)는 SessionStart가 이미 주입했으므로 제외(excludeCore).
import { readStdinJson, formatMemoryEntries, hookProjectDir } from "./config.ts";

const projectDir = hookProjectDir();
const input = await readStdinJson();
const raw = String(input.prompt ?? input.user_input ?? "");
// 다른 세션의 handback은 사용자 입력이 아니다
if (/^\s*Another Claude session/.test(raw)) process.exit(0);
// Claude Code가 붙인 태그 블록(<task-notification>, <ide_opened_file>, <browser_instruction> …)은
// 사용자 글이 아니다 — 지우고 남은 글로 검색한다. <pasted_content>도 함께 지워지므로
// 직접 친 글이 하나도 없을 때만 붙여 넣은 자료로 검색한다
const pasted = [...raw.matchAll(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g)]
  .map((m) => m[1]).join("\n");
const prompt = (raw.replace(/<([\w-]+)[^>]*>[\s\S]*?<\/\1[^>]*>/g, " ").trim() || pasted).trim();
if (!prompt) process.exit(0);

// 토큰화: 문자·숫자 연속만, 2자 이상, 중복 제거, 등장 순 최대 8개
const tokens = [...new Set(prompt.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))].slice(0, 8);
if (!tokens.length) process.exit(0);

try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    // 쿼터 분리: 모든 작업을 기록하면 task가 보정 항목보다 빠르게 늘어난다 —
    // 단일 검색에 섞으면 보정 회수가 밀리므로 3(보정)+2(작업) 고정 쿼터로 나눈다.
    // strict: 매 메시지 자동 주입은 정밀도 우선 — 흔한 2자 단어 하나로는 주입하지 않는다
    const [cal, tasks] = await Promise.all([
      mem.search(tokens, { limit: 3, excludeCore: true, sections: ["punish", "forgive", "env"], strict: true }),
      mem.search(tokens, { limit: 2, sections: ["task"], strict: true }),
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
            // ponytail: 하드 슬라이스 — additionalContext는 1만자를 넘으면 파일로 빠지고 2천자 미리보기만
            // 남는다. 새 기록은 MCP 스키마가 필드 길이를 묶으므로, 상한 전에 쌓인 긴 항목만 잘린다
            additionalContext: blocks.join("\n").slice(0, 8000),
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
