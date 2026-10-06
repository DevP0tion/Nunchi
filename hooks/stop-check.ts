#!/usr/bin/env bun
// nunchi Stop hook (Bun)
// 매 응답 종료 시 카운트를 올리고, CHECK_EVERY 턴마다 한 번
// "이번 구간에 예측 어긋남이 있었나?" 점검을 강제한다 (decision: block).
// - stop_hook_active 가드로 무한 루프 방지
// - 구간 내에 이 세션이 보정 DB에 기록했으면 점검 생략 (중복 잔소리 방지)
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hookProjectDir, readStdinJson } from "./config.ts";

hookProjectDir(); // Claude Code 밖(다른 harness)이면 점검하지 않고 종료

const CHECK_EVERY = Math.max(
  2,
  parseInt(process.env.NUNCHI_CHECK_EVERY || "10", 10) || 10
);
const STATE_TTL_MS = 7 * 86400_000;

const input = await readStdinJson();

const sessionId = String(input.session_id || "unknown").replace(/[^\w-]/g, "");
const stateDir = join(tmpdir(), "nunchi");
const statePath = join(stateDir, `${sessionId}.json`);

interface State {
  count: number;
  /** 지난 점검 시점의 transcript 바이트 길이 — 이번 구간은 여기서부터 */
  offset: number;
}

let state: State = { count: 0, offset: 0 };
try {
  state = { ...state, ...JSON.parse(readFileSync(statePath, "utf8")) };
} catch {
  /* 첫 실행 */
}

const save = () => {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
    /* 상태 저장 실패는 치명적이지 않음 */
  }
};

// 직전 Stop hook이 이미 진행을 막은 상태면 즉시 통과 (루프 가드).
// 점검에 응답한 기록이 다음 구간의 "기록 있음"으로 세지지 않도록 기준선을 응답 뒤로 옮긴다
if (input.stop_hook_active) {
  try {
    state.offset = statSync(String(input.transcript_path)).size;
    save();
  } catch {
    /* transcript 없음 — 기준선 유지 */
  }
  process.exit(0);
}

state.count += 1;

let block = false;
if (state.count >= CHECK_EVERY) {
  // 이 세션의 transcript에서 구간 내 기록 도구 호출을 찾는다. DB 전체의 마지막 기록 시각은
  // 같은 DB를 쓰는 동시 세션의 기록까지 세므로 쓰지 않는다.
  // ponytail: 서브에이전트의 기록은 subagents/*.jsonl에 남아 보이지 않는다 — 과검(한 번 더 점검) 쪽으로 틀린다
  let recorded = false;
  try {
    const fd = openSync(String(input.transcript_path), "r");
    try {
      const size = fstatSync(fd).size;
      const from = size < state.offset ? 0 : state.offset; // 파일이 새로 쓰였으면 처음부터
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      recorded = /"name":"[^"]*nunchi_(?:record|update)"/.test(buf.toString("utf8"));
      state.offset = size;
    } finally {
      closeSync(fd);
    }
  } catch {
    /* transcript 없음·읽기 실패 — 기록 없음으로 보고 점검한다 */
  }
  block = !recorded;
  state.count = 0;
  // 끝난 세션의 상태 파일 정리 — 점검 턴에만 (매 턴 디렉터리를 훑지 않는다)
  try {
    for (const f of readdirSync(stateDir)) {
      const p = join(stateDir, f);
      if (Date.now() - statSync(p).mtimeMs > STATE_TTL_MS) rmSync(p, { force: true });
    }
  } catch {
    /* 정리 실패는 치명적이지 않음 */
  }
}

save();

if (block) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        `[nunchi] 주기 점검(${CHECK_EVERY}턴): ` +
        `(A) 이번 구간에 예측과 실제가 어긋난 경우가 있었는가? (1) 과잉 대응 (2) 과소 대응 (3) 환경 특이사항 — ` +
        `있었다면 nunchi_record(신규) 또는 nunchi_update(action: confirm 재확인 / reverse 반전). ` +
        `(B) 이번 구간에 완결된 작업(산출물이 남는 요청 단위)이 있는가? — ` +
        `있다면 유사 task 항목을 검색해 nunchi_update(edit 절차 교정 / confirm 재확인), 없으면 nunchi_record(section: task)로 기록. ` +
        `(C) 확신은 없지만 과잉/과소가 의심된 순간이 있었는가? — ` +
        `있다면 nunchi_record(section: observe)로 관찰만 남길 것 (자동 회수 제외 — 부담 없음, 반복되면 promote로 승격). ` +
        `셋 다 없었다면 "보정·작업 특이사항 없음" 한 줄만 답하고 종료할 것.`,
    })
  );
}
process.exit(0);
