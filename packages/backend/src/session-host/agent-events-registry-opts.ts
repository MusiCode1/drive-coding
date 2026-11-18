/**
 * agent-events-registry-opts.ts — host opts for agent events (slice be-events-subscribe).
 */

import type { PermissionPolicyKind } from "@drive-coding/core/types/permission"
import type { SessionHostFromConnOptions } from "./session-host.js"
import type { TurnEndedInfo } from "./agent-events-turn.js"

export function buildAgentEventHostOpts(deps: {
  agentId: string
  cwd: string
  acpSessionId: string | undefined
  permissionPolicy: PermissionPolicyKind | undefined
  closeOnTurnEnd: boolean
  onScheduleCloseOnTurnEnd: ((agentId: string) => void) | undefined
  onTurnEnded: ((agentId: string, info: TurnEndedInfo) => void) | undefined
}): SessionHostFromConnOptions | undefined {
  const {
    agentId,
    cwd,
    acpSessionId,
    permissionPolicy,
    closeOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
  } = deps
  if (
    !acpSessionId &&
    permissionPolicy === undefined &&
    !closeOnTurnEnd &&
    !onTurnEnded
  ) {
    return undefined
  }
  return {
    ...(acpSessionId ? { warmReattach: { acpSessionId, cwd } } : {}),
    ...(permissionPolicy !== undefined ? { permissionPolicy } : {}),
    ...(closeOnTurnEnd
      ? {
          closeOnTurnEnd: true,
          onScheduleCloseOnTurnEnd: () => onScheduleCloseOnTurnEnd?.(agentId),
        }
      : {}),
    ...(onTurnEnded ? { onTurnEnded: (info) => onTurnEnded(agentId, info) } : {}),
  }
}
