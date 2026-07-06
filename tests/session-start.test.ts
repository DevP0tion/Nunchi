// bun test tests/session-start.test.ts
// SessionStart 훅이 스폰한 memory server가 훅(부모) 종료 후에도 생존하는지 검증.
// 회귀 대상: Windows에서 Bun.spawn(...).unref()는 부모 종료 시 자식도 죽는다 — detached 필수.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignFreePort, connectMemory } from "../memory/client.ts";

const HOOK = fileURLToPath(new URL("../hooks/session-start.ts", import.meta.url));

const portAlive = (port: number) =>
  new Promise<boolean>((res) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      res(true);
    });
    s.once("error", () => res(false));
  });

test(
  "SessionStart 훅이 스폰한 memory server는 훅 종료 후에도 생존",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-"));
    const port = await assignFreePort(dir);
    try {
      // 훅을 실제 실행 방식 그대로 단명 프로세스로 실행 — 완료 시점에 부모는 이미 종료
      Bun.spawnSync(["bun", HOOK], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      // 스폰 없이 순수 접속으로만 확인 (connectMemory는 실패 시 재스폰해 회귀를 가리므로 금지)
      let alive = false;
      for (let i = 0; i < 40 && !alive; i++) {
        await new Promise((r) => setTimeout(r, 250));
        alive = await portAlive(port);
      }
      expect(alive).toBe(true);
    } finally {
      if (await portAlive(port)) {
        const m = await connectMemory(dir);
        await m.shutdown();
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows 파일 락 잔류 — 무해 */
      }
    }
  },
  20000
);
