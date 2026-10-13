import { DEFAULT_LAYER_COLORS } from "../colors"
import { MeshBuilder } from "../geometry"
import { getElementShape as shape } from "../get-element-shape"
import type { Color, Diagnostic } from "../types"
import { getSoldermaskOpening } from "./get-soldermask-opening"
import {
  isViaTented,
  type BoardOwnerMap,
  type RenderElement,
} from "./prepare-vias"

type GetMesh = (
  name: string,
  index: number,
  erase?: boolean,
  category?: number,
) => MeshBuilder

/** Paint substrate, covered copper and tenting first; subtract all apertures last.
 * The physical drill stays in its own layer and is never changed by mask margins.
 */
export function compileSoldermask({
  renderElements,
  boardOwnerMap,
  builders,
  get,
  options,
  diagnostics,
  elementIds,
}: {
  renderElements: RenderElement[]
  boardOwnerMap: BoardOwnerMap
  builders: Map<string, { paint: MeshBuilder; erase: MeshBuilder }>
  get: GetMesh
  options: { layerColors?: Record<string, Color> }
  diagnostics: Diagnostic[]
  elementIds: string[]
}) {
  const surfaces = renderElements.filter(
    ({ element }) =>
      element.type === "pcb_board" || element.type === "pcb_panel",
  )
  const color = (name: string) =>
    options.layerColors?.[name] ?? DEFAULT_LAYER_COLORS[name]
  const paint = (side: string, index: number, material: "copper" | "hole") => {
    const mesh = get(`soldermask_${side}`, index)
    mesh.color = color(`soldermask_over_${material}_${side}`)
    return mesh
  }
  const attempt = ({ element, index }: RenderElement, draw: () => void) => {
    try {
      draw()
    } catch (error) {
      // Geometry errors already reported by the copper pass need only one diagnostic.
      if (!diagnostics.some((d) => d.elementId === elementIds[index]))
        diagnostics.push({
          elementId: elementIds[index],
          type: element.type,
          message: String(error),
        })
    }
  }
  for (const item of surfaces)
    attempt(item, () => {
      get("substrate", item.index).polygon(shape(item.element))
      for (const side of ["top", "bottom"])
        get(`soldermask_${side}`, item.index).polygon(shape(item.element))
    })

  // Reuse tessellated trace copper, including tapers and through-pad spans.
  // Copy it in one linear pass per side; selection IDs are retained.
  if (surfaces.length)
    for (const side of ["top", "bottom"]) {
      const source = builders.get(side)?.paint
      if (!source) continue
      const traceIndices = new Set(
        renderElements
          .filter((i) => i.element.type === "pcb_trace")
          .map((i) => i.index),
      )
      const target = paint(side, 0, "copper")
      const map = new Map<number, number>()
      for (let offset = 0; offset < source.vertices.length; offset += 8) {
        const index = source.vertices[offset + 6]
        // Synthetic route-via geometry shares a trace ID but is handled below.
        if (!traceIndices.has(index) || source.vertices[offset + 7] === 2)
          continue
        map.set(offset / 8, target.vertices.length / 8)
        target.vertices.push(
          source.vertices[offset],
          source.vertices[offset + 1],
          ...color(`soldermask_over_copper_${side}`),
          index,
          0,
        )
      }
      for (let i = 0; i < source.indices.length; i += 3) {
        const a = map.get(source.indices[i]),
          b = map.get(source.indices[i + 1]),
          c = map.get(source.indices[i + 2])
        if (a !== undefined && b !== undefined && c !== undefined)
          target.indices.push(a, b, c)
      }
    }

  const orderedElements = [
    ...renderElements.filter((i) => i.element.type !== "pcb_via"),
    ...renderElements.filter((i) => i.element.type === "pcb_via"),
  ]
  for (const item of orderedElements)
    attempt(item, () => {
      const { element: e, index } = item
      if (e.type === "pcb_soldermask_opening") {
        get(`soldermask_${e.layer}`, index, true).polygon(shape(e))
        return
      }
      if (e.type === "pcb_copper_pour") {
        if (!surfaces.length || (e.layer !== "top" && e.layer !== "bottom"))
          return
        // Omitted coverage follows SVG/schema's covered-by-default convention.
        if (e.covered_with_solder_mask !== false)
          paint(e.layer, index, "copper").polygon(shape(e))
        else get(`soldermask_${e.layer}`, index, true).polygon(shape(e))
        return
      }
      if (
        !["pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_via"].includes(
          e.type,
        )
      )
        return
      const pad = e as unknown as Record<string, any>
      if (
        surfaces.length &&
        (e.type === "pcb_hole" ||
          ((e.type === "pcb_via" || e.type === "pcb_plated_hole") &&
            (!e.layers ||
              (e.layers.includes("top") && e.layers.includes("bottom")))))
      )
        get("substrate", index, true).polygon(
          shape(
            e.type === "pcb_hole" ? { ...e, shape: e.hole_shape } : e,
            true,
          ),
        )
      for (const side of ["top", "bottom"] as const) {
        if (e.type === "pcb_smtpad" && e.layer !== side) continue
        if (
          (e.type === "pcb_plated_hole" || e.type === "pcb_via") &&
          e.layers &&
          !e.layers.includes(side)
        )
          continue
        if (e.type === "pcb_via") {
          if (isViaTented(e, side, boardOwnerMap)) {
            const outer = shape(e),
              drill = shape(e, true)
            paint(side, index, "copper").polygon([...outer, ...drill])
            paint(side, index, "hole").polygon(drill)
          } else get(`soldermask_${side}`, index, true).polygon(shape(e))
          continue
        }
        if (surfaces.length)
          paint(side, index, "copper").polygon(
            e.type === "pcb_hole"
              ? shape({ ...e, shape: e.hole_shape }, true)
              : shape(e),
          )
        if (!pad.is_covered_with_solder_mask)
          get(`soldermask_${side}`, index, true).polygon(
            getSoldermaskOpening(pad),
          )
      }
    })
}
