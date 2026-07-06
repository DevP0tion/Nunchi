# nunchi (눈치)

> 작업 강도 캘리브레이션("적당히") passive skill for Claude Code

"적당히"는 고정 규칙이 아니라 **환경별로 학습되는 다이얼**이다. 어떤 프로젝트는 테스트 생략을 벌주고, 어떤 프로젝트는 과잉 검증이 시간 낭비다. nunchi는 예측과 실제가 어긋난 순간(**surprise**)만 프로젝트별 `calibration.md`에 축적하고, 매 세션 시작 시 자동 주입해서 검증 깊이 · 테스트 범위 · 리서치 강도 · 리팩토링 범위를 결정하는 기준으로 재귀 개선한다.

## 왜 만들었나

Claude Code는 세션이 끝나면 "이 프로젝트에서 뭐가 통하고 뭐가 사고 나는지"를 잊는다. nunchi는 그 경험 중 **신호만** 남긴다:

- **과잉이었음** — 했는데 불필요했던 검증/방어/추상화 → "용서하는 것"
- **과소였음** — 생략했다가 실제로 문제가 된 것 → "벌주는 것"
- **환경 특이사항** — 문서/상식과 다른 이 환경 고유의 동작 → "환경 특이사항"

예측대로 흘러간 평범한 작업, 일회성 실수는 기록하지 않는다. 노이즈가 아니라 신호를 쌓는다.

축적되는 문서 예시:

```markdown
# Calibration — my-project

## 벌주는 것 (반드시 한다)

### [배포: CI 캐시]
- 규칙: lockfile 변경 시 CI 캐시 키를 반드시 확인한다
- 근거: 2026-06-12 캐시 미스매치로 배포 2회 실패
- 신뢰도: 높음(3)

## 용서하는 것 (생략 가능)

### [테스트: 내부 스크립트]
- 규칙: scripts/ 하위 일회성 스크립트는 테스트 생략 가능
- 근거: 2026-06-20 테스트 작성이 스크립트 본체보다 오래 걸렸음
- 신뢰도: 중간(2)
```

## 동작

1. **SessionStart** (startup/resume/clear/compact): calibration 문서가 있으면 전문을, 없으면 부트스트랩 안내를 additionalContext로 조용히 주입. `auto-start: true`면 memory server도 자동 기동.
2. **세션 중** (모델 재량): surprise 발견 시 SKILL.md 규약대로 1-3줄 기록.
3. **Stop hook** (백업): 10턴마다 1회 "이번 구간 surprise 있었나?" 점검을 강제. 구간 내에 문서가 이미 갱신됐으면 자동 생략.
4. **`/nunchi`**: 수동 호출 시 문서 정제(pruning) 모드.

## 구조

```
nunchi/
├── SKILL.md                  # 방법론 (기록·신뢰도·반전·정제 규약)
├── memory/
│   ├── server.ts             # memory server: sqlite(rag db) 단일 소유 + Socket.IO 노출
│   ├── client.ts             # MCP용 Socket.IO 클라이언트 (서버 미기동 시 자동 스폰)
│   └── search.test.ts        # FTS5 검색 테스트
├── .claude-plugin/
│   └── plugin.json           # plugin 매니페스트 + userConfig 선언 (전역 설정)
└── hooks/
    ├── hooks.json
    ├── config.ts             # 계층형 config 로더 + 공용 타입
    ├── session-start.ts      # 매 세션: calibration 문서 컨텍스트 주입
    └── stop-check.ts         # N턴마다: surprise 점검 강제 (백업 루프)
```

## 요구사항

- **Bun** 이 PATH에 있어야 한다 (hooks가 `bun <script>.ts` 로 실행됨). 확인: `bun --version`
- hooks는 의존성 없이 동작한다. **memory server(server.ts/client.ts)** 사용 시에만 `bun install` 필요 (socket.io).

## 설치

**정식 설치 (필수)** — hooks가 `${CLAUDE_PLUGIN_ROOT}`를 사용하므로 반드시 plugin 시스템으로 설치해야 한다. `.claude/skills/` 폴더에 복사하는 방식은 SKILL.md만 로드되고 **hooks(SessionStart 주입, Stop 점검, server auto-start)가 전혀 동작하지 않는다.**

Claude Code 안에서:

```
/plugin marketplace add DevP0tion/DevP0tion
/plugin install nunchi@devp0tion
```

hooks는 자동 등록되며 **다음 세션 시작부터** 동작한다 (설치한 현재 세션에는 미적용).

**개발/테스트용**: 설치 없이 실행하려면

```sh
claude --plugin-dir /path/to/nunchi
```

(hooks 파일 변경 시에는 dev 모드에서도 `/reload-plugins` 필요)

확인: `claude plugin list` 에 `nunchi` 표시. 새 세션 시작 시 컨텍스트에 `[nunchi]` 주입 메시지가 보이면 정상.

## 설정 (config)

우선순위: **프로젝트 `.claude/nunchi.json` > plugin userConfig(환경 변수) > 내장 기본값** (키 단위 병합).

전역 설정은 `.claude-plugin/plugin.json`의 `userConfig`로 선언되어 있고, Claude Code plugin 설정 UI에서 값을 지정하면 hook 실행 시 `CLAUDE_PLUGIN_OPTION_<KEY_대문자>` 환경 변수로 주입된다. config 변경은 plugin 재로드 없이 다음 hook 실행부터 반영된다. 손상된 JSON은 무시되고 다음 계층으로 폴백.

| userConfig 키 | 환경 변수 | nunchi.json 키 | 기본값 | 설명 |
|---|---|---|---|---|
| `auto_start` | `CLAUDE_PLUGIN_OPTION_AUTO_START` | `auto-start` | `true` | `true`면 SessionStart 시 memory server 자동 시작 |
| `path` | `CLAUDE_PLUGIN_OPTION_PATH` | `path` | `.claude/nunchi` | calibration.md가 저장될 폴더 (프로젝트 루트 기준 상대 또는 절대). 초기화 시 없으면 생성 |
| `port` | `CLAUDE_PLUGIN_OPTION_PORT` | `port` | `null` | memory server(Socket.IO) 포트. 미설정 시 memory-config.json의 port(기본 41720) 사용 |
| `model` | `CLAUDE_PLUGIN_OPTION_MODEL` | `model` | `null` | 설정 시(예: `haiku`) `set`마다 `claude -p`로 검색 키워드를 비동기 생성. 미설정 시 비활성. 서버 기동 시 1회 로드되므로 변경은 memory server 재시작 후 반영 |

프로젝트별 예시 — `{프로젝트}/.claude/nunchi.json`:

```json
{
  "auto-start": false,
  "path": "docs"
}
```

## Memory server

sqlite(`memory.db`)는 server.ts 단일 프로세스만 소유하고, MCP 서버들은 `client.ts`의 `connectMemory()`로 Socket.IO 접속해서 사용한다 — MCP가 여럿 떠도 sqlite 동시 접근 문제가 없다.

- **단일 실행**: 포트 바인딩이 락. 중복 실행하면 `EADDRINUSE` 감지 후 즉시 종료(exit 0).
- **자동 연결**: `connectMemory()`는 `auto-start`와 무관하게 포트에 실행 중인 서버가 있으면 그대로 연결한다. 서버가 없으면 `auto-start: true`일 때만 스폰 후 재접속 (동시 스폰 경쟁은 포트 락이 정리), `false`면 에러.
- **설정**: `{path}/memory-config.json` (서버 전용 — 플러그인 config와 별개). `db`(파일명, 기본 `memory.db`), `port`(기본 41720). 플러그인 config의 `port`가 설정돼 있으면 그쪽이 우선.
- **API**: `set(key, value)` / `get(key)` / `search(query, limit)` / `shutdown()`
- **검색**: FTS5(trigram, BM25 랭킹). 3글자 미만 질의는 LIKE 폴백. 구버전 db는 기동 시 자동 마이그레이션·백필.
- **키워드 보강**: 플러그인 config에 `model`을 설정하면 `set`마다 `claude -p --model <값>`을 백그라운드로 돌려 유의어 키워드를 생성, 검색 대상에 포함한다. 값이 갱신되면 낡은 키워드는 자동 폐기. 미설정 시 완전 비활성.

## 튜닝

- 점검 주기: 환경변수 `NUNCHI_CHECK_EVERY` (기본 10, 최소 2)
- 문서 상한: SKILL.md 정제 규칙의 120줄 기준을 직접 수정
- 주입 상한: `session-start.ts` 의 `MAX_CHARS` (기본 9000자)

## 제거

```
/plugin uninstall nunchi@devp0tion
```

## 라이선스

[MIT](LICENSE)
