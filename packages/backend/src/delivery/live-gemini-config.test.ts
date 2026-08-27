/**
 * live-gemini-config.test.ts — product config must match measured SESSION_CONFIG.
 *
 * Slice: live-contract-gemini, Commit 1 (DoD #17).
 */

import { buildLiveActions } from "@drive-coding/core/voice/live-actions"
import { describe, expect, it } from "vitest"
import { buildGeminiLiveConfig } from "./live-gemini-config.js"

/** Anchor: SESSION_CONFIG in scripts/probe-live-token-modes.mjs (minus Modality enum). */
const MEASURED_SESSION_CONFIG = {
  responseModalities: ["AUDIO"],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
  tools: [
    {
      functionDeclarations: [
        {
          name: "compose_prompt",
          description:
            "נסח ושלח בקשה לסוכן הקוד בשם המשתמש. מחזיר קבלה מיידית; התשובה מגיעה בערוץ אחר. " +
            "אם קיבלת status:not_sent — אמור למשתמש שהבקשה לא נשלחה ומדוע; אל תאשר שליחה.",
          parameters: {
            type: "OBJECT",
            properties: {
              text: { type: "STRING", description: "הבקשה המנוסחת במלואה." },
            },
            required: ["text"],
          },
        },
        {
          name: "cancel_turn",
          description: "בטל את הריצה הנוכחית של הסוכן.",
          parameters: { type: "OBJECT", properties: {}, required: [] },
        },
      ],
    },
  ],
  systemInstruction: {
    parts: [{ text: "test secretary prompt" }],
  },
  thinkingConfig: { thinkingBudget: 0 },
}

describe("buildGeminiLiveConfig()", () => {
  it("matches measured SESSION_CONFIG shape for a subset of actions", () => {
    const actions = buildLiveActions(["compose_prompt", "cancel_turn"])
    const built = buildGeminiLiveConfig({
      actions,
      systemInstruction: "test secretary prompt",
      voiceName: "Puck",
    })

    expect(built.responseModalities).toEqual(MEASURED_SESSION_CONFIG.responseModalities)
    expect(built.inputAudioTranscription).toEqual(MEASURED_SESSION_CONFIG.inputAudioTranscription)
    expect(built.outputAudioTranscription).toEqual(MEASURED_SESSION_CONFIG.outputAudioTranscription)
    expect(built.speechConfig).toEqual(MEASURED_SESSION_CONFIG.speechConfig)
    expect(built.systemInstruction).toEqual(MEASURED_SESSION_CONFIG.systemInstruction)
    expect(built.thinkingConfig).toEqual(MEASURED_SESSION_CONFIG.thinkingConfig)

    const builtTools = built.tools as typeof MEASURED_SESSION_CONFIG.tools
    const decls = builtTools[0]?.functionDeclarations as Record<string, unknown>[]
    expect(decls).toHaveLength(2)
    expect(decls.map((d) => d.name)).toEqual(["compose_prompt", "cancel_turn"])
    expect(decls[0]).toMatchObject(MEASURED_SESSION_CONFIG.tools[0]!.functionDeclarations[0]!)
    expect(decls[1]).toMatchObject(MEASURED_SESSION_CONFIG.tools[0]!.functionDeclarations[1]!)
  })

  it("includes non-empty tools when all actions are requested", () => {
    const actions = buildLiveActions()
    const built = buildGeminiLiveConfig({
      actions,
      systemInstruction: "x",
      voiceName: "Puck",
    })
    const tools = built.tools as { functionDeclarations: unknown[] }[]
    expect(tools[0]?.functionDeclarations.length).toBe(12)
  })
})
