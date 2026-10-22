/**
 * index.ts — ה-`test` של החליפה: BE + כרום-בקונטיינר כ-fixtures ברמת worker,
 * ודף טרי לכל בדיקה.
 *
 * 🛑 `browser.newContext()` על חיבור CDP אינו נתמך בכל הגרסאות, ולכן אנחנו
 * משתמשים בהקשר ברירת-המחדל (כמו `tests/smoke/playlist-nav-chrome.mjs`) ופותחים
 * **דף** חדש לכל בדיקה. הבידוד מגיע מכך שהמופע עצמו טרי וחד-פעמי.
 *
 * ⇒ אין `baseURL` ברמת ההקשר. בדיקות מנווטות דרך `app.baseURL` במפורש.
 */
import { test as base, expect, type Page } from "@playwright/test"
import { startApp, type AppTarget } from "./app.ts"
import { launchContainerChrome, type ContainerChrome } from "./container-chrome.ts"

type WorkerFixtures = {
  app: AppTarget
  chrome: ContainerChrome
}

type TestFixtures = {
  /** שגיאות קונסול ושגיאות-דף שנצטברו מרגע פתיחת הדף. */
  consoleErrors: string[]
  page: Page
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  app: [
    async ({}, use) => {
      const app = await startApp()
      await use(app)
      await app.dispose()
    },
    { scope: "worker" },
  ],

  chrome: [
    async ({}, use) => {
      const chrome = await launchContainerChrome()
      await use(chrome)
      await chrome.dispose()
    },
    { scope: "worker" },
  ],

  consoleErrors: async ({}, use) => {
    await use([])
  },

  page: async ({ chrome, consoleErrors }, use) => {
    const context = chrome.browser.contexts()[0] ?? (await chrome.browser.newContext())
    const page = await context.newPage()

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`)
    })
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`))

    await use(page)
    await page.close()
  },
})

export { expect }
