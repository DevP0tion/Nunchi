// bun test tests/store-socket.test.ts
// mem:* 소켓 왕복 + mem:doc DB 렌더링 + noSpawn. 실제 서버를 스폰하는 통합 테스트.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignFreePort, connectMemory } from "../memory/client.ts";
import { rmProject } from "./helpers.ts";

test(
  "mem:* 왕복 — add/search/core/stamp/update/remove, mem:doc 렌더링",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-cal-"));
    await assignFreePort(A);
    const mem = await connectMemory(A);
    try {
      expect(await mem.stamp()).toBe(null);
      expect(await mem.doc()).toBe(null); // 빈 DB — mem:doc도 null
      const id = await mem.add({
        section: "punish", area: "[배포: CI]", rule: "배포 전 캐시 키 확인",
        evidence: "2026-06-12 배포 실패", confidence: 3,
      });
      const low = await mem.add({
        section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 테스트 생략",
        evidence: "2026-06-20 과잉",
      });
      expect(await mem.stamp()).not.toBe(null);
      expect((await mem.core()).map((e) => e.id)).toEqual([id]);
      expect((await mem.search(["배포"], { excludeCore: true })).length).toBe(0);
      expect((await mem.search(["테스트 생략"])).map((e) => e.id)).toEqual([low]);
      expect((await mem.list({ section: "punish" })).length).toBe(1);
      expect(await mem.doc()).toContain("### [배포: CI]"); // mem:doc이 DB에서 렌더링
      expect(await mem.update(low, { confirm: true })).toBe(true);
      expect((await mem.list({ minConfidence: 2 })).length).toBe(2);
      expect(await mem.remove(low)).toBe(true);
      expect((await mem.list({})).length).toBe(1);
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);

test(
  "기동 임포트: 기존 calibration.md가 DB로 이관되고 .imported로 리네임",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-imp2-"));
    await assignFreePort(A);
    const dir = join(A, ".claude", "nunchi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "calibration.md"), [
      "# 보정 — t", "", "## 벌주는 것 (반드시 한다)", "",
      "### [a]", "- 규칙: r", "- 근거: 2026-07-01 e", "- 신뢰도: 높음(3)", "",
    ].join("\n"));
    const mem = await connectMemory(A); // 스폰 시 서버가 임포트 수행
    try {
      expect((await mem.core()).length).toBe(1);
      expect(existsSync(join(dir, "calibration.md"))).toBe(false);
      expect(existsSync(join(dir, "calibration.md.imported"))).toBe(true);
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);

test(
  "mem:search sections 배열·단수 하위호환 + mem:update reverse 왕복",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-task-"));
    await assignFreePort(A);
    const mem = await connectMemory(A);
    try {
      const f = await mem.add({ section: "forgive", area: "[테스트: 생략]", rule: "테스트 생략 가능", evidence: "2026-06-20 무사고", confidence: 3 });
      const t = await mem.add({ section: "task", area: "[리팩토링: 스토어]", rule: "접근: 테스트 먼저", evidence: "2026-07-09 완료" });
      // sections 배열 필터 — task만
      expect((await mem.search(["테스트"], { sections: ["task"] })).map((e) => e.id)).toEqual([t]);
      // 단수 section 하위호환 (구 클라이언트 페이로드) — 서버가 [p.section]으로 매핑
      expect((await mem.search(["테스트"], { section: "forgive" } as never)).map((e) => e.id)).toEqual([f]);
      // reverse 왕복: forgive → punish·신뢰도1·근거 교체
      expect(await mem.update(f, { reverse: true, evidence: "2026-07-09 생략했다 사고" })).toBe(true);
      const rev = (await mem.list({ section: "punish" }))[0];
      expect(rev.confidence).toBe(1);
      expect(rev.evidence).toBe("2026-07-09 생략했다 사고");
      // reverse에 evidence 누락 → 에러
      await expect(mem.update(t, { reverse: true } as never)).rejects.toThrow();
      // task 대상 reverse (evidence 있어도) → forgive 전용이라 거부
      await expect(mem.update(t, { reverse: true, evidence: "2026-07-09 x" })).rejects.toThrow();
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);

test("noSpawn: 서버 미기동이면 스폰하지 않고 즉시 실패", async () => {
  const A = mkdtempSync(join(tmpdir(), "nunchi-ns-"));
  await assignFreePort(A); // 빈 포트 배정 — 서버 없음
  await expect(connectMemory(A, { noSpawn: true })).rejects.toThrow("noSpawn");
  rmSync(A, { recursive: true, force: true });
});
