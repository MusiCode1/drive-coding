#!/usr/bin/env python3
"""
Block hardcoded Hebrew strings in source code.

Scans TS + Svelte files for Hebrew characters (U+0590..U+05FF) that appear
inside string literals (single/double/backtick quotes) or Svelte template
text. Hebrew inside line comments (`//`) and block comments (`/* */`) is
allowed — those are developer notes.

Scope:
  - packages/frontend/
  - packages/core/
  - packages/backend/

Allowlist (paths where Hebrew IS allowed in strings):
  - packages/core/src/i18n/catalogs/*  (source of truth)
  - packages/core/src/voice/*-prompt.ts  (LLM prompts)
  - **/*.test.ts, **/tests/**, **/fixtures/**  (test data)

Exit 0 = clean. Exit 1 = violations found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SCAN_DIRS = [
    "packages/frontend",
    "packages/core",
    "packages/backend",
]

ALLOW_PATTERNS = [
    re.compile(r"packages/core/src/i18n/catalogs/"),
    re.compile(r"/voice/.*-prompt\.ts$"),
    re.compile(r"packages/backend/src/prompts/"),  # LLM system prompts (slice 14)
    re.compile(r"\.test\.ts$"),
    re.compile(r"/tests/"),
    re.compile(r"/fixtures/"),
    re.compile(r"/node_modules/"),
    re.compile(r"/build/"),
    re.compile(r"/\.svelte-kit/"),
    re.compile(r"/dist/"),
]

HEBREW_RE = re.compile(r"[\u0590-\u05FF]")


def is_allowed(path: Path) -> bool:
    rel = str(path.relative_to(REPO_ROOT))
    return any(p.search(rel) for p in ALLOW_PATTERNS)


def strip_jsdoc_blocks(text: str) -> str:
    """
    Pre-pass: blank out all `/** ... */` and `/* ... */` blocks.
    Done before the main state machine so regex literals containing
    quotes (`/.../`) don't confuse comment detection.

    Preserves line breaks + column counts.
    """
    out = list(text)
    i = 0
    n = len(text)
    while i < n - 1:
        if text[i] == "/" and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            if end == -1:
                end = n
            else:
                end += 2
            for j in range(i, end):
                if out[j] != "\n":
                    out[j] = " "
            i = end
        else:
            i += 1
    return "".join(out)


def strip_all_comments(text: str) -> str:
    """
    Walk the full file as a single character stream with a state machine.
    Replace every comment character with a space, preserving line breaks
    and column counts. Strings are preserved as-is.

    States: code | line_comment | str_dq | str_sq | str_bt
    (Block comments are handled in strip_jsdoc_blocks before this.)
    """
    text = strip_jsdoc_blocks(text)
    out: list[str] = []
    state = "code"
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                out.append("  ")
                state = "line_comment"
                i += 2
                continue
            if ch == '"':
                state = "str_dq"
            elif ch == "'":
                state = "str_sq"
            elif ch == "`":
                state = "str_bt"
            out.append(ch)
            i += 1
            continue
        if state == "line_comment":
            if ch == "\n":
                out.append("\n")
                state = "code"
            else:
                out.append(" ")
            i += 1
            continue
        # In a string literal: handle escapes, preserve text.
        if state in ("str_dq", "str_sq", "str_bt"):
            quote = {"str_dq": '"', "str_sq": "'", "str_bt": "`"}[state]
            if ch == "\\" and i + 1 < n:
                out.append(ch)
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                out.append(ch)
                state = "code"
                i += 1
                continue
            out.append(ch)
            i += 1
            continue
    return "".join(out)


def scan_file(path: Path) -> list[tuple[int, str]]:
    """Return list of (line_no, original_line) where Hebrew appears outside comments."""
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []
    code_only = strip_all_comments(text)
    violations: list[tuple[int, str]] = []
    original_lines = text.splitlines()
    code_lines = code_only.splitlines()
    for n, (raw, stripped) in enumerate(zip(original_lines, code_lines), start=1):
        if HEBREW_RE.search(stripped):
            violations.append((n, raw.rstrip()))
    return violations


def main() -> int:
    total_violations = 0
    bad_files: list[tuple[Path, list[tuple[int, str]]]] = []

    for d in SCAN_DIRS:
        root = REPO_ROOT / d
        if not root.exists():
            continue
        for ext in ("*.ts", "*.svelte"):
            for path in root.rglob(ext):
                if is_allowed(path):
                    continue
                v = scan_file(path)
                if v:
                    bad_files.append((path, v))
                    total_violations += len(v)

    if bad_files:
        print("Hebrew strings found in code (must use t('key') instead):\n", file=sys.stderr)
        for path, violations in bad_files:
            rel = path.relative_to(REPO_ROOT)
            print(f"  {rel}", file=sys.stderr)
            for n, line in violations:
                print(f"    {n}: {line}", file=sys.stderr)
            print("", file=sys.stderr)
        print(f"✗ {len(bad_files)} file(s), {total_violations} occurrence(s).", file=sys.stderr)
        print("", file=sys.stderr)
        print("Fix: add the string to packages/core/src/i18n/catalogs/{he,en}.ts,", file=sys.stderr)
        print("  add the key to packages/core/src/i18n/keys.ts,", file=sys.stderr)
        print("  and use t('your.key') in the component.", file=sys.stderr)
        return 1

    print("✓ No hardcoded Hebrew in code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
