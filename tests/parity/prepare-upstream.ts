import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const installed = dirname(require.resolve("circuit-to-canvas/package.json"))
const target = fileURLToPath(
  new URL("../upstream/circuit-to-canvas/", import.meta.url),
)
const manifest = JSON.parse(
  readFileSync(new URL("./upstream-manifest.json", import.meta.url), "utf8"),
)
// Use a disposable copy: upstream matchers write diffs beside their goldens.
// Copy every manifest entry so the installed dependency stays untouched.
for (const path of Object.keys(manifest.files)) {
  const dest = resolve(target, path)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(resolve(installed, path), dest)
}

// The byte-for-byte pinned Canvas reference uses the schema it was authored
// against. Keep its types separate from the renderer's current Circuit JSON.
const referenceSchema = dirname(
  require.resolve("circuit-json-reference/package.json"),
)
const schemaLink = resolve(target, "node_modules/circuit-json")
mkdirSync(dirname(schemaLink), { recursive: true })
rmSync(schemaLink, { recursive: true, force: true })
symlinkSync(referenceSchema, schemaLink, "dir")

// Frozen Canvas goldens use their original SVG renderer.
const referenceSvg = dirname(
  require.resolve("circuit-to-svg-reference/package.json"),
)
const svgLink = resolve(target, "node_modules/circuit-to-svg")
rmSync(svgLink, { recursive: true, force: true })
symlinkSync(referenceSvg, svgLink, "dir")
