# Slice integrate-dev-sync — סנכרון ה-features עם dev (provider-contract + msr-v2) לפני merge — ‏בריף

> **‏תאריך**: 2026-06-16
> **‏סוג מסמך**: ‏בריף **‏אינטגרציה** (‏לא feature slice — ‏סנכרון + התאמה)
> **‏סטטוס**: ‏plan-verified — ‏מוכן לביצוע (‏אחרי אישור)
> **‏אימות אביגיל**: ✅ **READY** (round 2, 2026-06-16). round 1 — 4 findings (כולם מרגיעים: createAcpClient תואם, base hash, turnState נפתר, doc-comment); round 2 — READY. ‏דוח: `reports/drive-coding/slice-integrate-dev-sync-avigail*.md`
> **Complexity**: 8/10 (verifier: **calev-heavy** — ‏refactor חוצה-שכבות, ‏אימות סמנטי + חי)
> **‏תלויות**: ‏כל ה-feature branches שבוצעו בסשן + dev tip
> **‏Base**: ‏branch `integration-active-agents` (‏ה-sandbox המשולב) + **merge `dev`** ‏לתוכו

---

## §0 — Pre-flight + Reconnaissance (‏בוצע 2026-06-16)

> **‏המטרה**: ‏dev התקדם **34 commits** (dev tip `161bd94`) ‏מאז ה-base של ה-features (e25912c), ‏כולל refactors
> ‏מהותיים שנוגעים באותם קבצים. ‏לפני merge של ה-features → dev, ‏מביאים את **dev → ה-features**
> ‏(sandbox), ‏פותרים conflicts + ‏מתאימים סמנטית, ‏מאמתים — ‏הכל בסביבה בטוחה. dev לא נגע.

### ‏ממצאי reconnaissance (‏אומתו)

1. **`cwd-fix` ‏כבר מוזג ל-dev** (4d58188). ‏מתוך ה-features שלנו — ‏זה כבר בפנים; ‏היתר לא.
2. **dev refactors מהותיים**:
   - **dc-int**: `core/src/acp/*` ‏(client, transport, describe-crash, provider-error...) ‏**‏נמחק כולו**;
     ‏ה-ACP layer עבר ל-`provider-contract/acp` (git-dep). `agent-session.svelte.ts:20`:
     `import { createAcpClient } from "provider-contract/acp"`.
   - **msr-v2**: refactor של `agent-session` — `turnState` ‏($state נפרד), ‏הסרת `thinking` ‏מ-`AgentSessionStatus`,
     ‏הפרדת status/turnState, cancelTurn, BubblePlayer, ModelStatus.
   - **ה-reconnect infra + `listAgents` ‏כבר ב-dev** (ws-reconnect-infra מוזג מזמן). ‏ה-features שלנו
     ‏(`attachToLiveAgent`) ‏נבנו **‏מעל snapshot ישן** ‏של אותו קובץ.
3. **trial-merge `dev` → integration** (dry-run, בוצע ובוטל): ‏**‏רק 2 conflicts**, ‏שניהם **union-trivial**:
   - `docs/walkthrough.md` — ‏שני entries.
   - `packages/frontend/src/lib/context.ts` — ‏אנחנו הוספנו `active-agents` context; dev הוסיף
     `model-status`+`bubble-player`. **‏פתרון: ‏לקחת את שני הבלוקים** (additive context — ‏לא סותר).
   - **`agent-session.svelte.ts` עבר auto-merge** (git שילב את `attachToLiveAgent` ‏עם ה-provider-contract refactor).
   - i18n catalogs, `ports.ts`, `+layout.svelte` — ‏auto-merged.

> ⚠️ **‏הסיכון האמיתי**: auto-merge הוא **‏טקסטואלי**, ‏לא סמנטי. ‏ה-`attachToLiveAgent`/`#warmReconnect`
> ‏עלולים להישבר מול ה-API החדש של `provider-contract/acp` (אם `createAcpClient`/`loadSession` שינו
> ‏חתימה) ‏או מול `turnState` (msr-v2). **‏typecheck + test + build הם ה-gate הסמנטי האמיתי**, ‏לא ה-merge.

### ‏סביבה: **Windows-native**

- BE: `bun src/server.ts` (4000). FE: `pnpm --filter @drive-coding/frontend-v2 dev`. ‏טסטים: `pnpm test` ‏מהשורש.
- ‏`provider-contract` ‏הוא **git-dep** — ‏אחרי merge ‏יש להריץ `pnpm install` (‏ה-dep נוסף ב-dc-int).
- ‏אימות חי דרך URL (tuns.sh) — ‏ה-tunnel + BE+FE כבר רצים.

### Reading list

- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` ‏ב-dev — `createAcpClient` מ-`provider-contract/acp` (20), `turnState` (77), `#warmReconnect`/`#coldReconnect`/`loadSession`/`#findReusableAgent`. **‏לוודא ש-`attachToLiveAgent` שלנו (auto-merged) תואם ל-API הזה.**
- `packages/frontend/src/lib/context.ts` — ‏ה-conflict (union: active-agents + model-status + bubble-player).
- `provider-contract/acp` — ‏ה-API החדש (`createAcpClient`, `AcpClient`, `loadSession`). ‏בדוק חתימות.
- `docs/decisions/voice-acp.md` — ‏היסטוריית כל ה-slices בסשן (active-agents, windows, reconnect, win-driveroot).

---

## §0.9 — ‏מצב הסשן לשרידות-דחיסה (CONTEXT — ‏קרא קודם אחרי דחיסה)

> ‏כל מה שצריך כדי להמשיך את הביצוע גם אחרי context compaction. **‏מבצע: ‏מרדכי בעצמו** (‏המשתמש אישר).

### ‏הנתיב לקובץ הזה
`d:\UserProjects\AI\drive-coding\dev\docs\plans\slice-integrate-dev-sync.md`. ‏יומן ההחלטות המלא:
`d:\UserProjects\AI\drive-coding\dev\docs\decisions\voice-acp.md` (‏entries 2026-06-13→16).

### dev
- tip: `161bd94`. **`cwd-fix` ‏כבר מוזג ל-dev** (4d58188) — ‏מתוך 6 ה-features, ‏רק הוא בפנים.

### worktrees (‏תחת `d:\UserProjects\AI\drive-coding\.worktrees\`)
- **`slice-active-agents-widget`** — ‏יושב על branch **`integration-active-agents`** = ה-**sandbox** ‏שמשלב את **כל** ה-features. ‏**‏זה ה-worktree לעבודת האינטגרציה.** ‏יש בו node_modules + hooks.
- `slice-windows-adaptation`, `slice-reconnect-warm-attach`, `slice-win-home-env-driveroot`, `fix-cwd-validate-windows`, `slice-active-agents-backend` — ‏ה-feature branches הנקיים (‏לא ממוזגים ל-dev).
- `dev`, `main` — worktrees ראשיים.

### `integration-active-agents` (ה-sandbox) ‏מכיל (‏על base e25912c, ‏טרם dev):
‏active-agents-backend (persistent/pin/reaper/pid+attached) + active-agents-widget (ActiveProcessesPanel: Pin/reconnect/kill) + cwd-fix + windows-adaptation (fs/browse, FolderPicker, opencode plugin string-config, listProjectDirs) + F1 (FolderPicker homeDir fallback) + reconnect-warm-attach (`attachToLiveAgent`) + win-home-env-driveroot (`getHomeDir`, `normalizeRealpath`).

### 6 ה-slices שבוצעו בסשן (‏כולם GO; ‏כולם ב-sandbox; ‏רק cwd-fix ב-dev):
1. **fix-cwd-validate-windows** — `validateCwd` ‏מקבל Windows drive/UNC. ✅ **merged→dev**.
2. **slice-active-agents-backend** — `persistent` field + `POST /api/agents/:id/persistent` + reaper-מחריג-נעוצים + `getRuntimeInfo` (pid/attached). calev GO 9/9.
3. **slice-active-agents-widget** — `ActiveAgents` VM + `ActiveProcessesPanel` + handleReconnect. calev GO 12/13.
4. **slice-windows-adaptation** — fs/browse cross-platform + FolderPicker Windows paths + opencode plugin tuple→string (`PROMPT_INJECTOR_TEXT` env) + listProjectDirs (`os.tmpdir()`) + F1. calev-heavy GO + F1 fix.
5. **slice-reconnect-warm-attach** — `attachToLiveAgent({agentId,sessionId,cwd,cliKind})` (warm-attach ל-bridge חי, עוטף `#warmReconnect`). calev GO.
6. **slice-win-home-env-driveroot** — `getHomeDir()` (env-first) + `normalizeRealpath()` (drive-root `"D:"`→`"D:\"`). calev GO.

### ‏סביבה חיה (‏אם נפלה — ‏העלה מחדש מ-`integration-active-agents` worktree):
- **BE** :**4001** — `cd .worktrees/slice-active-agents-widget/packages/backend ; PORT=4001 LOG_LEVEL=info bun src/server.ts` (background). ‏**‏אחרי merge dev: `pnpm install` קודם** (provider-contract git-dep). ⚠️ **פורט שונה ל-4001** כי 4000 נתקע בסוקט-zombie (handle שירש bridge-ילד מ-BE ישן שמת; orphan reparented — לא ניתן לשחרר בלי לסכן את claude.exe של התוסף). 4001 הוא דפוס "parallel worktree" מתועד.
- **FE** :5173 — `cd .worktrees/slice-active-agents-widget ; BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev` (background). **חובה `BE_PORT=4001`** — vite מנתב /api,/proxy,/ws ל-`BE_PORT` (ברירת מחדל 4000).
- **tunnel** — `https://your-app.nue.tuns.sh` (דטרמיניסטי). לולאת auto-restart: `while true; do ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -R drive-coding:80:localhost:5173 tuns.sh http; sleep 3; done` (background). ‏ה-DPI מנתק לסירוגין — ה-loop מתחבר מחדש.
- ‏הערות סביבה: onecli על Windows לא מריץ bun (BE ישיר); opencode+claude מותקנים+מחוברים; lint:i18n דרך Git-Bash (`bash ./scripts/lint-no-hebrew-in-code.sh`); `pnpm test` מהשורש (ל-backend/core אין test script); 3 pre-existing failures (lint-no-hebrew + bridge-manager flake) — לא ב-scope.

### ‏הצעד הבא (‏המשך מכאן אחרי דחיסה) — ‏PROGRESS:
‏ב-worktree `slice-active-agents-widget` (branch integration-active-agents):
- ✅ **Commit 0 DONE**: `git merge dev` ‏בוצע ו-committed (**`e83c35d`**). 2 conflicts נפתרו: `context.ts` (union — active-agents+model-status+bubble-player), `walkthrough.md` (גרסת dev). ‏אין markers.
- ✅ **`pnpm install` DONE** (exit 0, provider-contract git-dep נמשך).
- ✅ **Commit 1 DONE** (`22669a5`): שער האימות הסמנטי **ירוק**. `core build` נקי; `pnpm -r typecheck` = **0 שגיאות** (core+backend+frontend 4978 קבצים); `pnpm test` = **645 passed**, רק **3 pre-existing failures** (lint-no-hebrew SyntaxError + 2× bridge spawn timeout — מתועדים ב-§2 כלא-ב-scope); `frontend production build` נקי (49s). **אפס שבירות מה-auto-merge** — `attachToLiveAgent`/`#warmReconnect` תואמים ל-provider-contract+turnState ללא שינוי קוד. תוקן doc-comment `agent-session.svelte.ts:9`. אביגיל צדקה: הסיכון היה מנופח.
- ✅ **verifier-phase DONE**: `Task(calev)` = **GO, 0 findings** (11/11 שערים). דוח: `reports/drive-coding/slice-integrate-dev-sync-calev-commit1.md`. ה-auto-merge עבד סמנטית ללא שבירה.
- 🔄 **Commit 2 (בעבודה)**: הסביבה החיה שוחזרה עם הקוד הממוזג. **BE :4001** (health OK), **FE :5173** (200), **proxy /api→BE** OK, **tunnel** `https://your-app.nue.tuns.sh` (200). smoke-tests עברו: `/api/agents`→`{"agents":[]}` (active-agents), `/api/options`→models+homeDir (windows-adaptation). **נותר: בדיקה אינטראקטיבית של המשתמש דרך ה-URL** (reconnect חם, folder picker, drive-root D:\, נעילת agent). → ⬜ **Commit 3**: docs.

#### ✅ אימות cross-platform על **linux** (cli-agents = `llm-clis` @ 192.168.x.x, SSH alias `cli-agents`, user `user`)
ה-branch `integration-active-agents` רץ על linux ב-tmux session **`drive-int`** (windows: `be`/`fe`/`tunnel`). מאומת מקצה-לקצה:
- repo שם: `~/projects/drive-coding` (bare+worktrees כמו Windows). ה-branch הועבר דרך **git bundle** (לא push ל-origin). worktree: `~/projects/drive-coding/.worktrees/integration-active-agents` @ `22669a5`.
- הותקנו **bun 1.3.14** (`~/.bun/bin`) + **pnpm 11.7.0**. כלים: node v24, gemini, codex זמינים (`~/.vite-plus/bin`); **claude/opencode חסרים** שם → בדיקות עם gemini.
- `pnpm install` ✅ (provider-contract git-dep נמשך), `core build` ✅.
- פורטים: 4000/4001/8899 תפוסים ע"י BE-ים ישנים → **BE שלנו על :4010**, FE על :5173 עם `BE_PORT=4010`.
- **מאומת על linux**: health OK · `validateCwd` קיבל נתיב Unix `/home/user/...` ✅ (cwd-fix cross-platform) · `orchestrator.createAndSpawn` spawn-ed **gemini bridge אמיתי** (pid 125958, ppid=BE) ✅ · `getRuntimeInfo`→pid ✅ · `/api/agents` ✅ · **persistent/pin** (`POST .../persistent {persistent:true}`)→`{"ok":true}` ✅ · FE+proxy ✅.
- ⚠️ ה-agent נשאר `status=starting` כי handshake ה-ACP (initialize/session) קורה בצד-browser — לא תקלת linux. הזרימה האינטראקטיבית המלאה (prompt/reconnect widget) דורשת browser.
- **URL חיצוני (linux)**: `https://musicode-musicode-drive-linux.nue.tuns.sh` (tunnel מ-cli-agents, מפתח `~/.ssh/pico`, auto-restart loop ב-tmux window `tunnel`). יש agent gemini נעוץ מוכן לבדיקת reconnect.
- ניקוי בסיום: `tmux kill-session -t drive-int` על cli-agents (+ אופציונלי `git worktree remove`).
#### ✅ MERGE ל-dev + DEPLOY (2026-06-16, אישור מפורש של המשתמש)
- **§9 Q1 נפתר**: ההתאמה הייתה מינימלית (doc-comment אחד, 0 שבירות, calev GO 0 findings) → **batch מ-integration** (לא rebuild).
- **merge**: `integration-active-agents` → `dev` (--no-ff, `b2c2349`). dev היה ancestor → מיזוג נקי. 2 briefs untracked ב-dev (CRLF-only diff) הוסרו לפני המיזוג.
- **push**: `git push origin dev` — FF נקי `161bd94..b2c2349` ל-GitHub.
- **deploy ל-cli-agents**: עדכון worktree `dev` (pull FF 48426ad→b2c2349, אחרי `git checkout -- pnpm-lock.yaml`) → `systemctl --user restart voice-acp-dev.service`. ה-ExecStartPre בנה (`pnpm install --frozen-lockfile && pnpm build`, frontend 17.73s) → השירות **active** על :4001 (onecli gateway). health uptime טרי = קוד חדש; `/api/agents`→`{"agents":[]}` (פיצ'ר חי).
- **URL ציבורי (staging dev)**: `https://drive-coding-dev.example.com` — מאחורי **Cloudflare Access** (302→musicode1.cloudflareaccess.com, מתאמתים בדפדפן). local health OK = פריסה תקינה.
- ⬜ **ניקוי tmux test**: `tmux kill-session -t drive-int` על cli-agents (BE 4010 + FE 5173 + tunnel + gemini agent — מיותר עכשיו שהשירות הרשמי חי). לא בוצע — ייתכן שהמשתמש עוד בודק.
- (calev-heavy slice-verify לא הורץ בנפרד — האימות שבוצע מקיף: calev GO Commit 1 + e2e חי Windows+linux; המשתמש אישר merge על סמך זה.)

---

## §1 — ‏מטרה

‏אחרי הסלייס, ‏ה-sandbox (`integration-active-agents`) ‏מכיל את **dev העדכני + כל 5 ה-features**
‏(active-agents-backend/widget, windows-adaptation, reconnect-warm-attach, win-home-env-driveroot),
‏מותאמים סמנטית ל-provider-contract + msr-v2. ‏typecheck/test/build ‏ירוקים, ‏בדיקה חית עוברת.
‏זהו **‏בסיס יציב** ‏ממנו נחליט על מבנה ה-merge הסופי ל-dev (§9 Q1). **dev לא נגע בסלייס הזה.**

---

## §2 — Scope

| ‏פעולה | ‏כן/לא |
|------|------|
| merge `dev` → `integration-active-agents` (sandbox) | ✅ |
| ‏פתרון 2 conflicts (walkthrough union, context.ts union) | ✅ |
| ‏התאמה סמנטית: `attachToLiveAgent`/reconnect מול `provider-contract/acp` + `turnState` | ✅ |
| ‏typecheck + test + build ירוקים (‏ה-gate הסמנטי) | ✅ |
| ‏בדיקה חית: active-agents + reconnect + Windows + drive-root מול dev | ✅ |
| **merge ל-dev עצמו** | ❌ | §9 Q1 — ‏החלטה נפרדת אחרי שה-sandbox ירוק |
| ‏שינוי dev / ה-feature branches המקוריים | ❌ | ‏עובדים רק ב-sandbox |
| ‏תיקון 3 ה-pre-existing failures (lint-no-hebrew, bridge flake) | ❌ | ‏ידועים, ‏לא ב-scope |

---

## §3 — Architecture diagram

```
dev (161bd94, +34: dc-int provider-contract, msr-v2 turnState, cwd-fix)
  │ merge ↓
integration-active-agents (sandbox: backend+widget+windows+reconnect+win-driveroot)
  ├── conflict: walkthrough.md       → union
  ├── conflict: context.ts           → union (active-agents + model-status + bubble-player)
  ├── auto-merged: agent-session.ts  → ⚠️ אמת סמנטית (provider-contract API + turnState)
  └── pnpm install (provider-contract git-dep)
       → typecheck + test + build (gate סמנטי) → תקן שבירות
       → בדיקה חית (active-agents/reconnect/windows) מול dev
```

---

## §4 — שלבים ‏בסדר

### Commit 0 — merge dev + פתרון 2 conflicts (approach: integration)

1. ‏ב-`integration-active-agents` worktree: `git merge dev --no-ff`.
2. **walkthrough.md**: union (שמור את שני ה-entries).
3. **context.ts**: union — **שלושת** ה-context blocks (`active-agents` שלנו + `model-status` + `bubble-player` של dev). ‏הסר conflict markers, ‏שמור את כל ה-imports + exports.
4. `pnpm install` (provider-contract git-dep + שינויי deps מ-dev).
5. commit ה-merge.

**Verification**: `git status` נקי; ‏אין conflict markers (`grep -rn "<<<<<<<" packages/`).

---

### Commit 1 — אימות + התאמה סמנטית (approach: integration) ⚠️ verifier-phase

> ‏ה-auto-merge של `agent-session.svelte.ts` ‏טקסטואלי. ‏כאן מוודאים שהוא **‏עובד** ‏מול ה-API החדש.

> **‏אביגיל round 1**: ‏הסיכון המרכזי מנופח — `createAcpClient`/`loadSession` **‏חתימות תואמות**
> (‏ה-feature כבר ב-`await createAcpClient` + loadSession object-form); ‏ההבדל היחיד הוא **import path**,
> ‏וה-auto-merge כבר לקח את גרסת dev. `turnState`/`thinking` ‏נפתר נקי ב-auto-merge (0 `status===thinking` שורדים).
> **‏זו התאמה, ‏לא שכתוב.** ‏**‏+ תקן doc-comment**: `agent-session.svelte.ts:9` ‏עדיין אומר
> `@drive-coding/core/acp` → ‏עדכן ל-`provider-contract/acp`.

1. **typecheck**: `pnpm -r typecheck` (+ `pnpm --filter @drive-coding/core build` ‏קודם). ‏צפה לשגיאות
   ‏ב-`attachToLiveAgent`/reconnect אם `provider-contract/acp` ‏שינה חתימות (`createAcpClient`/`loadSession`/`AcpClient`).
2. **test**: `pnpm test` ‏מהשורש. ‏צפה לכשלים ב-`agent-session.reconnect.test` (turnState/status mismatch מ-msr-v2).
   ‏התעלם מ-3 pre-existing (lint-no-hebrew, bridge-manager flake).
3. **build**: `pnpm --filter @drive-coding/frontend-v2 build`.
4. **התאם** ‏כל שבירה: ‏עדכן `attachToLiveAgent`/reconnect מול ה-API החדש (provider-contract), ‏ו-`status`/`turnState`
   ‏מול msr-v2 (‏אם `setStatus`/`thinking` השתנו). ‏שמור את ה-DoD של ה-features (warm-attach עדיין מתחבר ל-bridge חי).

**Verification**: typecheck + test + build ירוקים (מלבד pre-existing).

> 🔬 **verifier-phase כאן** (calev) — ‏ה-commit הקריטי (semantic adaptation מול refactor).

---

### Commit 2 — בדיקה חית מקצה-לקצה (approach: manual)

‏BE+FE חי (restart מ-integration) + URL. ‏אמת מול dev העדכני:
- **active-agents**: ‏צור agent, ‏הווידג'ט מציג, Pin/Kill.
- **reconnect-warm-attach**: ‏צור agent + שיחה → `/` → "התחבר מחדש" → warm (אין spawn), ‏שיחה חוזרת.
- **Windows**: folder picker → drive-root (`D:\`) → בחר; opencode עולה ל-ready; homeDir מ-env.
- **regression מ-dev**: msr-v2 (turnState/cancelTurn/BubblePlayer), provider-contract (ACP flow) — ‏עדיין עובדים.

**Verification**: ‏screenshot + BE log (warm reconnect: אין createAgent).

---

### Commit 3 — Docs (approach: none)

- `docs/walkthrough.md` — ‏רשומת אינטגרציה. ‏עדכון `docs/decisions/voice-acp.md` (‏החלטת merge-strategy ל-dev — §9 Q1).

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | merge נקי, ‏אין conflict markers | `grep -rn "<<<<<<<\|>>>>>>>" packages/` ‏ריק |
| 2 | `pnpm install` עובר (provider-contract git-dep) | exit 0 |
| 3 | typecheck (3 packages) | `pnpm -r typecheck` |
| 4 | test | `pnpm test` — ‏0 ‏כשלים מלבד 3 pre-existing |
| 5 | build | `pnpm --filter @drive-coding/frontend-v2 build` |
| 6 | **reconnect warm חי** מול dev | URL: agent+שיחה → reconnect → warm (אין spawn), ‏שיחה חוזרת |
| 7 | active-agents + Windows חי | widget/Pin/Kill + folder picker drive-root + opencode ready |
| 8 | **regression dev** | msr-v2 (turnState/cancel/player) + provider-contract ACP — ‏עובדים |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **auto-merge טקסטואלי שבור סמנטית** | agent-session + provider-contract | typecheck+test+build = ה-gate (Commit 1). verifier-phase. |
| `createAcpClient`/`loadSession` ‏שינו חתימה ב-provider-contract | dc-int | ‏קרא את `provider-contract/acp` API; ‏התאם את `attachToLiveAgent`/reconnect. |
| `turnState`/`status` ‏שבר את ה-reconnect/widget | msr-v2 (הסרת thinking) | ‏בדוק `#setStatus` + status checks ב-`attachToLiveAgent`/handleReconnect מול ה-union החדש. |
| `provider-contract` git-dep לא נמשך על Windows | git-dep + pnpm | `pnpm install` אחרי merge; ‏אם נכשל — ‏בדוק git access ל-dep. escalation. |
| ה-sandbox מבולגן (6 merges + dev) → merge ל-dev מסובך | git history | §9 Q1 — ‏ייתכן rebuild branches נקיים מ-dev במקום batch מ-sandbox. ‏החלטה נפרדת. |
| ‏3 pre-existing failures מבלבלים | base | ‏מתועדים (lint-no-hebrew, bridge flake) — ‏אמת שלא נוספו חדשים. |

---

## §7 — Escalation triggers

- `provider-contract/acp` ‏שינה את ה-API כך ש-`attachToLiveAgent`/reconnect דורשים **‏שכתוב מהותי** (לא התאמה) → ‏עצור, ‏שקול אם reconnect-warm-attach צריך re-design מול ה-layer החדש.
- ‏ה-merge חושף **‏עוד** conflicts מעבר ל-2 (ה-trial היה dry; ‏מצב dev עשוי להתקדם) → ‏מפה מחדש.
- `provider-contract` git-dep לא נגיש/לא נבנה → ‏בעיית תשתית, ‏דווח.
- ‏msr-v2 turnState שבר התנהגות reconnect (‏השיחה לא חוזרת נכון) → ‏דווח, ‏ייתכן תיאום עם msr-v2.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| merge חוצה-33-commits עם refactors | +2 |
| ‏התאמה סמנטית מול provider-contract (acp layer הוחלף) | +2 |
| msr-v2 (agent-session refactor) | +1 |
| ‏regression surface רחב (כל ה-lifecycle + dev features) | +1 |
| ‏בדיקה חית מקצה-לקצה | +1 |
| ‏בסיס glue | +1 |

**Score**: 8 / 10 → **`calev-heavy`** (Opus) + verifier-phase על Commit 1 (semantic adaptation).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏מבנה merge ל-dev אחרי ש-sandbox ירוק: batch מ-integration, ‏או rebuild branches נקיים מ-dev? | ‏**‏להחליט אחרי Commit 2** — ‏תלוי בכמות ההתאמה. ‏אם קטנה → batch; ‏אם גדולה → rebuild נקי. | ❌ (‏לא חוסם את האינטגרציה) |
| 2 | ‏מבצע: אני (מרדכי) ‏או אליעזר? | ‏inference-heavy (semantic adaptation מול refactor) → ‏מרדכי, ‏או אליעזר עם הנחיה צמודה + escalation מהיר. | ❌ |
| 3 | ‏לתקן את 3 ה-pre-existing failures כחלק מזה? | ‏לא — ‏מחוץ ל-scope. ‏אמת רק שלא נוספו חדשים. | ❌ |

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י המבצע)

- ...
