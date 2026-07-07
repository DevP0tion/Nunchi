---
name: migrate
description: nunchi 보정 DB 마이그레이션이 필요할 때 사용 - 플러그인 업데이트 후 보정 엔트리가 안 보일 때, 구버전 데이터(0.7.x calibration.md, 0.8.x calibration 테이블)를 최신 스키마(memory 테이블)로 이전할 때, memory.db가 잠겨 있거나 구버전 서버가 떠 있어 마이그레이션이 적용되지 않을 때, 사용자가 "마이그레이션", "migrate", "DB 이전", "스키마 업그레이드"를 언급할 때.
---

# nunchi migrate — 보정 DB 마이그레이션

마이그레이션 자체는 memory server 기동 시 자동 실행된다. 이 스킬의 일은 **구버전 서버를 내리고 새 코드로 재기동한 뒤, 이전 결과를 검증**하는 것이다. 코드를 직접 고치거나 SQL을 손으로 실행하지 않는다.

## 자동 이전 내용 (서버 기동 시 1회, 멱등)

| 출발점 | 이전 |
|---|---|
| 0.7.x `calibration.md` | DB로 임포트, 원본은 `.imported`로 리네임 보존 |
| 0.8.x `calibration` 테이블 | `memory` 테이블로 id 보존 이관 후 제거 |
| 0.8.x 구 KV `memory` 테이블(key/value) | 제거 (플러그인 내 소비자 없음) |

최신 스키마: `memory(id, section, area, rule, evidence, confidence, keywords, updated_at)` + `memory_fts`(FTS5 trigram).

## 절차

1. **이전 전 상태 기록** — 가능하면 `nunchi_list`로 현재 엔트리 수·id를 확보한다. 서버가 응답하지 않으면 DB 파일을 직접 읽어 `SELECT count(*) FROM calibration`(구) 또는 `FROM memory`(신)로 확인한다.
2. **구버전 서버 종료** — 서버 프로세스가 살아 있는 한 구버전 코드가 DB를 계속 소유한다. Windows에서 확인·종료:
   ```powershell
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'memory[/\\]server\.ts' }
   Stop-Process -Id <PID> -Force
   ```
3. **재기동** — `nunchi_list`를 호출하면 auto-start가 새 코드로 서버를 스폰하며 이전이 실행된다.
4. **검증** — `nunchi_list` 결과를 1번 기록과 대조한다: 엔트리 수 일치, id 보존. 하나라도 어긋나면 사용자에게 보고하고 진행을 멈춘다.

## 문제 해결

- **이전 후 0건인데 원래 데이터가 있었다**: 구버전 서버가 살아 있었던 것. 2번부터 다시.
- **memory.db 삭제·접근 불가(잠김)**: orphan 서버가 핸들을 쥔 것 — 2번의 프로세스 종료 후 재시도.
- **되돌리기가 필요할 수 있는 대량 DB**: 2번 이후 `memory.db`를 복사해 백업하고 진행한다.
