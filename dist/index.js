// lib/get-wire-taper-polygon.ts
function hasWireTaper(point) {
  if (!point || typeof point !== "object") return false;
  return "route_type" in point && point.route_type === "wire" && ("start_width" in point || "end_width" in point || "width_interpolation_mode" in point);
}
function getWireTaperSegments(route) {
  const result = [];
  for (let i = 0; i < route.length - 1; i++) {
    const point = route[i];
    if (!hasWireTaper(point)) continue;
    const next = route[i + 1];
    if (!next) continue;
    const end = next.route_type === "through_pad" ? next.start : { x: next.x, y: next.y };
    const layer = next.route_type === "via" ? next.from_layer : next.route_type === "through_pad" ? next.start_layer : next.layer;
    if (!end || layer !== point.layer || point.width !== point.start_width)
      continue;
    const segment = {
      start: { x: point.x, y: point.y },
      end,
      start_width: point.start_width,
      end_width: point.end_width,
      width_interpolation_mode: point.width_interpolation_mode,
      layer: point.layer,
      is_inside_copper_pour: Boolean(
        point.is_inside_copper_pour && next.is_inside_copper_pour
      )
    };
    if (isValidWireTaperSegment(segment)) result.push(segment);
  }
  return result;
}
function getWireTaperPolygon(segment) {
  const { start, end, start_width: w0, end_width: w1 } = segment;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!isValidWireTaperSegment(segment)) return [];
  const delta = Math.abs(w1 - w0);
  const steps = segment.width_interpolation_mode === "linear" ? 1 : Math.max(
    1,
    Math.ceil(Math.sqrt(delta / (1e-3 + delta * 1e-6) * (3 / 8)))
  );
  const nx = -dy / length;
  const ny = dx / length;
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = w0 <= w1 ? t : 1 - t;
    const width = segment.width_interpolation_mode === "quadratic" ? Math.min(w0, w1) + delta * u * u : w0 + (w1 - w0) * t;
    const halfWidth = width / 2;
    const x = start.x + dx * t;
    const y = start.y + dy * t;
    left.push({ x: x + nx * halfWidth, y: y + ny * halfWidth });
    right.push({ x: x - nx * halfWidth, y: y - ny * halfWidth });
  }
  return [...left, ...right.reverse()];
}
function isValidWireTaperSegment(segment) {
  const { start, end, start_width: w0, end_width: w1 } = segment;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (![start.x, start.y, end.x, end.y, length, w0, w1].every(Number.isFinite) || length <= 0 || w0 <= 0 || w1 <= 0)
    return false;
  if (segment.width_interpolation_mode !== "linear" && segment.width_interpolation_mode !== "quadratic")
    return false;
  return true;
}

// lib/geometry.ts
import earcut from "earcut";
import polygonClipping from "polygon-clipping";
var MeshBuilder = class {
  constructor(color2 = [1, 1, 1, 1], element = 0, category = 0) {
    this.color = color2;
    this.element = element;
    this.category = category;
  }
  color;
  element;
  category;
  vertices = [];
  indices = [];
  polygon(rings) {
    if (!rings[0] || rings[0].length < 3) return;
    const points = [], holes = [];
    for (const [i, ring] of rings.entries()) {
      if (i) holes.push(points.length / 2);
      for (const p of ring) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
          throw new Error("Non-finite polygon vertex");
        points.push(p.x, p.y);
      }
    }
    const triangles = earcut(points, holes, 2), base = this.vertices.length / 8;
    for (let i = 0; i < points.length; i += 2)
      this.vertices.push(
        points[i],
        points[i + 1],
        ...this.color,
        this.element,
        this.category
      );
    for (const index of triangles) this.indices.push(base + index);
  }
  line(a, b, width) {
    if (!(width > 0)) return;
    const points = capsule(a, b, width);
    this.polygon([points]);
  }
  path(points, width, closed = false) {
    for (let i = 1; i < points.length; i++)
      this.line(points[i - 1], points[i], width);
    if (closed && points.length > 2) this.line(points.at(-1), points[0], width);
  }
  fabricationPath(points, width, filled) {
    if (points.length < 2) return;
    const polygons = [];
    if (filled && points.length >= 3)
      polygons.push([points.map((p) => [p.x, p.y])]);
    if (width > 0) {
      const route = filled ? [...points, points[0]] : points;
      for (let i = 1; i < route.length; i++)
        polygons.push([
          capsule(route[i - 1], route[i], width).map((p) => [p.x, p.y])
        ]);
    }
    if (!polygons.length) return;
    const snapped = polygons.map(
      (polygon) => polygon.map(
        (ring) => ring.map(([x, y]) => [
          Math.round(x * 1e9) / 1e9,
          Math.round(y * 1e9) / 1e9
        ])
      )
    );
    for (const polygon of polygonClipping.union(
      snapped[0],
      ...snapped.slice(1)
    ))
      this.polygon(polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));
  }
  build() {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices)
    };
  }
};
function capsule(a, b, width) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x), r = width / 2;
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = angle + Math.PI / 2 + i * Math.PI / 12;
    points.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) });
  }
  for (let i = 0; i <= 12; i++) {
    const t = angle - Math.PI / 2 + i * Math.PI / 12;
    points.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) });
  }
  return points;
}
function rotate(p, center2, degrees = 0) {
  const t = degrees * Math.PI / 180, x = p.x - center2.x, y = p.y - center2.y;
  return {
    x: center2.x + x * Math.cos(t) - y * Math.sin(t),
    y: center2.y + x * Math.sin(t) + y * Math.cos(t)
  };
}
function ellipse(center2, width, height = width, rotation = 0) {
  if (!(width > 0 && height > 0)) return [];
  return Array.from({ length: 96 }, (_, i) => {
    const t = i * 2 * Math.PI / 96;
    return rotate(
      {
        x: center2.x + Math.cos(t) * width / 2,
        y: center2.y + Math.sin(t) * height / 2
      },
      center2,
      rotation
    );
  });
}
function rectangle(center2, width, height, radius = 0, rotation = 0) {
  if (!(width > 0 && height > 0)) return [];
  radius = Math.max(0, Math.min(radius, width / 2, height / 2));
  const points = [];
  for (let corner = 0; corner < 4; corner++) {
    const sx = corner === 0 || corner === 3 ? 1 : -1;
    const sy = corner < 2 ? 1 : -1;
    const steps = radius ? 24 : 1;
    for (let i = 0; i < steps; i++) {
      const t = (corner + i / (steps - 1 || 1)) * Math.PI / 2;
      points.push(
        rotate(
          {
            x: center2.x + sx * (width / 2 - radius) + radius * Math.cos(t),
            y: center2.y + sy * (height / 2 - radius) + radius * Math.sin(t)
          },
          center2,
          rotation
        )
      );
    }
  }
  return points;
}
function expandBrepRing(vertices) {
  const points = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    points.push({ x: a.x, y: a.y });
    const bulge = a.bulge ?? 0, dx = b.x - a.x, dy = b.y - a.y;
    if (!bulge || !dx && !dy) continue;
    const sweep = 4 * Math.atan(bulge);
    const center2 = {
      x: (a.x + b.x) / 2 - dy * (1 - bulge * bulge) / (4 * bulge),
      y: (a.y + b.y) / 2 + dx * (1 - bulge * bulge) / (4 * bulge)
    };
    const angle = Math.atan2(a.y - center2.y, a.x - center2.x), r = Math.hypot(a.x - center2.x, a.y - center2.y);
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 48)));
    for (let j = 1; j < steps; j++)
      points.push({
        x: center2.x + r * Math.cos(angle + sweep * j / steps),
        y: center2.y + r * Math.sin(angle + sweep * j / steps)
      });
  }
  return points;
}

// lib/draw-keepout.ts
function clip(points, offset, above) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = a.x + a.y - offset, db = b.x + b.y - offset;
    const insideA = above ? da >= 0 : da <= 0;
    const insideB = above ? db >= 0 : db <= 0;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return result;
}
function drawKeepout(mesh, rings) {
  const copperColor = mesh.color;
  const color2 = [
    copperColor[0] + (1 - copperColor[0]) * 0.4,
    copperColor[1] + (1 - copperColor[1]) * 0.4,
    copperColor[2] + (1 - copperColor[2]) * 0.4,
    copperColor[3]
  ];
  mesh.color = [color2[0], color2[1], color2[2], color2[3] * 0.2];
  mesh.polygon(rings);
  mesh.color = color2;
  const surface = new MeshBuilder();
  surface.polygon(rings);
  const halfWidth = 0.15 * Math.SQRT2 / 2;
  for (let i = 0; i < surface.indices.length; i += 3) {
    const triangle = surface.indices.slice(i, i + 3).map((index) => ({
      x: surface.vertices[index * 8],
      y: surface.vertices[index * 8 + 1]
    }));
    const offsets = triangle.map((p) => p.x + p.y);
    const start = Math.ceil(Math.min(...offsets) - halfWidth);
    const end = Math.floor(Math.max(...offsets) + halfWidth);
    for (let offset = start; offset <= end; offset++) {
      mesh.polygon([
        clip(
          clip(triangle, offset - halfWidth, true),
          offset + halfWidth,
          false
        )
      ]);
    }
  }
  mesh.color = copperColor;
}

// lib/colors.ts
import color from "color";
var rgb = (r, g, b) => [
  r / 255,
  g / 255,
  b / 255,
  1
];
var DEFAULT_LAYER_COLORS = {
  board: rgb(70, 72, 72),
  top: rgb(200, 52, 52),
  bottom: rgb(77, 127, 196),
  inner1: rgb(127, 200, 127),
  inner2: rgb(206, 125, 44),
  inner3: rgb(79, 203, 203),
  inner4: rgb(219, 98, 139),
  inner5: rgb(167, 165, 198),
  inner6: rgb(40, 204, 217),
  inner7: rgb(232, 178, 167),
  inner8: rgb(242, 237, 161),
  drill: rgb(255, 38, 226),
  top_silkscreen: rgb(242, 237, 161),
  bottom_silkscreen: rgb(242, 237, 161),
  soldermask_top: rgb(12, 55, 33),
  soldermask_bottom: rgb(12, 55, 33),
  top_fabrication: [1, 1, 1, 0.5],
  bottom_fabrication: [1, 1, 1, 0.5],
  top_notes: rgb(89, 148, 220),
  bottom_notes: rgb(89, 148, 220),
  top_courtyard: rgb(255, 0, 245),
  bottom_courtyard: rgb(38, 233, 255),
  edge_cuts: rgb(208, 210, 205)
};
var normalizeLayer = (layer) => layer.replace(/_copper$/, "");
function parseColor(value) {
  try {
    const parsed = color(value.trim().toLowerCase()).rgb();
    return [
      parsed.red() / 255,
      parsed.green() / 255,
      parsed.blue() / 255,
      parsed.alpha()
    ];
  } catch {
    throw new Error(`Unsupported color: ${value}`);
  }
}

// lib/text/fill-even-odd.ts
function contains(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
function fillEvenOdd(mesh, rings) {
  const contours = rings.filter((r) => r.length >= 3).map((ring) => ({ ring, parents: [] }));
  for (const [i, c] of contours.entries())
    c.parents = contours.flatMap(
      (other, j) => i !== j && contains(other.ring, c.ring[0]) ? [j] : []
    );
  for (const [i, c] of contours.entries())
    if (c.parents.length % 2 === 0) {
      const holes = contours.filter(
        (h) => h.parents.length === c.parents.length + 1 && h.parents.includes(i)
      );
      mesh.polygon([c.ring, ...holes.map((h) => h.ring)]);
    }
}

// node_modules/circuit-to-canvas/lib/drawer/shapes/text/getAlphabetLayout.ts
import {
  glyphAdvanceRatio,
  kerningRatio,
  textMetrics
} from "@tscircuit/alphabet";
var getAdvanceRatio = (char) => glyphAdvanceRatio[char] ?? (char === " " ? textMetrics.spaceWidthRatio : textMetrics.glyphWidthRatio);
function getAlphabetAdvanceWidth(char, nextChar, fontSize) {
  const advanceRatio = getAdvanceRatio(char);
  const letterSpacingRatio = nextChar ? textMetrics.letterSpacingRatio : 0;
  const kerningAdjustmentRatio = nextChar ? kerningRatio[char]?.[nextChar] ?? 0 : 0;
  return fontSize * (advanceRatio + letterSpacingRatio + kerningAdjustmentRatio);
}
function getAlphabetLayout(text, fontSize) {
  const glyphWidth = fontSize * textMetrics.glyphWidthRatio;
  const letterSpacing = fontSize * textMetrics.letterSpacingRatio;
  const spaceWidth = fontSize * textMetrics.spaceWidthRatio;
  const strokeWidth = fontSize * textMetrics.strokeWidthRatio;
  const lineHeight = fontSize * textMetrics.lineHeightRatio;
  const lines = text.replace(/\\n/g, "\n").split("\n");
  const lineWidths = lines.map((line) => {
    const characters = Array.from(line);
    return characters.reduce(
      (sum, char, index) => sum + getAlphabetAdvanceWidth(char, characters[index + 1], fontSize),
      0
    );
  });
  const width = lineWidths.reduce(
    (maxWidth, lineWidth) => Math.max(maxWidth, lineWidth),
    0
  );
  const height = lines.length > 1 ? fontSize + (lines.length - 1) * lineHeight : fontSize;
  return {
    width,
    height,
    glyphWidth,
    letterSpacing,
    spaceWidth,
    strokeWidth,
    lineHeight,
    lines,
    lineWidths
  };
}

// node_modules/circuit-to-canvas/lib/drawer/shapes/text/getAlphabetOutlineGroups.ts
import glyphOutlineAlphabet from "@tscircuit/alphabet/outline-polygons";
function getAlphabetOutlineGroups(params) {
  const { line, fontSize, startX, startY } = params;
  const height = fontSize;
  const glyphScaleX = fontSize;
  const characters = Array.from(line);
  const groups = [];
  let cursor = startX + params.layout.strokeWidth / 2;
  characters.forEach((char, index) => {
    const glyphRings = glyphOutlineAlphabet[char];
    if (glyphRings?.length) {
      const rings = [];
      for (const ring of glyphRings) {
        const points = ring.map((point) => ({
          x: cursor + point.x * glyphScaleX,
          y: startY + (1 - point.y) * height
        }));
        if (points.length >= 3) rings.push(points);
      }
      if (rings.length > 0) groups.push(rings);
    }
    cursor += getAlphabetAdvanceWidth(char, characters[index + 1], fontSize);
  });
  return groups;
}

// node_modules/circuit-to-canvas/lib/drawer/shapes/text/getPolygonBounds.ts
function getPolygonBounds(polygons) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const point of polygon) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (minX === Number.POSITIVE_INFINITY || minY === Number.POSITIVE_INFINITY || maxX === Number.NEGATIVE_INFINITY || maxY === Number.NEGATIVE_INFINITY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

// node_modules/circuit-to-canvas/lib/drawer/shapes/text/getTextStartPosition.ts
function getTextGeometry(alignment, layout, fontSize) {
  const baseLinePlacements = getBaseLinePlacements(alignment, layout);
  const baseGlyphGroups = getGlyphGroupsForLinePlacements(
    baseLinePlacements,
    layout,
    fontSize
  );
  const baseBounds = getPolygonBounds(baseGlyphGroups.flat());
  const startOffset = getStartOffset(alignment, layout, baseBounds);
  return {
    bounds: baseBounds ? translateBounds(baseBounds, startOffset) : null,
    glyphGroups: translateGlyphGroups(baseGlyphGroups, startOffset),
    linePlacements: baseLinePlacements.map(({ line, startX, startY }) => ({
      line,
      startX: startX + startOffset.x,
      startY: startY + startOffset.y
    })),
    startOffset
  };
}
function getApproximateTextStartPosition(alignment, layout) {
  const totalWidth = layout.width + layout.strokeWidth;
  const totalHeight = layout.height + layout.strokeWidth;
  let x = 0;
  let y = 0;
  if (alignment === "center" || alignment === "top_center" || alignment === "bottom_center") {
    x = -totalWidth / 2;
  } else if (alignment === "top_left" || alignment === "bottom_left" || alignment === "center_left") {
    x = 0;
  } else if (alignment === "top_right" || alignment === "bottom_right" || alignment === "center_right") {
    x = -totalWidth;
  } else if (alignment === "top_center" || alignment === "bottom_center") {
    x = -totalWidth / 2;
  }
  if (alignment === "center" || alignment === "center_left" || alignment === "center_right") {
    y = -totalHeight / 2;
  } else if (alignment === "top_left" || alignment === "top_right" || alignment === "top_center") {
    y = 0;
  } else if (alignment === "bottom_left" || alignment === "bottom_right" || alignment === "bottom_center") {
    y = -totalHeight;
  }
  return { x, y };
}
function getBaseLinePlacements(alignment, layout) {
  return layout.lines.map((line, lineIndex) => ({
    line,
    startX: getLineStartX({
      alignment,
      lineWidth: layout.lineWidths[lineIndex],
      maxWidth: layout.width,
      strokeWidth: layout.strokeWidth
    }),
    startY: lineIndex * layout.lineHeight
  }));
}
function getGlyphGroupsForLinePlacements(linePlacements, layout, fontSize) {
  return linePlacements.flatMap(
    ({ line, startX, startY }) => getAlphabetOutlineGroups({
      line,
      fontSize,
      startX,
      startY,
      layout
    })
  );
}
function getStartOffset(alignment, layout, bounds) {
  if (!bounds) {
    return getApproximateTextStartPosition(alignment, layout);
  }
  return {
    x: -getHorizontalAnchorPosition(alignment, bounds),
    y: -getVerticalAnchorPosition(alignment, bounds)
  };
}
function getHorizontalAnchorPosition(alignment, bounds) {
  if (alignment === "top_left" || alignment === "bottom_left" || alignment === "center_left") {
    return bounds.minX;
  }
  if (alignment === "top_right" || alignment === "bottom_right" || alignment === "center_right") {
    return bounds.maxX;
  }
  return (bounds.minX + bounds.maxX) / 2;
}
function getVerticalAnchorPosition(alignment, bounds) {
  if (alignment === "top_left" || alignment === "top_right" || alignment === "top_center") {
    return bounds.minY;
  }
  if (alignment === "bottom_left" || alignment === "bottom_right" || alignment === "bottom_center") {
    return bounds.maxY;
  }
  return (bounds.minY + bounds.maxY) / 2;
}
function translateGlyphGroups(glyphGroups, offset) {
  if (offset.x === 0 && offset.y === 0) {
    return glyphGroups;
  }
  return glyphGroups.map(
    (group) => group.map(
      (polygon) => polygon.map((point) => ({
        x: point.x + offset.x,
        y: point.y + offset.y
      }))
    )
  );
}
function translateBounds(bounds, offset) {
  return {
    minX: bounds.minX + offset.x,
    minY: bounds.minY + offset.y,
    maxX: bounds.maxX + offset.x,
    maxY: bounds.maxY + offset.y
  };
}
function getLineStartX(params) {
  const { alignment, lineWidth, maxWidth, strokeWidth } = params;
  const totalLineWidth = lineWidth + strokeWidth;
  const totalMaxWidth = maxWidth + strokeWidth;
  if (alignment === "top_left" || alignment === "bottom_left" || alignment === "center_left") {
    return 0;
  }
  if (alignment === "top_right" || alignment === "bottom_right" || alignment === "center_right") {
    return totalMaxWidth - totalLineWidth;
  }
  return (totalMaxWidth - totalLineWidth) / 2;
}

// lib/text/draw-text.ts
import { textMetrics as textMetrics2 } from "@tscircuit/alphabet";
var alphabetAscenderRatio = 940 / 1e3;
function drawText(mesh, e, yAxis = "up") {
  const text = String(e.text ?? "").replace(/\\n/g, "\n");
  if (!text) return;
  const c = e.anchor_position ?? e.center ?? { x: e.x ?? 0, y: e.y ?? 0 };
  const fontSize = e.font_size ?? 1;
  if (e.type === "pcb_note_text" && text.includes("\n")) {
    for (const [index, line] of text.split("\n").entries())
      drawText(
        mesh,
        {
          ...e,
          text: line,
          anchor_position: {
            x: c.x,
            y: c.y + (yAxis === "up" ? -1 : 1) * index * fontSize
          }
        },
        yAxis
      );
    return;
  }
  const layout = getAlphabetLayout(text, fontSize);
  const geometry = getTextGeometry(
    e.anchor_alignment ?? "center",
    layout,
    fontSize
  );
  const isNote = e.type === "pcb_note_text";
  const isFabrication = e.type === "pcb_fabrication_note_text";
  const mirrored = isFabrication ? false : isNote ? e.is_mirrored_from_top_view ?? false : e.type === "pcb_silkscreen_text" ? e.layer === "bottom" : e.is_mirrored ?? e.layer === "bottom";
  const rotation = isNote || isFabrication ? 0 : e.ccw_rotation ?? 0;
  const sign = yAxis === "up" ? -1 : 1;
  const alignment = e.anchor_alignment ?? "center";
  const ascender = alphabetAscenderRatio;
  const descender = ascender - textMetrics2.lineHeightRatio;
  const noteAnchorX = alignment.endsWith("_left") ? 0 : alignment.endsWith("_right") ? -layout.width : -layout.width / 2;
  const noteBaseline = alignment.startsWith("top_") ? ascender : alignment.startsWith("bottom_") ? descender : (ascender + descender) / 2;
  const transform2 = (p) => {
    const x = isNote ? p.x - geometry.startOffset.x - layout.strokeWidth / 2 + noteAnchorX : p.x;
    const y = isNote ? (p.y - geometry.startOffset.y - fontSize) * ascender + noteBaseline * fontSize : p.y;
    return rotate(
      { x: c.x + (mirrored ? -x : x), y: c.y + sign * y },
      c,
      -sign * rotation
    );
  };
  if (e.is_knockout && !isNote && !isFabrication) {
    const b = geometry.bounds;
    if (!b) return;
    const p = {
      left: 0.2,
      right: 0.2,
      top: 0.2,
      bottom: 0.2,
      ...e.knockout_padding
    };
    const outer = [
      { x: b.minX - p.left, y: b.minY - p.top },
      { x: b.maxX + p.right, y: b.minY - p.top },
      { x: b.maxX + p.right, y: b.maxY + p.bottom },
      { x: b.minX - p.left, y: b.maxY + p.bottom }
    ];
    fillEvenOdd(mesh, [
      outer.map(transform2),
      ...geometry.glyphGroups.flatMap(
        (group) => group.map((ring) => ring.map(transform2))
      )
    ]);
    return;
  }
  for (const group of geometry.glyphGroups)
    fillEvenOdd(
      mesh,
      group.map((ring) => ring.map(transform2))
    );
}

// node_modules/@tscircuit/math-utils/dist/chunk-5J3PCV4D.js
function midpoint(p1, p2) {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2
  };
}

// node_modules/transformation-matrix/src/applyToPoint.js
function applyToPoint(matrix, point) {
  return Array.isArray(point) ? [
    matrix.a * point[0] + matrix.c * point[1] + matrix.e,
    matrix.b * point[0] + matrix.d * point[1] + matrix.f
  ] : {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

// node_modules/transformation-matrix/src/utils.js
function isUndefined(val) {
  return typeof val === "undefined";
}

// node_modules/transformation-matrix/src/translate.js
function translate(tx, ty = 0) {
  return {
    a: 1,
    c: 0,
    e: tx,
    b: 0,
    d: 1,
    f: ty
  };
}

// node_modules/transformation-matrix/src/transform.js
function transform(...matrices) {
  matrices = Array.isArray(matrices[0]) ? matrices[0] : matrices;
  const multiply = (m1, m2) => {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e,
      b: m1.b * m2.a + m1.d * m2.b,
      d: m1.b * m2.c + m1.d * m2.d,
      f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  };
  switch (matrices.length) {
    case 0:
      throw new Error("no matrices provided");
    case 1:
      return matrices[0];
    case 2:
      return multiply(matrices[0], matrices[1]);
    default: {
      const [m1, m2, ...rest] = matrices;
      const m = multiply(m1, m2);
      return transform(m, ...rest);
    }
  }
}

// node_modules/transformation-matrix/src/rotate.js
var { cos, sin, PI } = Math;
function rotate2(angle, cx, cy) {
  const cosAngle = cos(angle);
  const sinAngle = sin(angle);
  const rotationMatrix = {
    a: cosAngle,
    c: -sinAngle,
    e: 0,
    b: sinAngle,
    d: cosAngle,
    f: 0
  };
  if (isUndefined(cx) || isUndefined(cy)) {
    return rotationMatrix;
  }
  return transform([
    translate(cx, cy),
    rotationMatrix,
    translate(-cx, -cy)
  ]);
}
function rotateDEG(angle, cx = void 0, cy = void 0) {
  return rotate2(angle * PI / 180, cx, cy);
}

// node_modules/transformation-matrix/src/scale.js
function scale(sx, sy = void 0, cx = void 0, cy = void 0) {
  if (isUndefined(sy)) sy = sx;
  const scaleMatrix = {
    a: sx,
    c: 0,
    e: 0,
    b: 0,
    d: sy,
    f: 0
  };
  if (isUndefined(cx) || isUndefined(cy)) {
    return scaleMatrix;
  }
  return transform([
    translate(cx, cy),
    scaleMatrix,
    translate(-cx, -cy)
  ]);
}

// node_modules/transformation-matrix/src/skew.js
var { tan } = Math;

// lib/pcb-dimension/get-pcb-dimension-geometry.ts
var TEXT_OFFSET_MULTIPLIER = 1.5;
var CHARACTER_WIDTH_MULTIPLIER = 0.6;
var TEXT_INTERSECTION_PADDING_MULTIPLIER = 0.3;
function getPcbDimensionGeometry({
  pcbDimension
}) {
  const dimensionDirection = normalizeVector({
    x: pcbDimension.to.x - pcbDimension.from.x,
    y: pcbDimension.to.y - pcbDimension.from.y
  });
  const perpendicularDirection = applyToPoint(rotateDEG(90), dimensionDirection);
  const offsetDirection = normalizeVector(
    pcbDimension.offset_direction ?? { x: 0, y: 0 }
  );
  const offsetDistance = pcbDimension.offset_distance ?? 0;
  const offsetVector = scaleVector(offsetDirection, offsetDistance);
  const dimensionStart = translatePoint(pcbDimension.from, offsetVector);
  const dimensionEnd = translatePoint(pcbDimension.to, offsetVector);
  const arrowSize = pcbDimension.arrow_size ?? 1;
  const dimensionStartArrowBase = translatePoint(
    dimensionStart,
    scaleVector(dimensionDirection, arrowSize)
  );
  const dimensionEndArrowBase = translatePoint(
    dimensionEnd,
    scaleVector(dimensionDirection, -arrowSize)
  );
  const arrowHalfWidthVector = scaleVector(
    perpendicularDirection,
    arrowSize / 2
  );
  const negativeArrowHalfWidthVector = scaleVector(
    perpendicularDirection,
    -arrowSize / 2
  );
  const extensionDirection = hasDirection(offsetDirection) ? offsetDirection : perpendicularDirection;
  const extensionVector = scaleVector(
    extensionDirection,
    offsetDistance + arrowSize
  );
  const dimensionMidpoint = translatePoint(
    midpoint(pcbDimension.from, pcbDimension.to),
    offsetVector
  );
  const fontSize = pcbDimension.font_size ?? 1;
  const textOffsetDistance = arrowSize * TEXT_OFFSET_MULTIPLIER + getRotatedTextClearance({
    fontSize,
    text: pcbDimension.text ?? "",
    textCcwRotationDegrees: pcbDimension.text_ccw_rotation
  });
  return {
    arrowPolygons: [
      [
        dimensionStart,
        translatePoint(dimensionStartArrowBase, arrowHalfWidthVector),
        translatePoint(dimensionStartArrowBase, negativeArrowHalfWidthVector)
      ],
      [
        dimensionEnd,
        translatePoint(dimensionEndArrowBase, arrowHalfWidthVector),
        translatePoint(dimensionEndArrowBase, negativeArrowHalfWidthVector)
      ]
    ],
    dimensionLine: {
      start: dimensionStartArrowBase,
      end: dimensionEndArrowBase,
      width: arrowSize / 5
    },
    extensionLines: [
      {
        start: pcbDimension.from,
        end: translatePoint(pcbDimension.from, extensionVector)
      },
      {
        start: pcbDimension.to,
        end: translatePoint(pcbDimension.to, extensionVector)
      }
    ],
    label: pcbDimension.text ? {
      anchorPosition: translatePoint(
        dimensionMidpoint,
        scaleVector(perpendicularDirection, textOffsetDistance)
      ),
      ccwRotationDegrees: getLabelCcwRotationDegrees({
        dimensionDirection,
        requestedCcwRotationDegrees: pcbDimension.text_ccw_rotation
      }),
      fontSize,
      text: pcbDimension.text
    } : void 0
  };
}
function getLabelCcwRotationDegrees({
  dimensionDirection,
  requestedCcwRotationDegrees
}) {
  let dimensionCcwRotationDegrees = Math.atan2(dimensionDirection.y, dimensionDirection.x) * 180 / Math.PI;
  if (dimensionCcwRotationDegrees > 90 || dimensionCcwRotationDegrees < -90) {
    dimensionCcwRotationDegrees += 180;
  }
  return dimensionCcwRotationDegrees + (requestedCcwRotationDegrees ?? 0);
}
function getRotatedTextClearance({
  fontSize,
  text,
  textCcwRotationDegrees
}) {
  if (textCcwRotationDegrees === void 0 || !Number.isFinite(textCcwRotationDegrees)) {
    return 0;
  }
  const halfWidth = text.length * fontSize * CHARACTER_WIDTH_MULTIPLIER / 2;
  const halfHeight = fontSize / 2;
  const textCcwRotationTransform = rotateDEG(textCcwRotationDegrees);
  const horizontalExtentVector = applyToPoint(textCcwRotationTransform, {
    x: halfWidth,
    y: 0
  });
  const verticalExtentVector = applyToPoint(textCcwRotationTransform, {
    x: 0,
    y: halfHeight
  });
  return Math.abs(horizontalExtentVector.y) + Math.abs(verticalExtentVector.y) + fontSize * TEXT_INTERSECTION_PADDING_MULTIPLIER;
}
function normalizeVector(vector) {
  const vectorLength = Math.hypot(vector.x, vector.y) || 1;
  return applyToPoint(scale(1 / vectorLength), vector);
}
function scaleVector(vector, scaleFactor) {
  return applyToPoint(scale(scaleFactor), vector);
}
function translatePoint(point, translation) {
  return applyToPoint(translate(translation.x, translation.y), point);
}
function hasDirection(direction) {
  return Math.abs(direction.x) > Number.EPSILON || Math.abs(direction.y) > Number.EPSILON;
}

// lib/pcb-dimension/draw-pcb-dimension.ts
function drawPcbDimension({
  mesh,
  pcbDimension,
  textYAxis
}) {
  if (pcbDimension.color) mesh.color = parseColor(pcbDimension.color);
  const { arrowPolygons, dimensionLine, extensionLines, label } = getPcbDimensionGeometry({ pcbDimension });
  for (const arrowPolygon of arrowPolygons) mesh.polygon([arrowPolygon]);
  mesh.line(dimensionLine.start, dimensionLine.end, dimensionLine.width);
  for (const extensionLine of extensionLines) {
    mesh.line(extensionLine.start, extensionLine.end, dimensionLine.width);
  }
  if (!label) return;
  drawText(
    mesh,
    {
      anchor_alignment: "center",
      anchor_position: label.anchorPosition,
      ccw_rotation: label.ccwRotationDegrees,
      font_size: label.fontSize,
      text: label.text,
      type: "pcb_dimension_text"
    },
    textYAxis
  );
}

// lib/compile-circuit.ts
function getElementId(element, index = 0) {
  return element[`${element.type}_id`] ?? `${element.type}:${index}`;
}
function center(e) {
  return e.center ?? e.anchor_position ?? { x: e.x ?? 0, y: e.y ?? 0 };
}
function shape(e, hole = false) {
  if (e.brep_shape)
    return [e.brep_shape.outer_ring, ...e.brep_shape.inner_rings ?? []].map(
      (r) => expandBrepRing(r.vertices)
    );
  if (e.outline?.length) return [e.outline];
  if (e.shape === "rotated_pill_hole_with_rect_pad") {
    const base2 = center(e);
    const c2 = hole ? {
      x: base2.x + (e.hole_offset_x ?? 0),
      y: base2.y + (e.hole_offset_y ?? 0)
    } : base2;
    const width2 = hole ? e.hole_width : e.rect_pad_width;
    const height2 = hole ? e.hole_height : e.rect_pad_height;
    return [
      rectangle(
        c2,
        width2,
        height2,
        hole ? Math.min(width2, height2) / 2 : e.rect_border_radius ?? 0,
        (hole ? e.hole_ccw_rotation : e.rect_ccw_rotation) ?? 0
      )
    ];
  }
  const kind = hole ? e.hole_shape ?? e.shape : e.shape;
  if (kind === "polygon") return [e.points ?? e.vertices ?? []];
  const base = center(e), rotation = e.rect_ccw_rotation ?? e.ccw_rotation ?? e.rotation ?? 0;
  const c = hole ? rotate(
    {
      x: base.x + (e.hole_offset_x ?? 0),
      y: base.y + (e.hole_offset_y ?? 0)
    },
    base,
    rotation
  ) : base;
  if (kind === "circle" || kind === "circular_hole_with_rect_pad" && hole || e.type === "pcb_via") {
    const diameter = hole ? e.hole_diameter : e.outer_diameter ?? (e.radius != null ? e.radius * 2 : e.diameter);
    return [
      ellipse(c, diameter || e.diameter || e.hole_diameter || e.radius * 2)
    ];
  }
  const width = hole ? e.hole_width ?? e.hole_diameter : e.rect_pad_width ?? e.outer_width ?? e.width ?? e.hole_diameter;
  const height = hole ? e.hole_height ?? e.hole_diameter : e.rect_pad_height ?? e.outer_height ?? e.height ?? e.hole_diameter;
  if (kind === "oval") return [ellipse(c, width, height, rotation)];
  if ([
    "rect",
    "square",
    "rotated_rect",
    "roundrect",
    "rounded_rect",
    "pill",
    "rotated_pill",
    "circular_hole_with_rect_pad",
    "pill_hole_with_rect_pad",
    void 0
  ].includes(kind)) {
    const pill = kind?.includes("pill") && !(kind === "pill_hole_with_rect_pad" && !hole);
    const radius = pill ? Math.min(width, height) / 2 : e.corner_radius ?? e.rect_border_radius ?? 0;
    return [rectangle(c, width, height, radius, rotation)];
  }
  throw new Error(`Unsupported shape: ${kind}`);
}
function compileCircuitJson(elements, options = {}) {
  const builders = /* @__PURE__ */ new Map();
  const diagnostics = [], elementIds = elements.map(getElementId);
  const board = elements.find((e) => e.type === "pcb_board");
  const copper = [
    "top",
    ...Array.from(
      { length: Math.max(0, Math.min(8, (board?.num_layers ?? 2) - 2)) },
      (_, i) => `inner${i + 1}`
    ),
    "bottom"
  ];
  const get = (name, index, erase = false, category = 0) => {
    name = normalizeLayer(name);
    if (!builders.has(name))
      builders.set(name, { paint: new MeshBuilder(), erase: new MeshBuilder() });
    const mesh = builders.get(name)[erase ? "erase" : "paint"];
    mesh.color = options.layerColors?.[name] ?? DEFAULT_LAYER_COLORS[name] ?? [0.75, 0.75, 0.75, 1];
    mesh.element = index;
    mesh.category = category;
    return mesh;
  };
  const openings = [];
  const keepouts = [];
  const cutouts = [];
  for (const [index, input] of elements.entries()) {
    const e = input, type = e.type;
    try {
      if (type === "pcb_board" || type === "pcb_panel") {
        const rings = shape(e);
        get("board", index).polygon(rings);
        for (const ring of rings) get("edge_cuts", index).path(ring, 0.1, true);
        for (const side of ["top", "bottom"])
          get(`soldermask_${side}`, index).polygon(rings);
      } else if (type === "pcb_cutout") {
        cutouts.push({ rings: shape(e), index });
        get("edge_cuts", index).path(shape(e)[0], 0.05, true);
      } else if (input.type === "pcb_soldermask_opening") {
        get(`soldermask_${input.layer}`, index, true).polygon(shape(input));
      } else if (type === "pcb_smtpad") {
        get(e.layer, index).polygon(shape(e));
        if (!e.is_covered_with_solder_mask)
          get(`soldermask_${e.layer}`, index, true).polygon(shape(e));
      } else if (type === "pcb_via" || type === "pcb_plated_hole") {
        let layers2 = e.layers ?? copper;
        if (type === "pcb_via" && !e.layers && e.from_layer && e.to_layer) {
          const from = copper.indexOf(e.from_layer), to = copper.indexOf(e.to_layer);
          layers2 = copper.slice(Math.min(from, to), Math.max(from, to) + 1);
        }
        for (const layer of layers2) get(layer, index).polygon(shape(e));
        openings.push({ element: e, index, layers: layers2 });
        for (const side of ["top", "bottom"])
          if (layers2.includes(side) && !e.is_covered_with_solder_mask)
            get(`soldermask_${side}`, index, true).polygon(shape(e));
      } else if (type === "pcb_hole") {
        openings.push({
          element: { ...e, shape: e.hole_shape },
          index,
          layers: copper
        });
      } else if (input.type === "pcb_trace") {
        const route = input.route;
        if (input.route_thickness_mode === "interpolated" && route.some(
          (p, i) => p.route_type === "wire" && !hasWireTaper(p) && route[i + 1]?.route_type === "wire"
        ))
          throw new Error(
            "Interpolated/through-pad traces are not supported yet"
          );
        for (const point of getWireTaperSegments(route)) {
          const polygon = getWireTaperPolygon(point);
          if (!polygon.length)
            throw new Error("Invalid teardrop geometry or interpolation mode");
          get(point.layer, index).polygon([polygon]);
        }
        for (const point of route) {
          if (point.route_type !== "through_pad") continue;
          for (const layer of /* @__PURE__ */ new Set([point.start_layer, point.end_layer]))
            get(layer, index).line(point.start, point.end, point.width);
        }
        for (let i = 1; i < route.length; i++) {
          let a = route[i - 1], b = route[i];
          if (hasWireTaper(a)) continue;
          if (a.route_type === "through_pad")
            a = {
              route_type: "wire",
              ...a.end,
              layer: a.end_layer,
              width: a.width
            };
          if (b.route_type === "through_pad")
            b = {
              route_type: "wire",
              ...b.start,
              layer: b.start_layer,
              width: b.width
            };
          if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer)
            get(a.layer, index).line(a, b, a.width);
          else if (a.route_type === "wire" && b.route_type === "via" && [b.from_layer, b.to_layer].includes(a.layer))
            get(a.layer, index).line(a, b, a.width);
          else if (a.route_type === "via" && b.route_type === "wire" && [a.from_layer, a.to_layer].includes(b.layer))
            get(b.layer, index).line(a, b, b.width);
        }
      } else if (type === "pcb_copper_pour") {
        get(e.layer, index, false, 1).polygon(shape(e));
      } else if (input.type === "pcb_copper_text") {
        drawText(get(input.layer, index), input, options.textYAxis);
      } else if (/^pcb_(silkscreen|fabrication_note|courtyard|note|user_note)_/.test(
        type
      )) {
        const group = type.match(
          /^pcb_(silkscreen|fabrication_note|courtyard|note|user_note)_/
        )[1];
        const suffix = {
          silkscreen: "silkscreen",
          fabrication_note: "fabrication",
          courtyard: "courtyard",
          note: "notes",
          user_note: "notes"
        }[group];
        const layer = `${e.layer ?? "top"}_${suffix}`;
        const mesh = get(layer, index);
        if (input.type === "pcb_note_dimension" || input.type === "pcb_fabrication_note_dimension") {
          drawPcbDimension({
            mesh,
            pcbDimension: input,
            textYAxis: options.textYAxis
          });
        } else if (input.type === "pcb_silkscreen_text" || input.type === "pcb_fabrication_note_text" || input.type === "pcb_note_text") {
          if (e.color && (group === "note" || group === "fabrication_note"))
            mesh.color = parseColor(e.color);
          drawText(mesh, input, options.textYAxis);
        } else if (input.type === "pcb_note_line" || input.type === "pcb_silkscreen_line") {
          if (input.type === "pcb_note_line" && input.color)
            mesh.color = parseColor(input.color);
          mesh.line(
            { x: input.x1, y: input.y1 },
            { x: input.x2, y: input.y2 },
            input.stroke_width ?? 0.1
          );
        } else if (type.endsWith("_path") || type.endsWith("_line") || type.endsWith("_outline")) {
          const points = e.route ?? e.points ?? e.outline ?? [e.start, e.end].filter(Boolean);
          const isFabricationPath = type === "pcb_fabrication_note_path";
          if (isFabricationPath && e.color) mesh.color = parseColor(e.color);
          if (isFabricationPath) {
            mesh.fabricationPath(
              points,
              e.has_stroke === false ? 0 : e.stroke_width ?? 0.05,
              !!e.is_filled
            );
          } else {
            mesh.path(
              points,
              e.stroke_width ?? e.width ?? 0.05,
              type.endsWith("_outline")
            );
          }
        } else if (type === "pcb_silkscreen_graphic" && e.shape === "brep") {
          mesh.polygon(shape(e));
        } else if (type.endsWith("_rect")) {
          const points = rectangle(
            center(e),
            e.width,
            e.height,
            e.corner_radius ?? 0,
            e.ccw_rotation ?? 0
          );
          if (e.is_filled) mesh.polygon([points]);
          else mesh.path(points, e.stroke_width ?? 0.05, true);
        } else if (type.endsWith("_circle")) {
          const points = ellipse(center(e), (e.radius ?? 0) * 2);
          if (e.is_filled) mesh.polygon([points]);
          else mesh.path(points, e.stroke_width ?? 0.05, true);
        } else throw new Error("Unsupported annotation geometry");
      } else if (type === "pcb_keepout") {
        keepouts.push({
          rings: shape(e),
          index,
          layers: e.layers ?? [e.layer ?? "top"]
        });
      } else if (type.startsWith("pcb_") && ![
        "pcb_component",
        "pcb_port",
        "pcb_group",
        "pcb_solder_paste",
        "pcb_debug_object",
        "pcb_trace_hint",
        "pcb_anchor",
        "pcb_breakout_point"
        // Routing target metadata, not visible geometry.
      ].includes(type) && !/_(error|warning)$/.test(type)) {
        throw new Error("Unsupported PCB element");
      }
    } catch (error) {
      diagnostics.push({
        elementId: elementIds[index],
        type,
        message: String(error)
      });
    }
  }
  for (const { rings, index, layers: layers2 } of keepouts) {
    try {
      for (const layer of layers2) drawKeepout(get(layer, index), rings);
    } catch (error) {
      diagnostics.push({
        elementId: elementIds[index],
        type: "pcb_keepout",
        message: String(error)
      });
    }
  }
  for (const { element, index, layers: layers2 } of openings) {
    const rings = shape(element, true);
    for (const layer of layers2) get(layer, index, true).polygon(rings);
    const isThrough = layers2.includes("top") && layers2.includes("bottom");
    if (isThrough) {
      get("board", index, true).polygon(rings);
      get("drill", index).polygon(rings);
    }
    for (const side of ["top", "bottom"])
      if (layers2.includes(side))
        get(`soldermask_${side}`, index, true).polygon(rings);
  }
  for (const { rings, index } of cutouts) {
    get("drill", index).polygon(rings);
    for (const name of builders.keys())
      if (name !== "edge_cuts" && name !== "drill")
        get(name, index, true).polygon(rings);
  }
  const layers = [...builders].map(([name, mesh]) => ({
    name,
    paint: mesh.paint.build(),
    erase: mesh.erase.build()
  }));
  return {
    layers,
    elementIds,
    diagnostics,
    triangleCount: layers.reduce(
      (sum, l) => sum + (l.paint.indices.length + l.erase.indices.length) / 3,
      0
    )
  };
}

// lib/shaders.ts
var geometryShader = (
  /* wgsl */
  `
struct Camera { rowX: vec4f, rowY: vec4f, viewport: vec4f }
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> highlights: array<u32>;
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) @interpolate(flat) category: u32,
  @location(2) @interpolate(flat) selected: u32,
}
@vertex fn vertexMain(@location(0) p: vec2f, @location(1) color: vec4f,
  @location(2) element: f32, @location(3) category: f32) -> VertexOut {
  let pixel = vec2f(dot(camera.rowX.xyz, vec3f(p, 1)), dot(camera.rowY.xyz, vec3f(p, 1)));
  var out: VertexOut;
  out.position = vec4f(pixel.x / camera.viewport.x * 2 - 1, 1 - pixel.y / camera.viewport.y * 2, 0, 1);
  let highlight = select(0.0, 1.0, (highlights[u32(element)] & 1u) != 0u);
  out.color = vec4f(mix(color.rgb, min(vec3f(1), color.rgb * 1.5), highlight), color.a);
  out.category = u32(category);
  out.selected = highlights[u32(element)] & 2u;
  return out;
}
@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  if (in.category == 1u && camera.viewport.z == 0) { discard; }
  if (camera.viewport.w == 1) {
    if (in.selected == 0u) { discard; }
    return vec4f(in.color.rgb, 1);
  }
  let alpha = in.color.a * select(1.0, camera.viewport.z, in.category == 1u);
  return vec4f(in.color.rgb * alpha, alpha);
}
`
);
var compositeShader = (
  /* wgsl */
  `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> fade: vec4f;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Out {
  let points = array<vec2f, 6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  var out: Out;
  out.uv = points[index];
  out.position = vec4f(out.uv.x * 2 - 1, 1 - out.uv.y * 2, 0, 1);
  return out;
}
@fragment fn fragmentMain(in: Out) -> @location(0) vec4f {
  return textureSample(image, imageSampler, in.uv) * fade.x;
}
`
);

// lib/CircuitToWebGpuDrawer.ts
var over = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
};
var CircuitToWebGpuDrawer = class _CircuitToWebGpuDrawer {
  constructor(canvas, device, context, format, config) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.config = config;
    this.uniform = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.xRayUniform = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.highlights = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const module = device.createShaderModule({ code: geometryShader });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" }
            },
            {
              binding: 1,
              visibility: GPUShaderStage.VERTEX,
              buffer: { type: "read-only-storage" }
            }
          ]
        })
      ]
    });
    const geometry = (blend) => ({
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
              { shaderLocation: 3, offset: 28, format: "float32" }
            ]
          }
        ]
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", blend }]
      },
      primitive: { topology: "triangle-list" },
      multisample: { count: config.sampleCount ?? 4 }
    });
    this.paintPipeline = device.createRenderPipeline(geometry(over));
    this.erasePipeline = device.createRenderPipeline(
      geometry({
        color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" }
      })
    );
    const composite = device.createShaderModule({ code: compositeShader });
    this.compositePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: composite, entryPoint: "vertexMain" },
      fragment: {
        module: composite,
        entryPoint: "fragmentMain",
        targets: [{ format, blend: over }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.sampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear"
    });
    device.lost.then((info) => {
      this.lost = true;
      if (!this.disposed) config.onDeviceLost?.(info.message || info.reason);
    });
  }
  canvas;
  device;
  context;
  config;
  /** Feature detection for clients that also support older renderer versions. */
  static supportsXRayNet = true;
  realToCanvasMat = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };
  stats = {
    geometryUploads: 0,
    frames: 0,
    triangleCount: 0,
    compileMs: 0,
    vertexBytes: 0
  };
  circuit;
  scene;
  layers = [];
  xRayLayers = [];
  xRayUniform;
  xRayCameraGroup;
  uniform;
  highlights;
  cameraGroup;
  highlightKey = "";
  highlightIndices = /* @__PURE__ */ new Map();
  sample;
  size = "";
  disposed = false;
  adapterInfo;
  lost = false;
  paintPipeline;
  erasePipeline;
  compositePipeline;
  sampler;
  options = {};
  static async create(canvas, options = {}) {
    if (!globalThis.navigator?.gpu) throw new Error("WebGPU is unavailable");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    if (!adapter) throw new Error("No WebGPU adapter available");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) {
      device.destroy();
      throw new Error("WebGPU canvas context is unavailable");
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    device.pushErrorScope("validation");
    try {
      const drawer = new _CircuitToWebGpuDrawer(
        canvas,
        device,
        context,
        format,
        options
      );
      const error = await device.popErrorScope();
      if (error) {
        drawer.dispose();
        throw new Error(error.message);
      }
      device.addEventListener(
        "uncapturederror",
        (event) => options.onDeviceLost?.(event.error.message)
      );
      drawer.adapterInfo = adapter.info;
      return drawer;
    } catch (error) {
      context.unconfigure();
      device.destroy();
      throw error;
    }
  }
  get diagnostics() {
    return this.scene?.diagnostics ?? [];
  }
  setCircuitJson(circuitJson) {
    this.assertLive();
    if (this.circuit === circuitJson) return;
    const start = performance.now(), scene = compileCircuitJson(circuitJson, this.config);
    this.releaseLayers();
    this.highlights.destroy();
    this.highlights = this.device.createBuffer({
      size: Math.max(4, scene.elementIds.length * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.highlightIndices = new Map(
      scene.elementIds.map((id, index) => [id, index])
    );
    this.highlightKey = "!";
    this.cameraGroup = this.device.createBindGroup({
      layout: this.paintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.highlights } }
      ]
    });
    this.xRayCameraGroup = this.device.createBindGroup({
      layout: this.paintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.xRayUniform } },
        { binding: 1, resource: { buffer: this.highlights } }
      ]
    });
    this.stats.vertexBytes = 0;
    const upload = (mesh) => {
      const make = (data, usage) => {
        const buffer = this.device.createBuffer({
          size: Math.max(4, data.byteLength),
          usage: usage | GPUBufferUsage.COPY_DST
        });
        if (data.byteLength)
          this.device.queue.writeBuffer(
            buffer,
            0,
            data.buffer,
            data.byteOffset,
            data.byteLength
          );
        this.stats.vertexBytes += data.byteLength;
        return buffer;
      };
      return {
        vertices: make(mesh.vertices, GPUBufferUsage.VERTEX),
        indices: make(mesh.indices, GPUBufferUsage.INDEX),
        count: mesh.indices.length
      };
    };
    this.layers = scene.layers.map((layer) => ({
      name: layer.name,
      paint: upload(layer.paint),
      erase: upload(layer.erase),
      opacity: this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    }));
    this.xRayLayers = this.layers.filter((layer) => this.isCopper(layer.name) || layer.name === "drill").map((layer) => ({
      ...layer,
      opacity: this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    }));
    this.scene = scene;
    this.circuit = circuitJson;
    this.size = "";
    this.stats.geometryUploads++;
    this.stats.triangleCount = scene.triangleCount;
    this.stats.compileMs = performance.now() - start;
  }
  /** Similar to circuit-to-canvas; repeated draws with the same array reuse all buffers. */
  drawElements(elements, options = {}) {
    this.setCircuitJson(elements);
    this.options = {};
    this.render(options);
  }
  render(options = {}) {
    this.assertLive();
    this.options = { ...this.options, ...options };
    const o = this.options;
    if (o.transform) this.realToCanvasMat = o.transform;
    const t = this.realToCanvasMat, width = this.canvas.width, height = this.canvas.height;
    if (!width || !height) return;
    if (![...Object.values(t), width, height].every(Number.isFinite))
      throw new Error("Invalid camera or canvas dimensions");
    if (width > this.device.limits.maxTextureDimension2D || height > this.device.limits.maxTextureDimension2D)
      throw new Error("Canvas exceeds GPU texture limits");
    const copperPourOpacity = o.showCopperPours === false ? 0 : Number.isFinite(o.copperPourOpacity) ? Math.max(0, Math.min(1, o.copperPourOpacity)) : 1;
    this.resize(width, height);
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
        0
      ])
    );
    const xRayIds = o.xRayElementIds ?? [];
    const xRayActive = xRayIds.length > 0;
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
          1
        ])
      );
    const ids = xRayActive ? [] : o.highlightedElementIds ?? [], key = JSON.stringify([ids, xRayIds]);
    if (key !== this.highlightKey) {
      const mask = new Uint32Array(
        Math.max(1, this.scene?.elementIds.length ?? 0)
      );
      for (const id of ids) {
        const i = this.highlightIndices.get(id);
        if (i !== void 0) mask[i] = 1;
      }
      for (const id of xRayIds) {
        const i = this.highlightIndices.get(id);
        if (i !== void 0) mask[i] |= 2;
      }
      this.device.queue.writeBuffer(this.highlights, 0, mask);
      this.highlightKey = key;
    }
    const selected = normalizeLayer(o.selectedLayer ?? "top"), filter = o.layers ? new Set(o.layers.map(normalizeLayer)) : void 0;
    const visible = this.layers.filter((l) => {
      if (filter && !filter.has(l.name)) return false;
      if (xRayActive && !this.isCopper(l.name)) return false;
      if (l.name === "board" && !o.showBoardMaterial) return false;
      if (l.name.startsWith("soldermask_") && (!o.showSolderMask || l.name !== `soldermask_${selected}`))
        return false;
      if (l.name.includes("silkscreen") && o.showSilkscreen === false)
        return false;
      if (l.name.includes("fabrication") && !o.showFabricationNotes)
        return false;
      if (l.name.includes("notes") && o.showPcbNotes === false) return false;
      if (l.name.includes("courtyard") && !o.showCourtyards) return false;
      return xRayActive && this.isCopper(l.name) || this.opacity(l.name, selected, o.hiddenLayerOpacity ?? 0.4) > 0;
    }).sort(
      (a, b) => this.order(a.name, selected) - this.order(b.name, selected)
    );
    const selectedLayers = xRayActive ? this.xRayLayers.filter((layer) => !filter || filter.has(layer.name)).sort(
      (a, b) => this.xRayOrder(a.name, selected) - this.xRayOrder(b.name, selected)
    ) : [];
    const renderLayers = [
      ...visible.map((layer) => ({ layer, xRay: false })),
      ...selectedLayers.map((layer) => ({ layer, xRay: true }))
    ];
    const encoder = this.device.createCommandEncoder();
    for (const { layer, xRay } of renderLayers) {
      this.ensureTexture(layer, width, height);
      const target = layer.texture.createView(), msaa = (this.config.sampleCount ?? 4) > 1;
      const pass2 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: msaa ? this.sample.createView() : target,
            ...msaa ? { resolveTarget: target } : {},
            clearValue: [0, 0, 0, 0],
            loadOp: "clear",
            storeOp: msaa ? "discard" : "store"
          }
        ]
      });
      for (const [mesh, pipeline] of [
        [layer.paint, this.paintPipeline],
        [layer.erase, this.erasePipeline]
      ]) {
        if (!mesh.count) continue;
        pass2.setBindGroup(
          0,
          xRay && pipeline === this.paintPipeline ? this.xRayCameraGroup : this.cameraGroup
        );
        pass2.setPipeline(pipeline);
        pass2.setVertexBuffer(0, mesh.vertices);
        pass2.setIndexBuffer(mesh.indices, "uint32");
        pass2.drawIndexed(mesh.count);
      }
      pass2.end();
      this.device.queue.writeBuffer(
        layer.opacity,
        0,
        new Float32Array([
          xRay ? 1 : xRayActive && this.isCopper(layer.name) ? Math.max(0, Math.min(1, o.hiddenLayerOpacity ?? 0.4)) : this.opacity(layer.name, selected, o.hiddenLayerOpacity ?? 0.4),
          0,
          0,
          0
        ])
      );
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: o.background ?? [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });
    pass.setPipeline(this.compositePipeline);
    for (const { layer } of renderLayers) {
      pass.setBindGroup(0, layer.composite);
      pass.draw(6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.stats.frames++;
  }
  async flush() {
    this.assertLive();
    await this.device.queue.onSubmittedWorkDone();
  }
  isCopper(layer) {
    return /^(top|bottom|inner\d+)$/.test(layer);
  }
  opacity(layer, selected, hidden) {
    return ["board", "drill", "edge_cuts"].includes(layer) || layer === selected || layer.startsWith(`${selected}_`) || layer.endsWith(`_${selected}`) ? 1 : Math.max(0, Math.min(1, hidden));
  }
  xRayOrder(layer, selected) {
    if (layer === "drill") return 200;
    if (layer === selected) return 100;
    if (layer === "bottom") return 0;
    if (layer.startsWith("inner")) return 20 - Number(layer.slice(5));
    return 40;
  }
  order(layer, selected) {
    if (layer === "board") return -100;
    if (layer === "drill") return 200;
    if (layer === "edge_cuts") return 150;
    const base = layer === selected ? 100 : layer.startsWith("inner") ? 20 - Number(layer.slice(5)) : layer === "bottom" ? 30 : 40;
    if (layer.includes("soldermask")) return 110;
    if (layer.startsWith(`${selected}_`)) return 120;
    return base;
  }
  resize(width, height) {
    const size = `${width}:${height}`;
    if (size === this.size) return;
    this.sample?.destroy();
    this.sample = (this.config.sampleCount ?? 4) > 1 ? this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      sampleCount: this.config.sampleCount ?? 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    }) : void 0;
    for (const layer of [...this.layers, ...this.xRayLayers]) {
      layer.texture?.destroy();
      layer.texture = void 0;
      layer.composite = void 0;
    }
    this.size = size;
  }
  ensureTexture(layer, width, height) {
    if (layer.texture) return;
    layer.texture = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    layer.composite = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: layer.texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: layer.opacity } }
      ]
    });
  }
  assertLive() {
    if (this.disposed || this.lost)
      throw new Error(this.lost ? "WebGPU device lost" : "Renderer disposed");
  }
  releaseLayers() {
    for (const layer of this.xRayLayers) {
      layer.opacity.destroy();
      layer.texture?.destroy();
    }
    this.xRayLayers = [];
    for (const layer of this.layers) {
      for (const mesh of [layer.paint, layer.erase]) {
        mesh.vertices.destroy();
        mesh.indices.destroy();
      }
      layer.opacity.destroy();
      layer.texture?.destroy();
    }
    this.layers = [];
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseLayers();
    this.sample?.destroy();
    this.uniform.destroy();
    this.xRayUniform.destroy();
    this.highlights.destroy();
    this.context.unconfigure();
    const destroyDevice = () => this.device.destroy();
    void this.device.queue.onSubmittedWorkDone().then(destroyDevice, destroyDevice);
    this.circuit = void 0;
    this.scene = void 0;
  }
};
export {
  CircuitToWebGpuDrawer,
  DEFAULT_LAYER_COLORS,
  compileCircuitJson,
  getElementId,
  normalizeLayer
};
