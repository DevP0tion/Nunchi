// bun test tests/mcp.test.ts
// MCP 핸드셰이크 + tools/list 스모크. stdio는 개행 구분 JSON-RPC.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignFreePort } from "../memory/client.ts";
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
      // task 대상 reverse → forgive 전용이라 isError로 거부
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nunchi_update", arguments: {
        id: recId, action: "reverse", evidence: "2026-07-09 x",
      }}});
      await proc.stdin.flush();
      const rev = await waitFor(3);
      expect(rev.result?.isError).toBe(true);
      expect(rev.result!.content[0].text).toContain("forgive");
    } finally {
      proc.kill();
      await pump;
      await rmProject(dir); // mcp가 스폰한 memory server가 DB를 잠그므로 종료 후 삭제
    }
  },
  25000
);

test(
  "MCP: initialize → tools/list에 도구 4종",
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
    expect(names.sort()).toEqual(["nunchi_list", "nunchi_record", "nunchi_search", "nunchi_update"]);
    rmSync(dir, { recursive: true, force: true });
  },
  20000
);
