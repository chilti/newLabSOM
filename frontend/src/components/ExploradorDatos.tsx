import React, { useRef, useState, useEffect, useMemo } from 'react';
import chroma from 'chroma-js';
import { line, curveCatmullRom } from 'd3-shape';
import { useSomStore, getApiUrl } from '../store/somStore';
import { 
  Upload, 
  Database, 
  Settings, 
  HelpCircle, 
  Activity, 
  RefreshCw, 
  ExternalLink,
  Sliders,
  TrendingUp,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronRight,
  Download
} from 'lucide-react';
import { BoxPlot } from './BoxPlot';
import { MallaHexagonal, type Trajectory } from './MallaHexagonal';
import { UmapHeatmap } from './UmapHeatmap';
import { ClusterMetricsModal } from './ClusterMetricsModal';
import { parseTrajectoryEntity } from '../utils/timeSeries';

export const ExploradorDatos: React.FC = () => {
  const { 
    dataMatrix, 
    labels, 
    compNames, 
    result, 
    isTraining, 
    trainSOM,
    generateUmap,
    isGeneratingUmap,
    config, 
    setConfig, 
    hardware, 
    fetchSystemStatus,
    showLabelsOnComponents,
    setShowLabelsOnComponents,
    normalizationInfo,
    applyNormalization,
    revertNormalization,
    matrixOrigin,
    originalDataMatrix,
    isCmaSmoothingActive,
    cmaWindowSize,
    setIsCmaSmoothingActive,
    setCmaWindowSize,
    activeTrajectories,
    setActiveTrajectories,
    trajectoryLineWidth,
    setTrajectoryLineWidth,
    isTrajectoriesExpanded,
    setIsTrajectoriesExpanded,
    entityColorOverrides,
    setEntityColorOverrides,
    showLabelsOnUmapScatter,
    setShowLabelsOnUmapScatter,
    reclusterLocally,
    fileName,
    exploSubTab, setExploSubTab,
    exploUmapColorScale, setExploUmapColorScale,
    exploSomColorScale, setExploSomColorScale,
  } = useSomStore();

  // Alias store names to match local usage in JSX
  const subTab = exploSubTab;
  const setSubTab = setExploSubTab;
  const umapColorScale = exploUmapColorScale;
  const setUmapColorScale = setExploUmapColorScale;
  const somColorScale = exploSomColorScale;
  const setSomColorScale = setExploSomColorScale;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [labelIndex, setLabelIndex] = useState(0);
  const [hoveredUmapDot, setHoveredUmapDot] = useState<number | null>(null);
  const [showClusterMetrics, setShowClusterMetrics] = useState(false);
  
  const [umapHeatmapScale, setUmapHeatmapScale] = useState(1); // 1 = 240x200, 1.5 = 360x300, 2 = 480x400

  // Main UMAP native zoom/pan state
  const [mainUmapZoom, setMainUmapZoom] = useState(1);
  const [mainUmapPan, setMainUmapPan] = useState({ x: 0, y: 0 });
  const isDraggingMainUmap = useRef(false);
  const lastMousePosMainUmap = useRef({ x: 0, y: 0 });
  const mainUmapSvgRef = useRef<SVGSVGElement>(null);

  // Register native non-passive wheel listener for main UMAP zoom
  useEffect(() => {
    const svg = mainUmapSvgRef.current;
    if (!svg) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      
      setMainUmapZoom(z => {
        const newZoom = Math.max(0.5, Math.min(10, z * zoomFactor));
        // Compute new pan to zoom strictly towards the mouse cursor
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        setMainUmapPan(p => ({
          x: mouseX - (mouseX - p.x) * (newZoom / z),
          y: mouseY - (mouseY - p.y) * (newZoom / z)
        }));
        
        return newZoom;
      });
    };
    
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  // --- PATHSOM STATE ---
  // State is now managed globally in useSomStore() to persist across tabs.

  // Determine if the current dataset has trajectories (temporal data)
  const hasTrajectories = useMemo(() => {
    return labels.some(label => parseTrajectoryEntity(label).isTemporal);
  }, [labels]);

  // Derive trajectories from labels
  const availableTrajectories = useMemo(() => {
    if (!result || !result.bmus) return [];
    
    const entities = new Map<string, { index: number; dataIndex: number }[]>();
    
    labels.forEach((label, i) => {
      if (!label) return;
      const { entity } = parseTrajectoryEntity(label);
      if (!entities.has(entity)) {
        entities.set(entity, []);
      }
      entities.get(entity)!.push({ index: result.bmus[i], dataIndex: i });
    });

    const trajs: Trajectory[] = [];
    let colorIdx = 0;
    const defaultColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

    entities.forEach((points, name) => {
      // Sort points by original order in the dataset
      points.sort((a, b) => a.dataIndex - b.dataIndex);
      
      trajs.push({
        name,
        points,
        color: entityColorOverrides[name] || defaultColors[colorIdx % defaultColors.length],
        width: trajectoryLineWidth
      });
      colorIdx++;
    });

    return trajs.sort((a, b) => a.name.localeCompare(b.name));
  }, [labels, result, entityColorOverrides, trajectoryLineWidth]);

  // --- END PATHSOM STATE ---

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  const handleRecluster = async () => {
    if (!result || !result.weights) return;
    try {
      const apiUrl = getApiUrl('/api/som/recluster');
      
      const payload = {
        weights: result.weights,
        algorithm: config.clusteringAlgorithm,
        n_clusters: config.nClusters,
        eps: config.eps,
        min_samples: config.minSamples
      };
      
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      if (json.success && json.clustering) {
        reclusterLocally(json.clustering);
        setSubTab('maps');
      } else {
        const errMsg = json.error || json.title || json.detail || JSON.stringify(json);
        alert(typeof errMsg === 'string' ? errMsg : "Failed to re-cluster");
      }
    } catch (e: any) {
      alert("Network error: " + e.message);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      readFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        useSomStore.getState().loadCsvData(text, labelIndex, []);
        setSubTab('import'); // Keep on import to see boxplots
      }
    };
    reader.readAsText(file);
  };

  // Legacy Popup SVG cloner stand-alone window for MallaHexagonal
  const openMapPopup = (id: string, mapTitle: string) => {
    const container = document.getElementById(id);
    const svgEl = container?.querySelector('svg.map-hexagonal-svg');
    if (!svgEl) {
      alert("SVG map element not found. Please ensure the map is loaded.");
      return;
    }

    // Deep clone the SVG node
    const clonedSvg = svgEl.cloneNode(true) as SVGElement;
    
    // Scale up the clone for presentation in the standalone window
    clonedSvg.setAttribute('width', '100%');
    clonedSvg.setAttribute('height', '90%');

    // Create popup window
    const popup = window.open("", "_blank", "width=850,height=750,resizable=yes,scrollbars=yes");
    if (!popup) {
      alert("Popup blocker active. Please allow popups for Sinapsis Map to open stand-alone charts.");
      return;
    }

    popup.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sinapsis Map - Standalone Chart</title>
          <style>
            body {
              background-color: #050508;
              color: #cbd5e1;
              font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
              margin: 0;
              padding: 24px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              overflow: hidden;
              box-sizing: border-box;
            }
            .header-bar {
              width: 100%;
              max-width: 800px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 1px solid #1e293b;
              padding-bottom: 12px;
              margin-bottom: 20px;
            }
            .title {
              font-size: 16px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #ffffff;
            }
            .subtitle {
              font-size: 11px;
              color: #00F0FF;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.1em;
            }
            .chart-container {
              flex: 1;
              width: 100%;
              max-width: 800px;
              display: flex;
              align-items: center;
              justify-content: center;
              background-color: #0e121a;
              border: 1px solid #181f2b;
              border-radius: 16px;
              padding: 20px;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
              overflow: hidden;
            }
            svg {
              max-width: 100%;
              max-height: 100%;
              filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
            }
            polygon {
              transition: opacity 0.15s ease;
            }
            polygon:hover {
              opacity: 1 !important;
              stroke: #ffffff !important;
              stroke-width: 1.5px !important;
            }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <span class="title">${mapTitle}</span>
            <span class="subtitle">Sinapsis Map Premium Export</span>
          </div>
          <div class="chart-container">
            ${clonedSvg.outerHTML}
          </div>
        </body>
      </html>
    `);
    popup.document.close();
  };

  // Popup: open the main UMAP 2D scatter (SVG clone)
  const openUmapScatterPopup = () => {
    const svgEl = mainUmapSvgRef.current;
    if (!svgEl) return;
    const popup = window.open('', '_blank', 'width=1100,height=750,resizable=yes,scrollbars=yes');
    if (!popup) { alert('Popup blocker active. Please allow popups.'); return; }
    const cloned = svgEl.cloneNode(true) as SVGElement;
    // Set viewBox so the SVG fills the entire popup window
    const vb = `0 0 ${svgEl.getAttribute('width') || 700} ${svgEl.getAttribute('height') || 450}`;
    cloned.setAttribute('viewBox', vb);
    cloned.setAttribute('width', '100%');
    cloned.setAttribute('height', '100%');
    cloned.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    popup.document.write(`
      <!DOCTYPE html><html>
        <head><title>UMAP Dimensional Projection — Sinapsis Map</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #050508; display: flex; flex-direction: column;
                 height: 100vh; overflow: hidden;
                 font-family: ui-sans-serif, system-ui, sans-serif; color: #cbd5e1; }
          .header { display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 20px; border-bottom: 1px solid #1e293b; flex-shrink: 0; }
          .title { font-size: 14px; font-weight: 900; text-transform: uppercase;
                   letter-spacing: .08em; color: #fff; }
          .sub { font-size: 10px; color: #00F0FF; font-weight: 700;
                 text-transform: uppercase; letter-spacing: .12em; }
          .chart { flex: 1; background: #0e121a; overflow: hidden;
                   margin: 12px; border-radius: 12px;
                   box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
                   display: flex; align-items: stretch; justify-content: stretch; }
          .chart svg { width: 100% !important; height: 100% !important; display: block; }
          circle { cursor: default !important; }
        </style></head>
        <body>
          <div class="header">
            <span class="title">UMAP Dimensional Projection (2D)</span>
            <span class="sub">Sinapsis Map — Premium Export</span>
          </div>
          <div class="chart">${cloned.outerHTML}</div>
        </body>
      </html>`);
    popup.document.close();
  };

  // Popup: render a UMAP heatmap at high resolution.
  // Accepts active trajectories so they are drawn over the canvas.
  const openUmapHeatmapPopup = (
    name: string,
    points: {x:number,y:number,value:number,label?:string,dataIndex?:number}[],
    activeTrajs: typeof availableTrajectories
  ) => {
    const HI = 600;
    const W = 1200, H = 960;
    const sigma = 0.08;

    const validPts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value));
    if (validPts.length === 0) { alert('No valid points to render.'); return; }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of validPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.value < minV) minV = p.value; if (p.value > maxV) maxV = p.value;
    }
    const padX = (maxX - minX || 1) * 0.1, padY = (maxY - minY || 1) * 0.1;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const srX = maxX - minX, srY = maxY - minY;
    if (minV >= maxV) maxV = minV + 1;

    const sorted = validPts.map(p => p.value).sort((a, b) => a - b);
    const clipMin = sorted[Math.floor(sorted.length * 0.02)] ?? minV;
    const clipMax = sorted[Math.floor(sorted.length * 0.98)] ?? maxV;
    const cdMin = clipMin < clipMax ? clipMin : minV;
    const cdMax = clipMin < clipMax ? clipMax : maxV;
    const scaleColors = ['#38a169', '#ecc94b', '#e53e3e'];
    const scaleFn = chroma.scale(scaleColors).domain([cdMin, cdMax]);

    const gridPts = validPts.map(p => ({
      gx: ((p.x - minX) / srX) * HI,
      gy: ((p.y - minY) / srY) * HI,
      v: p.value
    }));
    const s = Math.max(sigma, 0.01) * HI;
    const s2 = s * s;
    const radius = Math.ceil(3 * s);

    const densityMap   = new Float32Array(HI * HI);
    const valueMap     = new Float32Array(HI * HI);
    const weightSumMap = new Float32Array(HI * HI);

    for (const p of gridPts) {
      const cx = Math.round(p.gx), cy = Math.round(p.gy);
      const x0 = Math.max(0, cx - radius), x1 = Math.min(HI - 1, cx + radius);
      const y0 = Math.max(0, cy - radius), y1 = Math.min(HI - 1, cy + radius);
      for (let py = y0; py <= y1; py++) {
        const ddy = p.gy - py;
        for (let px = x0; px <= x1; px++) {
          const ddx = p.gx - px;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > 9 * s2) continue;
          const w = Math.exp(-d2 / (2 * s2));
          const idx = py * HI + px;
          densityMap[idx] += w; weightSumMap[idx] += w; valueMap[idx] += w * p.v;
        }
      }
    }
    let maxDensity = 0;
    for (let i = 0; i < HI * HI; i++) {
      if (weightSumMap[i] > 0) valueMap[i] /= weightSumMap[i];
      if (densityMap[i] > maxDensity) maxDensity = densityMap[i];
    }
    const alphaNorm = maxDensity > 0 ? maxDensity * 0.08 : 1;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = HI; offCanvas.height = HI;
    const offCtx = offCanvas.getContext('2d')!;
    const imgData = offCtx.createImageData(HI, HI);
    const data = imgData.data;
    for (let i = 0; i < HI * HI; i++) {
      const pIdx = i * 4;
      const d = densityMap[i];
      if (d > 0.001) {
        const c = scaleFn(valueMap[i]).rgba();
        const alpha = Math.min(1, d / alphaNorm);
        data[pIdx] = Math.round(c[0]); data[pIdx+1] = Math.round(c[1]);
        data[pIdx+2] = Math.round(c[2]); data[pIdx+3] = Math.round(255 * alpha);
      } else { data[pIdx+3] = 0; }
    }
    offCtx.putImageData(imgData, 0, 0);

    // Upscale to display canvas
    const displayCanvas = document.createElement('canvas');
    displayCanvas.width = W; displayCanvas.height = H;
    const dCtx = displayCanvas.getContext('2d')!;
    dCtx.fillStyle = '#050508';
    dCtx.fillRect(0, 0, W, H);
    dCtx.imageSmoothingEnabled = true;
    dCtx.imageSmoothingQuality = 'high';
    dCtx.drawImage(offCanvas, 0, 0, W, H);

    // Build a dataIndex -> canvas coords map for trajectories
    const coordMap = new Map<number, {cx: number, cy: number}>();
    for (const p of validPts) {
      if (p.dataIndex !== undefined) {
        coordMap.set(p.dataIndex, {
          cx: ((p.x - minX) / srX) * W,
          cy: ((p.y - minY) / srY) * H
        });
      }
    }

    // Draw colored dots
    for (const p of validPts) {
      const cx = ((p.x - minX) / srX) * W;
      const cy = ((p.y - minY) / srY) * H;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      dCtx.beginPath();
      dCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      dCtx.fillStyle = scaleFn(p.value).hex();
      dCtx.fill();
      dCtx.lineWidth = 0.5;
      dCtx.strokeStyle = 'rgba(0,0,0,0.6)';
      dCtx.stroke();
    }

    // Draw labels if showLabelsOnComponents is true
    if (showLabelsOnComponents) {
      dCtx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
      dCtx.textAlign = 'center';
      for (const p of validPts) {
        if (!p.label) continue;
        const cx = ((p.x - minX) / srX) * W;
        const cy = ((p.y - minY) / srY) * H;
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        dCtx.strokeStyle = '#050508';
        dCtx.lineWidth = 3;
        dCtx.strokeText(p.label, cx, cy - 6);
        dCtx.fillStyle = '#e2e8f0';
        dCtx.fillText(p.label, cx, cy - 6);
      }
    }

    // Draw active trajectories
    for (const traj of activeTrajs) {
      const pts = traj.points
        .map(p => coordMap.get(p.dataIndex))
        .filter(Boolean) as {cx: number, cy: number}[];
      if (pts.length < 2) continue;

      const curveGen = line<{cx: number, cy: number}>()
        .x(d => d.cx)
        .y(d => d.cy)
        .curve(curveCatmullRom.alpha(0.5))
        .context(dCtx);

      // Shadow
      dCtx.beginPath();
      curveGen(pts);
      dCtx.strokeStyle = 'rgba(0,0,0,0.55)';
      dCtx.lineWidth = (traj.width || 2) + 3;
      dCtx.lineJoin = 'round';
      dCtx.lineCap = 'round';
      dCtx.stroke();

      // Main line
      dCtx.beginPath();
      curveGen(pts);
      dCtx.strokeStyle = traj.color;
      dCtx.lineWidth = traj.width || 2;
      dCtx.stroke();

      // Nodes
      for (const pt of pts) {
        dCtx.beginPath();
        dCtx.arc(pt.cx, pt.cy, (traj.width || 2) + 2, 0, Math.PI * 2);
        dCtx.fillStyle = traj.color;
        dCtx.fill();
        dCtx.beginPath();
        dCtx.arc(pt.cx, pt.cy, 2, 0, Math.PI * 2);
        dCtx.fillStyle = '#fff';
        dCtx.fill();
      }
    }

    const dataUrl = displayCanvas.toDataURL('image/png');

    const popup = window.open('', '_blank', 'width=1280,height=1060,resizable=yes,scrollbars=no');
    if (!popup) { alert('Popup blocker active. Please allow popups.'); return; }
    popup.document.write(`
      <!DOCTYPE html><html>
        <head><title>${name} — UMAP Heatmap — Sinapsis Map</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #050508; display: flex; flex-direction: column;
                 height: 100vh; overflow: hidden;
                 font-family: ui-sans-serif, system-ui, sans-serif; color: #cbd5e1; }
          .header { width: 100%; display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 24px; border-bottom: 1px solid #1e293b; flex-shrink: 0; }
          .title { font-size: 14px; font-weight: 900; text-transform: uppercase;
                   letter-spacing: .08em; color: #fff; }
          .sub { font-size: 10px; color: #00F0FF; font-weight: 700;
                 text-transform: uppercase; letter-spacing: .12em; }
          .chart { flex: 1; background: #0e121a;
                   box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
                   display: flex; align-items: stretch; justify-content: stretch; }
          img { width: 100%; height: 100%; object-fit: contain; display: block; }
        </style></head>
        <body>
          <div class="header">
            <span class="title">${name}</span>
            <span class="sub">UMAP Variable Heatmap — Sinapsis Map</span>
          </div>
          <div class="chart"><img src="${dataUrl}" /></div>
        </body>
      </html>`);
    popup.document.close();
  };
  const exportClusteredData = () => {
    if (!result || !originalDataMatrix) {
      alert("No trained SOM or dataset available.");
      return;
    }
    
    // Create CSV header
    const csvRows = [];
    const headers = ['Label', ...compNames.map(name => `"${name}"`), 'Cluster_ID'];
    csvRows.push(headers.join(','));
    
    // Append rows
    for (let i = 0; i < originalDataMatrix.length; i++) {
      const bmu = result.bmus[i];
      const clusterId = result.clustering[bmu];
      const row = [
        `"${labels[i]}"`,
        ...originalDataMatrix[i],
        clusterId
      ];
      csvRows.push(row.join(','));
    }
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName ? fileName.replace('.csv', '') : 'dataset'}_clustered.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render UMAP Projections
  const renderUmapScatter = () => {
    if (!result || !result.umap) {
      return (
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-800 rounded-2xl h-96 text-gray-500 bg-gray-900 bg-opacity-40">
          <Database className="w-12 h-12 mb-4 text-gray-600 animate-pulse" />
          <p className="text-lg font-medium text-gray-200">No projections available</p>
          <p className="text-sm mt-1 max-w-sm text-center">Enable UMAP projection checkbox in the Training tab and trigger training to visualize.</p>
        </div>
      );
    }
    
    const umap = result.umap;
    const cl = result.clustering;
    
    // Find limits for scaling
    const xs = umap.map(p => p[0]);
    const ys = umap.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const margin = 40;
    const plotW = 700;
    const plotH = 450;

    const scaleX = (val: number) => margin + ((val - minX) / (maxX - minX || 1)) * (plotW - 2 * margin);
    const scaleY = (val: number) => margin + ((val - minY) / (maxY - minY || 1)) * (plotH - 2 * margin);

    return (
      <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl flex flex-col items-center shadow-xl max-w-4xl mx-auto">
        <div className="w-full flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
          <div>
            <h4 className="font-bold text-gray-200 flex items-center space-x-2 text-sm uppercase tracking-wide">
              <Activity className="w-4 h-4 text-indigo-400" />
              <span>UMAP Dimensional Projection (2D)</span>
            </h4>
            <p className="text-[10px] text-gray-500 mt-0.5">Solver Core: {result.umapSource}</p>
          </div>
          
          {/* Main UMAP Toolbar */}
          <div className="flex items-center space-x-3">
            <label className="flex items-center space-x-1.5 text-[10px] text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showLabelsOnUmapScatter}
                onChange={e => setShowLabelsOnUmapScatter(e.target.checked)}
                className="w-3.5 h-3.5 bg-gray-950 border-gray-700 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer"
              />
              <span className="font-bold text-indigo-400 uppercase tracking-wider">Labels</span>
            </label>

            {(mainUmapZoom !== 1 || mainUmapPan.x !== 0 || mainUmapPan.y !== 0) && (
              <button
                onClick={() => { setMainUmapZoom(1); setMainUmapPan({x: 0, y: 0}); }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded-lg transition"
              >
                Reset View
              </button>
            )}

            <button
              onClick={openUmapScatterPopup}
              className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-indigo-500 text-gray-400 hover:text-white rounded-lg transition cursor-pointer"
              title="Open in standalone window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        <div className="relative border border-gray-850 rounded-xl overflow-hidden bg-gray-950 p-4" style={{ touchAction: 'none' }}>
          <svg 
            ref={mainUmapSvgRef}
            width={plotW} 
            height={plotH} 
            className="select-none cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              isDraggingMainUmap.current = true;
              lastMousePosMainUmap.current = { x: e.clientX, y: e.clientY };
            }}
            onMouseMove={(e) => {
              if (!isDraggingMainUmap.current) return;
              const dx = e.clientX - lastMousePosMainUmap.current.x;
              const dy = e.clientY - lastMousePosMainUmap.current.y;
              setMainUmapPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
              lastMousePosMainUmap.current = { x: e.clientX, y: e.clientY };
            }}
            onMouseUp={() => isDraggingMainUmap.current = false}
            onMouseLeave={() => isDraggingMainUmap.current = false}
          >
            {/* Transform Group */}
            <g transform={`translate(${mainUmapPan.x}, ${mainUmapPan.y}) scale(${mainUmapZoom})`}>
              {/* Draw dots */}
            {umap.map((point, idx) => {
              const x = scaleX(point[0]);
              const y = scaleY(point[1]);
              const clusterId = cl[result.bmus[idx]];
              const hue = (clusterId * 137.5) % 360;
              const clr = chroma(`hsl(${hue}, 75%, 60%)`).hex();
              
              const isHovered = hoveredUmapDot === idx;

              return (
                <g key={idx}>
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 10 : 5.5}
                    fill={clr}
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 0.8}
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredUmapDot(idx)}
                    onMouseLeave={() => setHoveredUmapDot(null)}
                  />
                  {showLabelsOnUmapScatter && (
                    <text
                      x={x}
                      y={y - 8}
                      textAnchor="middle"
                      fontSize={10 / mainUmapZoom}
                      fill="#e2e8f0"
                      stroke="#050508"
                      strokeWidth={3 / mainUmapZoom}
                      paintOrder="stroke"
                      className="pointer-events-none select-none"
                      style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 700 }}
                    >
                      {labels[idx]}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Draw Trajectories */}
            {hasTrajectories && availableTrajectories
              .filter((t: any) => activeTrajectories.has(t.name))
              .map((traj, idx) => {
                const tPoints = traj.points
                  .map(p => {
                    const u = umap[p.dataIndex];
                    if (!u) return null;
                    return { x: scaleX(u[0]), y: scaleY(u[1]) };
                  })
                  .filter(Boolean) as {x: number, y: number}[];
                  
                if (tPoints.length < 2) return null;
                
                const curveGen = line<{x: number, y: number}>()
                  .x(d => d.x)
                  .y(d => d.y)
                  .curve(curveCatmullRom.alpha(0.5));
                  
                const d = curveGen(tPoints) || '';
                
                return (
                  <g key={`main-umap-traj-${idx}`}>
                    {/* Shadow (fast double-stroke) */}
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(0,0,0,0.5)"
                      strokeWidth={(traj.width || 2) + 2}
                    />
                    {/* Curve */}
                    <path
                      d={d}
                      fill="none"
                      stroke={traj.color}
                      strokeWidth={traj.width || 2}
                    />
                    {/* Nodes */}
                    {tPoints.map((pt, pIdx) => (
                      <g key={`main-umap-traj-${idx}-pt-${pIdx}`}>
                        <circle cx={pt.x} cy={pt.y} r={(traj.width || 2) + 1} fill={traj.color} />
                        <circle cx={pt.x} cy={pt.y} r={1.5} fill="#fff" />
                      </g>
                    ))}
                  </g>
                );
            })}
            </g>
          </svg>

          {/* Scatter Tooltip */}
          {hoveredUmapDot !== null && (() => {
            const baseMatrix = originalDataMatrix || dataMatrix;
            const rowData = baseMatrix[hoveredUmapDot] || [];
            const displayFeatures = compNames.slice(0, 6);
            return (
              <div className="absolute top-4 right-4 bg-gray-950 bg-opacity-95 p-4 rounded-xl border border-indigo-500 text-xs text-gray-200 shadow-xl max-w-[260px] z-10">
                <p className="font-black text-indigo-400 truncate mb-2" title={labels[hoveredUmapDot]}>{labels[hoveredUmapDot]}</p>
                <div className="space-y-1 text-[10px]">
                  {displayFeatures.map((name, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="text-gray-500 font-bold truncate flex-1" title={name}>{name}:</span>
                      <span className="text-gray-200 font-mono flex-shrink-0">{typeof rowData[i] === 'number' ? rowData[i].toFixed(3) : '–'}</span>
                    </div>
                  ))}
                  {compNames.length > 6 && (
                    <p className="text-gray-600 italic pt-1">+{compNames.length - 6} more features…</p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  const renderDataPreview = (matrix: number[][], currentLabels: string[], currentCompNames: string[], title: string) => {
    if (matrix.length === 0) return null;
    const previewRows = Math.min(5, matrix.length);
    const previewCols = Math.min(10, currentCompNames.length);
    
    return (
      <div className="mt-4 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-inner w-full">
        <div className="bg-gray-900 border-b border-gray-800 px-3 py-1.5 flex justify-between items-center">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{title}</span>
          <span className="text-[10px] text-gray-600 italic">Showing {previewRows} of {matrix.length} rows</span>
        </div>
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-gray-950/50">
                <th className="p-2 text-[10px] font-bold text-gray-500 border-b border-r border-gray-800 sticky left-0 bg-gray-900 z-10">Label</th>
                {currentCompNames.slice(0, previewCols).map((c, i) => (
                  <th key={i} className="p-2 text-[10px] font-bold text-gray-500 border-b border-gray-800" title={c}>{c.length > 12 ? c.substring(0, 12) + '...' : c}</th>
                ))}
                {currentCompNames.length > previewCols && (
                  <th className="p-2 text-[10px] italic text-gray-600 border-b border-gray-800">+{currentCompNames.length - previewCols} more...</th>
                )}
              </tr>
            </thead>
            <tbody>
              {matrix.slice(0, previewRows).map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-gray-800 transition-colors">
                  <td className="p-2 text-[10px] text-indigo-300 font-bold border-r border-gray-800 sticky left-0 bg-gray-950 z-10 truncate max-w-[120px]" title={currentLabels[rIdx]}>{currentLabels[rIdx]}</td>
                  {row.slice(0, previewCols).map((val, cIdx) => (
                    <td key={cIdx} className="p-2 text-[10px] text-gray-400 font-mono">{typeof val === 'number' ? val.toFixed(3) : val}</td>
                  ))}
                  {currentCompNames.length > previewCols && <td className="p-2 text-[10px] text-gray-600">...</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col h-full space-y-6">
      {/* Horizontal Tabs Header Bar */}
      <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
        <button
          onClick={() => setSubTab('import')}
          className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'import'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
        >
          1. Import & Exploration
        </button>
        <button
          onClick={() => setSubTab('training')}
          className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'training'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
        >
          2. SOM Training
        </button>
        <button
          onClick={() => setSubTab('maps')}
          className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'maps'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
        >
          3. SOM Maps
        </button>
        <button
          onClick={() => setSubTab('umap')}
          className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            subTab === 'umap'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
        >
          4. UMAP Projections
        </button>
      </div>

      {/* RENDER ACTIVE SUBTAB CONTENT */}
      <div className="flex-1">
        
        {/* SUBTAB 1: DATA IMPORT & EXPLORATION */}
        {subTab === 'import' && (
          <div className="space-y-6">
            {/* Header Control Card: Compact Import Controls */}
            <div 
              onDragOver={e => e.preventDefault()}
              onDrop={handleFileDrop}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4"
            >
              <div className="flex items-center space-x-4">
                {/* Compact upload action button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-2"
                >
                  <Upload className="w-4 h-4" />
                  <span>Import CSV Data</span>
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".csv"
                  className="hidden"
                />

                <div className="flex items-center space-x-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Label Col Index:</label>
                  <input
                    type="number"
                    value={labelIndex}
                    onChange={(e) => setLabelIndex(parseInt(e.target.value) || 0)}
                    className="w-16 bg-gray-950 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {dataMatrix.length > 0 ? (
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex items-center space-x-4 bg-gray-950 px-4 py-2 rounded-xl border border-gray-850 text-xs text-gray-400 self-start">
                    {fileName && (
                      <>
                        <span className="text-indigo-300 font-bold max-w-[200px] truncate" title={fileName}>
                          {fileName}
                        </span>
                        <span className="text-gray-700">|</span>
                      </>
                    )}
                    <span className="flex items-center"><Database className="w-3.5 h-3.5 mr-1.5 text-indigo-400" /> Matrix: <strong className="text-gray-200 ml-1">{dataMatrix.length} rows</strong></span>
                    <span className="text-gray-700">|</span>
                    <span className="flex items-center"><Sliders className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> Features: <strong className="text-gray-200 ml-1">{compNames.length}</strong></span>
                  </div>
                  {originalDataMatrix && renderDataPreview(originalDataMatrix, labels, compNames, "Raw Dataset Preview")}
                </div>
              ) : (
                <span className="text-xs text-gray-500">No CSV file loaded currently. Please select a local CSV source.</span>
              )}
            </div>

            {/* Preprocessing Pipeline Container */}
            <div className="flex flex-col space-y-4">
              
              {/* Normalization Toolbar (Step 1) */}
              {dataMatrix.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col space-y-4 relative">
                  {hasTrajectories && (
                    <div className="absolute -left-3 -top-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg uppercase">
                      Step 1
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-200 flex items-center space-x-2">
                      <Sliders className="w-4 h-4 text-indigo-400" />
                      <span>Data Normalization & Scaling</span>
                    </h3>
                    
                    {normalizationInfo && (
                      <div className="flex items-center space-x-3">
                        <span className="text-xs text-emerald-400 font-bold bg-emerald-900 bg-opacity-20 px-2 py-1 rounded">
                          Active: {normalizationInfo.type}
                        </span>
                        <button
                          onClick={revertNormalization}
                          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded-lg transition"
                        >
                          Revert to Original
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-4 border-t border-gray-800 pt-4">
                    {matrixOrigin === 'csv' && (
                      <div className="flex-1 space-y-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Performance Profiles</label>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => applyNormalization('div_max')}
                            className="flex-1 px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Division by Max
                          </button>
                          <button
                            onClick={() => applyNormalization('min_max')}
                            className="flex-1 px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Min-Max Scaling
                          </button>
                          <button
                            onClick={() => applyNormalization('z_score')}
                            className="flex-1 px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Z-Score (Standardize)
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {matrixOrigin === 'monothematic' && (
                      <div className="flex-1 space-y-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Symmetric Cooccurrence</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <button
                            onClick={() => applyNormalization('cooc_cosine')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Cosine
                          </button>
                          <button
                            onClick={() => applyNormalization('cooc_association')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Association Str.
                          </button>
                          <button
                            onClick={() => applyNormalization('cooc_jaccard')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Jaccard Index
                          </button>
                          <button
                            onClick={() => applyNormalization('cooc_inclusion')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Inclusion Index
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {matrixOrigin === 'bipartite' && (
                      <div className="flex-1 space-y-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Bipartite Network Normalization</label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <button
                            onClick={() => applyNormalization('bipartite_row')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Row Normalization
                          </button>
                          <button
                            onClick={() => applyNormalization('bipartite_col')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Column Normalization
                          </button>
                          <button
                            onClick={() => applyNormalization('bipartite_sym')}
                            className="px-3 py-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-300 text-xs font-semibold rounded-xl transition"
                          >
                            Symmetric Normalization
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {renderDataPreview(dataMatrix, labels, compNames, "Normalized Data Preview")}
                </div>
              )}

              {/* Visual Flow Indicator for Time-Series */}
              {dataMatrix.length > 0 && hasTrajectories && (
                <div className="flex justify-center -my-2 relative z-10">
                  <div className="bg-gray-950 border border-gray-800 p-1.5 rounded-full text-indigo-500 shadow-lg">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Time-Series Preprocessing (Step 2) */}
              {dataMatrix.length > 0 && hasTrajectories && (
                <div className="bg-gray-900 border border-indigo-500/30 rounded-2xl p-5 shadow-lg flex flex-col space-y-4 relative">
                  <div className="absolute -left-3 -top-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg uppercase">
                    Step 2
                  </div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-indigo-300 flex items-center space-x-2">
                      <TrendingUp className="w-4 h-4" />
                      <span>Time-Series Preprocessing (PathSOM)</span>
                    </h3>
                    
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center cursor-pointer">
                        <div className="relative">
                          <input 
                            type="checkbox" 
                            className="sr-only" 
                            checked={isCmaSmoothingActive}
                            onChange={(e) => setIsCmaSmoothingActive(e.target.checked)}
                          />
                          <div className={`block w-10 h-6 rounded-full transition-colors ${isCmaSmoothingActive ? 'bg-indigo-600' : 'bg-gray-800'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isCmaSmoothingActive ? 'transform translate-x-4' : ''}`}></div>
                        </div>
                        <span className="ml-3 text-xs font-bold text-gray-300 uppercase">Apply CMA Smoothing</span>
                      </label>
                    </div>
                  </div>

                  {isCmaSmoothingActive && (
                    <div className="flex items-center gap-4 border-t border-gray-800 pt-4">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                          Window Size (Odd numbers): {cmaWindowSize}
                        </label>
                        <input 
                          type="range" 
                          min="3" 
                          max="15" 
                          step="2" 
                          value={cmaWindowSize}
                          onChange={(e) => setCmaWindowSize(parseInt(e.target.value))}
                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                      <div className="text-xs text-gray-500 italic max-w-xs leading-tight">
                        Applies a Centered Moving Average to each entity's feature sequence to smooth temporal noise before training.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Exploratory Boxplots Grid */}
            {dataMatrix.length > 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl space-y-4">
                <div>
                  <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2">
                    <Activity className="w-5 h-5 text-indigo-400" />
                    <span>Exploratory Variable Boxplots (First 9 Features)</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Inspecting data metrics, distribution ranges, and midpoints before training.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {compNames.slice(0, 9).map((name, idx) => {
                    const featureVals = dataMatrix.map(row => row[idx]).filter(v => typeof v === 'number' && !isNaN(v));
                    return (
                      <BoxPlot 
                        key={idx}
                        name={name}
                        values={featureVals}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 shadow-2xl flex flex-col items-center justify-center text-gray-400 text-center">
                <Database className="w-12 h-12 mb-4 text-gray-700 animate-bounce" />
                <p className="text-lg font-medium text-gray-200">No CSV dataset loaded</p>
                <p className="text-sm mt-1 max-w-sm">Use the "Import CSV Data" button above, or preprocess files from PubMed/WoS in the Bibliometrics tab to begin.</p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: TRAINING AND HYBRID SOLVER STATUS */}
        {subTab === 'training' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {/* Form configuration card */}
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl space-y-6">
              <div>
                <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2">
                  <Settings className="w-5 h-5 text-indigo-400" />
                  <span>SOM Grid & Algorithm Hyperparameters</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">Configure clustering grid dimension, iterations, and active fallbacks.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 font-semibold mb-1.5">Grid Rows</label>
                      <input
                        type="number"
                        value={config.rows}
                        onChange={(e) => setConfig({ rows: parseInt(e.target.value) || 5 })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 font-semibold mb-1.5">Grid Columns</label>
                      <input
                        type="number"
                        value={config.cols}
                        onChange={(e) => setConfig({ cols: parseInt(e.target.value) || 5 })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Training Epochs / Iterations</label>
                    <input
                      type="number"
                      value={config.iterations}
                      onChange={(e) => setConfig({ iterations: parseInt(e.target.value) || 10 })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-gray-400 font-semibold mb-1.5">Clustering Algorithm</label>
                      <select
                        value={config.clusteringAlgorithm || 'dbscan'}
                        onChange={(e) => setConfig({ clusteringAlgorithm: e.target.value as any })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="dbscan">DBSCAN (Density-Based)</option>
                        <option value="agglomerative">Agglomerative (Ward)</option>
                      </select>
                    </div>

                    {config.clusteringAlgorithm === 'agglomerative' ? (
                      <div>
                        <label className="block text-xs text-gray-400 font-semibold mb-1.5">Target Clusters (K)</label>
                        <input
                          type="number"
                          value={config.nClusters}
                          onChange={(e) => setConfig({ nClusters: parseInt(e.target.value) || 2 })}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ) : (
                      <div className="flex space-x-2">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-400 font-semibold mb-1.5">Epsilon (eps)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={config.eps || 1.5}
                            onChange={(e) => setConfig({ eps: parseFloat(e.target.value) || 1.5 })}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-400 font-semibold mb-1.5">Min Samples</label>
                          <input
                            type="number"
                            value={config.minSamples || 2}
                            onChange={(e) => setConfig({ minSamples: parseInt(e.target.value) || 2 })}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Solver Algorithm</label>
                    <select
                      value={config.method}
                      onChange={(e) => setConfig({ method: e.target.value as any })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="batch">Batch SOM (Standard Batch Updates)</option>
                      <option value="basic">Basic SOM (Stochastic Iterative)</option>
                    </select>
                    {config.method === 'basic' ? (
                      <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
                        <strong className="text-gray-400">Basic SOM</strong> trains sequentially one sample at a time. The <strong>learning rate</strong> decreases <span className="text-indigo-400">linearly</span> over time, while the <strong>neighborhood function (sigma)</strong> shrinks <span className="text-emerald-400">exponentially</span> to converge the map.
                      </p>
                    ) : (
                      <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
                        <strong className="text-gray-400">Batch SOM</strong> processes all samples simultaneously per epoch. It is much faster and does not require a learning rate, as weights are updated to the exact weighted average of their neighborhood.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Distance Metric</label>
                    <select
                      value={config.metric}
                      onChange={(e) => setConfig({ metric: e.target.value as any })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="euclidean">Euclidean Distance</option>
                      <option value="manhattan">Manhattan Distance</option>
                      <option value="canberra">Canberra Distance</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Grid Weight Initialization</label>
                    <select
                      value={config.init}
                      onChange={(e) => setConfig({ init: e.target.value as any })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="pca">PCA Spread (Eigenvalue Projection - Recommended)</option>
                      <option value="random">Random Uniform Weights</option>
                      <option value="linear">Linear Spread</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end border-t border-gray-800 pt-5 space-y-4">
                <button
                  onClick={async () => {
                    const success = await trainSOM();
                    if (success) {
                      setSubTab('maps');
                    }
                  }}
                  disabled={isTraining || dataMatrix.length === 0}
                  className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900 shadow-opacity-30 cursor-pointer"
                >
                  {isTraining ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Training SOM...</span>
                    </>
                  ) : (
                    <span>Train SOM Grid</span>
                  )}
                </button>
                {config.clusteringAlgorithm === 'agglomerative' && (
                  <button
                    onClick={() => setShowClusterMetrics(true)}
                    disabled={!result || dataMatrix.length === 0}
                    title="Train the SOM first to calculate clustering metrics"
                    className="px-6 py-3.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50 w-full md:w-auto"
                  >
                    <Activity className="w-4 h-4" />
                    <span>Analyze Optimal Clusters</span>
                  </button>
                )}
                
                <button
                  onClick={handleRecluster}
                  disabled={!result || dataMatrix.length === 0}
                  title="Apply clustering parameters without retraining"
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer disabled:bg-gray-800 disabled:text-gray-600 w-full md:w-auto shadow-md shadow-emerald-900/20"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Apply Fast Re-Clustering</span>
                </button>
              </div>
            </div>

            {/* Hardware accelerator status card */}
            <div className="lg:col-span-1 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
              <div>
                <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2">
                  <HelpCircle className="w-5 h-5 text-indigo-400" />
                  <span>Acceleration Engine</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">Status of system hardware accelerators and fallback levels.</p>
              </div>

              <div className="bg-gray-950 p-4 rounded-xl border border-gray-850 flex-1 space-y-3 text-xs">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block">Active Device</span>
                  <span className="text-gray-200 font-bold text-sm block mt-1">{hardware?.device || "Detecting..."}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block">Hardware Detail</span>
                  <span className="text-gray-400 block mt-1 leading-normal">{hardware?.details || "Detecting details..."}</span>
                </div>
                <div className="border-t border-gray-800 pt-3">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black block">System Fallback Priority</span>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className={`w-3.5 h-3.5 rounded-full ${
                      hardware?.level === 1 ? 'bg-emerald-400 shadow-[0_0_8px_#00F0FF]' : hardware?.level === 2 ? 'bg-amber-400' : 'bg-gray-500'
                    }`} />
                    <span className="font-bold text-gray-300">
                      {hardware?.level === 1 ? 'GPU Native Fallback (Level 1)' : hardware?.level === 2 ? 'Accelerated Fallback (Level 2)' : 'CPU Thread Fallback (Level 3)'}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-gray-500 leading-normal">
                Photino hybrid engine dynamically hooks local system resources to optimize computational neural map iterations.
              </p>
            </div>
          </div>
        )}

        {/* SUBTAB 3: SOM MAPS VIEWPORTS AND 3X3 GRID CLONER */}
        {subTab === 'maps' && (
          <div className="space-y-8">
            {result ? (
              <>
                {/* Section A: Side-by-Side U-Matrix and Clustering Maps */}
                <div className="space-y-4">
                  <h3 className="text-xs uppercase tracking-widest font-black text-gray-400 border-b border-gray-800 pb-2 flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    <span>Neural Mapping Matrix comparison</span>
                  </h3>
                  
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* PathSOM Trajectories Controls (Only if hasTrajectories) */}
                    {hasTrajectories && (
                      <div className="w-full lg:w-64 flex flex-col shrink-0">
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-xl flex-1 flex flex-col overflow-hidden h-[420px]">
                          <h3 className="text-[11px] font-black uppercase text-indigo-400 flex items-center space-x-1.5 mb-4">
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>PathSOM Trajectories</span>
                          </h3>
                          
                          <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            {/* Line Thickness */}
                            <div className="space-y-1">
                              <label className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                <span>Line Thickness</span>
                                <span className="text-indigo-400">{trajectoryLineWidth}px</span>
                              </label>
                              <input 
                                type="range" 
                                min="1" max="10" step="1" 
                                value={trajectoryLineWidth} 
                                onChange={(e) => setTrajectoryLineWidth(parseInt(e.target.value))}
                                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                              />
                            </div>

                            <hr className="border-gray-800" />

                            {/* Trajectories List */}
                            <div>
                              <div className="flex justify-between items-center mb-2">
                                <button 
                                  onClick={() => setIsTrajectoriesExpanded(!isTrajectoriesExpanded)}
                                  className="flex items-center space-x-1 text-[10px] font-bold text-gray-400 hover:text-gray-200 uppercase tracking-wider focus:outline-none"
                                >
                                  {isTrajectoriesExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  <span>Entities ({availableTrajectories.length})</span>
                                </button>
                                
                                {isTrajectoriesExpanded && (
                                  <div className="flex space-x-2">
                                    <button 
                                      onClick={() => setActiveTrajectories(new Set(availableTrajectories.map(t => t.name)))}
                                      className="text-[9px] text-indigo-400 hover:text-indigo-300 uppercase font-bold"
                                    >
                                      All
                                    </button>
                                    <span className="text-gray-700">|</span>
                                    <button 
                                      onClick={() => setActiveTrajectories(new Set())}
                                      className="text-[9px] text-gray-500 hover:text-gray-300 uppercase font-bold"
                                    >
                                      None
                                    </button>
                                  </div>
                                )}
                              </div>

                              {isTrajectoriesExpanded && (
                                <div className="space-y-0.5 mt-2 transition-all duration-300">
                                  {availableTrajectories.map((traj) => {
                                    const isActive = activeTrajectories.has(traj.name);
                                    return (
                                      <div key={traj.name} className="flex items-center space-x-2 py-1 px-1.5 hover:bg-gray-800 rounded transition group">
                                        <input 
                                          type="checkbox"
                                          checked={isActive}
                                          onChange={(e) => {
                                            const newSet = new Set(activeTrajectories);
                                            if (e.target.checked) newSet.add(traj.name);
                                            else newSet.delete(traj.name);
                                            setActiveTrajectories(newSet);
                                          }}
                                          className="w-3 h-3 bg-gray-900 border-gray-700 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                                        />
                                        {/* Color picker swatch */}
                                        <label
                                          title="Change entity color"
                                          className="relative w-4 h-4 rounded-full shrink-0 cursor-pointer shadow-sm overflow-hidden border border-gray-600 hover:border-white transition"
                                          style={{ backgroundColor: traj.color }}
                                        >
                                          <input
                                            type="color"
                                            value={entityColorOverrides[traj.name] || traj.color}
                                            onChange={(e) => {
                                              setEntityColorOverrides({
                                                ...entityColorOverrides,
                                                [traj.name]: e.target.value
                                              });
                                            }}
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                          />
                                        </label>
                                        <span className={`text-[11px] truncate flex-1 ${isActive ? 'text-gray-200' : 'text-gray-600'}`} title={traj.name}>
                                          {traj.name}
                                        </span>
                                        {/* Reset color button */}
                                        {entityColorOverrides[traj.name] && (
                                          <button
                                            onClick={() => {
                                              const next = { ...entityColorOverrides };
                                              delete next[traj.name];
                                              setEntityColorOverrides(next);
                                            }}
                                            className="text-[8px] text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                                            title="Reset to default color"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* U-Matrix Port */}
                      <div id="comp-viewport-umatrix" className="relative border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[420px]">
                        <div className="absolute top-4 right-4 z-20">
                          <button
                            onClick={() => openMapPopup('comp-viewport-umatrix', 'U-Matrix (Distances Map)')}
                            className="p-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-xl transition cursor-pointer"
                            title="Open Standalone View"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="mb-2">
                          <h4 className="text-xs font-black uppercase text-gray-300">U-Matrix (Distances)</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">Visualize topological distances between adjacent nodes.</p>
                        </div>
                        <div className="flex-1 min-h-0">
                          <MallaHexagonal 
                            visualizationMode="umatrix" 
                            initialScale={30} 
                            trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                          />
                        </div>
                      </div>

                      {/* Clustering Port */}
                      <div id="comp-viewport-clustering" className="relative border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[420px]">
                        <div className="absolute top-4 right-4 z-20 flex space-x-2">
                          <button
                            onClick={exportClusteredData}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition cursor-pointer shadow-lg shadow-indigo-900/20 flex items-center space-x-2 text-[10px] font-bold uppercase tracking-wider"
                            title="Export Data with Cluster Column"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Export CSV</span>
                          </button>
                          <button
                            onClick={() => openMapPopup('comp-viewport-clustering', 'Clustering Map')}
                            className="p-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-xl transition cursor-pointer"
                            title="Open Standalone View"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="mb-2 pr-20">
                          <h4 className="text-xs font-black uppercase text-gray-300">
                            {config.clusteringAlgorithm === 'agglomerative' ? 'Agglomerative Clusters' : 'DBSCAN Clusters'}
                          </h4>
                          <p className="text-[10px] text-gray-500 mt-0.5">Partition grid nodes based on similarity centers.</p>
                        </div>
                        <div className="flex-1 min-h-0">
                          <MallaHexagonal 
                            visualizationMode="clustering" 
                            initialScale={30} 
                            trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section B: 3x3 Component Maps Grid with Selector */}
                <div className="space-y-4 pt-4">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gray-800 pb-2">
                    <div className="flex items-center space-x-4 flex-wrap gap-2">
                      <h3 className="text-xs uppercase tracking-widest font-black text-gray-400 flex items-center space-x-2">
                        <Sliders className="w-4 h-4 text-indigo-400" />
                        <span>Individual Variable Component Maps (3x3 Grid)</span>
                      </h3>
                      
                      <span className="text-gray-700">|</span>
                      
                      <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer" title="Enable drawing labels on all component maps globally">
                        <input
                          type="checkbox"
                          checked={showLabelsOnComponents}
                          onChange={(e) => setShowLabelsOnComponents(e.target.checked)}
                          className="w-4 h-4 bg-gray-950 border-gray-850 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                        />
                        <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px]">Draw Labels on Component Maps</span>
                      </label>
                    </div>

                    {/* Swap controls for variable grid pages */}
                    {Math.ceil(compNames.length / 9) > 1 && (
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-gray-500">Variables Page:</span>
                        <button
                          disabled={compPage === 0}
                          onClick={() => setCompPage(p => p - 1)}
                          className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg transition"
                        >
                          Prev
                        </button>
                        <span className="text-gray-300 font-bold px-1">{compPage + 1} / {Math.ceil(compNames.length / 9)}</span>
                        <button
                          disabled={compPage >= Math.ceil(compNames.length / 9) - 1}
                          onClick={() => setCompPage(p => p + 1)}
                          className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg transition"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {compNames.slice(compPage * 9, (compPage + 1) * 9).map((name, index) => {
                      const globalIdx = compPage * 9 + index;
                      const elementId = `comp-grid-cell-${globalIdx}`;
                      
                      return (
                        <div 
                          key={globalIdx} 
                          id={elementId}
                          className="relative border border-gray-800 bg-gray-900 bg-opacity-30 rounded-xl p-4 flex flex-col h-[280px] shadow-md transition-all hover:border-indigo-500"
                        >
                          <div className="absolute top-3 right-3 z-20">
                            <button
                              onClick={() => openMapPopup(elementId, `Component Map: ${name}`)}
                              className="p-1-5 bg-gray-950 border border-gray-850 hover:border-indigo-500 text-gray-400 hover:text-white rounded-lg transition cursor-pointer"
                              title="Open Standalone View"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          <div className="mb-2 pr-8">
                            <span className="text-10 font-black uppercase text-gray-400 block truncate">{name}</span>
                          </div>

                          <div className="flex-1 min-h-0">
                            <MallaHexagonal 
                              visualizationMode="component" 
                              selectedComponentIndex={globalIdx} 
                              initialScale={25}
                              colorScale={somColorScale}
                              onColorScaleChange={setSomColorScale}
                              trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 shadow-2xl flex flex-col items-center justify-center text-gray-400 text-center">
                <TrendingUp className="w-12 h-12 mb-4 text-gray-700 animate-pulse" />
                <p className="text-lg font-medium text-gray-200">The grid has not been trained yet</p>
                <p className="text-sm mt-1 max-w-sm">Configure parameters and execute training under the SOM Training tab to render coordinates.</p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 4: RESPONSIVE UMAP scatterplot */}
        {subTab === 'umap' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-inner">
              <div className="flex-1 max-w-md">
                <label className="block text-xs text-gray-400 font-semibold mb-2">UMAP Data Source</label>
                <select
                  value={config.umapDataSource || 'data'}
                  onChange={(e) => setConfig({ umapDataSource: e.target.value as any })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="data">Original Data Matrix (High Detail)</option>
                  <option value="weights">SOM Neuron Weights (Fast Outline)</option>
                </select>
                <p className="text-[10px] text-gray-500 mt-2">
                  {config.umapDataSource === 'data' 
                    ? "Projects all original documents into 2D space. Best for accurate labels and trajectories."
                    : "Projects only the trained SOM neurons. Faster, but abstracts individual documents."}
                </p>
              </div>

              <div className="flex justify-end pl-6">
                <button
                  onClick={generateUmap}
                  disabled={isGeneratingUmap || !result || !result.weights}
                  className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900 shadow-opacity-30 cursor-pointer"
                >
                  {isGeneratingUmap ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Generating UMAP...</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      <span>Generate UMAP Projections</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {result && result.umap ? (
              <>
                {renderUmapScatter()}
                
                {/* UMAP Component Heatmaps (3x3 Grid) */}
                <div className="space-y-4 pt-4 border-t border-gray-800">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gray-800 pb-2">
                    <div className="flex items-center space-x-4 flex-wrap gap-2">
                      <h3 className="text-xs uppercase tracking-widest font-black text-gray-400 flex items-center space-x-2">
                        <Sliders className="w-4 h-4 text-indigo-400" />
                        <span>UMAP Variable Heatmaps (3x3 Grid)</span>
                      </h3>
                      
                      <span className="text-gray-700">|</span>
                      
                      {/* Zoom controls */}
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">Zoom</span>
                        <button
                          onClick={() => setUmapHeatmapScale(s => Math.max(0.75, parseFloat((s - 0.25).toFixed(2))))}
                          disabled={umapHeatmapScale <= 0.75}
                          className="p-1-5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-lg transition text-xs font-bold"
                          title="Zoom Out"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] text-gray-400 font-mono w-8 text-center">{Math.round(umapHeatmapScale * 100)}%</span>
                        <button
                          onClick={() => setUmapHeatmapScale(s => Math.min(2.5, parseFloat((s + 0.25).toFixed(2))))}
                          disabled={umapHeatmapScale >= 2.5}
                          className="p-1-5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-lg transition text-xs font-bold"
                          title="Zoom In"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      
                      <span className="text-gray-700">|</span>
                      
                      <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showLabelsOnComponents}
                          onChange={(e) => setShowLabelsOnComponents(e.target.checked)}
                          className="w-4 h-4 bg-gray-950 border-gray-850 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
                        />
                        <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px]">Draw Labels on Maps</span>
                      </label>
                      
                      <span className="text-gray-700">|</span>
                      
                      <select 
                        value={umapColorScale}
                        onChange={(e) => setUmapColorScale(e.target.value as any)}
                        className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="standard">Standard (Green-Red)</option>
                        <option value="viridis">Viridis (Colorblind-friendly)</option>
                        <option value="cividis">Cividis (Colorblind-friendly)</option>
                      </select>
                    </div>

                    {/* Swap controls for variable grid pages */}
                    {Math.ceil(compNames.length / 9) > 1 && (
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-gray-500">Variables Page:</span>
                        <button
                          disabled={umapCompPage === 0}
                          onClick={() => setUmapCompPage(p => p - 1)}
                          className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg transition"
                        >
                          Prev
                        </button>
                        <span className="text-gray-300 font-bold px-1">{umapCompPage + 1} / {Math.ceil(compNames.length / 9)}</span>
                        <button
                          disabled={umapCompPage >= Math.ceil(compNames.length / 9) - 1}
                          onClick={() => setUmapCompPage(p => p + 1)}
                          className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg transition"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {compNames.slice(umapCompPage * 9, (umapCompPage + 1) * 9).map((name, index) => {
                      const globalIdx = umapCompPage * 9 + index;
                      const elementId = `umap-comp-grid-cell-${globalIdx}`;
                      
                      // Gather points for this component (already sliced from memoized allUmapPoints)
                      const baseMatrix = originalDataMatrix || dataMatrix;
                      const points = result.umap!
                        .map((coords, i) => {
                          if (config.umapDataSource === 'weights') {
                            // Map over Neurons (result.weights)
                            const val = result.weights[i] ? result.weights[i][globalIdx] : undefined;
                            // Concat all labels for this BMU
                            const bmuLabels = result.mappedLabels && result.mappedLabels[i] ? result.mappedLabels[i].join(', ') : '';
                            return {
                              x: coords[0],
                              y: coords[1],
                              value: val,
                              label: bmuLabels,
                              index: i // specific to trajectory neuron mapping
                            };
                          } else {
                            // Map over Original Data (dataMatrix)
                            const val = baseMatrix[i] ? baseMatrix[i][globalIdx] : undefined;
                            return {
                              x: coords[0],
                              y: coords[1],
                              value: val,
                              label: labels[i],
                              dataIndex: i
                            };
                          }
                        })
                        .filter(p => typeof p.value === 'number' && !isNaN(p.value)) as any[];

                      // Component bounds for colorbar
                      const values = points.map((p: any) => p.value);
                      const compMin = values.length > 0 ? Math.min(...values) : 0;
                      const compMax = values.length > 0 ? Math.max(...values) : 1;
                      const compAvg = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
                      
                      return (
                        <div 
                          key={globalIdx} 
                          id={elementId}
                          className="relative border border-gray-800 bg-gray-900 bg-opacity-30 rounded-xl p-4 flex flex-row shadow-md transition-all hover:border-indigo-500 overflow-hidden"
                          style={{ minHeight: `${Math.round(200 * umapHeatmapScale) + 56}px` }}
                        >
                          {/* Popup button */}
                          <div className="absolute top-2 right-2 z-20">
                            <button
                              onClick={() => openUmapHeatmapPopup(name, points, availableTrajectories.filter(t => activeTrajectories.has(t.name)).map(t => ({...t, width: trajectoryLineWidth})))}
                              className="p-1.5 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-lg transition cursor-pointer"
                              title="Open high-resolution standalone view"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex-1 flex flex-col min-w-0 pr-2">
                            <div className="mb-2 pr-8">
                              <span className="text-[10px] font-black uppercase text-gray-400 block truncate">{name}</span>
                            </div>

                            <div className="flex-1 min-h-0 flex items-center justify-center">
                              <UmapHeatmap
                                points={points}
                                width={Math.round(240 * umapHeatmapScale)}
                                height={Math.round(200 * umapHeatmapScale)}
                                colorScale={umapColorScale}
                                sigma={0.08}
                                resolution={100}
                                showPoints={true}
                                showLabels={showLabelsOnComponents}
                                trajectories={availableTrajectories.filter((t: any) => activeTrajectories.has(t.name)).map(t => ({...t, width: trajectoryLineWidth}))}
                              />
                            </div>
                          </div>
                          
                          {/* Color bar */}
                          <div 
                            className="flex flex-col items-center justify-center px-2 py-2 border-l border-gray-800 bg-gray-900 bg-opacity-40"
                            style={{ flexShrink: 0, width: '55px', maxWidth: '55px' }}
                          >
                            <span className="text-[9px] font-bold text-gray-300 mb-2" title="Maximum Value">{compMax.toFixed(2)}</span>
                            
                            <div 
                              className="relative rounded-full shadow-inner my-1"
                              style={{
                                width: '10px',
                                minWidth: '10px',
                                height: '100px',
                                background: umapColorScale === 'standard' 
                                  ? 'linear-gradient(to bottom, #e53e3e, #ecc94b, #38a169)'
                                  : umapColorScale === 'viridis' 
                                    ? 'linear-gradient(to bottom, #fde725, #5ec962, #21918c, #3b528b, #440154)'
                                    : 'linear-gradient(to bottom, #ffea46, #b9ad71, #7c7b78, #414d6b, #00204d)'
                              }}
                            >
                              {/* Avg indicator */}
                              <div 
                                className="absolute bg-white z-10 rounded-full" 
                                style={{ 
                                  width: '16px', 
                                  height: '2px', 
                                  left: '-3px', 
                                  top: `${Math.max(0, Math.min(100, 100 - ((compAvg - compMin) / (compMax - compMin || 1)) * 100))}%` 
                                }}
                              ></div>
                              <div 
                                className="absolute text-white bg-gray-800 border border-gray-600 rounded shadow-lg whitespace-nowrap"
                                style={{ 
                                  fontSize: '8px',
                                  fontWeight: 900,
                                  padding: '1px 4px',
                                  left: '12px',
                                  top: `${Math.max(0, Math.min(100, 100 - ((compAvg - compMin) / (compMax - compMin || 1)) * 100))}%`,
                                  transform: 'translateY(-50%)'
                                }}
                                title="Average Value"
                              >
                                μ = {compAvg.toFixed(2)}
                              </div>
                            </div>
                            
                            <span className="text-[9px] font-bold text-gray-300 mt-2" title="Minimum Value">{compMin.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 shadow-2xl flex flex-col items-center justify-center text-gray-400 text-center max-w-xl mx-auto">
                  <Activity className="w-12 h-12 mb-4 text-gray-700 animate-pulse" />
                  <p className="text-lg font-medium text-gray-200">UMAP Projections unavailable</p>
                  <p className="text-sm mt-1 max-w-sm">Click "Generate UMAP Projections" to generate a non-linear 2D layout based on the SOM's high-dimensional structure.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showClusterMetrics && (
        <ClusterMetricsModal onClose={() => setShowClusterMetrics(false)} />
      )}
    </>
  );
};
