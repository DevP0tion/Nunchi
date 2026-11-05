// 주제·작업공간 관련 훅 공용 렌더링 — SessionStart·SubagentStart·UserPromptSubmit·Pre/PostToolUse와
// MCP(nunchi_topic set 결과)가 같은 문구를 쓴다. bun:sqlite·socket.io를 import하지 않는다.
import { isAbsolute, resolve } from "node:path";
import { formatMemoryEntries, type MemoryEntryLite } from "./config.ts";
import type { TopicState } from "../memory/session-state.ts";

const CORE_HEADING = "[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]";
const CORE_OUTSIDE_HEADING = "[확정 규칙 — 주제 밖, 전문은 nunchi_list(ids)로 조회. 항상 지킨다]";
const TOPIC_LIST_MAX = 20;

export const TOPIC_CLEARED = "[nunchi] 현재 주제 없음 — 이전에 주입된 주제 블록은 무효";

export function sessionIdLine(sid: string): string {
  return `[nunchi] 이 세션 id: ${sid} — nunchi_topic·nunchi_record·nunchi_update·nunchi_search 호출 시 session_id로 넘긴다`;
}

/** 주제 목록(최대 20개) + 규약 1줄. 목록이 비어도 규약은 낸다 (사용자 요청 시 주제를 만들 수 있다) */
export function formatTopicList(topics: { name: string; description: string }[]): string {
  const lines: string[] = [];
  if (topics.length) {
    lines.push("[nunchi] 주제 목록:");
    for (const t of topics.slice(0, TOPIC_LIST_MAX)) lines.push(`- ${t.name} — ${t.description}`);
  }
  lines.push(
    "[nunchi] 작업을 시작할 때 맞는 주제가 있으면 nunchi_topic(set)으로 설정한다. 사용자가 주제 변경을 요청하면(`/nunchi:topic`, 자연어) 따른다. 작업공간 밖 파일을 고쳐야 하면 사용자에게 알린다."
  );
  return lines.join("\n");
}

/** 주제 블록 (set 결과·훅 주입 공통). changed면 변경 안내 줄을 앞에 붙인다 */
export function formatTopicBlock(t: TopicState, changed = false): string {
  const lines: string[] = [];
  if (changed) lines.push("[nunchi] 주제 정보가 갱신됨");
  lines.push(`[nunchi] 현재 주제: ${t.name}${t.description ? ` — ${t.description}` : ""}`);
  lines.push(
    t.folders.length ? `작업공간: ${t.folders.join(", ")} — 이 폴더들 안에서 작업한다` : "작업공간: (지정 없음)"
  );
  if (t.areas.length) {
    lines.push("주제 핵심 영역(주제 신뢰도 3+, 전문은 nunchi_list(ids)로 조회):");
    for (const a of t.areas) lines.push(`- #${a.id} ${a.area}`);
  }
  return lines.join("\n");
}

/** 코어 블록. memberIds null(주제 없음)이면 기존 훅 출력과 동일. 배열이면 소속은 전문, 비소속은 `#id · area` 줄 */
export function formatCoreBlock(core: MemoryEntryLite[], memberIds: number[] | null): string {
  if (!core.length) return "";
  if (memberIds === null) return `${CORE_HEADING}\n${formatMemoryEntries(core)}`;
  const ids = new Set(memberIds);
  const inside = core.filter((r) => ids.has(r.id));
  const outside = core.filter((r) => !ids.has(r.id));
  const blocks: string[] = [];
  if (inside.length) blocks.push(`${CORE_HEADING}\n${formatMemoryEntries(inside)}`);
  if (outside.length) blocks.push(`${CORE_OUTSIDE_HEADING}\n${outside.map((r) => `- #${r.id} · ${r.area}`).join("\n")}`);
  return blocks.join("\n\n");
}

// 비교용 정규화 — 절대 경로로 풀고 구분자를 "/"로 통일, Windows는 대소문자 무시
function norm(projectDir: string, p: string): string {
  const slashed = p.replace(/\\/g, "/");
  const abs = isAbsolute(slashed) ? resolve(slashed) : resolve(projectDir, slashed);
  const out = abs.replace(/\\/g, "/");
  return process.platform === "win32" ? out.toLowerCase() : out;
}

/** filePath가 작업공간 폴더 중 하나 안인가. folders가 비면 항상 true */
export function inWorkspace(projectDir: string, folders: string[], filePath: string): boolean {
  if (!folders.length) return true;
  const file = norm(projectDir, filePath);
  return folders.some((f) => {
    const folder = norm(projectDir, f);
    return file === folder || file.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
  });
}
