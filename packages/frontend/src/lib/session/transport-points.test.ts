import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  readProductionSources,
  type SourceFile,
  visitSource,
} from "./source-policy.test-support.js"

const session = "lib/session/"
const transportConfig = `${session}session-transport.ts`
const branchPaths = [
  `${session}create-session-view.ts`,
  `${session}session-url.ts`,
  transportConfig,
]
const readPaths = [
  `${session}session-transport-read.ts`,
  "lib/actions/connect-agent.ts",
  "lib/actions/open-session-cold.ts",
  "lib/actions/open-session-url.ts",
  "lib/actions/reconnect-agent.ts",
  "lib/components/chat/bubbles/UserBubble.svelte",
  "lib/components/layout/SessionOptionsPanel.svelte",
]

type TransportUse = {
  branch: boolean
  read: boolean
  legacy: boolean
  unapprovedConfigBranch: boolean
}

const legacyNames = new Set([
  "isRemoteView",
  "#isRemote",
  "#remoteView",
  "hasAcpClient",
  "hasClient",
])
const configFunctions = new Set(["normalizeSessionTransport", "resolveSessionTransport"])

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

function isTransportLiteral(node: ts.Expression): boolean {
  const expression = unwrap(node)
  return (
    ts.isStringLiteralLike(expression) && (expression.text === "ws" || expression.text === "http")
  )
}

function isTransportBranch(node: ts.Node): boolean {
  if (ts.isCaseClause(node)) return isTransportLiteral(node.expression)
  if (ts.isConditionalExpression(node)) {
    return isTransportLiteral(node.whenTrue) || isTransportLiteral(node.whenFalse)
  }
  return (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
    (isTransportLiteral(node.left) || isTransportLiteral(node.right))
  )
}

function isTransportMap(expression: ts.Expression): boolean {
  const object = unwrap(expression)
  if (!ts.isObjectLiteralExpression(object)) return false
  const keys = new Set(
    object.properties.flatMap(({ name }) => {
      const key = name && ts.isComputedPropertyName(name) ? name.expression : name
      return key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) ? [key.text] : []
    }),
  )
  return keys.has("ws") && keys.has("http")
}

function inTransportConfigFunction(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && ts.isSourceFile(parent.parent)) {
      return parent.name !== undefined && configFunctions.has(parent.name.text)
    }
  }
  return false
}

function transportUse(file: SourceFile): TransportUse {
  const use: TransportUse = {
    branch: false,
    read: false,
    legacy: false,
    unapprovedConfigBranch: false,
  }
  const maps = new Set<string>()
  const lookups: ts.ElementAccessExpression[] = []
  function recordBranch(node: ts.Node) {
    use.branch = true
    if (file.path === transportConfig && !inTransportConfigFunction(node)) {
      use.unapprovedConfigBranch = true
    }
  }
  visitSource(file, (node) => {
    if (isTransportBranch(node)) recordBranch(node)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isTransportMap(node.initializer)
    ) {
      maps.add(node.name.text)
    }
    if (ts.isElementAccessExpression(node)) {
      const index = unwrap(node.argumentExpression)
      if (!ts.isStringLiteralLike(index) && !ts.isNumericLiteral(index)) lookups.push(node)
    }
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      use.legacy ||= legacyNames.has(node.text)
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      use.legacy ||= legacyNames.has(node.argumentExpression.text)
    }
    if (ts.isFunctionDeclaration(node)) {
      use.read ||= node.name?.text === "readSessionTransport"
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression
      use.read ||= ts.isIdentifier(name) && name.text === "readSessionTransport"
    }
  })
  for (const lookup of lookups) {
    const map = unwrap(lookup.expression)
    if (isTransportMap(map) || (ts.isIdentifier(map) && maps.has(map.text))) {
      recordBranch(lookup)
    }
  }
  return use
}

describe("session transport points (L5)", () => {
  it.each([
    'if (transport === "http") run()',
    "if ('ws' !== transport) run()",
    'const t = condition ? "ws" : other',
    'const t = condition ? other : "http"',
    'switch (transport) { case "http": connect(); break; case "ws": open(); }',
    "const pipe = ({ ws: open, http: connect })[transport]",
    'const pipes = { ["ws"]: open, http: connect } as const; const pipe = pipes[transport]',
  ])("detects transport branching: %s", (text) => {
    expect(transportUse({ path: "lib/other.ts", text }).branch).toBe(true)
  })

  it("allows a fixed lookup and a map with unrelated keys", () => {
    const text = 'const a = ({ ws: 1, http: 2 })["ws"]; const b = ({ x: 1, y: 2 })[key]'
    expect(transportUse({ path: "lib/other.ts", text }).branch).toBe(false)
  })

  it("allows branching in the two transport config functions", () => {
    const text = `
      export function normalizeSessionTransport(t: string) { return t === "http" }
      export function resolveSessionTransport(t: string) { return t === "ws" }
    `
    expect(transportUse({ path: transportConfig, text })).toMatchObject({
      branch: true,
      unapprovedConfigBranch: false,
    })
  })

  it.each([
    'export const addition = value !== "ws"',
    'export function additionalFunction() { return value === "http" }',
  ])("rejects an additional branch in the transport config: %s", (text) => {
    expect(transportUse({ path: transportConfig, text }).unapprovedConfigBranch).toBe(true)
  })

  it("detects readSessionTransport in Svelte scripts", () => {
    expect(
      transportUse({
        path: "routes/example/+page.svelte",
        text: "<script>const transport = readSessionTransport(options)</script>",
      }).read,
    ).toBe(true)
  })

  it("detects transport branches in Svelte block conditions", () => {
    const text = '{#if transport === "ws"}<div>Connected</div>{/if}'
    expect(transportUse({ path: "lib/Example.svelte", text }).branch).toBe(true)
  })

  it.each([
    "state.isRemoteView",
    "class Session { #isRemote = true }",
    "class Session { open() { this.#remoteView() } }",
    "state.hasAcpClient",
    'state["hasClient"]',
  ])("detects a legacy transport switch: %s", (text) => {
    expect(transportUse({ path: "lib/other.ts", text }).legacy).toBe(true)
  })

  it("ignores comments describing removed code", () => {
    expect(
      transportUse({
        path: "routes/example/+page.svelte",
        text: `
          <!-- {isRemoteView ? "ws" : "http"} -->
          <script>
            // const t = readSessionTransport()
            /* hasAcpClient || t === "http" */
          </script>
        `,
      }),
    ).toEqual({ branch: false, read: false, legacy: false, unapprovedConfigBranch: false })
  })

  it("permits exactly the listed production sites for each rule", () => {
    const uses = readProductionSources().map((file) => ({
      path: file.path,
      ...transportUse(file),
    }))
    expect(
      uses
        .filter((use) => use.branch)
        .map((use) => use.path)
        .sort(),
    ).toEqual([...branchPaths].sort())
    expect(
      uses
        .filter((use) => use.read)
        .map((use) => use.path)
        .sort(),
    ).toEqual([...readPaths].sort())
    expect(uses.filter((use) => use.legacy || use.unapprovedConfigBranch)).toEqual([])
  })
})
