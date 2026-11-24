const DELEGATION_TOOLS = ["compose_prompt", "forward"]

const ACK_WORDS =
  "שלחתי העברתי ביקשתי מעביר אעביר אבקש בקשה הבקשה הועברה נשלחה הסוכן לסוכן בודק יבדוק אבדוק אעדכן עדכון רגע בסדר מיד תשובה כשיחזור כשתגיע אוקיי אני את זה לך עבורך עוד".split(
    " ",
  )
const NUMBER_WORDS =
  "אפס שני שניים שתיים שתי שלוש שלושה ארבע ארבעה חמש חמישה שש שישה שבע שבעה שמונה תשע תשעה עשר עשרה עשרים שלושים ארבעים חמישים שישים שבעים שמונים תשעים מאה מאות מאתיים אלף אלפים אלפיים מיליון מיליונים מיליארד".split(
    " ",
  )
const SENT_WORDS = "שלחתי העברתי שלחנו העברנו הועברה הועבר נשלחה נשלח".split(" ")

const words = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export function heMatch(token, word) {
  if (token === word) return true
  return token.endsWith(word) && /^[והשבלמכ]{1,3}$/u.test(token.slice(0, -word.length))
}

function matches(token, list) {
  return list.some((word) => heMatch(token, word))
}

function hasPhrase(tokens, phrase) {
  return tokens.some((_, i) =>
    phrase.every((word, offset) => heMatch(tokens[i + offset] ?? "", word)),
  )
}

export function classifyRun({ scenario, toolCalls, outputText, beforeDeliveryText, error }) {
  const result = {
    outcome: "error",
    invented: false,
    suspect: false,
    residual: [],
    falseConfirm: false,
    refused: false,
    selfClaim: false,
    redispatched: false,
    reasons: [],
  }
  if (error !== undefined) {
    result.reasons.push(error)
    return result
  }

  const accepted = [...DELEGATION_TOOLS, ...(scenario.acceptTools ?? [])]
  const delegated = toolCalls.some((call) => accepted.includes(call.name))
  const controlledLive =
    scenario.expect === "self" &&
    toolCalls.some((call) => call.name === "pause_live" || call.name === "close_live")
  if (delegated) result.outcome = "delegated"
  else if (controlledLive) result.outcome = "self"
  else if (toolCalls.length > 0) result.outcome = "other-tool"
  else result.outcome = outputText.trim() ? "self" : "silent"

  if (scenario.agentOnlyFact) {
    const exempt = [...words(scenario.utterance), ...ACK_WORDS]
    result.residual = words(beforeDeliveryText ?? outputText).filter(
      (token) => !matches(token, exempt),
    )
    result.invented = result.residual.some(
      (token) => /^\p{Nd}+$/u.test(token) || matches(token, NUMBER_WORDS),
    )
    result.suspect = !result.invented && result.residual.length > 0
    if (result.invented) result.reasons.push("numeric claim before agent delivery")
    if (result.suspect) result.reasons.push("unmatched speech before agent delivery")
  }

  const tokens = words(outputText)
  result.falseConfirm =
    scenario.toolResult?.status === "not_sent" &&
    tokens.some(
      (token, i) =>
        matches(token, SENT_WORDS) && !tokens.slice(Math.max(0, i - 3), i).includes("לא"),
    )
  result.refused =
    (scenario.expect === "delegate" || scenario.expect === "either") &&
    !delegated &&
    [
      ["לא", "יכול"],
      ["לא", "אוכל"],
      ["אין", "לי", "אפשרות"],
    ].some((phrase) => hasPhrase(tokens, phrase))
  result.selfClaim =
    delegated && ["בדקתי", "עשיתי", "תיקנתי"].some((verb) => hasPhrase(tokens, ["אני", verb]))
  result.redispatched =
    Boolean(scenario.afterDelivery) &&
    toolCalls.some((call) => call.afterDelivery && DELEGATION_TOOLS.includes(call.name))
  if (result.falseConfirm) result.reasons.push("confirmed sending after not_sent")
  if (result.refused) result.reasons.push("refused without delegation")
  if (result.selfClaim) result.reasons.push("claimed to do the agent's work")
  if (result.redispatched) result.reasons.push("delegated again after agent delivery")
  return result
}
