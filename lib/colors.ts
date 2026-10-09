import color from "color"
import type { Color } from "./types"
const rgb = (r: number, g: number, b: number): Color => [
  r / 255,
  g / 255,
  b / 255,
  1,
]
export const DEFAULT_LAYER_COLORS: Record<string, Color> = {
  board: rgb(70, 72, 72),
  top: rgb(200, 52, 52),
  bottom: rgb(77, 127, 196),
  inner1: rgb(127, 200, 127),
  inner2: rgb(206, 125, 44),
  inner3: rgb(79, 203, 203),
  inner4: rgb(219, 98, 139),
  inner5: rgb(167, 165, 198),
  inner6: rgb(40, 204, 217),
  inner7: rgb(232, 178, 167),
  inner8: rgb(242, 237, 161),
  drill: rgb(255, 38, 226),
  top_silkscreen: rgb(242, 237, 161),
  bottom_silkscreen: rgb(242, 237, 161),
  soldermask_top: rgb(12, 55, 33),
  soldermask_bottom: rgb(12, 55, 33),
  top_fabrication: [1, 1, 1, 0.5],
  bottom_fabrication: [1, 1, 1, 0.5],
  top_notes: rgb(89, 148, 220),
  bottom_notes: rgb(89, 148, 220),
  top_courtyard: rgb(255, 0, 245),
  bottom_courtyard: rgb(38, 233, 255),
  edge_cuts: rgb(208, 210, 205),
}
export const normalizeLayer = (layer: string) => layer.replace(/_copper$/, "")

export function parseColor(value: string): Color {
  try {
    const parsed = color(value.trim().toLowerCase()).rgb()
    return [
      parsed.red() / 255,
      parsed.green() / 255,
      parsed.blue() / 255,
      parsed.alpha(),
    ]
  } catch {
    throw new Error(`Unsupported color: ${value}`)
  }
}
