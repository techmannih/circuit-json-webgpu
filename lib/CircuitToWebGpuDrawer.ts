import { compileCircuitJson } from "./compile-circuit"
import { normalizeLayer } from "./colors"
import { compositeShader, geometryShader } from "./shaders"
import type {
  CircuitJson,
  CompiledScene,
  DrawerOptions,
  Matrix,
  Mesh,
  RenderOptions,
} from "./types"

type GpuMesh = { vertices: GPUBuffer; indices: GPUBuffer; count: number }
type Layer = {
  name: string
  paint: GpuMesh
  erase: GpuMesh
  opacity: GPUBuffer
  texture?: GPUTexture
  composite?: GPUBindGroup
}
const over: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
}

/** Retained GPU geometry: camera and highlight changes never recompile or upload vertices. */
export class CircuitToWebGpuDrawer {
  /** Feature detection for clients that also support older renderer versions. */
  static readonly supportsXRayNet = true
  realToCanvasMat: Matrix = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }
  readonly stats = {
    geometryUploads: 0,
    frames: 0,
    triangleCount: 0,
    compileMs: 0,
    vertexBytes: 0,
  }
  private circuit?: CircuitJson
  private scene?: CompiledScene
  private layers: Layer[] = []
  private xRayLayers: Layer[] = []
  private xRayUniform: GPUBuffer
  private xRayCameraGroup?: GPUBindGroup
  private uniform: GPUBuffer
  private highlights: GPUBuffer
  private cameraGroup?: GPUBindGroup
  private highlightKey = ""
  private highlightIndices = new Map<string, number>()
  private sample?: GPUTexture
  private size = ""
  private disposed = false
  adapterInfo?: GPUAdapterInfo
  private lost = false
  private paintPipeline: GPURenderPipeline
  private erasePipeline: GPURenderPipeline
  private compositePipeline: GPURenderPipeline
  private sampler: GPUSampler
  private options: RenderOptions = {}

  static async create(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    options: DrawerOptions = {},
  ) {
    if (!globalThis.navigator?.gpu) throw new Error("WebGPU is unavailable")
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    })
    if (!adapter) throw new Error("No WebGPU adapter available")
    const device = await adapter.requestDevice()
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null
    if (!context) {
      device.destroy()
      throw new Error("WebGPU canvas context is unavailable")
    }
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: "premultiplied" })
    device.pushErrorScope("validation")
    try {
      const drawer = new CircuitToWebGpuDrawer(
        canvas,
        device,
        context,
        format,
        options,
      )
      const error = await device.popErrorScope()
      if (error) {
        drawer.dispose()
        throw new Error(error.message)
      }
      device.addEventListener("uncapturederror", (event) =>
        options.onDeviceLost?.(event.error.message),
      )
      drawer.adapterInfo = adapter.info
      return drawer
    } catch (error) {
      context.unconfigure()
      device.destroy()
      throw error
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private device: GPUDevice,
    private context: GPUCanvasContext,
    format: GPUTextureFormat,
    private config: DrawerOptions,
  ) {
    this.uniform = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.xRayUniform = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.highlights = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const module = device.createShaderModule({ code: geometryShader })
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.VERTEX,
              buffer: { type: "read-only-storage" },
            },
          ],
        }),
      ],
    })
    const geometry = (blend: GPUBlendState): GPURenderPipelineDescriptor => ({
      layout,
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x4" },
              { shaderLocation: 2, offset: 24, format: "float32" },
              { shaderLocation: 3, offset: 28, format: "float32" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", blend }],
      },
      primitive: { topology: "triangle-list" },
      multisample: { count: config.sampleCount ?? 4 },
    })
    this.paintPipeline = device.createRenderPipeline(geometry(over))
    this.erasePipeline = device.createRenderPipeline(
      geometry({
        color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
      }),
    )
    const composite = device.createShaderModule({ code: compositeShader })
    this.compositePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: composite, entryPoint: "vertexMain" },
      fragment: {
        module: composite,
        entryPoint: "fragmentMain",
        targets: [{ format, blend: over }],
      },
      primitive: { topology: "triangle-list" },
    })
    this.sampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
    })
    device.lost.then((info) => {
      this.lost = true
      if (!this.disposed) config.onDeviceLost?.(info.message || info.reason)
    })
  }

  get diagnostics() {
    return this.scene?.diagnostics ?? []
  }
  setCircuitJson(circuitJson: CircuitJson) {
    this.assertLive()
    if (this.circuit === circuitJson) return
    const start = performance.now(),
      scene = compileCircuitJson(circuitJson, this.config)
    this.releaseLayers()
    this.highlights.destroy()
    this.highlights = this.device.createBuffer({
      size: Math.max(4, scene.elementIds.length * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.highlightIndices = new Map(
      scene.elementIds.map((id, index) => [id, index]),
    )
    this.highlightKey = "!"
    this.cameraGroup = this.device.createBindGroup({
      layout: this.paintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.highlights } },
      ],
    })
    this.xRayCameraGroup = this.device.createBindGroup({
      layout: this.paintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.xRayUniform } },
        { binding: 1, resource: { buffer: this.highlights } },
      ],
    })
    this.stats.vertexBytes = 0
    const upload = (mesh: Mesh): GpuMesh => {
      const make = (data: Float32Array | Uint32Array, usage: number) => {
        const buffer = this.device.createBuffer({
          size: Math.max(4, data.byteLength),
          usage: usage | GPUBufferUsage.COPY_DST,
        })
        if (data.byteLength)
          this.device.queue.writeBuffer(
            buffer,
            0,
            data.buffer as ArrayBuffer,
            data.byteOffset,
            data.byteLength,
          )
        this.stats.vertexBytes += data.byteLength
        return buffer
      }
      return {
        vertices: make(mesh.vertices, GPUBufferUsage.VERTEX),
        indices: make(mesh.indices, GPUBufferUsage.INDEX),
        count: mesh.indices.length,
      }
    }
    this.layers = scene.layers.map((layer) => ({
      name: layer.name,
      paint: upload(layer.paint),
      erase: upload(layer.erase),
      opacity: this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    }))
    // Share retained geometry; only the per-layer compositing targets are separate.
    this.xRayLayers = this.layers
      .filter((layer) => this.isCopper(layer.name) || layer.name === "drill")
      .map((layer) => ({
        ...layer,
        opacity: this.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      }))
    this.scene = scene
    this.circuit = circuitJson
    this.size = ""
    this.stats.geometryUploads++
    this.stats.triangleCount = scene.triangleCount
    this.stats.compileMs = performance.now() - start
  }

  /** Similar to circuit-to-canvas; repeated draws with the same array reuse all buffers. */
  drawElements(elements: CircuitJson, options: RenderOptions = {}) {
    this.setCircuitJson(elements)
    // Independent draws use defaults; render() retains options for camera updates.
    this.options = {}
    this.render(options)
  }

  render(options: RenderOptions = {}) {
    this.assertLive()
    this.options = { ...this.options, ...options }
    const o = this.options
    if (o.transform) this.realToCanvasMat = o.transform
    const t = this.realToCanvasMat,
      width = this.canvas.width,
      height = this.canvas.height
    if (!width || !height) return
    if (![...Object.values(t), width, height].every(Number.isFinite))
      throw new Error("Invalid camera or canvas dimensions")
    if (
      width > this.device.limits.maxTextureDimension2D ||
      height > this.device.limits.maxTextureDimension2D
    )
      throw new Error("Canvas exceeds GPU texture limits")
    const copperPourOpacity =
      o.showCopperPours === false
        ? 0
        : Number.isFinite(o.copperPourOpacity)
          ? Math.max(0, Math.min(1, o.copperPourOpacity!))
          : 1
    this.resize(width, height)
    this.device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([
        t.a,
        t.c,
        t.e,
        0,
        t.b,
        t.d,
        t.f,
        0,
        width,
        height,
        copperPourOpacity,
        0,
      ]),
    )
    const xRayIds = o.xRayElementIds ?? []
    const xRayActive = xRayIds.length > 0
    if (xRayActive)
      this.device.queue.writeBuffer(
        this.xRayUniform,
        0,
        new Float32Array([
          t.a,
          t.c,
          t.e,
          0,
          t.b,
          t.d,
          t.f,
          0,
          width,
          height,
          copperPourOpacity,
          1,
        ]),
      )
    const ids = xRayActive ? [] : (o.highlightedElementIds ?? []),
      key = JSON.stringify([ids, xRayIds])
    if (key !== this.highlightKey) {
      const mask = new Uint32Array(
        Math.max(1, this.scene?.elementIds.length ?? 0),
      )
      for (const id of ids) {
        const i = this.highlightIndices.get(id)
        if (i !== undefined) mask[i] = 1
      }
      for (const id of xRayIds) {
        const i = this.highlightIndices.get(id)
        if (i !== undefined) mask[i] |= 2
      }
      this.device.queue.writeBuffer(this.highlights, 0, mask)
      this.highlightKey = key
    }
    const selected = normalizeLayer(o.selectedLayer ?? "top"),
      filter = o.layers ? new Set(o.layers.map(normalizeLayer)) : undefined
    const maskVisible =
      !!o.showSolderMask &&
      !xRayActive &&
      (selected === "top" || selected === "bottom") &&
      (!filter || filter.has(`soldermask_${selected}`))
    const visible = this.layers
      .filter((l) => {
        if (filter && !filter.has(l.name)) return false
        if (xRayActive && !this.isCopper(l.name)) return false
        if (l.name === "board" && !o.showBoardMaterial) return false
        if (
          l.name === "substrate" &&
          (!maskVisible || o.showBoardMaterial === false)
        )
          return false
        if (
          l.name.startsWith("soldermask_") &&
          (!o.showSolderMask || l.name !== `soldermask_${selected}`)
        )
          return false
        if (l.name.includes("silkscreen") && o.showSilkscreen === false)
          return false
        if (l.name.includes("fabrication") && !o.showFabricationNotes)
          return false
        if (l.name.includes("notes") && o.showPcbNotes === false) return false
        if (l.name.includes("courtyard") && !o.showCourtyards) return false
        return (
          (xRayActive && this.isCopper(l.name)) ||
          this.opacity(l.name, selected, o.hiddenLayerOpacity ?? 0.4) > 0
        )
      })
      .sort(
        (a, b) =>
          this.order(a.name, selected, maskVisible) -
          this.order(b.name, selected, maskVisible),
      )
    const selectedLayers = xRayActive
      ? this.xRayLayers
          .filter((layer) => !filter || filter.has(layer.name))
          .sort(
            (a, b) =>
              this.xRayOrder(a.name, selected) -
              this.xRayOrder(b.name, selected),
          )
      : []
    const renderLayers = [
      ...visible.map((layer) => ({ layer, xRay: false })),
      ...selectedLayers.map((layer) => ({ layer, xRay: true })),
    ]
    const encoder = this.device.createCommandEncoder()
    for (const { layer, xRay } of renderLayers) {
      this.ensureTexture(layer, width, height)
      const target = layer.texture!.createView(),
        msaa = (this.config.sampleCount ?? 4) > 1
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: msaa ? this.sample!.createView() : target,
            ...(msaa ? { resolveTarget: target } : {}),
            clearValue: [0, 0, 0, 0],
            loadOp: "clear",
            storeOp: msaa ? "discard" : "store",
          },
        ],
      })
      for (const [mesh, pipeline] of [
        [layer.paint, this.paintPipeline],
        [layer.erase, this.erasePipeline],
      ] as const) {
        if (!mesh.count) continue
        // Erase geometry (drills/cutouts) must retain its physical meaning in both passes.
        pass.setBindGroup(
          0,
          xRay && pipeline === this.paintPipeline
            ? this.xRayCameraGroup!
            : this.cameraGroup!,
        )
        pass.setPipeline(pipeline)
        pass.setVertexBuffer(0, mesh.vertices)
        pass.setIndexBuffer(mesh.indices, "uint32")
        pass.drawIndexed(mesh.count)
      }
      pass.end()
      this.device.queue.writeBuffer(
        layer.opacity,
        0,
        new Float32Array([
          xRay
            ? 1
            : xRayActive && this.isCopper(layer.name)
              ? Math.max(0, Math.min(1, o.hiddenLayerOpacity ?? 0.4))
              : this.opacity(layer.name, selected, o.hiddenLayerOpacity ?? 0.4),
          0,
          0,
          0,
        ]),
      )
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: o.background ?? [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.setPipeline(this.compositePipeline)
    for (const { layer } of renderLayers) {
      pass.setBindGroup(0, layer.composite!)
      pass.draw(6)
    }
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.stats.frames++
  }

  async flush() {
    this.assertLive()
    await this.device.queue.onSubmittedWorkDone()
  }
  private isCopper(layer: string) {
    return /^(top|bottom|inner\d+)$/.test(layer)
  }
  private opacity(layer: string, selected: string, hidden: number) {
    return ["board", "substrate", "drill", "edge_cuts"].includes(layer) ||
      layer === selected ||
      layer.startsWith(`${selected}_`) ||
      layer.endsWith(`_${selected}`)
      ? 1
      : Math.max(0, Math.min(1, hidden))
  }
  private xRayOrder(layer: string, selected: string) {
    if (layer === "drill") return 200
    if (layer === selected) return 100
    if (layer === "bottom") return 0
    if (layer.startsWith("inner")) return 20 - Number(layer.slice(5))
    return 40
  }
  private order(layer: string, selected: string, maskVisible = false) {
    if (layer === "board") return -100
    if (layer === "substrate") return -90
    if (layer === "drill") return maskVisible ? 105 : 200
    if (layer === "edge_cuts") return 150
    const base =
      layer === selected
        ? 100
        : layer.startsWith("inner")
          ? 20 - Number(layer.slice(5))
          : layer === "bottom"
            ? 30
            : 40
    if (layer.includes("soldermask")) return 110
    if (layer.startsWith(`${selected}_`)) return 120
    return base
  }
  private resize(width: number, height: number) {
    const size = `${width}:${height}`
    if (size === this.size) return
    this.sample?.destroy()
    this.sample =
      (this.config.sampleCount ?? 4) > 1
        ? this.device.createTexture({
            size: [width, height],
            format: "rgba8unorm",
            sampleCount: this.config.sampleCount ?? 4,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        : undefined
    for (const layer of [...this.layers, ...this.xRayLayers]) {
      layer.texture?.destroy()
      layer.texture = undefined
      layer.composite = undefined
    }
    this.size = size
  }
  private ensureTexture(layer: Layer, width: number, height: number) {
    if (layer.texture) return
    layer.texture = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    layer.composite = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: layer.texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: layer.opacity } },
      ],
    })
  }
  private assertLive() {
    if (this.disposed || this.lost)
      throw new Error(this.lost ? "WebGPU device lost" : "Renderer disposed")
  }
  private releaseLayers() {
    for (const layer of this.xRayLayers) {
      layer.opacity.destroy()
      layer.texture?.destroy()
    }
    this.xRayLayers = []
    for (const layer of this.layers) {
      for (const mesh of [layer.paint, layer.erase]) {
        mesh.vertices.destroy()
        mesh.indices.destroy()
      }
      layer.opacity.destroy()
      layer.texture?.destroy()
    }
    this.layers = []
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.releaseLayers()
    this.sample?.destroy()
    this.uniform.destroy()
    this.xRayUniform.destroy()
    this.highlights.destroy()
    this.context.unconfigure()
    // Let queued writes finish before device destruction and worker teardown.
    const destroyDevice = () => this.device.destroy()
    void this.device.queue
      .onSubmittedWorkDone()
      .then(destroyDevice, destroyDevice)
    this.circuit = undefined
    this.scene = undefined
  }
}
