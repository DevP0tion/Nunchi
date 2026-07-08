# nunchi — memory server 조건부 웹 대시보드 설계

- 날짜: 2026-07-08
- 상태: 사용자 승인됨 (구현 전)
- 대상 브랜치: dev

## 목표

memory server(`memory/server.ts`)에 설정으로 켜고 끄는 웹 대시보드를 붙인다.
브라우저에서 보정 DB(메모리 항목)를 조회·검색·편집(전체 CRUD)할 수 있어야 한다.

## 결정 사항 (브레인스토밍 합의)

| 쟁점 | 결정 |
|---|---|
| 용도 | 웹 UI 대시보드 (전체 CRUD + 문서 뷰) |
| 서빙 위치 | 기존 Socket.IO `httpServer`에 얹음 — 새 HTTP 서버·프로세스·포트 없음 (B안) |
| 포트·바인딩 | 기존 `port`/`host`와 공용 |
| 활성 조건 | `memory-config.json`의 플랫 키 `web: boolean` (기본 `false`) |
| `host` 타입 | `string` → `boolean` 전환. `false` = 루프백, `true` = `0.0.0.0` |
| 인증 | `token: string \| null` 1개. 설정 시 Socket.IO 핸드셰이크에서 검사 |
| API | 별도 API 레이어 없음 — 브라우저가 same-origin Socket.IO로 기존 `mem:*` 이벤트 직접 호출 |
| 대시보드 위치 | `memory/dashboard/` 정적 파일 (`index.html` + `style.css`) |
| 프런트엔드 | 빌드 없음, 프레임워크 없음, 바닐라 JS |

## 1. 설정 — memory-config.json

플랫 키 3개 추가·변경:

```json
{
  "version": 1,
  "db": "memory.db",
  "port": 41720,
  "host": false,
  "web": false,
  "token": null,
  "model": null,
  "modelProvider": "claude"
}
```

- `web: boolean` — `true`면 대시보드 정적 서빙 활성. 기본 `false` (기존 동작 그대로)
- `host: boolean` — `false` = `127.0.0.1`, `true` = `0.0.0.0`. 소켓·웹 공용
- `token: string | null` — 설정 시 모든 Socket.IO 접속에 토큰 요구. `null`이면 무인증(기존 동작)

### 기존 `host: string` 호환

이미 배포된 config에는 `"host": "127.0.0.1"` 같은 문자열이 있다. `loadMemoryConfig`에서 정규화:

- 문자열이면: 루프백(`"127.0.0.1"`, `"localhost"`, `"::1"`)은 `false`, 그 외(`"0.0.0.0"` 등)는 `true`
- 불리언이면 그대로

바인딩 주소 결정은 `host ? "0.0.0.0" : "127.0.0.1"`.

## 2. 정적 서빙 — server.ts

`web: true`일 때만 기존 `httpServer`에 request 핸들러 등록:

- `GET /` → `memory/dashboard/index.html`
- 그 외 경로 → `memory/dashboard/` 내 파일 매핑 (css/js 추가 시 코드 수정 불필요)
- 경로는 `import.meta.dir` 기준 해석 — 서버가 플러그인 캐시 등 어디서 실행되든 소스 옆의 dashboard를 찾음
- **경로 탈출 방지 검사 필수** — `host: true` 외부 공개가 가능하므로 정규화 후 dashboard 루트 밖 접근은 404
- `/socket.io/*` 경로는 Socket.IO가 자체 처리 (client JS 서빙 포함) — 건드리지 않음
- `web: false`면 request 핸들러 미등록 — 기존과 완전히 동일한 동작

## 3. 인증 — 토큰 1개

`token`이 설정된 경우 Socket.IO 미들웨어(`io.use`)에서 `socket.handshake.auth.token` 검사:

- 불일치 시 접속 거부
- **브라우저**: 대시보드 페이지에서 한 번 입력받아 `auth: { token }`으로 접속. localStorage에 보관해 재입력 생략
- **MCP 클라이언트(client.ts)**: 이미 memory-config.json을 읽는 경로가 있으므로 토큰을 읽어 자동 전달 — 사용자 설정 변경 불필요
- 정적 파일 서빙 자체는 토큰 미검사 — HTML은 공개돼도 데이터 접근(소켓)이 막히면 충분

트레이드오프(합의됨): 토큰은 대시보드뿐 아니라 소켓 전체에 적용된다. 구버전
external-address 클라이언트는 토큰 설정 시 접속 불가. 기본값 `null`이므로 기존 사용자 영향 없음.

## 4. 대시보드 — memory/dashboard/

- `index.html` — 마크업 + 바닐라 JS (인라인 script)
- `style.css` — 스타일 분리
- Socket.IO 클라이언트는 same-origin `/socket.io/socket.io.js` 로드

기능:

- 목록 (`mem:list`) — section·confidence 필터
- 검색 (`mem:search`) — 다중 쿼리
- 추가 (`mem:add`) / 수정 (`mem:update`) / 삭제 (`mem:remove`) / confirm (`mem:update` confirm)
- 보정 문서 뷰 (`mem:doc`)
- 서버 정보 표시 (`mem:info` — projectDir·dbPath·port)

`mem:shutdown`은 UI에 노출하지 않는다 (사고 방지 — 소켓으로는 여전히 호출 가능, 기존과 동일).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `memory/server.ts` | config 기본값·정규화(`web`/`token`/`host`), 정적 서빙 핸들러, `io.use` 토큰 미들웨어 |
| `memory/client.ts` | config에서 token 읽어 `auth`로 전달 |
| `memory/dashboard/index.html` | 신규 — 대시보드 본체 |
| `memory/dashboard/style.css` | 신규 — 스타일 |

## 6. 테스트

기존 `tests/` 패턴을 따라 최소 검증:

- `host` 정규화: 문자열 루프백 → `false`, `"0.0.0.0"` → `true`, 불리언 통과
- `web: true`일 때 `GET /`가 HTML 반환, 경로 탈출(`/../server.ts` 등)은 404
- `token` 설정 시: 토큰 없는 접속 거부, 올바른 토큰 접속 허용, client.ts 자동 전달
- `web: false`(기본)일 때 기존 소켓 동작 회귀 없음

## 범위 밖

- HTTPS/TLS — 필요 시 리버스 프록시로 해결 (서버 코드에 미도입)
- 사용자 계정·권한 분리 — 토큰 1개로 충분
- 프런트엔드 빌드 체인·프레임워크
