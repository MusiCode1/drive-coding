declare global {
  namespace App {}
}

export {}

// slice debug-surface: קבוע-בילד (‏vite `define`). true בכל FE_ENV שאינו prod.
// ⚠️ חייב להיות define ולא env — ‏$env/dynamic נקרא בזמן-ריצה ואינו ניתן-לגזימה.
declare const __DC_ENABLED__: boolean
