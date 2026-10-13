import { expect, test } from "bun:test"
import { compileCircuitJson } from "../lib"
import { drawKeepout } from "../lib/draw-keepout"
import {
  ellipse,
  expandBrepRing,
  MeshBuilder,
  rectangle,
} from "../lib/geometry"
import { fixtures, silkscreenGraphics } from "../site/fixtures"
import large from "./fixtures/am3352-dev-board.circuit.json"
import breakout from "./fixtures/f1c100s-breakout.circuit.json"
import museSockets from "./fixtures/muse-socket-plated-holes.circuit.json"

function area(mesh: ReturnType<MeshBuilder["build"]>) {
  let area = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [...mesh.indices.slice(i, i + 3)].map((j) => ({
      x: mesh.vertices[j * 8],
      y: mesh.vertices[j * 8 + 1],
    }))
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
  }
  return area
}

test("through-pad layer transitions connect each wire to its pad anchor", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      route: [
        { route_type: "wire", x: -4, y: 1, width: 0.4, layer: "top" },
        {
          route_type: "through_pad",
          start: { x: -1, y: 1 },
          end: { x: 1, y: -1 },
          start_layer: "top",
          end_layer: "bottom",
          width: 0.4,
        },
        { route_type: "wire", x: 4, y: -1, width: 0.4, layer: "bottom" },
      ],
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["top", "bottom"])
  expect(area(scene.layers[0].paint)).toBeCloseTo(2.58, 3)
  expect(area(scene.layers[1].paint)).toBeCloseTo(2.58, 3)
  const vertexStride = 8
  const topX = scene.layers[0].paint.vertices.filter(
    (_, i) => i % vertexStride === 0,
  )
  const bottomX = scene.layers[1].paint.vertices.filter(
    (_, i) => i % vertexStride === 0,
  )
  expect(Math.max(...topX)).toBeCloseTo(1.2)
  expect(Math.min(...bottomX)).toBeCloseTo(-1.2)
})

test("through-pad anchors do not connect wires on unrelated layers", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      route: [
        { route_type: "wire", x: -4, y: 0, width: 0.4, layer: "bottom" },
        {
          route_type: "through_pad",
          start: { x: 0, y: 0 },
          end: { x: 0, y: 0 },
          start_layer: "top",
          end_layer: "bottom",
          width: 0.4,
        },
        { route_type: "wire", x: 4, y: 0, width: 0.4, layer: "top" },
      ],
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["top", "bottom"])
  expect(area(scene.layers[0].paint)).toBeCloseTo(0.124, 3)
  expect(area(scene.layers[1].paint)).toBeCloseTo(0.124, 3)
})

test("a same-layer through-pad span is drawn once", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      route: [
        {
          route_type: "through_pad",
          start: { x: -1, y: 0 },
          end: { x: 1, y: 0 },
          start_layer: "top",
          end_layer: "top",
          width: 0.4,
        },
      ],
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["top"])
  expect(area(scene.layers[0].paint)).toBeCloseTo(0.924, 3)
})

test("rectangular soldermask openings erase only the selected mask layer", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      thickness: 1.6,
      num_layers: 2,
      material: "fr4",
    },
    {
      type: "pcb_copper_pour",
      pcb_copper_pour_id: "pour",
      covered_with_solder_mask: true,
      shape: "rect",
      layer: "top",
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
    },
    {
      type: "pcb_soldermask_opening",
      pcb_soldermask_opening_id: "opening",
      shape: "rect",
      layer: "top",
      x: 0,
      y: 0,
      width: 4,
      height: 2,
    },
  ])
  expect(scene.diagnostics).toEqual([])
  const mask = scene.layers.find((layer) => layer.name === "soldermask_top")!
  // Board surface plus the covered copper pour's lighter mask overlay.
  expect(area(mask.paint)).toBeCloseTo(164)
  expect(area(mask.erase)).toBeCloseTo(8)
  expect(
    scene.layers
      .filter((layer) => layer.erase.indices.length > 0)
      .map((layer) => layer.name),
  ).toEqual(["soldermask_top"])
  expect(
    area(scene.layers.find((layer) => layer.name === "top")!.paint),
  ).toBeCloseTo(64)
  expect(
    area(scene.layers.find((layer) => layer.name === "board")!.paint),
  ).toBeCloseTo(100)
  expect(scene.layers.some((layer) => layer.name === "drill")).toBe(false)
})

test("circular soldermask openings work without a board or copper", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_soldermask_opening",
      pcb_soldermask_opening_id: "opening",
      shape: "circle",
      layer: "bottom",
      x: 3,
      y: -2,
      radius: 1,
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["soldermask_bottom"])
  expect(scene.layers[0].paint.indices.length).toBe(0)
  expect(area(scene.layers[0].erase)).toBeCloseTo(Math.PI, 1)
})

test("rotated rectangular soldermask openings preserve position and rotation", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_soldermask_opening",
      pcb_soldermask_opening_id: "opening",
      shape: "rotated_rect",
      layer: "bottom",
      x: 3,
      y: -2,
      width: 4,
      height: 2,
      ccw_rotation: 90,
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["soldermask_bottom"])
  const mesh = scene.layers[0].erase
  expect(area(mesh)).toBeCloseTo(8)
  const xs = [...mesh.vertices].filter((_, index) => index % 8 === 0)
  const ys = [...mesh.vertices].filter((_, index) => index % 8 === 1)
  expect([Math.min(...xs), Math.max(...xs)]).toEqual([2, 4])
  expect(Math.min(...ys)).toBeCloseTo(-4)
  expect(Math.max(...ys)).toBeCloseTo(0)
})

test("polygon soldermask openings preserve concave boundaries", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_soldermask_opening",
      pcb_soldermask_opening_id: "opening",
      shape: "polygon",
      layer: "top",
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 3 },
        { x: 0, y: 3 },
      ],
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers.map((layer) => layer.name)).toEqual(["soldermask_top"])
  expect(scene.layers[0].paint.indices.length).toBe(0)
  expect(area(scene.layers[0].erase)).toBeCloseTo(5)
})
// Repro: <board width="10mm" height="10mm">
//   <cutout shape="rect" width="6mm" height="4mm" />
// </board>
test("rectangular cutouts paint the drill layer without erasing their fill", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      thickness: 1.6,
      num_layers: 2,
      material: "fr4",
    },
    {
      type: "pcb_cutout",
      pcb_cutout_id: "cutout",
      shape: "rect",
      center: { x: 0, y: 0 },
      width: 6,
      height: 4,
    },
  ])
  const drill = scene.layers.find((layer) => layer.name === "drill")!
  expect(scene.diagnostics).toEqual([])
  expect(drill).toBeDefined()
  expect(area(drill.paint)).toBeCloseTo(24)
  expect([...drill.paint.vertices.slice(2, 6)]).toEqual([
    ...new Float32Array([1, 38 / 255, 226 / 255, 1]),
  ])
  expect(drill.erase.indices.length).toBe(0)
  expect(
    area(scene.layers.find((layer) => layer.name === "board")!.erase),
  ).toBeCloseTo(24)
})

test("cutouts still erase overlapping copper", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_cutout",
      pcb_cutout_id: "cutout",
      shape: "rect",
      center: { x: 0, y: 0 },
      width: 6,
      height: 4,
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad",
      pcb_component_id: "component",
      shape: "rect",
      layer: "top",
      x: 0,
      y: 0,
      width: 8,
      height: 6,
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(
    area(scene.layers.find((layer) => layer.name === "top")!.erase),
  ).toBeCloseTo(24)
  const drill = scene.layers.find((layer) => layer.name === "drill")!
  expect(drill).toBeDefined()
  expect(area(drill.paint)).toBeCloseTo(24)
  expect(drill.erase.indices.length).toBe(0)
})

test("triangulation preserves polygon holes", () => {
  const mesh = new MeshBuilder()
  mesh.polygon([
    rectangle({ x: 0, y: 0 }, 10, 10),
    rectangle({ x: 0, y: 0 }, 4, 4),
  ])
  expect(area(mesh.build())).toBeCloseTo(84)
})
test("rounded and rotated pads retain their areas", () => {
  const mesh = new MeshBuilder()
  mesh.polygon([rectangle({ x: 2, y: 3 }, 8, 4, 2, 37)])
  expect(area(mesh.build())).toBeCloseTo(16 + Math.PI * 4, 1)
})
test("bulge arcs expand in the correct direction", () => {
  const ring = expandBrepRing([
    { x: -1, y: 0, bulge: 1 },
    { x: 1, y: 0 },
  ])
  expect(Math.min(...ring.map((p) => p.y))).toBeCloseTo(-1)
  expect(Math.max(...ring.map((p) => p.y))).toBe(0)
})
test("circle tessellation has finite coordinates and correct area", () => {
  const mesh = new MeshBuilder()
  mesh.polygon([ellipse({ x: 0, y: 0 }, 4)])
  expect(area(mesh.build())).toBeCloseTo(Math.PI * 4, 1)
})
for (const [name, fixture] of Object.entries(fixtures))
  test(`compiles ${name} without missing geometry`, () => {
    const scene = compileCircuitJson(fixture.elements)
    expect(scene.diagnostics).toEqual([])
    expect(scene.triangleCount).toBeGreaterThan(0)
    for (const layer of scene.layers)
      for (const mesh of [layer.paint, layer.erase]) {
        expect([...mesh.vertices].every(Number.isFinite)).toBe(true)
        expect(
          [...mesh.indices].every((i) => i < mesh.vertices.length / 8),
        ).toBe(true)
      }
  })
test("reports unsupported shapes instead of silently hiding them", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "bad",
      layer: "top",
      shape: "future_shape",
    },
  ] as any)
  expect(scene.diagnostics[0].elementId).toBe("bad")
})
test("AM3352 compiles without unsupported PCB geometry", () => {
  const scene = compileCircuitJson(large as any)
  expect(scene.diagnostics).toEqual([])
  expect(scene.triangleCount).toBeGreaterThan(100000)
})

test("F1C100S breakout routing targets do not fail or change rendered geometry", () => {
  const scene = compileCircuitJson(breakout as any)
  const geometry = breakout.filter((e) => e.type !== "pcb_breakout_point")
  const reference = compileCircuitJson(geometry as any)
  expect(scene.diagnostics).toEqual([])
  expect(scene.elementIds).toContain("pcb_breakout_point_0")
  expect(scene.triangleCount).toBeGreaterThan(0)
  expect(scene.triangleCount).toBe(reference.triangleCount)
  expect(scene.layers.map((l) => l.name)).toEqual(
    reference.layers.map((l) => l.name),
  )
  for (const [i, layer] of scene.layers.entries()) {
    for (const kind of ["paint", "erase"] as const) {
      const actual = layer[kind],
        expected = reference.layers[i][kind]
      expect(actual.indices).toEqual(expected.indices)
      expect(actual.vertices.length).toBe(expected.vertices.length)
      for (let j = 0; j < actual.vertices.length; j++) {
        // Adding metadata shifts indices, but highlighting must still refer to
        // the same rendered element. All other vertex attributes stay identical.
        if (j % 8 === 6)
          expect(scene.elementIds[actual.vertices[j]]).toBe(
            reference.elementIds[expected.vertices[j]],
          )
        else expect(actual.vertices[j]).toBe(expected.vertices[j])
      }
    }
  }
})

test("breakout routing targets alone produce no renderable geometry", () => {
  const scene = compileCircuitJson(
    breakout.filter((e) => e.type === "pcb_breakout_point") as any,
  )
  expect(scene.diagnostics).toEqual([])
  expect(scene.layers).toEqual([])
  expect(scene.triangleCount).toBe(0)
  expect(scene.elementIds).toEqual(["pcb_breakout_point_0"])
})

test("wire-to-via segments stay on the adjacent layer without bridging other runs", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_trace",
      pcb_trace_id: "transition",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 1, layer: "top" },
        {
          route_type: "via",
          x: 5,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        { route_type: "wire", x: 10, y: 0, width: 1, layer: "bottom" },
        { route_type: "wire", x: 100, y: 0, width: 1, layer: "inner1" },
      ],
    },
  ] as any)
  expect(scene.layers.some((l) => l.name === "inner1")).toBe(false)
  expect(scene.layers.some((l) => l.name === "drill")).toBe(true)
  expect(area(scene.layers.find((l) => l.name === "top")!.paint)).toBeCloseTo(
    5 + Math.PI / 4 + Math.PI * 0.3 ** 2,
    1,
  )
})

test("square holes compile, including rotated holes", () => {
  for (const ccw_rotation of [0, 45]) {
    const scene = compileCircuitJson([
      {
        type: "pcb_hole",
        pcb_hole_id: "square",
        hole_shape: "square",
        hole_diameter: 2,
        x: 0,
        y: 0,
        ccw_rotation,
      },
    ] as any)
    expect(scene.diagnostics).toEqual([])
    const erase = scene.layers.flatMap((l) => [...l.erase.vertices])
    expect(erase.length).toBeGreaterThan(0)
    expect(erase.every(Number.isFinite)).toBe(true)
  }
})

test("silkscreen graphics preserve filled areas, holes, arcs, layers, and IDs", () => {
  const scene = compileCircuitJson(silkscreenGraphics)
  expect(scene.diagnostics).toEqual([])
  expect(scene.elementIds).toEqual(["top-graphic", "bottom-graphic"])
  expect(scene.layers.map((layer) => layer.name)).toEqual([
    "top_silkscreen",
    "bottom_silkscreen",
  ])
  // Square with a circular hole; circle with two square holes.
  const expectedAreas = [144 - Math.PI * 9, Math.PI * 36 - 8]
  for (const [index, layer] of scene.layers.entries()) {
    expect(Math.abs(area(layer.paint) - expectedAreas[index])).toBeLessThan(
      0.15,
    )
    expect(layer.erase.indices.length).toBe(0)
    const xs = []
    for (let i = 0; i < layer.paint.vertices.length; i += 8) {
      xs.push(layer.paint.vertices[i])
      expect(layer.paint.vertices[i + 6]).toBe(index)
    }
    expect(Math.min(...xs)).toBeCloseTo(index === 0 ? -18 : 6)
    expect(Math.max(...xs)).toBeCloseTo(index === 0 ? -6 : 18)
  }
})

test("silkscreen graphics without inner rings remain filled", () => {
  const graphic = silkscreenGraphics[0]
  const scene = compileCircuitJson([
    {
      ...graphic,
      brep_shape: {
        outer_ring: graphic.brep_shape.outer_ring,
        inner_rings: [],
      },
    },
  ])
  expect(scene.diagnostics).toEqual([])
  expect(area(scene.layers[0].paint)).toBeCloseTo(144)
})

test("unsupported silkscreen graphic shapes still report a diagnostic", () => {
  const scene = compileCircuitJson([
    {
      ...silkscreenGraphics[0],
      shape: "future_shape",
    },
  ] as any)
  expect(scene.diagnostics).toHaveLength(1)
  expect(scene.diagnostics[0].elementId).toBe("top-graphic")
  expect(scene.triangleCount).toBe(0)
})

test("keepouts overlay later copper with translucent fill and clipped stripes on every layer", () => {
  const scene = compileCircuitJson(fixtures["keepouts-top"].elements)
  expect(scene.diagnostics).toEqual([])
  for (const name of ["top", "inner1", "bottom"]) {
    const mesh = scene.layers.find((layer) => layer.name === name)!.paint
    const keepoutIndex = scene.elementIds.indexOf("mounting-keepout")
    const pourIndex = scene.elementIds.indexOf(`keepout-pour-${name}`)
    const vertices = Array.from(
      { length: mesh.vertices.length / 8 },
      (_, i) => [...mesh.vertices.slice(i * 8, i * 8 + 8)],
    )
    const marking = vertices.filter((v) => v[6] === keepoutIndex)
    expect(marking.some((v) => Math.abs(v[5] - 0.2) < 1e-6)).toBe(true)
    expect(marking.some((v) => v[5] === 1)).toBe(true)
    expect(vertices.findIndex((v) => v[6] === keepoutIndex)).toBeGreaterThan(
      vertices.length -
        1 -
        [...vertices].reverse().findIndex((v) => v[6] === pourIndex),
    )
    for (const v of marking)
      expect(Math.hypot(v[0] + 10, v[1])).toBeLessThanOrEqual(6.00001)
  }
})

test("keepout fill and stripes preserve holes in concave polygons", () => {
  const mesh = new MeshBuilder()
  drawKeepout(mesh, [
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 8 },
      { x: 0, y: 8 },
    ],
    rectangle({ x: 2, y: 2 }, 2, 2),
  ])
  let fillArea = 0,
    stripeArea = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = mesh.indices
      .slice(i, i + 3)
      .map((j) => ({ x: mesh.vertices[j * 8], y: mesh.vertices[j * 8 + 1] }))
    const center = {
      x: triangle.reduce((s, p) => s + p.x, 0) / 3,
      y: triangle.reduce((s, p) => s + p.y, 0) / 3,
    }
    expect(center.x > 4 && center.y > 4).toBe(false)
    expect(center.x > 1 && center.x < 3 && center.y > 1 && center.y < 3).toBe(
      false,
    )
    const [a, b, c] = triangle
    const area =
      Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    if (mesh.vertices[mesh.indices[i] * 8 + 5] === 0.2) fillArea += area
    else stripeArea += area
  }
  expect(fillArea).toBeCloseTo(44)
  expect(stripeArea).toBeGreaterThan(0)
  expect(stripeArea).toBeLessThan(fillArea)
})

function meshBounds(mesh: ReturnType<MeshBuilder["build"]>) {
  const xs: number[] = [],
    ys: number[] = []
  for (let i = 0; i < mesh.vertices.length; i += 8) {
    xs.push(mesh.vertices[i])
    ys.push(mesh.vertices[i + 1])
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
}

test("Muse imported socket pads compile on both copper layers and through the board", () => {
  const scene = compileCircuitJson(museSockets as any)
  expect(scene.diagnostics).toEqual([])
  for (const name of [
    "top",
    "bottom",
    "soldermask_top",
    "soldermask_bottom",
    "board",
    "drill",
  ]) {
    const layer = scene.layers.find((l) => l.name === name)!
    const mesh =
      name === "board" || name.startsWith("soldermask")
        ? layer.erase
        : layer.paint
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true)
  }
  for (const name of ["top", "bottom"]) {
    const layer = scene.layers.find((l) => l.name === name)!
    expect(area(layer.paint)).toBeCloseTo(2 * 1.5999968 ** 2)
    expect(area(layer.erase)).toBeCloseTo(2 * Math.PI * (1.0499852 / 2) ** 2, 2)
  }
})

test("rotated pill holes have independent pad and drill rotations and world-space offsets", () => {
  for (const explicitHoleShape of [false, true]) {
    const scene = compileCircuitJson([
      {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: "rotated-slot",
        shape: "rotated_pill_hole_with_rect_pad",
        ...(explicitHoleShape
          ? { hole_shape: "rotated_pill", pad_shape: "rect" }
          : {}),
        x: 10,
        y: 20,
        rect_pad_width: 8,
        rect_pad_height: 6,
        rect_ccw_rotation: 90,
        hole_width: 4,
        hole_height: 2,
        hole_ccw_rotation: 0,
        hole_offset_x: 0.5,
        hole_offset_y: -0.25,
        layers: ["top", "inner1", "bottom"],
      },
    ] as any)
    expect(scene.diagnostics).toEqual([])
    for (const name of ["top", "inner1", "bottom"]) {
      const layer = scene.layers.find((l) => l.name === name)!
      expect(meshBounds(layer.paint)).toEqual([7, 13, 16, 24])
      const drillBounds = meshBounds(layer.erase)
      // The slot stays horizontal when the rectangular pad rotates vertically.
      for (const [i, expected] of [8.5, 12.5, 18.75, 20.75].entries())
        expect(drillBounds[i]).toBeCloseTo(expected, 2)
      expect(area(layer.paint)).toBeCloseTo(48)
      expect(area(layer.erase)).toBeCloseTo(4 + Math.PI, 2)
    }
    const drill = scene.layers.find((l) => l.name === "drill")!.paint
    for (const name of ["board", "soldermask_top", "soldermask_bottom"])
      expect(
        scene.layers.find((l) => l.name === name)!.erase.vertices.length,
      ).toBeGreaterThan(0)
    const erase = scene.layers.find((l) => l.name === "top")!.erase
    expect(drill.vertices.length).toBe(erase.vertices.length)
    for (let i = 0; i < drill.vertices.length; i += 8) {
      expect(drill.vertices[i]).toBe(erase.vertices[i])
      expect(drill.vertices[i + 1]).toBe(erase.vertices[i + 1])
    }
  }
})

test("rounded rectangular pads stay rectangular while their slots rotate independently", () => {
  const scene = compileCircuitJson([
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "rounded-slot",
      shape: "rotated_pill_hole_with_rect_pad",
      hole_shape: "rotated_pill",
      x: 0,
      y: 0,
      rect_pad_width: 8,
      rect_pad_height: 6,
      rect_border_radius: 0.5,
      rect_ccw_rotation: 0,
      hole_width: 4,
      hole_height: 2,
      hole_ccw_rotation: 90,
      layers: ["top", "bottom"],
    },
  ] as any)
  expect(scene.diagnostics).toEqual([])
  const layer = scene.layers.find((l) => l.name === "top")!
  expect(area(layer.paint)).toBeCloseTo(48 - (4 - Math.PI) * 0.5 ** 2, 2)
  for (const [i, expected] of [-1, 1, -2, 2].entries())
    expect(meshBounds(layer.erase)[i]).toBeCloseTo(expected, 2)
})

const fabricationPath = {
  type: "pcb_fabrication_note_path" as const,
  pcb_fabrication_note_path_id: "solid-region",
  pcb_component_id: "component",
  layer: "top" as const,
  route: [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 8 },
    { x: 0, y: 8 },
  ],
  stroke_width: 2,
}

function compileTranslatedFabricationPath({
  layer,
  route,
}: {
  layer: "top" | "bottom"
  route: typeof fabricationPath.route
}) {
  return compileCircuitJson([
    { ...fabricationPath, layer, route, stroke_width: 0.254 },
  ])
}

test("fabrication path fills triangulate concave regions without widening them", () => {
  for (const layer of ["top", "bottom"] as const) {
    for (const route of [
      fabricationPath.route,
      [...fabricationPath.route, fabricationPath.route[0]],
    ]) {
      const path = {
        ...fabricationPath,
        layer,
        route,
        is_filled: true,
        has_stroke: false,
        color: "rgba(255,0,0,0.5)",
      }
      const scene = compileCircuitJson([path])
      expect(scene.diagnostics).toEqual([])
      const mesh = scene.layers.find(
        (l) => l.name === `${layer}_fabrication`,
      )!.paint
      expect(area(mesh)).toBeCloseTo(48)
      expect(meshBounds(mesh)).toEqual([0, 8, 0, 8])
      expect([...mesh.vertices.slice(2, 6)]).toEqual([1, 0, 0, 0.5])
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const triangle = [...mesh.indices.slice(i, i + 3)]
        const x = triangle.reduce((sum, j) => sum + mesh.vertices[j * 8], 0) / 3
        const y =
          triangle.reduce((sum, j) => sum + mesh.vertices[j * 8 + 1], 0) / 3
        expect(x > 4 && y > 4).toBe(false)
      }
    }
  }
})

test("fabrication paths retain optional strokes, close filled outlines, and ignore disabled geometry", () => {
  const compile = (
    flags: {
      is_filled?: boolean
      has_stroke?: boolean
      stroke_width?: number
    } = {},
  ) => compileCircuitJson([{ ...fabricationPath, ...flags }]).layers[0].paint
  const legacy = compile()
  expect(compile({ is_filled: false, has_stroke: true })).toEqual(legacy)
  const filled = compile({ is_filled: true })
  expect(area(filled)).toBeGreaterThan(48)
  expect(area(filled)).toBeLessThan(area(legacy) + 48)
  expect(area(compile({ is_filled: true, stroke_width: 0 }))).toBeCloseTo(48)
  expect(compile({ has_stroke: false }).indices.length).toBe(0)
  for (const route of [[], [{ x: 0, y: 0 }]]) {
    const path = { ...fabricationPath, route, is_filled: true }
    const scene = compileCircuitJson([path])
    expect(scene.diagnostics).toEqual([])
    expect(scene.triangleCount).toBe(0)
  }
})

test("fabrication path tessellation unions retraced segments instead of stacking triangles", () => {
  const single = new MeshBuilder()
  single.fabricationPath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    2,
    false,
  )
  const retraced = new MeshBuilder()
  retraced.fabricationPath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    2,
    false,
  )
  expect(area(retraced.build())).toBeCloseTo(area(single.build()), 5)
  const closed = new MeshBuilder()
  closed.fabricationPath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ],
    2,
    false,
  )
  // A square stroked with round outer corners retains its unpainted center.
  expect(area(closed.build())).toBeCloseTo(
    80 - 4 + 12 * Math.sin(Math.PI / 12),
    4,
  )
})

test("translated fabrication paths tolerate round-cap floating-point noise", () => {
  for (const layer of ["top", "bottom"] as const) {
    for (const x of [-11.299999199999984, 6.600000800000018]) {
      const y = 0.4999999999999997
      for (const route of [
        [
          { x, y },
          { x: x + 1, y: y + 0.000001 },
          { x, y },
        ],
        [
          { x, y },
          { x: x + 0.1, y: y + 0.1 },
          { x: x + 0.1, y },
          { x, y },
        ],
      ]) {
        const scene = compileTranslatedFabricationPath({ layer, route })
        expect(scene.diagnostics).toEqual([])
        const mesh = scene.layers.find(
          (l) => l.name === `${layer}_fabrication`,
        )!.paint
        expect(mesh.indices.length).toBeGreaterThan(0)
        expect([...mesh.vertices].every(Number.isFinite)).toBe(true)
        const origin = compileTranslatedFabricationPath({
          layer,
          route: route.map((p) => ({ x: p.x - x, y: p.y - y })),
        })
        expect(origin.diagnostics).toEqual([])
        expect(area(mesh)).toBeCloseTo(area(origin.layers[0].paint), 5)
        // Reversing or retracing the path must preserve coverage, applying alpha once.
        const reversed = compileTranslatedFabricationPath({
          layer,
          route: [...route].reverse(),
        })
        const retraced = compileTranslatedFabricationPath({
          layer,
          route: [...route, ...route.slice(1)],
        })
        for (const equivalent of [reversed, retraced]) {
          expect(equivalent.diagnostics).toEqual([])
          expect(area(equivalent.layers[0].paint)).toBeCloseTo(area(mesh), 5)
          expect(meshBounds(equivalent.layers[0].paint)).toEqual(
            meshBounds(mesh),
          )
        }
      }
    }
  }
})
