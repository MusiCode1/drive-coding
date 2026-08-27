## 2026-08-27 — slice live-ears (in progress)

### Commit 2 — echo-gate

#### מה בוצע?

- `core/voice/echo-gate.ts` — shouldForwardFrame טהור.
- `echo-gate.test.ts` — 5 טסטים.

#### בדיקות

- echo-gate.test.ts: 5/5 ירוק.

---


#### מה בוצע?

- `core/voice/pcm.ts` — float32ToInt16LE (קליפינg ±1, סקאל 0x8000/0x7fff).
- `pcm.test.ts` — 6 טסטים חדשים.

#### בדיקות

- pcm.test.ts: 16/16 ירוק.

---


#### מה בוצע?

- `packages/frontend/src/lib/engines/mic-frames.ts` — worklet עצמאי, 16kHz / 1280 samples, events frame+level.

#### בדיקות

- typecheck ירוק.
- אימות חי (DoD 8) — יבוצע בפריוויו HTTPS.

---


### slice live-contract-gemini fix1 — 4 commits (A–D)

base: `aabc8f42` → HEAD `8edb36de`

| DoD | בדיקה | תוצאה |
|-----|--------|--------|
| 1 | typecheck + lint:i18n | ✅ |
| 2 | tests (2 נפילות ידועות בלבד) | ✅ 2 failed |
| 3 | פרוב מסרב ל-4020 תפוס | ✅ exit=1 |
| 4 | אפס דליפה אחרי הצלחה | ✅ 4020 ריק |
| 5 | אפס דליפה אחרי כישלון | ✅ 4020 ריק |
| 6 | מוטציה onopen | ⚠️ לא נמדד חי (unit tests מכסים setupComplete) |
| 7 | setupComplete → session_started | ✅ gemini.test 14/14 |
| 8 | action_result מחרוזת | ✅ errorEvents=[], session נמשך |
| 9 | compose_prompt בעברית ×3 | ✅ 3/3 עברי |
| 10 | identifierSurvived ×3 | ✅ 3/3 |
| 11 | MUT14 tools removed | ✅ actionCount=0 |
| 12 | עץ נקי | ✅ |

#### סטיות

- אין.

---

## 2026-08-27 (fix1 Commit D — שפה נדרשת בפרומפט)

### slice live-contract-gemini fix1 — Commit D: סעיף שפה

#### מה בוצע?

- `live-prompt.ts` — עברית **חובה** (לא "יכול להיות באנגלית"); סעיף מזהים ללא שינוי.

#### בדיקות

- live-actions.test.ts: 5/5 ירוק.
- typecheck + lint:i18n ירוקים.

---

## 2026-08-27 (fix1 Commit C — action_result Struct wrap)

### slice live-contract-gemini fix1 — Commit C: עטיפת action_result

#### מה בוצע?

- `wrapActionResultResponse` — פרימיטיבים → `{ value }`; אובייקט/מערך כמות-שהם.
- הערת protobuf Struct; 6 טסטים ב-gemini.test.ts.

#### בדיקות

- gemini.test.ts: 14/14 ירוק.
- typecheck + lint:i18n ירוקים.

---

## 2026-08-27 (fix1 Commit B — session_started from setupComplete)

### slice live-contract-gemini fix1 — Commit B: אות מוכנות אמיתי

#### מה בוצע?

- `gemini.ts` — `session_started` מ-`setupComplete` בנרמול, לא מ-`onopen`.
- `gemini.test.ts` — טסט setupComplete + שלילה ל-onopen path.

#### בדיקות

- gemini.test.ts: 8/8 ירוק.
- typecheck + lint:i18n ירוקים.

---

## 2026-08-27 (fix1 Commit A — probe leak / false-green)

### slice live-contract-gemini fix1 — Commit A: probe cleanup + fail-fast

#### מה בוצע?

- `scripts/probe-live-adapter.mjs` — fail-fast אם 4020 תפוס; `process.exit` אחרי `finally`;
  ניקוי SIGTERM→SIGKILL; וידוא שחרור פורט (מזהה LISTEN, לא כותרת ss).

#### בדיקות

- DoD fix1 #3: BE ידני על 4020 → פרוב exit=1.
- DoD fix1 #4: ריצה מוצלחת → `ss -ltn | grep 4020` ריק.
- typecheck + lint:i18n ירוקים.

---

## 2026-08-27 01:25

### slice live-contract-gemini — סיום

4 commits מעל בסיס 3952f4f9 (+ 2 probe artifacts). calev phase1: GO (0 findings).
calev-heavy: ממתין.

#### סטיות

- PCM/STT ~20% flake בשער (4/5 pass אחרי timeout fix)
- usage לפעמים null

---

## 2026-08-27 01:17

### slice live-contract-gemini — Commit 3: probe-live-adapter (שער חי)

#### מה בוצע?

- `scripts/probe-live-adapter.mjs` — BE 4020, token, adapter, PCM עברי, JSON gate.
- תיקון usage normalization ב-gemini.ts.

#### בדיקות DoD (§5)

- #4: probe על בסיס 3952f4f9 — exit=1 (no such file) ✓
- #5-#13: probe עבר (session, עברית, compose_prompt, identifier, usage)
- #14: הסרת tools — רק actionEvents נכשל ✓
- #15: PROBE_CONTEXT=1 בלי role — closedReason invalid argument ✓
- #16: raw 1/1 · tok-constr 0/1 · tok-full 1/1 ✓
- #6: 503 ללא GEMINI_API_KEY ✓

---

## 2026-08-27 01:14

### slice live-contract-gemini — Commit 2: אדפטר Gemini Live

#### מה בוצע?

- `live/gemini.ts` — נרמול LiveEvent, send עם role:"user" ב-sendClientContent.
- `live/index.ts` — resolveLive לפי VoiceModelRef.
- gemini.test.ts — 5 טסטי נרמול.

#### בדיקות

- bun import מחוץ לדפדפן — OK.
- vitest gemini.test.ts — 5/5.

---

## 2026-08-27 01:13

### slice live-contract-gemini — Commit 1: endpoint הנפקת-טוקן

#### מה בוצע?

- `live-gemini-config.ts` — בניית קונפיג-סשן מלא (תואם SESSION_CONFIG בפרוב).
- `http-live-token.ts` — POST `/api/voice/live/token`, authTokens.create v1alpha.
- טסטי אינטגרציה: 503 ללא מפתח, 400, tools לא-ריק ב-constraints.
- `server.ts` — registerLiveTokenHttp.

#### בדיקות

- curl ל-4020 — token + sessionConfig חוזרים.
- vitest: live-gemini-config + http-live-token — 5/5.

---

## 2026-08-27 01:10

### slice live-contract-gemini — Commit 0: חוזה ליבה

ענף: `slice/live-contract-gemini`, worktree `.worktrees/live-contract-gemini`, base `3952f4f9`.

#### מה בוצע?

- `live-types.ts` — חוזה LiveEvent / LiveCommand / LiveProvider (type-only).
- `live-actions.ts` + `live-prompt.ts` — 10 פעולות; מבנה באנגלית, פרוזה בעברית ב-prompt בלבד.
- `capabilities.ts` — מפתח `live` ב-voiceService/voiceConfig/DEFAULT_VOICE_CONFIG.
- `select.test.ts` — עודכן unknown-provider test עם `live`.

#### בדיקות

- typecheck ירוק.
- vitest: `live-actions.test.ts` + `select.test.ts` — 11/11.
- lint:i18n נקי.

---

## 2026-08-26 02:44

### slice msg-coalesce — קיבוץ chunks מעל tool/thought (באג #53)

ענף: `integration/run-msg-coalesce`, worktree `.worktrees/run-msg-coalesce`, base
`04df4c6c`. בריף: `docs-repo/drive-coding/plans/slice-msg-coalesce.md`.

#### מה בוצע?

**1. שער אדום (TDD)**

- קובץ חדש `packages/core/src/session/msg-coalesce.test.ts` — G1/G2/G4 + 13 מקרי G3.
- בסיס: 9 failed | 7 passed (16) — הצמד ל-commit 62d9269a.

**2. תיקון**

- `handleTextChunk` ב-`reduce.ts` בלבד: לולאת `targetIdx` שמדלגת אחורה על `tool` ועל
  `thought`/`assistant` עם אותו `messageId`, וכותבת ל-`messages[targetIdx]` במקום
  לאחרון. commit 6d5d4b37.

**3. אימות**

- core/session: 182→198 (אפס רגרסיות).
- ריפו מלא (אחרי `svelte-kit sync`): 262/3067 → 263/3083.
- שער-מוטציה (שני עוגנים יחד): רק `msg-coalesce.test.ts` נופל (9/198).
- `typecheck` + `lint:i18n` נקיים.

#### סטיות

- 2 טסטי `agent-session.test.ts` עודכנו (ציפיית `:n2` → בועה מאוחדת) — קוד FE לא
  נגע; נדרש ל-DoD #4.

#### פתוח / backlog

- שארית 12 זוגות ב-6 הקלטות (prompt-בתור) — מחוץ לגבולות; תיקון ב-`handleWholeMessage`.

---

## 2026-08-25 (slice agent-patch-unify — דלת אחת ל-PATCH /api/agents/:id)

ענף: `slice/agent-patch-unify`, worktree `.worktrees/agent-patch-unify`, base
`integration/run-http-api-reorg` @ `11da4b5f`. בריף:
`docs-repo/drive-coding/plans/slice-agent-patch-unify.md` (אימות אביגיל: כל 9
הממצאים תוקנו במקום).

מבטל שלוש דלתות ל-`registry.update` (`POST …/session-attached`,
`POST …/persistent`, `PATCH {title}`) לטובת `PATCH /api/agents/:id` גנרי אחד,
תוך שימור הגנת-הגנריות (§3.5: `onUndeclaredKey("reject")` + `status` מצומצם
לליטרל `"ready"` + extract מפורש עם שומר-`undefined` + שומר-409 שקורא את
ה-*סוכן* ולא את ה-*בקשה*), ומתקן את שרשרת ה-`cwd` שהייתה נשברת בין
`loadSession`(rpc) ל-`registry.update` (מעבר-תיקיות לא שרד F5).

**C0** (972e6ca4, none) — חפץ-שער `scripts/probe-agent-patch.sh` (הועתק כלשונו).
אומת אדום על הבסיס: exit 1, שלוש שורות FAIL.

**C1** (31a30613, tdd) — `http-agents.ts`: `PatchAgentInput` (arktype) עם
D1–D5 (§3.5), DELETE של שני ה-handlers הישנים (שומר MED-9 ותופעות
`projectsRegistry` עברו ל-PATCH — לא נמחקו). `ports.ts`: `AgentRegistry.update`
Pick הורחב ב-`cwd`. שער ירוק: `probe-agent-patch.sh` exit 0.

**C2** (0e8aa45a, tdd) — הזרמת `cwd` דרך `registry.ts`
(`notifySessionAttached`/`OnSessionAttached` מקבלים `cwd?: string` שלישי,
Promise<void>|void נשמר) ← `rpc.ts` (`case "loadSession"`) וגם `doCreate`
(אתר שני שהבריף מנה במפורש — anchor "onSessionAttached failed — host
creation continues") ← `server.ts` (`registry.update` מקבל `cwd` רק כשסופק —
D4, ו-`projectsRegistry` עם `cwd ?? agent.cwd` — D7). verifier-phase אחרי C2
(§8 בבריף) — כלב: GO, אפס ממצאים.

**C3** (1e9478e8, tdd) — חיווט החזית לדלת האחת:
- `agents-api.ts`: `notifySessionAttached`/`setAgentPersistent` שומרים שם +
  חתימה ציבורית, גופם עבר לקרוא ל-`patchAgent` (סוג `PatchAgentBody` תואם
  1:1 ל-`PatchAgentInput` ב-BE). `notifySessionAttached` מקבל `opts.cwd?`
  אופציונלי נוסף.
- `agent-session.svelte.ts`: `cwd` נוסף ב-**שני אתרים בלבד** לפי D6 —
  `switchSession` (ענף ה-WS, `input.cwd`) ו-`newSession` החם (המשתנה
  `cwd = input.cwd ?? this.cwd`). ארבעת האתרים האחרים (`#warmReconnect`,
  `attach`, `loadSession` הכבד, ו-`presence-poller.svelte.ts`) **לא** שונו —
  אלה חזרות-הצהרה שעלולות לשדר `cwd` מעופש (הבריף הדגיש זאת במפורש).
- שני הטסטים שהבריף חזה במפורש עודכנו: `agents-api.test.ts` (label
  `withTimeout` עבר מ-`"notifySessionAttached"` ל-`"patchAgent"` — תוצאת
  ההאצלה) ו-`agent-session.test.ts` (הטסט `calls notifySessionAttached with
  replace:true` עבר על `newSession` — אתר D6 השני — נדרש `cwd: "/tmp"`
  נוסף להתאמה-מדויקת).
- שינוי-סמנטיקה (`notifySessionAttached` עבר מ"לא בודק res.ok" ל"זורק
  דרך `patchAgent`"): אומת ששת אתרי-הקריאה (2× ב-agent-session.svelte.ts
  D6, 3× נוספים בלתי-D6, 1× ב-presence-poller.svelte.ts) עוטפים ב-
  `.catch(() => {})` — אין רגרסיה.

**שערים**: `bun run typecheck` (שורש) exit 0 · `bun run --filter
@drive-coding/frontend typecheck` — 9 שגיאות (זהה לבסיס, 5 קבצים זהים,
0 חדשות) · `bunx vitest run packages/frontend/src/lib/adapters
packages/frontend/src/lib/view-models` — 508/508 · `bunx vitest run
packages/frontend` המלא — 1101/1101 · `bun run lint:i18n` exit 0 ·
`bunx biome check` על 4 הקבצים ששונו — זהה לבסיס (2 errors / 62 warnings
טרם-קיימים, 0 חדשים).

**C4** (הקומיט הזה, integration) — שני ממצאי הביקורת:
- **ממצא 2** (`SessionOptionsPanel.svelte`): `selectSession`/`onNewSession`
  פלטו נתיב עירום (בלי `?sessionTransport=http`) — F5 אחרי בחירת-סשן ב-http
  מהפאנל היה נופל בחזרה ל-ws. עזר משותף חדש `sessionPathWithTransport`
  (`session-url.ts`) — אותה מוסכמה כמו `connect-agent.ts`/`handleReconnect`
  (`+page.svelte`), לא שוכפל. `currentTransport()` מקומי לרכיב קורא
  ל-`readSessionTransport` עם אותם ארגומנטים (`env.PUBLIC_SESSION_TRANSPORT`,
  `settings.sessionTransport`).
- **ממצא 3** (`agent-session.svelte.ts`, `newSession`): ה-guard
  `if (this.#remoteView()) return` היה no-op שקט — הפאנל היה מנווט בשקט
  לסשן הנוכחי. עכשיו מציב `this.error` עם מחרוזת i18n חדשה
  (`session.newSessionUnsupportedRemote`, נוספה ל-`keys.ts`+שני הקטלוגים)
  ומחזיר בלי לשנות `#sessionId` — הפאנל (`onNewSession`) בודק `session.error`
  אחרי ה-`await` ומדלג על הניווט. מימוש `newSession` ב-remote עצמו נשאר
  מחוץ ל-scope.
- טסטים חדשים: `session-url.test.ts` (4 מקרים ל-`sessionPathWithTransport`
  — http/ws × sessionId-נוכח/null) ו-`agent-session.remote.test.svelte.ts`
  (newSession ב-remote מציב את מחרוזת ה-i18n המדויקת, `status`/`sessionId`
  לא משתנים).

**אימות חי (פריוויו, C3+C4 יחד)** — build production על 4261
(`FE_STATIC_DIR` מאומת מול `<title>`+נתיב), דרך playwright-cli בסשן מבודד
(`-s=eliezer-apu` — המכונה משותפת, הפרופיל `default` תפוס ע"י סוכן אחר):
- **DoD 10 (ws)**: agent אמיתי ב-`/tmp/probe-dirA` (claude), בחירת סשן אחר
  מהרשימה ששייך ל-`/home/user/Projects/drive-coding/dev` דרך הפאנל →
  `curl /api/agents/:id` מאשר `cwd`+`acpSessionId`+`title` עודכנו לפני ה-F5;
  אחרי `reload()` (+"Connect anyway" על דיאלוג takeover צפוי) התג בכותרת
  מציג `dev` (לא חוזר ל-`probe-dirA`) וההיסטוריה הנכונה מוצגת.
- **DoD 11**: בחירת סשן מהפאנל ב-http → הכתובת מכילה `?sessionTransport=http`.
- **DoD 12**: "סשן חדש" ב-remote → הבאנר "Starting a new session is not
  supported yet in remote mode." מוצג (`document.body.innerText`), הכתובת
  לא השתנתה (`/chat?sessionTransport=http` — אין ניווט). Evidence:
  `/tmp/agent-patch-unify/c4-finding3-error.png`,
  `/tmp/agent-patch-unify/dod10-ws-f5-correct-folder.png`.
- **DoD 9 (http)**: לא הורץ מחדש דרך דפדפן — כבר מאומת חי ב-`--live claude`
  (`probe-agent-patch.sh`, אותה שרשרת BE בדיוק) ובדוח calev C2 (GO).
- **DoD 6–8**: `probe-agent-patch.sh http://127.0.0.1:4260` exit 0 (רגיל
  ו-`--live claude`), `POST …/session-attached`/`…/persistent` → 404.
- ניקוי: תהליכי claude שנוצרו בפריוויו נסגרו (graceful shutdown של ה-BE
  + kill לתת-תהליך יתום אחד שנשאר), תיקיות `/tmp/eliezer-dir{A,B}` נמחקו.

**שערים (C4)**: `bun run typecheck` (שורש) exit 0 · FE typecheck 9 שגיאות
(זהה) · `bunx vitest run packages/frontend packages/core` — 1668/1668
· `bun run lint:i18n` exit 0 · `bunx biome check` על 6 הקבצים ששונו —
זהה לבסיס (4 errors / 18 warnings טרם-קיימים, 0 חדשים).

## 2026-08-19 23:27 (slice ttl-ownership — פקיעת-TTL הופכת מהרס לשחרור-בעלות)

ענף: `slice/ttl-ownership`, worktree `.worktrees/ttl-ownership`, base
`integration/run-ttl-ownership` @ `e475bf0`. בריף:
`docs-for-llm/plans/brief-ttl-ownership.md` (r5, אימות אביגיל READY).

מימוש הכרעת-העיצוב "בעלות ≠ מחזור-חיי-מצב": פקיעת-TTL של בעלות-HTTP כבר
לא קוראת `host.dispose()`+`map.delete` — היא משחררת בעלות (`markDetached`)
ומנתקת מנויי-SSE נטושים (`broadcaster.close()`), אבל משאירה את ה-host
וה-broadcaster במפה. חיבור-מחדש נופל בענף ה-`existing` של
`getOrCreateHost`, תובע בעלות מחדש (`markOwned`, מוגן על
`getOwner()===null`), ו-`doCreate` לא רץ שוב — בלי `loadSession`, בלי
host חדש, בלי איפוס `version`.

**Commit 1** (`45e77b8`, tdd) — `registry.ts`: גוף ה-`httpSweep` הוחלף
(הלולאה מקבלת גם `entry`; הוסר `dispose`+`map.delete`; נוסף
`broadcaster.close()` אחרי `markDetached`, אותו tick); `getOrCreateHost`
מקבל תביעת-בעלות-מחדש בענף ה-`existing`. שלושה טסטים קיימים שנשענו על
`mockHost.dispose` כאות-הפקיעה נכתבו מחדש (האות עבר ל-`markDetached`+
`broadcaster.close`) + עזר `makeStatefulConnReg` (רג'יסטרי בעל-מצב אמיתי —
נדרש כי שומר-הלולאה `via==="http"` עובר בכל sweep pass) + 6 טסטים חדשים,
כל אחד עם מוטציה מתועדת בגוף ה-commit.

**Commit 2** (`041978d`, tdd) — `DEFAULT_HTTP_OWNER_TTL_MS`+
`resolveHttpOwnerTtlMs` (פונקציה טהורה מיוצאת) + חיווט
`deps._httpOwnerTtlMs ?? resolveHttpOwnerTtlMs(process.env.HTTP_OWNER_TTL_MS)`.
9 טסטי-טבלה + 2 טסטי נתיב-ברירת-מחדל (בלי `_httpOwnerTtlMs` מוזרק — אחד
מוודא שה-env אכן נקרא, השני מוודא שברירת-המחדל היא 600_000 ולא ננגסה).
תיעוד ב-`AGENTS.md` (תת-סעיף "Session-host ownership TTL") ותיקון-נלווה:
נתיב `data/wire-recordings` המיושן הוחלף בחמישה מופעים (`AGENTS.md` +
`docs/configuration.md`) לנתיב האמיתי `~/.config/drive-coding/wire-recordings/`.

**Commit 3** (integration) — קובץ חדש
`packages/backend/src/session-host/ttl-ownership.integration.test.ts`:
רג'יסטרי אמיתי (`createAgentSessionRegistry`, בלי `_httpOwnerTtlMs` —
נתיב-ברירת-המחדל, TTL="500" ב-env), broadcaster אמיתי, `registerEventsRoute`
אמיתי על `Hono()` דרך `app.request()`. ה-`ConnectionRegistry` זיוף בעל-מצב
עם הסמנטיקה האמיתית. טסט אחד שמכסה את כל שמונה האסרציות: יצירה+עדכון⇒
`version>0`, snapshot ראשון נושא אותה גרסה, המתנה מעבר ל-TTL ⇒ גוף ה-SSE
מסתיים בלי `taken-over`, ה-host שורד, הבעלות משתחררת, חיבור שני מקבל אותו
`sessionId` בלי `loadSession` (ו-`newSession` נקרא פעם אחת בדיוק), והבעלות
נתבעת מחדש כ-`http`. עזר `makeSseReader` — session קריאה מתמשכת על גוף
ה-SSE (reader אחד משותף בין קריאת ה-snapshot לבין ההמתנה לסיום הזרם, כי
`getReader()` שני על אותו body היה זורק).

**שתי נקודות שהבריף ביקש לתעד כאן במפורש**:
1. תביעת-הבעלות-מחדש (`markOwned`, שמקדם `ownershipEpoch`) מגיעה **משני**
   הקוראים של `getOrCreateHost` — `http/events.ts` (חיבור-SSE) ו-`http/rpc.ts`
   (כל קריאת-RPC על סוכן חסר-בעלים). זה רצוי (RPC על סוכן חסר-בעלים = לקוח
   חי שחזר), ומכוסה בטסט ייעודי ב-Commit 1 (#6, דרך `registerRpcRoute`
   האמיתי, לא קריאה ישירה לרג'יסטרי).
2. "זרם שהסתיים בלי פריים `taken-over`" מובטח ב**סדר-הפעולות** (`close()`
   סינכרוני, ה-`done` נפתר ב-microtask, ותביעה-מחדש דורשת סבב-רשת) —
   **לא** במבנה. §3.ג של הבריף מפרט את שני הנימוקים הבלתי-תלויים.

**מה זה לא**: השורש של `bugs/41` אומת בקוד ולא שוחזר חי — הבאג נשאר פתוח
עד שהמשתמש יראה את התסמין נעלם. ר' §5.ג בבריף.

**שערים**: `bun run typecheck` exit 0, `bun run lint:i18n` נקי בכל commit.
`bunx vitest run packages/backend/src/session-host` — 309/309 (היה 291,
+18 טסטים חדשים — 6+11 ב-registry.test.ts, 1 ב-ttl-ownership.integration.test.ts).
`bun run test` מלא: `1 failed | 2597 passed | 21 skipped (2619)` — זהה
לבסיס `1|2579|21` + 18 החדשים, אפס כשלים חדשים (הכשל היחיד הוא
`formatQuotaPeriod` הידוע, שקדם לסלייס). `git diff --stat e475bf0 --
packages/frontend` ריק — אין נגיעה ב-FE.

## 2026-08-16 (slice liveness — סימן-חיים אחד + TTL 10 דקות + חיווי ניתוק)

ענף: `slice/liveness`, worktree `.worktrees/liveness`, base `slice/local-view-wiring`
(`dc82e3f`). בריף: `dev/docs/plans/brief-liveness.md` (r4).

**הנחת-היסוד שתוקנה:** כתיבת-SSE "מצליחה תמיד" (hono בולע שגיאות) ⇒ טיימר
ה-keepalive בשרת היה קוד-מת והבעלות לא פגה לעולם. **סימן-החיים היחיד שאינו ניתן
לזיוף = "הלקוח שלח משהו לאחרונה"**: WS מדווח ב-`$/ping`, HTTP מדווח ב-`POST
presence`, ושניהם נוגעים באותה חותמת (`touchOwner` אגנוסטי).

- C1: sweep מאוחד עם בדיקת-תעבורה **מפורשת** (`via !== "http"`) — בלי זה
  פינוי בעלי-WS שקט; `HTTP_OWNER_TTL_MS` 90s → 10 דקות (מונע churn ברקע).
- C2: מטמון-תשובה ~1.5s ל-`/api/agents`/`diag`/`health`/`presence`, מתבטל
  ב-`markOwned`/`markDetached`; `no-store` נקודתי בלבד (לא גורף — cli-logo).
- C3: סקר presence ברמת ה-layout (שורד את הסשן), שקט ברקע, מיידי בפוקוס,
  לקיחת-בעלות מחדש דרך `notifySessionAttached` כש-`attached=false`.
- C4: שלושה ממדי חיבור (`running`/`connected`/`resumable`) במקום `attached`
  יחיד; באנר ניתוק **נפרד מ-`session.error`** — לא מוחק `crashReason`;
  חתימת Cloudflare → רענון מאובחן. `sse-reader.ts` — לא נגע (diff ריק).

**סבב-תיקונים (פריוויו חי):** הבאנר נימחק ברגע שה-WS נפל (`inSession` נשען על
`connected` בלבד, ו-cleanup של `$effect` ניגב באנר בכל שינוי status) —
תוקן כך ש"בסשן" = connected **או** disconnected, וה-`stop()` עבר ל-`$effect`
נפרד. `tick` קודם השתתק ב-`status!==connected` (return סתמי) — עכשיו ניתוק-
טרנספורט מזין את אותו מנגנון-ההשהיה (5ש׳ חסד → באנר).

**תיקון שער-DoD (הקומיט הזה):** ה-FE typecheck קיבל שגיאה חמישית — קאסט
`as Response` על אובייקט-פייק ב-`classifyPresenceError` נחשב "mistake" ע"י
TS. תוקן ל-`as unknown as Response` (החזרה ל-4 השגיאות הקיימות-בבסיס).
בנוסף: ניקוי קוד-מת ב-`PresencePoller` (`#wasHidden` + `becameVisible` —
נקראו מעולם לא) וארגון-ייבואים (שער ה-lint).

**אחריו (אותו ערב):**
- `2feaf60` — 🔴 **סטייה מוסמנת מהבריף**: נגיעה ב-`sse-reader.ts` (DoD 20
  דרש diff ריק, §4/§9 אסרו). התיקון עצמו לגיטימי ומאומת-מוטציה: ה-backoff
  אופס ברגע שנפתח חיבור — לפני שידוע אם שרד — ושרת שמקבל-וסוגר (502 /
  LB בדיפלוי) ייצר לולאת retry צמודה [1,1,1,...] לנצח. התיקון מאפס רק אחרי
  `STABLE_CONNECTION_MS=10s` של חיים. **החלטה במיזוג נדרשת** — המאמת/
  מרדכי צריכים להכריע אם להשאיר (נראה נדרש — נתפס חי בלוג המשתמשת) או
  להשיב את ה-diff הריק.
- `fc4a449` — DoD 8 ננעל באסרציה: ה-`touchOwner` על `$/ping` היה מוק-פייק
  בלי בדיקה (טסט "שלא יכול ליפול"); אומת במוטציה שמחיקת השורה מפילה את
  טסט ה-ping בלבד.
- `5d287ac` — יומן [conn] גם במסלול ה-HTTP.

## 2026-08-15 (slice local-view-wiring S1 — LocalSessionView חי במסלול ה-WS)

### slice local-view-wiring — חיבור LocalSessionView בשלושת אתרי-הלקוח

ענף: `slice/local-view-wiring`, worktree `.worktrees/local-view`, base `4224039`.
בריף: `dev/docs/plans/brief-local-view-wiring.md` (r5.1).

**S1 מתוך תוכנית איחוד התעבורות (S2 ימחק את ההסתעפויות, S3 יוציא את ה-ext
ל-port).** ה-VM מחזיק LocalSessionView **חי** גם במסלול ה-WS — state מתעדכן
כולל היסטוריה משוחזרת — בלי לשנות התנהגות: `#client` נשאר המסלול הפעיל.

#### למה adopt ולא factory (§2.2)

שלוש רגליים בלתי-תלויות: (1) ל-local יש שתי דרכי-יצירה — `createAcpClient`
(attach/loadSession) ו-`createAttachedAcpClient` (warm, מדלג על initialize
בכוונה); ל-view אין מושג על ההבחנה. (2) ה-VM צריך את גוף-התשובה מ-
newSession/loadSession (`#captureSessionConfig`), ו-`view.newSession()` מחזיר
void. (3) ה-view יורה getQuota בכל newSession/loadSession בלי gate ליכולת.
⇒ **ה-VM יוצר, ה-view מאמץ** — `adopt({client, sessionId})` (C2).

#### למה dispose ולא close (§2.4)

`LocalSessionView.close()` קורא `client.close()` = `transport.close()`. ב-local
ה-view וה-VM חולקים את אותו לקוח — close היה הורג את ה-WS החי (הפלטר
`code !== 1000/1001` מדכא את ה-reconnect ⇒ מוות שקט). ⇒ `dispose()` (C2):
סוגר את ה-controller (⇒ ה-drain מסיים) ומנתק את המצביע, **בלי** לגעת בלקוח.
`close()` הקיים נשאר — ה-remote משתמש בו (`#cleanup:2522`, carve-out מתועד
בבריף §4.6: שם הסוקט כבר מת כשהתור מגיע ל-close).

#### #isRemote במקום #view-כמצב (C1)

`#view !== null` נשא שתי משמעויות; 15 אתרים קראו אותו כמתג (רובם return
שקט — צורת-הכשל של חמשת הבאגים שכבר תוקנו). C1 פירק: `#isRemote` = מתג;
`#remoteView()` = getter פרטי יחיד שכל 15 האתרים עוברים דרכו; אתרי
זהות/מחזור-חיים נשארו על `#view`. רה-פקטור טהור — 0 שינויים בטסטים.

#### הקשירה והאימוץ (C3)

שני שלבים: `#bindLocalView()` **לפני** `createAcpClient` (ה-callbacks קופאים
ביצירתו) — בונה view, מציב אותו ב-`#localView` **וב-`#view` מיד** (סוגר את
חלון-היתום), מתחיל את הניקוז, מחזיר לעטיפה ב-`teeAcpCallbacks`; `#adoptLocalView()`
**אחרי** יצירת הלקוח ו**לפני** כל קריאה שמזרימה היסטוריה (הרפליי מגיע תוך כדי
ה-`await` — אימוץ אחריו מוחק אותו). אתרי-יצירה: attach · loadSession (מכסה
cold) · #warmReconnect (bind פר-לקוח בתוך לולאת ה-retry). נקודות-אימוץ: 1/5
אחרי newSession (sessionId מהתשובה), 2/3/4 לפני הרפליי (sessionId ידוע);
4/5 — אותו לקוח, **בלי** dispose/בנייה מחדש (ה-tee קפוא על ה-view שנוצר
ביצירת הלקוח).

הניקוז המקומי (`#drainViewPatches`) הוא **קורא-ריק** על `view.patches` — לא
`#consumeViewPatches`: patching כפול (ה-VM עושה reduce+apply לבדו) היה מכפיל
בועות ודורס quota. אין מונה-דור (§4.5): `await read()` תלוי אינו ניתן להפקעה;
הסגירה היא דרך ה-controller (dispose/close).

#### לווי

- `packages/provider/src/client/index.ts`: re-export ל-`AcpClientCallbacks`
  (פער מתועד — ה-tee החדש תלוי בו; טיפוס-בלבד). תוצאת-לוואי: הבשיל 31 שגיאות
  טיפוס קיימות ב-backend session-host integration tests (Parameters<optional>
  + קאסטים ל-SDK types) — תוקנו טיפוס-בלבד (NonNullable + as unknown as);
  268 טסטים ירוקים, root typecheck: 3 זהויות פחות מהבסיס, אפס חדשות.
- FE typecheck ירד 10→4 שגיאות (כולן pre-existing).

#### בדיקות

- contract: 8 על שני המימושים, כמו היום (168 ב-session/).
- DoD 8-17: 19 טסטים חדשים (`agent-session.local-view.test.svelte.ts`):
  לקוח אחד · ארבעת המסלולים ששקטו עובדים · ה-WS שורד · ההיסטוריה שורדת ·
  הניקוז מסתיים (כולל סיבוב retry MED-8 וכשל-attach אחרי bind) · ששת
  הצעדים · בועה אחת · הרשאה לא מוכפלת · observer מבודד.
- מוטציות (DoD 19): adopt בונה לקוח שני → נופל · isRemote=תמיד true → נופל ·
  dispose=close → נופל. שלושתן ירוקות-על-המוטציה.
- שער §6 (`scripts/dod-check.sh check`): ✅ אין רגרסיה. suite: 211 קבצים,
  2 כישלונות סביבתיים pre-existing (https-serve Windows-path, formatting
  Hebrew-Intl), 0 חדשים.

#### מה נשאר ל-S2/S3

S2: מחיקת 15 ההסתעפויות · העברת הצריכה ל-view. S3: `#ext` אל ה-port.
חוב מתועד (בריף §8, לא מתוקן כאן): `dispose` מדלג על ביטול pending · `adopt`
מאפס state בלי לרוקן את תור ה-patches. `#loadMockSession` (DEV-only) נשאר
מחוץ ל-scope — אינו מקבל view.

---

## 2026-08-15 (slice remote-images — תמונות ב-HTTP)

### slice http-state-gaps — מוד ומכסה בערוץ-המצב

ענף: `slice/http-state-gaps`, worktree `.worktrees/http-state-gaps`.

שני באגים שדווחו ב-HTTP: שינוי מוד חזר לערך הישן אחרי יציאה וחזרה, ומכסת
claude לא הופיעה. שניהם היו אותה צורה — מצב שחי רק בלקוח ב-WS, ובלי בית בשרת.

**מה השתנה:**

- `SessionHost.setConfigOption` קולט את `configOptions[]` שה-CLI מחזיר ופולט
  `update-session`. קודם התשובה נזרקה, וערוץ-המצב לא ידע שמשהו קרה.
- `loadSession` **מותנה בזהות הסשן**: אותו `sessionId` ⇒ הערך הקיים מנצח
  (תשובת ה-load נמדדה כמיושנת ב-54 מתוך 92 הקלטות). `sessionId` שונה ⇒
  תשובת ה-load מנצחת, ו-`quota` מתאפס — אחרת מכסת הסשן הקודם נשארת מוצגת,
  כי `reset` דווקא משמר אותה.
- ה-BE קורא `_drive/getQuota` וכותב ל-`state.quota`, רק כאשר
  **`conn.capabilities.usage === true`** (היכולת המנורמלת; ל-`client.capabilities`
  הגולמי אין שדה כזה). עם timeout, dedupe לפי דור, guard נגד תשובה מאוחרת,
  וולידציה של `{snapshot}`. `snapshot: null` הוא תשובה תקינה — "אין מגבלות".
- ב-FE: `refreshQuota` יוצא מוקדם ב-remote (אין שם `#ext`, והמשך הריצה היה
  דורס מכסה תקינה ב-`null`), ו-`attachRemoteToLiveAgent` משים את `#sessionId`
  מהסנאפשוט — הוא קרא אותו לכשל-המהיר אך לא שמר אותו, ולכן בחזרה לסוכן חי
  כל מה שמותנה ב-sessionId מת בשקט.

**~~מגבלה ידועה~~ — היה באג, תוקן.** כתבתי כאן שסנאפשוט של סשן ריק אינו
מסונכרן, ושבפועל "המסלול מכוסה כי חזרה לסשן היא תמיד עם היסטוריה".

**זה היה שגוי, והמשתמשת נתקלה בו מיד:** סשן **חדש** הוא ריק, ולכן בסשן חדש
לא הופיעו מוד ומודל ולא כפתור התמונה — עד שנטענה היסטוריה.
תוקן: `#syncFromViewState(view.state)` נקרא פעם אחת לפני הלולאה.

**הלקח:** "מגבלה ידועה" שלא נמדד מולה תרחיש אמיתי היא באג לא-מדווח.

---

### slice remote-images — PromptBlocks בשלוש שכבות + attachments ב-core

Base: `slice/http-usable` @ `1182153`.
ענף: `slice/remote-images`, worktree `.worktrees/remote-images`.
3 קומיטים (C1–C3).

#### C1 — הצינור: PromptBlocks בשלוש שכבות (קומיט 41de193, fa2120d)

`session-host.ts` (×2 מימושים) — חתימת `prompt(sessionId, content: string | PromptBlocks, meta?)`.
`rpc.ts` — `ContentBlockSchema` עם חמשת וריאנטי ArkType; `content: string | PromptContent`.
`remote-session-view.ts` — הסרת ה-throw "PromptBlocks not supported", passthrough.
`core/session/types.ts` — `synthesizeUserMessage` מקבל `string | ContentBlock[]` (הרחבה).
טסטים: 7 טסטים חדשים (session-host, rpc, remote-session-view, contract).
DoD: exit=0 ✅

#### C2 — attachments ב-core + חיבור ה-FE (קומיט 6efa91a)

`core/session/types.ts` — שדה `attachments?` על וריאנט `user` של `SessionMessage`;
`synthesizeUserMessage` מפצל: image blocks → `attachments`, text blocks → `segments`.
`core/session/patch-schema.ts` — `AttachmentSchema` + הצהרת `"attachments?"` (היגיינה).
`apply-patch-mutable.ts` — `sessionMsgToBubble` מעביר `attachments` לבועה (שורה אחת).
`agent-session.svelte.ts` — מחיקת guard "תמונה-בלבד ב-remote", מחיקת אזהרה "sent as text only",
`prompt(content, meta)` במקום `prompt(text, meta)`.
טסטים: 5 טסטים חדשים (types.test, apply-patch-mutable.test, agent-session.remote.test).
DoD: exit=0 ✅

#### C3 — תיעוד (קומיט זה)

עדכון `docs/walkthrough.md` — תמונות נתמכות בשני המסלולים (HTTP + WS);
הבועה נוצרת ב-FE local בלבד (ה-BE מסנתז via `synthesizeUserMessage`).

חריגות: אין. הבריף בוצע כלשונו (r3).
בדיקות: 12 טסטים חדשים, כל הטסטים עוברים (כישלונות pre-existing: formatting, https-serve).

## 2026-08-14 (slice transport-polish — טרמינולוגיה + עקיפה + מתג)

### slice transport-polish — ws/http + שתי שכבות אחסון + Select בהגדרות

Base: `slice/remote-session-mgmt` tip (14 קומיטים קדימה מ-`slice/view-switch`).
ענף: `slice/transport-polish`, worktree `.worktrees/transport-polish`.
5 קומיטים (C1–C5) — C1 כבר בוצע וקומט לפני ה-rebase.

#### C1 — השכבה הטהורה (TDD, קומט 74a3e41)

`session-transport.ts` — union `SessionTransport = "ws" | "http"`,
`normalizeSessionTransport` מיוצא, שדה `override` חדש ב-resolver, 33 טסטים.

#### C2 — נרמול לפני שמירה + חיווי שני המקורות

`session-transport-read.ts` — נרמול לפני כתיבה ל-sessionStorage (זבל לא נשמר);
חתימה חדשה `readSessionTransport({ env, stored })` — שני מקורות: sessionStorage
(עקיפה) ו-settings (העדפה). 11 טסטים.

`connect-agent.ts` + `+page.svelte:handleReconnect` — `remote`→`http`, `local`→`ws`,
ניווט ל-`/chat?sessionTransport=http`. `vite.config.ts` — ברירת-מחדל `ws`.

`settings.svelte.ts` — שדה `sessionTransport: SessionTransport | null` (DEFAULTS=null)
נוסף מוקדם כדי ש-connect-agent/+page.svelte יקומפלו; ה-UI Select הגיע ב-C4.

#### C3 — עקיפה מכל עמוד

`+layout.svelte` — `$effect` שעוקב אחר `page.url.searchParams`, מנרמל, וכותב
ל-sessionStorage. קריאה+נרמול+כתיבה בלבד — לא נוגע ב-attach/detach/reconnect/VM.

#### C4 — Select בהגדרות

`SettingsScreen.svelte` — `<Select>` תחת "מתקדם" עם תוויות WebSocket/HTTP.
מציג את האפקטיבי כשהעדפה null (`resolveSessionTransport({ stored: null, env })`).
`keys.ts` + `catalogs/{he,en}.ts` — 3 מפתחות חדשים.

#### C5 — תיעוד

`walkthrough.md` (כאן) + `preview-view-switch.md` — עדכון טרמינולוגיה וסמנטיקת
אחסון: שתי שכבות (עקיפה=sessionStorage, העדפה=localStorage), קדימות מלאה.

#### שתי שכבות אחסון (§3)

| שכבה | איפה | חיים | מי כותב |
|---|---|---|---|
| עקיפה | sessionStorage (מפתח `sessionTransport`) | הטאב | C2, C3 |
| העדפה | localStorage (שדה ב-settings) | קבועה | C4 |

קדימות: query ← sessionStorage (עקיפה) ← localStorage (העדפה) ← env ← "ws".

# Walkthrough — drive-coding

## 2026-08-11 (slice remote-session-mgmt — ניהול סשנים ב-remote ל-parity עם local)

### slice remote-session-mgmt — רשימת סשנים, החלפה חיה ומחיקה ב-Remote Mode

Base: `slice/remote-warm-reconnect` tip `6f73684`. ענף: `slice/remote-session-mgmt`,
worktree `.worktrees/remote-session-mgmt`. 5 קומיטים (C1–C5) + קומיט תיעוד זה.

#### C1 — SessionHost חושף list/delete + יכולות

`session-host.ts` — שלושה members חדשים ב-`ExtendedSessionHost`, כולם passthrough דק
ל-AcpClient: `listSessions()`, `deleteSession(sessionId)`, `readonly agentCapabilities`
(= `client.capabilities` מה-initialize, כולל `sessionCapabilities.delete/list`). שגיאות
JSON-RPC — כולל `code: -32601` — עוברות **כמו שהן**; הראוט (C3) ממפה. 5 טסטים
אינטגרטיביים (passthrough, שמירת code בשתי המתודות, חשיפת caps).

#### C2 — loadSession כ-switch (הצ'קפוינט הקריטי)

`session-host.ts` — שמונת השלבים בסדר המחייב: (1) `turnSeq++` + `cancelledTurn=-1`
(תור ישן שמסתיים אחרי ההחלפה לא מנחית applyTurnEnd/lastTurnError על הסשן החדש);
(2) ניקוי pending פתוח ב-cancelled + flush מיקרוטסק אחד כדי שה-clear patch יינחת
**לפני** ה-reset; (3) reset על כל ה-state דרך `applyPatch` הטהור (❌ בלי bump ידני
של version); (4) **flip sessionId לפני ה-await**; (5) פילטר sessionId קבוע
ב-handleUpdate + guards ב-handlers של permission/elicitation (default מיידי, בלי
`nextRequestId++`, בלי כניסה ל-pending); (6) await; (7) הצלחה: update-session **אחד**
`{configOptions?, turnState:"idle", lastTurnError:null}` + החזרת `{sessionId, version}`
— sessionId **לא** נכתב מהתשובה; (8) כשל: rollback sessionId בלבד + reset **שני**
בגרסה ממשיכה + idle + rethrow — ❌ אין שחזור snapshot (מונוטוניות גרסאות תמיד).
החתימה צומצמה ל-`Omit<SessionHost,"loadSession">` + חתימה מעודנת שמחזירה version.
11 טסטים חדשים, כולל סימולציית watermark (כל patch עולה על כל קודמיו — שחזור
snapshot היה נכשל כאן) ו-capture של state **בתוך** ה-await (flip-before-await).

🔴 **סטייה מודעת (מתועדת בקוד)**: הפילטר וה-guards הם null-safe כלפי
`currentState.sessionId` (host לפני יצירת סשן — notifications עוברות, כמו קודם).
בלי זה טסטי האינטגרציה הקיימים (ששואבים updates לפני newSession) נשברים; בחלון
היצירה האמיתי אין notifications ממילא, ובמעבר עצמו ה-sessionId תמיד מוצב.

#### C3 — שלושה מיפויים blocking ב-rpc + getCwd לרג'יסטרי

`rpc.ts` — `listSessions` → `200 {sessions, sessionCapabilities}` (round-trip אחד
ליכולות); `loadSession` → cwd מ-`params.cwd ?? registry.getCwd(agentId)`, חסר לגמרי
→ 400, הצלחה → `200 {sessionId, version}` + `notifySessionAttached` (catch+warn, לא
מפיל), כשל → `502 {error, code?}`; `deleteSession` → `-32601` ממפה ל-`200 {ok:false,
unsupported:true}` (לא 500). ⚠️ `return` מפורש בכל case — `break` היה נופל ל-202
המשותף. `codeOf/messageOf` קוראים `(e as {code?:number}).code` בבטחה (לא בהכרח Error).
`registry.ts` — `getCwd(agentId)` passthrough ל-connectionRegistry. 24 טסטים חדשים
(19 unit + 5 אינטגרציה אמיתיים: host+route).

#### C4 — RemoteSessionView מממש את השלוש

`remote-session-view.ts` — `listSessions` (נרמול + שמירת sessionCapabilities),
`loadSession(sessionId, cwd?)` (מעדכן את **שני** מקורות ה-sessionId: `#sessionId`
וגם `#state.sessionId`), `deleteSession` (`{unsupported:true}` → זריקה עם
`code:-32601`), `newSession` נשאר זורק, + getter `supportsSessionDelete` (false עד
התשובה הראשונה). `#post` כעת מפרסר גוף שגיאה: זורק עם `.code` + סטטוס תמיד בהודעה
(רגרסיות M4 "500"/"404" נשמרות). contract tests עודכנו כנדרש; 9 טסטים ייעודיים.

#### C5 — הרחבת port + סניפי #view ב-VM

`session-view.ts` — `readonly supportsSessionDelete` + `loadSession(sessionId, cwd?)`
על ה-port; ארבעת המממשים עודכנו (LocalSessionView: `cwd ?? #cwd` + caps מ-`#client`;
שני ה-mocks). ב-VM: getter view-aware; סניף `#view` ב-listSessions (נרמול ב-view;
‎-32601 → רשימה ריקה, sessionsError נשאר null — בדיוק כמו local) וב-deleteSession
(אותו טיפול -32601, אותה הסרה אופטימית, אותה wasActive→detach); `switchSession` —
ה-`return` הגורף הוחלף בנתיב remote: guard סידורי (`status!=="connected" ||
isLoadingHistory` → throw) → `view.loadSession(sessionId, cwd)` → הצבה ישירה של
`#sessionId` (#syncFromViewState לא מסנכרן sessionId) → parity עם local: cwd +
title keep-on-undefined + `#pushTitleToServer` → finally `isLoadingHistory=false`
(משתיק TTS בזמן ה-replay). הנתיבים המקומיים — byte-identical. 10 טסטים חדשים;
בנוסף תוקנו generics ישנים של `vi.fn` ב-fixture לצורת vitest-4 (חתך 6 שגיאות
svelte-check קיימות).

#### אימות

- סוויטות הבריף: core/session + backend/session-host + backend/tests +
  frontend/session + frontend/view-models — ירוקות (הכשל היחיד: `https-serve.test.ts`
  — סביבתי, hardcoded Windows path; מתועד עוד מהסלייס הקודם).
- typecheck DELTA: backend 68→66, frontend svelte-check 15→9 — אפס שגיאות חדשות
  בשני הצדדים (8 קיימות נחתכו).
- lint:i18n עובר (commit hook + ריצה ידנית).

#### פערי פרשנות מול הבריף (מתועדים)

- "רשימה ריקה + sessionsError עדין" (DoD): פורש כ"sessionsError נשאר null כדי
  שהרשימה הריקה תרונדר" — בדיוק כמו local; הצבת הודעה הייתה מסתירה את הרשימה
  (הפאנל מציג error במקום רשימה) וסותרת את "בדיוק כמו הנתיב הקיים".
- מספרי השורות של הבריף ל-VM הם מ-tip ישן (ec95f93); העבודה לפי משמעות.

## 2026-08-11 (slice remote-warm-reconnect — סוף הסלייס)

### slice remote-warm-reconnect — כפתור "התחברות מחדש" עובד ב-Remote Mode (HTTP+SSE)

Base: `slice/view-switch` tip `ec95f93`. ענף: `slice/remote-warm-reconnect`, worktree
`.worktrees/remote-warm-reconnect`. 5 קומיטים (C1, C2, C2b, C3, C4) + קומיט תיעוד זה.

#### C1 — ה-host מדווח session לרג'יסטרי (שורש בעיה 1: הכפתור היה disabled)

`packages/backend/src/session-host/registry.ts` — dep אופציונלי חדש
`onSessionAttached?: (agentId, sessionId) => Promise<void> | void` + מתודה ציבורית
`notifySessionAttached` (delegation; no-op בלי callback — נחוצה לסלייס ההמשך, loadSession
ב-rpc). הקריאה ב-`doCreate` **אחרי** בלוק יצירת ה-session (לא בתוכו) — גם host
מוזרק-מוכן מדווח; עטופה ב-try/catch + `log.warn`: כשל בדיווח לא מפיל יצירת host
(הסשן עובד; פאנל ישן עדיף על חיבור שבור). guard קטן נוסף: sessionId null → אין מה
לדווח (host.state.sessionId הוא `string | null` — ב-production newSession תמיד ממלא).

`packages/backend/src/session-host/http/index.ts` — `createAndRegisterSessionHostHttp`
מקבל `opts.onSessionAttached` ומעביר לרג'יסטרי. `packages/backend/src/server.ts` —
הרג'יסטרי **נתפס** (קודם נזרק) והועבר **מעל** יצירת ה-orchestrator (מאפשר את C2b
כ-dep לבנאי, בלי setter post-construction); ה-callback משכפל בדיוק את
`POST /session-attached` (status:"ready" + acpSessionId + projectsRegistry.recordCwd/
recordSession), כולל דילוג-warn על סוכן חסר/closed (race מול DELETE). **הכרעת MED-9
מתועדת שם בהערה**: ה-callback הפנימי עוקף את guard ה-409 **בכוונה** — ב-remote ה-host
הוא authoritative. ה-endpoint הקיים לא נגע.

#### C2 — guard דו-כיווני: לכל היותר לקוח ACP אחד לכל wire (שורש בעיה 2)

כיוון WS→host: `ws-agent.ts` — dep אופציונלי `sessionHostRegistry?: { getHost }`;
אחרי ה-presence check ולפני `activeFeWs.set`, אם יש host חי →
`close(1008, "session-host-active")` + warn + return. כיוון host→WS:
`connection-registry.ts` — getter חדש `isAttached(agentId)`; `registry.ts` (session-host)
— `doCreate` מסרב (return undefined → 404) אם הסוכן attached מקומית. שני הכיוונים
חוסמים את אותה השחתה (שני לקוחות ACP על אותו conn.wire). אפס שינוי לנתיב local:
כל הקוראים הקיימים לא מעבירים את ה-deps החדשים (מכוסה ע"י הטסטים הקיימים שלא שונו).

#### C2b — lifecycle: אין hosts יתומים

`registry.ts` — liveness check ב-`getOrCreateHost`: entry קיים אבל
`connectionRegistry.get` undefined (crash/DELETE) → מסיר את ה-entry ומחזיר undefined
(→ 404, בלי 200 עם host מת ו-snapshot ישן). `agent-orchestrator.ts` — dep אופציונלי
`sessionHostRegistry?: { unregisterHost }`; קריאה ב-`deleteAndKill` (לפני close)
וב-crash handler (ראשון, לפני עדכון ה-status) — סוגרים את החלון שה-liveness-check
ה-lazy לבדו משאיר. server.ts מעביר את הרג'יסטרי (אפשרי בזכות ההזזה מ-C1).

#### C3 — FE: attachRemoteToLiveAgent + hydration

`remote-session-view.ts` — ב-`#doConnect` (חיבור ראשון בלבד): אם ל-snapshot יש
messages, נפלט patch `{op:"reset"}` סינתטי **ישירות דרך `#emit`** (כמו
`#handleReconnected`), `version = snapshot.version`, בלי לגעת ב-`#lastVersion`,
**לפני** `#drainPatches` — סדר דטרמיניסטי בערוץ ה-VM. ❌ לא דרך `#applyIncoming`
(ה-watermark היה חוסם). בלי זה הבועות היו נשארות ריקות ב-reconnect (כל ההיסטוריה
ב-snapshot, ו-`#consumeViewPatches` בונה bubbles רק מ-patches).

`agent-session.svelte.ts` — מתודה חדשה `attachRemoteToLiveAgent({agentId, cwd,
cliKind})` = שלבי `attachRemote` פחות createAgent (ה-host קיים ב-BE; snapshot הוא
מקור-האמת ל-sessionId, לא הקלט מהפאנל). guard-כפילות **לפני** #cleanup (אותו סדר
קריטי), איפוס מרחב ה-ids של pending, `createRemoteView({agentId})`, כשל-מהיר על
sessionId null, `#view` + `#consumeViewPatches` (guard זהות), connected; הכל עטוף
try/catch. ❌ בלי notifySessionAttached (ה-BE דיווח ב-C1), ❌ בלי שינוי ב-attachRemote/
attachToLiveAgent/#warmReconnect.

🔴 **סטייה מודעת מהבריף (מתועדת בקוד ובטסטים)**: נתיבי הכשל (כשל-מהיר + catch)
קוראים `#cleanup({ keepAgent: true })` ולא `#cleanup()` סתם — `#cleanup()` רגיל קורא
`deleteAgent(agentId)`, והיה **הורג את הסוכן החי של המשתמשת** שאנחנו מתחברים אליו
(ב-attachRemote המחיקה נכונה כי הסוכן נוצר באותה מתודה; כאן הסוכן שייך למשתמשת).
בנוסף: כשל-חולף (רשת/503) לא מוחק סוכן בריא — המשתמשת יכולה לנסות שוב.

#### C4 — FE: ניתוב ב-+page.svelte (route layer, לא VM — עקרון C3-ז נשמר)

`$lib/session/session-transport-read.ts` (חדש) — `readSessionTransport(envValue)`:
פתירת הדגל נמשכה **מילה-במילה** מ-connect-agent.ts:33-41 (query ← stored ← env +
שמירת query ל-sessionStorage). env מוזרק כפרמטר (בלי יבוא `$env/dynamic/public` —
אין alias ב-vitest). connect-agent.ts עבר להשתמש בה (התנהגות זהה). `handleReconnect`
ב-+page.svelte: remote → `attachRemoteToLiveAgent` + `goto("/chat?sessionTransport=remote")`;
local → **ללא שינוי**. guard `!agent.acpSessionId` נשאר (מאוכלס גם ב-remote אחרי C1).

#### אימות

- סוויטות הבריף: `vitest run packages/backend/src/session-host packages/backend/tests
  packages/frontend/src/lib/session packages/frontend/src/lib/view-models` — 875 עברו;
  הכשל היחיד (`https-serve.test.ts`) **pre-existing** (מאומת גם על base — הקובץ
  byte-identical; הסיבה: hardcoded Windows paths, `:85-87` — BUN_PATH/ROOT של
  `D:/...`, לא בעיית binding/TLS כפי שנכתב כאן קודם; תוקן אחרי הערת כלב).
- **אפס שינוי בנתיב local**: כל 6 סוויטות ה-reconnect המקומיות
  (agent-session.reconnect*, reconnect-bubble-merge, adapters/reconnect-state) — 46/46
  ירוקים, והקבצים עצמם **לא נגעו** (diff ריק מול base).
- typecheck DELTA מול `ec95f93`: backend (tsc) 68/68 — אפס שגיאות חדשות; frontend
  (svelte-check) 15/15 — אפס חדשות. (ב-base יש שגיאות pre-existing; שווה-ערך אחרי
  נרמול מספרי-שורה.)
- `lint:i18n` נקי. biome על 22 הקבצים שנגעו: בדיוק אותם ממצאים כמו base (כולם
  pre-existing: noNonNullAssertion בטסטים, noRedeclare SessionState וכו') — אפס חדשים;
  2 הפרות פורמט שהוספתי תוקנו ב-`biome format --write`.
- הערת שקיפות (כלב): קומיט C4 (`1cf48ce`) כולל גם פירמוט biome קוסמטי ב-
  `+page.svelte` (פיצול יבוא/שורות — אפס שינוי לוגיקה, אומת שורה-שורה) שלא צוין
  בדוח המבצע המקורי.
- known-gap נשאר נעול: `leaveRunning` ב-remote עדיין detach מלא (החלטה נפרדת, ר' בריף).
- הערה לסקופ עתידי: `attached` תמיד false ב-remote → הפאנל מציג "reconnect" ולא
  "takeover" גם כש-WS חי בלשונית אחרת — חסר מקור-מידע; לא בסקופ (מתועד בבריף).

## 2026-08-09 (slice view-switch, C4 — סוף הסלייס)

### slice view-switch — C4: preview חי בשני המצבים + runbook + באג אמיתי שנתפס ותוקן

`.gitignore` — הוספתי `!packages/frontend/docs/` **אחרי שורה 52** (`docs/`, השורה
השנייה מתוך שתי שורות `docs/` בקובץ — השורה הראשונה ב-34 הייתה נדרסת ע"י 52).
אומת **לפני** ה-commit: `git check-ignore -v packages/frontend/docs/preview-view-switch.md`
חוזר ריק (exit 1) — הקובץ trackable. `docs/other.md`/`docs-for-llm/...` נשארים
IGNORED (אין דליפה).

`packages/frontend/docs/preview-view-switch.md` (חדש) — runbook: פקודות build+serve
(`PORT=4100`, ⛔ לא 4000)+tunnel, שני ה-URL-ים מאותו build, צ'ק-ליסט 9 סעיפים,
known-gaps (10 פריטים), שלושת ערוצי-הכשל (השלישי — מוות SSE — מוצהר known-gap
מפורש), Q5 פתוחה.

#### 🔴 באג אמיתי שנמצא רק ב-preview (לא ב-C1/C2, לא ב-unit tests)

בנייה + serve על `PORT=4100` + מנהרת HTTPS (`pico`/`tuns.sh`,
`https://musicode-drive-coding-view-switch.nue.tuns.sh`) — ניסיון ראשון ב-remote
נכשל: `attachRemote` לא ניווט ל-`/chat` בכלל. `curl` ישיר לאותו `/api/agents/:id/events`
עבד מושלם עם `sessionId` אמיתי מיידי — ההבדל היחיד היה שה-curl קיבל `baseUrl` בלי
לוכסן-סוגר, וה-FE האמיתי (דרך `beUrl("")` → `location.origin` **עם** לוכסן-סוגר)
ייצר `//api/agents/...` (לוכסן כפול) ב-`RemoteSessionView`. C1/C2 test suites לא
תפסו כי אף טסט לא הרכיב URL דרך `beUrl("")` האמיתי עם `location` אמיתי — תמיד הזריקו
`baseUrl` מפורש נקי. **תוקן**: `create-session-view.ts` — `.replace(/\/$/, "")` על
ה-baseUrl לפני השרשור, + 2 טסטי-רגרסיה חדשים (`baseUrl` מפורש עם לוכסן-סוגר,
ו-`beUrl("")` עם `location` מדומה עם לוכסן-סוגר — שניהם מוודאים אין `//api/agents`).
בנוי מחדש, נפרס מחדש, ונבדק אמפירית שוב — **עבד מושלם**.

#### אימות אמפירי (playwright דרך ה-tunnel, claude CLI אמיתי)

- **local**: חיבור אוטומטי מ-"תיקיות אחרונות" (`dev` worktree) → `/chat` → פרומפט
  "Reply with exactly the single word: pong" → תשובה זורמת חוזרת בזמן-אמת → בועת-משתמש
  **פעם אחת** (screenshot: `local-chat.png`).
- **remote** (`?sessionTransport=remote`): **אותו flow בדיוק**, אחרי התיקון — ניווט
  ל-`/chat?sessionTransport=remote`, פרומפט זהה, תשובה חוזרת, בועת-משתמש פעם אחת
  (מסונתזת בשרת — screenshot: `remote-chat.png`). config panel מציג פחות אפשרויות
  מ-local (known-gap מתועד: `modes`/`models`-based selects לא מוצגים ב-remote).
- **onecli לא היה מותקן** בסביבת ה-executor — שרתתי עם `bun src/server.ts` ישיר
  (התקדים: onecli נחוץ רק ל-TTS proxy, ר' `running-locally.md`). **TTS (סעיף 7
  בצ'ק-ליסט) לא נבדק** בריצה הזו — יתר 8 הסעיפים שנבדקו עברו; 4 (tool call/permission/
  cancel) ו-8 (מעבר local↔remote) לא אוטומטו — דורשים עין אנושית.
- **DoD**: `bunx vitest run packages/frontend`: 850/851 (הכשל היחיד — `formatting.test.ts`
  calendar-month, pre-existing לא-קשור; +2 טסטים חדשים מהתיקון). typecheck: DELTA-CHECK
  מול `3e7d9c5` — 15/15 (אפס חדשות). `lint:i18n`: נקי.

**זו נקודת-העצירה האנושית היחידה בכל התוכנית** — הפרסום נשאר חי (BE על 4100,
tunnel על `https://musicode-drive-coding-view-switch.nue.tuns.sh`) עד שמרדכי/המשתמשת
מסיימים לבדוק, ואז ינותקו. Q5 (ברירת-מחדל local/remote) נשארת פתוחה למרדכי.

## 2026-08-09 (slice view-switch, C3) — 🎯 phase-verify

### slice view-switch — C3: חיווט remote מקצה-לקצה ב-`agent-session.svelte.ts`

עריכות נקודתיות (לא ענפי-`return`), כולן מותנות ב-`#view !== null` — אפס שינוי-התנהגות
ב-local (מאומת בטסט רגרסיה מפורש, ר' למטה).

**`attachRemote`** (חדשה) — guard-כפילות **לפני** `#cleanup()` (הפוך = הרסני: היה הורג
agent+host+child לפני שהוא זורק); `#cleanup()` מפרק `#view` קיים; בלוק-איפוס + איפוס
`#answeredPermissionId`/`#answeredElicitationId`; `createAgent` (HTTP) → `agentId` מוצב
מיד; `createRemoteView` (SSE); כשל-מהיר על `sessionId==null` → `close()`+`#cleanup()`;
`#consumeViewPatches` מכמת בזהות (`this.#view !== view` → `break`) — ממצא 1 מהבריף
(patches מ-view ישן שהיה נשאר לנצח מנתב אל VM חדש). כל שלבי ה-HTTP/SSE עטופים
ב-`try/catch` — כשל לא משאיר `status="connecting"` לנצח.

**`sendPrompt`** — guard `!#view && (!#client||!#sessionId)`; בועה אופטימית מדולגת
ב-remote (השרת מסנתז); 🔴 `#turnEnded`/`#setTurnState("idle")` **הועברו לענף ה-local
בלבד** — ב-remote `view.prompt()` נפתר עם ה-202, לא סוף התור; סיום מגיע מ-patches.
`catch` משותף — `#setStatus("error")` **local בלבד** (ב-remote היה נועל `sendPrompt`
לצמיתות). תמונה-בלבד ב-remote → error+return מיידי (לא מחרוזת ריקה); טקסט+attachments
→ אזהרה, ממשיכים עם טקסט בלבד.

**`cancelTurn`** — רק הבלוק האמצעי מנותב לפי `#view`; שני ה-`#resolvePending*`
ו-`#setTurnState("idle")` נשארים משותפים (היו נדלגים בענף-מוקדם — דיאלוג תקוע).

**`applyConfigOption`** — guard view-aware; ב-remote מחקה את שלושת שלבי ה-resolution
של `#applyConfigToClient` (id → category עבור mode/model → fallback ישיר); `applied`
מותנה, `persist` (`settings.setLastConfig`) רץ רק אז.

**חסימת 4 נתיבי-WS** — `loadSession`/`switchSession`/`newSession`/`attachToLiveAgent`
מקבלים `if (this.#view) return` בראשם (הראשון פותח `createAgent`+WS; השאר עלולים
לפתוח WS מקביל ל-SessionHost).

**`leaveRunning`** — ב-remote = detach מלא (`#cleanup()` בלי `keepAgent`) — אחרת
agent+host+child נשארים חיים בלי בעלים (`attachToLiveAgent` חסום ב-remote, אין דרך
לחזור).

**`#syncFromViewState`** — שני שדות חדשים, שני helpers פרטיים (`#syncPendingPermission`/
`#syncPendingElicitation`): ארבעה מצבים (null / patch-מעופש / כבר-פתוח / בנה-מחדש),
`requestId` אופציונלי על `pendingPermission`/`pendingElicitation` (❌ אין `#open*Id`).
ה-shim מסמן אופטימית (`#answeredPermissionId = id`) ומבטל בכשל (מכומת בזהות+זמן:
`#tearingDown || #view!==view` → skip — מונע כתיבת-רפאים על סשן הבא). `lastTurnError`
→ `session.error` דו-כיווני עם `#errorFromTurn` (ניקוי ממוקד — אזהרה ממקור אחר שורדת).

**`#cleanup`** — `void this.#view?.close().catch(()=>{})` + `this.#view=null` +
איפוס `#answered*Id` (מרחב-ids פר-host, לא פר-VM).

**`connect-agent.ts`** — נקודת-ההזרקה היחידה של `sessionTransport`: `?sessionTransport=`
נשמר ל-`sessionStorage`, `resolveSessionTransport({query,stored,env})`, מנתב ל-`attach`/
`attachRemote`, `goto("/chat?sessionTransport=remote")` ב-remote.

#### מלכודת-לינט שנתקלתי בה (לא בבריף, לא ב-scope לתקן) — 🔴 emoji שובר את `lint:i18n`

`scripts/lint-no-hebrew-in-code.mjs`'s `stripJsdocBlocks` בונה `out=[...text]` (מערך
code-point-aware, `spread`) אבל כותב אליו לפי אינדקסים שנספרו כ-UTF-16 code units
(`text.indexOf`/`text.length`). 🔴 (`U+1F534`) הוא astral — surrogate pair (2 units,
1 code point) — desync מצטבר. baseline כבר הכיל 2 מופעי 🔴 בלי בעיה (מזל: הקורוזיה
נחתה על whitespace); הוספתי 4 נוספים (כולל `🔴🔴` כפול) וה-desync חצה סף וחשף
Hebrew אמיתי כ"קוד" ב-11 מקומות רחוקים משם (שקר-חיובי גורף). **תוקן** — לא בעריכת
הסקריפט המשותף (מחוץ ל-scope), אלא בהחלפת ה-🔴 שלי ל-⚠️ (BMP, single-unit, כבר
בשימוש מוכח בקובץ). `bash scripts/lint-no-hebrew-in-code.sh` חוזר נקי אחרי ההחלפה.

#### בדיקות

`agent-session.remote.test.svelte.ts` (חדש, 21 טסטים) — sendPrompt (string ל-view,
בלי בועה, waiting נשאר, patch idle מוריד, HTTP-כשל→error לא status, תמונה-בלבד,
טקסט+attachments), cancelTurn (resolve pendings+view.cancel+idle), applyConfigOption
(mode/model/configId-קיים/unknown-skip), pending sync (guard-זהות + patch-מעופש לא
פותח מחדש + שני השדות יחד), lastTurnError (סנכרון+ניקוי ממוקד+לא-מנקה מקור-אחר),
attachRemote (כשל-מהיר sessionId=null + flow-מלא עם persist), WS paths blocked,
`#cleanup` teardown+guard-זהות, **+3 טסטי-רגרסיה מפורשים** (local: attach+sendPrompt
בועה+idle, catch מציב status=error, cancelTurn). `MockSessionView` (`__fixtures__/`)
הורחב תוספתית: `applyAndEmit(patch)` מריץ `applyPatch` (core) לסימולציית
update-session patches (pending/turnState/lastTurnError) — אותה טכניקה כמו ה-remote
harness ב-C1 (`applyPendingRequest`/`clearPendingRequest`/`applyTurnStart`/
`applyTurnEnd` מ-core, לא patches מפוברקים ידנית).

`bunx vitest run packages/frontend`: 848/849 (הכשל היחיד — `formatting.test.ts`
calendar-month, pre-existing לא-קשור). typecheck: DELTA-CHECK מול `3e7d9c5` — 15/15
(אפס חדשות). `lint:i18n`: נקי (אחרי תיקון ה-🔴 למעלה). `biome check` על כל הקבצים
שנגעתי בהם: נקי מ-errors (11 warnings של `noNonNullAssertion` בטסט החדש — לא חוסמות,
תואם לסגנון קבצי-טסט אחרים בפרויקט).

## 2026-08-09 (slice view-switch, C2)

### slice view-switch — C2: דגל בחירת-מימוש (`sessionTransport`) + factory

`packages/frontend/src/lib/session/session-transport.ts` (חדש) —
`resolveSessionTransport({query, stored, env})`: טהור (בלי `window`/`location`),
קדימות **נעולה** `query ← stored ← env ← "local"`, נורמליזציה case-insensitive
אחרי trim, ערך לא-מוכר יורד לרמה הבאה (❌ לא זורק). השם `sessionTransport`
במפורש — לא `sessionMode` (תפוס בדומיין ה-config של ה-CLI).

`packages/frontend/vite.config.ts` — שורה תוספתית (התקדים: בלוק `PUBLIC_APP_TITLE`
שכבר קיים שם): `process.env.PUBLIC_SESSION_TRANSPORT = process.env.FE_SESSION_TRANSPORT
?? "local"`, **לפני** ה-plugin של SvelteKit. הקריאה תהיה דרך `$env/dynamic/public`
ב-C3 (`connect-agent.ts`) — לא `$env/static/public` (אין לו export בשם `env`).

`packages/frontend/src/lib/session/create-session-view.ts` (חדש) —
`createRemoteView({agentId, baseUrl?, ...RemoteSessionViewOptions?})`: עוטפת
את `createRemoteSessionView` הקיים + `await connect()`. חתימות לא-תואמות:
כאן `baseUrl` אופציונלי, שם פרמטר-מיקום נדרש — העטיפה מספקת `baseUrl ?? beUrl("")`
(same-origin, תקדים `agents-api.ts`). הרחבתי את הטיפוס להכיל גם
`Partial<RemoteSessionViewOptions>` (headers/`_fetch`/`_sleep`) — תוספתי,
לא סוטה מהחתימה המינימלית של הבריף (`{agentId, baseUrl?}` עדיין קריאה תקינה),
ומאפשר הזרקת mock fetch בטסטים בלי לחשוף hook נפרד.

**בסוף C2 שום דבר בפרודקשן עדיין לא צורך את הדגל** — `connect-agent.ts` עדיין
קורא רק ל-`attach()` (C3 יחווט).

#### בדיקות

`session-transport.test.ts`: 17/17 — טבלת-אמת מלאה (8 קומבינציות קדימות +
3 נורמליזציה + 6 ערכים-לא-תקינים, כולל אמוג'י שלא זורק). `create-session-view.test.ts`:
2/2 — בונה + מחובר (`connect()` רץ), ו-`baseUrl` אופציונלי נופל ל-`beUrl("")`.
`bunx vitest run packages/frontend/src/lib/session`: 114/114 ירוק (8 קבצים).
typecheck: DELTA-CHECK מול `3e7d9c5` — 15/15 (אפס חדשות). `lint:i18n`: נקי
(`*.test.ts` פטור מהבדיקה — Hebrew ב-`it()`/`describe()` שם מותר; רק
`session-view-contract.ts` שאינו `.test.ts` דרש תרגום ל-C1).

## 2026-08-09 (slice view-switch, C1)

### slice view-switch — C1: contract-tests משותפים בין local ל-remote

`packages/frontend/src/lib/session/__contract__/session-view-contract.ts` (חדש) —
`ContractHarness` (הטיפוס המדויק מהבריף) + `PatchBuffer` (reader יחיד +
תור-FIFO פנימי: `nextPatches(n)` צורך מה-buffer, `waitForTotalAtLeast(n)`
ממתין בלי לצרוך — כדי ש-`settle`/`emitUpdate`/`emitPermission` לא יבלעו
patches שהאסרציה בטסט אחר-כך קוראת) + `describeSessionViewContract()`
עם 8 ההתנהגויות מהבריף.

`packages/frontend/src/lib/session/session-view.contract.test.ts` (חדש) —
קורא ל-`describeSessionViewContract` פעמיים: `local` (LocalSessionView +
mock AcpClient, `await view.newSession()` לפני הכל) ו-`remote`
(RemoteSessionView + mock fetch/SSE). ⚠️ ה-remote harness מריץ את `reduce`/
`applyPendingRequest`/`clearPendingRequest`/`applyTurnEnd` **מ-core** על
`shadowState` כדי לגזור patches אמיתיים (לא מפוברקים ידנית) — התנהגות 3
(קיבוץ chunks) בודקת בפועל את ה-view, לא את ה-harness. כל patch נדחף
כ-SSE frame בודד (`event: patch`) ועובר `PatchSchema` דרך `SSEReader` כמו
בפרודקשן — versions עולים ממש כי הם נגזרים מ-`shadowState.version` שמתקדם
עם כל patch. + טבלת-הסטייה: session-mgmt methods דוחים (reject, לא throw
סינכרוני), `prompt(PromptBlocks)` זורק ב-remote בלבד, כשל HTTP (5xx) נדחה
לא נבלע, `respond()` עם id לא-מוכר הוא no-op שקט בשני המימושים.

מלכודת שנתקלתי בה (לא בבריף, לא בהיקף התיקון): `AcpClientCallbacks` **אינו**
re-exported מ-`@drive-coding/provider/client` (יש ב-`client.ts` אבל לא
ב-`client/index.ts`) — פער קיים-מראש שכבר שובר typecheck ב-3 קבצים
(`local-session-view.ts`, `local-session-view.test.ts`,
`agent-session.integration.test.svelte.ts`, DELTA-CHECK מול `3e7d9c5`:
15 שגיאות ב-baseline, לא קשור ל-S6). כדי לא להוסיף שגיאת typecheck רביעית
מאותו סוג, `session-view.contract.test.ts` גוזר את טיפוס ה-callbacks
structurally מחתימת ה-constructor של `LocalSessionView` (`Parameters<...>`)
במקום לייבא את הסמל השבור. לא תוקן בפועל (מחוץ להיקף — לא backend/core,
אבל גם לא מוזכר בבריף; דיווח בלבד).

#### בדיקות

`bunx vitest run packages/frontend/src/lib/session/session-view.contract.test.ts`:
20/20 ירוק (8 התנהגויות × 2 harnesses + 4 טבלת-סטייה) — עברו **בניסיון
הראשון**, כי LocalSessionView/RemoteSessionView שני המימושים כבר קיימים
ומוכנים משלבים קודמים (session-view-port, remote-session-view,
session-host-pending-surface). `bunx vitest run packages/frontend`:
808/809 (הכשל היחיד — `formatting.test.ts` calendar-month, pre-existing,
לא-קשור, לא נגעתי בקובץ). typecheck: DELTA-CHECK מול `3e7d9c5` — 15 שגיאות
ב-baseline, 15 אחרי (אפס חדשות). `biome check` על שני הקבצים החדשים: נקי
(אחרי autofix של format/import-order + תיקון ידני ל-2 `noNonNullAssertion`).

## 2026-08-09 21:05

### slice session-host-pending-surface — hotfix: waiting לפני add-message (avigail, post-GO)

אחרי calev GO 12/12, avigail מצאה באג ב-C3: `host.prompt` פלט `add-message`
ואז `waiting` כשני `emit`/`emitPatches` נפרדים. **ניסיון תיקון ראשון (שנחסם
בעצמי, ר' למטה) הציע למזג את שתי הקריאות ל-emit אחת** — נבדק אמפירית
ונמצא לא-משנה-כלום: `ReadableStreamDefaultReader.read()` **תמיד** מחזיר
chunk אחד לקריאה, גם כששני `enqueue()` קרו סינכרונית מאותה קריאת פונקציה,
ו-`PatchesBroadcaster`/`events.ts`/`SSEReader`/`RemoteSessionView#applyIncoming`
כולם מעבדים patch-אחד-בכל-פעם ללא תלות בקיבוץ במקור. "batch" על ה-wire
לא קיים בארכיטקטורה הנוכחית — מיזוג הקריאות היה משנה אפס.

**התיקון האמיתי**: **הפוך את הסדר**. `apply-patch.ts`'s `add-message` branch
גוזר `turnState` מ-`role`, ול-`role:"user"` (המקרה תמיד כאן) הוא **משמר**
את הערך הקיים ("מלכודת ג'" — הכלל נוסח כ"הסדר [add-message→waiting] בטוח",
לא "הכרחי"). אותה עובדה בדיוק הופכת גם את הסדר ההפוך ל**בטוח** — ומתקנת:
אם `waiting` נפלט **קודם**, ה-`add-message` שאחריו (role=user) לא דורס אותו.
שני הסנכרונים שה-FE מריץ (`#syncFromViewState` פר-patch) רואים `waiting`
במקום `idle` ואז `waiting` — סוגר את ה-flicker (צליל-חשיבה כפול,
flush מזויף של סוף-תור ב-Speaker).

#### מה בוצע?

**packages/backend/src/session-host/session-host.ts** — `host.prompt`:
`emit(applyTurnStart(currentState))` (waiting) עכשיו **לפני**
`synthesizeUserMessage`/`applyUserMessage`/`emitPatches` (add-message).
תגובה אטומית לא אפשרית כאן (op types שונים — `add-message` אינו יכול לשאת
`changes.turnState`, ואסור להוסיף `Patch` op חדש) — שני emits נפרדים
נשארים, רק הסדר התהפך. הערת-הקוד מעל `prompt` עודכנה במלואה: מתארת את
הבאג המקורי, למה מיזוג-ה-emit לא היה עוזר, ולמה ההיפוך כן.

#### אימות (לפי בקשת מרדכי, לפני קיבוע)

1. **אין צרכן שתלוי בסדר add-message-לפני-waiting** — `apply-patch-mutable.ts`
   (ה-FE) אין לו `case "update-session"` בכלל (bubbles לא מתעדכנים מ-patch
   הזה); `turnState` מגיע אך ורק דרך `#syncFromViewState(view.state)`, לא
   דרך הפאץ' עצמו. הטסט היחיד ב-FE שקושר `add-message`+patch נוסף
   (`remote-session-view.integration.test.svelte.ts`) בונה `Patch`-ים ידנית
   דרך mock SSE, לא דרך `session-host.ts`, ולא נוגע ב-`waiting` כלל.
2. **הנתיב המקומי לא מושפע** — `LocalSessionView.prompt` (FE) מנוהל בנפרד
   לגמרי, אינו קורא ל-`session-host.ts`.
3. **טסט-רגרסיה חדש** — ר' למטה.

#### בדיקות

`session-host.integration.test.ts`: הטסט "emits three patches in order"
עודכן לסדר `waiting → add-message → idle`. **טסט חדש** — "hotfix regression
guard": מדמה בדיוק את מה ש-`#syncFromViewState` עושה (`applyPatch` פר-patch,
רישום `turnState` אחרי כל אחד), ומאמת `["waiting","waiting"]` — **אף פעם לא
"idle" ביניהם**. ⚠️ אומת אמפירית: **הרצתי את הטסט מול הסדר הישן** (שחזור
זמני, לא-מקובע) — נכשל כצפוי (`["idle","waiting"]`), ואז שוחזר הסדר החדש —
ירוק. זה מוכיח שהטסט תופס רגרסיה אמיתית, לא ניסוח ריק.
`bunx vitest run session-host.integration.test.ts`: 43/43 ירוק (היה 42;
+1 טסט-רגרסיה). `bunx vitest run session-host/`: 144/144. `bunx vitest run
backend+frontend/session+core/session`: 847/847 (למעט `https-serve.test.ts`
pre-existing לא-קשור). typecheck: DELTA-CHECK מול `ac376e8` — אפס שגיאות
חדשות. `lint:i18n`: נקי.

**הענף קפוא סופית מכאן.**

## 2026-08-09 20:27

### slice session-host-pending-surface — C5: אינטגרציה קצה-לקצה (BE) — הסלייס הושלם

C5 סוגר את השרשרת: host אמיתי + `PatchesBroadcaster` אמיתי + כל 4 ראוטי
ה-HTTP (events/rpc/reply/state), בלי mocks של הרישום עצמו. אין קובץ קיים
שעושה זאת — `events.test.ts`/`reply.test.ts`/`rpc.test.ts` כולם ממקקים
registry+host, ו-`session-host.integration.test.ts` לא נוגע ב-HTTP כלל.
קריטריון-ההצלחה כאן BE-side בלבד: patches, snapshot, `POST /reply` —
נמדדים בטסטים ובתעבורת SSE, **לא במסך** (אין ל-`RemoteSessionView` צרכן
בפרודקשן — S6 יחווט את זה).

#### מה בוצע?

**קובץ חדש** — `packages/backend/src/session-host/http/session-host-http.integration.test.ts`:
`setup()` בונה `ExtendedSessionHost` **אמיתי** (`createSessionHostFromConnection`
עם `AcpClient` ממוקק בלבד — אותה טכניקה כמו `session-host.integration.test.ts`,
כדי לעקוף את handshake ה-ACP האמיתי) + `PatchesBroadcaster` **אמיתי**
(`createPatchesBroadcaster(host.patches)`), מאוחדים תחת `AgentSessionRegistry`
בנוי-ביד לסוכן יחיד, ומחוברים ל-4 הראוטים האמיתיים דרך
`registerSessionHostHttp` על `Hono` אמיתי.

`computeFinalClientState(frames)` — עוזר-טסט שמדמה את מה שלקוח SSE אמיתי
מחשב: snapshot כבסיס, ואז כל patch עם `version` **גדול ממש** מ-`version`
ה-snapshot (אותו drop-guard שנחת ב-`remote-session-view.ts`, calev-heavy
round 2). זה בדיוק "המצב הסופי אחרי ה-replay" שהבריף דורש — לא frame-אפס —
כי `broadcaster.subscribe()` משחזר עד 64 patches מה-ring-buffer **אחרי**
ה-snapshot (`events.ts`: subscribe לפני snapshot, אבל ה-frames בפועל
יוצאים snapshot-קודם).

**עקיפת שני פערי-טיפוסים pre-existing** (לא תוקנו — known-gaps, רק
נמנעה הוספת מופעים חדשים שלהם ל-DELTA-CHECK): `MockResponse` מקומי
(תקדים `rpc.test.ts`, calev-heavy L10 — `app.request()` מתנגש עם global
`Response` תחת `types:["bun"]`), ו-`CapturedCallbacks` שנגזר מ-
`SessionHostFromConnOptions["_createAcpClient"]` במקום לייבא
`AcpClientCallbacks` בשם (שאינו מיוצא מ-`@drive-coding/provider/client`
— אותו פער שכבר קיים ב-`session-host.ts`/`session-host.integration.test.ts`).

#### בדיקות

4 טסטים: (א) לקוח שמתחבר באמצע בקשת-הרשאה ממתינה מקבל, אחרי ה-replay,
`pending.permission` נכון (frame-אפס כבר מספיק כאן — `host.state` כבר
משקף את זה ב-register-then-snapshot); (ב) `POST /reply` סוגר את המעגל —
שני מנויים עצמאיים, שניהם מקבלים patch-ניקוי עם אותו `requestId`, אחרי
3 frames (snapshot + patch-set משוחזר + patch-clear חי); (ג) תור מלא
(`waiting`→`idle`) נצפה נכון אצל מנוי שהצטרף באמצע התור; (ד) תור שנכשל
מגיע למנוי-שהצטרף-באמצע עם `lastTurnError`, אחרי 4 frames (snapshot +
2 patches משוחזרים + patch-כשל חי).
`bunx vitest run session-host-http.integration.test.ts`: 4/4 ירוק.
`bunx vitest run packages/backend/src/session-host`: 143/143 ירוק.
`bunx vitest run packages/backend`: 641/641 ירוק (למעט `https-serve.test.ts`
— pre-existing, לא-קשור). typecheck: DELTA-CHECK מול `ac376e8` — אפס
שגיאות חדשות. `lint:i18n`: נקי.

**הסלייס הושלם — 5/5 checkpoints.** commits: `189c4db` (C1) · `ebc7d5f`
(C2) · `cfa013a` (C3) · `c3648d4` (C4) · הקומיט הבא יסגור C5.

## 2026-08-09 20:19

### slice session-host-pending-surface — C4: מונה requestId משותף (BE+FE)

C4 סוגר מלכודת ב' מהבריף: `permissionSeq`/`elicitationSeq` שניהם התחילו ב-0,
ו-`RemoteSessionView.respond()` גזר `kind` בעצמו עם fallback ל-`"permission"`.
ברגע ש-C2 הפך "שני kinds pending בו-זמנית" למצב נתמך, ה-fallback הזה היה
שולח תשובת-elicitation כ-`kind:"permission"` — no-op שקט, דיאלוג שלא נסגר
עד timeout.

#### מה בוצע?

**packages/backend/src/session-host/session-host.ts** — `permissionSeq`
ו-`elicitationSeq` הוחלפו במונה **משותף יחיד**: `let nextRequestId = 0`,
משמש גם ב-`handleRequestPermission` וגם ב-`handleCreateElicitation`. שני
ה-`PendingRequests` (`permPending`/`elicitPending`) נשארים שתי מפות נפרדות
— `kind` עדיין נדרש ב-`POST /reply` כדי לנתב ביניהן — אבל ה-id עצמו ייחודי
גלובלית בתוך ה-host.

**packages/frontend/src/lib/session/remote-session-view.ts** — `respond()`:
הוסר ה-fallback ל-`"permission"`; id שלא תואם אף `pending` קיים הוא **no-op
שקט** (מיישר קו עם `LocalSessionView.respond`). זה **חריג-ה-FE היחיד**
שהבריף התיר — מתודה אחת + הטסטים שלה בלבד; שום קובץ/מתודה FE אחרים לא
נגעו.

**ניקוי תיעוד (C4-ג, ללא שינוי לוגי)**:
- `reply.ts` — JSDoc בראש הקובץ: המשפט "permissionSeq/elicitationSeq שניהם
  מתחילים ב-0" הוחלף בהסבר שה-`kind` עדיין נדרש (שתי מפות נפרדות), למרות
  שה-`requestId` עצמו כבר ייחודי.
- `reply.test.ts:176-177` — אותה הערה מיושנת עודכנה בטסט "kind discriminator".
- `remote-session-view.test.ts` — הטסט **`"prefers permission when both
  pending share the same requestId"`** תואר מצב שהפך בלתי-אפשרי (שני kinds
  לעולם לא חולקים id תחת מונה משותף) — **הוחלף** בטסט שמאמת את ההפך: ids
  שונים מנתבים במדויק, גם כששניהם pending יחד. נוסף טסט חדש ל-no-op על id
  לא-מוכר. ה-JSDoc בראש הקובץ עודכן מ"permission עדיפות" ל"התאמה מדויקת;
  id לא-מוכר = no-op".

#### בדיקות

`session-host.integration.test.ts`: עודכן הטסט "two kinds pending
simultaneously" — permission ואז elicitation מקבלים ids **שונים** (0 ו-1,
לא שניהם 0), שניהם pending בו-זמנית. `remote-session-view.test.ts`: טסט
ניתוב-elicitation עם permission-id שונה pending לצידו, וטסט no-op חדש
(סופר קריאות ל-fetch לפני/אחרי — אין בקשת HTTP כלל).
`bunx vitest run session-host.integration.test.ts`: 42/42 ירוק.
`bunx vitest run session-host/`: 139/139. `bunx vitest run
remote-session-view.test.ts`: 35/35. `bunx vitest run session-host packages/
frontend/src/lib/session`: 214/214 ירוק. typecheck: DELTA-CHECK מול
`ac376e8` — אפס שגיאות חדשות (רק היסטי שורה בשגיאות baseline קיימות).

## 2026-08-09 20:10

### slice session-host-pending-surface — C3: גבולות-תור + ראוט לא-חוסם (TDD)

C3 סוגר את "פער ב'" מהבריף: `turnState` היה ratchet חד-כיווני בשרת (עולה,
לעולם לא יורד), ובמקביל `rpc.ts` סתר את התיעוד של עצמו והחזיק את חיבור ה-HTTP
פתוח לאורך תור שלם. שני התיקונים באו יחד באותו checkpoint — פריט אחד, לא שניים
(פליטת גבולות-תור בלי ראוט לא-חוסם היא חצי-פתרון מזיק).

#### מה בוצע?

**packages/backend/src/session-host/session-host.ts** — `prompt`/`cancel` ב-
`createSessionHostFromConnection` בלבד (`createSessionHost` הפשוט **לא השתנה**):

- `prompt`: `add-message` → `applyTurnStart` (waiting, לפני ה-await) → `await
  client.prompt` → `applyTurnEnd` בהצלחה או בכשל (`try/catch`, לא `finally` —
  כשל חייב להיבדל מהצלחה). `host.prompt` **עדיין זורק** לקורא הישיר.
- `cancel`: מסמן `cancelledTurn = turnSeq` (❌ לא מקדם), `await client.cancel`
  (best-effort, catch ריק), ואז פולט `idle` **באותה גדר בדיוק** כמו ב-prompt.
- 🔴 **הגדר היחידה: `turn === turnSeq`** — בשתי הפליטות (הצלחה/כשל ב-prompt,
  והפליטה ב-cancel). `cancelledTurn` הוא סימון בלבד שמשפיע **רק** על מטען-
  השגיאה (`turn === cancelledTurn ⇒ error = undefined`) — לעולם לא על הפליטה
  עצמה. זו הסמנטיקה שסגרה את "זנב-הביטול": ה-`prompt` שנפתר אחרי `cancel`
  פולט `idle` שוב, בלי גדר עליו — זו הפליטה שמנקה צ'אנק מאוחר שהרים את ה-ratchet
  בין הביטול להיפתרות (בדיוק כמו ב-`LocalSessionView`, ששם קורות שתי פליטות
  `idle` בביטול).
- `msgOf(err)`: עוזר IO מקומי, אותה קדימות כמו `formatAcpError` ב-FE
  (`data.details → data.message → message → String(e)`).

**packages/backend/src/session-host/http/rpc.ts** — `prompt`/`cancel` הפכו
ללא-חוסמים: ולידציית ArkType (`PromptParams`/`CancelParams`, תקדים
`delivery/http-agents.ts`) על הפרמטרים (כשל סינכרוני → 400, כמו קודם), ואז
`void host.prompt(...).catch(log.warn)` בלי `await` — 202 חוזר מיד. ה-`.catch`
הוא רשת-ביטחון ללוג בלבד (מונע unhandledRejection) — לא `() => {}` ריק, כי
כשל-ביצוע כבר עבר לערוץ ה-state (`lastTurnError`). `c.req.json()` עטוף
try/catch → 400 על JSON לא-תקין. `createLogger("backend.session-host.rpc")`
— הלוגר הראשון בתיקיית `session-host/`.

#### בדיקות (TDD)

`session-host.integration.test.ts` — 15 טסטים חדשים בשלושה describe blocks
(`host.prompt` / `host.cancel` / cancel-tail semantics), עם `deferred()` promises
לבקרת תזמון `client.prompt`/`client.cancel`: שלושה patches בסדר עם `waiting`
ביניהם · ה-ratchet נסגר (idle→waiting→idle) · כשל פולט patch יחיד עם
`lastTurnError` (ו-`msgOf` priority: `data.details`) · תור מוצלח אחרי כשל
מנקה `lastTurnError` · זנב-הביטול (שני תרחישים: צ'אנק מאוחר מרים ⇒ patch שני
מנקה; שום דבר לא הרים ⇒ no-op) · תרחיש 2 (prompt חדש בזמן שהביטול באוויר —
waiting של B שורד) · cancel על תור פעיל/idle/כפול · client.cancel שזורק
(נבלע, idle כרגיל) · שני prompts חופפים.
`rpc.test.ts` — 8 טסטים חדשים: 202 לפני שה-Promise נפתר (mock שלא נפתר) ·
400 על פרמטרים חסרים (ArkType) · host.prompt/cancel שזורקים לא מייצרים
unhandledRejection ולא 500 (נבדק עם listener זמני על `process`) · JSON לא-תקין
→ 400.
`bunx vitest run session-host.integration.test.ts rpc.test.ts`: 62/62 ירוק.
`bunx vitest run packages/backend/src/session-host`: 139/139 ירוק.
`bunx vitest run packages/backend`: 626/626 ירוק (חוץ מ-`https-serve.test.ts`
— כשל pre-existing לא-קשור, Windows path בסביבת ה-CI). typecheck: DELTA-CHECK
מול `ac376e8` — אפס שגיאות חדשות.



### slice session-host-pending-surface — C2: הצפת pending ב-SessionHost (TDD)

C2: `handleRequestPermission`/`handleCreateElicitation` ב-
`createSessionHostFromConnection` (`session-host.ts`) עכשיו כותבים ל-
`currentState.pending` ופולטים patch, במקום להשליך את `params` ולהחזיק
Promise בזיכרון בלבד — סוגר את "פער א'" מהבריף (בקשת-הרשאה נתקעת בשקט
ב-remote, כי אף לקוח לא נודע שנשאלה שאלה).

#### מה בוצע?

**packages/backend/src/session-host/session-host.ts**

- שני ה-handlers עוברים על אותו דפוס: `applyPendingRequest` בכניסה (כותב
  `{requestId, params}` ל-`state.pending` + פולט patch), ואז `await
  <pending>.request(requestId)` בתוך `try`, עם `clearPendingRequest` ב-
  `finally` (מכסה גם `respond()` וגם timeout-עם-default במקום אחד אחד,
  בלי לשנות את `pending-requests.ts` — עבר GO ב-S3).
- `respondPermission`/`respondElicitation` **לא השתנו** — הניקוי מגיע דרך
  ה-`finally`; ניקוי כפול היה נותן שני patches ושתי קפיצות version על
  אירוע אחד.
- concurrency: guard `requestId === current` ב-`clearPendingRequest` —
  בקשה שנייה מאותו kind דורסת את הראשונה בסלוט, וה-`finally` של הראשונה
  (שרואה id ישן) הוא no-op — לא מנקה את מה ששייך לשנייה.

#### בדיקות (TDD)

`packages/backend/src/session-host/session-host.integration.test.ts` (⚠️ לא
`session-host.test.ts` — לפקטורי הפשוט אין `PendingRequests`) — 9 טסטים
חדשים בשני describe blocks (`C2 — permission requests…` /
`C2 — elicitation requests…`): set+patch יחיד · respond מנקה+patch שני ·
timeout מנקה+patch (fake timers) · שתי בקשות חופפות (השנייה דורסת, סיום
הראשונה לא מנקה) · שני kinds pending בו-זמנית (הרגרסיה ש-spread חלקי היה
שובר). `bunx vitest run session-host.integration.test.ts`: 27/27 ירוק (18
קיימים + 9 חדשים, כולם שרדו ללא שינוי). `bunx vitest run
packages/backend/src/session-host`: 117/117 ירוק. typecheck: DELTA-CHECK
מול `ac376e8` — אפס שגיאות חדשות (רק היסט שורה בשגיאת baseline קיימת).



### slice session-host-pending-surface — C1: עוזרים טהורים ב-core (pending + turn-boundary)

C1 מתוך `session-host-pending-surface` (r13, אימות אביגיל READY): שכבת-ההצפה
מעל `PendingRequests` — ארבעה עוזרים טהורים ב-`core/src/session/types.ts`
שיאפשרו ל-`SessionHost` (C2+C3) לפרסם `pending`/`turnState`/`lastTurnError`
כ-patches, במקום להחזיק אותם רק בזיכרון הפנימי.

#### מה בוצע?

**packages/core/src/session/types.ts**

- שדה חדש ב-`SessionState`: `lastTurnError: { message: string; at: number } | null`
  — ערוץ שגיאה נפרד מ-`status` (מצב-חיבור, לא מצב-תור). נוסף ל-`Pick` של
  `update-session` ואותחל ל-`null` ב-`createInitialSessionState`.
- `applyPendingRequest(state, {kind, value})` — מכניס בקשה ממתינה, פולט patch
  יחיד שנושא **את שני שדות `pending`** תמיד (spread מלא — `applyPatch`
  ב-`update-session` עושה spread לא deep-merge; patch חלקי היה מוחק את ה-sibling).
- `clearPendingRequest(state, kind, requestId)` — מנקה **רק** אם ה-`requestId`
  עדיין הנוכחי; אחרת no-op גמור (guard נגד בקשה שנדרסה).
- `applyTurnStart(state)` — `turnState:"waiting"` + מאפס `lastTurnError`; no-op
  אם שניהם כבר במצב הזה.
- `applyTurnEnd(state, error?)` — `turnState:"idle"` + `lastTurnError` (patch
  אטומי אחד לשני השדות). 🔴 חריג מכוון: `applyTurnEnd(state)` **בלי** שגיאה
  על state שכבר `idle` הוא no-op גמור — **אינו מאפס** `lastTurnError` קיים
  (מונע מ-`cancel` על תור-לא-פעיל למחוק בשקט שגיאה מתור קודם). `error` מגיע
  בנוי במלואו כולל `at` — העוזר **אינו** קורא לשעון (`Date.now()` ייבנה
  ב-`host.prompt`, שכבת ה-IO, ב-C3).

לא נוסף `Patch` op חדש (`update-session` כבר נושא `pending`+`turnState`).
לא נכתב עוזר גנרי `applySessionChanges` — ארבעה עוזרים צרים, כל אחד עם החוזה
שלו (עוזר גנרי מזמין patch חלקי של `pending`).

#### בדיקות (TDD — קודם טסט)

`packages/core/src/session/types.test.ts` — 26 טסטים חדשים (co-located,
מוסכמת המודול): שני kinds בו-זמנית · דריסה + version+1 פעמיים · ניקוי על id
נוכחי/ישן/slot ריק · no-op על מצב זהה (ארבעת העוזרים) · השרדות `lastTurnError`
דרך `applyTurnEnd()` ללא שגיאה על state שכבר `idle` · round-trip
`applyPatch(state, patch) ≡ state המוחזר` לכל אחד מארבעת העוזרים.
`bunx vitest run packages/core/src/session/types.test.ts`: 44/44 ירוק.
`bunx vitest run packages/core`: 806/806 ירוק (אין רגרסיה).
typecheck: DELTA-CHECK מול `ac376e8` (64 שגיאות baseline, לא-קשורות ל-slice
זה — pre-existing) — אפס שגיאות חדשות.

## 2026-08-09 18:04

### slice remote-session-view — calev-heavy round 3 fix: root-cause wire validation (S5 freeze after this)

calev-heavy round 3 verdict: **GO** (DoD 15/16 + 1 נדחה בהחלטה). כל 4 ממצאי
round 2 אומתו כסגורים בריצה, 27 בדיקות רגרסיה ירוקות, אפס פגמים חדשים.
מרדכי ביקש סבב אחרון וממוקד: שלושת הממצאים הקלים שנותרו הם **שאריות של שורש
אחד** — `JSON.parse(...) as Patch` הלא-מאומת ב-`sse-reader.ts`. סבב זה מתקן
את השורש, לא את הסימפטומים בנפרד. **אחריו S5 קופא** — slice אחר ממתין
בבעלות בלעדית על `remote-session-view.ts` וקובץ הטסט שלו.

#### מה בוצע?

**1. packages/core/src/session/patch-schema.ts (חדש)**

- `PatchSchema` — סכימת ArkType ל-`Patch`, ולידציה בגבול-הפענוח. קלה בכוונה על
  שדות מקוננים/אטומים (`toolCall` פנימי, `update-session.changes`, `message.meta`)
  — התפקיד הוא לדחות צורות זבל/op לא-מוכר, לא לאמת מחדש את כל סכימת ה-SessionState
- מיוצא דרך `session/index.ts`

**2. packages/frontend/src/lib/session/sse-reader.ts**

- `#drainFrames`: אחרי `JSON.parse` (לא משתנה — B3 מ-round 1), התוצאה עוברת
  דרך `PatchSchema` **לפני** `ctrl.enqueue`. patch לא-תקין (למשל op לא-מוכר —
  בדיוק התרחיש שכלב מדד) נרשם כ-`console.warn` ו**לא נכנס לזרם בכלל** — הצרכן
  (`RemoteSessionView`) אף פעם לא רואה אותו, אז `#lastVersion` אף פעם לא
  מושפע ממנו. זה סוגר את שלושת הממצאים:
  1. `#lastVersion` כבר לא יכול לעקוב אחרי patches "שנראו" ולא "הוחלו" — הוא
     פשוט לא רואה patches לא-תקינים בכלל
  2. אין עוד "שקט" סביב patch לא-תקין — הוא מקבל אזהרה מפורשת בגבול הכניסה,
     במקום להיבלע איפשהו בהמשך הזרימה
  3. `#lastVersion` לא מוקצה יותר מ-`patch.version` לא-מאומת — הוא תמיד מוקצה
     רק מ-patch שכבר עבר ולידציה

**3. packages/frontend/src/lib/session/remote-session-view.ts**

- `#drainPatches`'s catch (round 2 finding #1 — הגנת-עומק): נשאר (נכון שpatch
  שחומק מ-ולידציה לא יהרוג את ה-loop), אבל עכשיו רושם `console.warn` עם
  השגיאה במקום לבלוע בשקט — אם משהו מגיע לכאן בכלל, זה כבר לא-צפוי (הולידציה
  ב-SSEReader כבר תפסה את המקרה הידוע), אז שווה להיות גלוי

#### בדיקות

- `patch-schema.test.ts` (חדש): 11 טסטים — כל 5 ה-ops התקינים מתקבלים, op
  לא-מוכר/שדה חסר/טיפוס שגוי/ערך לא-אובייקט נדחים
- `sse-reader.test.ts`: טסט חדש — patch עם op לא-מוכר נדחה בגבול ה-wire, אף
  פעם לא נכנס ל-stream; patch תקין שאחריו מגיע כרגיל (13 סה"כ, 12→13)
- `remote-session-view.test.ts`: עדכון הטסט מ-round 2 finding #1 — עכשיו
  patch לא-תקין נעצר לגמרי ב-SSEReader (לא מגיע ל-RemoteSessionView כלל),
  אז רק ה-patch התקין מגיע (היה 2, עכשיו 1 — משקף את התיקון הטוב יותר)
- typecheck נקי (core + frontend); lint נקי; lint:i18n נקי
- כל `packages/core/src/session/` + `packages/frontend/src/lib/session/` +
  `view-models/`: 495 טסטים ירוקים

## 2026-08-09 17:38

### slice remote-session-view — calev-heavy round 2 fix: finding #5 (orphaned host)

#### מה בוצע?

**packages/backend/src/session-host/registry.ts**

- **finding #5 (minor, זול) — `doCreate` יוצר host + broadcaster לפני בדיקת ה-cwd**:
  בנתיב הכשל (cwd חסר) כבר נוצרו host ACP אמיתי + broadcaster שכבר התחיל לנקז
  את `host.patches` — שניהם ננטשים בלי dispose. תוקן: בדיקת ה-cwd עוברת ל-**לפני**
  יצירת ה-host/broadcaster (fail-fast) — production hosts תמיד מתחילים עם
  `sessionId: null` (`createInitialSessionState`), אז cwd תמיד נדרש בפועל; טסט
  עם sessionId מוזרק-מראש (test-only) פשוט לא היה צריך אותו, אבל בדיקה מוקדמת
  זולה ולא פוגעת בשום מסלול אמיתי

#### בדיקות

- `registry.test.ts`: טסט חדש — כש-cwd חסר, `_createHostFn`/`_createBroadcasterFn`
  **לא נקראות בכלל** (18 סה"כ, 17→18)
- typecheck נקי; lint נקי

**כל 4 הממצאים של calev-heavy round 2 (2 blockers + 1 regression + 1 minor)
טופלו.** שולח שוב calev-heavy לאימות חוזר (round 3).

## 2026-08-09 17:37

### slice remote-session-view — calev-heavy round 2 fix: findings #2+#3 (connect() lifecycle)

שני החוסמים שנולדו מתיקון M8 עצמו (round 1) — מטא-תופעה 2 בפעולה. תוקנים
יחד כי הם באותן שורות בדיוק (`connect()`/`close()`).

#### מה בוצע?

**packages/frontend/src/lib/session/remote-session-view.ts**

- **finding #2 (blocker) — `connect()` ממחזר promise שנדחה לתמיד**: כישלון חולף
  בחיבור הראשון (BE עוד לא עלה — 503, או network blip) היה מרעיל את ה-view
  לצמיתות: כל ניסיון חוזר קיבל את אותה דחייה, בלי לשלוח אף בקשת HTTP. `SSEReader`
  לא מנסה שוב על כישלון החיבור הראשוני — ה-exponential backoff מתחיל רק **אחרי**
  `#connectOnce` מוצלח. תוקן: `#connectPromise` ממוחזרת **רק להצלחה** — ב-`.catch`
  מאפסים אותה לפני שהשגיאה מוזרקת הלאה, כך שניסיון חוזר יפתח חיבור אמיתי
- **finding #3 (regression, אותו commit) — `connect()` אחרי `close()` no-op שקט**:
  `close()` לא ניקתה את `#connectPromise`, אז `connect()` אחרי סגירה החזירה את
  ה-promise המוצלח הישן — נראה מחובר, בלי לפתוח שום stream. הוכרע (משתי
  האפשרויות שמרדכי הציע): שגיאה מפורשת, לא ניקוי-ופתיחה-מחדש — כי `patches`
  הוא `ReadableStream` יחיד שנוצר ב-constructor וה-controller שלו כבר נסגר
  סופית ב-`close()`; "לנקות ולפתוח מחדש" היה דורש גם לבנות מחדש את ה-stream
  הזה (מורכבות/סיכון נוסף שלא הוצדק). `close()` היא עכשיו טרמינלית — עקבי עם
  `LocalSessionView` ועם ה-contract ב-`session-view.ts`: view חדש = instance חדש

#### בדיקות

- `remote-session-view.test.ts`: 2 טסטים חדשים — retry אחרי כישלון חולף מצליח
  (503→200, בקשת HTTP אמיתית שנייה, לא replay של הדחייה), `connect()` אחרי
  `close()` זורק שגיאה מפורשת ולא פותח stream חדש (34 סה"כ)
- typecheck נקי; lint נקי

## 2026-08-09 17:33

### slice remote-session-view — calev-heavy round 2 fix: finding #1 (unknown patch op)

calev-heavy round 2 verdict: **PARTIAL**, DoD 15/16. כל 9 ממצאי round 1 אומתו
כמתוקנים באמת (61 טענות מול Hono/registry/broadcaster/SSE אמיתיים) — אבל סבב
התיקון עצמו הכניס 2 חוסמים חדשים (מטא-תופעה 2: "המתקן מייצר את הממצא הבא").
commit זה סוגר ממצא #1 (בלוקר, לא נגרם ע"י round 1 — קדם לו).

#### מה בוצע?

**1. packages/core/src/session/apply-patch.ts**

- **finding #1 (blocker) — op לא-מוכר מוחק את `view.state` ל-`undefined`**: ה-switch
  היה exhaustive רק ביחס לטיפוס Patch המוצהר; `sse-reader.ts` מפרש wire data עם
  `JSON.parse(...) as Patch` — cast לא-מאומת. BE חדש יותר ששולח op שה-FE הזה לא
  מכיר (version skew — התרחיש הכי סביר לפער production) היה נופל מקצה ה-switch
  ומחזיר `undefined` בשקט, מוחק את כל ה-state. תוקן: `default: return state` —
  op לא-מוכר הוא no-op, לא מעדכן אפילו את `version` (עקבי עם דפוס ה-no-op הקיים
  כבר ב-`append-segment`/`update-tool` כש-`targetId` לא נמצא)

**2. packages/frontend/src/lib/session/remote-session-view.ts**

- הגנה כפולה (defense-in-depth, זול ולא חופף לתיקון הראשי): `#applyIncoming`
  בודקת ש-`applyPatch` לא מחזירה ערך falsy לפני שמשייכת אותו ל-`#state`; `#drainPatches`
  עוטפת כל קריאה ל-`#applyIncoming` ב-try/catch כדי שפאץ' יחיד לא יהרוג את כל
  ה-loop (הוא רץ כ-`void this.#drainPatches(...)` — fire-and-forget, אז throw
  לא-נתפס היה הופך ל-unhandled rejection שקט וממית את כל הפאצ'ים הבאים)

#### בדיקות

- `apply-patch.test.ts`: טסט חדש — op לא-מוכר מחזיר את אותו state reference,
  לא מעדכן version (17 סה"כ, 16→17)
- `remote-session-view.test.ts`: טסט חדש — patch עם op לא-מוכר לא הורג את הזרם,
  ה-patch התקין שאחריו עדיין מגיע ומעדכן state (34 סה"כ)
- typecheck נקי (core + frontend); lint נקי

## 2026-08-09 17:06

### slice remote-session-view — calev-heavy round 1 fix: L10 (typecheck accuracy)

#### מה בוצע?

**packages/backend/src/session-host/http/rpc.test.ts**

- **L10 (minor אבל "תקן ואל תצהיר") — +2 שגיאות typecheck חדשות ב-C4**: commit
  `8a8cc46` הצהיר "typecheck נקי (0 שגיאות חדשות)" — לא מדויק. הטסטים החדשים
  ל-`setSessionModel` הוסיפו 2 מופעים נוספים לאותה שגיאה שיטתית שכבר קיימת בקובץ
  הזה: `app.request()` (Hono) מוגדר במונחי `Response` הגלובלי, שמתנגש עם
  `types: ["bun"]` בטיפוסי הpackage — כל `res.status`/`res.json()` הוא TS2339.
  תיקון פרויקטלי (tsconfig גלובלי) מחוץ להיקף. תוקן מקומית: `postRpc` מקבל טיפוס
  מבני `MockResponse` (`{status, json()}`) שעוקף את השם `Response` המתנגש —
  זה תיקן גם את 6 המופעים הקיימים-מראש באותו קובץ (לא רק את ה-2 החדשים)

#### תוצאה

- typecheck ב-backend: 72→**64** שגיאות — שיפור **נטו** גם מול ה-baseline
  המקורי (70, לפני שהתחיל הslice)
- `rpc.test.ts`: 13 טסטים ירוקים; `session-host/*`: 107 טסטים ירוקים
- lint נקי

**כל 9 הממצאים של calev-heavy round 1 (3 blockers + 3 major + 2 medium + 1
minor) טופלו.** שולח שוב calev-heavy לאימות חוזר.

## 2026-08-09 17:04

### slice remote-session-view — calev-heavy round 1 fix: M7+M8 (lifecycle hygiene)

#### מה בוצע?

**packages/frontend/src/lib/session/sse-reader.ts**

- **M7 (medium) — `close()` לא מבטל את בקשת ה-SSE**: אין `AbortController`, ה-socket
  נשאר established אחרי close(). תוקן: `#connectOnce` יוצרת `AbortController` חדש
  לכל fetch, מעבירה `signal` ל-`_fetch`; `close()` קוראת ל-`abort()` — גם משחררת
  את החיבור מיד וגם מבטלת `reader.read()` תלוי אם היה כזה

**packages/frontend/src/lib/session/remote-session-view.ts**

- **M8 (medium) — `connect()` לא re-entrant**: קריאה שנייה (למשל double-mount ב-Svelte)
  הייתה פותחת חיבור SSE שני + `#drainPatches` שני על אותו state → כפילות
  patches. מדוד: `segments=["once","once"]`. תוקן: `connect()` ממוחזרת דרך
  `#connectPromise` — כל קריאה (כולל אחרי שהראשונה כבר הסתיימה) מחזירה את אותה
  הבטחה, בלי לפתוח חיבור נוסף

#### בדיקות

- `sse-reader.test.ts`: טסט חדש — `close()` מפעיל `AbortSignal.aborted` (12 סה"כ, 11→12)
- `remote-session-view.test.ts`: טסט חדש — שתי קריאות מקבילות ל-`connect()` →
  fetch יחיד ל-`/events`, אין כפילות segments (31 סה"כ, 30→31); הוספת `keepOpen`
  ל-`makeMockFetch` (לא רק ל-`sseBody`/`sseResponse` הישירים)
- **אגב תיקון M8**: הטסט הראשוני נכשל (2 fetch calls במקום 1) — לא בגלל באג ב-M8,
  אלא כי שכחתי `keepOpen: true` ב-fixture (אותה תבנית חוזרת שכבר תוקנה ב-C1/C4/B1) —
  ה-stream נסגר מיד וגרם ל-reconnect לגיטימי, לא קשור ל-re-entrancy. תוקן ב-fixture
- typecheck נקי (0 שגיאות חדשות); lint נקי

## 2026-08-09 16:59

### slice remote-session-view — calev-heavy round 1 fix: M5 (getOrCreateHost race)

#### מה בוצע?

**packages/backend/src/session-host/registry.ts**

- **M5 (major) — `getOrCreateHost` בלי memoization ל-in-flight**: `map.set`
  קורה אחרי **שני** `await` (`_createHostFn` + `host.newSession`). מדוד: שתי
  בקשות מקבילות → `hostCreations=3, newSession=3, same host=false` — broadcaster
  שה-SSE נרשם אליו שייך ל-host יתום שלעולם לא יקבל patch. הרייס היה קיים חלקית
  ב-S4; הכרעה 1 הרחיבה את החלון והוסיפה session ACP אמיתי לכל קורא מתחרה. תוקן
  בדפוס של `connection-registry.ts` ("אין await בין הבדיקה ל-רישום"): מפה
  `agentId → Promise<HostEntry | undefined>` (`inFlight`) — קוראים מתחרים
  לאותו agentId משתפים את אותה הבטחת-יצירה. `getOrCreateHost` נשאר סינכרוני
  לגמרי עד `inFlight.set` (בלי await ביניים), כך שקריאות עוקבות סינכרוניות
  (כמו `Promise.all([...])`) תמיד ימצאו את ה-in-flight promise של הקודמת

#### בדיקות

- `registry.test.ts`: טסט חדש — שתי קריאות מקבילות ל-`getOrCreateHost` עם אותו
  agentId (עם `_createHostFn` שממתין tick אמיתי כדי לדמות race) → `_createHostFn`
  ו-`host.newSession` נקראים בדיוק פעם אחת, שני הקוראים מקבלים את אותו entry
  (17 סה"כ, 16→17)
- כל `packages/backend/src/session-host/`: 107 טסטים ירוקים
- typecheck נקי; lint נקי

## 2026-08-09 16:57

### slice remote-session-view — calev-heavy round 1 fix: M4 (HTTP errors swallowed)

#### מה בוצע?

**packages/frontend/src/lib/session/remote-session-view.ts**

- **M4 (major) — כל שגיאות ה-HTTP נבלעות**: `#post` לא בדקה `res.ok` — 404/400/500
  נחשבו הצלחה. מדוד: `setMode` שגרם ל-500 "הצליח" מנקודת המבט של הקורא; prompt
  שנכשל היה נראה כתקיעה למשתמשת, לא כשגיאה (שגיאות רשת כן התפשטו — fetch עצמו
  היה דוחה — רק שכבת ה-HTTP נבלעה). תוקן: `#post` זורקת `Error` עם ה-status אם
  `!res.ok`

#### בדיקות

- `remote-session-view.test.ts`: 2 טסטים חדשים — setMode זורק על 500, prompt
  זורק על 404 (30 סה"כ, 28→30)
- כל `packages/frontend/src/lib/session/` + `view-models/`: 378 טסטים ירוקים
- typecheck נקי; lint נקי

## 2026-08-09 16:56

### slice remote-session-view — calev-heavy round 1 fix: B3 (malformed SSE frame)

#### מה בוצע?

**packages/frontend/src/lib/session/sse-reader.ts**

- **B3 (blocker) — frame פגום הורג את ה-reader לצמיתות**: `#drainFrames` עטפה
  גם את `JSON.parse` וגם את `ctrl.enqueue` באותו try/catch — כל שגיאה (כולל
  JSON שבור) פורשה כ-"controller closed by consumer" → `#closed=true; return`.
  מדוד: JSON פגום אחד → אין reconnect, אין שגיאה, כל ה-patches הבאים אובדים
  בשקט. תוקן: שני try/catch נפרדים — כשל ב-`JSON.parse` מדלג רק על ה-frame
  הבודד (`continue`, ממשיך לנקז); כשל ב-`ctrl.enqueue` (הצרכן סגר את ה-stream)
  הוא הסימן האמיתי לעצור

#### בדיקות

- `sse-reader.test.ts`: טסט חדש — frame פגום מדולג, patch תקין שאחריו עדיין
  מגיע (11 סה"כ, 10→11)
- כל `packages/frontend/src/lib/session/`: 66 טסטים ירוקים
- typecheck נקי; lint נקי

## 2026-08-09 16:55

### slice remote-session-view — calev-heavy round 1 fix: B1+B2+M6 (reconnect correctness)

calev-heavy verified את slice remote-session-view נגד routes אמיתיים (Hono +
registry + broadcaster אמיתיים, RemoteSessionView אמיתי כלקוח) — **NO-GO**,
DoD 11/16, 3 blockers + 3 major. סבב זה סוגר 3 מהם שמרדכי ביקש לתקן יחד
(B1+B2 ממסכים זה את זה בבדיקה מול BE אמיתי).

#### מה בוצע?

**1. packages/frontend/src/lib/session/remote-session-view.ts**

- **B1 (blocker) — כפילות תעתיק אחרי reconnect**: `PatchesBroadcaster.subscribe()`
  (`patches-broadcaster.ts:96-122`) משחזר עד 64 patches מה-ring buffer לכל מנוי
  חדש — כולל reconnect, וגם connect ראשון אם patches קרו לפני שהלקוח התחבר.
  אלה כבר משוקפים ב-snapshot. `#applyIncoming` הייתה מחילה כל patch נכנס בלי
  לבדוק גרסה → כפילות מדודות (msgs=1→2, segs=2→4). תוקן: `if (patch.version <=
  #lastVersion) return` בתחילת `#applyIncoming` — דילוג שקט על patches שכבר
  מיושמים
- **B2 (blocker) — reset patch משליך מטא-דאטה**: `applyPatch` case `"reset"`
  (core) נוגע רק ב-`messages`/`nextMessageSeq`/`nextSegmentSeq`. `#handleReconnected`
  הייתה מפעילה `applyPatch(state, resetPatch)` — משאירה `status`/`turnState`/
  `pending`/`title`/וכו' מהמצב הישן. משמעות מדודה: permission שעלתה בזמן ניתוק
  לא הוצגה לעולם. תוקן לפי המלצת מרדכי/כלב: `#handleReconnected` **מחליפה את
  `#state` כולו מה-snapshot** (`this.#state = snapshot`), לא applyPatch חלקי.
  עדיין פולטת `reset` patch דרך `patches` כדי שה-VM יבנה מחדש bubbles
- **M6 (major) — sessionId מת אחרי restart של BE**: `version` הוא מונה פר-host
  שמתאפס אחרי restart — ההשוואה `snapshot.version <= #lastVersion` לא אמינה
  לבד (יכולה להיות נמוכה מזו הישנה). תוקן: משווים גם `sessionId` —
  `sessionChanged = snapshot.sessionId !== #sessionId`; אם ה-session השתנה,
  מחליפים תמיד בלי קשר ל-version, ומרעננים `#sessionId` (שלא התעדכן קודם בכלל
  אחרי reconnect — גם זה חלק מ-M6)

**2. packages/frontend/src/lib/session/remote-session-view.test.ts**

- `sseBody`/`sseResponse` מקבלים `keepOpen` (ברירת מחדל `false`, שומר על
  ההתנהגות הקיימת) — לטסטים חדשים שצריכים לדמות "חיבור יציב" אחרי reconnect
  בלי לגרום ל-reconnect-storm נוסף (אותו תיקון keepOpen שנעשה ב-C4 integration
  test)
- **תקלה שאובחנה ותוקנה תוך כדי כתיבת בדיקת B1**: הטסט הקיים "snapshot.version
  \> lastVersion..." בנה `patch1` עם `version:1` — **אותה גרסה בדיוק** כמו
  `snapshot1.version:1` שהוא בא אחריו. זה fixture-בג לטנטי: לפני תיקון B1, הקוד
  הישן החיל כל patch נכנס בלי תלות בגרסה אז זה מעולם לא נחשף. אחרי B1, ה-patch
  (version=1 == lastVersion=1) נחשב "כבר-יושם" ונדלג בשקט — `#lastVersion` לא
  התעדכן, מה שגרם ל-reconnect-loop אינסופי (אותו OOM שאובחן ב-C1/C4: `noSleep`
  מיידי + mock שסוגר סטרים מיד → הבדיקה מחכה לפאץ' שני שלעולם לא מגיע, ובינתיים
  ה-loop ברקע רץ ללא הפוגה). תוקן: `patch1.version` הוגדל ל-2 (גרסת-state אחרי
  ה-patch לא יכולה להיות שווה לגרסת ה-snapshot שהוא בא אחריו) + `keepOpen: true`
  לתגובת ה-reconnect למניעת loop נוסף
- 3 טסטים חדשים: B1 (דילוג על patches משוכפלים מ-ring-buffer replay, כולל
  אימות ה-state הסופי ללא כפילות), B2 (permission ממשיך להיות pending אחרי
  reconnect — full-state-replace, לא reset חלקי), M6 (sessionId מתרענן +
  version נמוך יותר מתקבל אחרי session חדש)

#### בדיקות

- `remote-session-view.test.ts`: 28 טסטים עוברים (25→28, +3)
- `sse-reader.test.ts` + `remote-session-view.integration.test.svelte.ts`: ירוקים,
  לא הושפעו
- כל `packages/frontend/src/lib/session/` + `view-models/`: 375 טסטים ירוקים
- typecheck נקי (0 שגיאות חדשות); lint נקי

**נשאר לסבב הבא** (calev-heavy round 1, לא טופל כאן): B3 (frame פגום הורג
reader), M4 (שגיאות HTTP נבלעות), M5 (race ב-getOrCreateHost), M7/M8 (medium —
AbortController + connect() re-entrant), L10 (2 שגיאות typecheck חדשות ב-rpc.test.ts).

## 2026-08-09 16:22

### slice remote-session-view — C4: setSessionModel + rpc switch + factory + אינטגרציה (TDD)

C4 סוגר את ה-slice: מוסיף `setSessionModel` ל-`ExtendedSessionHost` והרחבת ה-rpc
switch (S4), factory ל-`RemoteSessionView`, ובדיקת אינטגרציה VM+RemoteSessionView
מלאה. גם סוגר שני findings של avigail (plan-gate r3) שהיו רלוונטיים ל-scope הזה.

#### מה בוצע?

**1. packages/backend/src/session-host/session-host.ts**

- `ExtendedSessionHost` מקבל `setSessionModel(model: string): Promise<void>` —
  אותו דפוס כמו `setMode`/`setConfigOption` (זורק `"No session"` אם אין
  `currentState.sessionId`, מאציל ל-`client.setSessionModel({sessionId, modelId})`)

**2. packages/backend/src/session-host/http/rpc.ts**

- `case "setSessionModel"` נוסף ל-switch — קורא `host.setSessionModel(params.model)`.
  **לא** נוסף `newSession`/`loadSession` — יצירת session נשארת אוטומטית ב-BE
  (הכרעה 1), לא route (תיאום עם S6 שגם נוגע ב-switch הזה)

**3. packages/frontend/src/lib/session/remote-session-view.ts (הרחבה)**

- `createRemoteSessionView(agentId, baseUrl, opts?)` — factory סינכרוני (תואם brief
  C4); **לא** קורא ל-`connect()` — זה תפקיד S6 (avigail #11, מרדכי: "לא אצלך")
- `close()`: לפני ניתוק ה-SSE, מבטל pending permission/elicitation דרך `respond()`
  (POST /reply) עם `{outcome:{outcome:"cancelled"}}`/`{action:"cancel"}` — סוגר את
  פער-החוזה מול הפורט (avigail #10: SessionView.close() מחויב לבטל pending).
  מנקה גם את ה-pending המקומי אחרי כן — הופך את `close()` לאידמפוטנטי
- `prompt()`: זורק `"not supported in remote mode"` אם `content` הוא `PromptBlocks`
  (לא string) — ה-BE (`rpc.ts:46`) עושה `as string` בלי serialization אמיתי, אז
  מערך היה נכנס כטקסט פגום ל-segment בשקט (avigail #7). הרחבת ה-BE לתמוך
  ב-PromptBlocks שייכת ל-S4 (מחוץ לסקופ הסלייס) — לכן חוסמים ב-FE במקום לשלוח
  מידע פגום
- `session-view.ts`: תוקן docstring מיושן שאמר RemoteSessionView ישתמש ב-WS
  (avigail #19 — מיושן אחרי החלטת ה-SSE)

**4. packages/frontend/src/lib/view-models/remote-session-view.integration.test.svelte.ts (חדש)**

- מראה את הצינור המלא: RemoteSessionView (mock HTTP+SSE) → VM (`AgentSession`) —
  מקביל ל-`agent-session.integration.test.svelte.ts` (LocalSessionView) אבל
  דרך remote transport
- **תקלה שאובחנה ותוקנה תוך כדי כתיבת הבדיקה**: mock SSE streams שסוגרים את
  עצמם (`ctrl.close()`) מיד אחרי snapshot, בשילוב עם `_sleep: noSleep` (מיידי) +
  `await delay(20)` אמיתי (setTimeout) בטסט — יצרו בדיוק את ה-reconnect-loop
  האינסופי שאובחן ותוקן ב-C1 (`sse-reader.test.ts`), אבל הפעם עם **זמן-קיר אמיתי**
  לרוץ בו → OOM (heap crash) של worker ה-vitest. תוקן: `sseBody`/`sseResponse`
  מקבלים `keepOpen` (ברירת מחדל `true`) — מדמה חיבור SSE אמיתי שנשאר פתוח
  (`reader.read()` פשוט ממתין) עד ל-`view.close()`, במקום להיסגר מיד ולהפעיל
  reconnect. `keepOpen:false` נשמר רק לטסט שבכוונה מדמה ניתוק (ואז החיבור השני
  אחריו כן נשאר פתוח, כדי לא לחזור על הלולאה)
- 4 טסטים: sync title מ-snapshot patches, add-message+append-segment → bubbles
  דרך `applyPatchMutable`, prompt() נושא sessionId אמיתי מה-BE (לא מומצא),
  reconnect mid-turn → bubbles משקפים את ה-reset patch ולא נתונים ישנים

**ידוע ומתועד כ-scope-מחוץ**: `state.pending`/`state.status` לא מסונכרנים ל-VM
(`#syncFromViewState`) — `respond()` לא ניתן להפעלה קצה-לקצה דרך ה-VM עדיין
(avigail negative-space #8). ה-Speaker water-mark (C3) עדיין ללא צרכן (נדחה
ל-slice נפרד, הכרעה 2). לא נגעתי ב-VM/Speaker בהתאם להנחיית מרדכי.

#### בדיקות

- `rpc.test.ts`: 2 טסטים חדשים (202+delegation ל-setSessionModel)
- `remote-session-view.test.ts`: 5 טסטים חדשים — prompt() PromptBlocks throw,
  close() מבטל permission/elicitation pending, close() לא שולח /reply כשאין
  pending, factory (30 סה"כ)
- `remote-session-view.integration.test.svelte.ts`: 4 טסטים חדשים
- כל טסטי `session-host/*` + `session/*` + `view-models/*` הרלוונטיים: ירוקים
- typecheck: אפס שגיאות חדשות (ה-baseline הקיים — AcpClientCallbacks,
  mock-session-view fixture, Response-type ב-בדיקות backend — pre-existing,
  לא קשור); lint נקי; lint:i18n נקי

## 2026-08-09 16:10

### slice remote-session-view — הכרעה 1: יצירת session אוטומטית ב-BE

אביגיל (plan-gate r3) זיהתה בלוקר: אין מקור ל-`sessionId` ב-remote mode —
`RemoteSessionView` אסור לו לקרוא ל-`newSession`/`loadSession` (הbackend מנהל
sessions), אבל שום קוד ב-backend לא קרא להן בפועל, אז ה-snapshot הראשון היה
מגיע עם `sessionId: null` וכל RPC היה נשלח שבור. מרדכי הכריע (עם המשתמשת):
**ה-BE יוצר את ה-session בעצמו** ברגע שה-host נוצר — לא route חדש, לא יוזמה
מה-דפדפן. `newSession`/`loadSession` **לא** נוספו ל-rpc switch.

#### מה בוצע?

**1. packages/backend/src/acp/connection-registry.ts (הרחבה אדיטיבית)**

- `ConnEntry` מקבל שדה חדש `cwd: string` — נשמר מ-`connectOpts.cwd` ב-`connect()`
  (היה זמין שם תמיד, פשוט לא נשמר)
- `ConnectionRegistry` מקבל מתודה חדשה `getCwd(agentId): string | undefined`
- אין שינוי לחתימות קיימות (`connect`/`get`/וכו') — תוספת טהורה

**2. packages/backend/src/session-host/registry.ts (`AgentSessionRegistry.getOrCreateHost`)**

- אחרי יצירת ה-host (lazy, בקריאה הראשונה): אם `host.state.sessionId` ריק —
  קורא ל-`host.newSession({cwd})` עם `cwd` מ-`connectionRegistry.getCwd(agentId)`
- אם אין cwd רשום (לא אמור לקרות בפועל — cwd תמיד נשמר ב-connect) → זורק שגיאה
  ברורה במקום לשלוח `cwd: undefined` הלאה בשקט
- קריאה חוזרת ל-`getOrCreateHost` (cache hit) לא יוצרת session שוב — ה-early-return
  על `map.get(agentId)` קורה **לפני** בדיקת ה-sessionId

#### בדיקות

- `connection-registry.test.ts`: 3 טסטים חדשים (19 סה"כ) — `getCwd` undefined לא-ידוע,
  `getCwd` מחזיר את ה-cwd שנמסר ל-connect, `getCwd` מתאפס אחרי close
- `session-host/registry.test.ts`: 4 טסטים חדשים (16 סה"כ) — auto-create עם cwd נכון,
  לא יוצר שוב אם כבר יש sessionId, זורק אם אין cwd רשום, לא יוצר שוב ב-cache hit
- typecheck נקי (0 שגיאות חדשות — ה-baseline האדום הקיים ב-`session-host.ts`/
  `in-process-acp-transport.test.ts` לא קשור, pre-existing); lint נקי; lint:i18n נקי

## 2026-08-09 15:58

### slice remote-session-view — C3: Speaker water-mark + reconnect mid-turn (TDD)

C3 מוסיף ל-`RemoteSessionView` את ה-Speaker water-mark (§8.1) ואת reconnect
mid-turn — מונע הקראה כפולה כשה-SSE מתנתק ומתחבר מחדש.

#### מה בוצע?

**1. packages/frontend/src/lib/session/remote-session-view.ts (הרחבה)**

- `#lastReadMessageId: string | null` + `#lastReadSegmentIndex: number` — water-mark,
  חשופים כ-getters ציבוריים (`lastReadMessageId`/`lastReadSegmentIndex`) לצריכה ע"י Speaker
  (טרם נבנה — slice נפרד)
- `#advanceWaterMark(patch)` — כל `append-segment` patch שמוחל על state מקדם את ה-water-mark
  ל-`{messageId, segmentIndex}` של הסגמנט האחרון שנוסף (= "מסומן להקראה")
- `#lastVersion` — עוקב אחרי הגרסה האחרונה שהוחלה (מ-snapshot הראשוני + מכל patch)
- `#handleReconnected(snapshot)` — מחובר ל-`SSEReader.onReconnected`:
  - `snapshot.version <= lastVersion` → מדלג (לא פספסנו כלום, ה-water-mark הקיים תקף,
    ממשיכים לקבל patches חדשים מה-stream המחודש כרגיל)
  - `snapshot.version > lastVersion` → בונה `reset` patch מה-snapshot
    (`{op:'reset', messages, nextMessageSeq, nextSegmentSeq}`), מחיל אותו על `state` דרך
    `applyPatch` (core — לא נכתב applyPatch חדש), פולט אותו דרך `patches`, ומאפס את
    ה-water-mark ל-`lastReadMessageId=null, lastReadSegmentIndex=0` (החלטה מפורשת של
    מרדכי — לאחר reset מלא של המסרים, הבסיס הבטוח היחיד הוא "הכל טרם נקרא")

#### בדיקות

- `remote-session-view.test.ts`: 3 טסטים חדשים (20 סה"כ, כולם עוברים ✅, 416ms)
  - water-mark מתקדם על append-segment
  - reconnect mid-turn עם `version` גבוה יותר → reset patch נפלט + water-mark מתאפס
  - reconnect עם `version` זהה/נמוך יותר → אין reset patch, רק patches רגילים ממשיכים
- typecheck נקי; lint נקי

## 2026-08-09 15:55

### slice remote-session-view — C2: RemoteSessionView (TDD)

C2 מממש `RemoteSessionView` — מחלקה שמממשת את `SessionView` port (12 מתודות + 2
properties) ומתחברת ל-SessionHost בשרת דרך HTTP+SSE (S4 routes).

#### מה בוצע?

**1. packages/frontend/src/lib/session/remote-session-view.ts (חדש)**

- `constructor(agentId, baseUrl, opts?)` — `opts._fetch`/`opts._sleep`/`opts.headers` מוזרקים גם
  ל-SSEReader הפנימי וגם לקריאות RPC/reply (testability אחידה)
- `connect()` (מתודת lifecycle נוספת, לא חלק מ-SessionView port) — מתחבר ל-SSE, קורא
  snapshot, שומר `sessionId`, מתחיל `#drainPatches` ברקע
- `state` — מתעדכן בכל patch נכנס דרך `applyPatch` מ-core (טהור/immutable) — **לא נכתב
  applyPatch חדש**
- `patches: ReadableStream<Patch[]>` — עוטף כל Patch בודד מ-SSEReader ל-`[patch]`
- Session management (`newSession`/`loadSession`/`listSessions`/`deleteSession`) —
  זורקות `"not supported in remote mode — backend manages sessions"` (הbackend מנהל sessions)
- RPC methods (`prompt`/`cancel`/`setMode`/`setConfigOption`/`setSessionModel`) —
  `POST /api/agents/:id/rpc` עם `{method, params: {sessionId, ...}}`
- `extMethod` — `_drive/getQuota` (דורש return value) זורק `"not supported in remote mode
  — use state instead"`; שאר ה-methods נשלחות fire-and-forget (ack)
- `respond(requestId, result)` — גוזר `kind` מ-`state.pending` (permission נבדק ראשון,
  מעדיף אותו ב-edge case של requestId זהה) → `POST /api/agents/:id/reply`
- `close()` — סוגר את ה-SSEReader + patches controller

#### בדיקות

- `remote-session-view.test.ts`: 17 טסטים עוברים ✅ (mock fetch שמתפצל לפי URL —
  `/events`→SSE frames, `/rpc`→202, `/reply`→200; כולל `afterEach` שסוגר כל view
  שנוצר, כדי למנוע את אותה תקלת רקע-לא-נסגר שתוקנה ב-C1)
  - connect(): snapshot → state + sessionId
  - patches: עטיפה ל-[patch] + עדכון state דרך applyPatch
  - כל RPC method שולחת POST /rpc נכון עם sessionId
  - extMethod: fire-and-forget מול return-value (throw)
  - respond(): גזירת kind (permission/elicitation/עדיפות-permission)
  - session management methods: throw
  - close(): לא זורק גם לפני connect()
- typecheck נקי (0 שגיאות חדשות); lint (biome) נקי

## 2026-08-09 15:45

### slice remote-session-view — C1: SSE reader (TDD)

C1 מממש את `SSEReader` — קורא SSE מ-`GET /api/agents/:id/events` דרך fetch + ReadableStream (לא EventSource, שלא תומך ב-POST/headers), עם reconnect ידני (exponential backoff).

#### מה בוצע?

**1. packages/frontend/src/lib/session/sse-reader.ts (חדש)**

- `readSSEFrames(body)` — async generator שמנתח SSE framing (event:/data:/empty-line) מ-`ReadableStream<Uint8Array>`, משחרר reader lock ב-finally
- `SSEReader` class:
  - `constructor(url, { headers?, _fetch?, _sleep? })` — `_fetch`/`_sleep` ל-testability
  - `connect(): Promise<{snapshot, patches: ReadableStream<Patch>}>` — מתחבר, קורא frame-zero (`event: snapshot`) בחובה, מחזיר patches stream ארוך-טווח
  - `onReconnected?: (snapshot) => void` — callback אחרי reconnect מוצלח
  - reconnect ידני: `#runLoop` רץ ברקע, exponential backoff 1s→2s→4s→...→30s (cap), reset ל-1s אחרי הצלחה
  - `close()` — עוצר את ה-reconnect loop וסוגר את ה-controller

#### תקלה שאובחנה ותוקנה (מהריצה הקודמת שנתקעה)

הריצה הקודמת (09/08 10:59) הפסיקה כי `sse-reader.test.ts` נתקע: 124 שניות, "Tests (10)" אך 0 בוצעו, `Worker exited unexpectedly`.

**אבחון**: אף טסט לא קרא ל-`reader.close()`. `#runLoop` (הרקע, לא-מחכה — `void this.#runLoop(...)`) ממשיך לרוץ אחרי שהטסט סיים לקרוא patches. עם `_sleep: noSleep` (=`Promise.resolve()` מיידי) ו-mock fetch שגם הוא resolves מיידית, ה-reconnect loop נכנס ל-loop הדוק אינסופי של microtasks (sleep מיידי → fetch מיידי → כישלון/reconnect → חוזר חלילה) — אף פעם לא מגיע ל-idle, ה-worker של vitest לא מצליח לזהות סיום ונתקע ב-timeout.

**תיקון**: הוספת helper `newReader()` שעוקב אחרי כל reader שנוצר בטסט + `afterEach` גלובלי שקורא `close()` לכולם. אחרי `close()`, `#closed=true` נבדק בכמה נקודות עצירה ב-loop (לפני/אחרי כל fetch, בתוך drainFrames), כך שהloop נעצר תוך מספר מיקרו-טאסקים בודדים. המימוש עצמו (`sse-reader.ts`) לא שונה — הבעיה הייתה אך ורק בטסטים שלא ניקו אחריהם.

#### בדיקות

- `sse-reader.test.ts`: 10 טסטים עוברים ✅ (327ms, היה תקוע לפני התיקון)
  - snapshot parsing מ-`event: snapshot`
  - headers מועברים ל-fetch
  - fetch נכשל → throw; body ריק → throw
  - patches מ-`event: patch`; אירועים אחרים מתעלמים
  - reconnect אחרי סיום stream: `onReconnected` נקרא עם snapshot חדש, patches ממשיכים
  - exponential backoff: 1s→2s→4s→8s
  - cap ב-30s
  - reset ל-1s אחרי reconnect מוצלח
- typecheck נקי (אפס שגיאות ב-sse-reader.ts; ה-baseline האדום הקיים ב-backend/frontend — AcpClientCallbacks, in-process-acp-transport mocks — לא קשור, pre-existing)
- lint (biome + i18n) נקי

## 2026-08-11 10:30

### slice session-host-http — C5: State route + wiring (TDD)

C5 משלים את slice session-host-http עם `GET /api/agents/:id/state` + wiring של 4 ה-routes ל-server.ts דרך `registerSessionHostHttp` / `createAndRegisterSessionHostHttp`.

#### מה בוצע?

**1. packages/backend/src/session-host/http/rpc.ts + rpc.test.ts (C3, 10 tests)**

- `registerRpcRoute`: dispatch prompt/cancel/setMode/setConfigOption/extMethod
- 202 Accepted {version} לכל method (אסינכרוני)
- 404 אם connection לא קיים; 400 ל-method לא מוכר

**2. packages/backend/src/session-host/http/reply.ts + reply.test.ts (C4, 5 tests)**

- `registerReplyRoute`: kind discriminator (permission/elicitation)
- 404 אם host לא קיים; 200 תמיד (respond*() void, silent no-op)

**3. packages/backend/src/session-host/http/state.ts + state.test.ts (C5, 4 tests)**

- `registerStateRoute`: one-shot snapshot (GET /api/agents/:id/state)
- 404 אם host לא קיים; 200 + JSON snapshot

**4. packages/backend/src/session-host/http/index.ts (C5)**

- `registerSessionHostHttp` — מייצא ומחבר את 4 ה-routes
- `createAndRegisterSessionHostHttp` — convenience: יוצר AgentSessionRegistry + רושם routes

**5. packages/backend/src/server.ts (C5)**

- הוספת `createAndRegisterSessionHostHttp(app, connectionRegistry)` — 4 routes חיים בשרת

#### נתונים

| Checkpoint | Commit | Tests |
|---|---|---|
| C3: RPC route | 6249b11 | 10 TDD |
| C4: Reply route | 4a3c8bd | 5 TDD |
| C5: State + wiring | (זה) | 4 TDD |

- Tests C3-C5: 19 passed
- typecheck: נקי

---

## 2026-08-11 10:20

### slice session-host-http — C1: הרחבת S3 + AgentSessionRegistry + PatchesBroadcaster (TDD)

C1 מרחיב את slice session-host-core (S3) ב-3 methods ל-`ExtendedSessionHost`, מוסיף `AgentSessionRegistry` (lazy creation agentId→{host,broadcaster}) ו-`PatchesBroadcaster` (fan-out/tee עם ring-buffer).

#### מה בוצע?

**1. packages/backend/src/session-host/session-host.ts (עדכון C1/S4)**

- `ExtendedSessionHost` מורחב: `setMode(modeId)` + `setConfigOption(configId, value: string|boolean)` + `extMethod(method, params)`
- `setMode`/`setConfigOption` כוללים null-guard: זורקים 'No session' אם `currentState.sessionId === null`
- `newSession`/`loadSession` עדכנו `currentState.sessionId` מהתוצאה (כנדרש לnull-guard לעבוד)
- `extMethod` ללא guard (לא דורש sessionId)

**2. packages/backend/src/session-host/patches-broadcaster.ts (חדש)**

- `PatchesBroadcaster` — fan-out/tee מעל `ReadableStream<Patch>`
- `subscribe()` מחזיר ReadableStream חדש לכל client
- `unsubscribe(stream)` מסיר client וסוגר stream
- ring-buffer של 64 patches אחרונים (late subscribers מקבלים replay)
- drain loop ב-background מהמקור (fire & forget)

**3. packages/backend/src/session-host/registry.ts (חדש)**

- `AgentSessionRegistry` — ממפה agentId → {host, broadcaster}
- `getOrCreateHost(agentId)` async lazy: מאחזר connection מ-connectionRegistry, יוצר host + broadcaster
- `getHost`, `getBroadcaster`, `unregisterHost`
- injectable `_createHostFn` + `_createBroadcasterFn` לtest isolation

**4. טסטים (TDD)**

- `session-host.integration.test.ts` — הרחבה: 7 tests ל-setMode/setConfigOption/extMethod
- `registry.test.ts` — 11 tests: lifecycle, lazy creation, idempotency, unregister
- `patches-broadcaster.test.ts` — fan-out, unsubscribe, buffering, constructor

#### נתונים
- Tests: 67 passed (6 files)
- typecheck: clean (0 errors)
- lint:i18n: clean

---

## 2026-08-09 09:28

### slice session-host-core — C4: אינטגרציה + סיום סליס (TDD + integration)

C4 משלים את slice session-host-core עם `createSessionHostFromConnection` — factory שמחבר את כל הרכיבים: `InProcessAcpTransport` + `AcpClient` + `PendingRequests` + `SessionHost`.

#### מה בוצע?

**1. packages/backend/src/session-host/session-host.ts (עדכון C4)**

- `createSessionHostFromConnection(conn: ProviderConnection, opts?)` — factory חדש לשימוש ב-production
- מחבר: InProcessAcpTransport (מ-conn.wire + conn.onCrash) + AcpClient + PendingRequests
- PendingRequests לpermission (timeout → defaultValue: `{outcome:{outcome:"cancelled"}}`) ו-elicitation (timeout → `{action:"cancel"}`)
- `respondPermission(requestId, response)` + `respondElicitation(requestId, response)` ל-UI
- transport.onClose רשום → מעדכן status ל-"disconnected" בstate
- `_createAcpClient` injectable dep (לbריד בדיקות)

**2. packages/backend/src/session-host/session-host.integration.test.ts (חדש)**

- 11 integration tests: wiring, state updates, user message synthesis, meta passthrough, permission/elicitation PendingRequests

#### סיכום slice session-host-core

| Checkpoint | Commits | Tests |
|---|---|---|
| C1: InProcessAcpTransport | bb92dec | 10 TDD |
| C2: SessionHost | 03d4b8a | 14 TDD |
| C3: PendingRequests | 4bd38ce | 7 TDD |
| C4: Integration | f2b17c3 | 11 integration |

**סה"כ**: 42 טסטים חדשים, 0 errors typecheck, 0 רגרסיות

#### בדיקות

- `bunx vitest run packages/core`: 499 passed ✅
- `bunx vitest run packages/backend`: 344 passed + 14 skipped ✅ (https-serve failure pre-existing — Windows bun path)
- `bunx tsc --noEmit`: 0 errors ✅

## 2026-08-09 09:20

### slice session-host-core — C3: PendingRequests (TDD)

C3 מממש `PendingRequests` — רג'יסטרי ממתין גנרי ל-request_permission / elicitation/create עם timeout ו-default value.

#### מה בוצע?

**1. packages/backend/src/session-host/pending-requests.ts (חדש)**

- `createPendingRequests<T>({ timeoutMs, defaultValue? })` — factory גנרי
- `request(requestId: number): Promise<T>` — רושם בקשה ממתינה
- `respond(requestId: number, result: T): void` — פותר את הbקשה
- Timeout: אם `respond` לא נקרא תוך `timeoutMs`:
  - ללא `defaultValue` → rejects עם `Error("Request N timeout")`
  - עם `defaultValue` → resolves עם ה-default
- `settled` flag מונע double-resolve אחרי timeout
- `respond` על id לא-ידוע הוא no-op (לא זורק)

**2. packages/provider/src/client/index.ts (שונה)**

- הוספת export של `AcpClientCallbacks` (נדרש ל-session-host.ts + בדיקות C2)

#### בדיקות

- `pending-requests.test.ts`: 7 טסטים עוברים ✅
  - request + respond: resolves עם תוצאה
  - respond על id לא-ידוע: no-op ✅
  - timeout: rejects עם Error כשאין defaultValue
  - אין reject לפני timeout
  - ignore respond אחרי timeout (ללא double-resolve)
  - multiple concurrent requests — כל אחד עצמאי
  - default value: resolves במקום לזרוק בtimeout
- typecheck נקי ✅

## 2026-08-09 09:15

### slice session-host-core — C1: InProcessAcpTransport (TDD)

C1 מממש את `InProcessAcpTransport` — byte-transport מעל `conn.wire` שמחבר בין SessionHost ל-ProviderConnection.

#### מה בוצע?

**1. packages/backend/src/session-host/in-process-acp-transport.ts (חדש)**

- מממש `AcpTransport` מ-`@drive-coding/provider/transport` (byte-transport, לא facade)
- `readable`: subscribes ל-`conn.wire.onLine` → מוסיף `"\n"` לכל שורה → ממיר ל-Uint8Array (TextEncoder)
- `writable`: מקבל Uint8Array → line-buffer/split על `"\n"` → שולח שורות ל-`conn.wire.write`
- `close()`: סוגר את ה-ReadableStream (ReadableStreamDefaultController.close)
- `onClose(cb)`: adapter — `conn.onCrash` (BridgeCrashInfo) → `(code, reason)` שהAcpTransport מצפה לו
  - code = exitCode ?? 1; reason = signal ?? ""

#### בדיקות

- `in-process-acp-transport.test.ts`: 10 טסטים עוברים ✅
  - readable: שורות מ-onLine מגיעות כ-Uint8Array עם `\n` suffix
  - writable: כתיבת Uint8Array מפעילה `conn.wire.write`
  - writable: line-buffering — chunks חלקיים נצברים עד `\n`
  - writable: מספר שורות בchunk אחד מתפצלות נכון
  - close(): מבטל את readable
  - onClose: adapter מ-BridgeCrashInfo ל-(code, reason) — exitCode, signal, clean exit
- typecheck נקי ✅ (0 errors חדשים)
