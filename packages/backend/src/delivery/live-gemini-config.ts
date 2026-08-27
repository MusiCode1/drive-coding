/**
 * live-gemini-config.ts — sole authority for Gemini Live session config shape.
 *
 * Slice: live-contract-gemini, Commit 1.
 * Pure — no IO, no SDK imports. Must match SESSION_CONFIG in probe-live-token-modes.mjs.
 */

import type { LiveActionParam, LiveActionSpec } from "@drive-coding/core/voice/live-actions"

const GEMINI_TYPE: Record<LiveActionParam["type"], string> = {
  string: "STRING",
  number: "NUMBER",
  boolean: "BOOLEAN",
}

function declarationFromAction(action: LiveActionSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const param of action.params) {
    const prop: Record<string, unknown> = {
      type: GEMINI_TYPE[param.type],
      description: param.description,
    }
    if (param.enumValues !== undefined && param.enumValues.length > 0) {
      prop.enum = [...param.enumValues]
    }
    properties[param.name] = prop
    if (param.required) required.push(param.name)
  }

  return {
    name: action.name,
    description: action.description,
    parameters: {
      type: "OBJECT",
      properties,
      required,
    },
  }
}

/** Builds the session config object locked into the ephemeral token constraints. */
export function buildGeminiLiveConfig(opts: {
  actions: readonly LiveActionSpec[]
  systemInstruction: string
  voiceName: string
}): Record<string, unknown> {
  return {
    responseModalities: ["AUDIO"],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } },
    },
    tools: [{ functionDeclarations: opts.actions.map(declarationFromAction) }],
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    thinkingConfig: { thinkingBudget: 0 },
  }
}
