# Roadmap — drive-coding (master)

+ **תאריך:** 2026-06-17 · **סטטוס:** חי (master — מאחד את כל ה-roadmaps)
+ זהו מקור-האמת לטווח-ארוך. ה-roadmaps הספציפיים (provider/voice/frontend) הם sub-documents תחתיו — ראה §מקורות.

> ⚠️ **סיכון חיוב (2026-06-20):** Anthropic הכריזו (14/5/2026, תוקף מתוכנן 15/6, אכיפה כרגע
> **מושהית**) על פיצול חיוב-מנוי: שימוש ב-claude **דרך ACP / `claude -p` / SDK** יוצא מ-pool
> המנוי ל-**Agent SDK credits נפרדים** ($20 Pro / $100–200 Max). drive-coding מריץ claude
> דרך ה-ACP adapter → נופל ב-pool ה-third-party. ה"עובד על המנוי" עובד היום רק כי האכיפה
> מושהית; "subprocess מול library" **לא** פותר (שתיהן ACP/SDK). first-party = רק ה-CLI `claude`
> בטרמינל (אין לו ACP server mode). משפיע על Track A ועל productization. מקור: Zed blog
> "anthropic-subscription-changes". ר' memory `anthropic-acp-subscription-billing-change`.
> **מיטיגציה לחקירה (נדון ב-e7a6f5c1):** ה-VSCode extension מדבר עם Claude Code (שכן תומך-מנוי)
> בפרוטוקול כלשהו — לבדוק האם אפשר לאמץ אותו כדי להישאר על ה-pool של המנוי, במקום SDK/ACP.

## חזון

עוזר **voice-first** אחד — שמשמש **גם ככותב קוד וגם כעוזר אישי** — מעל מנוע רב-ספקי.
הקונספט "כמו CodeNomad": פלטפורמת-עוזר רב-יכולת (לא CLI wrapper), עם ריבוי ספקים,
ניהול sessions, ושירותי קול כאזרח מהמעלה הראשונה. היכולות ה"אישיות" הן **אופציונליות** —
המשתמש מדליק מה שהוא צריך.

## עקרונות-יסוד

+ **Provider-agnostic:** `provider-contract` (repo `provider-abstraction`) הוא מקור-האמת היחיד למודל המנורמל. **drive-coding = צרכן בלבד** (git-dep).
+ **Voice-first:** קלט/פלט קולי הוא הדרך הראשית, לא תוספת. hands-free (רכב, נייד).
+ **אופציונליות:** יכולות עוזר (memory/MCP/scheduling) נדלקות לפי בחירה — לא כפויות.
+ **שיטת עבודה:** brief-driven-slices (מרדכי→אביגיל→אליעזר→כלב); נועלים תוכנית ב-commit לפני ביצוע.

## מצב נוכחי (תמצית)

עובד היום: chat טקסטואלי+קולי מול ACP/opencode, VoiceMode FSM, TTS streaming, sessions,
tool rendering, WS reconnect, אריזה (bunx/npm), Windows. הבסיס יציב לשימוש יומיומי.

---

## ערוצי עבודה (Tracks)

### A — Provider Engine  ·  `provider-contract`
מנוע רב-ספקי מנורמל (events + session + config + registry).

| פריט | סטטוס |
| --- | --- |
| P0 — contract + ACP + claude-code adapters + registry | ✅ מוזג ל-main |
| vnext-A/B — transport split + ProviderLaunchConfig | ✅ ב-integration-vnext |
| **vnext-C — config-options** (SessionConfig + setConfigOption) | 🔄 brief אושר (READY), בביצוע |
| P1d — drive-coding cutover ל-ProviderSession (+יישור shape `kind`/`type`) | 💭 מתפצל ל-P1d-1/P1d-2 |
| claude-code native — ספק שני (דלת 5: tool lifecycle) | 💭 |
| codex app-server — ספק שלישי | 💭 |
| **הזרקת prompt-מערכת מותאם-אודיו פר-CLI** — הנחיות לעוזר voice-first מוזרקות לכל ספק בדרכו (claude=CLI flag, opencode=plugin, codex=app-server prompt). תשתית להתאמת התנהגות-קול פר-מנוע. | 💭 חדש — נדון ב-83d1e6e4 (sessions), טרם brief |

### B — Voice  ·  `voice-provider-abstraction`
כל ספק לכל שירות קול (TTS/STT/תרגום/נרייט).

| פריט | סטטוס |
| --- | --- |
| V1 — voice-config-core (בחירת ספק טהורה) | 💭 מוכן ל-dispatch |
| V2 — voice-openai-text (תרגום/STT/נרייט) | 💭 |
| V3 — TtsProvider interface (ElevenLabs מאחוריו) | 💭 |
| V4 — ספק TTS שני (Gemini-Live / OpenAI / TBD) | 💭 הכרעה פתוחה |

### C — Frontend / UX
ממשק קולי, hands-free, web-first.

| פריט | סטטוס |
| --- | --- |
| בסיס: connect/chat/voice-mode/bubbles/sessions/tool-rendering | ✅ |
| settings page · smart scroll · audio cues | 🔶 חלקי — **smart scroll מוזג** (slice-mode-label-scroll: גלילה מאוחדת ב-SessionOptionsPanel + תווית mode פר-ספק + תיאורי אפשרויות + קישורי markdown ב-tab חדש). settings page · audio cues עדיין 💭 |
| **chat-render polish** (שרשרת A→B→C) — **A:** טבלאות Markdown (allowlist DOMPurify חסר tags של טבלה) · **B:** רינדור תמונות בכלים (`image` raster+SVG + `resource` blob image, היום base64 גולמי) · **C:** העדפות-תצוגה (collapse מחשבות / expand כלים ב-settings) | ✅ **מוזג ל-dev** (2026-06-25, merge cc5ff66; 4 commits כולל snap-back fix; כלב GO, אביגיל READY, אומת חי בנייד). פותח את message/input backlog שמתחתיו |

#### Message & Input UX backlog — נקלט 2026-06-24 (מהתנסות המשתמשת)

> מקור-פירוט: `docs/plans/ui-feature-backlog.md`. כל הסלייסים האלה בונים מעל chat-render-polish (ToolBubble/ThoughtBubble/settings). **אפשר אימות ACP חי מול שני ספקים** (opencode + claude-code) — רלוונטי במיוחד ל-spike של סוכן-המשנה.

| פריט | סטטוס |
| --- | --- |
| **תצוגת סוכן-משנה (sub-agent / Task)** — היום מגיע כ-`tool_call` רגיל עם `kind`, מרונדר כ-`ToolBubble` גנרי עם args כ-JSON גולמי. **חסר:** (א) זיהוי task/subagent כסוג נפרד; (ב) רינדור מקונן עם הפרדה בין ההודעות/הכלים/המחשבות של תת-הסוכן; (ג) הצגת שם תת-הסוכן ופרטיו. **לא ידוע מה claude/opencode בכלל שולחים על ה-wire עבור Task — האם ה-updates המקוננים מגיעים בנפרד או רק tool_call אחד עם תוצאה.** קבצים: `agent-session.svelte.ts#handleToolCall`, `bubble.ts` (ToolCall union), `ToolBubble.svelte`. אולי דורש הרחבת משטח-החוזה (nested agent updates). | ⭐💭 **spike ראשון** (`WIRE_RECORD=1` על Task חי בכל ספק) → אז brief renderer. complexity 8+ → calev-heavy |
| **virtualization / ביצועי גלילה** — `ChatBubbles.svelte` עושה `{#each bubbles}` ללא windowing → כל הבועות ב-DOM בו-זמנית → איטיות בשיחה ארוכה. smart-scroll כבר מוזג (`slice-mode-label-scroll`) אבל windowing לא. צריך virtual list עם שימור anchoring + **auto-scroll במנות** + jump-to-bottom (reference: CodeNomad `virtual-follow-list.tsx`). עצמאי לחלוטין. | 🔄 **brief עודכן — ממתין לאימות אביגיל מחדש** (`slice-chat-virtualization.md`; היה READY r3, ואז שונה ב-דיון `623c749f`: follow מ-re-pin רציף ל-**batched** [distance ~3 שורות + floor ~300ms, קפיצה מלאה לסוף, בלי page-cap] + toggle=hold + force-follow על תור חדש. **virtua** + Option B; complexity 8 → calev-heavy + phase-check. dispatch אחרי READY+אישור) |
| **ביטול שליחה ב-Enter (toggle)** — setting `enterToSend` (default true=התנהגות נוכחית); כש-off: Enter=שורה-חדשה, שליחה בכפתור/Cmd+Ctrl+Enter. | ✅ **מוזג ל-dev** (2026-06-25, merge 160736b; אביגיל READY, כלב GO 10/10, אומת חי) |
| **latex-math** — רינדור KaTeX בכל 4 הסגנונות (`$`/`$$`/`\(`/`\[`). הכרעת-מפתח: **allowlist פר-מקור (two-pass)** — `style`/`span` מבודדים למסלול KaTeX (trusted), ה-markdown של המודל בלי span/style (secure-by-construction נגד overlay-phishing מ-prompt-injection). extension פנימי (`marked.use`), dep=`katex` בלבד. נוגע ב-`markdown.ts` → תלוי chat-render-polish. | ✅ **מוזג ל-dev** (2026-06-25, merge `cb66b8a`) — שרשרת של 3 slices: **latex-math** (two-pass KaTeX) → **bidi-fix** (`normalizeLineLeadingBidi`) → **invisibles** (`normalizeInvisibles` — range relocate-or-delete; תיקן את ה-gap שהתגלה חי: תווים בלתי-נראים אחרי `\|` בשורת separator שברו טבלאות). אביגיל READY על כולם, כלב GO (11/11 DoD), אומת חי בדפדפן. ⚠️ post-merge צריך `pnpm install` (תלות katex חדשה) |
| **content-viewer** — viewer fullscreen גנרי (bits-ui `Dialog`) פר content-type. MVP: **תמונה + PDF + Markdown-מרונדר** (לסוכן להציג brief/plan לאישור). lightbox משרת גם את תמונות-הכלים (chat-render-polish). תשתית גנרית, מימוש הדרגתי. | 💭 brief (בכתיבה — מרדכי) |
| **כותרת הסשן בהדר הצ'אט** — ה-`title` כבר במודל (`SessionInfo`) ומוצג ב-`SessionCard`/`SessionPicker`, אבל **לא בהדר של הצ'אט הפעיל**. auto-generate (`generate_session_title`) הוא future נפרד. | ✅ **brief READY** (`slice-session-title-header.md`; אביגיל r1→r2; חיווט 3 נתיבים: loadSession/switchSession/reconnect + keep-on-undefined). dispatch אחרי אישור |
| **פקודות Slash (/)** — 0% תשתית. החוזה לא חושף `commands` (Claude שולח `commands_changed`, לא מחווט ל-FE). דורש: חשיפת `commands` במשטח-החוזה/BE + view-model + dropdown autocomplete + parsing ב-TypeArea. | 🟡💭 תלוי Track A (משטח-חוזה) |
| **הדבקת תמונות (paste→preview→send)** — 0%. `sendPrompt(text)` טקסט-בלבד; צריך multimodal `PromptContent[]` + `onpaste` handler + preview + הרחבת חוזה `/session/prompt`. ה-`PromptContent` הקנוני כבר מולטימודלי. | 🟡💭 תלוי Track A (משטח-חוזה) |
| **local-file-proxy** — BE proxy שקורא `file://` מקומי-לסביבת-ה-agent ומגיש ל-FE, כדי להציג `resource_link` עם `file://`+`image/*` כתמונה אמיתית (היום נופל ל-JSON; הדפדפן ב-https לא יכול לטעון `file://`). **כבד-אבטחה: LFI/path-traversal** — ההכרעה המרכזית תהיה sandbox (allowlist דינמי של uris שהוזכרו ב-session **או** sandbox ל-cwd עם `realpath`). תלוי ב-slice B (משתמש ברינדור ה-`<img>`). יש תקדים proxy ב-BE (`/proxy/elevenlabs`, `/proxy/google`). | 💭 brief (אחרי B) |
| **session-prefs פר-פרויקט (CWD)** — שמירת agent/mode/model + מצב-קול (mute) פר-פרויקט ב-BE, **מסונכרן בין מכשירים** (תיקיית `.drive-coding` בנתיב). אופציה לבטל סנכרון בהגדרות. | 🟢 **brief READY** (`slice-session-prefs-per-cwd.md`, Complexity 7, אביגיל r3). base=dev — dispatch מותר |
| **עקביות מחווני "Chat display"** — שני המתגים מ-chat-render-polish C בפולריות הפוכה (Collapse thoughts ON=מסתיר; Expand tools ON=מציג) → מבלבל. איחוד לפולריות חיובית ("Show X by default") + migration למשתמשים קיימים. | 🟢 **brief READY** (`slice-display-toggle-consistency.md`, Complexity 3). base=dev — dispatch מיידי |
| **claude — בועות כפולות** — כל תשובת claude מופיעה פעמיים. שורש מאומת: `resetTurnScratch()` ב-`claude-agent-acp` מאפס `currentStreamMessageId` באמצע ה-stream → deltas בלי messageId → לא מסוננים. תיקון: **fork של ה-adapter + שורת-שורש** (TDD red→green), בלי לגעת בקוד drive-coding (wiring דרך config). | 🟡💭 **brief טיוטה** (`slice-fix-claude-duplicate-bubbles.md`, Complexity 6). base=fork נפרד |
| **RLM / תווים משבשי-markdown** — תווי כיווניות (RLM `‏`) ותווים אחרים צמודים לסימוני-MD שוברים רינדור. הכרעות פתוחות: דחיפת RLM לתוך הטקסט במקום מחיקה; **הפרדת קוד-sanitize מקוד-render** (כיום מעורבבים). | 🔄 **בעבודה כעת ע"י סוכן** — נדון ב-5f8fcb92 (אושר + שוגר אליעזר); כיוון: דחיפת RLM לטקסט במקום מחיקה + הפרדת sanitize/render (TDD). לאמת branch/commit בסיום |
| **ממשק אישור-בקשות (permission UI)** — כיום `session/request_permission` מאושר אוטומטית כברירת-מחדל, אין UI להחליט. צריך: UI אישור/דחייה לכלי + מיפוי אילו modes (bypass) בכלל לא שולחים בקשה. קשור ל-F "הריצה נעצרת". | 💭 **טרם brief** — נדון ב-fdf80659/e038a47a |
| **ID יציב לכלי (שורש snap-back)** — לכל tool-call ID יציב לשימור מצב קיפול פר-בועה (כיום snap-back בכל status update; chat-render-polish תיקן מקומית בלבד). | 💭 **טרם brief** — נדון ב-9a6999e2 |
| **עקביות ערכות-עיצוב (themes)** — יש כמה ערכות-עיצוב; פיצ'רים חדשים חייבים להתאים לכולן (קונטרסט/צבעי-בועות). | 💭 רעיון — נדון ב-fdf80659 |
| **drive-first chrome** (car mode, Media Session, wake lock) | 💭 |
| recordings + replay | 💭 |
| **ידית BottomSheet מתנגשת ב-OS gesture bar (מובייל)** — ה-handle יושב ב-28px התחתונים (detent `peek`), בדיוק על ה-gesture bar של הטלפון → גרירת ה-sheet מתנגשת במחוות ה-OS. פתרון מוצע: לנתק את ה-handle מה-sheet ולמקמו **מעל ה-toggle של RecordFooter**; ב"סגור" ה-sheet נעלם לגמרי (`peek 28px`→`hidden 0px`). ההתנהגות (משיכה→sheet עולה ומכסה) נשמרת. דורש: decoupling handle↔sheet + שינוי detent-model + drag-ownership (`BottomSheet`/`RecordFooter`/`ui-shell`) + z-index. כבר יש workaround חלקי (RecordFooter `pb` במצב hidden). **מצריך brief — regression בליבת ה-gesture, לא נתפס ב-typecheck.** | 💭 brief |
| cutover frontend-v2 → frontend | 💭 סוף |

### D — Assistant capabilities  ·  *חדש (עוזר אישי)*
היכולות שהופכות מ"כותב קוד" ל"עוזר אישי". **כולן אופציונליות.**

| פריט | סטטוס |
| --- | --- |
| **זיכרון ארוך-טווח / knowledge** — persistence חוצה-sessions (העדפות, עובדות) | 💭 חדש |
| **תזמון, תזכורות ומשימות** — עוזר פרואקטיבי (לא רק reactive) | 💭 חדש |
| **MCP כללי + automation** — תשתית MCP פתוחה לחיבור כלים/שירותים + workflows | 💭 חדש |
| **Google Workspace** — דרך CLI של Google או שרתי MCP של Anthropic | 💭 **spike: לבדוק היתכנות** |

### E — Access & Entry  ·  *חדש (deep links)*
כניסה מהירה ל-hands-free.

| פריט | סטטוס |
| --- | --- |
| **Deep link לתיקייה** — קישור אחד פותח את העוזר על התיקייה הנכונה ומתחיל שיחה, בלי לבחור תיקייה | 💭 חדש |
| deep links כלליים (session/agent/mode מתוך קישור) | 💭 חדש |

### F — Infrastructure & Packaging
| פריט | סטטוס |
| --- | --- |
| `bunx drive-coding` · npm-publish | ✅ READY |
| Windows adaptation · cli-agents deploy (systemd) | ✅ |
| **WS robustness — ניתוק דפדפן לא יפיל את ה-BE** — ניתוק WS "מלוכלך" פולט `error` ללא listener → `uncaughtException` → `process.exit` → כל ה-BE + ה-agent child מתים. תיקון: `feWs.on("error")` + ריכוך ה-handler הגלובלי | ✅ מוזג ל-dev (`slice-ws-error-survival`, 3 שכבות + observability; אביגיל ×2 READY) |
| **Wire observability לשכבת הגשר** — כל תצפית ה-wire (`LOG_WIRE` + `WIRE_RECORD`) חיה ב-`ws-agent` ומתה ב-`detach()` → עיוורון כשאין דפדפן. תיקון: התצפית יורדת ל-`bridge-manager` (reader קבוע ששורד detach) + `writeStdin()` לכיוון ה-out; ns `backend.ws.wire`→`backend.acp.wire`. **נותן עיניים לאבחן את "הריצה נעצרת" — לא מתקן אותה.** | ✅ מוזג ל-dev (`slice-wire-observability-bridge`, אביגיל ×2 READY, כלב GO, בדיקה חיה: 245 frames אחרי detach) |
| **"הריצה נעצרת" בלי דפדפן** — התהליך **שורד** (תוקן), אבל ה-turn נעצר. השערה: ה-FE הוא ה-ACP client → בקשת-קליינט (`session/request_permission`/`fs/read_text_file`) שלא נענית כשאין דפדפן. **לחקור עם ה-observability החדש.** | 💭 slice נפרד — לאבחן עם `LOG_WIRE=acp` ואז להחליט (backend-managed client? buffer? timeout?) |
| **WS thrashing — אותו session בשני טאבים** — MED-8 (חיבור FE יחיד ל-agentId) + auto-reconnect → ping-pong אינסופי על הסוקט. נדיר (אין דרך רשמית לפתוח אותו session בשני טאבים) אבל livelock כשקורה | 💭 **לבדוק** — takeover semantics / לעצור reconnect בטאב המפסיד |
| **spawn ENOENT → 201 (known bug)** — `POST /api/agents` כש-CLI לא נמצא מחזיר `201` (optimistic) במקום error; ה-BE שורד אבל ה-client לא יודע מיד שה-spawn נכשל. הטסט F-1 (`bridge-failure-integration`) אדום מ-slice 10 (חלק ה-status-code מעולם לא היה ירוק). **נפרד מ-WS disconnect.** | 💭 slice נפרד — fail-fast (להמתין רגע ל-child) או עדכון הטסט ל-design ה-async |

---

## Milestones (אבני-דרך)

+ **M0 — בסיס יומיומי** ✅ — chat+voice+sessions מול ACP/opencode. *קיים.*
+ **M1 — כותב-קוד מלא ויציב** — vnext-C + P1d (config-options מקצה-לקצה) · Voice V1–V3 · frontend polish (settings/scroll/cues/car-mode/recordings) + **message & input UX** (sub-agent rendering · virtualization · enter-toggle · session-title · slash · paste — ראה Track C). *הליבה הטכנית מתבססת.*
+ **M2 — עוזר אישי v1** — Track D (memory + MCP general + scheduling) + Track E (deep links) + spike Google. *המעבר ל"עוזר".*
+ **M3 — רב-ספקי מלא** — claude-code native + codex (Track A). *לא נעולים לספק יחיד.*

## Future / רעיונות לא-מחייבים

+ **Backend-managed (HTTP/SSE transport)** — session-owner ב-backend, client דק, כמו טופולוגיית CodeNomad. מתועד ב-`provider-abstraction/docs/design/ideas/backend-managed-http-transport.md`. **רעיון אופציונלי** — לא ב-roadmap המחייב; לחזור אליו אם יציבות WS / איבוד-state יהפכו לכאב. **עדכון (sessions 848d3296/e7a6f5c1/e038a47a):** עלתה כוונה אקטיבית יותר — **להפוך את ספריית-הספקים עצמה לגשר** שמדבר frames מצד אחד ו-WS/SSE/HTTP/ACP מהשני, **הדרגתית** (שלב ראשון: רק לאשר בקשות; התשתית כבר תהיה שם). טרם הוכרע אם נכלל ב-M-מחייב.
+ פיצ'רים שנדחו — ראה `docs/future-features.md`.

## מקורות (sub-roadmaps)

+ Provider: `docs/plans/provider-abstraction-roadmap.md` · `provider-abstraction/docs/decisions/session-config-options.md`
+ Voice: `docs/plans/voice-provider-abstraction-roadmap.md`
+ Frontend: `packages/frontend/docs/slices.md`
+ נדחים/רעיונות: `docs/future-features.md` · `provider-abstraction/docs/design/ideas/`
