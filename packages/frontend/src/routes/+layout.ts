// רק SPA (אפליקציית עמוד יחיד) — משתמש ב-adapter-static + ממשקי voice/audio שלא קיימים ב-SSR.
// כל הניווט הוא בצד לקוח (client-side). מונע גישה בזמן SSR ל-window ול-localStorage.

export const ssr = false
export const prerender = false
export const csr = true
