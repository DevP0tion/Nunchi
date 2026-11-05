#!/usr/bin/env bun
// nunchi SessionEnd hook (Bun) — 대시보드 보드에서 세션을 제거한다 (서버가 세션 행·상태 파일 삭제).
// 서버 미기동이면 스폰하지 않고 통과한다.
import { hookProjectDir, readStdinJson } from "./config.ts";

const projectDir = hookProjectDir();
const sid = (await readStdinJson()).session_id;
if (!sid) process.exit(0);

try {
  const { connectMemory } = await import("../memory/client.ts");
  const mem = await connectMemory(projectDir, { noSpawn: true });
  try {
    await mem.endSession(sid);
  } finally {
    mem.close();
  }
} catch {
  /* 서버 미기동·타임아웃 — 세션 만료(24시간)가 정리한다 */
}
process.exit(0);
