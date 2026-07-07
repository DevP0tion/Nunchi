import type { Provider } from "./provider.ts";

// stdout에는 진행 로그가 섞이므로 --output-last-message 파일로 최종 메시지만 회수.
// "-"는 프롬프트를 stdin에서 읽으라는 지시자.
export const codex: Provider = {
  argv: (model, outFile) => [
    "codex", "exec", "--skip-git-repo-check",
    "--model", model, "--output-last-message", outFile, "-",
  ],
  output: "file",
};
