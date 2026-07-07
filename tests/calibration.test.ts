// bun test tests/calibration.test.ts
// calibration 저장소 로직 검증 (소켓 계층 제외) — search.test.ts와 같은 패턴.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createCalStore, parseCalibrationDoc, renderCalibrationDoc, importCalibrationDoc } from "../memory/calibration.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const makeStore = () => createCalStore(new Database(":memory:"));

test("add/get: 항목 추가와 조회, 기본 신뢰도 1", () => {
  const s = makeStore();
  const id = s.add({ section: "punish", area: "[배포: CI 캐시]", rule: "lockfile 변경 시 캐시 키 확인", evidence: "2026-06-12 캐시 미스매치로 배포 2회 실패" });
  const e = s.get(id);
  expect(e?.section).toBe("punish");
  expect(e?.confidence).toBe(1);
  expect(s.get(9999)).toBe(null);
});

test("confirm: 신뢰도 +1, 없는 id는 false", () => {
  const s = makeStore();
  const id = s.add({ section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략 가능", evidence: "2026-06-20 테스트가 본체보다 오래 걸림" });
  expect(s.confirm(id)).toBe(true);
  expect(s.get(id)?.confidence).toBe(2);
  expect(s.confirm(9999)).toBe(false);
});

test("update: 부분 갱신 — 반전(섹션 이동+신뢰도 리셋+근거 교체)", () => {
  const s = makeStore();
  const id = s.add({ section: "forgive", area: "[테스트: 생략]", rule: "테스트 생략 가능", evidence: "2026-06-20 무사고", confidence: 3 });
  expect(s.update(id, { section: "punish", confidence: 1, evidence: "2026-07-06 생략했다가 회귀 발생" })).toBe(true);
  const e = s.get(id)!;
  expect(e.section).toBe("punish");
  expect(e.confidence).toBe(1);
  expect(e.rule).toBe("테스트 생략 가능"); // 미지정 필드는 보존
  expect(s.update(9999, { rule: "x" })).toBe(false);
});

test("remove/list/core/stamp", () => {
  const s = makeStore();
  expect(s.stamp()).toBe(null);
  const a = s.add({ section: "punish", area: "[a]", rule: "r1", evidence: "e1", confidence: 3 });
  const b = s.add({ section: "punish", area: "[b]", rule: "r2", evidence: "e2" });
  const c = s.add({ section: "env", area: "[c]", rule: "r3", evidence: "e3" });
  expect(s.stamp()).not.toBe(null);
  expect(s.list({}).length).toBe(3);
  expect(s.list({ section: "punish" }).length).toBe(2);
  expect(s.list({ minConfidence: 3 }).map((e) => e.id)).toEqual([a]);
  expect(s.core().map((e) => e.id)).toEqual([a]); // punish AND confidence>=3
  expect(s.remove(c)).toBe(true);
  expect(s.list({}).length).toBe(2);
  expect(s.remove(c)).toBe(false);
  void b;
});

test("search: 다중 쿼리 OR-병합, 중복 제거, limit", () => {
  const s = makeStore();
  const a = s.add({ section: "punish", area: "[배포: CI]", rule: "배포 전 캐시 키 확인", evidence: "2026-06-12 배포 실패" });
  const b = s.add({ section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략", evidence: "2026-06-20 과잉" });
  s.add({ section: "env", area: "[윈도우: 인코딩]", rule: "BOM 주의", evidence: "2026-06-25 파싱 실패" });
  // "배포"(2글자→LIKE), "테스트 생략"(FTS) 두 쿼리가 서로 다른 항목을 회수
  const rows = s.search(["배포", "테스트 생략"], { limit: 5 });
  expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  // 같은 항목을 두 쿼리가 맞혀도 1건
  expect(s.search(["배포", "캐시"], { limit: 5 }).length).toBe(1);
  expect(s.search(["배포", "테스트 생략"], { limit: 1 }).length).toBe(1);
});

test("search: section 필터와 excludeCore", () => {
  const s = makeStore();
  const core = s.add({ section: "punish", area: "[배포: 게이트]", rule: "배포 게이트 유지", evidence: "e", confidence: 3 });
  const low = s.add({ section: "punish", area: "[배포: 로그]", rule: "배포 로그 확인", evidence: "e" });
  expect(s.search(["배포"], { limit: 5 }).length).toBe(2);
  expect(s.search(["배포"], { limit: 5, excludeCore: true }).map((r) => r.id)).toEqual([low]);
  expect(s.search(["배포"], { limit: 5, section: "punish" }).length).toBe(2);
  expect(s.search(["배포"], { limit: 5, section: "env" }).length).toBe(0);
  void core;
});

test("search: 빈 쿼리·특수문자는 안전하게 처리", () => {
  const s = makeStore();
  s.add({ section: "env", area: '[fts: "인용"]', rule: 'query "quoted" AND OR', evidence: "e" });
  expect(s.search([], { limit: 5 })).toEqual([]);
  expect(s.search(["", "  "], { limit: 5 })).toEqual([]);
  expect(s.search(['"quoted"'], { limit: 5 }).length).toBe(1);
});

test("search: keywords 컬럼도 검색 대상", () => {
  const s = makeStore();
  const id = s.add({ section: "forgive", area: "[테스트: 헬퍼]", rule: "내부 헬퍼 방어 생략", evidence: "e" });
  const e = s.get(id)!;
  s.setKeywords(id, e.updated_at, "defensive, guard, 방어코드");
  expect(s.search(["defensive"], { limit: 5 }).map((r) => r.id)).toEqual([id]);
});

const SAMPLE_DOC = `# Calibration — my-project

## 벌주는 것 (반드시 한다)

### [배포: CI 캐시]
- 규칙: lockfile 변경 시 CI 캐시 키를 반드시 확인한다
- 근거: 2026-06-12 캐시 미스매치로 배포 2회 실패
- 신뢰도: 높음(3)

## 용서하는 것 (생략 가능)

### [테스트: 내부 스크립트]
- 규칙: scripts/ 하위 일회성 스크립트는 테스트 생략 가능
- 근거: 2026-06-20 테스트 작성이 스크립트 본체보다 오래 걸렸음
- 신뢰도: 중간(2)

### [불량: 필드 누락]
- 규칙: 근거가 없는 항목

## 환경 특이사항

### [윈도우: 인코딩]
- 규칙: UTF-8 BOM 파일 파싱에 주의한다
- 근거: 2026-06-25 nunchi.json BOM으로 파싱 실패
- 신뢰도: 낮음(1)
`;

test("parseCalibrationDoc: 3섹션·신뢰도 숫자 추출·불량 항목 skip", () => {
  const { entries, skipped } = parseCalibrationDoc(SAMPLE_DOC);
  expect(entries.length).toBe(3);
  expect(skipped).toBe(1);
  expect(entries[0]).toEqual({
    section: "punish", area: "[배포: CI 캐시]",
    rule: "lockfile 변경 시 CI 캐시 키를 반드시 확인한다",
    evidence: "2026-06-12 캐시 미스매치로 배포 2회 실패", confidence: 3,
  });
  expect(entries[1].section).toBe("forgive");
  expect(entries[1].confidence).toBe(2);
  expect(entries[2].section).toBe("env");
  expect(entries[2].confidence).toBe(1);
});

test("parseCalibrationDoc: 빈 문서는 0건", () => {
  expect(parseCalibrationDoc("")).toEqual({ entries: [], skipped: 0 });
});

test("renderCalibrationDoc: 3섹션 재구성, 빈 DB는 null", () => {
  const s = makeStore();
  expect(renderCalibrationDoc(s, "my-project")).toBe(null);
  for (const e of parseCalibrationDoc(SAMPLE_DOC).entries) s.add(e);
  const doc = renderCalibrationDoc(s, "my-project")!;
  expect(doc).toContain("# Calibration — my-project");
  expect(doc).toContain("## 벌주는 것 (반드시 한다)");
  expect(doc).toContain("### [배포: CI 캐시]");
  expect(doc).toContain("- 신뢰도: 높음(3)");
  expect(doc).toContain("- 신뢰도: 중간(2)");
  expect(doc).toContain("- 신뢰도: 낮음(1)");
  // 렌더 → 파싱 왕복 보존
  expect(parseCalibrationDoc(doc).entries.length).toBe(3);
});

test("v0.9.0 마이그레이션: 구 KV memory 제거 + calibration → memory 이관 (id 보존)", () => {
  const db = new Database(":memory:");
  // 0.8.x 스키마 재현 — 구 KV memory 테이블 + FTS + 트리거
  db.run(`CREATE TABLE memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.run(`CREATE VIRTUAL TABLE memory_fts USING fts5(
    key, value, keywords, content='memory', content_rowid='id', tokenize='trigram')`);
  db.run(`CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory BEGIN
    INSERT INTO memory_fts(rowid, key, value, keywords)
    VALUES (new.id, new.key, new.value, new.keywords); END`);
  db.run(`INSERT INTO memory (key, value) VALUES ('test:roundtrip', 'v')`);
  // 0.8.x calibration 테이블 + 데이터
  db.run(`CREATE TABLE calibration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL CHECK (section IN ('punish','forgive','env')),
    area TEXT NOT NULL, rule TEXT NOT NULL, evidence TEXT NOT NULL,
    confidence INTEGER NOT NULL DEFAULT 1, keywords TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')))`);
  db.run(`CREATE VIRTUAL TABLE calibration_fts USING fts5(
    area, rule, evidence, keywords, content='calibration', content_rowid='id', tokenize='trigram')`);
  db.run(`INSERT INTO calibration (id, section, area, rule, evidence, confidence)
    VALUES (7, 'punish', '[배포: CI]', '캐시 키 확인', '2026-06-12 실패', 3)`);

  const s = createCalStore(db);
  expect(s.get(7)?.area).toBe("[배포: CI]"); // id 보존 이관
  expect(s.list({}).length).toBe(1); // 구 KV 행은 이관 대상 아님
  expect(s.search(["캐시 키 확인"], { limit: 5 }).map((e) => e.id)).toEqual([7]); // FTS 재구축
  const leftovers = db
    .query(`SELECT name FROM sqlite_master WHERE name IN ('calibration', 'calibration_fts')`)
    .all();
  expect(leftovers).toEqual([]);
  expect(db.query(`SELECT 1 AS x FROM pragma_table_info('memory') WHERE name = 'key'`).get()).toBe(null);
  // 재실행은 no-op (멱등)
  expect(createCalStore(db).list({}).length).toBe(1);
});

test("importCalibrationDoc: 1회 임포트 + .imported 리네임, 재실행은 no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "nunchi-imp-"));
  const docPath = join(dir, "calibration.md");
  writeFileSync(docPath, SAMPLE_DOC);
  const s = makeStore();
  expect(importCalibrationDoc(s, docPath)).toBe(3);
  expect(existsSync(docPath)).toBe(false);
  expect(readFileSync(docPath + ".imported", "utf8")).toBe(SAMPLE_DOC);
  expect(s.list({}).length).toBe(3);
  // DB에 데이터가 있으면 임포트하지 않는다 (파일이 다시 생겨도)
  writeFileSync(docPath, SAMPLE_DOC);
  expect(importCalibrationDoc(s, docPath)).toBe(null);
  rmSync(dir, { recursive: true, force: true });
});
