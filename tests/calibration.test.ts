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
