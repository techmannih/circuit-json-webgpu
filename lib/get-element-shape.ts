import { ellipse, expandBrepRing, rectangle, rotate } from "./geometry"
import type { Point } from "./types"

export type Element = Record<string, any>
function center(e: Element): Point {
  return e.center ?? e.anchor_position ?? { x: e.x ?? 0, y: e.y ?? 0 }
}
export function getElementShape(e: Element, hole = false): Point[][] {
  if (e.shape === "hole_with_polygon_pad" && !hole)
    return [
      (e.pad_outline ?? []).map((p: Point) => ({ x: p.x + e.x, y: p.y + e.y })),
    ]
  if (e.brep_shape)
    return [e.brep_shape.outer_ring, ...(e.brep_shape.inner_rings ?? [])].map(
      (r) => expandBrepRing(r.vertices),
    )
  if (e.outline?.length) return [e.outline]
  if (e.shape === "rotated_pill_hole_with_rect_pad") {
    // Pad and slot use independent rotations. Hole offsets are board-space
    // coordinates, as in the reference canvas renderer, not pad-local offsets.
    const base = center(e)
    const c = hole
      ? {
          x: base.x + (e.hole_offset_x ?? 0),
          y: base.y + (e.hole_offset_y ?? 0),
        }
      : base
    const width = hole ? e.hole_width : e.rect_pad_width
    const height = hole ? e.hole_height : e.rect_pad_height
    return [
      rectangle(
        c,
        width,
        height,
        hole ? Math.min(width, height) / 2 : (e.rect_border_radius ?? 0),
        (hole ? e.hole_ccw_rotation : e.rect_ccw_rotation) ?? 0,
      ),
    ]
  }
  const kind = hole ? (e.hole_shape ?? e.shape) : e.shape
  if (kind === "polygon") return [e.points ?? e.vertices ?? []]
  const base = center(e),
    rotation = e.rect_ccw_rotation ?? e.ccw_rotation ?? e.rotation ?? 0
  const c = hole
    ? rotate(
        {
          x: base.x + (e.hole_offset_x ?? 0),
          y: base.y + (e.hole_offset_y ?? 0),
        },
        base,
        rotation,
      )
    : base
  if (
    kind === "circle" ||
    (kind === "circular_hole_with_rect_pad" && hole) ||
    e.type === "pcb_via"
  ) {
    const diameter = hole
      ? e.hole_diameter
      : (e.outer_diameter ?? (e.radius != null ? e.radius * 2 : e.diameter))
    return [
      ellipse(c, diameter || e.diameter || e.hole_diameter || e.radius * 2),
    ]
  }
  const width = hole
    ? (e.hole_width ?? e.hole_diameter)
    : (e.rect_pad_width ?? e.outer_width ?? e.width ?? e.hole_diameter)
  const height = hole
    ? (e.hole_height ?? e.hole_diameter)
    : (e.rect_pad_height ?? e.outer_height ?? e.height ?? e.hole_diameter)
  if (kind === "oval") return [ellipse(c, width, height, rotation)]
  if (
    [
      "rect",
      "square",
      "rotated_rect",
      "roundrect",
      "rounded_rect",
      "pill",
      "rotated_pill",
      "circular_hole_with_rect_pad",
      "pill_hole_with_rect_pad",
      undefined,
    ].includes(kind)
  ) {
    const pill =
      kind?.includes("pill") && !(kind === "pill_hole_with_rect_pad" && !hole)
    const radius = pill
      ? Math.min(width, height) / 2
      : (e.corner_radius ?? e.rect_border_radius ?? 0)
    return [rectangle(c, width, height, radius, rotation)]
  }
  throw new Error(`Unsupported shape: ${kind}`)
}
