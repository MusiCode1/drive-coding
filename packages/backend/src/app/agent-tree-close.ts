import type { AgentRegistry } from "@drive-coding/core"
import { buildAgentTree, descendantsPostOrder } from "@drive-coding/core/agents/agent-tree"
import type { Logger } from "@drive-coding/core/log"
import type { TurnStateValue } from "@drive-coding/core/session"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { clearGrantsFor, markClosing } from "../agent-scope.js"
import { stopAgentUnit } from "../agents/agent-launcher.js"

export type CloseTreeResult = {
  closed: string[]
  failed: Array<{ agentId: string; error: string }>
  closedWhileBusy: string[]
}

export type AgentHosts = {
  unregisterHost(agentId: string): void
  getHost?(agentId: string): { state: { turnState: TurnStateValue } } | undefined
}

type CloseDependencies = {
  registry: AgentRegistry
  connectionRegistry: Pick<ConnectionRegistry, "close">
  sessionHostRegistry?: AgentHosts
}

type DirectAttempt = Promise<PromiseSettledResult<void>>
type TargetResult = { wasTurnState?: TurnStateValue }

type TargetOperation = {
  result: Promise<TargetResult>
  collecting: Set<DirectAttempt> | undefined
  physical?: Promise<void>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function createAgentTreeClose(deps: CloseDependencies, log: Logger) {
  const activeDirect = new Map<string, Set<DirectAttempt>>()
  const targets = new Map<string, TargetOperation>()

  async function performClose(id: string): Promise<void> {
    log.info({ agentId: id }, "deleteAndKill")
    markClosing(id)
    clearGrantsFor(id)
    // Remove the host before closing the connection so /events cannot serve stale state.
    deps.sessionHostRegistry?.unregisterHost(id)

    try {
      await deps.registry.update(id, { status: "closed" })
    } catch {
      // Preserve the existing best-effort registry update.
    }

    // Closing the connection only detaches a sidecar. Ending the agent also stops its unit.
    await deps.connectionRegistry.close(id)
    stopAgentUnit(id)

    try {
      await deps.registry.delete(id)
    } catch {
      // Preserve the existing best-effort registry deletion.
    }
  }

  function deleteAndKill(id: string): Promise<void> {
    const target = targets.get(id)
    if (target?.physical) return target.physical

    const attempt = deferred<PromiseSettledResult<void>>()
    const active = activeDirect.get(id) ?? new Set<DirectAttempt>()
    activeDirect.set(id, active)
    active.add(attempt.promise)
    target?.collecting?.add(attempt.promise)

    const settle = (result: PromiseSettledResult<void>) => {
      active.delete(attempt.promise)
      if (active.size === 0 && activeDirect.get(id) === active) activeDirect.delete(id)
      attempt.resolve(result)
    }
    const physical = performClose(id)
    void physical.then(
      () => settle({ status: "fulfilled", value: undefined }),
      (reason: unknown) => settle({ status: "rejected", reason }),
    )
    return physical
  }

  async function closeTarget(id: string, target: TargetOperation): Promise<TargetResult> {
    try {
      let lookup: { exists: boolean; wasTurnState?: TurnStateValue } | { error: unknown }
      try {
        const agent = await deps.registry.get(id)
        lookup = {
          exists: agent !== null,
          wasTurnState:
            agent && target.collecting?.size === 0
              ? deps.sessionHostRegistry?.getHost?.(id)?.state.turnState
              : undefined,
        }
      } catch (error) {
        lookup = { error }
      }

      // Cut after the last synchronous read. From here to publishing and starting
      // a physical close there is no yield point for another direct attempt.
      const group = target.collecting
      target.collecting = undefined
      if (group?.size) {
        const outcomes = await Promise.all(group)
        const first = outcomes[0]
        if (first?.status === "rejected" && outcomes.every((item) => item.status === "rejected")) {
          throw first.reason
        }
        if ("error" in lookup || lookup.wasTurnState === undefined) return {}
        return { wasTurnState: lookup.wasTurnState }
      }
      if ("error" in lookup) throw lookup.error
      if (!lookup.exists) return {}

      const physical = deferred<void>()
      target.physical = physical.promise
      void performClose(id).then(physical.resolve, physical.reject)
      await physical.promise
      return { wasTurnState: lookup.wasTurnState }
    } finally {
      if (targets.get(id) === target) targets.delete(id)
    }
  }

  function getTargetResult(id: string): Promise<TargetResult> {
    const existing = targets.get(id)
    if (existing) return existing.result

    const result = deferred<TargetResult>()
    const operation: TargetOperation = {
      result: result.promise,
      collecting: new Set(activeDirect.get(id)),
    }
    targets.set(id, operation)
    void closeTarget(id, operation).then(result.resolve, result.reject)
    return result.promise
  }

  function finish(rootId: string, result: CloseTreeResult): CloseTreeResult {
    log.info(
      {
        rootId,
        closed: result.closed.length,
        failed: result.failed.length,
        closedWhileBusy: result.closedWhileBusy.length,
      },
      "agent tree close complete",
    )
    if (result.failed.length > 0) {
      log.warn({ rootId, failed: result.failed }, "agent tree close failures")
    }
    return result
  }

  async function closeBranch(rootId: string): Promise<CloseTreeResult> {
    const result: CloseTreeResult = { closed: [], failed: [], closedWhileBusy: [] }
    let agents: Awaited<ReturnType<AgentRegistry["list"]>>
    try {
      agents = await deps.registry.list()
    } catch (reason) {
      result.failed.push({ agentId: rootId, error: errorMessage(reason) })
      return finish(rootId, result)
    }

    const tree = buildAgentTree(agents)
    if (!tree.byId.has(rootId)) {
      result.failed.push({ agentId: rootId, error: "not found" })
      return finish(rootId, result)
    }

    const ids = descendantsPostOrder(tree, rootId).map((agent) => agent.id)
    ids.push(rootId)
    for (const id of ids) {
      try {
        const { wasTurnState } = await getTargetResult(id)
        result.closed.push(id)
        if (id !== rootId && wasTurnState !== undefined && wasTurnState !== "idle") {
          result.closedWhileBusy.push(id)
          log.warn({ agentId: id, wasTurnState }, "closed a busy agent in the tree")
        }
      } catch (reason) {
        result.failed.push({ agentId: id, error: errorMessage(reason) })
      }
    }
    return finish(rootId, result)
  }

  return { deleteAndKill, closeBranch }
}
