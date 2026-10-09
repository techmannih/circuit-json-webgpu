import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PNG } from "pngjs"
import { compare } from "./parity/compare"
import {
  compareBaseWithCurrentReference,
  findParityRegressions,
  type ParityReport,
} from "./parity/check-regressions"

test("SVG reference updates preserve detection of actual WebGPU regressions", () => {
  const directory = mkdtempSync(join(tmpdir(), "parity-reference-"))
  const image = (redWidth: number) => {
    const png = new PNG({ width: 32, height: 16 })
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4
        png.data[i] = x < redWidth ? 255 : 0
        png.data[i + 3] = 255
      }
    return png
  }
  const reference = image(32)
  const difference = (render: PNG) =>
    compare(reference, render, image(0)).changed
  const base: ParityReport = {
    upstreamCommit: "same-frozen-canvas",
    snapshots: [{ pass: true }],
    snapshotFailed: 0,
    capturedRenderCalls: 1,
    renderCalls: 1,
    parityFailed: 0,
    referenceFailed: 0,
    results: [
      {
        id: "base-case",
        path: "fixture.ts",
        test: "pad",
        status: "pass",
        pass: true,
        changedPixels: 0,
        diagnostics: [],
      },
    ],
    referenceTests: [
      {
        path: "fixture.ts",
        name: "pad",
        status: "passed",
        caseIds: ["base-case"],
      },
    ],
  }
  const head = structuredClone(base)
  head.results[0] = {
    ...head.results[0],
    id: "head-case",
    status: "mismatch",
    pass: false,
    changedPixels: difference(image(16)),
    allowance: 4,
  }
  head.parityFailed = 1
  try {
    writeFileSync(
      join(directory, "base-case.webgpu.png"),
      PNG.sync.write(image(16)),
    )
    writeFileSync(
      join(directory, "head-case.svg.png"),
      PNG.sync.write(reference),
    )
    writeFileSync(
      join(directory, "head-case.webgpu.png"),
      PNG.sync.write(image(16)),
    )
    expect(findParityRegressions(base, head)).toHaveLength(1)
    const comparable = compareBaseWithCurrentReference(
      base,
      head,
      directory,
      directory,
    )
    expect(findParityRegressions(comparable, head)).toEqual([])
    head.results[0].changedPixels = difference(image(8))
    writeFileSync(
      join(directory, "head-case.webgpu.png"),
      PNG.sync.write(image(8)),
    )
    expect(
      findParityRegressions(
        compareBaseWithCurrentReference(base, head, directory, directory),
        head,
      ),
    ).toHaveLength(1)
    rmSync(join(directory, "base-case.webgpu.png"))
    expect(() =>
      compareBaseWithCurrentReference(base, head, directory, directory),
    ).toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
