export function buildTranslationPrompt(text: string, targetLang: "he" | "en"): string {
  if (targetLang === "he") {
    return `תרגם את הטקסט הבא לעברית טבעית ושוטפת, ללא הסברים. אם הטקסט כבר בעברית — החזר אותו כמו שהוא.\n\nטקסט:\n${text}`
  }
  return `Translate to natural fluent English, no explanations. If already English, return as-is.\n\nText:\n${text}`
}
