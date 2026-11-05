// 세션 주제 상태 파일 — memory server가 쓰고, 훅이 소켓 없이 읽는다.
// <docDir>/sessions/<sid>.json              현재 주제 + rev
// <docDir>/sessions/<sid>.delivered         메인 에이전트가 마지막으로 받은 rev
// <docDir>/sessions/<sid>.<agentId>.delivered  서브에이전트별 rev
// bun:sqlite·socket.io를 import하지 않는다 (훅 dist 번들 오염 방지 — memory-config.ts와 같은 이유).
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TopicState {
  id: number;
  name: string;
  description: string;
  folders: string[];
  areas: { id: number; area: string }[];
}

export interface SessionStateFile {
  rev: number;
  topic: TopicState | null;
}

export function sessionsDir(docDir: string): string {
  return join(docDir, "sessions");
}

// 파일명에 들어가는 id — 경로 탈출 방지를 위해 이 문자만 허용
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function deliveredName(sid: string, agentId?: string | null): string | null {
  if (!SAFE_ID.test(sid)) return null;
  if (!agentId) return `${sid}.delivered`;
  return SAFE_ID.test(agentId) ? `${sid}.${agentId}.delivered` : null;
}

// tmp 파일에 쓴 뒤 rename — 훅이 쓰다 만 파일을 읽지 않게 한다
function writeAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function writeSessionState(docDir: string, sid: string, s: SessionStateFile): void {
  if (!SAFE_ID.test(sid)) return;
  writeAtomic(join(sessionsDir(docDir), `${sid}.json`), JSON.stringify(s));
}

/** 없음·파싱 실패·형식 불일치 → null */
export function readSessionState(docDir: string, sid: string): SessionStateFile | null {
  if (!SAFE_ID.test(sid)) return null;
  try {
    const s = JSON.parse(readFileSync(join(sessionsDir(docDir), `${sid}.json`), "utf8"));
    return s && typeof s.rev === "number" ? (s as SessionStateFile) : null;
  } catch {
    return null;
  }
}

/** 없음·잘못된 id·파싱 실패 → 0 */
export function readDelivered(docDir: string, sid: string, agentId?: string | null): number {
  const name = deliveredName(sid, agentId);
  if (!name) return 0;
  try {
    const n = parseInt(readFileSync(join(sessionsDir(docDir), name), "utf8"), 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export function writeDelivered(docDir: string, sid: string, agentId: string | null | undefined, rev: number): void {
  const name = deliveredName(sid, agentId);
  if (name) writeAtomic(join(sessionsDir(docDir), name), String(rev));
}

/** <sid>.json, <sid>.delivered, <sid>.<agentId>.delivered (+ 남은 tmp 파일) 삭제. sid에 "."이 올 수 없어 접두 일치가 모호하지 않다 */
export function removeSessionFiles(docDir: string, sid: string): void {
  if (!SAFE_ID.test(sid)) return;
  const dir = sessionsDir(docDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) if (n.startsWith(`${sid}.`)) rmSync(join(dir, n), { force: true });
}
