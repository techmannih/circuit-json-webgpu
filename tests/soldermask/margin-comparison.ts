import type { CapturedCase } from "../parity/types"
import { prepareComparison } from "../parity/prepare"

export function marginComparison(
  state: "top" | "bottom" | "off",
  coverage: false | undefined,
) {
  const layer = state === "bottom" ? "bottom" : "top"
  const elements: CapturedCase["elements"] = [
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: 0, y: 0 },
      width: 22,
      height: 11,
    },
  ]
  for (const [y, margin] of [
    [2.3, 0.4],
    [-2.3, -0.3],
  ]) {
    const common = {
      y,
      soldermask_margin: margin,
      ...(coverage === false ? { is_covered_with_solder_mask: false } : {}),
    }
    elements.push(
      {
        type: "pcb_hole",
        pcb_hole_id: `circle-${y}`,
        hole_shape: "circle",
        x: -8,
        hole_diameter: 2,
        ...common,
      },
      {
        type: "pcb_hole",
        pcb_hole_id: `pill-${y}`,
        hole_shape: "pill",
        x: -4,
        hole_width: 2,
        hole_height: 1.5,
        ...common,
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: `pad-${y}`,
        shape: "circle",
        layer,
        x: 0,
        radius: 1,
        ...common,
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: `asymmetric-${y}`,
        shape: "rect",
        layer,
        x: 4,
        width: 2,
        height: 1.5,
        ...common,
        soldermask_margin: 0,
        soldermask_margin_right: margin,
      },
      {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: `pth-${y}`,
        shape: "circle",
        layers: ["top", "bottom"],
        x: 8,
        outer_diameter: 2,
        hole_diameter: 0.8,
        ...common,
      },
    )
  }
  return prepareComparison({
    width: 600,
    height: 320,
    matrix: { a: 25, b: 0, c: 0, d: -25, e: 300, f: 160 },
    contextTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    elements,
    options: {
      drawSoldermask: state !== "off",
      drawSoldermaskTop: layer === "top",
      drawSoldermaskBottom: layer === "bottom",
    },
  }).scene!
}
