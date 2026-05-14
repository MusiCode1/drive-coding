/**
 * Characterization tests for `findSentenceBoundary`.
 *
 * Behaviors documented in `docs/behaviors.md` (PROMPT-8 + helper).
 *
 * The function returns the index *after* the last sentence boundary,
 * or -1 if no boundary found.
 *
 * Boundaries:
 *   - `.`/`!`/`?` followed by whitespace
 *   - `:` followed by whitespace
 *   - blank line (`\n\n+`)
 *
 * Protections:
 *   - skips abbreviations (Mr., Dr., Mrs., Ms., St., vs., etc., i.e., e.g.)
 *   - skips inside decimal numbers (3.14)
 *
 * Forced flush: if no boundary but string >= 200 chars, cuts at last
 * space before 200 (or at 200 if no space after position 100).
 */

import { describe, expect, test } from "bun:test";
import { findSentenceBoundary } from "../src/sentence-boundary.ts";

describe("findSentenceBoundary — sentence boundaries", () => {
  test("English period + space → boundary after the space", () => {
    const s = "I saw the file. Looks good.";
    const idx = findSentenceBoundary(s);
    // Boundary is after ". " — at position 16.
    expect(idx).toBe(16);
    // Sanity: the head is exactly the first sentence.
    expect(s.slice(0, idx)).toBe("I saw the file. ");
  });

  test("Hebrew period + space → boundary after the space", () => {
    const s = "ראיתי את הקובץ. הוא נראה תקין.";
    const idx = findSentenceBoundary(s);
    // After "ראיתי את הקובץ. " — char-index 16 (chars, not bytes).
    expect(idx).toBe(16);
    expect(s.slice(0, idx)).toBe("ראיתי את הקובץ. ");
  });

  test("question mark + space → boundary after the space", () => {
    const idx = findSentenceBoundary("Are you sure? Maybe.");
    expect(idx).toBe(14);
  });

  test("exclamation mark + space → boundary after the space", () => {
    const idx = findSentenceBoundary("Wow! That worked.");
    expect(idx).toBe(5);
  });

  test("colon + space → boundary after the space", () => {
    const idx = findSentenceBoundary("Header: body text");
    expect(idx).toBe(8);
  });

  test("blank line → boundary after the blank", () => {
    const idx = findSentenceBoundary("para one\n\npara two");
    // \n\n matched starting at 8, length 2 → end at 10.
    expect(idx).toBe(10);
  });

  test("no boundary at all → -1", () => {
    expect(findSentenceBoundary("just one short sentence without ending")).toBe(-1);
  });

  test("sentence without trailing space is not a boundary", () => {
    // The final period has no whitespace after it — no boundary.
    expect(findSentenceBoundary("Hello.")).toBe(-1);
  });
});

describe("findSentenceBoundary — abbreviation protection", () => {
  test("Mr. and Dr. are not boundaries (with trailing context)", () => {
    // "Hello Mr. Smith and Dr. Jones." — only periods with trailing space
    // are "Mr. " and "Dr. ". Both are protected.
    // After them, no other punctuation+space → expect -1.
    expect(findSentenceBoundary("Hello Mr. Smith and Dr. Jones.")).toBe(-1);
  });

  test("i.e. and e.g. are not boundaries", () => {
    expect(findSentenceBoundary("Use the tool, i.e. the CLI.")).toBe(-1);
    expect(findSentenceBoundary("Cats, e.g. lions.")).toBe(-1);
  });

  test("Mrs. / Ms. / St. / vs. / etc. are not boundaries", () => {
    expect(findSentenceBoundary("Hello Mrs. Smith and Ms. Jones.")).toBe(-1);
    expect(findSentenceBoundary("On 5th St. nearby.")).toBe(-1);
    expect(findSentenceBoundary("Cats vs. dogs forever.")).toBe(-1);
    expect(findSentenceBoundary("Cats, dogs, etc. are pets.")).toBe(-1);
  });

  test("abbreviation protection is case-insensitive", () => {
    expect(findSentenceBoundary("hello mr. smith here.")).toBe(-1);
    expect(findSentenceBoundary("hello DR. smith here.")).toBe(-1);
  });

  test("abbreviation followed by REAL sentence still finds the real boundary", () => {
    // "Mr. Smith." is protected, but "Smith. Then" is real.
    const s = "Mr. Smith. Then we go.";
    const idx = findSentenceBoundary(s);
    // Real boundary is after "Smith. " (chars 4..10 → 11).
    expect(idx).toBe(11);
    expect(s.slice(0, idx)).toBe("Mr. Smith. ");
  });
});

describe("findSentenceBoundary — decimal number protection", () => {
  test("decimal number is not split", () => {
    // "The value is 3.14 exactly." — the "." in 3.14 has a digit before
    // and after, so it's protected. The trailing "." has no space → -1.
    expect(findSentenceBoundary("The value is 3.14 exactly.")).toBe(-1);
  });

  test("decimal protection works with real sentence after", () => {
    const s = "Pi is 3.14. Next sentence.";
    const idx = findSentenceBoundary(s);
    // "Pi is 3.14." is 11 chars; "." at index 10, "(space)" at 11.
    // ". " pattern matches at 10, length 2 → end at 12.
    expect(idx).toBe(12);
    expect(s.slice(0, idx)).toBe("Pi is 3.14. ");
  });
});

describe("findSentenceBoundary — forced flush", () => {
  test("very long string with no boundary → forced flush near position 200", () => {
    // 220 spaces + letters → forced flush will find last space before 200
    const s = "x".repeat(50) + " " + "y".repeat(170);
    const idx = findSentenceBoundary(s);
    // No real boundary. Forced flush: lastIndexOf(" ") in s.slice(0,200) is
    // position 50; since 50 > 100 is FALSE → returns 200.
    expect(idx).toBe(200);
  });

  test("forced flush at a space if it's after position 100", () => {
    // First 120 chars no space, then space, then more.
    const s = "z".repeat(120) + " " + "y".repeat(100);
    const idx = findSentenceBoundary(s);
    // lastIndexOf(" ") in slice(0,200) = 120 (the space). 120 > 100 → return 121.
    expect(idx).toBe(121);
  });

  test("shorter than 200 with no boundary → -1 (no forced flush)", () => {
    const s = "x".repeat(199);
    expect(findSentenceBoundary(s)).toBe(-1);
  });

  test("exactly 200 with no boundary → forced flush kicks in", () => {
    const s = "x".repeat(200);
    const idx = findSentenceBoundary(s);
    // No space → returns 200.
    expect(idx).toBe(200);
  });
});

describe("findSentenceBoundary — multiple boundaries", () => {
  test("returns the LAST boundary, not the first", () => {
    const s = "First. Second. Third now";
    const idx = findSentenceBoundary(s);
    // Boundaries after "First. " (7) and "Second. " (15). Last = 15.
    expect(idx).toBe(15);
    expect(s.slice(0, idx)).toBe("First. Second. ");
  });

  test("mix of boundary types — picks the latest", () => {
    const s = "Header: First sentence. Second";
    const idx = findSentenceBoundary(s);
    // ": " matches at index 6 → end 8. ". " matches at index 22 → end 24.
    // Last (max) = 24.
    expect(idx).toBe(24);
    expect(s.slice(0, idx)).toBe("Header: First sentence. ");
  });
});
