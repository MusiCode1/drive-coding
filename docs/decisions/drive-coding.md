# Decisions — drive-coding

## 2026-06-28 — פיצול slice-cache-headers-version לדק (A+B+C) + D נפרד

### רציונל

ה-brief הישן `slice-cache-headers-version.md` גדל לנפח-יתר: A (Cache-Control headers) + B (הצגת
גרסה+SHA) + C (bump semver) + D (מיתוג: rename, FE_ENV, title, localStorage, publish). A+B קטנים
ובעלי-ערך מיידי (רענון-טלפון אמין + visibility ל-debug) אבל נתקעו כי D (מיתוג/publish) נגרר איתם
ודרש סבב אביגיל חוזר. פיצלתי ל-`slice-cache-version.md` הדק = A+B+C בלבד, שעבר אביגיל **READY ב-r2**
(0 findings; r1 = 3 קוסמטיים בלבד — אחד מה-briefs המדויקים שעברו כאן). depends_on=[] כי
slice-fe-build-decouple כבר מוזג (זרימת build מנותקת + dc-build-fe + alias fe:build זמינים).

### שינויי-כיוון

- **D מתפצל בעצמו**: D2+D3+D4 (כותרת בלי v2, איחוד `FE_ENV` ב-vite.config, מיגרציית localStorage-key)
  עצמאיים מהשם → slice מיתוג נפרד (depends_on=[]). D5+D-publish (metadata + guards ב-build.mjs)
  מצמדים לשם החבילה (`--filter @drive-coding/frontend`) ולסוכן-הפרסום → slice publish-prep שתלוי
  ב-`slice-frontend-rename-cutover` (הקנוני ל-rename). כך אין סבך-תלויות.
- **ממצא חי שהפיצול חשף**: `FE_ENV=dev` שכבר הוגדר ב-units (sync 21/06) **לא עושה כלום** — `vite.config.ts`
  עדיין קורא `FE_SOURCEMAP`, לא `FE_ENV`. D3(a) (איחוד ב-vite.config) הוא הפער שסוגר את זה.

### רעיונות שנדחו

- **לשגר את ה-brief הגדול כמו שהוא** — נדחה. הנפח החזיק את A+B (ערך מיידי) כבני-ערובה של D
  (מיתוג, פחות דחוף, מצמד-לפרסום). thin-slicing מחזיר את A+B למסלול מהיר.
- **§D1 (rename חבילה) בתוך D** — נדחה לטובת `slice-frontend-rename-cutover` כמקור-אמת יחיד (כפילות).

---

## 2026-06-28 — סדר slice-input-autogrow ↔ slice-image-paste: autogrow ראשון, brief מרוענן

### רציונל
שני ה-slices נוגעים ב-`TypeArea.svelte` (היחיד). `input-autogrow` היה בוצע+אומת (כלב GO 9/9);
`image-paste` הוא complexity-8, טרם התחיל, וחלקו (Commit 4) gated על track-A. ההכרעה:
**מזגנו את autogrow ראשון** (b3b5140) ולא הפכנו את הסדר — להחזיק slice מאומת כבן-ערובה
ל-slice שטרם התחיל זה אחורה.

### שינוי-כיוון (תלות שהתגלתה)
ה-brief המקורי של image-paste הצהיר `depends_on: [track-A]` בלבד — **לא הכיר ב-autogrow**.
זו הייתה תלות-קוד חבויה: autogrow שינה את אותו קובץ ש-image-paste "משכתב במלואו".
התיקון: הוספת `input-autogrow` ל-depends_on, רענון כל הפניות-השורה (TypeArea 67→79,
onkeydown L43-55→L55-67), §3.5 חדש (טבלת מה-autogrow-הוסיף + מה אסור לדרוס), והערת-layout
ל-tray (חייב לשבת **מחוץ** ל-`<form items-end>` כדי לא לשבור את גדילת-הגובה).

### ממצאי אביגיל
r3 USABLE-AFTER-FIX: הרענון מול autogrow היה **מדויק לחלוטין** (כל 9 הפניות TypeArea בול);
2 findings קלים בלבד — drift +6 בהפניות `sendPrompt` (559→565, 562→568, שריד מ-131-commit
sync, לא קשור ל-autogrow) ו-hash contract קוסמטי (4f3a→b745). תוקנו → r4 **READY**.

### מצב
Commits 0–3 (resize-plan TDD + image-attachment engine + TypeArea capture/tray/gating +
UserBubble render) **dispatch-ready**. Commit 4 (שליחה מולטימודלית) + merge **מוקפאים**
עד ש-track-A יחשוף `AcpClient.prompt(PromptContent[])` (היום text-only, client.d.ts:45).

### kill-switch (החלטת המשתמשת, 2026-06-28) — Commits 0–3 בטוחים ל-merge רדומים
במקום להסתמך על מה שהספק מדווח ב-`promptCapabilities.image` (שעלול להיות `true` בטעות בעוד
`AcpClient.prompt` text-only → כשל-שקט: משתמש שולח תמונה לחלל), הוספנו **דגל קשיח
`IMAGE_INPUT_ENABLED = false`** (module-const ב-`agent-session.svelte.ts`) שכופה
`supportsImageInput=false`. כל עוד false → כל הלכידה רדומה, אפס שינוי-התנהגות → **Commits 0–3
בטוחים ל-merge מיד** בלי בדיקת-runtime ובלי להחזיק branch שמתיישן. Commit 4 הופך ל-`true`
בשורה אחת יחד עם חיווט השליחה. אביגיל r5 הוסיפה: gating גם ברמת-handler (early-return
ב-paste/drop/picker), לא רק הסתרת אייקון. זה מהפך את "בצע ולא תמזג" מכורח לבחירה.

## 2026-06-28 — slice-restore-last-config: שחזור agent+mode מהסשן האחרון (מוזג)

### רציונל
הבקשה: "סשן חדש יטען את ה-agent וה-mode שהיו בסשן האחרון." בחרנו פתרון **FE-טהור,
per-cliKind**: mode/model/agent הם תכונות של ה-CLI, לא של התיקייה — לכן Settings (FE)
ולא ה-BE registry (שמחזיק per-cwd lastSessionId; לא מערבבים). מנגנון גנרי יחיד
`setLastConfig(cliKind, configId, value)` שמכסה **כל** ציר-קונפיג. apply נקרא אחרי
`status==="connected"` בשני נתיבי סשן-חדש (`attach` + `newSession`) — **לא** ב-resume
(loadSession/switchSession שומרים את ה-mode של הסשן הקיים).

זה **נפרד** מ-`session-prefs-per-cwd` (BE, multi-device sync) — בכוונה לא עשינו את זה כאן.

### החלטת-תכנון מרכזית
הזרקת `settings` ל-constructor של `AgentSession` (לא singleton import) — ה-VM הוא הבעלים
של persist+apply. `settings` אופציונלי → טסטים קיימים (`new AgentSession({ cues })`)
ממשיכים לעבור כ-no-op חינני.

### ממצאי אביגיל (r3, READY)
2 findings זניחים בלבד (מספר-שורה L163 vs L159, הערת-נתיב view-models/) — 0 מהותיים.
התפיסות החשובות היו בסבבים מוקדמים: (א) `applyConfigOption` עם 5 מסלולי-return → persist
חייב wrapper, לא "בסוף המתודה"; (ב) תזמון — apply חייב לרוץ אחרי `connected` אחרת no-op
שקט; (ג) כיסוי — `attach` (החיבור הראשון) הוא הנתיב השכיח, לא רק `newSession`.

### merge (2026-06-28)
INVASIVE-but-additive במכוון (אישור המשתמשת 27/06). מול 90 commits drift ב-dev: קונפליקט
additive יחיד בקוד (`settings.ttsProvider` של V4a לצד `lastConfig` — keep-both). build-gate
ירוק (typecheck 0, 354/354, i18n נקי), כלב GO (light, 6/6 DoD). merge `350e60d`.

### רעיונות שנדחו
per-cwd/BE/sync (= ה-roadmap-item הנפרד session-prefs-per-cwd) — נדחה לעכשיו.

## 2026-06-27 — slice-context-window-meter: מד טוקנים ביחס לחלון-הקשר

### רציונל

המשתמשת ביקשה להציג כמה מחלון-ההקשר של המודל בשימוש. ACP מספק את הנתון ישירות דרך
התראת `session/update` מסוג `usage_update` = `{ used, size, cost }` — בדיוק `used/size`.
ה-bridge ב-BE הוא passthrough גנרי (`bridge-manager.ts:165` `cb(line)` → `ws-agent.ts:88`,
ללא allowlist), כך שההתראה כבר מגיעה ל-FE; הפער היחיד הוא ש-`#onSessionUpdate` לא מטפל
בה והנתון נזרק. לכן הפיצ'ר הוא plumbing קצר (ענף early-return) + רכיב UI קטן — לא שינוי
פרוטוקול. בחרתי ב-`usage_update` ולא ב-`PromptResponse.usage` (פר-turn) כי הראשון נותן
used-מול-size ישירות, והשני נזרק היום ב-acp-provider וממילא מצטבר-פר-turn.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). 🔴 הבולט: ה-pseudo-code מיקם את ענף ה-usage_update
בשרשרת ה-else-if **אחרי** ה-guard `if (!text) return` (L1191) — ושם הוא לעולם לא יורה,
כי usage_update לא נושא `content.text` (silent bug שהיה עולה לאליעזר 20-40 דק' debug).
תוקן ל-early-return לפני ה-guard. עוד: שם-המתודה האמיתי `#onSessionUpdate` (לא
`#applyUpdate`), ו-`cost` הוא `Cost={amount,currency}` ולא מספר (→ `u.cost?.amount`).
r2 = שלושת אלה אומתו כמתוקנים; נותרו 2 🟢 קוסמטיים בלבד שתוקנו ידנית. 0 ממצאים פתוחים.

### שינויי-כיוון

- **Commit 0 = spike fail-fast**: הסיכון אינו טכני אלא ריצתי — לא אומת סטטית שה-CLI
  (opencode/claude) בכלל *פולט* `usage_update`. במקום לבנות UI על הנחה, השלב הראשון לוכד
  turn אמיתי ומאשר פליטה; אם אף CLI לא פולט — עצירה והחלטה ארכיטקטונית מחדש.

### רעיונות שנדחו

- **`PromptResponse.usage` פר-turn** כמקור — נדחה לטובת `usage_update` (used/size ישיר).
  נשמר כתוכנית-מגירה אם ה-spike יגלה שאין `usage_update`.

---

## 2026-06-27 — slice-release-publish (בוצע ישיר): תיקון `bin` ל-npm publish
אימות חי של החבילה (npm publish --dry-run, npm 11.11) חשף ש-`bin: "./dist/drive-coding.js"` עם
`./` prefix **נדחה בפרסום** (`invalid and removed`) → ה-CLI `drive-coding` לא היה עולה אחרי install.
תוקן ל-`"dist/drive-coding.js"` (אומת ע"י `npm pkg fix`). נוסף `publishConfig: {access:"public"}` +
metadata (keywords/repository/homepage/bugs). ה-bundle נבנה ורץ על Windows (אימות ראשון על Windows —
GET / + /api/agents + _app asset = 200). branch `slice/release-publish` @ `b349d63`. **slice קטן
מדי ל-executor/verifier — בוצע ישירות ע"י מרדכי**; `npm publish` עצמו = צעד אנושי.

## 2026-06-27 — slice-binary-core: בינארי `--compile` עולה ומגיש מקומית
### רציונל
ה-slice המרכזי בשרשרת הבינארי — מטמיע FE+BE ב-executable יחיד (`bun build --compile`) שרץ בלי Bun
מותקן. מבוסס על 5 ספייקים מאומתים (FE embed דרך `import…with{type:"file"}`; `--asset-naming="[dir]…"`
משמר נתיב; `__IS_BINARY__` דרך `--define` עובד cross-module; pino-pretty stream ישיר in-process;
`.ts` מוטמע כ-asset כמו `.js`). base=`slice/state-dir` (משתמש ב-`getStateDir()` לחילוץ ה-plugin).
### ממצאי אביגיל
r1 USABLE-AFTER-FIX (5) → r2 READY (0). findings: SPA-fallback typecheck (`noUncheckedIndexedAccess`),
stub annotation `Record<string,string>`, plugin extraction → `ensureStateSubdir("plugins")`, dev-tip
התיישן `0e23b0f`→`88d447b`, `.ts` embedding לא-מאומת (נסגר בספייק 27/06).
### שינויי-כיוון
ה-gate הוא **build-constant** (`--define`), לא env var ולא `Bun.isStandaloneExecutable` (שמחזיר
`undefined` ב-1.3.12). plugin extraction דרך `ensureStateSubdir` (mkdir מובטח).
### רעיונות שנדחו
- serve-from-memory דרך `Bun.embeddedFiles` loop: לא ישים (מסנן `.js`, `name` משוטח) → codegen manifest.
- `bun-plugin-pino` / תיקון ה-worker: מיותר — pino-pretty stream ישיר פשוט יותר ומבטל את ה-worker.
- extract-to-temp ל-FE: נדחה — embedded + `Bun.file()` serve-from-memory, אפס חילוץ.

## 2026-06-27 — slice-state-dir: תיקיית state מאוחדת `~/.config/drive-coding/`

### רציונל
Foundation לסלייס הבינארי (`docs/plans/slice-single-binary-prebrief.md`). היום נתיבי ה-state
(recordings/cache/wire-recordings/proxy) נוצרים `path.resolve("data/...")` יחסית ל-cwd → בינארי/bunx
שרצים מ-cwd אקראי מזהמים אותו. ה-slice מאחד ל-`~/.config/drive-coding/` (מרחיב את `cli-specs.jsonc`
שכבר שם), דרך helper יחיד `getStateDir()`. הוכרע 27/06 שלא נדרש migration — אין recordings חיים,
cache ייבנה מחדש → ה-slice פשוט (complexity 4, calev light). ראשון בשרשרת state-dir→binary-core→binary-dist.

### ממצאי אביגיל
r1 USABLE-AFTER-FIX (3 findings) → r2 READY (0). 6 spot-checks עברו מילה-במילה (`getHomeDir`
http-options:75-77, 4 נתיבי `data/` ב-server.ts:80/84/85/104, חתימות store/registry, אין circular
import). findings: (1) imports יתומים (`homedir`/`join`) אחרי swap; (2) הנתיב **כן** משתנה
`os.homedir`→`getHomeDir` (DoD#6 טען בטעות "לא השתנה") → טסט `cli-config-file:33-38` צריך עדכון;
(3) הנחה שגויה שטסטי recordings/projects מניחים `data/`-cwd (הם מזריקים `tmpdir()`).

### שינויי-כיוון
DoD#6 תוקן: ההתנהגות משתנה (env `HOME`/`USERPROFILE` > `os.homedir`) — הטסט שמשווה ל-`os.homedir`
ישירות יישבר במכונה שבה `HOME≠os.homedir` (git-bash/onecli); עודכן ל-`getStateDir()` או mock env.

### רעיונות שנדחו
- **extract-to-temp** ל-state: נדחה לטובת dir קבוע (יציב, נגיש למשתמש, חילוץ plugin חד-פעמי).
- **OS-native (env-paths)**: נדחה לטובת `~/.config/drive-coding/` אחיד פר-OS — פשטות > OS-purity.
- **migration אוטומטי**: לא נדרש (אין data חי).

## 2026-06-27 — content-viewer: viewer fullscreen גנרי (MVP: Markdown + תמונה, FE-טהור)

> brief: `docs/plans/slice-content-viewer.md`. אביגיל **READY** (r2/0-findings; r1 היו 3
> path/line findings, אין blocker). דוח: `reports/drive-coding/content-viewer-avigail.md`.
> Complexity 4/10 → verifier light. base=dev, `depends_on: []`.

### רציונל

המשתמשת ביקשה viewer להצגת **בריפים מוכנים** בנוחות. בריף מגיע מהסוכן כ-message markdown
ארוך → בבועת-צ'אט הוא צפוף. ה-viewer פותח אותו fullscreen (bits-ui Dialog, בחיקוי מדויק
של `FolderPickerDialog`). משתמש מחדש ב-`renderMarkdown` הקיים (DOMPurify two-pass + KaTeX) —
אפס שכפול-sanitize. משמש מיד גם כ-lightbox לתמונות-הכלים.

ההכרעה המכריעה — **מקור התוכן קובע את הסקופ**: בדיקת ה-bubble model הראתה שלמרות ש-roadmap
מנה "Markdown + תמונה + PDF" יחד, רק markdown (כ-`Segment.text`) ותמונה (כ-`ToolContentImage.data`
base64) מגיעים **inline ב-ACP stream** וכבר נמצאים ב-FE. PDF ו-`file://` מהדיסק נופלים
ל-`ToolContentOther` ודורשים BE proxy עם הכרעת-אבטחה כבדה (LFI/path-traversal). לכן ה-MVP
**FE-טהור** (`depends_on: []`) ו-PDF נדחה לגל שני gated על `local-file-proxy`. זה מנתק את
הפיצ'ר מכל תלות-תשתית — אפשר לשגר מיד.

### ממצאי אביגיל

r1: 3 findings, כולן path/line (אין blocker, אין regression). (1) `ToolContent` union ב-
`lib/types/bubble.ts` ולא ב-`chat/bubbles/`; (2) `joinSegmentText` ב-`chat/bubbles/bubble-rendering.ts`
ולא ב-util/; (3) cosmetic — נימוק double-mount. תוקנו, r2 נקי. אביגיל אישרה במפורש את שלוש
ה-concerns: (א) expand ידני מספיק ל-use case הבריפים, (ב) אין double-overlay (connect ו-chat
מסכים בלעדיים — +page לא עטוף ב-AppShell), (ג) `viewer.open` getter-מעל-`$state` ריאקטיבי כ-prop
ל-bits-ui `open` (תקדים `uiShell.sheetOpen`).

### רעיונות שנדחו

- **agent-triggered auto-open** (הסוכן פותח את ה-viewer מיוזמתו לדחוף brief לאישור) — נדחה
  ל-MVP: דורש הרחבת חוזה ACP (content-type/tool ייעודי), וצריך קודם spike של מה claude/opencode
  שולחים על ה-wire. ה-default = expand ידני, שמספק את ה-use case במלואו. (§9.1 בבריף, לא חוסם)
- **הרחבת `ModalsVM`** במקום VM נפרד — נדחה: content-viewer נושא payload לא-טריוויאלי
  (discriminated union markdown|image) + שמירה על תוספתיות (אפס נגיעה ב-modals.svelte.ts).

## 2026-06-27 — מסך-פתיחה: החלפת בורר-הסשן ברשימת תיקיות-אחרונות + 2 תיקוני folder-picker

> שני briefs (שרשרת סדרתית): `slice-folder-picker-fixes` → `slice-connect-recent-projects`.
> שניהם אומתו ע"י אביגיל ל-**READY** (folder-picker-fixes r3/0-findings; connect-recent-projects
> r2/3-cosmetic). דוחות: `reports/drive-coding/slice-*-avigail.md` (ריפו השיטה).

### רציונל

המשתמשת ביקשה להסיר את בורר-הסשן ממסך הפתיחה. המנגנון הנוכחי (`SessionPicker` + `listSessionsForCwd`)
**מריץ תהליך-סוכן חד-פעמי** (spawn → ACP handshake → listSessions → delete, ~300-700ms) רק כדי
להציג רשימת סשנים *לפני* שמתחברים. זה יקר ומיותר: בחירת סשן כבר אפשרית **בתוך** הסשן הפעיל
(`SessionOptionsPanel` → `switchSession`/`newSession`, warm ACP call ~20-50ms על אותו חיבור). אז
מסך-הפתיחה צריך רק *לחבר לתיקייה*, והבחירה העדינה קורית בפנים.

במקום הבורר — **רשימת תיקיות אחרונות**. הגילוי המכריע בתכנון: התשתית **כבר קיימת במלואה ב-BE** —
`ProjectsRegistry` (`projects-registry.json`) שמתעד כל `cwd` ב-`session-attached`, ו-endpoint
`GET /api/projects` שמחזיר אותן ממוינות lastSeen — **רק שאף אחד ב-FE לא צורך אותן**. כלומר הפיצ'ר
הוא FE-only (adapter + VM + panel בחיקוי מדויק של דפוס `ActiveAgents` הקיים) + הסרה. אין צורך
ב-endpoint חדש או שינוי BE.

שני תיקוני ה-folder-picker שורבבו כ-slice נפרד (ראשון בשרשרת) כי הם low-risk ועצמאיים-לוגית, אבל
**שניהם נוגעים ב-`+page.svelte`** — לכן שרשרת סדרתית (slice 1 ממוזג ל-dev, slice 2 נגזר מ-dev
המעודכן) במקום שני dev-based מקבילים שיתנגשו ב-merge.

**שורשי הבאגים (מאומתים בקוד, לא משוערים):**
- *folder-picker לא נפתח בנתיב שהוזן*: `FolderPickerDialog.openAtStart` קורא נקודת-פתיחה מ-`currentPath`/
  `settings.lastCwd` בלבד — **לא** רואה את ערך-הקלט החי (`cwd` ב-`+page.svelte`). תיקון: prop `startPath`.
- *תיקיות מוסתרות לא מוסתרות*: הפילטר ב-`http-history.ts:179` הוא **prefix-match מול 5 קידומות בלבד**
  (`.git`/`.opencode`/`.svelte-kit`/`node_modules`/`.pnpm`). כל dot-folder אחר (`.config`/`.cache`/
  `.ssh`/`.vscode`...) עובר ומוצג. תיקון: "מוסתר" = `startsWith(".")` || שם-רעש (`node_modules`).

### ממצאי אביגיל

- **folder-picker-fixes** (3 סבבים): r1 — mount כפול של `FolderPickerDialog` (גם `AppShell.svelte:345`,
  chat/settings) שלא הוזכר → הובהר כמחוץ-לסקופ. r2 — **blocker אמיתי**: `pnpm --filter
  @drive-coding/backend test` הוא **no-op** (אין script `test` ב-package; ה-runner היחיד הוא root
  vitest) → תוקן ל-`pnpm vitest run packages/backend` (אומת חי: 16 טסטים עוברים). r3 — READY/0.
- **connect-recent-projects** (2 סבבים): r1 — 2 blockers בשכבת-התלות: ה-base `slice/folder-picker-fixes`
  לא קיים/לא-מוזג, וההנחה `startPath={cwd}` לא מתקיימת ב-dev הנוכחי. r2 — READY אחרי מסגור-מחדש
  כשרשרת-סדרתית עם **Gate** מפורש + Pre-flight `grep startPath`. אומת ש-`beUrl` הוא ה-helper הנכון,
  ושמחיקת כל `sessions.ts` הייתה שוברת build (`SessionInfo`/`normalizeSessionInfo` בשימוש חי).

### שינויי-כיוון

- **לא מוחקים את `sessions.ts`** — רק את `listSessionsForCwd`. הקובץ מייצא גם `SessionInfo` +
  `normalizeSessionInfo` בשימוש ב-`agent-session.svelte.ts` (in-session listing) וב-`SessionCard`.
- **שרשרת סדרתית במקום שני slices מקבילים** — שניהם נוגעים ב-`+page.svelte` → merge מקביל = קונפליקט.
- **build-gate (`vite build`) ב-DoD של slice 2** — לא בגלל ה-adapter החדש (fetch בלבד, בטוח), אלא
  כשער-כללי; ה-acp barrel כבר ב-bundle ממילא (`agent-session.svelte.ts:20`).

### Windows hidden — נקודת-הרחבה מוכנה, מימוש בנפרד (עדכון 2026-06-27, בקשת המשתמשת)

המשתמשת שאלה אם "מוסתר" יכול לקרוא מה-OS כדי לכלול גם תיקיות מוסתרות-ב-Windows. הבחנה: ב-Windows
"מוסתר" = תכונת-קובץ (`FILE_ATTRIBUTE_HIDDEN`), **לא** נקודה — הכלל `startsWith(".")` יפספס תיקיות
כמו `AppData`. אבל **Node לא חושף את התכונה הזו** ב-`readdir`/`stat`; קריאתה דורשת מודול native
(`winattr`/`fswin`) או shell-out ל-`attrib`, **per-entry** (IO על כל פתיחת תיקייה → רגרסיית-latency
בבורר אינטראקטיבי).

**הכרעה**: לא לאגד עם תיקון-הבאג (שמשנה את פרופיל-הסיכון מ-trivial ל-native-dep/IO). במקום —
`isHiddenEntry` נכתב כ-**async שמקבל `(dirent, fullPath)`**, נקודת-ההרחבה היחידה שאליה ה-Windows-
detection ייכנס בעתיד בלי לגעת בלולאת-הסינון. המימוש בפועל = `slice-windows-hidden-attr` נפרד
(יכריע native vs `attrib`). עלות-עכשיו: מעט קוד async ללא-IO; תועלת: ה-Windows-slice = שינוי נקודתי
בתוך פונקציה אחת.

### רעיונות שנדחו

- **מימוש Windows-hidden כחלק מתיקון-הבאג** — נדחה (ראה למעלה): native-dep / IO per-entry ⊥ פרופיל
  של תיקון-trivial. רק נקודת-ההרחבה הוכנה.
- **טעינת `lastSessionId` של תיקייה-אחרונה בלחיצה** — נדחה ל-MVP. לחיצה = חיבור (סשן חדש); בחירת
  סשן ספציפי נעשית מתוך הסשן (בדיוק העיקרון שהמשתמשת ביקשה). אפשר להוסיף בעתיד.
- **סינון חופפים מול `ActiveProcessesPanel`** — נדחה. תיקייה עם agent חי תופיע בשניהם, אבל הסמנטיקה
  שונה: "תהליכים פעילים" = reconnect warm (שומר state); "תיקיות אחרונות" = spawn חדש. לא באג.
- **endpoint BE חדש** — מיותר; `GET /api/projects` כבר קיים ומאוכלס.

---

## 2026-06-27 — היפוך-כיוון: ACP כמשטח קנוני + ספק-כגשר + reabsorption (מחליף את החוזה הקנוני)

### רציונל

החלטה ארכיטקטונית מכוננת שמהפכת את כיוון שכבת-הספק. עד כה הכיוון (ננעל 2026-06-08..17)
היה **חוזה קנוני מומצא** (`provider-abstraction/docs/design/canonical-contract-proposal.md`
LOCKED v1.2): consumer מדבר `ProviderSession` מנורמל, drive-coding = צרכן-בלבד דרך git-dep על
repo פרטי `provider-abstraction`. הכיוון הזה ייצר כאב מתמשך (git-dep על repo פרטי → 404 ל-bun;
`pnpm update -r` מוחק `#main`; ה-acp barrel שבר את ה-vite build) **בתמורה לתועלת שלא מומשה** —
ה-cutover ל-ProviderSession (P1d) מעולם לא הושלם (חסום).

ההיפוך (התקבל ע"י המשתמש 2026-06-26, פורמלי 2026-06-27): **ACP הוא ה-API הקנוני.** אין סיבה
לכתוב מודל מנורמל מקביל כש-`@agentclientprotocol/sdk` מכסה את רוב המשטח. צורכים את הספרייה
הרשמית כספרייה (לא כפקודות), ומרחיבים את מה שאינו מכוסה דרך 3 שכבות ההרחבה
(`provider-abstraction/docs/design/acp-extension-mechanisms.md`: `_meta` / `ext` / `unstable_`).
נשארים עם פרוביידור אחד שמתקנן את כל ה-CLIs ומייצא משטח אחיד — רק שהמשטח הוא ACP-רשמי+הרחבות,
לא חוזה מומצא.

### ההחלטה — 8 עוגנים

1. **ACP = המשטח הקנוני** (`ClientSideConnection`), לא `ProviderSession` מומצא.
2. **מתאם אחד, כמה CLIs, משטח אחד** — opencode/gemini/codex/claude-acp, כולם ACP-over-stdio.
3. **ייחוד-פר-ספק = הרחבות** (`_meta`/`ext`/`unstable_`), בלי לזהם את הליבה.
4. **החוזה הקנוני יורד לרציף** — `canonical-contract-proposal.md` → superseded; שני ה-P1d מתבטלים.
5. **Reabsorption** — הפרוסה הנצרכת (`provider-contract/acp`: client+transport+describe-crash, בלי
   `contract/`) חוזרת ל-`packages/core` כמודול מקומי; git-dep נמחק; הריפו `provider-abstraction`
   נשאר כארכיב-ידע, נוציא שוב כשבשל לשימוש חוצה-פרויקטים.
6. **מודול-הספק מחזיק את כל מחסנית ה-CLI** — spawn (`bridge-manager`) + מפרטים (`cli-config`) +
   פרוטוקול (ACP client) + טרנספורט — "הספרייה = גשר" (`roadmap.md` Future,
   `backend-managed-http-transport.md`).
7. **session-owner עובר ל-BE** (HTTP/SSE ללקוח) — פותר את ה-stall (Track F: ה-FE כקליינט
   → `request_permission` ללא מענה אחרי ניתוק) ומייתר את כל warm-attach/reconnect.
8. **שער-אימות אמפירי פר-CLI לפני התחייבות** — להריץ בפועל מול claude/codex/gemini/opencode
   (+antigravity desk-check) ולוודא שכל פיצ'ר ניתן-לביטוי על ACP+הרחבה, לא להסיק מהמסמכים.

### מה מוחלף (superseded)

- `canonical-contract-proposal.md` (LOCKED v1.2) — מודל ProviderSession מומצא.
- `provider-contract-framework.md` + `session-control-redesign/02-prescription.md` (17/06) —
  מסגור "provider-contract בעלים, drive-coding צרכן git-dep".
- `slice-P1d-provider-session-cutover.md` (🔴 NEEDS-REWORK) + `slice-P1d-frontend-cutover.md` (DRAFT) —
  אין יעד-cutover; ACP הוא היעד.
- `provider-abstraction-roadmap.md` — כבר SUPERSEDED (17/06), נשאר היסטורי.

### רעיונות שנדחו / מאוזנים

- **התפיסה ש-reabsorption = "5 קבצים וגמרנו"** — נדחתה. ה*חזון* המלא (עוגנים 6+7) הוא שינוי-טופולוגיה
  (FE-client → BE-session-owner), גדול בהרבה מ-5 קבצים → roadmap קצר (V→R→B), לא slice בודד שמסיים הכול.
  הגישה ההדרגתית ("שלב ראשון רק לאשר בקשות, התשתית כבר שם") היא הדרך.
  **‏הבהרה (נדחתה התפיסה, לא הצעד):** מהלך ה-5-קבצים עצמו **כן מבוצע** — כצעד הראשון של גל R
  (`slice-R1-inline-acp-slice`): interim פרגמטי שמסיר את כאב ה-git-dep **מיד**, מנותק מעוגנים 6+7.
  R1 הוא הצעד הראשון של הדרך ההדרגתית, לא סתירה לה.
- **לדלג על שער-האימות (עוגן 8)** — נדחה. הדירוגים 🟡/🟠/🔴 ב-`acp-extension-mechanisms.md` הם
  הסקה מתיעוד, לא הרצה. 🔴 אמיתי (antigravity ללא ACP, custom-agent בזמן-ריצה) יכול לשנות את התכנון —
  לכן האימות קודם לכל קוד.

### תוצרים

- roadmap: `docs/plans/acp-bridge-roadmap.md` (V → R → B).
- brief ראשון: `docs/plans/slice-V1-acp-feature-probe.md` (שער-האימות).

## 2026-06-25 — slice-frontend-rename-cutover: `@drive-coding/frontend-v2` → `@drive-coding/frontend`

### רציונל
סגירת ה-cutover ההיסטורי frontend-v2→frontend. הדירקטוריה כבר `packages/frontend/` (שונתה
2026-05 עם מחיקת ה-legacy); נשאר רק **שם החבילה** ב-`package.json` שעדיין `-v2`. החקירה
הראתה שהמשטח הפונקציונלי **זעיר**: 3 קבצי-קוד (package.json name + `--filter` ב-build.mjs
וב-dc-launch.mjs) + 2 הערות. 92 מתוך 97 ההפניות הן docs היסטוריים.

### ממצאי אביגיל
3 סבבים עד READY. הליבה הפונקציונלית אומתה מילה-במילה כבר ב-r1 (כולל: pnpm-lock ממופתח
לפי **נתיב** לא שם → rename לא נוגע ב-lockfile; build paths דירקטוריוניים; אין CI/turbo/nx;
אף package אחר לא תלוי בשם). כל ה-findings (r1×4, r2×1) היו בשכבת ה-docs-sweep: exclude-pattern
שדולף ל-`docs/reports/`, קבצי-גבול לא-מסווגים (redesign-chain-dispatch, walkthrough, voice-acp,
.html mockup), ו-24 merged briefs ב-`docs/plans/*.md` שנספרו ב-grep גלובלי.

### שינויי-כיוון
- **rename גורף → גורף-מתוחם**: לא `sed -i` עיוור. Commit 1 = 4 קבצי-קוד נקובים; Commit 2 =
  רשימת 11 docs-חיים מפורשת. ה-DoD בודק את הרשימה המתוחמת (`git grep` על 11 קבצים), לא
  "grep גלובלי ריק" — כי זה מתנגש עם ה-briefs ההיסטוריים.
- **brief = ארטיפקט היסטורי כשמוזג**: ~24 merged briefs ב-`docs/plans/*.md` מזכירים `-v2`
  ונשארים (כמו reports/archives). ד-dispatch עתידי מקבל את השם הנכון מ-prompt של מרדכי, אז
  stale `--filter` ב-brief לא-מורץ אינו סיכון.

### רעיונות שנדחו
- **`sed -i` גורף על כל הריפו** (כולל archives/reports/merged-briefs): נדחה — שכתוב רשומה
  היסטורית מטעה ("אז זה היה frontend-v2") + diff ענק. אם תתבקש בכל זאת — Commit 3 טריוויאלי.
- **שכתוב `docs/decisions/voice-acp.md` הישן**: נדחה — ה-rename נכנס כ-entry חדש (זה), לא
  בעריכת entries מתוארכים ישנים.

## 2026-06-25 — slice-input-autogrow: textarea שגדל עם הטקסט עד תקרה

### רציונל
ה-composer (`TypeArea.svelte`) היה `rows={2}` קבוע עם scroll פנימי — בהכתבה קולית/נייד
רב-שורתית לא רואים את כל מה שנכתב. הסלייס הופך אותו ל-auto-grow: גדל שורה-שורה עד תקרה
(`MAX_ROWS=6`) ואז scroll. מימוש מינימלי: `bind:this` + `$effect` תלוי-`promptText`
(לא `oninput` — כי מחיקה פרוגרמטית אחרי שליחה לא פולטת `input` event), + `max-height`/
`overflow-y:auto` ב-inline style. commit אחד, קובץ אחד, `depends_on: []`. Complexity 2.

### ממצאי אביגיל
3 סבבים עד READY. r1: (#1 🔴) ה-`<form>` היה `items-stretch` → כפתור ה-Send היה נמתח
ל-6 שורות יחד עם ה-textarea (רגרסיה ויזואלית שלא כוסתה); (#2 base-hash מיושן). r2: שני
הראשונים תוקנו; צצו 2 מינוריים — הטרייד-אוף ההפוך של `items-end` (~6px בראש הכפתור בשורה-
אחת) ו-base-drift נוסף. r3: READY. כל דפוסי ה-Svelte 5 (`$state` ל-ref, `$effect` timing,
interpolation ב-`style`) אומתו תקינים מול הקוד.

### שינויי-כיוון
- ה-fix לרגרסיית כפתור-הענק: `<form>` מ-`items-stretch` ל-**`items-end`** — הכפתור מיושר-
  לתחתית ושומר על גובהו הטבעי, יושב בקו התחתית של ה-textarea הגדל. זה גם דפוס ה-composer
  הסטנדרטי (ChatGPT/Claude) כשהקלט גדל כלפי מעלה.

### רעיונות שנדחו
- **`oninput` handler** במקום `$effect`: נדחה — לא מכווץ אחרי שליחה (מחיקה פרוגרמטית של
  `promptText` לא פולטת `input`).
- **`min-h` תואם על הכפתור** כדי לסגור את ה-6px בשורה-אחת: נדחה לבסבב הזה — הטרייד-אוף
  מקובל (יישור-לתחתית מכוון), והחלופה `items-stretch` מחזירה את רגרסיית כפתור-הענק.
- **תקרה כהגדרה ב-Settings**: נדחה — `MAX_ROWS` קבוע hardcoded; slice עתידי אם יידרש.

## 2026-06-25 — slice-fe-build-decouple: ניתוק בילד-FE מ-restart של הסרוויס

### רציונל
רענון FE בפריסה המקומית דרש `systemctl restart`, שמריץ `pnpm build` מלא **וגם** מפיל את
תהליך ה-bun → כל סוכני ה-ACP (children של ה-BE) נהרגים. זה כפה הרג-סוכנים + בילד איטי על כל
שינוי FE קוסמטי. העובדה המאפשרת: ה-BE מגיש את ה-FE דרך Hono `serveStatic` שקורא מהדיסק
**per-request** (אין קאש בזיכרון) → בילד לתוך אותה תיקייה תוך-כדי ריצה מתפרסם ב-request הבא,
בלי restart.

### החלטות
1. **בילד היחיד שנחוץ בריצה = FE.** core/backend רצים מ-src עם bun (exports→src), ה-`tsc --build`
   שלהם הם artifacts לטייפצ'ק בלבד. לכן ExecStartPre עובר מ-`pnpm build` מלא ל-FE-only
   `build-if-missing` (תקדים: `dc-launch.mjs`).
2. **swap אטומי בשני `mv`** (build→old, staging→build) ולא symlink — החלון הלא-אטומי תת-מילישנייה
   (metadata-only), עלות נמוכה מול ניהול-גרסאות/symlink. בילד ה-vite האיטי רץ ל-`.build-staging`
   בלי לגעת ב-`build/` החי.
3. **outDir פרמטרי דרך `FE_BUILD_OUT`** ב-svelte.config.js (ברירת-מחדל `"build"` → אפס שינוי
   התנהגות). הוכח שה-cwd של `pnpm --filter` הוא package-dir, אז נתיב יחסי נפתר נכון.
4. **restart שמור ל-BE בלבד** — מודע ובכוונה. הטייפצ'ק כשער-פריסה נזנח (ה-BE רץ untyped מ-src
   ממילא); נשאר באחריות לולאת-הפיתוח.
5. **התקנת ה-units החיים = צעד post-merge נפרד** הדורש אישור מפורש (שינוי שירות-חי, SOUL.md).
   הסבר עצמו נוגע רק בקבצי-מקור ב-`deploy/systemd/`.

### ממצאי אביגיל
verdict=READY בסבב ראשון (נדיר). כל הטענות הארכיטקטוניות אומתו אמפירית: serveStatic per-request
(createReadStream, ללא קאש), cwd של pnpm filter = package-dir, אין service-worker,
`.gitignore build/` לא תופס `.build-staging`. שני findings minor בלבד (drop-in `.service.d`
לא-בתחום + תבנית grep path-only) — הוטמעו כהערות ב-brief.

### רעיונות שנדחו
- **symlink-based atomic deploy** — אטומי-לחלוטין אבל overkill לפריסה אישית (ניהול גרסאות + ניקוי).
- **`bun --watch` ל-BE** — היה מחזיר את הרג-ה-children בכל שינוי. נדחה.
- **השארת `pnpm build` מלא כשער-טייפצ'ק** — סותר את מטרת הרענון-המהיר.

## 2026-06-25 — slice-chat-virtualization: windowing לרשימת הבועות (virtua + Option B)

### רציונל
`ChatBubbles` עושה `{#each session.bubbles}` ללא windowing → כל הבועות ב-DOM בו-זמנית →
גלילה איטית בשיחה ארוכה (180+ בועות), בעיקר בנייד. גל שני של ה-Message&Input UX backlog.

### החלטות (אחרי מחקר ספריות — מתועד למטה)
1. **ספרייה: `virtua`** (לא TanStack-headless, לא windowing ידני). שלוש סיבות: zero-config
   dynamic measurement (החלק הקשה — גובה משתנה ב-markdown/קוד/כלים/תמונות); `Virtualizer`
   חושף `scrollRef?: HTMLElement` חיצוני; peer `svelte >=5.0` native. TanStack headless דורש
   רינדור absolute + measureElement ידני + anchoring עצמי = הרבה boilerplate על משטח רגיש.
   זו גם בחירת CodeNomad (`virtual-follow-list.tsx`, battle-tested).
2. **Option B — AppShell נשאר owner ה-scroll** (חוק זהב #4 / redesign-2 **לא** מתהפך).
   `virtua` עושה windowing בתוך ה-scroll node הקיים דרך `scrollRef`. נמנעת היפוך-ארכיטקטורה.
3. **isAtBottom ממדדי virtua handle**, לא `scrollEl.scrollHeight` גולמי — תחת windowing אסור
   להניח ש-scrollHeight מהימן. פונקציה טהורה `computeScrollEdges` (TDD) ניזונה מ-handle.
4. **auto-follow דרך `handle.scrollToIndex(last,{align:'end'})`**, לא `scrollTop=scrollHeight` —
   virtua מחשב נכון גם עבור items שטרם נמדדו (anti-jump בזמן stream).
5. **גשר context דו-כיווני** (`ChatScrollBridge` $state ב-+layout): AppShell↔ChatBubbles הם
   אחאים דרך `{@render children()}` (לא parent→prop). AppShell כותב scrollEl, ChatBubbles
   כותב handle. coupling מינימלי, additive.

### רמת חסינות: MVP+
windowing + follow-via-handle + `ResizeObserver` (re-pin בזמן streaming) + user-intent window
(להבדיל scroll-משתמש מ-scroll-תוכניתי). **hold-target** (בועה גבוהה-מ-viewport מחזיקה follow,
כמו CodeNomad) **נדחה ל-future** — over-engineering ל-MVP.

### ממצאי אביגיל (r1→r3)
r1=USABLE-AFTER-FIX, 4 findings — **כולם מינוריים** (אין blocker). אביגיל אימתה אמפירית
את אי-הוודאות המרכזית שדגלתי (§6): מנגנון ה-`bind:this` ל-handle ב-virtua/svelte = Svelte 5
instance-exports → `bind:this={handle}` מחזיר את המתודות ישירות, כפי שהונח. גם הפריכה השערת
regression על ה-Speaker (קורא `session.bubbles` VM, לא DOM). r2 תפסה שאריות typo (`?stream=`→
`&stream=` + DoD hardcoded 209). r3=READY. complexity 8 → **calev-heavy** + phase-check אחרי Commit 1.

### רעיונות שנדחו
- **TanStack svelte-virtual (headless)**: שליטה מלאה ב-DOM אבל boilerplate כבד (absolute +
  measureElement + anchoring ידני); ה-Svelte adapter היסטורית מפגר אחרי React. נדחה.
- **windowing ידני (IntersectionObserver)**: מדידת-גובה-משתנה היא בדיוק החלק הקשה — לא להמציא מחדש.
- **היפוך scroll-ownership ל-ChatBubbles**: היה מבטל את redesign-2; Option B מונע זאת.
- **hold-target**: נדחה ל-future (ראה לעיל).

### עדכון 2026-06-25 (אחרי READY) — auto-scroll במנות (batched), לא רציף (דיון `623c749f`)
ה-brief היה READY עם follow **רציף** (re-pin בכל גדילה דרך ResizeObserver). בדיון עם המשתמשת
התברר שזה בדיוק הבאג שמרגיז: הטקסט "בורח" כלפי מעלה תוך כדי קריאה (ה-default הנאיבי של
ChatGPT/Claude). ההחלטה החדשה:
1. **batched by distance + floor** — קופצים לתחתית **המלאה** רק כש (א) הקצה החי נפל ≥ ~3 שורות
   (`3 × lineHeight`) **וגם** (ב) עברו ≥ ~300ms מהקפיצה הקודמת. בין הקפיצות — אפס תזוזה.
   const-ים ב-`scroll-follow.ts` (פונקציה טהורה `shouldFollowJump`, TDD) → calev מכוונן חי.
2. **distance על-פני throttle** — המשתמשת בחרה מרחק (מסתגל למהירות הזרם) על-פני שעון.
3. **קפיצה תמיד מלאה לסוף — page-cap נדחה מפורשות.** המשתמשת לא רוצה הליכת-מסך; בלוק-כלי גדול →
   קפיצה אחת לסוף (לקרוא אותו = לגלול למעלה = hold). snap-to-line מיותר בגרנולריות בועה.
4. **toggle ידני של בועה = user-intent = hold** — פתיחה/קיפול tool/thought הוא קליק (לא scroll
   event) → ה-handler מאותת `chatScroll.noteUserIntent?.()`; המוטציה ב-AppShell (חוק זהב #4).
   בלי זה, פתיחת כלי במצב follow הייתה מקפיצה לסוף במקום לתת לקרוא.
5. **turn-boundary = force-follow** — prompt חדש מדליק follow + קופץ לקצה, גם אם היית ב-hold.

**מה זה שינה ב-brief**: Commit 0 קיבל פונקציה טהורה שנייה (`shouldFollowJump`); Commit 2 שוכתב
מ-re-pin רציף ל-batched-tick; Commit 3 קיבל toggle-intent (נוגע ב-ToolBubble/ThoughtBubble) +
turn-boundary. complexity נשאר 8 (קצה עליון). plan_verified→false עד אביגיל READY מחדש.

**רעיונות שנדחו בדיון הזה**: continuous re-pin (קופצני — הבעיה המקורית); throttle-by-time
(distance עדיף); page-walk/page-cap (המשתמשת רצתה קפיצה מלאה); snap-to-line (מיותר); hold-target
(נשאר future); split לסלייס נפרד (אותו משטח קוד בדיוק — לא לשגר-ואז-להחליף).

## 2026-06-25 — roadmap-reconciliation: קיפול הצעות-סשנים שלא תועדו ל-roadmap

### רציונל
ביקורת-כיסוי: סריקת 22 סשנים אחרונים (21–25/6) מול `docs/roadmap.md` (grep + git) חשפה
שהצעות מהותיות שנדונו — חלקן עם **brief מאושר** — מעולם לא נכנסו ל-roadmap. זה בדיוק מה
שהמשתמשת ביקשה למנוע ("תתעד הכל ב-Roadmap, שאם לא נספיק — לפחות יישאר כתוב", session b1f98c82).

### מה נוסף ל-roadmap
**Track C (Message & Input UX backlog) — 7 פריטים:**
- `session-prefs-per-cwd` — 🟢 brief READY (r3, Complexity 7), היה **חסר לגמרי** מה-roadmap למרות brief מלא.
- `display-toggle-consistency` — 🟢 brief READY (Complexity 3).
- `fix-claude-duplicate-bubbles` — 🟡 brief טיוטה (Complexity 6, fork ל-adapter).
- `RLM / תווים משבשי-markdown` — 🔄 בעבודה כעת ע"י סוכן (נדון+שוגר ב-5f8fcb92); לאמת branch/commit בסיום.
- `permission UI` (אישור-בקשות) — 💭 טרם brief.
- `ID יציב לכלי` (שורש snap-back) — 💭 טרם brief.
- `עקביות themes` — 💭 רעיון.

**Track A — 1 פריט:** הזרקת prompt-מערכת מותאם-אודיו פר-CLI (claude flag / opencode plugin / codex app-server).

**עדכוני-מסגור (לא פריטים חדשים):**
- הערת-סיכון Anthropic: נוספה דרך-מיטיגציה לחקירה (פרוטוקול ה-VSCode extension מול Claude Code, לשמירה על pool-המנוי).
- Future "Backend-managed transport": עודכן לשקף כוונה אקטיבית יותר — להפוך את ספריית-הספקים לגשר הדרגתי (frames↔WS/SSE/HTTP/ACP, שלב ראשון רק אישור-בקשות).

### תיקוני-מצב (stale)
- `latex-math`: ההערה "dispatch אחרי merge chat-render-polish" הוסרה — chat-render-polish **מוזג** (`cc5ff66`), הסלייס unblocked.
- אומת ב-git ש-`enter-toggle` ו-`chat-render-polish` מוזגו ל-dev; הסתירה לכאורה ב-brief של display-toggle ("enter-toggle טרם מוזג") היא הערה מיושנת בלבד — חשש merge-ordering נפתר.

### רעיונות שנדחו / מחוץ ל-scope כעת
local-file-proxy (כבר ב-roadmap, נדחה ע"י המשתמשת ל"אחרי B"). לא בוצע merge/push — שינוי docs בלבד.

## 2026-06-25 — slice-session-title-header: כותרת הסשן בהדר הצ'אט

### רציונל
פריט "גל ראשון quick-win" מה-Message&Input UX backlog. ה-`title` כבר קיים ב-`SessionInfo`
(מ-`listSessionsForCwd`) ומוצג ב-`SessionPicker`/`SessionCard`, אבל **לא** חווט ל-`AgentSession`
הפעיל → לא נראה בהדר ה-`/chat` (שמציג placeholder קבוע `"drive-coding"`). תיקון: שדה
`$state sessionTitle` חדש ב-VM, חיווט מ-connect, ו-`AppHeader` מציג עם fallback ל-placeholder
הקיים (אפס regression לסשן חדש). **auto-generate (`generate_session_title`) מחוץ ל-scope** —
future נפרד; הכותרת היא snapshot מרגע הטעינה, ללא תלות ב-wire (זה מה שהפך אותו מ-spike לסלייס קטן).

### שינויי-כיוון — אביגיל הצילה מ-regression שקט
ה-brief הראשון חיווט **רק** את `loadSession`, עם סמנטיקת `sessionTitle = input.title ?? ""`.
אביגיל (r1, USABLE-AFTER-FIX) תפסה שזה משאיר שני נתיבי-כניסה חיים שמאפסים את הכותרת בשקט
(לא נתפס ב-typecheck, כנראה גם לא ב-calev light):
1. **`switchSession`** — הנתיב ה**ראשי** להחלפת סשן בצ'אט (מ-`SessionOptionsPanel`), לא חווט כלל.
2. **`#coldReconnect`** — קורא `loadSession` בלי title → כל WS-reconnect היה מוחק את הכותרת.

ההכרעה המתקנת: **keep-on-undefined** — `sessionTitle = input.title ?? this.sessionTitle`.
קורא שלא יודע title (reconnect) **שומר** במקום למחוק (תיקון אוטומטי, אפס שינוי ב-`#coldReconnect`);
רק נתיבים שיודעים title-חדש (connect/switch) מעבירים `string` מפורש (גם `""` כדי לנקות כראוי
בהחלפה לסשן חסר-כותרת); רק `newSession` מאפס. r2=READY.

### רעיונות שנדחו
- **שדה פרטי `#sessionTitle` שמשוחזר ב-reconnect** (הצעת אביגיל א'): מיותר — keep-on-undefined
  על השדה הציבורי מספיק ופשוט יותר (אין כפילות state).
- **צמצום scope ("warm-switch+reconnect לא בסבב")** (הצעת אביגיל ב'): נדחה — warm-switch הוא
  הנתיב הנפוץ; כותרת שנעלמת בהחלפת-סשן = בדיוק החוויה השבורה שהפריט בא לתקן.
- **fallback ל-"סשן חדש"**: ברירת-המחדל היא שימור ה-placeholder הקיים (`"drive-coding"`) — אפס
  regression, אפס i18n חדש. נשאר כשאלה פתוחה לא-חוסמת (§9) למשתמשת.

## 2026-06-25 — slice-display-toggle-consistency: פולריות אחידה למחווני "תצוגת צ'אט"

### רציונל
המשתמשת תפסה חוסר-עקביות: בכרטיס "Chat display" (מ-chat-render-polish) מחוון אחד
("Collapse thoughts" — ON מסתיר) ואחר ("Expand tools" — ON מציג) בעלי **פולריות הפוכה**.
באותו כרטיס, הפעלת מתג אחד מסתירה ואחרת מציגה — מודל מנטלי שבור. אומת בקוד:
`ThoughtBubble:34` = `open = !collapseThoughts` (שלילי); `ToolBubble:30` = `open = expandTools`
(חיובי). השורש: ב-chat-render-polish כל מתג נוסח כ-"opt-in לשינוי מברירת-המחדל" (מחשבות
פתוחות, כלים סגורים) → פולריות לא-עקבית כתוצר-לוואי.

**ההכרעה**: לאחד לפולריות חיובית אחת — `showThoughts`/`showTools`, **ON תמיד מציג**.
ההתנהגות-בפועל של ברירות-המחדל נשמרת (`showThoughts:true`=מחשבות מוצגות,
`showTools:false`=כלים מצומצמים) — רק המודל המנטלי נעשה עקבי. **migration ב-`load()`**
ממפה מפתחות ישנים (`!collapseThoughts`→`showThoughts`, `expandTools`→`showTools`) כדי
שמשתמשים קיימים לא יאבדו העדפה.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings). 🟡: מספרי שורות ה-reset (178-179) נכונים
ל-dev הנוכחי, אך אם enter-toggle מוזג קודם — שורת `setEnterToSend` נכנסת ביניהן והמספרים
זזים; חודד ב-§4 (אתר ע"י grep, לא מספרים). 🟢: ה-spread ב-`load()` נושא מפתחות-ישנים
ל-runtime — מאושר ב-brief (נופלים בשמירה הבאה). אומת: ה-rename מלא (grep=0), לוגיקת
migration נכונה, snap-back נשמר (`$state` מקומי, לא reactive). דוח:
`reports/drive-coding/slice-display-toggle-consistency-avigail.md`.

### שינויי-כיוון / merge-ordering
- **תלות-מיזוג ב-enter-toggle** (GO, טרם מוזג): שני ה-slices נוגעים בכרטיס + reset.
  הכרעה פתוחה (§9 Q1): למזג enter-toggle קודם (לינארי, נקי) **או** לשרשר slice זה עליו.
  ממתין להכרעת המשתמשת לפני dispatch.

### רעיונות שנדחו
- **לא לגעת (known issue בלבד)** — נדחה; המשתמשת ביקשה עקביות מפורשות, וזה מחמיר עם
  המתג השלישי (enterToSend) שנכנס לאותו כרטיס.
- **להפוך את `expandTools` לשלילי** (כדי "להתאים" ל-collapse) — נדחה; חיובי ("Show")
  הוא המודל הברור; הפכנו את `collapseThoughts` אליו, לא להפך.
- **בלי migration** (ערך ישן נופל ל-default) — נדחה; זול לשמר העדפה (2 תנאים ב-load).
## 2026-06-25 — slice-latex-math-invisibles: נרמול range של תווים בלתי-נראים (relocate-or-delete)

### רציונל
ה-fix הקודם (slice-latex-math-bidi-fix) תיקן RLM בתחילת שורה אבל התגלה **חלקי** באימות חי:
טבלאות נשברו מ-RLM ש**אחרי** ה-`|` בשורת ה-separator (`|‏---|`) — מיקום שהנרמול לא כיסה.
אבחון אמפירי שיטתי (מטריצת **10 תווים בלתי-נראים × 6 מיקומים**) הראה ש**כל משפחת התווים**
(bidi-control, zero-width, soft-hyphen, NBSP) שוברת את **כל** המיקומים התחביריים — לא רק RLM,
לא רק תחילת שורה. תיקון-מונחה-תסמינים כשל פעמיים → עברנו לאסטרטגיה כללית.

ההכרעה: עיקרון אחיד — *"הצמד את התו הבלתי-נראה לטקסט אמיתי; מחק רק באזורי-תחביר-טהור."*
מומש כ-`normalizeInvisibles` (מחליף את `normalizeLineLeadingBidi`): char-class של **range** (לא רשימה),
+ NBSP→רווח, + strip בשורות separator ובתוך math-spans, + relocate בתחילת שורה, + שמירה בתוכן.
הורץ אמפירית: **16/16** (כל המטריצה + שמירת RLM בתוכן).

### ממצאי אביגיל (2 סבבים)
- **r1 = USABLE-AFTER-FIX** (3 findings): (🔴) `markdown.ts:41` עושה re-export של `normalizeLineLeadingBidi`
  — מחיקת הסמל בלי עדכון ה-re-export שוברת typecheck (`verbatimModuleSyntax`). (🟡 **המהותי**) ה-inline
  `$..$` strip תופס **מחירים** (`$5 .. $10`) ומוחק מהם invis = content-mutation שקט שלא נתפס בטסטים.
  (🟡) מקור ה-import של ה-unit test לא צוין. אביגיל אימתה את ה-reference 16/16 עצמאית.
- **r2 = READY** (0 חוסם) — שלושת התיקונים אושרו.

### שינויי-כיוון
- מ"נרמול RLM בתחילת שורה" → **range של כל הבלתי-נראים, בכל מיקום** (אבחון המטריצה).
- math-span strip **הוגבל ל-`$$`/`\[`/`\(`** (הוסר `$..$` inline) — בעקבות finding #2 (מחירים). invis בתוך
  `$x$` inline math נדיר נשאר → רעש `unknownSymbol` קל ב-KaTeX, מחיר מקובל מול הגנה על מחירים/קוד.

### רעיונות שנדחו
- **strip גורף של כל הבלתי-נראים** (אסטרטגיה B) — נדחה לטובת relocate-or-delete של המשתמשת: שומר את ה-RLM
  בתוכן אמיתי (מועיל ל-`dir="auto"` ב-block שמתחיל בלטינית), מוחק רק היכן שאין טקסט.
- **טלאי per-{תו×מיקום}** (אסטרטגיה A) — gap-prone; כשל פעמיים. range + עיקרון אחיד מחליף.

## 2026-06-25 — slice-latex-math-bidi-fix: נרמול bidi-marks בתחילת שורה (heuristic היברידי)

### רציונל
אחרי merge-ready של `slice-latex-math`, אימות חי בדפדפן (linux-gui) חשף ש**טבלאות ונוסחאות display
לא רונדרו** — נשארו markdown גולמי. אבחון אמפירי (marked+katex ישירות, ואז `renderMarkdown` ב-jsdom)
הוכיח ש**`marked` ו-`DOMPurify` תקינים לחלוטין** — ה-root-cause הוא **תווי bidi-control (RLM, U+200F)
שמרדכי/המודל מזריקים בתחילת שורות עבריות** (כללי ה-RTL של ה-CLI). marked עוגן block-tokenizers ל-`^`
(`^#`/`^|`/`^>`/`^-`); RLM יושב שם וחוסם → הבלוק הופך לפסקה גולמית. אירוניה: כללי-ה-RTL שברו את הרינדור.

ההכרעה: **heuristic היברידי** של נרמול-bidi בתחילת שורה (לא מחיקה גורפת):
- לפני **block-marker נושא-טקסט** (`#`/`-`/`>`/`|`/`1.`) → **דחוף** את ה-RLM אל אחרי ה-marker.
  כך marked מזהה את הבלוק, וה-RLM נוחת בתחילת התוכן → `dir="auto"` של ה-element בוחר RTL נכון
  (heading שמתחיל במילה לטינית עדיין מיושר ימין).
- לפני **math-marker** (`$$`/`\[`) → **מחק** את ה-RLM (נוסחה היא LTR; RLM בתוך LaTeX = `unknownSymbol` ב-KaTeX).
- לפני **טקסט רגיל / באמצע שורה** → **השאר** (RLM שם ניטרלי/מועיל — לא נוגעים בכוונת המשתמש).

בנוסף: **פיצול `markdown-parse.ts` (טהור, בר-בדיקה ללא DOM) / `markdown.ts` (עוטף-סניטיזציה)** — internal
boundary בתוך FE, ה-export הציבורי היחיד נשאר `renderMarkdown`, האבטחה (two-pass) לא משתנה.

### ממצאי אביגיל (2 סבבים)
- **r1 = USABLE-AFTER-FIX** (3 findings, אין blocker): (#1) פקודת typecheck השתמשה ב-`@drive-coding/frontend`
  במקום `-v2` → "No projects matched"+exit-0 = **typecheck פאנטום** (קריטי כי Commit 2 הוא refactor רגיש-אבטחה).
  (#2) בעלות `replacePlaceholders`/sentinels ב-Commit 2 הייתה דו-משמעית. (#3) framing: `$$`/`\[` כבר עובדים
  עם RLM (start()=indexOf) — החסימה רק ל-block-markers. אביגיל אימתה אמפירית את ה-regex (9 תרחישים) ואת
  ה-edge-cases (RLM כפול, marker בלי רווח, `|` בטבלה) — כולם נכונים.
- **r2 = READY** (0 findings) — שלושת התיקונים אושרו.

### שינויי-כיוון
- מהשערה ראשונית "הבאג ב-`breaks:true` / ב-DOMPurify allowlist" → אחרי אבחון אמפירי: **הקלט (bidi-marks), לא הקוד**.
  marked+DOMPurify חפים. תובנת המשתמשת ("אולי קשור לסניטיזציה") כיוונה לפסילת ה-allowlist כחשוד, מה שמיקד את האבחון.
- מ"מחיקה גורפת של bidi בתחילת שורה" (הצעת מרדכי הראשונה, A) → **heuristic היברידי** (דחיפה/מחיקה/השארה).
  תובנת המשתמשת: "אי אפשר לדחוף RLM אל הטקסט במקום למחוק?" — אומת ש-`dir="auto"` הופך דחיפה לעדיפה (משמרת RTL).

### רעיונות שנדחו
- **העברת הרינדור ל-`core`** — נדחה: DOMPurify דורש DOM (אסור ב-core); זה view-concern; אין צרכן מחוץ ל-FE.
- **מחיקה גורפת (A)** — over-reach: מסיר RLM לגיטימי מטקסט רגיל.
- **strip רק לפני רשימת-markers קשיחה (C)** — שביר (מתיישן בהוספת תחביר); ההיברידי משתמש ב"דחיפה" שלא דורשת זאת.
- **דחיפת RLM גם לתוך math** — נדחה: KaTeX פולט `unknownSymbol` (אומת אמפירית).

## 2026-06-25 — slice-latex-math: רינדור LaTeX/KaTeX עם allowlist פר-מקור

### רציונל
רינדור נוסחאות (KaTeX) בכל 4 הסגנונות (`$`,`$$`,`\(`,`\[`). ההכרעה המרכזית — **אבטחה**:
KaTeX מייצר HTML עם inline `style` (positioning), שמנוגד ל-policy שאסר `style` ב-DOMPurify
(vector ל-CSS-injection). הפתרון הסופי: **allowlist פר-מקור (two-pass)**, לא רשימה כללית אחת.

- **המנגנון**: extension פנימי (`marked.use`) שמזהה math (מכבד code blocks דרך ה-pipeline,
  לא regex) ומפיק **placeholder**; `renderMarkdown` עושה two-pass: ה-markdown עובר
  `MARKDOWN_ALLOW` (שמרני, **בלי span/style**), וכל KaTeX עובר `KATEX_ALLOW` (נדיב: span/style/
  MathML/SVG) **בנפרד**, ואז מוזרק. ה-`span`+`style` קיימים אך-ורק במסלול KaTeX (input מהימן:
  generated, `trust:false`). span גולמי של מודל-מתחזה (prompt-injection) → נמחק.
- **secure by construction, לא by filtering**: לא "מסננים" CSS מסוכן (ומקווים שה-allowlist מושלם)
  — פשוט לא יוצרים את ההרשאה במסלול הלא-מהימן.

### ממצאי אביגיל (3 סבבים — אומת אמפירית, לא בהנחה)
- **r1 = NEEDS-REWORK**: ההכרעה המקורית ("התר `style` גלובלי כי DOMPurify מסנן `url()`/`javascript:`")
  הייתה **שגויה עובדתית** — אביגיל הריצה DOMPurify ואימתה ש-style עובר verbatim. **טעות של מרדכי**;
  אביגיל תפסה לפני קוד. (הסיכון האמיתי: overlay-phishing/exfiltration דרך prompt-injection, **לא** RCE — מת ב-2026.)
- **r2 = USABLE-AFTER-FIX**: ה-two-pass אומת אמפירית — כל 5 ההנחות (בידוד span-strip, re-inject ≠ modify-after,
  PUA sentinel שורד, marked-extension API, map per-call). נותרו 3 דיוקים.
- **r3 = USABLE-AFTER-FIX + אישור-מותנה**: KATEX_ALLOW הושלם (mtable/sum/vector...), אומת שאין tag מסוכן.
  4 ערכי-MathML שוליים (`mpadded`/`linethickness`/...) נוספו → READY.

### שינויי-כיוון
- מ"התר style גלובלי + סנן" (r1) → "allowlist פר-מקור, style מבודד ל-KaTeX" (r2+). תובנת המשתמשת:
  ה-CSS המסוכן מגיע מ-HTML-גולמי-של-מודל, לא מ-KaTeX/LaTeX → לבנות כך שלא קיים, לא לסנן.
- `marked-katex-extension` הוסר — extension פנימי שולט בכל ה-delimiters (פותר גם `\(`/`\[`).

### רעיונות שנדחו
- **`style` גלובלי + DOMPurify** — שגוי (style עובר verbatim).
- **placeholder re-inject בלי sanitize נפרד** — מפר אזהרת DOMPurify "modify-after".
- **MathML-only** — בטוח-מבנית ופשוט יותר, אך KaTeX-HTML מלוטש יותר; נבחר two-pass לטובת ה-rendering.
- **CSS-sanitizer hook (uponSanitizeAttribute)** — תקף (המלצת DOMPurify), אך per-input בטוח-מבנית יותר (לא תלוי בשלמות allowlist של CSS-properties).

## 2026-06-24 — slice-enter-toggle: ביטול שליחה ב-Enter (toggle)

### רציונל
ראשון ב-"Message & Input UX backlog" (Track C, נקלט מהתנסות המשתמשת). נבחר כ-quick-win
ראשון כי כל התשתית קיימת: ה-handler ב-`TypeArea` כבר מבחין Enter/Shift+Enter, ותשתית
ה-settings (Persisted + reset) קיימת מ-chat-render-polish. השדה `enterToSend` ברירת-מחדל
`true` → **התנהגות נוכחית נשמרת**, אין הפתעה למשתמש קיים. כש-off: Enter=שורה-חדשה, שליחה
בכפתור (תמיד קיים — ידידותי-נייד) או Cmd/Ctrl+Enter. Cmd/Ctrl+Enter שולח בשני המצבים
(power-user עקבי).

**הכרעת depends_on**: התבסס על `chat-render-polish` (לא dev הנקי) — הוא מוסיף את כרטיס
"תצוגת צ'אט" ב-SettingsScreen + דפוס Persisted ל-toggles, וה-toggle החדש נכנס לאותו כרטיס.
base = dev אחרי merge של chat-render-polish. **חוסם dispatch**: chat-render-polish חייב
להתמזג ל-dev ראשון.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: הפניה קוסמטית — `en.ts:196` היא
שורת-הערה (expandTools ב-197-199); הוראת-ההוספה עצמה נכונה — תוקן ה-ref. #2: ל-keydown
החדש אין guard ל-`e.isComposing`/IME — אבל גם ל-baseline אין, אז זו **לא רגרסיה** שה-brief
מכניס (קיים-מראש, מחוץ ל-scope). אומת שקריאת `settings.enterToSend` בתוך event-handler
אינה בעיית reactivity של Svelte 5 (קריאת-ערך, לא render). דוח: `reports/drive-coding/slice-enter-toggle-avigail.md`.

### רעיונות שנדחו
- **כרטיס "קלט" נפרד ב-settings** — נדחה; ה-toggle שייך-לוגית לתצוגת-הצ'אט, חוסך כרטיס.
- **לשנות Enter ל-newline ללא הגדרה (swap קשיח)** — נדחה; שובר ציפייה של משתמשים קיימים.
  toggle עם default=current שומר תאימות-לאחור.
- **IME isComposing guard** — לא נכלל בסבב (out-of-scope, pre-existing); מועמד ל-polish עתידי.

## 2026-06-24 — slice-chat-render-polish: טבלאות MD + תמונות בכלים + העדפות-תצוגה

### רציונל
שלושה שיפורי-רינדור בצ'אט אוחדו ל-**brief אחד עם 3 commits עצמאיים** (לא 3 slices נפרדים).
הסיבה: שלושתם נוגעים ב-`ToolBubble.svelte`. בתחילה תוכננה שרשרת A→B→C כדי להימנע מ-merge
conflicts בין branches — אבל ב-worktree יחיד אין conflicts כלל, כך שהנימוק לפיצול ביטל את
עצמו. הנושאים קטנים, קוהרנטיים ("שיפורי רינדור"), ועצמאיים-לוגית, אז commit-per-נושא מאפשר
merge חלקי אם אחד מסתבך — בלי overhead של 3 dispatch/אביגיל/כלב/merge.

- **טבלאות MD**: השורש — `markdown.ts` ALLOWED_TAGS חסר תגי טבלה, DOMPurify מוחק את מה
  ש-marked כבר מייצר (`gfm:true`). תיקון: allowlist + `align` (marked מייצר attr, **לא** style)
  + CSS. אומת ש-marked v18 פולט `<th align="left">`.
- **תמונות**: ACP `image` content (`{data:base64, mimeType}`) מופה היום ל-`{type:"other"}`
  ומודפס כ-JSON. הוספת `ToolContentImage` + רינדור `<img>`. גם `resource` blob עם `image/*`
  (אותו רינדור). **SVG מתירני** — `<img>` מנטרל scripting ב-secure-static-mode, עם invariant
  מתועד "רק `<img>`, לעולם לא inline".
- **העדפות-תצוגה**: ברירות-מחדל שומרות התנהגות נוכחית (`collapseThoughts:false`,
  `expandTools:false`); רק ה-default נשמר ב-settings, override ידני per-bubble הוא per-render.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: כפתור reset סלקטיבי ולא גלובלי —
ניסוח "עקביות" תוקן. #2 (משמעותי): `ToolBubble:121` כופה reactivity על `tc.status`; חשש
ל-snap-back שיכפה `open` מחדש ויבטל קיפול ידני באמצע turn. ב-Svelte 5 fine-grained כנראה
לא קורה, אך חוזק ב-§6 כ-risk עם הנחיית בדיקה-בפועל + פתרון נפילה (local `$state` per-bubble).
(הערה: אביגיל לא כתבה קובץ report פיזי — ה-verdict+findings תועדו כאן מהתמצית.)

### שינויי-כיוון
- מ-3 briefs בשרשרת → brief אחד / 3 commits (בקשת המשתמשת; הנימוק לשרשור קרס תחת worktree יחיד).
- `resource_link` (`file://`) **הוצא מ-scope** — דורש BE proxy לקבצים מקומיים (LFI/path-traversal),
  נרשם ב-roadmap כ-slice **local-file-proxy** נפרד (Track C, תלוי ב-slice זה).

### רעיונות שנדחו
- **שמרני ל-SVG** (raster בלבד): נדחה — `<img>` בטוח, ו-SVG נפוץ בפרויקטי קוד.
- **persist של מצב פתוח/סגור per-bubble**: נדחה — רק ה-default נשמר, override ידני per-render.
- **audio / resource-text content**: future (סוגי מדיה אחרים, fallback ל-JSON נשמר).

## 2026-06-22 — slice-wake-lock: מתג "השאר מסך דלוק" + WakeLockEngine

### רציונל

באג שמטריד בעיקר בנייד: המסך נכבה באמצע שהסוכן עובד / בזמן האזנה לתשובה. ה-Web
**Screen Wake Lock API** פותר בדיוק את זה. בקשת המשתמשת: שזו תהיה **הגדרה** שניתן
להדליק/לכבות, לא התנהגות כפויה. הפיצ'ר כבר ברודמ"פ — Track C, "drive-first chrome
(car mode, Media Session, **wake lock**)".

**הכרעת סמנטיקה: נעילה כל-עוד-הטאב-גלוי, לא רק-בזמן-turn-פעיל.** מתג שהמשתמשת מדליקה
במפורש צריך להיות צפוי — מסך שנכבה באמצע קריאת תשובה ארוכה (כי ה-turn הסתיים) הוא
הפתעה גרועה. בהקשר hands-free/נהיגה רוצים את המסך דלוק לאורך כל ה-session כדי להעיף
מבט. הסוללה היא tradeoff שהמשתמשת בוחרת מדעת (opt-in, default `false`). עידון עתידי
"רק בזמן פעילות" (חיסכון סוללה) אפשרי בסלייס שיגדיר "פעילות" (turn/mic/speaker).

**הכרעת ארכיטקטורה: `WakeLockEngine` (engines/) owner של ה-`WakeLockSentinel`, מחווט
דרך `$effect` יחיד ב-`+layout.svelte`** — לא ב-VM. זו סטייה **מודעת** מחוק-הזהב 4 של
ה-FE (`AGENTS.md:70`), שנותן דוגמה "`Mic.state === recording` צריך wake-lock? → ב-Mic"
— כלומר מחברי ה-design דמיינו wake-lock בתוך VM. ההצדקה: כאן הנעילה גלובלית-לאפליקציה
ולא נגזרת מ-state של entity יחיד, אלא ממתג גלובלי (`settings.screenWakeLock`). זה בדיוק
המקרה של ה-`$effect` הקיים של dir/lang sync, שכבר חי ב-`+layout` כי `<html>` הוא
app-global. ה-engine **לא** ב-`context.ts` — אף component/VM לא צורך אותו (רק +layout
מזין), אז context pair היה dead code.

ה-gotcha המרכזי של ה-API מעוגן ב-DoD (#6): הדפדפן משחרר את הנעילה אוטומטית בכל הסתרת
טאב, ולא מחזיר אותה לבד — לכן ה-engine מאזין ל-`visibilitychange` ותופס-מחדש.

### ממצאי אביגיל

r1 = **READY** בסבב ראשון (נדיר — track record היה 100% briefs-with-issues עד כה). 3
findings, כולן 0-min: (#1 🟡) חוק-זהב 1 מונה 'wakelock' מפורשות כ-side-effect אסור
ב-`$effect` — ה-brief מפרש כ-routes-only, עקבי עם precedent של dir/lang (לא חוסם,
ומתועד מראש ב-brief); (#2 🟢) אין precedent ל-`dispose()` ב-engines (cues חושף
`close()`); (#3 🟢) snippet UI בלי wrapper `divide-y`. כל 8 ה-spot-checks אומתו factual
(דפוס muted, `$effect` של dir/lang, חתימת `SettingToggle`, `WakeLockSentinel` ב-DOM lib).

### שינויי-כיוון

קלים בלבד — קיפלתי את שתי ה-🟢 לתוך ה-brief כהבהרות (dispose סינכרוני במכוון ≠ close
אסינכרוני; toggle בודד לא צריך wrapper) כדי לאטום אותו. הסמנטיקה והארכיטקטורה לא השתנו.

### רעיונות שנדחו

- **נעילה רק בזמן turn פעיל** — חיסכון סוללה אבל כיבוי מפתיע באמצע קריאה. נדחה ל-v1,
  אופציה לעידון עתידי.
- **wake-lock בתוך VM (Mic/AgentSession)** — מה שחוק-זהב 4 מרמז עליו. נדחה כי הנעילה
  גלובלית-לאפליקציה, לא נגזרת מ-entity יחיד; +layout הוא ה-owner הנכון (כמו dir/lang).
- **`WakeLockEngine` ב-`context.ts`** — dead code (אין צרכן מלבד +layout).

## 2026-06-21 — slice-session-prefs-per-cwd: שמירת state של סשן פר-פרויקט בצד שרת

### רציונל

המשך-ישיר לאבחון של "הריצה נעצרת": גילינו ש-`bypassPermissions` פותר את התקיעה (האדפטר עושה
short-circuit ולא שולח `request_permission` — אומת חי על agent `920d6c43`), אבל הבחירה במצב
**לא נשמרת** — היא runtime-only (`session/set_config_option`) לאותו סשן. בכל סשן חדש המשתמשת
נאלצת לבחור מחדש.

**ההכרעה: לשמור את ה-state של הסשן (mode/model/agent/config) פר-`(cwd, cliKind)` בצד שרת, לא ב-localStorage.**
הנימוק המכריע — drive-coding הוא **multi-device מעצם הגדרתו** (voice/car/mobile): בוחרים
`bypassPermissions` במחשב בבית, נכנסים לרכב ומתחברים מהטלפון לאותו BE — וצריך שייזכר.
localStorage שובר את זה כי הוא per-device. אחסון ב-BE מסתנכרן בין כל המכשירים המחוברים לאותו
שרת, וה-`cwd` ממילא שייך לוגית ל-BE (זה ה-filesystem שלו). זה גם צעד ראשון עקבי לכיוון
backend-managed (state נודד ל-BE).

**ההחלטה על הנתיב**: כל ה-stores עוברים מ-`<worktree>/data/` (מעורבב בקוד, נפרד בין dev/main)
ל-`~/.drive-coding/` — תיקיית בית יציבה, משותפת בין deployments, עם `DRIVE_CODING_DATA_DIR`
override קריטי כדי שבדיקות/worktrees לא יזהמו data חי. migration של recordings/cache קיימים
= פעולה תפעולית-ידנית (`cp -n`), **לא** קוד-startup, כדי לא לסכן data חי ב-race.

### ממצאי אביגיל

3 סבבים עד READY. r1 = USABLE-AFTER-FIX (6 findings, 2×🔴): (#1) הנחתי מסלול `newSession` יחיד
אך יש **שניים** fresh (`attach()` ו-`newSession()` ציבורי) מול שלושה load/warm — תוקן עם helper
`#captureSessionConfigFresh`; (#2) Commit 3 (voice) הסתמך על `applyRuntimeMuted` שלא קיים — voice
דורש runtime-tier ב-`Settings`. r2 = USABLE-AFTER-FIX (4 findings, 0×🔴): `applyConfigOption` יש
בו **5** success-returns לא 3 (תוקן עם wrapper boolean); `SavedSessionState` חייב לשבת ב-core ולא
ב-backend (אחרת coupling FE→backend שלא קיים היום); `buildAvailableModes` הוא בקוד האדפטר החיצוני
לא ב-drive-coding. r3 = READY (2×🟢 cosmetic). track record נמשך: 100% briefs עם בעיה אמיתית.

### שינויי-כיוון

תוכנן תחילה client-side (localStorage) — המשתמשת עצרה ושאלה "צד שרת או לקוח?", מה שחשף שה-multi-device
שובר את גישת ה-localStorage. שונה ל-BE. בעקבות ממצא אביגיל r1, **voice/muted נדחה ל-slice נפרד**
(`slice-voice-prefs-per-project`) — tier שונה (UI-prefs ב-localStorage מול ACP session-config),
דורש runtime-override layer ב-`Settings`. הסלייס הזה התמקד ב-session-config בלבד.

### רעיונות שנדחו

- ‏**localStorage (per-device)** — נדחה בגלל multi-device (הליבה של drive-coding).
- ‏**migration אוטומטי ב-startup** — נדחה (סיכון race/partial-copy על recordings חיים); ידני במקום.
- ‏**voice override-on-top באותו slice** — נדחה (mechanism `applyRuntimeMuted` לא קיים, tier נפרד) → slice ייעודי.
- ‏**`permissions.defaultMode` ב-claude settings** (חלופה ללא קוד) — נדחה כפתרון ראשי: גלובלי לכל ה-CLIs, לא מבודד ל-drive-coding, ולא נותן את חוויית ה-UI.

## 2026-06-21 — slice-release-cli-hardening: fixtures strip + CLI flags + --help

### רציונל

קידום ה-NPM package `drive-coding` (packages/release/) לקראת publish. שתי מטרות אמיתיות:
(1) הסרת דליפה — `frontend-dist/fixtures/` (~2MB sessions מוקלטים, כולל `salary-*.json`
שנשמעים אישיים) נכנס ל-tarball הציבורי. הם DEV-only (`MOCK_FIXTURES` מאחורי
`import.meta.env.DEV`), לכן מוחרגים מהעותק של ה-release ב-build.mjs בלבד — dev לא נפגע.
(2) בקשת המשתמשת — config דרך flags (לא רק env vars) + `--help`. נוסף `parseArgs`
(`node:util`, בלי dependency), flags `--port/--opencode-bin/--fe-static-dir/--cors-origins`,
`--help`, `--version`, עם קדימות flag > env > default (flag דורס env דרך הצבה לפני ה-`??=`).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX, **תפסה 🔴 קריטי**: ה-brief המקורי כלל "Commit 0 — תיקון FE path
resolution" בטענה שה-package שבור (404 מהתקנה נקייה). **הטענה הופרכה.** אומת עד הסוף:
`import.meta.dirname` בבאנדל נפתר נכון ל-`dist/`, ו-candidate `../frontend-dist` נבחר.
r2 = READY (1×🟢: `--port` לא-מספרי → NaN → bind שקט; קופל פנימה כולידציה).

### שינויי-כיוון

ה-FE-path "blocker" כולו נמחק מה-brief. ה-package **עובד ומוכן לפרסום כמו שהוא** —
ה-slice הוא שיפורים בלבד, לא תיקון.

### רעיונות שנדחו

- **תיקון FE path resolution (process.argv[1] במקום import.meta.dirname):** נדחה — אין באג.
- **config-file ממשי (JSON/TOML):** נדחה — flags מספיקים; env-vars נשארים מקור-האמת ש-flags דורסים.
- **חשיפת debug envs (LOG_WIRE/WIRE_RECORD) כ-flags:** נדחה — נשארים env-only (לא user-facing).

### לקח מתודולוגי (false-blocker)

ה-404 שהוליד את ה"blocker" המדומה נבע **אך ורק** מכך שה-session של מרדכי מייצא
`FE_STATIC_DIR=.../dev/packages/frontend/build` (מסקריפט הרצת dev) — זה דלף לכל בדיקת
install-נקי, וה-`??=` ב-bin היה no-op. עם `env -u FE_STATIC_DIR` + עץ dev מוסתר → 200
מה-`frontend-dist` הארוז. **כלל חדש שנכנס ל-brief**: כל בדיקת install חייבת `env -u
FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN`. ערך אביגיל כאן היה למנוע dispatch של
תיקון מיותר לבאג שלא קיים.

---

## 2026-06-19 — slice-wire-observability-bridge: העברת תצפית ה-wire לשכבת הגשר

### רציונל

המשך-ישיר ל-`slice-ws-error-survival`. אותו slice תיקן שה-child **שורד** ניתוק דפדפן, אבל
דיבוג חי (19/6) חשף שהתסמין האמיתי שונה ממה ש-§11 הניח: ברוב המקרים **התהליך לא מת — אבל
הריצה נעצרת**. כדי לאבחן את זה צריך לראות את זרם ה-wire של ה-agent **גם כשאין דפדפן** — וכאן
התגלה ה-gap: כל ה-wire observability (live log של `LOG_WIRE` ב-ns `backend.ws.wire`, וגם
`WIRE_RECORD`) חי **בתוך `ws-agent.ts`**, ב-`onLine` callback וב-message handler — שניהם
מתבטלים ב-`detach()` (`unsub()` + `rec.close()`). כלומר ברגע הניתוק אנחנו עיוורים בדיוק
כשצריך לראות. זה מה ש-Commit 3 (observability) של ה-slice הקודם לא כיסה — הוא הוסיף לוג ל-error
path, לא לזרם ה-stdout/stdin עצמו.

**ההכרעה: להוריד את נקודת-התצפית מהשכבה שמתנתקת (`ws-agent`) לשכבה שמחזיקה את ה-child ושורדת
(`bridge-manager`).** ה-reader הקבוע `stdoutRl` הוא כבר הבעלים של `child.stdout` ורץ כל חיי
ה-child → שם נכנס תיעוד כיוון ה-"in". כיוון ה-"out" עובר דרך method חדש `bridgeManager.writeStdin()`
(במקום `child.stdin.write` ישיר ב-ws-agent), שמתעד גם הוא. כך התצפית **סימטרית, רציפה דרך
disconnect→reconnect, ובלי פערים עיוורים**. ה-recording session הופך per-child-lifetime (לא
per-WS-connection). ה-ns עובר מ-`backend.ws.wire` ל-`backend.acp.wire` — סמנטי נכון (זה ה-CLI↔BE
wire, לא BE↔FE), וכבר ממופה ל-`LOG_WIRE=acp` ב-`core/log/config.ts`.

> **גבול scope מפורש**: הבריף **נותן את העיניים** לאבחן את "הריצה נעצרת" — הוא לא מתקן את
> התקיעה. ההשערה החזקה (FE הוא ה-ACP client → בקשת-קליינט שלא נענית כשאין דפדפן) תיבדק
> ב-slice נפרד, עם התצפית החדשה ביד.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings). ה-blocker (🔴 #1+#2): פספסתי call-site שלם —
`ws-agent-pipe.test.ts` עם 7 קריאות ל-`createAgentWsHandler` ו-mock `bridgeManager` בלי
`writeStdin`; הסרת `wireRecorder` מה-deps הייתה מפילה typecheck ב-7 מקומות, והמעבר ל-`writeStdin`
היה שובר את הטסט "FE message forwarded to child.stdin" **ב-runtime** (ה-mock לא כותב ל-stdin).
תוקן: §4.ד מפרט הסרת `wireRecorder` + הוספת `writeStdin` ל-mock. עוד: (#3) ה-return type הוא
inline object, אין שינוי ב-`core/ports.ts`; (#4) אין rec-leak ב-spawn-fail path (rec.open אחרי
pid-guard); (#5) `LOG_WIRE=ws` ב-`docs/deploy-local-service.md:99`, לא ב-systemd units. r2 = READY
(2 findings 🟢 קוסמטיים: off-by-one בציטוט שורות, walkthrough היסטורי out-of-scope).

### שינויי-כיוון

ה-blocker של אביגיל חידד שזה refactor שנוגע ב-**3 קבצי טסט** (לא אחד) — מה שהצדיק commit אטומי
אחד (in+out+recorder יחד) במקום פיצול, כדי להימנע מ-double-logging זמני.

### רעיונות שנדחו

- **לתעד `$/ping`/`$/pong` ב-wire** — נדחה: זה transport keepalive (BE↔FE, ענייני NAT), לא עובר
  ל-child ולא חלק מ-ACP wire. יורד מהתיעוד.
- **לפצל ל-2 commits (הוסף ל-bridge → הסר מ-ws-agent)** — נדחה: יוצר double-logging/recording זמני
  כי שתי השכבות היו מתעדות את אותו frame. commit אטומי במקום.
- **להשאיר `backend.ws.wire` כ-alias ל-backward-compat** — נדחה: אין צרכן קוד חי אחרי השינוי
  (אומת ב-grep), `LOG_WIRE=acp` מכסה. פחות בלבול.

## 2026-06-18 — slice-ws-error-survival: ניתוק דפדפן לא יפיל את ה-BE

### רציונל

המשתמשת דיווחה שכשחיבור הדפדפן משתבש/מתנתק, גם ה-CLI agent (claude-code/opencode)
מפסיק לרוץ — התנהגות לא-צפויה, שכן ה-backend הוא בעל התהליך. החקירה גילתה ש-`ws-agent.ts`
דווקא **נכון** בניתוק נקי (`feWs.on("close")` מבצע detach בלי `child.kill`). הבאג הוא
בניתוק **לא-נקי**: ה-socket פולט אירוע `'error'`, אין לו listener בשום מקום → ב-Node זה
throw → `uncaughtException` → ה-handler הגלובלי ב-`server.ts:14-20` עושה `process.exit(1)`
→ כל ה-backend נופל, וה-child (spawn ללא `detached`) מת כ-collateral.

**ההכרעה: שלוש שכבות.** (0) `feWs.on("error")` שמטפל כמו close (detach idempotent,
בלי kill) — חוסם במקור. (1) error listeners על `echoWss`/`agentWss`/ws-echo — סותם
מקורות WS error נוספים. (2) הגנה בעומק — `uncaughtException` מסנן transient socket
errors (`isTransientSocketError` טהור: ECONNRESET/EPIPE/ENOTCONN/ECONNABORTED/ETIMEDOUT)
ולא יוצא עליהם, אבל **שומר** `process.exit` לשגיאות אמיתיות (קו-הגנה אחרון לגיטימי).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (2 findings, שניהם בתיאור הטסט/הבהרות — לא בקוד הייצור): (#1)
mock WS כ-EventEmitter לא מספק structurally את חתימת `ws.WebSocket` תחת strict → דרוש
`as unknown as WebSocket` (הבריף השמיט); (#2) `lint:i18n` חוסם רק string literals,
לא הערות — הבריף רמז על כלל מחמיר מדי. תוקנו. r2 = READY (1 finding 🟢 קוסמטי: ציטוט
מספר שורה :9→:6, עלות אפס — תוקן). כל ה-claims העובדתיים (שורות, symbols, paths)
אומתו 1:1, כולל אישור ש-ה-child לא detached ולכן מת עם ה-backend.

### שינויי-כיוון

- **שני באגים נפרדים זוהו, slice אחד מתקן רק את הקריסה.** ה-thrashing של אותו session
  בשני טאבים (MED-8 livelock) הופרד ל-slice עתידי (תועד ב-`roadmap.md` Track F) — בעיה
  של connection-arbitration, לא error-handling. לא מערבבים scope/verification.

### רעיונות שנדחו

- **ריכוך uncaughtException בלבד (בלי שכבה 0):** היה מסתיר את הבאג במקום לתקנו, ומסכן
  בליעת שגיאות אמיתיות. נדחה — שכבה 0 (טיפול במקור) היא התיקון הנכון; שכבה 2 רק
  belt-and-suspenders, מוגבלת לרשימת codes סגורה.
- **Backend-managed session ownership (HTTP/SSE transport):** פתרון-שורש לכל משפחת
  בעיות ה-WS, אבל refactor ארכיטקטוני גדול. נשאר ב-Future (roadmap) — לא נדרש כדי
  לעצור את הקריסה.

## 2026-06-16 — slice-npm-publish: אריזה ל-npm כ-tarball self-contained

### רציונל

המשך ישיר ל-slice-bunx-single-command (depends_on). המטרה: `bunx drive-coding`
מ-npm. הבדיקה הראתה ששני deps לא יושבים ב-registry — `@drive-coding/core` (workspace,
private, exports ל-`src/*.ts`) ו-`provider-contract` (git dep, 404 ב-npm, אבל בנוי עם
`dist/`). ההכרעה: **`bundledDependencies`** לשניהם — נארזים פנימה ל-tarball, בלי לפרסם
אותם בנפרד ובלי לדרוש git מהמשתמש הקצה.

ה-package המתפרסם = `packages/backend` ששמו משתנה ל-`drive-coding` (כבר מחזיק את ה-bin
ואת כל ה-runtime deps; אביגיל אימתה שאף אחד לא תלוי ב-`@drive-coding/backend` כ-import).
ה-FE build מועתק לתוך החבילה ב-`prepack` (`frontend-dist/`), וה-bin בוחר בין dev-path
ל-packaged-path לפי קיום הקובץ.

**Scope עד tarball שמתקין ורץ מקומית** — `npm publish` ל-registry הוא הצעד האנושי האחרון
(credentials + שם + אישור), מחוץ ל-slice.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings, 2 🔴). הקריטי (#1): `bundledDependencies` אורז את
**קבצי** core אבל לא את עץ ה-deps שלו — core מייבא `pino`/`pino-pretty`/`marked` שלא
מוצהרים ב-backend → התקנה נקייה קורסת ב-boot עם `Cannot find module 'pino'`, וזה נראה
מטעה כמו בעיית symlink. #2: ה-base branch (התלות) עדיין לא קיים. #4: `npm pack` מסרב
לארוז `private` bundledDependency. r2 = READY (נותר רק ה-gate התזמוני המתועד).

### שינויי-כיוון

- **הכרזת transitive deps על פני bundling רקורסיבי:** `pino`/`pino-pretty`/`marked`
  הוכרזו כ-`dependencies` של ה-package (מותקנים מ-registry), במקום לנסות לבנדל את כל
  עץ ה-deps של core. פשוט יותר ועמיד.
- **core הופך packable** (הסרת `private`, version 0.1.0) — בלי לפרסמו בנפרד.
- **gate תזמוני מפורש** ב-§0: ה-slice לא מתחיל לפני שה-branch של התלות קיים או נמרג ל-dev.

### רעיונות שנדחו

- **פרסום `@drive-coding/core` ו-`provider-contract` כ-packages נפרדים ל-npm:** "נכון"
  ל-monorepo אבל דורש תיאום-גרסאות ופרסום של 3 packages. נדחה לטובת bundledDependencies
  (חבילה אחת self-contained).
- **`npm publish` בתוך ה-slice:** נדחה — צעד אנושי אחרון אחרי merge.

## 2026-06-16 — slice-bunx-single-command: הרצה בפקודה אחת דרך bunx

> **2026-06-17 — מוזג ל-dev** (merge commit `ea7726f`, `--no-ff`). כלב: GO (light, 0 findings).
> מרדכי אימת runtime נוסף מעבר ל-DoD: `bun link` חשף את ה-`bin` כ-`drive-coding` גלובלי,
> הרצה מ-`/tmp` כפקודה עירומה → HTTP 200 + FE + API. אומת גם ש-`FE_STATIC_DIR ??=`
> מכבד env מפורש על פני ה-default (env precedence) כפי שתוכנן. אישור מיזוג מפורש מהמשתמשת.

### רציונל

המשתמש ביקש להריץ את הפרויקט "מ-npx בפקודה אחת". הפרויקט הוא monorepo (pnpm) עם
backend (Hono), frontend (SvelteKit/adapter-static), ו-core. הבדיקה הראתה ש**הבעיה
אינה ה-runtime** אלא אריזה: ה-backend כבר משתמש ב-`@hono/node-server` (אין `Bun.serve`
בקוד — ה-comment בטסט התיישן) ויודע להגיש את ה-FE הבנוי דרך `FE_STATIC_DIR` (single-origin).
מה שחסר: `bin` entry שמחבר את שני אלה בפקודה אחת.

**ההכרעה: `bunx` — לא Node, לא bundling.** שלוש עובדות הכריעו:
1. `tsconfig.base.json` עם `moduleResolution: "Bundler"` — הקוד מתוכנן ל-Bun/bundler,
   לא ל-`tsc → node`.
2. ה-plugin `packages/backend/plugins/prompt-injector.ts` **חייב להישאר .ts נגיש
   ב-runtime** — OpenCode טוען אותו דרך `file://` באמצעות Bun. bundling היה שובר אותו.
3. production (Dockerfile, systemd) כבר רץ עם Bun.

bunx מריץ את ה-TS ישירות כמו production — אפס מרחק בין dev ל-prod, ואפס עבודת bundling.

**Scope מצומצם בכוונה (JIT):** ה-slice הזה הוא ה-**mechanism** המקומי בלבד —
`bin/drive-coding.ts` שמגדיר `FE_STATIC_DIR`+`PORT` ומייבא את server.ts, launcher
שבונה FE אם חסר, ו-preflight. **פרסום ל-npm בפועל** (הסרת `private`, פתרון
`@drive-coding/core` workspace + `provider-contract` git dependency, `prepublishOnly`)
נדחה ל-slice המשך נפרד (`slice-npm-publish`), כדי ללמוד מה-mechanism לפני ה-publish.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). כל ההנחות הארכיטקטוניות הקריטיות אומתו — במיוחד
ש-`server.ts` הוא **self-starting on-import** (אין `startServer()`; `serve()` ב-top-level),
שעליה נשען כל ה-API skeleton. שני פערי-אימות אמיתיים: (1) `bin/` מחוץ ל-`src/` היה גורם
ל-`pnpm typecheck` לדלג עליו בשקט (false-positive ל-DoD); (3) פקודות האימות היו bash-only
בעוד סביבת ה-dev היא Windows/PowerShell. r2 = READY, 0 findings.

### שינויי-כיוון

לפי ממצא #1 — ה-bin הועבר מ-`packages/backend/bin/` אל **`packages/backend/src/bin/`**,
כך שהוא נכלל אוטומטית ב-`include: ["src/**/*"]` ו-typecheck מכסה גם אותו וגם את ה-`import`,
**בלי לגעת ב-`rootDir`/`outDir`**. זה עדיף על הרחבת ה-tsconfig (שהיתה משנה מבנה output).
כל פקודות האימות הומרו ל-PowerShell.

### רעיונות שנדחו

- **bundling ל-JS יחיד (node-compatible):** היה מאפשר `npx` על Node טהור ומעלים את ה-git/
  workspace deps — אבל שובר את טעינת ה-plugin דרך `file://` ומנוגד ל-`moduleResolution: Bundler`
  ולכל ה-production stack שרץ Bun. נדחה לטובת bunx.
- **פרסום ל-npm בתוך ה-slice הזה:** נדחה ל-slice נפרד (JIT — לא לבנות publish לפני
  שה-mechanism עובד ונבדק).

## 2026-06-18 — slice-release-package: package נפרד מבונדל ל-bunx (החליף את slice-npm-publish)

### רציונל

המטרה: `bunx drive-coding` עובד מהתקנה נקייה מ-npm. הדרך לשם התבררה רק אחרי
שלוש גישות שנפלו אחת-אחת באימות אמפירי (spikes):

1. **`bundledDependencies` (slice-npm-publish, נזרק):** ארז את core+provider-contract
   כקבצים בתוך ה-tarball. **עובד עם npm, נשבר עם bun** — `bun add`/`bunx` מתעלמים משדה
   `bundledDependencies` ומנסים לפתור מחדש את ה-specs המקוריים: `@drive-coding/core@workspace:*`
   (לא קיים מחוץ ל-monorepo) ו-`provider-contract@git+...` (repo **פרטי** → 404 ל-bun הלא-מאומת).
   מאחר שה-headline הוא `bunx`, זו חסימה.
2. **devDependencies:** הרעיון — להוציא את core/provider-contract מ-`dependencies` כדי ש-bun
   לא ינסה לפתור. אבל `bundledDependencies` **חייב להיות תת-קבוצה של `dependencies`** — npm
   הפסיק לארוז אותם (457→89 קבצים), וה-runtime קרס `Cannot find module @drive-coding/core`.
3. **git URL ציבורי / auth:** bun **יודע** git+https; ה-404 הוא כי ה-repo פרטי. אבל חבילה
   ציבורית לא יכולה לתלות ב-repo פרטי, ו-`workspace:*` של core אין לו git URL בכלל.

**ההכרעה: package נפרד `packages/release/` שמבונדל בזמן build.** `bun build` של ה-bin
מטמיע (inline) את core+provider-contract לתוך JS אחד → הם **נעלמים מגרף התלויות** → אין
מה לפתור, לא משנה איזה installer. external רק ל-`pino`/`pino-pretty` (worker-thread, לא
ניתנים ל-bundling — נשארים deps ציבוריים ש-bun פותר). ה-packages הקיימים
(backend/core/provider-contract) **לא נגעו** — נשארים workspace/git/private (זמני, יהפכו
ל-public בעתיד). זה היפוך מודע של ההחלטה של slice-bunx ("no bundling") — שתי הסיבות שלה
פגו: (א) אומת שה-plugin (`file://` ע"י תהליך opencode נפרד) **לא** מבונדל ולכן לא נשבר;
(ב) `bundledDependencies` ⊥ bun הוכח אמפירית. בחירת המשתמשת: package נפרד על-פני עריכת
ה-monorepo "הזמני".

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). שני 🔴 חשובים: (#1) ה-brief תיאר את ה-bin של
slice-npm-publish (dual-layout) במקום את ה-bin האמיתי של dev (single-line) — ה-spike
רץ על הבסיס הלא-נכון; (#2) ה-script `build` היה נתפס ע"י `pnpm -r run build` ומפעיל
build כבד לא-מכוון. תוקנו: ה-script שונה ל-`bundle`, וה-Commit עודכן ל-bin האמיתי
(single-line + הוספת `existsSync`). r2 = READY, 0 findings.

### שינויי-כיוון

- **הנגיעה היחידה ב-backend**: ה-FE cascade ב-`src/bin/drive-coding.ts` שונה ל-2-candidate
  (`../frontend-dist` ל-bundle, `../../../frontend/build` ל-dev) — שיפור path-resolution
  כללי, לא מחיקת תלויות. אומת לשני ה-layouts.
- **guard ל--sourcemap**: התגלה באג ב-bun 1.3.14 — `bun build --sourcemap --outfile` מתעלם
  מ-`--outfile` ופולט לתיקיית ה-entry. נוגע רק ל-build של release (לא ל-dev, ששם אין
  bundling). הוגן guard דו-שכבתי: `files` מצומצם ל-`dist/drive-coding.js` בלבד + assertion
  ב-build.mjs שמפיל את ה-build אם `.map` מופיע או אם הבאנדל חסר. מאומת ששתי השכבות תופסות.

### רעיונות שנדחו

- **`bundledDependencies` (slice-npm-publish):** נזרק — ⊥ bun (ראה רציונל). ה-worktree
  וה-branch נמחקו (לא merged).
- **bundling בתוך backend (טיוטת slice-bundle-single-artifact):** היה דורש מחיקת deps
  ושכתוב prepack של backend. נדחה לטובת package נפרד — additive, הפיך, בלי לגעת ב-monorepo
  "הזמני" (בקשת המשתמשת).
- **release-own bin shim (אפס נגיעה ב-backend):** היה מונע את הנגיעה ב-bin, אבל משכפל את
  לוגיקת ה-preflight/URL. נדחה — ה-cascade הוא שיפור כללי ובטוח ממילא.
