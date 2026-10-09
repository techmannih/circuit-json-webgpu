import { expect, test } from "bun:test"
import { MeshBuilder } from "../lib/geometry"
import { drawText } from "../lib/text/draw-text"

test("PCB notes anchor their first line and advance by one font size", () => {
  for (const textYAxis of ["up", "down"] as const) {
    for (const anchor of [
      "top_left",
      "top_center",
      "top_right",
      "center_left",
      "center",
      "center_right",
      "bottom_left",
      "bottom_center",
      "bottom_right",
    ] as const) {
      const note: Parameters<typeof drawText>[1] = {
        type: "pcb_note_text",
        text: "Via\n\nTented",
        font_size: 2,
        anchor_alignment: anchor,
        anchor_position: { x: 3, y: 5 },
      }
      const actual = new MeshBuilder()
      drawText(actual, note, textYAxis)
      const expected = new MeshBuilder()
      drawText(expected, { ...note, text: "Via" }, textYAxis)
      drawText(
        expected,
        {
          ...note,
          text: "Tented",
          anchor_position: { x: 3, y: textYAxis === "up" ? 1 : 9 },
        },
        textYAxis,
      )
      expect(actual.build()).toEqual(expected.build())
      const escaped = new MeshBuilder()
      drawText(escaped, { ...note, text: "Via\\n\\nTented" }, textYAxis)
      expect(escaped.build()).toEqual(actual.build())
    }
  }
})
