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
import SketchupCanvas, { InstallationItem, ModelInfo, PickedEntity, Projection, RenderStyle, SceneGroup, ScenePage } from "../components/SketchupCanvas";

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

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
  const [showDimensions, setShowDimensions] = useState(true);
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
  const [selectedInstallId, setSelectedInstallId] = useState<string | null>(null);
  const [selectedGroupPath, setSelectedGroupPath] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<PickedEntity | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<[number, number, number][]>([]);
  const [openMenu, setOpenMenu] = useState<HeaderMenu>(null);

  const readFile = useCallback(async (nextFile: File) => {
    if (!nextFile.name.toLowerCase().endsWith(".skp")) {
      setError("Vui lòng chọn file SketchUp có đuôi .skp.");
      return;
    }

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
    fetch("/file.skp")
      .then((response) => (response.ok ? response.blob() : null))
      .then(async (blob) => {
        if (!blob || cancelled) return;
        const demoFile = new File([blob], "file.skp", { type: "application/octet-stream" });
        await readFile(demoFile);
      })
      .catch(() => undefined);
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

  const layers = useMemo(() => ["All layers", ...(stats.layerNames ?? [])], [stats.layerNames]);

  useEffect(() => {
    if (!layers.includes(activeLayer)) setActiveLayer("All layers");
  }, [activeLayer, layers]);

  const activeScene = activeSceneIndex === null ? null : scenes[activeSceneIndex] ?? null;
  const activeSectionPlane = activeSectionPlaneIndex === null ? null : modelInfo?.sectionPlanes[activeSectionPlaneIndex] ?? null;

  const handleModelInfo = useCallback((info: ModelInfo) => {
    setModelInfo(info);
    setHiddenLayers(info.hiddenLayers);
    setActiveSectionPlaneIndex(info.sectionPlanes.length > 0 ? 0 : null);
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
                <button onClick={() => { setBuffer(null); setFile(null); setStats(initialStats); setActiveLayer("All layers"); setHiddenLayers([]); setInstallationItems([]); setSceneGroups([]); setScenes([]); setActiveSceneIndex(null); setModelInfo(null); setActiveSectionPlaneIndex(null); setSelectedInstallId(null); setSelectedGroupPath(null); setSelectedEntity(null); setMeasureMode(false); setMeasurementPoints([]); setError(null); setOpenMenu(null); }}><Box size={14} /> Đóng model</button>
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
          <button className="upload-button" onClick={() => inputRef.current?.click()}>
            <Upload size={16} />
            Mở file
          </button>
          <input ref={inputRef} hidden type="file" accept=".skp" onChange={(event) => {
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
                {Object.entries(selectedEntity.properties).length > 0 && <div className="entity-properties"><strong>Dynamic attributes</strong>{Object.entries(selectedEntity.properties).slice(0, 8).map(([key, value]) => <span key={key}><em>{key}</em>{value}</span>)}</div>}
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
                {layers.map((layer, index) => (
                  <button key={layer} className={`layer-row ${activeLayer === layer ? "selected" : ""} ${hiddenLayers.includes(layer) ? "hidden" : ""}`} onClick={() => setActiveLayer(layer)} onContextMenu={(event) => { event.preventDefault(); if (layer !== "All layers") setHiddenLayers((current) => current.includes(layer) ? current.filter((value) => value !== layer) : [...current, layer]); }} title={layer === "All layers" ? "Chọn tất cả layers" : "Click chọn layer · click phải để ẩn/hiện layer"}>
                    <span className={`layer-swatch swatch-${index}`} />
                    <span>{layer}</span>
                    {hiddenLayers.includes(layer) ? <EyeOff size={14} className="layer-eye" /> : <Eye size={14} className="layer-eye" />}
                  </button>
                ))}
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
              <button className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Chọn file .skp</button>
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
