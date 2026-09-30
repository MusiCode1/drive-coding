/** Sends intentional $/detach before closing transport; failures are non-fatal (closed pipe). */
export function sendDetachFrame(transport: { sendRaw(frame: string): void }): void {
  try {
    transport.sendRaw(`${JSON.stringify({ jsonrpc: "2.0", method: "$/detach" })}
`)
  } catch {
    // transport already closed — leaveRunning / navigate-away must not surface this
  }
}
