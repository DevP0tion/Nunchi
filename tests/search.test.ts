// bun test tests/search.test.ts
// 키워드 보강 유틸 검증. 검색 경로(FTS/LIKE 폴백)는 store.test.ts가 담당.
import { expect, test } from "bun:test";
import { dlopen, FFIType } from "bun:ffi";
import { pickKeywordsLine, spawnProvider } from "../memory/server.ts";

// 콘솔 창 제목 읽기·쓰기 (kernel32). 콘솔 없는 프로세스면 GetConsoleTitleW가 0 → null
const k32 =
  process.platform === "win32"
    ? dlopen("kernel32.dll", {
        GetConsoleTitleW: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
        SetConsoleTitleW: { args: [FFIType.ptr], returns: FFIType.bool },
      }).symbols
    : null;
const getTitle = () => {
  const buf = new Uint16Array(1024);
  const n = k32!.GetConsoleTitleW(buf, buf.length);
  return n ? String.fromCharCode(...buf.subarray(0, n)) : null;
};

test.skipIf(!k32 || getTitle() === null)(
  "spawnProvider: 보강 CLI가 memory server 창 제목을 바꾸지 못한다 (Windows)",
  async () => {
    const before = getTitle()!;
    try {
      // claude CLI가 공유 콘솔 제목을 "claude"로 덮던 결함 — API 호출 없는 title 명령으로 재현
      expect(await spawnProvider(["title", "nunchi-title-changed"], "").exited).toBe(0);
      expect(getTitle()).toBe(before);
    } finally {
      k32!.SetConsoleTitleW(Buffer.from(before + "\0", "utf16le"));
    }
  }
);

test("spawnProvider: 프롬프트는 stdin으로, 응답은 stdout 파이프로", async () => {
  const proc = spawnProvider([process.platform === "win32" ? "sort" : "cat"], "nunchi-ok\n");
  expect((await new Response(proc.stdout).text()).trim()).toBe("nunchi-ok");
});

test("pickKeywordsLine: 서론이 섞여도 마지막 비어있지 않은 줄", () => {
  expect(pickKeywordsLine("다음은 키워드입니다.\n\nkw1, kw2, kw3\n")).toBe("kw1, kw2, kw3");
  expect(pickKeywordsLine("")).toBe("");
});
