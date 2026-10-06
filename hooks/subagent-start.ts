#!/usr/bin/env bun
// nunchi SubagentStart hook (Bun)
// 서브에이전트는 SessionStart 주입을 받지 못한다 — 규약 1줄 + 코어를 대신 주입한다.
// 공식 스키마상 stdin에 서브에이전트 프롬프트는 없다(agent_type/agent_id만) — 관련 항목 검색은 하지 않는다.
import { formatMemoryEntries, hookProjectDir, type MemoryEntryLite } from "./config.ts";

const projectDir = hookProjectDir();

const lines = [
  "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다. 작업 강도 판단이 애매하면 nunchi_search(유의어 확장 쿼리)·nunchi_list 도구로 보정 항목을 조회하고, 예측-실제 불일치(예측 어긋남)는 nunchi_record로 기록한다.",
  "작업 기록 규약: 완결된 작업(산출물이 남는 요청 단위)을 마무리하면 nunchi_search로 유사 task 항목을 찾아 edit(절차 교정)/confirm(재확인), 없으면 nunchi_record(section: task)로 기록한다.",
  "확신 없는 어긋남 의심은 nunchi_record(section: observe)로 관찰만 남긴다 (자동 회수 제외).",
];

try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    const core: MemoryEntryLite[] = await mem.core();
    if (core.length) {
      // ponytail: 하드 슬라이스 — session-start와 동일하게 8천자 캡 (additionalContext 상한 보호)
      const coreBlock = formatMemoryEntries(core).slice(0, 8000);
      lines.push("", "[확정 규칙 — '벌주는 것' 신뢰도 높음(3+). 항상 지킨다]", coreBlock);
    }
  } finally {
    mem.close();
  }
} catch {
  /* 서버 미기동 — 규약 안내만 주입 */
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
