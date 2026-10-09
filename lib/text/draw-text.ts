import { fillEvenOdd } from "./fill-even-odd"
import { MeshBuilder, rotate } from "../geometry"
import type { Point } from "../types"
import { getAlphabetLayout } from "circuit-to-canvas/lib/drawer/shapes/text/getAlphabetLayout"
import { getTextGeometry } from "circuit-to-canvas/lib/drawer/shapes/text/getTextStartPosition"
import { textMetrics } from "@tscircuit/alphabet"
import type {
  PcbCopperText,
  PcbFabricationNoteText,
  PcbNoteText,
  PcbSilkscreenText,
} from "circuit-json"

type TextElement = Partial<Omit<PcbCopperText, "type">> & {
  type:
    | PcbCopperText["type"]
    | PcbSilkscreenText["type"]
    | PcbFabricationNoteText["type"]
    | PcbNoteText["type"]
    | "pcb_dimension_text"
  is_mirrored_from_top_view?: PcbNoteText["is_mirrored_from_top_view"]
  center?: Point
  x?: number
  y?: number
}

// @tscircuit/alphabet's scripts/build-font.ts uses ASCENDER / UNITS_PER_EM.
// Its public textMetrics exports line height, but not the ascender yet.
const alphabetAscenderRatio = 940 / 1000

/** Convert shared alphabet outlines to GPU triangles. */
export function drawText(
  mesh: MeshBuilder,
  e: TextElement,
  yAxis: "up" | "down" = "up",
) {
  const text = String(e.text ?? "").replace(/\\n/g, "\n")
  if (!text) return
  const c = e.anchor_position ?? e.center ?? { x: e.x ?? 0, y: e.y ?? 0 }
  const fontSize = e.font_size ?? 1
  if (e.type === "pcb_note_text" && text.includes("\n")) {
    // SVG notes anchor the first line and advance subsequent tspans by one em.
    for (const [index, line] of text.split("\n").entries())
      drawText(
        mesh,
        {
          ...e,
          text: line,
          anchor_position: {
            x: c.x,
            y: c.y + (yAxis === "up" ? -1 : 1) * index * fontSize,
          },
        },
        yAxis,
      )
    return
  }
  const layout = getAlphabetLayout(text, fontSize)
  const geometry = getTextGeometry(
    e.anchor_alignment ?? "center",
    layout,
    fontSize,
  )
  const isNote = e.type === "pcb_note_text"
  const isFabrication = e.type === "pcb_fabrication_note_text"
  const mirrored = isFabrication
    ? false
    : isNote
      ? (e.is_mirrored_from_top_view ?? false)
      : e.type === "pcb_silkscreen_text"
        ? e.layer === "bottom"
        : (e.is_mirrored ?? e.layer === "bottom")
  const rotation = isNote || isFabrication ? 0 : (e.ccw_rotation ?? 0)
  const sign = yAxis === "up" ? -1 : 1
  const alignment = e.anchor_alignment ?? "center"
  // SVG anchors its font advance and baseline, rather than the glyph ink bounds.
  const ascender = alphabetAscenderRatio
  const descender = ascender - textMetrics.lineHeightRatio
  const noteAnchorX = alignment.endsWith("_left")
    ? 0
    : alignment.endsWith("_right")
      ? -layout.width
      : -layout.width / 2
  const noteBaseline = alignment.startsWith("top_")
    ? ascender
    : alignment.startsWith("bottom_")
      ? descender
      : (ascender + descender) / 2
  const transform = (p: Point) => {
    const x = isNote
      ? p.x - geometry.startOffset.x - layout.strokeWidth / 2 + noteAnchorX
      : p.x
    const y = isNote
      ? (p.y - geometry.startOffset.y - fontSize) * ascender +
        noteBaseline * fontSize
      : p.y
    return rotate(
      { x: c.x + (mirrored ? -x : x), y: c.y + sign * y },
      c,
      -sign * rotation,
    )
  }
  if (e.is_knockout && !isNote && !isFabrication) {
    const b = geometry.bounds
    if (!b) return
    const p = {
      left: 0.2,
      right: 0.2,
      top: 0.2,
      bottom: 0.2,
      ...e.knockout_padding,
    }
    const outer = [
      { x: b.minX - p.left, y: b.minY - p.top },
      { x: b.maxX + p.right, y: b.minY - p.top },
      { x: b.maxX + p.right, y: b.maxY + p.bottom },
      { x: b.minX - p.left, y: b.maxY + p.bottom },
    ]
    fillEvenOdd(mesh, [
      outer.map(transform),
      ...geometry.glyphGroups.flatMap((group) =>
        group.map((ring) => ring.map(transform)),
      ),
    ])
    return
  }
  // Alphabet outlines describe the union of each glyph's round strokes. Filling
  // once avoids alpha accumulating at segment joins in translucent note text.
  for (const group of geometry.glyphGroups)
    fillEvenOdd(
      mesh,
      group.map((ring) => ring.map(transform)),
    )
}
