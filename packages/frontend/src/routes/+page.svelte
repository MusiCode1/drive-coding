<script lang="ts">
import { onDestroy } from "svelte"

type LogEntry = { time: string; direction: "→" | "←"; payload: string }

let log = $state<LogEntry[]>([])
let ws = $state<WebSocket | null>(null)
// biome-ignore lint/correctness/noUnusedVariables: used in template
let status = $state<"disconnected" | "connecting" | "connected">("disconnected")

function addLog(direction: "→" | "←", payload: string): void {
  log = [{ time: new Date().toLocaleTimeString(), direction, payload }, ...log.slice(0, 19)]
}

// biome-ignore lint/correctness/noUnusedVariables: used in template
function connect(): void {
  if (ws) return
  status = "connecting"
  const socket = new WebSocket(`ws://${location.host}/ws/echo`)
  socket.onopen = () => {
    status = "connected"
    addLog("←", "[opened]")
  }
  socket.onmessage = (e) => addLog("←", String(e.data))
  socket.onerror = () => addLog("←", "[error]")
  socket.onclose = () => {
    status = "disconnected"
    ws = null
    addLog("←", "[closed]")
  }
  ws = socket
}

// biome-ignore lint/correctness/noUnusedVariables: used in template
function sendPing(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const msg = JSON.stringify({ type: "ping" })
  ws.send(msg)
  addLog("→", msg)
}

// biome-ignore lint/correctness/noUnusedVariables: used in template
function disconnect(): void {
  ws?.close()
}

onDestroy(() => ws?.close())
</script>

<main>
  <h1>drive-coding — Slice 1</h1>
  <p>Status: <strong>{status}</strong></p>
  <div class="actions">
    {#if status === "disconnected"}
      <button onclick={connect}>Connect</button>
    {:else}
      <button onclick={sendPing} disabled={status !== "connected"}>Send ping</button>
      <button onclick={disconnect}>Disconnect</button>
    {/if}
  </div>
  <ul class="log">
    {#each log as entry (entry.time + entry.payload)}
      <li><code>{entry.time}</code> {entry.direction} <code>{entry.payload}</code></li>
    {/each}
  </ul>
</main>

<style>
  main { max-width: 720px; margin: 2rem auto; font-family: system-ui, sans-serif; }
  .actions { display: flex; gap: 0.5rem; margin: 1rem 0; }
  button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
  .log { list-style: none; padding: 0; }
  .log li { padding: 0.25rem 0; border-bottom: 1px solid #eee; font-size: 0.9rem; }
  code { background: #f5f5f5; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
