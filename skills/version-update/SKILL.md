---
name: version-update
description: nunchi 플러그인 저장소 자체의 버전 업데이트(유지보수자 전용)에만 사용 - 이 저장소(Nunchi)에서 dev의 변경을 새 버전으로 main·codex-support에 배포할 때, nunchi의 버전 범프 위치나 브랜치 동기화 순서가 헷갈릴 때, 사용자가 "nunchi 버전 업데이트", "nunchi 릴리스", "플러그인 버전 올려"를 언급할 때. 다른 프로젝트의 릴리스·배포에는 사용하지 않는다.
---

# nunchi version-update — 플러그인 버전 업데이트·브랜치 동기화

dev → main → codex-support 순서로 동기화하고 로컬 플러그인 캐시를 갱신한다. 버전은 **main 이후 dev 전체 델타**로 결정한다(semver: feat 포함이면 minor, 픽스만이면 patch).

## 버전 표기 위치 (반드시 함께 정렬)

| 파일 | 브랜치 |
|---|---|
| `.claude-plugin/plugin.json` `version` | dev·main |
| `mcp/server.ts` `new McpServer({ ... version })` | dev·main·codex-support |
| `.codex-plugin/plugin.json` `version` | codex-support 전용 |

한글이 든 파일이므로 수정은 Edit 도구로만 한다 (PowerShell Get/Set-Content 왕복은 CP949 파손).

## 절차

1. **테스트** — dev에서 `bun test` 전체 통과 확인.
2. **dev 마무리** — 작업 커밋 후, 버전 범프 chore 커밋(`chore: vX.Y.Z — 요약 (MCP version 정렬)`)을 만들고 푸시.
3. **main 머지** — `git checkout main && git merge dev --no-commit`. main에 없어야 할 경로를 제외하고 커밋:
   ```
   git rm -r tests docs/superpowers   # dev로 돌아가면 자동 복원됨
   git commit -m "Merge dev into main — vX.Y.Z (요약)"
   ```
   푸시. main 푸시가 분류기에 간헐적으로 차단됨 — 막히면 사용자 승인을 받는다.
4. **codex-support 머지** — `git checkout codex-support && git merge main`. codex-support에는 `.claude-plugin`이 없어 modify/delete 충돌이 난다 — `git rm -r .claude-plugin`으로 삭제를 유지하고 머지 커밋. 이어서 `.codex-plugin/plugin.json` 버전 chore 커밋 후 푸시.
5. **codex 머지 검증** — `git diff main codex-support`가 codex 고유 3파일뿐인지 확인: `.claude-plugin/plugin.json`(삭제), `.codex-plugin/plugin.json`, README Codex 섹션. 그 외가 나오면 머지가 어긋난 것.
6. **플러그인 갱신** — `claude plugin marketplace update devp0tion` 후 `claude plugin update nunchi@devp0tion`. plain `nunchi`는 not found.
7. **구버전 서버 종료** — 갱신 후에도 구버전 캐시 경로의 memory server가 살아 있다. `mem:shutdown` 소켓 이벤트로 정상 종료(DB 닫힘, 포트 41720 닫힘 확인). 같은 세션에서 nunchi MCP 도구를 다시 쓰면 구버전 서버가 재스폰되므로 사용 후 재종료한다.

## 문제 해결

- **plugin update가 구버전을 유지**: marketplace update를 건너뛴 것 — 6번을 순서대로 다시.
- **codex-support 머지 후 diff에 tests/ 등장**: 3번에서 제외 누락 — main에서 `git rm` 후 재머지.
- **포트 41720이 계속 열려 있음**: 구버전 서버 생존 — `Get-CimInstance Win32_Process`로 `memory[/\\]server\.ts` 프로세스 확인 후 종료.
