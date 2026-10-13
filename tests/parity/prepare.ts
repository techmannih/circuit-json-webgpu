import type { CapturedCase } from "./types"
import type { LayerRef } from "circuit-json"
import { compose, inverse, applyToPoint } from "transformation-matrix"
import { getElementRenderLayers } from "@tscircuit/circuit-json-util"

/** One canonical PCB scene/camera shared by SVG and WebGPU. No Canvas pixels. */
export function prepareComparison(
  c: Omit<CapturedCase, "id" | "testName" | "testPath">,
) {
  if (c.primitive)
    return {
      reason:
        "Direct Canvas primitive helper; no Circuit JSON fixture to compare.",
    }
  if (c.sourceFunction)
    return {
      reason: `Canvas-only ${c.sourceFunction} pass; circuit-to-svg has no equivalent isolated pass.`,
    }
  if (c.options.clipContextElements)
    return {
      reason:
        "Subset draw with separate clip context is not supported by circuit-to-svg.",
    }
  if (c.options.clearDrillHoles)
    return {
      reason:
        "Canvas clearDrillHoles compositing is not exposed by circuit-to-svg.",
    }
  if (c.options.drawSolderPaste)
    return {
      reason:
        "The PCB SVG renderer does not expose the same solder-paste pass.",
    }
  const requested = c.options.layers
  if (requested?.some((l) => l.endsWith("_soldermask")))
    return {
      reason:
        "Isolated soldermask-only passes are not supported by circuit-to-svg.",
    }
  const sides = [...new Set((requested ?? []).map((l) => l.split("_")[0]))]
  if (sides.length > 1)
    return {
      reason:
        "This mixed-side layer selection cannot be expressed by circuit-to-svg's single layer option.",
    }
  const hasExplicitMaskSide =
    c.options.drawSoldermaskTop !== undefined ||
    c.options.drawSoldermaskBottom !== undefined
  const topMask =
    !!c.options.drawSoldermask &&
    (c.options.drawSoldermaskTop ?? !hasExplicitMaskSide)
  const bottomMask =
    !!c.options.drawSoldermask && (c.options.drawSoldermaskBottom ?? false)
  const layer = (sides[0] ??
    (topMask ? "top" : bottomMask ? "bottom" : undefined)) as
    | LayerRef
    | undefined
  const showSolderMask =
    layer === "top" ? topMask : layer === "bottom" ? bottomMask : false
  const elements = requested?.length
    ? c.elements.filter((e) => {
        const layers =
          e.type === "pcb_silkscreen_graphic"
            ? [`${e.layer}_silkscreen`]
            : getElementRenderLayers(
                e as Parameters<typeof getElementRenderLayers>[0],
              )
        return !layers.length || layers.some((l) => requested.includes(l))
      })
    : c.elements
  const m = compose(c.contextTransform, c.matrix)
  const inv = inverse(m)
  const corners = [
    [0, 0],
    [c.width, 0],
    [0, c.height],
    [c.width, c.height],
  ].map((p) => applyToPoint(inv, { x: p[0], y: p[1] }))
  const viewport = {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  }
  if (
    !Object.values(viewport).every(Number.isFinite) ||
    viewport.maxX <= viewport.minX ||
    viewport.maxY <= viewport.minY
  )
    return { reason: "Invalid viewport" }
  const scale = Math.min(
    c.width / (viewport.maxX - viewport.minX),
    c.height / (viewport.maxY - viewport.minY),
  )
  const offsetX = (c.width - (viewport.maxX - viewport.minX) * scale) / 2
  const offsetY = (c.height - (viewport.maxY - viewport.minY) * scale) / 2
  const transform = {
    a: scale,
    b: 0,
    c: 0,
    d: -scale,
    e: offsetX - viewport.minX * scale,
    f: c.height - offsetY + viewport.minY * scale,
  }
  const layers = requested?.map((l) =>
    l
      .replace(/_copper$/, "")
      .replace(/_user_note$/, "_notes")
      .replace(/_fabrication_note$/, "_fabrication"),
  )
  if (layers) {
    layers.push("board", "edge_cuts", "drill")
    // Canvas's mask pass is separate from its copper layer filter. Keep the
    // selected mask and exposed substrate visible in the WebGPU comparison too.
    if (showSolderMask) layers.push(`soldermask_${layer}`, "substrate")
  }
  return {
    scene: {
      elements,
      width: c.width,
      height: c.height,
      viewport,
      transform,
      layer,
      layers,
      showSolderMask,
      showPcbNotes: c.options.showPcbNotes ?? true,
      background: "#000000",
    },
  }
}
