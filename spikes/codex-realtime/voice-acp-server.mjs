// Spikes 1+2 in one browser session.
//   1. Voice handoffs over ACP: the session is opened by an ACP client of codex-acp; the realtime
//      session runs on the SAME thread via a second app-server client. Does the voice-opened turn
//      reach the ACP client as session/update?
//   2. Custom tools via the browser's data channel: the page logs every data-channel event here
//      (POST /dc) and can inject a function tool with session.update.
// Topology: ACP client (this) -> codex-acp (CODEX_PATH=fake-codex) -> shared ws app-server <- realtime client (this).
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "../../packages/provider/node_modules/@agentclientprotocol/sdk/dist/acp.js";
import { wsClient } from "./wsrpc.mjs";

const PORT = Number(process.env.PORT ?? 47921);
const TOKEN = process.env.TOKEN;
if (!TOKEN) throw new Error("TOKEN required");
const HERE = new URL(".", import.meta.url).pathname;
const LOG = `${HERE}voice-acp-events.log`;
const log = (src, o) => appendFileSync(LOG, `${new Date().toISOString()} ${src} ${JSON.stringify(o)}\n`);
const sse = new Set();
const push = (o) => { const d = `data: ${JSON.stringify(o)}\n\n`; for (const r of sse) r.write(d); };

// ── ACP side ────────────────────────────────────────────────────────────────
const agent = spawn("node", [`${HERE}../../packages/provider/node_modules/@musicode1/codex-acp/dist/index.js`], {
  cwd: `${HERE}cwd`, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CODEX_PATH: `${HERE}fake-codex.mjs` },
});
agent.stderr.on("data", (d) => log("adapter-stderr", d.toString().slice(0, 400)));
agent.on("exit", (c) => log("adapter-exit", c));
const conn = new ClientSideConnection(() => ({
  async sessionUpdate(n) {
    const u = n.update;
    log("acp", u);
    if (!/_chunk$/.test(u.sessionUpdate)) push({ src: "acp", kind: u.sessionUpdate, text: u.title ?? u.content?.text ?? "" });
    else push({ src: "acp", kind: u.sessionUpdate, text: u.content?.text ?? "" });
  },
  async requestPermission(p) {
    log("acp-permission", p);
    push({ src: "acp", kind: "requestPermission", text: p.toolCall?.title ?? "" });
    return { outcome: { outcome: "selected", optionId: p.options[0].optionId } };
  },
  async extNotification(m, p) { log("acp-ext", { m, p }); },
  async extMethod(m, p) { log("acp-extMethod", { m, p }); return {}; },
}), ndJsonStream(Writable.toWeb(agent.stdin), Readable.toWeb(agent.stdout)));

await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
const { sessionId } = await conn.newSession({ cwd: `${HERE}cwd`, mcpServers: [] });
log("acp-session", sessionId);
await conn.prompt({ sessionId, prompt: [{ type: "text", text: "Reply with just: ready" }] }); // persists the rollout so a second client can resume
log("acp-ready", sessionId);

// ── realtime control client on the same thread ─────────────────────────────
const V = wsClient(process.env.SHARED_APP_SERVER ?? "ws://127.0.0.1:47811", "V", () => {});
await V.init();
const resumed = await V.req("thread/resume", { threadId: sessionId });
if (resumed.error) throw new Error(`resume: ${JSON.stringify(resumed.error)}`);
V.ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (!m.method || m.method === "thread/realtime/outputAudio/delta" || /^mcpServer|Warning|warning/.test(m.method)) return;
  if (m.params?.threadId !== sessionId) return;
  log("app-server", { method: m.method, params: m.params });
  if (/realtime\/(started|error|closed|transcript\/done)|^turn\//.test(m.method)) {
    push({ src: "app-server", kind: m.method, text: m.params?.text ?? m.params?.message ?? m.params?.reason ?? "" });
  }
});
const waitFor = (pred, ms) => new Promise((res) => {
  const on = (ev) => { const m = JSON.parse(ev.data); if (pred(m)) { V.ws.removeEventListener("message", on); res(m); } };
  V.ws.addEventListener("message", on);
  setTimeout(() => { V.ws.removeEventListener("message", on); res(undefined); }, ms);
});

// ── HTTP ────────────────────────────────────────────────────────────────────
const body = (r) => new Promise((res) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); });
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
http.createServer(async (r, res) => {
  const p = (r.url ?? "").split("?")[0];
  if (!p.startsWith(`/${TOKEN}/`)) { res.writeHead(404); res.end(); return; }
  const route = p.slice(TOKEN.length + 2);
  try {
    if (route === "" && r.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(`${HERE}voice-acp.html`)); return;
    }
    if (route === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.write(": hi\n\n"); sse.add(res); r.on("close", () => sse.delete(res)); return;
    }
    if (route === "offer" && r.method === "POST") {
      const { sdp } = JSON.parse(await body(r));
      const got = waitFor((m) => m.params?.threadId === sessionId && /realtime\/(sdp|error)$/.test(m.method ?? ""), 25000);
      const s = await V.req("thread/realtime/start", { threadId: sessionId, outputModality: "audio", version: "v3", transport: { type: "webrtc", sdp } });
      if (s.error) return json(res, 502, { error: s.error });
      const m = await got;
      if (!m) return json(res, 504, { error: "no sdp within 25s" });
      if (m.method.endsWith("error")) return json(res, 502, { error: m.params.message });
      return json(res, 200, { sdp: m.params.sdp });
    }
    if (route === "dc" && r.method === "POST") { log("dc", JSON.parse(await body(r))); return json(res, 200, {}); }
    if (route === "stop" && r.method === "POST") { await V.req("thread/realtime/stop", { threadId: sessionId }); return json(res, 200, {}); }
    res.writeHead(404); res.end();
  } catch (e) { log("err", String(e)); json(res, 500, { error: String(e) }); }
}).listen(PORT, "127.0.0.1", () => log("listening", { PORT, sessionId }));
