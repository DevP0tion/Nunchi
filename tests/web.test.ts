// bun test tests/web.test.ts
// 웹 대시보드: 설정 정규화 + 토큰 인증 + 정적 서빙
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemoryConfig } from "../memory/server.ts";

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
