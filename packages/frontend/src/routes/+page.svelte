<script lang="ts">
import { CLI_KINDS, type CliKind, type AgentPublic } from "@drive-coding/core"
import { goto } from "$app/navigation"
import { onMount } from "svelte"
import { connectAgent } from "$lib/actions/connect-agent"
import { fetchServerOptions } from "$lib/adapters/options"
import { listSessionsForCwd, type SessionInfo } from "$lib/adapters/sessions"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import SessionPicker from "$lib/components/connect/SessionPicker.svelte"
import ActiveProcessesPanel from "$lib/components/connect/ActiveProcessesPanel.svelte"
import LanguageSelect from "$lib/components/settings/LanguageSelect.svelte"
import Select from "$lib/components/ui/Select.svelte"
import FolderPickerDialog from "$lib/components/modals/FolderPickerDialog.svelte"
import FolderIcon from "@lucide/svelte/icons/folder"
import { getI18n, getSession, getSettings, getModals, getActiveAgents } from "$lib/context"

const settings = getSettings()
const session = getSession()
const modals = getModals()
const i18n = getI18n()
const t = i18n.t
const activeAgents = getActiveAgents()

let cliKind = $state<CliKind>(settings.cliKind)
let cwd = $state(settings.lastCwd)

// Slice 24: אכלס cwd מה-homeDir של השרת אם אין ערך שמור ולא הוקלד
// init-timing: cwd הוא $state מקומי שמועתק מ-settings.lastCwd ב-init.
// fetch חוזר אחרי init → מעדכן cwd ישירות (לא מסתמך על re-init).
// עדכן רק אם cwd עדיין ריק (המשתמש לא הקליד בינתיים).
onMount(() => {
  void activeAgents.refresh()

  // sessions-autoload: טעינה אוטומטית של סשנים — רק אם יש cwd מוכר מ-lastCwd
  // (לא משתמש חדש / cwd ריק). spawn יקר → רק כשסביר שהמשתמש יחזור לאותה תיקייה.
  // onMount רץ פעם אחת per mount — guard טבעי, אין צורך בדגל נוסף.
  if (settings.lastCwd && cwd.trim()) {
    void loadSessions()
  }

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

// C14: ניקוי שגיאה reactive — כשה-cwd משתנה (המשתמש תיקן) מנקה את השגיאה
// כך שה-error לא יישאר sticky לאחר תיקון הנתיב או reconnect.
// session.error מנוקה גם ע"י ה-VM לפני כל ניסיון התחברות חדש (connect/attach).
$effect(() => {
  // track cwd + cliKind — כל שינוי מנקה שגיאה ישנה
  void cwd
  void cliKind
  if (session.error !== null) session.error = null
})

// C15: סדר כפתור תיקייה לפי locale — RTL (עברית): כפתור ב-order:-1 (ימין visual)
// LTR (אנגלית): כפתור ב-order:1 (ימין visual, אחרי ה-input)
const isRtl = $derived(settings.locale === "he")

// ─── state עבור תפריט בחירת סשן (session picker) ───
let sessions = $state<SessionInfo[]>([])
let sessionsLoading = $state(false)
let sessionsError = $state<string | null>(null)
let selectedSessionId = $state<string | null>(null)

// ─── DEV-only: mock fixtures (static/fixtures/*.json) — דיבוג עיצוב ללא ACP ───
const MOCK_FIXTURES: SessionInfo[] = import.meta.env.DEV
  ? [
      ["greeting", "שיחה קצרה (3 בועות)"],
      ["tool-spill", "בינוני — הרבה הודעות (25)"],
      ["phone-tunnel", "בינוני מאוזן (39)"],
      ["mitm", "ארוך — בלוקי קוד (180)"],
      ["salary-prev", "ארוך — הרבה כלים (189)"],
      ["salary-attendance", "ארוך מאוד (209)"],
    ].map(([name, label]) => ({
      sessionId: `mock:${name}`,
      cwd: "/mock",
      title: `🧪 MOCK: ${label}`,
      updatedAt: "",
    }))
  : []

async function loadSessions() {
  sessionsLoading = true
  sessionsError = null
  sessions = []
  selectedSessionId = null
  try {
    sessions = await listSessionsForCwd(cwd.trim(), cliKind)
  } catch (e) {
    sessionsError = e instanceof Error ? e.message : String(e)
  } finally {
    // ב-dev: הצג את ה-mock fixtures בראש הרשימה (גם אם הטעינה האמיתית נכשלה)
    sessions = [...MOCK_FIXTURES, ...sessions]
    sessionsLoading = false
  }
}

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
  if (selectedSessionId !== null) {
    settings.setCliKind(cliKind)
    settings.setLastCwd(cwd.trim())
    await session.loadSession({ sessionId: selectedSessionId, cwd: cwd.trim(), cliKind })
    if (session.status === "connected") {
      await goto("/chat")
    }
  } else {
    await connectAgent({ cliKind, cwd: cwd.trim(), session, settings })
  }
}
</script>

<main class="connect">
  <h1>{t("connect.title")}</h1>
  <p class="subtitle">{t("connect.subtitle")}</p>

  <ActiveProcessesPanel onReconnect={handleReconnect} />

  <form onsubmit={onSubmit}>
    <label>
      <span>{t("settings.language.label")}</span>
      <LanguageSelect />
    </label>

    <label>
      <span>{t("connect.cli.label")}</span>
      <Select
        value={cliKind}
        options={CLI_KINDS.map((k) => ({ value: k, label: k }))}
        title={t("connect.cli.label")}
        ariaLabel={t("connect.cli.label")}
        disabled={session.status === "connecting"}
        onchange={(v) => (cliKind = v as CliKind)}
      />
    </label>

    <label>
      <span>{t("connect.cwd.label")}</span>
      <!-- C15: dir="auto" + margin-inline-start:auto על הכפתור → תמיד ב-inline-end -->
      <div class="cwd-row" dir="auto">
        <input
          type="text"
          bind:value={cwd}
          placeholder={t("connect.cwd.placeholder")}
          dir="ltr"
          disabled={session.status === "connecting"}
        />
        <!-- C15: כפתור תיקייה — order דינמי לפי locale
             RTL (עברית): order=-1 → מופיע לפני ה-input ב-flex = visual-right
             LTR (אנגלית): order=1 → מופיע אחרי ה-input = visual-right -->
        <button
          type="button"
          class="folder-btn"
          style="order: {isRtl ? -1 : 1}"
          onclick={() => modals.openFolder()}
          disabled={session.status === "connecting"}
          aria-label={t("settings.folder.pick")}
          title={t("settings.folder.pick")}
        >
          <FolderIcon size={18} strokeWidth={1.75} />
        </button>
      </div>
    </label>

    <SessionPicker
      {cwd}
      {cliKind}
      {sessions}
      loading={sessionsLoading}
      error={sessionsError}
      {selectedSessionId}
      onload={loadSessions}
      onselect={(id) => { selectedSessionId = id }}
    />

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
<FolderPickerDialog />

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

  input {
    padding: 0.7rem 0.8rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
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

  .folder-btn {
    flex-shrink: 0;
    margin-top: 0; /* מאפס את ה-margin-top של כלל ה-button הגלובלי — מיישר עם ה-input */
    display: grid;
    place-items: center;
    padding: 0 0.8rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
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
