#!/usr/bin/env bun
// nunchi SubagentStart hook (Bun)
// 서브에이전트는 SessionStart 주입을 받지 못한다 — 규약 1줄 + 코어를 대신 주입한다.
// 공식 스키마상 stdin에 서브에이전트 프롬프트는 없다(agent_type/agent_id만).
// prompt 필드가 있으면(향후 추가 대비) 기회적으로 관련 엔트리도 검색한다.
import { readStdinJson, formatCalEntries, type CalEntryLite } from "./config.ts";

const input = await readStdinJson();
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const lines = [
  "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다. 작업 강도 판단이 애매하면 nunchi_search(유의어 확장 쿼리)·nunchi_list 도구로 보정 엔트리를 조회하고, 예측-실제 불일치(surprise)는 nunchi_record로 기록한다.",
];

try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    const core: CalEntryLite[] = await mem.calCore();
    if (core.length) {
      // ponytail: 하드 슬라이스 — session-start와 동일하게 8천자 캡 (additionalContext 상한 보호)
      const coreBlock = formatCalEntries(core).slice(0, 8000);
      lines.push("", "[확정 규칙 — '벌주는 것' 신뢰도 높음(3+). 항상 지킨다]", coreBlock);
    }
    const prompt = String(input.prompt ?? "").trim();
    if (prompt) {
      const tokens = [...new Set(prompt.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2))].slice(0, 8);
      const rows = tokens.length ? await mem.calSearch(tokens, { limit: 3, excludeCore: true }) : [];
      if (rows.length) lines.push("", "[이번 작업 관련 보정 엔트리]", formatCalEntries(rows));
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
