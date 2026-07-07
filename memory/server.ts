#!/usr/bin/env bun
// nunchi memory server (Bun)
// rag db(sqlite)를 단일 프로세스가 소유하고 Socket.IO로 노출한다.
// 여러 MCP 서버가 동시에 떠도 sqlite에 직접 접근하지 않고 이 서버에
// 클라이언트(client.ts)로 접속하므로 동시 접근 문제가 없다.
// 단일 실행 보장: 포트 바인딩이 락 — 이미 떠 있으면 EADDRINUSE로 감지하고 종료(exit 0).
// memory-config.json: 메모리 서버 전용 설정 — 플러그인 config(nunchi.json/userConfig)와 별개.
//   플러그인 config는 "어디에"(path)만 정하고, 서버 동작 설정은 전부 이 파일이 담당한다.
import { Database } from "bun:sqlite";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadConfig, resolveDocDir, resolveDocPath } from "../hooks/config.ts";
import {
  createMemoryStore,
  importLegacyDoc,
  renderMemoryDoc,
  type NewMemoryEntry,
} from "./store.ts";
import { DEFAULT_PROVIDER, PROVIDERS } from "./provider/index.ts";

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
  /** 바인딩 주소. 기본 루프백. 외부 클라이언트(external-address)에게 서비스하려면
   *  "0.0.0.0" 등으로 변경 — 인증이 없으므로 신뢰할 수 있는 네트워크에서만 열 것 */
  host: string;
  /** 설정 시(예: "haiku") 보정 기록(mem:add/update)마다 modelProvider CLI로
   *  검색 키워드를 비동기 생성. null이면 비활성. 기동 시 1회 로드 — 변경은 서버 재시작 후 반영 */
  model: string | null;
  /** 키워드 보강에 쓸 CLI 공급자 — provider/index.ts의 PROVIDERS 키
   *  ("claude" | "codex" | "gemini"). 기본 "claude" */
  modelProvider: string;
}

const MEMORY_CONFIG_DEFAULTS: MemoryConfig = {
  version: 1,
  db: DB_FILENAME,
  port: DEFAULT_PORT,
  host: "127.0.0.1",
  model: null,
  modelProvider: DEFAULT_PROVIDER,
};

/** memory-config.json 로드 — 없거나 손상이면 기본값과 병합 (키 단위) */
export function loadMemoryConfig(configPath: string): MemoryConfig {
  try {
    // trim(): UTF-8(BOM) 파일도 파싱되도록
    const raw = JSON.parse(readFileSync(configPath, "utf8").trim());
    return { ...MEMORY_CONFIG_DEFAULTS, ...raw };
  } catch {
    return { ...MEMORY_CONFIG_DEFAULTS };
  }
}

/** 클라이언트용: 접속할 포트만 조회 (파일 생성 없음) */
export function resolveMemoryPort(projectDir: string): number {
  const cfg = loadConfig(projectDir);
  const mc = loadMemoryConfig(
    join(resolveDocDir(projectDir, cfg), MEMORY_CONFIG_FILENAME)
  );
  return cfg.port ?? mc.port;
}

/** path 폴더를 만들고 memory-config.json을 초기화 (멱등). DB는 열지 않는다 —
 *  포트 락(단일 실행)을 딴 뒤에만 열어, EADDRINUSE로 곧 종료될 패자 프로세스가
 *  DB 파일을 잠깐이라도 잠그지 않게 한다 */
export function initMemory(projectDir: string): {
  dbPath: string;
  configPath: string;
  memoryConfig: MemoryConfig;
  port: number;
} {
  const cfg = loadConfig(projectDir);
  const dir = resolveDocDir(projectDir, cfg);
  mkdirSync(dir, { recursive: true });

  const configPath = join(dir, MEMORY_CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(MEMORY_CONFIG_DEFAULTS, null, 2) + "\n");
  }
  const memoryConfig = loadMemoryConfig(configPath);

  const dbPath = join(dir, memoryConfig.db);
  return { dbPath, configPath, memoryConfig, port: cfg.port ?? memoryConfig.port };
}

/** claude -p 출력에서 키워드 줄 추출 — 서론이 섞여도 마지막 비어있지 않은 줄을 취한다 */
export function pickKeywordsLine(raw: string): string {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 500);
}

if (import.meta.main) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { dbPath, port, memoryConfig } = initMemory(projectDir);
  const pluginCfg = loadConfig(projectDir); // calibration.md 임포트 경로(path) 해석용
  // 보강 모델·공급자 — memory-config.json에서 기동 시 1회 로드. 변경은 memory server 재시작 후 반영
  const model = memoryConfig.model;
  const provider = PROVIDERS[memoryConfig.modelProvider] ?? PROVIDERS[DEFAULT_PROVIDER];
  if (!PROVIDERS[memoryConfig.modelProvider])
    console.error(
      `[nunchi] 알 수 없는 modelProvider "${memoryConfig.modelProvider}" — ${DEFAULT_PROVIDER}로 대체`
    );

  const ENRICH_TIMEOUT_MS = 60_000;
  let kwSeq = 0; // output: "file" 공급자의 임시 파일 이름 충돌 방지
  /** provider CLI로 검색 키워드 생성 (model 설정 시에만 호출됨). 실패 시 빈 문자열 */
  async function generateKeywords(label: string, body: string): Promise<string> {
    const prompt = [
      "다음 작업 기록을 나중에 검색할 때 쓸 키워드를 생성하라.",
      "원문에 없는 유의어·관련어 위주로 한국어/영어 키워드 10개 이내.",
      "쉼표로 구분된 한 줄만 출력하고 다른 텍스트는 출력하지 마라.",
      "",
      `key: ${label}`,
      `value: ${body}`,
    ].join("\n");
    const outFile = join(tmpdir(), `nunchi-kw-${process.pid}-${++kwSeq}.txt`);
    const argv = provider.argv(model!, outFile);
    const cmd = process.platform === "win32" ? ["cmd", "/c", ...argv] : argv;
    const proc = Bun.spawn(cmd, {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), ENRICH_TIMEOUT_MS);
    try {
      let text = await new Response(proc.stdout).text(); // stdout EOF = 프로세스 종료 대기
      if (provider.output === "file") text = readFileSync(outFile, "utf8");
      return pickKeywordsLine(text);
    } catch (e) {
      console.error(`[nunchi] keyword 보강 실패 (${label}): ${e}`);
      return "";
    } finally {
      clearTimeout(timer);
      if (provider.output === "file") rmSync(outFile, { force: true });
    }
  }
  // 기본 루프백 바인딩. 외부 서비스가 필요하면 memory-config.json의 host를 변경
  const httpServer = createServer();
  httpServer.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.log(`[nunchi] memory server가 이미 실행 중 (port ${port}) — 종료`);
      process.exit(0);
    }
    throw e;
  });
  const io = new Server(httpServer);

  type Ack = (res: Record<string, unknown>) => void;
  // 작업 로그 — 서버 터미널 창에서 무슨 일이 오가는지 보이도록
  const ts = () => new Date().toTimeString().slice(0, 8);
  const summarize = (res: Record<string, unknown>): string => {
    if (Array.isArray(res.rows)) return `${res.rows.length}건`;
    if (res.id !== undefined) return `#${res.id}`;
    if (res.updated !== undefined) return `updated=${res.updated}`;
    if (res.removed !== undefined) return `removed=${res.removed}`;
    if ("doc" in res) return res.doc ? "렌더" : "없음";
    if ("stamp" in res) return String(res.stamp);
    return "";
  };
  const handle = (ev: string, fn: () => Record<string, unknown>) => (ack: Ack) => {
    if (typeof ack !== "function") return;
    try {
      const res = fn();
      console.log(`[${ts()}] ${ev} ${summarize(res)}`.trimEnd());
      ack({ ok: true, ...res });
    } catch (e) {
      console.error(`[${ts()}] ${ev} 실패: ${e}`);
      ack({ ok: false, error: String(e) });
    }
  };

  // 포트 락(단일 실행)을 딴 뒤에만 DB를 연다 — EADDRINUSE 패자는 DB를 건드리지 않는다.
  // 콜백 본문은 동기 실행이므로 핸들러 등록 전에 connection 이벤트가 끼어들 수 없다
  httpServer.listen(port, memoryConfig.host, () => {
  const db = new Database(dbPath); // 파일이 없으면 생성 (createMemoryStore가 스키마 적용)
  const store = createMemoryStore(db);
  // 구버전 calibration.md — 기동 시 1회만 DB로 임포트한다 (이후는 mem:doc이 DB에서 렌더링)
  const imported = importLegacyDoc(store, resolveDocPath(projectDir, pluginCfg));
  if (imported !== null)
    console.log(`[nunchi] calibration.md 임포트: ${imported}건 → DB (원본은 .imported로 보존)`);
  /** mem:add/update 후 백그라운드 보강 — updated_at 가드로 낡은 키워드 폐기 */
  async function enrich(id: number): Promise<void> {
    const e = store.get(id);
    if (!e) return;
    const keywords = await generateKeywords(e.area, `${e.rule} / ${e.evidence}`);
    if (keywords) {
      store.setKeywords(id, e.updated_at, keywords);
      console.log(`[${ts()}] enrich #${id} keywords: ${keywords}`);
    }
  }

  io.on("connection", (socket) => {
    // 핸드셰이크: 클라이언트가 접속 직후 이 서버의 소유 프로젝트를 확인한다
    // — 여러 프로젝트가 같은 포트를 쓸 때 다른 프로젝트의 db에 조용히 붙는 사고 방지
    socket.on("mem:info", (ack) =>
      handle("mem:info", () => ({ projectDir, dbPath, port }))(ack)
    );
    // 보정 문서 — DB에서 렌더링 (external-address 구버전 클라이언트·내보내기 겸용)
    socket.on("mem:doc", (ack) =>
      handle("mem:doc", () => ({ doc: renderMemoryDoc(store, basename(projectDir)) }))(ack)
    );
    socket.on("mem:add", (p, ack) =>
      handle(`mem:add [${p.area}]`, () => {
        const id = store.add({
          section: p.section, area: String(p.area), rule: String(p.rule),
          evidence: String(p.evidence),
          confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : undefined,
        } as NewMemoryEntry);
        if (model) void enrich(id);
        return { id };
      })(ack)
    );
    socket.on("mem:update", (p, ack) =>
      handle(`mem:update #${p.id}${p.confirm ? " confirm" : ""}`, () => {
        const id = Number(p.id);
        if (p.confirm) return { updated: store.confirm(id) };
        const fields: Partial<NewMemoryEntry> = {};
        if (p.section !== undefined) fields.section = p.section;
        if (p.area !== undefined) fields.area = String(p.area);
        if (p.rule !== undefined) fields.rule = String(p.rule);
        if (p.evidence !== undefined) fields.evidence = String(p.evidence);
        if (p.confidence !== undefined) fields.confidence = Number(p.confidence);
        const updated = store.update(id, fields);
        if (updated && model && (fields.area ?? fields.rule ?? fields.evidence) !== undefined)
          void enrich(id);
        return { updated };
      })(ack)
    );
    socket.on("mem:remove", (p, ack) =>
      handle(`mem:remove #${p.id}`, () => ({ removed: store.remove(Number(p.id)) }))(ack)
    );
    socket.on("mem:search", (p, ack) => {
      const queries = Array.isArray(p.queries) ? p.queries.map(String) : [];
      handle(`mem:search [${queries.join(" | ")}]`, () => ({
        rows: store.search(queries, {
          section: p.section, limit: Number(p.limit) || undefined,
          excludeCore: Boolean(p.excludeCore),
        }),
      }))(ack);
    });
    socket.on("mem:list", (p, ack) =>
      handle("mem:list", () => ({
        rows: store.list({
          section: p?.section,
          minConfidence: Number(p?.minConfidence) || undefined,
        }),
      }))(ack)
    );
    socket.on("mem:core", (ack) => handle("mem:core", () => ({ rows: store.core() }))(ack));
    socket.on("mem:stamp", (ack) => handle("mem:stamp", () => ({ stamp: store.stamp() }))(ack));
    socket.on("mem:shutdown", (ack) => {
      console.log(`[${ts()}] mem:shutdown — 종료`);
      if (typeof ack === "function") ack({ ok: true });
      // db를 먼저 닫는다 — 클라이언트가 disconnect를 볼 시점엔 DB 파일 잠금이 해제된 뒤다
      // (ack 직후 rmSync하는 테스트의 EBUSY 경쟁 방지)
      db.close();
      io.close();
      process.exit(0);
    });
  });

  console.log(`[nunchi] memory server 시작: port ${port}, db ${dbPath}`);
  });
}
