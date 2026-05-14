/**
 * Server — Bun WebSocket + HTTP server.
 *
 * - GET /            → frontend/index.html
 * - GET /<file>      → frontend/<file>
 * - WS  /ws          → WebSocket לתקשורת קולית
 *
 * פרוטוקול WebSocket: ראה docs/spec.md §4.
 */

import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { dirname, sep as PATH_SEP } from "node:path";
import { transcribeAudio } from "./stt.ts";
import { cachedTextToSpeechBase64, streamCachedTextToSpeech } from "./tts.ts";
import { createAcpBridge, type AcpBridge } from "./acp-bridge.ts";
import { VOICE_SYSTEM_PROMPT } from "./system-prompt.ts";
import { renderMarkdown } from "./markdown.ts";
import { narrateToolCall, translateThought } from "./gemini-helper.ts";
import {
  recordingsDir,
  recordingsEnabled,
  saveRecording,
  saveRecordingMetadata,
} from "./recordings.ts";
import { findSentenceBoundary } from "./sentence-boundary.ts";
import { extractProviderError } from "./provider-error.ts";

const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_DIR = resolve(import.meta.dir, "../../frontend");

/**
 * האם להציג stderr של opencode acp ב-stderr של ה-server.
 * controlled by `VOICE_ACP_VERBOSE`. ערך `1`/`true` (case-insensitive) מפעיל.
 * בכל מקרה, ה-stderr נתפס לbuffer פנימי ל-error extraction.
 */
const VERBOSE = (() => {
  const v = (process.env.VOICE_ACP_VERBOSE ?? "0").toLowerCase();
  return v === "1" || v === "true";
})();

// ── סוגי הודעות WebSocket ─────────────────────────────────────────────────────

type ClientMessage =
  | {
      type: "init";
      cwd: string;
      sessionId?: string;
      model?: string;
      voice?: string;
    }
  | { type: "audio"; data: string; mimeType?: string }
  | { type: "text"; text: string } // שליחת טקסט (לדיבוג, בלי STT)
  | { type: "cancel" };

type ServerMessage =
  | {
      type: "ready";
      sessionId: string;
      availableModels?: Array<{ modelId: string; name: string; description?: string }>;
      currentModelId?: string;
    }
  | { type: "transcript"; text: string }
  | { type: "thinking" }
  | {
      type: "text_chunk";
      text: string;
      kind: "message" | "thought" | "thought_translation";
    }
  | {
      type: "tool_call";
      event: "create" | "update";
      toolCallId: string;
      title: string;
      toolKind?: string;
      status?: string;
    }
  | {
      type: "audio_ready";
      data: string; // base64 MP3
      kind: "message" | "tool_title";
    }
  // streaming TTS — מחליף audio_ready ל-live messages
  | {
      type: "audio_start";
      streamId: string;
      kind: "message" | "tool_title" | "thought";
    }
  | { type: "audio_chunk"; streamId: string; data: string } // base64 MP3 chunk
  | { type: "audio_end"; streamId: string }
  // נשלח כשסגמנט message הסתיים — html מרונדר ממרקדאון
  | { type: "message_rendered"; html: string; source: "live" | "history" }
  | { type: "done" }
  | { type: "error"; message: string }
  // היסטוריה — נשלח רק במהלך טעינת session קיים
  | { type: "history_start" }
  | {
      type: "history_chunk";
      text: string;
      kind: "message" | "thought" | "user_message";
    }
  | {
      type: "history_tool_call";
      event: "create" | "update";
      toolCallId: string;
      title: string;
      toolKind?: string;
      status?: string;
    }
  | { type: "history_done" };

// state per WebSocket connection
interface ConnState {
  bridge: AcpBridge | null;
  busy: boolean;
  /** האם כבר נשלח prompt בsession הזה? משפיע על הזרקת ה-system prompt. */
  firstPromptSent: boolean;
  /** קול ה-TTS שנבחר ל-session הזה (`voiceId` של ElevenLabs). */
  voiceId: string | null;
  /**
   * הקטע האחרון מהודעת המודל ש-flushה. משמש כקונטקסט ל-STT —
   * עוזר ל-Gemini לפענח מילים דו-משמעיות לפי מה שנאמר קודם.
   */
  lastAgentMessage: string | null;
  /**
   * הטקסט האחרון שהמשתמש שלח (transcript או text ישיר). משמש כקונטקסט
   * ל-narrateToolCall — "המשתמש ביקש X, ועכשיו אני עושה Y".
   */
  lastUserText: string | null;
  /**
   * עד 3 הסגמנטים האחרונים של הודעות המודל (כל flushMessage). סדר
   * כרונולוגי. משמש כקונטקסט ל-narrateToolCall.
   */
  recentMessages: string[];
  /** ה-cwd שנשלח ב-init. נשמר ל-metadata של הקלטות. */
  cwd: string | null;
  /** sessionId האקטיבי (אחרי handleInit). נשמר ל-metadata של הקלטות. */
  sessionId: string | null;
}

const states = new WeakMap<WebSocket, ConnState>();

// ── HTTP + WS server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    // upgrade ל-WebSocket
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return undefined; // הצליח
      return new Response("Upgrade failed", { status: 400 });
    }

    // API: GET /api/info?cwd=... → אילו מודלים זמינים + sessions קיימות
    if (url.pathname === "/api/info") {
      return handleApiInfo(url);
    }

    // API: GET /api/voices → רשימת קולות זמינים מ-ElevenLabs
    if (url.pathname === "/api/voices") {
      return handleApiVoices();
    }

    // API: POST /api/tts {text, voiceId?} → base64 MP3
    if (url.pathname === "/api/tts" && req.method === "POST") {
      return handleApiTts(req);
    }

    // API: GET /api/ls?path=<absolute> → רשימת תת-תיקיות (לבוחר התיקיות)
    if (url.pathname === "/api/ls") {
      return handleApiLs(url);
    }

    // הגשת קבצים סטטיים מ-frontend/
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      states.set(ws as any, {
        bridge: null,
        busy: false,
        firstPromptSent: false,
        voiceId: null,
        lastAgentMessage: null,
        lastUserText: null,
        recentMessages: [],
        cwd: null,
        sessionId: null,
      });
      console.log("[ws] חיבור חדש");
    },
    async message(ws, raw) {
      const state = states.get(ws as any);
      if (!state) return;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch (e) {
        sendError(ws, "JSON לא תקין");
        return;
      }

      try {
        await handleMessage(ws, state, msg);
      } catch (e) {
        console.error("[ws] שגיאה בטיפול בהודעה:", e);
        sendError(ws, String((e as Error).message ?? e));
      }
    },
    async close(ws) {
      const state = states.get(ws as any);
      if (state?.bridge) {
        await state.bridge.dispose().catch(() => {});
      }
      states.delete(ws as any);
      console.log("[ws] חיבור נסגר");
    },
  },
});

console.log(`שרת voice-acp רץ ב-http://localhost:${server.port}`);
console.log(`  GET  http://localhost:${server.port}/    → frontend`);
console.log(`  WS   ws://localhost:${server.port}/ws    → תקשורת קולית`);
console.log(
  `  recordings: ${recordingsEnabled ? "ON" : "OFF"} (${recordingsDir})`,
);
console.log(
  `  verbose:    ${VERBOSE ? "ON" : "OFF"} (set VOICE_ACP_VERBOSE=1 ל-stderr של opencode)`,
);

// ── טיפול בהודעות ────────────────────────────────────────────────────────────

async function handleMessage(
  ws: any,
  state: ConnState,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "init":
      await handleInit(ws, state, msg);
      break;

    case "audio":
      await handleAudio(ws, state, msg);
      break;

    case "text":
      // נתיב דיבוג — מדלגים על STT, ישר prompt
      await handleUserInput(ws, state, msg.text);
      break;

    case "cancel":
      if (state.bridge) {
        await state.bridge.cancel().catch(() => {});
      }
      break;

    default:
      sendError(ws, `סוג הודעה לא ידוע: ${(msg as any).type}`);
  }
}

async function handleInit(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "init" }>,
): Promise<void> {
  if (state.bridge) {
    sendError(ws, "כבר אותחל");
    return;
  }

  // שמירת voiceId + cwd לשימוש בכל ה-TTS וה-recordings של ה-session
  state.voiceId = msg.voice ?? null;
  state.cwd = msg.cwd;

  console.log(
    `[ws] init cwd=${msg.cwd} session=${msg.sessionId ?? "(new)"} voice=${state.voiceId ?? "(default)"}`,
  );
  state.bridge = await createAcpBridge({ cwd: msg.cwd, printAgentLogs: VERBOSE });

  let sessionResult;
  if (msg.sessionId) {
    // session קיימת — נטען עם streaming של היסטוריה ל-frontend.
    // ההיסטוריה כוללת את ה-system prompt, אז מסמנים כנשלח.
    state.firstPromptSent = true;
    send(ws, { type: "history_start" });

    // buffer לרינדור markdown של סגמנטים בהיסטוריה (כמו flushMessage ב-live)
    let historyMessageBuffer = "";
    const flushHistoryMessage = () => {
      const t = historyMessageBuffer.trim();
      historyMessageBuffer = "";
      if (!t) return;
      try {
        const html = renderMarkdown(t);
        send(ws, { type: "message_rendered", html, source: "history" });
      } catch (e) {
        console.error(`[ws] render history נכשל: ${(e as Error).message}`);
      }
    };

    sessionResult = await state.bridge.loadSession(msg.sessionId, {
      onChunk: (chunk, kind) => {
        send(ws, { type: "history_chunk", text: chunk, kind });
        if (kind === "message") {
          historyMessageBuffer += chunk;
        } else if (
          (kind === "thought" || kind === "user_message") &&
          historyMessageBuffer.length > 0
        ) {
          flushHistoryMessage();
        }
      },
      onToolCall: (event) => {
        send(ws, {
          type: "history_tool_call",
          event: event.event,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.toolKind,
          status: event.status,
        });
        if (event.event === "create" && historyMessageBuffer.length > 0) {
          flushHistoryMessage();
        }
      },
    });
    // flush סופי
    flushHistoryMessage();
    send(ws, { type: "history_done" });
  } else {
    sessionResult = await state.bridge.newSession();
  }

  // אם התבקש model ספציפי — הגדרה אחרי הקמת ה-session
  if (msg.model && msg.model !== sessionResult.currentModelId) {
    try {
      await state.bridge.setModel(msg.model);
      sessionResult.currentModelId = msg.model;
    } catch {
      sendError(ws, `לא ניתן להגדיר model=${msg.model}; נשאר עם ברירת המחדל`);
    }
  }

  state.sessionId = sessionResult.sessionId;

  send(ws, {
    type: "ready",
    sessionId: sessionResult.sessionId,
    availableModels: sessionResult.availableModels,
    currentModelId: sessionResult.currentModelId,
  });
}

async function handleAudio(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "audio" }>,
): Promise<void> {
  if (!state.bridge) {
    sendError(ws, "צריך לשלוח init קודם");
    return;
  }
  if (state.busy) {
    sendError(ws, "כבר בעיבוד הודעה אחרת");
    return;
  }

  // 0. שמירת הקלטה (אופציונלי, controlled by env). מתבצע ברקע במקביל
  //    ל-STT כדי לא להאריך את ה-latency של התגובה.
  const mimeType = msg.mimeType ?? "audio/webm";
  const recPromise = saveRecording(msg.data, mimeType, state.sessionId);

  // 1. STT: אודיו → טקסט
  console.log(`[ws] STT (${msg.data.length} chars base64)`);
  const transcript = await transcribeAudio(msg.data, {
    mimeType,
    previousResponse: state.lastAgentMessage ?? undefined,
  });
  send(ws, { type: "transcript", text: transcript });

  // השלמת שמירת ההקלטה ברקע + metadata עם transcript.
  // לא ממתינים — אסור שזה ידחה את ה-prompt או את ה-done.
  recPromise.then(async (info) => {
    if (!info) return;
    await saveRecordingMetadata(info, {
      timestamp: info.timestamp,
      sessionId: state.sessionId,
      cwd: state.cwd,
      mimeType,
      audioSize: Buffer.from(msg.data, "base64").byteLength,
      transcript,
      sttModel: "gemini-flash-latest",
    });
  });

  if (!transcript) {
    send(ws, { type: "done" });
    return;
  }

  await handleUserInput(ws, state, transcript);
}

async function handleUserInput(
  ws: any,
  state: ConnState,
  text: string,
): Promise<void> {
  if (!state.bridge) {
    sendError(ws, "אין session");
    return;
  }
  state.lastUserText = text;
  state.busy = true;

  try {
    // 2. אות "חושב" — צ'יים חד-פעמי ב-frontend
    send(ws, { type: "thinking" });

    // 3. prompt ל-ACP + streaming.
    //    ב-prompt הראשון של ה-session מזריקים system prompt כ-prefix.
    const isFirst = !state.firstPromptSent;
    const promptText = isFirst ? VOICE_SYSTEM_PROMPT + text : text;
    state.firstPromptSent = true;

    // TTS queue: כל קריאה ל-queueTts מוסיפה משימה לשרשרת. הסדר נשמר.
    // כך אפשר לקרוא TTS לקטעי הודעה ולכותרות כלים בזמן אמת,
    // והאודיו ינוגן ב-frontend לפי הסדר.
    let ttsQueue: Promise<void> = Promise.resolve();
    let totalMessageChars = 0;
    // streaming TTS: שולח audio_start → audio_chunk* → audio_end.
    // ה-frontend מנגן progressively (Media Source) או אוסף ומנגן בסוף (fallback).
    let streamCounter = 0;
    const streamTts = async (
      text: string,
      kind: "message" | "tool_title" | "thought",
    ): Promise<void> => {
      const streamId = `s${Date.now().toString(36)}-${streamCounter++}`;
      try {
        send(ws, { type: "audio_start", streamId, kind });
        await streamCachedTextToSpeech(
          text,
          { voiceId: state.voiceId ?? undefined },
          (chunk) => {
            send(ws, {
              type: "audio_chunk",
              streamId,
              data: Buffer.from(chunk).toString("base64"),
            });
          },
        );
        send(ws, { type: "audio_end", streamId });
      } catch (e) {
        console.error(`[ws] TTS streaming נכשל (${kind}): ${(e as Error).message}`);
        send(ws, { type: "audio_end", streamId });
      }
    };
    const queueTts = (text: string, kind: "message" | "tool_title") => {
      ttsQueue = ttsQueue.then(() => streamTts(text, kind));
    };

    // buffer מצטבר של chunks של "message" — מתפרק לקטעי TTS+render לפי גבולות.
    let messageBuffer = "";
    const flushMessage = () => {
      const t = messageBuffer.trim();
      messageBuffer = "";
      if (!t) return;
      totalMessageChars += t.length;
      // שמירת הקטע האחרון כקונטקסט ל-STT של ההודעה הבאה.
      // ה-flush האחרון מספיק — הוא הקטע שזכור למשתמש כשהוא מגיב.
      state.lastAgentMessage = t;
      // הוספה ל-recentMessages (FIFO, max 3) — קונטקסט ל-narrateToolCall.
      state.recentMessages.push(t);
      if (state.recentMessages.length > 3) state.recentMessages.shift();
      // רנדור markdown — נשלח לפני TTS כדי שהממשק יציג מיד את הגרסה היפה
      try {
        const html = renderMarkdown(t);
        send(ws, { type: "message_rendered", html, source: "live" });
      } catch (e) {
        console.error(`[ws] render נכשל: ${(e as Error).message}`);
      }
      console.log(`[ws] TTS message segment (${t.length} chars)`);
      queueTts(t, "message");
    };

    // thoughtBuffer מצטבר במקביל ל-messageBuffer.
    // flushThought: מתרגם דרך Gemini → שולח text_chunk thought_translation
    // → TTS עם kind "thought" (frontend מקשר ל-bubble המקורי של ה-thought).
    // אם התרגום נכשל (null) — דילוג מוחלט: אין text_chunk ואין TTS,
    // המשתמש יראה רק את המקור האנגלי בלי קול.
    let thoughtBuffer = "";
    const flushThought = () => {
      const t = thoughtBuffer.trim();
      thoughtBuffer = "";
      if (!t) return;
      console.log(`[ws] thought segment (${t.length} chars) → תרגום + TTS`);
      ttsQueue = ttsQueue.then(async () => {
        const hebrew = await translateThought(t);
        if (hebrew === null) {
          console.log(
            `[ws] thought translation failed — דילוג על TTS לסגמנט הזה`,
          );
          return;
        }
        send(ws, {
          type: "text_chunk",
          text: hebrew,
          kind: "thought_translation",
        });
        await streamTts(hebrew, "thought");
      });
    };

    console.log(`[ws] prompt (${isFirst ? "first" : "follow-up"}): ${text}`);
    // מונים לסיכום בסוף ה-prompt (debug)
    let cntMessage = 0;
    let cntThought = 0;
    let cntUser = 0;
    let toolCreates: Array<{ id: string; kind?: string; title: string }> = [];
    let toolUpdates = 0;
    await state.bridge.prompt(promptText, {
      onChunk: (chunk, kind) => {
        // user_message_chunk מגיע רק בהיסטוריה (loadSession), לא ב-prompt רגיל.
        if (kind === "user_message") {
          cntUser += chunk.length;
          return;
        }
        if (kind === "message") cntMessage += chunk.length;
        else if (kind === "thought") cntThought += chunk.length;
        send(ws, { type: "text_chunk", text: chunk, kind });
        if (kind === "message") {
          // אם הגיע thought לפני — הוא נגמר. flush אותו ל-תרגום+TTS.
          if (thoughtBuffer.length > 0) flushThought();
          messageBuffer += chunk;
          // חיתוך לפי גבול משפט — מאפשר התחלת TTS מהר ולא לחכות לסוף ההודעה.
          let boundary = findSentenceBoundary(messageBuffer);
          while (boundary !== -1) {
            const head = messageBuffer.slice(0, boundary);
            const rest = messageBuffer.slice(boundary);
            messageBuffer = head;
            flushMessage(); // שולח head, מאפס את messageBuffer ל-""
            messageBuffer = rest;
            boundary = findSentenceBoundary(messageBuffer);
          }
        } else if (kind === "thought") {
          // thought באמצע — flush של ה-message הנוכחי (לחלוקת בועות ב-frontend).
          if (messageBuffer.length > 0) flushMessage();
          thoughtBuffer += chunk;
          // חיתוך לפי גבול משפט — אנלוגי ל-message: מאפשר התחלת תרגום+TTS
          // של ה-thought מהר ולא לחכות לסוף ה-thought block.
          let boundary = findSentenceBoundary(thoughtBuffer);
          while (boundary !== -1) {
            const head = thoughtBuffer.slice(0, boundary);
            const rest = thoughtBuffer.slice(boundary);
            thoughtBuffer = head;
            flushThought(); // שולח head ל-תרגום+TTS, מאפס thoughtBuffer ל-""
            thoughtBuffer = rest;
            boundary = findSentenceBoundary(thoughtBuffer);
          }
        }
      },
      onToolCall: (event) => {
        if (event.event === "create") {
          toolCreates.push({
            id: event.toolCallId,
            kind: event.toolKind,
            title: event.title ?? "",
          });
          console.log(
            `[ws] tool_call create: kind=${event.toolKind ?? "?"} title="${event.title ?? "(empty)"}" status=${event.status ?? "?"}`,
          );
        } else {
          toolUpdates++;
          console.log(
            `[ws] tool_call update: id=${event.toolCallId.slice(0, 8)} status=${event.status ?? "?"}`,
          );
        }
        send(ws, {
          type: "tool_call",
          event: event.event,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.toolKind,
          status: event.status,
        });
        // tool create — לסגור גם message וגם thought שהיו פתוחים, ואז
        // נראציה דרך Gemini במקום הכותרת הגולמית.
        if (event.event === "create") {
          flushMessage();
          flushThought();
          const rawTitle = event.title?.trim();
          if (rawTitle) {
            console.log(`[ws] narrate tool (raw: ${rawTitle})`);
            // לוקחים snapshot של ההקשר ברגע ה-create — כדי שאם פעולות
            // נוספות מעדכנות recentMessages במקביל, הנראציה תייצג נכון
            // את המצב כש-ה-tool נקרא.
            const userMessage = state.lastUserText ?? "";
            const recentSnapshot = state.recentMessages.slice(-3);
            const toolForNarrate = {
              toolCallId: event.toolCallId,
              kind: event.toolKind,
              title: rawTitle,
            };
            ttsQueue = ttsQueue.then(async () => {
              let narrate = rawTitle;
              try {
                narrate = await narrateToolCall(
                  { userMessage, recentMessages: recentSnapshot },
                  toolForNarrate,
                );
              } catch (e) {
                console.error(`[ws] narrate נכשל: ${(e as Error).message}`);
              }
              await streamTts(narrate, "tool_title");
            });
          }
        }
      },
    });

    // סוף תור — flush של כל מה שנשאר ב-buffers
    flushMessage();
    flushThought();

    console.log(
      `[ws] סיכום prompt: message=${cntMessage}ch thought=${cntThought}ch user_msg=${cntUser}ch tools=${toolCreates.length}create+${toolUpdates}update`,
    );
    if (toolCreates.length > 0) {
      console.log(
        `[ws]   tools: ${toolCreates.map((t) => `${t.kind ?? "?"}/"${t.title}"`).join(", ")}`,
      );
    }

    if (totalMessageChars === 0) {
      // המודל לא הוציא message. ייתכן שזו שגיאת provider שopencode בלע.
      // ננסה לחלץ אותה מ-stderr של ה-acp child.
      const stderrLines = state.bridge.getRecentStderr();
      const providerError = extractProviderError(stderrLines);
      if (providerError) {
        console.log(`[ws] תשובה ריקה — שגיאת provider: ${providerError}`);
        sendError(ws, `שגיאת provider: ${providerError}`);
      } else if (cntThought > 0 || toolCreates.length > 0) {
        console.log(
          `[ws] תשובה ריקה — היו thoughts/tools (${cntThought}ch, ${toolCreates.length}t)`,
        );
        sendError(
          ws,
          "המודל ביצע פעולות אבל לא חזר עם תשובה מילולית. נסי לבקש סיכום.",
        );
      } else {
        console.log(`[ws] תשובה ריקה — מדלגים על TTS`);
        sendError(ws, "המודל לא ענה. נסי לנסח את השאלה אחרת.");
      }
    }

    // לא מחכים ל-ttsQueue להסתיים לפני "done" —
    // ה-frontend מטפל בתור הניגון בעצמו ו-audio_ready ימשיכו להגיע.
    send(ws, { type: "done" });
  } finally {
    state.busy = false;
  }
}

// ── עזרים ────────────────────────────────────────────────────────────────────

function send(ws: any, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function sendError(ws: any, message: string): void {
  send(ws, { type: "error", message });
}

/**
 * GET /api/info?cwd=<path>
 *
 * spawns opencode זמני, מוציא רשימת מודלים זמינים + sessions קיימות, וסוגר.
 * עלות: ~3-5 שניות לכל קריאה (overhead של opencode).
 */
async function handleApiInfo(url: URL): Promise<Response> {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) {
    return Response.json({ error: "חסר פרמטר cwd" }, { status: 400 });
  }

  let bridge: AcpBridge | null = null;
  try {
    bridge = await createAcpBridge({ cwd });
    // יוצרים session זמני רק כדי לקבל את ה-availableModels
    const tempSession = await bridge.newSession();
    // ננסה לטעון sessions קיימות (אם הסוכן תומך)
    const sessions = await bridge.listSessions().catch(() => []);

    return Response.json({
      cwd,
      availableModels: tempSession.availableModels ?? [],
      currentModelId: tempSession.currentModelId ?? null,
      sessions,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  } finally {
    await bridge?.dispose().catch(() => {});
  }
}

/**
 * GET /api/voices → רשימת קולות זמינים מ-ElevenLabs.
 * מחזיר רק שדות שימושיים, ומסמן קולות שתומכים עברית.
 */
async function handleApiVoices(): Promise<Response> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": "placeholder", // OneCLI מזריק את האמיתי
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      return Response.json(
        { error: `ElevenLabs error ${res.status}` },
        { status: 502 },
      );
    }
    const data: any = await res.json();
    const voices = (data?.voices ?? []).map((v: any) => {
      const langs = (v.verified_languages ?? []).map(
        (l: any) => l.language ?? l.language_id,
      );
      return {
        voiceId: v.voice_id,
        name: v.name,
        category: v.category, // premade / cloned / generated / professional
        description: v.description ?? null,
        languages: langs,
        supportsHebrew: langs.includes("he") || (v.labels?.language === "he"),
      };
    });
    // מיון: ברירת מחדל ראשון, אחר-כך תומכי עברית, אחר-כך premade, ואז שאר
    const defaultId = process.env.ELEVENLABS_VOICE_ID ?? "";
    voices.sort((a: any, b: any) => {
      if (a.voiceId === defaultId) return -1;
      if (b.voiceId === defaultId) return 1;
      if (a.supportsHebrew !== b.supportsHebrew) {
        return a.supportsHebrew ? -1 : 1;
      }
      const order = { premade: 0, professional: 1, cloned: 2, generated: 3 };
      const ao = order[a.category as keyof typeof order] ?? 9;
      const bo = order[b.category as keyof typeof order] ?? 9;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    return Response.json({
      defaultVoiceId: defaultId || null,
      voices,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/tts
 * Body: { text, voiceId? }
 * → { data: <base64 MP3> }
 *
 * משמש להשמעה lazy של בועות היסטוריה. עובר דרך cache, אז קריאה חוזרת
 * לאותו טקסט+voice מחזירה מיד.
 */
async function handleApiTts(req: Request): Promise<Response> {
  let body: { text?: string; voiceId?: string };
  try {
    body = (await req.json()) as { text?: string; voiceId?: string };
  } catch {
    return Response.json({ error: "JSON לא תקין" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "חסר text" }, { status: 400 });
  }
  try {
    const data = await cachedTextToSpeechBase64(text, {
      voiceId: body.voiceId,
    });
    return Response.json({ data });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ls?path=<absolute>&showHidden=1
 * רשימת תת-תיקיות בנתיב נתון. מסנן קבצים, מציג רק תיקיות.
 *
 * סייגי ביטחון: רק תחת `$HOME` או `/tmp`. dot-folders מסוננים כברירת מחדל.
 */
async function handleApiLs(url: URL): Promise<Response> {
  const path = url.searchParams.get("path") ?? "";
  const showHidden = url.searchParams.get("showHidden") === "1";
  const home = process.env.HOME ?? "/home/user";

  if (!path.startsWith("/")) {
    return Response.json(
      { error: "path חייב להיות absolute" },
      { status: 400 },
    );
  }
  // ביטחון: רק תחת home או /tmp
  const allowed = [home, "/tmp"];
  const isAllowed = allowed.some(
    (root) => path === root || path.startsWith(root + PATH_SEP),
  );
  if (!isAllowed) {
    return Response.json(
      { error: `path מחוץ לטווח המותר (מותר רק תחת ${home} או /tmp)` },
      { status: 403 },
    );
  }

  try {
    const entries = await readdir(path, { withFileTypes: true });
    const dirs = entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        if (!showHidden && e.name.startsWith(".")) return false;
        return true;
      })
      .map((e) => ({ name: e.name, type: "directory" as const }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    // parent מותר רק אם הוא בתוך הטווח המותר
    let parent: string | null = path === "/" ? null : dirname(path);
    if (parent) {
      const parentAllowed = allowed.some(
        (root) => parent === root || parent!.startsWith(root + PATH_SEP),
      );
      if (!parentAllowed) parent = null;
    }

    return Response.json({
      path,
      parent,
      home,
      entries: dirs,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  // הגנת path traversal — לאשר רק שמות סבירים
  if (pathname.includes("..") || pathname.includes("\0")) {
    return new Response("Bad request", { status: 400 });
  }

  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(FRONTEND_DIR, "." + relative);

  // לוודא שהקובץ באמת תחת FRONTEND_DIR (הגנת escaping)
  if (!filePath.startsWith(FRONTEND_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file);
}
