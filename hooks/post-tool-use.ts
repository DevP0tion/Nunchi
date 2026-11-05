#!/usr/bin/env bun
// nunchi PostToolUse hook (Bun) — 대시보드에서 바뀐 주제를 턴 중간에 전달한다.
// 매 도구 호출 경로 — 소켓 없이 세션 상태 파일·delivered 파일만 읽는다.
import { hookProjectDir, loadConfig, readStdinJson, resolveDocDir } from "./config.ts";
import { TOPIC_CLEARED, formatTopicBlock } from "./topic.ts";
import { readDelivered, readSessionState, writeDelivered } from "../memory/session-state.ts";

const projectDir = hookProjectDir();
const input = await readStdinJson();
const sid = input.session_id;
if (!sid) process.exit(0);

try {
  const docDir = resolveDocDir(projectDir, loadConfig(projectDir));
  const state = readSessionState(docDir, sid);
  if (state && state.rev !== readDelivered(docDir, sid, input.agent_id)) {
    const block = state.topic ? formatTopicBlock(state.topic, true) : TOPIC_CLEARED;
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: block.slice(0, 8000) } })
    );
    writeDelivered(docDir, sid, input.agent_id, state.rev);
  }
} catch {
  /* 렌더링·기록 실패 — 다음 도구 호출에 다시 알린다 */
}
process.exit(0);
