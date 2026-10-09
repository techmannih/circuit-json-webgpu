import { expect, test } from "bun:test"
import type { PcbNoteText } from "circuit-json"
import { compileCircuitJson } from "../lib"

test("named white PCB notes compile like hex white on both board sides", () => {
  for (const layer of ["top", "bottom"] as const) {
    const note: PcbNoteText = {
      type: "pcb_note_text",
      pcb_note_text_id: "tenting_legend",
      layer,
      text: "Board via tenting",
      anchor_position: { x: 0, y: 0 },
      anchor_alignment: "center",
      font: "tscircuit2024",
      font_size: 1,
      color: "white",
    }
    const scene = compileCircuitJson([note])
    const hexScene = compileCircuitJson([{ ...note, color: "#ffffff" }])
    expect(scene.diagnostics).toEqual([])
    expect(scene.triangleCount).toBeGreaterThan(0)
    expect(scene).toEqual(hexScene)
  }
})
