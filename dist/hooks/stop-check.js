#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};
var __require = import.meta.require;

// hooks/config.ts
import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
async function readStdinJson() {
  try {
    const raw = await Bun.stdin.text();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function hookProjectDir() {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  if (!dir)
    process.exit(0);
  return dir;
}
function readJson(p) {
  try {
    if (existsSync(p))
      return JSON.parse(readFileSync(p, "utf8").trim());
  } catch {}
  return {};
}
function envConfig() {
  const cfg = {};
  const autoStart = process.env.CLAUDE_PLUGIN_OPTION_AUTO_START;
  if (autoStart !== undefined)
    cfg["auto-start"] = autoStart !== "false";
  const path = process.env.CLAUDE_PLUGIN_OPTION_PATH;
  if (path)
    cfg.path = path;
  const port = parseInt(process.env.CLAUDE_PLUGIN_OPTION_PORT ?? "", 10);
  if (Number.isFinite(port))
    cfg.port = port;
  const external = process.env.CLAUDE_PLUGIN_OPTION_EXTERNAL_ADDRESS;
  if (external)
    cfg["external-address"] = external;
  const priority = normalizePriority(process.env.CLAUDE_PLUGIN_OPTION_POLICY_PRIORITY);
  if (priority)
    cfg["policy-priority"] = priority;
  return cfg;
}
function loadConfig(projectDir) {
  const projectCfg = readJson(join(projectDir, ".claude", "nunchi.json"));
  const merged = { ...DEFAULTS, ...envConfig(), ...projectCfg };
  return {
    "auto-start": merged["auto-start"] !== false,
    path: typeof merged.path === "string" && merged.path.trim() ? merged.path.trim() : DEFAULTS.path,
    port: Number.isFinite(merged.port) ? merged.port : null,
    "external-address": typeof merged["external-address"] === "string" && merged["external-address"].trim() ? merged["external-address"].trim() : null,
    "policy-priority": normalizePriority(merged["policy-priority"])
  };
}
function normalizePriority(v) {
  if (v === "nunchi" || v === "ponytail")
    return v;
  if (v === "calibration")
    return "nunchi";
  return null;
}
function isPonytailEnabled(projectDir) {
  let enabled = false;
  for (const p of [
    join(homedir(), ".claude", "settings.json"),
    join(projectDir, ".claude", "settings.json"),
    join(projectDir, ".claude", "settings.local.json")
  ]) {
    const plugins = readJson(p).enabledPlugins;
    for (const [key, value] of Object.entries(plugins ?? {})) {
      if (key.startsWith("ponytail@") && typeof value === "boolean")
        enabled = value;
    }
  }
  return enabled;
}
function resolveDocDir(projectDir, cfg) {
  return isAbsolute(cfg.path) ? cfg.path : join(projectDir, cfg.path);
}
function resolveDocPath(projectDir, cfg) {
  return join(resolveDocDir(projectDir, cfg), DOC_FILENAME);
}
function formatMemoryEntries(rows) {
  return rows.map((r) => `- (#${r.id}) [${SECTION_LABEL[r.section] ?? r.section}\xB7\uC2E0\uB8B0\uB3C4${r.confidence}] ${r.area}: ${r.rule} (\uADFC\uAC70: ${r.evidence})`).join(`
`);
}
var BUNDLED = true, PLUGIN_ROOT, DEFAULTS, DOC_FILENAME = "calibration.md", SECTION_LABEL;
var init_config = __esm(() => {
  PLUGIN_ROOT = fileURLToPath(new URL(BUNDLED ? "../../" : "../", import.meta.url));
  DEFAULTS = {
    "auto-start": true,
    path: ".claude/nunchi",
    port: null,
    "external-address": null,
    "policy-priority": null
  };
  SECTION_LABEL = {
    punish: "\uBC8C\uC8FC\uB294 \uAC83",
    forgive: "\uC6A9\uC11C\uD558\uB294 \uAC83",
    env: "\uD658\uACBD \uD2B9\uC774\uC0AC\uD56D",
    task: "\uC791\uC5C5 \uAE30\uB85D"
  };
});

// hooks/stop-check.ts
init_config();
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync as readFileSync2, readSync, rmSync, statSync, writeFileSync } from "fs";
import { join as join2 } from "path";
import { tmpdir } from "os";
hookProjectDir();
var CHECK_EVERY = Math.max(2, parseInt(process.env.NUNCHI_CHECK_EVERY || "10", 10) || 10);
var STATE_TTL_MS = 7 * 86400000;
var input = await readStdinJson();
var sessionId = String(input.session_id || "unknown").replace(/[^\w-]/g, "");
var stateDir = join2(tmpdir(), "nunchi");
var statePath = join2(stateDir, `${sessionId}.json`);
var state = { count: 0, offset: 0 };
try {
  state = { ...state, ...JSON.parse(readFileSync2(statePath, "utf8")) };
} catch {}
var save = () => {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch {}
};
if (input.stop_hook_active) {
  try {
    state.offset = statSync(String(input.transcript_path)).size;
    save();
  } catch {}
  process.exit(0);
}
state.count += 1;
var block = false;
if (state.count >= CHECK_EVERY) {
  let recorded = false;
  try {
    const fd = openSync(String(input.transcript_path), "r");
    try {
      const size = fstatSync(fd).size;
      const from = size < state.offset ? 0 : state.offset;
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      recorded = /"name":"[^"]*nunchi_(?:record|update)"/.test(buf.toString("utf8"));
      state.offset = size;
    } finally {
      closeSync(fd);
    }
  } catch {}
  block = !recorded;
  state.count = 0;
  try {
    for (const f of readdirSync(stateDir)) {
      const p = join2(stateDir, f);
      if (Date.now() - statSync(p).mtimeMs > STATE_TTL_MS)
        rmSync(p, { force: true });
    }
  } catch {}
}
save();
if (block) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `[nunchi] \uC8FC\uAE30 \uC810\uAC80(${CHECK_EVERY}\uD134): ` + `(A) \uC774\uBC88 \uAD6C\uAC04\uC5D0 \uC608\uCE21\uACFC \uC2E4\uC81C\uAC00 \uC5B4\uAE0B\uB09C \uACBD\uC6B0\uAC00 \uC788\uC5C8\uB294\uAC00? (1) \uACFC\uC789 \uB300\uC751 (2) \uACFC\uC18C \uB300\uC751 (3) \uD658\uACBD \uD2B9\uC774\uC0AC\uD56D \u2014 ` + `\uC788\uC5C8\uB2E4\uBA74 nunchi_record(\uC2E0\uADDC) \uB610\uB294 nunchi_update(action: confirm \uC7AC\uD655\uC778 / reverse \uBC18\uC804). ` + `(B) \uC774\uBC88 \uAD6C\uAC04\uC5D0 \uC644\uACB0\uB41C \uC791\uC5C5(\uC0B0\uCD9C\uBB3C\uC774 \uB0A8\uB294 \uC694\uCCAD \uB2E8\uC704)\uC774 \uC788\uB294\uAC00? \u2014 ` + `\uC788\uB2E4\uBA74 \uC720\uC0AC task \uD56D\uBAA9\uC744 \uAC80\uC0C9\uD574 nunchi_update(edit \uC808\uCC28 \uAD50\uC815 / confirm \uC7AC\uD655\uC778), \uC5C6\uC73C\uBA74 nunchi_record(section: task)\uB85C \uAE30\uB85D. ` + `(C) \uD655\uC2E0\uC740 \uC5C6\uC9C0\uB9CC \uACFC\uC789/\uACFC\uC18C\uAC00 \uC758\uC2EC\uB41C \uC21C\uAC04\uC774 \uC788\uC5C8\uB294\uAC00? \u2014 ` + `\uC788\uB2E4\uBA74 nunchi_record(section: observe)\uB85C \uAD00\uCC30\uB9CC \uB0A8\uAE38 \uAC83 (\uC790\uB3D9 \uD68C\uC218 \uC81C\uC678 \u2014 \uBD80\uB2F4 \uC5C6\uC74C, \uBC18\uBCF5\uB418\uBA74 promote\uB85C \uC2B9\uACA9). ` + `\uC14B \uB2E4 \uC5C6\uC5C8\uB2E4\uBA74 "\uBCF4\uC815\xB7\uC791\uC5C5 \uD2B9\uC774\uC0AC\uD56D \uC5C6\uC74C" \uD55C \uC904\uB9CC \uB2F5\uD558\uACE0 \uC885\uB8CC\uD560 \uAC83.`
  }));
}
process.exit(0);
