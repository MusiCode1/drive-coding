declare global {
  namespace App {}

  // slice debug-surface: קבוע-בילד (‏vite `define`). true בכל FE_ENV שאינו prod.
  // ⚠️ חייב להיות define ולא env — ‏$env/dynamic נקרא בזמן-ריצה ואינו ניתן-לגזימה.
  // ⚠️ חייב לשבת **בתוך** `declare global`: הקובץ הוא מודול (יש בו `export {}`),
  // ולכן הצהרה בשורש שלו מקומית-למודול ואינה גלובלית — ‏+layout.svelte קיבל
  // "Cannot find name '__DC_ENABLED__'".
  const __DC_ENABLED__: boolean
}

export {}
