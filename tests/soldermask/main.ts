import { CircuitToWebGpuDrawer, type RenderOptions } from "../../lib"
import { soldermaskFixture } from "./fixture"

const canvas = document.querySelector("canvas")!
const drawer = await CircuitToWebGpuDrawer.create(canvas, {
  onDeviceLost: (message) => {
    throw new Error(message)
  },
})
drawer.setCircuitJson(soldermaskFixture)
const transform = { a: 24, b: 0, c: 0, d: -24, e: 300, f: 240 }
async function render(options: RenderOptions = {}) {
  drawer.render({
    transform,
    selectedLayer: "top",
    showSolderMask: true,
    showBoardMaterial: undefined,
    layers: undefined,
    xRayElementIds: [],
    highlightedElementIds: [],
    hiddenLayerOpacity: 0,
    background: [0, 0, 0, 1],
    ...options,
  })
  // Capture before yielding: the browser may present and clear the WebGPU
  // drawing buffer at the next animation frame while flush() is pending.
  const png = canvas.toDataURL("image/png").split(",")[1]
  await drawer.flush()
  return {
    png,
    uploads: drawer.stats.geometryUploads,
    diagnostics: drawer.diagnostics,
  }
}
Object.assign(window, { soldermaskTest: { render, drawer, transform } })
declare global {
  interface Window {
    soldermaskTest: {
      render: typeof render
      drawer: CircuitToWebGpuDrawer
      transform: typeof transform
    }
  }
}
