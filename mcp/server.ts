#!/usr/bin/env bun
// nunchi MCP server (stdio, Bun)
// 보정 DB 기록·검색 도구를 모델에 노출한다. 저장은 전부 memory server 경유 —
// sqlite 단일 소유(server.ts)를 유지하므로 MCP가 여럿 떠도 동시 접근 문제가 없다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { connectMemory, type MemoryClient } from "../memory/client.ts";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let memP: Promise<MemoryClient> | null = null;
/** 접속은 첫 도구 호출 시 1회 — 실패하면 다음 호출이 재시도 */
function mem(): Promise<MemoryClient> {
  memP ??= connectMemory(projectDir).catch((e) => {
    memP = null;
    throw e; // ProjectMismatchError 안내문도 그대로 도구 에러로 전달된다
  });
  return memP;
}

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: String(e) }],
  isError: true as const,
});

const section = z
  .enum(["punish", "forgive", "env", "task"])
  .describe("punish=벌주는 것(반드시 한다), forgive=용서하는 것(생략 가능), env=환경 특이사항, task=작업 기록(완결 작업 플레이북)");

const server = new McpServer({ name: "nunchi", version: "0.12.0" });

server.registerTool(
  "nunchi_record",
  {
    description:
      "예측 어긋남(예측-실제 불일치)을 보정 DB에 신규 기록한다. 과잉이었음→forgive, 과소였음→punish, 환경 특이사항→env. 근거는 반드시 실제 사건 1줄(YYYY-MM-DD 포함) — 일반론 금지. 같은 규칙이 이미 있으면 대신 nunchi_update(confirm)를 쓸 것. 완결된 작업의 플레이북은 section: task로 기록한다 — area='[작업유형: 상황]', rule='접근: 절차 / 주의: 함정', evidence='YYYY-MM-DD 결과 1줄'. 유사 task 항목이 이미 있으면 record 대신 nunchi_update(edit 교정 / confirm 재확인).",
    inputSchema: {
      section,
      area: z.string().describe('"[영역: 짧은 상황 서술]" 형식'),
      rule: z.string().describe("무엇을 한다 / 생략해도 된다"),
      evidence: z.string().describe("YYYY-MM-DD 실제로 있었던 일 1줄"),
    },
  },
  async (a) => {
    try {
      return ok({ id: await (await mem()).add(a) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_update",
  {
    description:
      "기존 항목 갱신. confirm=재확인(신뢰도 +1, 날짜 갱신 — task 재수행 무사고에도 사용), reverse=반전 규칙('용서하는 것'을 따르다 사고 → punish로 이동+신뢰도 1 리셋+근거 교체, evidence 필수, 보정 forgive 전용 — task 항목에는 사용 불가), edit=필드 수정(task 플레이북 절차 교정도 edit), remove=정제 삭제('벌주는 것'은 사용자 확인 없이 삭제 금지).",
    inputSchema: {
      id: z.number().int(),
      action: z.enum(["confirm", "reverse", "edit", "remove"]),
      section: section.optional(),
      area: z.string().optional(),
      rule: z.string().optional(),
      evidence: z.string().optional(),
      confidence: z.number().int().min(1).optional(),
    },
  },
  async ({ id, action, ...f }) => {
    try {
      const m = await mem();
      if (action === "confirm") return ok({ updated: await m.update(id, { confirm: true }) });
      if (action === "remove") return ok({ removed: await m.remove(id) });
      if (action === "reverse") {
        if (!f.evidence) return fail("reverse에는 evidence(새 사건 1줄)가 필수다");
        // §5.4 서버 검증 경유 — forgive 아닌 대상(env·punish·task)은 서버가 거부한다
        return ok({ updated: await m.update(id, { reverse: true, evidence: f.evidence }) });
      }
      return ok({ updated: await m.update(id, f) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_search",
  {
    description:
      "보정 항목·작업 기록 검색. 시맨틱 매칭은 호출자가 담당한다 — 원문 어휘에 얽매이지 말고 유의어·관련어·한/영 변형 쿼리를 2-5개 만들어 배열로 전달할 것 (서버는 FTS OR-병합). 유사 작업의 플레이북을 찾을 땐 section: task로 좁힌다. 결과가 부족하면 nunchi_list로 전량을 읽고 직접 선별한다.",
    inputSchema: {
      queries: z.array(z.string()).min(1).describe("확장 쿼리 2-5개 권장"),
      section: section.optional(),
      limit: z.number().int().min(1).max(20).optional().describe("기본 3"),
    },
  },
  async ({ queries, section: sec, limit }) => {
    try {
      // 단수 section → sections 배열 매핑 (client.search는 sections만 받는다)
      return ok({ rows: await (await mem()).search(queries, { sections: sec ? [sec] : undefined, limit }) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_list",
  {
    description:
      "보정 항목·작업 기록 전량/필터 조회. 항목 전체가 몇 KB 규모이므로 판단이 중요할 때는 전량을 읽고 인컨텍스트에서 직접 선별하는 것이 가장 정확하다 (recall 100%). section: task로 작업 기록만 조회할 수 있다.",
    inputSchema: {
      section: section.optional(),
      minConfidence: z.number().int().min(1).optional(),
    },
  },
  async (opts) => {
    try {
      return ok({ rows: await (await mem()).list(opts) });
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());
