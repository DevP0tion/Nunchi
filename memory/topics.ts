// nunchi 주제·작업공간·세션 저장소 (Bun)
// events 저널 밖의 조직 정보 — replay(rebuildDerived)는 이 테이블을 건드리지 않는다.
// FK·CASCADE를 쓰지 않는다: replay가 memory를 비울 때 소속 행이 지워지면 안 된다.
// store.ts와 순환 import — 상대 모듈의 바인딩은 함수 안에서만 쓴다.
import type { Database } from "bun:sqlite";
import { isCore, type MemoryEntry } from "./store.ts";

export const SESSION_TTL_HOURS = 24;
/** 주제 핵심 영역 기준: 주제 신뢰도 3+, 최대 30개 */
export const TOPIC_AREA_MIN = 3;
export const TOPIC_AREA_MAX = 30;

export interface Topic {
  id: number;
  name: string;
  description: string;
  folders: string[];
  created_at: string;
  updated_at: string;
}
export interface TopicSummary extends Topic { memberCount: number }
export interface TopicMember extends MemoryEntry { topic_confidence: number }
export interface SessionRow {
  session_id: string;
  title: string | null;
  first_prompt: string;
  cwd: string | null;
  topic_id: number | null;
  topic_rev: number;
  last_seen: string;
}
export interface TopicArea { id: number; area: string }

const NOW = `strftime('%Y-%m-%d %H:%M:%f','now')`;

export function applyTopicSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    updated_at TEXT NOT NULL DEFAULT (${NOW}))`);
  db.run(`CREATE TABLE IF NOT EXISTS topic_folders (
    topic_id INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY (topic_id, path))`);
  db.run(`CREATE TABLE IF NOT EXISTS topic_members (
    topic_id INTEGER NOT NULL, memory_id INTEGER NOT NULL,
    confidence INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (topic_id, memory_id))`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY, title TEXT, first_prompt TEXT NOT NULL DEFAULT '', cwd TEXT,
    topic_id INTEGER, topic_rev INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL)`);
}

/** 세션 표시 이름 — 사용자 지정 제목, 없으면 첫 프롬프트 앞 30자 + 세션 id 앞 4자 */
export function sessionLabel(s: SessionRow): string {
  return s.title ?? `${s.first_prompt.slice(0, 30)} · ${s.session_id.slice(0, 4)}`;
}

export function createTopicStore(db: Database) {
  applyTopicSchema(db);
  const q = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];
  const one = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T | null;
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);

  const folders = (id: number) =>
    q<{ path: string }>(`SELECT path FROM topic_folders WHERE topic_id = ? ORDER BY rowid`, id).map((r) => r.path);
  const withFolders = <T extends Omit<Topic, "folders">>(r: T) => ({ ...r, folders: folders(r.id) });
  const setFolders = (id: number, paths: string[]) => {
    run(`DELETE FROM topic_folders WHERE topic_id = ?`, id);
    for (const p of paths) if (p.trim()) run(`INSERT OR IGNORE INTO topic_folders (topic_id, path) VALUES (?, ?)`, id, p.trim());
  };
  // 대시보드가 그대로 보여주므로 SQLite의 영문 UNIQUE 오류 대신 한국어 메시지를 던진다
  const dupName = <T>(name: string, fn: () => T): T => {
    try { return fn(); } catch (e) {
      if (String(e).includes("UNIQUE")) throw new Error(`이미 있는 주제 이름: ${name.trim()}`);
      throw e;
    }
  };
  const cleanName = (n: string) => {
    const name = n.trim();
    if (!name) throw new Error("주제 이름이 비어 있다");
    return name;
  };
  const topicCols = `id, name, description, created_at, updated_at`;
  const get = (id: number): Topic | null => {
    const r = one<Omit<Topic, "folders">>(`SELECT ${topicCols} FROM topics WHERE id = ?`, id);
    return r ? withFolders(r) : null;
  };
  const rate = (topicId: number, memoryId: number, delta: 1 | -1): number | null =>
    one<{ confidence: number }>(
      `UPDATE topic_members SET confidence = max(1, confidence + ?)
       WHERE topic_id = ? AND memory_id = ? RETURNING confidence`, delta, topicId, memoryId
    )?.confidence ?? null;
  const session = (id: string) => one<SessionRow>(`SELECT * FROM sessions WHERE session_id = ?`, id);
  const memberSql = `SELECT m.id, m.section, m.area, m.rule, m.evidence, m.confidence, m.kind, m.updated_at,
      tm.confidence AS topic_confidence
    FROM topic_members tm JOIN memory m ON m.id = tm.memory_id WHERE tm.topic_id = ?
    ORDER BY tm.confidence DESC, m.updated_at DESC`;

  return {
    create(t: { name: string; description?: string; folders?: string[] }): number {
      return dupName(t.name, () => db.transaction(() => {
        const id = (one<{ id: number }>(
          `INSERT INTO topics (name, description) VALUES (?, ?) RETURNING id`, cleanName(t.name), t.description ?? ""
        ))!.id;
        setFolders(id, t.folders ?? []);
        return id;
      })());
    },
    update(id: number, f: { name?: string; description?: string; folders?: string[] }): boolean {
      return dupName(f.name ?? "", () => db.transaction(() => {
        const cur = get(id);
        if (!cur) return false;
        run(`UPDATE topics SET name = ?, description = ?, updated_at = ${NOW} WHERE id = ?`,
          f.name !== undefined ? cleanName(f.name) : cur.name, f.description ?? cur.description, id);
        if (f.folders) setFolders(id, f.folders);
        return true;
      })());
    },
    /** 소속·폴더 삭제 + 그 주제였던 세션 해제(topic_rev +1). 기억은 지우지 않는다. 영향받은 session_id 반환 */
    remove(id: number): string[] {
      return db.transaction(() => {
        const ids = q<{ session_id: string }>(`SELECT session_id FROM sessions WHERE topic_id = ?`, id)
          .map((r) => r.session_id);
        run(`UPDATE sessions SET topic_id = NULL, topic_rev = topic_rev + 1 WHERE topic_id = ?`, id);
        run(`DELETE FROM topic_members WHERE topic_id = ?`, id);
        run(`DELETE FROM topic_folders WHERE topic_id = ?`, id);
        run(`DELETE FROM topics WHERE id = ?`, id);
        return ids;
      })();
    },
    get,
    byName(name: string): Topic | null {
      const r = one<Omit<Topic, "folders">>(`SELECT ${topicCols} FROM topics WHERE name = ?`, name.trim());
      return r ? withFolders(r) : null;
    },
    list(): TopicSummary[] {
      return q<Omit<Topic, "folders"> & { memberCount: number }>(
        `SELECT ${topicCols}, (SELECT count(*) FROM topic_members WHERE topic_id = topics.id) AS memberCount
         FROM topics ORDER BY name`
      ).map(withFolders);
    },
    /** 초기 주제 신뢰도 = 기억의 전체 신뢰도. 이미 소속이면 건너뛰고 추가 건수를 반환 */
    link(topicId: number, memoryIds: number[]): number {
      return db.transaction(() => {
        if (!get(topicId)) throw new Error(`주제 #${topicId} 없음`);
        let added = 0;
        for (const m of memoryIds) {
          const mem = one<{ confidence: number }>(`SELECT confidence FROM memory WHERE id = ?`, m);
          if (!mem) throw new Error(`기억 #${m} 없음`);
          added += run(`INSERT OR IGNORE INTO topic_members (topic_id, memory_id, confidence) VALUES (?, ?, ?)`,
            topicId, m, mem.confidence).changes;
        }
        return added;
      })();
    },
    unlink(topicId: number, memoryIds: number[]): number {
      return db.transaction(() =>
        memoryIds.reduce((n, m) => n + run(`DELETE FROM topic_members WHERE topic_id = ? AND memory_id = ?`, topicId, m).changes, 0)
      )();
    },
    rate,
    members(topicId: number): TopicMember[] {
      return q<TopicMember>(memberSql, topicId);
    },
    memberIds(topicId: number): number[] {
      return q<{ memory_id: number }>(`SELECT memory_id FROM topic_members WHERE topic_id = ?`, topicId).map((r) => r.memory_id);
    },
    /** 주제 핵심 영역: 주제 신뢰도 3+, observe·코어 제외, 최대 30개 */
    areas(topicId: number): TopicArea[] {
      return q<TopicMember>(memberSql, topicId)
        .filter((m) => m.topic_confidence >= TOPIC_AREA_MIN && m.section !== "observe" && !isCore(m))
        .slice(0, TOPIC_AREA_MAX)
        .map((m) => ({ id: m.id, area: m.area }));
    },
    topicsOf(memoryId: number): number[] {
      return q<{ topic_id: number }>(`SELECT topic_id FROM topic_members WHERE memory_id = ?`, memoryId).map((r) => r.topic_id);
    },
    /** upsert + last_seen 갱신. title은 값이 올 때만, first_prompt는 비어 있을 때만 채운다 */
    registerSession(p: { sessionId: string; title?: string | null; cwd?: string | null; prompt?: string }): void {
      run(`INSERT INTO sessions (session_id, title, first_prompt, cwd, last_seen) VALUES (?, ?, ?, ?, ${NOW})
           ON CONFLICT(session_id) DO UPDATE SET
             title = COALESCE(excluded.title, title),
             first_prompt = CASE WHEN first_prompt = '' THEN excluded.first_prompt ELSE first_prompt END,
             cwd = COALESCE(excluded.cwd, cwd),
             last_seen = excluded.last_seen`,
        p.sessionId, p.title || null, p.prompt ?? "", p.cwd || null);
    },
    endSession(sessionId: string): void {
      run(`DELETE FROM sessions WHERE session_id = ?`, sessionId);
    },
    setSessionTopic(sessionId: string, topicId: number | null): void {
      if (topicId !== null && !get(topicId)) throw new Error(`주제 #${topicId} 없음`);
      run(`INSERT INTO sessions (session_id, topic_id, last_seen) VALUES (?, ?, ${NOW})
           ON CONFLICT(session_id) DO UPDATE SET topic_id = excluded.topic_id`, sessionId, topicId);
    },
    bumpRev(sessionId: string): number {
      return one<{ topic_rev: number }>(
        `UPDATE sessions SET topic_rev = topic_rev + 1 WHERE session_id = ? RETURNING topic_rev`, sessionId
      )?.topic_rev ?? 0;
    },
    session,
    sessions(): SessionRow[] {
      return q<SessionRow>(`SELECT * FROM sessions ORDER BY last_seen DESC`);
    },
    /** last_seen이 24시간을 넘은 세션 삭제 — 삭제된 id 반환 */
    expireSessions(now: Date = new Date()): string[] {
      const cutoff = new Date(now.getTime() - SESSION_TTL_HOURS * 3600_000)
        .toISOString().replace("T", " ").replace("Z", "");
      const ids = q<{ session_id: string }>(`SELECT session_id FROM sessions WHERE last_seen < ?`, cutoff)
        .map((r) => r.session_id);
      run(`DELETE FROM sessions WHERE last_seen < ?`, cutoff);
      return ids;
    },
    /** 세션 주제의 소속 기억이면 주제 신뢰도 +1 */
    confirmInTopic(sessionId: string, memoryId: number): boolean {
      const topicId = session(sessionId)?.topic_id;
      return topicId != null && rate(topicId, memoryId, 1) !== null;
    },
  };
}

export type TopicStore = ReturnType<typeof createTopicStore>;
