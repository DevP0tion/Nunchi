// bun test tests/hooks.test.ts
// 훅 4종 스모크: stdin에 hook JSON을 넣고 stdout을 검증한다. 실서버를 시드해서 사용.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignFreePort, connectMemory, type MemoryClient } from "../memory/client.ts";

const hookPath = (name: string) => fileURLToPath(new URL(`../hooks/${name}`, import.meta.url));

async function runHook(name: string, dir: string, input: object): Promise<string> {
  const proc = Bun.spawn(["bun", hookPath(name)], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe", stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

/** 코어 1건 + 저신뢰 1건이 시드된 프로젝트와 열린 클라이언트 */
async function seeded(): Promise<{ dir: string; mem: MemoryClient }> {
  const dir = mkdtempSync(join(tmpdir(), "nunchi-hook-"));
  await assignFreePort(dir);
  const mem = await connectMemory(dir);
  await mem.calAdd({
    section: "punish", area: "[배포: 게이트]", rule: "배포 게이트를 생략하지 않는다",
    evidence: "2026-06-12 생략으로 장애", confidence: 3,
  });
  await mem.calAdd({
    section: "forgive", area: "[테스트: 스크립트]", rule: "일회성 스크립트 테스트 생략 가능",
    evidence: "2026-06-20 과잉이었음",
  });
  return { dir, mem };
}

test(
  "session-start: 규약 + 코어(확정 규칙)만 주입, 전문 주입 없음",
  async () => {
    const { dir, mem } = await seeded();
    try {
      const raw = await runHook("session-start.ts", dir, { source: "startup" });
      const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext as string;
      expect(ctx).toContain("nunchi_search");
      expect(ctx).toContain("배포 게이트를 생략하지 않는다"); // 코어는 주입
      expect(ctx).not.toContain("일회성 스크립트"); // 저신뢰는 주입 안 함
    } finally {
      await mem.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000
);
