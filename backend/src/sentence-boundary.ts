/**
 * Pure helper — find the last "safe" sentence boundary in a string.
 *
 * Used by the prompt streaming logic to chunk model output into TTS-able
 * segments before the full response is complete.
 *
 * Returns the index *after* the last boundary, or -1 if none.
 *
 * Boundaries recognized:
 *   - `.`/`!`/`?` followed by whitespace
 *   - `:` followed by whitespace
 *   - blank line (`\n\n+`)
 *
 * Protections:
 *   - common abbreviations (`Mr.`, `Dr.`, `Mrs.`, `Ms.`, `St.`, `vs.`, `etc.`,
 *     `i.e.`, `e.g.`) — does not cut after their trailing period.
 *   - decimal numbers (`3.14`) — does not cut inside.
 *
 * Forced flush: if no boundary but the string is >= 200 chars long, cuts
 * at the last space before position 200 (or at 200 if no space found
 * after position 100). This handles Hebrew where periods are rarer than
 * in English and a buffer may grow long without natural boundaries.
 */
export function findSentenceBoundary(s: string): number {
  const patterns = [/[.!?][\s\n]/g, /:\s/g, /\n\n+/g];
  let last = -1;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const end = m.index + m[0].length;
      if (m[0][0] === ".") {
        const before = s.slice(Math.max(0, m.index - 3), m.index);
        if (/\b(Mr|Dr|Mrs|Ms|St|vs|etc|i\.e|e\.g)$/i.test(before)) continue;
        // Decimal number: 3.14 — skip
        if (/\d$/.test(before) && /^\d/.test(s.slice(end))) continue;
      }
      if (end > last) last = end;
    }
  }
  // Forced flush — long string without any boundary
  if (last === -1 && s.length >= 200) {
    const slice = s.slice(0, 200);
    const lastSpace = slice.lastIndexOf(" ");
    return lastSpace > 100 ? lastSpace + 1 : 200;
  }
  return last;
}
