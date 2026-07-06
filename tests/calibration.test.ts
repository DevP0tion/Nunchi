// bun test tests/calibration.test.ts
// calibration 저장소 로직 검증 (소켓 계층 제외) — search.test.ts와 같은 패턴.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createCalStore } from "../memory/calibration.ts";

const makeStore = () => createCalStore(new Database(":memory:"));

test("add/get: 엔트리 추가와 조회, 기본 신뢰도 1", () => {
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
  // "배포"(2글자→LIKE), "테스트 생략"(FTS) 두 쿼리가 서로 다른 엔트리를 회수
  const rows = s.search(["배포", "테스트 생략"], { limit: 5 });
  expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  // 같은 엔트리를 두 쿼리가 맞혀도 1건
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
