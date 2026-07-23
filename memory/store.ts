// nunchi memory store (Bun)
// 보정 항목 + 작업 기록(task) 테이블(memory) + FTS5 인덱스 + 규약 연산(승격·반전·정제)을 소유한다.
// 소켓 계층(server.ts)과 테스트가 공유하는 저장소 로직.
// v0.9.0: 범용 KV memory 테이블을 제거하고 보정 항목을 memory 테이블 하나로 통합했다.
// task: 완결 작업 플레이북을 같은 테이블 section='task'로 축적한다. reverse는 forgive 전용(store 소유).
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync } from "node:fs";

export type MemorySection = "punish" | "forgive" | "env" | "task" | "observe";

export type EventType =
  | "add" | "observe" | "promote" | "confirm" | "reverse" | "edit" | "remove" | "link";

/** canonical 저널 행 — append-only. 파생 상태(memory·FTS)는 이걸 replay해 재구축한다 */
export interface MemoryEvent {
  seq: number;
  ts: string;
  type: EventType;
  entry_id: number;
  /** 승격 계보의 canonical 부모 (관찰 기록 시 지정) */
  parent_id: number | null;
  /** 자유 참조 링크 (JSON 배열 문자열, 비권위) */
  refs: string;
  /** 이벤트별 데이터 (JSON) */
  payload: string;
}

export interface MemoryEntry {
  id: number;
  section: MemorySection;
  area: string;
  rule: string;
  evidence: string;
  confidence: number;
  updated_at: string;
}

export interface NewMemoryEntry {
  section: MemorySection;
  area: string;
  rule: string;
  evidence: string;
  /** 미지정 시 낮음(1) — 임포트가 기존 신뢰도를 보존할 때만 지정한다 */
  confidence?: number;
}

/** 상시 주입 코어 기준: punish AND confidence >= 3 (SKILL.md의 '높음') */
export const CORE_CONFIDENCE = 3;

/** 항목의 관계 트리 — 승격 계보(canonical) + 도메인 형제(파생) + 자유 참조(비권위) */
export interface MemoryTree {
  entry: MemoryEntry;
  /** 관찰 기록 시 지정한 canonical 부모 */
  parent: MemoryEntry | null;
  /** 이 항목으로 승격된 관찰들 */
  sources: MemoryEntry[];
  /** 이 관찰이 승격된 항목 */
  promotedTo: MemoryEntry | null;
  /** area "[도메인: …]"의 도메인 */
  domain: string | null;
  /** 같은 도메인 항목 (observe 제외, 최대 10) */
  siblings: MemoryEntry[];
  /** 자유 참조 */
  refs: MemoryEntry[];
}

const COLS = "id, section, area, rule, evidence, confidence, updated_at";

/** memory 테이블 컬럼 정의 — 신규 생성과 재구축(§task 마이그레이션)이 동일 CHECK를
 *  쓰도록 한 곳에 둔다. CHECK 문자열이 두 곳에 흩어지면 안 된다. */
const MEMORY_COLS_DDL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('punish','forgive','env','task','observe')),
  area TEXT NOT NULL,
  rule TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 1,
  keywords TEXT NOT NULL DEFAULT '',
  promoted_to INTEGER,
  refs TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
`;

/** canonical 저널(events) 컬럼 정의 — append-only, UPDATE/DELETE 금지 */
const EVENTS_DDL = `
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
  type TEXT NOT NULL CHECK (type IN
    ('add','observe','promote','confirm','reverse','edit','remove','link')),
  entry_id INTEGER NOT NULL,
  parent_id INTEGER,
  refs TEXT NOT NULL DEFAULT '[]',
  payload TEXT NOT NULL DEFAULT '{}'
`;

/** 테이블 + FTS5 인덱스 초기화 (멱등). 0.8.x DB는 memory 테이블 하나로 마이그레이션.
 *  전체를 한 트랜잭션으로 — 마이그레이션 도중 크래시로 두 테이블이 공존(다음 기동 시
 *  id 중복 INSERT 실패)하는 상태를 남기지 않는다 */
export function applyMemorySchema(db: Database): void {
  db.transaction(() => applyMemorySchemaInner(db))();
}

function applyMemorySchemaInner(db: Database): void {
  // v0.9.0 마이그레이션 1/2: 구 KV memory 테이블(key/value)은 제거 — 플러그인 내 소비자 없음.
  // 트리거는 테이블과 함께 삭제되고, 구 memory_fts는 컬럼이 달라 명시적으로 지운다
  const kvMemory = db
    .query(`SELECT 1 AS x FROM pragma_table_info('memory') WHERE name = 'key'`)
    .get();
  if (kvMemory) {
    db.run(`DROP TABLE memory`);
    db.run(`DROP TABLE IF EXISTS memory_fts`);
  }
  // task 마이그레이션: CHECK에 'task'를 추가한다. SQLite는 CHECK 변경이 불가하므로
  // 테이블 재구축(id·keywords·updated_at 보존). kv 블록 이후에 조회하므로 kv 케이스는
  // memory가 이미 DROP돼 ddl=null → 재구축 블록이 자연히 건너뛰어진다 (별도 오탐 방어 불필요).
  const memDdl = db
    .query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory'`)
    .get() as { sql: string } | null;
  if (memDdl && !memDdl.sql.includes("'task'")) {
    db.run(`CREATE TABLE memory_new (${MEMORY_COLS_DDL})`);
    db.run(`
      INSERT INTO memory_new (id, section, area, rule, evidence, confidence, keywords, updated_at)
      SELECT id, section, area, rule, evidence, confidence, keywords, updated_at FROM memory
    `);
    db.run(`DROP TABLE memory`); // 트리거 3종(memory_fts_ai/ad/au)도 함께 삭제된다
    db.run(`ALTER TABLE memory_new RENAME TO memory`);
  }
  // v0.13 마이그레이션 1/2: observe 섹션 + promoted_to/refs 컬럼 — CHECK 변경 = 테이블 재구축.
  // task 블록과 같은 패턴. task 블록이 이미 신 DDL로 재구축한 경우 'observe'가 포함돼 건너뛴다
  const ddl13 = db
    .query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory'`)
    .get() as { sql: string } | null;
  if (ddl13 && !ddl13.sql.includes("'observe'")) {
    db.run(`CREATE TABLE memory_new (${MEMORY_COLS_DDL})`);
    db.run(`
      INSERT INTO memory_new (id, section, area, rule, evidence, confidence, keywords, updated_at)
      SELECT id, section, area, rule, evidence, confidence, keywords, updated_at FROM memory
    `);
    db.run(`DROP TABLE memory`);
    db.run(`ALTER TABLE memory_new RENAME TO memory`);
  }
  db.run(`CREATE TABLE IF NOT EXISTS memory (${MEMORY_COLS_DDL})`);
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      area, rule, evidence, keywords,
      content='memory', content_rowid='id', tokenize='trigram'
    )
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, area, rule, evidence, keywords)
      VALUES (new.id, new.area, new.rule, new.evidence, new.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, area, rule, evidence, keywords)
      VALUES ('delete', old.id, old.area, old.rule, old.evidence, old.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, area, rule, evidence, keywords)
      VALUES ('delete', old.id, old.area, old.rule, old.evidence, old.keywords);
      INSERT INTO memory_fts(rowid, area, rule, evidence, keywords)
      VALUES (new.id, new.area, new.rule, new.evidence, new.keywords);
    END
  `);
  // v0.9.0 마이그레이션 2/2: calibration 테이블의 항목을 id 보존하며 이관 후 제거
  const legacyTable = db
    .query(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'calibration'`)
    .get();
  if (legacyTable) {
    db.run(`
      INSERT INTO memory (id, section, area, rule, evidence, confidence, keywords, updated_at)
      SELECT id, section, area, rule, evidence, confidence, keywords, updated_at FROM calibration
    `);
    db.run(`DROP TABLE calibration`);
    db.run(`DROP TABLE IF EXISTS calibration_fts`);
  }
  // v0.13 마이그레이션 2/2: canonical 저널(events) + 파생 반영 스탬프(meta).
  // events가 비어 있으면 기존 memory 행을 add 이벤트로 부트스트랩 — 이력은 이 시점부터 시작
  db.run(`CREATE TABLE IF NOT EXISTS events (${EVENTS_DDL})`);
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const hasEvents = db.query(`SELECT 1 AS x FROM events LIMIT 1`).get();
  if (!hasEvents) {
    db.run(`
      INSERT INTO events (ts, type, entry_id, payload)
      SELECT updated_at,
             CASE WHEN section = 'observe' THEN 'observe' ELSE 'add' END,
             id,
             json_object('section', section, 'area', area, 'rule', rule,
                         'evidence', evidence, 'confidence', confidence)
      FROM memory ORDER BY id
    `);
  }
  // 드리프트 검사: 외부 도구가 이벤트만 추가(파생 미반영)한 경우 replay로 자가 치유.
  // 스탬프가 아예 없으면(부트스트랩 직후) 현재 상태가 곧 파생 결과 — 스탬프만 기록
  const maxSeq = (db.query(`SELECT COALESCE(max(seq), 0) AS m FROM events`).get() as { m: number }).m;
  const applied = db.query(`SELECT value FROM meta WHERE key = 'applied_seq'`).get() as
    | { value: string }
    | null;
  if (applied === null) {
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`, [String(maxSeq)]);
  } else if (Number(applied.value) !== maxSeq) {
    rebuildDerived(db);
  }
  // 시작 시 재구축: 백필 + 드리프트 자가 치유 (수백 행 규모 — ms 단위)
  db.run(`INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`);
}

/** 파생 상태(memory·FTS)를 events replay로 재구축한다.
 *  keywords는 파생 보강이라 이벤트에 없다 — 재구축 전 스냅숏을 떠 id 기준으로 복원.
 *  이벤트 ts가 행 updated_at으로 재현되므로 결과는 원본 파생 상태와 완전 동일하다 */
export function rebuildDerived(db: Database): void {
  db.transaction(() => {
    const kw = db.prepare(`SELECT id, keywords FROM memory WHERE keywords != ''`).all() as
      { id: number; keywords: string }[];
    db.run(`DELETE FROM memory`);
    const ins = db.prepare(
      `INSERT INTO memory (id, section, area, rule, evidence, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const events = db.prepare(`SELECT * FROM events ORDER BY seq`).all() as MemoryEvent[];
    for (const ev of events) {
      const p = JSON.parse(ev.payload) as Record<string, unknown>;
      switch (ev.type) {
        case "add":
        case "observe":
        case "promote":
          ins.run(ev.entry_id, p.section as string, p.area as string, p.rule as string,
            p.evidence as string, (p.confidence as number) ?? 1, ev.ts);
          if (ev.type === "promote")
            for (const sid of (p.sources as number[]) ?? [])
              db.run(`UPDATE memory SET promoted_to = ? WHERE id = ?`, [ev.entry_id, sid]);
          break;
        case "edit": {
          const sets: string[] = [];
          const args: (string | number)[] = [];
          for (const k of ["section", "area", "rule", "evidence", "confidence"] as const)
            if (p[k] !== undefined) { sets.push(`${k} = ?`); args.push(p[k] as string | number); }
          db.run(`UPDATE memory SET ${sets.concat("updated_at = ?").join(", ")} WHERE id = ?`,
            [...args, ev.ts, ev.entry_id]);
          break;
        }
        case "confirm":
          db.run(`UPDATE memory SET confidence = confidence + 1, updated_at = ? WHERE id = ?`,
            [ev.ts, ev.entry_id]);
          break;
        case "reverse":
          db.run(`UPDATE memory SET section = 'punish', confidence = 1, evidence = ?, updated_at = ? WHERE id = ?`,
            [p.evidence as string, ev.ts, ev.entry_id]);
          break;
        case "remove":
          db.run(`DELETE FROM memory WHERE id = ?`, [ev.entry_id]);
          break;
        case "link": {
          const row = db.query(`SELECT refs FROM memory WHERE id = ?`).get(ev.entry_id) as
            { refs: string } | null;
          if (!row) break;
          const merged = [
            ...new Set([...(JSON.parse(row.refs) as number[]), ...((p.refs as number[]) ?? [])]),
          ];
          db.run(`UPDATE memory SET refs = ? WHERE id = ?`, [JSON.stringify(merged), ev.entry_id]);
          break;
        }
      }
    }
    const restore = db.prepare(`UPDATE memory SET keywords = ? WHERE id = ?`);
    for (const k of kw) restore.run(k.keywords, k.id);
    db.run(`INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`);
    const max = (db.query(`SELECT COALESCE(max(seq), 0) AS m FROM events`).get() as { m: number }).m;
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`, [String(max)]);
  })();
}

export function createMemoryStore(db: Database) {
  applyMemorySchema(db);
  type Row = MemoryEntry & { keywords: string; promoted_to: number | null; refs: string };
  const strip = ({ keywords: _k, promoted_to: _p, refs: _r, ...e }: Row): MemoryEntry => e;
  const insStmt = db.prepare(
    `INSERT INTO memory (section, area, rule, evidence, confidence)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  );
  const getStmt = db.prepare(`SELECT ${COLS}, keywords, promoted_to, refs FROM memory WHERE id = ?`);
  const evStmt = db.prepare(
    `INSERT INTO events (ts, type, entry_id, parent_id, refs, payload)
     VALUES (COALESCE(?, strftime('%Y-%m-%d %H:%M:%f','now')), ?, ?, ?, ?, ?) RETURNING seq`
  );
  const metaStmt = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_seq', ?)`);
  const rowTsStmt = db.prepare(`SELECT updated_at FROM memory WHERE id = ?`);
  /** canonical 이벤트 기록 + 반영 스탬프. 변경 연산과 같은 트랜잭션 안에서 호출한다.
   *  ts는 행 updated_at과 동기화 — replay가 원본과 동일한 updated_at을 재현하기 위함 */
  const logEvent = (
    type: EventType,
    entryId: number,
    payload: Record<string, unknown>,
    parentId: number | null = null,
    refs: number[] = []
  ) => {
    const ts = (rowTsStmt.get(entryId) as { updated_at: string } | null)?.updated_at ?? null;
    const { seq } = evStmt.get(
      ts, type, entryId, parentId, JSON.stringify(refs), JSON.stringify(payload)
    ) as { seq: number };
    metaStmt.run(String(seq));
  };
  /** 파생 상태 필드 갱신 (이벤트 기록 없음) — update/reverse가 공유.
   *  내용(area/rule/evidence) 변경 시 keywords를 비운다 (보강이 다시 채움) */
  const applyFields = (cur: Row, fields: Partial<NewMemoryEntry>): void => {
    const next = {
      section: fields.section ?? cur.section,
      area: fields.area ?? cur.area,
      rule: fields.rule ?? cur.rule,
      evidence: fields.evidence ?? cur.evidence,
      confidence: fields.confidence ?? cur.confidence,
    };
    const contentChanged =
      next.area !== cur.area || next.rule !== cur.rule || next.evidence !== cur.evidence;
    updStmt.run(next.section, next.area, next.rule, next.evidence, next.confidence,
      contentChanged ? "" : cur.keywords, cur.id);
  };
  const updStmt = db.prepare(
    `UPDATE memory SET section = ?, area = ?, rule = ?, evidence = ?,
     confidence = ?, keywords = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`
  );
  const confirmStmt = db.prepare(
    `UPDATE memory SET confidence = confidence + 1, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`
  );
  const delStmt = db.prepare(`DELETE FROM memory WHERE id = ?`);
  const stampStmt = db.prepare(`SELECT max(updated_at) AS m FROM memory`);
  const coreStmt = db.prepare(
    `SELECT ${COLS} FROM memory WHERE section = 'punish' AND confidence >= ?
     ORDER BY confidence DESC, updated_at DESC`
  );
  const keywordsStmt = db.prepare(
    // updated_at 일치 조건 — 보강 중에 항목이 다시 바뀌었으면 낡은 키워드를 버린다
    `UPDATE memory SET keywords = ? WHERE id = ? AND updated_at = ?`
  );
  const ftsStmt = db.prepare(
    `SELECT c.id, c.section, c.area, c.rule, c.evidence, c.confidence, c.updated_at,
            f.rank AS rank
     FROM memory_fts f JOIN memory c ON c.id = f.rowid
     WHERE memory_fts MATCH ? ORDER BY f.rank LIMIT 50`
  );
  const likeStmt = db.prepare(
    `SELECT ${COLS} FROM memory
     WHERE area LIKE ? OR rule LIKE ? OR evidence LIKE ? OR keywords LIKE ?
     ORDER BY updated_at DESC LIMIT 50`
  );
  const promoteMark = db.prepare(`UPDATE memory SET promoted_to = ? WHERE id = ?`);
  const linkStmt = db.prepare(`UPDATE memory SET refs = ? WHERE id = ?`);
  const sourcesStmt = db.prepare(`SELECT ${COLS} FROM memory WHERE promoted_to = ? ORDER BY id`);
  const parentEvStmt = db.prepare(
    `SELECT parent_id FROM events WHERE entry_id = ? AND type IN ('add','observe')
     ORDER BY seq DESC LIMIT 1`
  );
  const allStmt = db.prepare(
    `SELECT ${COLS} FROM memory WHERE id != ? AND section != 'observe' ORDER BY updated_at DESC`
  );
  const exportStmt = db.prepare(
    `SELECT seq, ts, type, entry_id, parent_id, refs, payload FROM events ORDER BY seq`
  );
  /** area "[도메인: …]" → 도메인. 관례 밖 표기는 null */
  const domainOf = (area: string): string | null =>
    /^\[([^:\]]+)/.exec(area)?.[1]?.trim() ?? null;

  return {
    add(e: NewMemoryEntry & { parent?: number }): number {
      return db.transaction(() => {
        if (e.parent != null && !getStmt.get(e.parent))
          throw new Error(`parent #${e.parent} 없음`);
        const id = (insStmt.get(e.section, e.area, e.rule, e.evidence, e.confidence ?? 1) as { id: number }).id;
        logEvent(e.section === "observe" ? "observe" : "add", id, {
          section: e.section, area: e.area, rule: e.rule,
          evidence: e.evidence, confidence: e.confidence ?? 1,
        }, e.parent ?? null);
        return id;
      })();
    },
    get(id: number): MemoryEntry | null {
      const row = getStmt.get(id) as Row | null;
      return row ? strip(row) : null;
    },
    /** 부분 갱신 — 내용(area/rule/evidence)이 바뀌면 keywords를 비운다 (보강이 다시 채움) */
    update(id: number, fields: Partial<NewMemoryEntry>): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        // payload는 실제 지정된 필드만 — replay가 부분 갱신을 그대로 재현한다
        const clean = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        ) as Partial<NewMemoryEntry>;
        applyFields(cur, clean);
        logEvent("edit", id, clean);
        return true;
      })();
    },
    /** 신뢰도 +1 (재확인) — 규약의 승격 연산 */
    confirm(id: number): boolean {
      return db.transaction(() => {
        if (confirmStmt.run(id).changes === 0) return false;
        logEvent("confirm", id, {});
        return true;
      })();
    },
    /** 반전: '용서하는 것'(forgive) 전용 — punish 이동 + 신뢰도 1 리셋 + 근거 교체.
     *  env·punish·task 대상은 규약 위반이므로 명확한 에러로 거부한다 */
    reverse(id: number, evidence: string): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        if (cur.section !== "forgive")
          throw new Error(`reverse는 '용서하는 것'(forgive) 전용 — 대상 항목은 ${cur.section}`);
        applyFields(cur, { section: "punish", confidence: 1, evidence });
        logEvent("reverse", id, { evidence });
        return true;
      })();
    },
    remove(id: number): boolean {
      return db.transaction(() => {
        if (delStmt.run(id).changes === 0) return false;
        // 행이 이미 삭제됨 — 이벤트 ts는 현재 시각 기본값 (의도된 동작)
        logEvent("remove", id, {});
        return true;
      })();
    },
    list(opts: { section?: MemorySection; minConfidence?: number; withObserve?: boolean } = {}): MemoryEntry[] {
      // ponytail: 필터 3개뿐이라 동적 WHERE — 쿼리 빌더 불필요
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (opts.section) { where.push("section = ?"); args.push(opts.section); }
      else if (!opts.withObserve) where.push("section != 'observe'"); // 관찰은 명시 요청 시에만
      if (opts.minConfidence) { where.push("confidence >= ?"); args.push(opts.minConfidence); }
      const sql = `SELECT ${COLS} FROM memory
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY section, confidence DESC, updated_at DESC`;
      return db.prepare(sql).all(...args) as MemoryEntry[];
    },
    /** 상시 주입 대상: 벌주는 것 고신뢰 */
    core(): MemoryEntry[] {
      return coreStmt.all(CORE_CONFIDENCE) as MemoryEntry[];
    },
    /** 마지막 기록 시각 — Stop hook 점검용. 항목이 없으면 null */
    stamp(): string | null {
      return (stampStmt.get() as { m: string | null }).m;
    },
    setKeywords(id: number, updatedAt: string, keywords: string): void {
      keywordsStmt.run(keywords, id, updatedAt);
    },
    /** 다중 쿼리 OR-병합 검색. FTS(BM25) 우선, 3글자 미만·무결과는 LIKE 폴백.
     *  모델 쿼리 확장(nunchi_search)과 훅 자동 주입이 공유하는 유일한 검색 경로 */
    search(
      queries: string[],
      opts: { sections?: MemorySection[]; limit?: number; excludeCore?: boolean } = {}
    ): MemoryEntry[] {
      const limit = opts.limit ?? 3;
      const best = new Map<number, MemoryEntry & { rank: number }>();
      let pseudo = 1e9; // LIKE 결과는 랭크가 없다 — FTS 결과 뒤에 도착 순으로
      for (const raw of queries) {
        const q = String(raw ?? "").trim();
        if (!q) continue;
        let rows: (MemoryEntry & { rank?: number })[] = [];
        if ([...q].length >= 3) {
          try {
            const phrase = `"${q.replaceAll('"', '""')}"`;
            rows = ftsStmt.all(phrase) as (MemoryEntry & { rank: number })[];
          } catch {
            /* FTS 질의 오류 → LIKE 폴백 */
          }
        }
        if (!rows.length) {
          const pat = `%${q}%`;
          rows = (likeStmt.all(pat, pat, pat, pat) as MemoryEntry[]).map((r) => ({
            ...r,
            rank: pseudo++,
          }));
        }
        for (const r of rows) {
          const rank = r.rank ?? pseudo++;
          const prev = best.get(r.id);
          if (!prev || rank < prev.rank) best.set(r.id, { ...r, rank } as MemoryEntry & { rank: number });
        }
      }
      let out = [...best.values()];
      // 관찰(observe)은 명시 요청 시에만 — 자동 회수(훅)와 기본 검색을 오염시키지 않는다
      if (opts.sections) out = out.filter((r) => opts.sections!.includes(r.section));
      else out = out.filter((r) => r.section !== "observe");
      if (opts.excludeCore)
        out = out.filter((r) => !(r.section === "punish" && r.confidence >= CORE_CONFIDENCE));
      out.sort((a, b) => a.rank - b.rank); // BM25 rank는 음수(낮을수록 관련) — 오름차순
      return out.slice(0, limit).map(({ rank: _r, ...e }) => e);
    },
    /** 관찰들 → 보정 항목 승격. 출처는 promote 이벤트의 sources와 관찰의 promoted_to로 보존 */
    promote(sources: number[], e: NewMemoryEntry): number {
      if (!sources.length) throw new Error("promote에는 근거 관찰 id가 1개 이상 필요하다");
      if (e.section === "observe") throw new Error("승격 결과 섹션은 observe가 될 수 없다");
      return db.transaction(() => {
        for (const sid of sources) {
          const cur = getStmt.get(sid) as Row | null;
          if (!cur) throw new Error(`관찰 #${sid} 없음`);
          if (cur.section !== "observe") throw new Error(`#${sid}는 관찰(observe)이 아니다 (${cur.section})`);
          if (cur.promoted_to != null) throw new Error(`#${sid}는 이미 #${cur.promoted_to}로 승격됨`);
        }
        const id = (insStmt.get(e.section, e.area, e.rule, e.evidence, e.confidence ?? 1) as { id: number }).id;
        for (const sid of sources) promoteMark.run(id, sid);
        logEvent("promote", id, {
          section: e.section, area: e.area, rule: e.rule,
          evidence: e.evidence, confidence: e.confidence ?? 1, sources,
        });
        return id;
      })();
    },
    /** 자유 참조 링크 병합 (비권위 — 지워도 canonical 훼손 없음) */
    link(id: number, refIds: number[]): boolean {
      return db.transaction(() => {
        const cur = getStmt.get(id) as Row | null;
        if (!cur) return false;
        const clean = [...new Set(refIds.filter((r) => r !== id))];
        if (!clean.length) throw new Error("link에는 자신이 아닌 참조 id가 1개 이상 필요하다");
        for (const r of clean) if (!getStmt.get(r)) throw new Error(`참조 대상 #${r} 없음`);
        const merged = [...new Set([...(JSON.parse(cur.refs) as number[]), ...clean])];
        linkStmt.run(JSON.stringify(merged), id);
        logEvent("link", id, { refs: clean }, null, clean);
        return true;
      })();
    },
    /** 항목의 관계 트리: 승격 계보(canonical) + 도메인 형제(파생) + 자유 참조(비권위) */
    tree(id: number): MemoryTree | null {
      const row = getStmt.get(id) as Row | null;
      if (!row) return null;
      const byId = (i: number | null | undefined): MemoryEntry | null => {
        if (i == null) return null;
        const r = getStmt.get(i) as Row | null;
        return r ? strip(r) : null;
      };
      const parentRow = parentEvStmt.get(id) as { parent_id: number | null } | null;
      const domain = domainOf(row.area);
      // ponytail: 수백 행 규모 — 도메인 형제는 JS 필터로 충분, 인덱스 불필요
      const siblings = domain
        ? (allStmt.all(id) as MemoryEntry[]).filter((e) => domainOf(e.area) === domain).slice(0, 10)
        : [];
      const refs = (JSON.parse(row.refs) as number[])
        .map(byId).filter((e): e is MemoryEntry => e !== null);
      return {
        entry: strip(row),
        parent: byId(parentRow?.parent_id),
        sources: sourcesStmt.all(id) as MemoryEntry[],
        promotedTo: byId(row.promoted_to),
        domain,
        siblings,
        refs,
      };
    },
    /** canonical 저널 전량 — JSONL 내보내기·감사용 */
    exportEvents(): MemoryEvent[] {
      return exportStmt.all() as MemoryEvent[];
    },
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;

// ---- calibration.md 상호 변환 (임포트 원본 · mem:doc 내보내기 뷰) ----

const SECTION_OF: [RegExp, MemorySection][] = [
  [/벌주는/, "punish"],
  [/용서/, "forgive"],
  [/특이사항/, "env"],
];
const SECTION_TITLE: Record<MemorySection, string> = {
  punish: "벌주는 것 (반드시 한다)",
  forgive: "용서하는 것 (생략 가능)",
  env: "환경 특이사항",
  task: "작업 기록",
  observe: "관찰 (미승격 신호)",
};

/** 기존 calibration.md → 항목 배열. 규칙/근거가 없는 항목은 skipped로 센다 */
export function parseLegacyDoc(md: string): { entries: NewMemoryEntry[]; skipped: number } {
  const entries: NewMemoryEntry[] = [];
  let skipped = 0;
  let section: MemorySection | null = null;
  let cur: Partial<NewMemoryEntry> | null = null;

  const flush = () => {
    if (!cur) return;
    if (section && cur.area && cur.rule && cur.evidence) {
      entries.push({
        section, area: cur.area, rule: cur.rule, evidence: cur.evidence,
        confidence: cur.confidence ?? 1,
      });
    } else {
      skipped += 1;
    }
    cur = null;
  };

  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flush();
      section = SECTION_OF.find(([re]) => re.test(line))?.[1] ?? null;
    } else if (line.startsWith("### ")) {
      flush();
      cur = { area: line.slice(4).trim() };
    } else if (cur && line.startsWith("- 규칙:")) {
      cur.rule = line.slice("- 규칙:".length).trim();
    } else if (cur && line.startsWith("- 근거:")) {
      cur.evidence = line.slice("- 근거:".length).trim();
    } else if (cur && line.startsWith("- 신뢰도:")) {
      const n = parseInt(line.match(/\((\d+)\)/)?.[1] ?? "", 10);
      cur.confidence = Number.isFinite(n) ? n : 1;
    }
  }
  flush();
  return { entries, skipped };
}

/** DB → 기존 3섹션 markdown. external-address 구버전 클라이언트(mem:doc)와 내보내기 겸용 */
export function renderMemoryDoc(store: MemoryStore, projectName: string): string | null {
  const all = store.list({ withObserve: true });
  if (!all.length) return null;
  const label = (c: number) => (c >= CORE_CONFIDENCE ? `높음(${c})` : c === 2 ? "중간(2)" : `낮음(${c})`);
  const parts = [`# 보정 — ${projectName}`];
  for (const sec of ["punish", "forgive", "env", "task", "observe"] as MemorySection[]) {
    const rows = all.filter((e) => e.section === sec);
    if (!rows.length) continue;
    parts.push("", `## ${SECTION_TITLE[sec]}`);
    for (const e of rows) {
      parts.push("", `### ${e.area}`, `- 규칙: ${e.rule}`, `- 근거: ${e.evidence}`, `- 신뢰도: ${label(e.confidence)}`);
    }
  }
  return parts.join("\n") + "\n";
}

/** 서버 기동 시 1회 마이그레이션: DB가 비어 있고 문서가 있으면 임포트 후 .imported로 보존 */
export function importLegacyDoc(store: MemoryStore, docPath: string): number | null {
  if (store.stamp() !== null || !existsSync(docPath)) return null;
  const { entries, skipped } = parseLegacyDoc(readFileSync(docPath, "utf8"));
  for (const e of entries) store.add(e);
  if (skipped) console.error(`[nunchi] 임포트: 파싱 불가 항목 ${skipped}건 건너뜀 (원본 .imported 참조)`);
  renameSync(docPath, docPath + ".imported"); // 0건이어도 리네임 — 기동마다 재파싱 방지
  return entries.length;
}
