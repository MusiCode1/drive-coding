import type { Bubble, BubbleVoice } from "$lib/types/bubble"

export type BubbleSide = "start" | "end"
export type BubbleAvatarKind = "user" | "agent" | "thought" | "tool" | "voice"

export function bubbleSide(kind: Bubble["kind"]): BubbleSide {
  return kind === "user" ? "end" : "start"
}

export function bubbleAvatarKind(kind: Bubble["kind"]): BubbleAvatarKind {
  switch (kind) {
    case "user":
      return "user"
    case "message":
      return "agent"
    case "thought":
      return "thought"
    case "tool":
      return "tool"
  }
}

/**
 * slice codex-voice-poc — where a voice-conversation message sits: the user's own speech on the
 * user side; the voice's speech and its handoffs to the agent on the agent side, with the voice avatar.
 */
export function voicePlacement(voice: BubbleVoice): { side: BubbleSide; avatar: BubbleAvatarKind } {
  if (voice.kind === "speech" && voice.role === "user") return { side: "end", avatar: "user" }
  return { side: "start", avatar: "voice" }
}
