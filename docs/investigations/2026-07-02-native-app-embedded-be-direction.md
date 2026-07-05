# Design — אפליקציית Android עם BE-מוטמע + צינור-ACP דק בטרמוקס

- **תאריך:** 2026-07-02
- **סטטוס:** 📐 **תיעוד-כיוון עתידי. לא מאושר לביצוע, אין briefs.** רעיון מ-Track F/Future.
- **מקור:** session תכנון (מרדכי + משתמשת), 2026-07-02.
- **ייעוד:** לתפוס את **כל ההנחות** של הכיוון הזה — הן המאומתות והן שטרם — כדי
  שכשנחזור אליו לא נגלה פתאום שהנחה שהנחנו כאן ("X עובד ככה") כבר לא נכונה. לכן
  §3 (ground truth) ו-§5 (הנחות-לאימות) מסומנות מפורשות. **אל תתייחס כ-spec נעול.**

---

## 0. הרעיון בשורה אחת

אפליקציית Android **סגורה** (Capacitor) ש**היא** drive-coding — אורזת את ה-FE + ה-`core`
הטהור, מריצה את כל לוגיקת-ה-ACP **בתוך ה-webview** (בלי Node, בלי שרת-HTTP פנימי) —
בעוד ש**טרמוקס נשאר רק כצינור `ACP-over-WS` דק** שעושה `spawn` ל-CLI ומעביר frames גולמיים.
תוצאה: תחושת אפליקציה-אחת, קלת-סוללה, בלי לשכפל את סביבת-ה-exec של טרמוקס.

---

## 1. המטרה והלייף-סייקל הרצוי

- אפליקציה עצמאית בתחושה (אייקון, task נפרד), **לא** "אוסף קבצים בטרמוקס".
- ה-BE (הלוגיקה — תרגום ACP, נורמליזציית-ספקים, session-state) **חי באפליקציה**.
- **הדבר היחיד שרץ ברציפות** מהפעלה עד כיבוי = **חיבור WebSocket אחד** לצינור בטרמוקס.
- לייף-סייקל: המשתמש מסיים משימה → **סוגר את הסוכן** → כלום לא רץ. פותח מחדש → **סוכן חדש**.
- **קל-סוללה בעיצוב** — ראה §2.5.

---

## 2. שרשרת-ההחלטות (כל שלב: ההחלטה · ההנחה · למה · סטטוס)

### 2.1 קיר ה-`exec` → למה טרמוקס **נשאר** ומריץ את הסוכן

**ההחלטה:** ה-exec של הסוכן נשאר בטרמוקס; האפליקציה **לעולם לא עושה `spawn`**.

**ההנחה הנושאת:** מאז **Android 10 (אכיפת W^X)**, אפליקציה **לא יכולה** להריץ (`execve`)
בינארי מתוך תיקייה שאפשר לכתוב אליה (ה-`data`/`files` dir שלה). מותר להריץ רק מ-
`nativeLibraryDir` (read-only, שחולץ מה-APK). קידוד-אג'נטי = הרצת `bash`/`git`/`rg`/ה-CLIs,
ולכן ללא סביבת-exec אמיתית זה נחסם. טרמוקס פתר את זה בעמל-שנים (`termux-exec` וכו').

**למה לא אפליקציה עצמאית-לגמרי (proot+rootfs ארוז):** כן אפשרי (UserLAnd/Andronix עושים),
אבל זה = לשכפל את טרמוקס: APK ענק, חילוץ בהפעלה, overhead של ptrace, **תחזוקת rootfs**.
נדחה לטובת "טרמוקס כתלות-commodity".

**סטטוס:** ✅ הנחת-פלטפורמה ידועה. ⚠️ **לאמת מול Android של המכשיר בפועל** — ראה §5/A7.

### 2.2 הפיצול: טרמוקס = צינור `ACP-over-WS` דק · אפליקציה = כל השאר

**ההחלטה:** הגבול מצויר ב-**frame הגולמי** (ACP JSON-RPC over stdio / WS). האפליקציה היא
ה-ACP-**client**; טרמוקס מריץ את שכבת-הספק שמפיקה frames של ACP.

**⚠️ תיקון-דיוק (2026-07-02): כמה "דק" הצינור תלוי בספק.**
- **opencode/codex** — מדברים ACP native (G2b). טרמוקס = `spawn(cli)` + pipe stdio↔WS. **באמת דק.**
- **claude** — ל-CLI **אין ACP native**; חייבים את האדפטר (`ClaudeAcpAgent`) ש**מריץ את claude-code
  ומתרגם ל-ACP**. האדפטר הוא Node ו**עושה exec** ל-claude-code → **חייב לרוץ בצד-טרמוקס**
  (בין אם כ-`connectSpawn` subprocess ובין אם כ-host-in-process של Model 2 בתוך תהליך-Node בטרמוקס).
  אז לclaude טרמוקס מריץ **Node + adapter + claude-code**, לא "צינור טיפש".

**המסגור המדויק יותר:** הגבול app↔טרמוקס = **בדיוק הגבול FE↔BE של היום** (WS נושא frames של ACP;
ה-FE הוא ה-client). כלומר: **טרמוקס = שכבת-הספק של ה-BE הנוכחי** (ws-agent + `connect*` +
אירוח-האדפטר), **האפליקציה = ה-FE הנוכחי** (ACP-client) + שירותים לא-ACP. ה"קריסה ל-webview
בלי Node" חלה על **צד ה-FE** (שממילא browser-native, בלי Node) — **לא** על סילוק ה-Node מצד-טרמוקס.

**סטטוס:** ✅ הגבול קיים בקוד היום (ראה §3) — זה כבר גבול-ה-WS של FE↔BE.

### 2.3 הקריסה: בלי שרת + בלי spawn → **בלי Node** → webview מספיק

**ההחלטה:** ה-BE של היום דורש Node רק בשביל **שני** דברים: (א) הוא **שרת** HTTP/WS (Hono);
(ב) הוא עושה **spawn**. בתוכנית הזו שניהם נעלמים — ה-spawn עבר לטרמוקס, וה-FE↔BE הם
**אותה אפליקציה** (קריאות in-process, לא HTTP). מה שנשאר הוא **JS ברמת-דפדפן**:
WebSocket-client + תרגום JSON-RPC/ACP + נורמליזציית-ספקים + state + `fetch`.

**תובנה מחזקת (ground truth):** ה-**FE כבר היום הוא ה-ACP client** — הוא צורך frames מעל
WS דרך `ws-to-streams` (WebSocket טבעי של הדפדפן) ומריץ את פרוטוקול-ה-ACP. הלוגיקה
הכבדה **כבר רצה בדפדפן**. מה ש"עובר לאפליקציה" מינימלי.

**מסקנה:** **`nodejs-mobile` לא נחוץ** במודל הזה (בניגוד למה שנשקל קודם). הוא נדרש רק אם
מריצים שרת/spawn בתוך האפליקציה — ושניהם ירדו.

**סטטוס:** ✅ עקרון · ⚠️ תלוי בכך שאף אחריות-BE שנשארת לא דורשת Node — §5/A4-A6.

### 2.4 המסגרת: **Capacitor**

**ההחלטה:** Capacitor עוטף webview. ה-FE שלנו כבר **SvelteKit + adapter-static** → בונה
בדיוק ל-bundle שדפדפן טוען → Capacitor עוטף אותו כמות-שהוא. `packages/core` כבר **טהור**
(אין IO, אין Node/browser globals — לפי design) → נופל ישר לתוך ה-webview.

**נדחו:** **Tauri** (shell ב-Rust — ה-glue של RUN_COMMAND ב-Rust, Android פחות בשל);
**React Native** (זורק את Svelte); **nodejs-mobile** (מיותר אחרי §2.3, וגם מפגר אחרי גרסת Node).

**סטטוס:** ✅ עקרון · ⚠️ בשלות Android של Capacitor + plugin ל-RUN_COMMAND — §5/A7.

### 2.5 סוללה: WS יחיד, בלי wakelock native

**ההחלטה:** שום דבר לא רץ ברציפות חוץ מ-WS אחד. idle → ה-OS **משעה את ה-webview** →
suspend עמוק → **~0 drain**. אין צורך ב-wakelock native, כי **הישרדות-הסוכן היא תפקיד טרמוקס**
(ה-wakelock של טרמוקס). backgrounding באמצע turn **חינני**: הסוכן חי בטרמוקס, האפליקציה
מתחברת-מחדש (ל-drive-coding כבר יש WS-reconnect).

**למה זה קל יותר מ-nodejs-mobile:** אין runtime של Node שצריך foreground-service/wakelock
משלו; הכל מנוהל ע"י ה-OS על ה-webview.

**סטטוס:** ✅ עקרון · ⚠️ התנהגות-webview-ברקע + catch-up של frames אחרי reconnect — §5/A3.

### 2.6 Boot של הצינור: `RUN_COMMAND`

**ההחלטה:** האפליקציה מדליקה את הצינור בטרמוקס דרך `com.termux.RUN_COMMAND` intent →
`RunCommandService` (background=true), ואז מדברת איתו על `ws://localhost`. **intent =
lifecycle בלבד; WS = דאטה.** לחלופין Termux:Boot מדליק את הצינור והאפליקציה רק מתחברת.

**דורש (setup חד-פעמי):** `allow-external-apps=true` ב-`~/.termux/termux.properties` ·
הרשאה `com.termux.permission.RUN_COMMAND` ב-manifest · **Termux מ-F-Droid/GitHub** (לא Play Store).

**סטטוס:** ⚠️ לאמת מול המכשיר — §5/A7.

---

## 3. Ground truth — מה שאומת בקוד (2026-07-02)

| # | ממצא | מקור |
|---|------|------|
| G1 | ה-**FE הוא ה-ACP client** שצורך frames מעל WS דרך WebSocket **טבעי של הדפדפן** (לא חבילת `ws`). | `packages/provider/src/transport/ws-to-streams.ts` |
| G2 | **`claude-code` רץ תמיד כתהליך-OS נפרד** — ה-Claude Code SDK שבתוך האדפטר עושה לו spawn. מה שרץ "in-process" (Model 2) הוא **רק מתאם-ה-ACP** (`ClaudeAcpAgent`), המתארח בתהליך ה-Node שלנו דרך in-memory streams. **`pid: null` = אין adapter-subprocess שאנחנו spawn — לא "אין תהליך claude-code".** | `in-process-host.ts` ("*without spawning a child process*" = האדפטר) · `connect-in-process.ts` (`pid:null`) · `query-access.ts` (`query` חי בתוך האדפטר) |
| G2b | ל-`claude` CLI **אין ACP-server-mode native** → חייבים את האדפטר (`claude-agent-acp`) שמתרגם claude↔ACP **ומריץ את claude-code**. לעומתו opencode/codex **מדברים ACP native** → לא צריכים adapter. | roadmap §סיכון-חיוב ("אין לו ACP server mode") |
| G3 | קיימות **שתי** צורות-אירוח-adapter: `connectInProcess` (claude — adapter in-memory) ו-`connectSpawn` (opencode/codex — CLI כ-subprocess). הגבול הוא `ProviderConnection.wire` (frames גולמיים). | `packages/provider/src/connection/{index,spawn,connect-in-process}.ts` |
| G4 | פרוטוקול-ה-WS כולל heartbeat: `$/ping`→`$/pong`. `ws-to-streams` **כבר מסנן** control-frames של `$/` לפני שהם נכנסים ל-SDK. | `ws-to-streams.ts` (`isAcpControlFrame`) |
| G5 | תצפית-ה-wire (`WIRE_RECORD`/`LOG_WIRE`) יושבת בשכבת-ה-delivery ומקבילה ל-`onFrame` tap ב-`connect-in-process`. הגבול "frame גולמי" מוחשי וניתן-להאזנה. | `packages/backend/src/delivery/wire-recorder.ts`, `connect-in-process.ts` (onFrame tap) |
| G6 | `packages/core` — **אין imports של `node:`** (grep ריק). מחזק את היותו טהור. | `packages/core/src` |

---

## 4. משטח-הגבול — מה עובר לאיזה צד

| אחריות | היום (BE יחיד) | במודל האפליקציה | הערה |
|--------|----------------|------------------|------|
| `spawn(cli)` + stdio↔WS | BE | **טרמוקס** (הצינור) | הגרעין של הצינור הדק |
| ACP client / תרגום frames | FE (כבר!) | **אפליקציה (webview)** | G1 — כמעט אפס תזוזה |
| נורמליזציית-ספקים / session-state | FE/core | **אפליקציה** | core טהור → נופל פנימה |
| מתאם-ACP של claude (+ spawn של claude-code) | BE (Model 2 in-process) | **טרמוקס** (Node+exec — §6) | לא בעיה; המתאם תמיד צריך exec. topology חופשי (Model-2-בטרמוקס או `connectSpawn`) |
| פרוקסי TTS/translate (מפתחות OneCLI) | BE | **לא הוכרע** | §5/A8 |
| projects-registry / sessions / recordings | BE (fs) | **לא הוכרע** | app-storage vs טרמוקס — §5/A4 |
| auth של claude | טרמוקס (`~/.claude`) | **טרמוקס** (ללא שינוי) | לא דרך OneCLI — יציב |

---

## 5. הנחות לאימות **לפני** התחייבות (רשימת "שלא נופתע")

> זו הרשימה שבגללה נכתב המסמך. כל שורה = הנחה + **איך מאמתים**.

- **A1 — קיר ה-exec.** ההנחה: Android חוסם exec מ-writable-dir; טרמוקס חייב להריץ את הסוכן.
  אימות: ידוע-פלטפורמה; אבל לוודא שטרמוקס עדיין רץ exec על **המכשיר בפועל** (OnePlus 15 / Android חדש).
- **A2 — ה-FE כבר ה-ACP-client.** ההנחה: הלוגיקה הכבדה כבר בדפדפן; מעט "עובר". אימות: לקרוא את
  `AcpClient` של provider-contract + איך ה-FE מתחבר היום; לוודא שאין לוגיקת-ACP-client **בצד-BE** שחייבת לעבור.
- **A3 — מתאם-claude בצד-טרמוקס + מסלול ext.** ⚠️ **הסיכון המרכזי.** המתאם (Node, עושה exec
  ל-claude-code) רץ בצד-טרמוקס — topology חופשי (§6). אימות: (א) אירוח-המתאם בטרמוקס עובד
  (Model-2-בתוך-Node-בטרמוקס **או** `connectSpawn` כ-subprocess) ומוציא frames תקינים מעל WS;
  (ב) **[הסיכון האמיתי] מסלול ext→query מחווט מעל גבול-ה-WS/frame** — `_drive/setThinkingTokens`
  היום עובר in-memory (`callExt`/`onRequest`); לוודא שהוא נוסע app→WS→adapter→`query` (query-access);
  (ג) `claude-code` עושה exec בטרמוקס על **המכשיר בפועל**.
- **A4 — אחריות-BE שנשארת שדורשת Node.** ההנחה: אין. אימות פר-אחריות: projects-registry,
  sessions-persistence, recordings, wire-recording, **buffering של frames בזמן שה-FE מנותק**
  (ר' חקירת warm-reattach 2026-07-01) — כל אחת: עוברת ל-app-storage (Capacitor Filesystem) /
  נשארת בטרמוקס / יורדת. **קריטי:** האם הצינור מחזיק frames שנפלטו בזמן שהאפליקציה ברקע/מנותקת?
  אם לא — backgrounding באמצע turn מאבד פלט.
- **A5 — `core` טהור לגמרי.** ההנחה: אין Node-only בנתיבים שה-webview צריך. אימות: grep ל-`node:`
  ריק (G6), אבל לוודא גם `Buffer`/streams/crypto בתלויות טרנזיטיביות.
- **A6 — nodejs-mobile מיותר.** נגזר מ-A4/A5 — נכון רק אם אף אחריות-שנשארת לא דורשת Node.
- **A7 — RUN_COMMAND + Termux על המכשיר.** אימות: מקור-ה-build של טרמוקס (F-Droid/GitHub),
  התנהגות RUN_COMMAND על ה-Android של המכשיר, plugin Capacitor ל-intent (קהילתי או custom native).
- **A8 — credential ל-TTS.** ההנחה-פתוחה: `fetch` מ-webview צריך מפתח. אפשרויות: פרוקסי TTS
  **בצד-טרמוקס** (משאיר OneCLI) או **secure-storage** באפליקציה. claude-auth **לא** מושפע.
- **A9 — cleartext ws://localhost.** webview מ-Capacitor אל `ws://localhost` דורש
  `network-security-config`/`usesCleartextTraffic` ל-localhost. קונפיג, לא חסם.
- **A10 — heartbeat.** ה-WS-client באפליקציה חייב לטפל ב-`$/ping`/`$/pong`. `ws-to-streams`
  כבר מסנן `$/` (G4) — לוודא שהמנגנון עובר כמות-שהוא.

---

## 6. השלכה: מתאם-ה-claude חייב לרוץ בצד-טרמוקס (וזה **לא** נוגד את ה-cutover)

**תיקון להבנה מוקדמת:** "in-process (Model 2)" **מעולם לא אמר "claude רץ ב-webview".**
`claude-code` הוא **תמיד תהליך-OS נפרד** (G2); Model 2 = אירוח **מתאם-ה-ACP** בתהליך-Node שלנו
דרך in-memory streams. אז אין כאן "להעביר את claude ל-webview".

**מה כן נכון:** המתאם (`ClaudeAcpAgent`) הוא **Node ועושה exec** ל-claude-code (דרך ה-SDK) →
הוא **חייב לרוץ בצד-טרמוקס** (Node + exec). ל-webview אין לא Node ולא exec, אז הוא לעולם לא
מארח את המתאם — הוא רק ה-ACP-**client** מעליו.

**לכן זה לא נוגד את ה-cutover:** ה-cutover עסק ב**טופולוגיית אירוח-המתאם**, ו-claude-code
היה תהליך-נפרד ממילא. בצד-טרמוקס אפשר אפילו **לשמר את Model 2** (לארח את המתאם בתהליך-Node
בטרמוקס ולחשוף frames מעל WS), **או** ללכת על `connectSpawn` (מתאם כ-subprocess). שתיהן
בצד-טרמוקס, שתיהן תקפות. המובייל פשוט מריץ את **שכבת-הספק בטרמוקס** (כפי שה-BE עושה היום)
ואת ה-**ACP-client באפליקציה** (ה-FE של היום).

**הסיכון הקונקרטי שנשאר (A3) — ext channel:** `_drive/setThinkingTokens` מגיע ל-`query` החי
**בתוך המתאם** (`query-access.ts` → `sessions[id].query.setMaxThinkingTokens`). ב-Model 2 זה
עובר דרך in-memory `callExt`/`onRequest`. במודל-האפליקציה ה-ext חייב לנסוע
**app → WS → adapter-host-בטרמוקס → query**. **לאמת שמסלול ext→query מחווט מעל גבול-ה-WS/frame,
לא רק in-memory.** זו ההנחה שהכי סביר "תיעלם מתחת לרגליים".

---

## 7. קשר ל-roadmap

זה **צרכן ישיר** של ה-Future-idea תחת §Future ב-`docs/roadmap.md`:
> "להפוך את ספריית-הספקים עצמה לגשר שמדבר frames מצד אחד ו-WS/SSE/HTTP/ACP מהשני, הדרגתית."

הצינור-בטרמוקס הוא בדיוק ה"גשר" הזה בקצה טרמוקס. הכיוון גם נשען על ההפרדה core/backend
שכבר קיימת, ועל היות ה-FE כבר-ACP-client. משיק ל-Track F (packaging) ול-Track E (deep links —
אפליקציה native היא הבית הטבעי להם).

---

## 8. לא הוכרע (open)

- credential ל-TTS (A8) — פרוקסי-טרמוקס מול secure-storage.
- אחסון (A4) — app-storage מול טרמוקס, ו-migration.
- ext-channel ב-subprocess (§6/A3) — הסיכון המרכזי.
- buffering של frames בזמן ניתוק-רקע (A4) — תלוי בחקירת warm-reattach.
- RUN_COMMAND מול Termux:Boot כמנגנון-ה-boot (2.6).
- האם זה בכלל נכנס ל-M-מחייב או נשאר Future (כרגע: **Future, לא מחייב**).
