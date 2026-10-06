// nunchi memory-config.json 해석 — memory server(server.ts)와 클라이언트(client.ts) 공용.
// server.ts(진입 파일)에서 분리한 이유: client가 server.ts를 import하면 dist 번들(훅·MCP)에
// server.ts의 import.meta.main 블록이 함께 들어가고, 번들에서는 그 조건이 참이 되어
// 훅·MCP 프로세스 안에서 memory server가 기동된다 (stdout 오염, EADDRINUSE 시 exit).
// 그래서 이 파일은 socket.io·sqlite 없이 node 내장 모듈과 config만 쓴다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveDocDir } from "../hooks/config.ts";
import { DEFAULT_PROVIDER } from "./provider/index.ts";

export const DB_FILENAME = "memory.db";
export const MEMORY_CONFIG_FILENAME = "memory-config.json";
export const DEFAULT_PORT = 41720;

/** 메모리 서버 전용 설정 (memory-config.json) */
export interface MemoryConfig {
  version: number;
  /** path 폴더 안의 sqlite 파일명 */
  db: string;
  /** Socket.IO 포트. 플러그인 config의 port가 설정돼 있으면 그쪽이 우선 */
  port: number;
  /** false = 루프백(127.0.0.1), true = 외부 공개(0.0.0.0). 소켓·웹 대시보드 공용.
   *  구버전 문자열 값("127.0.0.1" 등)은 loadMemoryConfig가 불리언으로 정규화.
   *  외부 공개 시 token 설정을 권장 — 없으면 신뢰할 수 있는 네트워크에서만 열 것 */
  host: boolean;
  /** true면 이 포트의 HTTP GET에서 대시보드(memory/dashboard)를 정적 서빙 */
  web: boolean;
  /** 설정 시 모든 Socket.IO 접속에 핸드셰이크 토큰 요구 (대시보드·MCP 클라이언트 공통).
   *  null·빈 문자열이면 무인증(기존 동작) */
  token: string | null;
  /** 설정 시(예: "haiku") 보정 기록(mem:add/update)마다 modelProvider CLI로
   *  검색 키워드를 비동기 생성. null이면 비활성. 기동 시 1회 로드 — 변경은 서버 재시작 후 반영 */
  model: string | null;
  /** 키워드 보강에 쓸 CLI 공급자 — provider/index.ts의 PROVIDERS 키
   *  ("claude" | "codex" | "gemini"). 기본 "claude" */
  modelProvider: string;
}

export const MEMORY_CONFIG_DEFAULTS: MemoryConfig = {
  version: 1,
  db: DB_FILENAME,
  port: DEFAULT_PORT,
  host: false,
  web: false,
  token: null,
  model: null,
  modelProvider: DEFAULT_PROVIDER,
};

const LOOPBACKS = ["127.0.0.1", "localhost", "::1"];

/** memory-config.json 로드 — 없거나 손상이면 기본값과 병합 (키 단위) */
export function loadMemoryConfig(configPath: string): MemoryConfig {
  try {
    // trim(): UTF-8(BOM) 파일도 파싱되도록
    const raw = JSON.parse(readFileSync(configPath, "utf8").trim());
    const merged: MemoryConfig = { ...MEMORY_CONFIG_DEFAULTS, ...raw };
    // 구버전 host: string 정규화 — 루프백은 false, 그 외("0.0.0.0" 등)는 true
    if (typeof (merged.host as unknown) === "string")
      merged.host = !LOOPBACKS.includes(merged.host as unknown as string);
    merged.web = merged.web === true;
    merged.token =
      typeof merged.token === "string" && merged.token ? merged.token : null;
    return merged;
  } catch {
    return { ...MEMORY_CONFIG_DEFAULTS };
  }
}

/** 클라이언트용: 접속 정보(포트·토큰) 조회 (파일 생성 없음) */
export function resolveMemoryConn(
  projectDir: string
): { port: number; token: string | null } {
  const cfg = loadConfig(projectDir);
  const mc = loadMemoryConfig(
    join(resolveDocDir(projectDir, cfg), MEMORY_CONFIG_FILENAME)
  );
  return { port: cfg.port ?? mc.port, token: mc.token };
}

/** 클라이언트용: 접속할 포트만 조회 (파일 생성 없음) */
export function resolveMemoryPort(projectDir: string): number {
  return resolveMemoryConn(projectDir).port;
}
