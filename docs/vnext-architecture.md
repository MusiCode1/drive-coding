# vNext Architecture — drive-coding (לשעבר voice-acp)

> **סטטוס:** טיוטה שנייה (שכבה 1.5 — עקרונות, החלטות, מודולים, UX, תשובות לשאלות פתוחות).
> **כותב:** Tama (planner agent), בדיון עם אבי.
> **תאריך התחלה:** 2026-05-15.
> **שם מועדף:** `drive-coding` (אבי לאישור).
> **לא קוד פעיל** — תיעוד תכנון. הקוד יבוצע ב-worktree נפרד `drive-coding` (או `voice-acp-v2` זמני).

---

## תוכן עניינים

1. [מטרה ויעדים](#1-מטרה-ויעדים)
2. [עקרונות מנחים](#2-עקרונות-מנחים)
3. [דרישות מאבי](#3-דרישות-מאבי)
4. [החלטות שנלקחו (locked)](#4-החלטות-שנלקחו-locked)
5. [שאלות פתוחות](#5-שאלות-פתוחות)
6. [Mental Model — מה המוצר עושה](#6-mental-model)
7. [ארכיטקטורה ברמת domains](#7-ארכיטקטורה-ברמת-domains)
8. [Module map (backend + frontend)](#8-module-map)
9. [Deployment](#9-deployment)
10. [תהליך פיתוח (worktree, מיגרציה)](#10-תהליך-פיתוח)
11. [Roadmap](#11-roadmap)

---

## 1. מטרה ויעדים

### מה הגרסה הבאה עושה

**ממשק קולי לסוכני CLI לשימוש hands-free.**

ממשק שיחה רב-לשוני (עברית קודם, אנגלית אחר כך), רב-משתמש (אנונימי), שמתפקד כשכבה קולית מעל **כל CLI agent שמדבר ACP** — opencode, Gemini CLI, Claude Code (דרך adapter), וכל מה שיגיע. מיועד בעיקר לשימוש במצבים שהידיים תפוסות: **נהיגה ("drive coding"), שטיפת כלים, ריצה, בישול**. רץ בקונטיינר אצל אבי בפרוקסמוקס, נגיש דרך מנהרת Cloudflare, מיועד לאימוץ קהילתי של מפתחים.

### תיאור בכמה מילים (אבי, 2026-05-15)

> ממשק קולי לסוכני CLI. יש ממשקים גרפיים כמו codenomad או opencode WEB. אני יוצר ממשק קולי שבו ניתן לנהל את ה-CLI בשיחה קולית בזמן נהיגה או שטיפת כלים. אפשר להתחבר לכל CLI תומך ACP, גם Claude Code תומך עם מתאם.

### מה הגרסה הבאה איננה

- **לא ריפקטור** של ה-POC. greenfield. ה-POC ימשיך לחיות ב-master עד שהחדש כשיר.
- **לא רק עברית.** רב-לשוני מהיום הראשון.
- **לא single-page app.** אפליקציה מלאה — routing, dashboard, multi-session, התחלה של auth.
- **לא DB משלנו.** stateless ככל הניתן. רק cache של קריאות יקרות (תרגום/תמלול/הקראה).
- **לא vendor lock-in ל-opencode.** ACP transport מופשט מספיק לתמוך גם ב-Gemini CLI, Claude Code, וכל מי שיהיה.

### יעדים מדידים

| יעד | מדד |
|-----|-----|
| Time-to-first-audio | ≤ 1.5s מסיום הקלטה ועד התחלת השמעה (היום ~2-3s) |
| Reconnect-survival | סוכן ממשיך לרוץ גם אם המשתמש סוגר את הדפדפן ל-30 דקות |
| Multi-session | משתמש יכול לעבוד במקביל על 5+ סוכנים פעילים |
| Port-ability | ה-core (פונקציות טהורות) ניתן ל-port ל-Go עם < שבוע עבודה |
| Cache hit rate | > 30% על תרגום/הקראה אחרי שבוע ריצה |
| Cold start | < 3s מ-spawn של agent process עד מוכן לקלט |

---

## 2. עקרונות מנחים

### 2.1 Functional core, imperative shell

כל לוגיקה שמחליטה משהו (parsing, routing, decision-making, state transitions) — פונקציות טהורות שמקבלות data ומחזירות data. ה-IO (WebSocket, spawn, fetch, filesystem) — עוטף דק שקורא ל-core.

**מה זה אומר בפועל:**
- אין singletons שמחזיקים state גלובלי.
- אין "manager" classes שמערבבים IO עם החלטות.
- כל פונקציה שאי אפשר לבדוק עם input/output בלי mock — חשד.
- `ConnectionState` הוא data, לא class עם methods שמתקשרים החוצה.

**מה זה לא אומר:**
- לא monads, לא Effect.ts, לא fp-ts.
- לא immutability דוגמטית — `Map` ו-`Array` רגילים מותרים, פשוט נטו לא לחלוק אותם בין closures.
- לא higher-kinded types או ML-style discipline.

### 2.2 ACP-agnostic core, transport-pluggable

הקוד שלנו מדבר ACP. מה הוא לא מכיר:
- האם ACP רץ על stdio או HTTP.
- אם הסוכן הוא opencode, Gemini CLI, או משהו אחר.
- אם זה רץ אצלי או בענן.

`AcpTransport` הוא interface. יש implementations: `StdioTransport`, `HttpTransport` (אם קיים/נצטרך לבנות), ובעתיד אולי `WebSocketTransport`.

### 2.3 Agent process = entity עצמאית עם זהות

כמו שלמדנו ב-tmux: שרת רץ ברקע, clients מתחברים ומתנתקים. אצלנו:

- כל agent process (opencode/Gemini/וכו') הוא "Agent Instance" עם UUID.
- מחזור החיים שלו לא תלוי בחיבור הדפדפן.
- ה-WebSocket של הדפדפן הוא subscription לעדכונים ממנו.
- כשהדפדפן נסגר — ה-agent ממשיך. כשהוא חוזר — מתחבר מחדש למזהה.
- "כיבוי" הוא פעולה מפורשת של המשתמש (כמו codenomad).

### 2.4 Stateless כמה שאפשר, persistent רק כשחייב

| Layer | Persistent? | איפה |
|-------|-------------|------|
| Session content (history of messages) | לא | ה-CLI agent עצמו (opencode/Gemini) שומר את זה במקור |
| Agent process state (alive/dead, pid, cwd) | רק בזיכרון | proc orchestrator |
| User identity | קל (token) | localStorage / cookie |
| User preferences (voice, language) | קל | localStorage; בעתיד אולי K/V |
| TTS cache | כן | R2 / disk volume |
| STT cache | כן (אופציונלי) | R2 / disk volume |
| Translation cache | כן | KV / R2 |

הכלל: אם נאבד את זה ב-restart — האם המשתמש ירגיש? אם לא — זיכרון בלבד.

### 2.5 Backend ו-frontend מנותקים מהיום הראשון

אין SSR שמערבב לוגיקת backend בתוך SvelteKit endpoints. ה-backend הוא service נפרד עם API מתועד. SvelteKit עוסק ב-UI בלבד.

זה מכפיל את הסיכוי שיום אחד נפרד ל-Go ב-backend בלי לגעת ב-frontend, ומאפשר deployment נפרד (frontend ל-Cloudflare Pages, backend ל-Fly.io, נגיד).

### 2.6 Types משותפים

הפרוטוקול בין front ל-back מוגדר ב-package אחד מתועד (`@voice-acp/protocol`), שמיובא משני הצדדים. אין JSON ad-hoc.

### 2.7 i18n מובנה, לא bolted-on

מההתחלה — אין מחרוזת hardcoded בעברית בקוד. כל טקסט עובר דרך i18n layer (frontend + backend). שפת ברירת מחדל = שפת הדפדפן או שפה שנשמרה ב-preferences.

---

## 3. דרישות מאבי

תיעוד מילולי של מה שאבי אמר בדיון, כדי שלא נשכח:

1. **רב-לשוני.** לא רק עברית.
2. **רץ בענן.** עדיף Cloudflare/Vercel אם אפשר (התשובה: Cloudflare Containers / Fly.io / VPS — לא Workers/serverless).
3. **בלי DB משלנו.** רק cache לחיסכון על קריאות ל-Gemini ו-ElevenLabs.
4. **ACP על פני API ספציפי של opencode** — תמיכה ב-CLIs נוספים.
5. **שווה לשקול ACP-over-HTTP** אם יש implementation אמינה ומשתלמת על stdio.
6. **CLI ממשיך לרוץ אם המשתמש סוגר דף.** דרישה קשה.
7. **הפעלה/כיבוי מפורשים** של ה-CLI כמו codenomad.
8. **ריבוי סשנים בממשק.** dashboard.
9. **Worktree** — הממשק הנוכחי ימשיך לפעול עד שהמחליף כשיר.
10. **TypeScript** — לא Go לעת עתה. SvelteKit ל-frontend.
11. **Functional core** — כדי לאפשר port עתידי ל-Go בלי שיחות.
12. **Frontend = אפליקציה מלאה**, לא SPA יחיד. כולל routing, dashboard.

---

## 4. החלטות שנלקחו (locked)

| # | החלטה | הקשר |
|---|-------|------|
| D1 | TypeScript + Bun ב-backend | אבי מכיר; port עתידי ל-Go אפשרי דרך פונקציונלי |
| D2 | SvelteKit ב-frontend | אבי בחר במפורש |
| D3 | Greenfield, לא ריפקטור | "לתכנן את הכל מחדש" |
| D4 | Worktree `voice-acp-v2` (או `drive-coding`) | master ימשיך לעבוד עד מעבר |
| D5 | Functional core, imperative shell | לא fp library מלא |
| D6 | ACP transport מופשט | תמיכה ב-multi-CLI; transport pluggable |
| D7 | Agent process = entity עצמאית | שורד סגירת דף; אבל ימות עם backend ב-MVP |
| D8 | אין DB משלנו | רק cache (memory→disk→R2 בעתיד) ל-Gemini+ElevenLabs |
| D9 | Backend ו-frontend נפרדים | services נפרדים, API מתועד, types משותפים |
| D10 | i18n מובנה מהתחלה | אין hardcoded strings; **שפת ברירת מחדל: עברית** |
| D11 | Identity אנונימי, **לא עכשיו OAuth** | token ב-localStorage; auth אמיתי לעתיד אם נדרש |
| D12 | Multi-session מהתחלה | dashboard, routing |
| **D13** | **שם הפרויקט: `drive-coding`** (לאישור אבי) | משקף את היעד — voice-first hands-free |
| **D14** | **Deployment ראשון: Proxmox container + CF tunnel** | אצל אבי. ענן ציבורי בעתיד אם נדרש |
| ~~D15~~ | ~~ACP transport: stdio בלבד ל-MVP~~ | **מבוטל ב-D23** |
| ~~D16~~ | ~~Agent dies with backend (MVP)~~ | **מבוטל ב-D23** |
| **D17** | **Cache: disk בלבד ל-MVP** | abstraction `CacheStore` תאפשר R2/KV אחר כך |
| **D18** | **Pricing: BYOC (Bring Your Own CLI)** | המשתמש משתמש ב-CLI שלו עם המינוי שלו. אנחנו משלמים רק על STT/TTS (Gemini, ElevenLabs) |
| **D19** | **UX: כפתור גדול יחיד** | start/stop של הקלטה + cancel של model במצב "speaking" |
| **D20** | **שפות התחלה: עברית בלבד** | אנגלית כשירגיש בשל |
| **D21** | **Frontend routes** מאושרים (§5 Q8) | `/`, `/agent/new`, `/agent/:id`, `/settings` |
| **D22** | **אין הקלדה ב-MVP** | קולי בלבד. לא נעול — נשקול אחר כך |
| **D23** | **`acp-bridge`: stdio↔WebSocket wrapper** | רעיון אבי. כל agent רץ כתהליך עצמאי, חושף WS. backend מתחבר. שורד נפילת backend. |
| **D24** | **Claude Code דרך `@agentclientprotocol/claude-agent-acp`** | adapter רשמי, 1.9k stars, v0.34.0 (2026-05-15). תומך תמונות, MCP, slash commands |
| ~~D25~~ | ~~השתמש ב-`@flutur/acp-http-bridge`~~ | **מבוטל ב-D30** — לא published ב-npm, alpha-0, 0 stars. נכתוב משלנו בהשראתו |
| **D26** | **התאם את WebSocket protocol ל-ACP Streamable HTTP & WebSocket RFD** | headers: `Acp-Connection-Id`, `Acp-Session-Id`. spec רשמי קיים |
| ~~D27~~ | ~~neverthrow + Zod~~ | **עודכן ב-D31** — `neverthrow + ArkType` (אבי כבר משתמש ב-ArkType, ביצועים טובים יותר) |
| **D28** | **Hexagonal architecture, אבל מינימלי** | התחל עם 2 packages (`core` + `backend`). שכבות בתוך `backend/` הן תיקיות, לא packages. הוספת `protocol/` רק כשנצטרך |
| ~~D29~~ | ~~`voice-coda` כ-reference architecture~~ | **עודכן ב-D32** — voice-coda **אין license**. רק inspiration רעיונית. אסור fork/copy בלי הסכמת evanstern |
| ~~D30~~ | ~~`acp-bridge` משלנו בהשראת `Alemusica/acp-http-bridge`~~ | **מבוטל ב-D33** — נמצא פתרון בוגר ב-npm |
| **D31** | **ArkType + neverthrow** | אבי כבר מכיר ArkType, ביצועים ~100× מ-Zod, syntax קצר יותר. neverthrow ל-`Result<T,E>` ב-core |
| **D32** | **לא להישען על voice-coda — לפנות בנימוס לבדיקת license** | אם יחזיר MIT/Apache, נשקול שיתוף פעולה. בינתיים — independent build |
| **D33** | **השתמש ב-`@rebornix/stdio-to-ws` כ-bridge** | published ב-npm (v0.2.0, Apache-2.0). תומך `--persist`, `--grace-period`, Microsoft Dev Tunnels (`--tunnel`/`--tunnel-name`). משמש ב-acp-ui (274★). לא לכתוב משלנו |
| **D34** | **`acp-ui` של formulahendry קיים — נשקול אסטרטגיה** | 274⭐, MIT, Vue+Tauri+Web. תומך 11 agents native, web build חי ב-acp-ui.github.io. לא תומך voice/RTL. **ראה Q-NEW-4 — build vs fork acp-ui** |

---

## 5. שאלות פתוחות (היסטוריה + חדשות)

### ✅ נסגרו (תשובות אבי, 2026-05-15)

**Q1. איפה לפרוס?** → Proxmox container אצל אבי + Cloudflare tunnel. אימוץ קהילתי של מפתחים. ראה §9.

**Q2. ACP transport?** → ~~stdio בלבד~~ → **`acp-bridge` (stdio↔WebSocket wrapper).** רעיון אבי (סשן 3). כל CLI רץ בתהליך נפרד שעוטף stdio ב-WS. ה-backend מתחבר ל-WS. ראה D23 ו-§7.4a.

**Q3. Agent orchestration?** → ~~ההורה מריץ, CLI מת עם backend~~ → **bridges עצמאיים שורדים נפילת backend.** ראה §9.1. אבל ה-bridges הם עדיין children של ה-bridge-manager שאצלנו בקונטיינר.

**Q4. Cache?** → disk ל-MVP. abstraction תאפשר R2/KV אחר כך.

**Q5. Identity?** → אנונימי, OAuth לא עכשיו.

**Q6. Pricing?** → **BYOC** (Bring Your Own CLI). המשתמש משתמש ב-CLI עם מינוי משלו (`opencode` עם OAuth/sub, `gemini` עם key משלו וכו'). אנחנו ממומנים רק את STT/TTS (Gemini ו-ElevenLabs) אצל אבי, או BYOK לאלה בעתיד. קהל יעד: **מפתחים**, לא קהל רחב.

**Q7. i18n?** → עברית בלבד מהיום הראשון. אנגלית כשירגיש בשל. **i18n layer מובנה בכל זאת** כדי שתוספת שפה תהיה pull request של JSON, לא ריפקטור.

**Q8. Frontend routes?** → טיוטה אושרה. הוסף `/settings` למפתחי STT/TTS כשנעבור ל-BYOK.

---

### ⏳ שאלות חדשות שעלו (סשן 2026-05-15)

#### Q9. שם הפרויקט סופי

הצעות, לפי סדר ההמלצה שלי:

| שם | תחושה | הערות |
|----|--------|------|
| **`drive-coding`** ⭐ | ברור, ספציפי לקהל יעד | מומלץ. tagline: "voice interface for CLI agents" |
| `drive-assistant` | רחב יותר | פחות "מפתחים", יותר "אביזר" |
| `roadcode` | קצר, ייחודי, פנוי | חמוד. פחות מתאר |
| `whilecode` | משחק על `while` loop + `while driving` | פנוי, גיקי, אבל לא מסביר עצמו |
| `voxcode` | vox = קול | פחות drive-y |

**ההמלצה שלי: `drive-coding`.** ניתן להישאר עם `voice-acp` בתור worktree זמני עד שתחליט. ממתין לאישור.

#### Q10. Stop mechanism — איך עוצרים את המודל באמצע

ניתחתי שלוש אופציות (ראה דיון בסשן):

| אופציה | יתרון | חיסרון |
|--------|-------|---------|
| **A.** כפתור stop נפרד | חד-משמעי | שני כפתורים — לא drive-friendly |
| **B.** **אותו כפתור הקלטה** | כפתור אחד, חוויה זורמת | false-positive אפשרי |
| **C.** מילת מפתח ("עצור"/"די") | hands-free | false-positive, רעש |

**ההמלצה שלי: B.** במצב `speaking`, לחיצה על הכפתור הגדול = (1) `session/cancel` ל-ACP, (2) עצירת TTS playback מיד, (3) פתיחת הקלטה חדשה. זה ה-state machine הבסיסי של ה-UI. ממתין לאישור.

#### Q11. Wake word — מתי להיכנס?

אבי הזכיר wake word ל-hands-free טהור. ההצעה שלי: **לא ב-MVP**. אחרי שהגרסה הבסיסית יציבה ויש משתמשים, נכניס POC נפרד עם Picovoice Porcupine או Web Speech API. נדרוש שיהיה דטרמיניסטי מאוד (false-positive rate נמוך מ-1 בשעה). ממתין לאישור שזה הסדר הנכון.

#### Q12. Backend survival — האם נטפל בזה אחרי MVP?

ב-D16 הוחלט: agent מת עם backend. אבל אם backend נופל פעמיים בשבוע כי יש bug, זה הופך לכאב. השאלה היא **מתי** לחזור לזה:
- **Option A:** רק אם זה הופך לבעיה בפועל (reactive).
- **Option B:** אחרי slice 5 (MVP voice working) — לפני שיש משתמשים אחרים.

**ההמלצה שלי: A.** Bun + supervisord = backend ש-restartים תוך 1-2 שניות. ה-cost של "פתח agent מחדש" הוא נמוך. ממתין לאישור.

#### Q13. הקלדה — האם וכמה

אבי אמר "לא קנאי" להחלטה לא לאפשר הקלדה. השאלה: באיזה stage להוסיף?
- **לא ב-MVP** — קולי בלבד פותח את כל ההנחות (אין צורך ב-keyboard handling, אין דאגה מ-IME).
- **אם נוסיף אחר כך:** input field שמופיע בלחיצת toggle, שולח prompt כ-text במקום audio. הצרכים שונים: לא צריך STT, לא צריך הקלטה. הצורך כן: הצגת הטקסט בבועה.

**ההמלצה שלי:** לא ב-MVP. נחזור לזה כשמשתמש קונקרטי יבקש. ממתין לאישור.

#### Q14a. ACP Bridge — פירוט פרוטוקול

הרעיון של D23 דורש החלטות:

1. **Transport בין backend ל-bridge:** WebSocket (המלצתי — JSON-RPC over WS, bidirectional טבעי), HTTP+SSE, או Unix domain socket (local-only, יותר מהיר)?
2. **Port allocation:** טווח קבוע (7100-7199) או OS-assigned? איך backend מוצא את ה-port אחרי restart?
3. **Process supervisor:** mini-supervisor משלנו ב-bridge-manager (פשוט), או systemd user services (חזק יותר אבל תלוי OS), או supervisord (תלות נוספת)?
4. **Buffer size:** כמה updates ה-bridge שומר בזיכרון בזמן שhe-backend offline? 100? 1000? unbounded?
5. **Authentication:** ה-WS של ה-bridge רץ על localhost בלבד. צריך auth? token בסיסי בכל זאת ליתרון של hardening?
6. **Discovery:** קובץ `bridges.json` ב-`/data/` (פשוט), Unix socket discovery, או רישום ב-K/V?

**ההמלצה שלי:**
- WebSocket (JSON-RPC over WS) — סטנדרטי, bidirectional, supports notifications.
- OS-assigned port + שמירה ב-`/data/bridges.json` (kid-style — בlocalhost).
- mini-supervisor משלנו ב-`bridge-manager` (Bun) — restart-on-crash, kill-on-shutdown.
- Buffer: 500 updates (זה ~30 דקות של שיחה רגילה).
- אין auth — localhost-only, ולא expose מעבר ל-container.
- `bridges.json` registry. בעתיד אם נצטרך scaling, מעבר ל-Redis/SQLite.

**ממתין לאישור.**

#### Q14b. Wake word — איזה library?

אבי הזכיר פרויקטים שמזהים מילה custom עם דגימות אימון, ללא LLM, low-resource. הסקירה שלי:

| ספרייה | רישוי | Wake word custom | Runtime | הערות |
|--------|-------|------------------|---------|-------|
| **Picovoice Porcupine** | Commercial (free tier: 3 wake words) | ✅ דרך console | WASM, ONNX | best in class, אבל לא open source |
| **Snowboy** | Apache 2.0 | ✅ | C++ | discontinued 2020, אבל forks חיים |
| **openWakeWord** | Apache 2.0 | ✅ דרך training | Python + ONNX (גם WASM) | חדש, פעיל, fully open |
| **Vosk** | Apache 2.0 | ⚠️ זה STT, לא wake | C++/Python/WASM | overkill ל-wake word |
| **Web Speech API** | Browser built-in | ❌ keywords לא custom | native | תמיכה רעה ב-Hebrew |

**ההמלצה שלי לבדיקה:** **openWakeWord** — open, custom, רץ ב-browser דרך ONNX Runtime Web. נצטרך שאבי יקליט ~50-100 דגימות של ה-wake phrase לאימון. POC ב-slice עתידי (אחרי MVP).

**שאלת אבי על MVP:** האם להציג wake word כ-feature מובטח ב-roadmap (slice 11+), או רק "מה שמעניין לחקור"?

#### Q14. UI Components — כמה מינימליסטי?

עוד פירוט על "כפתור גדול":

**מסך agent חי (`/agent/:id`):**
- כפתור עגול ענק במרכז (3 מצבים: idle / recording / speaking).
- מעל הכפתור: בועות שיחה (scroll history).
- מתחת לכפתור: סטטוס טקסטואלי קטן ("מקליט...", "המודל חושב...", "מדבר...").
- בפינה: כפתור hamburger לתפריט (חזרה ל-dashboard, settings, כיבוי agent).
- **זה הכל.** אין tabs, אין side panels, אין pop-ups.

**Dashboard (`/`):**
- רשימת agents חיים (cards גדולים).
- כפתור "+ סוכן חדש" גדול בראש.

**אישור?**

---

## 6. Mental Model

### דמיון מועיל: tmux לסוכני AI

- **tmux server** = backend service שלנו.
- **tmux session** = Agent Instance (CLI process חי).
- **tmux client (`tmux attach`)** = פתיחת דפדפן עם החיבור ל-agent.
- **`tmux ls`** = ה-dashboard של ה-agents.
- **`tmux kill-session`** = כפתור "כיבוי" של agent.

### זרימת חיים של agent

```
1. User: "צור סוכן חדש"
   → POST /api/agents { cli: "opencode", cwd: "/foo", model: "sonnet" }
   → Backend: spawn(opencode acp), assign UUID
   → Backend: register in AgentRegistry
   → Response: { agentId, wsUrl }

2. User: "פתח חיבור" (auto on agent page load)
   → WebSocket connect to wsUrl
   → Backend: subscribe browser to agent's event stream
   → Browser: receives history if exists, then live updates

3. User: "תגיד לסוכן X"
   → Browser → WS → Backend → AcpTransport.prompt(...)
   → Agent processes, streams session/update notifications
   → Backend → STT/translation/TTS pipeline → WS → Browser

4. User: סוגר דף
   → WebSocket closes
   → Agent ממשיך לרוץ
   → Backend ממשיך לקבל session/update events, אבל לא שולח לאף אחד
   → אופציונלי: לשמור updates ב-buffer קצר למקרה של reconnect

5. User: חוזר אחרי 10 דקות
   → Browser → WS connect → "קח אותי ל-agent X"
   → Backend: שולח את ה-buffered updates שהצטברו
   → ממשיך כרגיל

6. User: "כבה את הסוכן"
   → DELETE /api/agents/X
   → Backend: graceful shutdown של ACP, kill process, remove from registry
```

---

## 7. ארכיטקטורה ברמת domains

7 domains, כל אחד עם responsibility ברורה ו-API מתועד:

### 7.1 Transport
**מה:** WebSocket / HTTP בין frontend ל-backend.
**אחריות:** serialization, authentication, routing של messages.
**Pure?** כן (parsing/routing). IO רק ב-edges.

### 7.2 Identity
**מה:** מי המשתמש? יש לו token? אילו agents שייכים לו?
**אחריות:** token issuance, validation, agent ownership.
**Persistence:** in-memory map לעת עתה; K/V בעתיד.

### 7.3 Agent Orchestration
**מה:** ניהול mahzor חיים של CLI processes.
**אחריות:** spawn, kill, registry, subscribe, broadcast.
**State:** in-memory `Map<agentId, AgentInstance>`.

### 7.4 ACP
**מה:** abstraction של פרוטוקול ACP.
**אחריות:** initialize, session/new, session/prompt, session/cancel, parsing של session/update.
**Sub-domains:** `AcpTransport` (websocket-to-bridge / stdio), `AcpClient` (logic).

### 7.4a ACP Bridge — צרכן של `@rebornix/stdio-to-ws` (עדכון D33)

הרעיון של אבי ממומש בpackage בוגר ב-npm. אנחנו לא בונים — אנחנו spawn-ים.

**מה זה:** `@rebornix/stdio-to-ws` (fork של `marimo-team/stdio-to-ws`) הוא בinary שעוטף **כל** stdio process ב-WebSocket. ב-npm, Apache-2.0, v0.2.0. משמש ב-`acp-ui` (274★) שזה ה-web client הכי בוגר ל-ACP.

**איך אנחנו משתמשים בו:**
```ts
// packages/backend/src/adapters/bridge-spawn.ts
import { spawn, type ChildProcess } from "node:child_process"

export type BridgeHandle = {
  readonly port: number
  readonly process: ChildProcess
  readonly wsUrl: string
}

export async function spawnBridge(opts: {
  cliCommand: string         // e.g., "opencode acp"
  port: number               // OS-assigned (use 0)
  cwd: string
  persist?: boolean          // keep CLI alive on disconnects
  gracePeriod?: number       // -1 for infinite (mobile)
  tunnelName?: string        // optional Dev Tunnel
}): Promise<BridgeHandle> {
  const args = [
    "@rebornix/stdio-to-ws",
    opts.cliCommand,
    "--port", String(opts.port),
    ...(opts.persist ? ["--persist"] : []),
    ...(opts.gracePeriod !== undefined
      ? ["--grace-period", String(opts.gracePeriod)]
      : []),
    ...(opts.tunnelName
      ? ["--tunnel-name", opts.tunnelName]
      : []),
  ]
  const proc = spawn("npx", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] })
  // Parse port from stdout, return handle
  // ...
}
```

**מה אנחנו מקבלים חינם:**
- ✅ stdio↔WebSocket wrapping (line / NDJSON framing — ACP native)
- ✅ **`--persist` + `--grace-period -1`** — CLI שורד disconnects (חיוני למובייל ולנהיגה)
- ✅ Client-Id replay buffer
- ✅ **Microsoft Dev Tunnels integration** (`--tunnel-name`) — `wss://` URL יציב מבלי TLS/proxy ידני
- ✅ בinary בלבד, ללא integration code שלנו לתחזוקה

**מה אנחנו עדיין צריכים לעשות:**
- כתיבת `BridgeManager` ב-`backend/adapters/` שspawn-ים, מנטר, ו-killing את ה-bridge processes
- כתיבת `AcpTransport` adapter שמתחבר ל-WS שה-bridge חושף ומדבר ACP JSON-RPC
- (זה מה ש-`@agentclientprotocol/sdk` עושה — שני שלבים שמקצרים ל-~100 שורות)

**Survival flow:**
1. Backend spawn-ים `npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1`
2. ה-bridge מדפיס "Listening on ws://127.0.0.1:7100"
3. Backend connect ל-WS, מבצע ACP handshake, מקבל `connectionId` + `sessionId`
4. Backend נופל / מתעדכן → ה-bridge ממשיך, מצבר sessionUpdate notifications, ה-CLI ממשיך לעבד
5. Backend חוזר → reconnect ל-WS עם `X-Client-Id` header → bridge עושה replay של ה-buffered events

### 7.5 Voice Pipeline
**מה:** STT → LLM router → TTS.
**אחריות:** המרה דו-כיוונית בין אודיו לטקסט, plus translation אם נדרש.
**Sub-modules:** `Stt` (Gemini), `Tts` (ElevenLabs), `Translator` (Gemini), `Cache`.
**Pure?** core כן; HTTP fetches ב-edges.

### 7.6 Cache
**מה:** persistence של קריאות יקרות.
**אחריות:** lookup, store, eviction, TTL.
**Implementation:** pluggable (memory / disk / R2 / KV).

### 7.7 i18n
**מה:** תרגום UI strings, ניהול locale.
**אחריות:** load locale bundles, format messages.
**Where:** משותף ל-frontend ו-backend (שרת מחזיר messages מתורגמים).

---

## 8. Module map

### 8.1 Monorepo structure

```
drive-coding/
├── packages/
│   ├── protocol/          # Zod schemas + types משותפים
│   │   ├── src/
│   │   │   ├── ws-messages.ts   # FE↔BE WS protocol (Zod)
│   │   │   ├── api.ts           # HTTP API types (Zod)
│   │   │   ├── agent.ts         # Agent/Session domain types
│   │   │   └── acp-envelope.ts  # ACP types (re-export from @agentclientprotocol/sdk)
│   │   └── package.json
│   │
│   ├── core/              # ⭐ Pure functional core — NO IO
│   │   ├── src/
│   │   │   ├── ports/           # interfaces (SttProvider, TtsProvider, AcpTransport, CacheStore)
│   │   │   ├── voice/           # pipeline planning, sentence-boundary, decisions
│   │   │   ├── acp/             # message parsing, provider-error extraction
│   │   │   ├── cache/           # cache key derivation, eviction policies (pure)
│   │   │   └── i18n/            # message catalogs + formatting
│   │   ├── tests/               # 100% pure unit tests
│   │   └── package.json
│   │
│   ├── backend/           # Imperative shell — IO + adapters + delivery
│   │   ├── src/
│   │   │   ├── server.ts        # entry: HTTP + WS server
│   │   │   ├── boot.ts          # wire ports ↔ adapters
│   │   │   ├── adapters/        # implementations של ports
│   │   │   │   ├── acp-bridge-transport.ts    # uses @flutur/acp-http-bridge
│   │   │   │   ├── gemini-stt.ts
│   │   │   │   ├── gemini-translator.ts
│   │   │   │   ├── elevenlabs-tts.ts
│   │   │   │   ├── whisper-local-stt.ts       # optional (BYOC)
│   │   │   │   ├── piper-tts.ts               # optional (BYOC)
│   │   │   │   ├── disk-cache.ts
│   │   │   │   └── memory-cache.ts
│   │   │   ├── app/             # application orchestration
│   │   │   │   ├── voice-orchestrator.ts
│   │   │   │   ├── agent-orchestrator.ts
│   │   │   │   └── identity.ts
│   │   │   └── delivery/        # HTTP routes, WS handlers
│   │   │       ├── http-api.ts
│   │   │       └── ws-handler.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── frontend/          # SvelteKit (drive-first UI)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +page.svelte             # dashboard
│       │   │   ├── agent/[id]/+page.svelte  # ממשק קולי (כפתור גדול)
│       │   │   ├── agent/new/+page.svelte   # יצירת agent חדש
│       │   │   └── settings/+page.svelte
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   │   ├── BigButton.svelte
│       │   │   │   ├── BubbleChat.svelte
│       │   │   │   └── AgentCard.svelte
│       │   │   ├── stores/
│       │   │   │   ├── agent.ts             # per-agent store factory
│       │   │   │   ├── dashboard.ts
│       │   │   │   └── settings.ts
│       │   │   ├── api/                     # WS+HTTP clients
│       │   │   ├── audio/                   # MediaRecorder + playback
│       │   │   └── i18n/                    # locale loading (Paraglide?)
│       │   └── app.html
│       └── package.json
│
├── docs/                  # תיעוד
├── tests/                 # cross-package integration tests
├── docker-compose.yml
├── bun-workspace.json     # או pnpm-workspace
└── package.json
```

**Dependencies חיצוניים מרכזיים:**
- **`@rebornix/stdio-to-ws`** — bridge לכל CLI (D33). spawn דרך `npx`, אין צורך ב-import.
- `@agentclientprotocol/sdk` — JSON-RPC types + client-side connection
- `@agentclientprotocol/claude-agent-acp` — Claude Code adapter (D24)
- `neverthrow` — `Result<T, E>` ב-core (D31)
- `arktype` — schemas ב-`core/schemas.ts` (D31)
- `@google/genai` — STT + translator (Gemini)
- `@ricky0123/vad-web` — VAD בעתיד (לא ב-MVP)

**הסרה משמעותית:** ה-package `packages/acp-bridge/` שתוכנן ב-D23 ושוב ב-D30 — בוטל סופית ב-D33. אנחנו spawn-ים את `@rebornix/stdio-to-ws` כ-CLI binary, לא קוד שלנו.

### 8.2 Key boundaries

- `core/` **לא יכול** לייבא מ-`backend/` או `frontend/`. רק טיפוסים מ-`protocol/`.
- `backend/` יכול לייבא מ-`core/` ו-`protocol/`.
- `frontend/` יכול לייבא מ-`protocol/` בלבד.
- אין שיתוף קבצים דרך symlinks. הכל workspace dependencies.

### 8.3 דוגמה ל-pure function ב-core

```ts
// packages/core/src/voice/sentence-boundary.ts
export function findSentenceBoundary(text: string): number {
  // הקיים מ-v6 — pure, נבדק, port-able ל-Go
}

// packages/core/src/pipeline/decide-tts-priority.ts
export function decideTtsPriority(
  state: PipelineState,
  event: AcpEvent,
): TtsAction {
  // pure decision: האם לשלוח ל-TTS, לבטל, להמתין
  // החלפת ה-imperative queue הקיים ב-decision pure
}
```

ה-shell ב-`backend/` קורא לפונקציות האלה ומבצע IO לפי ההחלטה.

### 8.4 Frontend store strategy

SvelteKit עם stores. אין state גלובלי — כל agent הוא store עצמאי.

```ts
// packages/frontend/src/lib/stores/agent.ts
export function createAgentStore(agentId: string) {
  // WebSocket subscription
  // local cache of bubbles, audio, status
  // returns readable + actions
}
```

ב-route `/agent/:id`, ה-store נוצר on-mount, מתפרק on-unmount. Dashboard ב-`/` מאזין ל-orchestrator events דרך WebSocket נפרד.

---

## 9. Deployment

### 9.1 Architecture diagram

```
              ┌────────────────────────────┐
              │   Public users (mobile,    │
              │   browser, in-car)         │
              └──────────────┬─────────────┘
                             │ HTTPS / WSS
                             ▼
                  ┌──────────────────────┐
                  │  Cloudflare Tunnel   │ (no public IP)
                  └──────────┬───────────┘
                             │
                             ▼
   ┌────────────────────────────────────────────────────────┐
   │   Proxmox host (אצל אבי)                                │
   │  ┌──────────────────────────────────────────────────┐  │
   │  │  Container: drive-coding                          │  │
   │  │                                                   │  │
   │  │  ┌──────────────────────────┐                     │  │
   │  │  │  Backend (Bun)           │                     │  │
   │  │  │  - HTTP + WebSocket (FE) │                     │  │
   │  │  │  - Voice Pipeline        │                     │  │
   │  │  │  - Static frontend serve │                     │  │
   │  │  │  - bridge-client (per-id)│                     │  │
   │  │  └─────┬────────────────────┘                     │  │
   │  │        │ WebSocket (JSON-RPC ACP)                 │  │
   │  │        │ localhost:7100..7199                     │  │
   │  │  ┌─────▼──────────────────────────────────────┐   │  │
   │  │  │  acp-bridge processes (one per agent)      │   │  │
   │  │  │  ┌─────────────┐  ┌─────────────┐          │   │  │
   │  │  │  │  bridge #1  │  │  bridge #2  │  ...     │   │  │
   │  │  │  │  WS :7100   │  │  WS :7101   │          │   │  │
   │  │  │  │     │       │  │     │       │          │   │  │
   │  │  │  │     ▼ stdio │  │     ▼ stdio │          │   │  │
   │  │  │  │   opencode  │  │   gemini    │          │   │  │
   │  │  │  └─────────────┘  └─────────────┘          │   │  │
   │  │  │  Each bridge survives backend crashes      │   │  │
   │  │  └────────────────────────────────────────────┘   │  │
   │  │                                                   │  │
   │  │  Volume mount: /data/cache (TTS, STT, transl.)   │  │
   │  └──────────────────────────────────────────────────┘  │
   └────────────────────────────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
     ┌──────────────────┐          ┌──────────────────┐
     │  Gemini API      │          │  ElevenLabs API  │
     └──────────────────┘          └──────────────────┘
```

**זרימת מקרי קצה:**
- **Backend נופל:** bridges ממשיכים לקבל events מ-CLIs ומאחסנים ב-buffer.
- **Backend עולה מחדש:** bridge-manager טוען את הregistry (קובץ JSON ב-`/data/bridges.json`), מתחבר מחדש לכל bridge, מקבל את ה-buffered events.
- **Bridge נופל:** backend מסמן את ה-agent כ-"מת" ב-dashboard. המשתמש יכול לבחור לפתוח מחדש (יאבד state פנימי של ה-CLI, אבל אפשר להציע `session/load` כדי להמשיך).
- **Cloudflare tunnel נופל:** משתמשים מקבלים 521. backend ו-bridges ממשיכים.

### 9.2 Environments

| Env | Where | Purpose |
|-----|-------|---------|
| `dev` | Coder workspace / מחשב אישי | פיתוח יומיומי |
| `prod` | Proxmox container אצל אבי | היחיד לעת עתה |

### 9.3 Frontend deploy

**שלב 1 (MVP):** Frontend נבנה ל-static (SvelteKit adapter-static) ומוגש על-ידי ה-backend עצמו על אותו origin. פשטות מעל הכל.

**שלב 2 (אם הקהילה גדלה):** SvelteKit ל-Cloudflare Pages, backend נשאר ב-Proxmox עם CORS. עוזר ל-latency גלובלי ול-edge caching של static assets.

### 9.4 Backend deploy

Bun ב-Docker בתוך LXC. Container תקין כ-Docker host. אם נעדיף LXC native — Bun מותקן ישירות, יותר קליל אבל פחות isolated.

Volume mount ל-`/data/cache` (TTS audio, translation text, STT cache).

Cloudflare tunnel (`cloudflared`) רץ או על ה-host או בקונטיינר נפרד, מצביע ל-`localhost:3000`.

### 9.5 Updates

- Push ל-`main` branch (אחרי שעוברים מ-worktree).
- GitHub Actions: build + push Docker image ל-ghcr.io.
- Container אצל אבי משתמש ב-Watchtower או webhook להזנקת `docker pull && restart`.

לעת עתה זה future. בשלב הראשון — `git pull && docker compose up -d --build` ידני.

---

## 9.6 UX Principles — Drive-First

זה הדגש המרכזי שמבדיל את הפרויקט מ-codenomad או opencode web. כל החלטת UI נשפטת לפי **"האם זה עובד עם ידיים על ההגה ועיניים על הכביש?"**.

### עקרונות

1. **כפתור אחד גדול במרכז.** start/stop של הקלטה + cancel של מודל. אין כפתור נפרד לכל פעולה.
2. **Touch targets מינימום 80px.** אצבע בנהיגה לא מדייקת.
3. **High contrast, large text.** הבועות גדולות, ניתנות לקריאה גם במבט קצר.
4. **TTS-first feedback.** כל מצב חשוב גם נשמע (לא רק נראה). למשל "מקליט" לא רק טקסט קטן — גם צליל אישור.
5. **בלי modals/dialogs.** הם דורשים אצבע מדויקת והסתכלות.
6. **בלי scroll מורכב.** scroll הבועות אוטומטי, אין pinch-zoom.
7. **Wake lock + landscape lock.** המסך לא יכבה, ולא יסתובב באמצע ריצה.
8. **Media Session API.** כפתור bluetooth ברכב יוכל להפעיל/לעצור הקלטה.

### UI Surfaces

| Surface | Purpose | Style |
|---------|---------|-------|
| Dashboard `/` | רשימת agents חיים + כפתור "+ חדש" | cards גדולים, scroll vertical |
| Agent live `/agent/:id` | ממשק קולי פעיל | כפתור גדול במרכז, בועות מעליו |
| Settings `/settings` | קולות, שפה, מפתחות BYOK בעתיד | רגיל, לא drive-friendly |
| Agent new `/agent/new` | בחירת CLI, cwd, model | רגיל. רק לפני הנהיגה |

### State Machine של הכפתור הגדול

```
                    ┌──────────────────┐
              ┌────►│      idle         │◄────┐
              │     └─────────┬────────┘     │
              │               │ click         │
              │               ▼               │ done speaking
              │     ┌──────────────────┐     │ (no user click)
              │     │   recording       │     │
              │     └─────────┬────────┘     │
              │               │ click         │
              │ click         ▼               │
              │     ┌──────────────────┐     │
              │     │  processing       │     │
              │     │ (STT + ACP)       │     │
              │     └─────────┬────────┘     │
              │               │ first chunk   │
              │               ▼               │
              │     ┌──────────────────┐     │
              │     │   speaking        │─────┘
              │     │ (model streaming) │
              │     └─────────┬────────┘
              │               │ click (interrupt)
              │               ▼
              │     ┌──────────────────┐
              └─────│   cancelling      │
                    │ (cancel + audio   │
                    │  stop)            │
                    └──────────────────┘
                             │
                             ▼
                       (back to recording)
```

### צבעי המצב (לכפתור הגדול)

| State | Color | אנימציה |
|-------|-------|---------|
| idle | אפור כחלחל | אין |
| recording | אדום עז | פעימה רכה (1Hz) |
| processing | סגול | rotation slow |
| speaking | ירוק | waveform או pulse לפי volume |
| cancelling | כתום | flash מהיר |

ממתין לאישור / שיפור.

---

## 10. תהליך פיתוח

### 10.1 Worktree

```bash
git worktree add ../voice-acp-v2 -b vnext
```

ה-master ימשיך לקבל hotfixes רק במידת הצורך. כל v2 חי ב-`vnext` branch ב-worktree נפרד.

### 10.2 Migration strategy

לא migration — paralllel run.
1. ה-POC הקיים ימשיך לעבוד אצל אבי על port 3000.
2. v2 יבנה מאפס ב-port אחר (3010) ב-dev.
3. כשמרגיש מוכן — אבי בודק את שניהם זמנית (URLs נפרדים).
4. כש-v2 כשיר ל-100% — אבי עובר אליו, ה-POC נכבה.
5. לא נמחק את הקוד הישן עוד חודשיים — אולי נצטרך reference.

### 10.3 Vertical slices

הפיתוח ב-vertical slices (כמו ב-v6) — כל slice נותן feature שאפשר לראות ולבדוק:

**Slice 1:** scaffold monorepo + protocol package + "hello world" backend + SvelteKit hello + WebSocket שמחזיר echo.

**Slice 2:** identity + dashboard ריק + יצירת agent דמה (בלי CLI אמיתי, רק entity במזיכרון).

**Slice 3:** ACP transport stdio + spawn opencode + session/new + session/prompt בסיסי בלי voice.

**Slice 4:** Voice pipeline — STT + TTS + ECHO ללא agent (הקלטה → תמלול → הקראה).

**Slice 5:** חיבור agent + voice pipeline → ממשק קולי מלא לסשן בודד.

**Slice 6:** Multi-session + dashboard עם agents חיים.

**Slice 7:** Survival של disconnect (agent ממשיך לרוץ).

**Slice 8:** Cache (R2 או disk לפי env).

**Slice 9:** i18n + שפה אחרת מלבד עברית.

**Slice 10:** Deploy ל-Fly.io + Cloudflare Pages.

כל slice = sprint קצר. בסוף כל slice — אבי בודק.

### 10.4 Testing

- **Pure functions ב-core:** unit tests מקיפים (כמו ב-v6).
- **Backend imperative shell:** integration tests עם mocks של ACP/Gemini/ElevenLabs.
- **Frontend:** Vitest ל-stores ול-components, Playwright ל-e2e flows.
- **Cross-package:** smoke tests של slices.

מטרה: כל slice יוצא עם בדיקות עוברות.

---

## 11. Roadmap

### Phase 0 — תכנון (כאן עכשיו)

- [x] שיחת תכנון עם אבי (סשן זה)
- [x] טיוטה ראשונה של מסמך זה
- [ ] תשובות לשאלות פתוחות מ-§5
- [ ] שכבה 2 של מסמך זה — חפירה לעומק בכל domain

### Phase 1 — Foundation

- [ ] worktree `voice-acp-v2`
- [ ] monorepo scaffold
- [ ] Slices 1-3 (echo → dashboard → ACP בסיסי)

### Phase 2 — Voice MVP

- [ ] Slices 4-5 (voice pipeline → first end-to-end)

### Phase 3 — Production-readiness

- [ ] Slices 6-8 (multi-session, survival, cache)

### Phase 4 — Cloud + i18n

- [ ] Slices 9-10 (i18n, deploy)

### Phase 5 — מעבר

- [ ] בדיקת acceptance של אבי
- [ ] כיבוי של POC

---

## נספח A — מה מהPOC עובר?

הצעה ראשונית למה ב-`backend/src/` של ה-POC נשמע "port-able" כפונקציות טהורות:

| מה | יעד ב-vNext |
|-----|------------|
| `sentence-boundary.ts` | `core/voice/sentence-boundary.ts` (כמעט copy) |
| `provider-error.ts` | `core/acp/provider-error.ts` |
| `markdown.ts` | `core/voice/markdown.ts` |
| `tts-cache.ts` (logic) | `core/cache/tts-cache.ts` (חסר IO) |
| `gemini-helper.ts` (decisions) | `core/voice/translator.ts` (חסר fetch) |
| `system-prompt.ts` | `core/voice/system-prompt.ts` |
| `static-path.ts` | מיותר (frontend ב-CDN) |
| `recordings.ts` (logic) | `core/voice/recording-paths.ts` (paths only) |

מה לא עובר: `server.ts`, `acp-bridge.ts`, `audio-handler.ts`, `init-handler.ts`, `message-router.ts`, `prompt-handler.ts` — אלה IO-shells שייכתבו מחדש.

---

## נספח A2 — Comparison: drive-coding vs existing tools

| כלי | Voice? | Multi-CLI? | RTL? | Hands-free? | OS / Platform |
|-----|--------|------------|------|-------------|---------------|
| **codenomad** | ❌ | ❌ (opencode only) | ✅ | ❌ | Web |
| **opencode web** | ❌ | ❌ | ⚠️ חלקי | ❌ | Web |
| **Zed** | ❌ | ✅ (ACP) | ❌ (כתב מראה!) | ❌ | Desktop |
| **Claude desktop** | ⚠️ TTS only | ❌ | ✅ | ❌ | Desktop |
| **drive-coding (vNext)** | ✅ | ✅ (ACP) | ✅ | ✅ | Web (mobile-first) |

ה-niche הייחודי שלנו: **voice + multi-CLI + RTL + drive-friendly**. אין מתחרה ישיר. ה-CLI החזק ביותר עם voice היום הוא Whisper.cpp + ChatGPT plugins, אבל זה לא מחובר לקודינג עם ACP.

ה-prior art שכן קיים — Whisperflow, Wispr Flow — הם כללי לכל typing, לא ל-coding workflow. drive-coding ממוקד בסוכני קוד.

### השלכה ל-codenomad

אבי הזכיר: "הייתי רוצה ש-codenomad יתחבר דרך ACP ל-CLI מרובים ולא רק לאופנקוד".

הפרויקט שלנו מאיץ את זה — הקוד של `acp-bridge` ו-`AcpClient` שיתפתחו כאן יוכלו בעתיד להיות package נפרד שמשרת גם את codenomad וגם את drive-coding. שווה לחשוב על זה כשמגיעים ל-slice 3.

### CLIs נתמכים מהיום הראשון

| CLI | Adapter | Status |
|-----|---------|--------|
| opencode | native ACP (built-in) | ✅ נתמך ב-POC |
| Gemini CLI | ?? לבדוק במחקר | ⚠️ צריך בדיקה |
| **Claude Code** | **`@agentclientprotocol/claude-agent-acp`** v0.34.0 | ✅ adapter רשמי (1.9k★) |

ה-Claude Code adapter תומך ב: context @-mentions, images, tool calls, edit review, TODO lists, terminals (interactive + background), slash commands, MCP servers. הכל דרך ACP — כך שאנחנו לא צריכים adapter משלנו, רק להפעיל את התהליך הזה דרך `acp-bridge`.

---

## נספח B — שאלות שעוד פתוחות לאבי (אחרי סבב 3)

**עיקרי הסבב הזה:**

1. **Q9.** שם הפרויקט — האם `drive-coding` מאושר?
2. **Q10.** Stop mechanism — אופציה B (אותו כפתור)?
3. **Q11.** Wake word ב-MVP — POC נפרד אחרי MVP?
4. **Q13.** הקלדה ב-MVP — לא?
5. **Q14.** UI Components — פירוט אושר?
6. **Q14a.** ACP Bridge protocol — האם ההמלצות שלי (WS + OS-port + mini-supervisor + 500-buffer + no auth + registry קובץ) מאושרות?
7. **Q14b.** Wake word library — openWakeWord לבחירה לכשנגיע אליו?
8. **Q15.** State machine של הכפתור — משקף נכון?
9. **Q16.** Frontend `/settings` — עמוד אחד או פיצול?
10. **Q17.** Image format — Docker או LXC native?

**~~נסגרו~~ בסבב הזה (3):**
- ~~Q12. Backend survival~~ → נפתר עם D23 (acp-bridge).
- ~~Q18. Multi-CLI adapter~~ → Claude Code דרך adapter רשמי (D24).

---

### ⏳ שאלה אסטרטגית קריטית — Q-NEW-4

**הקשר:** מצאנו את `formulahendry/acp-ui` (274★, MIT, Vue 3 + Tauri) — web/mobile/desktop client בוגר ל-ACP עם 11 agents pre-configured. הוא **לא** תומך ב-voice וב-RTL. הוא משמש בעצמו את `@rebornix/stdio-to-ws` כ-bridge.

זה משנה את הבחירה האסטרטגית הגדולה. שלוש אופציות:

#### אופציה A: Build from scratch (התוכנית המקורית)

- כותבים SvelteKit frontend חדש לחלוטין.
- backend Bun, ports/adapters, voice pipeline, drive-first UX מהיום הראשון.
- שולטים בכל קווי הקוד.

**יתרונות:**
- 100% ייחוד — drive-first, RTL, voice, Hebrew מהיום הראשון.
- SvelteKit כמו שאבי בחר.
- אין תלות בעדכוני upstream.
- learning experience עמוק.

**חסרונות:**
- ~10 slices, חודשי עבודה.
- צריך לכתוב מחדש: routing, agent management UI, sessions list, permission dialogs, slash commands, tool call visualization, model picker, traffic monitor.
- חלק מהדברים חופפים ל-acp-ui.

#### אופציה B: Fork `acp-ui` והוסף voice + RTL

- מתחילים ב-fork של formulahendry/acp-ui.
- מוסיפים voice layer (STT/TTS/translator) + RTL + drive-first UX.
- שומרים את כל ה-multi-agent + cross-platform support.

**יתרונות:**
- חיסכון של ~70% מהעבודה — הbase מוכן ועובד.
- 11 agents כבר נתמכים.
- Mobile/Web/Desktop builds ready.
- session/load + foreground reconnect כבר ממומשים.
- MIT license — חופשי לחלוטין.

**חסרונות:**
- **Vue 3, לא SvelteKit** — אבי הצהיר על SvelteKit.
- Tauri — תלות נוספת (ל-desktop builds).
- צריך לחיות עם החלטות UX שלא בחרנו (chat-first, לא drive-first).
- עדכוני upstream דורשים merge work.
- branding שלהם — צריך לעשות rename ל-drive-coding.

#### אופציה C: Hybrid — voice gateway נפרד + שמירה על acp-ui כ-alternative

- אנחנו בונים backend עם voice pipeline + Svelte frontend ייעודי ל-drive mode.
- ה-backend חושף את ה-WS protocol של drive-coding.
- במקביל, ה-bridge עצמו (`stdio-to-ws`) חי כ-CLI נפרד שגם משמש את acp-ui.
- המשתמש יכול לבחור: drive-coding (drive-first) או acp-ui (chat-first), שניהם מתחברים לאותם CLIs.

**יתרונות:**
- Drive-first UX שלם בחירת SvelteKit.
- אופציה backup — אם משהו לא עובד ב-drive-coding, יש acp-ui כ-alternative client לאותו setup.
- contribution לקהילה (קל יותר לתרום ל-stdio-to-ws + לעודד שימוש שכן עובד).

**חסרונות:**
- כמעט כמו אופציה A מבחינת היקף.
- "alternative client" הוא יתרון מינורי לרוב המשתמשים שיבחרו אחד מהם.

#### ההמלצה שלי

**אופציה C — בעצם כמעט A אבל עם awareness של acp-ui.**

הסיבות:
1. SvelteKit הוא המבחר שלך, לא Vue. למעבר ל-Vue יש tax לא-תרומתי.
2. drive-first UX הוא הייחוד שלנו — הוא מצדיק build מאפס.
3. ה-bridge (stdio-to-ws) גם ככה לא משלנו — חסכנו שם 40% מהעבודה.
4. ה-CLIs פותחים את הברירה — אפילו אם נבחר A, משתמש שלא רוצה drive-mode יוכל להשתמש ב-acp-ui עם אותו setup.

**ממתין להחלטה.** אם תבחר B (fork), כל ה-spec ב-`vnext-spec.md` משתנה דרסטית. אם תבחר A או C, נמשיך כמתוכנן עם תיקון ה-bridge ל-`@rebornix/stdio-to-ws`.

---

## נספח C — Roadmap מפורט אחרי תשובות

(טיוטה — יוחלף אחרי שכבה 2)

לקראת **shipping אצל אבי**:
1. סגירת שאלות Q9-Q18 (סבב נוסף).
2. שכבה 2 של המסמך — data models, API spec, WS protocol spec.
3. scaffold worktree + monorepo.
4. Slices 1-5 (foundations + voice MVP).
5. בדיקה משותפת — אבי משווה ל-POC.
6. החלפה.

לקראת **shipping לקהילת מפתחים**:
7. Slices 6-7 (multi-session, ניקוי + dashboard).
8. Slice 8 (cache פרסיסטנטי).
9. Slice 9 (i18n + אנגלית).
10. Slice 10 (deploy hardening, supervisor, monitoring).
11. README + onboarding מסמך + video demo.
12. הכרזה (HN? Reddit? Lobste.rs? Twitter?).

---

> **המשך:** שכבה 2 של מסמך זה תיכתב אחרי שאבי יחזור עם תשובות לסבב Q9-Q18.
> שכבה 2 תכלול: data models מלאים, sequence diagrams, פירוט API, ו-protocol spec.
