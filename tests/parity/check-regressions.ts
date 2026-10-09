import { appendFileSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { PNG } from "pngjs"
import { compare } from "./compare"
import type { Diagnostic } from "../../lib/types"
import type { ComparisonResult, ReferenceTest } from "./types"

export type ParityReport = {
  upstreamCommit: string
  snapshots: { pass: boolean }[]
  snapshotFailed: number
  capturedRenderCalls: number
  renderCalls: number
  parityFailed: number
  referenceFailed: number
  results: ComparisonResult[]
  referenceTests: ReferenceTest[]
}

function getDiagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.elementId,
    diagnostic.type,
    diagnostic.message,
  ])
}

function currentDiagnosticsAreSubsetOfBase({
  baseDiagnostics,
  currentDiagnostics,
}: {
  baseDiagnostics: Diagnostic[] | undefined
  currentDiagnostics: Diagnostic[] | undefined
}): boolean {
  const unmatchedBaseDiagnosticKeys = (baseDiagnostics ?? []).map(
    getDiagnosticKey,
  )
  for (const diagnostic of currentDiagnostics ?? []) {
    const diagnosticKey = getDiagnosticKey(diagnostic)
    const matchingBaseIndex = unmatchedBaseDiagnosticKeys.indexOf(diagnosticKey)
    if (matchingBaseIndex === -1) return false
    unmatchedBaseDiagnosticKeys.splice(matchingBaseIndex, 1)
  }
  return true
}

const indexCases = (results: ComparisonResult[]) => {
  const counts = new Map<string, number>()
  return new Map(
    results.map((result) => {
      const test = JSON.stringify([result.path, result.test])
      const ordinal = counts.get(test) ?? 0
      counts.set(test, ordinal + 1)
      return [JSON.stringify([test, ordinal]), result]
    }),
  )
}

/** Measure both renderer revisions against the same SVG reference image. */
export function compareBaseWithCurrentReference(
  base: ParityReport,
  head: ParityReport,
  baseDirectory: string,
  headDirectory: string,
): ParityReport {
  const current = indexCases(head.results)
  const results = [...indexCases(base.results)].map(([key, result]) => {
    const reference = current.get(key)
    if (
      !reference ||
      !["pass", "mismatch"].includes(result.status) ||
      !["pass", "mismatch"].includes(reference.status)
    )
      return result
    const expected = PNG.sync.read(
      readFileSync(resolve(headDirectory, `${reference.id}.svg.png`)),
    )
    const baseImage = readFileSync(
      resolve(baseDirectory, `${result.id}.webgpu.png`),
    )
    const actual = PNG.sync.read(baseImage)
    if (expected.width !== actual.width || expected.height !== actual.height)
      throw Error(`Base and current reference dimensions differ: ${key}`)
    if (
      !Number.isFinite(reference.allowance) ||
      !Number.isFinite(reference.changedPixels)
    )
      throw Error(`Missing comparison metrics: ${key}`)
    // Identical renderer images already have the head's current-reference score.
    const sameRendering = baseImage.equals(
      readFileSync(resolve(headDirectory, `${reference.id}.webgpu.png`)),
    )
    const { changed, rawChanged } = sameRendering
      ? {
          changed: reference.changedPixels!,
          rawChanged: reference.rawChangedPixels ?? reference.changedPixels!,
        }
      : compare(
          expected,
          actual,
          new PNG({ width: actual.width, height: actual.height }),
        )
    const pass = changed <= reference.allowance! && !result.diagnostics?.length
    return {
      ...result,
      pass,
      status: pass ? "pass" : "mismatch",
      changedPixels: changed,
      rawChangedPixels: rawChanged,
      inkPixels: reference.inkPixels,
      allowance: reference.allowance,
    }
  })
  return {
    ...base,
    results,
    parityFailed: results.filter((r) => r.pass === false).length,
  }
}

/** The strict SVG audit remains available; CI rejects regressions from its base. */
export function findParityRegressions(
  base: ParityReport,
  head: ParityReport,
): string[] {
  const failures: string[] = []
  for (const [label, report] of [
    ["base", base],
    ["head", head],
  ] as const) {
    if (
      !report.results.length ||
      report.results.length !== report.capturedRenderCalls ||
      report.results.filter((r) => r.status !== "not-comparable").length !==
        report.renderCalls ||
      !report.referenceTests.length
    )
      failures.push(`${label}: incomplete audit`)
  }
  if (base.upstreamCommit !== head.upstreamCommit)
    failures.push(
      "Reference dependency changed; compare against an audit of the same upstream revision",
    )
  if (
    head.snapshotFailed ||
    head.snapshots.some((s) => !s.pass) ||
    head.snapshots.length !== head.renderCalls
  )
    failures.push("Feature snapshots failed or are missing")
  const previous = indexCases(base.results)
  const current = indexCases(head.results)
  for (const key of previous.keys())
    if (!current.has(key)) failures.push(`Missing comparison: ${key}`)
  for (const [key, result] of current) {
    const before = previous.get(key)
    const label = `${result.path}: ${result.test} (${result.id})`
    if (result.status === "error") {
      failures.push(`Render error: ${label}`)
      continue
    }
    if (result.status === "not-comparable") {
      if (
        !before ||
        before.status !== result.status ||
        before.reason !== result.reason
      )
        failures.push(`Comparison was skipped: ${label}`)
      continue
    }
    if (
      !["pass", "mismatch"].includes(result.status) ||
      !Number.isFinite(result.changedPixels)
    ) {
      failures.push(`Invalid result: ${label}`)
      continue
    }
    if (result.status === "pass") continue
    if (
      !before ||
      before.status !== "mismatch" ||
      result.changedPixels! > (before.changedPixels ?? -1) ||
      !currentDiagnosticsAreSubsetOfBase({
        baseDiagnostics: before.diagnostics,
        currentDiagnostics: result.diagnostics,
      })
    )
      failures.push(`New or worsened mismatch: ${label}`)
  }
  const reference = new Map(
    base.referenceTests.map((t) => [JSON.stringify([t.path, t.name]), t]),
  )
  const currentReference = new Map(
    head.referenceTests.map((t) => [JSON.stringify([t.path, t.name]), t]),
  )
  for (const key of reference.keys())
    if (!currentReference.has(key))
      failures.push(`Missing reference test: ${key}`)
  for (const [key, test] of currentReference) {
    if (test.status !== "passed" && reference.get(key)?.status !== test.status)
      failures.push(`New reference test failure: ${key}`)
  }
  return failures
}

if (import.meta.main) {
  const [basePath, headPath] = process.argv.slice(2)
  if (!basePath || !headPath)
    throw new Error(
      "Usage: check-regressions.ts base-report.json head-report.json",
    )
  const base = JSON.parse(readFileSync(basePath, "utf8")) as ParityReport
  const head = JSON.parse(readFileSync(headPath, "utf8")) as ParityReport
  const comparableBase = compareBaseWithCurrentReference(
    base,
    head,
    dirname(basePath),
    dirname(headPath),
  )
  const failures = findParityRegressions(comparableBase, head)
  const summary = `SVG parity regression check: ${failures.length} regressions across ${head.renderCalls} comparisons.\nBoth WebGPU revisions use the proposed SVG reference: base ${comparableBase.parityFailed} mismatches, head ${head.parityFailed}.\nStrict audits originally reported ${base.parityFailed} base SVG mismatches and ${head.parityFailed} head SVG mismatches; reference test failures: base ${base.referenceFailed}, head ${head.referenceFailed}.\n`
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (failures.length) throw new Error(failures.join("\n"))
}
