import { ellipse, rectangle, rotate } from "../geometry"
import { getElementShape, type Element } from "../get-element-shape"
import type { Point } from "../types"

/** Apertures are independent of pad/drill geometry. Margins are in millimeters. */
export function getSoldermaskOpening(e: Element): Point[][] {
  const margin = e.soldermask_margin ?? 0
  const isHole = e.type === "pcb_hole"
  const kind = isHole ? e.hole_shape : e.shape
  const center = e.center ?? { x: e.x ?? 0, y: e.y ?? 0 }
  const rotation = e.rect_ccw_rotation ?? e.ccw_rotation ?? e.rotation ?? 0
  if (kind === "polygon" || kind === "hole_with_polygon_pad") {
    const points = getElementShape(e)[0]
    // Match the existing Canvas/SVG polygon margin convention (radial from
    // the vertex centroid), rather than silently changing its geometry.
    if (!margin || points.length < 3) return [points]
    const c = {
      x: points.reduce((n, p) => n + p.x, 0) / points.length,
      y: points.reduce((n, p) => n + p.y, 0) / points.length,
    }
    if (points.some((p) => Math.hypot(p.x - c.x, p.y - c.y) + margin <= 0))
      return []
    return [
      points.map((p) => {
        const d = Math.hypot(p.x - c.x, p.y - c.y)
        return d
          ? {
              x: p.x + ((p.x - c.x) * margin) / d,
              y: p.y + ((p.y - c.y) * margin) / d,
            }
          : { x: p.x + margin, y: p.y }
      }),
    ]
  }
  if (kind === "circle" || e.type === "pcb_via") {
    const diameter = isHole
      ? e.hole_diameter
      : (e.outer_diameter ?? e.radius * 2)
    return [ellipse(center, diameter + 2 * margin)]
  }
  let width = isHole
    ? (e.hole_width ?? e.hole_diameter)
    : (e.rect_pad_width ?? e.outer_width ?? e.width)
  let height = isHole
    ? (e.hole_height ?? e.hole_diameter)
    : (e.rect_pad_height ?? e.outer_height ?? e.height)
  let left = margin,
    right = margin,
    top = margin,
    bottom = margin
  if (e.type === "pcb_smtpad" && (kind === "rect" || kind === "rotated_rect")) {
    left = e.soldermask_margin_left ?? margin
    right = e.soldermask_margin_right ?? margin
    top = e.soldermask_margin_top ?? margin
    bottom = e.soldermask_margin_bottom ?? margin
  }
  width += left + right
  height += top + bottom
  const shifted = rotate(
    { x: center.x + (right - left) / 2, y: center.y + (top - bottom) / 2 },
    center,
    rotation,
  )
  if (kind === "oval") return [ellipse(shifted, width, height, rotation)]
  const isPill = kind === "pill" || kind === "rotated_pill"
  const radius = isPill
    ? Math.min(width, height) / 2
    : Math.max(
        0,
        (e.corner_radius ?? e.rect_border_radius ?? 0) +
          Math.min(0, left, right, top, bottom),
      )
  return [rectangle(shifted, width, height, radius, rotation)]
}
