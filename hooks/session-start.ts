#!/usr/bin/env bun
// nunchi SessionStart hook (Bun)
// 보정 DB의 규약 요약 + 코어('벌주는 것' 신뢰도 3+)를 세션 컨텍스트에 조용히 주입한다.
// startup / resume / clear / compact 모두에서 실행 (matcher 미지정 = 전체).
// 서버 스폰·external-address·핸드셰이크는 전부 connectMemory가 담당한다.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  loadConfig,
  resolveDocDir,
  hookProjectDir,
  isPonytailEnabled,
  readStdinJson,
} from "./config.ts";
import { TOPIC_CLEARED, formatCoreBlock, formatTopicBlock, formatTopicList, sessionIdLine } from "./topic.ts";
import { writeDelivered } from "../memory/session-state.ts";

const projectDir = hookProjectDir();
const input = await readStdinJson();
const sid = input.session_id;
const cfg = loadConfig(projectDir);
const docDir = resolveDocDir(projectDir, cfg);

// 초기화: path 폴더(db 위치)가 없으면 생성
try {
  mkdirSync(docDir, { recursive: true });
} catch {
  /* 생성 실패해도 주입은 계속 */
}

// 코어 조회 — auto-start면 connectMemory가 서버를 스폰한다 (기존 스폰 블록 대체)
let core: import("./config.ts").MemoryEntryLite[] = [];
let note: string | null = null;
// 워크스페이스 탭: ws:* 호출은 각자 try — 구버전 서버·타임아웃이어도 코어 주입은 나간다
let topic: import("../memory/session-state.ts").TopicState | null = null;
let memberIds: number[] = [];
let rev = 0;
let stateOk = false; // 주제 조회 성공 여부 — 실패(구버전 서버)면 resume 무효화 줄도 내지 않는다
let topicList: Awaited<ReturnType<import("../memory/client.ts").MemoryClient["topics"]>> | null = null;
try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir);
  try {
    core = await mem.core();
    if (sid) {
      // 동시 호출: 구버전 서버는 ws:*에 응답하지 않아 순차 호출이면 호출마다 1.5초씩 쌓인다.
      // 소켓은 emit 순서를 보존하고 서버 ws 핸들러는 동기라 등록이 조회보다 먼저 반영된다
      const [, st, tl] = await Promise.allSettled([
        mem.registerSession({ sessionId: sid, title: input.session_title, cwd: input.cwd }),
        mem.sessionState(sid),
        mem.topics(),
      ]);
      if (st.status === "fulfilled") {
        ({ topic, memberIds, rev } = st.value);
        stateOk = true;
      }
      if (tl.status === "fulfilled") topicList = tl.value;
    }
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
  "예측과 실제가 어긋나면(과잉/과소/환경 특이사항/예측보다 좋았음) 또는 사용자가 작업 방식을 좋다고 하면 nunchi_record로 기록한다. 기존 항목 재확인은 nunchi_update(action: confirm), '권장(강도)'을 따르다 사고가 나면 nunchi_update(action: reverse)로 즉시 반전하고, '권장(방법)'이 틀렸으면 edit·remove로 고친다.",
  "작업 기록 규약: 완결된 작업(산출물이 남는 요청 단위)을 마무리하면 nunchi_search로 유사 task 항목을 찾아 — 절차가 어긋났으면 nunchi_update(edit)로 교정, 그대로 유효했으면 nunchi_update(confirm), 없으면 nunchi_record(section: task)로 신규 기록한다.",
  "관찰 레인: 확신이 없는 예측 어긋남 의심은 nunchi_record(section: observe)로 가볍게 남긴다 (자동 회수 제외). 같은 신호가 반복 확인되면 nunchi_update(action: promote, id: 대표 관찰, sources: 추가 관찰)로 보정 항목으로 승격한다 — 출처가 계보로 보존된다.",
];
// additionalContext는 1만자를 넘으면 파일로 빠진다 — 주제 관련 추가분(세션 id 줄·주제 목록·주제 블록)은
// 합쳐서 TOPIC_BUDGET으로 묶고, 코어는 8000에서 추가분을 뺀 만큼만 싣는다 (규약·SKILL·ponytail 줄 생존)
const TOPIC_BUDGET = 2500;
let extra = "";
if (sid) {
  const head = [sessionIdLine(sid)];
  if (input.source === "fork") head.push(TOPIC_CLEARED); // fork는 부모 주제를 이어받지 않는다
  else if (input.source === "resume" || input.source === "compact") {
    try {
      if (topic) head.push(formatTopicBlock(topic));
      // resume: SessionEnd가 정상 종료 시 세션을 지우므로 옛 transcript의 주제 블록은 무효다
      else if (stateOk && input.source === "resume") head.push(TOPIC_CLEARED);
      if (topic || (stateOk && input.source === "resume")) writeDelivered(docDir, sid, null, rev); // 첫 메시지 재주입 방지
    } catch { /* 렌더링·기록 실패 — 첫 메시지 훅이 다시 알린다 */ }
  }
  // 주제 목록은 남는 예산에 들어가는 만큼만 (규약 줄은 formatTopicList가 항상 마지막에 붙인다)
  const fit = (n: number) => [...head, formatTopicList(topicList!.slice(0, n))].join("\n");
  let n = topicList ? topicList.length : 0;
  while (topicList && n > 0 && fit(n).length > TOPIC_BUDGET) n--;
  extra = (topicList ? fit(n) : head.join("\n")).slice(0, TOPIC_BUDGET);
  lines.push(extra);
}
if (core.length) {
  // ponytail: 하드 슬라이스 — 코어가 예산을 넘는 비정상 상황에서만 잘리며, 규약·ponytail 줄이 항상 살아남는 것이 우선
  lines.push("", formatCoreBlock(core, topic ? memberIds : null).slice(0, Math.max(0, 8000 - extra.length)));
}
if (note) lines.push("", note);
lines.push(
  "",
  `[nunchi] 기록 규약 전문(SKILL.md): ${join(PLUGIN_ROOT, "SKILL.md")}`
);

// ponytail(고정 강도 정책) 공존: 우선순위가 결정돼 있으면 규칙 1줄, 미결정이면 질문 지시 1줄 주입
if (isPonytailEnabled(projectDir)) {
  const priority = cfg["policy-priority"];
  if (priority === "nunchi") {
    lines.push(
      "[nunchi] ponytail 활성 (사용자 결정: nunchi 우선). 작업 강도 판단이 충돌하면 보정 DB가 ponytail의 최소화 규칙보다 우선한다. 특히 코어 항목('벌주는 것'·'권장(방법)' 3+)은 항상 지킨다."
    );
  } else if (priority === "ponytail") {
    lines.push(
      "[nunchi] ponytail 활성 (사용자 결정: ponytail 우선). 작업 강도 판단이 충돌하면 ponytail의 최소화 규칙을 따른다. 단 코어 항목(신뢰도 높음(3+)의 '벌주는 것'·'권장(방법)')은 실제 사고 기록이거나 반복 확인된 사용자 선호이므로 예외로 지키고, 생략이 사고로 이어지면 반전 규칙대로 기록한다."
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
