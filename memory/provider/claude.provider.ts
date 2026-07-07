import type { Provider } from "./provider.ts";

export const claude: Provider = {
  argv: (model) => ["claude", "-p", "--model", model],
  output: "stdout",
};
