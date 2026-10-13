import assert from "node:assert/strict"
import { test, expect } from "bun:test"
import { prepareComparison } from "./parity/prepare.ts"
import { renderComparisonSvg } from "./parity/render-svg"
const fixture = {
  width: 400,
  height: 200,
  matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  contextTransform: { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 },
  options: {},
  elements: [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad",
      shape: "rect",
      x: 50,
      y: 25,
      width: 5,
      height: 5,
      layer: "top",
    },
  ],
}
test("SVG and WebGPU share one viewport and canonical y-up camera", () => {
  const { scene } = prepareComparison(fixture)
  assert(scene)
  expect(scene.elements).toBe(fixture.elements)
  expect(scene.viewport).toEqual({ minX: 0, maxX: 100, minY: 0, maxY: 50 })
  expect(scene.transform).toEqual({ a: 4, b: 0, c: 0, d: -4, e: 0, f: 200 })
  expect(scene.background).toBe("#000000")
})
test("layer filtering supplies the same subset to both renderers", () => {
  const top = {
      type: "pcb_silkscreen_text",
      layer: "top",
      text: "Top",
      anchor_position: { x: 0, y: 0 },
    },
    bottom = { ...top, layer: "bottom", text: "Bottom" }
  const { scene } = prepareComparison({
    ...fixture,
    elements: [top, bottom, ...fixture.elements],
    options: { layers: ["top_silkscreen"] },
  })
  assert(scene)
  expect(scene.elements).toEqual([top])
  expect(scene.layer).toBe("top")
  expect(scene.layers).toContain("top_silkscreen")
})
test("Canvas-only passes are not mislabeled as SVG comparisons", () => {
  for (const extra of [
    { primitive: { shape: "circle" } },
    { sourceFunction: "drawPcbTrace" },
    { options: { clipContextElements: [] } },
    { options: { layers: ["top_soldermask"] } },
    { options: { layers: ["bottom_copper", "top_user_note"] } },
  ])
    expect(prepareComparison({ ...fixture, ...extra }).reason).toBeTruthy()
})

test("soldermask comparisons render the board mask in SVG and allow it through the GPU layer filter", () => {
  for (const type of ["pcb_board", "pcb_panel"]) {
    for (const side of ["top", "bottom"] as const) {
      for (const filtered of [false, true]) {
        const { scene } = prepareComparison({
          ...fixture,
          elements: [
            {
              type,
              [`${type}_id`]: "surface",
              center: { x: 50, y: 25 },
              width: 80,
              height: 40,
            },
            ...(type === "pcb_panel"
              ? [
                  {
                    type: "pcb_board",
                    pcb_board_id: "child",
                    center: { x: 50, y: 25 },
                    width: 60,
                    height: 30,
                  },
                ]
              : []),
          ],
          options: {
            layers: filtered ? [`${side}_copper`] : undefined,
            drawSoldermask: true,
            drawSoldermaskTop: side === "top",
            drawSoldermaskBottom: side === "bottom",
          },
        })
        assert(scene)
        expect(scene.layer).toBe(side)
        expect(scene.showSolderMask).toBe(true)
        if (filtered) {
          expect(scene.layers).toContain(`soldermask_${side}`)
          expect(scene.layers).toContain("substrate")
        }
        // Exercise the same SVG entry point as the audit, not just its options.
        const svg = renderComparisonSvg(scene)
        expect(svg).toContain('class="pcb-board-soldermask"')
        expect(svg).toContain(`data-pcb-layer="soldermask-${side}"`)
        expect(scene.viewport).toEqual({
          minX: 0,
          maxX: 100,
          minY: 0,
          maxY: 50,
        })
      }
    }
  }
})

test("soldermask defaults to top and explicit side flags do not enable the wrong surface", () => {
  for (const [options, visible] of [
    [{ drawSoldermask: true }, true],
    [{ drawSoldermask: false, drawSoldermaskTop: true }, false],
    [
      {
        drawSoldermask: true,
        drawSoldermaskTop: false,
        drawSoldermaskBottom: false,
      },
      false,
    ],
    [
      {
        layers: ["top_copper"],
        drawSoldermask: true,
        drawSoldermaskBottom: true,
      },
      false,
    ],
    [{ layers: ["inner1_copper"], drawSoldermask: true }, false],
  ] as const) {
    const { scene } = prepareComparison({
      ...fixture,
      elements: [
        {
          type: "pcb_board",
          pcb_board_id: "board",
          center: { x: 50, y: 25 },
          width: 80,
          height: 40,
        },
      ],
      options: {
        ...options,
        layers: "layers" in options ? [...options.layers] : undefined,
      },
    })
    assert(scene)
    expect(scene.showSolderMask).toBe(visible)
    expect(
      renderComparisonSvg(scene).includes('class="pcb-board-soldermask"'),
    ).toBe(visible)
    if (visible) expect(scene.layer).toBe("top")
  }
})
