#!/usr/bin/env node
// Stand-in for the `codex` binary: `app-server` is bridged to a shared ws app-server; anything else runs real codex.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import readline from "node:readline";
const args = process.argv.slice(2);
const LOG = new URL("./fake-codex.log", import.meta.url).pathname;
appendFileSync(LOG, `${new Date().toISOString()} argv=${JSON.stringify(args)}\n`);
if (args[0] !== "app-server" || args.some((a) => ["generate-ts", "generate-json-schema", "daemon", "proxy"].includes(a))) {
  const c = spawn(process.env.REAL_CODEX ?? "codex", args, { stdio: "inherit" });
  c.on("exit", (code) => process.exit(code ?? 1));
} else {
  const ws = new WebSocket(process.env.SHARED_APP_SERVER ?? "ws://127.0.0.1:47811");
  const queue = [];
  ws.onopen = () => { for (const l of queue.splice(0)) ws.send(l); };
  ws.onmessage = (ev) => process.stdout.write(`${ev.data}\n`);
  ws.onclose = () => process.exit(0);
  ws.onerror = (e) => { appendFileSync(LOG, `ws error ${e.message ?? e}\n`); process.exit(1); };
  readline.createInterface({ input: process.stdin }).on("line", (l) => { if (!l.trim()) return; ws.readyState === 1 ? ws.send(l) : queue.push(l); });
  process.stdin.on("end", () => ws.close());
}
