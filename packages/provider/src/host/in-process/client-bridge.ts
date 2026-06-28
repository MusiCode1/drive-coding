/**
 * client-bridge.ts — bridges ClaudeAcpAgent's AcpClient interface
 * over the AgentContext exposed by sdk@1.0.0.
 *
 * Promoted from spike.ts::makeAcpClientFromCtx.
 * This file is the ONLY place in in-process/ that imports from acp-sdk-v1.
 * No types from acp-sdk-v1 appear in the public function signature.
 */

import type { AgentContext } from "acp-sdk-v1"
import { methods } from "acp-sdk-v1"

/**
 * Creates an AcpClient-compatible object over an sdk@1.0.0 AgentContext.
 * Mirrors the unexported ClientConnection class in acp-agent.js:255.
 *
 * @internal — only used inside host/in-process/
 */
export function makeAcpClientFromCtx(ctx: AgentContext) {
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
