#!/usr/bin/env bun
// nunchi SessionStart hook (Bun)
// 프로젝트의 calibration 문서를 세션 컨텍스트에 조용히 주입한다.
// startup / resume / clear / compact 모두에서 실행 (matcher 미지정 = 전체).
// config: auto-start=true 면 memory server 자동 시작, path 로 문서 경로 변경 가능.
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveDocDir,
  resolveDocPath,
  readStdinJson,
  isPonytailEnabled,
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
    // node:child_process + detached: Bun.spawn의 unref()는 이벤트 루프 분리만 할 뿐이라
    // Windows에서 훅(부모) 종료 시 자식도 함께 죽는다 — detached만이 부모 종료 후 생존을 보장
    spawn(
      "bun",
      [fileURLToPath(new URL("../memory/server.ts", import.meta.url))],
      {
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        detached: true,
        stdio: "ignore",
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

// external-address 설정 시 외부 memory server의 calibration 문서를 우선 사용.
// 접속 실패·구버전 서버(mem:doc 미지원)·문서 없음이면 로컬 문서로 폴백.
let doc: string | null = null;
let docSource = `보정 문서(${docRel})`;
if (cfg["external-address"]) {
  try {
    // 동적 import: 로컬 경로에서는 socket.io-client를 로드하지 않는다
    const { connectMemory } = await import("../memory/client.ts");
    const mem = await connectMemory(projectDir);
    try {
      doc = await mem.doc();
    } finally {
      mem.close();
    }
    if (doc !== null) {
      docSource = `외부 memory server(${cfg["external-address"]})의 보정 문서`;
    }
  } catch {
    /* 외부 서버 실패 → 로컬 문서 폴백 */
  }
}
if (doc === null && existsSync(docPath)) {
  try {
    doc = readFileSync(docPath, "utf8");
  } catch {
    process.exit(0);
  }
}

let context: string;
if (doc !== null) {
  if (doc.length > MAX_CHARS) {
    doc = doc.slice(0, MAX_CHARS) + "\n...(truncated: 문서가 상한을 초과함. 정제 필요)";
  }
  context = [
    "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다.",
    `아래는 이 환경에서 학습된 ${docSource} 전문이다. 작업 강도(검증 깊이, 테스트 여부, 리서치 범위, 리팩토링 범위) 결정 시 이 문서가 기준이 된다.`,
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

// 스킬 규약 문서 경로: Skill 도구가 없는 호스트(Codex CLI 등)에서도 규약 전문을 찾을 수 있게 명시
context += `\n[nunchi] 기록 규약 전문(SKILL.md): ${fileURLToPath(new URL("../SKILL.md", import.meta.url))}`;

// ponytail(고정 강도 정책) 공존: 우선순위가 결정돼 있으면 규칙 1줄, 미결정이면 질문 지시 1줄 주입
if (isPonytailEnabled(projectDir)) {
  const priority = cfg["policy-priority"];
  if (priority === "calibration") {
    context +=
      "\n[nunchi] ponytail 활성 (사용자 결정: calibration 우선). 작업 강도 판단이 충돌하면 calibration 문서가 ponytail의 최소화 규칙보다 우선한다. 특히 '벌주는 것' 엔트리는 항상 지킨다.";
  } else if (priority === "ponytail") {
    context +=
      "\n[nunchi] ponytail 활성 (사용자 결정: ponytail 우선). 작업 강도 판단이 충돌하면 ponytail의 최소화 규칙을 따른다. 단 신뢰도 높음(3+)의 '벌주는 것' 엔트리는 실제 사고 기록이므로 예외로 지키고, 생략이 사고로 이어지면 반전 규칙대로 기록한다.";
  } else {
    context +=
      '\n[nunchi] ponytail 활성 감지 — calibration과의 우선순위 미결정. 이번 세션에서 작업 강도 판단이 처음 충돌하면(ponytail은 생략을 권하는데 calibration은 반대, 또는 그 역) AskUserQuestion으로 어느 쪽을 우선할지 물어보고, 답을 프로젝트 .claude/nunchi.json 의 "policy-priority" 키에 "calibration" 또는 "ponytail" 로 저장한다. 다음 세션부터 자동 반영된다. 충돌이 없으면 묻지 않는다.';
  }
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
