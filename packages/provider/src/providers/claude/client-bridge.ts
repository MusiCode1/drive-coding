/**
 * client-bridge.ts — bridges ClaudeAcpAgent's AcpClient interface
 * over the AgentContext exposed by @agentclientprotocol/sdk.
 *
 * Promoted from spike.ts::makeAcpClientFromCtx.
 * No ACP SDK types appear in the public function signature.
 */

import type { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import type { AgentContext } from "@agentclientprotocol/sdk"
import { methods } from "@agentclientprotocol/sdk"

type ClaudeAcpClient = ConstructorParameters<typeof ClaudeAcpAgent>[0]

/**
 * Creates an AcpClient-compatible object over an ACP AgentContext.
 * Mirrors the unexported ClientConnection class in acp-agent.js:255.
 *
 * @internal — only used inside providers/claude/
 */
export function makeAcpClientFromCtx(ctx: AgentContext): ClaudeAcpClient {
  return {
    sessionUpdate: (params: unknown) => ctx.notify(methods.client.session.update, params as never),
    requestPermission: (params: unknown, signal?: AbortSignal) =>
      ctx.request(methods.client.session.requestPermission, params as never, {
        cancellationSignal: signal,
      }),
    readTextFile: (params: unknown) => ctx.request(methods.client.fs.readTextFile, params as never),
    writeTextFile: (params: unknown) =>
      ctx.request(methods.client.fs.writeTextFile, params as never),
    unstable_createElicitation: (params: unknown, signal?: AbortSignal) =>
      ctx.request(methods.client.elicitation.create, params as never, {
        cancellationSignal: signal,
      }),
    unstable_completeElicitation: (params: unknown) =>
      ctx.notify(methods.client.elicitation.complete, params as never),
    extNotification: (method: string, params: Record<string, unknown>) =>
      ctx.notify(method, params as never),
  }
}
