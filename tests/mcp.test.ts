// bun test tests/mcp.test.ts
// MCP 핸드셰이크 + tools/list 스모크. stdio는 개행 구분 JSON-RPC.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveDocDir } from "../hooks/config.ts";
import { assignFreePort, connectMemory, type MemoryClient } from "../memory/client.ts";
import { readDelivered } from "../memory/session-state.ts";
import { rmProject } from "./helpers.ts";

const SERVER = fileURLToPath(new URL("../mcp/server.ts", import.meta.url));

test(
  "MCP tools/call: nunchi_record(section:task) 성공, task 대상 reverse는 isError",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp2-"));
    await assignFreePort(dir); // 빈 포트 배정 — 실행 중인 프로젝트 서버와의 포트 충돌 방지
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const responses = new Map<number, { result?: { isError?: boolean; content: { text: string }[] } }>();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          try { const msg = JSON.parse(line); if (msg.id != null) responses.set(msg.id, msg); } catch { /* 불완전 */ }
        }
      }
    })().catch(() => {});
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    const waitFor = async (id: number) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const r = responses.get(id);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 20));
      }
      throw new Error(`timeout waiting for id ${id}`);
    };
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" },
      }});
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await proc.stdin.flush();
      await waitFor(1);
      // nunchi_record with section: task → 성공
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nunchi_record", arguments: {
        section: "task", area: "[리팩토링: 스토어]", rule: "접근: 테스트 먼저 / 주의: CHECK 재구축", evidence: "2026-07-09 완료",
      }}});
      await proc.stdin.flush();
      const rec = await waitFor(2);
      expect(rec.result?.isError).toBeFalsy();
      const recId = JSON.parse(rec.result!.content[0].text).id as number;
      expect(typeof recId).toBe("number");
      // task 대상 reverse → 권장(level) 전용이라 isError로 거부
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nunchi_update", arguments: {
        id: recId, action: "reverse", evidence: "2026-07-09 x",
      }}});
      await proc.stdin.flush();
      const rev = await waitFor(3);
      expect(rev.result?.isError).toBe(true);
      expect(rev.result!.content[0].text).toContain("권장(강도) 전용");
      // 필드 길이 상한 — 상한 초과 기록은 거부 (훅 주입 크기를 기록 시점에 묶는다)
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nunchi_record", arguments: {
        section: "env", area: "[a]", rule: "r", evidence: "2026-10-06 " + "x".repeat(200),
      }}});
      await proc.stdin.flush();
      const long = (await waitFor(4)) as { result?: { isError?: boolean }; error?: unknown };
      expect(long.result?.isError || long.error).toBeTruthy();
    } finally {
      proc.kill();
      await pump;
      await rmProject(dir); // mcp가 스폰한 memory server가 DB를 잠그므로 종료 후 삭제
    }
  },
  25000
);

test(
  "MCP v0.13: observe 기록 → promote 승격 → tree 조회 → link, 일반 항목 promote는 isError",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp4-"));
    await assignFreePort(dir);
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const responses = new Map<number, { result?: { isError?: boolean; content: { text: string }[] } }>();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          try { const msg = JSON.parse(line); if (msg.id != null) responses.set(msg.id, msg); } catch { /* 불완전 */ }
        }
      }
    })().catch(() => {});
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    const waitFor = async (id: number) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const r = responses.get(id);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 20));
      }
      throw new Error(`timeout waiting for id ${id}`);
    };
    const call = async (id: number, name: string, args: object) => {
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      await proc.stdin.flush();
      return waitFor(id);
    };
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" },
      }});
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await proc.stdin.flush();
      await waitFor(1);
      // 1) 관찰 기록
      const o = await call(2, "nunchi_record", {
        section: "observe", area: "[ship: 의심]", rule: "PR 과잉 의심", evidence: "2026-07-24 의심",
      });
      expect(o.result?.isError).toBeFalsy();
      const oId = JSON.parse(o.result!.content[0].text).id as number;
      // 2) 승격
      const pr = await call(3, "nunchi_update", {
        id: oId, action: "promote", section: "recommend",
        area: "[ship: 배포 절차]", rule: "PR 단계 생략 가능", evidence: "2026-07-24 반복 관찰",
      });
      expect(pr.result?.isError).toBeFalsy();
      const prId = JSON.parse(pr.result!.content[0].text).id as number;
      // 3) 트리 조회 — 승격 계보에 관찰 포함
      const tr = await call(4, "nunchi_list", { tree: prId });
      expect(tr.result?.isError).toBeFalsy();
      const tree = JSON.parse(tr.result!.content[0].text).tree;
      expect(tree.sources.map((e: { id: number }) => e.id)).toEqual([oId]);
      // 4) 자유 참조 링크
      const env = await call(5, "nunchi_record", {
        section: "env", area: "[윈도우: 인코딩]", rule: "BOM 주의", evidence: "2026-07-24 e",
      });
      const envId = JSON.parse(env.result!.content[0].text).id as number;
      const lk = await call(6, "nunchi_update", { id: prId, action: "link", refs: [envId] });
      expect(lk.result?.isError).toBeFalsy();
      // 5) 일반 항목 promote → isError
      const bad = await call(7, "nunchi_update", {
        id: prId, action: "promote", section: "punish", area: "[x]", rule: "r", evidence: "e",
      });
      expect(bad.result?.isError).toBe(true);
      // 6) v0.13.5 권장(recommend) kind — method 기록·검색, method reverse 거부
      const m = await call(8, "nunchi_record", {
        section: "recommend", kind: "method", area: "[리뷰: 요청]", rule: "리뷰 요청 먼저", evidence: "2026-11-05 사용자가 좋다고 함",
      });
      expect(m.result?.isError).toBeFalsy();
      const mId = JSON.parse(m.result!.content[0].text).id as number;
      const sr = await call(9, "nunchi_search", { queries: ["리뷰 요청"] });
      expect(JSON.parse(sr.result!.content[0].text).rows[0]).toMatchObject({ id: mId, kind: "method" });
      const mr = await call(10, "nunchi_update", { id: mId, action: "reverse", evidence: "2026-11-05 x" });
      expect(mr.result?.isError).toBe(true);
      expect(mr.result!.content[0].text).toContain("방법 기록(method)은 edit·remove");
      // 도구 스키마: section enum에 forgive 없음·recommend 있음
      send({ jsonrpc: "2.0", id: 11, method: "tools/list" });
      await proc.stdin.flush();
      const tl = JSON.stringify(await waitFor(11));
      expect(tl).toContain('"recommend"');
      expect(tl).not.toContain('"forgive"');
    } finally {
      proc.kill();
      await pump;
      await rmProject(dir);
    }
  },
  25000
);

test(
  "MCP nunchi_topic: create → set 결과에 주제 블록, delivered 기록, list ids 조회",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp5-"));
    await assignFreePort(dir);
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const responses = new Map<number, { result?: { isError?: boolean; content: { text: string }[] } }>();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          try { const msg = JSON.parse(line); if (msg.id != null) responses.set(msg.id, msg); } catch { /* 불완전 */ }
        }
      }
    })().catch(() => {});
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    const waitFor = async (id: number) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const r = responses.get(id);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 20));
      }
      throw new Error(`timeout waiting for id ${id}`);
    };
    let n = 1;
    const call = async (name: string, args: object) => {
      const id = ++n;
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      await proc.stdin.flush();
      return waitFor(id);
    };
    const text = (r: { result?: { content: { text: string }[] } }) => r.result!.content[0].text;
    let mem: MemoryClient | null = null;
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" },
      }});
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await proc.stdin.flush();
      await waitFor(1);
      const cr = await call("nunchi_topic", { action: "create", name: "UI", description: "화면 작업", folders: ["src/"] });
      expect(cr.result?.isError).toBeFalsy();
      const topicId = JSON.parse(text(cr)).id as number;
      const rec = await call("nunchi_record", {
        section: "env", area: "[UI: 렌더링]", rule: "컴포넌트는 순수하게", evidence: "2026-11-06 확인",
      });
      const memId = JSON.parse(text(rec)).id as number;
      const lk = await call("nunchi_topic", { action: "link", name: "UI", memory_ids: [memId] });
      expect(JSON.parse(text(lk)).count).toBe(1);
      const ls = await call("nunchi_topic", { action: "list" });
      expect(JSON.parse(text(ls)).topics[0]).toMatchObject({ id: topicId, name: "UI", memberCount: 1 });
      // set은 등록된 세션만 — SessionStart 훅이 하는 등록을 대신한다 (MCP가 띄운 서버에 접속)
      const ghost = await call("nunchi_topic", { action: "set", session_id: "ghost", name: "UI" });
      expect(ghost.result?.isError).toBe(true);
      expect(text(ghost)).toContain("세션 없음");
      mem = await connectMemory(dir, { noSpawn: true });
      await mem.registerSession({ sessionId: "s1" });
      const docDir = resolveDocDir(dir, loadConfig(dir));
      const set = await call("nunchi_topic", { action: "set", session_id: "s1", name: "UI" });
      expect(set.result?.isError).toBeFalsy();
      expect(text(set)).toContain("현재 주제: UI");
      expect(text(set)).toContain("src/");
      expect(readDelivered(docDir, "s1")).toBe((await mem.sessionState("s1")).rev); // 전달한 rev 그대로
      // topic_id 경로
      const byId = await call("nunchi_topic", { action: "set", session_id: "s1", topic_id: topicId });
      expect(text(byId)).toContain("현재 주제: UI");
      const noId = await call("nunchi_topic", { action: "set", session_id: "s1", topic_id: 999 });
      expect(noId.result?.isError).toBe(true);
      expect(text(noId)).toContain("주제 없음: 999");
      // 세션 주제로 link 대상 해석 (topic_id·name 생략)
      const ulk = await call("nunchi_topic", { action: "unlink", session_id: "s1", memory_ids: [memId] });
      expect(JSON.parse(text(ulk)).count).toBe(1);
      const lst = await call("nunchi_list", { ids: [memId] });
      expect(JSON.parse(text(lst)).rows.length).toBe(1);
      // 없는 이름·세션 id 누락은 isError
      const miss = await call("nunchi_topic", { action: "set", session_id: "s1", name: "없는주제" });
      expect(miss.result?.isError).toBe(true);
      expect(text(miss)).toContain("주제 없음");
      expect((await call("nunchi_topic", { action: "set", name: "UI" })).result?.isError).toBe(true);
      // clear → TOPIC_CLEARED
      const clr = await call("nunchi_topic", { action: "clear", session_id: "s1" });
      expect(text(clr)).toContain("현재 주제 없음");
      const cleared = await mem.sessionState("s1");
      expect(cleared.topic).toBe(null);
      expect(readDelivered(docDir, "s1")).toBe(cleared.rev);
      // 세션 주제 대체 경로 — 주제가 없으면 sid가 아니라 세션 주제 없음으로 안내
      const lk2 = await call("nunchi_topic", { action: "link", session_id: "s1", memory_ids: [memId] });
      expect(lk2.result?.isError).toBe(true);
      expect(text(lk2)).toBe("세션에 주제가 없음");
      send({ jsonrpc: "2.0", id: 99, method: "tools/list" });
      await proc.stdin.flush();
      expect(JSON.stringify(await waitFor(99))).toContain('"nunchi_topic"');
    } finally {
      mem?.close();
      proc.kill();
      await pump;
      await rmProject(dir);
    }
  },
  30000
);

test(
  // 이슈 #1 회귀: memory server 재시작 후 죽은 캐시 소켓을 영구 재사용하던 문제.
  // 구코드는 재호출이 영구 timeout, 신규 코드는 connected 확인 → 재연결/재스폰으로 복구.
  "MCP: memory server 종료 후에도 도구 호출이 재연결로 복구된다",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp3-"));
    await assignFreePort(dir);
    // 테스트가 memory server 수명을 직접 통제 — MCP는 떠 있는 이 서버에 붙어 캐시한다
    const srv = await connectMemory(dir);
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, NUNCHI_NO_WINDOW: "1" },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const responses = new Map<number, { result?: { isError?: boolean } }>();
    const pump = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          try { const m = JSON.parse(line); if (m.id != null) responses.set(m.id, m); } catch { /* 불완전 */ }
        }
      }
    })().catch(() => {});
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    const waitFor = async (id: number) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const r = responses.get(id);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 20));
      }
      throw new Error(`timeout waiting for id ${id}`);
    };
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" },
      }});
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await proc.stdin.flush();
      await waitFor(1);
      // 1) 첫 호출 → MCP가 떠 있는 서버에 연결·캐시
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nunchi_list", arguments: {} }});
      await proc.stdin.flush();
      expect((await waitFor(2)).result?.isError).toBeFalsy();
      // 2) 서버 종료 → MCP의 캐시 소켓이 죽는다
      await srv.shutdown();
      // 3) 재호출 → 신규 코드는 재연결(+재스폰)으로 복구. connected 감지 타이밍 레이스 대비
      //    최대 3회 재시도 — 구코드는 몇 번을 해도 죽은 캐시라 영구 실패한다.
      let recovered = false;
      for (let id = 3; id <= 5 && !recovered; id++) {
        send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "nunchi_list", arguments: {} }});
        await proc.stdin.flush();
        recovered = !(await waitFor(id)).result?.isError;
      }
      expect(recovered).toBe(true);
    } finally {
      proc.kill();
      await pump;
      try { srv.close(); } catch { /* 이미 종료 */ }
      await rmProject(dir); // MCP가 재스폰한 서버가 DB를 잠그므로 rmProject가 정리
    }
  },
  40000
);

test(
  "MCP: initialize → tools/list에 도구 5종",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp-"));
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {},
      clientInfo: { name: "test", version: "0" },
    }});
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await proc.stdin.flush();

    const names: string[] = [];
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !names.length) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      for (const line of buf.split("\n")) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) names.push(...msg.result.tools.map((t: { name: string }) => t.name));
        } catch { /* 불완전한 줄 */ }
      }
    }
    proc.kill();
    expect(names.sort()).toEqual(["nunchi_list", "nunchi_record", "nunchi_search", "nunchi_topic", "nunchi_update"]);
    rmSync(dir, { recursive: true, force: true });
  },
  20000
);

test(
  "MCP: 클라이언트가 stdin을 닫으면 memory 소켓이 열려 있어도 종료 (고아 프로세스 방지)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-mcp-exit-"));
    await assignFreePort(dir);
    const proc = Bun.spawn(["bun", SERVER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const reader = proc.stdout.getReader();
    let buf = "";
    const until = async (s: string) => {
      while (!buf.includes(s)) buf += new TextDecoder().decode((await reader.read()).value);
    };
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" },
      }});
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      // 도구 1회 호출 — memory server 소켓이 열린다 (이벤트 루프를 붙잡는 원인)
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nunchi_list", arguments: {} } });
      await proc.stdin.flush();
      await until('"id":2');
      proc.stdin.end();
      const exited = await Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
      ]);
      expect(exited).toBe(true);
    } finally {
      proc.kill();
      await rmProject(dir);
    }
  },
  25000
);
