#!/usr/bin/env bun
// nunchi dist 빌드 — hooks.json·plugin.json은 dist/의 단일 파일 번들을 실행한다.
// 런타임 의존성이 0이라 플러그인 폴더에 node_modules가 없어도(설치기 의존성 설치 실패,
// 상위 디렉터리의 다른 node_modules로 Bun auto-install 비활성) 동작한다.
// 실행: bun run build — 소스를 고치면 다시 빌드해 dist를 함께 커밋한다.
// 최신 여부는 dist/build-info.json의 입력 해시로 검사한다 (tests/dist.test.ts).
// 출력 바이트는 Bun 버전·cwd(모듈 경로 주석)에 따라 달라 비교 기준으로 쓰지 않는다.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;

export const ENTRIES = [
  "hooks/session-start.ts",
  "hooks/user-prompt-submit.ts",
  "hooks/subagent-start.ts",
  "hooks/stop-check.ts",
  "mcp/server.ts",
  "memory/server.ts",
];

/** 번들 입력 해시 — 개행을 LF로 맞춰 core.autocrlf 체크아웃 여부와 무관하게 같은 값 */
export function inputHash(): string {
  const files = [
    ...new Bun.Glob("{hooks,mcp,memory}/**/*.ts").scanSync(ROOT),
    "package.json",
    "bun.lock",
    "build.ts",
  ]
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
  const h = createHash("sha256");
  for (const f of files)
    h.update(`${f}\0${readFileSync(join(ROOT, f), "utf8").replaceAll("\r\n", "\n")}\0`);
  return h.digest("hex");
}

if (import.meta.main) {
  // 번들에 들어가는 의존성 버전을 bun.lock 고정값으로 맞춘다
  const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (install.exitCode !== 0) process.exit(1);

  process.chdir(ROOT); // 번들의 모듈 경로 주석이 cwd 기준
  rmSync("dist", { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: ENTRIES,
    root: ".",
    outdir: "dist",
    target: "bun",
    // hooks/config.ts의 BUNDLED — 번들에서 PLUGIN_ROOT·memory server 경로를 dist 기준으로
    define: { "process.env.NUNCHI_BUNDLED": '"1"' },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  writeFileSync(
    "dist/build-info.json",
    JSON.stringify({ inputs: inputHash(), bun: Bun.version }, null, 2) + "\n"
  );
  for (const o of result.outputs) console.log(`${o.path}  ${(o.size / 1024).toFixed(0)} KB`);
}
