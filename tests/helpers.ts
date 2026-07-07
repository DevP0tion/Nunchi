// 테스트 공용: 서버 shutdown 직후 프로젝트 폴더 삭제.
// 스폰 경쟁의 낙오 프로세스가 shutdown 후 빈 포트를 차지해 DB를 다시 열 수 있다
// (프로덕션에선 무해 — 서버가 하나 떠 있을 뿐. 폴더를 즉시 지우는 테스트만 충돌).
// EBUSY면 낙오 서버를 종료시키고 재시도한다.
import { rmSync } from "node:fs";
import { connectMemory } from "../memory/client.ts";

export async function rmProject(dir: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i >= 20) throw e;
      try {
        const m = await connectMemory(dir, { noSpawn: true, force: true });
        await m.shutdown();
      } catch {
        /* 서버 없음 — 핸들 해제 지연일 뿐, 잠시 후 재시도 */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
