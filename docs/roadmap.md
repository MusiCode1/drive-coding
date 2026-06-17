# Roadmap — drive-coding (master)

+ **תאריך:** 2026-06-17 · **סטטוס:** חי (master — מאחד את כל ה-roadmaps)
+ זהו מקור-האמת לטווח-ארוך. ה-roadmaps הספציפיים (provider/voice/frontend) הם sub-documents תחתיו — ראה §מקורות.

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
| settings page · smart scroll · audio cues | 💭 |
| **drive-first chrome** (car mode, Media Session, wake lock) | 💭 |
| recordings + replay | 💭 |
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

---

## Milestones (אבני-דרך)

+ **M0 — בסיס יומיומי** ✅ — chat+voice+sessions מול ACP/opencode. *קיים.*
+ **M1 — כותב-קוד מלא ויציב** — vnext-C + P1d (config-options מקצה-לקצה) · Voice V1–V3 · frontend polish (settings/scroll/cues/car-mode/recordings). *הליבה הטכנית מתבססת.*
+ **M2 — עוזר אישי v1** — Track D (memory + MCP general + scheduling) + Track E (deep links) + spike Google. *המעבר ל"עוזר".*
+ **M3 — רב-ספקי מלא** — claude-code native + codex (Track A). *לא נעולים לספק יחיד.*

## Future / רעיונות לא-מחייבים

+ **Backend-managed (HTTP/SSE transport)** — session-owner ב-backend, client דק, כמו טופולוגיית CodeNomad. מתועד ב-`provider-abstraction/docs/design/ideas/backend-managed-http-transport.md`. **רעיון אופציונלי** — לא ב-roadmap המחייב; לחזור אליו אם יציבות WS / איבוד-state יהפכו לכאב.
+ פיצ'רים שנדחו — ראה `docs/future-features.md`.

## מקורות (sub-roadmaps)

+ Provider: `docs/plans/provider-abstraction-roadmap.md` · `provider-abstraction/docs/decisions/session-config-options.md`
+ Voice: `docs/plans/voice-provider-abstraction-roadmap.md`
+ Frontend: `packages/frontend/docs/slices.md`
+ נדחים/רעיונות: `docs/future-features.md` · `provider-abstraction/docs/design/ideas/`
