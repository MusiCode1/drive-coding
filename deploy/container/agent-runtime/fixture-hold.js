// Long-lived fixture process for cgroup / restart checks (no network, no credentials).
await new Promise((resolve) => {
  const hold = () => setTimeout(hold, 60_000)
  hold()
  // Never resolve in normal use; allow clean exit on SIGTERM.
  process.on("SIGTERM", () => resolve(undefined))
})
