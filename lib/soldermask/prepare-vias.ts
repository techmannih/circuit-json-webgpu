import { createBoardOwnerMap } from "@tscircuit/circuit-json-util"
import type {
  AnyCircuitElement,
  PcbBoard,
  PcbVia,
  PcbViaInput,
} from "circuit-json"
import type { CircuitJson } from "../types"

export type RenderElement = { element: AnyCircuitElement; index: number }
export type BoardOwnerMap = Map<string, PcbBoard | undefined>

/** Route vias share their trace's picking/highlight index and board ownership. */
export function prepareVias(elements: CircuitJson) {
  const boardOwnerMap: BoardOwnerMap = createBoardOwnerMap([...elements])
  const renderElements: RenderElement[] = elements.map((element, index) => ({
    element,
    index,
  }))
  const atPosition = new Map<string, PcbVia[]>()
  const key = (board: PcbBoard | undefined, x: number, y: number) =>
    `${board?.pcb_board_id ?? ""}:${x}:${y}`
  for (const element of elements) {
    if (element.type !== "pcb_via") continue
    const position = key(
      boardOwnerMap.get(element.pcb_via_id),
      element.x,
      element.y,
    )
    const vias = atPosition.get(position) ?? []
    vias.push(element)
    atPosition.set(position, vias)
  }
  for (const [index, trace] of elements.entries()) {
    if (trace.type !== "pcb_trace") continue
    const board = boardOwnerMap.get(trace.pcb_trace_id)
    for (const [routeIndex, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue
      const position = key(board, point.x, point.y)
      const vias = atPosition.get(position) ?? []
      if (
        vias.some(
          (via) =>
            via.layers.includes(point.from_layer) &&
            via.layers.includes(point.to_layer),
        )
      )
        continue
      const via: PcbVia = {
        type: "pcb_via",
        pcb_via_id: `${trace.pcb_trace_id}_route_via_${routeIndex}`,
        pcb_trace_id: trace.pcb_trace_id,
        subcircuit_id: trace.subcircuit_id,
        pcb_group_id: trace.pcb_group_id,
        x: point.x,
        y: point.y,
        layers: [point.from_layer, point.to_layer],
        hole_diameter:
          point.hole_diameter ?? board?.min_via_hole_diameter ?? 0.25,
        outer_diameter:
          point.outer_diameter ?? board?.min_via_pad_diameter ?? 0.6,
        tented_on_top: point.tented_on_top,
        tented_on_bottom: point.tented_on_bottom,
      }
      renderElements.push({ element: via, index })
      boardOwnerMap.set(via.pcb_via_id, board)
      vias.push(via)
      atPosition.set(position, vias)
    }
  }
  return { renderElements, boardOwnerMap }
}

export function isViaTented(
  via: PcbVia,
  side: "top" | "bottom",
  owners: BoardOwnerMap,
) {
  const board = owners.has(via.pcb_via_id)
    ? owners.get(via.pcb_via_id)
    : owners.get(via.pcb_trace_id ?? "")
  return (
    (side === "top" ? via.tented_on_top : via.tented_on_bottom) ??
    (via as PcbViaInput).is_tented ??
    (side === "top"
      ? board?.default_via_tented_on_top
      : board?.default_via_tented_on_bottom) ??
    false
  )
}
