# 주제(topic)·작업공간 + 대시보드 WorkSpace 탭 설계

- 날짜: 2026-11-05
- 기준: v0.13.5 (f7c0716, recommend 개편 완료 상태)
- 대상 버전: 0.14.0 (기능 추가 = minor)

## 1. 의도

기억이 늘수록 "지금 이 작업에 중요한 기억"이 검색 3+2건 쿼터 안에서 밀린다. 사용자는 기억을 **주제**로 묶고, 에이전트가 작업할 때 주제를 정하면 그 주제의 기억이 먼저 떠오르게 하고 싶다. 주제마다 **작업공간**(폴더 경로 여러 개)을 붙여, 에이전트가 어디서 작업하면 되는지 알게 하고 그 밖을 고치면 경고한다. 대시보드에는 주제를 카드로 보고, 작업 중인 에이전트를 끌어다 주제를 바꾸는 탭을 만든다.

## 2. 사용자 결정 사항

- **주제**: 여러 기억을 묶는 단위. 기억 하나는 **여러 주제**에 속할 수 있다.
- **작업공간**: 주제와 1:1. 폴더 경로 여러 개로 구성. 별도 개체가 아니라 주제의 속성이다.
- **주제 설정**: 에이전트가 도구로 설정한다. 사용자는 슬래시 명령(`/nunchi:topic`)·자연어·대시보드 드래그로 바꿀 수 있다.
- **유지 범위**: 세션 단위. 서브에이전트는 부모 세션의 주제를 따른다. 새 세션은 주제 없이 시작한다.
- **주입 방식**: 주제가 설정되면 규칙 전문 대신 **주제 신뢰도 높은 기억의 `#id · area` 목록만** 주입한다. 전문은 에이전트가 필요할 때 id로 조회한다. 매 메시지 검색에서는 주제 소속 기억을 우선한다.
- **주제가 있을 때의 코어**: 주제 소속 코어는 전문, **주제 밖 코어는 `#id · area`만** 주입한다.
- **매 메시지 쿼터**: 기존 보정 3 + 작업 2를 유지하되, **각 쿼터를 주제 소속으로 먼저 채우고** 남는 자리를 일반 검색으로 채운다. 출력은 지금처럼 전문.
- **주제별 신뢰도**: 기억×주제 쌍마다 별도 신뢰도를 둔다(전체 신뢰도와 별개).
- **기억 배정 주체**: 대시보드에서 사용자, 기록할 때 에이전트(설정된 주제에 자동 소속), 에이전트가 도구로 기존 기억도 넣고 뺄 수 있다.
- **작업공간 밖 작업**: 경고한다(차단하지 않음).
- **대시보드 변경 전달**: 다음 메시지뿐 아니라 **진행 중인 턴에도** 전달한다.
- **에이전트 표시**: 세션 이름.
- **대시보드**: 기존 화면은 탭 **"Memory"**, 새 탭은 **"WorkSpace"**. 레이아웃은 목업 A안 + "자세히 보기":
  - 주제 카드 격자. 카드 안에 작업 중인 에이전트 칩. "주제 없음" 카드(점선)에 주제 미설정 세션.
  - 칩을 다른 카드로 드래그 → 그 세션의 주제 변경.
  - 카드 클릭 → 오른쪽 미리보기 패널(설명, 작업공간 폴더, 소속 기억 상위 5개(주제 신뢰도순), 버튼: 자세히 보기·편집·삭제).
  - "자세히 보기" → 탭 영역 전체를 쓰는 상세 화면(← 보드로 복귀). 왼쪽: 작업공간 폴더 추가·삭제, 작업 중인 에이전트와 마지막 활동 시각. 오른쪽: 소속 기억 전체 표(#, 섹션, 영역·규칙, 주제 신뢰도 👍👎, 전체 신뢰도, 빼기) + "기억 추가".
  - 탭 상단 "+ 새 주제".
  - 목업: `.superpowers/brainstorm/837-1793862075/content/topic-board-v2.html`

## 3. 목표 / 비목표 / 실패 기준

- 목표: 위 2절 전부.
- 비목표: 여러 프로젝트를 한 대시보드에서 보기(대시보드는 프로젝트별 memory server에 붙으므로 그 프로젝트의 세션만 보인다). Bash 명령으로 하는 파일 수정의 작업공간 검사. 주제 데이터의 `mem:export` 포함. Memory 탭 목록에 주제 뱃지 표시.
- 실패 기준(동작해도 실패):
  1. `rebuildDerived`(replay)가 주제 소속·주제 신뢰도를 지우거나 바꾼다.
  2. 삭제된 기억의 소속 행이 남아 보드·주입에 유령 id가 나온다.
  3. 매 도구 호출마다 memory server 소켓 왕복이 생긴다(핫 경로는 파일 읽기만).
  4. 서버 미기동·네트워크 실패가 세션을 막거나 지연시킨다(기존 훅처럼 조용히 통과).
  5. 주제 삭제가 기억 자체를 지운다.
  6. 드래그를 못 쓰는 사용자(키보드)가 주제를 바꿀 방법이 없다.

## 4. 결정된 구현 방식

### 4.1 세션 식별 — 고정 제약

- 공식 문서 확인 결과: 훅 입력에는 `session_id`가 있지만, stdio MCP 서버는 세션 id를 받을 문서화된 경로가 없다. 또 MCP 서버 프로세스는 세션보다 오래 살아남는다(/clear·fork로 세션 id가 바뀌어도 그대로). 일반 resume은 같은 session_id를 이어 쓴다고 본다(설계자 판단 — 문서상 별도 id가 나오는 것은 `--fork-session`의 source `fork`뿐). fork 세션은 원래 세션 id를 훅 입력으로 알 수 없으므로 **주제 없이 시작**하고, SessionStart(source `fork`)는 "현재 주제 없음 — 이전 대화의 주제 블록은 무효" 한 줄을 주입한다.
- 따라서 **세션 상태는 전부 `session_id` 키로 memory server에 저장하고, 쓰기는 훅이 한다.** MCP 도구 중 세션이 필요한 것은 `session_id`를 파라미터로 받는다. 에이전트는 SessionStart가 주입한 id를 쓴다(SessionStart는 compact·resume·clear에도 다시 실행되므로 압축 후에도 남는다).
- **MCP 서버 프로세스 안에 세션 id를 캐시하지 않는다.**
- 세션 이름: 훅 입력의 `session_title`(사용자가 `/rename`·`--name`으로 붙인 이름일 때만 들어옴, SessionStart·UserPromptSubmit). 없으면 **첫 프롬프트 앞 30자 + " · " + session_id 앞 4자**로 표시한다(설계자 판단 — 자동 생성 제목은 훅으로 오지 않고, 트랜스크립트 JSONL 형식은 문서상 비공개·변경 가능이라 읽지 않는다).

### 4.2 데이터 모델 (memory/store.ts)

새 테이블 4개. **events 저널 밖**에 둔다.

```
topics(id INTEGER PK, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
       created_at, updated_at)
topic_folders(topic_id INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(topic_id, path))
topic_members(topic_id INTEGER NOT NULL, memory_id INTEGER NOT NULL,
              confidence INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(topic_id, memory_id))
sessions(session_id TEXT PK, title TEXT, first_prompt TEXT NOT NULL DEFAULT '', cwd TEXT,
         topic_id INTEGER, topic_rev INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL)
```

- **저널 밖에 두는 이유**: 저널은 기억 내용과 계보의 canonical 기록이다. 주제는 기억을 묶는 조직 정보이고, 세션은 휘발성 상태다. replay는 `memory`·FTS만 재구축하고 이 4개 테이블은 건드리지 않는다. 기억 id는 replay에서 `entry_id`로 보존되므로 소속 행은 그대로 유효하다.
- **FK·CASCADE를 쓰지 않는다**(기존 스키마에도 없음). replay가 `memory`를 비우고 다시 채울 때 CASCADE가 소속 행을 지우면 실패 기준 1을 어긴다.
- **정리 규칙**: 기억 `remove`(라이브 경로)가 실행되면 같은 트랜잭션에서 `DELETE FROM topic_members WHERE memory_id = ?`. 주제 삭제 시 `topic_folders`·`topic_members` 행 삭제, 그 주제였던 `sessions.topic_id`는 NULL로 바꾸고 `topic_rev` +1. 기억은 지우지 않는다.
- **주제 신뢰도 초깃값**: 소속시킬 때 그 기억의 **전체 신뢰도 값을 복사**한다(설계자 판단 — 1에서 시작하면 이미 검증된 기억이 주입 기준 3에 닿을 때까지 주제 안에서 보이지 않는다). 하한·상한은 전체 신뢰도와 같은 규칙을 따른다.
- **신뢰도 변화 규칙**:
  - 대시보드 WorkSpace 상세의 👍👎 → 주제 신뢰도만 ±1.
  - 대시보드 Memory 탭의 👍👎 → 전체 신뢰도만(기존 동작 그대로).
  - `nunchi_update(confirm)`에 `session_id`가 오고, 그 세션에 주제가 있고, 대상 기억이 그 주제 소속이면 → 전체 +1(기존)과 **주제 신뢰도 +1을 함께**.
  - `reverse`는 주제 신뢰도를 바꾸지 않는다.
- **세션 만료**: `last_seen`이 24시간을 넘은 세션은 서버 기동 시와 보드 조회 시 삭제한다. SessionEnd 훅은 kill이나 크래시 때 실행되지 않으므로(Windows orphan 사례) 만료가 안전망이다.
- **경로 정규화**: `topic_folders.path`는 입력한 그대로 저장한다(절대 경로 또는 프로젝트 루트 기준 상대 경로). 비교할 때 프로젝트 루트로 resolve한 뒤 슬래시를 정규화하고, Windows에서는 대소문자를 무시하는 접두 비교(폴더 경계 포함)를 한다.

### 4.3 세션 상태 파일 — 핫 경로용

- memory server는 세션의 주제·주제 폴더·주제 소속 기억이 바뀔 때마다 `<보정 DB 폴더>/sessions/<session_id>.json`을 다시 쓴다.
  ```json
  { "rev": 7, "topic": { "id": 3, "name": "대시보드 UI", "description": "...",
    "folders": ["memory/dashboard/"], "areas": [{ "id": 41, "area": "접근성 대비" }] } | null }
  ```
  `areas`는 주제 신뢰도 3 이상인 소속 기억이고, 주제 신뢰도 내림차순으로 최대 30개다. observe 섹션은 제외한다(기존 "자동 회수 제외" 규약). 코어 항목도 제외한다 — 코어 블록(4.6)이 이미 전문으로 다루기 때문이다.
- 훅이 이미 쓰는 `resolveDocDir(projectDir, cfg)`가 같은 폴더를 가리킨다. SessionEnd와 만료 시 파일을 삭제한다.
- 전달 확인은 마지막으로 전달한 rev를 **에이전트별로** 적어서 한다. 메인 에이전트는 `<session_id>.delivered`, 서브에이전트는 `<session_id>.<agent_id>.delivered`를 쓴다(훅 입력의 `agent_id`). 서브에이전트가 먼저 받아도 메인 에이전트가 변경을 놓치지 않는다. SubagentStart가 주제 블록을 주입할 때 그 서브에이전트의 delivered도 기록한다. SessionEnd와 만료 시 `<session_id>.*` 파일을 모두 삭제한다.
- 원격 서버(external-address)라서 파일이 없으면, PostToolUse와 PreToolUse 훅은 아무것도 하지 않는다. 다음 UserPromptSubmit이 소켓으로 전달한다.

### 4.4 소켓 API (memory/server.ts, memory/client.ts)

기존 `mem:*` 옆에 `ws:*` 이벤트를 추가한다. 이름은 빌더 재량이지만 다음 기능을 모두 갖춰야 한다.

- 보드 조회: 주제 목록(소속 기억 수, 폴더 수) + 만료 안 된 세션 목록(표시 이름, topic_id, last_seen).
- 주제 상세: 주제 정보, 폴더, 세션, 소속 기억 전체(memory 행과 주제 신뢰도).
- 주제 생성·수정(이름, 설명, 폴더 목록)·삭제.
- 소속 추가·제거, 주제 신뢰도 ±1.
- 세션 등록·갱신(title, first_prompt는 비어 있을 때만, cwd, last_seen)·종료.
- 세션 주제 설정·해제: `topic_rev` +1, 상태 파일 갱신.
- 세션 상태 조회: 현재 주제, rev, areas. UserPromptSubmit 폴백용.
- 변경이 생기면 서버는 모든 소켓에 `ws:changed`를 broadcast한다. 대시보드 WorkSpace 탭은 이를 받아 다시 조회한다. 현재 대시보드는 실시간 갱신이 없으므로 이 탭에만 둔다.
- 기존 `mem:list`에 **`ids` 필터**를 추가한다. 전문 조회는 이걸로 한다.
- 기존 `mem:search`에 선택 `topicId`를 추가한다. 주어지면 그 주제 소속만 검색한다.

### 4.5 MCP 도구 (mcp/server.ts)

- **신규 `nunchi_topic`** 도구 — actions: `list`, `set`, `clear`, `create`, `link`, `unlink`.
  - `set`·`clear`는 `session_id` 필수. `set`의 결과 텍스트가 곧 주입이 된다(4.6의 주입 블록과 같은 형식). 같은 rev를 delivered로 기록해서 훅이 중복 주입하지 않게 한다.
  - `create`는 이름, 설명, 폴더를 받는다. 도구 설명에 "사용자가 요청했을 때만 만든다"를 명시한다.
  - 주제 **삭제와 수정은 대시보드 전용**이다. 에이전트에게 열지 않는다(설계자 판단: 되돌리기 어려운 조작).
  - #13 작업 기록의 "도구 신설 금지"는 기억 항목 조작에 대한 원칙이다. 주제는 기억 항목이 아닌 새 개체여서 기존 도구의 action으로 넣으면 의미가 섞이므로, 예외로 신설한다.
- 기존 도구에 선택 필드를 추가한다(필드 추가로만 확장).
  - `nunchi_record`: `session_id`. 세션에 주제가 있으면 새 기억을 그 주제에 자동 소속시킨다.
  - `nunchi_update(confirm)`: `session_id`. 4.2의 신뢰도 규칙을 따른다.
  - `nunchi_search`: `session_id`. 세션 주제의 소속 결과를 앞에 정렬한다.
  - `nunchi_list`: `ids`. id로 전문을 조회한다.

### 4.6 훅

공통: 모든 서버 접속은 실패하면 조용히 통과한다(실패 기준 4). 매 도구 호출 경로(Pre·PostToolUse)는 소켓을 쓰지 않는다.

- **SessionStart** (`hooks/session-start.ts`): 세션 등록(session_id, session_title, cwd). 그리고 다음 내용을 주입한다.
  - `[nunchi] 이 세션 id: <session_id> — nunchi_topic·nunchi_record·nunchi_update·nunchi_search 호출 시 session_id로 넘긴다`
  - 주제 목록(이름 — 설명, 최대 20개)과 규약 한 줄: "작업을 시작할 때 맞는 주제가 있으면 nunchi_topic(set)으로 설정한다. 사용자가 주제 변경을 요청하면(`/nunchi:topic`, 자연어) 따른다. 작업공간 밖 파일을 고쳐야 하면 사용자에게 알린다."
  - source가 resume·compact이고 세션에 이미 주제가 있으면 주제 블록도 다시 주입한다.
  - **코어 블록**: 세션에 주제가 없으면 지금과 같다(전문). 주제가 있으면 주제 소속 코어는 전문, 주제 밖 코어는 `#id · area` 줄로 출력한다(제목: "[확정 규칙 — 주제 밖, 전문은 nunchi_list(ids)로 조회. 항상 지킨다]"). 새 세션은 주제 없이 시작하므로, 실제로 축소가 일어나는 곳은 resume·compact·SubagentStart다. 세션 도중 주제를 설정해도 이미 들어간 코어 전문은 그대로 둔다.
- **주제 블록 형식** (set 결과·훅 주입 공통):
  ```
  [nunchi] 현재 주제: <이름> — <설명>
  작업공간: <폴더1>, <폴더2> — 이 폴더들 안에서 작업한다
  주제 핵심 영역(주제 신뢰도 3+, 전문은 nunchi_list(ids)로 조회):
  - #41 접근성 대비
  - #57 토큰 우선 CSS
  ```
- **UserPromptSubmit** (`hooks/user-prompt-submit.ts`): 세션 갱신(title, 첫 프롬프트, last_seen). 상태 rev가 delivered와 다르면 주제 블록을 주입하고 delivered를 갱신한다. 검색은 주제가 있으면 기존 두 쿼터를 각각 이렇게 채운다. 보정 3(punish·recommend·env, excludeCore, strict): 먼저 `topicId`로 검색하고, 모자란 만큼 일반 검색(앞 결과 id 제외)으로 채운다. 작업 2(task)도 같은 방식이다. 총 주입량과 전문 출력 형식은 지금과 같다. 주제 소속 결과에는 줄 앞에 `[주제]` 표시를 붙인다(빌더 재량으로 표현 변경 가능).
- **SubagentStart** (`hooks/subagent-start.ts`): 세션 id 줄을 주입한다. 상태 파일에 주제가 있으면 주제 블록을 주입하고, 코어 블록은 SessionStart와 같은 축소 규칙을 따른다(서브에이전트는 부모와 session_id를 공유한다).
- 훅의 `ws:*` 소켓 호출은 짧은 타임아웃(예: 1.5초)을 쓴다. 구버전 서버는 `ws:*`에 응답하지 않으므로 기존 5초 대기를 피하기 위해서다.
- **PreToolUse (신규)** — matcher `Edit|Write|MultiEdit|NotebookEdit`: 상태 파일을 읽어 주제 폴더가 있고 `tool_input.file_path`(NotebookEdit는 `notebook_path`)가 어느 폴더에도 속하지 않으면 additionalContext로 경고한다. 예: "[nunchi] 경고: <경로>는 현재 주제 '<이름>'의 작업공간 밖이다. 의도한 작업이면 사용자에게 알린다." 차단하지 않는다(`permissionDecision`을 내지 않는다). 코드에 `shortcut: Bash 경유 수정은 검사하지 않음, 필요해지면 Bash 명령 파싱 추가` 주석을 남긴다.
- **PostToolUse (신규)** — matcher 전체: 상태 파일의 rev가 delivered와 다르면 주제 블록(변경 안내 문구 포함)을 additionalContext로 주입하고 delivered를 갱신한다. 파일 두 개를 읽고 비교만 한다.
- **SessionEnd (신규)**: 세션 종료 등록(소켓, noSpawn). 서버가 행과 상태 파일을 지운다. timeout은 기본값으로 둔다.
- `hooks/hooks.json`에 위 3개를 등록하고, `build.ts`의 진입점 목록에 추가한다.

### 4.7 슬래시 명령

- `skills/topic/SKILL.md` → `/nunchi:topic [이름]`.
  - 인자가 없으면 `nunchi_topic(list)`를 보여 주고 고르게 한다.
  - 인자가 있으면 `nunchi_topic(set)`을 실행한다(맞는 이름이 없으면 비슷한 주제를 제시하고, 새로 만들지 묻는다).
  - `session_id`는 컨텍스트에 주입된 값을 쓴다.

### 4.8 대시보드 (memory/dashboard/index.html, style.css)

- 헤더 아래에 탭 바를 둔다: **Memory**(기존 화면 전체) | **WorkSpace**. 선택 탭은 `localStorage`에 기억하고 접근 실패는 try/catch로 감싼다. 탭은 `role="tablist"` 마크업을 쓴다.
- WorkSpace 보드·패널·상세는 2절과 목업 v2를 그대로 따른다. 색과 간격은 기존 `:root` 토큰만 쓴다. 다크모드는 토큰 재정의로 자동 적용된다. 섹션 도트는 기존 `sec-*` 클래스를 쓴다.
- 드래그는 HTML5 drag and drop으로 구현한다. **키보드 대안**: 칩은 포커스 가능한 버튼이고, Enter를 누르면 주제 선택 메뉴가 열려 같은 이동을 한다(실패 기준 6).
- "주제 없음" 카드로 드롭하면 주제를 해제한다.
- "+ 새 주제"와 "편집"은 같은 폼(이름, 설명, 폴더 목록 줄 단위)을 쓴다. 삭제는 `confirm()` 후 실행한다.
- 상세의 "기억 추가"는 검색 입력(`mem:search`)과 결과 선택으로 소속시킨다.
- `ws:changed`를 받으면 보드나 열린 상세를 다시 조회한다.

### 4.9 문서

- `SKILL.md`: 주제·작업공간 규약(세션 id 전달, 주제 설정 시점, 주제 신뢰도 규칙, 작업공간 경고의 의미).
- `README.md`: WorkSpace 탭, `/nunchi:topic`, 새 훅 3개.

## 5. 구현 순서 (자식 세션용 권장)

1. store: 테이블, 정리 규칙, 신뢰도 규칙, 만료, replay 비간섭 테스트.
2. 소켓 API, 상태 파일 쓰기, `mem:list ids`·`mem:search topicId`.
3. client와 MCP(`nunchi_topic` 신설, 기존 도구 필드 추가).
4. 훅(SessionStart·UserPromptSubmit·SubagentStart 수정, Pre/PostToolUse·SessionEnd 신설), hooks.json, build.ts.
5. `/nunchi:topic` 스킬.
6. 대시보드 탭과 보드·패널(드래그, 키보드 대안).
7. 대시보드 상세 화면.
8. 문서. `.gitignore`에 `.superpowers/` 추가.

각 단계는 실패 테스트를 먼저 쓰고 커밋한다(기존 tests/ 패턴, 서버 스폰 테스트는 `assignFreePort`와 `rmProject` 사용).

## 6. 빌더 재량

- 소켓 이벤트·함수 이름, 마이그레이션 블록의 감지 표현.
- 오류 문구, 주입 문구의 세부 표현(형식과 정보 항목은 4.6 고정).
- 보드 카드의 정렬(기본: 이름순, "주제 없음"은 마지막).
- 테스트 최소 범위: ① replay 후 소속·주제 신뢰도 보존 ② 기억 remove 시 소속 정리 ③ 주제 삭제 시 기억 보존·세션 해제 ④ confirm+session_id의 이중 증가 ⑤ 상태 파일 rev와 delivered 비교 주입(메인 에이전트와 서브에이전트가 각각 받음) ⑤-2 주제가 있을 때의 코어 축소와 쿼터 채우기 ⑥ 작업공간 경로 판정(상대·절대·Windows 대소문자·폴더 경계) ⑦ 세션 24시간 만료.

## 7. 릴리스 메모

- 0.14.0. `version-update` 스킬 절차를 따른다.
- 새 훅·MCP가 구버전 memory server에 `ws:*`를 보내면 응답이 없다. 훅은 조용히 통과하고, 절차 7번(구버전 서버 종료)으로 해소한다.
