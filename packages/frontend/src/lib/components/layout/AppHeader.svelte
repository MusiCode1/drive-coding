<script lang="ts">
/**
 * AppHeader — header צף עם fade gradient.
 *
 * כולל: [☰ דסקטופ בלבד] [כותרת-סשן ממורכזת] ··· [cwd chip + status dot]
 *
 * redesign-fix: disconnect + audio master + ⚙ הגדרות הועברו ל-SessionOptionsPanel
 * (ה-⚙ ירד מה-header בכל המצבים — בראש רשימת הפעולות בפאנל/sheet).
 *
 * hamburger: דסקטופ בלבד (מוסתר במובייל — sheet peek במקומו). (אביגיל #3)
 *
 * slice session-title: כותרת-סשן במרכז (fallback=agentName); cwd chip עבר ל-inline-end.
 *
 * ─── redesign-2 ───
 */
import MenuIcon from "@lucide/svelte/icons/menu"
import FolderIcon from "@lucide/svelte/icons/folder"
import { getI18n, getResponsive, getSession, getUiShell } from "$lib/context"

const responsive = getResponsive()
const uiShell = getUiShell()
const session = getSession()
const t = getI18n().t

// שם הסוכן — placeholder קבוע; redesign-3 יחבר לאפשרויות הסוכן
const agentName = "drive-coding"

// cwd — רק שם התיקייה האחרון. split על / וגם \ (Windows path separator).
const cwdLabel = $derived(
  session.cwd ? session.cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? session.cwd : ""
)

// slice session-title: כותרת הסשן אם קיימת, fallback ל-agentName ("drive-coding")
const headerLabel = $derived(session.sessionTitle?.trim() ? session.sessionTitle : agentName)
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

  <!-- כותרת ממורכזת אבסולוטית: כותרת-הסשן בלבד (ה-cwd עבר ל-inline-end) -->
  <!-- start-1/2 (לוגי); -translate-x-1/2 = מרכוז גאומטרי (a-directional, תקין) -->
  <div class="absolute start-1/2 -translate-x-1/2 top-3 h-9 flex items-center justify-center pointer-events-none max-w-[60%]">
    <span
      class="text-[15px] font-semibold shrink-0 truncate max-w-[min(60vw,22rem)]"
      title={headerLabel}
    >{headerLabel}</span>
  </div>

  <!-- spacer — דוחק את קבוצת-הסטטוס ל-inline-end -->
  <div class="flex-1"></div>

  <!-- קבוצת-סטטוס (inline-end): cwd chip + נקודת-חיבור. בעברית inline-end = שמאל. -->
  <!-- קלאסים לוגיים בלבד: gap/px/py סימטריים (תקין). אסור ml/mr/pl/pr/left/right חדשים. -->
  <div class="flex items-center gap-2 shrink-0">
    {#if cwdLabel}
      <!-- cwd chip: dir="ltr" נשאר רק על ה-chip (path הוא LTR), לא על הקבוצה -->
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
    <!-- נקודת סטטוס: ירוק כשמחובר/חושב, אפור אחרת -->
    <span
      class="pointer-events-auto shrink-0 grid place-items-center size-9"
      title={t("header.connected")}
    >
      <span
        class="size-2.5 rounded-full transition-colors duration-300"
        style="background:{session.status === 'connected' ? 'var(--speaking)' : 'var(--fg-dim)'}; {session.status === 'connected' ? 'box-shadow:0 0 8px var(--speaking)' : ''}"
      ></span>
    </span>
  </div>
</header>
