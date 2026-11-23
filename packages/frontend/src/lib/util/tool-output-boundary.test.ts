import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

function schemaReferences(source: string): string[] {
  const identifiers = /\b(?:ToolOutputFieldPaths|toolOutputMappings|outputMapping|META_ROOT)\b/g
  const specifiers =
    /["'`](?:@drive-coding\/provider\/config|[^"'\n`]*(?:tool-output-mappings|tool-output-field-types|tool-output-override-parse)[^"'\n`]*)["'`]/g
  return [...(source.match(identifiers) ?? []), ...(source.match(specifiers) ?? [])]
}

it("keeps provider tool output schema references out of frontend source and tests", () => {
  const src = fileURLToPath(new URL("../../", import.meta.url))
  const files = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|svelte)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => path !== fileURLToPath(import.meta.url))
  expect(files.length).toBeGreaterThan(0)
  expect(
    files.flatMap((path) =>
      schemaReferences(readFileSync(path, "utf8")).map((ref) => ({ path, ref })),
    ),
  ).toEqual([])
})

it("detects a forbidden import and a schema identifier in a synthetic frontend file", () => {
  expect(schemaReferences('import { schema } from "@drive-coding/provider/config"')).toEqual([
    '"@drive-coding/provider/config"',
  ])
  expect(schemaReferences("const outputMapping = {}")).toEqual(["outputMapping"])
})
