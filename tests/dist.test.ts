// bun test tests/dist.test.ts
// dist 번들 검증: (1) 소스와 일치(입력 해시) (2) node_modules 없는 설치본에서 훅·MCP·memory server 동작.
// (2)의 회귀 대상: client가 server.ts를 import해 번들된 훅·MCP 안에서 memory server가 기동되던 결함 —
// stdout을 통째로 JSON.parse해 서버 로그 혼입을 잡는다.
import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { inputHash } from "../build.ts";
import { assignFreePort, connectMemory } from "../memory/client.ts";
import { rmProject } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");

test("dist가 소스와 일치 — 실패하면 bun run build 후 dist를 함께 커밋", () => {
  const info = JSON.parse(readFileSync(join(ROOT, "dist/build-info.json"), "utf8"));
  expect(info.inputs).toBe(inputHash());
});

test(
  "node_modules 없는 설치본(상위에 다른 node_modules): 훅 4종·MCP·memory server 동작",
  async () => {
    const tmp = mkdtempSync(join(tmpdir(), "nunchi-nodeps-"));
    // 상위 node_modules가 있으면 Bun auto-install이 꺼진다 — 번들 밖 import가 남아 있으면 여기서 실패
    mkdirSync(join(tmp, "node_modules"));
    const plugin = join(tmp, "plugin");
    cpSync(ROOT, plugin, {
      recursive: true,
      filter: (src) => !/^(node_modules|\.git|tests|docs)([\\/]|$)/.test(relative(ROOT, src)),
    });
    // 다른 머신 재현: 번들은 CJS 의존성의 __dirname을 빌드 머신 절대 경로로 박는다(socket.io 클라이언트 서빙 등).
    // 빌드 머신에선 그 경로가 실제로 있어 결함이 가려지므로 복사본의 빌드 루트를 없는 경로로 바꾼다
    const esc = (p: string) => JSON.stringify(p).slice(1, -1);
    const bundle = join(plugin, "dist/memory/server.js");
    writeFileSync(bundle, readFileSync(bundle, "utf8").replaceAll(esc(ROOT), esc(join(tmp, "build-root"))));
    const proj = join(tmp, "project");
    mkdirSync(proj);
    const port = await assignFreePort(proj); // 실행 중인 프로젝트 서버와의 포트 충돌 방지
    // web: true — 번들 서버가 dashboard를 플러그인 루트의 memory/dashboard에서 찾는지 확인
    mkdirSync(join(proj, ".claude/nunchi"), { recursive: true });
    writeFileSync(join(proj, ".claude/nunchi/memory-config.json"), JSON.stringify({ web: true }));
    const run = (rel: string, input: object) =>
      Bun.spawnSync(["bun", join(plugin, rel)], {
        cwd: proj,
        env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
        stdin: new TextEncoder().encode(JSON.stringify(input)),
        stdout: "pipe",
        stderr: "ignore",
      }).stdout.toString();
    try {
      // SessionStart: 번들 memory server(dist/memory/server.js)를 스폰하고, stdout은 JSON 하나
      const ss = JSON.parse(run("dist/hooks/session-start.js", { source: "startup" }));
      expect(ss.hookSpecificOutput.additionalContext).toContain(
        `SKILL.md): ${join(plugin, "SKILL.md")}`
      );

      // 훅이 띄운 서버에 클라이언트 왕복 (noSpawn — 테스트가 서버를 대신 띄우지 않도록)
      const mem = await connectMemory(proj, { noSpawn: true });
      try {
        const id = await mem.add({
          section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략 가능",
          evidence: "2026-10-07 과잉이었음",
        });
        expect((await mem.list()).map((r) => r.id)).toContain(id);
        expect((await mem.exportEvents()).count).toBeGreaterThan(0);
        const dash = await fetch(`http://127.0.0.1:${port}/`);
        expect(dash.status).toBe(200);
        const html = await dash.text();
        expect(html).toContain("<html");
        // 대시보드의 Socket.IO 클라이언트 — 빈 200이면 브라우저에서 io 미정의로 타일이 전부 "—"
        const client = await fetch(`http://127.0.0.1:${port}${/<script src="([^"]+)">/.exec(html)![1]}`);
        expect(client.status).toBe(200);
        expect(client.headers.get("content-type")).toContain("javascript");
        expect((await client.text()).length).toBeGreaterThan(0);

        const ups = JSON.parse(
          run("dist/hooks/user-prompt-submit.js", { prompt: "일회성 스크립트에도 테스트가 필요할까?" })
        );
        expect(ups.hookSpecificOutput.additionalContext).toContain("일회성 스크립트 테스트 생략 가능");
        const sub = JSON.parse(run("dist/hooks/subagent-start.js", { agent_type: "general-purpose" }));
        expect(sub.hookSpecificOutput.hookEventName).toBe("SubagentStart");
        const stop = run("dist/hooks/stop-check.js", { session_id: "nodeps" });
        if (stop) JSON.parse(stop);

        // MCP: stdin EOF에서 종료된다 — stdout의 모든 줄이 JSON-RPC여야 한다
        const mcp = Bun.spawnSync(["bun", join(plugin, "dist/mcp/server.js")], {
          cwd: proj,
          env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
          stdin: new TextEncoder().encode(
            [
              { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
              { jsonrpc: "2.0", method: "notifications/initialized" },
              { jsonrpc: "2.0", id: 2, method: "tools/list" },
            ].map((m) => JSON.stringify(m) + "\n").join("")
          ),
          stdout: "pipe",
          stderr: "ignore",
          timeout: 15000,
        });
        const msgs = mcp.stdout.toString().trim().split("\n").map((l) => JSON.parse(l));
        const version = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version;
        expect(msgs.find((m) => m.id === 1).result.serverInfo.version).toBe(version);
        expect(msgs.find((m) => m.id === 2).result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
          ["nunchi_list", "nunchi_record", "nunchi_search", "nunchi_update"]
        );
      } finally {
        await mem.shutdown();
      }
    } finally {
      await rmProject(proj);
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* Windows 파일 락 잔류 — 무해 */
      }
    }
  },
  60000
);
