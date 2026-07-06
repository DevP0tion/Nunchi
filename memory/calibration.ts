// nunchi calibration store (Bun)
// 보정 엔트리 테이블 + FTS5 인덱스 + 규약 연산(승격·반전·정제)을 소유한다.
// 소켓 계층(server.ts)과 테스트가 공유하는 저장소 로직 — memory store(createStore)와 같은 패턴.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync } from "node:fs";

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
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
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
     confidence = ?, keywords = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`
  );
  const confirmStmt = db.prepare(
    `UPDATE calibration SET confidence = confidence + 1, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`
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
  const ftsStmt = db.prepare(
    `SELECT c.id, c.section, c.area, c.rule, c.evidence, c.confidence, c.updated_at,
            f.rank AS rank
     FROM calibration_fts f JOIN calibration c ON c.id = f.rowid
     WHERE calibration_fts MATCH ? ORDER BY f.rank LIMIT 50`
  );
  const likeStmt = db.prepare(
    `SELECT ${COLS} FROM calibration
     WHERE area LIKE ? OR rule LIKE ? OR evidence LIKE ? OR keywords LIKE ?
     ORDER BY updated_at DESC LIMIT 50`
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
    /** 다중 쿼리 OR-병합 검색. FTS(BM25) 우선, 3글자 미만·무결과는 LIKE 폴백.
     *  모델 쿼리 확장(nunchi_search)과 훅 자동 주입이 공유하는 유일한 검색 경로 */
    search(
      queries: string[],
      opts: { section?: CalSection; limit?: number; excludeCore?: boolean } = {}
    ): CalEntry[] {
      const limit = opts.limit ?? 3;
      const best = new Map<number, CalEntry & { rank: number }>();
      let pseudo = 1e9; // LIKE 결과는 랭크가 없다 — FTS 결과 뒤에 도착 순으로
      for (const raw of queries) {
        const q = String(raw ?? "").trim();
        if (!q) continue;
        let rows: (CalEntry & { rank?: number })[] = [];
        if ([...q].length >= 3) {
          try {
            const phrase = `"${q.replaceAll('"', '""')}"`;
            rows = ftsStmt.all(phrase) as (CalEntry & { rank: number })[];
          } catch {
            /* FTS 질의 오류 → LIKE 폴백 */
          }
        }
        if (!rows.length) {
          const pat = `%${q}%`;
          rows = (likeStmt.all(pat, pat, pat, pat) as CalEntry[]).map((r) => ({
            ...r,
            rank: pseudo++,
          }));
        }
        for (const r of rows) {
          const rank = r.rank ?? pseudo++;
          const prev = best.get(r.id);
          if (!prev || rank < prev.rank) best.set(r.id, { ...r, rank } as CalEntry & { rank: number });
        }
      }
      let out = [...best.values()];
      if (opts.section) out = out.filter((r) => r.section === opts.section);
      if (opts.excludeCore)
        out = out.filter((r) => !(r.section === "punish" && r.confidence >= CORE_CONFIDENCE));
      out.sort((a, b) => a.rank - b.rank); // BM25 rank는 음수(낮을수록 관련) — 오름차순
      return out.slice(0, limit).map(({ rank: _r, ...e }) => e);
    },
  };
}

export type CalStore = ReturnType<typeof createCalStore>;

// ---- calibration.md 상호 변환 (임포트 원본 · mem:doc 내보내기 뷰) ----

const SECTION_OF: [RegExp, CalSection][] = [
  [/벌주는/, "punish"],
  [/용서/, "forgive"],
  [/특이사항/, "env"],
];
const SECTION_TITLE: Record<CalSection, string> = {
  punish: "벌주는 것 (반드시 한다)",
  forgive: "용서하는 것 (생략 가능)",
  env: "환경 특이사항",
};

/** 기존 calibration.md → 엔트리 배열. 규칙/근거가 없는 엔트리는 skipped로 센다 */
export function parseCalibrationDoc(md: string): { entries: NewCalEntry[]; skipped: number } {
  const entries: NewCalEntry[] = [];
  let skipped = 0;
  let section: CalSection | null = null;
  let cur: Partial<NewCalEntry> | null = null;

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
export function renderCalibrationDoc(store: CalStore, projectName: string): string | null {
  const all = store.list({});
  if (!all.length) return null;
  const label = (c: number) => (c >= CORE_CONFIDENCE ? `높음(${c})` : c === 2 ? "중간(2)" : `낮음(${c})`);
  const parts = [`# Calibration — ${projectName}`];
  for (const sec of ["punish", "forgive", "env"] as CalSection[]) {
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
export function importCalibrationDoc(store: CalStore, docPath: string): number | null {
  if (store.stamp() !== null || !existsSync(docPath)) return null;
  const { entries, skipped } = parseCalibrationDoc(readFileSync(docPath, "utf8"));
  for (const e of entries) store.add(e);
  if (skipped) console.error(`[nunchi] 임포트: 파싱 불가 엔트리 ${skipped}건 건너뜀 (원본 .imported 참조)`);
  renameSync(docPath, docPath + ".imported"); // 0건이어도 리네임 — 기동마다 재파싱 방지
  return entries.length;
}
