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
  // 서브에이전트가 직접 nunchi_topic으로 바꾼 경우: MCP는 호출자를 몰라 메인 delivered를 갱신해 버린다 —
  // 호출한 에이전트는 이미 결과를 받았으므로 그쪽만 현재 rev로 맞추고, 메인은 다음 호출에서 알도록 되돌린다
  const act = input.tool_input?.action;
  if (state && input.agent_id && String(input.tool_name ?? "").endsWith("nunchi_topic") && (act === undefined || act === "set" || act === "clear")) {
    writeDelivered(docDir, sid, input.agent_id, state.rev);
    writeDelivered(docDir, sid, null, 0);
    process.exit(0);
  }
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
