import { expect, test } from "bun:test"
import { compileCircuitJson, normalizeLayer } from "../lib"
import type { CompiledScene, Mesh } from "../lib"

const board = {
  type: "pcb_board",
  pcb_board_id: "board",
  subcircuit_id: "board",
  center: { x: 0, y: 0 },
  width: 30,
  height: 20,
  num_layers: 4,
  material: "fr4",
  thickness: 1.6,
}
const pad = {
  type: "pcb_smtpad",
  pcb_smtpad_id: "pad",
  shape: "rect",
  x: 0,
  y: 0,
  width: 2,
  height: 1,
  layer: "top",
}
const via = {
  type: "pcb_via",
  pcb_via_id: "via",
  subcircuit_id: "board",
  x: 0,
  y: 0,
  outer_diameter: 2,
  hole_diameter: 1,
  layers: ["top", "bottom"],
}
test("board-tenting fixture labels accept CSS keyword colors without failing the worker", () => {
  const scene = compile([
    board,
    {
      type: "pcb_note_text",
      pcb_note_text_id: "legend",
      text: "Via tenting",
      anchor_position: { x: 0, y: 5 },
      anchor_alignment: "center",
      font: "tscircuit2024",
      font_size: 1,
      layer: "top",
      color: "white",
    },
  ])
  expect([...layer(scene, "top_notes").paint.vertices.slice(2, 6)]).toEqual([
    1, 1, 1, 1,
  ])
})
function compile(elements: any[]) {
  const scene = compileCircuitJson(elements)
  expect(scene.diagnostics).toEqual([])
  for (const l of scene.layers)
    for (const mesh of [l.paint, l.erase])
      expect([...mesh.vertices].every(Number.isFinite)).toBe(true)
  return scene
}
const layer = (scene: CompiledScene, name: string) =>
  scene.layers.find((l) => l.name === name)!
function bounds(mesh: Mesh) {
  const xs = [],
    ys = []
  for (let i = 0; i < mesh.vertices.length; i += 8) {
    xs.push(mesh.vertices[i])
    ys.push(mesh.vertices[i + 1])
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
}
function at(mesh: Mesh, x: number, y: number) {
  let color: number[] | undefined
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const points = [...mesh.indices.slice(i, i + 3)].map((j) => [
      mesh.vertices[j * 8],
      mesh.vertices[j * 8 + 1],
    ])
    const signs = points.map(([ax, ay], j) => {
      const [bx, by] = points[(j + 1) % 3]
      return (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    })
    if (signs.every((s) => s >= -1e-7) || signs.every((s) => s <= 1e-7))
      color = [
        ...mesh.vertices.slice(
          mesh.indices[i] * 8 + 2,
          mesh.indices[i] * 8 + 6,
        ),
      ]
  }
  return color
}
function mask(scene: CompiledScene, side: string, x: number, y: number) {
  const l = layer(scene, `soldermask_${side}`)
  return l && !at(l.erase, x, y) ? at(l.paint, x, y) : undefined
}

test("positive and negative margins change only the aperture, not copper", () => {
  for (const margin of [0.2, 0, -0.2, -2]) {
    const scene = compile([board, { ...pad, soldermask_margin: margin }])
    expect(bounds(layer(scene, "top").paint)).toEqual([-1, 1, -0.5, 0.5])
    const opening = layer(scene, "soldermask_top").erase
    if (margin === -2) expect(opening.indices.length).toBe(0)
    else
      for (const [i, v] of [
        -1 - margin,
        1 + margin,
        -0.5 - margin,
        0.5 + margin,
      ].entries())
        expect(bounds(opening)[i]).toBeCloseTo(v)
    if (margin < 0) expect(mask(scene, "top", 0.9, 0)).toBeDefined()
  }
})
test("asymmetric margins rotate in the pad's local frame", () => {
  const scene = compile([
    board,
    {
      ...pad,
      shape: "rotated_rect",
      ccw_rotation: 90,
      soldermask_margin: 0.1,
      soldermask_margin_left: 0.5,
      soldermask_margin_bottom: 0.3,
    },
  ])
  const b = bounds(layer(scene, "soldermask_top").erase)
  for (const [i, v] of [-0.6, 0.8, -1.5, 1.1].entries())
    expect(b[i]).toBeCloseTo(v)
})
test("circle, pill, rounded rectangle and polygon margins stay finite and preserve sides", () => {
  for (const shape of [
    { shape: "circle", radius: 1 },
    { shape: "pill", width: 3, height: 1 },
    { shape: "rotated_pill", width: 3, height: 1, ccw_rotation: 35 },
    { shape: "rect", width: 3, height: 2, corner_radius: 0.3 },
    {
      shape: "polygon",
      points: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
    },
  ])
    for (const margin of [-0.2, 0.2]) {
      const scene = compile([
        board,
        { ...pad, ...shape, layer: "bottom", soldermask_margin: margin },
      ])
      expect(layer(scene, "soldermask_top").erase.indices.length).toBe(0)
      expect(mask(scene, "bottom", 0, 0)).toBeUndefined()
      expect(
        layer(scene, "soldermask_bottom").erase.indices.length,
      ).toBeGreaterThan(0)
    }
})
test("covered pads override margin openings and use covered-copper shading", () => {
  const scene = compile([
    board,
    { ...pad, is_covered_with_solder_mask: true, soldermask_margin: 0.5 },
  ])
  expect(layer(scene, "soldermask_top").erase.indices.length).toBe(0)
  expect(mask(scene, "top", 0, 0)![1]).toBeCloseTo(135 / 255)
  expect(mask(scene, "top", 2, 0)![1]).toBeCloseTo(55 / 255)
})
test("hole and plated-hole mask margins never resize their physical drills", () => {
  for (const element of [
    {
      type: "pcb_hole",
      pcb_hole_id: "hole",
      hole_shape: "circle",
      x: 0,
      y: 0,
      hole_diameter: 1,
    },
    {
      ...via,
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "plated",
      shape: "circle",
    },
    {
      ...via,
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "slot",
      shape: "rotated_pill_hole_with_rect_pad",
      rect_pad_width: 4,
      rect_pad_height: 2,
      rect_ccw_rotation: 90,
      hole_width: 2,
      hole_height: 0.6,
      hole_ccw_rotation: 0,
      hole_offset_x: 0.2,
    },
    {
      ...via,
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "polygon",
      shape: "hole_with_polygon_pad",
      hole_shape: "circle",
      pad_outline: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
    },
  ]) {
    const original = compile([board, element])
    for (const margin of [-0.2, 0.2]) {
      const scene = compile([board, { ...element, soldermask_margin: margin }])
      expect(layer(scene, "drill").paint).toEqual(
        layer(original, "drill").paint,
      )
      expect(layer(scene, "board").erase).toEqual(
        layer(original, "board").erase,
      )
      expect(layer(scene, "soldermask_top").erase.vertices).not.toEqual(
        layer(original, "soldermask_top").erase.vertices,
      )
    }
  }
})
test("covered and negative-margin non-plated holes cover the drill without deleting it", () => {
  const hole = {
    type: "pcb_hole",
    pcb_hole_id: "hole",
    hole_shape: "circle",
    x: 0,
    y: 0,
    hole_diameter: 2,
  }
  const negative = compile([board, { ...hole, soldermask_margin: -0.3 }])
  expect(mask(negative, "top", 0.9, 0)).toBeDefined()
  expect(mask(negative, "top", 0, 0)).toBeUndefined()
  const covered = compile([
    board,
    { ...hole, is_covered_with_solder_mask: true },
  ])
  expect(mask(covered, "top", 0, 0)).toBeDefined()
  expect(bounds(layer(covered, "drill").paint)).toEqual([-1, 1, -1, 1])
})
test("via tenting precedence preserves explicit false and applies independently per side", () => {
  for (const legacy of [undefined, false, true])
    for (const top of [undefined, false, true])
      for (const bottom of [undefined, false, true]) {
        const scene = compile([
          {
            ...board,
            default_via_tented_on_top: true,
            default_via_tented_on_bottom: false,
          },
          {
            ...via,
            is_tented: legacy,
            tented_on_top: top,
            tented_on_bottom: bottom,
          },
        ])
        for (const [side, expected] of [
          ["top", top ?? legacy ?? true],
          ["bottom", bottom ?? legacy ?? false],
        ] as const) {
          expect(!!mask(scene, side, 0, 0)).toBe(expected)
          expect(!!mask(scene, side, 0.8, 0)).toBe(expected)
          if (expected) {
            expect(mask(scene, side, 0, 0)![1]).toBeCloseTo(68 / 255)
            expect(mask(scene, side, 0.8, 0)![1]).toBeCloseTo(135 / 255)
          }
        }
        expect(bounds(layer(scene, "drill").paint)).toEqual([
          -0.5, 0.5, -0.5, 0.5,
        ])
      }
})
test("via defaults resolve owning boards and nested subcircuits instead of the first board", () => {
  const scene = compile([
    { ...board, default_via_tented_on_top: true },
    {
      ...board,
      pcb_board_id: "other",
      subcircuit_id: "other",
      center: { x: 40, y: 0 },
      default_via_tented_on_top: false,
      default_via_tented_on_bottom: true,
    },
    {
      type: "source_group",
      source_group_id: "child",
      subcircuit_id: "child",
      parent_subcircuit_id: "other",
      is_subcircuit: true,
    },
    via,
    { ...via, pcb_via_id: "nested", subcircuit_id: "child", x: 40 },
  ])
  expect(mask(scene, "top", 0, 0)).toBeDefined()
  expect(mask(scene, "top", 40, 0)).toBeUndefined()
  expect(mask(scene, "bottom", 40, 0)).toBeDefined()
})
test("tented standalone vias work without a board and never invent an outer layer", () => {
  for (const layers of [
    ["top", "inner1"],
    ["inner1", "inner2"],
    ["inner1", "bottom"],
  ]) {
    const scene = compile([
      { ...via, layers, tented_on_top: true, tented_on_bottom: true },
    ])
    expect(!!mask(scene, "top", 0, 0)).toBe(layers.includes("top"))
    expect(!!mask(scene, "bottom", 0, 0)).toBe(layers.includes("bottom"))
    expect(scene.layers.some((l) => l.name === "drill")).toBe(false)
  }
})
test("route vias inherit trace ownership and dimensions, keep trace highlight IDs, and deduplicate standalone vias", () => {
  const trace = {
    type: "pcb_trace",
    pcb_trace_id: "trace",
    subcircuit_id: "board",
    route: [
      { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom" },
    ],
  }
  const b = {
    ...board,
    default_via_tented_on_top: true,
    min_via_hole_diameter: 0.8,
    min_via_pad_diameter: 1.6,
  }
  const scene = compile([b, trace])
  expect(mask(scene, "top", 0, 0)).toBeDefined()
  expect(bounds(layer(scene, "drill").paint)[0]).toBeCloseTo(-0.4)
  expect(scene.elementIds).toEqual(["board", "trace"])
  expect(layer(scene, "drill").paint.vertices[6]).toBe(1)
  const standalone = { ...via, tented_on_top: false }
  const dedup = compile([b, trace, standalone])
  expect(layer(dedup, "drill").paint.indices.length).toBe(
    layer(compile([b, standalone]), "drill").paint.indices.length,
  )
  expect(mask(dedup, "top", 0, 0)).toBeUndefined()
})
test("pad and standalone openings cut tenting regardless of input order", () => {
  for (const opening of [
    { ...pad, width: 0.4, height: 0.4 },
    {
      type: "pcb_soldermask_opening",
      pcb_soldermask_opening_id: "opening",
      shape: "rect",
      layer: "top",
      x: 0,
      y: 0,
      width: 0.4,
      height: 0.4,
    },
  ])
    for (const reverse of [false, true]) {
      const items = [
        board,
        { ...via, tented_on_top: true, tented_on_bottom: true },
        opening,
      ]
      const scene = compile(reverse ? items.reverse() : items)
      expect(mask(scene, "top", 0, 0)).toBeUndefined()
      expect(mask(scene, "top", 0.8, 0)).toBeDefined()
      expect(mask(scene, "bottom", 0, 0)).toBeDefined()
    }
})
test("covered pours preserve negative pad apertures; uncovered pours expose copper", () => {
  const pour = {
    type: "pcb_copper_pour",
    pcb_copper_pour_id: "pour",
    shape: "rect",
    layer: "top",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
    covered_with_solder_mask: true,
  }
  const scene = compile([board, { ...pad, soldermask_margin: -0.2 }, pour])
  expect(mask(scene, "top", 0, 0)).toBeUndefined()
  expect(mask(scene, "top", 0.9, 0)).toBeDefined()
  const exposed = compile([board, { ...pour, covered_with_solder_mask: false }])
  expect(mask(exposed, "top", 2, 0)).toBeUndefined()
})
test("layer aliases and translucent colors never make apertures partially transparent", () => {
  expect(normalizeLayer("top_soldermask")).toBe("soldermask_top")
  const scene = compileCircuitJson([board, pad] as any, {
    layerColors: { soldermask_top: [0, 1, 0, 0.5] },
  })
  const erase = layer(scene, "soldermask_top").erase
  for (let i = 5; i < erase.vertices.length; i += 8)
    expect(erase.vertices[i]).toBe(1)
})
test("cutouts erase the mask, substrate and copper while retaining drill color", () => {
  const scene = compile([
    board,
    { ...pad, is_covered_with_solder_mask: true },
    {
      type: "pcb_cutout",
      pcb_cutout_id: "cutout",
      shape: "rect",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
    },
  ])
  expect(mask(scene, "top", 0, 0)).toBeUndefined()
  expect(at(layer(scene, "substrate").erase, 0, 0)).toBeDefined()
  expect(at(layer(scene, "drill").paint, 0, 0)).toBeDefined()
})
