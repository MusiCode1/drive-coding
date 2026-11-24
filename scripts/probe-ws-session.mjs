// Run on Node 22+: node scripts/probe-ws-session.mjs <base URL> <agent id>
const [base, agentId] = process.argv.slice(2)
if (!base || !agentId) {
  console.error("Usage: node scripts/probe-ws-session.mjs <base URL> <agent id>")
  process.exit(2)
}

const address = new URL(`/ws/session/${encodeURIComponent(agentId)}`, base)
address.protocol = address.protocol === "https:" ? "wss:" : "ws:"

await new Promise((resolve, reject) => {
  const socket = new WebSocket(address)
  let snapshotReceived = false
  let promptAccepted = false
  let toolOutputId
  const timer = setTimeout(
    () => finish(new Error("Timed out waiting for snapshot, RPC and tool output")),
    90_000,
  )

  function finish(error) {
    clearTimeout(timer)
    socket.close()
    if (error) reject(error)
    else resolve()
  }

  socket.addEventListener("close", (event) => {
    if (!promptAccepted || toolOutputId === undefined) {
      finish(new Error(`WebSocket closed before the probe completed (code ${event.code})`))
    }
  })
  socket.addEventListener("error", () => finish(new Error("WebSocket connection failed")))
  socket.addEventListener("message", (event) => {
    try {
      const envelope = JSON.parse(event.data)
      if (envelope.event === "snapshot" && !snapshotReceived) {
        snapshotReceived = true
        const { sessionId } = JSON.parse(envelope.data)
        if (!sessionId) throw new Error("Snapshot is missing a session ID")
        console.log(`snapshot id: ${envelope.id}`)
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "_drive/rpc",
            params: { method: "session/prompt", params: { sessionId, content: "run: echo hi" } },
          }),
        )
      } else if (envelope.id === 1 && "result" in envelope) {
        if (envelope.result.status !== 202) {
          throw new Error(`Prompt returned status ${envelope.result.status}`)
        }
        promptAccepted = true
        console.log("prompt status: 202")
      } else if (envelope.event === "update" && toolOutputId === undefined) {
        const updates = JSON.parse(envelope.data)
        if (
          updates.some((entry) => entry.params?.update?._meta?.["_drive/toolOutput"] !== undefined)
        ) {
          toolOutputId = envelope.id
          console.log(`tool output id: ${toolOutputId}`)
        }
      } else if (envelope.event === "error") {
        throw new Error("Server sent a stream error")
      }
      if (promptAccepted && toolOutputId !== undefined) finish()
    } catch (error) {
      finish(error)
    }
  })
})
