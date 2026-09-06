/**
 * FS browse registration with optional WebDAV gate (tzlev remote / sibling).
 */
import type { Hono } from "hono"
import {
  registerFsBrowseHttp as registerLocalFsBrowseHttp,
  registerProjectsHttp,
  registerRecordingsHttp,
  registerRecordingsPostHttp,
} from "./http-history.js"
import { registerWebdavBrowseGate } from "./webdav-browse-http.js"

export { registerProjectsHttp, registerRecordingsHttp, registerRecordingsPostHttp }

export function registerFsBrowseHttp(
  app: Hono,
  opts: Parameters<typeof registerLocalFsBrowseHttp>[1] = {},
): void {
  registerWebdavBrowseGate(app)
  registerLocalFsBrowseHttp(app, opts)
}
