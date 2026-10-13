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
  soldermask_over_copper_top: rgb(52, 135, 73),
  soldermask_over_copper_bottom: rgb(52, 135, 73),
  soldermask_over_hole_top: rgb(26, 68, 37),
  soldermask_over_hole_bottom: rgb(26, 68, 37),
  substrate: rgb(201, 162, 110),
  top_fabrication: [1, 1, 1, 0.5],
  bottom_fabrication: [1, 1, 1, 0.5],
  top_notes: rgb(89, 148, 220),
  bottom_notes: rgb(89, 148, 220),
  top_courtyard: rgb(255, 0, 245),
  bottom_courtyard: rgb(38, 233, 255),
  edge_cuts: rgb(208, 210, 205),
}
export const normalizeLayer = (layer: string) =>
  layer
    .replace(/^(top|bottom)_soldermask$/, "soldermask_$1")
    .replace(/_copper$/, "")

// Basic CSS color keywords also appear in imported PCB annotation fixtures.
const namedColors: Record<string, string> = {
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
  transparent: "#00000000",
}

export function parseColor(value: string): Color {
  value = namedColors[value.trim().toLowerCase()] ?? value.trim()
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex
    if (full.length !== 6 && full.length !== 8)
      throw new Error(`Unsupported color: ${value}`)
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
      full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1,
    ]
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/)
  if (match) {
    const channels = match[1].split(",").map((v) => Number(v.trim()))
    if (
      (channels.length === 3 || channels.length === 4) &&
      channels.every(Number.isFinite)
    )
      return [
        channels[0] / 255,
        channels[1] / 255,
        channels[2] / 255,
        channels[3] ?? 1,
      ]
  }
  throw new Error(`Unsupported color: ${value}`)
}
