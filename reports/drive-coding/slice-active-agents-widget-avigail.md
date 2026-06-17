---
project: "drive-coding"
slice: "slice-active-agents-widget"
verifier: "avigail"
date: "2026-06-13"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "blocker"
    category: "missing-dependency"
    summary: "base branch slice-active-agents-backend does not exist (not local, not remote) — worktree command fails"
    source_brief: "§0 Worktree + §0 תלויות"
    source_code: "git branch -a (no slice-active-agents-backend)"
    cost_estimate: "blocks dispatch entirely"
  - id: 2
    severity: "confusion"
    category: "outdated-risk"
    summary: "Linux env: /home/user paths, linux-gui Chrome :9222, playwright-cli -s=vacp, lint:i18n is a .sh script — project now on Windows d:/UserProjects/AI/drive-coding"
    source_brief: "§0 Worktree/Browser/איך להריץ, §4 Commit 3 verification"
    source_code: "package.json:18 lint:i18n -> ./scripts/lint-no-hebrew-in-code.sh"
    cost_estimate: "5-10min"
  - id: 3
    severity: "confusion"
    category: "wrong-line-number"
    summary: "brief §4 Commit 2 says formatDate uses toLocaleTimeString like SessionCard:20, but SessionCard:20 uses toLocaleString (date+time, not time-only)"
    source_brief: "§4 Commit 2 (גיל) + §9 Q2"
    source_code: "packages/frontend/src/lib/components/modals/SessionCard.svelte:20"
    cost_estimate: "2-5min"
  - id: 4
    severity: "minor"
    category: "type-error"
    summary: "pid/persistent/attached are optional on AgentPublic (added by backend slice) — rendering pid:a.pid shows undefined if BE not enriched; brief handles via ?. but worth noting"
    source_brief: "§4 Commit 2 row rendering"
    source_code: "packages/core/src/schemas/agent.ts:79-93 (no pid/persistent/attached yet)"
    cost_estimate: "0min (already guarded)"
---

# Plan Verification — slice-active-agents-widget

> **Brief**: docs/plans/slice-active-agents-widget.md
> **Base tip (dev)**: e25912c
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן אליעזר confusion אם לא תוקן**: ~15-25 דק' (בעיקר env + dependency ordering)

הערת-הקשר: זהו slice משורשר (`depends_on: [slice-active-agents-backend]`). ה-symbols
שמסופקים ע"י ה-backend (`AgentPublic.persistent/.pid/.attached`, `POST /api/agents/:id/persistent`)
**טרם קיימים ב-dev** — וזה צפוי. אימתתי ש-shape תואם בין שני ה-briefs (ראה spot-check)
ולכן לא סימנתי אותם כ-blocker. ה-blocker היחיד הוא ש-branch ה-base אינו קיים בכלל.

## בעיות שנמצאו

### 🔴 Blocker

| # | בעיה | מקור (brief / קוד) | עלות אם לא תוקן |
|---|------|---------------------|------------------|
| 1 | **branch `slice-active-agents-backend` לא קיים** — לא מקומית ולא ב-remote. `git branch -a` מראה רק dev/main/P1a/P1b/ws-reconnect וכו'. ה-brief §0 מצהיר `Base: branch slice-active-agents-backend` ופקודת ה-worktree עושה `git worktree add ... -b slice-active-agents-widget slice-active-agents-backend` — **תיפול** (`fatal: invalid reference`). בנוסף ה-backend brief עצמו עדיין `סטטוס: טיוטה` / `אימות אביגיל: לא מאומת`. | brief §0 Worktree (שורה 37) + §0 תלויות / `git branch -a` | חוסם dispatch לחלוטין — חייב לדַספץ' ולמזג/ליצור את branch ה-backend קודם |

> שורש: שרשור תקין מבחינת **תוכן** (depends_on מוצהר, shape עקבי), אבל ה-base
> הפיזי לא קיים עדיין. מרדכי צריכה לוודא ש-`slice-active-agents-backend` dispatched
> (לפחות יש branch) לפני שה-widget נשלח לאליעזר, או לעדכן את ה-base ל-dev אם
> ה-backend כבר ימוזג. זו בדיוק בדיקה 8 (depends_on) — עקבי בהצהרה אך ה-branch חסר.

### 🟡 Confusion / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 2 | **סביבה לינוקסית בכל ה-brief**: §0 Worktree `cd /home/user/projects/drive-coding`; §0 Browser `linux-gui Chrome :9222` + `playwright-cli -s=vacp attach --cdp=...`; §0 "איך להריץ" נתיבי linux. הפרויקט עכשיו על Windows (`d:\UserProjects\AI\drive-coding`). גם `pnpm lint:i18n` → `./scripts/lint-no-hebrew-in-code.sh` (bash) — דורש bash ב-Windows (קיים `.mjs` מקביל אבל ה-script ב-package.json הוא ה-`.sh`). | brief §0 (כל התת-סעיפים), §4 Commit 0/2/3 verification | תקני נתיבים ל-Windows; ציין שה-browser-check ידני בסביבה הנוכחית; ודאי ש-`lint:i18n` רץ (bash/git-bash) |
| 3 | **wrong-line/naming**: §4 Commit 2 ("גיל") + §9 Q2 אומרים "הצג שעה מ-`toLocaleTimeString("he-IL")` כמו SessionCard:20" / "`formatDate` (שעה:דקה)". בפועל `SessionCard.svelte:20` קורא ל-`toLocaleString` (לא `toLocaleTimeString`) ומחזיר **יום/חודש + שעה:דקה** (4 שדות), לא שעה בלבד. החיקוי המדויק יחזיר תאריך מלא, לא "שעה:דקה". | brief §4 Commit 2 / `SessionCard.svelte:17-29` (השורה הרלוונטית 20) | תקני ל-`toLocaleString` ותארי שזה תאריך+שעה, או בחרי `toLocaleTimeString` בכוונה |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | `pid`/`persistent`/`attached` הם optional ב-`AgentPublic` (נוספים ב-backend slice). `pid: a.pid` בשורה ירנדר `undefined` אם ה-BE לא העשיר — ה-brief מטפל ב-`?.` ל-acpSessionId אבל ל-pid אין guard. לא חוסם (BE brief מבטיח enrichment). | brief §4 Commit 2 / `agent.ts:79-93` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **shape עקביות backend↔widget** — `AgentPublic` (`agent.ts:79-93`) כבר כולל `id/cliKind/cwd/status/createdAt/acpSessionId`. ה-backend brief §3/§4 Commit 0 מוסיף `persistent?`/`pid?`/`attached?` בדיוק כפי שה-widget מניח. תואם.
- ✅ `listAgents` ב-`agents-api.ts:50-59` — קיים, חתימה `Promise<AgentPublic[]>`. אומת.
- ✅ `deleteAgent` ב-`agents-api.ts:91-102` — קיים. אומת.
- ✅ `withTimeout` + `AGENTS_API_TIMEOUT_MS` ב-`agents-api.ts:9,12` — קיימים; דפוס `setAgentPersistent` של ה-brief תואם ל-`deleteAgent` הקיים (אחרי שורה 102). אומת.
- ✅ `context.ts` קונבנציית תוספתיות — שורות 9-12 מתעדות "בלוק חדש בסוף, אל תערוך קיים". הבלוק האחרון `modals` בשורה 60. אומת.
- ✅ `+layout.svelte` composition root — דפוס הוספת VM (שורות 8-11) + בלוק `new VM()` + `setX()` (95-105). אומת; ה-VM החדש בלתי-תלוי → מיקום חופשי.
- ✅ `+page.svelte` `onMount` שורות 29-49 — אומת (29 פתיחה, 49 סגירה).
- ✅ `+page.svelte` `onSubmit` ענף existing-session שורות 101-107 — אומת. ה-`handleReconnect` ב-brief מחקה אותו נאמנה: `setCliKind`+`setLastCwd`+`loadSession({sessionId,cwd,cliKind})`+`if connected goto("/chat")`. הבדל יחיד (תקין): onSubmit משתמש ב-`cliKind` מקומי, ה-handler ב-`agent.cliKind` — `AgentPublic.cliKind` קיים (`agent.ts:81`), אז זו התאמה נכונה ולא regression.
- ✅ `session.loadSession` — public arrow field ב-`agent-session.svelte.ts:508`, חתימה `{sessionId,cwd,cliKind:CliKind}` — תואם בדיוק לקריאה ב-`handleReconnect`. אומת.
- ✅ `#findReusableAgent` שורות 182-197 — אומת; matches לפי `acpSessionId + cwd` + status חי. ה-brief לא נוגע בקובץ (read-only reuse). אומת.
- ✅ `settings.setCliKind` (`settings.svelte.ts:127`) + `setLastCwd` (`:132`) — קיימים. אומת.
- ✅ `SessionCard.svelte` קיים, design tokens + Tailwind — דפוס ויזואלי לחיקוי. אומת.
- ✅ i18n keys — `keys.ts` בלוק `connect` (24+), קונבנציית תוספתיות (1-9). 9 המפתחות `connect.agents.*` net-new. `Catalog = Record<MessageKey,string>` יאכוף שלמות בשלושת הקבצים. אומת.
- ✅ `verbatimModuleSyntax: true` + `noUncheckedIndexedAccess: true` (`packages/frontend/tsconfig.json:5-6`) — ה-brief מצהיר נכון על `import type { AgentPublic }`. אומת.
- ✅ Svelte 5 reactivity — `{#each activeAgents.agents as a (a.id)}` עם key + `$state` array + refresh מציב array חדש. דפוס נכון.
- ✅ VM context זמין ב-`/` — `+page.svelte:14` כבר עושה `getI18n/getSession/getSettings/getModals` מ-root layout; ה-VM החדש ייקבע באותו root. אומת.

## Verdict

🟡 **USABLE-AFTER-FIX** — ה-brief טכנית-נכון מול ה-FE anchors ב-dev וה-shape עקבי
מול ה-backend brief. אבל **לא ניתן ל-dispatch כעת**: branch ה-base
(`slice-active-agents-backend`) לא קיים (finding 1, blocker לסדר-dispatch), ויש 2
תיקוני confusion סביבתיים/דיוק (env לינוקס, formatDate). תיקון ~15-25 דק' של מרדכי:
(1) ודאי שה-backend slice dispatched ויש branch / או עדכני base; (2) המירי נתיבי
env ל-Windows; (3) תקני את הפניית `toLocaleString` ב-SessionCard:20. אחרי זה — READY.
