// bun test memory/search.test.ts
// 검색 경로(FTS/LIKE 폴백)와 키워드 보강의 저장소 로직 검증. socket 계층은 제외.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createStore, pickKeywordsLine } from "./server.ts";

const makeStore = () => createStore(new Database(":memory:"));
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

test("FTS: 3글자 이상 한국어 질의는 trigram 부분 문자열 매칭", () => {
  const store = makeStore();
  store.set("s1", "배포 전 검증을 생략했다가 회귀 발생");
  store.set("s2", "테스트 커버리지는 충분했다");
  expect(keys(store.search("회귀 발생", 20))).toEqual(["s1"]);
  expect(keys(store.search("커버리지", 20))).toEqual(["s2"]);
});

test("LIKE 폴백: 2글자 질의도 검색된다", () => {
  const store = makeStore();
  store.set("s1", "배포 전 검증을 생략했다가 회귀 발생");
  expect(keys(store.search("검증", 20))).toEqual(["s1"]);
});

test("keywords 컬럼도 검색 대상 (FTS·LIKE 양쪽)", () => {
  const store = makeStore();
  store.set("s1", "배포 전 검증 생략");
  store.setKeywords("s1", "배포 전 검증 생략", "regression, deploy check, qa");
  expect(keys(store.search("regression", 20))).toEqual(["s1"]); // FTS 경로
  expect(keys(store.search("qa", 20))).toEqual(["s1"]); // LIKE 경로 (2글자)
});

test("값 갱신 시 keywords 초기화 + FTS 인덱스 동기화", () => {
  const store = makeStore();
  store.set("s1", "옛날 내용 알파벳");
  store.setKeywords("s1", "옛날 내용 알파벳", "oldkeyword");
  store.set("s1", "새로운 내용 감마");
  expect(store.search("oldkeyword", 20)).toEqual([]); // 낡은 키워드 폐기
  expect(store.search("알파벳", 20)).toEqual([]); // 옛 값은 인덱스에서 제거
  expect(keys(store.search("새로운 내용", 20))).toEqual(["s1"]);
});

test("setKeywords는 value가 일치할 때만 적용 (늦게 도착한 보강 가드)", () => {
  const store = makeStore();
  store.set("s1", "v2");
  store.setKeywords("s1", "v1", "stalekeyword"); // 보강 중 값이 바뀐 상황 — no-op
  expect(store.search("stalekeyword", 20)).toEqual([]);
});

test("FTS 특수문자 질의는 폴백으로 안전하게 처리", () => {
  const store = makeStore();
  store.set("s1", 'query "quoted" AND OR value');
  expect(keys(store.search('"quoted"', 20))).toEqual(["s1"]);
});

test("pickKeywordsLine: 서론이 섞여도 마지막 비어있지 않은 줄", () => {
  expect(pickKeywordsLine("다음은 키워드입니다.\n\nkw1, kw2, kw3\n")).toBe("kw1, kw2, kw3");
  expect(pickKeywordsLine("")).toBe("");
});
