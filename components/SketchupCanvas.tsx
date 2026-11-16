"use client";

import { Html, Line, OrthographicCamera, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { isDrawableEdge, parseSkpWithInstancedScene, parseSkpWithScene } from "skp-core-custom";
import type { ConstructionLine, ConstructionPoint, Definition, Dimension, Edge, InstanceNode, InstancedMeshResource, InstancedNode, InstancedScene, SectionPlane, SkpModel, SkpScene, TextEntity } from "skp-core-custom";

export type RenderStyle = "shaded" | "hidden-line" | "monochrome" | "wireframe" | "xray";
export type Projection = "perspective" | "orthographic";

export type InstallationItem = {
  id: string;
  name: string;
  definitionName: string;
  layer: string;
  count: number;
  sizeMm: [number, number, number];
  positionMm: [number, number, number];
  properties: Record<string, string>;
};

export type SceneGroup = {
  id: string;
  path: string;
  name: string;
  definitionName: string;
  layer: string;
  depth: number;
  count: number;
  sizeMm: [number, number, number];
  positionMm: [number, number, number];
};

export type ScenePage = {
  name: string;
  eye: [number, number, number] | null;
  target: [number, number, number] | null;
  up: [number, number, number] | null;
  fov: number;
  parallel: boolean;
  orthoHeight: number;
  hiddenLayers: string[];
};

export type PickedEntity = {
  objectId: string;
  name: string;
  definitionName: string;
  layer: string;
  groupPath: string;
  installId: string;
  sizeMm: [number, number, number];
  positionMm: [number, number, number];
  properties: Record<string, string>;
  attributeDictionaries: Record<string, Record<string, string>>;
  abf: AbfEntityInfo | null;
};

export type AbfRole = "label" | "cuttingLines" | "edgeBanding" | "fittings" | "intersections" | "none";

export type AbfVisibility = {
  nesting: boolean;
  labels: boolean;
  cuttingLines: boolean;
  edgeBanding: boolean;
  fittings: boolean;
  intersections: boolean;
};

export type AbfEntityInfo = {
  role: AbfRole;
  inNesting: boolean;
  boardIndex: string | null;
  edgeBandTypes: string | null;
  settingName: string | null;
  attributes: Record<string, string>;
};

export type AbfPart = {
  id: string;
  boardIndex: string;
  name: string;
  layer: string;
  material: string;
  sizeMm: [number, number, number];
  edgeBandTypes: string | null;
  labelRotation: string | null;
  path: string;
};

export type AbfOperation = {
  name: string;
  count: number;
  kind: "CAM" | "Joint";
};

export type AbfConnector = {
  name: string;
  count: number;
};

export type AbfNestingSheet = {
  id: string;
  name: string;
  path: string;
  thicknessMm: number | null;
  partCount: number;
};

export type AbfInfo = {
  detected: boolean;
  boardCount: number;
  nestingSheetCount: number;
  layers: string[];
  featureCounts: Record<Exclude<AbfRole, "none">, number>;
  labelCount: number;
  operations: AbfOperation[];
  connectors: AbfConnector[];
  parts: AbfPart[];
  nestingSheets: AbfNestingSheet[];
};

export type ModelInfo = {
  units: string | null;
  bounds: [number, number, number] | null;
  dimensions: Dimension[];
  sectionPlanes: SectionPlane[];
  constructionLines: ConstructionLine[];
  constructionPoints: ConstructionPoint[];
  texts: TextEntity[];
  hiddenLayers: string[];
  abf: AbfInfo | null;
};

type ModelStats = {
  version?: string;
  definitions: number;
  layers: number;
  layerNames?: string[];
  materials: number;
  primitives: number;
  edges: number;
  scenes: number;
  dimensions: number;
  sectionPlanes: number;
  guides: number;
  units?: string | null;
  bounds?: [number, number, number];
};

type Props = {
  buffer: ArrayBuffer | null;
  showGrid: boolean;
  showEdges: boolean;
  showAxes: boolean;
  showDimensions: boolean;
  showGuides: boolean;
  renderStyle: RenderStyle;
  projection: Projection;
  fov: number;
  activeLayer: string;
  hiddenLayers: string[];
  selectedInstallId: string | null;
  selectedGroupPath: string | null;
  selectedEntity: PickedEntity | null;
  activeScene: ScenePage | null;
  activeSectionPlane: SectionPlane | null;
  abfVisibility: AbfVisibility;
  explodeFactor: number;
  measureMode: boolean;
  measurementPoints: Point[];
  viewPreset: "iso" | "front" | "top";
  onStats: (stats: ModelStats) => void;
  onInstallationItems: (items: InstallationItem[]) => void;
  onGroups: (groups: SceneGroup[]) => void;
  onScenes: (scenes: ScenePage[]) => void;
  onModelInfo: (info: ModelInfo) => void;
  onEntitySelect: (entity: PickedEntity | null, isolate?: boolean) => void;
  onMeasurePoint: (point: Point) => void;
  onProgress: (value: number) => void;
  onError: (message: string | null) => void;
};

export function normalizeLayerName(value: unknown) {
  const name = String(value ?? "").replace(/\0/g, "").trim();
  return name || "Layer0";
}

type GltfMaterialDefinition = {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: { index: number };
  };
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
};

type Matrix = number[];
type Point = [number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const INCH_TO_METRE = 0.0254;
const BVH_TRIANGLE_THRESHOLD = 2000;

type BvhGeometry = THREE.BufferGeometry & {
  boundsTree?: unknown;
  computeBoundsTree?: (options?: { maxLeafTris?: number }) => void;
  disposeBoundsTree?: () => void;
};

let bvhInstalled = false;

function prepareGeometryForRaycast(geometry: THREE.BufferGeometry) {
  const triangleCount = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  if (triangleCount < BVH_TRIANGLE_THRESHOLD) return;
  if (!bvhInstalled) {
    (THREE.BufferGeometry.prototype as BvhGeometry).computeBoundsTree = computeBoundsTree;
    (THREE.BufferGeometry.prototype as BvhGeometry).disposeBoundsTree = disposeBoundsTree;
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    bvhInstalled = true;
  }
  (geometry as BvhGeometry).computeBoundsTree?.({ maxLeafTris: 12 });
}

function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  const aa = a.length === 16 ? a : [...a.slice(0, 12), 1];
  const bb = b.length === 16 ? b : [...b.slice(0, 12), 1];
  if (aa.length === 16 && bb.length === 16) {
    const result = new Array(16).fill(0);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        for (let k = 0; k < 4; k += 1) result[column * 4 + row] += aa[k * 4 + row] * bb[column * 4 + k];
      }
    }
    return result;
  }
  return [
    aa[0] * bb[0] + aa[1] * bb[3] + aa[2] * bb[6],
    aa[0] * bb[1] + aa[1] * bb[4] + aa[2] * bb[7],
    aa[0] * bb[2] + aa[1] * bb[5] + aa[2] * bb[8],
    aa[3] * bb[0] + aa[4] * bb[3] + aa[5] * bb[6],
    aa[3] * bb[1] + aa[4] * bb[4] + aa[5] * bb[7],
    aa[3] * bb[2] + aa[4] * bb[5] + aa[5] * bb[8],
    aa[6] * bb[0] + aa[7] * bb[3] + aa[8] * bb[6],
    aa[6] * bb[1] + aa[7] * bb[4] + aa[8] * bb[7],
    aa[6] * bb[2] + aa[7] * bb[5] + aa[8] * bb[8],
    aa[0] * bb[9] + aa[1] * bb[10] + aa[2] * bb[11] + aa[9],
    aa[3] * bb[9] + aa[4] * bb[10] + aa[5] * bb[11] + aa[10],
    aa[6] * bb[9] + aa[7] * bb[10] + aa[8] * bb[11] + aa[11],
    1,
  ];
}

function transformPoint(matrix: Matrix, point: Point): Point {
  if (matrix.length === 16) {
    return [
      matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
      matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
      matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
    ];
  }
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[9],
    matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2] + matrix[10],
    matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2] + matrix[11],
  ];
}

function toThreePoint(point: Point): Point {
  return [point[0] * INCH_TO_METRE, point[2] * INCH_TO_METRE, -point[1] * INCH_TO_METRE];
}

function sectionPlaneToThree(section: SectionPlane) {
  const [a, b, c, d] = section.plane;
  const lengthSquared = a * a + b * b + c * c;
  if (lengthSquared < 1e-12) return null;
  const point = toScenePoint([
    (-d * a) / lengthSquared,
    (-d * b) / lengthSquared,
    (-d * c) / lengthSquared,
  ]);
  const normal = new THREE.Vector3(a, c, -b).normalize();
  return new THREE.Plane(normal, -normal.dot(point));
}

function installationId(metadata: { name?: string; definitionName?: string; layer?: string }) {
  return [metadata.name || "Component", metadata.definitionName || "", metadata.layer || "Layer0"].join("::");
}

type AbfMetadata = {
  name?: string;
  layer?: string;
  path?: string;
  properties?: Record<string, string>;
  attributeDictionaries?: Record<string, Record<string, string>>;
};

function inspectAbfMetadata(metadata: AbfMetadata): AbfEntityInfo | null {
  const rawAttributes = Object.entries(metadata.attributeDictionaries || {}).find(([name]) => name.toLowerCase() === "abf")?.[1] || {};
  const attributes = Object.fromEntries(Object.entries(rawAttributes).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const text = `${metadata.name || ""} ${metadata.layer || ""} ${metadata.path || ""}`.toLowerCase();
  const hasAbfData = Object.keys(attributes).length > 0 || text.includes("abf");
  if (!hasAbfData) return null;

  let role: AbfRole = "none";
  if (Object.prototype.hasOwnProperty.call(attributes, "is-intersect") || text.includes("intersect")) role = "intersections";
  else if (text.includes("label")) role = "label";
  else if (text.includes("cuttingline") || text.includes("cutting-lines")) role = "cuttingLines";
  else if (text.includes("edgeband") || text.includes("edge-band")) role = "edgeBanding";
  else if (text.includes("minifix") || text.includes("hinge") || text.includes("screw") || text.includes("drill") || text.includes("mortise") || text.includes("tenon") || text.includes("abf-d")) role = "fittings";

  return {
    role,
    inNesting: text.includes("__abf_nesting"),
    boardIndex: attributes["board-index"] || null,
    edgeBandTypes: attributes["edge-band-types"] || null,
    settingName: attributes["setting-name"] || null,
    attributes,
  };
}

function abfMetadataText(metadata: AbfMetadata, abf: AbfEntityInfo) {
  return [
    metadata.name,
    metadata.layer,
    metadata.path,
    ...Object.keys(metadata.properties || {}),
    ...Object.values(metadata.properties || {}),
    ...Object.keys(abf.attributes),
    ...Object.values(abf.attributes),
  ].filter(Boolean).join(" ").toLowerCase();
}

function abfConnectorName(metadata: AbfMetadata, abf: AbfEntityInfo) {
  const text = abfMetadataText(metadata, abf);
  if (text.includes("lockdowel") || text.includes("lock dowel")) return "Lockdowel";
  if (text.includes("minifix")) return "Minifix";
  if (text.includes("hinge") || text.includes("bản lề")) return "Hinge";
  if (text.includes("dowel") || text.includes("cam lock") || text.includes("camlock")) return "Dowel / cam lock";
  if (text.includes("screw") || text.includes("bolt") || text.includes("bu-lông")) return "Screw / bolt";
  return null;
}

function abfOperation(metadata: AbfMetadata, abf: AbfEntityInfo) {
  if (abf.settingName) return abf.settingName;
  if (abf.role === "intersections") return "ABF intersection";
  return null;
}

function applyExplode(root: THREE.Object3D, factor: number) {
  const modelBox = new THREE.Box3().setFromObject(root);
  const modelCenter = modelBox.getCenter(new THREE.Vector3());
  const modelSize = modelBox.getSize(new THREE.Vector3()).length();
  const maxExplodeDistance = Math.max(2.8, modelSize * 0.65);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.isSkpMesh) return;
    if (!object.userData.explodeOffset) {
      const objectCenter = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
      const direction = objectCenter.sub(modelCenter);
      if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
      const distance = Math.max(0.25, objectCenter.distanceTo(modelCenter) * 0.58);
      object.userData.explodeOffset = direction.normalize().multiplyScalar(Math.min(maxExplodeDistance, distance));
    }
    object.position.copy(object.userData.explodeOffset).multiplyScalar(factor);
  });
}

function primitiveBounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    min[0] = Math.min(min[0], positions[index]);
    min[1] = Math.min(min[1], positions[index + 1]);
    min[2] = Math.min(min[2], positions[index + 2]);
    max[0] = Math.max(max[0], positions[index]);
    max[1] = Math.max(max[1], positions[index + 1]);
    max[2] = Math.max(max[2], positions[index + 2]);
  }
  return [
    Math.round(Math.max(0, max[0] - min[0]) * 1000),
    Math.round(Math.max(0, max[1] - min[1]) * 1000),
    Math.round(Math.max(0, max[2] - min[2]) * 1000),
  ] as [number, number, number];
}

function buildAbfInfo(parsed: SkpScene, model: SkpModel): AbfInfo | null {
  const layers = new Set<string>();
  const parts = new Map<string, AbfPart>();
  const sheets = new Map<string, AbfNestingSheet>();
  const operations = new Map<string, AbfOperation>();
  const connectors = new Map<string, number>();
  let labelCount = 0;
  const featureCounts: AbfInfo["featureCounts"] = {
    label: 0,
    cuttingLines: 0,
    edgeBanding: 0,
    fittings: 0,
    intersections: 0,
  };

  for (const primitive of parsed.glbPrimitives) {
    const metadata = parsed.meshIndex[primitive.geomName];
    if (!metadata) continue;
    const abf = inspectAbfMetadata(metadata);
    if (!abf) continue;
    if (metadata.layer?.toLowerCase().includes("abf")) layers.add(metadata.layer);
    if (abf.role !== "none") featureCounts[abf.role] += 1;
    if (abf.attributes["label-rotation"] !== undefined) labelCount += 1;
    const operationName = abfOperation(metadata, abf);
    if (operationName) {
      const key = `${abf.role === "intersections" ? "CAM" : "Joint"}:${operationName}`;
      const existing = operations.get(key);
      operations.set(key, existing ? { ...existing, count: existing.count + 1 } : { name: operationName, count: 1, kind: abf.role === "intersections" ? "CAM" : "Joint" });
    }
    const connectorName = abfConnectorName(metadata, abf);
    if (connectorName) connectors.set(connectorName, (connectors.get(connectorName) || 0) + 1);

    if (abf.boardIndex) {
      const id = abf.boardIndex;
      const material = model.materials[primitive.materialIndex]?.name || `Material #${primitive.materialIndex}`;
      const existing = parts.get(id);
      if (!existing) {
        parts.set(id, {
          id,
          boardIndex: id,
          name: metadata.name || `Part ${id}`,
          layer: metadata.layer || "Layer0",
          material,
          sizeMm: primitiveBounds(primitive.positions),
          edgeBandTypes: abf.edgeBandTypes,
          labelRotation: abf.attributes["label-rotation"] || null,
          path: metadata.path,
        });
      }
    }

    if (abf.inNesting) {
      const segments = (metadata.path || "ROOT").split(" / ");
      const sheetName = segments.find((segment) => segment.toLowerCase().startsWith("__") && segment.toLowerCase().includes("sheet-"));
      if (sheetName) {
        const sheetPath = segments.slice(0, segments.indexOf(sheetName) + 1).join(" / ");
        const thicknessMatch = sheetName.match(/(\d+(?:\.\d+)?)mm/i);
        const sheet = sheets.get(sheetPath) ?? {
          id: sheetPath,
          name: sheetName.replace(/^__/, ""),
          path: sheetPath,
          thicknessMm: thicknessMatch ? Number(thicknessMatch[1]) : null,
          partCount: 0,
        };
        if (segments.length > segments.indexOf(sheetName) + 1 && !metadata.name?.toLowerCase().includes("abf")) sheet.partCount += 1;
        sheets.set(sheetPath, sheet);
      }
    }
  }

  const detected = layers.size > 0 || parts.size > 0 || sheets.size > 0;
  if (!detected) return null;
  return {
    detected,
    boardCount: parts.size,
    nestingSheetCount: sheets.size,
    layers: [...layers].sort(),
    featureCounts,
    labelCount,
    operations: [...operations.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    connectors: [...connectors.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    parts: [...parts.values()].sort((a, b) => Number(a.boardIndex) - Number(b.boardIndex)),
    nestingSheets: [...sheets.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function buildAbfInfoFromInstanced(parsed: InstancedScene, model: SkpModel): AbfInfo | null {
  const resources = new Map(parsed.meshResources.map((resource) => [resource.id, resource]));
  const layers = new Set<string>();
  const parts = new Map<string, AbfPart>();
  const sheets = new Map<string, AbfNestingSheet>();
  const operations = new Map<string, AbfOperation>();
  const connectors = new Map<string, number>();
  let labelCount = 0;
  const featureCounts: AbfInfo["featureCounts"] = { label: 0, cuttingLines: 0, edgeBanding: 0, fittings: 0, intersections: 0 };
  walkInstancedScene(parsed, (node, path) => {
    if (!node.meshResourceId) return;
    const resource = resources.get(node.meshResourceId);
    if (!resource) return;
    const metadata: AbfMetadata = {
      name: node.name,
      layer: node.layer,
      path,
      properties: node.properties,
      attributeDictionaries: node.attributeDictionaries,
    };
    const abf = inspectAbfMetadata(metadata);
    if (!abf) return;
    if (node.layer?.toLowerCase().includes("abf")) layers.add(node.layer);
    if (abf.role !== "none") featureCounts[abf.role] += 1;
    if (abf.attributes["label-rotation"] !== undefined) labelCount += 1;
    const operationName = abfOperation(metadata, abf);
    if (operationName) {
      const key = `${abf.role === "intersections" ? "CAM" : "Joint"}:${operationName}`;
      const existing = operations.get(key);
      operations.set(key, existing ? { ...existing, count: existing.count + 1 } : { name: operationName, count: 1, kind: abf.role === "intersections" ? "CAM" : "Joint" });
    }
    const connectorName = abfConnectorName(metadata, abf);
    if (connectorName) connectors.set(connectorName, (connectors.get(connectorName) || 0) + 1);
    const primitive = resource.primitives[0];
    if (abf.boardIndex && primitive) {
      const material = model.materials[primitive.materialIndex]?.name || `Material #${primitive.materialIndex}`;
      if (!parts.has(abf.boardIndex)) {
        parts.set(abf.boardIndex, {
          id: abf.boardIndex,
          boardIndex: abf.boardIndex,
          name: node.name || `Part ${abf.boardIndex}`,
          layer: node.layer || "Layer0",
          material,
          sizeMm: primitiveBounds(primitive.positions),
          edgeBandTypes: abf.edgeBandTypes,
          labelRotation: abf.attributes["label-rotation"] || null,
          path,
        });
      }
    }
    if (abf.inNesting) {
      const segments = path.split(" / ");
      const sheetName = segments.find((segment) => segment.toLowerCase().startsWith("__") && segment.toLowerCase().includes("sheet-"));
      if (sheetName) {
        const sheetPath = segments.slice(0, segments.indexOf(sheetName) + 1).join(" / ");
        const thicknessMatch = sheetName.match(/(\d+(?:\.\d+)?)mm/i);
        const sheet = sheets.get(sheetPath) ?? { id: sheetPath, name: sheetName.replace(/^__/, ""), path: sheetPath, thicknessMm: thicknessMatch ? Number(thicknessMatch[1]) : null, partCount: 0 };
        if (segments.length > segments.indexOf(sheetName) + 1 && !node.name?.toLowerCase().includes("abf")) sheet.partCount += 1;
        sheets.set(sheetPath, sheet);
      }
    }
  });
  if (layers.size === 0 && parts.size === 0 && sheets.size === 0) return null;
  return {
    detected: true,
    boardCount: parts.size,
    nestingSheetCount: sheets.size,
    layers: [...layers].sort(),
    featureCounts,
    labelCount,
    operations: [...operations.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    connectors: [...connectors.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    parts: [...parts.values()].sort((a, b) => Number(a.boardIndex) - Number(b.boardIndex)),
    nestingSheets: [...sheets.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function abfIsVisible(entity: AbfEntityInfo | null, visibility: AbfVisibility) {
  if (!entity) return true;
  if (entity.inNesting && !visibility.nesting) return false;
  if (entity.role === "label") return visibility.labels;
  if (entity.role === "cuttingLines") return visibility.cuttingLines;
  if (entity.role === "edgeBanding") return visibility.edgeBanding;
  if (entity.role === "fittings") return visibility.fittings;
  if (entity.role === "intersections") return visibility.intersections;
  return true;
}

function collectInstallationItems(parsed: SkpScene): InstallationItem[] {
  const grouped = new Map<string, { name: string; definitionName: string; layer: string; paths: Set<string>; boundsByPath: Map<string, { min: Point; max: Point }>; positionMm: [number, number, number]; properties: Record<string, string> }>();
  for (const primitive of parsed.glbPrimitives) {
    const metadata = parsed.meshIndex[primitive.geomName];
    if (!metadata || metadata.name === "ROOT") continue;
    const id = installationId(metadata);
    const existing = grouped.get(id) ?? {
      name: metadata.name,
      definitionName: metadata.definitionName,
      layer: metadata.layer,
      paths: new Set<string>(),
      boundsByPath: new Map(),
      positionMm: metadata.positionMm,
      properties: metadata.properties || {},
    };
    existing.paths.add(metadata.path);
    const pathBounds = existing.boundsByPath.get(metadata.path) ?? {
      min: [Infinity, Infinity, Infinity] as Point,
      max: [-Infinity, -Infinity, -Infinity] as Point,
    };
    for (let index = 0; index < primitive.positions.length; index += 3) {
      pathBounds.min[0] = Math.min(pathBounds.min[0], primitive.positions[index]);
      pathBounds.min[1] = Math.min(pathBounds.min[1], primitive.positions[index + 1]);
      pathBounds.min[2] = Math.min(pathBounds.min[2], primitive.positions[index + 2]);
      pathBounds.max[0] = Math.max(pathBounds.max[0], primitive.positions[index]);
      pathBounds.max[1] = Math.max(pathBounds.max[1], primitive.positions[index + 1]);
      pathBounds.max[2] = Math.max(pathBounds.max[2], primitive.positions[index + 2]);
    }
    existing.boundsByPath.set(metadata.path, pathBounds);
    grouped.set(id, existing);
  }
  return [...grouped.entries()]
    .map(([id, item]) => ({
      id,
      name: item.name,
      definitionName: item.definitionName,
      layer: item.layer,
      count: item.paths.size,
      sizeMm: [
        Math.round(Math.max(...[...item.boundsByPath.values()].map((bounds) => bounds.max[0] - bounds.min[0])) * 1000),
        Math.round(Math.max(...[...item.boundsByPath.values()].map((bounds) => bounds.max[1] - bounds.min[1])) * 1000),
        Math.round(Math.max(...[...item.boundsByPath.values()].map((bounds) => bounds.max[2] - bounds.min[2])) * 1000),
      ] as [number, number, number],
      positionMm: item.positionMm,
      properties: item.properties,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function collectSceneGroups(parsed: SkpScene): SceneGroup[] {
  const nodeMeta = new Map<string, { name: string; definitionName: string; layer: string; positionMm: [number, number, number] }>();
  const nodePaths = new Set<string>();
  const indexNodes = (node: InstanceNode, parentPath: string) => {
    const path = node.name === "ROOT" ? "ROOT" : `${parentPath} / ${node.name}`;
    if (path !== "ROOT") {
      nodePaths.add(path);
      nodeMeta.set(path, { name: node.name || "Group", definitionName: node.definitionName || "", layer: node.layer || "Layer0", positionMm: node.positionMm });
    }
    node.children.forEach((child) => indexNodes(child, path));
  };
  indexNodes(parsed.sceneHierarchy, "ROOT");

  const grouped = new Map<string, {
    name: string;
    definitionName: string;
    layer: string;
    depth: number;
    paths: Set<string>;
    positionMm: [number, number, number];
    min: Point;
    max: Point;
  }>();

  for (const primitive of parsed.glbPrimitives) {
    const metadata = parsed.meshIndex[primitive.geomName];
    if (!metadata || metadata.path === "ROOT" || isAbfInternalPath(metadata.path)) continue;
    const segments = metadata.path.split(" / ");
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join(" / ");
      if (!nodePaths.has(path) || isAbfInternalPath(path)) continue;
      const existing = grouped.get(path) ?? {
        name: segments[index] || "Group",
        definitionName: metadata.definitionName,
        layer: metadata.layer,
        depth: index,
        paths: new Set<string>(),
        positionMm: metadata.positionMm,
        min: [Infinity, Infinity, Infinity] as Point,
        max: [-Infinity, -Infinity, -Infinity] as Point,
      };
      existing.paths.add(metadata.path);
      for (let vertex = 0; vertex < primitive.positions.length; vertex += 3) {
        existing.min[0] = Math.min(existing.min[0], primitive.positions[vertex]);
        existing.min[1] = Math.min(existing.min[1], primitive.positions[vertex + 1]);
        existing.min[2] = Math.min(existing.min[2], primitive.positions[vertex + 2]);
        existing.max[0] = Math.max(existing.max[0], primitive.positions[vertex]);
        existing.max[1] = Math.max(existing.max[1], primitive.positions[vertex + 1]);
        existing.max[2] = Math.max(existing.max[2], primitive.positions[vertex + 2]);
      }
      grouped.set(path, existing);
    }
  }

  return [...grouped.entries()]
    .map(([path, group]) => ({
      id: path,
      path,
      name: nodeMeta.get(path)?.name || group.name,
      definitionName: nodeMeta.get(path)?.definitionName || group.definitionName,
      layer: nodeMeta.get(path)?.layer || group.layer,
      depth: path.split(" / ").length - 1,
      count: 1,
      sizeMm: [
        Math.round((group.max[0] - group.min[0]) * 1000),
        Math.round((group.max[1] - group.min[1]) * 1000),
        Math.round((group.max[2] - group.min[2]) * 1000),
      ] as [number, number, number],
      positionMm: nodeMeta.get(path)?.positionMm || group.positionMm,
    }))
    .filter((group) => group.count > 0 && nodePaths.has(group.path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function isAbfInternalPath(path: string) {
  return path.split(" / ").some((segment) => segment.startsWith("_ABF") || segment.startsWith("__ABF_"));
}

function instancedNodeLabel(node: InstancedNode) {
  return node.name || node.definitionName || "Group";
}

function instancedWorldBox(resource: InstancedMeshResource, world: THREE.Matrix4) {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const primitive of resource.primitives) {
    for (let index = 0; index < primitive.positions.length; index += 3) {
      point.set(primitive.positions[index], primitive.positions[index + 1], primitive.positions[index + 2]).applyMatrix4(world);
      box.expandByPoint(point);
    }
  }
  return box;
}

function walkInstancedScene(scene: InstancedScene, callback: (node: InstancedNode, path: string, world: THREE.Matrix4) => void) {
  const walk = (node: InstancedNode, parentPath: string, parentWorld: THREE.Matrix4) => {
    const path = node.name === "ROOT" ? "ROOT" : parentPath === "ROOT" ? instancedNodeLabel(node) : `${parentPath} / ${instancedNodeLabel(node)}`;
    const world = parentWorld.clone().multiply(new THREE.Matrix4().fromArray(node.matrix));
    callback(node, path, world);
    node.children.forEach((child) => walk(child, path, world));
  };
  walk(scene.sceneHierarchy, "ROOT", new THREE.Matrix4());
}

function collectInstancedInstallationItems(scene: InstancedScene): InstallationItem[] {
  const resources = new Map(scene.meshResources.map((resource) => [resource.id, resource]));
  const grouped = new Map<string, { name: string; definitionName: string; layer: string; paths: Set<string>; size: THREE.Vector3; positionMm: [number, number, number]; properties: Record<string, string> }>();
  walkInstancedScene(scene, (node, path, world) => {
    if (path === "ROOT" || !node.meshResourceId) return;
    const resource = resources.get(node.meshResourceId);
    if (!resource) return;
    const id = installationId({ name: node.name || resource.definitionName, definitionName: node.definitionName || resource.definitionName, layer: node.layer });
    const box = instancedWorldBox(resource, world);
    const size = box.getSize(new THREE.Vector3());
    const existing = grouped.get(id) ?? {
      name: node.name || resource.definitionName || "Component",
      definitionName: node.definitionName || resource.definitionName,
      layer: node.layer || "Layer0",
      paths: new Set<string>(),
      size: new THREE.Vector3(),
      positionMm: node.positionMm,
      properties: node.properties || {},
    };
    existing.paths.add(path);
    existing.size.max(size);
    grouped.set(id, existing);
  });
  return [...grouped.entries()].map(([id, item]) => ({
    id,
    name: item.name,
    definitionName: item.definitionName,
    layer: item.layer,
    count: item.paths.size,
    sizeMm: [Math.round(item.size.x * 1000), Math.round(item.size.y * 1000), Math.round(item.size.z * 1000)] as [number, number, number],
    positionMm: item.positionMm,
    properties: item.properties,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function collectInstancedGroups(scene: InstancedScene): SceneGroup[] {
  const resources = new Map(scene.meshResources.map((resource) => [resource.id, resource]));
  const nodeMeta = new Map<string, { name: string; definitionName: string; layer: string; positionMm: [number, number, number] }>();
  const nodePaths = new Set<string>();
  const grouped = new Map<string, { name: string; definitionName: string; layer: string; depth: number; paths: Set<string>; min: THREE.Vector3; max: THREE.Vector3; positionMm: [number, number, number] }>();
  walkInstancedScene(scene, (node, path, world) => {
    if (path === "ROOT") return;
    nodePaths.add(path);
    nodeMeta.set(path, { name: node.name || "Group", definitionName: node.definitionName || "", layer: node.layer || "Layer0", positionMm: node.positionMm });
    if (!node.meshResourceId || isAbfInternalPath(path)) return;
    const resource = resources.get(node.meshResourceId);
    if (!resource) return;
    const box = instancedWorldBox(resource, world);
    const segments = path.split(" / ");
    for (let index = 0; index < segments.length; index += 1) {
      const groupPath = segments.slice(0, index + 1).join(" / ");
      if (!nodePaths.has(groupPath) || isAbfInternalPath(groupPath)) continue;
      const existing = grouped.get(groupPath) ?? {
        name: segments[index],
        definitionName: node.definitionName || resource.definitionName,
        layer: node.layer || "Layer0",
        depth: index,
        paths: new Set<string>(),
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        positionMm: node.positionMm,
      };
      existing.paths.add(path);
      existing.min.min(box.min);
      existing.max.max(box.max);
      if (groupPath === path) {
        existing.name = node.name || existing.name;
        existing.definitionName = node.definitionName || existing.definitionName;
        existing.layer = node.layer || existing.layer;
        existing.positionMm = node.positionMm;
      }
      grouped.set(groupPath, existing);
    }
  });
  return [...grouped.entries()].map(([path, group]) => {
    const size = group.max.clone().sub(group.min);
    const metadata = nodeMeta.get(path);
    return {
      id: path,
      path,
      name: metadata?.name || group.name,
      definitionName: metadata?.definitionName || group.definitionName,
      layer: metadata?.layer || group.layer,
      depth: path.split(" / ").length - 1,
      count: 1,
      sizeMm: [Math.round(size.x * 1000), Math.round(size.y * 1000), Math.round(size.z * 1000)] as [number, number, number],
      positionMm: metadata?.positionMm || group.positionMm,
    };
  }).filter((group) => group.count > 0 && nodePaths.has(group.path)).sort((a, b) => a.path.localeCompare(b.path));
}

type SceneHierarchyNode = {
  layer?: string;
  children?: SceneHierarchyNode[];
};

function collectSketchupEdges(model: SkpModel, sceneHierarchy: SceneHierarchyNode) {
  const positionsByLayer = new Map<string, number[]>();
  const visit = (definition: Definition, matrix: Matrix, stack: Set<number>, inheritedLayer: string, sceneNode?: SceneHierarchyNode) => {
    const layer = normalizeLayerName(sceneNode?.layer || inheritedLayer);
    const positions = positionsByLayer.get(layer) ?? [];
    positionsByLayer.set(layer, positions);
    const vertices = new Map(definition.vertices.map((vertex) => [vertex.id, [vertex.x, vertex.y, vertex.z] as Point]));
    definition.edges.forEach((edge: Edge) => {
      if (!isDrawableEdge(edge)) return;
      const start = vertices.get(edge.v1Id);
      const end = vertices.get(edge.v2Id);
      if (!start || !end) return;
      const a = toThreePoint(transformPoint(matrix, start));
      const b = toThreePoint(transformPoint(matrix, end));
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    });
    definition.instances.forEach((instance, index) => {
      if (instance.hidden || stack.has(instance.refIdx)) return;
      const child = model.definitions.get(instance.refIdx);
      if (!child) return;
      const nextStack = new Set(stack);
      nextStack.add(instance.refIdx);
      const childNode = sceneNode?.children?.[index];
      const childLayer = normalizeLayerName(childNode?.layer || instance.layer || layer);
      visit(child, multiplyMatrices(matrix, instance.matrix), nextStack, childLayer, childNode);
    });
  };
  visit(model.root, IDENTITY, new Set([model.root.id]), "Layer0", sceneHierarchy);
  return new Map([...positionsByLayer.entries()].map(([layer, positions]) => [layer, new Float32Array(positions)]));
}

function materialColor(definition: GltfMaterialDefinition | undefined) {
  const factor = definition?.pbrMetallicRoughness?.baseColorFactor ?? [0.72, 0.73, 0.7, 1];
  return { color: new THREE.Color(factor[0], factor[1], factor[2]), alpha: factor[3] ?? 1 };
}

function makeMaterials(definition: GltfMaterialDefinition | undefined, texture?: THREE.Texture | null) {
  const { color, alpha } = materialColor(definition);
  const transparent = definition?.alphaMode === "BLEND" || alpha < 0.999;
  const mapProps = texture ? { map: texture } : {};
  return {
    shaded: new THREE.MeshLambertMaterial({ ...mapProps, color, flatShading: true, side: THREE.DoubleSide, transparent, opacity: alpha, depthWrite: !transparent }),
    hiddenLine: new THREE.MeshBasicMaterial({ color: "#eeeae1", side: THREE.DoubleSide }),
    monochrome: new THREE.MeshLambertMaterial({ color: "#dedbd0", flatShading: true, side: THREE.DoubleSide }),
    wireframe: new THREE.MeshBasicMaterial({ color: "#566064", wireframe: true, side: THREE.DoubleSide }),
    xray: new THREE.MeshBasicMaterial({ ...mapProps, color: "#aabfc0", side: THREE.DoubleSide, transparent: true, opacity: 0.34, depthWrite: false }),
  };
}

function ModelLoader({ buffer, renderStyle, showEdges, activeLayer, hiddenLayers, selectedInstallId, selectedGroupPath, activeSectionPlane, abfVisibility, explodeFactor, onStats, onInstallationItems, onGroups, onScenes, onModelInfo, onProgress, onError, onReady }: Omit<Props, "showGrid" | "showAxes" | "showDimensions" | "showGuides" | "projection" | "fov" | "activeScene" | "measureMode" | "measurementPoints" | "viewPreset" | "selectedEntity" | "onEntitySelect" | "onMeasurePoint" | "onModelInfo"> & { activeSectionPlane: SectionPlane | null; onModelInfo: (info: ModelInfo) => void; onReady: (root: THREE.Object3D) => void }) {
  const { scene } = useThree();
  const modelRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    const textureUrls: string[] = [];
    if (!buffer) return undefined;
    onError(null);
    onProgress(34);

    const load = async () => {
      try {
        const { model, scene: parsed } = parseSkpWithScene(buffer, { frontSideOnly: true, respectEdgeVisibility: true });
        if (disposed) return;
        onProgress(67);
        const textureLoader = new THREE.TextureLoader();
        const textureCache = new Map<number, THREE.Texture>();
        const getTexture = async (index: number) => {
          const existing = textureCache.get(index);
          if (existing) return existing;
          const textureInfo = parsed.textures?.[index];
          if (!textureInfo?.data) return null;
          const textureBytes = new Uint8Array(textureInfo.data.length);
          textureBytes.set(textureInfo.data);
          const url = URL.createObjectURL(new Blob([textureBytes.buffer], { type: textureInfo.mimeType }));
          textureUrls.push(url);
          try {
            const texture = await textureLoader.loadAsync(url);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = 4;
            textureCache.set(index, texture);
            return texture;
          } catch {
            return null;
          }
        };

        const root = new THREE.Group();
        root.name = "SKP_NATIVE_STYLE_SCENE";
        const materialVariants = new Map<number, ReturnType<typeof makeMaterials>>();
        for (const primitive of parsed.glbPrimitives) {
          if (disposed) return;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
          if (primitive.uvs?.length) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
          geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
          geometry.computeBoundingSphere();
          prepareGeometryForRaycast(geometry);

          let variants = materialVariants.get(primitive.materialIndex);
          if (!variants) {
            const definition = parsed.gltfMaterials?.[primitive.materialIndex] as GltfMaterialDefinition | undefined;
            const textureIndex = definition?.pbrMetallicRoughness?.baseColorTexture?.index;
            variants = makeMaterials(definition, textureIndex === undefined ? null : await getTexture(textureIndex));
            materialVariants.set(primitive.materialIndex, variants);
          }
          const mesh = new THREE.Mesh(geometry, variants.shaded);
          const metadata = parsed.meshIndex[primitive.geomName];
          mesh.name = metadata?.name || primitive.geomName;
          mesh.userData = {
            isSkpMesh: true,
            geomName: primitive.geomName,
            layer: metadata?.layer || "Layer0",
            installId: metadata ? installationId(metadata) : "",
            groupPath: metadata?.path || "ROOT",
            definitionName: metadata?.definitionName || "",
            positionMm: metadata?.positionMm || [0, 0, 0],
            properties: metadata?.properties || {},
            attributeDictionaries: metadata?.attributeDictionaries || {},
            abf: inspectAbfMetadata(metadata),
            displayName: metadata?.name || primitive.geomName,
            materialIndex: primitive.materialIndex,
            variants,
          };
          root.add(mesh);
        }

        const edgeLayers = collectSketchupEdges(model, parsed.sceneHierarchy);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: "#4d5859", transparent: true, opacity: 0.78 });
        const edges = new Map<string, THREE.LineSegments>();
        let edgeCount = 0;
        edgeLayers.forEach((positions, layer) => {
          const edgeGeometry = new THREE.BufferGeometry();
          edgeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          const edgeObject = new THREE.LineSegments(edgeGeometry, edgeMaterial);
          edgeObject.name = `SKP_VISIBLE_EDGES_${layer}`;
          edgeObject.userData = { isSkpEdge: true, layer };
          root.add(edgeObject);
          edges.set(layer, edgeObject);
          edgeCount += positions.length / 6;
        });
        root.userData = { materialVariants, edgeMaterial, edges };

        if (disposed) return;
        scene.add(root);
        modelRef.current = root;
        applyExplode(root, explodeFactor);
        onReady(root);
        onInstallationItems(collectInstallationItems(parsed));
        onGroups(collectSceneGroups(parsed));
        onModelInfo({
          units: model.units,
          bounds: parsed.bounds?.size ?? null,
          dimensions: model.dimensions,
          sectionPlanes: model.root.sectionPlanes,
          constructionLines: model.root.constructionLines,
          constructionPoints: model.root.constructionPoints,
          texts: model.root.texts,
          hiddenLayers: model.layers.filter((layer) => layer.hidden).map((layer) => normalizeLayerName(layer.name)),
          abf: buildAbfInfo(parsed, model),
        });
        onScenes(model.pages.map((page) => ({
          name: page.name,
          eye: page.eye,
          target: page.target,
          up: page.up,
          fov: page.fov,
          parallel: page.parallel,
          orthoHeight: page.orthoHeight,
          hiddenLayers: page.hiddenLayers,
        })));
        onStats({
          definitions: model.definitions.size,
          layers: model.layers?.length ?? 0,
          layerNames: model.layers?.map((layer) => normalizeLayerName(layer.name)) ?? [],
          materials: model.materials?.length ?? 0,
          primitives: parsed.glbPrimitives?.length ?? 0,
          edges: edgeCount,
          scenes: model.pages?.length ?? 0,
          dimensions: model.dimensions.length,
          sectionPlanes: model.root.sectionPlanes.length,
          guides: model.root.constructionLines.length + model.root.constructionPoints.length,
          units: model.units,
          bounds: parsed.bounds?.size,
          version: model.version,
        });
        onProgress(100);
      } catch (error) {
        console.error(error);
        onError("OpenSKP không thể phân tích file này.");
      }
    };
    void load();

    return () => {
      disposed = true;
      if (modelRef.current) {
        scene.remove(modelRef.current);
        modelRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
            (object.geometry as BvhGeometry).disposeBoundsTree?.();
            object.geometry.dispose();
          }
        });
        const variants = modelRef.current.userData.materialVariants as Map<number, ReturnType<typeof makeMaterials>> | undefined;
        variants?.forEach((items) => Object.values(items).forEach((material) => material.dispose()));
        (modelRef.current.userData.edgeMaterial as THREE.Material | undefined)?.dispose();
        modelRef.current = null;
      }
      textureUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [buffer, onError, onGroups, onInstallationItems, onModelInfo, onProgress, onReady, onScenes, onStats, scene]);

  useEffect(() => {
    if (modelRef.current) applyExplode(modelRef.current, explodeFactor);
  }, [explodeFactor]);

  useEffect(() => {
    const root = modelRef.current;
    if (!root) return;
    const normalizedActiveLayer = normalizeLayerName(activeLayer);
    const hiddenLayerSet = new Set(hiddenLayers.map(normalizeLayerName));
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.variants) return;
      const variants = object.userData.variants as ReturnType<typeof makeMaterials>;
      const materialKey = renderStyle === "hidden-line" ? "hiddenLine" : renderStyle;
      object.material = variants[materialKey];
      const clippingPlane = activeSectionPlane ? sectionPlaneToThree(activeSectionPlane) : null;
      (object.material as THREE.Material).clippingPlanes = clippingPlane ? [clippingPlane] : [];
      const meshLayer = normalizeLayerName(object.userData.layer);
      const layerVisible = !hiddenLayerSet.has(meshLayer) && (activeLayer === "All layers" || meshLayer === normalizedActiveLayer);
      const installVisible = !selectedInstallId || object.userData.installId === selectedInstallId;
      const meshGroupPath = String(object.userData.groupPath || "ROOT");
      const groupVisible = !selectedGroupPath || meshGroupPath === selectedGroupPath || meshGroupPath.startsWith(`${selectedGroupPath} / `);
      object.visible = layerVisible && installVisible && groupVisible && abfIsVisible(object.userData.abf as AbfEntityInfo | null, abfVisibility);
    });
    const edges = root.userData.edges as Map<string, THREE.LineSegments> | undefined;
    if (edges) {
      edges.forEach((edgeObject, layer) => {
        const edgeLayer = normalizeLayerName(layer);
        const layerVisible = !hiddenLayerSet.has(edgeLayer) && (activeLayer === "All layers" || edgeLayer === normalizedActiveLayer);
        edgeObject.visible = showEdges && renderStyle !== "wireframe" && layerVisible && !selectedInstallId && !selectedGroupPath;
      });
      const edgeMaterial = root.userData.edgeMaterial as THREE.LineBasicMaterial | undefined;
      const clippingPlane = activeSectionPlane ? sectionPlaneToThree(activeSectionPlane) : null;
      if (edgeMaterial) {
        edgeMaterial.clippingPlanes = clippingPlane ? [clippingPlane] : [];
        edgeMaterial.opacity = renderStyle === "hidden-line" ? 0.95 : renderStyle === "xray" ? 0.62 : 0.78;
      }
    }
  }, [abfVisibility, activeLayer, activeSectionPlane, hiddenLayers, renderStyle, selectedGroupPath, selectedInstallId, showEdges]);

  return null;
}

function InstancedModelLoader({ buffer, renderStyle, showEdges, activeLayer, hiddenLayers, selectedInstallId, selectedGroupPath, activeSectionPlane, abfVisibility, explodeFactor, onStats, onInstallationItems, onGroups, onScenes, onModelInfo, onProgress, onError, onReady }: Omit<Props, "showGrid" | "showAxes" | "showDimensions" | "showGuides" | "projection" | "fov" | "activeScene" | "measureMode" | "measurementPoints" | "viewPreset" | "selectedEntity" | "onEntitySelect" | "onMeasurePoint" | "onModelInfo"> & { activeSectionPlane: SectionPlane | null; onModelInfo: (info: ModelInfo) => void; onReady: (root: THREE.Object3D) => void }) {
  const { scene } = useThree();
  const modelRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    const textureUrls: string[] = [];
    if (!buffer) return undefined;
    onError(null);
    onProgress(34);

    const load = async () => {
      try {
        const { model, scene: parsed } = parseSkpWithInstancedScene(buffer, { frontSideOnly: true, respectEdgeVisibility: true });
        if (disposed) return;
        onProgress(67);
        const textureLoader = new THREE.TextureLoader();
        const textureCache = new Map<number, THREE.Texture>();
        const getTexture = async (index: number) => {
          const existing = textureCache.get(index);
          if (existing) return existing;
          const textureInfo = parsed.textures?.[index];
          if (!textureInfo?.data) return null;
          const textureBytes = new Uint8Array(textureInfo.data.length);
          textureBytes.set(textureInfo.data);
          const url = URL.createObjectURL(new Blob([textureBytes.buffer], { type: textureInfo.mimeType }));
          textureUrls.push(url);
          try {
            const texture = await textureLoader.loadAsync(url);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = 4;
            textureCache.set(index, texture);
            return texture;
          } catch {
            return null;
          }
        };

        const root = new THREE.Group();
        root.name = "SKP_NATIVE_INSTANCED_SCENE";
        const materialVariants = new Map<number, ReturnType<typeof makeMaterials>>();
        const resourceGeometries = new Map<string, THREE.BufferGeometry[]>();
        const resources = new Map(parsed.meshResources.map((resource) => [resource.id, resource]));
        const getMaterialVariants = async (materialIndex: number) => {
          const existing = materialVariants.get(materialIndex);
          if (existing) return existing;
          const definition = parsed.gltfMaterials?.[materialIndex] as GltfMaterialDefinition | undefined;
          const textureIndex = definition?.pbrMetallicRoughness?.baseColorTexture?.index;
          const variants = makeMaterials(definition, textureIndex === undefined ? null : await getTexture(textureIndex));
          materialVariants.set(materialIndex, variants);
          return variants;
        };
        const getResourceGeometries = (resource: InstancedMeshResource) => {
          const existing = resourceGeometries.get(resource.id);
          if (existing) return existing;
          const geometries = resource.primitives.map((primitive) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(primitive.positions, 3));
            geometry.setAttribute("normal", new THREE.BufferAttribute(primitive.normals, 3));
            if (primitive.uvs?.length) geometry.setAttribute("uv", new THREE.BufferAttribute(primitive.uvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
            geometry.computeBoundingSphere();
            prepareGeometryForRaycast(geometry);
            return geometry;
          });
          resourceGeometries.set(resource.id, geometries);
          return geometries;
        };
        const addNode = async (node: InstancedNode, parent: THREE.Object3D, parentPath: string) => {
          const path = node.name === "ROOT" ? "ROOT" : parentPath === "ROOT" ? instancedNodeLabel(node) : `${parentPath} / ${instancedNodeLabel(node)}`;
          const nodeGroup = node.name === "ROOT" ? parent : new THREE.Group();
          if (nodeGroup !== parent) {
            nodeGroup.name = path;
            nodeGroup.matrixAutoUpdate = false;
            nodeGroup.matrix.fromArray(node.matrix);
            parent.add(nodeGroup);
          }
          if (node.meshResourceId) {
            const resource = resources.get(node.meshResourceId);
            if (resource) {
              const geometries = getResourceGeometries(resource);
              for (let index = 0; index < resource.primitives.length; index += 1) {
                const primitive = resource.primitives[index];
                const mesh = new THREE.Mesh(geometries[index], (await getMaterialVariants(primitive.materialIndex)).shaded);
                mesh.name = node.name || resource.definitionName || resource.id;
                mesh.userData = {
                  isSkpMesh: true,
                  geomName: `${resource.id}:${index}`,
                  layer: node.layer || "Layer0",
                  installId: installationId({ name: node.name || resource.definitionName, definitionName: node.definitionName || resource.definitionName, layer: node.layer }),
                  groupPath: path,
                  definitionName: node.definitionName || resource.definitionName,
                  positionMm: node.positionMm,
                  properties: node.properties || {},
                  attributeDictionaries: node.attributeDictionaries || {},
                  abf: inspectAbfMetadata({ name: node.name, layer: node.layer, path, properties: node.properties, attributeDictionaries: node.attributeDictionaries }),
                  displayName: node.name || resource.definitionName || resource.id,
                  materialIndex: primitive.materialIndex,
                  variants: await getMaterialVariants(primitive.materialIndex),
                };
                nodeGroup.add(mesh);
              }
            }
          }
          for (const child of node.children) await addNode(child, nodeGroup, path);
        };
        await addNode(parsed.sceneHierarchy, root, "ROOT");

        const edgeLayers = collectSketchupEdges(model, parsed.sceneHierarchy);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: "#4d5859", transparent: true, opacity: 0.78 });
        const edges = new Map<string, THREE.LineSegments>();
        let edgeCount = 0;
        edgeLayers.forEach((positions, layer) => {
          const edgeGeometry = new THREE.BufferGeometry();
          edgeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          const edgeObject = new THREE.LineSegments(edgeGeometry, edgeMaterial);
          edgeObject.name = `SKP_VISIBLE_EDGES_${layer}`;
          edgeObject.userData = { isSkpEdge: true, layer };
          root.add(edgeObject);
          edges.set(layer, edgeObject);
          edgeCount += positions.length / 6;
        });
        root.userData = { materialVariants, edgeMaterial, edges, resourceGeometries };

        if (disposed) return;
        scene.add(root);
        modelRef.current = root;
        applyExplode(root, explodeFactor);
        onReady(root);
        onInstallationItems(collectInstancedInstallationItems(parsed));
        onGroups(collectInstancedGroups(parsed));
        onModelInfo({
          units: model.units,
          bounds: parsed.bounds?.size ?? null,
          dimensions: model.dimensions,
          sectionPlanes: model.root.sectionPlanes,
          constructionLines: model.root.constructionLines,
          constructionPoints: model.root.constructionPoints,
          texts: model.root.texts,
          hiddenLayers: model.layers.filter((layer) => layer.hidden).map((layer) => normalizeLayerName(layer.name)),
          abf: buildAbfInfoFromInstanced(parsed, model),
        });
        onScenes(model.pages.map((page) => ({
          name: page.name,
          eye: page.eye,
          target: page.target,
          up: page.up,
          fov: page.fov,
          parallel: page.parallel,
          orthoHeight: page.orthoHeight,
          hiddenLayers: page.hiddenLayers,
        })));
        onStats({
          definitions: model.definitions.size,
          layers: model.layers?.length ?? 0,
          layerNames: model.layers?.map((layer) => normalizeLayerName(layer.name)) ?? [],
          materials: model.materials?.length ?? 0,
          primitives: parsed.meshResources.reduce((total, resource) => total + resource.primitives.length, 0),
          edges: edgeCount,
          scenes: model.pages?.length ?? 0,
          dimensions: model.dimensions.length,
          sectionPlanes: model.root.sectionPlanes.length,
          guides: model.root.constructionLines.length + model.root.constructionPoints.length,
          units: model.units,
          bounds: parsed.bounds?.size,
        });
        onProgress(100);
      } catch (error) {
        console.error(error);
        onError("OpenSKP không thể phân tích file này.");
      }
    };
    void load();

    return () => {
      disposed = true;
      if (modelRef.current) {
        scene.remove(modelRef.current);
        const geometries = modelRef.current.userData.resourceGeometries as Map<string, THREE.BufferGeometry[]> | undefined;
        geometries?.forEach((items) => items.forEach((geometry) => geometry.dispose()));
        const variants = modelRef.current.userData.materialVariants as Map<number, ReturnType<typeof makeMaterials>> | undefined;
        variants?.forEach((items) => Object.values(items).forEach((material) => material.dispose()));
        (modelRef.current.userData.edgeMaterial as THREE.Material | undefined)?.dispose();
        modelRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
            (object.geometry as BvhGeometry).disposeBoundsTree?.();
            object.geometry.dispose();
          }
        });
        modelRef.current = null;
      }
      textureUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [buffer, onError, onGroups, onInstallationItems, onModelInfo, onProgress, onReady, onScenes, onStats, scene]);

  useEffect(() => {
    if (modelRef.current) applyExplode(modelRef.current, explodeFactor);
  }, [explodeFactor]);

  useEffect(() => {
    const root = modelRef.current;
    if (!root) return;
    const normalizedActiveLayer = normalizeLayerName(activeLayer);
    const hiddenLayerSet = new Set(hiddenLayers.map(normalizeLayerName));
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.variants) return;
      const variants = object.userData.variants as ReturnType<typeof makeMaterials>;
      const materialKey = renderStyle === "hidden-line" ? "hiddenLine" : renderStyle;
      object.material = variants[materialKey];
      const clippingPlane = activeSectionPlane ? sectionPlaneToThree(activeSectionPlane) : null;
      (object.material as THREE.Material).clippingPlanes = clippingPlane ? [clippingPlane] : [];
      const meshLayer = normalizeLayerName(object.userData.layer);
      const layerVisible = !hiddenLayerSet.has(meshLayer) && (activeLayer === "All layers" || meshLayer === normalizedActiveLayer);
      const installVisible = !selectedInstallId || object.userData.installId === selectedInstallId;
      const meshGroupPath = String(object.userData.groupPath || "ROOT");
      const groupVisible = !selectedGroupPath || meshGroupPath === selectedGroupPath || meshGroupPath.startsWith(`${selectedGroupPath} / `);
      object.visible = layerVisible && installVisible && groupVisible && abfIsVisible(object.userData.abf as AbfEntityInfo | null, abfVisibility);
    });
    const edges = root.userData.edges as Map<string, THREE.LineSegments> | undefined;
    if (edges) {
      edges.forEach((edgeObject, layer) => {
        const edgeLayer = normalizeLayerName(layer);
        const layerVisible = !hiddenLayerSet.has(edgeLayer) && (activeLayer === "All layers" || edgeLayer === normalizedActiveLayer);
        edgeObject.visible = showEdges && renderStyle !== "wireframe" && layerVisible && !selectedInstallId && !selectedGroupPath;
      });
      const edgeMaterial = root.userData.edgeMaterial as THREE.LineBasicMaterial | undefined;
      const clippingPlane = activeSectionPlane ? sectionPlaneToThree(activeSectionPlane) : null;
      if (edgeMaterial) {
        edgeMaterial.clippingPlanes = clippingPlane ? [clippingPlane] : [];
        edgeMaterial.opacity = renderStyle === "hidden-line" ? 0.95 : renderStyle === "xray" ? 0.62 : 0.78;
      }
    }
  }, [abfVisibility, activeLayer, activeSectionPlane, hiddenLayers, renderStyle, selectedGroupPath, selectedInstallId, showEdges]);

  return null;
}

type SnapKind = "CORNER" | "EDGE" | "FACE";

type SnapVertex = {
  point: THREE.Vector3;
  sources: THREE.Object3D[];
};

type SnapEdge = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  source: THREE.Object3D;
};

type SnapIndex = {
  vertices: SnapVertex[];
  edges: SnapEdge[];
};

type SnapCandidate = {
  kind: SnapKind;
  point: THREE.Vector3;
  distancePx: number;
  source: THREE.Object3D;
};

const SNAP_VERTEX_RADIUS_PX = 16;
const SNAP_EDGE_RADIUS_PX = 20;

function buildSnapIndex(model: THREE.Object3D | null): SnapIndex {
  if (!model) return { vertices: [], edges: [] };
  model.updateMatrixWorld(true);
  const vertices: SnapVertex[] = [];
  const edges: SnapEdge[] = [];
  const verticesByKey = new Map<string, SnapVertex>();
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();

  const keyForPoint = (point: THREE.Vector3) => `${Math.round(point.x * 100000)},${Math.round(point.y * 100000)},${Math.round(point.z * 100000)}`;
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.isSkpMesh) {
      const position = object.geometry.getAttribute("position");
      if (!position) return;
      for (let index = 0; index < position.count; index += 1) {
        localPoint.fromBufferAttribute(position, index);
        worldPoint.copy(localPoint).applyMatrix4(object.matrixWorld);
        if (!Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y) || !Number.isFinite(worldPoint.z)) continue;
        const key = keyForPoint(worldPoint);
        const existing = verticesByKey.get(key);
        if (existing) existing.sources.push(object);
        else {
          const vertex = { point: worldPoint.clone(), sources: [object] };
          verticesByKey.set(key, vertex);
          vertices.push(vertex);
        }
      }
    }
    if (object instanceof THREE.LineSegments && object.userData.isSkpEdge) {
      const position = object.geometry.getAttribute("position");
      if (!position) return;
      for (let index = 0; index + 1 < position.count; index += 2) {
        const start = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        const end = new THREE.Vector3().fromBufferAttribute(position, index + 1).applyMatrix4(object.matrixWorld);
        if (start.distanceToSquared(end) > 1e-12) edges.push({ start, end, source: object });
      }
    }
  });
  return { vertices, edges };
}

function isSceneObjectVisible(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function projectToViewport(point: THREE.Vector3, camera: THREE.Camera, rect: DOMRect) {
  const projected = point.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projected.y) / 2) * rect.height,
    depth: projected.z,
  };
}

function chooseSnapCandidate(index: SnapIndex, hit: THREE.Intersection, event: PointerEvent, camera: THREE.Camera, rect: DOMRect): SnapCandidate {
  const pointerDepth = hit.point.clone().project(camera).z;
  let closestVertex: SnapCandidate | null = null;
  let closestVertexScore = Infinity;
  for (const vertex of index.vertices) {
    const source = vertex.sources.find(isSceneObjectVisible);
    if (!source) continue;
    const screen = projectToViewport(vertex.point, camera, rect);
    if (!screen) continue;
    const distancePx = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
    if (distancePx > SNAP_VERTEX_RADIUS_PX) continue;
    const score = distancePx + Math.max(0, screen.depth - pointerDepth) * 18;
    if (score < closestVertexScore) {
      closestVertexScore = score;
      closestVertex = { kind: "CORNER", point: vertex.point.clone(), distancePx, source };
    }
  }
  if (closestVertex) return closestVertex;

  let closestEdge: SnapCandidate | null = null;
  let closestEdgeScore = Infinity;
  for (const edge of index.edges) {
    if (!isSceneObjectVisible(edge.source)) continue;
    const start = projectToViewport(edge.start, camera, rect);
    const end = projectToViewport(edge.end, camera, rect);
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((event.clientX - start.x) * dx + (event.clientY - start.y) * dy) / lengthSquared));
    const screenX = start.x + dx * t;
    const screenY = start.y + dy * t;
    const distancePx = Math.hypot(screenX - event.clientX, screenY - event.clientY);
    if (distancePx > SNAP_EDGE_RADIUS_PX) continue;
    const point = edge.start.clone().lerp(edge.end, t);
    const projected = projectToViewport(point, camera, rect);
    if (!projected) continue;
    const score = distancePx + Math.max(0, projected.depth - pointerDepth) * 18;
    if (score < closestEdgeScore) {
      closestEdgeScore = score;
      closestEdge = { kind: "EDGE", point, distancePx, source: edge.source };
    }
  }
  if (closestEdge) return closestEdge;
  return { kind: "FACE", point: hit.point.clone(), distancePx: 0, source: hit.object };
}

function formatSnapPoint(point: THREE.Vector3) {
  return `${Math.round(point.x * 1000)} × ${Math.round(point.y * 1000)} × ${Math.round(point.z * 1000)} mm`;
}

function MeasureSnapPreview({ candidate }: { candidate: SnapCandidate | null }) {
  if (!candidate) return null;
  return <>
    <mesh position={candidate.point} renderOrder={1000}>
      <sphereGeometry args={[0.045, 16, 16]} />
      <meshBasicMaterial color={candidate.kind === "CORNER" ? "#e06d37" : "#4d8fa3"} depthTest={false} depthWrite={false} />
    </mesh>
    <Html position={candidate.point} center style={{ pointerEvents: "none" }}>
      <div className={`measure-snap-preview measure-snap-${candidate.kind.toLowerCase()}`}>
        <span className="measure-snap-lens"><i /></span>
        <span className="measure-snap-copy"><strong>{candidate.kind}</strong><small>{formatSnapPoint(candidate.point)}</small></span>
      </div>
    </Html>
  </>;
}

function entityFromObject(object: THREE.Mesh): PickedEntity {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const data = object.userData;
  return {
    objectId: object.uuid,
    name: String(data.displayName || object.name || "Object"),
    definitionName: String(data.definitionName || ""),
    layer: String(data.layer || "Layer0"),
    groupPath: String(data.groupPath || "ROOT"),
    installId: String(data.installId || ""),
    sizeMm: [Math.round(size.x * 1000), Math.round(size.y * 1000), Math.round(size.z * 1000)],
    positionMm: (data.positionMm || [0, 0, 0]) as Point,
    properties: (data.properties || {}) as Record<string, string>,
    attributeDictionaries: (data.attributeDictionaries || {}) as Record<string, Record<string, string>>,
    abf: (data.abf || null) as AbfEntityInfo | null,
  };
}

function ModelPicker({ model, measureMode, explodeFactor, onEntitySelect, onMeasurePoint }: { model: THREE.Object3D | null; measureMode: boolean; explodeFactor: number; onEntitySelect: (entity: PickedEntity | null, isolate?: boolean) => void; onMeasurePoint: (point: Point) => void }) {
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const pendingSelection = useRef<number | null>(null);
  const lastSelection = useRef<{ time: number; x: number; y: number; objectId: string; entity: PickedEntity } | null>(null);
  const [preview, setPreview] = useState<SnapCandidate | null>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex>(() => buildSnapIndex(model));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSnapIndex(buildSnapIndex(model)));
    return () => window.cancelAnimationFrame(frame);
  }, [explodeFactor, model]);

  useEffect(() => {
    raycaster.current.firstHitOnly = true;
  }, []);

  useEffect(() => {
    const element = gl.domElement;
    let animationFrame = 0;
    let pendingMove: PointerEvent | null = null;
    const getHit = (event: PointerEvent) => {
      if (!model) return null;
      const rect = element.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer, camera);
      return raycaster.current.intersectObjects(model.children, true).find((hit) => hit.object instanceof THREE.Mesh && isSceneObjectVisible(hit.object));
    };
    const updatePreview = () => {
      animationFrame = 0;
      if (!measureMode || !model || !pendingMove) {
        setPreview(null);
        return;
      }
      const event = pendingMove;
      pendingMove = null;
      const hit = getHit(event);
      setPreview(hit ? chooseSnapCandidate(snapIndex, hit, event, camera, element.getBoundingClientRect()) : null);
    };
    const handleMove = (event: PointerEvent) => {
      if (!measureMode) return;
      pendingMove = event;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updatePreview);
    };
    const handleLeave = () => setPreview(null);
    const handleDown = (event: PointerEvent) => {
      if (event.button === 0) pointerDown.current = { x: event.clientX, y: event.clientY };
    };
    const handleUp = (event: PointerEvent) => {
      const start = pointerDown.current;
      pointerDown.current = null;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const hit = getHit(event);
      if (!hit || !(hit.object instanceof THREE.Mesh)) {
        if (!measureMode) onEntitySelect(null);
        return;
      }
      if (measureMode) {
        const candidate = chooseSnapCandidate(snapIndex, hit, event, camera, element.getBoundingClientRect());
        setPreview(candidate);
        onMeasurePoint([candidate.point.x, candidate.point.y, candidate.point.z]);
        return;
      }
      const entity = entityFromObject(hit.object);
      const now = performance.now();
      const previous = lastSelection.current;
      const isDoubleClick = Boolean(previous && previous.objectId === entity.objectId && now - previous.time < 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 10);
      if (isDoubleClick) {
        if (pendingSelection.current !== null) window.clearTimeout(pendingSelection.current);
        pendingSelection.current = null;
        lastSelection.current = null;
        onEntitySelect(entity, true);
      } else {
        lastSelection.current = { time: now, x: event.clientX, y: event.clientY, objectId: entity.objectId, entity };
        if (pendingSelection.current !== null) window.clearTimeout(pendingSelection.current);
        pendingSelection.current = window.setTimeout(() => {
          pendingSelection.current = null;
          lastSelection.current = null;
          onEntitySelect(entity, false);
        }, 260);
      }
    };
    element.addEventListener("pointermove", handleMove);
    element.addEventListener("pointerleave", handleLeave);
    element.addEventListener("pointerdown", handleDown);
    element.addEventListener("pointerup", handleUp);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (pendingSelection.current !== null) window.clearTimeout(pendingSelection.current);
      element.removeEventListener("pointermove", handleMove);
      element.removeEventListener("pointerleave", handleLeave);
      element.removeEventListener("pointerdown", handleDown);
      element.removeEventListener("pointerup", handleUp);
    };
  }, [camera, gl, measureMode, model, onEntitySelect, onMeasurePoint, snapIndex]);

  return <MeasureSnapPreview candidate={preview} />;
}

function SelectedObjectOutline({ model, selectedEntity, explodeFactor }: { model: THREE.Object3D | null; selectedEntity: PickedEntity | null; explodeFactor: number }) {
  const selectedObject = useMemo<THREE.Mesh | null>(() => {
    if (!model || !selectedEntity?.objectId) return null;
    model.updateMatrixWorld(true);
    let result: THREE.Mesh | null = null;
    model.traverse((object) => {
      if (!result && object instanceof THREE.Mesh && object.uuid === selectedEntity.objectId) result = object;
    });
    return result;
  }, [explodeFactor, model, selectedEntity?.objectId]);
  const outline = useMemo(() => {
    if (!selectedObject) return null;
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(selectedObject.geometry, 20),
      new THREE.LineBasicMaterial({ color: "#e2763b", depthTest: false, depthWrite: false }),
    );
    line.name = "SKP_SELECTED_OBJECT_OUTLINE";
    line.renderOrder = 1001;
    line.matrixAutoUpdate = false;
    line.matrix.copy(selectedObject.matrixWorld);
    line.matrixWorld.copy(selectedObject.matrixWorld);
    return line;
  }, [selectedObject]);
  useEffect(() => () => {
    if (!outline) return;
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
  }, [outline]);
  return outline ? <primitive object={outline} /> : null;
}

function MeasurementOverlay({ points }: { points: Point[] }) {
  return <>
    {points.map((point, index) => (
      <group key={`${point.join("-")}-${index}`} position={point}>
        <mesh renderOrder={1000}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshBasicMaterial color="#d47b48" depthTest={false} depthWrite={false} />
        </mesh>
        <Html center style={{ pointerEvents: "none" }}><span className="measure-point-label">{index === 0 ? "A" : "B"}</span></Html>
      </group>
    ))}
    {points.length === 2 && <Line points={points} color="#d47b48" lineWidth={3} dashed={false} />}
  </>;
}

function AbfLabelsOverlay({ model, visible, showNesting }: { model: THREE.Object3D | null; visible: boolean; showNesting: boolean }) {
  const labels = useMemo(() => {
    if (!model || !visible) return [] as { id: string; text: string; position: THREE.Vector3 }[];
    const result: { id: string; text: string; position: THREE.Vector3 }[] = [];
    const seen = new Set<string>();
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.isSkpMesh) return;
      const abf = object.userData.abf as AbfEntityInfo | null;
      if (!abf?.boardIndex || seen.has(abf.boardIndex) || (abf.inNesting && !showNesting)) return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      seen.add(abf.boardIndex);
      result.push({
        id: abf.boardIndex,
        text: `#${abf.boardIndex} · ${object.userData.displayName || "Board"}`,
        position: box.getCenter(new THREE.Vector3()),
      });
    });
    return result;
  }, [model, showNesting, visible]);

  return <>{labels.map((label) => <Html key={label.id} position={label.position} center distanceFactor={8} style={{ pointerEvents: "none" }}><span className="abf-board-label">{label.text}</span></Html>)}</>;
}

function formatMeasure(metres: number) {
  if (metres >= 1) return `${metres.toFixed(2)} m`;
  return `${Math.round(metres * 1000)} mm`;
}

function ModelAnnotations({ info, showDimensions, showGuides, activeSectionPlane }: { info: ModelInfo | null; showDimensions: boolean; showGuides: boolean; activeSectionPlane: SectionPlane | null }) {
  if (!info) return null;
  const section = activeSectionPlane ? sectionPlaneToThree(activeSectionPlane) : null;
  const sectionSize = info.bounds ? Math.max(...info.bounds) * 1.35 : 4;
  const sectionCenter = section ? section.normal.clone().multiplyScalar(-section.constant) : null;
  const sectionQuaternion = section && sectionCenter ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), section.normal) : null;
  return <>
    {showDimensions && info.dimensions.filter((dimension) => !dimension.hidden && dimension.a && dimension.b).map((dimension, index) => {
      const a = toScenePoint(dimension.a!);
      const b = toScenePoint(dimension.b!);
      const distance = a.distanceTo(b);
      return <group key={`dimension-${index}`}>
        <Line points={[a, b]} color="#d47b48" lineWidth={2} dashed={false} />
        <mesh position={a}><sphereGeometry args={[0.018, 10, 10]} /><meshBasicMaterial color="#d47b48" /></mesh>
        <mesh position={b}><sphereGeometry args={[0.018, 10, 10]} /><meshBasicMaterial color="#d47b48" /></mesh>
        <Html position={a.clone().lerp(b, 0.5)} center distanceFactor={8} style={{ pointerEvents: "none" }}>
          <span className="model-dimension-label">{dimension.text || formatMeasure(distance)}</span>
        </Html>
      </group>;
    })}
    {showGuides && info.constructionLines.map((line, index) => {
      const center = toScenePoint(line.point);
      const direction = new THREE.Vector3(line.direction[0], line.direction[2], -line.direction[1]).normalize();
      const start = line.start ? toScenePoint(line.start) : center.clone().addScaledVector(direction, -5);
      const end = line.end ? toScenePoint(line.end) : center.clone().addScaledVector(direction, 5);
      return <Line key={`guide-line-${index}`} points={[start, end]} color="#7294a4" lineWidth={1} dashed dashSize={0.08} gapSize={0.05} />;
    })}
    {showGuides && info.constructionPoints.map((point, index) => (
      <mesh key={`guide-point-${index}`} position={toScenePoint(point.position)}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshBasicMaterial color="#7294a4" />
      </mesh>
    ))}
    {section && sectionCenter && sectionQuaternion && <mesh position={sectionCenter} quaternion={sectionQuaternion}>
      <planeGeometry args={[sectionSize, sectionSize]} />
      <meshBasicMaterial color="#d47b48" transparent opacity={0.13} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>}
  </>;
}

function toScenePoint(point: [number, number, number]) {
  return new THREE.Vector3(...toThreePoint(point));
}

function toSceneDirection(point: [number, number, number]) {
  return new THREE.Vector3(point[0], point[2], -point[1]).normalize();
}

function sceneModelBounds(model: THREE.Object3D, activeLayer: string, hiddenLayers: string[], selectedInstallId: string | null, selectedGroupPath: string | null) {
  const bounds = new THREE.Box3();
  const hiddenLayerSet = new Set(hiddenLayers.map(normalizeLayerName));
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const layer = normalizeLayerName(object.userData.layer);
    if (hiddenLayerSet.has(layer) || (activeLayer !== "All layers" && layer !== normalizeLayerName(activeLayer))) return;
    if (selectedInstallId && object.userData.installId !== selectedInstallId) return;
    const groupPath = String(object.userData.groupPath || "ROOT");
    if (selectedGroupPath && groupPath !== selectedGroupPath && !groupPath.startsWith(`${selectedGroupPath} / `)) return;
    bounds.expandByObject(object);
  });
  return bounds;
}

function sceneCameraFrame(model: THREE.Object3D, scene: ScenePage, activeLayer: string, hiddenLayers: string[], selectedInstallId: string | null, selectedGroupPath: string | null) {
  const eye = scene.eye ? toScenePoint(scene.eye) : new THREE.Vector3();
  const savedTarget = scene.target ? toScenePoint(scene.target) : eye.clone().add(new THREE.Vector3(0, 0, -1));
  const bounds = sceneModelBounds(model, activeLayer, hiddenLayers, selectedInstallId, selectedGroupPath);
  if (bounds.isEmpty()) return { position: eye, target: savedTarget };
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 1);
  const direction = savedTarget.clone().sub(eye);
  if (direction.lengthSq() < 1e-8) direction.copy(center).sub(eye);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
  direction.normalize();
  const projectedDistance = center.clone().sub(eye).dot(direction);
  const projectedTarget = eye.clone().addScaledVector(direction, Math.max(projectedDistance, maxSize * 0.05));
  const target = projectedTarget.clone().clamp(bounds.min, bounds.max);
  return { position: eye, target };
}

function FitCamera({ model, preset, projection, fov, activeLayer, hiddenLayers, activeScene, selectedInstallId, selectedGroupPath }: { model: THREE.Object3D | null; preset: "iso" | "front" | "top"; projection: Projection; fov: number; activeLayer: string; hiddenLayers: string[]; activeScene: ScenePage | null; selectedInstallId: string | null; selectedGroupPath: string | null }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);

  const frameModel = useCallback((nextPreset: "iso" | "front" | "top" = preset) => {
    if (!model) return;
    if (activeScene?.eye && activeScene.target) {
      const frame = sceneCameraFrame(model, activeScene, activeLayer, hiddenLayers, selectedInstallId, selectedGroupPath);
      camera.position.copy(frame.position);
      controls.current?.target.copy(frame.target);
      if (activeScene.up) camera.up.copy(toSceneDirection(activeScene.up));
      if (camera instanceof THREE.PerspectiveCamera) camera.fov = activeScene.fov || fov;
      if (camera instanceof THREE.OrthographicCamera) camera.zoom = activeScene.orthoHeight > 0 ? 1 / (activeScene.orthoHeight * INCH_TO_METRE) : 1;
      camera.updateProjectionMatrix();
      controls.current?.update();
      return;
    }
    const box = new THREE.Box3();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      if (selectedInstallId && object.userData.installId !== selectedInstallId) return;
      box.expandByObject(object);
    });
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 1);
    const distance = maxSize * 1.75;
    if (nextPreset === "top") camera.position.set(center.x, center.y + distance, center.z + 0.01);
    else if (nextPreset === "front") camera.position.set(center.x, center.y + distance * 0.12, center.z + distance);
    else camera.position.set(center.x + distance, center.y + distance * 0.72, center.z + distance);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(1.55 / maxSize, 1.8);
      camera.near = 0.001;
      camera.far = Math.max(distance * 100, 1000);
    } else {
      camera.fov = fov;
      camera.near = Math.max(distance / 1000, 0.001);
      camera.far = Math.max(distance * 100, 1000);
    }
    camera.updateProjectionMatrix();
    controls.current?.target.copy(center);
    controls.current?.update();
  }, [activeLayer, activeScene, camera, fov, hiddenLayers, model, preset, selectedGroupPath, selectedInstallId]);

  useEffect(() => frameModel(), [frameModel, projection]);

  useEffect(() => {
    const fit = () => frameModel();
    const zoomIn = () => {
      if (!model || !controls.current) return;
      const target = controls.current.target as THREE.Vector3;
      const nextPosition = camera.position.clone().sub(target).multiplyScalar(0.82).add(target);
      camera.position.copy(nextPosition);
      controls.current.update();
    };
    window.addEventListener("skp-fit-model", fit);
    window.addEventListener("skp-zoom-in", zoomIn);
    return () => {
      window.removeEventListener("skp-fit-model", fit);
      window.removeEventListener("skp-zoom-in", zoomIn);
    };
  }, [camera, frameModel, model]);

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.06} minDistance={0.03} maxDistance={10000} screenSpacePanning />;
}

export default function SketchupCanvas({ buffer, showGrid, showEdges, showAxes, showDimensions, showGuides, renderStyle, projection, fov, activeLayer, hiddenLayers, selectedInstallId, selectedGroupPath, selectedEntity, activeScene, activeSectionPlane, abfVisibility, explodeFactor, measureMode, measurementPoints, viewPreset, onStats, onInstallationItems, onGroups, onScenes, onModelInfo, onEntitySelect, onMeasurePoint, onProgress, onError }: Props) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const useInstancedScene = Boolean(buffer && buffer.byteLength >= 8 * 1024 * 1024);
  const onReady = useCallback((root: THREE.Object3D) => setModel(root), []);
  const handleModelInfo = useCallback((info: ModelInfo) => {
    setModelInfo(info);
    onModelInfo(info);
  }, [onModelInfo]);
  useEffect(() => {
    if (!buffer) setModelInfo(null);
  }, [buffer]);

  return (
    <Canvas className="three-canvas" dpr={[1, 2]} camera={{ position: [5, 4, 5], fov: 38 }} gl={{ antialias: true, alpha: false, localClippingEnabled: true }} onCreated={({ gl }) => {
      gl.toneMapping = THREE.NoToneMapping;
      gl.outputColorSpace = THREE.SRGBColorSpace;
    }}>
      {projection === "orthographic" ? <OrthographicCamera makeDefault position={[5, 4, 5]} zoom={1} /> : <PerspectiveCamera makeDefault position={[5, 4, 5]} fov={fov} />}
      <color attach="background" args={["#e4e8e6"]} />
      <hemisphereLight args={["#ffffff", "#88918e", 0.66]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[5, 9, 6]} intensity={0.42} color="#fffdf6" />
      {showGrid && <gridHelper args={[100, 100, "#aeb9b5", "#cbd2cf"]} position={[0, -0.015, 0]} />}
      {showAxes && <axesHelper args={[2.6]} />}
      {useInstancedScene ? <InstancedModelLoader buffer={buffer} renderStyle={renderStyle} showEdges={showEdges} activeLayer={activeLayer} hiddenLayers={hiddenLayers} selectedInstallId={selectedInstallId} selectedGroupPath={selectedGroupPath} activeSectionPlane={activeSectionPlane} abfVisibility={abfVisibility} explodeFactor={explodeFactor} onStats={onStats} onInstallationItems={onInstallationItems} onGroups={onGroups} onScenes={onScenes} onModelInfo={handleModelInfo} onProgress={onProgress} onError={onError} onReady={onReady} /> : <ModelLoader buffer={buffer} renderStyle={renderStyle} showEdges={showEdges} activeLayer={activeLayer} hiddenLayers={hiddenLayers} selectedInstallId={selectedInstallId} selectedGroupPath={selectedGroupPath} activeSectionPlane={activeSectionPlane} abfVisibility={abfVisibility} explodeFactor={explodeFactor} onStats={onStats} onInstallationItems={onInstallationItems} onGroups={onGroups} onScenes={onScenes} onModelInfo={handleModelInfo} onProgress={onProgress} onError={onError} onReady={onReady} />}
      <ModelPicker model={model} measureMode={measureMode} explodeFactor={explodeFactor} onEntitySelect={onEntitySelect} onMeasurePoint={onMeasurePoint} />
      <SelectedObjectOutline model={model} selectedEntity={selectedEntity} explodeFactor={explodeFactor} />
      <MeasurementOverlay points={measurementPoints} />
      <AbfLabelsOverlay model={model} visible={abfVisibility.labels} showNesting={abfVisibility.nesting} />
      <ModelAnnotations info={modelInfo} showDimensions={showDimensions} showGuides={showGuides} activeSectionPlane={activeSectionPlane} />
      <FitCamera model={model} preset={viewPreset} projection={projection} fov={fov} activeLayer={activeLayer} hiddenLayers={hiddenLayers} activeScene={activeScene} selectedInstallId={selectedInstallId} selectedGroupPath={selectedGroupPath} />
    </Canvas>
  );
}
