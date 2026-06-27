// packages/core/src/acp/index.ts — רק התת-קבוצה חסרת-contract/ שנצרכת
export { createAcpClient } from "./client/client.js"
export type { AcpClient, AcpClientOptions } from "./client/client.js"
export type { AcpTransport } from "./transport.js"
export { describeCrash } from "./describe-crash.js"
export type { BridgeCrashInfo } from "./describe-crash.js"
