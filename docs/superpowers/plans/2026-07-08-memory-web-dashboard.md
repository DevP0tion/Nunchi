# memory server 조건부 웹 대시보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** memory server에 `web: true` 설정 시 기존 포트에서 대시보드(전체 CRUD 웹 UI)를 서빙하고, `token` 설정 시 소켓 전체에 핸드셰이크 인증을 건다.

**Architecture:** 새 HTTP 서버·프로세스·포트 없음 — 기존 Socket.IO `httpServer`에 request 핸들러를 추가해 `memory/dashboard/`를 정적 서빙한다. 브라우저는 same-origin Socket.IO(`/socket.io/socket.io.js`는 socket.io가 자체 서빙)로 기존 `mem:*` 이벤트를 직접 호출하므로 별도 API 레이어가 없다. `host`는 문자열에서 불리언으로 전환(루프백/`0.0.0.0`)하고 구버전 문자열 값은 로드 시 정규화한다.

**Tech Stack:** Bun, socket.io 4.8.3 (기존 의존성), 바닐라 JS/HTML/CSS (빌드·프레임워크 없음)

**스펙:** `docs/superpowers/specs/2026-07-08-memory-web-dashboard-design.md`

## Global Constraints

- 새 npm 의존성 추가 금지 — socket.io/socket.io-client는 이미 설치됨
- 프런트엔드는 빌드 체인 없음: `memory/dashboard/index.html` + `style.css` 정적 파일 그대로 서빙
- 주석은 기존 코드베이스처럼 한국어, "왜"를 설명하는 것만
- 테스트 실행은 `bun test tests/web.test.ts` (통합 테스트는 실제 서버를 스폰 — 기존 store-socket.test.ts 패턴)
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러
- HTTPS/TLS, 계정·권한 분리, `web.port` 분리는 범위 밖 (스펙 참조)

---

### Task 1: 설정 스키마 — `web`/`token` 키 추가, `host` 불리언 전환

**Files:**
- Modify: `memory/server.ts:28-73` (MemoryConfig, MEMORY_CONFIG_DEFAULTS, loadMemoryConfig, resolveMemoryPort)
- Modify: `memory/server.ts:149-150, 186` (바인딩 주소 결정)
- Create: `tests/web.test.ts`

**Interfaces:**
- Consumes: 기존 `loadConfig`/`resolveDocDir` (hooks/config.ts — 변경 없음)
- Produces:
  - `MemoryConfig`에 `host: boolean`, `web: boolean`, `token: string | null` (기존 `host: string` 대체)
  - `loadMemoryConfig(configPath: string): MemoryConfig` — 구버전 문자열 host를 불리언으로 정규화
  - `resolveMemoryConn(projectDir: string): { port: number; token: string | null }` — Task 2의 client.ts가 사용
  - `resolveMemoryPort(projectDir: string): number` — 시그니처 유지 (resolveMemoryConn 위임)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/web.test.ts` 생성:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test tests/web.test.ts`
Expected: FAIL — `host`가 `"127.0.0.1"`(문자열)로 나와 `false` 기대와 불일치, `web`/`token`은 `undefined`

- [ ] **Step 3: 구현**

`memory/server.ts`의 `MemoryConfig` 인터페이스(28-44행)를 다음으로 교체:

```ts
/** 메모리 서버 전용 설정 (memory-config.json) */
export interface MemoryConfig {
  version: number;
  /** path 폴더 안의 sqlite 파일명 */
  db: string;
  /** Socket.IO 포트. 플러그인 config의 port가 설정돼 있으면 그쪽이 우선 */
  port: number;
  /** false = 루프백(127.0.0.1), true = 외부 공개(0.0.0.0). 소켓·웹 대시보드 공용.
   *  구버전 문자열 값("127.0.0.1" 등)은 loadMemoryConfig가 불리언으로 정규화.
   *  외부 공개 시 token 설정을 권장 — 없으면 신뢰할 수 있는 네트워크에서만 열 것 */
  host: boolean;
  /** true면 이 포트의 HTTP GET에서 대시보드(memory/dashboard)를 정적 서빙 */
  web: boolean;
  /** 설정 시 모든 Socket.IO 접속에 핸드셰이크 토큰 요구 (대시보드·MCP 클라이언트 공통).
   *  null·빈 문자열이면 무인증(기존 동작) */
  token: string | null;
  /** 설정 시(예: "haiku") 보정 기록(mem:add/update)마다 modelProvider CLI로
   *  검색 키워드를 비동기 생성. null이면 비활성. 기동 시 1회 로드 — 변경은 서버 재시작 후 반영 */
  model: string | null;
  /** 키워드 보강에 쓸 CLI 공급자 — provider/index.ts의 PROVIDERS 키
   *  ("claude" | "codex" | "gemini"). 기본 "claude" */
  modelProvider: string;
}
```

`MEMORY_CONFIG_DEFAULTS`(46-53행)를 교체:

```ts
const MEMORY_CONFIG_DEFAULTS: MemoryConfig = {
  version: 1,
  db: DB_FILENAME,
  port: DEFAULT_PORT,
  host: false,
  web: false,
  token: null,
  model: null,
  modelProvider: DEFAULT_PROVIDER,
};
```

`loadMemoryConfig`(55-64행)를 교체:

```ts
const LOOPBACKS = ["127.0.0.1", "localhost", "::1"];

/** memory-config.json 로드 — 없거나 손상이면 기본값과 병합 (키 단위) */
export function loadMemoryConfig(configPath: string): MemoryConfig {
  try {
    // trim(): UTF-8(BOM) 파일도 파싱되도록
    const raw = JSON.parse(readFileSync(configPath, "utf8").trim());
    const merged: MemoryConfig = { ...MEMORY_CONFIG_DEFAULTS, ...raw };
    // 구버전 host: string 정규화 — 루프백은 false, 그 외("0.0.0.0" 등)는 true
    if (typeof (merged.host as unknown) === "string")
      merged.host = !LOOPBACKS.includes(merged.host as unknown as string);
    merged.web = merged.web === true;
    merged.token =
      typeof merged.token === "string" && merged.token ? merged.token : null;
    return merged;
  } catch {
    return { ...MEMORY_CONFIG_DEFAULTS };
  }
}
```

`resolveMemoryPort`(66-73행)를 다음 두 함수로 교체:

```ts
/** 클라이언트용: 접속 정보(포트·토큰) 조회 (파일 생성 없음) */
export function resolveMemoryConn(
  projectDir: string
): { port: number; token: string | null } {
  const cfg = loadConfig(projectDir);
  const mc = loadMemoryConfig(
    join(resolveDocDir(projectDir, cfg), MEMORY_CONFIG_FILENAME)
  );
  return { port: cfg.port ?? mc.port, token: mc.token };
}

/** 클라이언트용: 접속할 포트만 조회 (파일 생성 없음) */
export function resolveMemoryPort(projectDir: string): number {
  return resolveMemoryConn(projectDir).port;
}
```

바인딩 주소: 186행 `httpServer.listen(port, memoryConfig.host, () => {`를 다음으로 교체:

```ts
  httpServer.listen(port, memoryConfig.host ? "0.0.0.0" : "127.0.0.1", () => {
```

149행 주석 `// 기본 루프백 바인딩. 외부 서비스가 필요하면 memory-config.json의 host를 변경`을 다음으로 교체:

```ts
  // 기본 루프백 바인딩. 외부 서비스가 필요하면 memory-config.json의 host를 true로
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test tests/web.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run: `bun test`
Expected: 전체 PASS — 기존 config 파일(문자열 host)을 쓰는 테스트가 있어도 정규화가 흡수

- [ ] **Step 6: 커밋**

```bash
git add memory/server.ts tests/web.test.ts
git commit -m "feat: memory-config에 web/token 키 추가, host 불리언 전환

구버전 문자열 host는 로드 시 정규화 (루프백 → false, 그 외 → true).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 토큰 인증 — 서버 미들웨어 + 클라이언트 자동 전달

**Files:**
- Modify: `memory/server.ts` (`const io = new Server(httpServer);` 직후에 미들웨어 추가)
- Modify: `memory/client.ts:10, 103-138` (import, tryConnect, connectMemory)
- Test: `tests/web.test.ts` (통합 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `resolveMemoryConn(projectDir): { port, token }`
- Produces:
  - 서버: `token` 설정 시 `socket.handshake.auth.token` 불일치 접속을 `Error("unauthorized")`로 거부
  - 클라이언트: `tryConnect(url: string, timeoutMs: number, token: string | null)` — 내부 함수 시그니처 변경
  - `connectMemory` 공개 시그니처는 변경 없음 (토큰은 config에서 자동)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/web.test.ts`에 추가 — import 블록을 다음으로 확장:

```ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioc } from "socket.io-client";
import { loadMemoryConfig, resolveMemoryPort } from "../memory/server.ts";
import { assignFreePort, connectMemory } from "../memory/client.ts";
import { rmProject } from "./helpers.ts";
```

테스트 추가:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test tests/web.test.ts`
Expected: FAIL — 서버에 미들웨어가 없어 원시 접속이 성공(`err === null`)하므로 `"unauthorized"` 불일치

- [ ] **Step 3: 서버 미들웨어 구현**

`memory/server.ts`의 `const io = new Server(httpServer);` 바로 다음 줄에 추가:

```ts
  // token 설정 시 모든 접속에 핸드셰이크 토큰 요구 (대시보드·MCP 클라이언트 공통).
  // 구버전 external-address 클라이언트는 토큰을 못 보내므로, 그런 환경에선 token을 설정하지 말 것
  if (memoryConfig.token) {
    io.use((socket, next) =>
      socket.handshake.auth?.token === memoryConfig.token
        ? next()
        : next(new Error("unauthorized"))
    );
  }
```

- [ ] **Step 4: 클라이언트 토큰 전달 구현**

`memory/client.ts` 10행의 import를 교체:

```ts
import { resolveMemoryConn } from "./server.ts";
```

`tryConnect`(103-115행)를 교체:

```ts
function tryConnect(
  url: string,
  timeoutMs: number,
  token: string | null
): Promise<Socket | null> {
  return new Promise((resolve) => {
    const s = io(url, {
      reconnection: false,
      timeout: timeoutMs,
      auth: token ? { token } : {},
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", () => {
      s.close();
      resolve(null);
    });
  });
}
```

`connectMemory` 안에서 — `const cfg = loadConfig(projectDir);` 바로 다음 줄에 추가:

```ts
  // 토큰은 로컬 memory-config.json에서 읽는다 — 외부 서버가 토큰을 요구하는 경우에도
  // 같은 값을 로컬 config에 넣어두면 전달된다
  const { port, token } = resolveMemoryConn(projectDir);
```

기존 호출부 3곳 수정:
- external 분기: `socket = await tryConnect(url, 3000);` → `socket = await tryConnect(url, 3000, token);`
- local 분기: `const port = resolveMemoryPort(projectDir);` 줄 **삭제** (위에서 이미 확보), `socket = await tryConnect(url, 2000);` → `socket = await tryConnect(url, 2000, token);`
- 재시도 루프: `socket = await tryConnect(url, 1000);` → `socket = await tryConnect(url, 1000, token);`

- [ ] **Step 5: 테스트 통과 확인**

Run: `bun test tests/web.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 기존 테스트 회귀 확인**

Run: `bun test`
Expected: 전체 PASS — token 미설정(기본 null)이면 미들웨어 자체가 등록되지 않아 기존 동작 동일

- [ ] **Step 7: 커밋**

```bash
git add memory/server.ts memory/client.ts tests/web.test.ts
git commit -m "feat: memory server 소켓 토큰 인증 — token 설정 시 핸드셰이크 검사

client.ts는 memory-config.json에서 토큰을 읽어 자동 전달.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 대시보드 프런트엔드 — `memory/dashboard/`

**Files:**
- Create: `memory/dashboard/index.html`
- Create: `memory/dashboard/style.css`

**Interfaces:**
- Consumes: 서버의 `mem:*` 소켓 이벤트 (mem:info/list/search/add/update/remove/doc — 변경 없음), socket.io가 자체 서빙하는 `/socket.io/socket.io.js`
- Produces: Task 4의 정적 서빙 테스트가 `GET /`(index.html)와 `GET /style.css`를 검증

이 태스크는 정적 파일 작성이므로 자동 테스트가 없다 — 서빙 검증은 Task 4의 통합 테스트, 동작 검증은 Task 5의 수동 확인.

- [ ] **Step 1: index.html 작성**

`memory/dashboard/index.html`:

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nunchi memory</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>nunchi memory</h1>
    <span id="info">접속 중…</span>
  </header>
  <section id="toolbar">
    <input id="q" placeholder="검색 — 쉼표로 다중 쿼리 (예: 배포, deploy)">
    <select id="filter-section">
      <option value="">전체 섹션</option>
      <option value="punish">punish</option>
      <option value="forgive">forgive</option>
      <option value="env">env</option>
    </select>
    <button id="btn-search">검색</button>
    <button id="btn-refresh">전체 목록</button>
    <button id="btn-doc">문서 뷰</button>
    <button id="btn-add">+ 추가</button>
  </section>
  <form id="editor" hidden>
    <input type="hidden" id="f-id">
    <select id="f-section">
      <option value="punish">punish</option>
      <option value="forgive">forgive</option>
      <option value="env">env</option>
    </select>
    <input id="f-area" placeholder="area — 예: [배포: CI]" required>
    <input id="f-rule" placeholder="rule" required>
    <input id="f-evidence" placeholder="evidence" required>
    <input id="f-confidence" type="number" min="1" max="9" value="1" title="confidence">
    <button type="submit">저장</button>
    <button type="button" id="f-cancel">취소</button>
  </form>
  <pre id="doc" hidden></pre>
  <table>
    <thead>
      <tr>
        <th>#</th><th>section</th><th>area</th><th>rule</th>
        <th>evidence</th><th>conf</th><th>updated</th><th>동작</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    // 서버(memory/server.ts)의 mem:* 이벤트를 same-origin Socket.IO로 직접 호출한다
    // — 별도 REST 레이어 없음. 응답 형식은 { ok, ...payload } (server.ts의 handle 참조).
    let rowCache = []; // 마지막 렌더 목록 — 수정 버튼이 폼을 채울 때 사용
    const $ = (id) => document.getElementById(id);
    const socket = io({ auth: { token: localStorage.getItem("nunchi-token") ?? "" } });

    // 토큰 불일치 → 입력받아 저장 후 재접속
    socket.on("connect_error", (e) => {
      if (!String(e.message).includes("unauthorized")) return;
      const t = prompt("접속 토큰 (memory-config.json의 token)");
      if (t) { localStorage.setItem("nunchi-token", t); location.reload(); }
    });

    window.addEventListener("unhandledrejection", (e) =>
      alert(e.reason?.message ?? e.reason));

    async function req(ev, payload) {
      const r = payload === undefined
        ? await socket.timeout(5000).emitWithAck(ev)
        : await socket.timeout(5000).emitWithAck(ev, payload);
      if (!r.ok) throw new Error(r.error);
      return r;
    }

    const esc = (s) => String(s).replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    function render(rows) {
      rowCache = rows;
      $("rows").innerHTML = rows.map((e) => `
        <tr>
          <td>${e.id}</td>
          <td class="sec-${esc(e.section)}">${esc(e.section)}</td>
          <td>${esc(e.area)}</td>
          <td>${esc(e.rule)}</td>
          <td>${esc(e.evidence)}</td>
          <td>${e.confidence}</td>
          <td>${esc(e.updated_at)}</td>
          <td class="actions">
            <button data-act="edit" data-id="${e.id}">수정</button>
            <button data-act="confirm" data-id="${e.id}">confirm</button>
            <button data-act="remove" data-id="${e.id}">삭제</button>
          </td>
        </tr>`).join("");
    }

    async function refresh() {
      const section = $("filter-section").value || undefined;
      render((await req("mem:list", { section })).rows);
    }

    async function search() {
      const queries = $("q").value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!queries.length) return refresh();
      const section = $("filter-section").value || undefined;
      render((await req("mem:search", { queries, section })).rows);
    }

    $("rows").addEventListener("click", async (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const id = Number(b.dataset.id);
      if (b.dataset.act === "remove") {
        if (confirm(`#${id} 삭제할까요?`)) { await req("mem:remove", { id }); await refresh(); }
      } else if (b.dataset.act === "confirm") {
        await req("mem:update", { id, confirm: true });
        await refresh();
      } else if (b.dataset.act === "edit") {
        openEditor(rowCache.find((r) => r.id === id));
      }
    });

    function openEditor(e) {
      $("editor").hidden = false;
      $("f-id").value = e?.id ?? "";
      $("f-section").value = e?.section ?? "punish";
      $("f-area").value = e?.area ?? "";
      $("f-rule").value = e?.rule ?? "";
      $("f-evidence").value = e?.evidence ?? "";
      $("f-confidence").value = e?.confidence ?? 1;
      $("f-area").focus();
    }

    $("editor").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fields = {
        section: $("f-section").value,
        area: $("f-area").value,
        rule: $("f-rule").value,
        evidence: $("f-evidence").value,
        confidence: Number($("f-confidence").value),
      };
      const id = $("f-id").value;
      if (id) await req("mem:update", { id: Number(id), ...fields });
      else await req("mem:add", fields);
      $("editor").hidden = true;
      await refresh();
    });

    $("f-cancel").onclick = () => ($("editor").hidden = true);
    $("btn-add").onclick = () => openEditor(null);
    $("btn-search").onclick = search;
    $("btn-refresh").onclick = () => { $("q").value = ""; refresh(); };
    $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
    $("btn-doc").onclick = async () => {
      const el = $("doc");
      if (!el.hidden) { el.hidden = true; return; }
      el.textContent = (await req("mem:doc")).doc ?? "(비어 있음)";
      el.hidden = false;
    };

    socket.on("connect", async () => {
      const info = await req("mem:info");
      $("info").textContent = `${info.projectDir} · port ${info.port}`;
      await refresh();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: style.css 작성**

`memory/dashboard/style.css`:

```css
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  max-width: 1100px;
  padding: 16px;
  font: 14px/1.5 system-ui, sans-serif;
}
header { display: flex; align-items: baseline; gap: 12px; }
h1 { font-size: 20px; margin: 0 0 8px; }
#info { opacity: 0.6; font-size: 12px; }
#toolbar, #editor { display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
#q { flex: 1; min-width: 200px; }
input, select, button { padding: 4px 8px; font: inherit; }
#f-area, #f-rule, #f-evidence { flex: 1; min-width: 140px; }
#f-confidence { width: 60px; }
#doc {
  padding: 12px;
  border: 1px solid #8884;
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-x: auto;
}
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid #8884;
  vertical-align: top;
}
th { font-size: 12px; opacity: 0.7; }
td.actions { white-space: nowrap; }
td button { font-size: 12px; padding: 2px 6px; }
.sec-punish { color: #c0392b; }
.sec-forgive { color: #27ae60; }
.sec-env { color: #2980b9; }
```

- [ ] **Step 3: 커밋**

```bash
git add memory/dashboard/index.html memory/dashboard/style.css
git commit -m "feat: memory 대시보드 프런트엔드 — 목록·검색·CRUD·문서 뷰

빌드 없는 정적 HTML/CSS. same-origin Socket.IO로 mem:* 직접 호출.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 정적 서빙 — `web: true`일 때 기존 httpServer에서 대시보드 서빙

**Files:**
- Modify: `memory/server.ts:14` (node:path import에 `extname`, `resolve`, `sep` 추가)
- Modify: `memory/server.ts` (`const io = new Server(httpServer);` **직전**에 request 핸들러 삽입)
- Test: `tests/web.test.ts` (통합 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `memoryConfig.web`, Task 3의 `memory/dashboard/` 파일
- Produces: `GET /` → index.html(200, text/html), `GET /style.css` → 200 text/css, 경로 탈출·미존재 → 404. `/socket.io/*`는 socket.io가 처리(불간섭)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/web.test.ts`에 추가:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun test tests/web.test.ts`
Expected: FAIL — request 핸들러가 없어 `fetch`가 응답을 못 받고 타임아웃 또는 소켓 종료 에러

- [ ] **Step 3: 구현**

`memory/server.ts` 14행의 import를 교체:

```ts
import { basename, extname, join, resolve, sep } from "node:path";
```

`const io = new Server(httpServer);` **직전**(httpServer error 핸들러 다음)에 삽입:

```ts
  // web: true — 이 포트의 HTTP GET에서 대시보드(memory/dashboard)를 정적 서빙.
  // io 생성 전에 등록해야 engine.io가 이 리스너를 캡처해 /socket.io 외 경로에만 위임한다
  if (memoryConfig.web) {
    const dashDir = join(import.meta.dir, "dashboard");
    const MIME: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };
    httpServer.on("request", (req, res) => {
      if (req.url?.startsWith("/socket.io/")) return; // 등록 순서가 바뀌어도 io 응답과 충돌하지 않도록
      let file = "";
      try {
        const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
        file = resolve(dashDir, "." + (pathname === "/" ? "/index.html" : pathname));
      } catch {
        /* 잘못된 URL·인코딩 → 아래 404 */
      }
      // 경로 탈출 방지: 정규화 결과가 dashboard 루트 밖이면 거부 (host 공개 시 필수)
      if (!file.startsWith(dashDir + sep) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bun test tests/web.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run: `bun test`
Expected: 전체 PASS — `web: false`(기본)면 핸들러 자체가 등록되지 않아 기존 동작 동일

- [ ] **Step 6: 커밋**

```bash
git add memory/server.ts tests/web.test.ts
git commit -m "feat: web:true 시 기존 포트에서 대시보드 정적 서빙

경로 탈출 방지 포함. web:false(기본)면 핸들러 미등록 — 기존 동작 불변.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 문서화 + 수동 검증

**Files:**
- Modify: `README.md:161-162` (memory-config 키 설명 갱신)

**Interfaces:**
- Consumes: Task 1-4 전체
- Produces: 없음 (최종 검증)

- [ ] **Step 1: README 갱신**

`README.md` 161행의 설정 불릿에서 `host`(바인딩 주소, 기본 `127.0.0.1`) 부분을 갱신하고 `web`/`token`을 추가 — 해당 불릿을 다음으로 교체:

```markdown
- **설정**: `{path}/memory-config.json` (서버 전용 — 플러그인 config와 별개). `db`(파일명, 기본 `memory.db`), `port`(기본 41720), `host`(불리언 — `false`=루프백, `true`=`0.0.0.0` 외부 공개, 기본 `false`. 구버전 문자열 값은 자동 정규화), `web`(불리언 — `true`면 같은 포트에서 웹 대시보드 서빙, 기본 `false`), `token`(설정 시 모든 소켓 접속에 핸드셰이크 토큰 요구, 기본 `null`), `model`(키워드 보강 모델, 기본 `null`), `modelProvider`(보강 CLI 공급자 `"claude"`/`"codex"`/`"gemini"`, 기본 `"claude"`). 플러그인 config의 `port`가 설정돼 있으면 그쪽이 우선.
```

162행 외부 서버 불릿의 마지막 문장 `외부에 서비스하는 쪽은 memory-config.json의 host를 0.0.0.0 등으로 바꿔 바인딩을 연다 — 인증이 없으므로 신뢰할 수 있는 네트워크에서만 열 것.`을 다음으로 교체:

```markdown
외부에 서비스하는 쪽은 memory-config.json의 `host`를 `true`로 바꿔 바인딩을 연다 — `token`을 함께 설정해 인증을 걸 것 (접속하는 쪽도 로컬 memory-config.json에 같은 `token`을 넣으면 자동 전달된다). token 없이 열면 신뢰할 수 있는 네트워크에서만.
```

- [ ] **Step 2: 대시보드 수동 검증**

터미널에서 포그라운드로 서버를 띄운다 (백그라운드 detached 금지 — orphan이 DB를 잠근다):

```powershell
$env:CLAUDE_PROJECT_DIR = "C:\Users\Potion\Desktop\Claude\workspace\Nunchi"; bun memory\server.ts
```

사전에 이 프로젝트의 `.claude/nunchi/memory-config.json`에 `"web": true`를 설정해 둔다.
브라우저에서 `http://127.0.0.1:<포트>/` 열고 확인:

1. 목록이 뜬다 (헤더에 projectDir · port 표시)
2. `+ 추가`로 항목 생성 → 목록에 나타남
3. `수정`으로 rule 변경 → 반영
4. `confirm` → confidence 증가
5. 검색창에 키워드 입력 → 필터링
6. `문서 뷰` → 렌더된 보정 문서 표시
7. `삭제` → 확인 후 제거

검증 후 서버 Ctrl+C로 종료, 임시로 바꾼 `web` 설정은 원복 여부를 사용자에게 확인.

- [ ] **Step 3: 전체 테스트 최종 확인**

Run: `bun test`
Expected: 전체 PASS

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: README memory-config 설명 갱신 — host 불리언, web/token 키

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
