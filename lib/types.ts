import type { AnyCircuitElement } from "circuit-json"
export type CircuitJson = readonly AnyCircuitElement[]
export type Point = { x: number; y: number }
export type Matrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}
export type Color = readonly [number, number, number, number]
export type RenderOptions = {
  transform?: Matrix
  layers?: readonly string[]
  selectedLayer?: string
  hiddenLayerOpacity?: number
  /** Copper-pour alpha multiplier (0–1, default 1). showCopperPours=false overrides it. */
  copperPourOpacity?: number
  showCopperPours?: boolean
  /** Board material is hidden by default, except beneath visible soldermask.
   * Explicit false also hides the substrate exposed by mask apertures. */
  showBoardMaterial?: boolean
  showSolderMask?: boolean
  showSilkscreen?: boolean
  showFabricationNotes?: boolean
  showPcbNotes?: boolean
  showCourtyards?: boolean
  highlightedElementIds?: readonly string[]
  /** Copper belonging to an inspected net. Supply resolved PCB element IDs.
   * Selected copper is opaque on every layer; other copper uses hiddenLayerOpacity.
   * Omit or pass [] to exit. Explicit layers and visibility toggles still apply.
   * Selected via and plated-hole drills stay visible; all other non-copper
   * layers and hover highlights are hidden until X-Ray is cleared.
   * Selection changes reuse the retained geometry buffers.
   */
  xRayElementIds?: readonly string[]
  background?: Color
}
export type Diagnostic = { elementId: string; type: string; message: string }
export type Mesh = { vertices: Float32Array; indices: Uint32Array }
export type CompiledLayer = { name: string; paint: Mesh; erase: Mesh }
export type CompiledScene = {
  layers: CompiledLayer[]
  elementIds: string[]
  diagnostics: Diagnostic[]
  triangleCount: number
}
export type DrawerOptions = {
  /** Use down for Canvas-style coordinates; PCB world coordinates default to up. */
  textYAxis?: "up" | "down"
  layerColors?: Record<string, Color>
  sampleCount?: 1 | 4
  onDeviceLost?: (message: string) => void
}
