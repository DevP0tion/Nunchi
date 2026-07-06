// bun test tests/mcp.test.ts
// MCP 핸드셰이크 + tools/list 스모크. stdio는 개행 구분 JSON-RPC.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../mcp/server.ts", import.meta.url));

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
