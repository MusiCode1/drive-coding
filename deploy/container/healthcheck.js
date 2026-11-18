// healthcheck.js — probe for the container. Run with: bun healthcheck.js
//
// Why a file and not an inline HealthCmd: Quadlet applies systemd-style
// unquoting to the value, which swallows the closing quote of a nested
// `bun -e "..."`. podman then receives a truncated shell string and every
// probe reports unhealthy. A file needs no quoting at all.
const port = process.env.PORT ?? 4000
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(5000),
  })
  process.exit(res.ok ? 0 : 1)
} catch {
  process.exit(1)
}
