export function wsClient(url, tag, log) {
  const ws = new WebSocket(url); const pending = new Map(); let id = 0; const notes = [];
  const open = new Promise((r, j) => { ws.onopen = r; ws.onerror = (e) => j(e); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.id !== undefined && !m.method && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    notes.push(m); log(`${tag} ${m.id !== undefined ? "SERVER-REQ" : "NOTE"} ${m.method} ${JSON.stringify(m.params ?? {}).slice(0, 200)}`); };
  const req = (method, params, ms = 30000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ timeout: true }); } }, ms); });
  const init = async () => { await open; const r = await req("initialize", { clientInfo: { name: "dc-probe-" + tag, version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } }); ws.send(JSON.stringify({ method: "initialized", params: {} })); return r; };
  return { ws, req, init, notes };
}
