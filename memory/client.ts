// nunchi memory client — MCP 서버에서 import해 쓰는 Socket.IO 클라이언트.
// 서버가 안 떠 있으면 스폰 후 재접속한다. 여러 MCP가 동시에 스폰해도
// 서버 쪽 포트 락(EADDRINUSE 즉시 종료)으로 하나만 살아남으므로 안전하다.
import { io, type Socket } from "socket.io-client";
import { fileURLToPath } from "node:url";
import { resolveMemoryPort } from "./server.ts";
import { loadConfig } from "../hooks/config.ts";

const SERVER_PATH = fileURLToPath(new URL("./server.ts", import.meta.url));

export interface MemoryClient {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  search(
    query: string,
    limit?: number
  ): Promise<{ key: string; value: string; updated_at: string }[]>;
  /** 서버 프로세스 종료 (모든 클라이언트에 영향) */
  shutdown(): Promise<void>;
  close(): void;
}

function tryConnect(port: number, timeoutMs: number): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = io(`http://127.0.0.1:${port}`, {
      reconnection: false,
      timeout: timeoutMs,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", () => {
      s.close();
      resolve(null);
    });
  });
}

export async function connectMemory(
  projectDir: string = process.env.CLAUDE_PROJECT_DIR || process.cwd()
): Promise<MemoryClient> {
  const port = resolveMemoryPort(projectDir);
  // auto-start와 무관하게: 포트에 서버가 실행 중이면 그대로 연결
  let socket = await tryConnect(port, 1000);

  if (!socket) {
    // 서버 미기동 → 스폰은 auto-start=true일 때만
    if (!loadConfig(projectDir)["auto-start"]) {
      throw new Error(
        `[nunchi] memory server 미기동 (port ${port}) — auto-start가 꺼져 있어 스폰하지 않음`
      );
    }
    // 스폰 후 재시도 (동시 스폰 경쟁은 서버 포트 락이 정리)
    Bun.spawn(["bun", SERVER_PATH], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
    for (let i = 0; i < 20 && !socket; i++) {
      await new Promise((r) => setTimeout(r, 250));
      socket = await tryConnect(port, 1000);
    }
    if (!socket) throw new Error(`[nunchi] memory server 접속 실패 (port ${port})`);
  }

  const s = socket;
  const req = async (ev: string, payload?: unknown) => {
    const res = payload === undefined
      ? await s.timeout(5000).emitWithAck(ev)
      : await s.timeout(5000).emitWithAck(ev, payload);
    if (!res.ok) throw new Error(res.error);
    return res;
  };

  return {
    set: async (key, value) => {
      await req("mem:set", { key, value });
    },
    get: async (key) => (await req("mem:get", { key })).value,
    search: async (query, limit = 20) =>
      (await req("mem:search", { query, limit })).rows,
    shutdown: async () => {
      try {
        await req("mem:shutdown");
      } catch {
        /* 서버가 ack 전에 종료되면 연결이 끊긴다 — 그게 곧 성공 */
      }
      s.close();
    },
    close: () => s.close(),
  };
}
