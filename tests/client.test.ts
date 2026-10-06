// bun test tests/client.test.ts
// 핸드셰이크(프로젝트 소유 검증)와 포트 재할당 검증. 실제 서버를 스폰하는 통합 테스트.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "socket.io";
import {
  assignFreePort,
  connectMemory,
  ProjectMismatchError,
  sameProject,
  type MemoryClient,
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
  // v0.8.0부터 mem:doc은 파일을 직접 읽지 않고 DB에서 렌더링한다
  "mem:doc: DB의 보정 항목을 렌더링 (없으면 null)",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-d-"));
    await assignFreePort(A);
    const a = await connectMemory(A);
    try {
      expect(await a.doc()).toBe(null);
      await a.add({
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
  "핸드셰이크: 같은 포트의 타 프로젝트 서버 — noSpawn은 거부, force는 공유, 스폰 경로는 새 포트 자동 할당",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-a-"));
    const B = mkdtempSync(join(tmpdir(), "nunchi-b-"));
    // A와 B가 같은 포트를 쓰도록 구성 — 포트 충돌 상황 재현 (nunchi.json 없는 프로젝트가 모두 41720을 쓰는 상황)
    const port = await assignFreePort(A);
    mkdirSync(join(B, ".claude"), { recursive: true });
    writeFileSync(join(B, ".claude", "nunchi.json"), JSON.stringify({ port }));

    const a = await connectMemory(A); // 서버 스폰 + 자기 프로젝트 검증 통과
    let b2: MemoryClient | null = null;
    try {
      const id = await a.add({
        section: "punish", area: "[from-A]", rule: "r", evidence: "2026-07-07 e",
      });
      // 훅의 빠른 경로(noSpawn)는 A 소유 서버를 거부만 한다 — 설정 파일을 건드리지 않음
      await expect(connectMemory(B, { noSpawn: true })).rejects.toBeInstanceOf(ProjectMismatchError);
      // 강제 연결은 허용되고 A의 db를 공유한다
      const b = await connectMemory(B, { force: true });
      expect((await b.list({})).map((e) => e.id)).toEqual([id]);
      b.close();
      // 스폰 경로(SessionStart·MCP): 빈 포트를 B의 nunchi.json에 기록하고 B 소유 서버를 띄운다
      b2 = await connectMemory(B);
      expect(JSON.parse(readFileSync(join(B, ".claude", "nunchi.json"), "utf8")).port).not.toBe(port);
      expect(await b2.list({})).toEqual([]); // A의 db가 아닌 B 자신의 db
      // external-address: 스킴 생략 주소로 접속, 핸드셰이크 생략 (타 프로젝트 서버라도 연결)
      writeFileSync(
        join(B, ".claude", "nunchi.json"),
        JSON.stringify({ "external-address": `127.0.0.1:${port}` })
      );
      const ext = await connectMemory(B);
      expect((await ext.list({})).map((e) => e.id)).toEqual([id]);
      ext.close();
    } finally {
      await a.shutdown();
      await b2?.shutdown();
      await cleanup(A, B);
    }
  },
  30000
);

test(
  "핸드셰이크: 소유를 알 수 없는 구버전 서버는 자동 재할당하지 않는다 (같은 db 이중 소유 방지)",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nunchi-old-"));
    const port = await assignFreePort(dir);
    const old = new Server(port); // mem:info 핸들러가 없는 서버 = 구버전 memory server
    try {
      await expect(connectMemory(dir)).rejects.toBeInstanceOf(ProjectMismatchError);
      expect(JSON.parse(readFileSync(join(dir, ".claude", "nunchi.json"), "utf8")).port).toBe(port);
    } finally {
      old.close();
      await cleanup(dir);
    }
  },
  20000
);
