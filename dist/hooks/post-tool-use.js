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
  return rows.map((r) => `- (#${r.id}) [${label(r)}\xB7\uC2E0\uB8B0\uB3C4${r.confidence}] ${r.area}: ${r.rule} (\uADFC\uAC70: ${r.evidence})`).join(`
`);
}
var BUNDLED = true, PLUGIN_ROOT, VERSION = "0.13.5", DEFAULTS, DOC_FILENAME = "calibration.md", SECTION_LABEL, label = (r) => r.section === "recommend" ? `\uAD8C\uC7A5\xB7${r.kind === "method" ? "\uBC29\uBC95" : "\uAC15\uB3C4"}` : SECTION_LABEL[r.section] ?? r.section;
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
    recommend: "\uAD8C\uC7A5",
    env: "\uD658\uACBD \uD2B9\uC774\uC0AC\uD56D",
    task: "\uC791\uC5C5 \uAE30\uB85D"
  };
});

// hooks/post-tool-use.ts
init_config();

// hooks/topic.ts
init_config();
import { isAbsolute as isAbsolute2, resolve } from "path";
var CORE_HEADING = "[\uD655\uC815 \uADDC\uCE59 \u2014 '\uBC8C\uC8FC\uB294 \uAC83'\xB7'\uAD8C\uC7A5(\uBC29\uBC95)' \uC2E0\uB8B0\uB3C4 \uB192\uC74C(3+). \uD56D\uC0C1 \uC9C0\uD0A8\uB2E4]";
var CORE_OUTSIDE_HEADING = "[\uD655\uC815 \uADDC\uCE59 \u2014 \uC8FC\uC81C \uBC16, \uC804\uBB38\uC740 nunchi_list(ids)\uB85C \uC870\uD68C. \uD56D\uC0C1 \uC9C0\uD0A8\uB2E4]";
var TOPIC_LIST_MAX = 20;
var TOPIC_CLEARED = "[nunchi] \uD604\uC7AC \uC8FC\uC81C \uC5C6\uC74C \u2014 \uC774\uC804\uC5D0 \uC8FC\uC785\uB41C \uC8FC\uC81C \uBE14\uB85D\uC740 \uBB34\uD6A8";
function sessionIdLine(sid) {
  return `[nunchi] \uC774 \uC138\uC158 id: ${sid} \u2014 nunchi_topic\xB7nunchi_record\xB7nunchi_update\xB7nunchi_search \uD638\uCD9C \uC2DC session_id\uB85C \uB118\uAE34\uB2E4`;
}
function formatTopicList(topics) {
  const lines = [];
  if (topics.length) {
    lines.push("[nunchi] \uC8FC\uC81C \uBAA9\uB85D:");
    for (const t of topics.slice(0, TOPIC_LIST_MAX))
      lines.push(`- ${t.name} \u2014 ${t.description}`);
  }
  lines.push("[nunchi] \uC791\uC5C5\uC744 \uC2DC\uC791\uD560 \uB54C \uB9DE\uB294 \uC8FC\uC81C\uAC00 \uC788\uC73C\uBA74 nunchi_topic(set)\uC73C\uB85C \uC124\uC815\uD55C\uB2E4. \uC0AC\uC6A9\uC790\uAC00 \uC8FC\uC81C \uBCC0\uACBD\uC744 \uC694\uCCAD\uD558\uBA74(`/nunchi:topic`, \uC790\uC5F0\uC5B4) \uB530\uB978\uB2E4. \uC791\uC5C5\uACF5\uAC04 \uBC16 \uD30C\uC77C\uC744 \uACE0\uCCD0\uC57C \uD558\uBA74 \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uC54C\uB9B0\uB2E4.");
  return lines.join(`
`);
}
function formatTopicBlock(t, changed = false) {
  const lines = [];
  if (changed)
    lines.push("[nunchi] \uC8FC\uC81C \uC815\uBCF4\uAC00 \uAC31\uC2E0\uB428");
  lines.push(`[nunchi] \uD604\uC7AC \uC8FC\uC81C: ${t.name}${t.description ? ` \u2014 ${t.description}` : ""}`);
  lines.push(t.folders.length ? `\uC791\uC5C5\uACF5\uAC04: ${t.folders.join(", ")} \u2014 \uC774 \uD3F4\uB354\uB4E4 \uC548\uC5D0\uC11C \uC791\uC5C5\uD55C\uB2E4` : "\uC791\uC5C5\uACF5\uAC04: (\uC9C0\uC815 \uC5C6\uC74C)");
  if (t.areas.length) {
    lines.push("\uC8FC\uC81C \uD575\uC2EC \uC601\uC5ED(\uC8FC\uC81C \uC2E0\uB8B0\uB3C4 3+, \uC804\uBB38\uC740 nunchi_list(ids)\uB85C \uC870\uD68C):");
    for (const a of t.areas)
      lines.push(`- #${a.id} ${a.area}`);
  }
  return lines.join(`
`);
}
function formatCoreBlock(core, memberIds) {
  if (!core.length)
    return "";
  if (memberIds === null)
    return `${CORE_HEADING}
${formatMemoryEntries(core)}`;
  const ids = new Set(memberIds);
  const inside = core.filter((r) => ids.has(r.id));
  const outside = core.filter((r) => !ids.has(r.id));
  const blocks = [];
  if (inside.length)
    blocks.push(`${CORE_HEADING}
${formatMemoryEntries(inside)}`);
  if (outside.length)
    blocks.push(`${CORE_OUTSIDE_HEADING}
${outside.map((r) => `- #${r.id} \xB7 ${r.area}`).join(`
`)}`);
  return blocks.join(`

`);
}
function norm(projectDir, p) {
  const slashed = p.replace(/\\/g, "/");
  const abs = isAbsolute2(slashed) ? resolve(slashed) : resolve(projectDir, slashed);
  const out = abs.replace(/\\/g, "/");
  return process.platform === "win32" ? out.toLowerCase() : out;
}
function inWorkspace(projectDir, folders, filePath) {
  if (!folders.length)
    return true;
  const file = norm(projectDir, filePath);
  return folders.some((f) => {
    const folder = norm(projectDir, f);
    return file === folder || file.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
  });
}

// memory/session-state.ts
import { mkdirSync, readFileSync as readFileSync2, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join as join2 } from "path";
function sessionsDir(docDir) {
  return join2(docDir, "sessions");
}
var SAFE_ID = /^[A-Za-z0-9_-]+$/;
function deliveredName(sid, agentId) {
  if (!SAFE_ID.test(sid))
    return null;
  if (!agentId)
    return `${sid}.delivered`;
  return SAFE_ID.test(agentId) ? `${sid}.${agentId}.delivered` : null;
}
function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
function writeSessionState(docDir, sid, s) {
  if (!SAFE_ID.test(sid))
    return;
  writeAtomic(join2(sessionsDir(docDir), `${sid}.json`), JSON.stringify(s));
}
function readSessionState(docDir, sid) {
  if (!SAFE_ID.test(sid))
    return null;
  try {
    const s = JSON.parse(readFileSync2(join2(sessionsDir(docDir), `${sid}.json`), "utf8"));
    return s && typeof s.rev === "number" ? s : null;
  } catch {
    return null;
  }
}
function readDelivered(docDir, sid, agentId) {
  const name = deliveredName(sid, agentId);
  if (!name)
    return 0;
  try {
    const n = parseInt(readFileSync2(join2(sessionsDir(docDir), name), "utf8"), 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}
function writeDelivered(docDir, sid, agentId, rev) {
  const name = deliveredName(sid, agentId);
  if (name)
    writeAtomic(join2(sessionsDir(docDir), name), String(rev));
}
function removeSessionFiles(docDir, sid) {
  if (!SAFE_ID.test(sid))
    return;
  const dir = sessionsDir(docDir);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names)
    if (n.startsWith(`${sid}.`))
      rmSync(join2(dir, n), { force: true });
}

// hooks/post-tool-use.ts
var projectDir = hookProjectDir();
var input = await readStdinJson();
var sid = input.session_id;
if (!sid)
  process.exit(0);
try {
  const docDir = resolveDocDir(projectDir, loadConfig(projectDir));
  const state = readSessionState(docDir, sid);
  const act = input.tool_input?.action;
  if (state && input.agent_id && String(input.tool_name ?? "").endsWith("nunchi_topic") && (act === undefined || act === "set" || act === "clear")) {
    writeDelivered(docDir, sid, input.agent_id, state.rev);
    writeDelivered(docDir, sid, null, 0);
    process.exit(0);
  }
  if (state && state.rev !== readDelivered(docDir, sid, input.agent_id)) {
    const block = state.topic ? formatTopicBlock(state.topic, true) : TOPIC_CLEARED;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: block.slice(0, 8000) } }));
    writeDelivered(docDir, sid, input.agent_id, state.rev);
  }
} catch {}
process.exit(0);
