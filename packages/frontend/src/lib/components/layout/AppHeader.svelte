<script lang="ts">
/**
 * AppHeader — header צף עם fade gradient.
 *
 * כולל: [☰ דסקטופ בלבד] [שם+cwd chip] ··· [status dot] [⚙]
 *
 * redesign-fix: disconnect + audio master הועברו ל-SessionOptionsPanel
 * (פדיון החוב מ-redesign-2 — ה-header נקי כמו המוקאפ, 2 פקדים בלבד).
 *
 * hamburger: דסקטופ בלבד (מוסתר במובייל — sheet peek במקומו). (אביגיל #3)
 *
 * ─── redesign-2 ───
 */
import MenuIcon from "@lucide/svelte/icons/menu"
import FolderIcon from "@lucide/svelte/icons/folder"
import SettingsIcon from "@lucide/svelte/icons/settings"
import { page } from "$app/state"
import { goto } from "$app/navigation"
import { getI18n, getResponsive, getSession, getUiShell } from "$lib/context"

const responsive = getResponsive()
const uiShell = getUiShell()
const session = getSession()
const t = getI18n().t

// ⚙ כ-toggle: ב-/settings → חזרה; אחרת → פתיחת /settings.
// פתיחת /settings סוגרת גם את ה-bottom-sheet אם היה פתוח, כך שבחזרה
// המשתמש לא מוצא אותו תקוע פתוח (redesign-fix).
const onSettings = $derived(page.url.pathname === "/settings")

function toggleSettings() {
  if (onSettings) {
    // חזרה ל-chat. goto מפורש (לא history.back) — אם נכנסו ל-/settings ישירות
    // אין דף קודם וה-back יוצא מהאפליקציה ל-about:blank.
    goto("/chat")
  } else {
    uiShell.closeSheet()
    goto("/settings")
  }
}

// שם הסוכן — placeholder קבוע; redesign-3 יחבר לאפשרויות הסוכן
const agentName = "drive-coding"

// cwd — רק שם התיקייה האחרון
const cwdLabel = $derived(
  session.cwd ? session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd : ""
)
</script>

<header class="absolute top-0 inset-x-0 z-20 flex items-start gap-3 px-4 pt-3 pb-8 pointer-events-none">
  <!-- fade layer -->
  <div
    class="absolute inset-0 -z-10 backdrop-blur-sm"
    style="background:linear-gradient(to bottom, var(--bg) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 55%, transparent 100%);
           -webkit-mask-image:linear-gradient(to bottom, #000 60%, transparent); mask-image:linear-gradient(to bottom, #000 60%, transparent)"
  ></div>

  <!-- המבורגר: דסקטופ בלבד (מקפל/פותח sidebar). מוסתר במובייל. (אביגיל #3) -->
  {#if !responsive.isMobile}
    <button
      class="pointer-events-auto size-9 grid place-items-center rounded-lg text-[var(--fg-dim)] hover:bg-white/5 hover:text-[var(--fg)] shrink-0"
      onclick={() => uiShell.toggleSidebar()}
      aria-label={t("header.menu")}
    >
      <MenuIcon size={20} strokeWidth={1.75} />
    </button>
  {/if}

  <!-- כותרת ממורכזת אבסולוטית: שם סוכן + cwd chip -->
  <div class="absolute left-1/2 -translate-x-1/2 top-3 h-9 flex items-center justify-center gap-2.5 pointer-events-none max-w-[60%]">
    {#if cwdLabel}
      <span
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono shrink-0"
        style="background:var(--bg-card); border:1px solid var(--border)"
        dir="ltr"
        title={session.cwd ?? ""}
      >
        <FolderIcon size={11} strokeWidth={2} style="color:var(--fg-dim)" />
        <span class="font-semibold" style="color:var(--fg)">{cwdLabel}</span>
      </span>
    {/if}
    <span class="text-[15px] font-semibold shrink-0">{agentName}</span>
  </div>

  <!-- spacer — דוחק את הפקדים ימינה -->
  <div class="flex-1"></div>

  <!-- נקודת סטטוס: ירוק כשמחובר/חושב, אפור אחרת -->
  <span
    class="pointer-events-auto shrink-0 grid place-items-center size-9"
    title={t("header.connected")}
  >
    <span
      class="size-2.5 rounded-full transition-colors duration-300"
      style="background:{session.status === 'connected' || session.status === 'thinking'
        ? 'var(--speaking)'
        : 'var(--fg-dim)'}; {session.status === 'connected' ? 'box-shadow:0 0 8px var(--speaking)' : ''}"
    ></span>
  </span>

  <!-- הגדרות — toggle: ב-/settings סוגר (חזרה), אחרת פותח -->
  <button
    type="button"
    class="pointer-events-auto size-9 grid place-items-center rounded-lg shrink-0 hover:bg-white/5"
    style="color:{onSettings ? 'var(--accent)' : 'var(--fg-dim)'}"
    onclick={toggleSettings}
    aria-label={t("header.settings")}
    aria-pressed={onSettings}
    title={t("header.settings")}
  >
    <SettingsIcon size={20} strokeWidth={1.75} />
  </button>
</header>
