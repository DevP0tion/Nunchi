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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveDocDir } from "../hooks/config.ts";

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
}

const MEMORY_CONFIG_DEFAULTS: MemoryConfig = {
  version: 1,
  db: DB_FILENAME,
  port: DEFAULT_PORT,
  host: "127.0.0.1",
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

/** path 폴더를 만들고 memory.db + memory-config.json을 초기화 (멱등). db는 열린 채 반환 */
export function initMemory(projectDir: string): {
  db: Database;
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
  const db = new Database(dbPath); // 파일이 없으면 생성
  applySchema(db);

  return { db, dbPath, configPath, memoryConfig, port: cfg.port ?? memoryConfig.port };
}

/** 테이블 + FTS5 인덱스 초기화 (멱등). 구버전 db는 keywords 컬럼을 추가해 마이그레이션 */
export function applySchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  try {
    // 구버전 db 마이그레이션 — 이미 있으면 duplicate column 에러가 나고 무시된다
    db.run(`ALTER TABLE memory ADD COLUMN keywords TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* 컬럼이 이미 존재 */
  }
  // trigram: 한국어 조사 문제(unicode61은 "검증했다"≠"검증")를 부분 문자열 매칭으로 회피
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      key, value, keywords,
      content='memory', content_rowid='id', tokenize='trigram'
    )
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, key, value, keywords)
      VALUES (new.id, new.key, new.value, new.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, key, value, keywords)
      VALUES ('delete', old.id, old.key, old.value, old.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, key, value, keywords)
      VALUES ('delete', old.id, old.key, old.value, old.keywords);
      INSERT INTO memory_fts(rowid, key, value, keywords)
      VALUES (new.id, new.key, new.value, new.keywords);
    END
  `);
  // 시작 시 재구축: 기존 데이터 백필 + 드리프트 자가 치유 (수백 행 규모 — ms 단위)
  db.run(`INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`);
}

export interface SearchRow {
  key: string;
  value: string;
  updated_at: string;
}

/** set/get/search/setKeywords — 소켓 핸들러와 테스트가 공유하는 저장소 로직 */
export function createStore(db: Database) {
  applySchema(db);
  const upsert = db.prepare(
    // 값이 바뀌면 keywords를 비운다 — 낡은 키워드로 오검색되지 않게. 보강이 다시 채운다
    `INSERT INTO memory (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, keywords = '', updated_at = excluded.updated_at`
  );
  const getStmt = db.prepare(`SELECT value FROM memory WHERE key = ?`);
  const keywordsStmt = db.prepare(
    // value 일치 조건 — 보강 중에 값이 다시 바뀌었으면 낡은 키워드를 버린다
    `UPDATE memory SET keywords = ? WHERE key = ? AND value = ?`
  );
  const ftsStmt = db.prepare(
    `SELECT m.key, m.value, m.updated_at FROM memory_fts f
     JOIN memory m ON m.id = f.rowid
     WHERE memory_fts MATCH ? ORDER BY f.rank LIMIT ?`
  );
  const likeStmt = db.prepare(
    `SELECT key, value, updated_at FROM memory
     WHERE key LIKE ? OR value LIKE ? OR keywords LIKE ?
     ORDER BY updated_at DESC LIMIT ?`
  );

  return {
    set(key: string, value: string): void {
      upsert.run(key, value);
    },
    get(key: string): string | null {
      return (getStmt.get(key) as { value: string } | null)?.value ?? null;
    },
    setKeywords(key: string, value: string, keywords: string): void {
      keywordsStmt.run(keywords, key, value);
    },
    // ponytail: FTS5(trigram) + LIKE 폴백. 시맨틱 검색이 필요해지면 sqlite-vec으로 교체
    search(query: string, limit: number): SearchRow[] {
      const q = query.trim();
      // trigram은 3글자 미만 질의를 매칭하지 못한다 → 짧은 질의는 LIKE로
      if ([...q].length >= 3) {
        try {
          const phrase = `"${q.replaceAll('"', '""')}"`;
          const rows = ftsStmt.all(phrase, limit) as SearchRow[];
          if (rows.length) return rows;
        } catch {
          /* FTS 질의 오류 → LIKE 폴백 */
        }
      }
      const pat = `%${q}%`;
      return likeStmt.all(pat, pat, pat, limit) as SearchRow[];
    },
  };
}

/** claude -p 출력에서 키워드 줄 추출 — 서론이 섞여도 마지막 비어있지 않은 줄을 취한다 */
export function pickKeywordsLine(raw: string): string {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 500);
}

if (import.meta.main) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { db, dbPath, port, memoryConfig } = initMemory(projectDir);
  const store = createStore(db);
  // 보강 모델 — 기동 시 1회 로드. 변경은 memory server 재시작 후 반영
  const model = loadConfig(projectDir).model;

  const ENRICH_TIMEOUT_MS = 60_000;
  /** mem:set 후 백그라운드로 claude -p를 돌려 검색 키워드를 생성 (model 설정 시에만) */
  async function enrich(key: string, value: string): Promise<void> {
    const prompt = [
      "다음 작업 기록을 나중에 검색할 때 쓸 키워드를 생성하라.",
      "원문에 없는 유의어·관련어 위주로 한국어/영어 키워드 10개 이내.",
      "쉼표로 구분된 한 줄만 출력하고 다른 텍스트는 출력하지 마라.",
      "",
      `key: ${key}`,
      `value: ${value}`,
    ].join("\n");
    // 프롬프트는 stdin으로 전달 — Windows cmd 인용 문제를 피한다
    const cmd =
      process.platform === "win32"
        ? ["cmd", "/c", "claude", "-p", "--model", model!]
        : ["claude", "-p", "--model", model!];
    const proc = Bun.spawn(cmd, {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), ENRICH_TIMEOUT_MS);
    try {
      const keywords = pickKeywordsLine(await new Response(proc.stdout).text());
      if (keywords) store.setKeywords(key, value, keywords);
    } catch (e) {
      console.error(`[nunchi] keyword 보강 실패 (${key}): ${e}`);
    } finally {
      clearTimeout(timer);
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
  httpServer.listen(port, memoryConfig.host);

  type Ack = (res: Record<string, unknown>) => void;
  const handle = (fn: () => Record<string, unknown>) => (ack: Ack) => {
    if (typeof ack !== "function") return;
    try {
      ack({ ok: true, ...fn() });
    } catch (e) {
      ack({ ok: false, error: String(e) });
    }
  };

  io.on("connection", (socket) => {
    // 핸드셰이크: 클라이언트가 접속 직후 이 서버의 소유 프로젝트를 확인한다
    // — 여러 프로젝트가 같은 포트를 쓸 때 다른 프로젝트의 db에 조용히 붙는 사고 방지
    socket.on("mem:info", (ack) =>
      handle(() => ({ projectDir, dbPath, port }))(ack)
    );
    socket.on("mem:set", (p, ack) =>
      handle(() => {
        const key = String(p.key);
        const value = String(p.value);
        store.set(key, value);
        if (model) void enrich(key, value); // 비동기 — ack을 막지 않는다
        return {};
      })(ack)
    );
    socket.on("mem:get", (p, ack) =>
      handle(() => ({ value: store.get(String(p.key)) }))(ack)
    );
    socket.on("mem:search", (p, ack) =>
      handle(() => ({
        rows: store.search(String(p.query), Number(p.limit) || 20),
      }))(ack)
    );
    socket.on("mem:shutdown", (ack) => {
      if (typeof ack === "function") ack({ ok: true });
      io.close();
      db.close();
      process.exit(0);
    });
  });

  console.log(`[nunchi] memory server 시작: port ${port}, db ${dbPath}`);
}
