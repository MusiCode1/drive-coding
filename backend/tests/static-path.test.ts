/**
 * Tests for `resolveStaticPath` — path traversal protection.
 *
 * Pure function — no filesystem, no Bun.serve.
 *
 * Behaviors documented in `docs/behaviors.md` (STATIC-1..STATIC-3).
 */

import { describe, expect, test } from "bun:test";
import { resolveStaticPath } from "../src/static-path.ts";

const FRONTEND = "/app/frontend";

describe("resolveStaticPath — path traversal protection (STATIC-1)", () => {
  test("path with `..` → 400", () => {
    const r = resolveStaticPath("/../etc/passwd", FRONTEND);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toBe("Bad request");
    }
  });

  test("path with `..` deeper → 400", () => {
    const r = resolveStaticPath("/foo/../../etc", FRONTEND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("path with null byte → 400", () => {
    const r = resolveStaticPath("/foo\0bar", FRONTEND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test("normal path → 200 / ok", () => {
    const r = resolveStaticPath("/style.css", FRONTEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe(`${FRONTEND}/style.css`);
  });
});

describe("resolveStaticPath — root rewriting (STATIC-2)", () => {
  test("`/` → index.html", () => {
    const r = resolveStaticPath("/", FRONTEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe(`${FRONTEND}/index.html`);
  });

  test("specific filename preserved", () => {
    const r = resolveStaticPath("/config.html", FRONTEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe(`${FRONTEND}/config.html`);
  });

  test("nested path preserved", () => {
    const r = resolveStaticPath("/assets/logo.png", FRONTEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe(`${FRONTEND}/assets/logo.png`);
  });
});

describe("resolveStaticPath — startsWith enforcement (STATIC-3)", () => {
  test("path with `..` blocked by step 1, never reaches startsWith check", () => {
    // Step 1 already catches this — sanity that pipeline is correct
    const r = resolveStaticPath("/x/../../escape.txt", FRONTEND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400); // Bad request, not 403
  });

  test("absolute-looking trick — `//evil` does not escape via resolve", () => {
    // POSIX `resolve` flattens double-slashes. Should stay inside FRONTEND.
    const r = resolveStaticPath("//etc/passwd", FRONTEND);
    if (r.ok) {
      expect(r.filePath.startsWith(FRONTEND)).toBe(true);
    }
    // If status was used, it'd be 400 or 403 — but realistically the
    // resolve just produces /app/frontend/etc/passwd which is "safe"
    // in the sense that it stays under FRONTEND.
  });

  test("FRONTEND_DIR variation — different parent works", () => {
    const r = resolveStaticPath("/foo.html", "/other/place");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filePath).toBe("/other/place/foo.html");
  });
});

describe("resolveStaticPath — edge cases", () => {
  test("empty pathname → resolves to FRONTEND root (no leading slash)", () => {
    // pathname="" → relative="." → resolve(FRONTEND, ".") → FRONTEND.
    // (Real Bun would never send empty, but document the behavior.)
    const r = resolveStaticPath("", FRONTEND);
    if (r.ok) {
      expect(r.filePath).toBe(FRONTEND);
    }
  });

  test("path with backslash (Windows-like) — `\\` is NOT in the dangerous list", () => {
    // The code only blocks `..` and `\0`. Forward-slash backslashes pass.
    // On Linux they're treated as filename chars, not separators.
    const r = resolveStaticPath("/foo\\bar.html", FRONTEND);
    expect(r.ok).toBe(true);
  });

  test("trailing slash on path preserved", () => {
    const r = resolveStaticPath("/subdir/", FRONTEND);
    expect(r.ok).toBe(true);
    // resolve normalizes trailing slash off:
    if (r.ok) expect(r.filePath).toBe(`${FRONTEND}/subdir`);
  });
});
