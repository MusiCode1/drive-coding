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
| **provider cutover — `@drive-coding/provider` reabsorbed + claude in-process + ext channel חי** — חבילת-workspace additive (client/transport/config/spawn/host/connection/extensions); `bridge-manager`→`ProviderConnection` (BE מרכיב פרימיטיבים); claude in-process (Model 2, ext channel), opencode/codex spawn; `_drive/setThinkingTokens` חי מ-FE→claude; FE capability-gating+facade. | ✅ **מוזג ל-dev v0.8.0** (2026-06-29, merge `fac76c2`; 11 slices, כל אחת אביגיל READY→calev GO; אומת ב-preview חי claude/opencode/codex+thinking; ר' `decisions/drive-coding.md`). הסתייגויות: `mcp:false` (future), חיוב third-party (פתוח-במודע). |
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
| V1 — voice-config-core (בחירת ספק טהורה) | ✅ **מוזג ל-dev** (2026-06-27, merge `ff016e6`; `VoiceConfig`+`select()` טהור TDD; אביגיל READY 3 סבבים, calev GO 6/6) |
| V3 — TtsProvider interface (ElevenLabs מאחוריו) | ✅ **מוזג ל-dev** (2026-06-27, merge `3c4e9b3`; אביגיל READY r1, calev GO 7/7) |
| **V4a — Gemini-TTS ✅ (PCM→WebAudio)** — ספק שני אומת חי (`gemini-3.1-flash-tts-preview`, SSE streaming, ~1s first-audio, verbatim עברי). `geminiTts` (SDK `@google/genai`) + `PcmAudioStream` (WebAudio, BufferSource queue) לצד נתיב MP3/MediaSource + `RoutingAudioSink` (לפי format) + **בורר ספק-TTS בהגדרות** (default ElevenLabs). **V4a-unify** — איחוד שני צרכני-TTS (Speaker+BubblePlayer) תחת `resolveTts()`+`RoutingAudioSink` (תיקון bug Gemini-בבועה שנתפס ב-runtime-gate חי). | ✅ **מוזג ל-dev** (2026-06-27, merges `5abe5f1`+`38f929c`; אביגיל READY; build-gates ירוקים, 324/324; אומת חי ב-preview. ר' `decisions/voice-acp.md` + `v4-gemini-tts-pre-brief.md`) |
| **V4b — בורר-קול Gemini פר-ספק** — היום קול Gemini מקובע ל-`"Kore"` (מרוכז ב-`resolveTts()` — נקודת-שינוי יחידה). צריך: **לשלוף את רשימת הקולות של Google** (prebuilt voices: Kore/Puck/Charon/Fenrir/Aoede/Leda/Zephyr/Orus...) + שדה `geminiVoice` בהגדרות + `<Select>` (כמו VoicePicker) + העברתו דרך `resolveTts`. + voice-config מלא פר-ספק (ElevenLabs voiceId vs Gemini voiceName). | 💭 **טרם brief** — נדון 2026-06-27 |
| **חיתוך-סגמנטים חותך באמצע מילה** — ה-pipeline מפצל את הטקסט לסגמנטים (משפטים) ל-streaming TTS דרך `core/voice/sentence-boundary.ts`; **פעמים רבות החיתוך נופל באמצע מילה** → קול קטוע/לא-טבעי. נתפס חי 2026-06-27 ב-preview, **וקורה בשני הספקים (גם claude וגם opencode)**. | 🔬 **חקירה פתוחה** (2026-06-28) — `docs/investigations/2026-06-28-sentence-cutting-mid-word.md`. האבחון הראשון (flush מוקדם בגלל opencode-tail) **הופרך** (קורה גם ב-claude; אין סיגנל סוף-הודעה אמין). 5 השערות; **המובילה: תווי-כיווניות (RLM)/ניקוד משבשים את `Intl.Segmenter`** (מתחבר ל-"RLM/תווים משבשי-markdown" ב-Track C). דורש נתונים חיים (cache/wire של שני הספקים) לפני brief-ביצוע. בודד מתוכנית-הפלייליסט (Track C). |
| V2 — voice-openai-text (תרגום/STT/נרייט) — ספק טקסטואלי שני, מקבילי (לא בנתיב Gemini-TTS) | 💭 |

### C — Frontend / UX
ממשק קולי, hands-free, web-first.

| פריט | סטטוס |
| --- | --- |
| בסיס: connect/chat/voice-mode/bubbles/sessions/tool-rendering | ✅ |
| **מסך-פתיחה: הסרת בורר-סשן → רשימת תיקיות-אחרונות + 2 תיקוני folder-picker** — מסירים את ה-`SessionPicker`+`listSessionsForCwd` (spawn יקר רק כדי לאסוף סשנים); בחירת-סשן עוברת ל*תוך* הסשן (קיים). במקום: רשימת תיקיות-אחרונות מ-`GET /api/projects` (תשתית `ProjectsRegistry` קיימת ב-BE, FE-only). + תיקון folder-picker: נפתח בנתיב שהוזן (`startPath` prop) + מסתיר *כל* dot-folder (היום prefix-match על 5 בלבד). | ✅ **מוזג ל-dev** (2026-06-28, merges `83bd874` A → `726f9f3` B, `--no-ff` שרשרת; כלב GO: A 8/8 אומת חי בדפדפן, B 14/14 [סטטי + smoke-test חי ב-preview שאומת ע"י המשתמשת]; typecheck 0; push origin). **המשך — 3 שיפורים → slice אחד מאוחד `recent-projects-controls`:** מחיקה (BE: `removeCwd` + `DELETE /api/projects`) · כיווץ panel · persist מצב-כיווץ (localStorage) · ✕ אדום ב-hover. ✅ **מוזג ל-dev** (2026-06-28, merge `ca76a95`, release **v0.3.0**; אביגיל r1 READY; כלב GO 12/12 אומת חי; typecheck 0, BE 34, FE 354; push origin). **שינוי-כיוון אחרי preview**: מהסתרה-קבועה ל**מחיקה-אמיתית** (✕ מוחק רשומה; תיקייה חוזרת אם מתחברים אליה שוב — recency). |
| settings page · smart scroll · audio cues | 🔶 חלקי — **smart scroll מוזג** (slice-mode-label-scroll: גלילה מאוחדת ב-SessionOptionsPanel + תווית mode פר-ספק + תיאורי אפשרויות + קישורי markdown ב-tab חדש). settings page · audio cues עדיין 💭 |
| **בקרת השמעה+ריצה + פלייליסט** — עצור/השהה(pause)/המשך(resume) השמעה · **prev/next בין משפטים** · פלייליסט=**כל היסטוריית השיחה** (איחוד `BubblePlayer`) · עצור-ריצה (cancel + עוצר גם השמעה) · watchdog ל-turnState (בועה שנתקעת אחרי סיום). **התובנה המאחדת: reserve-on-enqueue** — סגמנט נכנס לתור מיד (לא אחרי fetch) → פותר גם סדר-השמעה-הפוך (Gemini), גם prev/next, גם pause. הרבה כבר קיים מ-msr-v2/slice-22 (`Player`/`OrderedQueue`/`jumpToSegment`). | 🟡 **קוד גמור — טרם מוזג; runtime-gate של B1 חסום חיצונית** (2026-07-01). כל השרשרת בוצעה ואומתה ב-`slice/playback-ui`: **A2 ✅GO\* · A3 ✅GO\* · A4 ✅GO\* · A5 ✅GO · B1 🟡 קוד-גמור+אביגיל-READY**. ה-branch מאגד A2→A3→A4+A5+B1 ו**עבר reconcile מול dev** (102 commits + provider cutover v0.8.0, `48b3403`). **build-gate אחרי reconcile ✅** (typecheck 0, tests 962/985; 6 כשלים pre-existing: spawn-ENOENT known-bug + TLS-cert-Windows — אפס בפלייליסט). **חסם:** מפתח Gemini שרוף — הפרויקט `generative-code` חסום מנהלית (תשלום תקוע, `403 PERMISSION_DENIED`; ה-env הוזרק נכון, המפתח תקף) → אי-אפשר לבדוק TTS חי. **נקודת-המשך** (כשיהיה מפתח תקין): preview על 4002 (build קיים, בחר Gemini) → **כלב calev-heavy על B1** → merge יחיד A2→A3→A4 (`--no-ff`) + A5 + B1. תוכנית: `docs/plans/playback-run-control-roadmap.md`; פירוט: `decisions/voice-acp.md` 2026-07-01. חיתוך-המילים (היה A1) **בודד לחקירה**. |
| **chat-render polish** (שרשרת A→B→C) — **A:** טבלאות Markdown (allowlist DOMPurify חסר tags של טבלה) · **B:** רינדור תמונות בכלים (`image` raster+SVG + `resource` blob image, היום base64 גולמי) · **C:** העדפות-תצוגה (collapse מחשבות / expand כלים ב-settings) | ✅ **מוזג ל-dev** (2026-06-25, merge cc5ff66; 4 commits כולל snap-back fix; כלב GO, אביגיל READY, אומת חי בנייד). פותח את message/input backlog שמתחתיו |

#### Message & Input UX backlog — נקלט 2026-06-24 (מהתנסות המשתמשת)

> מקור-פירוט: `docs/plans/ui-feature-backlog.md`. כל הסלייסים האלה בונים מעל chat-render-polish (ToolBubble/ThoughtBubble/settings). **אפשר אימות ACP חי מול שני ספקים** (opencode + claude-code) — רלוונטי במיוחד ל-spike של סוכן-המשנה.

##### 📦 Markdown-UX batch (2026-06-28) — 7 בקשות-משתמשת לרינדור-צד-לקוח

> מקור: התנסות-המשתמשת 28/06. נחתך ל-4 slices. **A+D מוזגים; B/C טרם.** briefs ב-`docs/plans/`, decisions ב-`decisions/voice-acp.md`.

| Slice | מכסה (req) | סטטוס |
| --- | --- | --- |
| **A — `markdown-content-unify`** | #1 קוד no-wrap+hscroll · #3 מרקדאון בהודעות-משתמש (UserBubble היה חסר CSS — ציטוט/רשימות/כותרות) · #4 מחשבות→מרקדאון מלא · #5 רשימות-סמן (Tailwind preflight) | ✅ **מוזג ל-dev** (merge `a20fbda`). איחוד 4 משטחים ל-`MarkdownContent.svelte` (+`ContentViewerDialog`). אביגיל READY ×2, כלב GO 10/10, **+ תיקון blockquote-נראה** (`var(--border)` 8% היה בלתי-נראה → `--fg-muted`+רקע; נתפס חי בpreview). אומת חי ע"י המשתמשת. |
| **B — `markdown-dir-per-paragraph`** | #6 `dir="auto"` פר block-element | ✅ **מוזג ל-dev** (2026-06-29, merge `f194357`, release **v0.7.1**; push `9988c74`). **🎉 סוגר את batch Markdown-UX (A+B+C+D ✅).** merge-order ההיסטורי "B לפני D" בטל (D מוזג קודם); אביגיל אימתה-מחדש מול dev+D (`f1763d4`, 6/6 claims, finding 🟢 `dir`-guard שולב). הרחבת DOMPurify hook: `BIDI_BLOCK_TAGS`→`dir="auto"` עם guard `!hasAttribute("dir")`; `pre/code` מודרים (LTR). 67/67 tests, כלב GO 8/8, אומת חי ב-preview. **known-limitation**: `<br>`-separated segments בפסקה דו-לשונית אחת חולקים כיוון (לא block-elements נפרדים) — מקרה-קצה bidi, לא רגרסיה. |
| **C — `code-copy-button`** | #2 כפתור-העתקה פר code-block | ✅ **מוזג ל-dev** (2026-06-29, merge `02ff12f`, release **v0.6.0**; push origin `74e26a2`). **הופרד מהשרשרת**: depends_on:[A] מומשה (A מוזג `a20fbda`) → base=dev ישיר. Svelte action `enhanceCodeBlocks` co-located + event-delegation (גוטשת-streaming). FE-only (`bubble.copy/copied`), typecheck 0, 371/371. אביגיל r2 READY, כלב GO 8/8, **אומת חי ב-preview (build מלא, כולל integration עם D)**. קונפליקט CSS מול D ב-`MarkdownContent.svelte` נפתר additive. |
| **D — `code-syntax-highlight`** | #7 צביעת-קוד | ✅ **מוזג ל-dev** (2026-06-28, merge `05fe3b6`, release **v0.5.0**). highlight.js ב-**pass-3b מבודד** (`CODE_ALLOW=pre/code/span+class`, בלי style; דפוס KaTeX). 16 שפות, theme פר-פלטה (8 פלטות × 9 `--hl-*`). **F1 שתפסה calev-heavy** (בלוק-קוד לפני KaTeX איבד את עוטף `<pre><code>` — סיווג fragment לפי boundary-by-index) **תוקן ב-`fragmentKinds[]`** + 3 טסטי-רגרסיה. **calev-heavy re-run GO 10/10**; אומת חי בדפדפן ע"י המשתמשת (צבעים ב-2 פלטות). F3 (class="hljs" ריק בבלוק-בלי-שפה) cosmetic נשאר. Shiki נדחה (inline-style מתנגש במודל). **שינוי-סדר**: מוזג **לפני** B (D היה גמור-ואומת; B/C מוחזקים ל-executor טרי מול dev+D — מזעור קונפליקטים ב-`markdown.ts`/`MarkdownContent.svelte`). |

##### 🐛 virtua scroll — 3 באגים (pre-brief למרדכי, סשן נפרד)

> `docs/plans/scroll-virtua-flicker-prebrief.md` — אבחנה חיה משותפת עם המשתמשת (Playwright harness `scripts/debug-virtua-flicker.cjs`). **בגלילה-הווירטואלית הקיימת, לא רגרסיה.**

| באג | שורש | מצב |
| --- | --- | --- |
| **ריצוד** — בועה נראית נעלמת-וחוזרת מתזוזת-2px | **מאומת בקוד-virtua**: viewport נמדד דרך `ResizeObserver.contentRect` (מחריג padding); `pt-20/pb-10` של `.chat-scroll` → viewport 524 במקום 644 → under-render | תיקון-חלקי נבדק חי (הסרת padding: 120→80px gap, **לא נסגר**; שארית ≈ `startMargin`+חוסר `itemSize`). דורש slice ייעודי |
| **קפיצה-לתחתית** | follow re-engage רגיש (48px) + חלון-כוונה 600ms | כיוון: sticky-hold (re-engage רק בגלילה-מכוונת/כפתור/שליחה) |
| **אובדן-הרחבה** ב-remount | `open` מקומי ב-Thought/ToolBubble נאבד | = שורש **"ID יציב לכלי / snap-back"** (כבר ב-roadmap). תיקון: מאגר-fold לפי id |

| פריט | סטטוס |
| --- | --- |
| **תצוגת סוכן-משנה (sub-agent / Task)** — היום מגיע כ-`tool_call` רגיל עם `kind`, מרונדר כ-`ToolBubble` גנרי עם args כ-JSON גולמי. **חסר:** (א) זיהוי task/subagent כסוג נפרד; (ב) רינדור מקונן עם הפרדה בין ההודעות/הכלים/המחשבות של תת-הסוכן; (ג) הצגת שם תת-הסוכן ופרטיו. **לא ידוע מה claude/opencode בכלל שולחים על ה-wire עבור Task — האם ה-updates המקוננים מגיעים בנפרד או רק tool_call אחד עם תוצאה.** קבצים: `agent-session.svelte.ts#handleToolCall`, `bubble.ts` (ToolCall union), `ToolBubble.svelte`. אולי דורש הרחבת משטח-החוזה (nested agent updates). | ⭐💭 **spike ראשון** (`WIRE_RECORD=1` על Task חי בכל ספק) → אז brief renderer. complexity 8+ → calev-heavy |
| **virtualization / ביצועי גלילה** — `ChatBubbles.svelte` עושה `{#each bubbles}` ללא windowing → כל הבועות ב-DOM בו-זמנית → איטיות בשיחה ארוכה. smart-scroll כבר מוזג (`slice-mode-label-scroll`) אבל windowing לא. צריך virtual list עם שימור anchoring + **auto-scroll במנות** + jump-to-bottom (reference: CodeNomad `virtual-follow-list.tsx`). עצמאי לחלוטין. | ✅ **מוזג ל-dev** (2026-06-25, merge `02a4129`; `slice-chat-virtualization.md`; **virtua** windowing + `ChatScrollBridge` + **batched auto-scroll** [distance ~3 שורות + floor ~300ms, snap-to-line, force-follow על תור חדש] + toggle=hold. follow שונה ב-דיון `623c749f` מ-re-pin רציף ל-batched. אביגיל **r8 READY**, **calev-heavy GO 15/16** + תיקון `lifecycle_outside_component`) |
| **ביטול שליחה ב-Enter (toggle)** — setting `enterToSend` (default true=התנהגות נוכחית); כש-off: Enter=שורה-חדשה, שליחה בכפתור/Cmd+Ctrl+Enter. | ✅ **מוזג ל-dev** (2026-06-25, merge 160736b; אביגיל READY, כלב GO 10/10, אומת חי) |
| **textarea auto-grow** — שדה-הקלט גדל 1→6 שורות לפי התוכן ומתכווץ בחזרה אחרי שליחה (היום גובה קבוע). | 🟡 **בוצע — ממתין לאישור merge** (2026-06-25, `slice-input-autogrow.md`, branch `slice-input-autogrow` @ `77e939f`; **כלב GO 9/9 DoD, 0 findings**; כפתור Send בגובה טבעי — הרגרסיה שאביגיל תפסה לא קרתה. runtime-gate=GO, merge תלוי באישור המשתמשת) |
| **latex-math** — רינדור KaTeX בכל 4 הסגנונות (`$`/`$$`/`\(`/`\[`). הכרעת-מפתח: **allowlist פר-מקור (two-pass)** — `style`/`span` מבודדים למסלול KaTeX (trusted), ה-markdown של המודל בלי span/style (secure-by-construction נגד overlay-phishing מ-prompt-injection). extension פנימי (`marked.use`), dep=`katex` בלבד. נוגע ב-`markdown.ts` → תלוי chat-render-polish. | ✅ **מוזג ל-dev** (2026-06-25, merge `cb66b8a`) — שרשרת של 3 slices: **latex-math** (two-pass KaTeX) → **bidi-fix** (`normalizeLineLeadingBidi`) → **invisibles** (`normalizeInvisibles` — range relocate-or-delete; תיקן את ה-gap שהתגלה חי: תווים בלתי-נראים אחרי `\|` בשורת separator שברו טבלאות). אביגיל READY על כולם, כלב GO (11/11 DoD), אומת חי בדפדפן. ⚠️ post-merge צריך `pnpm install` (תלות katex חדשה) |
| **content-viewer** — viewer fullscreen גנרי (bits-ui `Dialog`) פר content-type. MVP: **תמונה + PDF + Markdown-מרונדר** (לסוכן להציג brief/plan לאישור). lightbox משרת גם את תמונות-הכלים (chat-render-polish). תשתית גנרית, מימוש הדרגתי. | ✅ **מוזג ל-dev** (2026-06-27, merge `e2126e0`; `slice-content-viewer.md`, אביגיל r2/0-findings, כלב GO slice 10/11 + overlay-fix 5/5, typecheck ירוק, אומת חי ב-linux-gui). **MVP FE-טהור: Markdown + תמונה** (`depends_on: []`); expand על בועות message/tool + lightbox לתמונות; **overlay-click→close** (`e8ac736`). **PDF + `file://` נדחו לגל שני gated על `local-file-proxy`**; agent-triggered auto-open = future. |
| **כותרת הסשן בהדר הצ'אט** — ה-`title` כבר במודל (`SessionInfo`) ומוצג ב-`SessionCard`/`SessionPicker`, אבל **לא בהדר של הצ'אט הפעיל**. auto-generate (`generate_session_title`) הוא future נפרד. | ✅ **מוזג ל-dev** (`slice-session-title-header.md`, merge `f418ac7`; חיווט 3 נתיבים + keep-on-undefined + attachToLiveAgent reset; ארגון-מחדש הדר: cwd→inline-end, כותרת במרכז, קלאסים לוגיים; fallback="drive-coding". כלב GO 11/11). **המשך: `header-title-responsive`** (merge `c20bd1e`) — תיקן חפיפת כותרת-עברית-ארוכה על ה-cwd/dot במובייל: 3 עמודות flex + `line-clamp-2` (2 שורות) + פונט רספונסיבי 13/15px. אומת חי ב-linux-gui (כלב GO 10/10) |
| **פקודות Slash (/)** — 0% תשתית. החוזה לא חושף `commands` (Claude שולח `commands_changed`, לא מחווט ל-FE). דורש: חשיפת `commands` במשטח-החוזה/BE + view-model + dropdown autocomplete + parsing ב-TypeArea. | 🟡💭 תלוי Track A (משטח-חוזה) |
| **הדבקת תמונות (paste→preview→send)** — `sendPrompt(text)` טקסט-בלבד; צריך multimodal `PromptContent[]` + `onpaste`/drop/picker + preview + דחיסה. שורש מאומת: ה-FE מדבר ACP ישירות דרך `AcpClient.prompt(sessionId,text)` (text-only, client.d.ts:45); ה-`PromptContent` הקנוני כבר מולטימודלי (events.d.ts:160) אך השכבה הזו עוד לא. BE=dumb-pipe (0 שינוי). | 🟢 **הושלם — ממתין לאישור merge** (2026-07-04). Commits 0–4 בוצעו; reconcile מול dev v0.10.1; **calev-heavy GO 12/13** (e2e חי claude+image; wire image-block; תמונה-בלבד; 0 רגרסיות). capabilities raw (§10). **תיקון-במקום אחרון לפני merge — replay של `session/load`**: ה-gate `if (!text) return` ב-`#handleSessionUpdate` זרק **4 מ-5 ContentBlocks** (image/audio/resource_link/resource) → תמונה שנשלחה נעלמה בטעינה-מחדש (איבוד-שקט). fix: `image` רינדור-מלא ב-`user_message_chunk` (attachments) + **placeholder** ל-audio/resource_link/resource (אין יותר איבוד-שקט). ר' `decisions/drive-coding.md` 2026-07-04. |
| **`message-embedded-content` — רינדור `resource` (embedded) בגוף הודעה** — נגזר מ-image-paste 2026-07-04: `resource` הוא **self-contained** (התוכן ב-frame — `text` או `blob` base64), **לא דורש proxy** (בניגוד ל-`resource_link`). תמיכה חלקית זמינה עכשיו: `resource.text` (`{uri,text,mimeType}`) → רינדור inline (markdown/קוד לפי mime); `resource.blob` עם `image/*` → נתיב data-URI כמו image; blob בינארי → קישור-הורדה/placeholder. נוגע גם בבועות **צד-agent** (`MessageBubble` — אין לה `attachments` היום) → הרחבת-מודל + dispatch. `audio` נגן = slice נפרד (צריך producer). | 💭 **טרם brief** — נגזר 2026-07-04 מ-image-paste. base=dev (אחרי image-paste merge). complexity ~6. |
| **local-file-proxy** — BE proxy שקורא `file://` מקומי-לסביבת-ה-agent ומגיש ל-FE, כדי להציג `resource_link` עם `file://`+`image/*` כתמונה אמיתית (היום נופל ל-JSON/placeholder; הדפדפן ב-https לא יכול לטעון `file://`). **כבד-אבטחה: LFI/path-traversal** — ההכרעה המרכזית תהיה sandbox (allowlist דינמי של uris שהוזכרו ב-session **או** sandbox ל-cwd עם `realpath`). תלוי ב-slice B (משתמש ברינדור ה-`<img>`). יש תקדים proxy ב-BE (`/proxy/elevenlabs`, `/proxy/google`). **🆕 מקפל את רינדור `resource_link` המלא** (נדון 2026-07-04) — היום `resource_link` מקבל placeholder (chip עם `name`) ב-image-paste; התצוגה-כתמונה-אמיתית של `file://` שייכת כאן, כי דורשת את ה-proxy. | 💭 brief (אחרי B) |
| **שחזור agent+mode מהסשן האחרון (FE-טהור)** — סשן חדש טוען אוטומטית את ה-mode/model/agent/toggles שנבחרו לאחרונה, per-cliKind. מנגנון גנרי `setLastConfig` ב-Settings (FE), apply אחרי connected ב-attach+newSession; resume לא נדרס. | ✅ **מוזג ל-dev** (2026-06-28, merge `350e60d`; `slice-restore-last-config.md`; אביגיל r3 READY/0-מהותי, כלב GO light 6/6, build-gate ירוק 354/354. INVASIVE-but-additive — התמזג נקי מול 90 commits drift) |
| **session-prefs פר-פרויקט (CWD)** — שמירת agent/mode/model + מצב-קול (mute) פר-פרויקט ב-BE, **מסונכרן בין מכשירים** (תיקיית `.drive-coding` בנתיב). אופציה לבטל סנכרון בהגדרות. **(הרחבת ה-BE/sync של restore-last-config שלמעלה — הגרסה ה-FE כבר מוזגה.)** | 🟢 **brief READY** (`slice-session-prefs-per-cwd.md`, Complexity 7, אביגיל r3). base=dev. ⚠️ **פתוח לפני dispatch** (נדון 25/06, `4193105a`): הסלייס מאגד את הפיצ'ר עם העברת כל ה-stores ל-`~/.drive-coding/` (תשתית עם regression-risk על recordings/cache **חיים** + migration ידני בדפלוי) — להכריע אם לפצל את (ב) לסלייס-תשתית נפרד שירוץ ראשון |
| **עקביות מחווני "Chat display"** — שני המתגים מ-chat-render-polish C בפולריות הפוכה (Collapse thoughts ON=מסתיר; Expand tools ON=מציג) → מבלבל. איחוד לפולריות חיובית ("Show X by default") + migration למשתמשים קיימים. | ✅ **מוזג ל-dev** (2026-06-25, merge `96ed28e`; `showThoughts`/`showTools` + migration; כלב GO 9/9 DoD, אומת חי בנייד/tunnel) |
| **claude — בועות כפולות** — כל תשובת claude מופיעה פעמיים. שורש מאומת: `resetTurnScratch()` ב-`claude-agent-acp` מאפס `currentStreamMessageId` באמצע ה-stream → deltas בלי messageId → לא מסוננים. תיקון: **fork של ה-adapter + שורת-שורש** (TDD red→green), בלי לגעת בקוד drive-coding (wiring דרך config). | ✅ **נפתר upstream** (2026-06-25) — אנחנו רצים `@latest`, וב-`claude-agent-acp@0.52.0` ה-`resetTurnScratch()` **כבר לא** מאפס `currentStreamMessageId` (תגובה מפורשת ב-`dist/acp-agent.js:645`: "Do NOT reset currentStreamMessageId or streamedBlocks here"). ה-bump 0.47→0.52 ייתר את ה-fork. **ה-brief מבוטל** (`slice-fix-claude-duplicate-bubbles.md`). |
| **RLM / תווים משבשי-markdown** — תווי כיווניות (RLM `‏`) ותווים אחרים צמודים לסימוני-MD שוברים רינדור. הכרעות פתוחות: דחיפת RLM לתוך הטקסט במקום מחיקה; **הפרדת קוד-sanitize מקוד-render** (כיום מעורבבים). | 🔄 **בעבודה כעת ע"י סוכן** — נדון ב-5f8fcb92 (אושר + שוגר אליעזר); כיוון: דחיפת RLM לטקסט במקום מחיקה + הפרדת sanitize/render (TDD). לאמת branch/commit בסיום |
| **ממשק אישור-בקשות (permission UI)** — כיום `session/request_permission` מאושר אוטומטית כברירת-מחדל, אין UI להחליט. צריך: UI אישור/דחייה לכלי + מיפוי אילו modes (bypass) בכלל לא שולחים בקשה. קשור ל-F "הריצה נעצרת". | 💭 **טרם brief** — נדון ב-fdf80659/e038a47a. **שלב-מקדים ✅ מוזג v0.4.0 ב-`leave-running-background`**: זיהוי-bypass רוכז ב-`permission-mode.ts` (claude בלבד) עם הערת-קוד לאיחוד חוצה-ספקים כשיושלם מנגנון-ה-ACP המאוחד. **בסיס-הטריות ל-bypass detection הונח ב-`acp-mode-config-sync`** (מוזג v0.4.0 — ראה Track F) |
| **ID יציב לכלי (שורש snap-back)** — לכל tool-call ID יציב לשימור מצב קיפול פר-בועה (כיום snap-back בכל status update; chat-render-polish תיקן מקומית בלבד). | 💭 **טרם brief** — נדון ב-9a6999e2 |
| **עקביות ערכות-עיצוב (themes)** — יש כמה ערכות-עיצוב; פיצ'רים חדשים חייבים להתאים לכולן (קונטרסט/צבעי-בועות). | 💭 רעיון — נדון ב-fdf80659 |
| **drive-first chrome** (car mode, Media Session, wake lock) | 💭 |
| recordings + replay | 💭 |
| **ידית BottomSheet מתנגשת ב-OS gesture bar (מובייל)** — ה-handle יושב ב-28px התחתונים (detent `peek`), בדיוק על ה-gesture bar של הטלפון → גרירת ה-sheet מתנגשת במחוות ה-OS. פתרון מוצע: לנתק את ה-handle מה-sheet ולמקמו **מעל ה-toggle של RecordFooter**; ב"סגור" ה-sheet נעלם לגמרי (`peek 28px`→`hidden 0px`). ההתנהגות (משיכה→sheet עולה ומכסה) נשמרת. דורש: decoupling handle↔sheet + שינוי detent-model + drag-ownership (`BottomSheet`/`RecordFooter`/`ui-shell`) + z-index. כבר יש workaround חלקי (RecordFooter `pb` במצב hidden). **מצריך brief — regression בליבת ה-gesture, לא נתפס ב-typecheck.** | 💭 brief |
| cutover frontend-v2 → frontend | 🟡 **בביצוע** (`slice-frontend-rename-cutover.md`, branch `slice-frontend-rename-cutover`; 2 commits: קוד פונקציונלי + docs-חיים; ממתין ל-calev + merge) |

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
| **בינארי יחיד עצמאי (`bun build --compile`)** — executable שלא דורש Bun/Node מותקן (מחליף את "מעבר ל-Node target"). **הטמעת ה-FE נחקרה ונפתרה** (spike מאומת 27/06): glob מבנדל `.js` כ-source → חייב **codegen של `import … with {type:"file"}`** פר-קובץ + `Bun.file()` serve-from-memory (content-type אוטומטי, אפס חילוץ לדיסק); gate=`--define __IS_BINARY__` (כי `isStandaloneExecutable` מחזיר `undefined` ב-1.3.12). | 🟡💭 **קדם-brief** (`slice-single-binary-prebrief.md`) — עיצוב ה-FE מאומת; פתוח: pino-pretty worker · plugin opencode (נדחה) · `DATA_DIR` · cross-compile |
| **בילד FE בלי ריסטארט (decouple)** — לבנות מחדש את הפרונט בלי לעצור את הסוכנים הרצים; ריסטארט רק על שינויי-BE (היום ריסטארט עוצר את כל הסוכנים). | 🟢 **brief READY** (`slice-fe-build-decouple.md`, נדחף origin/dev `773e6f0`; טרם בוצע) |
| Windows adaptation · cli-agents deploy (systemd) | ✅ |
| **`slice-windows-hidden-attr` — הסתרת תיקיות מוסתרות-ב-attribute ב-Windows** — היום בורר-התיקיות מסתיר לפי קונבנציית-Unix (`startsWith(".")`); ב-Windows "מוסתר" = `FILE_ATTRIBUTE_HIDDEN` (לא נקודה, למשל `AppData`). Node לא חושף את התכונה ב-`readdir`/`stat`. נקודת-ההרחבה (`isHiddenEntry` async, מקבל dirent+fullPath) **מוכנה** ב-`slice-folder-picker-fixes`. ה-slice הזה יממש את הקריאה בפועל. | 💭 **טרם brief** — הכרעת-תלות פתוחה: מודול native (`winattr`/`fswin`) vs shell-out `attrib`; שקול perf (IO per-entry → cache/הגבלה). נדון 2026-06-27, decision נרשם |
| **WS robustness — ניתוק דפדפן לא יפיל את ה-BE** — ניתוק WS "מלוכלך" פולט `error` ללא listener → `uncaughtException` → `process.exit` → כל ה-BE + ה-agent child מתים. תיקון: `feWs.on("error")` + ריכוך ה-handler הגלובלי | ✅ מוזג ל-dev (`slice-ws-error-survival`, 3 שכבות + observability; אביגיל ×2 READY) |
| **Wire observability לשכבת הגשר** — כל תצפית ה-wire (`LOG_WIRE` + `WIRE_RECORD`) חיה ב-`ws-agent` ומתה ב-`detach()` → עיוורון כשאין דפדפן. תיקון: התצפית יורדת ל-`bridge-manager` (reader קבוע ששורד detach) + `writeStdin()` לכיוון ה-out; ns `backend.ws.wire`→`backend.acp.wire`. **נותן עיניים לאבחן את "הריצה נעצרת" — לא מתקן אותה.** | ✅ מוזג ל-dev (`slice-wire-observability-bridge`, אביגיל ×2 READY, כלב GO, בדיקה חיה: 245 frames אחרי detach) |
| **"הריצה נעצרת" בלי דפדפן** — התהליך **שורד** (תוקן), אבל ה-turn נעצר. שורש **מאומת חי**: ה-FE הוא ה-ACP client → `session/request_permission` שהסוכן פולט אחרי שהדפדפן נותק נשאר ללא מענה → ה-turn תקוע לנצח. | ✅ **אובחן + נמצא workaround מאומת חי** (2026-06-25): במצב **עקיפת-הרשאות (`bypassPermissions`)** ה-stall **לא קורה** — האדפטר מקצר ב-`acp-agent.ts:2480` ומחזיר `allow` בלי לשלוח בקשה לקליינט, אז אין על מה להיתקע. בדיקה חיה (agent `920d6c43`, 21/6, dev :4001): **0** frames של `request_permission`, הסוכן המשיך לפלוט ~5 דק' אחרי סגירת הטאב, ללא stall וללא crash. ⚠️ ה-mode הוא runtime-only ולא נשמר (אין `mode` ב-`Persisted`). **slice עתידי** להפוך את זה לקבוע — או (א) bypass כברירת-מחדל / persist, או (ב) bridge auto-answer כשאין FE (שומר על UI אישור עתידי). קשור ל"ממשק אישור-בקשות". **שיפור-ביניים ✅ מוזג v0.4.0 (`leave-running-background`, calev GO, אומת חי בדפדפן):** כפתור "צא — השאר רץ" (אייקון `LogOut`) שמחזיר לרשימת-התהליכים בלי רענון ובלי להרוג את הסוכן (`leaveRunning()` = תאום `detach()` בלי `deleteAgent`) + כפתור-כיבוי-מלא (`Power`, "כבה לגמרי את התהליך") + **אזהרת-stall** כשלא-ב-bypass (modal בכפתור + `beforeunload`) עם צ'קבוקס "אל תציג שוב" (`suppressLeaveWarning`). אינו פותר את ה-stall — מודיע עליו מראש. |
| **`acp-mode-config-sync` — השלמת ACP-client conformance** — ה-FE התעלם מ-2 events סטנדרטיים ב-`SessionUpdate` union (`current_mode_update` + `config_option_update`), ולכן `modes.currentModeId` נשאר תקוע אחרי שינוי-mode חי (claude חושף mode גם ב-`modes` וגם ב-`configOptions`; מסלול ה-config עדכן רק את האחרון) → ה-dropdown הציג ערך-ישן עד reconnect. טופלו שני ה-handlers ב-`#onSessionUpdate` → מצב mode/config נשאר טרי וסמכותי, **לכל ספק תואם-ACP**. תיקון-שורש שחשף ה-bug ב-leave-running. | ✅ **מוזג ל-dev v0.4.0** (2026-06-28; VM-only, 2 commits TDD `0703a98`+`3e51cf1`; אביגיל READY r2, calev GO 6/6; 371/371 ירוק; ר' `decisions/voice-acp.md`) |
| **WS thrashing — אותו session בשני טאבים** — MED-8 (חיבור FE יחיד ל-agentId) + auto-reconnect → ping-pong אינסופי על הסוקט. נדיר (אין דרך רשמית לפתוח אותו session בשני טאבים) אבל livelock כשקורה | 💭 **לבדוק** — takeover semantics / לעצור reconnect בטאב המפסיד |
| **spawn ENOENT → 201 (known bug)** — `POST /api/agents` כש-CLI לא נמצא מחזיר `201` (optimistic) במקום error; ה-BE שורד אבל ה-client לא יודע מיד שה-spawn נכשל. הטסט F-1 (`bridge-failure-integration`) אדום מ-slice 10 (חלק ה-status-code מעולם לא היה ירוק). **נפרד מ-WS disconnect.** | 💭 slice נפרד — fail-fast (להמתין רגע ל-child) או עדכון הטסט ל-design ה-async |
| **חוסן כיבוי-BE + פורטים שלא משתחררים** — נתפס חי 2026-07-01 (כאב חוזר לפי המשתמשת). ה-BE נתקע (מאזין אך HTTP `http=000`, ~60 סוקטים חצי-סגורים), סגירת-טרמינל לא הרגה אותו, והפורט **לא השתחרר גם אחרי מות התהליך** (handle-inheritance; הריגת בני-codex לא עזרה). 5 פערים: (1) אין `SIGINT`/`SIGTERM`/graceful-shutdown (רק uncaughtException/unhandledRejection ב-`server.ts`); (2) event-loop נתקע; (3) listen-socket עובר בירושה → פורט ננעל; (4) תהליכי-בן codex-acp יתומים לא מתנקים; (5) codex boot ~10ש' (`npx @latest`) מתנגש ב-`INIT_TIMEOUT_MS=10_000` → flaky connect. | 💭 **טרם brief** — `docs/investigations/2026-07-01-be-shutdown-socket-health.md`. slice-חוסן: graceful shutdown + kill-tree + socket לא-ניתן-לירושה + (נספח) נעיצת גרסת codex-acp |

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
