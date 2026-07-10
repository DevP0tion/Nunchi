#!/usr/bin/env bun
// nunchi SessionStart hook (Bun)
// 보정 DB의 규약 요약 + 코어('벌주는 것' 신뢰도 3+)를 세션 컨텍스트에 조용히 주입한다.
// startup / resume / clear / compact 모두에서 실행 (matcher 미지정 = 전체).
// 서버 스폰·external-address·핸드셰이크는 전부 connectMemory가 담당한다.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveDocDir,
  readStdinJson,
  isPonytailEnabled,
  formatMemoryEntries,
} from "./config.ts";

const input = await readStdinJson();
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const cfg = loadConfig(projectDir);

// 초기화: path 폴더(db 위치)가 없으면 생성
try {
  mkdirSync(resolveDocDir(projectDir, cfg), { recursive: true });
} catch {
  /* 생성 실패해도 주입은 계속 */
}

// 코어 조회 — auto-start면 connectMemory가 서버를 스폰한다 (기존 스폰 블록 대체)
let core: import("./config.ts").MemoryEntryLite[] = [];
let note: string | null = null;
try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir);
  try {
    core = await mem.core();
  } finally {
    mem.close();
  }
} catch (e) {
  // 미접속이어도 규약 주입은 계속. 포트 충돌 안내는 모델이 사용자에게 전달하도록 남긴다
  if (e instanceof Error && e.name === "ProjectMismatchError") note = e.message;
}

const lines = [
  "[nunchi] 이 프로젝트는 작업 강도 보정 규약을 사용한다 (보정 DB — 검색 회수 방식).",
  "작업 강도(검증 깊이, 테스트 여부, 리서치 범위, 리팩토링 범위) 판단 시: 자동 주입된 항목으로 부족하면 nunchi_search(유의어·한/영 확장 쿼리 2-5개), 그래도 애매하거나 판단이 중요하면 nunchi_list로 전량을 읽고 직접 선별한다.",
  "예측과 실제가 어긋나면(과잉/과소/환경 특이사항) nunchi_record로 기록한다. 기존 항목 재확인은 nunchi_update(action: confirm), '용서하는 것'을 따르다 사고가 나면 nunchi_update(action: reverse)로 즉시 반전한다.",
  "작업 기록 규약: 완결된 작업(산출물이 남는 요청 단위)을 마무리하면 nunchi_search로 유사 task 항목을 찾아 — 절차가 어긋났으면 nunchi_update(edit)로 교정, 그대로 유효했으면 nunchi_update(confirm), 없으면 nunchi_record(section: task)로 신규 기록한다.",
];
if (core.length) {
  const coreBlock = formatMemoryEntries(core).slice(0, 8000);
  // ponytail: 하드 슬라이스 — 코어가 8천자를 넘는 비정상 상황에서만 잘리며, 규약·ponytail 줄이 항상 살아남는 것이 우선
  lines.push("", "[확정 규칙 — '벌주는 것' 신뢰도 높음(3+). 항상 지킨다]", coreBlock);
}
if (note) lines.push("", note);
lines.push(
  "",
  `[nunchi] 기록 규약 전문(SKILL.md): ${fileURLToPath(new URL("../SKILL.md", import.meta.url))}`
);

// ponytail(고정 강도 정책) 공존: 우선순위가 결정돼 있으면 규칙 1줄, 미결정이면 질문 지시 1줄 주입
if (isPonytailEnabled(projectDir)) {
  const priority = cfg["policy-priority"];
  if (priority === "nunchi") {
    lines.push(
      "[nunchi] ponytail 활성 (사용자 결정: nunchi 우선). 작업 강도 판단이 충돌하면 보정 DB가 ponytail의 최소화 규칙보다 우선한다. 특히 '벌주는 것' 항목은 항상 지킨다."
    );
  } else if (priority === "ponytail") {
    lines.push(
      "[nunchi] ponytail 활성 (사용자 결정: ponytail 우선). 작업 강도 판단이 충돌하면 ponytail의 최소화 규칙을 따른다. 단 신뢰도 높음(3+)의 '벌주는 것' 항목은 실제 사고 기록이므로 예외로 지키고, 생략이 사고로 이어지면 반전 규칙대로 기록한다."
    );
  } else {
    lines.push(
      '[nunchi] ponytail 활성 감지 — 보정 DB와의 우선순위 미결정. 이번 세션에서 작업 강도 판단이 처음 충돌하면(ponytail은 생략을 권하는데 보정 DB는 반대, 또는 그 역) AskUserQuestion으로 어느 쪽을 우선할지 물어보고, 답을 프로젝트 .claude/nunchi.json 의 "policy-priority" 키에 "nunchi" 또는 "ponytail" 로 저장한다. 다음 세션부터 자동 반영된다. 충돌이 없으면 묻지 않는다.'
    );
  }
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  })
);
process.exit(0);
