import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { comparisonSilkscreenColors } from "./palette"
import type { prepareComparison } from "./prepare"

type Scene = NonNullable<ReturnType<typeof prepareComparison>["scene"]>

export function renderComparisonSvg(scene: Scene) {
  return convertCircuitJsonToPcbSvg(
    scene.elements as unknown as Parameters<
      typeof convertCircuitJsonToPcbSvg
    >[0],
    {
      width: scene.width,
      height: scene.height,
      viewport: scene.viewport,
      layer: scene.layer,
      showSolderMask: scene.showSolderMask,
      showPcbNotes: scene.showPcbNotes,
      showCourtyards: true,
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      includeVersion: false,
      // The pinned SVG renderer skips pcb_board/pcb_panel entirely when this
      // is false, including their soldermask. The explicit viewport above
      // keeps the camera identical while allowing the board mask to render.
      drawPaddingOutsideBoard: scene.showSolderMask,
      backgroundColor: scene.background,
      colorOverrides: { silkscreen: comparisonSilkscreenColors },
    },
  )
}
