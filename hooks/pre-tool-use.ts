#!/usr/bin/env bun
// nunchi PreToolUse hook (Bun) — 편집 대상이 현재 주제의 작업공간 밖이면 경고만 주입한다 (차단 없음).
// 매 도구 호출 경로 — 소켓 없이 세션 상태 파일만 읽는다.
// shortcut: Bash 경유 수정은 검사하지 않음, 필요해지면 Bash 명령 파싱 추가
import { hookProjectDir, loadConfig, readStdinJson, resolveDocDir } from "./config.ts";
import { inWorkspace } from "./topic.ts";
import { readSessionState } from "../memory/session-state.ts";

const projectDir = hookProjectDir();
const input = await readStdinJson();
const sid = input.session_id;
if (!sid) process.exit(0);

try {
  const ti = input.tool_input ?? {};
  const file = String(ti.file_path || ti.notebook_path || ""); // 빈 file_path도 notebook_path로 대체
  const topic = readSessionState(resolveDocDir(projectDir, loadConfig(projectDir)), sid)?.topic;
  if (file && topic?.folders.length && !inWorkspace(projectDir, topic.folders, file)) {
    const context = `[nunchi] 경고: ${file}는 현재 주제 '${topic.name}'의 작업공간 밖이다 (${topic.folders.join(", ")}). 의도한 작업이면 사용자에게 알린다.`;
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context.slice(0, 8000) } })
    );
  }
} catch {
  /* 상태 파일 형식 불일치 등 — 조용히 통과 */
}
process.exit(0);
