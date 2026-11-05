# 주제·작업공간 + 대시보드 WorkSpace 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기억을 주제로 묶고, 세션별로 주제를 설정해 주제 기억을 우선 주입하며, 작업공간 밖 수정을 경고하고, 대시보드 WorkSpace 탭에서 주제와 작업 중 에이전트를 관리한다.

**Architecture:** 주제·소속·세션은 events 저널 밖의 SQLite 테이블(`memory/topics.ts`)에 둔다. memory server가 변경마다 세션별 상태 파일(`<보정 DB 폴더>/sessions/<sid>.json`)을 다시 쓰고, 도구 호출마다 실행되는 훅은 소켓 없이 이 파일만 읽는다. 세션 id는 훅만 알기 때문에, SessionStart가 컨텍스트에 주입하고 MCP 도구는 `session_id` 파라미터로 받는다.

**Tech Stack:** Bun(bun:sqlite, bun test), Socket.IO 4.8.3, @modelcontextprotocol/sdk, zod, 정적 HTML/CSS/JS 대시보드. 새 의존성은 없다.

**Spec:** `docs/superpowers/specs/2026-11-05-workspace-tab-design.md` (실행자는 이 문서와 함께 읽는다)

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 커밋 메시지: 타입 접두사(`feat:`/`fix:`/`docs:`/`test:`/`chore:`)만 영문이고 제목과 본문은 한글이다. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 테스트는 `bun test tests/<file>.test.ts`로 실행한다. 서버를 스폰하는 테스트는 `assignFreePort(dir)`로 포트를 먼저 배정하고, 정리는 `rmProject(dir)`로 한다(`rmSync` 직접 사용 금지).
- 훅은 서버 미기동·타임아웃·파싱 실패 때 조용히 통과한다(exit 0, 출력 없음 또는 기존 출력만).
- `additionalContext`는 지금처럼 `.slice(0, 8000)`으로 자른다.
- `events` 테이블은 append-only다. 주제 기능은 events에 행을 쓰지 않는다.
- `memory/session-state.ts`와 `hooks/topic.ts`는 `bun:sqlite`·`socket.io`를 import하지 않는다(dist 번들 오염 방지, `memory/memory-config.ts`와 같은 이유).
- 지름길에는 `shortcut: <한계>, <업그레이드 시점>` 형식의 주석을 단다.
- 대시보드 색과 간격은 `style.css`의 `:root` 토큰만 쓴다. UI 문구는 한국어이고, 탭 이름만 `Memory`와 `WorkSpace`다.
- 세션 만료 시간은 24시간, 주제 핵심 영역 기준은 주제 신뢰도 3 이상·최대 30개, 주제 목록 주입은 최대 20개, 훅의 `ws:*` 호출 타임아웃은 1500ms다.

## Review Focus

1. **세션이 쓰고 있는 주제를 대시보드에서 삭제** → 그 세션은 "주제 없음"으로 바뀌고, 상태 파일의 topic이 null이 되며, 다음 도구 호출에서 "주제가 해제됨" 안내를 받아야 한다. (Task 3 테스트)
2. **작업공간 경로 표기 차이**: 끝 슬래시 유무, `\`와 `/`, 상대·절대 경로, Windows 대소문자, 접두어만 같은 폴더(`memory/dash` vs `memory/dashboard2`). 같은 폴더는 안으로, 이름만 비슷한 폴더는 밖으로 판정해야 한다. (Task 2 테스트)
3. **주제 이름 중복이나 빈 이름으로 생성** → 서버가 오류 응답(`ok: false`)을 돌려주고, 대시보드는 그 메시지를 보여 준다. 서버가 죽거나 행이 생기면 안 된다. (Task 1·3 테스트)
4. **구버전 서버(`ws:*` 핸들러 없음)나 서버 미기동 상태에서 훅 실행** → 1.5초 안에 조용히 통과하고, 기존 주입(코어·검색)은 그대로 나와야 한다. (Task 5 테스트)
5. **상태 파일이 깨졌거나 쓰는 도중에 읽힘** → 훅은 무시하고 통과한다. 서버는 임시 파일에 쓴 뒤 rename하는 원자적 쓰기를 한다. (Task 2·6 테스트)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `memory/topics.ts` (신규) | 주제·폴더·소속·세션 테이블 스키마와 `createTopicStore(db)` |
| `memory/store.ts` (수정) | `remove` 시 소속 정리, `search`의 `onlyIds`/`excludeIds`, `list`의 `ids` |
| `memory/session-state.ts` (신규) | 상태 파일·delivered 파일 경로, 원자적 쓰기·읽기·삭제 (sqlite·socket 없음) |
| `hooks/topic.ts` (신규) | 주제 블록·코어 블록·세션 id 줄·주제 목록 렌더링, `inWorkspace` 경로 판정 |
| `memory/server.ts` (수정) | `ws:*` 이벤트, `syncSessionStates`, `mem:*` 확장 필드, `ws:changed` broadcast |
| `memory/client.ts` (수정) | `ws:*` 클라이언트 메서드(1500ms), `search` `topicId`, `list` `ids`, `sessionId` 필드 |
| `mcp/server.ts` (수정) | `nunchi_topic` 신설, 기존 도구에 `session_id`·`ids` 필드 |
| `hooks/session-start.ts`, `user-prompt-submit.ts`, `subagent-start.ts` (수정) | 세션 등록, id 주입, 주제 블록, 코어 축소, 주제 우선 쿼터 |
| `hooks/pre-tool-use.ts`, `post-tool-use.ts`, `session-end.ts` (신규) | 작업공간 경고, 진행 중 턴 전달, 세션 종료 |
| `hooks/hooks.json`, `build.ts`, `hooks/config.ts` (수정) | 훅 등록, 번들 진입점, `HookInput` 필드 |
| `skills/topic/SKILL.md` (신규) | `/nunchi:topic` |
| `memory/dashboard/index.html`, `style.css` (수정) | Memory·WorkSpace 탭, 보드, 미리보기 패널, 상세 화면 |
| `SKILL.md`, `README.md`, `.gitignore` (수정) | 문서, `.superpowers/` 무시 |

---

### Task 1: 주제 저장소 (topics.ts) + store 확장

**Files:**
- Create: `memory/topics.ts`
- Modify: `memory/store.ts` (`createMemoryStore` 안: 스키마 적용 호출, `remove`, `search`, `list`)
- Test: `tests/topics.test.ts`

**Interfaces:**
- Produces (`memory/topics.ts`):
  ```ts
  export const SESSION_TTL_HOURS = 24;
  export const TOPIC_AREA_MIN = 3;
  export const TOPIC_AREA_MAX = 30;
  export interface Topic { id: number; name: string; description: string; folders: string[]; created_at: string; updated_at: string }
  export interface TopicSummary extends Topic { memberCount: number }
  export interface TopicMember extends MemoryEntry { topic_confidence: number }
  export interface SessionRow { session_id: string; title: string | null; first_prompt: string; cwd: string | null; topic_id: number | null; topic_rev: number; last_seen: string }
  export interface TopicArea { id: number; area: string }
  export function applyTopicSchema(db: Database): void;            // CREATE TABLE IF NOT EXISTS ×4 (spec 4.2 DDL)
  export function sessionLabel(s: SessionRow): string;             // title ?? `${first_prompt.slice(0,30)} · ${session_id.slice(0,4)}`
  export function createTopicStore(db: Database): {
    create(t: { name: string; description?: string; folders?: string[] }): number;   // 이름 trim, 빈 이름·중복 이름은 throw
    update(id: number, f: { name?: string; description?: string; folders?: string[] }): boolean; // folders는 전체 교체
    remove(id: number): string[];        // 소속·폴더 삭제, 해당 세션 topic_id=NULL. 영향받은 session_id 반환. 기억은 그대로
    get(id: number): Topic | null;
    byName(name: string): Topic | null;
    list(): TopicSummary[];              // 이름순
    link(topicId: number, memoryIds: number[]): number;    // 초기 topic_confidence = memory.confidence, 이미 소속이면 건너뜀, 없는 주제·기억은 throw. 추가 건수 반환
    unlink(topicId: number, memoryIds: number[]): number;
    rate(topicId: number, memoryId: number, delta: 1 | -1): number | null; // 하한 1, 소속 아니면 null
    members(topicId: number): TopicMember[];   // topic_confidence DESC, updated_at DESC
    memberIds(topicId: number): number[];
    areas(topicId: number): TopicArea[];       // topic_confidence >= 3, observe 제외, isCore 제외, 최대 30
    topicsOf(memoryId: number): number[];
    registerSession(p: { sessionId: string; title?: string | null; cwd?: string | null; prompt?: string }): void; // upsert, last_seen=now, title은 값이 오면 갱신, first_prompt는 비어 있을 때만
    endSession(sessionId: string): void;
    setSessionTopic(sessionId: string, topicId: number | null): void; // 행 없으면 생성, 없는 topicId는 throw
    bumpRev(sessionId: string): number;
    session(sessionId: string): SessionRow | null;
    sessions(): SessionRow[];             // last_seen DESC
    expireSessions(now?: Date): string[]; // last_seen < now-24h 삭제, 삭제된 id 반환
    confirmInTopic(sessionId: string, memoryId: number): boolean; // 세션 주제의 소속이면 rate +1
  };
  ```
- Produces (`memory/store.ts`): `createMemoryStore`가 `applyTopicSchema(db)`를 호출한다. `remove(id)`는 같은 트랜잭션에서 `DELETE FROM topic_members WHERE memory_id = ?`를 실행한다. `search` opts에 `onlyIds?: number[]`, `excludeIds?: number[]`를 추가한다(다른 필터와 같은 단계에서 적용). `list` opts에 `ids?: number[]`를 추가한다(지정 시 그 id만, observe 포함).
- 이유: `rebuildDerived`는 `remove` 이벤트를 replay할 때 `db.run(DELETE FROM memory …)`만 실행한다. 소속 정리는 라이브 `remove`가 이미 했으므로 replay는 이 테이블들을 건드리지 않는다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/topics.test.ts` (`new Database(":memory:")` + `createMemoryStore` 먼저, 그다음 `createTopicStore` 같은 db)
  - `create: 빈 이름·중복 이름 throw` — `create({name:"  "})`와 같은 이름 두 번째 생성이 각각 throw.
  - `link: 초기 주제 신뢰도 = 전체 신뢰도, 중복 무시` — confidence 3 기억을 link하면 `members(t)[0].topic_confidence === 3`. 두 번 link하면 반환값 0.
  - `rate: 하한 1` — 신뢰도 1에서 `rate(t,m,-1)`을 해도 1이고, `+1`이면 2. 소속이 아니면 null.
  - `areas: 3+·observe 제외·코어 제외·30개 상한` — punish 신뢰도 3(코어)은 제외, env 주제 신뢰도 3은 포함, observe는 제외, 35건 시드 시 30건.
  - `remove(기억): 소속 행 정리` — `memStore.remove(m)` 후 `memberIds(t)`에 m이 없음.
  - `replay 후 소속·주제 신뢰도 보존` — link하고 rate +1 → `rebuildDerived(db)` → `members(t)` 동일(id, topic_confidence).
  - `remove(주제): 기억 보존·세션 해제` — 반환값에 세션 id 포함, `session(sid).topic_id === null`, `memStore.get(m)`은 그대로.
  - `registerSession: first_prompt는 처음 값 유지, title은 갱신` / `sessionLabel 폴백` — title이 없으면 `"첫 프롬프트… · abcd"` 형식.
  - `expireSessions: 24시간 초과만 삭제` — `last_seen`을 25시간 전으로 UPDATE하고 `expireSessions()` 반환값에 포함, 23시간 전은 남음.
  - `confirmInTopic: 소속만 +1` — 세션 주제 소속 기억은 true이고 +1, 비소속은 false.
  - `store.search onlyIds/excludeIds, list ids` — 같은 쿼리에서 `onlyIds:[a]`이면 a만, `excludeIds:[a]`이면 a 제외, `list({ids:[b]})`이면 b만.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/topics.test.ts` / Expected: FAIL (`Cannot find module '../memory/topics.ts'`)

- [ ] **Step 3: `memory/topics.ts` 구현과 `memory/store.ts` 수정** — DDL은 spec 4.2 그대로(FK 없음). `folders`는 `topic_folders`에서 입력 순서대로 읽는다(rowid 순). 시각은 기존과 같은 `strftime('%Y-%m-%d %H:%M:%f','now')`. `areas`의 코어 제외는 `isCore()`를 쓴다.

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/topics.test.ts tests/store.test.ts tests/events.test.ts tests/search.test.ts` / Expected: 전부 PASS

- [ ] **Step 5: 커밋** — `git add memory/topics.ts memory/store.ts tests/topics.test.ts` → `feat(memory): 주제·작업공간·세션 저장소와 소속 정리`

---

### Task 2: 상태 파일 모듈 + 훅 공용 렌더링

**Files:**
- Create: `memory/session-state.ts`, `hooks/topic.ts`
- Test: `tests/topic-format.test.ts`

**Interfaces:**
- Produces (`memory/session-state.ts`):
  ```ts
  export interface TopicState { id: number; name: string; description: string; folders: string[]; areas: { id: number; area: string }[] }
  export interface SessionStateFile { rev: number; topic: TopicState | null }
  export function sessionsDir(docDir: string): string;                       // join(docDir, "sessions")
  export function writeSessionState(docDir: string, sid: string, s: SessionStateFile): void; // tmp 파일 → renameSync
  export function readSessionState(docDir: string, sid: string): SessionStateFile | null;   // 없음·파싱 실패 → null
  export function readDelivered(docDir: string, sid: string, agentId?: string | null): number; // 없음 → 0
  export function writeDelivered(docDir: string, sid: string, agentId: string | null | undefined, rev: number): void;
  export function removeSessionFiles(docDir: string, sid: string): void;     // <sid>.json, <sid>.delivered, <sid>.*.delivered
  ```
  파일명: `<sid>.json`, `<sid>.delivered`, `<sid>.<agentId>.delivered`. sid와 agentId는 `[A-Za-z0-9_-]`만 허용하고, 그 외 문자가 있으면 쓰지 않고 무시한다(경로 탈출 방지).
- Produces (`hooks/topic.ts`):
  ```ts
  export function sessionIdLine(sid: string): string;
  // "[nunchi] 이 세션 id: <sid> — nunchi_topic·nunchi_record·nunchi_update·nunchi_search 호출 시 session_id로 넘긴다"
  export function formatTopicList(topics: { name: string; description: string }[]): string; // 최대 20개 "- 이름 — 설명" + 규약 1줄(spec 4.6)
  export function formatTopicBlock(t: TopicState, changed?: boolean): string; // spec 4.6 형식. changed면 첫 줄 앞에 "[nunchi] 주제가 변경됨 (대시보드·명령)" 줄
  export const TOPIC_CLEARED = "[nunchi] 현재 주제 없음 — 이전에 주입된 주제 블록은 무효";
  export function formatCoreBlock(core: MemoryEntryLite[], memberIds: number[] | null): string;
  // memberIds null → "[확정 규칙 — '벌주는 것'·'권장(방법)' 신뢰도 높음(3+). 항상 지킨다]\n" + formatMemoryEntries(core)
  // 배열 → 소속 코어: 같은 제목 + 전문 / 비소속 코어: "[확정 규칙 — 주제 밖, 전문은 nunchi_list(ids)로 조회. 항상 지킨다]\n- #id · area" 줄
  // 빈 쪽 블록은 생략, core가 비면 ""
  export function inWorkspace(projectDir: string, folders: string[], filePath: string): boolean;
  // folders 비면 true. 각 폴더를 projectDir 기준 resolve, 구분자를 "/"로, win32면 소문자로 바꾼 뒤
  // file === folder 또는 file.startsWith(folder + "/") 이면 안
  ```

- [ ] **Step 1: 실패 테스트 작성** — `tests/topic-format.test.ts`
  - `inWorkspace: 상대·절대·끝 슬래시·역슬래시` — projectDir `C:/p`(win32 아니면 `/p`), folders `["memory/dashboard/"]`이면 `memory/dashboard/index.html`은 true, `memory/dashboard2/x`는 false, `memory/dash`는 false. 절대 경로 폴더, `memory\\dashboard` 표기도 같은 결과. 폴더가 없으면 항상 true.
  - `inWorkspace: win32 대소문자` — `process.platform === "win32"`일 때만 `MEMORY/Dashboard/a.ts`가 true(아니면 test.skipIf).
  - `formatTopicBlock: 형식` — 이름, 설명, 폴더, `#41 접근성 대비` 줄, `nunchi_list(ids)` 포함. `changed`면 "주제가 변경됨" 포함.
  - `formatCoreBlock: 소속은 전문, 비소속은 #id · area` — 코어 2건 중 하나만 소속일 때 소속 rule 텍스트는 포함, 비소속 rule 텍스트는 미포함·`#<id> · <area>` 포함. `memberIds=null`이면 두 rule 모두 포함.
  - `상태 파일: 원자적 쓰기·깨진 파일 null·delivered 에이전트별` — write 후 read 동일, 파일에 `"{"`를 쓰면 null, `writeDelivered(d,s,null,3)`과 `writeDelivered(d,s,"a1",5)`가 각각 3·5로 읽힘, `removeSessionFiles` 후 셋 다 없음.
  - `sid 경로 탈출 거부` — `writeSessionState(d, "../x", …)` 후 `d/../x.json` 미생성.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/topic-format.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 두 모듈 구현** — `formatCoreBlock`은 `hooks/config.ts`의 `formatMemoryEntries`를 재사용한다.

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/topic-format.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `feat(hooks): 주제 블록 렌더링·작업공간 판정·세션 상태 파일`

---

### Task 3: memory server `ws:*` + 상태 동기화 + client

**Files:**
- Modify: `memory/server.ts`, `memory/client.ts`
- Test: `tests/workspace-socket.test.ts`

**Interfaces:**
- Consumes: Task 1 `createTopicStore`, Task 2 `writeSessionState`/`removeSessionFiles`/`TopicState`
- Produces (소켓 이벤트, 모두 기존 `handle()` 응답 규약 `{ ok, ...res }` / `{ ok:false, error }`):

  | 이벤트 | 페이로드 | 응답 |
  |---|---|---|
  | `ws:board` | — | `{ topics: TopicSummary[], sessions: (SessionRow & { label: string })[] }` (조회 전에 만료 처리) |
  | `ws:topic` | `{ id }` | `{ topic: Topic \| null, members: TopicMember[], sessions: (SessionRow & {label})[] }` |
  | `ws:topic:create` | `{ name, description?, folders? }` | `{ id }` |
  | `ws:topic:update` | `{ id, name?, description?, folders? }` | `{ updated }` |
  | `ws:topic:remove` | `{ id }` | `{ removed: boolean }` |
  | `ws:topic:link` / `ws:topic:unlink` | `{ topicId, memoryIds }` | `{ count }` |
  | `ws:topic:rate` | `{ topicId, memoryId, delta }` | `{ confidence: number \| null }` |
  | `ws:session:register` | `{ sessionId, title?, cwd?, prompt? }` | `{}` |
  | `ws:session:end` | `{ sessionId }` | `{}` (행 삭제 + `removeSessionFiles`) |
  | `ws:session:set` | `{ sessionId, topicId: number \| null }` | `SessionStateFile` |
  | `ws:session` | `{ sessionId }` | `SessionStateFile & { memberIds: number[] }` (세션 행 없으면 `{rev:0, topic:null, memberIds:[]}`) |

- 기존 이벤트 확장:
  - `mem:search`의 `topicId`: 주제 소속(`onlyIds`)으로 먼저 `limit`까지 채우고, 남는 자리를 일반 검색(`excludeIds`)으로 채운다. 같은 sections·excludeCore·strict를 적용한다. 소속 결과 행에는 `topic: true`를 붙인다. `sessionId`가 오면 그 세션의 topic_id를 `topicId`로 쓴다(MCP용).
  - `mem:list`의 `ids`.
  - `mem:add`의 `sessionId`: 세션에 주제가 있으면 새 id를 link한다.
  - `mem:update`의 confirm + `sessionId`: `store.confirm` 후 `topics.confirmInTopic`.
- 서버 내부: `syncSessionStates()` — 세션별로 `topic_id`에서 `TopicState`(areas 포함)를 계산해 상태 파일의 topic과 JSON 비교한다. 다르면 `bumpRev` 후 `writeSessionState`. 파일이 없고 topic도 null이면 쓰지 않는다. 호출 시점: 모든 변경성 `ws:*`, `mem:add`·`mem:promote`·`mem:update`·`mem:remove` 성공 후, 서버 기동 직후(만료 처리 포함). 변경성 이벤트 뒤에는 `io.emit("ws:changed")`.
- docDir: `resolveDocDir(projectDir, loadConfig(projectDir))`(initMemory와 같은 폴더).
- `expireSessions()`가 반환한 id마다 `removeSessionFiles`를 호출한다.
- spec 4.4는 `topicId`를 "소속만 검색"으로 적었다. 이 계획은 4.6의 쿼터 규칙(소속으로 먼저 채우고 일반 검색으로 보충)을 서버 한 곳에서 처리하도록 의미를 "소속 우선 채우기"로 확정한다. 훅과 MCP가 같은 경로를 쓴다.
- Produces (`memory/client.ts` `MemoryClient`에 추가, `ws:*`는 `timeout(1500)`):
  ```ts
  topics(): Promise<TopicSummary[]>;                                         // ws:board의 topics
  createTopic(t: { name: string; description?: string; folders?: string[] }): Promise<number>;
  linkTopic(topicId: number, memoryIds: number[]): Promise<number>;
  unlinkTopic(topicId: number, memoryIds: number[]): Promise<number>;
  topicByName(name: string): Promise<Topic | null>;                          // ws:board topics에서 찾음
  registerSession(p: { sessionId: string; title?: string | null; cwd?: string | null; prompt?: string }): Promise<void>;
  endSession(sessionId: string): Promise<void>;
  setSessionTopic(sessionId: string, topicId: number | null): Promise<SessionStateFile>;
  sessionState(sessionId: string): Promise<SessionStateFile & { memberIds: number[] }>;
  ```
  `search` opts에 `topicId?: number; sessionId?: string`(반환 행 `topic?: boolean`), `list` opts에 `ids?: number[]`, `add`·`update`에 `sessionId?: string`를 추가한다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/workspace-socket.test.ts` (`assignFreePort` → `connectMemory`, 대시보드 전용 이벤트는 `socket.io-client`의 `io()` 원시 접속(web.test.ts 패턴))
  - `주제 생성·소속·세션 설정 → 상태 파일 rev 1, areas 포함` — confidence 3 env 기억 link, `setSessionTopic("s1", t)` 결과 `rev === 1`, `readSessionState(docDir,"s1").topic.areas[0].id === m`.
  - `내용이 그대로면 rev 유지, 바뀌면 증가` — 같은 topic으로 다시 set해도 rev 1. 폴더를 update하면 2.
  - `사용 중 주제 삭제 → 세션 해제, 상태 파일 topic null, rev 증가` (Review Focus 1)
  - `중복 이름 생성 → ok:false, 서버 계속 응답` (Review Focus 3) — 원시 소켓 `ws:topic:create` 응답 `ok === false`, 이어서 `ws:board` 정상.
  - `mem:search topicId: 소속 먼저 채우고 일반으로 보충, topic 표시` — 같은 단어를 가진 기억 3건 중 1건만 소속, `limit 2` → 첫 행이 소속(`topic: true`), 둘째는 비소속.
  - `mem:add sessionId → 자동 소속` / `mem:update confirm sessionId → 전체·주제 신뢰도 모두 +1`
  - `mem:remove → 상태 파일 areas에서 제거`
  - `ws:session:end → 행·파일 삭제`
  - `ws:changed broadcast` — 원시 소켓이 `ws:topic:create` 뒤에 `ws:changed`를 받음.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/workspace-socket.test.ts` / Expected: FAIL

- [ ] **Step 3: server·client 구현**

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/workspace-socket.test.ts tests/store-socket.test.ts tests/client.test.ts tests/web.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `feat(memory): 주제·세션 소켓 API와 세션 상태 파일 동기화`

---

### Task 4: MCP `nunchi_topic` + 기존 도구 필드

**Files:**
- Modify: `mcp/server.ts`
- Test: `tests/mcp.test.ts` (기존 하네스에 테스트 추가)

**Interfaces:**
- Consumes: Task 3 client 메서드, Task 2 `formatTopicBlock`·`TOPIC_CLEARED`·`writeDelivered`
- Produces: 도구 `nunchi_topic` inputSchema
  ```ts
  { action: z.enum(["list","set","clear","create","link","unlink"]),
    session_id: z.string().optional(),   // set·clear 필수, link·unlink에서 주제 미지정 시 세션 주제 사용
    name: z.string().max(60).optional(), // set·create·link·unlink의 주제 지정(이름)
    topic_id: z.number().int().optional(),
    description: z.string().max(200).optional(),
    folders: z.array(z.string()).optional(),
    memory_ids: z.array(z.number().int()).optional() }
  ```
  - `list` → `{ topics: [{id, name, description, folders, memberCount}] }`
  - `set` → 텍스트 결과 = `formatTopicBlock(state.topic)`. 그다음 `writeDelivered(docDir, session_id, null, state.rev)`.
  - `clear` → `TOPIC_CLEARED`, delivered 기록.
  - `create` → `{ id }`. description: "사용자가 요청했을 때만 만든다. 삭제·수정은 대시보드에서만 가능".
  - `link`/`unlink` → `{ count }`.
  - 주제를 찾지 못하면 `fail("주제 없음: …")`.
  - 주제 삭제·수정 action은 없다.
- 기존 도구: `nunchi_record`·`nunchi_update`·`nunchi_search`에 `session_id: z.string().optional()`를 추가한다. 설명은 "SessionStart가 주입한 이 세션 id — 주제 자동 소속·주제 신뢰도·주제 우선 검색에 쓰인다". client에는 `sessionId`로 넘긴다. `nunchi_list`에는 `ids: z.array(z.number().int()).optional()`를 추가한다.
- docDir: `resolveDocDir(projectDir, loadConfig(projectDir))`.

- [ ] **Step 1: 실패 테스트 작성** — `tests/mcp.test.ts`에 `"MCP nunchi_topic: create → set 결과에 주제 블록, delivered 기록, list ids 조회"` 추가. create(name "UI", folders ["src/"]) → record(session_id "s1" 없이) 기억 → link → set(session_id "s1", name "UI") 결과 텍스트에 `현재 주제: UI`와 `src/` 포함 → `readDelivered(docDir,"s1") >= 1` → `nunchi_list({ids:[id]})` rows 길이 1 → 없는 이름 set은 `isError`. tools/list에 `nunchi_topic` 포함.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/mcp.test.ts` / Expected: FAIL (`nunchi_topic` 없음)

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/mcp.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `feat(mcp): nunchi_topic 도구와 session_id·ids 필드`

---

### Task 5: 기존 훅 3종 (SessionStart·UserPromptSubmit·SubagentStart)

**Files:**
- Modify: `hooks/config.ts` (`HookInput`에 `session_title?: string; agent_id?: string; agent_type?: string; tool_name?: string; tool_input?: Record<string, unknown>` 추가), `hooks/session-start.ts`, `hooks/user-prompt-submit.ts`, `hooks/subagent-start.ts`
- Test: `tests/hooks.test.ts`

**Interfaces:**
- Consumes: Task 2 렌더러·상태 파일 함수, Task 3 client
- 동작(spec 4.6을 다음처럼 확정):
  - **session-start**: stdin을 읽는다(현재는 읽지 않음). `session_id`가 있으면 `registerSession({sessionId, title: session_title, cwd})`, `sessionState`, `topics()`를 조회한다. 기존 규약 줄 뒤에 `sessionIdLine`과 `formatTopicList`를 넣는다. source `fork`이면 `TOPIC_CLEARED`를 넣는다. source `resume`·`compact`이고 topic이 있으면 `formatTopicBlock`을 넣고 main delivered를 기록한다. 코어는 `formatCoreBlock(core, topic ? memberIds : null)`로 만든다. `session_id`가 없으면 지금 동작 그대로다.
  - **user-prompt-submit**: 토큰이 없어도 세션 처리는 한다(등록·전달은 검색과 별개). 순서: `registerSession({sessionId, title, prompt: raw 정제본})` → `sessionState` → `rev !== readDelivered(main)`이면 topic이 있을 때 `formatTopicBlock(topic, true)`, 없을 때 `TOPIC_CLEARED`를 블록 맨 앞에 넣고 delivered를 기록한다 → 검색 두 쿼터에 `topicId`(있을 때)를 넘긴다. 결과 행에 `topic: true`이면 렌더링 줄 앞에 `[주제] `를 붙인다.
  - **subagent-start**: stdin을 읽는다. `sessionIdLine`, `sessionState` → topic이 있으면 `formatTopicBlock`을 넣고 `writeDelivered(docDir, sid, agent_id, rev)`를 기록한다. 코어는 같은 축소 규칙을 따른다.
  - 세 훅 모두 `ws:*` 실패는 개별 try로 감싸서, 실패해도 코어·검색 주입은 그대로 나가게 한다(Review Focus 4).

- [ ] **Step 1: 실패 테스트 작성** — `tests/hooks.test.ts`에 추가(`seeded()` 재사용, 주제 조작은 Task 3 client)
  - `session-start: 세션 id 줄·주제 목록 주입, 세션 등록` — `{source:"startup", session_id:"s1", session_title:"탭 설계"}` → ctx에 `이 세션 id: s1`과 주제 이름 포함, `mem.sessionState("s1")` 접근 가능, `ws:board` 세션 label이 "탭 설계".
  - `session-start compact + 주제: 소속 코어 전문, 비소속 코어 #id · area` — 코어 2건 중 1건만 소속시키고 set 후 `{source:"compact"}` → 소속 rule 포함, 비소속 rule 미포함·`#id · area` 포함, 주제 블록 포함.
  - `session-start fork: 주제 없음 줄`
  - `user-prompt-submit: 대시보드 변경 후 첫 메시지에 변경 블록, 두 번째엔 없음` — `setSessionTopic` 후 두 번 실행 → 첫 출력에 "주제가 변경됨", 둘째 출력에는 없음.
  - `user-prompt-submit: 주제 소속 결과가 [주제] 표시로 먼저` — 같은 단어 기억 2건 중 소속 1건 → 출력 첫 항목 줄에 `[주제]`.
  - `subagent-start: 주제 블록 + agent별 delivered` — `{session_id:"s1", agent_id:"a1"}` 실행 후 `readDelivered(docDir,"s1","a1") === rev`, main delivered는 0 그대로.
  - `구버전/미기동 서버에서도 코어 주입 유지 (1.5초 이내)` — 서버 없는 dir에서 user-prompt-submit에 session_id를 주고 실행 → exit 0, 경과 < 3000ms.
- 기존 테스트의 코어 제목 단언(`hooks.test.ts:350,356`)은 그대로 통과해야 한다(주제 없을 때 제목 불변).

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/hooks.test.ts tests/session-start.test.ts` / Expected: 신규 테스트 FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/hooks.test.ts tests/session-start.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `feat(hooks): 세션 등록·주제 블록·코어 축소·주제 우선 쿼터`

---

### Task 6: 신규 훅 3종 + 등록·번들

**Files:**
- Create: `hooks/pre-tool-use.ts`, `hooks/post-tool-use.ts`, `hooks/session-end.ts`
- Modify: `hooks/hooks.json`, `build.ts` (`ENTRIES`에 세 파일 추가)
- Test: `tests/hooks.test.ts`

**Interfaces:**
- Consumes: Task 2 `readSessionState`·`readDelivered`·`writeDelivered`·`inWorkspace`·`formatTopicBlock`·`TOPIC_CLEARED`, Task 3 `endSession`
- 동작:
  - **pre-tool-use** (matcher `Edit|Write|MultiEdit|NotebookEdit`, timeout 5): `file_path`(NotebookEdit는 `notebook_path`)를 읽는다. 상태 파일의 topic 폴더가 있고 `inWorkspace`가 false이면 다음을 출력한다.
    `{hookSpecificOutput:{hookEventName:"PreToolUse", additionalContext:"[nunchi] 경고: <경로>는 현재 주제 '<이름>'의 작업공간 밖이다 (<폴더들>). 의도한 작업이면 사용자에게 알린다."}}`
    `permissionDecision`은 내지 않는다. 주석은 `// shortcut: Bash 경유 수정은 검사하지 않음, 필요해지면 Bash 명령 파싱 추가`. 소켓은 쓰지 않는다.
  - **post-tool-use** (matcher 없음, timeout 5): 상태 파일 rev가 `readDelivered(sid, agent_id)`와 다르면 `formatTopicBlock(topic, true)` 또는 `TOPIC_CLEARED`를 `hookEventName:"PostToolUse"`로 출력하고 delivered를 기록한다. 소켓은 쓰지 않는다.
  - **session-end** (matcher 없음, timeout 기본): `connectMemory(projectDir,{noSpawn:true})` → `endSession(session_id)`. 실패는 무시한다.
  - 공통: `session_id`가 없거나 상태 파일이 없으면 출력 없이 exit 0.

- [ ] **Step 1: 실패 테스트 작성** — `tests/hooks.test.ts`에 추가
  - `pre-tool-use: 작업공간 밖 Edit만 경고, 안·주제 없음은 무출력` — 주제 폴더 `["src/"]`, `tool_input.file_path`가 `<dir>/docs/a.md`이면 출력에 "작업공간 밖", `<dir>/src/a.ts`이면 빈 출력, 세션 주제가 없으면 빈 출력.
  - `post-tool-use: rev 변경 시 1회 전달, 메인·서브에이전트 각각` — set 후 main 실행 → 블록, 다시 실행 → 빈 출력, `agent_id:"a1"` 실행 → 블록.
  - `post-tool-use: 깨진 상태 파일 → 무출력 exit 0` (Review Focus 5)
  - `session-end: 세션 행·파일 삭제` — 실행 후 `ws:board` sessions에 s1 없음, 상태 파일 없음.
  - `build ENTRIES에 신규 훅 포함` — `ENTRIES`에 세 경로가 있고, `hooks.json`의 PreToolUse matcher가 정확히 `Edit|Write|MultiEdit|NotebookEdit`.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/hooks.test.ts` / Expected: 신규 테스트 FAIL

- [ ] **Step 3: 구현**, hooks.json에 PreToolUse·PostToolUse·SessionEnd 항목 추가(command는 `bun "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js"`)

- [ ] **Step 4: 통과 확인** — Run: `bun test tests/hooks.test.ts` / Expected: PASS

- [ ] **Step 5: 커밋** — `feat(hooks): 작업공간 경고·진행 중 주제 전달·세션 종료 훅`

---

### Task 7: 대시보드 탭 + WorkSpace 보드 + 미리보기 패널

**Files:**
- Modify: `memory/dashboard/index.html`, `memory/dashboard/style.css`
- Test: `tests/web.test.ts` (정적 서빙 스모크) + 브라우저 수동 확인

**Interfaces:**
- Consumes: Task 3 `ws:board`, `ws:topic`, `ws:topic:create/update/remove`, `ws:session:set`, `ws:changed`
- 확정 사항:
  - 헤더 아래 `<div role="tablist">`에 버튼 `Memory`(`aria-controls="tab-memory"`)와 `WorkSpace`(`aria-controls="tab-workspace"`)를 둔다. 기존 본문 전체를 `<section id="tab-memory" role="tabpanel">`로 감싼다. 선택 탭은 `localStorage` 키 `nunchi.tab`에 저장하고, 읽기와 쓰기는 try/catch로 감싼다.
  - 보드: 카드 격자(`display:grid`, 좁은 화면 1열). 주제 카드는 이름순이고 "주제 없음" 카드(점선)가 마지막이다. 카드에 `기억 N · 폴더 M`와 세션 칩을 넣는다.
  - 칩: `<button draggable="true">`, 텍스트는 `label`, `title`에 마지막 활동 시각. 드롭하면 `ws:session:set`(주제 없음 카드면 `topicId: null`). Enter 또는 Space를 누르면 주제 선택 `<select>` 팝오버가 열리고 같은 이동을 한다.
  - 카드 클릭(칩 클릭 제외) → 오른쪽 미리보기 패널(`aria-live="polite"`): 이름, 설명, 폴더, 소속 기억 상위 5개(섹션 도트 `sec-*`, `#id area`, 주제 신뢰도), 버튼 `자세히 보기 →`·`편집`·`삭제`.
  - `+ 새 주제`와 `편집`은 같은 `<dialog>` 폼을 쓴다(이름, 설명, 폴더 `<textarea>` 줄 단위). 서버 `ok:false`이면 폼 안에 오류 문구를 표시한다(Review Focus 3).
  - `삭제`는 `confirm("주제 '<이름>'을 삭제할까요? 기억은 지워지지 않습니다.")` 후 실행한다.
  - `ws:changed`를 받으면 보드와 열린 패널을 다시 조회한다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/web.test.ts`에 `"대시보드: Memory·WorkSpace 탭 마크업과 ws:board 사용"` 추가. 서빙된 index.html에 `role="tablist"`, `>Memory<`, `>WorkSpace<`, `ws:board`, `ws:session:set` 문자열이 들어 있는지 확인한다.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/web.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인 + 브라우저 확인** — Run: `bun test tests/web.test.ts` / Expected: PASS. 그다음 임시 프로젝트에서 `memory-config.json`의 `web: true`로 서버를 띄우고, 내장 브라우저로 다음을 확인한다. ① 탭 전환과 새로고침 후 유지 ② 주제 생성·편집·삭제 ③ 칩 드래그 이동과 키보드 이동 ④ 다른 소켓에서 `ws:session:register`를 보내면 보드가 자동 갱신 ⑤ 다크모드와 375px 폭에서 가로 스크롤 없음

- [ ] **Step 5: 커밋** — `feat(dashboard): Memory·WorkSpace 탭과 주제 보드·미리보기 패널`

---

### Task 8: 대시보드 주제 상세 화면

**Files:**
- Modify: `memory/dashboard/index.html`, `memory/dashboard/style.css`
- Test: `tests/web.test.ts` + 브라우저 수동 확인

**Interfaces:**
- Consumes: `ws:topic`, `ws:topic:update`(폴더), `ws:topic:link/unlink/rate`, `mem:search`
- 확정 사항(목업 v2 ②):
  - `자세히 보기 →`를 누르면 WorkSpace 패널 안에서 보드·미리보기를 숨기고 상세를 표시한다. `← 보드`로 복귀한다. 다른 탭에서 돌아오면 마지막 화면을 유지한다(메모리 상태만).
  - 왼쪽 열: 작업공간 폴더 목록(행마다 `✕` 삭제, `+ 폴더 추가` 입력) → `ws:topic:update`의 folders 전체 교체. 아래에 작업 중 에이전트 목록(label, 상대 시각 "N분 전").
  - 오른쪽 열: `소속 기억 N건` 표. 열은 `#`, 섹션(도트+라벨), 영역(굵게)+규칙, 주제 신뢰도(👍👎 = `ws:topic:rate`), 전체 신뢰도, `빼기`(`ws:topic:unlink`). 정렬은 주제 신뢰도 내림차순.
  - `+ 기억 추가`: 검색 입력 → `mem:search`(limit 10) 결과 목록에서 이미 소속된 항목은 비활성 → 클릭하면 `ws:topic:link`.
  - 좁은 화면에서는 두 열을 세로로 쌓는다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/web.test.ts`의 마크업 테스트에 `ws:topic:rate`, `ws:topic:link`, `자세히 보기` 문자열 확인을 추가한다.

- [ ] **Step 2: 실패 확인** — Run: `bun test tests/web.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인 + 브라우저 확인** — PASS, 그리고 ① 폴더 추가·삭제 후 미리보기 반영 ② 👍👎에 따른 주제 신뢰도 변화(전체 신뢰도는 그대로) ③ 기억 추가·빼기 ④ 375px 세로 배치

- [ ] **Step 5: 커밋** — `feat(dashboard): 주제 상세 화면 — 폴더·소속 기억·주제 신뢰도 관리`

---

### Task 9: `/nunchi:topic` 스킬 + 문서 + dist

**Files:**
- Create: `skills/topic/SKILL.md`
- Modify: `SKILL.md`, `README.md`, `.gitignore`, `dist/`(빌드 산출물)
- Test: `tests/dist.test.ts` (기존 — 입력 해시 최신 여부)

**Interfaces:**
- `skills/topic/SKILL.md` frontmatter: `name: topic`, description은 "nunchi 세션 주제를 보거나 바꿀 때 사용 — 사용자가 /nunchi:topic, '주제 바꿔', '주제를 X로' 등을 말할 때". 본문은 spec 4.7(인자 없음 → `nunchi_topic(list)` 후 선택, 인자 있음 → `set`, 이름이 없으면 비슷한 주제 제시 후 생성 여부 확인, `session_id`는 주입된 값 사용)이다.
- `SKILL.md`: spec 4.9 항목(세션 id 전달, 주제 설정 시점, 주제 신뢰도 규칙, 작업공간 경고 의미, 주제가 있을 때의 코어 축소)을 추가한다.
- `README.md`: WorkSpace 탭, `/nunchi:topic`, 신규 훅 3종, 상태 파일 위치(`<path>/sessions/`)를 추가한다.
- `.gitignore`에 `.superpowers/` 한 줄을 추가한다.

- [ ] **Step 1: 문서·스킬 작성**
- [ ] **Step 2: 빌드** — Run: `bun run build` / Expected: `dist/hooks/pre-tool-use.js`, `post-tool-use.js`, `session-end.js` 생성
- [ ] **Step 3: 전체 테스트** — Run: `bun test` / Expected: 전부 PASS (dist.test 포함)
- [ ] **Step 4: 커밋** — `docs: 주제·작업공간 규약과 /nunchi:topic, dist 재빌드`

버전 범프(0.14.0)와 main·codex-support 반영은 이 계획 범위 밖이다. `version-update` 스킬로 따로 진행한다.
