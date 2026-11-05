#!/usr/bin/env bun
// nunchi MCP server (stdio, Bun)
// 보정 DB 기록·검색 도구를 모델에 노출한다. 저장은 전부 memory server 경유 —
// sqlite 단일 소유(server.ts)를 유지하므로 MCP가 여럿 떠도 동시 접근 문제가 없다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { connectMemory, type MemoryClient } from "../memory/client.ts";
import { VERSION, loadConfig, resolveDocDir } from "../hooks/config.ts";
import { TOPIC_CLEARED, formatTopicBlock } from "../hooks/topic.ts";
import { writeDelivered } from "../memory/session-state.ts";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let memP: Promise<MemoryClient> | null = null;
/** 접속은 첫 도구 호출 시 1회 — 실패하면 다음 호출이 재시도.
 *  캐시된 클라이언트의 소켓이 죽었으면(서버 재시작·창 닫힘) 버리고 재연결한다 —
 *  재연결이 connectMemory를 다시 타므로 auto-start 스폰 경로도 함께 복원된다. */
async function mem(): Promise<MemoryClient> {
  if (memP) {
    try {
      const c = await memP;
      if (c.connected) return c;
      c.close(); // 죽은 소켓 정리 후 재연결
    } catch {
      /* 이전 연결이 reject됨 — 아래서 재시도 */
    }
    memP = null;
  }
  memP = connectMemory(projectDir).catch((e) => {
    memP = null;
    throw e; // ProjectMismatchError 안내문도 그대로 도구 에러로 전달된다
  });
  return memP;
}

const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const plain = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: String(e) }],
  isError: true as const,
});

const section = z
  .enum(["punish", "recommend", "env", "task", "observe"])
  .describe("punish=벌주는 것(반드시 한다), recommend=권장(이렇게 한다 — kind로 강도 권고·방법 기록 구분), env=환경 특이사항, task=작업 기록(완결 작업 플레이북), observe=관찰(확신 없는 예측 어긋남 의심 신호 — 자동 회수 제외, 반복 확인 시 update action: promote로 승격)");

// 필드 길이 상한 — 매 메시지 자동 주입(보정 3 + 작업 2건)이 additionalContext 상한 안에 들도록 기록 시점에 묶는다
const area = z.string().max(100).describe('"[영역: 짧은 상황 서술]" 형식, 100자 이내');
const rule = z.string().max(500).describe("무엇을 한다 / 이 수준으로 한다 — 500자 이내");
const kind = z
  .enum(["level", "method"])
  .describe("section: recommend일 때 필수로 고른다 — level=강도 권고(과잉이었음: 이 상황에선 이 수준으로 한다), method=방법 기록(예측보다 결과가 좋았던 접근·사용자가 좋다고 한 방식: 이렇게 한다)");
const evidence = z.string().max(200).describe("YYYY-MM-DD 실제로 있었던 일 1줄 — 200자 이내");

const session_id = z
  .string()
  .optional()
  .describe("SessionStart가 주입한 이 세션 id — 주제 자동 소속·주제 신뢰도·주제 우선 검색에 쓰인다");

const server = new McpServer({ name: "nunchi", version: VERSION });

server.registerTool(
  "nunchi_record",
  {
    description:
      "예측 어긋남(예측-실제 불일치)을 보정 DB에 신규 기록한다. 과잉이었음→recommend(kind: level), 예측보다 결과가 좋았음·사용자가 좋다고 함→recommend(kind: method), 과소였음→punish, 환경 특이사항→env. 근거는 반드시 실제 사건 1줄(YYYY-MM-DD 포함) — 일반론 금지. 같은 규칙이 이미 있으면 대신 nunchi_update(confirm)를 쓸 것. 완결된 작업의 플레이북은 section: task로 기록한다 — area='[작업유형: 상황]', rule='접근: 절차 / 주의: 함정', evidence='YYYY-MM-DD 결과 1줄'. 유사 task 항목이 이미 있으면 record 대신 nunchi_update(edit 교정 / confirm 재확인). 확신이 없는 어긋남 의심은 section: observe로 관찰만 남긴다(부담 없음, 자동 회수 제외) — 관련 기존 항목이 있으면 parent로 계보를 연결한다.",
    inputSchema: {
      section,
      area,
      rule,
      evidence,
      kind: kind.optional(),
      parent: z.number().int().optional()
        .describe("observe 기록 시 관련 기존 항목 id — 승격 계보의 canonical 부모 (선택)"),
      session_id,
    },
  },
  async ({ session_id: sessionId, ...a }) => {
    try {
      return ok({ id: await (await mem()).add({ ...a, sessionId }) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_update",
  {
    description:
      "기존 항목 갱신. confirm=재확인(신뢰도 +1, 날짜 갱신 — task 재수행 무사고에도 사용), reverse=반전 규칙('권장(강도)'을 따르다 사고 → punish로 이동+신뢰도 1 리셋+근거 교체, evidence 필수, recommend·level 전용 — 방법 기록(method)과 task는 edit·remove), edit=필드 수정(task 플레이북 절차 교정도 edit), remove=정제 삭제('벌주는 것'은 사용자 확인 없이 삭제 금지), promote=관찰 승격(id=대표 관찰, sources로 추가 관찰, 새 항목의 section/area/rule/evidence 필수 — 출처가 계보로 보존된다), link=자유 참조 연결(refs 필수).",
    inputSchema: {
      id: z.number().int(),
      action: z.enum(["confirm", "reverse", "edit", "remove", "promote", "link"]),
      section: section.optional(),
      area: area.optional(),
      rule: rule.optional(),
      evidence: evidence.optional(),
      kind: kind.optional(),
      confidence: z.number().int().min(1).optional(),
      sources: z.array(z.number().int()).optional().describe("promote 시 추가 근거 관찰 id들"),
      refs: z.array(z.number().int()).optional().describe("link 시 참조 항목 id들"),
      session_id,
    },
  },
  async ({ id, action, sources, refs, session_id: sessionId, ...f }) => {
    try {
      const m = await mem();
      if (action === "confirm") return ok({ updated: await m.update(id, { confirm: true, sessionId }) });
      if (action === "remove") return ok({ removed: await m.remove(id) });
      if (action === "promote") {
        if (!f.section || !f.area || !f.rule || !f.evidence)
          return fail("promote에는 새 항목의 section/area/rule/evidence가 필수다");
        return ok({
          id: await m.promote([id, ...(sources ?? [])], {
            section: f.section, area: f.area, rule: f.rule,
            evidence: f.evidence, confidence: f.confidence, kind: f.kind,
          }),
        });
      }
      if (action === "link") {
        if (!refs?.length) return fail("link에는 refs(참조 항목 id 배열)가 필수다");
        return ok({ updated: await m.link(id, refs) });
      }
      if (action === "reverse") {
        if (!f.evidence) return fail("reverse에는 evidence(새 사건 1줄)가 필수다");
        // §5.4 서버 검증 경유 — 권장(level) 아닌 대상(method·env·punish·task)은 서버가 거부한다
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
      "보정 항목·작업 기록 검색. 시맨틱 매칭은 호출자가 담당한다 — 원문 어휘에 얽매이지 말고 유의어·관련어·한/영 변형 쿼리를 2-5개 만들어 배열로 전달할 것 (서버는 쿼리를 단어로 나눠 OR-병합하고, 걸린 단어가 많은 항목을 먼저 반환). 유사 작업의 플레이북을 찾을 땐 section: task로 좁힌다. 결과가 부족하면 nunchi_list로 전량을 읽고 직접 선별한다.",
    inputSchema: {
      queries: z.array(z.string()).min(1).describe("확장 쿼리 2-5개 권장"),
      section: section.optional(),
      limit: z.number().int().min(1).max(20).optional().describe("기본 3"),
      session_id,
    },
  },
  async ({ queries, section: sec, limit, session_id: sessionId }) => {
    try {
      // 단수 section → sections 배열 매핑 (client.search는 sections만 받는다)
      return ok({ rows: await (await mem()).search(queries, { sections: sec ? [sec] : undefined, limit, sessionId }) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_list",
  {
    description:
      "보정 항목·작업 기록 전량/필터 조회. 항목 전체가 몇 KB 규모이므로 판단이 중요할 때는 전량을 읽고 인컨텍스트에서 직접 선별하는 것이 가장 정확하다 (recall 100%). section: task로 작업 기록만, section: observe로 관찰만(기본 목록에서는 제외) 조회할 수 있다. tree: id를 지정하면 해당 항목의 관계 트리(승격 계보·도메인 형제·자유 참조)만 반환한다.",
    inputSchema: {
      section: section.optional(),
      minConfidence: z.number().int().min(1).optional(),
      tree: z.number().int().optional()
        .describe("지정 시 해당 항목의 관계 트리(entry/parent/sources/promotedTo/domain/siblings/refs)만 반환"),
      ids: z.array(z.number().int()).optional().describe("지정 시 이 id들의 항목 전문만 반환 (주입된 `#id · area` 줄의 전문 조회용)"),
    },
  },
  async ({ tree, ...opts }) => {
    try {
      const m = await mem();
      if (tree !== undefined) return ok({ tree: await m.tree(tree) });
      return ok({ rows: await m.list(opts) });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "nunchi_topic",
  {
    description:
      "주제(작업공간) 조회·설정. list=주제 목록, set=이 세션의 주제 설정(session_id 필수, name 또는 topic_id), clear=세션 주제 해제(session_id 필수), create=주제 생성(사용자가 요청했을 때만 만든다), link/unlink=기억(memory_ids)을 주제에 소속/해제(주제 미지정 시 session_id의 현재 주제). 주제 삭제·수정은 대시보드에서만 가능하다.",
    inputSchema: {
      action: z.enum(["list", "set", "clear", "create", "link", "unlink"]),
      session_id: z.string().optional().describe("set·clear 필수. link·unlink에서 주제 미지정 시 이 세션의 주제를 쓴다"),
      name: z.string().max(60).optional().describe("set·create·link·unlink의 주제 이름"),
      topic_id: z.number().int().optional(),
      description: z.string().max(200).optional().describe("create 시 주제 설명"),
      folders: z.array(z.string()).optional().describe("create 시 작업공간 폴더들"),
      memory_ids: z.array(z.number().int()).optional().describe("link·unlink 대상 기억 id들"),
    },
  },
  async ({ action, session_id: sessionId, name, topic_id: topicId, description, folders, memory_ids: memoryIds }) => {
    try {
      const m = await mem();
      if (action === "list")
        return ok({
          topics: (await m.topics()).map((t) => ({
            id: t.id, name: t.name, description: t.description, folders: t.folders, memberCount: t.memberCount,
          })),
        });
      if (action === "create") {
        if (!name) return fail("create에는 name이 필요하다");
        return ok({ id: await m.createTopic({ name, description, folders }) });
      }
      // 주제 지정: topic_id → name → (link·unlink만) 세션의 현재 주제
      const find = async (): Promise<{ id: number } | null> => {
        if (topicId !== undefined) return (await m.topics()).find((t) => t.id === topicId) ?? null;
        if (name) return m.topicByName(name);
        if (sessionId && (action === "link" || action === "unlink")) return (await m.sessionState(sessionId)).topic;
        return null;
      };
      const label = String(topicId ?? name ?? sessionId ?? "(지정 안 됨)");
      if (action === "set" || action === "clear") {
        if (!sessionId) return fail(`${action}에는 session_id가 필요하다`);
        const t = action === "set" ? await find() : null;
        if (action === "set" && !t) return fail(`주제 없음: ${label}`);
        const st = await m.setSessionTopic(sessionId, t ? t.id : null);
        // 전달한 rev를 기록 — 실패해도 훅이 한 번 더 주입할 뿐이라 도구 호출은 성공시킨다
        try { writeDelivered(resolveDocDir(projectDir, loadConfig(projectDir)), sessionId, null, st.rev); } catch { /* 중복 주입만 발생 */ }
        return plain(st.topic ? formatTopicBlock(st.topic) : TOPIC_CLEARED);
      }
      if (!memoryIds?.length) return fail(`${action}에는 memory_ids가 필요하다`);
      const t = await find();
      if (!t) return fail(`주제 없음: ${label}`);
      return ok({ count: await (action === "link" ? m.linkTopic(t.id, memoryIds) : m.unlinkTopic(t.id, memoryIds)) });
    } catch (e) {
      return fail(e);
    }
  }
);

await server.connect(new StdioServerTransport());
// 클라이언트(Claude Code)가 stdin을 닫으면 종료 — memory server 소켓이 이벤트 루프를 붙잡아
// 세션이 비정상 종료돼도 프로세스가 고아로 남던 문제
process.stdin.on("end", () => process.exit(0));
