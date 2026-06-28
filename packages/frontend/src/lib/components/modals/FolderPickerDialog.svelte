<script lang="ts">
/**
 * FolderPickerDialog — E2: בחירת תיקייה (redesign-6).
 *
 * Bits Dialog עם: breadcrumb, רשימת תיקיות, ניווט up, "בחר תיקייה זו".
 * מוקאפ: 699-733.
 *
 * ─── redesign-6 / windows-adaptation ───
 * cross-platform: breadcrumbs פיצול על [\\/], ניווט עם separator נכון.
 *
 * ─── folder-picker-fixes ───
 * prop startPath: נקודת-פתיחה מה-parent (cwd שהוזן ידנית). עדיפות-ראשונה ב-openAtStart.
 * נקרא בתוך untrack → לא הופך ל-dependency של ה-$effect.
 */
import { untrack } from "svelte"
import { Dialog as BitsDialog } from "bits-ui"
import FolderIcon from "@lucide/svelte/icons/folder"
import ArrowUpIcon from "@lucide/svelte/icons/arrow-up"
import XIcon from "@lucide/svelte/icons/x"
import { getI18n, getSettings, getModals } from "$lib/context"
import { browseFolder } from "$lib/adapters/fs-browse"
import type { FsEntry } from "$lib/adapters/fs-browse"
import { fetchServerOptions } from "$lib/adapters/options"

let { startPath = "" }: { startPath?: string } = $props()

const t = getI18n().t
const settings = getSettings()
const modals = getModals()

// מצב מקומי
// default: settings.lastCwd (שהוא homeDir מה-server אחרי load).
// אין fallback לנתיב Unix קשיח — BE מחזיר path מנורמל בlectFolder.
let currentPath = $state(settings.lastCwd || "")
let entries = $state<FsEntry[]>([])
let loading = $state(false)
let error = $state<string | null>(null)
let showHidden = $state(false)

// טעינה ב-$effect כשה-dialog נפתח (edge false→true בלבד)
// כל הפעולה ב-untrack: effect עוקב אך ורק אחרי modals.folderOpen
// loadFolder, showHidden, currentPath — כולם ב-untrack למניעת re-runs
$effect(() => {
  const isOpen = modals.folderOpen   // ← tracked: Svelte עוקב רק אחרי זה
  untrack(() => {
    if (isOpen) {
      showHidden = false
      void openAtStart()
    }
  })
})

// מחשב נקודת-פתיחה ופותח.
// סדר עדיפויות: startPath (קלט חי מה-parent) → settings.lastCwd → homeDir מהשרת.
// startPath נקרא כאן בתוך untrack → לא הופך ל-dependency של ה-$effect.
async function openAtStart() {
  let start = startPath.trim() || settings.lastCwd
  if (!start) {
    try {
      const opts = await fetchServerOptions()
      start = opts.homeDir
    } catch {
      // אם /api/options נכשל — נשאר ריק; loadFolder יציג error ולא יקרוס.
    }
  }
  currentPath = start || ""
  await loadFolder(currentPath)
}

// breadcrumb — פיצול הנתיב לחלקים cross-platform (גם / וגם \).
// Windows drive-letter: "D:\Users\User" → ["D:", "Users", "User"]
const breadcrumbs = $derived(
  currentPath.split(/[\\/]/).filter(Boolean)
)

// זיהוי separator: אם הנתיב מכיל "\" → Windows, אחרת Unix.
// BE מחזיר realpath מנורמל, כך שהseparator עקבי.
function getSeparator(path: string): string {
  return path.includes("\\") ? "\\" : "/"
}

// בדיקת root cross-platform: Unix "/" או Windows drive-root "C:\" / "C:/"
function isRoot(path: string): boolean {
  return path === "/" || /^[a-zA-Z]:[\\/]?$/.test(path)
}

async function loadFolder(path: string) {
  if (!path) {
    // נתיב ריק — אל תנסה לטעון; המשתמש יצטרך להקליד
    return
  }
  loading = true
  error = null
  try {
    const result = await browseFolder(path, showHidden)
    currentPath = result.path  // BE מחזיר realpath מנורמל
    entries = result.entries.filter((e) => e.isDir)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    loading = false
  }
}

function onToggleHidden() {
  showHidden = !showHidden
  void loadFolder(currentPath)
}

// טוען את התיקייה בפתיחת dialog
// onOpenChange רק לסנכרון close (Bits UI מפעיל כשרוצה לסגור)
function onOpenChange(open: boolean) {
  modals.folderOpen = open
}

function navigateTo(name: string) {
  const sep = getSeparator(currentPath)
  const base = currentPath.replace(/[\\/]+$/, "")  // הסרת separator סופי
  void loadFolder(`${base}${sep}${name}`)
}

function navigateToDepth(index: number) {
  // בונה נתיב אבסולוטי עד ה-crumb באינדקס index (כולל)
  // Windows drive: ["D:", "Users"] → "D:\Users"; Unix: ["home", "user"] → "/home/user"
  const crumbs = breadcrumbs.slice(0, index + 1)
  const sep = getSeparator(currentPath)
  let path: string
  if (crumbs.length > 0 && crumbs[0] !== undefined && /^[a-zA-Z]:$/.test(crumbs[0])) {
    // Windows drive: D: + \ + rest
    path = crumbs[0] + sep + crumbs.slice(1).join(sep)
  } else {
    // Unix: / + parts joined
    path = "/" + crumbs.join("/")
  }
  void loadFolder(path)
}

function navigateUp() {
  const sep = getSeparator(currentPath)
  // הסרת החלק האחרון — cross-platform
  const trimmed = currentPath.replace(/[\\/]+$/, "")  // ללא trailing separator
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (lastSep <= 0) {
    // Unix root
    void loadFolder("/")
    return
  }
  const parent = trimmed.slice(0, lastSep)
  // Windows drive-root: "D:" → "D:\"
  if (/^[a-zA-Z]:$/.test(parent)) {
    void loadFolder(parent + sep)
    return
  }
  void loadFolder(parent)
}

function pickFolder() {
  settings.setLastCwd(currentPath)
  modals.closeFolder()
}
</script>

<BitsDialog.Root open={modals.folderOpen} {onOpenChange}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay
      class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
    />
    <BitsDialog.Content
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        class="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
        style="background:var(--bg-elev); border:1px solid var(--border); max-height:80dvh"
      >
        <!-- header -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color:var(--border)">
          <BitsDialog.Title class="text-lg font-semibold">
            {t("modal.folder.title")}
          </BitsDialog.Title>
          <BitsDialog.Close
            class="size-8 grid place-items-center rounded-lg"
            style="color:var(--fg-dim)"
            aria-label={t("modal.close")}
          >
            <XIcon size={16} strokeWidth={2} />
          </BitsDialog.Close>
        </div>

        <!-- breadcrumb -->
        <div
          class="mx-4 my-2 px-3 py-2 rounded-lg font-mono text-xs overflow-x-auto whitespace-nowrap shrink-0"
          style="background:var(--bg-card); color:var(--fg-dim)"
          dir="ltr"
        >
          {#each breadcrumbs as crumb, i}
            <button
              type="button"
              class="hover:underline inline"
              style="color:var(--accent-hi)"
              onclick={() => navigateToDepth(i)}
            >{crumb}</button>
            {#if i < breadcrumbs.length - 1}
              <span class="opacity-40 mx-1">/</span>
            {/if}
          {/each}
        </div>

        <!-- checkbox: הצג תיקיות מוסתרות -->
        <label class="mx-4 mb-1 flex items-center gap-2 text-xs shrink-0" style="color:var(--fg-dim)">
          <input type="checkbox" checked={showHidden} onchange={onToggleHidden} class="cursor-pointer" />
          {t("modal.folder.showHidden")}
        </label>

        <!-- רשימת תיקיות -->
        <div class="flex-1 overflow-y-auto chat-scroll px-4 pb-2 flex flex-col gap-1.5" dir="ltr">
          {#if loading}
            <div class="text-center py-8 opacity-50 text-sm">{t("modal.folder.loading")}</div>
          {:else if error}
            <div class="text-center py-4 text-sm" style="color:var(--recording)">{t("modal.folder.error")}: {error}</div>
          {:else}
            <!-- up button — מוצג כל עוד לא ב-root (cross-platform: "/" או "D:\") -->
            {#if !isRoot(currentPath) && currentPath !== ""}
              <button
                class="flex items-center gap-3 px-3 py-3.5 rounded-xl text-sm text-start"
                style="background:var(--bg-card); color:var(--fg-muted)"
                onclick={navigateUp}
              >
                <ArrowUpIcon size={16} strokeWidth={2} />
                ..
              </button>
            {/if}

            <!-- תיקיות -->
            {#each entries as entry (entry.name)}
              <button
                class="flex items-center gap-3 px-3 py-3.5 rounded-xl text-sm text-start"
                style="background:var(--bg-card)"
                onclick={() => navigateTo(entry.name)}
              >
                <FolderIcon size={16} strokeWidth={1.5} style="color:var(--accent)" />
                {entry.name}
              </button>
            {/each}
          {/if}
        </div>

        <!-- footer: path + pick button -->
        <div
          class="px-4 py-3 border-t flex items-center justify-between gap-3 shrink-0"
          style="border-color:var(--border); background:var(--bg-elev)"
        >
          <span class="text-xs truncate" style="color:var(--fg-muted)" dir="ltr">{currentPath}</span>
          <button
            class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white shrink-0"
            style="background:var(--accent)"
            onclick={pickFolder}
          >
            {t("modal.folder.pick")}
          </button>
        </div>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>
