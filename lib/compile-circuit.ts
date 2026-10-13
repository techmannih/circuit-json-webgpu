import {
  getWireTaperPolygon,
  getWireTaperSegments,
  hasWireTaper,
} from "./get-wire-taper-polygon"
import { drawKeepout } from "./draw-keepout"
import { drawPcbDimension } from "./pcb-dimension/draw-pcb-dimension"
import { drawText } from "./text/draw-text"
import { DEFAULT_LAYER_COLORS, normalizeLayer, parseColor } from "./colors"
import { ellipse, MeshBuilder, rectangle } from "./geometry"
import type { CircuitJson, CompiledScene, Diagnostic, Point } from "./types"

import { getElementShape as shape, type Element } from "./get-element-shape"
import { compileSoldermask } from "./soldermask/compile-soldermask"
import { prepareVias } from "./soldermask/prepare-vias"
function center(e: Element): Point {
  return e.center ?? e.anchor_position ?? { x: e.x ?? 0, y: e.y ?? 0 }
}
export function getElementId(element: Element, index = 0): string {
  return element[`${element.type}_id`] ?? `${element.type}:${index}`
}
/** Pure, DOM-free compiler. Exposes unsupported geometry rather than silently hiding it. */
export function compileCircuitJson(
  elements: CircuitJson,
  options: {
    textYAxis?: "up" | "down"
    layerColors?: Record<string, import("./types").Color>
  } = {},
): CompiledScene {
  const { renderElements, boardOwnerMap } = prepareVias(elements)
  const builders = new Map<string, { paint: MeshBuilder; erase: MeshBuilder }>()
  const diagnostics: Diagnostic[] = [],
    elementIds = elements.map(getElementId)
  const board = elements.find((e) => e.type === "pcb_board") as
    | Element
    | undefined
  const copper = [
    "top",
    ...Array.from(
      { length: Math.max(0, Math.min(8, (board?.num_layers ?? 2) - 2)) },
      (_, i) => `inner${i + 1}`,
    ),
    "bottom",
  ]
  const get = (name: string, index: number, erase = false, category = 0) => {
    name = normalizeLayer(name)
    if (!builders.has(name))
      builders.set(name, { paint: new MeshBuilder(), erase: new MeshBuilder() })
    const mesh = builders.get(name)![erase ? "erase" : "paint"]
    mesh.color = erase
      ? [0, 0, 0, 1]
      : (options.layerColors?.[name] ??
        DEFAULT_LAYER_COLORS[name] ?? [0.75, 0.75, 0.75, 1])
    mesh.element = index
    mesh.category = category
    return mesh
  }
  const openings: { element: Element; index: number; layers: string[] }[] = []
  const keepouts: { rings: Point[][]; index: number; layers: string[] }[] = []
  const cutouts: { rings: Point[][]; index: number }[] = []
  for (const { element: input, index } of renderElements) {
    const e = input as Element,
      type: string = e.type
    try {
      if (type === "pcb_board" || type === "pcb_panel") {
        const rings = shape(e)
        get("board", index).polygon(rings)
        for (const ring of rings) get("edge_cuts", index).path(ring, 0.1, true)
      } else if (type === "pcb_cutout") {
        cutouts.push({ rings: shape(e), index })
        get("edge_cuts", index).path(shape(e)[0], 0.05, true)
      } else if (input.type === "pcb_soldermask_opening") {
        // Openings are applied by the soldermask pass after all overlays.
      } else if (type === "pcb_smtpad") {
        get(e.layer, index).polygon(shape(e))
      } else if (type === "pcb_via" || type === "pcb_plated_hole") {
        let layers: string[] = e.layers ?? copper
        if (type === "pcb_via" && !e.layers && e.from_layer && e.to_layer) {
          const from = copper.indexOf(e.from_layer),
            to = copper.indexOf(e.to_layer)
          layers = copper.slice(Math.min(from, to), Math.max(from, to) + 1)
        }
        for (const layer of layers)
          get(layer, index, false, type === "pcb_via" ? 2 : 0).polygon(shape(e))
        openings.push({ element: e, index, layers })
      } else if (type === "pcb_hole") {
        openings.push({
          element: { ...e, shape: e.hole_shape },
          index,
          layers: copper,
        })
      } else if (input.type === "pcb_trace") {
        const route = input.route
        if (
          input.route_thickness_mode === "interpolated" &&
          route.some(
            (p, i) =>
              p.route_type === "wire" &&
              !hasWireTaper(p) &&
              route[i + 1]?.route_type === "wire",
          )
        )
          throw new Error(
            "Interpolated/through-pad traces are not supported yet",
          )
        for (const point of getWireTaperSegments(route)) {
          const polygon = getWireTaperPolygon(point)
          if (!polygon.length)
            throw new Error("Invalid teardrop geometry or interpolation mode")
          get(point.layer, index).polygon([polygon])
        }
        for (const point of route) {
          if (point.route_type !== "through_pad") continue
          for (const layer of new Set([point.start_layer, point.end_layer]))
            get(layer, index).line(point.start, point.end, point.width)
        }
        for (let i = 1; i < route.length; i++) {
          let a = route[i - 1],
            b = route[i]
          if (hasWireTaper(a)) continue
          if (a.route_type === "through_pad")
            a = {
              route_type: "wire",
              ...a.end,
              layer: a.end_layer,
              width: a.width,
            }
          if (b.route_type === "through_pad")
            b = {
              route_type: "wire",
              ...b.start,
              layer: b.start_layer,
              width: b.width,
            }
          // Connect wires to a via on the adjacent copper layer, but never
          // connect two unrelated runs across a layer transition.
          if (
            a.route_type === "wire" &&
            b.route_type === "wire" &&
            a.layer === b.layer
          )
            get(a.layer, index).line(a, b, a.width)
          else if (
            a.route_type === "wire" &&
            b.route_type === "via" &&
            [b.from_layer, b.to_layer].includes(a.layer)
          )
            get(a.layer, index).line(a, b, a.width)
          else if (
            a.route_type === "via" &&
            b.route_type === "wire" &&
            [a.from_layer, a.to_layer].includes(b.layer)
          )
            get(b.layer, index).line(a, b, b.width)
        }
      } else if (type === "pcb_copper_pour") {
        get(e.layer, index, false, 1).polygon(shape(e))
      } else if (type === "pcb_copper_text") {
        drawText(get(e.layer, index), e, options.textYAxis)
      } else if (
        /^pcb_(silkscreen|fabrication_note|courtyard|note|user_note)_/.test(
          type,
        )
      ) {
        const group = type.match(
          /^pcb_(silkscreen|fabrication_note|courtyard|note|user_note)_/,
        )![1]
        const suffix = {
          silkscreen: "silkscreen",
          fabrication_note: "fabrication",
          courtyard: "courtyard",
          note: "notes",
          user_note: "notes",
        }[group]!
        const layer = `${e.layer ?? "top"}_${suffix}`
        const mesh = get(layer, index)
        if (
          input.type === "pcb_note_dimension" ||
          input.type === "pcb_fabrication_note_dimension"
        ) {
          drawPcbDimension({
            mesh,
            pcbDimension: input,
            textYAxis: options.textYAxis,
          })
        } else if (type.endsWith("_text")) {
          if (e.color && (group === "note" || group === "fabrication_note"))
            mesh.color = parseColor(e.color)
          drawText(mesh, e, options.textYAxis)
        } else if (
          input.type === "pcb_note_line" ||
          input.type === "pcb_silkscreen_line"
        ) {
          if (input.type === "pcb_note_line" && input.color)
            mesh.color = parseColor(input.color)
          mesh.line(
            { x: input.x1, y: input.y1 },
            { x: input.x2, y: input.y2 },
            input.stroke_width ?? 0.1,
          )
        } else if (
          type.endsWith("_path") ||
          type.endsWith("_line") ||
          type.endsWith("_outline")
        ) {
          const points =
            e.route ?? e.points ?? e.outline ?? [e.start, e.end].filter(Boolean)
          const isFabricationPath = type === "pcb_fabrication_note_path"
          if (isFabricationPath && e.color) mesh.color = parseColor(e.color)
          if (isFabricationPath) {
            mesh.fabricationPath(
              points,
              e.has_stroke === false ? 0 : (e.stroke_width ?? 0.05),
              !!e.is_filled,
            )
          } else {
            mesh.path(
              points,
              e.stroke_width ?? e.width ?? 0.05,
              type.endsWith("_outline"),
            )
          }
        } else if (type === "pcb_silkscreen_graphic" && e.shape === "brep") {
          mesh.polygon(shape(e))
        } else if (type.endsWith("_rect")) {
          const points = rectangle(
            center(e),
            e.width,
            e.height,
            e.corner_radius ?? 0,
            e.ccw_rotation ?? 0,
          )
          if (e.is_filled) mesh.polygon([points])
          else mesh.path(points, e.stroke_width ?? 0.05, true)
        } else if (type.endsWith("_circle")) {
          const points = ellipse(center(e), (e.radius ?? 0) * 2)
          if (e.is_filled) mesh.polygon([points])
          else mesh.path(points, e.stroke_width ?? 0.05, true)
        } else throw new Error("Unsupported annotation geometry")
      } else if (type === "pcb_keepout") {
        keepouts.push({
          rings: shape(e),
          index,
          layers: e.layers ?? [e.layer ?? "top"],
        })
      } else if (
        type.startsWith("pcb_") &&
        ![
          "pcb_component",
          "pcb_port",
          "pcb_group",
          "pcb_solder_paste",
          "pcb_debug_object",
          "pcb_trace_hint",
          "pcb_anchor",
          "pcb_breakout_point", // Routing target metadata, not visible geometry.
        ].includes(type) &&
        !/_(error|warning)$/.test(type)
      ) {
        throw new Error("Unsupported PCB element")
      }
    } catch (error) {
      diagnostics.push({
        elementId: elementIds[index],
        type,
        message: String(error),
      })
    }
  }
  // Keep annotations visible regardless of the input order of copper pours.
  for (const { rings, index, layers } of keepouts) {
    try {
      for (const layer of layers) drawKeepout(get(layer, index), rings)
    } catch (error) {
      diagnostics.push({
        elementId: elementIds[index],
        type: "pcb_keepout",
        message: String(error),
      })
    }
  }
  for (const { element, index, layers } of openings) {
    const rings = shape(element, true)
    for (const layer of layers) get(layer, index, true).polygon(rings)
    const isThrough = layers.includes("top") && layers.includes("bottom")
    if (isThrough) {
      get("board", index, true).polygon(rings)
      get("drill", index).polygon(rings)
    }
  }
  compileSoldermask({
    renderElements,
    boardOwnerMap,
    builders,
    get,
    options,
    diagnostics,
    elementIds,
  })
  for (const { rings, index } of cutouts) {
    get("drill", index).polygon(rings)
    for (const name of builders.keys())
      if (name !== "edge_cuts" && name !== "drill")
        get(name, index, true).polygon(rings)
  }
  const layers = [...builders].map(([name, mesh]) => ({
    name,
    paint: mesh.paint.build(),
    erase: mesh.erase.build(),
  }))
  return {
    layers,
    elementIds,
    diagnostics,
    triangleCount: layers.reduce(
      (sum, l) => sum + (l.paint.indices.length + l.erase.indices.length) / 3,
      0,
    ),
  }
}
