<script lang="ts">
import { CLI_KINDS, type CliKind, type AgentPublic } from "@drive-coding/core"
import { goto } from "$app/navigation"
import { onMount, untrack } from "svelte"
import { connectAgent } from "$lib/actions/connect-agent"
import { fetchServerOptions } from "$lib/adapters/options"
import type { RecentProject } from "$lib/adapters/recent-projects"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import ActiveProcessesPanel from "$lib/components/connect/ActiveProcessesPanel.svelte"
import RecentProjectsPanel from "$lib/components/connect/RecentProjectsPanel.svelte"
import LanguageSelect from "$lib/components/settings/LanguageSelect.svelte"
import Select from "$lib/components/ui/Select.svelte"
import FolderPickerDialog from "$lib/components/modals/FolderPickerDialog.svelte"
import ContentViewerDialog from "$lib/components/modals/ContentViewerDialog.svelte"
import LoadingModal from "$lib/components/modals/LoadingModal.svelte"
import FolderIcon from "@lucide/svelte/icons/folder"
import Loader2Icon from "@lucide/svelte/icons/loader-2"
import { getI18n, getSession, getSettings, getModals, getActiveAgents } from "$lib/context"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"

const settings = getSettings()
const session = getSession()
const modals = getModals()
const i18n = getI18n()
const t = i18n.t
const activeAgents = getActiveAgents()
// slice cli-availability (re-scope): מציג את כל ה-CLI_KINDS תמיד, ומשבית (disabled)
// את מי שלא מותקן בפועל בסביבת ה-BE — לא מסתיר (§1).
// available מאותחל ל-CLI_KINDS המלא (race-safe) ונופל חזרה אליו אם ה-endpoint נכשל (§2, §6) —
// בשני המצבים (loading/error) זה שקול ל"הכל enabled" כי disabled נגזר מ-!available.includes(k).
const cliAvailability = new CliAvailability()

let cliKind = $state<CliKind>(settings.cliKind)
let cwd = $state(settings.lastCwd)

// Slice 24: אכלס cwd מה-homeDir של השרת אם אין ערך שמור ולא הוקלד
// init-timing: cwd הוא $state מקומי שמועתק מ-settings.lastCwd ב-init.
// fetch חוזר אחרי init → מעדכן cwd ישירות (לא מסתמך על re-init).
// עדכן רק אם cwd עדיין ריק (המשתמש לא הקליד בינתיים).
onMount(() => {
  void activeAgents.refresh()
  void cliAvailability.load()

  fetchServerOptions()
    .then((opts) => {
      if (cwd === "" || cwd === settings.lastCwd) {
        // localStorage ריק והמשתמש לא הקליד — הצב homeDir
        if (!settings.lastCwd && cwd === "") {
          cwd = opts.homeDir
        }
      }
    })
    .catch(() => {
      // fetch נכשל → cwd נשאר ריק, המשתמש יקליד ידנית. לא לשבור את מסך ה-connect.
    })
})

// C10: כפתור בחירת תיקייה פותח FolderPickerDialog (שכותב ל-settings.lastCwd).
// סנכרון: כשה-dialog נסגר, משוך את הבחירה ל-cwd המקומי (input מבוקר).
let folderWasOpen = $state(false)
$effect(() => {
  if (folderWasOpen && !modals.folderOpen) cwd = settings.lastCwd
  folderWasOpen = modals.folderOpen
})

// C14: ניקוי שגיאה reactive — כשה-cwd או cliKind משתנים (המשתמש תיקן) מנקה את השגיאה.
// untrack: session.error נקרא ונכתב בתוך untrack() כדי שהוא לא יהיה dependency של ה-effect.
// כך השגיאה נשארת מוצגת כל עוד המשתמש לא ערך את הטופס — ורק שינוי cwd/cliKind מנקה.
$effect(() => {
  // track רק cwd + cliKind — שינוי בהם מנקה שגיאה ישנה
  void cwd
  void cliKind
  untrack(() => {
    if (session.error !== null) session.error = null
  })
})

// C15: dir מפורש לפי locale — כפתור תיקייה ב-order:-1 תמיד (ראשון בflex).
// RTL (dir="rtl"): flex מימין לשמאל → ראשון=ימין ויזואלי. ✓
// LTR (dir="ltr"): flex משמאל לימין → ראשון=שמאל ויזואלי. ✓
// dir="auto" הוסר: היה מושפע מתוכן הנתיב (LTR) ולא מה-locale.
const isRtl = $derived(settings.locale === "he")

async function handleReconnect(agent: AgentPublic) {
  if (!agent.acpSessionId) return
  settings.setCliKind(agent.cliKind)
  settings.setLastCwd(agent.cwd)
  await session.attachToLiveAgent({
    agentId: agent.id,
    sessionId: agent.acpSessionId,
    cwd: agent.cwd,
    cliKind: agent.cliKind,
  })
  if (session.status === "connected") { await goto("/chat") }
  // if status==="error" — stay on /, VM set this.error
}

async function onSubmit(e: SubmitEvent) {
  e.preventDefault()
  if (!cwd.trim()) return
  await connectAgent({ cliKind, cwd: cwd.trim(), session, settings })
}

// connect-recent-projects: לחיצה על תיקייה אחרונה → חיבור ישיר (סשן חדש).
// connectAgent מבצע setCliKind/setLastCwd ו-goto("/chat") פנימית.
async function handleRecentSelect(project: RecentProject) {
  cliKind = project.kind
  cwd = project.cwd
  await connectAgent({ cliKind: project.kind, cwd: project.cwd, session, settings })
}
</script>

<main class="connect">
  <h1>{t("connect.title")}</h1>
  <p class="subtitle">{t("connect.subtitle")}</p>

  <ActiveProcessesPanel onReconnect={handleReconnect} />

  <!-- connect-recent-projects: רשימת תיקיות אחרונות — מ-GET /api/projects (registry) -->
  <RecentProjectsPanel onSelect={handleRecentSelect} />

  <form onsubmit={onSubmit}>
    <label>
      <span>{t("settings.language.label")}</span>
      <LanguageSelect />
    </label>

    <label>
      <span class="cli-label-row">
        {t("connect.cli.label")}
        {#if cliAvailability.loading}
          <Loader2Icon size={14} class="animate-spin" style="color:var(--fg-dim)" aria-hidden="true" />
          <span class="cli-hint">{t("connect.cli.loading")}</span>
        {:else if cliAvailability.error}
          <!-- §2/§6/§9 Q3: fallback = מציג הכול + אינדיקציה חלשה (לא באנר חוסם) -->
          <span class="cli-hint">{t("connect.cli.showAll")}</span>
        {/if}
      </span>
      <!-- Select.value נשאר cliKind גם אם הוא disabled ב-options (למקרה reconnect) —
           כל ה-CLI_KINDS מוצגים תמיד; מי שלא available מקבל disabled פר-option (§1, §4 Commit 2). -->
      <Select
        value={cliKind}
        options={CLI_KINDS.map((k) => ({
          value: k,
          label: k,
          disabled: !cliAvailability.available.includes(k),
          description: cliAvailability.available.includes(k)
            ? null
            : t("connect.cli.notInstalled"),
        }))}
        title={t("connect.cli.label")}
        ariaLabel={t("connect.cli.label")}
        disabled={session.status === "connecting"}
        onchange={(v) => (cliKind = v as CliKind)}
      />
    </label>

    <label>
      <span>{t("connect.cwd.label")}</span>
      <!-- C15: dir מפורש לפי locale (לא dir="auto" — שמושפע מתוכן הנתיב).
           כפתור תיקייה עם order:-1 תמיד = ראשון בflex.
           RTL (עברית): flex מימין לשמאל → ראשון=ימין ויזואלי. ✓
           LTR (אנגלית): flex משמאל לימין → ראשון=שמאל ויזואלי. ✓ -->
      <div class="cwd-row" dir={isRtl ? "rtl" : "ltr"}>
        <input
          type="text"
          bind:value={cwd}
          placeholder={t("connect.cwd.placeholder")}
          dir="ltr"
          disabled={session.status === "connecting"}
        />
        <!-- C15: order:-1 → תמיד ראשון בflex: LTR=שמאל, RTL=ימין -->
        <button
          type="button"
          class="folder-btn"
          style="order: -1"
          onclick={() => modals.openFolder()}
          disabled={session.status === "connecting"}
          aria-label={t("settings.folder.pick")}
          title={t("settings.folder.pick")}
        >
          <FolderIcon size={18} strokeWidth={1.75} />
        </button>
      </div>
    </label>

    <label>
      <span>{t("chat.voicePicker.label")}</span>
      <VoicePicker />
    </label>

    <button type="submit" disabled={!cwd.trim() || session.status === "connecting"}>
      {session.status === "connecting" ? t("connect.submitting") : t("connect.submit")}
    </button>
  </form>

  {#if session.error}
    <div class="error" role="alert">
      <strong>{t("connect.error.prefix")}</strong>
      {session.error}
    </div>
  {/if}
</main>

<!-- C10: בורר תיקיות (מרונדר כאן כי דף החיבור אינו עטוף ב-AppShell) -->
<!-- folder-picker-fixes: startPath={cwd} → הבורר נפתח בנתיב שהוזן ידנית -->
<FolderPickerDialog startPath={cwd} />
<!-- content-viewer (slice content-viewer — כמו FolderPickerDialog: מסך connect אינו עטוף ב-AppShell) -->
<ContentViewerDialog />
<!-- ui-session-polish fix5-extend: מודאל-טעינה גם ב-connect ראשוני + reconnect + רינדור היסטוריה -->
<LoadingModal open={session.status === "connecting" || session.isLoadingHistory} />

<style>
  /* גובה מלא + גלילה פנימית: ה-body הוא overflow:hidden (app.css), ודף החיבור
     אינו עטוף ב-AppShell, לכן הוא חייב לגלול בעצמו — אחרת התוכן נחתך במסכים נמוכים. */
  .connect {
    max-width: 420px;
    height: 100dvh;
    overflow-y: auto;
    margin: 0 auto;
    padding: 4rem 1rem;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
    font-weight: 600;
  }

  .subtitle {
    margin: 0 0 2rem;
    color: var(--fg-dim);
    font-size: 0.95rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  label > span {
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  /* slice cli-availability: ספינר-טעינה / אינדיקציית-fallback ליד תווית ה-dropdown */
  .cli-label-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .cli-hint {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--fg-dim);
  }

  /* יישור לגובה ה-Select (px-3 py-2.5 text-sm rounded-xl) — אחידות שורות */
  input {
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg);
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.2);
  }

  /* C10+C15: שורת cwd — input גמיש + כפתור תיקייה */
  .cwd-row {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }

  .cwd-row .folder-btn {
    align-self: stretch;
  }

  .cwd-row input {
    flex: 1;
    min-width: 0;
  }

  /* folder-btn — זהה ל-refresh-btn ב-SessionPicker (אחידות 2 הלחצנים) */
  .folder-btn {
    flex-shrink: 0;
    margin-top: 0; /* מאפס את ה-margin-top של כלל ה-button הגלובלי — מיישר עם ה-input */
    display: grid;
    place-items: center;
    padding: 0 0.7rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    color: var(--fg-dim);
    cursor: pointer;
  }

  .folder-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
  }

  .folder-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    margin-top: 0.5rem;
    padding: 0.8rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hi);
  }

  button:disabled {
    background: var(--muted);
    cursor: not-allowed;
    opacity: 0.7;
  }

  .error {
    margin-top: 1.5rem;
    padding: 0.9rem 1rem;
    background: rgba(255, 79, 79, 0.1);
    border: 1px solid rgba(255, 79, 79, 0.3);
    border-radius: 8px;
    color: var(--recording);
    font-size: 0.9rem;
  }
</style>
