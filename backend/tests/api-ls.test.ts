/**
 * Tests for `/api/ls` handler — directory listing with security.
 *
 * Behaviors documented in `docs/behaviors.md` (HTTP-10..HTTP-16).
 */

import { describe, expect, test } from "bun:test";
import { handleApiLs, type LsDeps } from "../src/api-ls.ts";

/** Simple stub directory tree for tests. */
function makeReader(tree: Record<string, Array<{ name: string; isDir: boolean }>>) {
  return async (path: string) => {
    const entries = tree[path];
    if (!entries) throw new Error(`ENOENT: ${path}`);
    return entries.map((e) => ({
      name: e.name,
      isDirectory: () => e.isDir,
    }));
  };
}

function deps(
  tree: Record<string, Array<{ name: string; isDir: boolean }>>,
  home = "/home/user",
): LsDeps {
  return { home, readDirectory: makeReader(tree) };
}

describe("handleApiLs — input validation (HTTP-10, HTTP-11)", () => {
  test("path not absolute → 400", async () => {
    const r = await handleApiLs("relative/path", false, deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("absolute");
    }
  });

  test("empty path → 400", async () => {
    const r = await handleApiLs("", false, deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("path outside $HOME and /tmp → 403", async () => {
    const r = await handleApiLs("/etc/passwd", false, deps({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.body.error).toContain("מחוץ לטווח המותר");
    }
  });

  test("path under $HOME → allowed", async () => {
    const r = await handleApiLs(
      "/home/user/projects",
      false,
      deps({ "/home/user/projects": [] }),
    );
    expect(r.ok).toBe(true);
  });

  test("path === $HOME → allowed", async () => {
    const r = await handleApiLs(
      "/home/user",
      false,
      deps({ "/home/user": [] }),
    );
    expect(r.ok).toBe(true);
  });

  test("path under /tmp → allowed", async () => {
    const r = await handleApiLs("/tmp/foo", false, deps({ "/tmp/foo": [] }));
    expect(r.ok).toBe(true);
  });

  test("path that LOOKS like home prefix but isn't (no separator) → blocked", async () => {
    // /home/user-foo starts with "/home/user" but isn't under it.
    const r = await handleApiLs(
      "/home/user-foo",
      false,
      deps({}, "/home/user"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe("handleApiLs — filtering (HTTP-12, HTTP-13)", () => {
  test("only directories returned, files filtered", async () => {
    const tree = {
      "/home/user": [
        { name: "Documents", isDir: true },
        { name: "file.txt", isDir: false },
        { name: "Downloads", isDir: true },
      ],
    };
    const r = await handleApiLs("/home/user", false, deps(tree));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.entries.map((e) => e.name)).toEqual([
        "Documents",
        "Downloads",
      ]);
    }
  });

  test("dot-folders filtered by default", async () => {
    const tree = {
      "/home/user": [
        { name: "Documents", isDir: true },
        { name: ".config", isDir: true },
        { name: ".ssh", isDir: true },
      ],
    };
    const r = await handleApiLs("/home/user", false, deps(tree));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.entries.map((e) => e.name)).toEqual(["Documents"]);
    }
  });

  test("dot-folders included when showHidden=true", async () => {
    const tree = {
      "/home/user": [
        { name: "Documents", isDir: true },
        { name: ".config", isDir: true },
      ],
    };
    const r = await handleApiLs("/home/user", true, deps(tree));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.entries.map((e) => e.name).sort()).toEqual([
        ".config",
        "Documents",
      ]);
    }
  });
});

describe("handleApiLs — sorting (HTTP-14)", () => {
  test("Hebrew locale sort", async () => {
    const tree = {
      "/home/user": [
        { name: "ב", isDir: true },
        { name: "א", isDir: true },
        { name: "ג", isDir: true },
      ],
    };
    const r = await handleApiLs("/home/user", false, deps(tree));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.entries.map((e) => e.name)).toEqual(["א", "ב", "ג"]);
    }
  });

  test("English sort", async () => {
    const tree = {
      "/home/user": [
        { name: "Zebra", isDir: true },
        { name: "alpha", isDir: true },
        { name: "Mango", isDir: true },
      ],
    };
    const r = await handleApiLs("/home/user", false, deps(tree));
    expect(r.ok).toBe(true);
    if (r.ok) {
      // localeCompare is typically case-insensitive in default mode.
      const names = r.body.entries.map((e) => e.name);
      // alpha < Mango < Zebra (case-insensitive)
      expect(names).toEqual(["alpha", "Mango", "Zebra"]);
    }
  });
});

describe("handleApiLs — parent (HTTP-15)", () => {
  test("parent is set when inside allowed root", async () => {
    const r = await handleApiLs(
      "/home/user/projects",
      false,
      deps({ "/home/user/projects": [] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.parent).toBe("/home/user");
  });

  test("parent is null when at allowed root boundary ($HOME)", async () => {
    // /home/user → parent /home → outside allowed → null.
    const r = await handleApiLs(
      "/home/user",
      false,
      deps({ "/home/user": [] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.parent).toBeNull();
  });

  test("parent is null at /tmp boundary", async () => {
    const r = await handleApiLs("/tmp", false, deps({ "/tmp": [] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.parent).toBeNull();
  });

  test("parent is set inside /tmp", async () => {
    const r = await handleApiLs(
      "/tmp/foo",
      false,
      deps({ "/tmp/foo": [] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.parent).toBe("/tmp");
  });
});

describe("handleApiLs — response shape (HTTP-16)", () => {
  test("returns path, parent, home, entries", async () => {
    const r = await handleApiLs(
      "/home/user/projects",
      false,
      deps({
        "/home/user/projects": [{ name: "voice-acp", isDir: true }],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.path).toBe("/home/user/projects");
      expect(r.body.parent).toBe("/home/user");
      expect(r.body.home).toBe("/home/user");
      expect(r.body.entries).toEqual([
        { name: "voice-acp", type: "directory" },
      ]);
    }
  });
});

describe("handleApiLs — error from readDirectory (500)", () => {
  test("ENOENT propagates as 500", async () => {
    const r = await handleApiLs(
      "/home/user/nonexistent",
      false,
      deps({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.body.error).toContain("ENOENT");
    }
  });
});
