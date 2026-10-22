import { defineConfig } from "@playwright/test"

/**
 * 🛑 `workers: 1` ו-`fullyParallel: false` במכוון: ל-BE יש state משותף
 * (סשנים מצטברים), והרצה מקבילית הייתה מסתירה באגי-מקביליות ולא חושפת אותם.
 * זהו אותו נימוק שמתועד ב-`tests/smoke/run-all.mjs`.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 1,
  // הרמת BE + בניית FE + spawn של סוכן — נדיב בכוונה.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
})
