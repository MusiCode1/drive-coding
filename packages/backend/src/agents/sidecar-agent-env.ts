import { type } from "arktype"

export const SIDECAR_AGENT_ENV = "DC_SIDECAR_AGENT_ENV"
export const SIDECAR_INPUT_ENV_LIMIT = 60 * 1024
export const SIDECAR_LAUNCH_ENV_LIMIT = 64 * 1024

const agentEnvSchema = type({ "[string]": "string" })

export function encodeSidecarAgentEnv(env: Record<string, string>): string {
  return Buffer.from(JSON.stringify(env), "utf8").toString("base64")
}

export function consumeSidecarAgentEnv(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const encoded = env[SIDECAR_AGENT_ENV]
  if (encoded === undefined) return undefined
  delete env[SIDECAR_AGENT_ENV]

  const bytes = Buffer.from(encoded, "base64")
  if (bytes.toString("base64") === encoded) {
    try {
      const decoded: unknown = JSON.parse(bytes.toString("utf8"))
      const payload = agentEnvSchema(decoded)
      if (!(payload instanceof type.errors)) return payload
    } catch {
      // Parse errors can quote the input, so use the same fixed diagnostic.
    }
  }
  throw new Error("invalid DC_SIDECAR_AGENT_ENV")
}
