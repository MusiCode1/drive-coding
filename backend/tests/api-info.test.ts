/**
 * Tests for `/api/info` handler — bridge orchestration.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-1..HTTP-3).
 */

import { describe, expect, test } from "bun:test";
import type { AcpBridge } from "../src/acp-bridge.ts";
import { handleApiInfo } from "../src/api-info.ts";

/** Tracks `dispose` calls so tests can verify cleanup. */
interface TrackingBridge extends AcpBridge {
  _disposed: boolean;
}

function makeStubBridge(opts: {
  newSession?: any;
  listSessions?: any[];
  newSessionError?: Error;
  listSessionsError?: Error;
} = {}): TrackingBridge {
  const stub: TrackingBridge = {
    _disposed: false,
    get sessionId() {
      return null;
    },
    getRecentStderr() {
      return [];
    },
    async newSession() {
      if (opts.newSessionError) throw opts.newSessionError;
      return opts.newSession ?? { sessionId: "tmp" };
    },
    async loadSession() {
      return { sessionId: "tmp" };
    },
    async listSessions() {
      if (opts.listSessionsError) throw opts.listSessionsError;
      return opts.listSessions ?? [];
    },
    async setModel() {
      return;
    },
    async prompt() {
      return "";
    },
    async cancel() {
      return;
    },
    async dispose() {
      stub._disposed = true;
    },
  };
  return stub;
}

describe("handleApiInfo — validation (HTTP-2)", () => {
  test("missing cwd → 400", async () => {
    const r = await handleApiInfo(null, {
      async createBridge() {
        throw new Error("should not be called");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("cwd");
    }
  });

  test("empty cwd → 400", async () => {
    const r = await handleApiInfo("", {
      async createBridge() {
        throw new Error("should not be called");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("handleApiInfo — happy path", () => {
  test("returns availableModels + currentModelId + sessions", async () => {
    const bridge = makeStubBridge({
      newSession: {
        sessionId: "tmp",
        availableModels: [{ modelId: "m1", name: "M1" }],
        currentModelId: "m1",
      },
      listSessions: [
        { sessionId: "s1", title: "Old chat", updatedAt: "2026-01-01" },
      ],
    });
    const r = await handleApiInfo("/my/cwd", {
      async createBridge() {
        return bridge;
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.cwd).toBe("/my/cwd");
      expect(r.body.availableModels).toEqual([
        { modelId: "m1", name: "M1" },
      ]);
      expect(r.body.currentModelId).toBe("m1");
      expect(r.body.sessions).toEqual([
        { sessionId: "s1", title: "Old chat", updatedAt: "2026-01-01" },
      ]);
    }
  });

  test("availableModels missing → empty array", async () => {
    const bridge = makeStubBridge({
      newSession: { sessionId: "tmp" },
    });
    const r = await handleApiInfo("/cwd", {
      async createBridge() {
        return bridge;
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.availableModels).toEqual([]);
      expect(r.body.currentModelId).toBeNull();
    }
  });

  test("listSessions failure → empty array (silently caught)", async () => {
    const bridge = makeStubBridge({
      newSession: { sessionId: "tmp" },
      listSessionsError: new Error("not supported"),
    });
    const r = await handleApiInfo("/cwd", {
      async createBridge() {
        return bridge;
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.sessions).toEqual([]);
  });

  test("bridge is disposed in happy path", async () => {
    const bridge = makeStubBridge();
    await handleApiInfo("/cwd", {
      async createBridge() {
        return bridge;
      },
    });
    expect(bridge._disposed).toBe(true);
  });
});

describe("handleApiInfo — error paths (HTTP-3)", () => {
  test("createBridge throws → 500", async () => {
    const r = await handleApiInfo("/cwd", {
      async createBridge() {
        throw new Error("spawn failed");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.body.error).toContain("spawn failed");
    }
  });

  test("newSession throws → 500 + bridge is still disposed", async () => {
    const bridge = makeStubBridge({
      newSessionError: new Error("session creation failed"),
    });
    const r = await handleApiInfo("/cwd", {
      async createBridge() {
        return bridge;
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.body.error).toContain("session creation failed");
    }
    // dispose called in finally even on error.
    expect(bridge._disposed).toBe(true);
  });
});
