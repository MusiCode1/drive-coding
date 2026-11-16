// Minimal JSON-lines client for codex app-server over a child's stdio.
import { spawn } from "node:child_process";
import readline from "node:readline";
export function client(cmd, args, tag, log) {
  const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd: "/tmp/codex-probe" });
  const pending = new Map(); let id = 0; const notes = [];
  readline.createInterface({ input: p.stdout }).on("line", (l) => {
    let m; try { m = JSON.parse(l); } catch { log(`${tag} RAW ${l.slice(0,200)}`); return; }
    if (m.id !== undefined && pending.has(m.id) && !m.method) { pending.get(m.id)(m); pending.delete(m.id); return; }
    notes.push(m);
    if (m.id !== undefined && m.method) { log(`${tag} SERVER-REQ ${m.method} ${JSON.stringify(m.params).slice(0,300)}`); return; }
    log(`${tag} NOTE ${m.method} ${JSON.stringify(m.params ?? {}).slice(0,260)}`);
  });
  p.stderr.on("data", (d) => { const s = d.toString().trim(); if (s) log(`${tag} STDERR ${s.slice(0,300)}`); });
  const req = (method, params, ms = 30000) => new Promise((res) => {
    const myId = ++id; pending.set(myId, res);
    p.stdin.write(JSON.stringify({ id: myId, method, params }) + "\n");
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); res({ timeout: true }); } }, ms);
  });
  const notify = (method, params) => p.stdin.write(JSON.stringify({ method, params }) + "\n");
  const init = async () => { const r = await req("initialize", { clientInfo: { name: "dc-probe", version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } }); notify("initialized", {}); return r; };
  return { p, req, notify, init, notes };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
