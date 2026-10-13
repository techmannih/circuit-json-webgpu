import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { chromium } from "playwright"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"

const root = fileURLToPath(new URL("../", import.meta.url))
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
let browser
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      ...(process.env.WEBGPU_SOFTWARE
        ? [
            "--enable-gpu",
            "--use-angle=swiftshader",
            "--use-vulkan=swiftshader",
            "--enable-features=Vulkan",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ]
        : []),
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  })
  const page = await browser.newPage({ viewport: { width: 600, height: 480 } })
  const errors: string[] = []
  page.on("pageerror", (e) => {
    errors.push(e.message)
    console.error(e.message)
  })
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text())
  })
  await page.goto(`${server.resolvedUrls!.local[0]}tests/soldermask/`)
  await page.waitForFunction(() => window.soldermaskTest)
  const pixel = (png: string, x: number, y: number) => {
    const image = PNG.sync.read(Buffer.from(png, "base64"))
    const offset =
      (Math.round(240 - 24 * y) * image.width + Math.round(300 + 24 * x)) * 4
    return [...image.data.slice(offset, offset + 4)]
  }
  await mkdir(new URL("./actual/soldermask/", import.meta.url), {
    recursive: true,
  })
  const states = ["top", "bottom", "off"] as const
  for (const state of states) {
    const result = await page.evaluate(
      (state) =>
        window.soldermaskTest.render({
          selectedLayer: state === "bottom" ? "bottom" : "top",
          showSolderMask: state !== "off",
        }),
      state,
    )
    assert.deepEqual(result.diagnostics, [])
    assert.equal(result.uploads, 1, "mask/side toggles reuse retained geometry")
    if (state !== "off") {
      const copper = state === "top" ? [200, 52, 52, 255] : [77, 127, 196, 255]
      assert.deepEqual(pixel(result.png, -6, 3), copper)
      assert.deepEqual(
        pixel(result.png, -7.25, 3),
        [201, 162, 110, 255],
        "positive margin exposes substrate",
      )
      assert.deepEqual(pixel(result.png, -2, 3), copper)
      assert.deepEqual(
        pixel(result.png, -1.2, 3),
        [52, 135, 73, 255],
        "negative margin leaves masked ring",
      )
      assert.deepEqual(
        pixel(result.png, 6, 3),
        [52, 135, 73, 255],
        "covered pad stays shaded",
      )
      assert.deepEqual(
        pixel(result.png, -6, -3),
        state === "top" ? [26, 68, 37, 255] : [255, 38, 226, 255],
        "board tenting covers the selected drill",
      )
      assert.deepEqual(
        pixel(result.png, -2, -3),
        state === "bottom" ? [26, 68, 37, 255] : [255, 38, 226, 255],
        "explicit side flags override board defaults",
      )
      assert.deepEqual(
        pixel(result.png, 2, -3),
        state === "top" ? [26, 68, 37, 255] : [255, 38, 226, 255],
        "explicit false overrides legacy true",
      )
      assert.deepEqual(
        pixel(result.png, 6, -3),
        [26, 68, 37, 255],
        "route via is tented",
      )
      assert.deepEqual(
        pixel(result.png, -5.4, 0),
        [52, 135, 73, 255],
        "negative hole margin covers part of the drill",
      )
      assert.deepEqual(
        pixel(result.png, 6, 0),
        state === "top" ? [201, 162, 110, 255] : [12, 55, 33, 255],
        "standalone opening exposes only its side",
      )
    } else {
      assert.deepEqual(pixel(result.png, -6, -3), [255, 38, 226, 255])
      assert.deepEqual(pixel(result.png, 6, 3), [200, 52, 52, 255])
      assert.deepEqual(pixel(result.png, -7.25, 3), [0, 0, 0, 255])
    }
    const buffer = Buffer.from(result.png, "base64")
    await writeFile(
      new URL(`./actual/soldermask/${state}.png`, import.meta.url),
      buffer,
    )
    const golden = new URL(
      `./snapshots/soldermask-${state}.png`,
      import.meta.url,
    )
    if (process.env.UPDATE_SNAPSHOTS) await writeFile(golden, buffer)
    else {
      const actual = PNG.sync.read(buffer),
        expected = PNG.sync.read(await readFile(golden))
      const changed = pixelmatch(
        actual.data,
        expected.data,
        undefined,
        actual.width,
        actual.height,
        { threshold: 0.1 },
      )
      assert(
        changed <= actual.width * actual.height * 0.002,
        `${state}: ${changed} changed pixels`,
      )
    }
  }
  const xray = await page.evaluate(() =>
    window.soldermaskTest.render({ xRayElementIds: ["inherited"] }),
  )
  assert.deepEqual(
    pixel(xray.png, -6, -3),
    [255, 38, 226, 255],
    "X-Ray keeps the physical drill",
  )
  assert.deepEqual(
    pixel(xray.png, 6, 3),
    [0, 0, 0, 255],
    "X-Ray hides mask overlays",
  )
  const alias = await page.evaluate(() =>
    window.soldermaskTest.render({ layers: ["top_soldermask"] }),
  )
  assert.deepEqual(pixel(alias.png, -6, -3), [26, 68, 37, 255])
  const highlight = await page.evaluate(() =>
    window.soldermaskTest.render({ highlightedElementIds: ["inherited"] }),
  )
  assert(
    pixel(highlight.png, -6, -3)[1] > 68,
    "tented via mask retains element highlight IDs",
  )
  assert.equal(highlight.uploads, 1)
  assert.deepEqual(errors, [])
  console.log(
    "Soldermask WebGPU pixel assertions, retained geometry, and 3 snapshots passed",
  )
} finally {
  await browser?.close()
  await server.close()
}
