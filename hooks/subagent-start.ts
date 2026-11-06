#!/usr/bin/env bun
// nunchi SubagentStart hook (Bun)
// 서브에이전트는 SessionStart 주입을 받지 못한다 — 규약 1줄 + 코어를 대신 주입한다.
// 공식 스키마상 stdin에 서브에이전트 프롬프트는 없다(agent_type/agent_id만) — 관련 항목 검색은 하지 않는다.
import { hookProjectDir, loadConfig, readStdinJson, resolveDocDir, type MemoryEntryLite } from "./config.ts";
import { fitTopicBlock, formatCoreBlock, sessionIdLine } from "./topic.ts";
import { writeDelivered } from "../memory/session-state.ts";

const projectDir = hookProjectDir();
const input = await readStdinJson();
const sid = input.session_id;
const docDir = () => resolveDocDir(projectDir, loadConfig(projectDir));

const lines = [
  "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다. 작업 강도 판단이 애매하면 nunchi_search(유의어 확장 쿼리)·nunchi_list 도구로 보정 항목을 조회하고, 예측-실제 불일치(예측 어긋남)는 nunchi_record로 기록한다.",
  "작업 기록 규약: 완결된 작업(산출물이 남는 요청 단위)을 마무리하면 nunchi_search로 유사 task 항목을 찾아 edit(절차 교정)/confirm(재확인), 없으면 nunchi_record(section: task)로 기록한다.",
  "확신 없는 어긋남 의심은 nunchi_record(section: observe)로 관찰만 남긴다 (자동 회수 제외).",
];

// 세션 id 줄·주제 블록은 합쳐서 2500자로 묶고 코어는 8000에서 그만큼 뺀다 (additionalContext 1만자 상한 보호)
const head: string[] = sid ? [sessionIdLine(sid)] : [];
let topicMembers: number[] | null = null;
let core: MemoryEntryLite[] = [];
try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    core = await mem.core();
    // ws:* 실패(구버전 서버·타임아웃)는 주제 없음으로 취급 — 코어는 그대로 나간다
    if (sid) {
      try {
        const { rev, topic, memberIds } = await mem.sessionState(sid);
        if (topic) {
          // 영역 줄을 줄여 2500 안에 맞춘다 — 끝의 하드 슬라이스가 줄 중간을 자르지 않게
          head.push(fitTopicBlock(topic, 2500 - head.join("\n").length - 1));
          topicMembers = memberIds;
        }
        // 주제가 없어도 기록한다 — 이후 PostToolUse가 "주제 없음"을 다시 알리지 않게. agent_id가 없으면 main 파일을 덮어쓰므로 기록하지 않는다
        if (input.agent_id) writeDelivered(docDir(), sid, input.agent_id, rev);
      } catch { /* 주제 조회·기록 실패 — 주제 없음 */ }
    }
  } finally {
    mem.close();
  }
} catch {
  /* 서버 미기동 — 규약 안내만 주입 */
}
const extra = head.join("\n").slice(0, 2500);
if (extra) lines.push(extra);
if (core.length) {
  // ponytail: 하드 슬라이스 — session-start와 동일하게 8천자 캡 (additionalContext 상한 보호)
  lines.push("", formatCoreBlock(core, topicMembers).slice(0, Math.max(0, 8000 - extra.length)));
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: lines.join("\n"),
    },
  })
);
process.exit(0);
