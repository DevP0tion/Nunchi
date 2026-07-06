// nunchi calibration store (Bun)
// 보정 엔트리 테이블 + FTS5 인덱스 + 규약 연산(승격·반전·정제)을 소유한다.
// 소켓 계층(server.ts)과 테스트가 공유하는 저장소 로직 — memory store(createStore)와 같은 패턴.
import type { Database } from "bun:sqlite";

export type CalSection = "punish" | "forgive" | "env";

export interface CalEntry {
  id: number;
  section: CalSection;
  area: string;
  rule: string;
  evidence: string;
  confidence: number;
  updated_at: string;
}

export interface NewCalEntry {
  section: CalSection;
  area: string;
  rule: string;
  evidence: string;
  /** 미지정 시 낮음(1) — 임포트가 기존 신뢰도를 보존할 때만 지정한다 */
  confidence?: number;
}

/** 상시 주입 코어 기준: punish AND confidence >= 3 (SKILL.md의 '높음') */
export const CORE_CONFIDENCE = 3;

const COLS = "id, section, area, rule, evidence, confidence, updated_at";

/** 테이블 + FTS5 인덱스 초기화 (멱등) — memory_fts와 동일 패턴 */
export function applyCalSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS calibration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL CHECK (section IN ('punish','forgive','env')),
      area TEXT NOT NULL,
      rule TEXT NOT NULL,
      evidence TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 1,
      keywords TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS calibration_fts USING fts5(
      area, rule, evidence, keywords,
      content='calibration', content_rowid='id', tokenize='trigram'
    )
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS calibration_fts_ai AFTER INSERT ON calibration BEGIN
      INSERT INTO calibration_fts(rowid, area, rule, evidence, keywords)
      VALUES (new.id, new.area, new.rule, new.evidence, new.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS calibration_fts_ad AFTER DELETE ON calibration BEGIN
      INSERT INTO calibration_fts(calibration_fts, rowid, area, rule, evidence, keywords)
      VALUES ('delete', old.id, old.area, old.rule, old.evidence, old.keywords);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS calibration_fts_au AFTER UPDATE ON calibration BEGIN
      INSERT INTO calibration_fts(calibration_fts, rowid, area, rule, evidence, keywords)
      VALUES ('delete', old.id, old.area, old.rule, old.evidence, old.keywords);
      INSERT INTO calibration_fts(rowid, area, rule, evidence, keywords)
      VALUES (new.id, new.area, new.rule, new.evidence, new.keywords);
    END
  `);
  // 시작 시 재구축: 백필 + 드리프트 자가 치유 (수백 행 규모 — ms 단위)
  db.run(`INSERT INTO calibration_fts(calibration_fts) VALUES ('rebuild')`);
}

export function createCalStore(db: Database) {
  applyCalSchema(db);
  const insStmt = db.prepare(
    `INSERT INTO calibration (section, area, rule, evidence, confidence)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  );
  const getStmt = db.prepare(`SELECT ${COLS}, keywords FROM calibration WHERE id = ?`);
  const updStmt = db.prepare(
    `UPDATE calibration SET section = ?, area = ?, rule = ?, evidence = ?,
     confidence = ?, keywords = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const confirmStmt = db.prepare(
    `UPDATE calibration SET confidence = confidence + 1, updated_at = datetime('now') WHERE id = ?`
  );
  const delStmt = db.prepare(`DELETE FROM calibration WHERE id = ?`);
  const stampStmt = db.prepare(`SELECT max(updated_at) AS m FROM calibration`);
  const coreStmt = db.prepare(
    `SELECT ${COLS} FROM calibration WHERE section = 'punish' AND confidence >= ?
     ORDER BY confidence DESC, updated_at DESC`
  );
  const keywordsStmt = db.prepare(
    // updated_at 일치 조건 — 보강 중에 엔트리가 다시 바뀌었으면 낡은 키워드를 버린다
    `UPDATE calibration SET keywords = ? WHERE id = ? AND updated_at = ?`
  );

  return {
    add(e: NewCalEntry): number {
      return (insStmt.get(e.section, e.area, e.rule, e.evidence, e.confidence ?? 1) as { id: number }).id;
    },
    get(id: number): CalEntry | null {
      const row = getStmt.get(id) as (CalEntry & { keywords: string }) | null;
      if (!row) return null;
      const { keywords: _k, ...e } = row;
      return e;
    },
    /** 부분 갱신 — 내용(area/rule/evidence)이 바뀌면 keywords를 비운다 (보강이 다시 채움) */
    update(id: number, fields: Partial<NewCalEntry>): boolean {
      const cur = getStmt.get(id) as (CalEntry & { keywords: string }) | null;
      if (!cur) return false;
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
        contentChanged ? "" : cur.keywords, id);
      return true;
    },
    /** 신뢰도 +1 (재확인) — 규약의 승격 연산 */
    confirm(id: number): boolean {
      return confirmStmt.run(id).changes > 0;
    },
    remove(id: number): boolean {
      return delStmt.run(id).changes > 0;
    },
    list(opts: { section?: CalSection; minConfidence?: number } = {}): CalEntry[] {
      // ponytail: 필터 2개뿐이라 동적 WHERE — 쿼리 빌더 불필요
      const where: string[] = [];
      const args: (string | number)[] = [];
      if (opts.section) { where.push("section = ?"); args.push(opts.section); }
      if (opts.minConfidence) { where.push("confidence >= ?"); args.push(opts.minConfidence); }
      const sql = `SELECT ${COLS} FROM calibration
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY section, confidence DESC, updated_at DESC`;
      return db.prepare(sql).all(...args) as CalEntry[];
    },
    /** 상시 주입 대상: 벌주는 것 고신뢰 */
    core(): CalEntry[] {
      return coreStmt.all(CORE_CONFIDENCE) as CalEntry[];
    },
    /** 마지막 기록 시각 — Stop hook 점검용. 엔트리가 없으면 null */
    stamp(): string | null {
      return (stampStmt.get() as { m: string | null }).m;
    },
    setKeywords(id: number, updatedAt: string, keywords: string): void {
      keywordsStmt.run(keywords, id, updatedAt);
    },
  };
}

export type CalStore = ReturnType<typeof createCalStore>;
