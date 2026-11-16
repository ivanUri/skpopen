"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Camera,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Grid3X3,
  Hand,
  Layers3,
  Maximize,
  MousePointer2,
  PanelLeft,
  Rotate3D,
  Ruler,
  Scan,
  Settings2,
  Sun,
  Upload,
  ZoomIn,
} from "lucide-react";
import SketchupCanvas, { AbfVisibility, InstallationItem, ModelInfo, normalizeLayerName, PickedEntity, Projection, RenderStyle, SceneGroup, ScenePage } from "../components/SketchupCanvas";

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

const initialStats: ModelStats = { definitions: 0, layers: 0, materials: 0, primitives: 0, edges: 0, scenes: 0, dimensions: 0, sectionPlanes: 0, guides: 0 };

const initialAbfVisibility: AbfVisibility = {
  nesting: false,
  labels: false,
  cuttingLines: false,
  edgeBanding: false,
  fittings: false,
  intersections: false,
};

const renderStyles: { value: RenderStyle; label: string }[] = [
  { value: "shaded", label: "Shaded" },
  { value: "hidden-line", label: "Hidden line" },
  { value: "monochrome", label: "Monochrome" },
  { value: "wireframe", label: "Wireframe" },
  { value: "xray", label: "X-Ray" },
];

type HeaderMenu = "file" | "view" | "camera" | null;

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimension(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} m`;
  return `${Math.round(value)} mm`;
}

const MODEL_CACHE_DB = "skp-viewer-cache";
const MODEL_CACHE_STORE = "models";
const MODEL_CACHE_KEY = "latest";

type CachedModel = {
  name: string;
  type: string;
  lastModified: number;
  buffer: ArrayBuffer;
};

function openModelCache() {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve<IDBDatabase | null>(null);
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(MODEL_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MODEL_CACHE_STORE)) request.result.createObjectStore(MODEL_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function cacheModel(file: File, buffer: ArrayBuffer) {
  const database = await openModelCache();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(MODEL_CACHE_STORE, "readwrite");
    transaction.objectStore(MODEL_CACHE_STORE).put({ name: file.name, type: file.type, lastModified: file.lastModified, buffer }, MODEL_CACHE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

async function restoreCachedModel() {
  const database = await openModelCache();
  if (!database) return null;
  return new Promise<File | null>((resolve) => {
    const request = database.transaction(MODEL_CACHE_STORE, "readonly").objectStore(MODEL_CACHE_STORE).get(MODEL_CACHE_KEY);
    request.onsuccess = () => {
      const cached = request.result as CachedModel | undefined;
      database.close();
      resolve(cached?.buffer ? new File([cached.buffer], cached.name, { type: cached.type, lastModified: cached.lastModified }) : null);
    };
    request.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

async function clearCachedModel() {
  const database = await openModelCache();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(MODEL_CACHE_STORE, "readwrite");
    transaction.objectStore(MODEL_CACHE_STORE).delete(MODEL_CACHE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  database.close();
}

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasUserSelectedFile = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [stats, setStats] = useState<ModelStats>(initialStats);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("shaded");
  const [projection, setProjection] = useState<Projection>("perspective");
  const [fov, setFov] = useState(35);
  const [leftPanel, setLeftPanel] = useState(true);
  const [activeLayer, setActiveLayer] = useState("All layers");
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [viewPreset, setViewPreset] = useState<"iso" | "front" | "top">("iso");
  const [installationItems, setInstallationItems] = useState<InstallationItem[]>([]);
  const [sceneGroups, setSceneGroups] = useState<SceneGroup[]>([]);
  const [scenes, setScenes] = useState<ScenePage[]>([]);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [activeSectionPlaneIndex, setActiveSectionPlaneIndex] = useState<number | null>(null);
  const [abfVisibility, setAbfVisibility] = useState<AbfVisibility>(initialAbfVisibility);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [selectedInstallId, setSelectedInstallId] = useState<string | null>(null);
  const [selectedGroupPath, setSelectedGroupPath] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<PickedEntity | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<[number, number, number][]>([]);
  const [openMenu, setOpenMenu] = useState<HeaderMenu>(null);

  const readFile = useCallback(async (nextFile: File, persist = true) => {
    if (!nextFile.name.toLowerCase().endsWith(".skp")) {
      setError("Vui lòng chọn file SketchUp có đuôi .skp.");
      return;
    }

    if (persist) hasUserSelectedFile.current = true;
    setError(null);
    setSelectedInstallId(null);
    setSelectedGroupPath(null);
    setSelectedEntity(null);
    setInstallationItems([]);
    setSceneGroups([]);
    setScenes([]);
    setActiveSceneIndex(null);
    setModelInfo(null);
    setActiveSectionPlaneIndex(null);
    setAbfVisibility(initialAbfVisibility);
    setExplodeFactor(0);
    setHiddenLayers([]);
    setMeasureMode(false);
    setMeasurementPoints([]);
    setIsLoading(true);
    setProgress(8);
    setFile(nextFile);
    try {
      const nextBuffer = await nextFile.arrayBuffer();
      setProgress(30);
      setBuffer(nextBuffer);
      if (persist) void cacheModel(nextFile, nextBuffer);
      setProgress(100);
    } catch {
      setError("Không thể đọc file này. Hãy thử lại với một file .skp khác.");
      setBuffer(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void restoreCachedModel().then((cachedFile) => {
      if (!cachedFile || cancelled || hasUserSelectedFile.current) return;
      void readFile(cachedFile, false);
    });
    return () => {
      cancelled = true;
    };
  }, [readFile]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer.files[0];
      if (dropped) void readFile(dropped);
    },
    [readFile],
  );

  const layers = useMemo(() => Array.from(new Set(["All layers", ...(stats.layerNames ?? []).map(normalizeLayerName)])), [stats.layerNames]);

  useEffect(() => {
    if (!layers.includes(activeLayer)) setActiveLayer("All layers");
  }, [activeLayer, layers]);

  const toggleLayerVisibility = useCallback((layer: string) => {
    if (layer === "All layers") {
      setActiveLayer("All layers");
      setHiddenLayers([]);
      return;
    }
    const isHidden = hiddenLayers.some((hiddenLayer) => normalizeLayerName(hiddenLayer) === layer);
    setHiddenLayers((current) => isHidden
      ? current.filter((hiddenLayer) => normalizeLayerName(hiddenLayer) !== layer)
      : [...current, layer]);
    setActiveLayer("All layers");
  }, [hiddenLayers]);

  const activeScene = activeSceneIndex === null ? null : scenes[activeSceneIndex] ?? null;
  const activeSectionPlane = activeSectionPlaneIndex === null ? null : modelInfo?.sectionPlanes[activeSectionPlaneIndex] ?? null;
  const selectedAbfPart = useMemo(() => {
    const boardIndex = selectedEntity?.abf?.boardIndex;
    if (!boardIndex) return null;
    return modelInfo?.abf?.parts.find((part) => part.boardIndex === boardIndex) ?? null;
  }, [modelInfo?.abf?.parts, selectedEntity?.abf?.boardIndex]);
  const selectedAbfSheet = useMemo(() => {
    if (!selectedEntity?.groupPath || !modelInfo?.abf) return null;
    return modelInfo.abf.nestingSheets.find((sheet) => selectedEntity.groupPath === sheet.path || selectedEntity.groupPath.startsWith(`${sheet.path} / `)) ?? null;
  }, [modelInfo?.abf, selectedEntity?.groupPath]);

  const handleModelInfo = useCallback((info: ModelInfo) => {
    setModelInfo(info);
    setHiddenLayers(info.hiddenLayers);
    setActiveSectionPlaneIndex(info.sectionPlanes.length > 0 ? 0 : null);
  }, []);

  const toggleAbfVisibility = useCallback((key: keyof AbfVisibility) => {
    setAbfVisibility((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const selectAbfPath = useCallback((path: string) => {
    setAbfVisibility((current) => ({ ...current, nesting: true }));
    setActiveLayer("All layers");
    setSelectedGroupPath(path);
    setSelectedInstallId(null);
    setSelectedEntity(null);
  }, []);

  const selectScene = useCallback((index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    setActiveSceneIndex(index);
    setFov(Math.round(scene.fov || 35));
    setProjection(scene.parallel ? "orthographic" : "perspective");
    setHiddenLayers(scene.hiddenLayers);
    setSelectedInstallId(null);
    setSelectedGroupPath(null);
    setSelectedEntity(null);
  }, [scenes]);

  const handleEntitySelect = useCallback((entity: PickedEntity | null) => {
    setSelectedEntity(entity);
    if (!entity) {
      setSelectedInstallId(null);
      setSelectedGroupPath(null);
      return;
    }
    setSelectedInstallId(entity.installId || null);
    setSelectedGroupPath(entity.groupPath === "ROOT" ? null : entity.groupPath);
    setMeasureMode(false);
  }, []);

  const handleMeasurePoint = useCallback((point: [number, number, number]) => {
    setSelectedEntity(null);
    setMeasurementPoints((current) => current.length === 2 ? [point] : [...current, point]);
  }, []);

  const measurementDistance = measurementPoints.length === 2
    ? Math.sqrt(
      (measurementPoints[1][0] - measurementPoints[0][0]) ** 2
      + (measurementPoints[1][1] - measurementPoints[0][1]) ** 2
      + (measurementPoints[1][2] - measurementPoints[0][2]) ** 2,
    )
    : null;

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const exportInstallationCsv = useCallback(() => {
    if (installationItems.length === 0) return;
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      ["Cấu kiện", "Số lượng", "Kích thước X (mm)", "Kích thước Y (mm)", "Kích thước Z (mm)", "Layer", "Vị trí X (mm)", "Vị trí Y (mm)", "Vị trí Z (mm)"],
      ...installationItems.map((item) => [item.name, item.count, item.sizeMm[0], item.sizeMm[1], item.sizeMm[2], item.layer, item.positionMm[0], item.positionMm[1], item.positionMm[2]]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name?.replace(/\.skp$/i, "") || "skp-model"}-installation.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [file?.name, installationItems]);

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Box size={17} strokeWidth={2.4} /></div>
          <div>
            <p className="brand-name">SKP VIEWER</p>
            <p className="brand-subtitle">3D model workspace</p>
          </div>
        </div>
        <div className="topbar-divider" />
        <nav className="menu-strip" aria-label="Application menu" ref={menuRef}>
          <div className="menu-item-wrap">
            <button className={openMenu === "file" ? "menu-active" : ""} aria-expanded={openMenu === "file"} onClick={() => setOpenMenu((menu) => menu === "file" ? null : "file")}>File <ChevronDown size={12} /></button>
            {openMenu === "file" && (
              <div className="header-menu-panel">
                <button onClick={() => { inputRef.current?.click(); setOpenMenu(null); }}><Upload size={14} /> Mở file SketchUp <span>⌘O</span></button>
                <button disabled={installationItems.length === 0} onClick={() => { exportInstallationCsv(); setOpenMenu(null); }}><Download size={14} /> Xuất danh sách lắp đặt <span>CSV</span></button>
                <div className="header-menu-divider" />
                <button onClick={() => { void clearCachedModel(); hasUserSelectedFile.current = false; setBuffer(null); setFile(null); setStats(initialStats); setActiveLayer("All layers"); setHiddenLayers([]); setInstallationItems([]); setSceneGroups([]); setScenes([]); setActiveSceneIndex(null); setModelInfo(null); setActiveSectionPlaneIndex(null); setAbfVisibility(initialAbfVisibility); setExplodeFactor(0); setSelectedInstallId(null); setSelectedGroupPath(null); setSelectedEntity(null); setMeasureMode(false); setMeasurementPoints([]); setError(null); setOpenMenu(null); }}><Box size={14} /> Đóng model</button>
              </div>
            )}
          </div>
          <div className="menu-item-wrap">
            <button className={openMenu === "view" ? "menu-active" : ""} aria-expanded={openMenu === "view"} onClick={() => setOpenMenu((menu) => menu === "view" ? null : "view")}>View <ChevronDown size={12} /></button>
            {openMenu === "view" && (
              <div className="header-menu-panel">
                <button onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={14} /> Lưới <span>{showGrid ? "Đang bật" : "Đang tắt"}</span></button>
                <button onClick={() => setShowAxes((value) => !value)}><Scan size={14} /> Trục XYZ <span>{showAxes ? "Đang bật" : "Đang tắt"}</span></button>
                <button onClick={() => setShowEdges((value) => !value)}><Eye size={14} /> SketchUp edges <span>{showEdges ? "Đang bật" : "Đang tắt"}</span></button>
                <button onClick={() => setShowDimensions((value) => !value)}><Ruler size={14} /> Kích thước SketchUp <span>{showDimensions ? "Đang bật" : "Đang tắt"}</span></button>
                <button onClick={() => setShowGuides((value) => !value)}><Scan size={14} /> Guide lines / points <span>{showGuides ? "Đang bật" : "Đang tắt"}</span></button>
                <div className="header-menu-divider" />
                {renderStyles.map((style) => (
                  <button key={style.value} className={renderStyle === style.value ? "menu-option-active" : ""} onClick={() => { setRenderStyle(style.value); setOpenMenu(null); }}><span className={`menu-style-dot menu-style-${style.value}`} /> {style.label} {renderStyle === style.value && <span>✓</span>}</button>
                ))}
              </div>
            )}
          </div>
          <div className="menu-item-wrap">
            <button className={openMenu === "camera" ? "menu-active" : ""} aria-expanded={openMenu === "camera"} onClick={() => setOpenMenu((menu) => menu === "camera" ? null : "camera")}>Camera <ChevronDown size={12} /></button>
            {openMenu === "camera" && (
              <div className="header-menu-panel">
                <button className={projection === "perspective" ? "menu-option-active" : ""} onClick={() => { setProjection("perspective"); setOpenMenu(null); }}><Camera size={14} /> Perspective {projection === "perspective" && <span>✓</span>}</button>
                <button className={projection === "orthographic" ? "menu-option-active" : ""} onClick={() => { setProjection("orthographic"); setOpenMenu(null); }}><Camera size={14} /> Orthographic {projection === "orthographic" && <span>✓</span>}</button>
                <div className="header-menu-control">
                  <label htmlFor="header-fov">Field of view <strong>{fov}°</strong></label>
                  <input id="header-fov" type="range" min="20" max="80" value={fov} disabled={projection === "orthographic"} onChange={(event) => { setFov(Number(event.target.value)); setActiveSceneIndex(null); }} />
                </div>
                <div className="header-menu-divider" />
                <button onClick={() => { setViewPreset("iso"); setOpenMenu(null); }}><Rotate3D size={14} /> Isometric</button>
                <button onClick={() => { setViewPreset("front"); setOpenMenu(null); }}><Scan size={14} /> Front</button>
                <button onClick={() => { setViewPreset("top"); setOpenMenu(null); }}><Grid3X3 size={14} /> Top</button>
                <div className="header-menu-divider" />
                <button onClick={() => { window.dispatchEvent(new Event("skp-fit-model")); setOpenMenu(null); }}><Maximize size={14} /> Fit model <span>F</span></button>
                <button onClick={() => { window.dispatchEvent(new Event("skp-zoom-in")); setOpenMenu(null); }}><ZoomIn size={14} /> Zoom in</button>
              </div>
            )}
          </div>
        </nav>
        <div className="document-name">
          <span className="document-dot" />
          <span>{file?.name ?? "No model loaded"}</span>
          {file && <span className="document-size">{formatSize(file.size)}</span>}
        </div>
        <div className="topbar-actions">
          <button className="icon-button ghost" title="Cài đặt hiển thị" aria-label="Cài đặt hiển thị" onClick={() => setOpenMenu("view")}><Settings2 size={17} /></button>
          <label className="upload-button" htmlFor="skp-file-input">
            <Upload size={16} />
            Mở file
          </label>
          <input id="skp-file-input" ref={inputRef} className="file-input" type="file" accept="*/*" onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void readFile(selected);
            event.target.value = "";
          }} />
        </div>
      </header>

      <div className="workspace">
        <div className="tool-rail" aria-label="Model tools">
          <button className="rail-button active" title="Select"><MousePointer2 size={17} /></button>
          <button className="rail-button" title="Orbit"><Rotate3D size={17} /></button>
          <button className="rail-button" title="Pan"><Hand size={17} /></button>
          <button className={`rail-button ${measureMode ? "active" : ""}`} title="Measure" onClick={() => { setMeasureMode((value) => !value); setMeasurementPoints([]); setSelectedEntity(null); }}><Ruler size={17} /></button>
          <span className="rail-divider" />
          <button className={`rail-button ${showGrid ? "active" : ""}`} title="Grid" onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={17} /></button>
        </div>
        {leftPanel && (
          <aside className="sidebar">
            <div className="sidebar-section sidebar-header">
              <div>
                <p className="eyebrow">MODEL INSPECTOR</p>
                <h1>{file?.name?.replace(/\.skp$/i, "") ?? "Untitled model"}</h1>
              </div>
              <button className="compact-button" title="Ẩn bảng điều khiển" onClick={() => setLeftPanel(false)}><PanelLeft size={16} /></button>
            </div>

            <div className="sidebar-section stats-section">
              <div className="section-title-row"><span>Overview</span><Scan size={15} /></div>
              <p className="section-caption model-meta-caption">{modelInfo?.units ? `Units: ${modelInfo.units}` : "Units: unknown"} · {stats.dimensions || 0} dimensions · {stats.sectionPlanes || 0} section planes</p>
              <div className="stats-grid">
                <div className="stat-card"><span>Definitions</span><strong>{stats.definitions || "—"}</strong></div>
                <div className="stat-card"><span>Materials</span><strong>{stats.materials || "—"}</strong></div>
                <div className="stat-card"><span>Layers</span><strong>{stats.layers || "—"}</strong></div>
                <div className="stat-card"><span>Visible edges</span><strong>{stats.edges || "—"}</strong></div>
              </div>
            </div>

            {modelInfo?.abf?.detected && (
              <div className="sidebar-section production-section">
                <div className="section-title-row"><span>ABF production</span><span className="section-count">{modelInfo.abf.boardCount} tấm</span></div>
                <p className="section-caption">Đã đọc từ layer, group và attribute ABF trong file SKP. Các lớp phụ mặc định đang tắt.</p>
                <div className="production-summary">
                  <span><strong>{modelInfo.abf.nestingSheetCount}</strong> khổ ván</span>
                  <span><strong>{modelInfo.abf.featureCounts.edgeBanding}</strong> cạnh dán</span>
                  <span><strong>{modelInfo.abf.featureCounts.fittings + modelInfo.abf.featureCounts.intersections}</strong> phụ kiện</span>
                  <span><strong>{modelInfo.abf.labelCount}</strong> nhãn tấm</span>
                </div>
                <div className="production-toggle-grid">
                  <button className={abfVisibility.nesting ? "selected" : ""} onClick={() => toggleAbfVisibility("nesting")}><Layers3 size={13} /> Nesting</button>
                  <button className={abfVisibility.labels ? "selected" : ""} onClick={() => toggleAbfVisibility("labels")}><Eye size={13} /> Labels</button>
                  <button className={abfVisibility.cuttingLines ? "selected" : ""} onClick={() => toggleAbfVisibility("cuttingLines")}><Scan size={13} /> Cutting lines</button>
                  <button className={abfVisibility.edgeBanding ? "selected" : ""} onClick={() => toggleAbfVisibility("edgeBanding")}><Box size={13} /> Edge banding</button>
                  <button className={abfVisibility.fittings ? "selected" : ""} onClick={() => toggleAbfVisibility("fittings")}><Settings2 size={13} /> Fittings</button>
                  <button className={abfVisibility.intersections ? "selected" : ""} onClick={() => toggleAbfVisibility("intersections")}><Scan size={13} /> Intersections</button>
                </div>
                {modelInfo.abf.nestingSheets.length > 0 && <>
                  <div className="section-subtitle">Nesting sheets</div>
                  <div className="production-sheet-list">
                    {modelInfo.abf.nestingSheets.slice(0, 12).map((sheet) => (
                      <button key={sheet.id} className={selectedGroupPath === sheet.path ? "selected" : ""} onClick={() => selectAbfPath(sheet.path)}>
                        <span><strong>{sheet.name}</strong><small>{sheet.thicknessMm ? `${sheet.thicknessMm} mm` : "Sheet"} · {sheet.partCount} chi tiết</small></span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                </>}
                <div className="production-control">
                  <label htmlFor="explode-factor"><span>Sơ đồ bung / lắp ráp</span><strong>{explodeFactor === 0 ? "Lắp ráp" : `${Math.round(explodeFactor * 100)}% bung`}</strong></label>
                  <input id="explode-factor" type="range" min="0" max="1" step="0.05" value={explodeFactor} onChange={(event) => setExplodeFactor(Number(event.target.value))} />
                </div>
                <div className="section-subtitle">Thống kê chi tiết</div>
                <div className="production-part-list">
                  {modelInfo.abf.parts.slice(0, 40).map((part) => <button key={part.id} className="production-part-row" onClick={() => selectAbfPath(part.path)}><span><strong>#{part.boardIndex} · {part.name.replace(/^__\d+\.?\s*/, "")}</strong><small>{part.material} · {formatDimension(part.sizeMm[0])} × {formatDimension(part.sizeMm[1])} × {formatDimension(part.sizeMm[2])}</small></span><em>{part.edgeBandTypes ? "EB" : "—"}</em></button>)}
                </div>
                {modelInfo.abf.parts.length > 40 && <span className="list-overflow">+ {modelInfo.abf.parts.length - 40} tấm khác</span>}
                <div className="section-subtitle">CAM / mối nối</div>
                <div className="production-data-list">
                  {modelInfo.abf.operations.length > 0 ? modelInfo.abf.operations.map((operation) => <div key={`${operation.kind}-${operation.name}`}><span>{operation.kind} · {operation.name}</span><strong>{operation.count}</strong></div>) : <p className="production-empty">File chưa có metadata CAM/mối nối để đọc.</p>}
                </div>
                <div className="section-subtitle">Minifix / Lockdowel / phụ kiện</div>
                <div className="production-data-list">
                  {modelInfo.abf.connectors.length > 0 ? modelInfo.abf.connectors.map((connector) => <div key={connector.name}><span>{connector.name}</span><strong>{connector.count}</strong></div>) : <p className="production-empty">File hiện tại không chứa metadata định danh Minifix, Lockdowel hoặc phụ kiện liên kết.</p>}
                </div>
              </div>
            )}

            <div className="sidebar-section installation-section">
              <div className="section-title-row">
                <span>Installation takeoff</span>
                <button className="export-installation" title="Xuất CSV danh sách lắp đặt" onClick={exportInstallationCsv} disabled={installationItems.length === 0}><Download size={13} /> CSV</button>
              </div>
              <div className="installation-meta"><span>{installationItems.length} loại cấu kiện</span><span>{installationItems.reduce((total, item) => total + item.count, 0)} vị trí</span></div>
              <p className="section-caption">Chọn một cấu kiện để cô lập và zoom vào vị trí lắp.</p>
              {selectedInstallId && (
                <button className="clear-selection" onClick={() => setSelectedInstallId(null)}>Hiện toàn bộ model</button>
              )}
              <div className="installation-list">
                {installationItems.length === 0 && <div className="empty-installation">Chưa tìm thấy component có thể bóc tách.</div>}
                {installationItems.slice(0, 80).map((item) => (
                  <button key={item.id} className={`installation-row ${selectedInstallId === item.id ? "selected" : ""}`} onClick={() => { setSelectedInstallId((current) => current === item.id ? null : item.id); setSelectedGroupPath(null); }}>
                    <span className="installation-index">{item.count}</span>
                    <span className="installation-copy">
                      <strong>{item.name}</strong>
                      <small>{item.definitionName || "Component"} · {item.layer}</small>
                      <small>{formatDimension(item.sizeMm[0])} × {formatDimension(item.sizeMm[1])} × {formatDimension(item.sizeMm[2])}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              {installationItems.length > 80 && <span className="list-overflow">+ {installationItems.length - 80} loại khác</span>}
            </div>

            <div className="sidebar-section groups-section">
              <div className="section-title-row"><span>Groups / Components</span><span className="section-count">{sceneGroups.length}</span></div>
              <p className="section-caption">Cây nhóm lấy trực tiếp từ cấu trúc file SketchUp. Chọn nhóm để cô lập và đánh dấu toàn bộ phần con.</p>
              {selectedGroupPath && <button className="clear-selection" onClick={() => setSelectedGroupPath(null)}>Hiện toàn bộ groups</button>}
              <div className="group-list">
                {sceneGroups.length === 0 && <div className="empty-installation">File chưa có group/component có hình học.</div>}
                {sceneGroups.slice(0, 120).map((group) => (
                  <button
                    key={group.id}
                    className={`group-row ${selectedGroupPath === group.path ? "selected" : ""}`}
                    style={{ paddingLeft: `${8 + group.depth * 14}px` }}
                    title={`${group.path} · ${formatDimension(group.sizeMm[0])} × ${formatDimension(group.sizeMm[1])} × ${formatDimension(group.sizeMm[2])}`}
                    onClick={() => {
                      setSelectedGroupPath((current) => current === group.path ? null : group.path);
                      setSelectedInstallId(null);
                    }}
                  >
                    <span className="group-marker"><Layers3 size={12} /></span>
                    <span className="group-copy"><strong>{group.name}</strong><small>{group.count} vị trí · {group.layer}</small></span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
              {sceneGroups.length > 120 && <span className="list-overflow">+ {sceneGroups.length - 120} groups khác</span>}
            </div>

            <div className="sidebar-section scenes-section">
              <div className="section-title-row"><span>Scenes / Pages</span><span className="section-count">{scenes.length}</span></div>
              <p className="section-caption">Khôi phục camera, FOV, projection và layer visibility đã lưu trong file SKP.</p>
              <div className="scene-list">
                {scenes.length === 0 && <div className="empty-installation">File chưa lưu scene/page.</div>}
                {scenes.map((scene, index) => (
                  <button key={`${scene.name}-${index}`} className={`scene-row ${activeSceneIndex === index ? "selected" : ""}`} onClick={() => selectScene(index)}>
                    <span className="scene-index">{index + 1}</span>
                    <span className="scene-copy"><strong>{scene.name || `Scene ${index + 1}`}</strong><small>{scene.parallel ? "Orthographic" : "Perspective"} · FOV {Math.round(scene.fov)}°</small></span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            </div>

            <div className="sidebar-section annotations-section">
              <div className="section-title-row"><span>SketchUp annotations</span><span className="section-count">{(modelInfo?.dimensions.length ?? 0) + (modelInfo?.constructionLines.length ?? 0) + (modelInfo?.constructionPoints.length ?? 0)}</span></div>
              <p className="section-caption">Giữ lại kích thước và guide từ file gốc để thợ đối chiếu khi lắp đặt.</p>
              <div className="annotation-toggle-grid">
                <button className={showDimensions ? "selected" : ""} onClick={() => setShowDimensions((value) => !value)}><Ruler size={13} /> Dimensions</button>
                <button className={showGuides ? "selected" : ""} onClick={() => setShowGuides((value) => !value)}><Scan size={13} /> Guides</button>
              </div>
              {(modelInfo?.sectionPlanes.length ?? 0) > 0 && <>
                <div className="section-subtitle">Section planes</div>
                <div className="section-plane-list">
                  <button className={activeSectionPlaneIndex === null ? "selected" : ""} onClick={() => setActiveSectionPlaneIndex(null)}>Off</button>
                  {modelInfo?.sectionPlanes.map((section, index) => (
                    <button key={`${section.name}-${index}`} className={activeSectionPlaneIndex === index ? "selected" : ""} onClick={() => setActiveSectionPlaneIndex(index)}>{section.name || section.label || `Section ${index + 1}`}</button>
                  ))}
                </div>
              </>}
            </div>

            {selectedEntity && (
              <div className="sidebar-section entity-section">
                <div className="section-title-row"><span>Entity info</span><span className="section-count">PICKED</span></div>
                <div className="entity-title"><strong>{selectedEntity.name}</strong><small>{selectedEntity.definitionName || "SketchUp object"}</small></div>
                <div className="entity-grid">
                  <span>Type</span><strong>Group / Component</strong>
                  <span>Layer</span><strong>{selectedEntity.layer}</strong>
                  <span>Size</span><strong>{formatDimension(selectedEntity.sizeMm[0])} × {formatDimension(selectedEntity.sizeMm[1])} × {formatDimension(selectedEntity.sizeMm[2])}</strong>
                  <span>Position</span><strong>{Math.round(selectedEntity.positionMm[0])}, {Math.round(selectedEntity.positionMm[1])}, {Math.round(selectedEntity.positionMm[2])} mm</strong>
                </div>
                {selectedAbfPart && <div className="entity-properties entity-board-properties"><strong>Board specification</strong><span><em>Board index</em>#{selectedAbfPart.boardIndex}</span><span><em>Part name</em>{selectedAbfPart.name.replace(/^__\d+\.?\s*/, "")}</span><span><em>Material</em>{selectedAbfPart.material}</span><span><em>Dimensions</em>{formatDimension(selectedAbfPart.sizeMm[0])} × {formatDimension(selectedAbfPart.sizeMm[1])} × {formatDimension(selectedAbfPart.sizeMm[2])}</span><span><em>Label rotation</em>{selectedAbfPart.labelRotation ? `${selectedAbfPart.labelRotation}°` : "—"}</span><span><em>Edge banding</em>{selectedAbfPart.edgeBandTypes || "None"}</span>{selectedAbfSheet && <span><em>Nesting sheet</em>{selectedAbfSheet.name}</span>}</div>}
                {Object.entries(selectedEntity.properties).length > 0 && <div className="entity-properties"><strong>Dynamic attributes</strong>{Object.entries(selectedEntity.properties).slice(0, 8).map(([key, value]) => <span key={key}><em>{key}</em>{value}</span>)}</div>}
                {selectedEntity.abf && <div className="entity-properties entity-abf-properties"><strong>ABF production</strong><span><em>Role</em>{selectedEntity.abf.role}</span><span><em>In nesting</em>{selectedEntity.abf.inNesting ? "Yes" : "No"}</span>{selectedEntity.abf.boardIndex && <span><em>Board index</em>{selectedEntity.abf.boardIndex}</span>}{selectedEntity.abf.edgeBandTypes && <span><em>Edge band</em>{selectedEntity.abf.edgeBandTypes}</span>}{selectedEntity.abf.settingName && <span><em>Operation</em>{selectedEntity.abf.settingName}</span>}</div>}
                {Object.entries(selectedEntity.attributeDictionaries).slice(0, 4).map(([dictionary, values]) => <div className="entity-properties" key={dictionary}><strong>{dictionary}</strong>{Object.entries(values).slice(0, 8).map(([key, value]) => <span key={key}><em>{key}</em>{value}</span>)}</div>)}
                <small className="entity-path">{selectedEntity.groupPath}</small>
              </div>
            )}

            <div className="sidebar-section style-section">
              <div className="section-title-row"><span>Display style</span><Sun size={15} /></div>
              <div className="style-grid">
                {renderStyles.map((style) => (
                  <button key={style.value} className={`style-option ${renderStyle === style.value ? "selected" : ""}`} onClick={() => setRenderStyle(style.value)}>
                    <span className={`style-icon style-icon-${style.value}`} />
                    {style.label}
                  </button>
                ))}
              </div>
              <div className="display-toggles">
                <button className={showEdges ? "selected" : ""} onClick={() => setShowEdges((value) => !value)}>{showEdges ? <Eye size={13} /> : <EyeOff size={13} />} Edges</button>
                <button className={showAxes ? "selected" : ""} onClick={() => setShowAxes((value) => !value)}><span className="axes-mini">XYZ</span> Axes</button>
              </div>
            </div>

            <div className="sidebar-section layers-section">
              <div className="section-title-row"><span>Layers</span><Layers3 size={15} /></div>
              <div className="layer-list">
                {layers.map((layer, index) => {
                  const isHidden = hiddenLayers.some((hiddenLayer) => normalizeLayerName(hiddenLayer) === layer);
                  return <button key={layer} className={`layer-row ${activeLayer === layer ? "selected" : ""} ${isHidden ? "hidden" : ""}`} onClick={() => toggleLayerVisibility(layer)} onContextMenu={(event) => { event.preventDefault(); toggleLayerVisibility(layer); }} title={layer === "All layers" ? "Hiện toàn bộ layers" : "Click để ẩn/hiện layer như SketchUp"}>
                    <span className={`layer-swatch swatch-${index}`} />
                    <span>{layer}</span>
                    {isHidden ? <EyeOff size={14} className="layer-eye" /> : <Eye size={14} className="layer-eye" />}
                  </button>;
                })}
              </div>
            </div>

            <div className="sidebar-section help-card">
              <div className="help-icon"><MousePointer2 size={15} /></div>
              <div><strong>Điều khiển nhanh</strong><p>Kéo để xoay · Cuộn để zoom<br />Shift + kéo để pan</p></div>
            </div>
          </aside>
        )}

        <section
          className={`viewer-stage ${isDragging ? "dragging" : ""}`}
          onDrop={handleDrop}
          onDragEnter={() => setIsDragging(true)}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setIsDragging(false);
          }}
        >
          {!leftPanel && <button className="reopen-sidebar" title="Hiện bảng điều khiển" onClick={() => setLeftPanel(true)}><PanelLeft size={17} /></button>}
          <div className="viewport-label"><span className="live-dot" /> REAL-TIME VIEWPORT</div>
          {selectedGroupPath && <div className="group-selection-chip"><Layers3 size={13} /><span>GROUP</span><strong>{selectedGroupPath.split(" / ").pop()}</strong></div>}
          {selectedEntity && selectedAbfPart && <div className="selected-board-screen-card"><span className="selected-board-screen-kicker">SELECTED BOARD</span><strong>#{selectedAbfPart.boardIndex} · {selectedAbfPart.name.replace(/^__\d+\.?\s*/, "")}</strong><span>{selectedAbfPart.material} · {formatDimension(selectedAbfPart.sizeMm[0])} × {formatDimension(selectedAbfPart.sizeMm[1])} × {formatDimension(selectedAbfPart.sizeMm[2])}</span><span>{selectedAbfPart.edgeBandTypes ? `Cạnh dán: ${selectedAbfPart.edgeBandTypes}` : "Không có cạnh dán"}</span></div>}
          {measureMode && <div className="measure-mode-chip"><Ruler size={13} /><span>MEASURE</span><strong>{measurementDistance === null ? "Chọn 2 điểm trên model" : `${measurementDistance.toFixed(3)} m`}</strong><button onClick={() => { setMeasurementPoints([]); setMeasureMode(false); }}>×</button></div>}
          <div className="view-cube" aria-label="View presets">
            <button className={viewPreset === "top" ? "selected" : ""} onClick={() => setViewPreset("top")}>TOP</button>
            <button className={viewPreset === "iso" ? "selected" : ""} onClick={() => setViewPreset("iso")}>ISO</button>
            <button className={viewPreset === "front" ? "selected" : ""} onClick={() => setViewPreset("front")}>FRONT</button>
          </div>
          <SketchupCanvas
            buffer={buffer}
            showGrid={showGrid}
            showEdges={showEdges}
            showAxes={showAxes}
            showDimensions={showDimensions}
            showGuides={showGuides}
            renderStyle={renderStyle}
            projection={projection}
            fov={fov}
            activeLayer={activeLayer}
            hiddenLayers={hiddenLayers}
            selectedInstallId={selectedInstallId}
            selectedGroupPath={selectedGroupPath}
            activeScene={activeScene}
            activeSectionPlane={activeSectionPlane}
            abfVisibility={abfVisibility}
            explodeFactor={explodeFactor}
            measureMode={measureMode}
            measurementPoints={measurementPoints}
            viewPreset={viewPreset}
            onStats={setStats}
            onInstallationItems={setInstallationItems}
            onGroups={setSceneGroups}
            onScenes={setScenes}
            onModelInfo={handleModelInfo}
            onEntitySelect={handleEntitySelect}
            onMeasurePoint={handleMeasurePoint}
            onProgress={setProgress}
            onError={setError}
          />

          {!buffer && !isLoading && (
            <div className="empty-state">
              <div className="empty-icon"><FileUp size={22} /></div>
              <h2>Thả file SketchUp vào đây</h2>
              <p>Xem mô hình 3D ngay trên trình duyệt, không cần upload lên server.</p>
              <label className="primary-button" htmlFor="skp-file-input"><Upload size={16} /> Chọn file .skp</label>
              <span className="drop-hint">hoặc kéo & thả file vào vùng xem</span>
            </div>
          )}

          {isLoading && (
            <div className="loading-card">
              <div className="spinner" />
              <div><strong>Đang đọc mô hình</strong><span>{progress}% · Dữ liệu chỉ xử lý trong trình duyệt</span></div>
            </div>
          )}

          {error && <div className="error-card"><strong>Không thể mở mô hình</strong><span>{error}</span></div>}

          <div className="viewport-toolbar">
            <button className={`tool-button ${showGrid ? "active" : ""}`} title="Bật/tắt lưới" onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={17} /></button>
            <button className={`tool-button ${showEdges ? "active" : ""}`} title="Bật/tắt edge thật" onClick={() => setShowEdges((value) => !value)}><Rotate3D size={17} /></button>
            <button className={`tool-button ${projection === "orthographic" ? "active" : ""}`} title="Perspective / Orthographic" onClick={() => setProjection((value) => value === "perspective" ? "orthographic" : "perspective")}><Camera size={17} /></button>
            <button className={`tool-button ${measureMode ? "active" : ""}`} title="Đo khoảng cách" onClick={() => { setMeasureMode((value) => !value); setMeasurementPoints([]); setSelectedEntity(null); }}><Ruler size={17} /></button>
            <div className="toolbar-separator" />
            <button className="tool-button" title="Fit model" onClick={() => window.dispatchEvent(new Event("skp-fit-model"))}><Maximize size={17} /></button>
            <button className="tool-button" title="Zoom in" onClick={() => window.dispatchEvent(new Event("skp-zoom-in"))}><ZoomIn size={17} /></button>
          </div>

          <div className="viewport-status"><span>{projection === "perspective" ? "Perspective" : "Orthographic"}</span><span className="status-separator" /><span>{renderStyles.find((style) => style.value === renderStyle)?.label}</span><span className="status-separator" /><span>{activeLayer}</span><span className="status-separator" /><span className="status-ok">● Loaded</span></div>
          <div className="statusbar"><span>Units: {modelInfo?.units ?? "metres"}</span><span className="statusbar-divider" /><span>Orbit · Pan · Zoom</span><span className="statusbar-spacer" /><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
          {isDragging && <div className="drop-overlay"><FileUp size={27} /><strong>Thả để mở mô hình</strong></div>}
        </section>
      </div>
    </main>
  );
}
