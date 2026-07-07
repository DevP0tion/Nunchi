// modelProvider(memory-config.json) 값 → 구현 레지스트리. 새 공급자는 파일 추가 후 여기 등록.
import type { Provider } from "./provider.ts";
import { claude } from "./claude.provider.ts";
import { codex } from "./codex.provider.ts";
import { gemini } from "./gemini.provider.ts";

export type { Provider } from "./provider.ts";

export const DEFAULT_PROVIDER = "claude";

export const PROVIDERS: Record<string, Provider> = { claude, codex, gemini };
