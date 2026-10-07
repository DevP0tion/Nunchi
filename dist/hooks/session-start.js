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
var BUNDLED = true, PLUGIN_ROOT, VERSION = "0.13.2", DEFAULTS, DOC_FILENAME = "calibration.md", SECTION_LABEL;
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

// node_modules/xmlhttprequest-ssl/lib/XMLHttpRequest.js
var require_XMLHttpRequest = __commonJS(function(exports, module) {
  var fs = __require("fs");
  var Url = __require("url");
  var spawn = __require("child_process").spawn;
  module.exports = XMLHttpRequest2;
  XMLHttpRequest2.XMLHttpRequest = XMLHttpRequest2;
  function XMLHttpRequest2(opts) {
    opts = opts || {};
    var self = this;
    var http = __require("http");
    var https = __require("https");
    var request;
    var response;
    var settings = {};
    var disableHeaderCheck = false;
    var defaultHeaders = {
      "User-Agent": "node-XMLHttpRequest",
      Accept: "*/*"
    };
    var headers = Object.assign({}, defaultHeaders);
    var forbiddenRequestHeaders = [
      "accept-charset",
      "accept-encoding",
      "access-control-request-headers",
      "access-control-request-method",
      "connection",
      "content-length",
      "content-transfer-encoding",
      "cookie",
      "cookie2",
      "date",
      "expect",
      "host",
      "keep-alive",
      "origin",
      "referer",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "via"
    ];
    var forbiddenRequestMethods = [
      "TRACE",
      "TRACK",
      "CONNECT"
    ];
    var sendFlag = false;
    var errorFlag = false;
    var abortedFlag = false;
    var listeners = {};
    this.UNSENT = 0;
    this.OPENED = 1;
    this.HEADERS_RECEIVED = 2;
    this.LOADING = 3;
    this.DONE = 4;
    this.readyState = this.UNSENT;
    this.onreadystatechange = null;
    this.responseText = "";
    this.responseXML = "";
    this.response = Buffer.alloc(0);
    this.status = null;
    this.statusText = null;
    var isAllowedHttpHeader = function(header) {
      return disableHeaderCheck || header && forbiddenRequestHeaders.indexOf(header.toLowerCase()) === -1;
    };
    var isAllowedHttpMethod = function(method) {
      return method && forbiddenRequestMethods.indexOf(method) === -1;
    };
    this.open = function(method, url, async, user, password) {
      this.abort();
      errorFlag = false;
      abortedFlag = false;
      if (!isAllowedHttpMethod(method)) {
        throw new Error("SecurityError: Request method not allowed");
      }
      settings = {
        method,
        url: url.toString(),
        async: typeof async !== "boolean" ? true : async,
        user: user || null,
        password: password || null
      };
      setState(this.OPENED);
    };
    this.setDisableHeaderCheck = function(state) {
      disableHeaderCheck = state;
    };
    this.setRequestHeader = function(header, value) {
      if (this.readyState != this.OPENED) {
        throw new Error("INVALID_STATE_ERR: setRequestHeader can only be called when state is OPEN");
      }
      if (!isAllowedHttpHeader(header)) {
        console.warn('Refused to set unsafe header "' + header + '"');
        return false;
      }
      if (sendFlag) {
        throw new Error("INVALID_STATE_ERR: send flag is true");
      }
      headers[header] = value;
      return true;
    };
    this.getResponseHeader = function(header) {
      if (typeof header === "string" && this.readyState > this.OPENED && response.headers[header.toLowerCase()] && !errorFlag) {
        return response.headers[header.toLowerCase()];
      }
      return null;
    };
    this.getAllResponseHeaders = function() {
      if (this.readyState < this.HEADERS_RECEIVED || errorFlag) {
        return "";
      }
      var result = "";
      for (var i in response.headers) {
        if (i !== "set-cookie" && i !== "set-cookie2") {
          result += i + ": " + response.headers[i] + `\r
`;
        }
      }
      return result.substr(0, result.length - 2);
    };
    this.getRequestHeader = function(name) {
      if (typeof name === "string" && headers[name]) {
        return headers[name];
      }
      return "";
    };
    this.send = function(data) {
      if (this.readyState != this.OPENED) {
        throw new Error("INVALID_STATE_ERR: connection must be opened before send() is called");
      }
      if (sendFlag) {
        throw new Error("INVALID_STATE_ERR: send has already been called");
      }
      var ssl = false, local = false;
      var url = Url.parse(settings.url);
      var host;
      switch (url.protocol) {
        case "https:":
          ssl = true;
        case "http:":
          host = url.hostname;
          break;
        case "file:":
          local = true;
          break;
        case undefined:
        case "":
          host = "localhost";
          break;
        default:
          throw new Error("Protocol not supported.");
      }
      if (local) {
        if (settings.method !== "GET") {
          throw new Error("XMLHttpRequest: Only GET method is supported");
        }
        if (settings.async) {
          fs.readFile(unescape(url.pathname), function(error, data) {
            if (error) {
              self.handleError(error, error.errno || -1);
            } else {
              self.status = 200;
              self.responseText = data.toString("utf8");
              self.response = data;
              setState(self.DONE);
            }
          });
        } else {
          try {
            this.response = fs.readFileSync(unescape(url.pathname));
            this.responseText = this.response.toString("utf8");
            this.status = 200;
            setState(self.DONE);
          } catch (e) {
            this.handleError(e, e.errno || -1);
          }
        }
        return;
      }
      var port = url.port || (ssl ? 443 : 80);
      var uri = url.pathname + (url.search ? url.search : "");
      headers["Host"] = host;
      if (!(ssl && port === 443 || port === 80)) {
        headers["Host"] += ":" + url.port;
      }
      if (settings.user) {
        if (typeof settings.password == "undefined") {
          settings.password = "";
        }
        var authBuf = new Buffer(settings.user + ":" + settings.password);
        headers["Authorization"] = "Basic " + authBuf.toString("base64");
      }
      if (settings.method === "GET" || settings.method === "HEAD") {
        data = null;
      } else if (data) {
        headers["Content-Length"] = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
        var headersKeys = Object.keys(headers);
        if (!headersKeys.some(function(h) {
          return h.toLowerCase() === "content-type";
        })) {
          headers["Content-Type"] = "text/plain;charset=UTF-8";
        }
      } else if (settings.method === "POST") {
        headers["Content-Length"] = 0;
      }
      var agent = opts.agent || false;
      var options = {
        host,
        port,
        path: uri,
        method: settings.method,
        headers,
        agent
      };
      if (ssl) {
        options.pfx = opts.pfx;
        options.key = opts.key;
        options.passphrase = opts.passphrase;
        options.cert = opts.cert;
        options.ca = opts.ca;
        options.ciphers = opts.ciphers;
        options.rejectUnauthorized = opts.rejectUnauthorized === false ? false : true;
      }
      errorFlag = false;
      if (settings.async) {
        var doRequest = ssl ? https.request : http.request;
        sendFlag = true;
        self.dispatchEvent("readystatechange");
        var responseHandler = function(resp) {
          response = resp;
          if (response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
            settings.url = response.headers.location;
            var url = Url.parse(settings.url);
            host = url.hostname;
            var newOptions = {
              hostname: url.hostname,
              port: url.port,
              path: url.path,
              method: response.statusCode === 303 ? "GET" : settings.method,
              headers
            };
            if (ssl) {
              newOptions.pfx = opts.pfx;
              newOptions.key = opts.key;
              newOptions.passphrase = opts.passphrase;
              newOptions.cert = opts.cert;
              newOptions.ca = opts.ca;
              newOptions.ciphers = opts.ciphers;
              newOptions.rejectUnauthorized = opts.rejectUnauthorized === false ? false : true;
            }
            request = doRequest(newOptions, responseHandler).on("error", errorHandler);
            request.end();
            return;
          }
          setState(self.HEADERS_RECEIVED);
          self.status = response.statusCode;
          response.on("data", function(chunk) {
            if (chunk) {
              var data = Buffer.from(chunk);
              self.response = Buffer.concat([self.response, data]);
            }
            if (sendFlag) {
              setState(self.LOADING);
            }
          });
          response.on("end", function() {
            if (sendFlag) {
              sendFlag = false;
              setState(self.DONE);
              self.responseText = self.response.toString("utf8");
            }
          });
          response.on("error", function(error) {
            self.handleError(error);
          });
        };
        var errorHandler = function(error) {
          if (request.reusedSocket && error.code === "ECONNRESET")
            return doRequest(options, responseHandler).on("error", errorHandler);
          self.handleError(error);
        };
        request = doRequest(options, responseHandler).on("error", errorHandler);
        if (opts.autoUnref) {
          request.on("socket", (socket) => {
            socket.unref();
          });
        }
        if (data) {
          request.write(data);
        }
        request.end();
        self.dispatchEvent("loadstart");
      } else {
        var contentFile = ".node-xmlhttprequest-content-" + process.pid;
        var syncFile = ".node-xmlhttprequest-sync-" + process.pid;
        fs.writeFileSync(syncFile, "", "utf8");
        var execString = "var http = require('http'), https = require('https'), fs = require('fs');" + "var doRequest = http" + (ssl ? "s" : "") + ".request;" + "var options = " + JSON.stringify(options) + ";" + "var responseText = '';" + "var responseData = Buffer.alloc(0);" + "var req = doRequest(options, function(response) {" + "response.on('data', function(chunk) {" + "  var data = Buffer.from(chunk);" + "  responseText += data.toString('utf8');" + "  responseData = Buffer.concat([responseData, data]);" + "});" + "response.on('end', function() {" + "fs.writeFileSync('" + contentFile + "', JSON.stringify({err: null, data: {statusCode: response.statusCode, headers: response.headers, text: responseText, data: responseData.toString('base64')}}), 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + "response.on('error', function(error) {" + "fs.writeFileSync('" + contentFile + "', 'NODE-XMLHTTPREQUEST-ERROR:' + JSON.stringify(error), 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + "}).on('error', function(error) {" + "fs.writeFileSync('" + contentFile + "', 'NODE-XMLHTTPREQUEST-ERROR:' + JSON.stringify(error), 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + (data ? "req.write('" + JSON.stringify(data).slice(1, -1).replace(/'/g, "\\'") + "');" : "") + "req.end();";
        var syncProc = spawn(process.argv[0], ["-e", execString]);
        var statusText;
        while (fs.existsSync(syncFile)) {}
        self.responseText = fs.readFileSync(contentFile, "utf8");
        syncProc.stdin.end();
        fs.unlinkSync(contentFile);
        if (self.responseText.match(/^NODE-XMLHTTPREQUEST-ERROR:/)) {
          var errorObj = JSON.parse(self.responseText.replace(/^NODE-XMLHTTPREQUEST-ERROR:/, ""));
          self.handleError(errorObj, 503);
        } else {
          self.status = self.responseText.replace(/^NODE-XMLHTTPREQUEST-STATUS:([0-9]*),.*/, "$1");
          var resp = JSON.parse(self.responseText.replace(/^NODE-XMLHTTPREQUEST-STATUS:[0-9]*,(.*)/, "$1"));
          response = {
            statusCode: self.status,
            headers: resp.data.headers
          };
          self.responseText = resp.data.text;
          self.response = Buffer.from(resp.data.data, "base64");
          setState(self.DONE, true);
        }
      }
    };
    this.handleError = function(error, status) {
      this.status = status || 0;
      this.statusText = error;
      this.responseText = error.stack;
      errorFlag = true;
      setState(this.DONE);
    };
    this.abort = function() {
      if (request) {
        request.abort();
        request = null;
      }
      headers = Object.assign({}, defaultHeaders);
      this.responseText = "";
      this.responseXML = "";
      this.response = Buffer.alloc(0);
      errorFlag = abortedFlag = true;
      if (this.readyState !== this.UNSENT && (this.readyState !== this.OPENED || sendFlag) && this.readyState !== this.DONE) {
        sendFlag = false;
        setState(this.DONE);
      }
      this.readyState = this.UNSENT;
    };
    this.addEventListener = function(event, callback) {
      if (!(event in listeners)) {
        listeners[event] = [];
      }
      listeners[event].push(callback);
    };
    this.removeEventListener = function(event, callback) {
      if (event in listeners) {
        listeners[event] = listeners[event].filter(function(ev) {
          return ev !== callback;
        });
      }
    };
    this.dispatchEvent = function(event) {
      if (typeof self["on" + event] === "function") {
        if (this.readyState === this.DONE && settings.async)
          setTimeout(function() {
            self["on" + event]();
          }, 0);
        else
          self["on" + event]();
      }
      if (event in listeners) {
        for (let i = 0, len = listeners[event].length;i < len; i++) {
          if (this.readyState === this.DONE)
            setTimeout(function() {
              listeners[event][i].call(self);
            }, 0);
          else
            listeners[event][i].call(self);
        }
      }
    };
    var setState = function(state) {
      if (self.readyState === state || self.readyState === self.UNSENT && abortedFlag)
        return;
      self.readyState = state;
      if (settings.async || self.readyState < self.OPENED || self.readyState === self.DONE) {
        self.dispatchEvent("readystatechange");
      }
      if (self.readyState === self.DONE) {
        let fire;
        if (abortedFlag)
          fire = "abort";
        else if (errorFlag)
          fire = "error";
        else
          fire = "load";
        self.dispatchEvent(fire);
        self.dispatchEvent("loadend");
      }
    };
  }
});

// node_modules/engine.io-parser/build/esm/commons.js
var PACKET_TYPES, PACKET_TYPES_REVERSE, ERROR_PACKET;
var init_commons = __esm(() => {
  PACKET_TYPES = Object.create(null);
  PACKET_TYPES["open"] = "0";
  PACKET_TYPES["close"] = "1";
  PACKET_TYPES["ping"] = "2";
  PACKET_TYPES["pong"] = "3";
  PACKET_TYPES["message"] = "4";
  PACKET_TYPES["upgrade"] = "5";
  PACKET_TYPES["noop"] = "6";
  PACKET_TYPES_REVERSE = Object.create(null);
  Object.keys(PACKET_TYPES).forEach((key) => {
    PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
  });
  ERROR_PACKET = { type: "error", data: "parser error" };
});

// node_modules/engine.io-parser/build/esm/encodePacket.js
function encodePacketToBinary(packet, callback) {
  if (packet.data instanceof ArrayBuffer || ArrayBuffer.isView(packet.data)) {
    return callback(toBuffer(packet.data, false));
  }
  encodePacket(packet, true, (encoded) => {
    if (!TEXT_ENCODER) {
      TEXT_ENCODER = new TextEncoder;
    }
    callback(TEXT_ENCODER.encode(encoded));
  });
}
var encodePacket = ({ type, data }, supportsBinary, callback) => {
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return callback(supportsBinary ? data : "b" + toBuffer(data, true).toString("base64"));
  }
  return callback(PACKET_TYPES[type] + (data || ""));
}, toBuffer = (data, forceBufferConversion) => {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array && !forceBufferConversion) {
    return data;
  } else if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  } else {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
}, TEXT_ENCODER;
var init_encodePacket = __esm(() => {
  init_commons();
});

// node_modules/engine.io-parser/build/esm/decodePacket.js
var decodePacket = (encodedPacket, binaryType) => {
  if (typeof encodedPacket !== "string") {
    return {
      type: "message",
      data: mapBinary(encodedPacket, binaryType)
    };
  }
  const type = encodedPacket.charAt(0);
  if (type === "b") {
    const buffer = Buffer.from(encodedPacket.substring(1), "base64");
    return {
      type: "message",
      data: mapBinary(buffer, binaryType)
    };
  }
  if (!PACKET_TYPES_REVERSE[type]) {
    return ERROR_PACKET;
  }
  return encodedPacket.length > 1 ? {
    type: PACKET_TYPES_REVERSE[type],
    data: encodedPacket.substring(1)
  } : {
    type: PACKET_TYPES_REVERSE[type]
  };
}, mapBinary = (data, binaryType) => {
  switch (binaryType) {
    case "arraybuffer":
      if (data instanceof ArrayBuffer) {
        return data;
      } else if (Buffer.isBuffer(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else {
        return data.buffer;
      }
    case "nodebuffer":
    default:
      if (Buffer.isBuffer(data)) {
        return data;
      } else {
        return Buffer.from(data);
      }
  }
};
var init_decodePacket = __esm(() => {
  init_commons();
});

// node_modules/engine.io-parser/build/esm/index.js
function createPacketEncoderStream() {
  return new TransformStream({
    transform(packet, controller) {
      encodePacketToBinary(packet, (encodedPacket) => {
        const payloadLength = encodedPacket.length;
        let header;
        if (payloadLength < 126) {
          header = new Uint8Array(1);
          new DataView(header.buffer).setUint8(0, payloadLength);
        } else if (payloadLength < 65536) {
          header = new Uint8Array(3);
          const view = new DataView(header.buffer);
          view.setUint8(0, 126);
          view.setUint16(1, payloadLength);
        } else {
          header = new Uint8Array(9);
          const view = new DataView(header.buffer);
          view.setUint8(0, 127);
          view.setBigUint64(1, BigInt(payloadLength));
        }
        if (packet.data && typeof packet.data !== "string") {
          header[0] |= 128;
        }
        controller.enqueue(header);
        controller.enqueue(encodedPacket);
      });
    }
  });
}
function totalLength(chunks) {
  return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
}
function concatChunks(chunks, size) {
  if (chunks[0].length === size) {
    return chunks.shift();
  }
  const buffer = new Uint8Array(size);
  let j = 0;
  for (let i = 0;i < size; i++) {
    buffer[i] = chunks[0][j++];
    if (j === chunks[0].length) {
      chunks.shift();
      j = 0;
    }
  }
  if (chunks.length && j < chunks[0].length) {
    chunks[0] = chunks[0].slice(j);
  }
  return buffer;
}
function createPacketDecoderStream(maxPayload, binaryType) {
  if (!TEXT_DECODER) {
    TEXT_DECODER = new TextDecoder;
  }
  const chunks = [];
  let state = 0;
  let expectedLength = -1;
  let isBinary = false;
  return new TransformStream({
    transform(chunk, controller) {
      chunks.push(chunk);
      while (true) {
        if (state === 0) {
          if (totalLength(chunks) < 1) {
            break;
          }
          const header = concatChunks(chunks, 1);
          isBinary = (header[0] & 128) === 128;
          expectedLength = header[0] & 127;
          if (expectedLength < 126) {
            state = 3;
          } else if (expectedLength === 126) {
            state = 1;
          } else {
            state = 2;
          }
        } else if (state === 1) {
          if (totalLength(chunks) < 2) {
            break;
          }
          const headerArray = concatChunks(chunks, 2);
          expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
          state = 3;
        } else if (state === 2) {
          if (totalLength(chunks) < 8) {
            break;
          }
          const headerArray = concatChunks(chunks, 8);
          const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
          const n = view.getUint32(0);
          if (n > Math.pow(2, 53 - 32) - 1) {
            controller.enqueue(ERROR_PACKET);
            break;
          }
          expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
          state = 3;
        } else {
          if (totalLength(chunks) < expectedLength) {
            break;
          }
          const data = concatChunks(chunks, expectedLength);
          controller.enqueue(decodePacket(isBinary ? data : TEXT_DECODER.decode(data), binaryType));
          state = 0;
        }
        if (expectedLength === 0 || expectedLength > maxPayload) {
          controller.enqueue(ERROR_PACKET);
          break;
        }
      }
    }
  });
}
var SEPARATOR, encodePayload = (packets, callback) => {
  const length = packets.length;
  const encodedPackets = new Array(length);
  let count = 0;
  packets.forEach((packet, i) => {
    encodePacket(packet, false, (encodedPacket) => {
      encodedPackets[i] = encodedPacket;
      if (++count === length) {
        callback(encodedPackets.join(SEPARATOR));
      }
    });
  });
}, decodePayload = (encodedPayload, binaryType) => {
  const encodedPackets = encodedPayload.split(SEPARATOR);
  const packets = [];
  for (let i = 0;i < encodedPackets.length; i++) {
    const decodedPacket = decodePacket(encodedPackets[i], binaryType);
    packets.push(decodedPacket);
    if (decodedPacket.type === "error") {
      break;
    }
  }
  return packets;
}, TEXT_DECODER, protocol = 4;
var init_esm = __esm(() => {
  init_encodePacket();
  init_decodePacket();
  init_commons();
  SEPARATOR = String.fromCharCode(30);
});

// node_modules/@socket.io/component-emitter/lib/cjs/index.js
var require_cjs = __commonJS(function(exports) {
  exports.Emitter = Emitter;
  function Emitter(obj) {
    if (obj)
      return mixin(obj);
  }
  function mixin(obj) {
    for (var key in Emitter.prototype) {
      obj[key] = Emitter.prototype[key];
    }
    return obj;
  }
  Emitter.prototype.on = Emitter.prototype.addEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    (this._callbacks["$" + event] = this._callbacks["$" + event] || []).push(fn);
    return this;
  };
  Emitter.prototype.once = function(event, fn) {
    function on() {
      this.off(event, on);
      fn.apply(this, arguments);
    }
    on.fn = fn;
    this.on(event, on);
    return this;
  };
  Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function(event, fn) {
    this._callbacks = this._callbacks || {};
    if (arguments.length == 0) {
      this._callbacks = {};
      return this;
    }
    var callbacks = this._callbacks["$" + event];
    if (!callbacks)
      return this;
    if (arguments.length == 1) {
      delete this._callbacks["$" + event];
      return this;
    }
    var cb;
    for (var i = 0;i < callbacks.length; i++) {
      cb = callbacks[i];
      if (cb === fn || cb.fn === fn) {
        callbacks.splice(i, 1);
        break;
      }
    }
    if (callbacks.length === 0) {
      delete this._callbacks["$" + event];
    }
    return this;
  };
  Emitter.prototype.emit = function(event) {
    this._callbacks = this._callbacks || {};
    var args = new Array(arguments.length - 1), callbacks = this._callbacks["$" + event];
    for (var i = 1;i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
    if (callbacks) {
      callbacks = callbacks.slice(0);
      for (var i = 0, len = callbacks.length;i < len; ++i) {
        callbacks[i].apply(this, args);
      }
    }
    return this;
  };
  Emitter.prototype.emitReserved = Emitter.prototype.emit;
  Emitter.prototype.listeners = function(event) {
    this._callbacks = this._callbacks || {};
    return this._callbacks["$" + event] || [];
  };
  Emitter.prototype.hasListeners = function(event) {
    return !!this.listeners(event).length;
  };
});

// node_modules/engine.io-client/build/esm-debug/globals.node.js
function createCookieJar() {
  return new CookieJar;
}
function parse(setCookieString) {
  const parts = setCookieString.split("; ");
  const i = parts[0].indexOf("=");
  if (i === -1) {
    return;
  }
  const name = parts[0].substring(0, i).trim();
  if (!name.length) {
    return;
  }
  let value = parts[0].substring(i + 1).trim();
  if (value.charCodeAt(0) === 34) {
    value = value.slice(1, -1);
  }
  const cookie = {
    name,
    value
  };
  for (let j = 1;j < parts.length; j++) {
    const subParts = parts[j].split("=");
    if (subParts.length !== 2) {
      continue;
    }
    const key = subParts[0].trim();
    const value = subParts[1].trim();
    switch (key) {
      case "Expires":
        cookie.expires = new Date(value);
        break;
      case "Max-Age":
        const expiration = new Date;
        expiration.setUTCSeconds(expiration.getUTCSeconds() + parseInt(value, 10));
        cookie.expires = expiration;
        break;
      default:
    }
  }
  return cookie;
}

class CookieJar {
  constructor() {
    this._cookies = new Map;
  }
  parseCookies(values) {
    if (!values) {
      return;
    }
    values.forEach((value) => {
      const parsed = parse(value);
      if (parsed) {
        this._cookies.set(parsed.name, parsed);
      }
    });
  }
  get cookies() {
    const now = Date.now();
    this._cookies.forEach((cookie, name) => {
      var _a;
      if (((_a = cookie.expires) === null || _a === undefined ? undefined : _a.getTime()) < now) {
        this._cookies.delete(name);
      }
    });
    return this._cookies.entries();
  }
  addCookies(xhr) {
    const cookies = [];
    for (const [name, cookie] of this.cookies) {
      cookies.push(`${name}=${cookie.value}`);
    }
    if (cookies.length) {
      xhr.setDisableHeaderCheck(true);
      xhr.setRequestHeader("cookie", cookies.join("; "));
    }
  }
  appendCookies(headers) {
    for (const [name, cookie] of this.cookies) {
      headers.append("cookie", `${name}=${cookie.value}`);
    }
  }
}
var nextTick, globalThisShim, defaultBinaryType = "nodebuffer";
var init_globals_node = __esm(() => {
  nextTick = process.nextTick;
  globalThisShim = global;
});

// node_modules/engine.io-client/build/esm-debug/util.js
function pick(obj, ...attr) {
  return attr.reduce((acc, k) => {
    if (obj.hasOwnProperty(k)) {
      acc[k] = obj[k];
    }
    return acc;
  }, {});
}
function installTimerFunctions(obj, opts) {
  if (opts.useNativeTimers) {
    obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
    obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
  } else {
    obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
    obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
  }
}
function byteLength(obj) {
  if (typeof obj === "string") {
    return utf8Length(obj);
  }
  return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
}
function utf8Length(str) {
  let c = 0, length = 0;
  for (let i = 0, l = str.length;i < l; i++) {
    c = str.charCodeAt(i);
    if (c < 128) {
      length += 1;
    } else if (c < 2048) {
      length += 2;
    } else if (c < 55296 || c >= 57344) {
      length += 3;
    } else {
      i++;
      length += 4;
    }
  }
  return length;
}
function randomString() {
  return Date.now().toString(36).substring(3) + Math.random().toString(36).substring(2, 5);
}
var NATIVE_SET_TIMEOUT, NATIVE_CLEAR_TIMEOUT, BASE64_OVERHEAD = 1.33;
var init_util = __esm(() => {
  init_globals_node();
  NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
  NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
});

// node_modules/engine.io-client/build/esm-debug/contrib/parseqs.js
function encode(obj) {
  let str = "";
  for (let i in obj) {
    if (obj.hasOwnProperty(i)) {
      if (str.length)
        str += "&";
      str += encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]);
    }
  }
  return str;
}
function decode(qs) {
  let qry = {};
  let pairs = qs.split("&");
  for (let i = 0, l = pairs.length;i < l; i++) {
    let pair = pairs[i].split("=");
    qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
  }
  return qry;
}

// node_modules/ms/index.js
var require_ms = __commonJS(function(exports, module) {
  var s = 1000;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  module.exports = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
  };
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return;
    }
  }
  function fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return Math.round(ms / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms / s) + "s";
    }
    return ms + "ms";
  }
  function fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return plural(ms, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms, msAbs, s, "second");
    }
    return ms + " ms";
  }
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS(function(exports, module) {
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = require_ms();
    createDebug.destroy = destroy;
    Object.keys(env).forEach((key) => {
      createDebug[key] = env[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0;i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug(...args) {
        if (!debug.enabled) {
          return;
        }
        const self = debug;
        const curr = Number(new Date);
        const ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self, args);
        const logFn = self.log || createDebug.log;
        logFn.apply(self, args);
      }
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy;
      Object.defineProperty(debug, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug);
      }
      return debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) {
        if (ns[0] === "-") {
          createDebug.skips.push(ns.slice(1));
        } else {
          createDebug.names.push(ns);
        }
      }
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0;
      let templateIndex = 0;
      let starIndex = -1;
      let matchIndex = 0;
      while (searchIndex < search.length) {
        if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
          if (template[templateIndex] === "*") {
            starIndex = templateIndex;
            matchIndex = searchIndex;
            templateIndex++;
          } else {
            searchIndex++;
            templateIndex++;
          }
        } else if (starIndex !== -1) {
          templateIndex = starIndex + 1;
          matchIndex++;
          searchIndex = matchIndex;
        } else {
          return false;
        }
      }
      while (templateIndex < template.length && template[templateIndex] === "*") {
        templateIndex++;
      }
      return templateIndex === template.length;
    }
    function disable() {
      const namespaces = [
        ...createDebug.names,
        ...createDebug.skips.map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name) {
      for (const skip of createDebug.skips) {
        if (matchesTemplate(name, skip)) {
          return false;
        }
      }
      for (const ns of createDebug.names) {
        if (matchesTemplate(name, ns)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  module.exports = setup;
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS(function(exports, module) {
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage = localstorage();
  exports.destroy = (() => {
    let warned = false;
    return () => {
      if (!warned) {
        warned = true;
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
    };
  })();
  exports.colors = [
    "#0000CC",
    "#0000FF",
    "#0033CC",
    "#0033FF",
    "#0066CC",
    "#0066FF",
    "#0099CC",
    "#0099FF",
    "#00CC00",
    "#00CC33",
    "#00CC66",
    "#00CC99",
    "#00CCCC",
    "#00CCFF",
    "#3300CC",
    "#3300FF",
    "#3333CC",
    "#3333FF",
    "#3366CC",
    "#3366FF",
    "#3399CC",
    "#3399FF",
    "#33CC00",
    "#33CC33",
    "#33CC66",
    "#33CC99",
    "#33CCCC",
    "#33CCFF",
    "#6600CC",
    "#6600FF",
    "#6633CC",
    "#6633FF",
    "#66CC00",
    "#66CC33",
    "#9900CC",
    "#9900FF",
    "#9933CC",
    "#9933FF",
    "#99CC00",
    "#99CC33",
    "#CC0000",
    "#CC0033",
    "#CC0066",
    "#CC0099",
    "#CC00CC",
    "#CC00FF",
    "#CC3300",
    "#CC3333",
    "#CC3366",
    "#CC3399",
    "#CC33CC",
    "#CC33FF",
    "#CC6600",
    "#CC6633",
    "#CC9900",
    "#CC9933",
    "#CCCC00",
    "#CCCC33",
    "#FF0000",
    "#FF0033",
    "#FF0066",
    "#FF0099",
    "#FF00CC",
    "#FF00FF",
    "#FF3300",
    "#FF3333",
    "#FF3366",
    "#FF3399",
    "#FF33CC",
    "#FF33FF",
    "#FF6600",
    "#FF6633",
    "#FF9900",
    "#FF9933",
    "#FFCC00",
    "#FFCC33"
  ];
  function useColors() {
    if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
      return false;
    }
    let m;
    return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
  }
  function formatArgs(args) {
    args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
    if (!this.useColors) {
      return;
    }
    const c = "color: " + this.color;
    args.splice(1, 0, c, "color: inherit");
    let index = 0;
    let lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, (match) => {
      if (match === "%%") {
        return;
      }
      index++;
      if (match === "%c") {
        lastC = index;
      }
    });
    args.splice(lastC, 0, c);
  }
  exports.log = console.debug || console.log || (() => {});
  function save(namespaces) {
    try {
      if (namespaces) {
        exports.storage.setItem("debug", namespaces);
      } else {
        exports.storage.removeItem("debug");
      }
    } catch (error) {}
  }
  function load() {
    let r;
    try {
      r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
    } catch (error) {}
    if (!r && typeof process !== "undefined" && "env" in process) {
      r = process.env.DEBUG;
    }
    return r;
  }
  function localstorage() {
    try {
      return localStorage;
    } catch (error) {}
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.j = function(v) {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return "[UnexpectedJSONParseError]: " + error.message;
    }
  };
});

// node_modules/debug/src/node.js
var require_node = __commonJS(function(exports, module) {
  var tty = __require("tty");
  var util = __require("util");
  exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
  exports.colors = [6, 2, 3, 4, 5, 1];
  try {
    const supportsColor = (()=>{throw new Error("Cannot require module "+"supports-color");})();
    if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
      exports.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ];
    }
  } catch (error) {}
  exports.inspectOpts = Object.keys(process.env).filter((key) => {
    return /^debug_/i.test(key);
  }).reduce((obj, key) => {
    const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
      return k.toUpperCase();
    });
    let val = process.env[key];
    if (/^(yes|on|true|enabled)$/i.test(val)) {
      val = true;
    } else if (/^(no|off|false|disabled)$/i.test(val)) {
      val = false;
    } else if (val === "null") {
      val = null;
    } else {
      val = Number(val);
    }
    obj[prop] = val;
    return obj;
  }, {});
  function useColors() {
    return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
  }
  function formatArgs(args) {
    const { namespace: name, useColors } = this;
    if (useColors) {
      const c = this.color;
      const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
      const prefix = `  ${colorCode};1m${name} \x1B[0m`;
      args[0] = prefix + args[0].split(`
`).join(`
` + prefix);
      args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
    } else {
      args[0] = getDate() + name + " " + args[0];
    }
  }
  function getDate() {
    if (exports.inspectOpts.hideDate) {
      return "";
    }
    return new Date().toISOString() + " ";
  }
  function log(...args) {
    return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + `
`);
  }
  function save(namespaces) {
    if (namespaces) {
      process.env.DEBUG = namespaces;
    } else {
      delete process.env.DEBUG;
    }
  }
  function load() {
    return process.env.DEBUG;
  }
  function init(debug) {
    debug.inspectOpts = {};
    const keys = Object.keys(exports.inspectOpts);
    for (let i = 0;i < keys.length; i++) {
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
    }
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.o = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts).split(`
`).map((str) => str.trim()).join(" ");
  };
  formatters.O = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts);
  };
});

// node_modules/debug/src/index.js
var require_src = __commonJS(function(exports, module) {
  if (typeof process === "undefined" || process.type === "renderer" || false || process.__nwjs) {
    module.exports = require_browser();
  } else {
    module.exports = require_node();
  }
});

// node_modules/engine.io-client/build/esm-debug/transport.js
var import_component_emitter, import_debug, debug, TransportError, Transport;
var init_transport = __esm(() => {
  init_esm();
  init_util();
  import_component_emitter = __toESM(require_cjs(), 1);
  import_debug = __toESM(require_src(), 1);
  debug = import_debug.default("engine.io-client:transport");
  TransportError = class TransportError extends Error {
    constructor(reason, description, context) {
      super(reason);
      this.description = description;
      this.context = context;
      this.type = "TransportError";
    }
  };
  Transport = class Transport extends import_component_emitter.Emitter {
    constructor(opts) {
      super();
      this.writable = false;
      installTimerFunctions(this, opts);
      this.opts = opts;
      this.query = opts.query;
      this.socket = opts.socket;
      this.supportsBinary = !opts.forceBase64;
    }
    onError(reason, description, context) {
      super.emitReserved("error", new TransportError(reason, description, context));
      return this;
    }
    open() {
      this.readyState = "opening";
      this.doOpen();
      return this;
    }
    close() {
      if (this.readyState === "opening" || this.readyState === "open") {
        this.doClose();
        this.onClose();
      }
      return this;
    }
    send(packets) {
      if (this.readyState === "open") {
        this.write(packets);
      } else {
        debug("transport is not open, discarding packets");
      }
    }
    onOpen() {
      this.readyState = "open";
      this.writable = true;
      super.emitReserved("open");
    }
    onData(data) {
      const packet = decodePacket(data, this.socket.binaryType);
      this.onPacket(packet);
    }
    onPacket(packet) {
      super.emitReserved("packet", packet);
    }
    onClose(details) {
      this.readyState = "closed";
      super.emitReserved("close", details);
    }
    pause(onPause) {}
    createUri(schema, query = {}) {
      return schema + "://" + this._hostname() + this._port() + this.opts.path + this._query(query);
    }
    _hostname() {
      const hostname = this.opts.hostname;
      return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
    }
    _port() {
      if (this.opts.port && (this.opts.secure && Number(this.opts.port) !== 443 || !this.opts.secure && Number(this.opts.port) !== 80)) {
        return ":" + this.opts.port;
      } else {
        return "";
      }
    }
    _query(query) {
      const encodedQuery = encode(query);
      return encodedQuery.length ? "?" + encodedQuery : "";
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/transports/polling.js
var import_debug2, debug2, Polling;
var init_polling = __esm(() => {
  init_transport();
  init_util();
  init_esm();
  import_debug2 = __toESM(require_src(), 1);
  debug2 = import_debug2.default("engine.io-client:polling");
  Polling = class Polling extends Transport {
    constructor() {
      super(...arguments);
      this._polling = false;
    }
    get name() {
      return "polling";
    }
    doOpen() {
      this._poll();
    }
    pause(onPause) {
      this.readyState = "pausing";
      const pause = () => {
        debug2("paused");
        this.readyState = "paused";
        onPause();
      };
      if (this._polling || !this.writable) {
        let total = 0;
        if (this._polling) {
          debug2("we are currently polling - waiting to pause");
          total++;
          this.once("pollComplete", function() {
            debug2("pre-pause polling complete");
            --total || pause();
          });
        }
        if (!this.writable) {
          debug2("we are currently writing - waiting to pause");
          total++;
          this.once("drain", function() {
            debug2("pre-pause writing complete");
            --total || pause();
          });
        }
      } else {
        pause();
      }
    }
    _poll() {
      debug2("polling");
      this._polling = true;
      this.doPoll();
      this.emitReserved("poll");
    }
    onData(data) {
      debug2("polling got data %s", data);
      const callback = (packet) => {
        if (this.readyState === "opening" && packet.type === "open") {
          this.onOpen();
        }
        if (packet.type === "close") {
          this.onClose({ description: "transport closed by the server" });
          return false;
        }
        this.onPacket(packet);
      };
      decodePayload(data, this.socket.binaryType).forEach(callback);
      if (this.readyState !== "closed") {
        this._polling = false;
        this.emitReserved("pollComplete");
        if (this.readyState === "open") {
          this._poll();
        } else {
          debug2('ignoring poll - transport state "%s"', this.readyState);
        }
      }
    }
    doClose() {
      const close = () => {
        debug2("writing close packet");
        this.write([{ type: "close" }]);
      };
      if (this.readyState === "open") {
        debug2("transport open - closing");
        close();
      } else {
        debug2("transport not open - deferring close");
        this.once("open", close);
      }
    }
    write(packets) {
      this.writable = false;
      encodePayload(packets, (data) => {
        this.doWrite(data, () => {
          this.writable = true;
          this.emitReserved("drain");
        });
      });
    }
    uri() {
      const schema = this.opts.secure ? "https" : "http";
      const query = this.query || {};
      if (this.opts.timestampRequests !== false) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary && !query.sid) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/contrib/has-cors.js
var value = false, hasCORS;
var init_has_cors = __esm(() => {
  try {
    value = typeof XMLHttpRequest !== "undefined" && "withCredentials" in new XMLHttpRequest;
  } catch (err) {}
  hasCORS = value;
});

// node_modules/engine.io-client/build/esm-debug/transports/polling-xhr.js
function empty() {}
function unloadHandler() {
  for (let i in Request.requests) {
    if (Request.requests.hasOwnProperty(i)) {
      Request.requests[i].abort();
    }
  }
}
function newRequest(opts) {
  const xdomain = opts.xdomain;
  try {
    if (typeof XMLHttpRequest !== "undefined" && (!xdomain || hasCORS)) {
      return new XMLHttpRequest;
    }
  } catch (e) {}
  if (!xdomain) {
    try {
      return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
    } catch (e) {}
  }
}
var import_component_emitter2, import_debug3, debug3, BaseXHR, Request, hasXHR2;
var init_polling_xhr = __esm(() => {
  init_polling();
  init_util();
  init_globals_node();
  init_has_cors();
  import_component_emitter2 = __toESM(require_cjs(), 1);
  import_debug3 = __toESM(require_src(), 1);
  debug3 = import_debug3.default("engine.io-client:polling");
  BaseXHR = class BaseXHR extends Polling {
    constructor(opts) {
      super(opts);
      if (typeof location !== "undefined") {
        const isSSL = location.protocol === "https:";
        let port = location.port;
        if (!port) {
          port = isSSL ? "443" : "80";
        }
        this.xd = typeof location !== "undefined" && opts.hostname !== location.hostname || port !== opts.port;
      }
    }
    doWrite(data, fn) {
      const req = this.request({
        method: "POST",
        data
      });
      req.on("success", fn);
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr post error", xhrStatus, context);
      });
    }
    doPoll() {
      debug3("xhr poll");
      const req = this.request();
      req.on("data", this.onData.bind(this));
      req.on("error", (xhrStatus, context) => {
        this.onError("xhr poll error", xhrStatus, context);
      });
      this.pollXhr = req;
    }
  };
  Request = class Request extends import_component_emitter2.Emitter {
    constructor(createRequest, uri, opts) {
      super();
      this.createRequest = createRequest;
      installTimerFunctions(this, opts);
      this._opts = opts;
      this._method = opts.method || "GET";
      this._uri = uri;
      this._data = opts.data !== undefined ? opts.data : null;
      this._create();
    }
    _create() {
      var _a;
      const opts = pick(this._opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
      opts.xdomain = !!this._opts.xd;
      const xhr = this._xhr = this.createRequest(opts);
      try {
        debug3("xhr open %s: %s", this._method, this._uri);
        xhr.open(this._method, this._uri, true);
        try {
          if (this._opts.extraHeaders) {
            xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
            for (let i in this._opts.extraHeaders) {
              if (this._opts.extraHeaders.hasOwnProperty(i)) {
                xhr.setRequestHeader(i, this._opts.extraHeaders[i]);
              }
            }
          }
        } catch (e) {}
        if (this._method === "POST") {
          try {
            xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
          } catch (e) {}
        }
        try {
          xhr.setRequestHeader("Accept", "*/*");
        } catch (e) {}
        (_a = this._opts.cookieJar) === null || _a === undefined || _a.addCookies(xhr);
        if ("withCredentials" in xhr) {
          xhr.withCredentials = this._opts.withCredentials;
        }
        if (this._opts.requestTimeout) {
          xhr.timeout = this._opts.requestTimeout;
        }
        xhr.onreadystatechange = () => {
          var _a;
          if (xhr.readyState === 3) {
            (_a = this._opts.cookieJar) === null || _a === undefined || _a.parseCookies(xhr.getResponseHeader("set-cookie"));
          }
          if (xhr.readyState !== 4)
            return;
          if (xhr.status === 200 || xhr.status === 1223) {
            this._onLoad();
          } else {
            this.setTimeoutFn(() => {
              this._onError(typeof xhr.status === "number" ? xhr.status : 0);
            }, 0);
          }
        };
        debug3("xhr data %s", this._data);
        xhr.send(this._data);
      } catch (e) {
        this.setTimeoutFn(() => {
          this._onError(e);
        }, 0);
        return;
      }
      if (typeof document !== "undefined") {
        this._index = Request.requestsCount++;
        Request.requests[this._index] = this;
      }
    }
    _onError(err) {
      this.emitReserved("error", err, this._xhr);
      this._cleanup(true);
    }
    _cleanup(fromError) {
      if (typeof this._xhr === "undefined" || this._xhr === null) {
        return;
      }
      this._xhr.onreadystatechange = empty;
      if (fromError) {
        try {
          this._xhr.abort();
        } catch (e) {}
      }
      if (typeof document !== "undefined") {
        delete Request.requests[this._index];
      }
      this._xhr = null;
    }
    _onLoad() {
      const data = this._xhr.responseText;
      if (data !== null) {
        this.emitReserved("data", data);
        this.emitReserved("success");
        this._cleanup();
      }
    }
    abort() {
      this._cleanup();
    }
  };
  Request.requestsCount = 0;
  Request.requests = {};
  if (typeof document !== "undefined") {
    if (typeof attachEvent === "function") {
      attachEvent("onunload", unloadHandler);
    } else if (typeof addEventListener === "function") {
      const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
      addEventListener(terminationEvent, unloadHandler, false);
    }
  }
  hasXHR2 = function() {
    const xhr = newRequest({
      xdomain: false
    });
    return xhr && xhr.responseType !== null;
  }();
});

// node_modules/engine.io-client/build/esm-debug/transports/polling-xhr.node.js
var XMLHttpRequestModule, XMLHttpRequest2, XHR;
var init_polling_xhr_node = __esm(() => {
  init_polling_xhr();
  XMLHttpRequestModule = __toESM(require_XMLHttpRequest(), 1);
  XMLHttpRequest2 = XMLHttpRequestModule.default || XMLHttpRequestModule;
  XHR = class XHR extends BaseXHR {
    request(opts = {}) {
      var _a;
      Object.assign(opts, { xd: this.xd, cookieJar: (_a = this.socket) === null || _a === undefined ? undefined : _a._cookieJar }, this.opts);
      return new Request((opts) => new XMLHttpRequest2(opts), this.uri(), opts);
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/transports/websocket.js
var import_debug4, debug4, isReactNative, BaseWS, WebSocketCtor;
var init_websocket = __esm(() => {
  init_transport();
  init_util();
  init_esm();
  init_globals_node();
  import_debug4 = __toESM(require_src(), 1);
  debug4 = import_debug4.default("engine.io-client:websocket");
  isReactNative = typeof navigator !== "undefined" && typeof navigator.product === "string" && navigator.product.toLowerCase() === "reactnative";
  BaseWS = class BaseWS extends Transport {
    get name() {
      return "websocket";
    }
    doOpen() {
      const uri = this.uri();
      const protocols = this.opts.protocols;
      const opts = isReactNative ? {} : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
      if (this.opts.extraHeaders) {
        opts.headers = this.opts.extraHeaders;
      }
      try {
        this.ws = this.createSocket(uri, protocols, opts);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this.ws.binaryType = this.socket.binaryType;
      this.addEventListeners();
    }
    addEventListeners() {
      this.ws.onopen = () => {
        if (this.opts.autoUnref) {
          this.ws._socket.unref();
        }
        this.onOpen();
      };
      this.ws.onclose = (closeEvent) => this.onClose({
        description: "websocket connection closed",
        context: closeEvent
      });
      this.ws.onmessage = (ev) => this.onData(ev.data);
      this.ws.onerror = (e) => this.onError("websocket error", e);
    }
    write(packets) {
      this.writable = false;
      for (let i = 0;i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        encodePacket(packet, this.supportsBinary, (data) => {
          try {
            this.doWrite(packet, data);
          } catch (e) {
            debug4("websocket closed before onclose event");
          }
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      if (typeof this.ws !== "undefined") {
        this.ws.onerror = () => {};
        this.ws.close();
        this.ws = null;
      }
    }
    uri() {
      const schema = this.opts.secure ? "wss" : "ws";
      const query = this.query || {};
      if (this.opts.timestampRequests) {
        query[this.opts.timestampParam] = randomString();
      }
      if (!this.supportsBinary) {
        query.b64 = 1;
      }
      return this.createUri(schema, query);
    }
  };
  WebSocketCtor = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
});

// node_modules/engine.io-client/build/esm-debug/transports/websocket.node.js
import * as ws from "ws";
var WS;
var init_websocket_node = __esm(() => {
  init_websocket();
  WS = class WS extends BaseWS {
    createSocket(uri, protocols, opts) {
      var _a;
      if ((_a = this.socket) === null || _a === undefined ? undefined : _a._cookieJar) {
        opts.headers = opts.headers || {};
        opts.headers.cookie = typeof opts.headers.cookie === "string" ? [opts.headers.cookie] : opts.headers.cookie || [];
        for (const [name, cookie] of this.socket._cookieJar.cookies) {
          opts.headers.cookie.push(`${name}=${cookie.value}`);
        }
      }
      return new ws.WebSocket(uri, protocols, opts);
    }
    doWrite(packet, data) {
      const opts = {};
      if (packet.options) {
        opts.compress = packet.options.compress;
      }
      if (this.opts.perMessageDeflate) {
        const len = typeof data === "string" ? Buffer.byteLength(data) : data.length;
        if (len < this.opts.perMessageDeflate.threshold) {
          opts.compress = false;
        }
      }
      this.ws.send(data, opts);
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/transports/webtransport.js
var import_debug5, debug5, WT;
var init_webtransport = __esm(() => {
  init_transport();
  init_globals_node();
  init_esm();
  import_debug5 = __toESM(require_src(), 1);
  debug5 = import_debug5.default("engine.io-client:webtransport");
  WT = class WT extends Transport {
    get name() {
      return "webtransport";
    }
    doOpen() {
      try {
        this._transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
      } catch (err) {
        return this.emitReserved("error", err);
      }
      this._transport.closed.then(() => {
        debug5("transport closed gracefully");
        this.onClose();
      }).catch((err) => {
        debug5("transport closed due to %s", err);
        this.onError("webtransport error", err);
      });
      this._transport.ready.then(() => {
        this._transport.createBidirectionalStream().then((stream) => {
          const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
          const reader = stream.readable.pipeThrough(decoderStream).getReader();
          const encoderStream = createPacketEncoderStream();
          encoderStream.readable.pipeTo(stream.writable);
          this._writer = encoderStream.writable.getWriter();
          const read = () => {
            reader.read().then(({ done, value }) => {
              if (done) {
                debug5("session is closed");
                return;
              }
              debug5("received chunk: %o", value);
              this.onPacket(value);
              read();
            }).catch((err) => {
              debug5("an error occurred while reading: %s", err);
            });
          };
          read();
          const packet = { type: "open" };
          if (this.query.sid) {
            packet.data = `{"sid":"${this.query.sid}"}`;
          }
          this._writer.write(packet).then(() => this.onOpen());
        });
      });
    }
    write(packets) {
      this.writable = false;
      for (let i = 0;i < packets.length; i++) {
        const packet = packets[i];
        const lastPacket = i === packets.length - 1;
        this._writer.write(packet).then(() => {
          if (lastPacket) {
            nextTick(() => {
              this.writable = true;
              this.emitReserved("drain");
            }, this.setTimeoutFn);
          }
        });
      }
    }
    doClose() {
      var _a;
      (_a = this._transport) === null || _a === undefined || _a.close();
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/transports/index.js
var transports;
var init_transports = __esm(() => {
  init_polling_xhr_node();
  init_websocket_node();
  init_webtransport();
  transports = {
    websocket: WS,
    webtransport: WT,
    polling: XHR
  };
});

// node_modules/engine.io-client/build/esm-debug/contrib/parseuri.js
function parse2(str) {
  if (str.length > 8000) {
    throw "URI too long";
  }
  const src = str, b = str.indexOf("["), e = str.indexOf("]");
  if (b != -1 && e != -1) {
    str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ";") + str.substring(e, str.length);
  }
  let m = re.exec(str || ""), uri = {}, i = 14;
  while (i--) {
    uri[parts[i]] = m[i] || "";
  }
  if (b != -1 && e != -1) {
    uri.source = src;
    uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ":");
    uri.authority = uri.authority.replace("[", "").replace("]", "").replace(/;/g, ":");
    uri.ipv6uri = true;
  }
  uri.pathNames = pathNames(uri, uri["path"]);
  uri.queryKey = queryKey(uri, uri["query"]);
  return uri;
}
function pathNames(obj, path) {
  const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
  if (path.slice(0, 1) == "/" || path.length === 0) {
    names.splice(0, 1);
  }
  if (path.slice(-1) == "/") {
    names.splice(names.length - 1, 1);
  }
  return names;
}
function queryKey(uri, query) {
  const data = {};
  query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function($0, $1, $2) {
    if ($1) {
      data[$1] = $2;
    }
  });
  return data;
}
var re, parts;
var init_parseuri = __esm(() => {
  re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
  parts = [
    "source",
    "protocol",
    "authority",
    "userInfo",
    "user",
    "password",
    "host",
    "port",
    "relative",
    "path",
    "directory",
    "file",
    "query",
    "anchor"
  ];
});

// node_modules/engine.io-client/build/esm-debug/socket.js
var import_component_emitter3, import_debug6, debug6, withEventListeners, OFFLINE_EVENT_LISTENERS, SocketWithoutUpgrade, SocketWithUpgrade, Socket;
var init_socket = __esm(() => {
  init_transports();
  init_util();
  init_parseuri();
  init_esm();
  init_globals_node();
  import_component_emitter3 = __toESM(require_cjs(), 1);
  import_debug6 = __toESM(require_src(), 1);
  debug6 = import_debug6.default("engine.io-client:socket");
  withEventListeners = typeof addEventListener === "function" && typeof removeEventListener === "function";
  OFFLINE_EVENT_LISTENERS = [];
  if (withEventListeners) {
    addEventListener("offline", () => {
      debug6("closing %d connection(s) because the network was lost", OFFLINE_EVENT_LISTENERS.length);
      OFFLINE_EVENT_LISTENERS.forEach((listener) => listener());
    }, false);
  }
  SocketWithoutUpgrade = class SocketWithoutUpgrade extends import_component_emitter3.Emitter {
    constructor(uri, opts) {
      super();
      this.binaryType = defaultBinaryType;
      this.writeBuffer = [];
      this._prevBufferLen = 0;
      this._pingInterval = -1;
      this._pingTimeout = -1;
      this._maxPayload = -1;
      this._pingTimeoutTime = Infinity;
      if (uri && typeof uri === "object") {
        opts = uri;
        uri = null;
      }
      if (uri) {
        const parsedUri = parse2(uri);
        opts.hostname = parsedUri.host;
        opts.secure = parsedUri.protocol === "https" || parsedUri.protocol === "wss";
        opts.port = parsedUri.port;
        if (parsedUri.query)
          opts.query = parsedUri.query;
      } else if (opts.host) {
        opts.hostname = parse2(opts.host).host;
      }
      installTimerFunctions(this, opts);
      this.secure = opts.secure != null ? opts.secure : typeof location !== "undefined" && location.protocol === "https:";
      if (opts.hostname && !opts.port) {
        opts.port = this.secure ? "443" : "80";
      }
      this.hostname = opts.hostname || (typeof location !== "undefined" ? location.hostname : "localhost");
      this.port = opts.port || (typeof location !== "undefined" && location.port ? location.port : this.secure ? "443" : "80");
      this.transports = [];
      this._transportsByName = {};
      opts.transports.forEach((t) => {
        const transportName = t.prototype.name;
        this.transports.push(transportName);
        this._transportsByName[transportName] = t;
      });
      this.opts = Object.assign({
        path: "/engine.io",
        agent: false,
        withCredentials: false,
        upgrade: true,
        timestampParam: "t",
        rememberUpgrade: false,
        addTrailingSlash: true,
        rejectUnauthorized: true,
        perMessageDeflate: {
          threshold: 1024
        },
        transportOptions: {},
        closeOnBeforeunload: false
      }, opts);
      this.opts.path = this.opts.path.replace(/\/$/, "") + (this.opts.addTrailingSlash ? "/" : "");
      if (typeof this.opts.query === "string") {
        this.opts.query = decode(this.opts.query);
      }
      if (withEventListeners) {
        if (this.opts.closeOnBeforeunload) {
          this._beforeunloadEventListener = () => {
            if (this.transport) {
              this.transport.removeAllListeners();
              this.transport.close();
            }
          };
          addEventListener("beforeunload", this._beforeunloadEventListener, false);
        }
        if (this.hostname !== "localhost") {
          debug6("adding listener for the 'offline' event");
          this._offlineEventListener = () => {
            this._onClose("transport close", {
              description: "network connection lost"
            });
          };
          OFFLINE_EVENT_LISTENERS.push(this._offlineEventListener);
        }
      }
      if (this.opts.withCredentials) {
        this._cookieJar = createCookieJar();
      }
      this._open();
    }
    createTransport(name) {
      debug6('creating transport "%s"', name);
      const query = Object.assign({}, this.opts.query);
      query.EIO = protocol;
      query.transport = name;
      if (this.id)
        query.sid = this.id;
      const opts = Object.assign({}, this.opts, {
        query,
        socket: this,
        hostname: this.hostname,
        secure: this.secure,
        port: this.port
      }, this.opts.transportOptions[name]);
      debug6("options: %j", opts);
      return new this._transportsByName[name](opts);
    }
    _open() {
      if (this.transports.length === 0) {
        this.setTimeoutFn(() => {
          this.emitReserved("error", "No transports available");
        }, 0);
        return;
      }
      const transportName = this.opts.rememberUpgrade && SocketWithoutUpgrade.priorWebsocketSuccess && this.transports.indexOf("websocket") !== -1 ? "websocket" : this.transports[0];
      this.readyState = "opening";
      const transport = this.createTransport(transportName);
      transport.open();
      this.setTransport(transport);
    }
    setTransport(transport) {
      debug6("setting transport %s", transport.name);
      if (this.transport) {
        debug6("clearing existing transport %s", this.transport.name);
        this.transport.removeAllListeners();
      }
      this.transport = transport;
      transport.on("drain", this._onDrain.bind(this)).on("packet", this._onPacket.bind(this)).on("error", this._onError.bind(this)).on("close", (reason) => this._onClose("transport close", reason));
    }
    onOpen() {
      debug6("socket open");
      this.readyState = "open";
      SocketWithoutUpgrade.priorWebsocketSuccess = this.transport.name === "websocket";
      this.emitReserved("open");
      this.flush();
    }
    _onPacket(packet) {
      if (this.readyState === "opening" || this.readyState === "open" || this.readyState === "closing") {
        debug6('socket receive: type "%s", data "%s"', packet.type, packet.data);
        this.emitReserved("packet", packet);
        this.emitReserved("heartbeat");
        switch (packet.type) {
          case "open":
            this.onHandshake(JSON.parse(packet.data));
            break;
          case "ping":
            this._sendPacket("pong");
            this.emitReserved("ping");
            this.emitReserved("pong");
            this._resetPingTimeout();
            break;
          case "error":
            const err = new Error("server error");
            err.code = packet.data;
            this._onError(err);
            break;
          case "message":
            this.emitReserved("data", packet.data);
            this.emitReserved("message", packet.data);
            break;
        }
      } else {
        debug6('packet received with socket readyState "%s"', this.readyState);
      }
    }
    onHandshake(data) {
      this.emitReserved("handshake", data);
      this.id = data.sid;
      this.transport.query.sid = data.sid;
      this._pingInterval = data.pingInterval;
      this._pingTimeout = data.pingTimeout;
      this._maxPayload = data.maxPayload;
      this.onOpen();
      if (this.readyState === "closed")
        return;
      this._resetPingTimeout();
    }
    _resetPingTimeout() {
      this.clearTimeoutFn(this._pingTimeoutTimer);
      const delay = this._pingInterval + this._pingTimeout;
      this._pingTimeoutTime = Date.now() + delay;
      this._pingTimeoutTimer = this.setTimeoutFn(() => {
        this._onClose("ping timeout");
      }, delay);
      if (this.opts.autoUnref) {
        this._pingTimeoutTimer.unref();
      }
    }
    _onDrain() {
      this.writeBuffer.splice(0, this._prevBufferLen);
      this._prevBufferLen = 0;
      if (this.writeBuffer.length === 0) {
        this.emitReserved("drain");
      } else {
        this.flush();
      }
    }
    flush() {
      if (this.readyState !== "closed" && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
        const packets = this._getWritablePackets();
        debug6("flushing %d packets in socket", packets.length);
        this.transport.send(packets);
        this._prevBufferLen = packets.length;
        this.emitReserved("flush");
      }
    }
    _getWritablePackets() {
      const shouldCheckPayloadSize = this._maxPayload && this.transport.name === "polling" && this.writeBuffer.length > 1;
      if (!shouldCheckPayloadSize) {
        return this.writeBuffer;
      }
      let payloadSize = 1;
      for (let i = 0;i < this.writeBuffer.length; i++) {
        const data = this.writeBuffer[i].data;
        if (data) {
          payloadSize += byteLength(data);
        }
        if (i > 0 && payloadSize > this._maxPayload) {
          debug6("only send %d out of %d packets", i, this.writeBuffer.length);
          return this.writeBuffer.slice(0, i);
        }
        payloadSize += 2;
      }
      debug6("payload size is %d (max: %d)", payloadSize, this._maxPayload);
      return this.writeBuffer;
    }
    _hasPingExpired() {
      if (!this._pingTimeoutTime)
        return true;
      const hasExpired = Date.now() > this._pingTimeoutTime;
      if (hasExpired) {
        debug6("throttled timer detected, scheduling connection close");
        this._pingTimeoutTime = 0;
        nextTick(() => {
          this._onClose("ping timeout");
        }, this.setTimeoutFn);
      }
      return hasExpired;
    }
    write(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    send(msg, options, fn) {
      this._sendPacket("message", msg, options, fn);
      return this;
    }
    _sendPacket(type, data, options, fn) {
      if (typeof data === "function") {
        fn = data;
        data = undefined;
      }
      if (typeof options === "function") {
        fn = options;
        options = null;
      }
      if (this.readyState === "closing" || this.readyState === "closed") {
        return;
      }
      options = options || {};
      options.compress = options.compress !== false;
      const packet = {
        type,
        data,
        options
      };
      this.emitReserved("packetCreate", packet);
      this.writeBuffer.push(packet);
      if (fn)
        this.once("flush", fn);
      this.flush();
    }
    close() {
      const close = () => {
        this._onClose("forced close");
        debug6("socket closing - telling transport to close");
        this.transport.close();
      };
      const cleanupAndClose = () => {
        this.off("upgrade", cleanupAndClose);
        this.off("upgradeError", cleanupAndClose);
        close();
      };
      const waitForUpgrade = () => {
        this.once("upgrade", cleanupAndClose);
        this.once("upgradeError", cleanupAndClose);
      };
      if (this.readyState === "opening" || this.readyState === "open") {
        this.readyState = "closing";
        if (this.writeBuffer.length) {
          this.once("drain", () => {
            if (this.upgrading) {
              waitForUpgrade();
            } else {
              close();
            }
          });
        } else if (this.upgrading) {
          waitForUpgrade();
        } else {
          close();
        }
      }
      return this;
    }
    _onError(err) {
      debug6("socket error %j", err);
      SocketWithoutUpgrade.priorWebsocketSuccess = false;
      if (this.opts.tryAllTransports && this.transports.length > 1 && this.readyState === "opening") {
        debug6("trying next transport");
        this.transports.shift();
        return this._open();
      }
      this.emitReserved("error", err);
      this._onClose("transport error", err);
    }
    _onClose(reason, description) {
      if (this.readyState === "opening" || this.readyState === "open" || this.readyState === "closing") {
        debug6('socket close with reason: "%s"', reason);
        this.clearTimeoutFn(this._pingTimeoutTimer);
        this.transport.removeAllListeners("close");
        this.transport.close();
        this.transport.removeAllListeners();
        if (withEventListeners) {
          if (this._beforeunloadEventListener) {
            removeEventListener("beforeunload", this._beforeunloadEventListener, false);
          }
          if (this._offlineEventListener) {
            const i = OFFLINE_EVENT_LISTENERS.indexOf(this._offlineEventListener);
            if (i !== -1) {
              debug6("removing listener for the 'offline' event");
              OFFLINE_EVENT_LISTENERS.splice(i, 1);
            }
          }
        }
        this.readyState = "closed";
        this.id = null;
        this.emitReserved("close", reason, description);
        this.writeBuffer = [];
        this._prevBufferLen = 0;
      }
    }
  };
  SocketWithoutUpgrade.protocol = protocol;
  SocketWithUpgrade = class SocketWithUpgrade extends SocketWithoutUpgrade {
    constructor() {
      super(...arguments);
      this._upgrades = [];
    }
    onOpen() {
      super.onOpen();
      if (this.readyState === "open" && this.opts.upgrade) {
        debug6("starting upgrade probes");
        for (let i = 0;i < this._upgrades.length; i++) {
          this._probe(this._upgrades[i]);
        }
      }
    }
    _probe(name) {
      debug6('probing transport "%s"', name);
      let transport = this.createTransport(name);
      let failed = false;
      SocketWithoutUpgrade.priorWebsocketSuccess = false;
      const onTransportOpen = () => {
        if (failed)
          return;
        debug6('probe transport "%s" opened', name);
        transport.send([{ type: "ping", data: "probe" }]);
        transport.once("packet", (msg) => {
          if (failed)
            return;
          if (msg.type === "pong" && msg.data === "probe") {
            debug6('probe transport "%s" pong', name);
            this.upgrading = true;
            this.emitReserved("upgrading", transport);
            if (!transport)
              return;
            SocketWithoutUpgrade.priorWebsocketSuccess = transport.name === "websocket";
            debug6('pausing current transport "%s"', this.transport.name);
            this.transport.pause(() => {
              if (failed)
                return;
              if (this.readyState === "closed")
                return;
              debug6("changing transport and sending upgrade packet");
              cleanup();
              this.setTransport(transport);
              transport.send([{ type: "upgrade" }]);
              this.emitReserved("upgrade", transport);
              transport = null;
              this.upgrading = false;
              this.flush();
            });
          } else {
            debug6('probe transport "%s" failed', name);
            const err = new Error("probe error");
            err.transport = transport.name;
            this.emitReserved("upgradeError", err);
          }
        });
      };
      function freezeTransport() {
        if (failed)
          return;
        failed = true;
        cleanup();
        transport.close();
        transport = null;
      }
      const onerror = (err) => {
        const error = new Error("probe error: " + err);
        error.transport = transport.name;
        freezeTransport();
        debug6('probe transport "%s" failed because of error: %s', name, err);
        this.emitReserved("upgradeError", error);
      };
      function onTransportClose() {
        onerror("transport closed");
      }
      function onclose() {
        onerror("socket closed");
      }
      function onupgrade(to) {
        if (transport && to.name !== transport.name) {
          debug6('"%s" works - aborting "%s"', to.name, transport.name);
          freezeTransport();
        }
      }
      const cleanup = () => {
        transport.removeListener("open", onTransportOpen);
        transport.removeListener("error", onerror);
        transport.removeListener("close", onTransportClose);
        this.off("close", onclose);
        this.off("upgrading", onupgrade);
      };
      transport.once("open", onTransportOpen);
      transport.once("error", onerror);
      transport.once("close", onTransportClose);
      this.once("close", onclose);
      this.once("upgrading", onupgrade);
      if (this._upgrades.indexOf("webtransport") !== -1 && name !== "webtransport") {
        this.setTimeoutFn(() => {
          if (!failed) {
            transport.open();
          }
        }, 200);
      } else {
        transport.open();
      }
    }
    onHandshake(data) {
      this._upgrades = this._filterUpgrades(data.upgrades);
      super.onHandshake(data);
    }
    _filterUpgrades(upgrades) {
      const filteredUpgrades = [];
      for (let i = 0;i < upgrades.length; i++) {
        if (~this.transports.indexOf(upgrades[i]))
          filteredUpgrades.push(upgrades[i]);
      }
      return filteredUpgrades;
    }
  };
  Socket = class Socket extends SocketWithUpgrade {
    constructor(uri, opts = {}) {
      const isOptionsOnly = typeof uri === "object";
      const o = isOptionsOnly ? { ...uri } : { ...opts };
      if (!o.transports || o.transports && typeof o.transports[0] === "string") {
        o.transports = (o.transports || ["polling", "websocket", "webtransport"]).map((transportName) => transports[transportName]).filter((t) => !!t);
      }
      super(isOptionsOnly ? o : uri, o);
    }
  };
});

// node_modules/engine.io-client/build/esm-debug/transports/polling-fetch.js
var init_polling_fetch = __esm(() => {
  init_polling();
});

// node_modules/engine.io-client/build/esm-debug/index.js
var protocol2;
var init_esm_debug = __esm(() => {
  init_socket();
  init_socket();
  init_transport();
  init_transports();
  init_util();
  init_parseuri();
  init_globals_node();
  init_polling_fetch();
  init_polling_xhr_node();
  init_polling_xhr();
  init_websocket_node();
  init_websocket();
  init_webtransport();
  protocol2 = Socket.protocol;
});

// node_modules/socket.io-client/build/esm-debug/url.js
function url(uri, path = "", loc) {
  let obj = uri;
  loc = loc || typeof location !== "undefined" && location;
  if (uri == null)
    uri = loc.protocol + "//" + loc.host;
  if (typeof uri === "string") {
    if (uri.charAt(0) === "/") {
      if (uri.charAt(1) === "/") {
        uri = loc.protocol + uri;
      } else {
        uri = loc.host + uri;
      }
    }
    if (!/^(https?|wss?):\/\//.test(uri)) {
      debug7("protocol-less url %s", uri);
      if (typeof loc !== "undefined") {
        uri = loc.protocol + "//" + uri;
      } else {
        uri = "https://" + uri;
      }
    }
    debug7("parse %s", uri);
    obj = parse2(uri);
  }
  if (!obj.port) {
    if (/^(http|ws)$/.test(obj.protocol)) {
      obj.port = "80";
    } else if (/^(http|ws)s$/.test(obj.protocol)) {
      obj.port = "443";
    }
  }
  obj.path = obj.path || "/";
  const ipv6 = obj.host.indexOf(":") !== -1;
  const host = ipv6 ? "[" + obj.host + "]" : obj.host;
  obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
  obj.href = obj.protocol + "://" + host + (loc && loc.port === obj.port ? "" : ":" + obj.port);
  return obj;
}
var import_debug7, debug7;
var init_url = __esm(() => {
  init_esm_debug();
  import_debug7 = __toESM(require_src(), 1);
  debug7 = import_debug7.default("socket.io-client:url");
});

// node_modules/socket.io-parser/build/esm-debug/is-binary.js
function isBinary(obj) {
  return withNativeArrayBuffer && (obj instanceof ArrayBuffer || isView(obj)) || withNativeBlob && obj instanceof Blob || withNativeFile && obj instanceof File;
}
function hasBinary(obj, toJSON) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  if (Array.isArray(obj)) {
    for (let i = 0, l = obj.length;i < l; i++) {
      if (hasBinary(obj[i])) {
        return true;
      }
    }
    return false;
  }
  if (isBinary(obj)) {
    return true;
  }
  if (obj.toJSON && typeof obj.toJSON === "function" && arguments.length === 1) {
    return hasBinary(obj.toJSON(), true);
  }
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
      return true;
    }
  }
  return false;
}
var withNativeArrayBuffer, isView = (obj) => {
  return typeof ArrayBuffer.isView === "function" ? ArrayBuffer.isView(obj) : obj.buffer instanceof ArrayBuffer;
}, toString, withNativeBlob, withNativeFile;
var init_is_binary = __esm(() => {
  withNativeArrayBuffer = typeof ArrayBuffer === "function";
  toString = Object.prototype.toString;
  withNativeBlob = typeof Blob === "function" || typeof Blob !== "undefined" && toString.call(Blob) === "[object BlobConstructor]";
  withNativeFile = typeof File === "function" || typeof File !== "undefined" && toString.call(File) === "[object FileConstructor]";
});

// node_modules/socket.io-parser/build/esm-debug/binary.js
function deconstructPacket(packet) {
  const buffers = [];
  const packetData = packet.data;
  const pack = packet;
  pack.data = _deconstructPacket(packetData, buffers);
  pack.attachments = buffers.length;
  return { packet: pack, buffers };
}
function _deconstructPacket(data, buffers) {
  if (!data)
    return data;
  if (isBinary(data)) {
    const placeholder = { _placeholder: true, num: buffers.length };
    buffers.push(data);
    return placeholder;
  } else if (Array.isArray(data)) {
    const newData = new Array(data.length);
    for (let i = 0;i < data.length; i++) {
      newData[i] = _deconstructPacket(data[i], buffers);
    }
    return newData;
  } else if (typeof data === "object" && !(data instanceof Date)) {
    const newData = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newData[key] = _deconstructPacket(data[key], buffers);
      }
    }
    return newData;
  }
  return data;
}
function reconstructPacket(packet, buffers) {
  packet.data = _reconstructPacket(packet.data, buffers);
  delete packet.attachments;
  return packet;
}
function _reconstructPacket(data, buffers) {
  if (!data)
    return data;
  if (data && data._placeholder === true) {
    const isIndexValid = typeof data.num === "number" && data.num >= 0 && data.num < buffers.length;
    if (isIndexValid) {
      return buffers[data.num];
    } else {
      throw new Error("illegal attachments");
    }
  } else if (Array.isArray(data)) {
    for (let i = 0;i < data.length; i++) {
      data[i] = _reconstructPacket(data[i], buffers);
    }
  } else if (typeof data === "object") {
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        data[key] = _reconstructPacket(data[key], buffers);
      }
    }
  }
  return data;
}
var init_binary = __esm(() => {
  init_is_binary();
});

// node_modules/socket.io-parser/build/esm-debug/index.js
var exports_esm_debug = {};
__export(exports_esm_debug, {
  Decoder: () => Decoder,
  Encoder: () => Encoder,
  PacketType: () => PacketType,
  isPacketValid: () => isPacketValid,
  protocol: () => protocol3
});

class Encoder {
  constructor(replacer) {
    this.replacer = replacer;
  }
  encode(obj) {
    debug8("encoding packet %j", obj);
    if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
      if (hasBinary(obj)) {
        return this.encodeAsBinary({
          type: obj.type === PacketType.EVENT ? PacketType.BINARY_EVENT : PacketType.BINARY_ACK,
          nsp: obj.nsp,
          data: obj.data,
          id: obj.id
        });
      }
    }
    return [this.encodeAsString(obj)];
  }
  encodeAsString(obj) {
    let str = "" + obj.type;
    if (obj.type === PacketType.BINARY_EVENT || obj.type === PacketType.BINARY_ACK) {
      str += obj.attachments + "-";
    }
    if (obj.nsp && obj.nsp !== "/") {
      str += obj.nsp + ",";
    }
    if (obj.id != null) {
      str += obj.id;
    }
    if (obj.data != null) {
      str += JSON.stringify(obj.data, this.replacer);
    }
    debug8("encoded %j as %s", obj, str);
    return str;
  }
  encodeAsBinary(obj) {
    const deconstruction = deconstructPacket(obj);
    const pack = this.encodeAsString(deconstruction.packet);
    const buffers = deconstruction.buffers;
    buffers.unshift(pack);
    return buffers;
  }
}

class BinaryReconstructor {
  constructor(packet) {
    this.packet = packet;
    this.buffers = [];
    this.reconPack = packet;
  }
  takeBinaryData(binData) {
    this.buffers.push(binData);
    if (this.buffers.length === this.reconPack.attachments) {
      const packet = reconstructPacket(this.reconPack, this.buffers);
      this.finishedReconstruction();
      return packet;
    }
    return null;
  }
  finishedReconstruction() {
    this.reconPack = null;
    this.buffers = [];
  }
}
function isNamespaceValid(nsp) {
  return typeof nsp === "string";
}
function isAckIdValid(id) {
  return id === undefined || isInteger(id);
}
function isObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
function isDataValid(type, payload) {
  switch (type) {
    case PacketType.CONNECT:
      return payload === undefined || isObject(payload);
    case PacketType.DISCONNECT:
      return payload === undefined;
    case PacketType.EVENT:
      return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
    case PacketType.ACK:
      return Array.isArray(payload);
    case PacketType.CONNECT_ERROR:
      return typeof payload === "string" || isObject(payload);
    default:
      return false;
  }
}
function isPacketValid(packet) {
  return isNamespaceValid(packet.nsp) && isAckIdValid(packet.id) && isDataValid(packet.type, packet.data);
}
var import_component_emitter4, import_debug8, debug8, RESERVED_EVENTS, protocol3 = 5, PacketType, Decoder, isInteger;
var init_esm_debug2 = __esm(() => {
  init_binary();
  init_is_binary();
  import_component_emitter4 = __toESM(require_cjs(), 1);
  import_debug8 = __toESM(require_src(), 1);
  debug8 = import_debug8.default("socket.io-parser");
  RESERVED_EVENTS = [
    "connect",
    "connect_error",
    "disconnect",
    "disconnecting",
    "newListener",
    "removeListener"
  ];
  (function(PacketType2) {
    PacketType2[PacketType2["CONNECT"] = 0] = "CONNECT";
    PacketType2[PacketType2["DISCONNECT"] = 1] = "DISCONNECT";
    PacketType2[PacketType2["EVENT"] = 2] = "EVENT";
    PacketType2[PacketType2["ACK"] = 3] = "ACK";
    PacketType2[PacketType2["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
    PacketType2[PacketType2["BINARY_EVENT"] = 5] = "BINARY_EVENT";
    PacketType2[PacketType2["BINARY_ACK"] = 6] = "BINARY_ACK";
  })(PacketType || (PacketType = {}));
  Decoder = class Decoder extends import_component_emitter4.Emitter {
    constructor(opts) {
      super();
      this.opts = Object.assign({
        reviver: undefined,
        maxAttachments: 10
      }, typeof opts === "function" ? { reviver: opts } : opts);
    }
    add(obj) {
      let packet;
      if (typeof obj === "string") {
        if (this.reconstructor) {
          throw new Error("got plaintext data when reconstructing a packet");
        }
        packet = this.decodeString(obj);
        const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
        if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
          packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
          this.reconstructor = new BinaryReconstructor(packet);
          if (packet.attachments === 0) {
            super.emitReserved("decoded", packet);
          }
        } else {
          super.emitReserved("decoded", packet);
        }
      } else if (isBinary(obj) || obj.base64) {
        if (!this.reconstructor) {
          throw new Error("got binary data when not reconstructing a packet");
        } else {
          packet = this.reconstructor.takeBinaryData(obj);
          if (packet) {
            this.reconstructor = null;
            super.emitReserved("decoded", packet);
          }
        }
      } else {
        throw new Error("Unknown type: " + obj);
      }
    }
    decodeString(str) {
      let i = 0;
      const p = {
        type: Number(str.charAt(0))
      };
      if (PacketType[p.type] === undefined) {
        throw new Error("unknown packet type " + p.type);
      }
      if (p.type === PacketType.BINARY_EVENT || p.type === PacketType.BINARY_ACK) {
        const start = i + 1;
        while (str.charAt(++i) !== "-" && i != str.length) {}
        const buf = str.substring(start, i);
        if (buf != Number(buf) || str.charAt(i) !== "-") {
          throw new Error("Illegal attachments");
        }
        const n = Number(buf);
        if (!isInteger(n) || n < 0) {
          throw new Error("Illegal attachments");
        } else if (n > this.opts.maxAttachments) {
          throw new Error("too many attachments");
        }
        p.attachments = n;
      }
      if (str.charAt(i + 1) === "/") {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if (c === ",")
            break;
          if (i === str.length)
            break;
        }
        p.nsp = str.substring(start, i);
      } else {
        p.nsp = "/";
      }
      const next = str.charAt(i + 1);
      if (next !== "" && Number(next) == next) {
        const start = i + 1;
        while (++i) {
          const c = str.charAt(i);
          if (c == null || Number(c) != c) {
            --i;
            break;
          }
          if (i === str.length)
            break;
        }
        p.id = Number(str.substring(start, i + 1));
      }
      if (str.charAt(++i)) {
        const payload = this.tryParse(str.substr(i));
        if (Decoder.isPayloadValid(p.type, payload)) {
          p.data = payload;
        } else {
          throw new Error("invalid payload");
        }
      }
      debug8("decoded %s as %j", str, p);
      return p;
    }
    tryParse(str) {
      try {
        return JSON.parse(str, this.opts.reviver);
      } catch (e) {
        return false;
      }
    }
    static isPayloadValid(type, payload) {
      switch (type) {
        case PacketType.CONNECT:
          return isObject(payload);
        case PacketType.DISCONNECT:
          return payload === undefined;
        case PacketType.CONNECT_ERROR:
          return typeof payload === "string" || isObject(payload);
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          return Array.isArray(payload) && (typeof payload[0] === "number" || typeof payload[0] === "string" && RESERVED_EVENTS.indexOf(payload[0]) === -1);
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          return Array.isArray(payload);
      }
    }
    destroy() {
      if (this.reconstructor) {
        this.reconstructor.finishedReconstruction();
        this.reconstructor = null;
      }
    }
  };
  isInteger = Number.isInteger || function(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  };
});

// node_modules/socket.io-client/build/esm-debug/on.js
function on(obj, ev, fn) {
  obj.on(ev, fn);
  return function subDestroy() {
    obj.off(ev, fn);
  };
}

// node_modules/socket.io-client/build/esm-debug/socket.js
var import_component_emitter5, import_debug9, debug9, RESERVED_EVENTS2, Socket2;
var init_socket2 = __esm(() => {
  init_esm_debug2();
  import_component_emitter5 = __toESM(require_cjs(), 1);
  import_debug9 = __toESM(require_src(), 1);
  debug9 = import_debug9.default("socket.io-client:socket");
  RESERVED_EVENTS2 = Object.freeze({
    connect: 1,
    connect_error: 1,
    disconnect: 1,
    disconnecting: 1,
    newListener: 1,
    removeListener: 1
  });
  Socket2 = class Socket2 extends import_component_emitter5.Emitter {
    constructor(io, nsp, opts) {
      super();
      this.connected = false;
      this.recovered = false;
      this.receiveBuffer = [];
      this.sendBuffer = [];
      this._queue = [];
      this._queueSeq = 0;
      this.ids = 0;
      this.acks = {};
      this.flags = {};
      this.io = io;
      this.nsp = nsp;
      if (opts && opts.auth) {
        this.auth = opts.auth;
      }
      this._opts = Object.assign({}, opts);
      if (this.io._autoConnect)
        this.open();
    }
    get disconnected() {
      return !this.connected;
    }
    subEvents() {
      if (this.subs)
        return;
      const io = this.io;
      this.subs = [
        on(io, "open", this.onopen.bind(this)),
        on(io, "packet", this.onpacket.bind(this)),
        on(io, "error", this.onerror.bind(this)),
        on(io, "close", this.onclose.bind(this))
      ];
    }
    get active() {
      return !!this.subs;
    }
    connect() {
      if (this.connected)
        return this;
      this.subEvents();
      if (!this.io["_reconnecting"])
        this.io.open();
      if (this.io._readyState === "open")
        this.onopen();
      return this;
    }
    open() {
      return this.connect();
    }
    send(...args) {
      args.unshift("message");
      this.emit.apply(this, args);
      return this;
    }
    emit(ev, ...args) {
      var _a, _b, _c;
      if (RESERVED_EVENTS2.hasOwnProperty(ev)) {
        throw new Error('"' + ev.toString() + '" is a reserved event name');
      }
      args.unshift(ev);
      if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
        this._addToQueue(args);
        return this;
      }
      const packet = {
        type: PacketType.EVENT,
        data: args
      };
      packet.options = {};
      packet.options.compress = this.flags.compress !== false;
      if (typeof args[args.length - 1] === "function") {
        const id = this.ids++;
        debug9("emitting packet with ack id %d", id);
        const ack = args.pop();
        this._registerAckCallback(id, ack);
        packet.id = id;
      }
      const isTransportWritable = (_b = (_a = this.io.engine) === null || _a === undefined ? undefined : _a.transport) === null || _b === undefined ? undefined : _b.writable;
      const isConnected = this.connected && !((_c = this.io.engine) === null || _c === undefined ? undefined : _c._hasPingExpired());
      const discardPacket = this.flags.volatile && !isTransportWritable;
      if (discardPacket) {
        debug9("discard packet as the transport is not currently writable");
      } else if (isConnected) {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      } else {
        this.sendBuffer.push(packet);
      }
      this.flags = {};
      return this;
    }
    _registerAckCallback(id, ack) {
      var _a;
      const timeout = (_a = this.flags.timeout) !== null && _a !== undefined ? _a : this._opts.ackTimeout;
      if (timeout === undefined) {
        this.acks[id] = ack;
        return;
      }
      const timer = this.io.setTimeoutFn(() => {
        delete this.acks[id];
        for (let i = 0;i < this.sendBuffer.length; i++) {
          if (this.sendBuffer[i].id === id) {
            debug9("removing packet with ack id %d from the buffer", id);
            this.sendBuffer.splice(i, 1);
          }
        }
        debug9("event with ack id %d has timed out after %d ms", id, timeout);
        ack.call(this, new Error("operation has timed out"));
      }, timeout);
      const fn = (...args) => {
        this.io.clearTimeoutFn(timer);
        ack.apply(this, args);
      };
      fn.withError = true;
      this.acks[id] = fn;
    }
    emitWithAck(ev, ...args) {
      return new Promise((resolve, reject) => {
        const fn = (arg1, arg2) => {
          return arg1 ? reject(arg1) : resolve(arg2);
        };
        fn.withError = true;
        args.push(fn);
        this.emit(ev, ...args);
      });
    }
    _addToQueue(args) {
      let ack;
      if (typeof args[args.length - 1] === "function") {
        ack = args.pop();
      }
      const packet = {
        id: this._queueSeq++,
        tryCount: 0,
        pending: false,
        args,
        flags: Object.assign({ fromQueue: true }, this.flags)
      };
      args.push((err, ...responseArgs) => {
        if (packet !== this._queue[0]) {
          return debug9("packet [%d] already acknowledged", packet.id);
        }
        const hasError = err !== null;
        if (hasError) {
          if (packet.tryCount > this._opts.retries) {
            debug9("packet [%d] is discarded after %d tries", packet.id, packet.tryCount);
            this._queue.shift();
            if (ack) {
              ack(err);
            }
          }
        } else {
          debug9("packet [%d] was successfully sent", packet.id);
          this._queue.shift();
          if (ack) {
            ack(null, ...responseArgs);
          }
        }
        packet.pending = false;
        return this._drainQueue();
      });
      this._queue.push(packet);
      this._drainQueue();
    }
    _drainQueue(force = false) {
      debug9("draining queue");
      if (!this.connected || this._queue.length === 0) {
        return;
      }
      const packet = this._queue[0];
      if (packet.pending && !force) {
        debug9("packet [%d] has already been sent and is waiting for an ack", packet.id);
        return;
      }
      packet.pending = true;
      packet.tryCount++;
      debug9("sending packet [%d] (try n\xB0%d)", packet.id, packet.tryCount);
      this.flags = packet.flags;
      this.emit.apply(this, packet.args);
    }
    packet(packet) {
      packet.nsp = this.nsp;
      this.io._packet(packet);
    }
    onopen() {
      debug9("transport is open - connecting");
      if (typeof this.auth == "function") {
        this.auth((data) => {
          this._sendConnectPacket(data);
        });
      } else {
        this._sendConnectPacket(this.auth);
      }
    }
    _sendConnectPacket(data) {
      this.packet({
        type: PacketType.CONNECT,
        data: this._pid ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data) : data
      });
    }
    onerror(err) {
      if (!this.connected) {
        this.emitReserved("connect_error", err);
      }
    }
    onclose(reason, description) {
      debug9("close (%s)", reason);
      this.connected = false;
      delete this.id;
      this.emitReserved("disconnect", reason, description);
      this._clearAcks();
    }
    _clearAcks() {
      Object.keys(this.acks).forEach((id) => {
        const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
        if (!isBuffered) {
          const ack = this.acks[id];
          delete this.acks[id];
          if (ack.withError) {
            ack.call(this, new Error("socket has been disconnected"));
          }
        }
      });
    }
    onpacket(packet) {
      const sameNamespace = packet.nsp === this.nsp;
      if (!sameNamespace)
        return;
      switch (packet.type) {
        case PacketType.CONNECT:
          if (packet.data && packet.data.sid) {
            this.onconnect(packet.data.sid, packet.data.pid);
          } else {
            this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
          }
          break;
        case PacketType.EVENT:
        case PacketType.BINARY_EVENT:
          this.onevent(packet);
          break;
        case PacketType.ACK:
        case PacketType.BINARY_ACK:
          this.onack(packet);
          break;
        case PacketType.DISCONNECT:
          this.ondisconnect();
          break;
        case PacketType.CONNECT_ERROR:
          this.destroy();
          const err = new Error(packet.data.message);
          err.data = packet.data.data;
          this.emitReserved("connect_error", err);
          break;
      }
    }
    onevent(packet) {
      const args = packet.data || [];
      debug9("emitting event %j", args);
      if (packet.id != null) {
        debug9("attaching ack callback to event");
        args.push(this.ack(packet.id));
      }
      if (this.connected) {
        this.emitEvent(args);
      } else {
        this.receiveBuffer.push(Object.freeze(args));
      }
    }
    emitEvent(args) {
      if (this._anyListeners && this._anyListeners.length) {
        const listeners = this._anyListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, args);
        }
      }
      super.emit.apply(this, args);
      if (this._pid && args.length && typeof args[args.length - 1] === "string") {
        this._lastOffset = args[args.length - 1];
      }
    }
    ack(id) {
      const self = this;
      let sent = false;
      return function(...args) {
        if (sent)
          return;
        sent = true;
        debug9("sending ack %j", args);
        self.packet({
          type: PacketType.ACK,
          id,
          data: args
        });
      };
    }
    onack(packet) {
      const ack = this.acks[packet.id];
      if (typeof ack !== "function") {
        debug9("bad ack %s", packet.id);
        return;
      }
      delete this.acks[packet.id];
      debug9("calling ack %s with %j", packet.id, packet.data);
      if (ack.withError) {
        packet.data.unshift(null);
      }
      ack.apply(this, packet.data);
    }
    onconnect(id, pid) {
      debug9("socket connected with id %s", id);
      this.id = id;
      this.recovered = pid && this._pid === pid;
      this._pid = pid;
      this.connected = true;
      this.emitBuffered();
      this._drainQueue(true);
      this.emitReserved("connect");
    }
    emitBuffered() {
      this.receiveBuffer.forEach((args) => this.emitEvent(args));
      this.receiveBuffer = [];
      this.sendBuffer.forEach((packet) => {
        this.notifyOutgoingListeners(packet);
        this.packet(packet);
      });
      this.sendBuffer = [];
    }
    ondisconnect() {
      debug9("server disconnect (%s)", this.nsp);
      this.destroy();
      this.onclose("io server disconnect");
    }
    destroy() {
      if (this.subs) {
        this.subs.forEach((subDestroy) => subDestroy());
        this.subs = undefined;
      }
      this.io["_destroy"](this);
    }
    disconnect() {
      if (this.connected) {
        debug9("performing disconnect (%s)", this.nsp);
        this.packet({ type: PacketType.DISCONNECT });
      }
      this.destroy();
      if (this.connected) {
        this.onclose("io client disconnect");
      }
      return this;
    }
    close() {
      return this.disconnect();
    }
    compress(compress) {
      this.flags.compress = compress;
      return this;
    }
    get volatile() {
      this.flags.volatile = true;
      return this;
    }
    timeout(timeout) {
      this.flags.timeout = timeout;
      return this;
    }
    onAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.push(listener);
      return this;
    }
    prependAny(listener) {
      this._anyListeners = this._anyListeners || [];
      this._anyListeners.unshift(listener);
      return this;
    }
    offAny(listener) {
      if (!this._anyListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyListeners;
        for (let i = 0;i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyListeners = [];
      }
      return this;
    }
    listenersAny() {
      return this._anyListeners || [];
    }
    onAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.push(listener);
      return this;
    }
    prependAnyOutgoing(listener) {
      this._anyOutgoingListeners = this._anyOutgoingListeners || [];
      this._anyOutgoingListeners.unshift(listener);
      return this;
    }
    offAnyOutgoing(listener) {
      if (!this._anyOutgoingListeners) {
        return this;
      }
      if (listener) {
        const listeners = this._anyOutgoingListeners;
        for (let i = 0;i < listeners.length; i++) {
          if (listener === listeners[i]) {
            listeners.splice(i, 1);
            return this;
          }
        }
      } else {
        this._anyOutgoingListeners = [];
      }
      return this;
    }
    listenersAnyOutgoing() {
      return this._anyOutgoingListeners || [];
    }
    notifyOutgoingListeners(packet) {
      if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
        const listeners = this._anyOutgoingListeners.slice();
        for (const listener of listeners) {
          listener.apply(this, packet.data);
        }
      }
    }
  };
});

// node_modules/socket.io-client/build/esm-debug/contrib/backo2.js
function Backoff(opts) {
  opts = opts || {};
  this.ms = opts.min || 100;
  this.max = opts.max || 1e4;
  this.factor = opts.factor || 2;
  this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
  this.attempts = 0;
}
var init_backo2 = __esm(() => {
  Backoff.prototype.duration = function() {
    var ms = this.ms * Math.pow(this.factor, this.attempts++);
    if (this.jitter) {
      var rand = Math.random();
      var deviation = Math.floor(rand * this.jitter * ms);
      ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
    }
    return Math.min(ms, this.max) | 0;
  };
  Backoff.prototype.reset = function() {
    this.attempts = 0;
  };
  Backoff.prototype.setMin = function(min) {
    this.ms = min;
  };
  Backoff.prototype.setMax = function(max) {
    this.max = max;
  };
  Backoff.prototype.setJitter = function(jitter) {
    this.jitter = jitter;
  };
});

// node_modules/socket.io-client/build/esm-debug/manager.js
var import_component_emitter6, import_debug10, debug10, Manager;
var init_manager = __esm(() => {
  init_esm_debug();
  init_socket2();
  init_esm_debug2();
  init_backo2();
  import_component_emitter6 = __toESM(require_cjs(), 1);
  import_debug10 = __toESM(require_src(), 1);
  debug10 = import_debug10.default("socket.io-client:manager");
  Manager = class Manager extends import_component_emitter6.Emitter {
    constructor(uri, opts) {
      var _a;
      super();
      this.nsps = {};
      this.subs = [];
      if (uri && typeof uri === "object") {
        opts = uri;
        uri = undefined;
      }
      opts = opts || {};
      opts.path = opts.path || "/socket.io";
      this.opts = opts;
      installTimerFunctions(this, opts);
      this.reconnection(opts.reconnection !== false);
      this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
      this.reconnectionDelay(opts.reconnectionDelay || 1000);
      this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
      this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== undefined ? _a : 0.5);
      this.backoff = new Backoff({
        min: this.reconnectionDelay(),
        max: this.reconnectionDelayMax(),
        jitter: this.randomizationFactor()
      });
      this.timeout(opts.timeout == null ? 20000 : opts.timeout);
      this._readyState = "closed";
      this.uri = uri;
      const _parser = opts.parser || exports_esm_debug;
      this.encoder = new _parser.Encoder;
      this.decoder = new _parser.Decoder;
      this._autoConnect = opts.autoConnect !== false;
      if (this._autoConnect)
        this.open();
    }
    reconnection(v) {
      if (!arguments.length)
        return this._reconnection;
      this._reconnection = !!v;
      if (!v) {
        this.skipReconnect = true;
      }
      return this;
    }
    reconnectionAttempts(v) {
      if (v === undefined)
        return this._reconnectionAttempts;
      this._reconnectionAttempts = v;
      return this;
    }
    reconnectionDelay(v) {
      var _a;
      if (v === undefined)
        return this._reconnectionDelay;
      this._reconnectionDelay = v;
      (_a = this.backoff) === null || _a === undefined || _a.setMin(v);
      return this;
    }
    randomizationFactor(v) {
      var _a;
      if (v === undefined)
        return this._randomizationFactor;
      this._randomizationFactor = v;
      (_a = this.backoff) === null || _a === undefined || _a.setJitter(v);
      return this;
    }
    reconnectionDelayMax(v) {
      var _a;
      if (v === undefined)
        return this._reconnectionDelayMax;
      this._reconnectionDelayMax = v;
      (_a = this.backoff) === null || _a === undefined || _a.setMax(v);
      return this;
    }
    timeout(v) {
      if (!arguments.length)
        return this._timeout;
      this._timeout = v;
      return this;
    }
    maybeReconnectOnOpen() {
      if (!this._reconnecting && this._reconnection && this.backoff.attempts === 0) {
        this.reconnect();
      }
    }
    open(fn) {
      debug10("readyState %s", this._readyState);
      if (~this._readyState.indexOf("open"))
        return this;
      debug10("opening %s", this.uri);
      this.engine = new Socket(this.uri, this.opts);
      const socket = this.engine;
      const self = this;
      this._readyState = "opening";
      this.skipReconnect = false;
      const openSubDestroy = on(socket, "open", function() {
        self.onopen();
        fn && fn();
      });
      const onError = (err) => {
        debug10("error");
        this.cleanup();
        this._readyState = "closed";
        this.emitReserved("error", err);
        if (fn) {
          fn(err);
        } else {
          this.maybeReconnectOnOpen();
        }
      };
      const errorSub = on(socket, "error", onError);
      if (this._timeout !== false) {
        const timeout = this._timeout;
        debug10("connect attempt will timeout after %d", timeout);
        const timer = this.setTimeoutFn(() => {
          debug10("connect attempt timed out after %d", timeout);
          openSubDestroy();
          onError(new Error("timeout"));
          socket.close();
        }, timeout);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
      this.subs.push(openSubDestroy);
      this.subs.push(errorSub);
      return this;
    }
    connect(fn) {
      return this.open(fn);
    }
    onopen() {
      debug10("open");
      this.cleanup();
      this._readyState = "open";
      this.emitReserved("open");
      const socket = this.engine;
      this.subs.push(on(socket, "ping", this.onping.bind(this)), on(socket, "data", this.ondata.bind(this)), on(socket, "error", this.onerror.bind(this)), on(socket, "close", this.onclose.bind(this)), on(this.decoder, "decoded", this.ondecoded.bind(this)));
    }
    onping() {
      this.emitReserved("ping");
    }
    ondata(data) {
      try {
        this.decoder.add(data);
      } catch (e) {
        this.onclose("parse error", e);
      }
    }
    ondecoded(packet) {
      nextTick(() => {
        this.emitReserved("packet", packet);
      }, this.setTimeoutFn);
    }
    onerror(err) {
      debug10("error", err);
      this.emitReserved("error", err);
    }
    socket(nsp, opts) {
      let socket = this.nsps[nsp];
      if (!socket) {
        socket = new Socket2(this, nsp, opts);
        this.nsps[nsp] = socket;
      } else if (this._autoConnect && !socket.active) {
        socket.connect();
      }
      return socket;
    }
    _destroy(socket) {
      const nsps = Object.keys(this.nsps);
      for (const nsp of nsps) {
        const socket = this.nsps[nsp];
        if (socket.active) {
          debug10("socket %s is still active, skipping close", nsp);
          return;
        }
      }
      this._close();
    }
    _packet(packet) {
      debug10("writing packet %j", packet);
      const encodedPackets = this.encoder.encode(packet);
      for (let i = 0;i < encodedPackets.length; i++) {
        this.engine.write(encodedPackets[i], packet.options);
      }
    }
    cleanup() {
      debug10("cleanup");
      this.subs.forEach((subDestroy) => subDestroy());
      this.subs.length = 0;
      this.decoder.destroy();
    }
    _close() {
      debug10("disconnect");
      this.skipReconnect = true;
      this._reconnecting = false;
      this.onclose("forced close");
    }
    disconnect() {
      return this._close();
    }
    onclose(reason, description) {
      var _a;
      debug10("closed due to %s", reason);
      this.cleanup();
      (_a = this.engine) === null || _a === undefined || _a.close();
      this.backoff.reset();
      this._readyState = "closed";
      this.emitReserved("close", reason, description);
      if (this._reconnection && !this.skipReconnect) {
        this.reconnect();
      }
    }
    reconnect() {
      if (this._reconnecting || this.skipReconnect)
        return this;
      const self = this;
      if (this.backoff.attempts >= this._reconnectionAttempts) {
        debug10("reconnect failed");
        this.backoff.reset();
        this.emitReserved("reconnect_failed");
        this._reconnecting = false;
      } else {
        const delay = this.backoff.duration();
        debug10("will wait %dms before reconnect attempt", delay);
        this._reconnecting = true;
        const timer = this.setTimeoutFn(() => {
          if (self.skipReconnect)
            return;
          debug10("attempting reconnect");
          this.emitReserved("reconnect_attempt", self.backoff.attempts);
          if (self.skipReconnect)
            return;
          self.open((err) => {
            if (err) {
              debug10("reconnect attempt error");
              self._reconnecting = false;
              self.reconnect();
              this.emitReserved("reconnect_error", err);
            } else {
              debug10("reconnect success");
              self.onreconnect();
            }
          });
        }, delay);
        if (this.opts.autoUnref) {
          timer.unref();
        }
        this.subs.push(() => {
          this.clearTimeoutFn(timer);
        });
      }
    }
    onreconnect() {
      const attempt = this.backoff.attempts;
      this._reconnecting = false;
      this.backoff.reset();
      this.emitReserved("reconnect", attempt);
    }
  };
});

// node_modules/socket.io-client/build/esm-debug/index.js
function lookup(uri, opts) {
  if (typeof uri === "object") {
    opts = uri;
    uri = undefined;
  }
  opts = opts || {};
  const parsed = url(uri, opts.path || "/socket.io");
  const source = parsed.source;
  const id = parsed.id;
  const path = parsed.path;
  const sameNamespace = cache[id] && path in cache[id]["nsps"];
  const newConnection = opts.forceNew || opts["force new connection"] || opts.multiplex === false || sameNamespace;
  let io;
  if (newConnection) {
    debug11("ignoring socket cache for %s", source);
    io = new Manager(source, opts);
  } else {
    if (!cache[id]) {
      debug11("new io instance for %s", source);
      cache[id] = new Manager(source, opts);
    }
    io = cache[id];
  }
  if (parsed.query && !opts.query) {
    opts.query = parsed.queryKey;
  }
  return io.socket(parsed.path, opts);
}
var import_debug11, debug11, cache;
var init_esm_debug3 = __esm(() => {
  init_url();
  init_manager();
  init_socket2();
  init_esm_debug2();
  init_esm_debug();
  import_debug11 = __toESM(require_src(), 1);
  debug11 = import_debug11.default("socket.io-client");
  cache = {};
  Object.assign(lookup, {
    Manager,
    Socket: Socket2,
    io: lookup,
    connect: lookup
  });
});

// memory/provider/claude.provider.ts
var claude;
var init_claude_provider = __esm(() => {
  claude = {
    argv: (model) => ["claude", "-p", "--model", model],
    output: "stdout"
  };
});

// memory/provider/codex.provider.ts
var codex;
var init_codex_provider = __esm(() => {
  codex = {
    argv: (model, outFile) => [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--model",
      model,
      "--output-last-message",
      outFile,
      "-"
    ],
    output: "file"
  };
});

// memory/provider/gemini.provider.ts
var gemini;
var init_gemini_provider = __esm(() => {
  gemini = {
    argv: (model) => ["gemini", "-m", model],
    output: "stdout"
  };
});

// memory/provider/index.ts
var DEFAULT_PROVIDER = "claude", PROVIDERS;
var init_provider = __esm(() => {
  init_claude_provider();
  init_codex_provider();
  init_gemini_provider();
  PROVIDERS = { claude, codex, gemini };
});

// memory/memory-config.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
function loadMemoryConfig(configPath) {
  try {
    const raw = JSON.parse(readFileSync2(configPath, "utf8").trim());
    const merged = { ...MEMORY_CONFIG_DEFAULTS, ...raw };
    if (typeof merged.host === "string")
      merged.host = !LOOPBACKS.includes(merged.host);
    merged.web = merged.web === true;
    merged.token = typeof merged.token === "string" && merged.token ? merged.token : null;
    return merged;
  } catch {
    return { ...MEMORY_CONFIG_DEFAULTS };
  }
}
function resolveMemoryConn(projectDir) {
  const cfg = loadConfig(projectDir);
  const mc = loadMemoryConfig(join2(resolveDocDir(projectDir, cfg), MEMORY_CONFIG_FILENAME));
  return { port: cfg.port ?? mc.port, token: mc.token };
}
function resolveMemoryPort(projectDir) {
  return resolveMemoryConn(projectDir).port;
}
var DB_FILENAME = "memory.db", MEMORY_CONFIG_FILENAME = "memory-config.json", DEFAULT_PORT = 41720, MEMORY_CONFIG_DEFAULTS, LOOPBACKS;
var init_memory_config = __esm(() => {
  init_config();
  init_provider();
  MEMORY_CONFIG_DEFAULTS = {
    version: 1,
    db: DB_FILENAME,
    port: DEFAULT_PORT,
    host: false,
    web: false,
    token: null,
    model: null,
    modelProvider: DEFAULT_PROVIDER
  };
  LOOPBACKS = ["127.0.0.1", "localhost", "::1"];
});

// memory/client.ts
import { spawn } from "child_process";
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "fs";
import { createServer } from "http";
import { basename, dirname, join as join3, resolve } from "path";
function sameProject(a, b) {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}
async function serverProjectDir(s) {
  try {
    const res = await s.timeout(2000).emitWithAck("mem:info");
    return res.ok && typeof res.projectDir === "string" ? res.projectDir : null;
  } catch {
    return null;
  }
}
async function assignFreePort(projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  const port = await new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
  const cfgPath = join3(projectDir, ".claude", "nunchi.json");
  let cfg = {};
  try {
    if (existsSync2(cfgPath))
      cfg = JSON.parse(readFileSync3(cfgPath, "utf8").trim());
  } catch {}
  cfg.port = port;
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + `
`);
  return port;
}
function tryConnect(url, timeoutMs, token) {
  return new Promise((resolve) => {
    const s = lookup(url, {
      reconnection: false,
      timeout: timeoutMs,
      auth: token ? { token } : {}
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", () => {
      s.close();
      resolve(null);
    });
  });
}
async function connectMemory(projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(), opts = {}) {
  const cfg = loadConfig(projectDir);
  const { port, token } = resolveMemoryConn(projectDir);
  let socket;
  const external = cfg["external-address"];
  if (external) {
    const url = external.includes("://") ? external : `http://${external}`;
    socket = await tryConnect(url, 3000, token);
    if (!socket) {
      throw new Error(`[nunchi] external memory server \uC811\uC18D \uC2E4\uD328 (${url})`);
    }
  } else {
    const url = `http://127.0.0.1:${port}`;
    socket = await tryConnect(url, 2000, token);
    if (!socket) {
      if (opts.noSpawn) {
        throw new Error(`[nunchi] memory server \uBBF8\uAE30\uB3D9 (port ${port}) \u2014 noSpawn \uBAA8\uB4DC`);
      }
      if (!cfg["auto-start"]) {
        throw new Error(`[nunchi] memory server \uBBF8\uAE30\uB3D9 (port ${port}) \u2014 auto-start\uAC00 \uAEBC\uC838 \uC788\uC5B4 \uC2A4\uD3F0\uD558\uC9C0 \uC54A\uC74C`);
      }
      if (process.platform === "win32" && process.env.NUNCHI_NO_WINDOW !== "1") {
        spawn("cmd", ["/d", "/s", "/c", `"start "Nunchi [${basename(projectDir)}]" bun "${SERVER_PATH}""`], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
          detached: true,
          stdio: "ignore",
          windowsVerbatimArguments: true
        }).unref();
      } else {
        spawn("bun", [SERVER_PATH], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
          detached: true,
          stdio: "ignore"
        }).unref();
      }
      for (let i = 0;i < 20 && !socket; i++) {
        await new Promise((r) => setTimeout(r, 250));
        socket = await tryConnect(url, 1000, token);
      }
      if (!socket)
        throw new Error(`[nunchi] memory server \uC811\uC18D \uC2E4\uD328 (port ${port})`);
    }
    if (!opts.force) {
      const dir = await serverProjectDir(socket);
      if (dir === null || !sameProject(dir, projectDir)) {
        socket.close();
        if (dir !== null && !opts.noSpawn && !opts.reassigned) {
          await assignFreePort(projectDir);
          return connectMemory(projectDir, { ...opts, reassigned: true });
        }
        throw new ProjectMismatchError(port, projectDir, dir);
      }
    }
  }
  const s = socket;
  const req = async (ev, payload) => {
    const res = payload === undefined ? await s.timeout(5000).emitWithAck(ev) : await s.timeout(5000).emitWithAck(ev, payload);
    if (!res.ok)
      throw new Error(res.error);
    return res;
  };
  return {
    doc: async () => (await req("mem:doc")).doc ?? null,
    add: async (e) => (await req("mem:add", e)).id,
    update: async (id, fields) => (await req("mem:update", { id, ...fields })).updated,
    remove: async (id) => (await req("mem:remove", { id })).removed,
    promote: async (sources, e) => (await req("mem:promote", { ...e, sources })).id,
    link: async (id, refs) => (await req("mem:update", { id, link: refs })).updated,
    tree: async (id) => (await req("mem:tree", { id })).tree ?? null,
    exportEvents: async () => {
      const r = await req("mem:export");
      return { count: r.count ?? 0, jsonl: r.jsonl ?? "" };
    },
    search: async (queries, opts = {}) => (await req("mem:search", { queries, ...opts })).rows,
    list: async (opts = {}) => (await req("mem:list", opts)).rows,
    core: async () => (await req("mem:core")).rows,
    stamp: async () => (await req("mem:stamp")).stamp ?? null,
    shutdown: async () => {
      const gone = new Promise((resolve) => {
        const t = setTimeout(resolve, 2000);
        s.once("disconnect", () => {
          clearTimeout(t);
          resolve();
        });
      });
      try {
        await req("mem:shutdown");
      } catch {}
      await gone;
      s.close();
    },
    close: () => s.close(),
    get connected() {
      return s.connected;
    }
  };
}
var SERVER_PATH, ProjectMismatchError;
var init_client = __esm(() => {
  init_esm_debug3();
  init_memory_config();
  init_config();
  SERVER_PATH = join3(PLUGIN_ROOT, BUNDLED ? "dist/memory/server.js" : "memory/server.ts");
  ProjectMismatchError = class ProjectMismatchError extends Error {
    port;
    expectedDir;
    serverDir;
    constructor(port, expectedDir, serverDir) {
      super([
        `[nunchi] port ${port}\uC758 memory server\uB294 \uC774 \uD504\uB85C\uC81D\uD2B8 \uC18C\uC720\uAC00 \uC544\uB2D8`,
        `(\uC11C\uBC84: ${serverDir ?? "\uC2DD\uBCC4 \uBD88\uAC00 \u2014 \uAD6C\uBC84\uC804 \uC11C\uBC84"}, \uAE30\uB300: ${expectedDir}).`,
        `\uC0AC\uC6A9\uC790\uC5D0\uAC8C \uC54C\uB9B4 \uAC83: \uC81C\uBAA9\uC774 "Nunchi [...]"\uC778 \uD574\uB2F9 memory server \uCC3D\uC744 \uB2EB\uACE0 \uC138\uC158\uC744 \uB2E4\uC2DC \uC2DC\uC791\uD558\uAC70\uB098,`,
        `\uC774 \uD504\uB85C\uC81D\uD2B8 .claude/nunchi.json\uC758 "port"\uC5D0 \uB2E4\uB978 \uD3EC\uD2B8 \uBC88\uD638\uB97C \uC9C0\uC815\uD558\uBA74 \uB2E4\uC74C \uC138\uC158\uBD80\uD130 \uD574\uACB0\uB41C\uB2E4.`
      ].join(" "));
      this.port = port;
      this.expectedDir = expectedDir;
      this.serverDir = serverDir;
      this.name = "ProjectMismatchError";
    }
  };
});

// hooks/session-start.ts
init_config();
import { mkdirSync as mkdirSync2 } from "fs";
import { join as join4 } from "path";
var projectDir = hookProjectDir();
var cfg = loadConfig(projectDir);
try {
  mkdirSync2(resolveDocDir(projectDir, cfg), { recursive: true });
} catch {}
var core = [];
var note = null;
try {
  await Promise.resolve().then(() => init_client());
  const mem = await connectMemory(projectDir);
  try {
    core = await mem.core();
  } finally {
    mem.close();
  }
} catch (e) {
  if (e instanceof Error && e.name === "ProjectMismatchError")
    note = e.message;
}
var lines = [
  "[nunchi] \uC774 \uD504\uB85C\uC81D\uD2B8\uB294 \uC791\uC5C5 \uAC15\uB3C4 \uBCF4\uC815 \uADDC\uC57D\uC744 \uC0AC\uC6A9\uD55C\uB2E4 (\uBCF4\uC815 DB \u2014 \uAC80\uC0C9 \uD68C\uC218 \uBC29\uC2DD).",
  "\uC791\uC5C5 \uAC15\uB3C4(\uAC80\uC99D \uAE4A\uC774, \uD14C\uC2A4\uD2B8 \uC5EC\uBD80, \uB9AC\uC11C\uCE58 \uBC94\uC704, \uB9AC\uD329\uD1A0\uB9C1 \uBC94\uC704) \uD310\uB2E8 \uC2DC: \uC790\uB3D9 \uC8FC\uC785\uB41C \uD56D\uBAA9\uC73C\uB85C \uBD80\uC871\uD558\uBA74 nunchi_search(\uC720\uC758\uC5B4\xB7\uD55C/\uC601 \uD655\uC7A5 \uCFFC\uB9AC 2-5\uAC1C), \uADF8\uB798\uB3C4 \uC560\uB9E4\uD558\uAC70\uB098 \uD310\uB2E8\uC774 \uC911\uC694\uD558\uBA74 nunchi_list\uB85C \uC804\uB7C9\uC744 \uC77D\uACE0 \uC9C1\uC811 \uC120\uBCC4\uD55C\uB2E4.",
  "\uC608\uCE21\uACFC \uC2E4\uC81C\uAC00 \uC5B4\uAE0B\uB098\uBA74(\uACFC\uC789/\uACFC\uC18C/\uD658\uACBD \uD2B9\uC774\uC0AC\uD56D) nunchi_record\uB85C \uAE30\uB85D\uD55C\uB2E4. \uAE30\uC874 \uD56D\uBAA9 \uC7AC\uD655\uC778\uC740 nunchi_update(action: confirm), '\uC6A9\uC11C\uD558\uB294 \uAC83'\uC744 \uB530\uB974\uB2E4 \uC0AC\uACE0\uAC00 \uB098\uBA74 nunchi_update(action: reverse)\uB85C \uC989\uC2DC \uBC18\uC804\uD55C\uB2E4.",
  "\uC791\uC5C5 \uAE30\uB85D \uADDC\uC57D: \uC644\uACB0\uB41C \uC791\uC5C5(\uC0B0\uCD9C\uBB3C\uC774 \uB0A8\uB294 \uC694\uCCAD \uB2E8\uC704)\uC744 \uB9C8\uBB34\uB9AC\uD558\uBA74 nunchi_search\uB85C \uC720\uC0AC task \uD56D\uBAA9\uC744 \uCC3E\uC544 \u2014 \uC808\uCC28\uAC00 \uC5B4\uAE0B\uB0AC\uC73C\uBA74 nunchi_update(edit)\uB85C \uAD50\uC815, \uADF8\uB300\uB85C \uC720\uD6A8\uD588\uC73C\uBA74 nunchi_update(confirm), \uC5C6\uC73C\uBA74 nunchi_record(section: task)\uB85C \uC2E0\uADDC \uAE30\uB85D\uD55C\uB2E4.",
  "\uAD00\uCC30 \uB808\uC778: \uD655\uC2E0\uC774 \uC5C6\uB294 \uC608\uCE21 \uC5B4\uAE0B\uB0A8 \uC758\uC2EC\uC740 nunchi_record(section: observe)\uB85C \uAC00\uBCCD\uAC8C \uB0A8\uAE34\uB2E4 (\uC790\uB3D9 \uD68C\uC218 \uC81C\uC678). \uAC19\uC740 \uC2E0\uD638\uAC00 \uBC18\uBCF5 \uD655\uC778\uB418\uBA74 nunchi_update(action: promote, id: \uB300\uD45C \uAD00\uCC30, sources: \uCD94\uAC00 \uAD00\uCC30)\uB85C \uBCF4\uC815 \uD56D\uBAA9\uC73C\uB85C \uC2B9\uACA9\uD55C\uB2E4 \u2014 \uCD9C\uCC98\uAC00 \uACC4\uBCF4\uB85C \uBCF4\uC874\uB41C\uB2E4."
];
if (core.length) {
  const coreBlock = formatMemoryEntries(core).slice(0, 8000);
  lines.push("", "[\uD655\uC815 \uADDC\uCE59 \u2014 '\uBC8C\uC8FC\uB294 \uAC83' \uC2E0\uB8B0\uB3C4 \uB192\uC74C(3+). \uD56D\uC0C1 \uC9C0\uD0A8\uB2E4]", coreBlock);
}
if (note)
  lines.push("", note);
lines.push("", `[nunchi] \uAE30\uB85D \uADDC\uC57D \uC804\uBB38(SKILL.md): ${join4(PLUGIN_ROOT, "SKILL.md")}`);
if (isPonytailEnabled(projectDir)) {
  const priority = cfg["policy-priority"];
  if (priority === "nunchi") {
    lines.push("[nunchi] ponytail \uD65C\uC131 (\uC0AC\uC6A9\uC790 \uACB0\uC815: nunchi \uC6B0\uC120). \uC791\uC5C5 \uAC15\uB3C4 \uD310\uB2E8\uC774 \uCDA9\uB3CC\uD558\uBA74 \uBCF4\uC815 DB\uAC00 ponytail\uC758 \uCD5C\uC18C\uD654 \uADDC\uCE59\uBCF4\uB2E4 \uC6B0\uC120\uD55C\uB2E4. \uD2B9\uD788 '\uBC8C\uC8FC\uB294 \uAC83' \uD56D\uBAA9\uC740 \uD56D\uC0C1 \uC9C0\uD0A8\uB2E4.");
  } else if (priority === "ponytail") {
    lines.push("[nunchi] ponytail \uD65C\uC131 (\uC0AC\uC6A9\uC790 \uACB0\uC815: ponytail \uC6B0\uC120). \uC791\uC5C5 \uAC15\uB3C4 \uD310\uB2E8\uC774 \uCDA9\uB3CC\uD558\uBA74 ponytail\uC758 \uCD5C\uC18C\uD654 \uADDC\uCE59\uC744 \uB530\uB978\uB2E4. \uB2E8 \uC2E0\uB8B0\uB3C4 \uB192\uC74C(3+)\uC758 '\uBC8C\uC8FC\uB294 \uAC83' \uD56D\uBAA9\uC740 \uC2E4\uC81C \uC0AC\uACE0 \uAE30\uB85D\uC774\uBBC0\uB85C \uC608\uC678\uB85C \uC9C0\uD0A4\uACE0, \uC0DD\uB7B5\uC774 \uC0AC\uACE0\uB85C \uC774\uC5B4\uC9C0\uBA74 \uBC18\uC804 \uADDC\uCE59\uB300\uB85C \uAE30\uB85D\uD55C\uB2E4.");
  } else {
    lines.push('[nunchi] ponytail \uD65C\uC131 \uAC10\uC9C0 \u2014 \uBCF4\uC815 DB\uC640\uC758 \uC6B0\uC120\uC21C\uC704 \uBBF8\uACB0\uC815. \uC774\uBC88 \uC138\uC158\uC5D0\uC11C \uC791\uC5C5 \uAC15\uB3C4 \uD310\uB2E8\uC774 \uCC98\uC74C \uCDA9\uB3CC\uD558\uBA74(ponytail\uC740 \uC0DD\uB7B5\uC744 \uAD8C\uD558\uB294\uB370 \uBCF4\uC815 DB\uB294 \uBC18\uB300, \uB610\uB294 \uADF8 \uC5ED) AskUserQuestion\uC73C\uB85C \uC5B4\uB290 \uCABD\uC744 \uC6B0\uC120\uD560\uC9C0 \uBB3C\uC5B4\uBCF4\uACE0, \uB2F5\uC744 \uD504\uB85C\uC81D\uD2B8 .claude/nunchi.json \uC758 "policy-priority" \uD0A4\uC5D0 "nunchi" \uB610\uB294 "ponytail" \uB85C \uC800\uC7A5\uD55C\uB2E4. \uB2E4\uC74C \uC138\uC158\uBD80\uD130 \uC790\uB3D9 \uBC18\uC601\uB41C\uB2E4. \uCDA9\uB3CC\uC774 \uC5C6\uC73C\uBA74 \uBB3B\uC9C0 \uC54A\uB294\uB2E4.');
  }
}
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: lines.join(`
`)
  }
}));
process.exit(0);
