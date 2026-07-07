// bun test tests/search.test.ts
// 키워드 보강 유틸 검증. 검색 경로(FTS/LIKE 폴백)는 calibration.test.ts가 담당.
import { expect, test } from "bun:test";
import { pickKeywordsLine } from "../memory/server.ts";

test("pickKeywordsLine: 서론이 섞여도 마지막 비어있지 않은 줄", () => {
  expect(pickKeywordsLine("다음은 키워드입니다.\n\nkw1, kw2, kw3\n")).toBe("kw1, kw2, kw3");
  expect(pickKeywordsLine("")).toBe("");
});
