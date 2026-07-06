# Calibration — Nunchi

## 벌주는 것 (반드시 한다)
<!-- 생략했다가 실제로 문제가 발생한 것들 -->

## 용서하는 것 (생략 가능)
<!-- 해봤더니 불필요했던 검증/방어/절차들 -->

## 환경 특이사항
<!-- 이 환경 고유의 동작, 함정, 제약 -->

### [plugin: Windows에서 Bun.spawn unref 자식은 부모 종료 시 사망]
- 규칙: 단명 프로세스(훅·CLI)에서 백그라운드 프로세스를 띄울 땐 Bun.spawn(...).unref()가 아니라 node:child_process spawn(..., { detached: true, stdio: "ignore" }).unref()를 쓴다 — Bun.spawn에는 detached 옵션이 없고 unref()는 이벤트 루프 분리만 한다
- 근거: 2026-07-06 SessionStart auto-start 미작동을 독립 재현으로 확정(Claude Code 무관, Bun 1.3.10 단독 재현), detached 전환 후 회귀 테스트로 생존 검증
- 신뢰도: 낮음(1)
