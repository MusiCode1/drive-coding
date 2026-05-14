/**
 * ACP Bridge — מגשר בין הbackend לבין opencode acp.
 *
 * הbackend הוא ה-Client; opencode הוא ה-Agent. תקשורת ב-JSON-RPC על stdin/stdout.
 *
 * שימוש בסיסי:
 *   const bridge = await createAcpBridge({ cwd: "/path/to/workspace" });
 *   const { sessionId } = await bridge.newSession();
 *   await bridge.prompt(sessionId, "what files are here?", (chunk) => console.log(chunk));
 *   bridge.dispose();
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ToolCallStatus,
  type ToolKind,
} from "@agentclientprotocol/sdk";

/**
 * callback שמופעל עבור כל chunk טקסטואלי שמגיע מהמודל.
 * - "message": תשובת המודל (אמורה לעבור ל-TTS)
 * - "thought": reasoning פנימי (לא מוקרא)
 * - "user_message": הודעת משתמש (מגיע רק במהלך טעינת היסטוריה של session קיימת)
 */
export type ChunkHandler = (
  text: string,
  kind: "message" | "thought" | "user_message",
) => void;

/** מידע על tool call שמועבר ל-handler. */
export interface ToolCallEvent {
  /** מזהה ייחודי של ה-tool call בתוך ה-session. */
  toolCallId: string;
  /** כותרת קריאה לקריאת אדם (למשל "Read file README.md"). */
  title: string;
  /** הסוג של הכלי — read/edit/search/execute/think/... */
  toolKind?: ToolKind;
  /** מצב הביצוע. ב-update הראשון לרוב `pending`/`in_progress`, ובסוף `completed`/`failed`. */
  status?: ToolCallStatus;
  /** האם זו יצירת tool call חדש (`create`) או עדכון של קיים (`update`). */
  event: "create" | "update";
}

export type ToolCallHandler = (event: ToolCallEvent) => void;

/** opts לפונקציית prompt. */
export interface PromptOptions {
  onChunk?: ChunkHandler;
  onToolCall?: ToolCallHandler;
}

export interface AcpBridgeOptions {
  /** תיקיית עבודה לסשן. חובה. */
  cwd: string;
  /** path ל-opencode binary. ברירת מחדל: `opencode` ב-PATH. */
  opencodeBin?: string;
  /** האם להדפיס לוגים של opencode ל-stderr של הbackend. ברירת מחדל: false. */
  printAgentLogs?: boolean;
}

/** מידע על מודל זמין. */
export interface ModelInfoLite {
  modelId: string;
  name: string;
  description?: string;
}

/** מידע על session קיימת ב-cwd. */
export interface SessionInfoLite {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
}

/** מידע שמוחזר מ-`newSession`/`loadSession`. */
export interface SessionResult {
  sessionId: string;
  availableModels?: ModelInfoLite[];
  currentModelId?: string;
}

export interface AcpBridge {
  /** ה-session ID של ה-session הפעיל (אם נוצרה). */
  sessionId: string | null;
  /**
   * מחזיר עד N שורות אחרונות של stderr של opencode acp. שימושי לדיאגנוסטיקה
   * כשתוצאה ריקה — לעתים opencode בולע שגיאות provider (כמו "credit balance
   * too low") ומחזיר stopReason=end_turn בלי לעדכן את ה-client.
   */
  getRecentStderr(): string[];
  /** יצירת session חדשה. */
  newSession(): Promise<SessionResult>;
  /**
   * טעינת session קיימת לפי id.
   * אם מועברים callbacks — הם יקבלו את כל אירועי ההיסטוריה ש-opencode משחזר
   * (user/agent chunks, thoughts, tool calls).
   */
  loadSession(sessionId: string, opts?: PromptOptions): Promise<SessionResult>;
  /** רשימת sessions קיימות (אם הסוכן תומך). */
  listSessions(): Promise<SessionInfoLite[]>;
  /** הגדרת המודל ל-session הפעיל (UNSTABLE — לא בטוח שנתמך). */
  setModel(modelId: string): Promise<void>;
  /**
   * שליחת prompt וקבלת תשובת המודל ב-streaming.
   * @param text     - הטקסט של המשתמש
   * @param opts     - callbacks: onChunk לטקסט, onToolCall ל-tool calls
   * @returns        - הטקסט המלא של תשובת המודל (מצטבר)
   */
  prompt(text: string, opts?: PromptOptions): Promise<string>;
  /** ביטול prompt פעיל. */
  cancel(): Promise<void>;
  /** סגירת התהליך. */
  dispose(): Promise<void>;
}

/**
 * יוצר Bridge ל-opencode acp.
 * spawns את התהליך, מבצע handshake, ומחזיר אובייקט עם מתודות.
 */
export async function createAcpBridge(
  opts: AcpBridgeOptions,
): Promise<AcpBridge> {
  const opencodeBin = opts.opencodeBin ?? "opencode";

  // ה-cwd שאנחנו רוצים לעבוד עליו עובר ב-newSession; את התהליך עצמו מריצים מ-cwd
  // הנוכחי (לא משנה כי הוא מקשיב לבקשות).
  // stderr תמיד pipe — אנחנו רוצים לקרוא אותו (גם לבליעה וגם לתפיסת errors).
  // אם printAgentLogs=true — נוסיף --print-logs ל-opencode ונעביר את ה-stderr
  // ל-stderr שלנו תוך תפיסה במקביל.
  const proc: ChildProcessByStdio<Writable, Readable, Readable> = spawn(
    opencodeBin,
    ["acp", ...(opts.printAgentLogs ? ["--print-logs"] : [])],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  ) as any;

  // Ring buffer של 100 השורות האחרונות של stderr — לדיאגנוסטיקה במצב error.
  const STDERR_BUFFER_SIZE = 100;
  const stderrBuffer: string[] = [];
  let stderrLineFrag = "";
  proc.stderr.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (opts.printAgentLogs) {
      process.stderr.write(text);
    }
    stderrLineFrag += text;
    const lines = stderrLineFrag.split("\n");
    stderrLineFrag = lines.pop() ?? "";
    for (const line of lines) {
      stderrBuffer.push(line);
      if (stderrBuffer.length > STDERR_BUFFER_SIZE) {
        stderrBuffer.shift();
      }
    }
  });

  // המרת Node streams ל-Web streams (נדרש ע"י ndJsonStream)
  const writableStdin = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
  const readableStdout = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;

  const stream = ndJsonStream(writableStdin, readableStdout);

  // state מצטבר לפי prompt; מתאפס בכל prompt חדש
  let currentChunkHandler: ChunkHandler | null = null;
  let currentToolCallHandler: ToolCallHandler | null = null;
  let accumulatedText = "";
  let accumulatedThought = "";

  const clientHandler: Client = {
    async sessionUpdate(params: SessionNotification): Promise<void> {
      const update = params.update;

      // chunk טקסטואלי — תשובה / מחשבה / הודעת משתמש (היסטוריה)
      if (
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk" ||
        update.sessionUpdate === "user_message_chunk"
      ) {
        const content = update.content;
        if (content.type === "text") {
          let kind: "message" | "thought" | "user_message";
          if (update.sessionUpdate === "agent_message_chunk") kind = "message";
          else if (update.sessionUpdate === "agent_thought_chunk") kind = "thought";
          else kind = "user_message";

          // מצטברים רק את ה-message text (מקור ה-TTS).
          // user_message ו-thought לא רלוונטיים לתשובה הסופית.
          if (kind === "message") accumulatedText += content.text;
          else if (kind === "thought") accumulatedThought += content.text;

          currentChunkHandler?.(content.text, kind);
        }
        return;
      }

      // tool call — יצירה
      if (update.sessionUpdate === "tool_call") {
        currentToolCallHandler?.({
          event: "create",
          toolCallId: update.toolCallId,
          title: update.title,
          toolKind: update.kind,
          status: update.status,
        });
        return;
      }

      // tool call — עדכון (בדרך-כלל מ-pending ל-in_progress ל-completed)
      if (update.sessionUpdate === "tool_call_update") {
        currentToolCallHandler?.({
          event: "update",
          toolCallId: update.toolCallId,
          // ב-update title יכול להיות חסר; נשאיר ריק אם כך
          title: update.title ?? "",
          toolKind: update.kind ?? undefined,
          status: update.status ?? undefined,
        });
        return;
      }
      // plan / mode_update / config_option_update / session_info_update — נתעלם
    },

    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      // YOLO mode — מאשרים אוטומטית.
      // עדיפות: allow_always > allow_once > הראשונה הזמינה.
      const options = params.options ?? [];
      const preferred =
        options.find((o) => o.kind === "allow_always") ??
        options.find((o) => o.kind === "allow_once") ??
        options[0];

      if (!preferred) {
        return {
          outcome: { outcome: "cancelled" },
        };
      }
      return {
        outcome: { outcome: "selected", optionId: preferred.optionId },
      };
    },
  };

  const conn = new ClientSideConnection((_agent: Agent) => clientHandler, stream);

  // handshake — protocolVersion הוא מספר (1), לא מחרוזת.
  const initResult = await conn.initialize({
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "voice-acp", version: "0.1.0" },
  });
  const agentCaps = initResult.agentCapabilities;

  let sessionId: string | null = null;

  function extractSessionResult(res: any): SessionResult {
    const models = res?.models;
    const availableModels = models?.availableModels?.map((m: any) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description ?? undefined,
    }));
    return {
      sessionId: res.sessionId,
      availableModels,
      currentModelId: models?.currentModelId,
    };
  }

  const bridge: AcpBridge = {
    get sessionId() {
      return sessionId;
    },

    getRecentStderr() {
      return [...stderrBuffer];
    },

    async newSession() {
      const res = await conn.newSession({
        cwd: opts.cwd,
        mcpServers: [],
      });
      sessionId = res.sessionId;
      return extractSessionResult(res);
    },

    async loadSession(id: string, promptOpts?: PromptOptions) {
      // ה-handlers נכנסים לתוקף לפני הקריאה כדי לתפוס את אירועי ההיסטוריה
      // ש-opencode משחזר במהלך loadSession.
      currentChunkHandler = promptOpts?.onChunk ?? null;
      currentToolCallHandler = promptOpts?.onToolCall ?? null;
      accumulatedText = "";
      accumulatedThought = "";

      try {
        const res: any = await conn.loadSession({
          sessionId: id,
          cwd: opts.cwd,
          mcpServers: [],
        } as any);
        sessionId = res?.sessionId ?? id;
        return extractSessionResult({ ...res, sessionId });
      } finally {
        currentChunkHandler = null;
        currentToolCallHandler = null;
        accumulatedText = "";
        accumulatedThought = "";
      }
    },

    async listSessions() {
      if (!agentCaps?.sessionCapabilities?.list) return [];
      const res: any = await conn.listSessions({} as any);
      const sessions = res?.sessions ?? [];
      return sessions.map((s: any) => ({
        sessionId: s.sessionId,
        cwd: s.cwd ?? undefined,
        title: s.title ?? undefined,
        updatedAt: s.updatedAt ?? undefined,
      }));
    },

    async setModel(modelId: string) {
      if (!sessionId) throw new Error("אין session פעיל");
      try {
        await (conn as any).unstable_setSessionModel({ sessionId, modelId });
      } catch (e) {
        // ייתכן שהסוכן לא תומך
        console.error(`[acp] setModel נכשל: ${(e as Error).message}`);
        throw e;
      }
    },

    async prompt(text: string, opts?: PromptOptions) {
      if (!sessionId) {
        throw new Error("אין session פעיל — קרא ל-newSession() או loadSession() קודם.");
      }
      currentChunkHandler = opts?.onChunk ?? null;
      currentToolCallHandler = opts?.onToolCall ?? null;
      accumulatedText = "";
      accumulatedThought = "";

      try {
        const res = await conn.prompt({
          sessionId,
          prompt: [{ type: "text", text }],
        });
        if (res.stopReason && res.stopReason !== "end_turn") {
          console.error(`[acp] prompt הסתיים עם stopReason=${res.stopReason}`);
        }
      } finally {
        currentChunkHandler = null;
        currentToolCallHandler = null;
      }
      // הערה: אם accumulatedText ריק אבל יש thought, זה אומר שהמודל "חשב את
      // התשובה" בלי לכתוב אותה כ-message. אין fallback ל-thought כי הוא
      // reasoning פנימי ולא תשובה למשתמש.
      return accumulatedText;
    },

    async cancel() {
      if (!sessionId) return;
      await conn.cancel({ sessionId });
    },

    async dispose() {
      try {
        proc.stdin.end();
      } catch {}
      proc.kill("SIGTERM");
      // ממתינים שיסיים, או SIGKILL אחרי 2 שניות
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 2000);
        proc.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };

  return bridge;
}

// CLI entrypoint — בדיקה עצמאית:
//   bun src/acp-bridge.ts <cwd> "שאלה למודל"
if (import.meta.main) {
  const cwd = process.argv[2];
  const question = process.argv[3];

  if (!cwd || !question) {
    console.error('שימוש: bun src/acp-bridge.ts <cwd> "<שאלה>"');
    process.exit(1);
  }

  console.log(`cwd: ${cwd}`);
  console.log(`שאלה: ${question}`);
  console.log("---");

  const bridge = await createAcpBridge({ cwd, printAgentLogs: false });
  try {
    const { sessionId } = await bridge.newSession();
    console.log(`session: ${sessionId}`);
    console.log("---");

    const start = Date.now();
    const reply = await bridge.prompt(question, {
      onChunk: (chunk, kind) => {
        if (kind === "thought") {
          process.stderr.write(`\x1b[2m${chunk}\x1b[0m`);
        } else {
          process.stdout.write(chunk);
        }
      },
      onToolCall: (event) => {
        const arrow = event.event === "create" ? "+" : "→";
        process.stderr.write(
          `\n\x1b[33m[${arrow} ${event.toolKind ?? "?"}] ${event.title} (${event.status ?? "?"})\x1b[0m\n`,
        );
      },
    });
    const elapsed = Date.now() - start;
    console.log(`\n---\n(${elapsed}ms, ${reply.length} chars)`);
  } finally {
    await bridge.dispose();
  }
}
