# Slice — audio-mode-toggle — תוכנית

> **תאריך**: 2026-07-05
> **סטטוס**: ‏טיוטה
> **Complexity**: 3/10 (verifier: light — `calev`)
> **תלות**: depends_on: []. **base=dev**. ‏BE(core+backend) + ‏FE. ‏לוקאלי/spawn — ‏אין wire חדש.

מ-roadmap Track C ("audio cues"/settings) + ‏החלטת-המשתמשת (2026-07-05, ‏גישה א'). ‏היום פרומפט
"‏מצב-אודיו" (`AUDIO_FRIENDLY_PROMPT` — ‏כללי פלט קולי: ‏בלי markdown/emoji/URL) ‏מוזרק **‏תמיד**
ל-opencode, ‏בלי שליטת-משתמש. ‏ה-slice מוסיף **‏toggle** ‏שמאפשר להדליק/לכבות אותו. ‏**‏גישה א'**:
הערך נקרא בזמן spawn → ‏חל על **‏סשן חדש** (‏שינוי לא משפיע על סשן רץ; ‏אין live-mutation של
system-prompt — ‏אומת מול `sdk.d.ts@0.3.191` ‏שאין `setSystemPrompt`).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/audio-mode-toggle -b slice/audio-mode-toggle dev
cd .worktrees/audio-mode-toggle
pnpm install && pnpm hooks:install
```

### Run
‏- ‏BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts` (‏הזרקת opencode דורשת env — ‏OneCLI)
‏- ‏FE: `pnpm --filter @drive-coding/frontend dev`
‏- ‏Tests: `pnpm --filter @drive-coding/core test` · `pnpm --filter @drive-coding/backend test`
‏- ‏Gates: `pnpm typecheck && pnpm lint && pnpm lint:i18n`

### Browser
‏- ‏Chrome. ‏הבדיקה הקריטית: ‏להדליק/לכבות את ה-toggle ‏ב-Settings, ‏ליצור **‏סוכן opencode חדש**, ‏ולוודא דרך debug-write של הפלאגין (למטה) ‏שה-`output.system` ‏כולל/לא-כולל את טקסט-האודיו.

### Reading list
**‏must-read לפני**:
‏- `packages/backend/src/app/agent-orchestrator.ts` — ‏`drivecodingShapeEnv` (הגדרה ב-**:82**, ‏opencode-only, ‏מזריק `PROMPT_INJECTOR_TEXT` **:87**), ‏ואתר-הקריאה (**:160**, ‏`shapeEnv: drivecodingShapeEnv`). ‏גם `CreateAndSpawnInput` (:43-45). ‏⚠️ ‏`drivecodingShapeEnv` ‏**‏module-private ‏היום** (אין `export`) → ‏Commit 1 ‏חייב לייצא אותה כדי לבדוק אותה ב-unit test.
‏- `packages/backend/src/delivery/http-agents.ts` — ‏`CreateAgentInputFull` (:11-16) ‏ו-`createAndSpawn({...parsed})` (:71-75). ‏⚠️ ‏arktype `type()` ‏**‏משמיט בשקט** ‏מפתחות לא-מוצהרים → ‏אם `audioMode` ‏לא בסכמה, ‏הוא **‏נבלע בלי שגיאה** (‏לא 400) ‏ולא יגיע ל-orchestrator. ‏לכן הוספתו לסכמה = ‏חובה, ‏לא רק "‏למנוע חסימה".
‏- `packages/core/src/schemas/agent.ts:108` — ‏`CreateAgentInput` (‏מקור-הסכמה ש-`CreateAgentInputFull` ‏מרחיב, ‏וגם הטיפוס ש-FE `createAgent` ‏מקבל).
‏- `packages/backend/src/prompts/audio-friendly.ts` — ‏`AUDIO_FRIENDLY_PROMPT` (‏הטקסט; ‏לא נוגעים בו).
‏- `packages/backend/plugins/prompt-injector.ts` — ‏no-op כש-`PROMPT_INJECTOR_TEXT` ‏ריק/חסר (**:47**, `text.length > 0`); ‏debug-write דרך `PROMPT_INJECTOR_DEBUG_PATH` (:40-43) — ‏כלי-האימות.
‏- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — ‏⚠️ ‏**‏ה-call-site ‏האמיתי**: ‏`attach()` (:618) ‏קורא `createAgent({ cwd, cliKind })` ‏ב-**:629**. ‏ה-VM ‏כבר מחזיק `this.#settings` (:106, ‏מוזרק מ-`opts?.settings` :110) → ‏משם שולפים את `audioMode`. **‏לא** ‏מ-agents-api.ts.
**‏reference**:
‏- `packages/core/src/i18n/` — ‏⚠️ ‏**‏ה-i18n חי ב-core** (`keys.ts` + ‏`catalogs/he.ts` + ‏`catalogs/en.ts`), ‏**‏לא ב-FE**. ‏מפתחות ה-toggle נוספים כאן.
‏- `packages/frontend/src/lib/view-models/settings.svelte.ts` — ‏דפוס הגדרה מתמשכת (`showThoughts`/`enterToSend`).
‏- `packages/frontend/src/lib/adapters/agents-api.ts` — ‏⚠️ ‏מגדיר `CreateAgentInput` ‏**‏type ‏מקומי** (**:14**), ‏**‏לא מיובא מ-core** → ‏חייב להוסיף `audioMode?: boolean` ‏גם כאן, ‏אחרת excess-property-check ‏של TS ‏ישבור typecheck ‏ב-`attach():629`. ‏הפונקציה עצמה רק מסריאלת (`JSON.stringify(input)`) — ‏אין שינוי לוגי, ‏רק לטיפוס.
‏- `packages/frontend/src/lib/components/settings/SettingsScreen.svelte` — ‏מיקום ה-toggle.

## §1 — מטרה

אחרי ה-slice: ‏ב-Settings ‏יש toggle **"‏מצב אודיו"** (ברירת-מחדל: **‏דלוק** — ‏שימור ההתנהגות הקיימת).
כשדלוק — ‏סוכן **‏חדש** ‏מקבל את `AUDIO_FRIENDLY_PROMPT` (‏כמו היום). ‏כשכבוי — ‏הטקסט **‏לא** ‏מוזרק,
והמודל פולט פלט רגיל (markdown/URLs). ‏ההחלה על סשן חדש בלבד (‏גישה א').

## §2 — Scope: מה כן, מה לא

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏toggle FE ‏(‏הגדרה מתמשכת, ‏default on) | ✅ | ‏Commit 2 |
| ‏העברת `audioMode` ‏ב-POST /api/agents → ‏spawn | ✅ | ‏Commit 1-2 |
| ‏gating של הזרקת opencode ‏לפי `audioMode` | ✅ | ‏Commit 1 |
| ‏שדה `audioMode?` ‏בסכמות core+http | ✅ | ‏Commit 0-1 |
| ‏**‏הזרקת audio ל-claude** (`appendSystemPrompt`) | ❌ | ‏**‏לא קיימת היום** (`drivecodingShapeEnv` ‏רק opencode). ‏ה-toggle ‏no-op ‏ל-claude עד slice `claude-audio-delivery` ‏נפרד. ‏מתועד כ-known-limitation. |
| ‏live-toggle ‏אמצע-סשן | ❌ | ‏לא נתמך ב-SDK/ACP (‏אין `setSystemPrompt`) — ‏גישה א' ‏בכוונה |
| ‏toggle ‏פר-פרויקט/‏סנכרון | ❌ | ‏global setting; ‏per-cwd = ‏עתידי (`session-prefs`) |
| ‏הזרקת runtime-context ("‏תהליך X ‏פורט Y") | ❌ | ‏slice נפרד |

## §3 — Architecture diagram

```
core/src/schemas/agent.ts        ← Commit 0: CreateAgentInput + "audioMode?": "boolean"
core/src/i18n/{keys,catalogs/*}  ← Commit 2: מפתח settings.audioMode (+תיאור) בכל ה-catalogs
backend/src/delivery/http-agents ← Commit 1: CreateAgentInputFull + "audioMode?"; עובר ב-{...parsed}
backend/src/app/agent-orchestrator← Commit 1: export drivecodingShapeEnv(cliKind, env, audioMode)
                                     gate: מזריק PROMPT_INJECTOR_TEXT רק כש-audioMode!==false
                                     call-site(:160): shapeEnv:(ck,env)=>drivecodingShapeEnv(ck,env,input.audioMode??true)
frontend/view-models/settings     ← Commit 2: audioMode ($state, default true, persist localStorage)
frontend/view-models/agent-session← Commit 2: attach():629 → createAgent({...,audioMode:this.#settings?.audioMode??true})
frontend/adapters/agents-api.ts   ← Commit 2: + audioMode? ל-type CreateAgentInput המקומי (:14, לא מיובא מ-core)
frontend/components/settings/…    ← Commit 2: toggle UI (t(key))
```
‏אין שכבה חדשה. ‏שדה additive ‏שזורם FE→HTTP→orchestrator→shapeEnv. ‏ברירת-מחדל שומרת תאימות.

## §4 — Commits

### Commit 0 — שדה `audioMode` בסכמת core (approach: **TDD**)

**‏שינויים**: `packages/core/src/schemas/agent.ts` — ‏להוסיף ל-`CreateAgentInput` ‏את `"audioMode?": "boolean"`.

**‏Verification (TDD)**:
```bash
pnpm --filter @drive-coding/core test agent
# טסטים: CreateAgentInput פרסר עם audioMode:true · עם audioMode:false · בלי השדה (undefined תקין)
pnpm --filter @drive-coding/core typecheck
```
> ‏back-compat: ‏השדה אופציונלי → ‏קלטים קיימים (‏בלי audioMode) ‏עדיין תקפים.

### Commit 1 — gating ההזרקה ב-BE (approach: **TDD** — ‏פונקציה טהורה)

**‏שינויים**:
‏1. ‏`http-agents.ts:11` — ‏`CreateAgentInputFull` + ‏`"audioMode?": "boolean"`. ‏(‏`createAndSpawn({...parsed})` ‏כבר מעביר את השדה — ‏אין שינוי נוסף שם.)
‏2. ‏`agent-orchestrator.ts` — ‏**‏לייצא** ‏את `drivecodingShapeEnv` (`export function` — ‏היום module-private, ‏חובה ל-unit test); ‏חתימה חדשה `drivecodingShapeEnv(cliKind, baseEnv, audioMode: boolean = true)`; ‏ה-gate:
   ```ts
   if (cliKind === "opencode") {
     return {
       ...baseEnv,
       OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(baseEnv.OPENCODE_CONFIG_CONTENT),
       // audio off → לא מזריקים טקסט; הפלאגין no-op על env ריק (prompt-injector.ts:36-48)
       ...(audioMode ? { PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT } : {}),
     }
   }
   return baseEnv
   ```
‏3. ‏אתר-הקריאה (:160) — ‏`shapeEnv: (ck, env) => drivecodingShapeEnv(ck, env, input.audioMode ?? true)`.

**‏Verification (TDD)**:
```bash
pnpm --filter @drive-coding/backend test agent-orchestrator
# טסטים על drivecodingShapeEnv הטהורה:
#   opencode + audioMode=true      → env.PROMPT_INJECTOR_TEXT === AUDIO_FRIENDLY_PROMPT
#   opencode + audioMode=undefined → PROMPT_INJECTOR_TEXT מוגדר (default on)
#   opencode + audioMode=false     → PROMPT_INJECTOR_TEXT לא מוגדר; OPENCODE_CONFIG_CONTENT עדיין כן
#   claude   + audioMode כלשהו     → baseEnv ללא שינוי (no-op — known limitation)
pnpm --filter @drive-coding/backend typecheck
```

### Commit 2 — FE: toggle + wiring (approach: **manual** — ‏אינטגרציה)

**‏שינויים**:
‏1. ‏`settings.svelte.ts` — ‏`audioMode` ‏($state, ‏default `true`), ‏persist ל-localStorage ‏(‏מראה `showThoughts`).
‏2. ‏`agent-session.svelte.ts` — ‏ב-`attach()` (**:629**) ‏להזרים את ההגדרה:
   ```ts
   const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind, audioMode: this.#settings?.audioMode ?? true })
   ```
   ‏ה-VM ‏כבר מחזיק `this.#settings` (:106/:110) — ‏אין צימוד חדש.
‏2ב. ‏`agents-api.ts:14` — ‏להוסיף `audioMode?: boolean` ‏ל-`type CreateAgentInput` ‏**‏המקומי** (‏הוא **‏לא** ‏מיובא מ-core!) — ‏אחרת excess-property-check ‏שובר typecheck ‏ב-:629. ‏(‏גוף `createAgent` ‏עצמו ללא שינוי — ‏`JSON.stringify(input)`.)
‏3. ‏`SettingsScreen.svelte` — ‏toggle **"‏מצב אודיו"** ‏(‏עם תיאור-משנה קצר: "‏חל על סשן חדש").
**‏i18n**: ‏המפתחות חיים ב-**`packages/core/src/i18n`** ‏(‏לא ב-FE): ‏להוסיף `settings.audioMode` (+‏תיאור) ל-`keys.ts` ‏ולכל ה-catalogs (`catalogs/he.ts`, ‏`en.ts`, ‏וכו'). **‏אין מחרוזת גולמית בקוד** — ‏רק `t(key)`. ‏`pnpm lint:i18n`.

**‏Verification**:
```bash
pnpm typecheck && pnpm lint && pnpm lint:i18n
pnpm --filter @drive-coding/frontend build
# ידני (preview build, לא HMR): toggle כבוי → יוצרים סוכן opencode חדש עם
# PROMPT_INJECTOR_DEBUG_PATH מוגדר → קוראים את הקובץ → output.system בלי טקסט-האודיו.
# toggle דלוק → אותו זרימה → הטקסט נוכח.
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| ‏סכמות core+http ‏מקבלות `audioMode?` ‏(‏כולל undefined) | `pnpm --filter core test` · `pnpm --filter backend test` |
| ‏`drivecodingShapeEnv`: ‏on/undefined→מזריק, off→לא | ‏טסט-יחידה (Commit 1) |
| ‏typecheck + ‏lint + ‏lint:i18n ‏ירוקים | ‏הפקודות |
| ‏build עובר | `pnpm --filter @drive-coding/frontend build` |
| ‏toggle ‏מתמשך בין רענונים | ‏preview |
| ‏opencode + ‏audio **‏דלוק**: ‏`output.system` ‏כולל טקסט-האודיו | ‏preview + ‏`PROMPT_INJECTOR_DEBUG_PATH` |
| ‏opencode + ‏audio **‏כבוי**: ‏`output.system` ‏בלי טקסט-האודיו | ‏preview + ‏debug-path |
| ‏שינוי ה-toggle ‏לא משפיע על סשן רץ; ‏רק על סוכן חדש | ‏preview |
| ‏אין רגרסיה: ‏opencode ‏בברירת-מחדל עדיין audio-friendly | ‏preview (‏default on) |

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏משתמש בוחר claude ‏ומצפה שה-toggle ‏ישפיע | ‏scope | ‏known-limitation מתועד; ‏תיאור-המשנה בהגדרה יכול לרמז "‏(opencode כרגע)". ‏delivery ל-claude = ‏slice נפרד |
| `audioMode` ‏**‏נבלע בשקט** ‏אם הסכמה לא עודכנה (arktype `type()` ‏משמיט מפתח לא-מוצהר בלי שגיאה — ‏**‏לא** 400) → ‏toggle ‏"‏עובד" ‏ב-FE ‏אך חסר-השפעה, ‏באג שקט | ‏אביגיל | ‏Commit 0 (core) + ‏Commit 1 (http) ‏מוסיפים את השדה **‏לפני** ‏Commit 2; ‏טסט "undefined→מזריק / false→לא" ‏תופס אם הזרימה נשברה |
| ‏Hardcoded Hebrew ‏ב-toggle ‏יחסום pre-commit | learnings #1 | ‏דרך `t("settings.audioMode")`; ‏`lint:i18n` ‏ירוק |
| ‏שכחת default → ‏opencode ‏קיים מאבד audio | ‏regression | ‏`audioMode ?? true` ‏בכל שלב; ‏טסט "undefined→מזריק" |
| ‏OneCLI ‏חסר → ‏opencode ‏spawn נכשל | learnings #3 | ‏BE דרך `onecli run` (§0) |

## §7 — Escalation triggers
‏- ‏אם call-site ‏של `createAgent` ‏ב-FE ‏לא מחזיק גישה ל-`settings.audioMode` ‏(‏צימוד לא-צפוי) → ‏עצור ושאל מרדכי.
‏- ‏אם מתברר שצריך לגעת ב-claude ‏path ‏כדי ש-toggle ‏"‏יעבוד" → ‏עצור (‏זה slice נפרד; ‏ה-scope ‏כאן opencode-gating בלבד).
‏- ‏אם `drivecodingShapeEnv` ‏אינו ה-hook היחיד להזרקה (‏יש נתיב הזרקה נוסף) → ‏עצור.

## §8 — Complexity score
‏- ‏commits: 3 · ‏שכבות חדשות: 0 · ‏APIs חיצוניים: 0 · ‏streaming: לא · ‏state-model: לא · ‏protocol: לא (‏שדה additive)
‏- ‏**Score: 3/10 → verifier: light (`calev`)**.

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏שם המפתח/‏label | `audioMode` / "‏מצב אודיו" | ❌ |
| 2 | ‏מיקום ה-toggle ‏ב-Settings | ‏ליד הגדרות-קול/‏מיקרופון | ❌ |
| 3 | ‏להסתיר/‏להאפיר את ה-toggle ‏כשה-CLI=claude (‏no-op)? | ‏לא — ‏להשאיר גלוי + ‏תיאור-משנה; ‏פשוט יותר, ‏ו-claude delivery מגיע | ❌ |
| 4 | ‏audio off — ‏להשמיט `PROMPT_INJECTOR_TEXT` ‏או לשלוח ריק? | ‏להשמיט (‏הפלאגין no-op ‏על env חסר) | ❌ |
