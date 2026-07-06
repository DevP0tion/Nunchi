// nunchi config loader (Bun/TypeScript)
// 우선순위: 프로젝트 .claude/nunchi.json > plugin userConfig(CLAUDE_PLUGIN_OPTION_*) > DEFAULTS
// userConfig는 plugin.json에 선언되고 Claude Code가 환경 변수로 주입한다.
import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

// zero-dependency 실행을 위한 최소 ambient 선언.
// 에디터에서 타입을 제대로 보려면 `bun add -d @types/bun` 후 이 블록을 제거해도 된다.
declare global {
  var Bun: {
    stdin: { text(): Promise<string> };
    spawn(cmd: string[], opts?: Record<string, unknown>): {
      unref(): void;
      kill(): void;
      stdout: ReadableStream<Uint8Array>;
    };
  };
}

export interface NunchiConfig {
  /** true면 SessionStart 시 memory server(server.ts) 자동 시작 */
  "auto-start": boolean;
  /** calibration 문서가 저장될 폴더 (프로젝트 루트 기준 상대 또는 절대) */
  path: string;
  /** memory server(Socket.IO) 포트. 미설정(null) 시 memory-config.json의 port(기본 41720) 사용 */
  port: number | null;
  /** 설정 시 mem:set마다 `claude -p --model <값>`으로 검색 키워드를 비동기 생성. null이면 비활성 */
  model: string | null;
  /** 설정 시 로컬 서버 대신 이 주소의 외부 memory server에 연결 (예: "http://192.168.0.10:41720").
   *  스킴 생략 시 http:// 로 간주. 로컬 스폰·프로젝트 핸드셰이크는 생략된다 */
  "external-address": string | null;
}

export const DEFAULTS: NunchiConfig = {
  "auto-start": true,
  path: ".claude/nunchi",
  port: null,
  model: null,
  "external-address": null,
};

/** path 폴더 안의 calibration 문서 파일명 (고정) */
export const DOC_FILENAME = "calibration.md";

/** Claude Code hook이 stdin으로 전달하는 JSON의 사용 필드 */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  source?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
}

export async function readStdinJson(): Promise<HookInput> {
  try {
    const raw = await Bun.stdin.text();
    return raw ? (JSON.parse(raw) as HookInput) : {};
  } catch {
    return {};
  }
}

function readJson(p: string): Partial<NunchiConfig> {
  try {
    // trim(): Windows 에디터가 만든 UTF-8(BOM) 파일도 파싱되도록 (BOM은 JS 공백)
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8").trim());
  } catch {
    /* 손상된 config는 무시하고 다음 계층으로 */
  }
  return {};
}

/** plugin.json userConfig → CLAUDE_PLUGIN_OPTION_<KEY_대문자> 환경 변수 */
function envConfig(): Partial<NunchiConfig> {
  const cfg: Partial<NunchiConfig> = {};
  const autoStart = process.env.CLAUDE_PLUGIN_OPTION_AUTO_START;
  if (autoStart !== undefined) cfg["auto-start"] = autoStart !== "false";
  const path = process.env.CLAUDE_PLUGIN_OPTION_PATH;
  if (path) cfg.path = path;
  const port = parseInt(process.env.CLAUDE_PLUGIN_OPTION_PORT ?? "", 10);
  if (Number.isFinite(port)) cfg.port = port;
  const model = process.env.CLAUDE_PLUGIN_OPTION_MODEL;
  if (model) cfg.model = model;
  const external = process.env.CLAUDE_PLUGIN_OPTION_EXTERNAL_ADDRESS;
  if (external) cfg["external-address"] = external;
  return cfg;
}

export function loadConfig(projectDir: string): NunchiConfig {
  const projectCfg = readJson(join(projectDir, ".claude", "nunchi.json"));
  const merged = { ...DEFAULTS, ...envConfig(), ...projectCfg };

  // 타입 방어: 잘못된 값은 기본값으로 강제
  return {
    "auto-start": merged["auto-start"] !== false, // 명시적 false만 꺼짐
    path:
      typeof merged.path === "string" && merged.path.trim()
        ? merged.path.trim()
        : DEFAULTS.path,
    port: Number.isFinite(merged.port as number) ? (merged.port as number) : null,
    model:
      typeof merged.model === "string" && merged.model.trim()
        ? merged.model.trim()
        : null,
    "external-address":
      typeof merged["external-address"] === "string" && merged["external-address"].trim()
        ? merged["external-address"].trim()
        : null,
  };
}

/** calibration 폴더 절대 경로 */
export function resolveDocDir(projectDir: string, cfg: NunchiConfig): string {
  return isAbsolute(cfg.path) ? cfg.path : join(projectDir, cfg.path);
}

/** calibration 문서 절대 경로 (폴더 + 고정 파일명) */
export function resolveDocPath(projectDir: string, cfg: NunchiConfig): string {
  return join(resolveDocDir(projectDir, cfg), DOC_FILENAME);
}
