// nunchi memory client — MCP 서버에서 import해 쓰는 Socket.IO 클라이언트.
// 서버가 안 떠 있으면 스폰 후 재접속한다. 여러 MCP가 동시에 스폰해도
// 서버 쪽 포트 락(EADDRINUSE 즉시 종료)으로 하나만 살아남으므로 안전하다.
import { io, type Socket } from "socket.io-client";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { resolveMemoryConn } from "./server.ts";
import { loadConfig } from "../hooks/config.ts";
import type { MemoryEntry, MemorySection, NewMemoryEntry } from "./store.ts";

const SERVER_PATH = fileURLToPath(new URL("./server.ts", import.meta.url));

/** 포트의 서버가 다른 프로젝트 소유일 때 — 소비자(MCP)는 이 에러를 받으면
 *  사용자에게 강제 연결 / 새 포트 할당 중 하나를 물어봐야 한다 */
export class ProjectMismatchError extends Error {
  constructor(
    readonly port: number,
    readonly expectedDir: string,
    /** null = 구버전 서버라 mem:info 미지원 (식별 불가) */
    readonly serverDir: string | null
  ) {
    super(
      [
        `[nunchi] port ${port}의 memory server는 이 프로젝트 소유가 아님`,
        `(서버: ${serverDir ?? "식별 불가 — 구버전 서버"}, 기대: ${expectedDir}).`,
        "사용자에게 다음 중 하나를 선택하도록 물어볼 것:",
        `1) 강제 연결 — connectMemory(projectDir, { force: true }). 다른 프로젝트의 memory.db를 공유하게 된다.`,
        `2) 새 포트 할당 — assignFreePort(projectDir)가 빈 포트를 .claude/nunchi.json의 port에 기록한다. 이후 connectMemory 재호출.`,
      ].join(" ")
    );
    this.name = "ProjectMismatchError";
  }
}

/** 경로 비교 — Windows는 대소문자 무시 */
export function sameProject(a: string, b: string): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32"
    ? x.toLowerCase() === y.toLowerCase()
    : x === y;
}

/** 서버의 소유 프로젝트 조회 — 구버전 서버(mem:info 미지원)면 null */
async function serverProjectDir(s: Socket): Promise<string | null> {
  try {
    const res = await s.timeout(2000).emitWithAck("mem:info");
    return res.ok && typeof res.projectDir === "string" ? res.projectDir : null;
  } catch {
    return null;
  }
}

/** OS가 주는 빈 임시 포트를 받아 프로젝트 .claude/nunchi.json의 port에 기록.
 *  nunchi.json은 plugin userConfig(환경 변수)보다 우선하므로 다음 연결부터 즉시 반영된다. */
export async function assignFreePort(
  projectDir: string = process.env.CLAUDE_PROJECT_DIR || process.cwd()
): Promise<number> {
  // ponytail: listen(0) 후 close — close~스폰 사이에 포트를 뺏길 수 있으나 확률 무시 가능
  const port = await new Promise<number>((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as { port: number }).port;
      srv.close(() => res(p));
    });
  });
  const cfgPath = join(projectDir, ".claude", "nunchi.json");
  let cfg: Record<string, unknown> = {};
  try {
    if (existsSync(cfgPath)) cfg = JSON.parse(readFileSync(cfgPath, "utf8").trim());
  } catch {
    /* 손상된 config는 port만 담아 새로 쓴다 */
  }
  cfg.port = port;
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  return port;
}

export interface MemoryClient {
  /** 서버 프로젝트의 보정 문서 전문 (없으면 null). 구버전 서버는 timeout 에러 */
  doc(): Promise<string | null>;
  add(e: NewMemoryEntry): Promise<number>;
  update(id: number, fields: Partial<NewMemoryEntry> & { confirm?: boolean; reverse?: boolean }): Promise<boolean>;
  remove(id: number): Promise<boolean>;
  search(
    queries: string[],
    opts?: { sections?: MemorySection[]; limit?: number; excludeCore?: boolean }
  ): Promise<MemoryEntry[]>;
  list(opts?: { section?: MemorySection; minConfidence?: number }): Promise<MemoryEntry[]>;
  /** 상시 주입 코어: 벌주는 것 신뢰도 높음(3+) */
  core(): Promise<MemoryEntry[]>;
  /** 마지막 기록 시각 — Stop hook 점검용 */
  stamp(): Promise<string | null>;
  /** 서버 프로세스 종료 (모든 클라이언트에 영향) */
  shutdown(): Promise<void>;
  close(): void;
}

function tryConnect(
  url: string,
  timeoutMs: number,
  token: string | null
): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = io(url, {
      reconnection: false,
      timeout: timeoutMs,
      auth: token ? { token } : {},
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", () => {
      s.close();
      resolve(null);
    });
  });
}

export async function connectMemory(
  projectDir: string = process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  opts: { force?: boolean; noSpawn?: boolean } = {}
): Promise<MemoryClient> {
  const cfg = loadConfig(projectDir);
  // 토큰은 로컬 memory-config.json에서 읽는다 — 외부 서버가 토큰을 요구하는 경우에도
  // 같은 값을 로컬 config에 넣어두면 전달된다
  const { port, token } = resolveMemoryConn(projectDir);
  let socket: Socket | null;

  const external = cfg["external-address"];
  if (external) {
    // 외부 서버: 스폰 없음. 명시적으로 지정한 공유 서버이므로 프로젝트 핸드셰이크도 생략
    const url = external.includes("://") ? external : `http://${external}`;
    socket = await tryConnect(url, 3000, token);
    if (!socket) {
      throw new Error(`[nunchi] external memory server 접속 실패 (${url})`);
    }
  } else {
    const url = `http://127.0.0.1:${port}`;
    // auto-start와 무관하게: 포트에 서버가 실행 중이면 그대로 연결.
    // 2초: 테스트 전체 실행 부하 시 루프백 핸드셰이크가 1초를 넘는다 — noSpawn은 stamp=null 오탐,
    // 스폰 경로는 떠 있는 서버를 놓치고 중복 스폰(낙오 프로세스가 나중에 빈 포트 차지)하던 문제
    socket = await tryConnect(url, 2000, token);

    if (!socket) {
      // 훅의 빠른 경로: 스폰 대기 없이 즉시 실패 (매 메시지 훅이 세션을 막지 않도록)
      if (opts.noSpawn) {
        throw new Error(`[nunchi] memory server 미기동 (port ${port}) — noSpawn 모드`);
      }
      // 서버 미기동 → 스폰은 auto-start=true일 때만
      if (!cfg["auto-start"]) {
        throw new Error(
          `[nunchi] memory server 미기동 (port ${port}) — auto-start가 꺼져 있어 스폰하지 않음`
        );
      }
      // 스폰 후 재시도 (동시 스폰 경쟁은 서버 포트 락이 정리)
      // NUNCHI_NO_WINDOW=1: 창 없이 detached 스폰 — 테스트 전체 실행이 창 수십 개를 띄우지 않도록
      if (process.platform === "win32" && process.env.NUNCHI_NO_WINDOW !== "1") {
        // 새 터미널 창에서 실행 — 서버 생존이 눈에 보이고, 창을 닫으면 종료된다.
        // (백그라운드 detached는 세션 종료 후 orphan으로 남아 memory.db를 잠그는 문제가 있었다)
        // cmd /s /c: 바깥 따옴표 한 겹을 벗기고 안쪽을 보존. start의 첫 따옴표 인자는 창 제목.
        spawn(
          "cmd",
          ["/d", "/s", "/c", `"start "Nunchi [${basename(projectDir)}]" bun "${SERVER_PATH}""`],
          {
            env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
            detached: true,
            stdio: "ignore",
            windowsVerbatimArguments: true,
          }
        ).unref();
      } else {
        // 비Windows: 범용적인 '새 터미널 창' 실행 방법이 없어 기존 detached 백그라운드 유지
        // detached: 부모(단명 클라이언트) 종료 시 자식이 함께 죽지 않도록
        spawn("bun", [SERVER_PATH], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
          detached: true,
          stdio: "ignore",
        }).unref();
      }
      for (let i = 0; i < 20 && !socket; i++) {
        await new Promise((r) => setTimeout(r, 250));
        socket = await tryConnect(url, 1000, token);
      }
      if (!socket) throw new Error(`[nunchi] memory server 접속 실패 (port ${port})`);
    }

    // 핸드셰이크: 서버가 이 프로젝트 소유인지 확인 — 직접 스폰한 경우도 검증
    // (스폰 경쟁에서 다른 프로젝트의 서버가 포트를 선점했을 수 있다)
    if (!opts.force) {
      const dir = await serverProjectDir(socket);
      if (dir === null || !sameProject(dir, projectDir)) {
        socket.close();
        throw new ProjectMismatchError(port, projectDir, dir);
      }
    }
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
    doc: async () => (await req("mem:doc")).doc ?? null,
    add: async (e) => (await req("mem:add", e)).id,
    update: async (id, fields) => (await req("mem:update", { id, ...fields })).updated,
    remove: async (id) => (await req("mem:remove", { id })).removed,
    search: async (queries, opts = {}) => (await req("mem:search", { queries, ...opts })).rows,
    list: async (opts = {}) => (await req("mem:list", opts)).rows,
    core: async () => (await req("mem:core")).rows,
    stamp: async () => (await req("mem:stamp")).stamp ?? null,
    shutdown: async () => {
      // ack는 서버가 파일 핸들을 놓기 전에 도착할 수 있다 — disconnect까지 기다려야
      // 호출자가 곧바로 DB 디렉터리를 지워도 안전하다 (서버는 db.close 후 접속을 끊는다)
      const gone = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        s.once("disconnect", () => {
          clearTimeout(t);
          resolve();
        });
      });
      try {
        await req("mem:shutdown");
      } catch {
        /* 서버가 ack 전에 종료되면 연결이 끊긴다 — 그게 곧 성공 */
      }
      await gone;
      s.close();
    },
    close: () => s.close(),
  };
}
