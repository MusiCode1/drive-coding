// בחירת לוגו המותג לפי ה-deployment, על אותו ציר dev/main הקיים:
//   dev  → נבנה עם `vite build --mode development` → MODE !== "production" → ember (כתום)
//   main → נבנה עם `vite build` (production)        → MODE === "production" → blue  (כחול)
// זהה למנגנון שמבדיל dev/main במקומות אחרים (למשל mock fixtures ב-routes/+page.svelte),
// כך שאין צורך ב-env var נוסף או בשינוי בהגדרות ה-systemd/deploy.
import emberLogo from "./drivecoding-dev.svg"
import blueLogo from "./drivecoding-main.svg"

/** "dev" בכל build שאינו production, אחרת "main". */
export const deployChannel: "dev" | "main" =
  import.meta.env.MODE === "production" ? "main" : "dev"

/** URL ללוגו המתאים ל-deployment הנוכחי (ember ב-dev, blue ב-main). */
export const brandLogo: string = deployChannel === "main" ? blueLogo : emberLogo
