import { expect, test } from "bun:test"
import type { PcbNoteText } from "circuit-json"
import { MeshBuilder } from "../lib/geometry"
import { drawText } from "../lib/text/draw-text"

test("PCB note overlays stay upright on either side unless explicitly mirrored", () => {
  const render = (
    layer: PcbNoteText["layer"],
    is_mirrored_from_top_view?: boolean,
  ) => {
    const mesh = new MeshBuilder()
    drawText(mesh, {
      type: "pcb_note_text",
      text: "F3",
      font_size: 2,
      anchor_position: { x: 5, y: 3 },
      anchor_alignment: "center_left",
      layer,
      is_mirrored_from_top_view,
    })
    return mesh.build().vertices
  }
  const upright = render("top")
  expect(render("bottom")).toEqual(upright)
  expect(render("bottom", false)).toEqual(upright)
  const mirrored = render("bottom", true)
  const xs = (vertices: Float32Array) =>
    Array.from(vertices).filter((_, i) => i % 8 === 0)
  expect(Math.min(...xs(mirrored))).toBeCloseTo(10 - Math.max(...xs(upright)))
  expect(Math.max(...xs(mirrored))).toBeCloseTo(10 - Math.min(...xs(upright)))
})
