/**
 * `GET /api/info?cwd=<path>` handler — spins up a temporary AcpBridge
 * to probe available models + existing sessions for a given cwd.
 *
 * Used by the config page to populate the model and session dropdowns
 * after the user selects a working directory.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-1..HTTP-3).
 */

import type { AcpBridge } from "./acp-bridge.ts";

export type InfoResult =
  | {
      ok: true;
      body: {
        cwd: string;
        availableModels: Array<{
          modelId: string;
          name: string;
          description?: string;
        }>;
        currentModelId: string | null;
        sessions: Array<{
          sessionId: string;
          cwd?: string;
          title?: string;
          updatedAt?: string;
        }>;
      };
    }
  | { ok: false; status: number; body: { error: string } };

export interface InfoDeps {
  /** Create a temporary bridge for the given cwd. */
  createBridge(opts: { cwd: string }): Promise<AcpBridge>;
}

/**
 * Pure handler logic. The bridge is always disposed at the end, even on
 * error.
 */
export async function handleApiInfo(
  cwd: string | null,
  deps: InfoDeps,
): Promise<InfoResult> {
  if (!cwd) {
    return {
      ok: false,
      status: 400,
      body: { error: "חסר פרמטר cwd" },
    };
  }

  let bridge: AcpBridge | null = null;
  try {
    bridge = await deps.createBridge({ cwd });
    const tempSession = await bridge.newSession();
    const sessions = await bridge.listSessions().catch(() => []);

    return {
      ok: true,
      body: {
        cwd,
        availableModels: tempSession.availableModels ?? [],
        currentModelId: tempSession.currentModelId ?? null,
        sessions,
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: 500,
      body: { error: String((e as Error).message ?? e) },
    };
  } finally {
    await bridge?.dispose().catch(() => {});
  }
}
