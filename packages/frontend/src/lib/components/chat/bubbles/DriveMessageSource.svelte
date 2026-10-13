<script lang="ts">
import DOMPurify from "dompurify"
import { highlightCode } from "$lib/util/code-highlight"

let { text }: { text: string } = $props()
function highlight(node: HTMLElement, source: string) {
  const update = (value: string) => {
    node.replaceChildren(
      DOMPurify.sanitize(highlightCode(value, "xml"), {
        ALLOWED_TAGS: ["span"],
        ALLOWED_ATTR: ["class"],
        RETURN_DOM_FRAGMENT: true,
      }),
    )
    // Preserve exact input even if HTML parsing normalizes line endings.
    if (node.textContent !== value) node.textContent = value
  }
  update(source)
  return { update }
}
</script>

<pre class="drive-msg-raw" dir="ltr"><code class="language-xml" use:highlight={text}></code></pre>

<style>
  .drive-msg-raw {
    margin: 0.35rem 0 0;
    max-height: 20rem;
    max-width: 100%;
    overflow: auto;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.35);
    white-space: pre;
    text-align: left;
    font: 0.75rem/1.5 ui-monospace, monospace;
  }
  code { font: inherit; }
  code :global(.hljs-tag),
  code :global(.hljs-name) { color: var(--hl-tag); }
  code :global(.hljs-attr) { color: var(--hl-attr); }
  code :global(.hljs-string) { color: var(--hl-string); }
  code :global(.hljs-comment) { color: var(--hl-comment); }
  code :global(.hljs-meta) { color: var(--hl-meta); }
</style>
