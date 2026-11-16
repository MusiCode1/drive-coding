// Spike 1: does a turn opened by the realtime voice model reach an ACP client of codex-acp as session/update?
// Topology: ACP client -> codex-acp (CODEX_PATH=fake-codex) -> shared ws app-server <- realtime probe client.
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "../../packages/provider/node_modules/@agentclientprotocol/sdk/dist/acp.js";
import { sleep } from "./rpc.mjs";
import { wsClient } from "./wsrpc.mjs";
import { FAKE_SDP } from "./fake-sdp.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const t0 = Date.now(); const log = (s) => console.log(String(Date.now() - t0).padStart(6), s);
const SAY = process.argv[2] ?? "Please ask Codex to run the shell command `ls -1 | wc -l` in the current directory and tell me the number it prints.";

const agent = spawn("node", [`${HERE}../../packages/provider/node_modules/@musicode1/codex-acp/dist/index.js`], {
  cwd: `${HERE}cwd`, stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CODEX_PATH: `${HERE}fake-codex.mjs` },
});
agent.stderr.on("data", (d) => { const s = d.toString().trim(); if (/error/i.test(s)) log(`ADAPTER-STDERR ${s.slice(0, 200)}`); });
const acpUpdates = [];
const conn = new ClientSideConnection(() => ({
  async sessionUpdate(n) {
    const u = n.update; acpUpdates.push({ at: Date.now() - t0, u });
    const txt = u.content?.text ?? u.title ?? u.rawInput?.command ?? "";
    if (!/_chunk$/.test(u.sessionUpdate)) log(`ACP ${u.sessionUpdate} ${String(txt).slice(0, 140)}`);
  },
  async requestPermission(p) { log(`ACP requestPermission ${p.toolCall?.title}`); return { outcome: { outcome: "selected", optionId: p.options[0].optionId } }; },
  async extNotification(m, p) { log(`ACP extNotification ${m} ${JSON.stringify(p).slice(0, 160)}`); },
  async extMethod(m) { log(`ACP extMethod ${m}`); return {}; },
}), ndJsonStream(Writable.toWeb(agent.stdin), Readable.toWeb(agent.stdout)));

log("acp init " + JSON.stringify(await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })).slice(0, 120));
const { sessionId } = await conn.newSession({ cwd: `${HERE}cwd`, mcpServers: [] });
log(`acp session ${sessionId}`);
log("acp prompt#1 " + JSON.stringify(await conn.prompt({ sessionId, prompt: [{ type: "text", text: "Reply with just: ready" }] })));

const V = wsClient("ws://127.0.0.1:47811", "V", (s) => { if (/realtime\/(started|error|closed|transcript\/done)|turn\/(started|completed)/.test(s)) log(s.slice(0, 220)); });
await V.init();
const r = await V.req("thread/resume", { threadId: sessionId });
log("voice-client resume " + JSON.stringify(r.error ?? "ok"));
log("rt/start " + JSON.stringify(await V.req("thread/realtime/start", { threadId: sessionId, outputModality: "audio", version: "v3", transport: { type: "webrtc", sdp: FAKE_SDP } })));
for (let i = 0; i < 100 && !V.notes.some((n) => n.method === "thread/realtime/started"); i++) await sleep(100);
await sleep(1000);
const before = acpUpdates.length;
log(`appendText(user): ${SAY}`);
log("appendText " + JSON.stringify(await V.req("thread/realtime/appendText", { threadId: sessionId, text: SAY, role: "user" })));
await sleep(Number(process.env.WAIT_MS ?? 60000));

const after = acpUpdates.slice(before);
const kinds = {}; for (const { u } of after) kinds[u.sessionUpdate] = (kinds[u.sessionUpdate] ?? 0) + 1;
log("ACP updates after appendText: " + JSON.stringify(kinds));
const userText = after.filter(({ u }) => u.sessionUpdate === "user_message_chunk").map(({ u }) => u.content?.text ?? "").join("");
const agentText = after.filter(({ u }) => u.sessionUpdate === "agent_message_chunk").map(({ u }) => u.content?.text ?? "").join("");
log(`ACP user text: ${JSON.stringify(userText.slice(0, 300))}`);
log(`ACP agent text: ${JSON.stringify(agentText.slice(0, 300))}`);
const vTurns = V.notes.filter((n) => n.method === "turn/completed").length;
log(`voice-side turn/completed count: ${vTurns}`);
await V.req("thread/realtime/stop", { threadId: sessionId }); V.ws.close(); agent.kill(); process.exit(0);
