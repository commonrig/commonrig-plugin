// src/guard-cli.ts
import { spawn } from "node:child_process";
import { mkdir as mkdir2 } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/auth.ts
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile as readFile2, rm as rm3 } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

// src/lock.ts
import { open as openFile, rm, stat } from "node:fs/promises";
var STALE_MS = 3e4;
var WAIT_MS = 150;
var PATIENCE_MS = 3e3;
async function withLock(path, now, fn, waitMs = WAIT_MS) {
  const started = Date.now();
  while (Date.now() - started < PATIENCE_MS) {
    const handle = await openFile(path, "wx", 384).catch(() => null);
    if (handle) {
      await handle.close();
      try {
        return await fn();
      } finally {
        await rm(path, { force: true, maxRetries: 5, retryDelay: 20 }).catch(() => void 0);
      }
    }
    const current = now + Date.now() - started;
    const modified = await stat(path).then((info) => info.mtimeMs, () => current);
    if (current - modified > STALE_MS) await rm(path, { force: true }).catch(() => void 0);
    else await new Promise((resolve) => setTimeout(resolve, waitMs * (0.5 + Math.random())));
  }
  return null;
}

// src/pause.ts
import { randomUUID } from "node:crypto";
import { readFile, rename, rm as rm2, writeFile } from "node:fs/promises";
var SERVER_PAUSE_MS = 5 * 6e4;
async function writeAtomic(file, text) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 384 });
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(temp, file);
    } catch (error) {
      if (attempt >= 7) {
        await rm2(temp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

// src/transport.ts
function assertSafeUrl(url) {
  const { protocol, hostname: hostname2 } = new URL(url);
  if (protocol !== "https:" && hostname2 !== "localhost" && hostname2 !== "127.0.0.1") throw new Error("capture needs an https url");
}

// src/auth.ts
var FILE = "credentials.json";
var LOCK = "credentials.lock";
var SCOPE = "capture offline_access";
var SIGN_IN_MS = 5 * 6e4;
var EXPIRY_MARGIN_MS = 6e4;
var b64url = (bytes) => bytes.toString("base64url");
async function readCredentials(dir) {
  const parsed = await readFile2(join(dir, FILE), "utf8").then((text) => JSON.parse(text)).catch(() => null);
  return parsed && typeof parsed.url === "string" ? parsed : null;
}
var save = (dir, credentials) => writeAtomic(join(dir, FILE), JSON.stringify(credentials));
var plainFailure = (error, url) => {
  const name = error?.name;
  const host = URL.canParse(url) ? new URL(url).host : "the workspace";
  if (name === "TimeoutError" || name === "AbortError") return new Error(`${host} didn't answer in time, try again in a minute`);
  const cause = String(error?.cause?.message ?? "");
  if (error instanceof TypeError && !/redirect/i.test(cause)) return new Error(`couldn't reach ${host}, check the connection and try again in a minute`);
  return error instanceof Error ? error : new Error(String(error));
};
var reach = (fetcher, url, init) => fetcher(url, init).catch((error) => {
  throw plainFailure(error, url);
});
var form = (fetcher, url, body) => reach(fetcher, url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(1e4), headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body) });
var removeCredentials = async (dir) => {
  await withLock(join(dir, LOCK), Date.now(), () => rm3(join(dir, FILE), { force: true }));
};
async function accessToken(dir, now, fetcher = fetch) {
  const fresh = (credentials) => credentials?.access_token && credentials.expires_at - EXPIRY_MARGIN_MS > now ? credentials.access_token : null;
  const held = await readCredentials(dir);
  if (!held?.refresh_token) return fresh(held);
  const valid = fresh(held);
  if (valid) return valid;
  return withLock(join(dir, LOCK), now, async () => {
    const current = await readCredentials(dir);
    const done = fresh(current);
    if (done || !current?.refresh_token) return done;
    const response = await form(fetcher, current.token_endpoint, { grant_type: "refresh_token", refresh_token: current.refresh_token, client_id: current.client_id });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      if (error !== "invalid_grant" && error !== "invalid_client") throw new Error(`refresh failed: ${response.status}`);
      await save(dir, { ...current, refresh_token: null, access_token: null, expires_at: 0 });
      return null;
    }
    const reply = await response.json();
    if (!reply.access_token) throw new Error("refresh gave no token");
    await save(dir, { ...current, access_token: reply.access_token, refresh_token: reply.refresh_token ?? current.refresh_token, expires_at: now + (reply.expires_in ?? 0) * 1e3 });
    return reply.access_token;
  });
}
async function dropAccessToken(dir) {
  await withLock(join(dir, LOCK), Date.now(), async () => {
    const held = await readCredentials(dir);
    if (held) await save(dir, { ...held, access_token: null, expires_at: 0 });
  });
}
var getJson = async (fetcher, url) => {
  const response = await reach(fetcher, url, { redirect: "error", signal: AbortSignal.timeout(1e4), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`could not read ${new URL(url).pathname}: ${response.status}`);
  return await response.json();
};
async function discover(fetcher, mcpUrl) {
  const { origin, pathname } = new URL(mcpUrl);
  const resource = await getJson(fetcher, `${origin}/.well-known/oauth-protected-resource${pathname}`);
  const issuer = resource.authorization_servers?.[0];
  if (!issuer || new URL(issuer).origin !== origin) throw new Error("this server names another sign-in host");
  const server = await getJson(fetcher, `${origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`);
  const { authorization_endpoint: authorization, token_endpoint: token, registration_endpoint: registration } = server;
  if (server.issuer !== issuer || !authorization || !token || !registration) throw new Error("this server has no usable sign-in");
  if ([authorization, token, registration].some((url) => new URL(url).origin !== origin)) throw new Error("this server names another sign-in host");
  return { issuer, authorization, token, registration };
}
function parseCallback(address, state) {
  const url = URL.canParse(address.trim()) ? new URL(address.trim()) : null;
  const code = url?.searchParams.get("code");
  return url && code && url.searchParams.get("state") === state ? { code, iss: url.searchParams.get("iss") } : null;
}
function listen(state) {
  return new Promise((resolve, reject) => {
    let deliver = () => void 0;
    const callback = new Promise((done) => {
      deliver = done;
    });
    const server = createServer((request, response) => {
      const found = parseCallback(`http://127.0.0.1${request.url ?? "/"}`, state);
      const say = (status, text) => {
        if (response.writableEnded) return;
        response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        response.end(text);
      };
      if (!found) return say(400, "Sign-in did not finish. Try connect again.");
      deliver({ ...found, answer: say });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0, callback });
    });
  });
}
var timeout = (ms) => new Promise((_, reject) => {
  setTimeout(() => reject(new Error("sign-in timed out")), ms).unref();
});
async function connect(options) {
  assertSafeUrl(options.url);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const scope = options.scope ?? SCOPE;
  const endpoints = await discover(fetcher, options.url);
  const state = b64url(randomBytes(16));
  const { server, port, callback } = await listen(state);
  try {
    const redirect = `http://127.0.0.1:${port}/callback`;
    const registered = await reach(fetcher, endpoints.registration, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1e4),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: `${options.clientName ?? "CommonRig helper"} on ${hostname()}`, redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope })
    });
    if (!registered.ok) throw new Error(`could not register: ${registered.status}`);
    const { client_id: clientId } = await registered.json();
    const verifier = b64url(randomBytes(32));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      state,
      scope,
      resource: options.url,
      device: hostname(),
      ...options.extra
    });
    options.show(`${endpoints.authorization}?${query}`);
    const pasted = options.pasted?.then((address) => address ? parseCallback(address, state) : null).then((found) => found ?? new Promise(() => void 0));
    const back = await Promise.race([callback, ...pasted ? [pasted] : [], timeout(options.timeoutMs ?? SIGN_IN_MS)]);
    try {
      if (back.iss && back.iss !== endpoints.issuer) throw new Error("sign-in reply came from another server");
      const body = { grant_type: "authorization_code", code: back.code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier, resource: options.url };
      const response = await form(fetcher, endpoints.token, body).catch(() => form(fetcher, endpoints.token, body));
      if (!response.ok) throw new Error(`sign-in refused: ${response.status}`);
      const reply = await response.json();
      if (!reply.access_token || !reply.refresh_token) throw new Error("sign-in gave no token");
      await save(options.dir, { url: options.url, token_endpoint: endpoints.token, client_id: clientId, refresh_token: reply.refresh_token, access_token: reply.access_token, expires_at: now() + (reply.expires_in ?? 0) * 1e3 });
      back.answer?.(200, "Signed in. You can close this tab.");
    } catch (error) {
      back.answer?.(500, "Sign-in did not finish, so nothing was saved. Close this tab and run connect again.");
      throw error;
    }
  } finally {
    server.close();
    server.closeIdleConnections();
  }
}
var sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var DEVICE_REDIRECT = "http://127.0.0.1/callback";
async function connectDevice(options) {
  assertSafeUrl(options.url);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const endpoints = await discover(fetcher, options.url);
  const machine = (options.machine ?? hostname()).slice(0, 64);
  const prepared = [];
  for (const ask of options.asks) {
    const registered = await reach(fetcher, endpoints.registration, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1e4),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: `${ask.clientName} on ${machine}`, redirect_uris: [DEVICE_REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: ask.scope })
    });
    if (!registered.ok) throw new Error(`could not register: ${registered.status}`);
    const { client_id: clientId } = await registered.json();
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: DEVICE_REDIRECT,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      state,
      scope: ask.scope,
      resource: options.url,
      device: machine,
      ...ask.extra
    });
    prepared.push({ ask, clientId, verifier, state, query: query.toString() });
  }
  const started = await reach(fetcher, `${endpoints.issuer}/oauth/device`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(1e4),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ machine, asks: prepared.map((one) => ({ query: one.query, ticked: one.ask.ticked })) })
  });
  const begun = await started.json().catch(() => ({}));
  if (!started.ok || !begun.device_code || !begun.user_code || !begun.verification_uri) throw new Error(`could not start the sign-in: ${begun.error_description ?? started.status}`);
  for (const link of [begun.verification_uri, begun.verification_uri_complete ?? begun.verification_uri]) {
    if (new URL(link).origin !== new URL(options.url).origin) throw new Error("this server names another sign-in host");
  }
  const expiresAt = now() + (begun.expires_in ?? 600) * 1e3;
  options.show({ code: begun.user_code, url: begun.verification_uri, complete: begun.verification_uri_complete ?? begun.verification_uri, minutes: Math.round((begun.expires_in ?? 600) / 60) });
  let interval = (begun.interval ?? 5) * 1e3;
  let results = null;
  while (!results) {
    if (now() > expiresAt) throw new Error("the code ran out before anyone approved it, nothing saved. Run connect again");
    await sleep(interval);
    const response = await form(fetcher, `${endpoints.issuer}/oauth/device/poll`, { device_code: begun.device_code }).catch((error) => {
      if (error instanceof Error && /didn't answer|couldn't reach/.test(error.message)) return null;
      throw error;
    });
    if (!response) continue;
    const reply = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(reply.results)) results = reply.results;
    else if (reply.error === "authorization_pending") continue;
    else if (reply.error === "slow_down") interval += 5e3;
    else if (reply.error === "access_denied") throw new Error("denied on the page, nothing saved");
    else if (reply.error === "expired_token") throw new Error("the code ran out before anyone approved it, nothing saved. Run connect again");
    else throw new Error(`sign-in did not finish: ${reply.error ?? response.status}`);
  }
  const done = [];
  for (const one of prepared) {
    const result = results.find((row) => row.state === one.state && row.code);
    if (!result?.code) continue;
    const body = { grant_type: "authorization_code", code: result.code, client_id: one.clientId, redirect_uri: DEVICE_REDIRECT, code_verifier: one.verifier, resource: options.url };
    const response = await form(fetcher, endpoints.token, body).catch(() => form(fetcher, endpoints.token, body));
    if (!response.ok) throw new Error(`sign-in refused for ${one.ask.label}: ${response.status}`);
    const reply = await response.json();
    if (!reply.access_token || !reply.refresh_token) throw new Error(`sign-in gave no token for ${one.ask.label}`);
    await mkdir(one.ask.dir, { recursive: true, mode: 448 });
    await save(one.ask.dir, { url: options.url, token_endpoint: endpoints.token, client_id: one.clientId, refresh_token: reply.refresh_token, access_token: reply.access_token, expires_at: now() + (reply.expires_in ?? 0) * 1e3, scope: reply.scope ?? one.ask.scope });
    done.push(one.ask.label);
  }
  return done;
}

// src/codex.ts
import { execFile } from "node:child_process";
import { isAbsolute, posix, win32 } from "node:path";
var str = (value) => typeof value === "string" && value ? value : null;
var folderKey = (path) => {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^(?:[a-z]:|\/\/)/i.test(clean) ? clean.toLowerCase() : clean;
};
function inScope(cwd, top, roots) {
  if (!cwd || !roots.length) return false;
  const wanted = new Set(roots.map(folderKey));
  if (top) return wanted.has(folderKey(top));
  const here = folderKey(cwd);
  return [...wanted].some((root) => here === root || here.startsWith(`${root}/`));
}
var SHELL = /(^|[\\/])(bash|sh|zsh|powershell|pwsh|cmd)(\.exe)?$/i;
var POWERSHELL = /(^|[\\/])(powershell|pwsh)(\.exe)?$/i;
var PATCH_LINE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/;
function patchText(input) {
  if (typeof input === "string") return input;
  const args = input ?? {};
  return String(args.input ?? args.patch ?? args.command ?? "");
}
function patchPaths(input, cwd) {
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(cwd);
  return patchText(input).split(/\r?\n/).flatMap((line2) => {
    const file = PATCH_LINE.exec(line2)?.[1]?.trim();
    if (!file) return [];
    if (!cwd) return [file];
    return [windows ? win32.resolve(cwd, file) : isAbsolute(file) ? file : posix.resolve(cwd, file)];
  });
}
var CMD = /(^|[\\/])cmd(\.exe)?$/i;
var psFlag = (word, name, short) => {
  const bare = word.replace(/^(?:-{1,2}|\/)/, "").toLowerCase();
  return bare !== word.toLowerCase() && (short.includes(bare) || bare.length >= 3 && name.startsWith(bare));
};
function argvScript(words) {
  const [shell = "", ...rest] = words;
  const joinAfter = (at) => rest.slice(at + 1).join(" ");
  if (POWERSHELL.test(shell)) {
    const at = rest.findIndex((word) => psFlag(word, "encodedcommand", ["e", "ec", "en", "enc"]) || psFlag(word, "command", ["c"]));
    if (at >= 0 && psFlag(rest[at], "command", ["c"])) return joinAfter(at);
    if (at >= 0 && rest[at + 1]) return Buffer.from(rest[at + 1], "base64").toString("utf16le");
  } else if (CMD.test(shell)) {
    const command2 = rest.findIndex((word) => /^\/[ckr]$/i.test(word));
    if (command2 >= 0) return joinAfter(command2);
  } else {
    const command2 = rest.findIndex((word) => /^-[a-z]*c[a-z]*$/i.test(word));
    if (command2 >= 0) return joinAfter(command2);
  }
  return words.join(" ");
}
function codexCalls(input, platform = process.platform) {
  const tool = str(input.tool_name);
  const args = input.tool_input ?? {};
  if (tool === "apply_patch") {
    const cwd = str(args.workdir) ?? str(input.cwd) ?? "";
    return patchPaths(input.tool_input, cwd).map((path) => ({ tool: "Edit", call: { path } }));
  }
  if (tool !== "Bash") return [];
  const raw = args.command;
  if (typeof raw === "string") return [platform === "win32" ? { tool: "PowerShell", call: { command: raw, ps: true } } : { tool: "Bash", call: { command: raw } }];
  if (!Array.isArray(raw) || !raw.every((word) => typeof word === "string") || !raw.length) return [];
  const words = raw;
  const ps = POWERSHELL.test(words[0]);
  const command2 = SHELL.test(words[0]) ? argvScript(words) : words.join(" ");
  return [ps ? { tool: "PowerShell", call: { command: command2, ps: true } } : { tool: "Bash", call: { command: command2 } }];
}
var gitTop = (cwd) => new Promise((done) => {
  execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 1500, windowsHide: true }, (error, stdout) => done(error ? null : stdout.trim() || null));
});
var flagValues = (flags2, name) => flags2.flatMap((flag, index) => flag === name && flags2[index + 1] ? [flags2[index + 1]] : []);

// src/guard.ts
import { appendFile, readFile as readFile3, rename as rename2, rm as rm4, stat as stat2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// ../domain/src/shell-slips.ts
var MAX_NESTING = 3;
var SEPARATORS = /* @__PURE__ */ new Set([";", "&&", "||", "|", "&", "\n"]);
var DQ_ESCAPED = /* @__PURE__ */ new Set(["$", "`", '"', "\\", "\n"]);
function matchParen(text, open) {
  let level = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "(") level++;
    else if (text[j] === ")" && --level === 0) return j;
  }
  return text.length - 1;
}
function findPsSingle(text, from) {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== "'") continue;
    if (text[j + 1] === "'") {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}
function readCalls(text, ps) {
  const calls = [];
  let words = [];
  let dyn = [];
  let word = "";
  let wordDyn = false;
  let inWord = false;
  let start = 0;
  let head = 0;
  const groupHeads = [];
  const heredocs = [];
  const escape = ps ? "`" : "\\";
  const endWord = () => {
    if (inWord) {
      words.push(word);
      dyn.push(wordDyn);
    }
    word = "";
    wordDyn = false;
    inWord = false;
  };
  const endCall = (at, op) => {
    endWord();
    if (!words.length && (op === "\n" || op === "") && calls.at(-1)?.next === "|") {
      start = at + op.length;
      return;
    }
    if (words.length) calls.push({ words, dyn, raw: text.slice(start, at), head, next: op });
    else if (op && op !== "\n" && calls.length && !calls.at(-1).next) calls.at(-1).next = op;
    words = [];
    dyn = [];
    start = at + op.length;
    if (op !== "|") head = calls.length;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === escape && i + 1 < text.length) {
      if (text[i + 1] === "\n") {
        i++;
        continue;
      }
      word += text[++i];
      inWord = true;
      continue;
    }
    if (ps && c === "@" && (text[i + 1] === "'" || text[i + 1] === '"') && /^\r?\n/.test(text.slice(i + 2, i + 4))) {
      const close = text.indexOf(`
${text[i + 1]}@`, i + 2);
      const end = close < 0 ? text.length : close + 3;
      word += text.slice(i, end);
      inWord = true;
      i = end - 1;
      continue;
    }
    if (c === "'") {
      const close = ps ? findPsSingle(text, i + 1) : text.indexOf("'", i + 1);
      const end = close < 0 ? text.length : close;
      word += ps ? text.slice(i + 1, end).replaceAll("''", "'") : text.slice(i + 1, end);
      inWord = true;
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        const d = text[j];
        if (d === escape && j + 1 < text.length) {
          if (ps || DQ_ESCAPED.has(text[j + 1])) {
            j++;
            word += text[j];
          } else word += d;
          continue;
        }
        if (d === "$") {
          wordDyn = true;
          if (text[j + 1] === "(") {
            const close = matchParen(text, j + 1);
            word += text.slice(j, close + 1);
            j = close;
            continue;
          }
        }
        word += d;
      }
      inWord = true;
      i = j;
      continue;
    }
    if (c === "$") {
      wordDyn = true;
      inWord = true;
      if (text[i + 1] === "(") {
        const close = matchParen(text, i + 1);
        word += text.slice(i, close + 1);
        i = close;
        continue;
      }
      word += c;
      continue;
    }
    if (c === "#" && !inWord) {
      const nl = text.indexOf("\n", i);
      i = (nl < 0 ? text.length : nl) - 1;
      continue;
    }
    if (c === "<" && text[i + 1] === "<" && text[i + 2] !== "<" && !ps) {
      const m = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(text.slice(i));
      if (m) {
        endWord();
        heredocs.push(m[2]);
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === "\n" && heredocs.length) {
      endCall(i, "\n");
      let at = i + 1;
      while (heredocs.length) {
        const tag = heredocs.shift();
        for (; ; ) {
          const nl = text.indexOf("\n", at);
          const lineText = text.slice(at, nl < 0 ? text.length : nl);
          at = nl < 0 ? text.length : nl + 1;
          if (lineText.trim() === tag || nl < 0) break;
        }
      }
      start = at;
      i = at - 1;
      head = calls.length;
      continue;
    }
    if ((c === ">" || c === "<") && text[i + 1] === "&") {
      word += c + "&";
      inWord = true;
      i++;
      continue;
    }
    if (c === "&" && text[i + 1] === ">") {
      word += "&>";
      inWord = true;
      i++;
      continue;
    }
    if ((c === "(" || c === "{") && !inWord && (c === "(" || /\s/.test(text[i + 1] ?? ""))) {
      endCall(i, "");
      groupHeads.push(head);
      start = i + 1;
      continue;
    }
    if ((c === ")" || c === "}" && !inWord) && groupHeads.length) {
      endCall(i, "");
      const groupHead = groupHeads.pop();
      let j = i + 1;
      while (j < text.length && /[ \t]/.test(text[j])) j++;
      const pair = text.slice(j, j + 2);
      const op = pair === "|&" ? "|" : SEPARATORS.has(pair) ? pair : SEPARATORS.has(text[j] ?? "") ? text[j] : "";
      const width = pair === "|&" ? 2 : op.length;
      if (op && calls.length) {
        calls.at(-1).next = op;
        start = j + width;
        i = j + width - 1;
        head = op === "|" ? groupHead : calls.length;
      } else head = calls.length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "|&") {
      endCall(i, "|");
      start = i + 2;
      i++;
      continue;
    }
    if (two === "&&" || two === "||") {
      endCall(i, two);
      i++;
      continue;
    }
    if (SEPARATORS.has(c)) {
      endCall(i, c);
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  endCall(text.length, "");
  return calls;
}
var programOf = (word) => (word.split(/[\\/]/).at(-1) ?? "").toLowerCase().replace(/\.(exe|cmd|ps1)$/, "");
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "doas", "nohup", "time", "command", "exec"]);
var KEYWORDS = /* @__PURE__ */ new Set(["if", "then", "else", "elif", "while", "until", "do", "!", "fi", "done", "esac"]);
function commandWords(words) {
  let k = 0;
  for (; ; ) {
    while (k < words.length && (/^[A-Za-z_]\w*=/.test(words[k]) || KEYWORDS.has(words[k]))) k++;
    if (words[k] === "case" && words.indexOf("in", k) > 0) {
      k = words.indexOf("in", k) + 1;
      continue;
    }
    if (k < words.length && /^[^()]+\)$/.test(words[k]) && k + 1 < words.length) {
      k++;
      continue;
    }
    const name = programOf(words[k] ?? "");
    if (WRAPPERS.has(name)) {
      k++;
      while (words[k]?.startsWith("-")) k++;
      continue;
    }
    if (name === "env") {
      k++;
      while (words[k] && (words[k].startsWith("-") || /^[A-Za-z_]\w*=/.test(words[k]))) k++;
      continue;
    }
    if (name === "nice") {
      k++;
      if (words[k] === "-n") k += 2;
      else if (/^-\d+$/.test(words[k] ?? "")) k++;
      continue;
    }
    if (name === "timeout") {
      k++;
      while (words[k]?.startsWith("-")) k += /^-(s|k)$|^--(signal|kill-after)$/.test(words[k]) ? 2 : 1;
      k++;
      continue;
    }
    return words.slice(k);
  }
}
var SSH_VALUE = /^-[bcDEeFIiJLlmOopQRSWw]$/;
var argv = (words) => words.map((w) => /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", "'\\''")}'`).join(" ");
function payloadOf(words) {
  const name = programOf(words[0] ?? "");
  if (name === "ssh") {
    let k = 1;
    while (k < words.length && words[k].startsWith("-") && words[k] !== "--") k += SSH_VALUE.test(words[k]) ? 2 : 1;
    if (words[k] === "--") k++;
    k++;
    if (words[k] === "--") k++;
    return k < words.length ? { text: words.slice(k).join(" "), ps: false } : null;
  }
  if (name === "bash" || name === "sh" || name === "zsh" || name === "dash") {
    const at = words.findIndex((w, k) => k > 0 && /^-[a-z]*c[a-z]*$/.test(w));
    return at > 0 && at + 1 < words.length ? { text: words[at + 1], ps: false } : null;
  }
  if (name === "pwsh" || name === "powershell") {
    const at = words.findIndex((w, k) => k > 0 && /^-(c|command)$/i.test(w));
    return at > 0 && at + 1 < words.length ? { text: words.slice(at + 1).join(" "), ps: true } : null;
  }
  if (name === "wsl") {
    let k = 1;
    while (k < words.length && words[k].startsWith("-") && !["-e", "--exec", "--"].includes(words[k])) k += /^(-d|--distribution|-u|--user|--cd)$/.test(words[k]) ? 2 : 1;
    if (["-e", "--exec", "--"].includes(words[k] ?? "")) k++;
    return k < words.length ? { text: argv(words.slice(k)), ps: false } : null;
  }
  if (name === "docker" || name === "podman" || name === "kubectl") {
    let k = words.indexOf("exec");
    if (k < 0) return null;
    k++;
    while (k < words.length && words[k].startsWith("-")) k += /^(-e|--env|-u|--user|-w|--workdir|-c|--container|-n|--namespace)$/.test(words[k]) ? 2 : 1;
    if (words[k + 1] === "--") k++;
    return k + 1 < words.length ? { text: argv(words.slice(k + 1)), ps: false } : null;
  }
  return null;
}
var PKILL_VALUE = /^-([gGPstuUFdOqr]|-(signal|pgroup|group|parent|session|terminal|euid|uid|pidfile|ns|nslist|delimiter|older|queue|runstates|cgroup|env))$/;
function guarded(alt) {
  if (alt.startsWith("^")) return true;
  for (let i = 0; i < alt.length; i++) {
    const c = alt[i];
    if (c === "\\") return i > 0 && alt[i + 1] !== void 0 && !/[A-Za-z0-9]/.test(alt[i + 1]);
    if (c === "[") return alt[i + 1] !== "^" && /^\[[^\]]+\]/.test(alt.slice(i));
    if (".*+?{".includes(c)) return false;
  }
  return false;
}
function pkillSelfMatch(command2, ps = false, nesting = 0) {
  if (!/pkill/i.test(command2)) return null;
  for (const call of readCalls(command2, ps)) {
    const words = commandWords(call.words);
    const payload = payloadOf(words);
    if (payload) {
      const inner = nesting < MAX_NESTING ? pkillSelfMatch(payload.text, payload.ps, nesting + 1) : null;
      if (inner) return inner;
      continue;
    }
    if (programOf(words[0] ?? "") !== "pkill") continue;
    const dyn = call.dyn.slice(call.words.length - words.length);
    let full = false;
    let skip = false;
    let at = -1;
    for (let k = 1; k < words.length; k++) {
      const w = words[k];
      if (w === "--") {
        if (at < 0) at = k + 1;
        break;
      }
      if (w === "--full") {
        full = true;
        continue;
      }
      if (w === "--exact" || w === "--ignore-ancestors") {
        skip = true;
        continue;
      }
      if (PKILL_VALUE.test(w)) {
        k++;
        continue;
      }
      const bundle = /^-[a-zA-Z]+$/.test(w) && /[a-z]/.test(w);
      if (bundle && w.includes("f")) full = true;
      if (bundle && (w.includes("x") || w.includes("A")) || w === "-A") skip = true;
      if (w.startsWith("-")) continue;
      if (at < 0) at = k;
    }
    const pattern = at > 0 ? words[at] : void 0;
    if (!full || skip || pattern === void 0 || dyn[at] || pattern.includes("$")) continue;
    if (pattern.split("|").every(guarded)) continue;
    return `pkill -f ${pattern}`;
  }
  return null;
}
var RUNNERS = /* @__PURE__ */ new Set(["npm", "pnpm", "yarn", "bun"]);
var RUNNER_GATES = /^(test|t|verify|lint|build|check|typecheck|ci:.*|test:.*|lint:.*|build:.*)$/;
var TOOL_GATES = /* @__PURE__ */ new Set(["pytest", "tox", "nox", "vitest", "jest", "mocha", "tsc", "eslint", "oxlint", "biome", "ruff", "mypy", "pyright", "make", "ctest", "mvn", "gradle", "gradlew", "phpunit", "rspec", "go", "cargo", "dotnet", "swift", "mix", "deno", "lefthook", "pre-commit"]);
var SUB_GATES = /^(test|build|check|clippy|vet|lint|nextest|run)$/;
function isGate(words) {
  const name = programOf(words[0] ?? "");
  const sub = words[1] ?? "";
  if (RUNNERS.has(name)) return RUNNER_GATES.test(sub) || sub === "run" && RUNNER_GATES.test(words[2] ?? "");
  if (name === "npx" || name === "pnpx" || name === "bunx") return isGate(words.slice(1).filter((w) => !w.startsWith("-")));
  if (name === "uv" || name === "poetry" || name === "pipenv") return sub === "run" && isGate(words.slice(2));
  if (/^python[\d.]*$|^py$/.test(name)) return words.some((w, k) => w === "-m" && /^(pytest|unittest|mypy|ruff|tox)$/.test(words[k + 1] ?? ""));
  if (name === "go" || name === "cargo" || name === "dotnet" || name === "swift" || name === "mix" || name === "deno") return SUB_GATES.test(sub);
  if (TOOL_GATES.has(name)) return true;
  const script = /^(bash|sh|zsh|pwsh|powershell)$/.test(name) ? sub : words[0] ?? "";
  return /(^|[\\/])(verify|test|tests|check|ci|lint|build)[\w-]*\.(sh|ps1)$/i.test(script);
}
function isPush(words) {
  if (programOf(words[0] ?? "") !== "git") return false;
  let k = 1;
  while (k < words.length && words[k].startsWith("-")) k += /^-(C|c)$/.test(words[k]) ? 2 : 1;
  return words[k] === "push" && !words.slice(k + 1).some((w) => w === "--help" || w === "-h" || w === "--dry-run" || w === "-n");
}
function filteredPush(command2, ps = false, nesting = 0) {
  if (!/push/i.test(command2) || !command2.includes("|")) return null;
  const calls = readCalls(command2, ps);
  const read = calls.map((call) => commandWords(call.words));
  for (const words of read) {
    const payload = payloadOf(words);
    const inner = payload && nesting < MAX_NESTING ? filteredPush(payload.text, payload.ps, nesting + 1) : null;
    if (inner) return inner;
  }
  if (!read.some(isPush)) return null;
  const nextPush = [];
  const nextCheck = [];
  for (let k = calls.length - 1, push = Infinity, check = Infinity; k >= 0; k--) {
    nextPush[k] = push;
    nextCheck[k] = check;
    if (isPush(read[k])) push = k;
    if (/PIPESTATUS|\$LASTEXITCODE|\$\?/i.test(calls[k].raw)) check = k;
  }
  const lastOf = /* @__PURE__ */ new Map();
  calls.forEach((call, k) => lastOf.set(call.head, k));
  let errexit = false;
  let pipefail = false;
  for (let j = 0; j < calls.length; j++) {
    const words = read[j];
    if (!ps && programOf(words[0] ?? "") === "set") {
      for (let k = 1; k < words.length; k++) {
        const w = words[k];
        const on = w.startsWith("-");
        if (/^[-+][a-zA-Z]*e[a-zA-Z]*$/.test(w)) errexit = on;
        if (/^[-+][a-zA-Z]*o$/.test(w) && words[k + 1] === "errexit") errexit = on;
        if (w === "pipefail" && /^[-+][a-zA-Z]*o$/.test(words[k - 1] ?? "")) pipefail = words[k - 1].startsWith("-");
      }
      continue;
    }
    if (calls[j].head !== j || errexit && pipefail) continue;
    const last = lastOf.get(j);
    if (last === j) continue;
    const after = calls[last].next;
    if (pipefail && after === "&&") continue;
    let g = j;
    while (g < last && /^(cd|chdir|pushd|set-location|sl|push-location)$/.test(programOf(read[g][0] ?? ""))) g++;
    let gate = read[g];
    if (ps && gate[0]?.startsWith("$") && gate[1] === "=") gate = gate.slice(2);
    if (!isGate(gate)) continue;
    const next = nextPush[last];
    if (next === Infinity) continue;
    if (after === "||" && next === last + 1) continue;
    if (nextCheck[j] < next) continue;
    return gate.join(" ");
  }
  return null;
}

// ../domain/src/rule-checks.ts
var RULE_TOOLS = ["report_push", "schedule_write", "handover_write"];
var isRuleTool = (value) => RULE_TOOLS.includes(value);
var MAX_WORDS = 30;
var MAX_WORD = 80;
var MAX_KB = 1536;
var NEEDABLE = {
  report_push: ["decision", "ask", "options", "item"],
  schedule_write: ["links"],
  handover_write: ["summary", "warnings", "items"]
};
var LOCAL_CHECKS = ["local_command", "local_commit", "local_path", "local_pkill_self", "local_piped_push"];
var isLocalCheck = (check) => LOCAL_CHECKS.includes(check.type);
var SLIP_FOUND = { local_pkill_self: "pkill -f matching its own shell", local_piped_push: "git push after a piped gate" };
var SLIP_FIX = {
  local_pkill_self: "Bracket one letter of the pattern (pkill -f '[n]ext dev'), anchor it with ^, or kill by pid.",
  local_piped_push: "Run the check as its own call and read its result before the push, or start with set -eo pipefail."
};
var exactKeys = (raw, keys) => Object.keys(raw).length === keys.length && keys.every((key) => key in raw);
function foldWords(text) {
  return text.normalize("NFKC").replace(/[\p{Cf}͏︀-️]/gu, "").toLowerCase();
}
var flatWords = (text) => foldWords(text).replace(/\s+/g, " ").trim();
function cleanWords(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_WORDS) return null;
  const words = raw.map((word) => typeof word === "string" ? flatWords(word) : "");
  return words.every((word) => word.length > 0 && word.length <= MAX_WORD) ? words : null;
}
var flatPath = (path) => foldWords(path).replace(/\\/g, "/");
function cleanPaths(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_WORDS) return null;
  const paths = raw.map((path) => typeof path === "string" ? flatPath(path.trim()) : "");
  return paths.every((path) => path.length > 0 && path.length <= MAX_WORD) ? paths : null;
}
function parseCheck(text) {
  if (!text) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const check = raw;
  switch (check.type) {
    case "banned_words": {
      const words = cleanWords(check.words);
      const { tools } = check;
      if (!exactKeys(check, ["type", "tools", "words"]) || !words || !Array.isArray(tools) || !tools.length || !tools.every(isRuleTool)) return null;
      return { type: "banned_words", tools, words };
    }
    case "needs_field":
      return exactKeys(check, ["type", "tool", "field"]) && isRuleTool(check.tool) && typeof check.field === "string" && NEEDABLE[check.tool].includes(check.field) ? { type: "needs_field", tool: check.tool, field: check.field } : null;
    case "report_max_kb":
      return exactKeys(check, ["type", "kb"]) && typeof check.kb === "number" && Number.isInteger(check.kb) && check.kb > 0 && check.kb <= MAX_KB ? { type: "report_max_kb", kb: check.kb } : null;
    case "report_opens_with_step":
    case "handover_not_a_question":
    case "local_pkill_self":
    case "local_piped_push":
      return exactKeys(check, ["type"]) ? { type: check.type } : null;
    case "local_command":
    case "local_commit": {
      const words = cleanWords(check.words);
      return exactKeys(check, ["type", "words"]) && words ? { type: check.type, words } : null;
    }
    case "local_path": {
      const paths = cleanPaths(check.paths);
      return exactKeys(check, ["type", "paths"]) && paths ? { type: "local_path", paths } : null;
    }
    default:
      return null;
  }
}
var NAMED = { mdash: String.fromCodePoint(8212), ndash: String.fromCodePoint(8211), amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
var WORD_CHAR = /[\p{L}\p{N}]/u;
function holdsWord(text, word) {
  const openEdge = !WORD_CHAR.test(word[0]);
  const closeEdge = !WORD_CHAR.test(word.at(-1));
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    const before = text[at - 1] ?? " ";
    const after = text[at + word.length] ?? " ";
    if ((openEdge || !WORD_CHAR.test(before)) && (closeEdge || !WORD_CHAR.test(after))) return true;
  }
  return false;
}
function judgeLocal(check, call) {
  if (check.type === "local_path") {
    const path = call.path ? flatPath(call.path) : "";
    return path ? check.paths.find((piece) => path.includes(piece)) ?? null : null;
  }
  if (check.type === "local_pkill_self") return call.command && pkillSelfMatch(call.command, call.ps) ? SLIP_FOUND.local_pkill_self : null;
  if (check.type === "local_piped_push") return call.command && filteredPush(call.command, call.ps) ? SLIP_FOUND.local_piped_push : null;
  const command2 = call.command ? flatWords(call.command) : "";
  if (!command2) return null;
  if (check.type === "local_commit" && !(holdsWord(command2, "git") && holdsWord(command2, "commit"))) return null;
  return check.words.find((word) => holdsWord(command2, word)) ?? null;
}

// src/guard.ts
var COPY = "rules.json";
var STRICT = "strict";
var OFF = "off";
var EVENTS = "events.jsonl";
var TRIED = "refresh-tried";
var SENDING = "events.sending";
var OUTCOMES = ["refused", "asked", "would_refuse", "would_ask", "failed", "failed_strict"];
var MAX_EVENTS_BYTES = 256 * 1024;
var REFRESH_MS = 5 * 6e4;
var MAX_RULES = 500;
var GUARDED_TOOLS = ["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"];
var isRule = (raw) => {
  if (typeof raw !== "object" || raw === null) return false;
  const { num, version, title, level, mode, strict, check, instead } = raw;
  return Number.isInteger(num) && Number.isInteger(version) && typeof title === "string" && typeof level === "string" && typeof mode === "string" && typeof strict === "boolean" && typeof check === "string" && typeof instead === "string";
};
function cleanRules(raw) {
  const rules = raw?.rules;
  return Array.isArray(rules) && rules.length <= MAX_RULES && rules.every(isRule) ? rules : null;
}
var readRetried = (file) => readFile3(file, "utf8").catch(async (error) => {
  if (error.code === "ENOENT") throw error;
  await new Promise((resolve) => setTimeout(resolve, 30));
  return readFile3(file, "utf8");
});
async function readCopy(dir) {
  try {
    const parsed = JSON.parse(await readRetried(join2(dir, COPY)));
    const rules = cleanRules(parsed);
    return rules && typeof parsed.at === "number" ? { at: parsed.at, rules } : null;
  } catch {
    return null;
  }
}
async function saveCopy(dir, rules, at) {
  await writeAtomic(join2(dir, COPY), JSON.stringify({ at, rules }));
  if (rules.some((rule) => rule.strict && rule.mode === "on")) await writeAtomic(join2(dir, STRICT), "1");
  else await rm4(join2(dir, STRICT), { force: true });
}
var switchedOff = (dir) => stat2(join2(dir, OFF)).then(() => true, () => false);
var setOff = (dir, off) => off ? writeFile2(join2(dir, OFF), "1", { mode: 384 }) : rm4(join2(dir, OFF), { force: true });
var callOf = (input) => {
  const args = input.tool_input ?? {};
  const path = args.file_path ?? args.notebook_path;
  return { ...typeof args.command === "string" ? { command: args.command } : {}, ...typeof path === "string" ? { path } : {}, ...input.tool_name === "PowerShell" ? { ps: true } : {} };
};
var line = (rule, found, fix = "") => `Refused by CommonRig rule #${rule.num} v${rule.version}: ${rule.title}. Found: ${found}. ${rule.instead || fix ? `Do instead: ${rule.instead || fix} ` : ""}A person on your team set this. If it looks wrong, tell them. Don't work around it.`;
var brokenLine = (rule) => `CommonRig rule #${rule.num} can't be checked on this machine and it's marked strict: ${rule.title}. Tell the person. An owner has to fix it, or they can turn the guard off here.`;
function judge(rules, tool, call) {
  const events = [];
  let deny = null;
  let ask = null;
  for (const rule of rules) {
    if (rule.mode === "off") continue;
    const on = rule.mode === "on";
    const check = parseCheck(rule.check);
    if (!check || !isLocalCheck(check)) {
      events.push({ rule: rule.num, version: rule.version, tool, outcome: rule.strict ? "failed_strict" : "failed" });
      if (rule.strict && on) deny ??= brokenLine(rule);
      continue;
    }
    const found = judgeLocal(check, call);
    if (!found) continue;
    const asks = rule.level === "ask first";
    events.push({ rule: rule.num, version: rule.version, tool, outcome: on ? asks ? "asked" : "refused" : asks ? "would_ask" : "would_refuse", found });
    if (on && asks) ask ??= line(rule, found, SLIP_FIX[check.type]);
    else if (on) deny ??= line(rule, found, SLIP_FIX[check.type]);
  }
  return { verdict: deny ? { decision: "deny", reason: deny } : ask ? { decision: "ask", reason: ask } : null, events };
}
async function logEvents(dir, events) {
  if (!events.length) return;
  const size = await stat2(join2(dir, EVENTS)).then((info) => info.size, () => 0);
  if (size < MAX_EVENTS_BYTES) await appendFile(join2(dir, EVENTS), `${events.map((row) => JSON.stringify(row)).join("\n")}
`, { mode: 384 });
}
var goodEvent = (row) => GUARDED_TOOLS.includes(row.tool) && OUTCOMES.includes(row.outcome) && Number.isInteger(row.rule) && Number.isInteger(row.version);
async function takeEvents(dir) {
  const held = await readFile3(join2(dir, SENDING), "utf8").catch(() => null);
  const text = held ?? await rename2(join2(dir, EVENTS), join2(dir, SENDING)).then(() => readFile3(join2(dir, SENDING), "utf8")).catch(() => "");
  return text.split("\n").flatMap((row) => {
    try {
      const event = row ? JSON.parse(row) : null;
      return event && goodEvent(event) ? [event] : [];
    } catch {
      return [];
    }
  });
}
var sentEvents = (dir) => rm4(join2(dir, SENDING), { force: true });
async function refreshDue(dir, now) {
  const tried = await stat2(join2(dir, TRIED)).then((info) => info.mtimeMs, () => 0);
  if (now - tried < REFRESH_MS) return false;
  await writeFile2(join2(dir, TRIED), "", { mode: 384 });
  return true;
}
var ENV_WORD = String.raw`CLAUDE_PLUGIN_(?:DATA|OPTION_WORKSPACE_URL)=(?:"[^"]*"|'[^']*'|[^\s"']*)\s+`;
var GUARD_PATH = String.raw`(?:"(?:[^"]*[\\/])?guard\.mjs"|'(?:[^']*[\\/])?guard\.mjs'|(?:[^\s"']*[\\/])?guard\.mjs)`;
var CONNECT = String.raw`connect(?:\s+(?:https?://[^\s"'()]+|--no-browser|--loopback))*`;
var OWN_COMMAND = new RegExp(String.raw`^\s*(?:${ENV_WORD})*node(?:\.exe)?\s+${GUARD_PATH}\s+(?:off|on|status|refresh(?:\s+--say)?|${CONNECT}|disconnect)\s*$`);
var isOwnCommand = (command2) => Boolean(command2) && !/[;&|`\n#<>]|\$\(/.test(command2) && OWN_COMMAND.test(command2);
var denied = (decision, reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } });
async function preTool(dir, input, now) {
  if (await switchedOff(dir)) return { out: null, stale: false };
  if (isOwnCommand(callOf(input).command)) return { out: null, stale: false };
  const copy = await readCopy(dir);
  if (!copy) {
    const strict = await stat2(join2(dir, STRICT)).then(() => true, () => false);
    return { out: strict ? denied("deny", "CommonRig's saved rules can't be read on this machine and one is marked strict. Tell the person: /commonrig-guard:refresh, or /commonrig-guard:off to stop checking here.") : null, stale: true };
  }
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const { verdict, events } = judge(copy.rules, tool, callOf(input));
  await logEvents(dir, events).catch(() => void 0);
  return { out: verdict ? denied(verdict.decision, verdict.reason) : null, stale: now - copy.at > REFRESH_MS };
}
var CODEX_ASK = " Codex can't ask for this: tell the person, and they can run it themselves.";
async function preToolCodex(dir, input, now, options) {
  if (await switchedOff(dir)) return { out: null, stale: false };
  const calls = codexCalls(input, options.platform);
  if (!calls.length || calls.some(({ call }) => isOwnCommand(call.command))) return { out: null, stale: false };
  const copy = await readCopy(dir);
  if (!copy) {
    const strict = options.enforce && await stat2(join2(dir, STRICT)).then(() => true, () => false);
    return { out: strict ? denied("deny", "CommonRig's saved rules can't be read on this machine and one is marked strict. Tell the person: run the guard's refresh, or turn it off here.") : null, stale: true };
  }
  const rules = options.enforce ? copy.rules : copy.rules.map((rule) => rule.mode === "on" ? { ...rule, mode: "log" } : rule);
  let deny = null;
  const events = [];
  for (const { tool, call } of calls) {
    const judged = judge(rules, tool, call);
    events.push(...judged.events);
    if (judged.verdict && !deny) deny = judged.verdict.decision === "ask" ? `${judged.verdict.reason}${CODEX_ASK}` : judged.verdict.reason;
  }
  await logEvents(dir, events).catch(() => void 0);
  return { out: deny ? denied("deny", deny) : null, stale: now - copy.at > REFRESH_MS };
}
var ago = (ms) => ms < 36e5 ? `${Math.max(1, Math.round(ms / 6e4))} minutes` : ms < 1728e5 ? `${Math.round(ms / 36e5)} hours` : `${Math.round(ms / 864e5)} days`;
async function sessionNote(dir, now, signedIn) {
  if (await switchedOff(dir)) return "CommonRig guard is off on this machine.";
  const copy = await readCopy(dir);
  if (!copy) return signedIn ? "CommonRig guard has no saved rules yet, so nothing is checked on this machine." : "CommonRig guard is installed but not signed in, so nothing is checked. A person can run /commonrig-guard:connect.";
  const on = copy.rules.filter((rule) => rule.mode === "on").length;
  const log = copy.rules.filter((rule) => rule.mode === "log").length;
  if (!on && !log) return null;
  const age = now - copy.at;
  return `CommonRig guard: ${on} refusing, ${log} watching, on a saved copy from ${ago(age)} ago.`;
}
var sessionOutput = (note) => JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: note } });
function statusOf(copy, off, signedIn, now) {
  return {
    signed_in: signedIn,
    off,
    rules: copy?.rules.length ?? 0,
    on: copy?.rules.filter((rule) => rule.mode === "on").length ?? 0,
    log: copy?.rules.filter((rule) => rule.mode === "log").length ?? 0,
    copy_age_minutes: copy ? Math.round((now - copy.at) / 6e4) : null
  };
}

// src/guard-cli.ts
var SCOPE2 = "rules offline_access";
var REFRESH_TIMEOUT_MS = 3e3;
var REPORT_ROWS = 100;
var dataDir = () => process.env.CLAUDE_PLUGIN_DATA || join3(homedir(), ".commonrig-guard");
async function callTool(dir, url, name, args) {
  assertSafeUrl(url);
  const token = await accessToken(dir, Date.now());
  if (!token) throw new Error("not signed in");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  });
  if (response.status === 401) await dropAccessToken(dir);
  if (!response.ok) throw new Error(`call failed: ${response.status}`);
  const body = await response.text();
  const data = (response.headers.get("content-type") ?? "").includes("text/event-stream") ? body.split("\n").filter((row) => row.startsWith("data:")).at(-1)?.slice(5) : body;
  const reply = JSON.parse(data ?? "null");
  const text = reply?.result?.content?.[0]?.text;
  if (!text || reply?.result?.isError) throw new Error("call refused");
  return JSON.parse(text);
}
async function refresh(dir) {
  const held = await readCredentials(dir);
  if (!held) return false;
  const rules = cleanRules(await callTool(dir, held.url, "rules_pull", {}));
  if (!rules) return false;
  await saveCopy(dir, rules, Date.now());
  const rows = await takeEvents(dir);
  for (let at = 0; at < rows.length; at += REPORT_ROWS) await callTool(dir, held.url, "rule_report", { rows: rows.slice(at, at + REPORT_ROWS) });
  await sentEvents(dir);
  return true;
}
function refreshBehind(env = process.env) {
  const child = spawn(process.execPath, [process.argv[1] ?? fileURLToPath(import.meta.url), "refresh"], { stdio: "ignore", detached: true, windowsHide: true, env });
  child.on("error", () => void 0);
  child.unref();
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function runHook(dir) {
  const input = await readStdin();
  await mkdir2(dir, { recursive: true, mode: 448 });
  if (input.hook_event_name === "SessionStart") {
    const note = await sessionNote(dir, Date.now(), Boolean(await readCredentials(dir)));
    if (note) process.stdout.write(sessionOutput(note));
    refreshBehind();
    return;
  }
  const { out, stale } = await preTool(dir, input, Date.now());
  if (out) process.stdout.write(out);
  if (stale && await refreshDue(dir, Date.now())) refreshBehind();
}
async function runCodexHook(dir, flags2) {
  const input = await readStdin();
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  if (input.hook_event_name !== "PreToolUse" || !inScope(cwd, cwd ? await gitTop(cwd) : null, flagValues(flags2, "--only"))) return;
  const { out, stale } = await preToolCodex(dir, input, Date.now(), { enforce: flags2.includes("--enforce") });
  if (out) process.stdout.write(out);
  if (stale && await refreshDue(dir, Date.now())) refreshBehind({ ...process.env, CLAUDE_PLUGIN_DATA: dir });
}
async function run(command2, flags2) {
  const dir = flagValues(flags2, "--data")[0] ?? dataDir();
  await mkdir2(dir, { recursive: true, mode: 448 });
  if (command2 === "hook" && flags2.includes("--codex")) return runCodexHook(dir, flags2).catch(() => void 0);
  if (command2 === "hook") return runHook(dir).catch(() => void 0);
  if (command2 === "refresh") {
    const done = await refresh(dir).catch(() => false);
    if (flags2.includes("--say")) console.log(done ? "rules refreshed" : "could not refresh: the saved copy stands");
    return;
  }
  if (command2 === "connect") {
    const noBrowser = flags2.includes("--no-browser");
    const url = flags2.find((flag) => !flag.startsWith("--")) ?? process.env.CLAUDE_PLUGIN_OPTION_WORKSPACE_URL ?? (await readCredentials(dir))?.url;
    if (!url) {
      console.log("usage: guard connect <workspace mcp url> [--no-browser] [--loopback]");
      process.exitCode = 2;
      return;
    }
    if (flags2.includes("--loopback")) await connect({ url, dir, scope: SCOPE2, clientName: "CommonRig guard", show: (link) => console.log(`Open this, sign in and allow it, then paste the address you land on if asked:
${link}`), pasted: noBrowser ? pastedLine() : void 0 });
    else {
      const done = await connectDevice({
        url,
        asks: [{ label: "guard", dir, scope: SCOPE2, clientName: "CommonRig guard", ticked: true }],
        show: ({ code, url: page, complete, minutes }) => console.log(`Open ${page} on any device signed in to CommonRig and enter:

    ${code}

Or open ${complete}
The code works for ${minutes} minutes. Waiting...`)
      });
      if (!done.length) {
        console.log("nothing was ticked, so nothing was saved");
        process.exit(0);
      }
    }
    const fetched = await refresh(dir).catch(() => false);
    console.log(fetched ? "signed in: this machine now fetches its rules" : "signed in, but the rules did not come through yet. Run refresh, or it tries again by itself");
    process.exit(0);
  }
  if (command2 === "disconnect") {
    await removeCredentials(dir);
    console.log("signed out here. The saved copy stays until you turn the guard off. Revoke the device under Agents to end it on the server too");
    return;
  }
  if (command2 === "off" || command2 === "on") {
    await setOff(dir, command2 === "off");
    console.log(`guard ${command2} on this machine`);
    return;
  }
  if (command2 === "status") {
    console.log(JSON.stringify(statusOf(await readCopy(dir), await switchedOff(dir), Boolean(await readCredentials(dir)), Date.now())));
    return;
  }
  console.log("usage: guard hook | connect <url> [--loopback] [--no-browser] | disconnect | refresh [--say] | on | off | status");
  process.exitCode = 2;
}
async function pastedLine() {
  const { createInterface } = await import("node:readline");
  for await (const line2 of createInterface({ input: process.stdin })) if (line2.trim()) return line2;
  return null;
}
var [command, ...flags] = process.argv.slice(2);
await run(command, flags).catch((error) => {
  console.log(`could not finish: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
