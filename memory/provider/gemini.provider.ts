import type { Provider } from "./provider.ts";

// stdin이 파이프면 비대화형(headless)으로 동작하고 응답을 stdout으로 출력한다
export const gemini: Provider = {
  argv: (model) => ["gemini", "-m", model],
  output: "stdout",
};
