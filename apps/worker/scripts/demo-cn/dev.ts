import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import net from "node:net";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { mkdirSync,existsSync,readFileSync,writeFileSync,createReadStream } from "node:fs";
import {realpath, stat} from "node:fs/promises";
import { projectSnapshots } from "./project-snapshots.ts";
import { handleProjectBot } from "./pulse-bot.ts";
import {handleProjectAssistantChat} from "./project-assistant-chat.ts";
import { handleDemoBot } from "./demo-bot.ts";
import { people } from "./data.ts";
import { companyPilotLedger, companyPilotRepo, pilotRepo, syncPilotPRs } from "./pr-pilot.ts";

// The Worker stays on loopback; --lan exposes only the application proxy with the same demo state.
const root = path.resolve(import.meta.dirname, "../../../..");
export const origin = "http://localhost:5174";
export const identity = "ember-demo-cn-v1";
const state = path.join(root, ".wrangler/demo-cn");
const demoEmailByLogin = new Map<string, string>(people.flatMap(([key, , , loginAliases]) =>
  loginAliases.map(alias => [alias, `${key}@demo.example.com`] as const)));
const lan = process.argv.slice(2).includes("--lan");
const tlsDir = lan ? process.env.EMBER_LAN_TLS_DIR : undefined;
const tlsProxyKey = tlsDir && readFileSync(path.join(tlsDir, "proxy-key"), "utf8").trim();
const isTls = (req: http.IncomingMessage) => (req.socket as TLSSocket).encrypted === true;
const prPollIntervalMs = 30 * 60_000;
if (process.argv.slice(2).some(arg => arg !== "--lan")) throw new Error("启动参数只支持 --lan。");
const loopback = (address: string | undefined) => address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
const localPath = (req: http.IncomingMessage) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", origin).pathname);
    return pathname.startsWith("/__") || pathname.startsWith("/cdn-cgi/local");
  } catch {return true;}
};
const headersOf = (req: http.IncomingMessage) => {
  const headers = {...req.headers};
  delete headers.forwarded;
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  delete headers["x-ember-lan-tls"];
  delete headers["x-ember-lan-origin"];
  delete headers["x-ember-lan-site"];
  if (tlsProxyKey && isTls(req)) {
    headers["x-ember-lan-tls"] = tlsProxyKey;
    headers["x-ember-lan-origin"] = encodeURIComponent(req.headers.origin ?? "");
    headers["x-ember-lan-site"] = req.headers["sec-fetch-site"] ?? "";
  }
  if (!loopback(req.socket.remoteAddress)) headers["cf-connecting-ip"] = req.socket.remoteAddress?.replace(/^::ffff:/, "");
  return headers;
};
mkdirSync(state, { recursive: true });
const assetRoot = path.join(state, "web-dist");
const webRoot = path.join(root, "apps/web");
execFileSync(process.execPath, [path.join(webRoot, "node_modules/vite/bin/vite.js"), "build", "--mode", "demo-cn", "--outDir", assetRoot, "--emptyOutDir"], {cwd:webRoot, stdio:"inherit"});
const staticPrefixes = ["/assets/", "/emojibase/", "/iconoir/", "/lucide/", "/logos/", "/browsers/", "/screenshots/", "/shortcuts/"];
const mime: Record<string, string> = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".woff2": "font/woff2"};
async function staticAsset(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const pathname = decodeURIComponent(new URL(req.url!, origin).pathname);
    const filename = await realpath(path.resolve(assetRoot, `.${pathname}`));
    if (!filename.startsWith(`${assetRoot}${path.sep}`)) {res.writeHead(404).end(); return;}
    const info = await stat(filename);
    if (!info.isFile()) {res.writeHead(404).end(); return;}
    const etag = `"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    const headers = {"Content-Type": mime[path.extname(filename)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": pathname === "/app-version.json" ? "no-cache" : pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600", ETag: etag};
    if (req.headers["if-none-match"] === etag) {res.writeHead(304, headers).end(); return;}
    res.writeHead(200, {...headers, "Content-Length": info.size});
    if (req.method === "HEAD") res.end();
    else createReadStream(filename).on("error", () => res.destroy()).pipe(res);
  } catch {if (!res.headersSent) res.writeHead(404); res.end();}
}
async function demoSignIn(req: http.IncomingMessage, res: http.ServerResponse) {
  const reply = (status: number, error: string) => res.writeHead(status, {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  }).end(JSON.stringify({error}));
  if (req.method !== "POST" || req.headers.origin !== `${isTls(req) ? "https" : "http"}://${req.headers.host}` || req.headers["sec-fetch-site"] === "cross-site") {
    reply(405, "请从演示登录页进入。");
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) {reply(413, "账号信息过长。"); return;}
      chunks.push(chunk);
    }
    const {emailAddress} = JSON.parse(Buffer.concat(chunks).toString());
    const {accounts, password} = JSON.parse(readFileSync(path.join(state, "accounts.json"), "utf8")) as {
      accounts: {emailAddress: string; loginAlias?: string; loginAliases?: string[]}[]; password: string;
    };
    const login = typeof emailAddress === "string" ? emailAddress.trim().toLowerCase() : "";
    const resolvedLogin = demoEmailByLogin.get(login) ?? login;
    const account = login === "admin" ? accounts[0] : accounts.find(person =>
      person.emailAddress.toLowerCase() === resolvedLogin ||
      person.loginAliases?.includes(login) ||
      person.loginAlias === login);
    if (!account) {reply(401, "请使用已有的演示账号。"); return;}
    const body = JSON.stringify({emailAddress: account.emailAddress, password});
    const upstream = http.request({
      hostname: "127.0.0.1", port: 8790, path: "/api/session", method: "POST",
      headers: {...headersOf(req), "content-type": "application/json", "content-length": Buffer.byteLength(body)},
    }, answer => {
      res.writeHead(answer.statusCode!, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => reply(503, "演示服务正在启动，请稍后重试。"));
    upstream.end(body);
  } catch {
    reply(400, "无法读取演示账号。");
  }
}

const handleRequest: http.RequestListener = (req, res) => {
  // Local tooling and webhook secrets are never exposed through the LAN entry.
  if (!loopback(req.socket.remoteAddress) && localPath(req)) {res.writeHead(404).end(); return;}
  if (handleDemoBot(req, res)) return;
  if (handleProjectBot(req,res)) return;
  if (handleProjectAssistantChat(req, res)) return;
  if (req.url === "/__demo_cn_identity") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ identity, storage: ".wrangler/demo-cn/state" }));
    return;
  }
  const pathname = new URL(req.url || "/", origin).pathname;
  if (pathname === "/api/demo-session") {void demoSignIn(req, res); return;}
  if (["GET", "HEAD"].includes(req.method || "") && (staticPrefixes.some(prefix => pathname.startsWith(prefix)) || ["/ember-icon.png", "/app-version.json", "/globe.svg"].includes(pathname))) {void staticAsset(req, res); return;}
  const upstream = http.request({ hostname: "127.0.0.1", port: 8790, path: req.url, method: req.method, headers: headersOf(req) }, (answer) => {
    const challenge = answer.headers["www-authenticate"];
    if (isTls(req) && pathname === "/mcp" && typeof challenge === "string") {
      answer.headers["www-authenticate"] = challenge.replace('resource_metadata="http://', 'resource_metadata="https://');
    }
    res.writeHead(answer.statusCode!, answer.headers);
    answer.pipe(res);
  });
  res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
  upstream.on("error", () => { if (!res.headersSent) res.writeHead(503); res.end("中文演示 Worker 正在启动，请稍后刷新。"); });
  req.pipe(upstream);
};
const server = http.createServer(handleRequest);
const handleUpgrade = (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
  if (!loopback(req.socket.remoteAddress) && localPath(req)) {socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return;}
  const upstream = net.connect(8790, "127.0.0.1", () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headersOf(req)).filter(([,value])=>value!==undefined).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
};
server.on("upgrade", handleUpgrade);
const secureServer = tlsDir && https.createServer({cert: readFileSync(path.join(tlsDir, "server.pem")), key: readFileSync(path.join(tlsDir, "server-key.pem"))}, handleRequest);
if (secureServer) secureServer.on("upgrade", handleUpgrade);
server.on("error", (error) => { console.error(error); process.exit(1); });
server.listen(5174, lan ? "0.0.0.0" : "127.0.0.1", async () => {
  // Refuse an occupied upstream port before starting, so the proxy cannot seed an unrelated Worker.
  const probe = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(8790, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } catch { console.error("8790 已被占用；中文演示未启动。"); server.close(); process.exitCode = 1; return; }
  const config=path.join(state,"pulse.wrangler.json");
  if (existsSync(config)) {
    const configured = JSON.parse(readFileSync(config, "utf8"));
    configured.assets.directory = assetRoot;
    if (tlsProxyKey) configured.vars.EMBER_LAN_TLS_PROXY_KEY = tlsProxyKey;
    const deviceBindingKey = path.join(state, "pulse-device-bind-token");
    if (existsSync(deviceBindingKey)) configured.vars.PULSE_DEVICE_BIND_TOKEN = readFileSync(deviceBindingKey, "utf8").trim();
    configured.vars.PULSE_DEMO_SNAPSHOTS = JSON.stringify(projectSnapshots(state));
    const linkFile = path.join(state, "pulse-link.json");
    const sessionFile = path.join(state, "pulse-session.json");
    if (existsSync(linkFile) && existsSync(sessionFile)) {
      const {botId} = JSON.parse(readFileSync(linkFile, "utf8"));
      // The demo coordinator is the administrator who linked the six project rooms.
      const {user} = JSON.parse(readFileSync(sessionFile, "utf8"));
      configured.vars.PULSE_MENTION_PRIORITY = [botId, user?.id].filter(Boolean).join(",");
    }
    writeFileSync(config, JSON.stringify(configured, null, 2), {mode: 0o600});
  }
  if (secureServer) secureServer.listen(5443, "0.0.0.0");
  const child = spawn(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", "8790", "--name", "ember-demo-cn", "-c", existsSync(config)?config:path.join(root, "wrangler.jsonc"), "--persist-to", path.join(state, "state"), "--var", "SESSION_SECRET:demo-cn-local-only", "--var", "EMBER_GUEST_SIGN_IN:false", ...(lan ? ["--var", "DISABLE_SSL:lan-http"] : [])], { cwd: root, stdio: "inherit" });
  child.on("exit", (code) => { server.close(); process.exit(code ?? 1); });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { child.kill(signal); server.close(); if (secureServer) secureServer.close(); });
  function startPRPoll(ledger: string, company: boolean) {
    if (!existsSync(ledger)) return;
    const repo = company ? companyPilotRepo : pilotRepo;
    const poll = async () => {
      try {
        const {scanned, sent} = await syncPilotPRs({company});
        console.log(`${repo} PR 检查 ${scanned} 条，推送 ${sent} 条。`);
      } catch (error) {
        console.error(`${repo} PR 同步失败，将在下一轮重试：`, error instanceof Error ? error.message : "unknown");
      }
      if (server.listening) setTimeout(poll, prPollIntervalMs).unref();
    };
    setTimeout(poll, 5000).unref();
  }
  startPRPoll(path.join(state, "pr-pilot-state.json"), false);
  startPRPoll(companyPilotLedger, true);
  console.log(`中文演示：${origin}（独立存储 ${state}/state）`);
  if (lan) for (const [name, addresses] of Object.entries(networkInterfaces())) if (/^(en|eth|wlan)/.test(name)) for (const address of addresses || []) if (address.family === "IPv4" && !address.internal) console.log(`局域网入口：http://${address.address}:5174`);
});
