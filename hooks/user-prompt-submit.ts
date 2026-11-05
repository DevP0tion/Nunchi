#!/usr/bin/env bun
// nunchi UserPromptSubmit hook (Bun)
// 프롬프트 어절로 보정 DB를 검색해 관련 항목만 조용히 주입한다.
// 매 메시지 경로 — 서버 미기동이면 스폰하지 않고 즉시 통과한다 (noSpawn).
// 코어(벌주는 것 3+)는 SessionStart가 이미 주입했으므로 제외(excludeCore).
import { readStdinJson, formatMemoryEntries, hookProjectDir, loadConfig, resolveDocDir } from "./config.ts";
import { TOPIC_CLEARED, formatTopicBlock } from "./topic.ts";
import { readDelivered, writeDelivered } from "../memory/session-state.ts";

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
const sid = input.session_id;
// 세션 id가 없으면 기존 동작 — 검색할 글이 없으면 통과. 있으면 등록·변경 전달은 글이 없어도 한다
if (!prompt && !sid) process.exit(0);

// 토큰화: 문자·숫자 연속만, 2자 이상, 중복 제거, 등장 순 최대 8개
const tokens = [...new Set(prompt.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))].slice(0, 8);
if (!tokens.length && !sid) process.exit(0);

try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    const blocks: string[] = [];
    let topicId: number | undefined;
    // ws:* 실패(구버전 서버·타임아웃)는 코어·검색 주입을 막지 않는다
    if (sid) {
      // 동시 호출: 구버전 서버는 ws:*에 응답하지 않아 순차면 1.5초씩 쌓인다. 소켓은 emit 순서를 보존하고
      // 서버 ws 핸들러는 동기라 등록이 조회보다 먼저 반영된다. 등록 실패는 무시, 조회 실패는 주제 없음 취급
      const [, st] = await Promise.allSettled([
        mem.registerSession({ sessionId: sid, title: input.session_title, cwd: input.cwd, prompt: prompt || undefined }),
        mem.sessionState(sid),
      ]);
      if (st.status === "fulfilled") {
        const { rev, topic } = st.value;
        topicId = topic?.id;
        try {
          const docDir = resolveDocDir(projectDir, loadConfig(projectDir));
          if (rev !== readDelivered(docDir, sid)) {
            blocks.push(topic ? formatTopicBlock(topic, true) : TOPIC_CLEARED);
            writeDelivered(docDir, sid, null, rev);
          }
        } catch { /* 렌더링·기록 실패 — 다음 메시지에 다시 알린다 */ }
      }
    }
    if (tokens.length) {
      try {
        // 쿼터 분리: 모든 작업을 기록하면 task가 보정 항목보다 빠르게 늘어난다 —
        // 단일 검색에 섞으면 보정 회수가 밀리므로 3(보정)+2(작업) 고정 쿼터로 나눈다.
        // strict: 매 메시지 자동 주입은 정밀도 우선 — 흔한 2자 단어 하나로는 주입하지 않는다
        // topicId: 주제 소속을 먼저 채운다 (소속 행은 topic: true)
        const t = topicId != null ? { topicId } : {};
        const [cal, tasks] = await Promise.all([
          mem.search(tokens, { limit: 3, excludeCore: true, sections: ["punish", "recommend", "env"], strict: true, ...t }),
          mem.search(tokens, { limit: 2, sections: ["task"], strict: true, ...t }),
        ]);
        const fmt = (rows: typeof cal) =>
          rows.map((r) => { const l = formatMemoryEntries([r]); return r.topic ? l.replace(/^- /, "- [주제] ") : l; }).join("\n");
        if (cal.length) blocks.push(`[nunchi] 이번 요청 관련 보정 항목:\n${fmt(cal)}`);
        if (tasks.length)
          blocks.push(
            `[nunchi] 이번 요청 관련 작업 기록 (유사 작업 플레이북 — 절차가 실제와 다르면 nunchi_update로 교정할 것):\n${fmt(tasks)}`
          );
      } catch { /* 검색 실패 — 주제 블록만이라도 내보낸다 */ }
    }
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
