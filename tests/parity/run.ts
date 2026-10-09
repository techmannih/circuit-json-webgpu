import { snapshotKey } from "./snapshot-key"
import { featureSnapshot } from "./snapshot"
import type { CapturedCase, ReferenceTest, ComparisonResult } from "./types"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { chromium } from "playwright"
import { PNG } from "pngjs"
import { compare } from "./compare.ts"
import { prepareComparison } from "./prepare.ts"
import { comparisonSilkscreenColors } from "./palette"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Resvg } from "@resvg/resvg-js"
const alphabetFontPath = fileURLToPath(
  new URL(
    "TscircuitAlphabet.ttf",
    import.meta.resolve(
      "@tscircuit/alphabet",
      import.meta.resolve("circuit-to-svg"),
    ),
  ),
)
const root = fileURLToPath(new URL("../../", import.meta.url))
const dir = new URL("../actual/parity/", import.meta.url)
const cases: CapturedCase[] = JSON.parse(
  await readFile(new URL("cases.json", dir), "utf8"),
)
const tests: ReferenceTest[] = JSON.parse(
  await readFile(new URL("tests.json", dir), "utf8"),
)
const server = await createServer({
  root,
  server: {
    host: "127.0.0.1",
    port: 0,
    hmr: false,
    watch: { ignored: ["**/*"] },
  },
  logLevel: "error",
})
await server.listen()
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    ...(process.env.WEBGPU_SOFTWARE
      ? [
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--ignore-gpu-blocklist",
          "--enable-gpu",
          "--enable-features=Vulkan",
          "--use-vulkan=swiftshader",
        ]
      : []),
  ],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
})
const occurrence = new Map<string, number>()
const results: ComparisonResult[] = []
const snapshots: { id: string; pass: boolean; error?: string }[] = []
try {
  const page = await browser.newPage()
  page.on("pageerror", (e) => console.error("Browser:", e.message))
  await page.goto(`${server.resolvedUrls!.local[0]}tests/parity/`)
  await page.waitForFunction(() => window.parity)
  for (const c of cases) {
    if (
      process.env.PARITY_TEXT_ONLY &&
      !(c.elements.length && c.elements.every((e) => e.type.endsWith("_text")))
    )
      continue
    const testKey = JSON.stringify([c.testPath, c.testName])
    const ordinal = occurrence.get(testKey) ?? 0
    occurrence.set(testKey, ordinal + 1)
    const key = snapshotKey(c.testPath, c.testName, ordinal)
    const { scene, reason } = prepareComparison(c)
    if (!scene) {
      results.push({
        id: c.id,
        test: c.testName,
        path: c.testPath,
        status: "not-comparable",
        reason,
      })
      continue
    }
    try {
      const svg = convertCircuitJsonToPcbSvg(
        scene.elements as unknown as Parameters<
          typeof convertCircuitJsonToPcbSvg
        >[0],
        {
          width: scene.width,
          height: scene.height,
          viewport: scene.viewport,
          layer: scene.layer,
          showSolderMask: scene.showSolderMask,
          showPcbNotes: scene.showPcbNotes,
          showCourtyards: true,
          shouldDrawErrors: false,
          shouldDrawRatsNest: false,
          includeVersion: false,
          drawPaddingOutsideBoard: false,
          backgroundColor: scene.background,
          colorOverrides: { silkscreen: comparisonSilkscreenColors },
        },
      )
      await writeFile(new URL(`${c.id}.svg.svg`, dir), svg)
      const svgPng = new Resvg(svg, {
        font: { fontFiles: [alphabetFontPath], loadSystemFonts: false },
      })
        .render()
        .asPng()
      await writeFile(new URL(`${c.id}.svg.png`, dir), svgPng)
      const result = await page.evaluate(
        (scene) => window.parity.render(scene),
        scene,
      )
      const actual = PNG.sync.read(Buffer.from(result.png, "base64"))
      const expected = PNG.sync.read(svgPng)
      if (expected.width !== actual.width || expected.height !== actual.height)
        throw new Error("SVG and GPU output dimensions differ")
      const diff = new PNG({ width: c.width, height: c.height })
      const { changed, rawChanged } = compare(expected, actual, diff)
      snapshots.push({
        id: c.id,
        ...(await featureSnapshot(c.id, expected, actual, key)),
      })
      let ink = 0
      for (let i = 0; i < expected.data.length; i += 4)
        if (
          [0, 1, 2, 3].some(
            (k) => Math.abs(expected.data[i + k] - (k === 3 ? 255 : 0)) > 8,
          )
        )
          ink++
      // Both an image-wide and ink-relative bound prevent tiny missing labels
      // from disappearing into the background allowance.
      const allowance = Math.ceil(
        Math.max(4, Math.min(c.width * c.height * 0.002, ink * 0.02)),
      )
      const pass = changed <= allowance && result.diagnostics.length === 0
      await writeFile(
        new URL(`${c.id}.webgpu.png`, dir),
        Buffer.from(result.png, "base64"),
      )
      if (!pass)
        await writeFile(new URL(`${c.id}.diff.png`, dir), PNG.sync.write(diff))
      results.push({
        id: c.id,
        test: c.testName,
        path: c.testPath,
        pass,
        status: pass ? "pass" : "mismatch",
        viewport: scene.viewport,
        layer: scene.layer ?? "all",
        changedPixels: changed,
        rawChangedPixels: rawChanged,
        inkPixels: ink,
        allowance,
        diagnostics: result.diagnostics,
      })
      console.log(
        `${pass ? "PASS" : "DIFF"} ${c.id} ${c.testName}: ${changed} pixels (${ink} ink)`,
      )
    } catch (error) {
      results.push({
        id: c.id,
        test: c.testName,
        path: c.testPath,
        pass: false,
        status: "error",
        error: String(error),
      })
      console.error(c.id, error)
    }
  }
  await page.evaluate(() => window.parity.dispose())
} finally {
  await browser.close()
  await server.close()
}
const pureTextResults = results.filter((r) => {
  const c = cases.find((c) => c.id === r.id)
  return (
    c && c.elements.length && c.elements.every((e) => e.type.endsWith("_text"))
  )
})
const report = {
  snapshots,
  snapshotPassed: snapshots.filter((s) => s.pass).length,
  snapshotFailed: snapshots.filter((s) => !s.pass).length,
  referenceRenderer: "circuit-to-svg",
  candidateRenderer: "circuit-json-webgpu",
  comparisonPolicy:
    "Fresh renders from identical Circuit JSON, canonical y-up viewport, dimensions, black background, and explicit layer settings. No Canvas images or stacked snapshots are used.",
  notComparable: results.filter((r) => r.status === "not-comparable").length,
  textRenderCalls: pureTextResults.length,
  textParityPassed: pureTextResults.filter((r) => r.pass).length,
  textParityFailed: pureTextResults.filter((r) => r.pass === false).length,
  upstreamCommit: "fa8405c67634e287b79a1506eedde077ef6accb0",
  testFiles: new Set(tests.map((t) => t.path)).size,
  tests: tests.length,
  referencePassed: tests.filter((t) => t.status === "passed").length,
  referenceFailed: tests.filter((t) => t.status === "failed").length,
  capturedRenderCalls: cases.length,
  renderCalls: results.filter((r) => r.status !== "not-comparable").length,
  parityPassed: results.filter((r) => r.pass).length,
  parityFailed: results.filter((r) => r.pass === false).length,
  testsWithoutCircuitDrawCalls: tests.filter((t) => !t.caseIds.length),
  referenceTests: tests,
  results,
}
await writeFile(new URL("report.json", dir), JSON.stringify(report, null, 2))
const escape = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
const html =
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>circuit-to-svg / circuit-json-webgpu</title><style>
body{font:14px system-ui;background:#161616;color:#eee;margin:24px}section{border-top:1px solid #555;padding:20px 0}.scroll{overflow-x:auto}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;min-width:600px}figure{margin:0;min-width:0}figcaption{font-weight:700;padding:10px 0}img{display:block;width:100%;height:auto;background:#000}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin-top:16px}.notice{padding:16px;background:#292929}summary{cursor:pointer}</style></head><body>
<h1>circuit-to-svg ← → circuit-json-webgpu</h1><p>Every pair is generated fresh from the same Circuit JSON, viewport, dimensions, layers, and black background. Left: circuit-to-svg. Right: circuit-json-webgpu. No Canvas snapshot or vertically stacked comparison is used.</p><p>${report.parityPassed}/${report.renderCalls} comparisons pass. ${report.notComparable} captured Canvas-only passes are explicitly listed as not comparable. The original Canvas assertions are retained separately in report.json.</p>` +
  results
    .map(
      (r) =>
        `<section id="${r.id}"><h2>${escape(r.status.toUpperCase())} · ${r.id} · ${escape(r.test)}</h2>${r.status === "not-comparable" ? `<p class="notice">Not compared: ${escape(r.reason)}</p>` : r.status === "error" ? `<p class="notice">Render failed: ${escape(r.error)}</p>` : `<p>${r.changedPixels} differing pixels; allowance ${r.allowance}. Layer: ${escape(r.layer)}.</p><div class="scroll"><div class="pair"><figure><figcaption>circuit-to-svg</figcaption><a href="${r.id}.svg.svg"><img loading="lazy" src="${r.id}.svg.png" alt="circuit-to-svg reference"></a></figure><figure><figcaption>circuit-json-webgpu</figcaption><img loading="lazy" src="${r.id}.webgpu.png" alt="WebGPU render"></figure></div></div>${r.pass ? "" : `<details><summary>Show pixel diff and diagnostics</summary><img loading="lazy" src="${r.id}.diff.png" alt="pixel diff"><pre>${escape(JSON.stringify(r.diagnostics, null, 2))}</pre></details>`}`}</section>`,
    )
    .join("") +
  "</body></html>"
await writeFile(new URL("index.html", dir), html)
console.log(
  JSON.stringify(
    {
      ...report,
      results: undefined,
      referenceTests: undefined,
      testsWithoutCircuitDrawCalls: report.testsWithoutCircuitDrawCalls.length,
    },
    null,
    2,
  ),
)
if (process.env.SNAPSHOT_TEST_ONLY) {
  if (report.snapshotFailed || results.some((r) => r.status === "error"))
    process.exitCode = 1
} else if (
  report.parityFailed ||
  report.referenceFailed ||
  report.testsWithoutCircuitDrawCalls.some((t) => t.path?.includes("/shapes/"))
)
  process.exitCode = 1
