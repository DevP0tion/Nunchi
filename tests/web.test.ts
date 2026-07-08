// bun test tests/web.test.ts
// 웹 대시보드: 설정 정규화 + 토큰 인증 + 정적 서빙
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioc } from "socket.io-client";
import { loadMemoryConfig, resolveMemoryPort } from "../memory/server.ts";
import { assignFreePort, connectMemory } from "../memory/client.ts";
import { rmProject } from "./helpers.ts";

const D = mkdtempSync(join(tmpdir(), "nunchi-webcfg-"));
/** 임시 memory-config.json을 쓰고 경로 반환 */
const cfgFile = (obj: unknown): string => {
  const p = join(D, "memory-config.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
};

test("loadMemoryConfig: 구버전 host 문자열 정규화 + web/token 기본값", () => {
  // 구버전 문자열 host — 루프백은 false, 그 외는 true
  expect(loadMemoryConfig(cfgFile({ host: "127.0.0.1" })).host).toBe(false);
  expect(loadMemoryConfig(cfgFile({ host: "localhost" })).host).toBe(false);
  expect(loadMemoryConfig(cfgFile({ host: "::1" })).host).toBe(false);
  expect(loadMemoryConfig(cfgFile({ host: "0.0.0.0" })).host).toBe(true);
  // 불리언은 그대로
  expect(loadMemoryConfig(cfgFile({ host: true })).host).toBe(true);
  expect(loadMemoryConfig(cfgFile({ host: false })).host).toBe(false);
  // 기본값
  const def = loadMemoryConfig(cfgFile({}));
  expect(def.host).toBe(false);
  expect(def.web).toBe(false);
  expect(def.token).toBe(null);
  // 빈 문자열 token은 무인증(null) 취급
  expect(loadMemoryConfig(cfgFile({ token: "" })).token).toBe(null);
  expect(loadMemoryConfig(cfgFile({ token: "s3cret" })).token).toBe("s3cret");
});

test(
  "token: 클라이언트는 config 토큰으로 접속, 무토큰 원시 접속은 거부",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-tok-"));
    await assignFreePort(A);
    const dir = join(A, ".claude", "nunchi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "memory-config.json"),
      JSON.stringify({ version: 1, token: "s3cret" })
    );
    const mem = await connectMemory(A); // client가 config에서 토큰을 읽어 전달 — 성공해야 함
    try {
      expect(await mem.stamp()).toBe(null); // 인증 통과 후 정상 왕복
      // 토큰 없는 원시 소켓은 미들웨어가 거부
      const err = await new Promise<unknown>((resolve) => {
        const bad = ioc(`http://127.0.0.1:${resolveMemoryPort(A)}`, {
          reconnection: false,
        });
        bad.once("connect", () => { bad.close(); resolve(null); });
        bad.once("connect_error", (e) => { bad.close(); resolve(e); });
      });
      expect(String(err)).toContain("unauthorized");
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);

test(
  "web: true — 대시보드 정적 서빙, 경로 탈출 차단",
  async () => {
    const A = mkdtempSync(join(tmpdir(), "nunchi-webui-"));
    await assignFreePort(A);
    const dir = join(A, ".claude", "nunchi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "memory-config.json"),
      JSON.stringify({ version: 1, web: true })
    );
    const mem = await connectMemory(A);
    try {
      const base = `http://127.0.0.1:${resolveMemoryPort(A)}`;
      const home = await fetch(`${base}/`);
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toContain("text/html");
      expect(await home.text()).toContain("nunchi memory");
      const css = await fetch(`${base}/style.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toContain("text/css");
      // 경로 탈출 (%2F = 인코딩된 '/' — fetch가 정규화하지 못하는 형태) → 404
      expect((await fetch(`${base}/..%2Fserver.ts`)).status).toBe(404);
      expect((await fetch(`${base}/no-such.css`)).status).toBe(404);
    } finally {
      await mem.shutdown();
      await rmProject(A);
    }
  },
  20000
);
