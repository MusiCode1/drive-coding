<script lang="ts">
/**
 * Composition root — instantiates all primary view-models and wires them
 * into context. The only place in the app where `new <VM>()` happens.
 *
 * ─── Parallel-safe additive design (docs/conventions/parallel-safe-code.md) ───
 *
 * Adding a new VM:
 *   1. Add `import { Foo } from "$lib/view-models/foo.svelte"` to imports.
 *   2. Append a new `// ─── <domain> ───` block in the section below.
 *      Order matters only when a VM depends on another (declare deps first).
 *   3. Add `setFoo(foo)` to the corresponding setContext block.
 *
 * Two slices that add independent VMs land in different sections → git auto-merge.
 */
import "../app.css"
import { setI18n, setSession, setSettings, setSpeaker } from "$lib/context"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"

let { children } = $props()

// ─── i18n ──────────────────────────────────────────
const i18n = new I18nVM()

// ─── settings ──────────────────────────────────────
const settings = new Settings()

// ─── session ───────────────────────────────────────
const session = new AgentSession()

// ─── speaker ─── (depends on session + settings)
const speaker = new Speaker({ session, settings })

// ─── mic ─── (slice 3 will add here)
// ─── voice-mode ─── (slice 3 — depends on mic + session + speaker)
// ─── car-mode ─── (slice 7)

// ─── wiring ───────────────────────────────────────
setI18n(i18n)
setSettings(settings)
setSession(session)
setSpeaker(speaker)
// new VM → add its setX(x) here as well
</script>

{@render children?.()}
