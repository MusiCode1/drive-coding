/**
 * elicitation.ts — טיפוסי view + מיפוי `requestedSchema.properties` → שדות-form לרינדור.
 *
 * לוגיקה טהורה (ללא IO/DOM).
 * מחקה את permission.ts (mapPermissionOptions) — התשתית המשותפת שA1 הניחה.
 */
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
} from "@agentclientprotocol/sdk"

/** נגזר מ-SDK — לא shape מותאם; drift אפס. */
export type ElicitationParams = CreateElicitationRequest
export type ElicitationResponse = CreateElicitationResponse

export type ElicitationFieldKind = "text" | "select" | "boolean" | "number"

export type ElicitationFieldOption = {
  value: string
  label: string
}

export type ElicitationFieldView = {
  key: string
  kind: ElicitationFieldKind
  label: string
  required: boolean
  /** אפשרויות בחירה — רק כש-kind==="select" (string+enum/oneOf). */
  options?: ElicitationFieldOption[]
}

/**
 * מזהה form-mode (יש `requestedSchema`). `mode:"url"` וmodes מותאמים-אישית אינם ב-scope
 * (§2 — form בלבד ב-MVP; url דורש `elicitation/complete` notification, future).
 */
export function isFormElicitation(
  params: ElicitationParams,
): params is Extract<ElicitationParams, { mode: "form" }> {
  return params.mode === "form"
}

/**
 * מיפוי `requestedSchema.properties` → רשימת שדות-view לרינדור, לפי סדר המפתחות
 * ב-properties (סדר-הכנסה של Object.entries — תואם ל-JSON שהגיע מהסוכן).
 *
 * ⚠️ enum אינו `type` נפרד (finding אביגיל, §4 Commit 1): `type==="string"` עם
 * `enum`/`oneOf` נוכח → Select. `type==="string"` בלי enum/oneOf → text.
 * `type==="number"/"integer"` → number. `type==="boolean"` → checkbox.
 * טיפוסים לא-נתמכים (array/multi-select, custom) מדולגים — nested/array-of-object
 * מחוץ ל-scope (§2, future).
 */
export function mapElicitationFields(schema: ElicitationSchema): ElicitationFieldView[] {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const fields: ElicitationFieldView[] = []

  for (const [key, prop] of Object.entries(properties)) {
    const field = mapProperty(key, prop, required.has(key))
    if (field) fields.push(field)
  }
  return fields
}

function propTitle(prop: ElicitationPropertySchema): string | null | undefined {
  return "title" in prop && typeof prop.title === "string" ? prop.title : undefined
}

function mapProperty(
  key: string,
  prop: ElicitationPropertySchema,
  required: boolean,
): ElicitationFieldView | null {
  const label = propTitle(prop) ?? key

  if (prop.type === "string") {
    // ⚠️ SDK union quirk: control-flow narrowing על `type === "string"` לא מסלק את
    // ענף ה-custom (`type: string` רחב, `[key: string]: unknown`) מהטיפוס המצומצם —
    // ולכן `prop.enum`/`prop.oneOf` היו נשארים `unknown`. `Extract<>` (מבוסס
    // assignability, לא control-flow) כן מסלק אותו נכון — cast מקומי בטוח.
    const stringProp = prop as Extract<ElicitationPropertySchema, { type: "string" }>
    const options = mapEnumOptions(stringProp.enum, stringProp.oneOf)
    if (options) {
      return { key, kind: "select", label, required, options }
    }
    return { key, kind: "text", label, required }
  }
  if (prop.type === "number" || prop.type === "integer") {
    return { key, kind: "number", label, required }
  }
  if (prop.type === "boolean") {
    return { key, kind: "boolean", label, required }
  }
  // array (multi-select) / custom type — מחוץ ל-scope (§2), מדולג.
  return null
}

/** enum (untitled) / oneOf (titled) — אחד מהם נוכח → Select. אחרת undefined → text. */
function mapEnumOptions(
  enumValues: ReadonlyArray<string> | null | undefined,
  oneOf: ReadonlyArray<{ const: string; title: string }> | null | undefined,
): ElicitationFieldOption[] | undefined {
  if (oneOf && oneOf.length > 0) {
    return oneOf.map((o) => ({ value: o.const, label: o.title }))
  }
  if (enumValues && enumValues.length > 0) {
    return enumValues.map((v) => ({ value: v, label: v }))
  }
  return undefined
}
