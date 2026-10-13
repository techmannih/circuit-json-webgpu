import { AnyCircuitElement } from 'circuit-json';

type CircuitJson = readonly AnyCircuitElement[];
type Point = {
    x: number;
    y: number;
};
type Matrix = {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
};
type Color = readonly [number, number, number, number];
type RenderOptions = {
    transform?: Matrix;
    layers?: readonly string[];
    selectedLayer?: string;
    hiddenLayerOpacity?: number;
    /** Copper-pour alpha multiplier (0–1, default 1). showCopperPours=false overrides it. */
    copperPourOpacity?: number;
    showCopperPours?: boolean;
    /** Board material is hidden by default, except beneath visible soldermask.
     * Explicit false also hides the substrate exposed by mask apertures. */
    showBoardMaterial?: boolean;
    showSolderMask?: boolean;
    showSilkscreen?: boolean;
    showFabricationNotes?: boolean;
    showPcbNotes?: boolean;
    showCourtyards?: boolean;
    highlightedElementIds?: readonly string[];
    /** Copper belonging to an inspected net. Supply resolved PCB element IDs.
     * Selected copper is opaque on every layer; other copper uses hiddenLayerOpacity.
     * Omit or pass [] to exit. Explicit layers and visibility toggles still apply.
     * Selected via and plated-hole drills stay visible; all other non-copper
     * layers and hover highlights are hidden until X-Ray is cleared.
     * Selection changes reuse the retained geometry buffers.
     */
    xRayElementIds?: readonly string[];
    background?: Color;
};
type Diagnostic = {
    elementId: string;
    type: string;
    message: string;
};
type Mesh = {
    vertices: Float32Array;
    indices: Uint32Array;
};
type CompiledLayer = {
    name: string;
    paint: Mesh;
    erase: Mesh;
};
type CompiledScene = {
    layers: CompiledLayer[];
    elementIds: string[];
    diagnostics: Diagnostic[];
    triangleCount: number;
};
type DrawerOptions = {
    /** Use down for Canvas-style coordinates; PCB world coordinates default to up. */
    textYAxis?: "up" | "down";
    layerColors?: Record<string, Color>;
    sampleCount?: 1 | 4;
    onDeviceLost?: (message: string) => void;
};

/** Retained GPU geometry: camera and highlight changes never recompile or upload vertices. */
declare class CircuitToWebGpuDrawer {
    private canvas;
    private device;
    private context;
    private config;
    /** Feature detection for clients that also support older renderer versions. */
    static readonly supportsXRayNet = true;
    realToCanvasMat: Matrix;
    readonly stats: {
        geometryUploads: number;
        frames: number;
        triangleCount: number;
        compileMs: number;
        vertexBytes: number;
    };
    private circuit?;
    private scene?;
    private layers;
    private xRayLayers;
    private xRayUniform;
    private xRayCameraGroup?;
    private uniform;
    private highlights;
    private cameraGroup?;
    private highlightKey;
    private highlightIndices;
    private sample?;
    private size;
    private disposed;
    adapterInfo?: GPUAdapterInfo;
    private lost;
    private paintPipeline;
    private erasePipeline;
    private compositePipeline;
    private sampler;
    private options;
    static create(canvas: HTMLCanvasElement | OffscreenCanvas, options?: DrawerOptions): Promise<CircuitToWebGpuDrawer>;
    private constructor();
    get diagnostics(): Diagnostic[];
    setCircuitJson(circuitJson: CircuitJson): void;
    /** Similar to circuit-to-canvas; repeated draws with the same array reuse all buffers. */
    drawElements(elements: CircuitJson, options?: RenderOptions): void;
    render(options?: RenderOptions): void;
    flush(): Promise<void>;
    private isCopper;
    private opacity;
    private xRayOrder;
    private order;
    private resize;
    private ensureTexture;
    private assertLive;
    private releaseLayers;
    dispose(): void;
}

type Element = Record<string, any>;

declare function getElementId(element: Element, index?: number): string;
/** Pure, DOM-free compiler. Exposes unsupported geometry rather than silently hiding it. */
declare function compileCircuitJson(elements: CircuitJson, options?: {
    textYAxis?: "up" | "down";
    layerColors?: Record<string, Color>;
}): CompiledScene;

declare const DEFAULT_LAYER_COLORS: Record<string, Color>;
declare const normalizeLayer: (layer: string) => string;

export { type CircuitJson, CircuitToWebGpuDrawer, type Color, type CompiledLayer, type CompiledScene, DEFAULT_LAYER_COLORS, type Diagnostic, type DrawerOptions, type Matrix, type Mesh, type Point, type RenderOptions, compileCircuitJson, getElementId, normalizeLayer };
