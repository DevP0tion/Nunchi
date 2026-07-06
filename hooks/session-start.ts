#!/usr/bin/env bun
// nunchi SessionStart hook (Bun)
// 프로젝트의 calibration 문서를 세션 컨텍스트에 조용히 주입한다.
// startup / resume / clear / compact 모두에서 실행 (matcher 미지정 = 전체).
// config: auto-start=true 면 memory server 자동 시작, path 로 문서 경로 변경 가능.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveDocDir,
  resolveDocPath,
  readStdinJson,
  DOC_FILENAME,
} from "./config.ts";

const MAX_CHARS = 9000; // hook 출력 상한(10,000자) 대비 여유

const input = await readStdinJson();
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const cfg = loadConfig(projectDir);

// auto-start: memory server 자동 시작 (이미 떠 있으면 서버가 포트 락으로 즉시 종료 → 멱등)
// external-address 설정 시에는 외부 서버를 쓰므로 로컬 스폰을 건너뛴다
if (cfg["auto-start"] && !cfg["external-address"]) {
  try {
    Bun.spawn(
      ["bun", fileURLToPath(new URL("../memory/server.ts", import.meta.url))],
      {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }
    ).unref();
  } catch {
    /* 서버 기동 실패(의존성 미설치 등)해도 주입은 계속 */
  }
}

const docRel = join(cfg.path, DOC_FILENAME);
const docPath = resolveDocPath(projectDir, cfg);

// 초기화: path 폴더가 없으면 생성
try {
  mkdirSync(resolveDocDir(projectDir, cfg), { recursive: true });
} catch {
  /* 생성 실패해도 주입은 계속 — 기록 시점에 다시 시도된다 */
}

let context: string;
if (existsSync(docPath)) {
  let doc = "";
  try {
    doc = readFileSync(docPath, "utf8");
  } catch {
    process.exit(0);
  }
  if (doc.length > MAX_CHARS) {
    doc = doc.slice(0, MAX_CHARS) + "\n...(truncated: 문서가 상한을 초과함. 정제 필요)";
  }
  context = [
    "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다.",
    `아래는 이 환경에서 학습된 보정 문서(${docRel}) 전문이다. 작업 강도(검증 깊이, 테스트 여부, 리서치 범위, 리팩토링 범위) 결정 시 이 문서가 기준이 된다.`,
    `작업 중 예측과 실제가 어긋나는 경우(과잉 대응 / 과소 대응으로 인한 문제 / 환경 특이사항 발견)에는 nunchi 스킬 규약대로 이 문서(${docRel})에 1-3줄을 추가한다.`,
    "",
    "---",
    doc,
    "---",
  ].join("\n");
} else {
  context = [
    `[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다. 보정 문서(${docRel})는 아직 없다.`,
    `작업 중 예측과 실제가 어긋나는 경우(과잉 대응 / 과소 대응으로 인한 문제 / 환경 특이사항)를 처음 발견하면 nunchi 스킬을 참조해 ${docRel} 를 생성하고 기록한다.`,
  ].join("\n");
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
process.exit(0);
