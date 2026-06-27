import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureStateSubdir } from "./paths.js"

export type TlsMaterial = { key: string; cert: string }

/**
 * Resolves TLS material from DRIVE_CODING_HTTPS (JSON in env).
 * - undefined / "false" / broken  -> null (HTTP).
 * - {"key":path,"cert":path}      -> readFileSync(path, "utf8") of both -> TlsMaterial.
 * - true                          -> self-signed: state-dir/tls/key.pem + cert.pem.
 *     Exists -> read. Missing -> selfsigned.generate -> write (0600 if possible) -> return.
 *     Idempotent (like plugin extraction).
 */
export function resolveTls(env: NodeJS.ProcessEnv): TlsMaterial | null {
  const raw = env["DRIVE_CODING_HTTPS"]

  if (!raw) return null

  // Parse value
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn("[tls] DRIVE_CODING_HTTPS is not valid JSON — ignoring (HTTP mode):", raw)
    return null
  }

  // "false" or false
  if (parsed === false || parsed === "false") return null

  // true -> self-signed (idempotent)
  if (parsed === true) {
    return resolveSelfSigned()
  }

  // {key, cert} paths
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "key" in parsed &&
    "cert" in parsed &&
    typeof (parsed as Record<string, unknown>).key === "string" &&
    typeof (parsed as Record<string, unknown>).cert === "string"
  ) {
    const keyPath = (parsed as { key: string; cert: string }).key
    const certPath = (parsed as { key: string; cert: string }).cert
    try {
      const key = readFileSync(keyPath, "utf8")
      const cert = readFileSync(certPath, "utf8")
      return { key, cert }
    } catch (err) {
      console.warn("[tls] Failed to read key/cert files — ignoring (HTTP mode):", err)
      return null
    }
  }

  console.warn("[tls] DRIVE_CODING_HTTPS has unexpected shape — ignoring (HTTP mode):", parsed)
  return null
}

function resolveSelfSigned(): TlsMaterial | null {
  const tlsDir = ensureStateSubdir("tls")
  const keyPath = join(tlsDir, "key.pem")
  const certPath = join(tlsDir, "cert.pem")

  // Idempotent: read if both exist
  if (existsSync(keyPath) && existsSync(certPath)) {
    const key = readFileSync(keyPath, "utf8")
    const cert = readFileSync(certPath, "utf8")
    return { key, cert }
  }

  // Generate new self-signed cert
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const selfsigned = require("selfsigned") as {
    generate: (
      attrs: Array<{ name: string; value: string }>,
      opts: {
        days?: number
        keySize?: number
        algorithm?: string
        extensions?: unknown[]
      },
    ) => { private: string; cert: string }
  }

  const attrs = [{ name: "commonName", value: "localhost" }]
  const opts = {
    days: 825,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" }, // DNS
          { type: 7, ip: "127.0.0.1" }, // IP
        ],
      },
    ],
  }

  const pems = selfsigned.generate(attrs, opts)

  try {
    mkdirSync(tlsDir, { recursive: true })
    writeFileSync(keyPath, pems.private, { encoding: "utf8", mode: 0o600 })
    writeFileSync(certPath, pems.cert, { encoding: "utf8", mode: 0o600 })
  } catch (err) {
    console.warn("[tls] Failed to write self-signed cert files:", err)
    // Still return the generated material even if we couldn't persist
    return { key: pems.private, cert: pems.cert }
  }

  return { key: pems.private, cert: pems.cert }
}
