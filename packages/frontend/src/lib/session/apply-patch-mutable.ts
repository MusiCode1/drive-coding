/**
 * apply-patch-mutable.ts — מיישם Patch על Bubble[] של FE (מוטציה ממוקדת).
 *
 * שומר ריאקטיביות Svelte ($state):
 * - append-segment: segments.push() — עובד כי segments[] הוא deep $state proxy.
 * - update-tool: object-replacement (חדש — כמו #handleToolCallUpdate, §8.3).
 * - reset: splice(0) + push(...) — ניקוי ואכלוס.
 *
 * mappers מוזרקים (לא import), מאפשרים stub דטרמיניסטי ב-property test (C3).
 *
 * ─── slice session-state-reducer C3 ───
 */
import type { Patch, SessionMessage } from "@drive-coding/core/session"
import type { Bubble, ToolBubble, ToolContent, ToolLocation } from "$lib/types/bubble"

// ─── Mapper types (injected) ───

export type PatchMappers = {
  mapToolContent: (raw: unknown[]) => ToolContent[]
  mapLocations: (raw: unknown[]) => ToolLocation[]
}

// ─── SessionMessage → Bubble mapping ───

function sessionMsgToBubble(msg: SessionMessage, mappers: PatchMappers): Bubble {
  if (msg.role === "tool") {
    return {
      id: msg.id,
      kind: "tool",
      messageId: null,
      createdAt: 0, // FE-only field — 0 for core-derived bubbles (not visible in replay)
      toolCall: {
        toolCallId: msg.toolCall.toolCallId,
        name: msg.toolCall.name,
        kind: msg.toolCall.kind,
        args: msg.toolCall.args,
        status: msg.toolCall.status,
        title: msg.toolCall.title,
        result: msg.toolCall.result,
        content:
          msg.toolCall.content != null
            ? mappers.mapToolContent(msg.toolCall.content)
            : undefined,
        locations:
          msg.toolCall.locations != null
            ? mappers.mapLocations(msg.toolCall.locations)
            : undefined,
      },
      segments: [],
    } satisfies ToolBubble
  }
  // user / thought / assistant
  const kind = msg.role === "assistant" ? "message" : msg.role === "thought" ? "thought" : "user"
  return {
    id: msg.id,
    kind,
    messageId: msg.messageId,
    createdAt: 0,
    segments: msg.segments,
  } as Bubble
}

// ─── applyPatchMutable ───

/**
 * applyPatchMutable — מיישם רצף patches על Bubble[] ב-מוטציה ממוקדת.
 *
 * @param bubbles  מערך ה-Bubble[] של ה-VM ($state proxy ב-Svelte)
 * @param patches  רשימת patches מ-reduce
 * @param mappers  mapToolContent + mapLocations (מוזרקים, לא import)
 */
export function applyPatchMutable(
  bubbles: Bubble[],
  patches: Patch[],
  mappers: PatchMappers,
): void {
  for (const patch of patches) {
    switch (patch.op) {
      case "add-message": {
        bubbles.push(sessionMsgToBubble(patch.message, mappers))
        break
      }

      case "append-segment": {
        const b = bubbles.find((b) => b.id === patch.targetId)
        if (!b || b.kind === "tool") break
        // segments.push() — עובד עם Svelte $state deep proxy
        b.segments.push(patch.segment)
        break
      }

      case "update-tool": {
        const idx = bubbles.findIndex((b) => b.id === patch.targetId)
        if (idx === -1) break
        const old = bubbles[idx]!
        if (old.kind !== "tool") break

        // immutable object-replacement (כמו #handleToolCallUpdate, שומר reactivity)
        const newToolCall = {
          ...old.toolCall,
          ...(patch.toolCall.status !== undefined && { status: patch.toolCall.status }),
          ...(patch.toolCall.args !== undefined && { args: patch.toolCall.args }),
          ...(patch.toolCall.result !== undefined && { result: patch.toolCall.result }),
          ...(patch.toolCall.kind !== undefined && { kind: patch.toolCall.kind }),
          ...(patch.toolCall.title !== undefined && { title: patch.toolCall.title }),
          ...(patch.toolCall.content !== undefined && {
            content:
              patch.toolCall.content === null
                ? undefined
                : Array.isArray(patch.toolCall.content)
                  ? mappers.mapToolContent(patch.toolCall.content)
                  : undefined,
          }),
          ...(patch.toolCall.locations !== undefined && {
            locations:
              patch.toolCall.locations === null
                ? undefined
                : Array.isArray(patch.toolCall.locations)
                  ? mappers.mapLocations(patch.toolCall.locations)
                  : undefined,
          }),
        }
        bubbles[idx] = { ...old, toolCall: newToolCall }
        break
      }

      case "reset": {
        // מחיקה + אכלוס (מוטציה על אותו מערך — $state proxy נשמר)
        bubbles.splice(0, bubbles.length, ...patch.messages.map((m) => sessionMsgToBubble(m, mappers)))
        break
      }
    }
  }
}
