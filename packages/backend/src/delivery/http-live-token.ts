/**
 * http-live-token.ts — POST /api/voice/live/token ephemeral token minting.
 *
 * Slice: live-contract-gemini, Commit 1.
 * IMPORTANT: never log the API key or the minted token.
 */

import { buildLiveActions } from "@drive-coding/core/voice/live-actions"
import { GoogleGenAI } from "@google/genai"
import { type } from "arktype"
import type { Hono } from "hono"
import { buildGeminiLiveConfig } from "./live-gemini-config.js"
import { resolveProviderAuth } from "./proxy-auth.js"

const liveTokenRequestSchema = type({
  "model?": "string",
  "voiceName?": "string",
  systemInstruction: "string",
  actions: "string[]",
})

export interface LiveTokenRequest {
  model?: string
  voiceName?: string
  systemInstruction: string
  actions: readonly string[]
}

export interface LiveTokenResponse {
  token: string
  expiresAt: string
  model: string
  sessionConfig: Record<string, unknown>
}

const DEFAULT_MODEL = "gemini-3.1-flash-live-preview"
const DEFAULT_VOICE = "Puck"

export function registerLiveTokenHttp(app: Hono): void {
  app.post("/api/voice/live/token", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid-json" }, 400)
    }

    const parsed = liveTokenRequestSchema(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: "invalid-body", details: parsed.summary }, 400)
    }

    const auth = resolveProviderAuth("google", process.env)
    if (!auth) {
      return c.json({ error: "no-api-key" }, 503)
    }

    const model = parsed.model ?? DEFAULT_MODEL
    const voiceName = parsed.voiceName ?? DEFAULT_VOICE
    const actions = buildLiveActions(parsed.actions)
    const sessionConfig = buildGeminiLiveConfig({
      actions,
      systemInstruction: parsed.systemInstruction,
      voiceName,
    })

    const expireTime = new Date(Date.now() + 30 * 60_000)
    const newSessionExpireTime = new Date(Date.now() + 60_000)

    // Ephemeral token minting is v1alpha-only; session client uses default api version.
    const admin = new GoogleGenAI({
      apiKey: auth.value,
      httpOptions: { apiVersion: "v1alpha" },
    })

    const tok = await admin.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireTime.toISOString(),
        newSessionExpireTime: newSessionExpireTime.toISOString(),
        liveConnectConstraints: { model, config: sessionConfig },
      },
    })

    const token = tok.name
    if (!token) {
      return c.json({ error: "token-mint-failed" }, 502)
    }

    const response: LiveTokenResponse = {
      token,
      expiresAt: expireTime.toISOString(),
      model,
      sessionConfig,
    }
    return c.json(response)
  })
}

/** @internal Test hook — mint with injected client factory. */
export async function mintLiveTokenForTest(
  body: LiveTokenRequest,
  env: NodeJS.ProcessEnv,
  createClient: (apiKey: string) => {
    authTokens: {
      create: (req: { config: Record<string, unknown> }) => Promise<{ name?: string }>
    }
  },
): Promise<{ status: number; json: unknown }> {
  const parsed = liveTokenRequestSchema(body)
  if (parsed instanceof type.errors) {
    return { status: 400, json: { error: "invalid-body" } }
  }

  const auth = resolveProviderAuth("google", env)
  if (!auth) {
    return { status: 503, json: { error: "no-api-key" } }
  }

  const model = parsed.model ?? DEFAULT_MODEL
  const voiceName = parsed.voiceName ?? DEFAULT_VOICE
  const actions = buildLiveActions(parsed.actions)
  const sessionConfig = buildGeminiLiveConfig({
    actions,
    systemInstruction: parsed.systemInstruction,
    voiceName,
  })

  const expireTime = new Date(Date.now() + 30 * 60_000)
  const newSessionExpireTime = new Date(Date.now() + 60_000)

  const admin = createClient(auth.value)
  const tok = await admin.authTokens.create({
    config: {
      uses: 1,
      expireTime: expireTime.toISOString(),
      newSessionExpireTime: newSessionExpireTime.toISOString(),
      liveConnectConstraints: { model, config: sessionConfig },
    },
  })

  if (!tok.name) {
    return { status: 502, json: { error: "token-mint-failed" } }
  }

  return {
    status: 200,
    json: {
      token: tok.name,
      expiresAt: expireTime.toISOString(),
      model,
      sessionConfig,
    },
  }
}
