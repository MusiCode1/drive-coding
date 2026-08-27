import type { Bubble } from "$lib/types/bubble"

export type BubbleSide = "start" | "end"
export type BubbleAvatarKind = "user" | "agent" | "thought" | "tool"

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
