// bun test tests/client.test.ts
// 핸드셰이크(프로젝트 소유 검증)와 포트 재할당 검증. 실제 서버를 스폰하는 통합 테스트.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignFreePort,
  connectMemory,
  ProjectMismatchError,
  sameProject,
} from "../memory/client.ts";
import { rmProject } from "./helpers.ts";

const cleanup = async (...dirs: string[]) => {
  for (const d of dirs) await rmProject(d);
};

test("assignFreePort: 기존 nunchi.json 키를 보존하며 port만 기록", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nunchi-c-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "nunchi.json"), JSON.stringify({ path: "docs" }));
  const port = await assignFreePort(dir);
  expect(port).toBeGreaterThan(0);
  const cfg = JSON.parse(readFileSync(join(dir, ".claude", "nunchi.json"), "utf8"));
  expect(cfg).toEqual({ path: "docs", port });
  await cleanup(dir);
});

test("sameProject: Windows는 대소문자 무시", () => {
  expect(sameProject("C:\\proj", "C:\\proj")).toBe(true);
  if (process.platform === "win32") {
    expect(sameProject("C:\\Proj", "c:\\proj")).toBe(true);
  }
  expect(sameProject("C:\\proj-a", "C:\\proj-b")).toBe(false);
});

test(
  // v0.8.0: mem:doc은 파일을 직접 읽지 않고 DB(calibration 테이블)에서 렌더링한다
  "mem:doc: DB의 calibration 엔트리를 렌더링 (없으면 null)",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-d-"));
    await assignFreePort(A);
    const a = await connectMemory(A);
    try {
      expect(await a.doc()).toBe(null);
      await a.calAdd({
        section: "punish", area: "[테스트: mem:doc]", rule: "규칙",
        evidence: "2026-07-06 근거", confidence: 3,
      });
      expect(await a.doc()).toContain("### [테스트: mem:doc]");
    } finally {
      await a.shutdown();
      await cleanup(A);
    }
  },
  20000
);

test(
  "핸드셰이크: 같은 포트의 타 프로젝트 서버는 거부, force로만 연결",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-a-"));
    const B = mkdtempSync(join(tmpdir(), "nunchi-b-"));
    // A와 B가 같은 포트를 쓰도록 구성 — 포트 충돌 상황 재현
    const port = await assignFreePort(A);
    mkdirSync(join(B, ".claude"), { recursive: true });
    writeFileSync(join(B, ".claude", "nunchi.json"), JSON.stringify({ port }));

    const a = await connectMemory(A); // 서버 스폰 + 자기 프로젝트 검증 통과
    try {
      const id = await a.calAdd({
        section: "punish", area: "[from-A]", rule: "r", evidence: "2026-07-07 e",
      });
      // B의 연결은 A 소유 서버 → ProjectMismatchError
      await expect(connectMemory(B)).rejects.toBeInstanceOf(ProjectMismatchError);
      // 강제 연결은 허용되고 A의 db를 공유한다
      const b = await connectMemory(B, { force: true });
      expect((await b.calList({})).map((e) => e.id)).toEqual([id]);
      b.close();
      // external-address: 스킴 생략 주소로 접속, 핸드셰이크 생략 (타 프로젝트 서버라도 연결)
      writeFileSync(
        join(B, ".claude", "nunchi.json"),
        JSON.stringify({ "external-address": `127.0.0.1:${port}` })
      );
      const ext = await connectMemory(B);
      expect((await ext.calList({})).map((e) => e.id)).toEqual([id]);
      ext.close();
    } finally {
      await a.shutdown();
      await cleanup(A, B);
    }
  },
  20000
);
