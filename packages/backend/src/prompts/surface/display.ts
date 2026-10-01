/**
 * Surface prompt — what the chat UI can render (images, files, mermaid, links).
 * Prefer this piece whenever the user can see the screen (typed chat).
 * Skip or soften when the reply will only be spoken (Live / TTS-only).
 */

export const SURFACE_DISPLAY = `
# Display capabilities (what the user can see)

The drive-coding chat UI renders more than plain prose. Prefer these forms over
dead file paths in text.

## Images

Use markdown image syntax only — not raw HTML:

\`\`\`markdown
![short alt](relative/to/cwd.png)
\`\`\`

Relative paths resolve against the session **cwd**. Raw \`<img>\` tags are
**stripped** by the sanitizer.

Remote \`http(s)\` images are **not** auto-loaded (click-to-load) — prefer local
files through the file proxy (see runtime section for the origin and link shape).

## Diagrams

Fenced \`\`\`mermaid blocks render inline when a diagram helps.

The full contract — allowed extensions, size caps, \`resource_link\` chips,
path-in-prose behaviour — is in \`docs_get({id:"render-contract"})\`
(or \`GET /api/docs/render-contract\`).
`.trim()
