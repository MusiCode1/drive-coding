/**
 * voice-catalog.ts — descriptions and sample clips for Codex's realtime (v3) voices.
 *
 * Codex's `thread/realtime/listVoices` returns names only. ChatGPT's own voice picker has the rest.
 *
 * Source (captured 2026-11-18, from a logged-in ChatGPT voice settings page):
 *   GET https://chatgpt.com/backend-api/settings/voices?spoken_language=he&voice_mode=wingman
 *   → { voices: [{ voice, name, description, accent, preview_url, … }] }
 * It is a private, undocumented ChatGPT endpoint — not called at runtime; this table is a snapshot.
 * Public trace of the same endpoint and CDN path:
 *   https://github.com/WSL043/dsh-codex-subscription/issues/205
 * Descriptions of the nine base voices also appear on https://help.openai.com/en/articles/20001274-chatgpt-voice
 *
 * Sample clips are on OpenAI's public CDN (no key needed). Their file names carry a version that
 * changes over time (maple was `maple.en.abff11d0.m4a` in October, `maple.en.bidibidi.m4a` now),
 * so a clip may start returning 404 — the picker then simply has no sample for that voice.
 *
 * Three voices have a different id in ChatGPT: spruce = "orbit", sol = "glimmer", arbor = "fathom".
 * porto and selva (offered by Codex) are not in ChatGPT's catalog.
 *
 * Slice: codex-voice-poc.
 */

export type CodexVoiceInfo = {
  /** The voice's id in ChatGPT's catalog (differs from Codex's for three voices). */
  chatgptId: string
  name: string
  accent: string
  description?: string
  previewUrl: string
}

/** Keyed by the Codex voice id (what `_codex/realtime/listVoices` returns). */
export const CODEX_VOICE_CATALOG: Readonly<Record<string, CodexVoiceInfo>> = {
  juniper: {
    chatgptId: "juniper",
    name: "Juniper",
    accent: "American English",
    description: "Open and upbeat",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/juniper.en.bidibidi.m4a",
  },
  maple: {
    chatgptId: "maple",
    name: "Maple",
    accent: "American English",
    description: "Cheerful and candid",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/maple.en.bidibidi.m4a",
  },
  spruce: {
    chatgptId: "orbit",
    name: "Spruce",
    accent: "American English",
    description: "Calm and affirming",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/orbit.en.bidibidi.m4a",
  },
  ember: {
    chatgptId: "ember",
    name: "Ember",
    accent: "American English",
    description: "Confident and optimistic",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/ember.en.bidibidi.m4a",
  },
  vale: {
    chatgptId: "vale",
    name: "Vale",
    accent: "British English",
    description: "Bright and inquisitive",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/vale.en.bidibidi.m4a",
  },
  breeze: {
    chatgptId: "breeze",
    name: "Breeze",
    accent: "American English",
    description: "Animated and earnest",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/breeze.en.bidibidi.m4a",
  },
  arbor: {
    chatgptId: "fathom",
    name: "Arbor",
    accent: "British English",
    description: "Easygoing and versatile",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/fathom.en.bidibidi.m4a",
  },
  sol: {
    chatgptId: "glimmer",
    name: "Sol",
    accent: "American English",
    description: "Savvy and relaxed",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/glimmer.en.bidibidi.m4a",
  },
  cove: {
    chatgptId: "cove",
    name: "Cove",
    accent: "American English",
    description: "Composed and direct",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/cove.en.bidibidi.m4a",
  },
  aube: {
    chatgptId: "aube",
    name: "Aube",
    accent: "French",
    description: "French female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/aube.en.ad1abad0.m4a",
  },
  bubbie: {
    chatgptId: "bubbie",
    name: "Bubbie",
    accent: "American English",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/bubbie.en.702619c3.m4a",
  },
  haetsal: {
    chatgptId: "haetsal",
    name: "Haetsal",
    accent: "Korean",
    description: "Korean female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/haetsal.en.702619c3.m4a",
  },
  hanul: {
    chatgptId: "hanul",
    name: "Hanul",
    accent: "Korean",
    description: "Korean male",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/hanul.en.702619c3.m4a",
  },
  himari: {
    chatgptId: "himari",
    name: "Himari",
    accent: "Japanese",
    description: "Japanese female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/himari.en.702619c3.m4a",
  },
  leher: {
    chatgptId: "leher",
    name: "Leher",
    accent: "Hindi",
    description: "Hindi female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/leher.en.702619c3.m4a",
  },
  miko: {
    chatgptId: "miko",
    name: "Miko",
    accent: "German",
    description: "German male",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/miko.en.77e04e9c.m4a",
  },
  neer: {
    chatgptId: "neer",
    name: "Neer",
    accent: "Hindi",
    description: "Hindi male",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/neer.en.702619c3.m4a",
  },
  // porto: not in the ChatGPT catalog (no description or sample)
  rindo: {
    chatgptId: "rindo",
    name: "Rindō",
    accent: "Japanese",
    description: "Japanese male",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/rindo.en.702619c3.m4a",
  },
  rio: {
    chatgptId: "rio",
    name: "Rio",
    accent: "Brazilian Portuguese",
    description: "Warm, welcoming, and helpful",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/rio.en.415bb008.m4a",
  },
  rivage: {
    chatgptId: "rivage",
    name: "Rivage",
    accent: "French",
    description: "French male",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/rivage.en.41c99aa1.m4a",
  },
  // selva: not in the ChatGPT catalog (no description or sample)
  sonna: {
    chatgptId: "sonna",
    name: "Sonna",
    accent: "German",
    description: "German female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/sonna.en.767b29c4.m4a",
  },
  tinta: {
    chatgptId: "tinta",
    name: "Tinta",
    accent: "Mexican Spanish",
    description: "Mexican Spanish female",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/tinta.en.702619c3.m4a",
  },
  viola: {
    chatgptId: "viola",
    name: "Viola",
    accent: "Brazilian Portuguese",
    description: "Light, spontaneous, and curious",
    previewUrl: "https://persistent.oaistatic.com/voice/previews/viola.en.415bb008.m4a",
  },
}
