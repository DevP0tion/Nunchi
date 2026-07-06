#!/usr/bin/env bun
// nunchi Stop hook (Bun)
// 매 응답 종료 시 카운트를 올리고, CHECK_EVERY 턴마다 한 번
// "이번 구간에 surprise 있었나?" 점검을 강제한다 (decision: block).
// - stop_hook_active 가드로 무한 루프 방지
// - 구간 내에 보정 DB 기록이 이미 있었으면 점검 생략 (중복 잔소리 방지)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStdinJson } from "./config.ts";

const CHECK_EVERY = Math.max(
  2,
  parseInt(process.env.NUNCHI_CHECK_EVERY || "10", 10) || 10
);

const input = await readStdinJson();

// 직전 Stop hook이 이미 진행을 막은 상태면 즉시 통과 (루프 가드)
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const sessionId = String(input.session_id || "unknown").replace(/[^\w-]/g, "");
const stateDir = join(tmpdir(), "nunchi");
const statePath = join(stateDir, `${sessionId}.json`);

interface State {
  count: number;
  /** 구간 시작 시점의 cal:stamp — null이면 서버 미접속 또는 엔트리 없음 */
  stamp: string | null;
}

let state: State = { count: 0, stamp: null };
try {
  state = { ...state, ...JSON.parse(readFileSync(statePath, "utf8")) };
} catch {
  /* 첫 실행 */
}

state.count += 1;

// 보정 DB의 마지막 기록 시각 — 서버 미기동이면 null (스폰하지 않는다)
let stamp: string | null = null;
try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    stamp = await mem.calStamp();
  } finally {
    mem.close();
  }
} catch {
  /* 서버 미접속 — 점검 자체는 그대로 진행 */
}

// 구간 첫 턴에 stamp 기준선 기록
if (state.count === 1) state.stamp = stamp;

let block = false;
if (state.count >= CHECK_EVERY) {
  // ponytail: 서버 단절 구간의 stamp 비교는 근사 — 오검(생략)보다 과검(한 번 더 점검)을 택한다
  // — 기준선 미상(null)은 기록으로 치지 않는다
  const recorded = state.stamp !== null && stamp !== null && stamp !== state.stamp;
  block = !recorded;
  state.count = 0;
  state.stamp = null;
}

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
} catch {
  /* 상태 저장 실패는 치명적이지 않음 */
}

if (block) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        `[nunchi] 주기 점검(${CHECK_EVERY}턴): 이번 구간에 예측과 실제가 어긋난 경우가 있었는가? ` +
        `(1) 과잉 대응 — 한 검증/리서치/방어 코드가 불필요했음 (2) 과소 대응 — 생략한 것 때문에 문제 발생 (3) 환경 특이사항 발견. ` +
        `있었다면 nunchi_record(신규) 또는 nunchi_update(action: confirm 재확인 / reverse 반전)로 기록할 것. ` +
        `없었다면 "보정 특이사항 없음" 한 줄만 답하고 종료할 것.`,
    })
  );
}
process.exit(0);
