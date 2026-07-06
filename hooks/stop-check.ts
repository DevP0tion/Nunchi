#!/usr/bin/env bun
// nunchi Stop hook (Bun)
// 매 응답 종료 시 카운트를 올리고, CHECK_EVERY 턴마다 한 번
// "이번 구간에 surprise 있었나?" 점검을 강제한다 (decision: block).
// - stop_hook_active 가드로 무한 루프 방지
// - 구간 내에 calibration 문서가 이미 갱신됐으면 점검 생략 (중복 잔소리 방지)
// config: path 로 문서 경로 변경 가능.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  resolveDocPath,
  readStdinJson,
  DOC_FILENAME,
} from "./config.ts";

const CHECK_EVERY = Math.max(
  2,
  parseInt(process.env.NUNCHI_CHECK_EVERY || "10", 10) || 10
);

const input = await readStdinJson();

// 직전 Stop hook이 이미 진행을 막은 상태면 즉시 통과 (루프 가드)
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const cfg = loadConfig(projectDir);

const docRel = join(cfg.path, DOC_FILENAME);
const docPath = resolveDocPath(projectDir, cfg);

const sessionId = String(input.session_id || "unknown").replace(/[^\w-]/g, "");
const stateDir = join(tmpdir(), "nunchi");
const statePath = join(stateDir, `${sessionId}.json`);

interface State {
  count: number;
  docMtime: number;
}

let state: State = { count: 0, docMtime: 0 };
try {
  state = { ...state, ...JSON.parse(readFileSync(statePath, "utf8")) };
} catch {
  /* 첫 실행 */
}

state.count += 1;

let mtime = 0;
try {
  if (existsSync(docPath)) mtime = statSync(docPath).mtimeMs;
} catch {
  /* ignore */
}

// 구간 첫 턴에 문서 mtime 기준선 기록
if (state.count === 1) state.docMtime = mtime;

let block = false;
if (state.count >= CHECK_EVERY) {
  // 구간 내 문서 갱신이 있었으면(모델이 재량으로 이미 기록) 점검 생략
  block = !(mtime > state.docMtime);
  state.count = 0;
  state.docMtime = 0;
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
        `있었다면 ${docRel} 에 nunchi 스킬 규약대로 1-3줄 기록할 것. ` +
        `없었다면 "보정 특이사항 없음" 한 줄만 답하고 종료할 것.`,
    })
  );
}
process.exit(0);
