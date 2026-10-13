import type { Matrix, Diagnostic } from "../../lib/types"
export type CapturedCase = {
  id: string
  testName: string
  testPath: string
  width: number
  height: number
  elements: Record<string, any>[]
  matrix: Matrix
  contextTransform: Matrix
  options: {
    layers?: string[]
    clipContextElements?: unknown
    clearDrillHoles?: boolean
    drawSolderPaste?: boolean
    drawSoldermask?: boolean
    drawSoldermaskTop?: boolean
    drawSoldermaskBottom?: boolean
    showPcbNotes?: boolean
  }
  primitive?: unknown
  sourceFunction?: string
}
export type ReferenceTest = {
  name: string
  path: string
  status: string
  caseIds: string[]
  error?: string
}
export type ComparisonResult = {
  id: string
  test: string
  path: string
  status: string
  pass?: boolean
  reason?: string
  error?: string
  viewport?: { minX: number; maxX: number; minY: number; maxY: number }
  layer?: string
  changedPixels?: number
  rawChangedPixels?: number
  inkPixels?: number
  allowance?: number
  diagnostics?: Diagnostic[]
}
