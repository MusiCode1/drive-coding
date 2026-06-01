# Decisions — voice-acp

## 2026-06-01 — refactor: מקור-אמת אחד ל-CLIs

### רציונל
היו 3 מקורות חופפים ולא-מסונכרנים לרשימת ה-CLIs: `BridgeKind` (core/ports, 5 סוגים),
`CliKind` (core/schemas, 4 — בלי qoder), ו-bin/args (backend). תוצאה: qoder היה ב-types
וב-bin אבל לא ב-FE dropdown ולא ב-schema; וב-cli-config היה dead-code switch אחרי return.
אוחד הכל לרשומה אחת `CLI_SPECS` ב-core/schemas/agent.ts — שם + bin/args + supportsModelFlag
באותו מקום. כל השאר (CLI_KINDS, CliKind arktype, BridgeKind alias, FE dropdown) נגזר.

### ההכרעה הארכיטקטונית
**bin/args יושבים ב-core למרות ש-spawn הוא IO** — כי bin/args הם נתונים סטטיים (מחרוזות),
לא IO בעצמם; ה-IO (spawn) חי ב-backend. ההפרדה: *הגדרה* (סטטית) → core; *resolution*
תלוי-סביבה (OPENCODE_BIN מ-process.env, הוספת --model) → backend (shell). זה לא מפר את
"no IO in core" כי core רק מחזיק מחרוזות.

### באג שנחשף
`OPENCODE_BIN` נקרא במקור eager (בזמן טעינת המודול) → טסט שמגדיר env אחרי טעינה נכשל.
תוקן ל-lazy (בזמן getCliCommand). תואם את ה-service file (OPENCODE_BIN=opencode-clean.sh).

### טסטים מיושנים שתוקנו
3 טסטי gemini ציפו ל-`npx @google/gemini-cli --experimental-acp`. אומת מול ה-binary
המותקן (~/.vite-plus/bin/gemini): הפקודה הנכונה היא `gemini --acp`, ו-`--experimental-acp`
deprecated ("use --acp instead"). הקוד היה נכון, הטסט מיושן — יושר למציאות.

## 2026-06-01 — slice-26: Temporary Bridge Idle-Reaper (BE)

### ‏רציונל
‏slice 25 (FE cleanup) ‏לא מכסה מקרה אחד: ‏**‏reload סתמי / ‏טאב שנסגר** ‏— ‏שם ה-FE ‏מת בלי ש-`#cleanup` ‏רץ, ‏וה-bridge ‏נשאר יתום. ‏לפי בקשת המשתמשת הוספנו **‏רשת-ביטחון זמנית בצד שרת**: ‏reaper תקופתי שהורג bridges ‏ללא WS ‏מחובר אחרי timeout (‏ברירת מחדל 5min, `BRIDGE_IDLE_TIMEOUT_MS`).

‏ההחלטה הקריטית בעיצוב: ‏**‏מדד ה-idle ‏הוא "זמן מאז ניתוק ה-WS ‏האחרון", ‏לא "מאז יצירה" ‏ולא "מאז פעילות"**. ‏הסיבה — ‏ה-BE ‏משאיר bridges חיים בכוונה (`ws-agent.ts:126`) ‏כדי לאפשר reconnect ‏(future A). ‏מדד מבוסס-יצירה היה הורג גם סוכן שרץ משימה ארוכה ‏וגם סוכן שמחכה ל-reconnect לגיטימי. ‏הכלל: ‏`hasActiveWs===true` → ‏**‏לעולם לא נאסף**. ‏זה גם תואם-קדימה ל-future A (‏reconnect ‏בתוך החלון "מנצל" ‏את הסוכן ‏ומאפס את הטיימר).

‏grace period פי-2 ‏לסוכן שמעולם לא נפתח לו WS — ‏מגן מפני race ‏בין `createAgent` ל-WS open ‏(לא להרוג סוכן בן-שנייה שעומד להתחבר).

‏ה-reaper ‏קורא ל-`orchestrator.deleteAndKill` ‏(נתיב מאוחד: ‏kill + ‏registry.delete), ‏לא ל-`bridgeManager.kill` ‏ישירות — ‏אחרת `/api/agents` ‏היה מציג סוכן מת.

### ‏זמניות (‏קריטי)
‏זה סלייס **‏זמני**. ‏כל הקוד מתויג `// TEMPORARY (slice 26)` ‏ויש §7 ‏עם תנאי-מחיקה מפורש (`grep -rn "TEMPORARY (slice 26)"`). ‏יימחק כשייכנס מנגנון ניהול agents-ברקע מסודר (future A) ‏שיחליף את ה-reaper ‏ב-lifecycle ‏מנוהל (‏reconnect מפורש + ‏רשימת agents + ‏סגירה יזומה).

### ‏ממצאי אביגיל
‏Verdict: READY (‏ללא תיקון מהותי). ‏כל 8 ‏נקודות האימות עברו: ‏מספרי שורות מדויקים, ‏לוגיקת `listIdle` ‏ללא חור, `reaper.unref()` ‏תקף, `deleteAndKill` ‏מנקה registry, ‏race ‏מטופל סבירות. ‏2 ‏ממצאי minor: ‏(1) ‏הבהרה ש-server.ts ‏אין בו shutdown handler → `unref()` ‏מספיק (‏תוקן); ‏(2) ‏פקודת `bun --watch` ‏ידנית בעוד ה-BE ‏רץ Node — ‏לא משפיע.

### ‏רעיונות שנדחו
- ‏**‏מדד idle מבוסס "מאז יצירה" ‏או "מאז פעילות אחרונה"** — ‏יהרוג סוכנים פעילים. ‏נדחה לטובת "מאז ניתוק WS".
- ‏**‏shutdown handler ‏עם clearInterval** — ‏מיותר; `unref()` ‏מספיק ‏ו-server.ts ‏ממילא אין בו graceful shutdown ‏היום.

---

## 2026-06-01 — slice-25: Bridge Process Leak Fix

### ‏רציונל
‏אבחון מצא דליפת תהליכים: ‏כל מחזור connect→disconnect/reload/error ‏משאיר תהליך CLI ‏(opencode/claude/gemini) ‏יתום וחי ב-BE ‏לנצח. ‏שורש הבעיה — ‏עיצוב חצי-גמור: ‏ה-BE ‏בכוונה לא הורג את ה-child ‏בסגירת WS (`ws-agent.ts:126`, ‏כדי לאפשר reconnect עתידי), ‏אבל הצד השני של הגשר מעולם לא חובר: ‏ה-FE ‏לא קורא ל-`deleteAgent` ‏ב-`#cleanup`/`detach`, ‏ולא מבצע reconnect אמיתי (‏מנגנון הדה-דופ ‏בצד שרת מנותק כי ה-FE ‏לא שולח `existingSessionId`).

‏בחרנו **‏גישה B ‏(תיקון מיידי)**: ‏`#cleanup` ‏קורא `deleteAgent(agentId)` ‏כ-fire-and-forget → ‏ה-BE ‏הורג את ה-bridge (SIGTERM→SIGKILL). ‏שורה אחת, ‏סיכון נמוך, ‏עוצר את הדימום. ‏מסלול רשימת הסשנים (`listSessionsForCwd`) ‏כבר נקי (spawn→delete מסודר) — ‏לא נגענו בו.

‏**‏גישה A ‏(reconnect אמיתי + ‏agents-ברקע) ‏נדחתה לסלייס עתידי** ‏לפי החלטת המשתמשת: ‏היא רוצה מנגנון שמשאיר סוכנים חיים ברקע (‏ממשיכים לרוץ גם כשהחלון נסגר), ‏עם ממשק ניהול לראות/לסגור agents פעילים. ‏זה דורש תכנון UX + ‏חיווט `existingSessionId` + ‏רשימת agents — ‏לא תיקון-דחוף. ‏לכן הפרדנו: B ‏עכשיו, A ‏כסלייס מתוכנן.

### ‏ממצאי אביגיל
‏Verdict: USABLE-AFTER-FIX (‏אין blocker). ‏כל הסמלים, ‏מספרי השורות, ‏וה-import אומתו מדויקים; ‏אין מסלול cleanup שלישי שעוקף את התיקון; `depends_on=[]`/`base=dev` ‏נכונים. ‏הבעיה היחידה: ‏האזהרה שלי על `lint:i18n` ‏הייתה **‏הפוכה** — ‏טענתי שה-lint ‏עלול לחסום עברית בהערות, ‏אבל ה-state machine ‏מנקה הערות לפני סריקה (‏וכל הקובץ כבר כתוב בהערות עברית). ‏תוקן: ‏הוסרה הוראת התרגום המיותרת ‏מ-§5/§6/§9.

### ‏שינויי-כיוון
‏אין — ‏רק תיקון תיעוד פנימי ב-brief. ‏הליבה (‏גישה B, ‏שורה אחת ב-`#cleanup`) ‏נשארה.

### ‏רעיונות שנדחו
- ‏**‏timeout/GC ‏ל-bridges יתומים בצד BE** — ‏רשת-ביטחון; ‏לא נדרש כש-FE ‏מנקה. future.
- ‏**‏שינוי `ws-agent.ts` ‏שיהרוג child ‏ב-WS close** — ‏היה הורס את התשתית ל-future A (agents-ברקע). ‏השארנו את "child שורד WS close" ‏שלם.

---

## 2026-05-31 — slice-6: Audio Cues engine

### ‏רציונל
‏הוספת חיווי קולי (cues) חיונית לחוויית drive-first כדי לאפשר למשתמשת לדעת מתי המערכת מקשיבה, חושבת או מדברת מבלי להביט במסך. בחרנו במימוש מבוסס Web Audio API (oscillators) ולא קבצי אודיו כדי לשמור על גמישות בתדרים, זמני טעינה אפסיים ומינימום bundle size.

### ‏ממצאי אביגיל
‏אביגיל זיהתה שתי בעיות קריטיות במימוש ה-Web Audio:
1. ‏העדר `setValueAtTime` לפני `linearRampToValueAtTime` ב-glides, מה שהיה גורם לצלילים להתחיל מתדר ברירת המחדל.
2. ‏צורך ב-`AudioContext.resume()` כדי להתמודד עם Autoplay Policy של Chrome גם בתוך user gesture.

### ‏שינויי-כיוון
‏ה-brief עודכן לכלול את התיקונים הטכניים שאביגיל הציעה. בנוסף, הובהר שהפרויקט מתבסס על `dev` שכבר כולל את מבנה Slice 3.

---

## 2026-06-01 — slice-23: Agent Options Panel

### ‏רציונל
‏בחרנו להוסיף ווידג'ט אפשרויות סוכן שמבוסס כולו על ACP `session/set_config_option` — לא דרך CLI flags ולא דרך discovery session זמני. הסיבה: `opencode acp` לא מקבל `--model`/`--agent`; session זמני ישאיר סשנים יתומים. ה-ACP מחזיר `configOptions/models/modes` מיד אחרי `session/new` — זה מספיק להחלת בחירות.

‏עיצוב cache: אפשרויות נשמרות לפי `cliKind|normalizedCwd` ב-localStorage, כך שמהחיבור השני dropdowns אמיתיים מופיעים לפני פתיחת הסשן.

### ‏ממצאי אביגיל (round 2 — NO-GO, round 3 — PASS)
‏4 blockers שזוהו ב-round 2:
1. ‏`SetSessionConfigOptionRequest` הוא discriminated union — boolean דורש `{ type:"boolean", value }`. תוקן ב-Commit 1.
2. ‏`models/modes` נשמרים ב-snapshot אך לא שימשו לרנדרינג; agents שמחזירים `models` בלי `configOptions` מתאים לא קיבלו dropdown. תוקן ב-rendering rules (3 מסלולים: `snapshot.models`, `configOptions.category`, fallback ידני).
3. ‏זיהוי model/mode לפי `id === "model"` שגוי — `id` הוא arbitrary. תוקן לשימוש ב-`category === "model"/"mode"`.
4. ‏`throw` על option חסר היה חוסם מעבר בין פרויקטים. תוקן ל-`console.warn` + skip.

### ‏שינויי-כיוון
- ‏`#applyConfigSelection` כולל עכשיו 3 מסלולים: `optionById` → `optionByCategory` → fallback method.
- ‏Cache key מנורמל (`.replace(/\/+$/, "")`) כדי לתאים ל-BE `validateCwd`.

### ‏רעיונות שנדחו
- ‏Discovery session זמני: נדחה — יוצר סשנים יתומים בגלל שOpenCode לא מפרסם `session/close`.
- ‏MCP servers / Additional directories בווידג'ט: נדחו ל-slice עתידי; לא מוסיפים מורכבות ל-MVP.

## 2026-06-01 — slice-24: Client-Keyed Proxy Cache

### ‏רציונל
‏ה-proxy-cache ‏ממפתח ‏לפי `sha256(method|path|body)`. ‏זה ‏שובר ‏ל-narrate ‏כי ‏ה-prompt
‏כולל `recentMessages` ‏תלוי-זמן → ‏אותו ‏tool-call ‏מקבל ‏hash ‏שונה ‏ב-reload → cache miss →
‏Gemini ‏מנוסח ‏מחדש → ‏נרטיב ‏**‏שונה** (LLM ‏לא-דטרמיניסטי). ‏הפתרון: ‏ה-FE ‏(‏הצד ‏היחיד ‏שיודע
‏את ה-identity ‏היציב) ‏קובע ‏את ‏מפתח-הקאש ‏דרך ‏header `x-cache-key`, ‏ולא ‏ה-BE ‏מהגוף.

‏**‏אין persistence ‏חדש** — ‏הקאש ‏הקיים ‏(disk) ‏הוא ‏ה-"DB". ‏המפתח ‏הדטרמיניסטי ‏מאפשר
‏re-fetch ‏ב-reload ‏ללא ‏שמירה ‏נוספת ‏מעבר ‏לטקסט ‏הגולמי ‏(‏שמשוחזר ‏ע"י ‏opencode ‏ב-session/load).

‏מפתחות: narrate=`narrate:<toolCallId>`, translate=`translate:<sha256(text+lang)>`,
‏tts=`tts:<voiceId>:<sha256(text+model)>`. ‏הסיבה ‏ש-narrate ‏שונה: ‏ה-input ‏שלו ‏(prompt+context)
‏לא-יציב, ‏אבל `toolCallId` ‏יציב; ‏ב-translate/tts ‏ההפך — ‏ה-input (text) ‏יציב, ‏אבל messageId ‏לא.

### ‏ממצאי אימות (‏בריצה ‏חיה, opencode 1.15.13)
- opencode ‏שולח `messageId` ‏גם ‏בזמן ‏חי (24/24 chunks, ‏UUID ‏יציב), ‏**‏משותף** ‏ל-thought+message
  ‏של ‏אותו ‏turn. ‏לכן messageId ‏לבדו ‏לא ‏מבחין ‏בין ‏סגמנטים → ‏לא ‏יכול ‏להיות ‏מפתח ‏יחיד.
- ‏ה-tool ‏ID (`toolu_...`, ‏ממרחב Anthropic) ‏**‏נפרד ‏לגמרי** ‏מ-messageId. ‏ל-`ToolCall` ‏schema
  ‏אין ‏בכלל ‏שדה ‏messageId.
- `messageId` ‏מסומן ‏**UNSTABLE** ‏ב-ACP spec ‏ו-**‏אופציונלי** (`required: ["content"]`) → ‏לבנות
  ‏עליו ‏מפתח ‏= ‏חול. ‏לכן ‏הוא ‏metadata ‏best-effort ‏בלבד, ‏אף ‏פעם ‏לא ‏במפתח.

### ‏ממצאי אביגיל
- ‏סבב 1: USABLE-AFTER-FIX — blocker: ה-brief ‏ציטט `sha256Key` ‏ב-`core/voice/cache-key.ts`,
  ‏אבל ‏שם ‏יש ‏רק `cacheKeyFor` (‏חתימה ‏אחרת); ‏הגנרי ‏יושב ‏ב-backend (‏ה-FE ‏לא ‏יכול ‏לייבא).
- ‏תיקון: Commit 0.5 ‏מעביר `sha256Key` ‏ל-core (additive). ‏סבב 2: READY.

### ‏רעיונות שנדחו
- ‏BE persistence (index ‏שמקשר session+message→audio): ‏נדחה — ‏שובר D8, ‏ומיותר ‏כי ‏ה-hash
  ‏הדטרמיניסטי ‏מספיק. ‏המשתמשת ‏זיהתה ‏נכון: "‏כמו ‏שבפעם ‏הראשונה ‏נוצר ‏ה-hash, ‏אפשר ‏לחשב ‏מחדש".
- ‏cache סמנטי ב-localStorage ‏(FE): ‏נדחה ‏לטובת `x-cache-key` header — ‏שומר ‏את ‏הקאש ‏במקום ‏אחד (BE disk),
  ‏בלי persistence ‏כפול.
- ‏מחיקת ‏query layer / index ‏לפי messageId: ‏נדחה (YAGNI) — ‏ה-metadata ‏נשמר, ‏אבל ‏ה-query ‏יבוא ‏עם ‏פיצ'ר ‏אמיתי.
- ‏"‏החזרת ‏קריאות ‏ל-BE" (‏במקום FE): ‏נשקל ‏ונדחה ‏לעת ‏עתה — ‏שובר ‏את slice 10, ‏מחזיר 600+ ‏שורות ‏ל-BE.
  ‏נשמר ‏כתוכנית-מגירה ‏אם `@ai-sdk/google` header passthrough ‏ייכשל ‏ב-Commit 0.
