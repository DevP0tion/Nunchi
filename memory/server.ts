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
import { basename, extname, join, resolve, sep } from "node:path";
import {
  BUNDLED,
  PLUGIN_ROOT,
  VERSION,
  loadConfig,
  resolveDocDir,
  resolveDocPath,
} from "../hooks/config.ts";
import {
  createMemoryStore,
  importLegacyDoc,
  renderMemoryDoc,
  type NewMemoryEntry,
} from "./store.ts";
import { createTopicStore, sessionLabel, type SessionRow } from "./topics.ts";
import {
  readSessionState,
  removeSessionFiles,
  writeSessionState,
  type SessionStateFile,
  type TopicState,
} from "./session-state.ts";
import { DEFAULT_PROVIDER, PROVIDERS } from "./provider/index.ts";
import {
  MEMORY_CONFIG_DEFAULTS,
  MEMORY_CONFIG_FILENAME,
  loadMemoryConfig,
  type MemoryConfig,
} from "./memory-config.ts";

// 기존 import 경로 호환 — client는 이 진입 파일이 아니라 memory-config.ts를 직접 import해야 한다
export * from "./memory-config.ts";

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

/** 보강 CLI 스폰 — 프롬프트는 stdin, 응답은 stdout 파이프 */
export function spawnProvider(argv: string[], prompt: string) {
  const cmd = process.platform === "win32" ? ["cmd", "/c", ...argv] : argv;
  return Bun.spawn(cmd, {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "ignore",
    // 서버 창 콘솔을 공유하면 자식 CLI(claude 등)가 창 제목을 덮어쓴다
    windowsHide: true,
  });
}

if (import.meta.main) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { dbPath, configPath, port, memoryConfig } = initMemory(projectDir);
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
    const proc = spawnProvider(provider.argv(model!, outFile), prompt);
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
  // 기본 루프백 바인딩. 외부 서비스가 필요하면 memory-config.json의 host를 true로
  const httpServer = createServer();
  httpServer.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.log(`[nunchi] memory server가 이미 실행 중 (port ${port}) — 종료`);
      process.exit(0);
    }
    throw e;
  });
  // web: true — 이 포트의 HTTP GET에서 대시보드(memory/dashboard)를 정적 서빙.
  // io 생성 전에 등록해야 engine.io가 이 리스너를 캡처해 /socket.io 외 경로에만 위임한다
  if (memoryConfig.web) {
    const dashDir = join(PLUGIN_ROOT, "memory", "dashboard"); // 번들(dist)은 dashboard를 복사하지 않는다
    const MIME: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };
    httpServer.on("request", (req, res) => {
      if (req.url?.startsWith("/socket.io/")) return; // 등록 순서가 바뀌어도 io 응답과 충돌하지 않도록
      let file = "";
      try {
        const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
        file = resolve(dashDir, "." + (pathname === "/" ? "/index.html" : pathname));
      } catch {
        /* 잘못된 URL·인코딩 → 아래 404 */
      }
      // 경로 탈출 방지: 정규화 결과가 dashboard 루트 밖이면 거부 (host 공개 시 필수)
      if (!file.startsWith(dashDir + sep) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
  }

  // serveClient: false — 번들은 socket.io의 __dirname을 빌드 머신 절대 경로로 박아 client-dist를 못 찾는다.
  // 대시보드 클라이언트는 build.ts가 memory/dashboard에 복사한 socket.io.min.js를 위 정적 경로로 서빙
  const io = new Server(httpServer, { serveClient: false });
  // token 설정 시 모든 접속에 핸드셰이크 토큰 요구 (대시보드·MCP 클라이언트 공통).
  // 구버전 external-address 클라이언트는 토큰을 못 보내므로, 그런 환경에선 token을 설정하지 말 것
  if (memoryConfig.token) {
    io.use((socket, next) =>
      socket.handshake.auth?.token === memoryConfig.token
        ? next()
        : next(new Error("unauthorized"))
    );
  }

  type Ack = (res: Record<string, unknown>) => void;
  // 작업 로그 — 서버 터미널 창에서 무슨 일이 오가는지 보이도록
  const ts = () => new Date().toTimeString().slice(0, 8);
  const summarize = (res: Record<string, unknown>): string => {
    if (Array.isArray(res.rows)) return `${res.rows.length}건`;
    if (res.count !== undefined) return `${res.count}건`;
    if ("tree" in res) return res.tree ? "1건" : "없음";
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
  httpServer.listen(port, memoryConfig.host ? "0.0.0.0" : "127.0.0.1", () => {
  const db = new Database(dbPath); // 파일이 없으면 생성 (createMemoryStore가 스키마 적용)
  const store = createMemoryStore(db);
  // 구버전 calibration.md — 기동 시 1회만 DB로 임포트한다 (이후는 mem:doc이 DB에서 렌더링)
  const imported = importLegacyDoc(store, resolveDocPath(projectDir, pluginCfg));
  if (imported !== null)
    console.log(`[nunchi] calibration.md 임포트: ${imported}건 → DB (원본은 .imported로 보존)`);
  const topics = createTopicStore(db);
  // 상태 파일 위치 — initMemory와 같은 폴더 (훅이 소켓 없이 읽는다)
  const docDir = resolveDocDir(projectDir, pluginCfg);
  const SAFE_SID = /^[A-Za-z0-9_-]+$/;
  const sid = (v: unknown): string => {
    const id = String(v ?? "");
    if (!SAFE_SID.test(id)) throw new Error(`잘못된 sessionId: ${id}`);
    return id;
  };
  const topicState = (topicId: number | null): TopicState | null => {
    const t = topicId === null ? null : topics.get(topicId);
    return t ? { id: t.id, name: t.name, description: t.description, folders: t.folders, areas: topics.areas(t.id) } : null;
  };
  const withLabel = (s: SessionRow) => ({ ...s, label: sessionLabel(s) });
  /** 만료 세션 정리 — 행과 상태 파일 모두 */
  const expire = () => {
    for (const id of topics.expireSessions()) {
      try { removeSessionFiles(docDir, id); } catch (e) { console.error(`[nunchi] 세션 파일 삭제 실패 (${id}): ${e}`); }
    }
  };
  /** 세션별로 렌더링한 주제 상태가 파일과 다르면 rev를 올리고 파일을 다시 쓴다 — 훅은 rev만 비교한다 */
  // shortcut: 변경마다 모든 세션 상태를 다시 계산, 세션이 수십 개를 넘으면 영향받은 세션만 동기화
  function syncSessionStates(): void {
    for (const row of topics.sessions()) {
      try {
        const want = topicState(row.topic_id);
        const cur = readSessionState(docDir, row.session_id);
        if (!cur && want === null) continue;
        if (cur && JSON.stringify(cur.topic) === JSON.stringify(want)) continue;
        writeSessionState(docDir, row.session_id, { rev: topics.bumpRev(row.session_id), topic: want });
      } catch (e) {
        console.error(`[nunchi] 세션 상태 파일 쓰기 실패 (${row.session_id}): ${e}`);
      }
    }
  }
  /** 변경성 이벤트 뒤처리 — 상태 파일 동기화 + 대시보드에 갱신 알림 */
  const changed = () => {
    syncSessionStates();
    io.emit("ws:changed");
  };
  expire();
  syncSessionStates();

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

  /** 구 클라이언트 하위 호환: 섹션 구 이름 forgive → recommend (v0.13.5) */
  const sec = (s: unknown) => (s === "forgive" ? "recommend" : s);
  const kindOf = (k: unknown) => (k === "level" || k === "method" ? k : undefined);

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
        // 세션에 주제가 있으면 새 기억을 그 주제에 소속시킨다
        const tid = p.sessionId ? topics.session(sid(p.sessionId))?.topic_id : null;
        const id = store.add({
          section: sec(p.section), area: String(p.area), rule: String(p.rule),
          evidence: String(p.evidence),
          confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : undefined,
          kind: kindOf(p.kind),
          parent: Number.isFinite(p.parent) ? Number(p.parent) : undefined,
        } as NewMemoryEntry & { parent?: number });
        if (tid != null) topics.link(tid, [id]);
        changed();
        // 관찰은 자동 회수 제외 대상 — 보강 비용을 쓰지 않는다 (승격 시 promote가 보강)
        if (model && p.section !== "observe") void enrich(id);
        return { id };
      })(ack)
    );
    socket.on("mem:promote", (p, ack) =>
      handle(`mem:promote [${p.area}]`, () => {
        const id = store.promote(
          (Array.isArray(p.sources) ? p.sources : []).map(Number),
          {
            section: sec(p.section), area: String(p.area), rule: String(p.rule),
            evidence: String(p.evidence),
            confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : undefined,
            kind: kindOf(p.kind),
          } as NewMemoryEntry
        );
        changed();
        if (model) void enrich(id);
        return { id };
      })(ack)
    );
    socket.on("mem:tree", (p, ack) =>
      handle(`mem:tree #${p.id}`, () => ({ tree: store.tree(Number(p.id)) }))(ack)
    );
    socket.on("mem:export", (ack) =>
      handle("mem:export", () => {
        const rows = store.exportEvents();
        return { count: rows.length, jsonl: rows.map((e) => JSON.stringify(e)).join("\n") };
      })(ack)
    );
    socket.on("mem:update", (p, ack) =>
      handle(`mem:update #${p.id}${p.confirm ? " confirm" : p.reverse ? " reverse" : Array.isArray(p.link) ? " link" : ""}`, () => {
        const id = Number(p.id);
        if (p.confirm) {
          const session = p.sessionId ? sid(p.sessionId) : null; // confirm 전에 검증 — 잘못된 id가 반쯤 적용된 상태를 남기지 않게
          const updated = store.confirm(id);
          if (updated && session) topics.confirmInTopic(session, id);
          changed();
          return { updated };
        }
        if (Array.isArray(p.link))
          return { updated: store.link(id, p.link.map(Number)) };
        if (p.reverse) {
          // reverse는 store가 권장(level) 전용을 검증한다 (method·env·punish·task 대상은 throw)
          if (p.evidence === undefined) throw new Error("reverse에는 evidence(새 사건 1줄)가 필요하다");
          const updated = store.reverse(id, String(p.evidence));
          // reverse는 evidence를 교체해 keywords가 비워지므로 edit 경로와 동일하게 재보강한다
          if (updated && model) void enrich(id);
          changed();
          return { updated };
        }
        const fields: Partial<NewMemoryEntry> = {};
        if (p.section !== undefined) fields.section = sec(p.section) as NewMemoryEntry["section"];
        if (kindOf(p.kind)) fields.kind = kindOf(p.kind);
        if (p.area !== undefined) fields.area = String(p.area);
        if (p.rule !== undefined) fields.rule = String(p.rule);
        if (p.evidence !== undefined) fields.evidence = String(p.evidence);
        if (p.confidence !== undefined) fields.confidence = Number(p.confidence);
        const updated = store.update(id, fields);
        if (updated && model && (fields.area ?? fields.rule ?? fields.evidence) !== undefined)
          void enrich(id);
        changed();
        return { updated };
      })(ack)
    );
    socket.on("mem:remove", (p, ack) =>
      handle(`mem:remove #${p.id}`, () => {
        const removed = store.remove(Number(p.id));
        changed();
        return { removed };
      })(ack)
    );
    socket.on("mem:search", (p, ack) => {
      const queries = Array.isArray(p.queries) ? p.queries.map(String) : [];
      handle(`mem:search [${queries.join(" | ")}]`, () => {
        const base = {
          // 구 클라이언트의 단수 section 페이로드를 배열로 매핑 (하위 호환)
          sections: Array.isArray(p.sections) ? p.sections.map(sec) : p.section ? [sec(p.section)] : undefined,
          excludeCore: Boolean(p.excludeCore),
          strict: Boolean(p.strict),
        };
        const limit = Number(p.limit) || 3; // store.search 기본값과 같다
        // 주제: 소속으로 먼저 limit까지 채우고, 남는 자리를 일반 검색으로 보충한다 (훅·MCP 공통 경로)
        const tid = p.topicId != null ? Number(p.topicId)
          : p.sessionId ? topics.session(sid(p.sessionId))?.topic_id ?? null : null;
        const ids = tid != null ? topics.memberIds(tid) : [];
        if (!ids.length) return { rows: store.search(queries, { ...base, limit }) };
        const own = store.search(queries, { ...base, limit, onlyIds: ids }).map((r) => ({ ...r, topic: true }));
        const rest = own.length < limit
          ? store.search(queries, { ...base, limit: limit - own.length, excludeIds: ids }) : [];
        return { rows: [...own, ...rest] };
      })(ack);
    });
    socket.on("mem:list", (p, ack) =>
      handle("mem:list", () => ({
        rows: store.list({
          section: sec(p?.section) as NewMemoryEntry["section"] | undefined,
          minConfidence: Number(p?.minConfidence) || undefined,
          withObserve: Boolean(p?.withObserve),
          ids: Array.isArray(p?.ids) ? p.ids.map(Number) : undefined,
        }),
      }))(ack)
    );
    socket.on("mem:core", (ack) => handle("mem:core", () => ({ rows: store.core() }))(ack));
    socket.on("mem:stamp", (ack) => handle("mem:stamp", () => ({ stamp: store.stamp() }))(ack));
    // ── 주제·작업공간·세션 (ws:*) ──
    // 페이로드 없는 이벤트는 (ack)만 받는다 — 어느 쪽이든 p는 객체로 정규화
    const ws = (ev: string, fn: (p: any) => Record<string, unknown>, mutate = false) =>
      socket.on(ev, (p, ack) => {
        if (typeof p === "function") [p, ack] = [{}, p];
        handle(ev, () => {
          const res = fn(p ?? {});
          if (mutate) changed();
          return res;
        })(ack);
      });
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
    const opt = (v: unknown) => (v == null ? undefined : String(v));
    const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number) : []);
    const stateOf = (id: string): SessionStateFile & { memberIds: number[] } => {
      const row = topics.session(id);
      return {
        rev: row?.topic_rev ?? 0,
        topic: topicState(row?.topic_id ?? null),
        memberIds: row?.topic_id != null ? topics.memberIds(row.topic_id) : [],
      };
    };
    ws("ws:board", () => {
      expire(); // 조회 전에 만료 처리
      return { topics: topics.list(), sessions: topics.sessions().map(withLabel) };
    });
    ws("ws:topic", (p) => ({
      topic: topics.get(Number(p.id)),
      members: topics.members(Number(p.id)),
      sessions: topics.sessions().filter((s) => s.topic_id === Number(p.id)).map(withLabel),
    }));
    ws("ws:topic:create", (p) => ({
      id: topics.create({ name: String(p.name ?? ""), description: opt(p.description), folders: strs(p.folders) }),
    }), true);
    ws("ws:topic:update", (p) => ({
      updated: topics.update(Number(p.id), { name: opt(p.name), description: opt(p.description), folders: strs(p.folders) }),
    }), true);
    ws("ws:topic:remove", (p) => {
      const removed = topics.get(Number(p.id)) !== null;
      topics.remove(Number(p.id)); // 해제된 세션의 상태 파일은 changed()의 동기화가 갱신한다
      return { removed };
    }, true);
    ws("ws:topic:link", (p) => ({ count: topics.link(Number(p.topicId), nums(p.memoryIds)) }), true);
    ws("ws:topic:unlink", (p) => ({ count: topics.unlink(Number(p.topicId), nums(p.memoryIds)) }), true);
    ws("ws:topic:rate", (p) => {
      const delta = Number(p.delta);
      if (delta !== 1 && delta !== -1) throw new Error(`잘못된 delta: ${p.delta} (1 또는 -1)`);
      return { confidence: topics.rate(Number(p.topicId), Number(p.memoryId), delta) };
    }, true);
    ws("ws:session:register", (p) => {
      const created = topics.registerSession({
        sessionId: sid(p.sessionId),
        title: p.title == null ? null : String(p.title),
        cwd: p.cwd == null ? null : String(p.cwd),
        prompt: p.prompt == null ? undefined : String(p.prompt),
      });
      return { created };
    }, true);
    ws("ws:session:end", (p) => {
      const id = sid(p.sessionId);
      topics.endSession(id);
      try { removeSessionFiles(docDir, id); } catch (e) { console.error(`[nunchi] 세션 파일 삭제 실패 (${id}): ${e}`); }
      return {};
    }, true);
    ws("ws:session:set", (p) => {
      const id = sid(p.sessionId);
      topics.setSessionTopic(id, p.topicId == null ? null : Number(p.topicId));
      syncSessionStates(); // 응답의 rev가 동기화 결과를 담도록 먼저 실행 (뒤의 changed()는 변화 없으면 no-op)
      const { rev, topic } = stateOf(id);
      return { rev, topic };
    }, true);
    ws("ws:session", (p) => stateOf(sid(p.sessionId)));
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

  // 기동 정보 — 창이 여럿 떠 있을 때 어느 버전·설치 경로·프로젝트의 서버인지 식별용 (token 값은 출력 금지)
  console.log(
    [
      `[nunchi] memory server v${VERSION} 시작 — pid ${process.pid}, bun ${Bun.version}, ${BUNDLED ? "번들" : "소스"} 실행`,
      `  프로젝트: ${projectDir}`,
      `  DB: ${dbPath}`,
      `  설정: ${configPath}`,
      `  주소: ${memoryConfig.host ? "0.0.0.0(외부 공개)" : "127.0.0.1(루프백)"}:${port}, 토큰 ${memoryConfig.token ? "사용" : "없음"}`,
      `  대시보드: ${memoryConfig.web ? `http://127.0.0.1:${port}` : `비활성 (${MEMORY_CONFIG_FILENAME}의 web: true로 활성화)`}`,
      `  키워드 보강: ${model ? `${model} (${PROVIDERS[memoryConfig.modelProvider] ? memoryConfig.modelProvider : DEFAULT_PROVIDER})` : "비활성"}`,
      `  실행 파일: ${process.argv[1]}`,
    ].join("\n")
  );

  // 'o' 키로 웹 대시보드 열기 — 새 터미널 창에서 서버가 뜨는 환경(win32) 편의 기능.
  // detached 스폰(stdio ignore)에선 isTTY가 아니므로 자동으로 비활성화된다
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (buf) => {
      const key = buf.toString();
      if (key === "\x03") process.exit(0); // raw mode에선 Ctrl+C 신호가 안 오므로 직접 종료
      if (key.toLowerCase() !== "o") return;
      if (!memoryConfig.web) {
        console.log(`[nunchi] 대시보드 비활성 — ${MEMORY_CONFIG_FILENAME}의 web을 true로 설정`);
        return;
      }
      const url = `http://127.0.0.1:${port}`;
      const argv =
        process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : [process.platform === "darwin" ? "open" : "xdg-open", url];
      Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" });
      console.log(`[${ts()}] 대시보드 열기: ${url}`);
    });
    console.log("[nunchi] o 키: 웹 대시보드 열기");
  }
  });
}
