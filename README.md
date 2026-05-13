# voice-acp

ממשק שיחה קולי ל-OpenCode דרך פרוטוקול ACP.

## מטרה

ממשק push-to-talk פשוט שמאפשר שיחה קולית עם מודל AI דרך OpenCode, תוך שימוש
בפרוטוקול ACP כשכבת תקשורת — כדי שהממשק יהיה ניתן לחיבור לכל CLI שתומך ב-ACP
בעתיד.

## עיקרון הפעולה

```
[לחיצה על כפתור] → הקלטה → STT (Gemini) → OpenCode via ACP → TTS (ElevenLabs) → השמעה
```

## רכיבים

- **frontend/** — דף HTML בודד עם כפתור push-to-talk
- **backend/** — שרת Bun: מגשר WebSocket ↔ ACP, מטפל ב-STT ו-TTS
- **docs/spec.md** — מפרט טכני מלא

## הפעלה

```bash
# דרישות: opencode, bun, משתני סביבה ב-.env
cd backend && bun install && bun run dev
# פתיחת frontend/index.html בדפדפן
# URL params: ?cwd=/path/to/workspace&session=SESSION_ID
```

## תצורה

ראה `.env.example` לרשימת משתני הסביבה הנדרשים.

## מצב

POC — לא מוכן לייצור.
