---
project: "voice-acp"
slice: "slice-redesign-6-modals"
verifier: "avigail"
date: "2026-06-02"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "regression"
    category: "missing-symbol"
    summary: "Brief assumes 'Bits Dialog שהוכרע ב-redesign-3' + a ui-wrapper, but the redesign-3 decision chose Bits Switch ONLY and explicitly REJECTED Bits Select/Portal (RTL quirks). No Dialog decision exists, no ui/Dialog.svelte wrapper exists — only Select.svelte + Switch.svelte in components/ui/"
    source_brief: "§0 line 16, §1 line 52-53, §3 line 37, §4 Commits 2+3, §6 first risk row"
    source_code: "packages/frontend/src/lib/components/ui/ (only Select.svelte, Switch.svelte); docs/decisions/voice-acp.md:3-16"
    cost_estimate: "30-60min"
  - id: 2
    severity: "confusion"
    category: "wrong-path"
    summary: "Brief §3 + §0 reading-list say i18n keys live at frontend 'i18n/keys.ts' — actual location is packages/core/src/i18n/keys.ts (keys are in @drive-coding/core, not the frontend package)"
    source_brief: "§0 line 39 (implicit), §3 line 87"
    source_code: "packages/core/src/i18n/keys.ts"
    cost_estimate: "5-10min"
  - id: 3
    severity: "confusion"
    category: "wrong-line-number"
    summary: "Brief cites /api/fs/browse at 'http-history.ts:115' without the delivery/ subdir — actual path is packages/backend/src/delivery/http-history.ts:115 (line number is exact, dir is missing)"
    source_brief: "§0 line 40, §3 reading-list"
    source_code: "packages/backend/src/delivery/http-history.ts:115"
    cost_estimate: "2-5min"
  - id: 4
    severity: "confusion"
    category: "dropped-branch"
    summary: "Brief says 'reuse formatDate מ-SessionPicker' but formatDate is a plain instance-scope function inside <script lang=ts> (line 31), NOT in <script module> and NOT exported — cannot be imported. Executor must extract to util or duplicate"
    source_brief: "§0 line 41, §4 Commit 3 line 133"
    source_code: "packages/frontend/src/lib/components/connect/SessionPicker.svelte:31"
    cost_estimate: "10-15min"
  - id: 5
    severity: "minor"
    category: "dropped-branch"
    summary: "loadSession requires {sessionId, cwd, cliKind} (3 fields) but brief §4 Commit 3 pseudo implies only sessionId — modal must capture/pass cwd+cliKind like routes/+page.svelte:44 does"
    source_brief: "§2 line 63, §4 Commit 3 line 132"
    source_code: "packages/frontend/src/lib/view-models/agent-session.svelte.ts:191"
    cost_estimate: "5-10min"
  - id: 6
    severity: "minor"
    category: "outdated-risk"
    summary: "Brief should reuse existing i18n keys (sessions.*, settings.folder.pick, sidebar.refresh/newSession) rather than create duplicates — only breadcrumb/up/select-this-folder are genuinely new"
    source_brief: "§3 line 87, §4 Commits 2-3"
    source_code: "packages/core/src/i18n/keys.ts:74-124"
    cost_estimate: "5min"
---

# Plan Verification — slice-redesign-6-modals

> **Brief**: docs/plans/slice-redesign-6-modals.md
> **Base tip**: 1c36bf3 (branch slice-redesign-5-bubbles)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: 60-90 דק' (רובו על Bits Dialog שלא קיים)

## בעיות שנמצאו

### 🔴 Regression risk / Blocker

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | ה-brief בנוי כולו סביב הנחה ש**"Bits Dialog הוכרע ב-redesign-3"** ושיש ui-wrapper מוכן. בפועל ה-decision ב-`docs/decisions/voice-acp.md:3-16` בחר **Bits Switch בלבד** ו**דחה מפורשות** את Bits Select/Portal ("Portal + JS overhead + RTL quirks"). **אין** החלטה על Dialog, **אין** `ui/Dialog.svelte`. ב-`components/ui/` יש רק `Select.svelte` (native fallback!) + `Switch.svelte`. Bits Dialog **גם** דורש Portal — בדיוק מה ש-redesign-3 ברח ממנו ב-Select. | brief §0:16, §1:52-53, §3:37, §4 Commits 2+3, §6 שורת-סיכון 1 / `components/ui/`, `docs/decisions/voice-acp.md:3-16` | אליעזר ייגש לכתוב `import { Dialog } from "bits-ui"`, יגלה שאין wrapper מוכרע, יתקל ב-Portal/RTL בדיוק כמו Select, ויבזבז 30-60 דק' לפני שיבין שצריך escalation או החלטה ארכיטקטונית. ה-brief עצמו מודה בסיכון (§6) אבל ממסגר אותו כ-"אם נשבר" במקום כ-"לא הוכרע". |

> **הערה ל-מרדכי**: זו לא בעיית factual בלבד — זו **שאלה ארכיטקטונית פתוחה** (D-level): האם Dialog דרך Bits Portal, או custom modal עם focus-trap ידני (כפי ש-Select בחר native)? ה-brief §6/§7 מכיר ב-escalation, אבל ההכרעה צריכה להיות **לפני** dispatch, אחרת אליעזר יחליט אקראית. ה-precedent מ-redesign-3 (Select→native) מטה לכיוון custom modal, לא Bits Dialog.

### 🟡 Confusion / wrong-path

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | i18n keys לא ב-frontend `i18n/keys.ts` אלא ב-`packages/core/src/i18n/keys.ts` (+ catalogs/en.ts, he.ts). ה-VM `i18n.svelte.ts` רק עוטף את `@drive-coding/core/i18n`. | §3:87, §0:39 | מרדכי: לתקן את §3 ל-`packages/core/src/i18n/keys.ts` + 2 catalogs. additive שם, לא ב-FE. |
| 3 | `/api/fs/browse` ב-`packages/backend/src/delivery/http-history.ts:115` — מספר השורה **מדויק** אבל ה-brief מַשמיט את תת-התיקייה `delivery/`. | §0:40, §3 | לתקן ל-`delivery/http-history.ts:115`. |
| 4 | "reuse formatDate מ-SessionPicker" — `formatDate` הוא `function` רגיל בתוך `<script lang="ts">` (שורה 31), **לא** ב-`<script module>` ו**לא** מיוצא. אי-אפשר לייבא אותו. | §0:41, §4 Commit 3:133 | מרדכי: או לחלץ ל-`util/format-date.ts` (commit נוסף קטן), או להנחות "שכפל את הלוגיקה". לא "reuse" כמו שזה. |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 5 | `loadSession` דורש `{sessionId, cwd, cliKind}` (3 שדות, agent-session.svelte.ts:191). ה-brief §4 Commit 3 מרמז רק על sessionId. ה-modal חייב ללכוד cwd+cliKind כמו `routes/+page.svelte:44`. | §2:63, §4 Commit 3 |
| 6 | מפתחות i18n רבים כבר קיימים: `sessions.loadButton/loading/label/startNew/error` (74-79), `settings.folder.label/pick` (102-103), `sidebar.sessions/refresh/newSession` (122-124). מומלץ reuse, לא duplicate. רק breadcrumb/up/"בחר תיקייה זו" באמת חדשים. | §3:87 |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **base branch** `slice-redesign-5-bubbles` קיים, tip `1c36bf3` תואם. depends_on (redesign-1/2/3) כולם ב-chain (כל 5 ה-branches קיימים).
- ✅ **package name** `@drive-coding/frontend-v2` — מדויק (package.json:2).
- ✅ `/api/fs/browse` — קיים, מאובטח: `allowedBase` + `realpath` + 403 על traversal, מחזיר `{path, entries:[{name,isDir}]}` (delivery/http-history.ts:113-155). §6/§7 security claims מדויקים.
- ✅ `listSessionsForCwd(cwd, cliKind): Promise<SessionInfo[]>` — sessions.ts:36, `SessionInfo` type:17.
- ✅ `setLastCwd(cwd)` — settings.svelte.ts:119.
- ✅ `beUrl()` — קיים ב-`util/be-url.ts` (יש גם be-url.test.ts). pseudo של browseFolder תקין.
- ✅ **מוקאפ**: SessionsScreen 652-697 ✅, FolderPicker 699-733 ✅, SessionCard 293-301 — line ranges מדויקים.
- ✅ **context.ts** — pattern `createContext<T>()` עם setX/getX זוגות (26-52). additive setModals/getModals יתאים.
- ✅ **render points**: `AppShell.svelte` מרנדר Sidebar (64) + BottomSheet (90) — מקום ל-Dialogs.
- ✅ **wiring targets קיימים ומסומנים**: `SessionOptionsPanel.svelte` יש `<!-- TODO redesign-6: wire refresh/create/list -->` (187,198,206). `SettingsScreen.svelte:43-49` כפתור folder-pick `disabled` placeholder. ה-brief מכוון בדיוק לנקודות הנכונות.
- ✅ **§4 deletion question (Q4)**: SessionPicker **עדיין נצרך** ב-`routes/+page.svelte:7,79`. ה-brief נכון שלא למחוק — connect `/` חי. אין regression.
- ✅ **ModalsVM החלטה (§9 Q2)**: עקבי עם הפותחים המרובים (sidebar/sheet/settings). singleton entity כמו UiShellVM — תקין.

## Verdict

🟡 **USABLE-AFTER-FIX** — ה-brief טכנית-מדויק ב~90% (כל ה-APIs, paths של fs/browse+sessions+loadSession, מוקאפ, context, wiring-targets, deletion-safety — כולם אומתו). אבל finding #1 הוא חור ארכיטקטוני אמיתי: ה-brief בונה הכל על "Bits Dialog שהוכרע" כשבפועל לא הוכרע ו-precedent redesign-3 דחה Portal. מרדכי צריכה: (א) להכריע Dialog: Bits-Portal מול custom-modal — **לפני** dispatch; (ב) לתקן 3 paths/reuse (#2/#3/#4). ~30-45 דק' תיקון של מרדכי. אחרי זה — READY.
