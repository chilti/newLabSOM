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
  Download,
  RotateCcw
} from 'lucide-react';
import { 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  Radar, 
  Legend, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer 
} from 'recharts';
import { BoxPlot } from './BoxPlot';
import { MallaHexagonal, type Trajectory } from './MallaHexagonal';
import { UmapHeatmap } from './UmapHeatmap';
import { ClusterMetricsPanel } from './ClusterMetricsPanel';
import type { MetricResult } from './ClusterMetricsPanel';
import { TrainingErrorPanel } from './TrainingErrorPanel';
import { parseTrajectoryEntity } from '../utils/timeSeries';
import { SendToAssistantButton } from './SendToAssistantButton';
import { denormalizeValue } from '../utils/normalization';

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
    savedRuns,
    activeRunId,
    setActiveRunId,
    deleteRun,
    renameRun,
    clusterLabels,
    incitesIsUploading,
    somSizeMode,
    setSomSizeMode,
    suggestedBigSom,
    suggestedSmallSom,
    componentScaleConfigs,
    globalScaleSource,
    setGlobalScaleSource,
    resetComponentScaleConfigs
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
  
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editingRunName, setEditingRunName] = useState<string>('');

  const [clusterMetricsData, setClusterMetricsData] = useState<MetricResult[] | null>(null);
  const [isAnalyzingClusters, setIsAnalyzingClusters] = useState(false);
  const [clusterMetricsError, setClusterMetricsError] = useState<string | null>(null);

  useEffect(() => {
  }, []);
  
  const [umapHeatmapScale, setUmapHeatmapScale] = useState(1); // 1 = 240x200, 1.5 = 360x300, 2 = 480x400

  // Pagination page for component maps (3x3 grid)
  const [compPage, setCompPage] = useState(0);
  const [umapCompPage, setUmapCompPage] = useState(0);

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

  const analyzeClusters = async () => {
    const currentResult = useSomStore.getState().result;
    if (!currentResult || !currentResult.weights) return;
    setIsAnalyzingClusters(true);
    setClusterMetricsError(null);
    try {
      const payload = { weights: currentResult.weights, max_k: config.maxK || 15 };
      const apiUrl = getApiUrl('/api/som/evaluate_clusters');
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        setClusterMetricsData(json.metrics);
      } else {
        const errMsg = json.error || json.title || json.detail || JSON.stringify(json);
        setClusterMetricsError(typeof errMsg === 'string' ? errMsg : "Unknown error occurred.");
      }
    } catch (e: any) {
      setClusterMetricsError(e.message || "Network error");
    } finally {
      setIsAnalyzingClusters(false);
    }
  };

  // Auto-calculate cluster metrics whenever a SOM result exists and metrics haven't been calculated yet
  useEffect(() => {
    if (result && result.weights && config.clusteringAlgorithm === 'agglomerative' && !clusterMetricsData && !isAnalyzingClusters) {
      analyzeClusters();
    }
  }, [result, config.clusteringAlgorithm]);

  // Reset cluster metrics data when active run changes
  useEffect(() => {
    if (result && result.weights && config.clusteringAlgorithm === 'agglomerative') {
      analyzeClusters();
    } else {
      setClusterMetricsData(null);
    }
  }, [activeRunId]);

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

  // Handler when clicking a neuron in any hex grid map: auto-select its cluster for the radar
  const handleNeuronClick = (neuronIdx: number) => {
    if (result && result.clustering && result.clustering[neuronIdx] !== undefined) {
      const cId = result.clustering[neuronIdx];
      if (cId !== -1) {
        setSelectedClusterId(cId);
      }
    }
  };
  const [selectedClusterId, setSelectedClusterId] = useState<number>(0);
  const [selectedRadarUnits, setSelectedRadarUnits] = useState<string[]>([]);

  // Derive unique clusters available in trained result
  const availableClusterIds = useMemo(() => {
    if (!result || !result.clustering) return [];
    const set = new Set<number>();
    result.clustering.forEach(c => {
      if (c !== -1) set.add(c);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [result]);

  // Ensure selectedClusterId is valid when availableClusterIds changes
  useEffect(() => {
    if (availableClusterIds.length > 0 && !availableClusterIds.includes(selectedClusterId)) {
      setSelectedClusterId(availableClusterIds[0]);
    }
  }, [availableClusterIds, selectedClusterId]);

  // Compute Cluster Centroid and all Units belonging to/nearest to cluster, ordered by distance
  const clusterCalculations = useMemo(() => {
    if (!result || !result.weights || !result.clustering || !dataMatrix || dataMatrix.length === 0 || compNames.length === 0) {
      return { centroidVector: [], unitsOrderedByDist: [] };
    }

    const { weights, clustering, bmus } = result;
    const numFeatures = compNames.length;

    // 1. Find neuron indices belonging to selectedClusterId
    const clusterNeuronSet = new Set<number>();
    const clusterNeuronIndices: number[] = [];
    clustering.forEach((cId, idx) => {
      if (cId === selectedClusterId) {
        clusterNeuronSet.add(idx);
        clusterNeuronIndices.push(idx);
      }
    });

    if (clusterNeuronIndices.length === 0) {
      return { centroidVector: [], unitsOrderedByDist: [] };
    }

    // 2. Compute Centroid Vector (Average of weight vectors of neurons in cluster)
    const centroidVector = new Array(numFeatures).fill(0);
    clusterNeuronIndices.forEach(nIdx => {
      const w = weights[nIdx];
      for (let f = 0; f < numFeatures; f++) {
        centroidVector[f] += w[f];
      }
    });
    for (let f = 0; f < numFeatures; f++) {
      centroidVector[f] /= clusterNeuronIndices.length;
    }

    // 3. Find samples mapped to this cluster (via BMU in clusterNeuronSet) or all samples
    // Calculate distance of each sample to centroid
    const mappedUnits = dataMatrix.map((row, sampleIdx) => {
      const bmu = bmus ? bmus[sampleIdx] : -1;
      const belongsToCluster = bmu !== -1 && clusterNeuronSet.has(bmu);
      
      let sumSq = 0;
      for (let f = 0; f < numFeatures; f++) {
        const diff = (row[f] ?? 0) - centroidVector[f];
        sumSq += diff * diff;
      }
      return {
        sampleIdx,
        label: labels[sampleIdx] || `Entity ${sampleIdx + 1}`,
        distance: Math.sqrt(sumSq),
        belongsToCluster,
        row,
        rawRow: originalDataMatrix ? originalDataMatrix[sampleIdx] : undefined
      };
    });

    // Filter to units assigned to cluster neurons first
    const clusterOnly = mappedUnits.filter(u => u.belongsToCluster).sort((a, b) => a.distance - b.distance);

    // Fallback if no samples mapped to cluster neurons: sort all samples by distance
    const finalUnitsList = clusterOnly.length > 0 ? clusterOnly : mappedUnits.sort((a, b) => a.distance - b.distance);

    return {
      centroidVector,
      unitsOrderedByDist: finalUnitsList
    };
  }, [result, dataMatrix, originalDataMatrix, labels, compNames, selectedClusterId]);

  // When cluster changes, auto-select Top 2 closest units by default
  useEffect(() => {
    const top2 = clusterCalculations.unitsOrderedByDist.slice(0, 2).map(u => u.label);
    setSelectedRadarUnits(top2);
  }, [selectedClusterId, clusterCalculations.unitsOrderedByDist]);

  // Active SOM experiment information and unit of analysis
  const activeSomRun = useMemo(() => {
    return savedRuns.find(r => r.id === activeRunId);
  }, [savedRuns, activeRunId]);

  const somTitleName = activeSomRun?.name || (fileName ? `SOM - ${fileName.replace(/\.[^/.]+$/, '')}` : `SOM ${config.clusteringAlgorithm === 'agglomerative' ? 'Agglomerative' : 'DBSCAN'} Clusters Map`);
  const unitAnalysisName = activeSomRun?.provenance?.unitName || (activeSomRun?.name?.includes('Locations') ? 'Locations' : (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Entidades / Documentos'));

  // Detailed cluster breakdown including centroid vectors, sizes, and sample labels
  const allClustersSummary = useMemo(() => {
    if (!result || !result.weights || !result.clustering || !dataMatrix || dataMatrix.length === 0 || compNames.length === 0) {
      return '';
    }

    const { weights, clustering, bmus } = result;
    const numFeatures = compNames.length;
    const clusters = Array.from(new Set(clustering.filter(c => c !== -1))).sort((a, b) => a - b);

    const summaries = clusters.map(cId => {
      const clusterNeuronIndices: number[] = [];
      const clusterNeuronSet = new Set<number>();
      clustering.forEach((c, idx) => {
        if (c === cId) {
          clusterNeuronIndices.push(idx);
          clusterNeuronSet.add(idx);
        }
      });

      // Centroid Vector (Average of neuron reference weights in this cluster)
      const centroidVector = new Array(numFeatures).fill(0);
      clusterNeuronIndices.forEach(nIdx => {
        const w = weights[nIdx];
        if (w) {
          for (let f = 0; f < numFeatures; f++) centroidVector[f] += (w[f] ?? 0);
        }
      });
      for (let f = 0; f < numFeatures; f++) {
        centroidVector[f] /= Math.max(1, clusterNeuronIndices.length);
      }

      // Mapped entities from data
      const mappedEntities = labels.filter((_, idx) => bmus && clusterNeuronSet.has(bmus[idx]));

      // Custom cluster label if user renamed it
      const customClusterName = (clusterLabels && clusterLabels[cId]) ? clusterLabels[cId] : `Cluster ${cId + 1}`;

      // Top distinguishing dimensions for this centroid
      const compWithValues = compNames.map((name, f) => ({ name, val: centroidVector[f] }));
      compWithValues.sort((a, b) => b.val - a.val);
      const topDimensions = compWithValues.slice(0, 6).map(cv => `${cv.name}: ${typeof cv.val === 'number' ? cv.val.toFixed(3) : cv.val}`).join(', ');

      return `• ${customClusterName} (${clusterNeuronIndices.length} neurons, ${mappedEntities.length} "${unitAnalysisName}" entities assigned):\n` +
             `   - Centroid Vector (Top weighted variables): [${topDimensions}]\n` +
             `   - Sample of assigned entities: ${mappedEntities.slice(0, 10).join(', ') || 'No directly assigned entities'}`;
    });

    return summaries.join('\n\n');
  }, [result, dataMatrix, compNames, labels, clusterLabels, unitAnalysisName]);

  // Construct Radar Chart Data
  const clusterRadarData = useMemo(() => {
    if (clusterCalculations.centroidVector.length === 0 || compNames.length === 0) {
      return { chartData: [], activeUnits: [] };
    }

    const { centroidVector, unitsOrderedByDist } = clusterCalculations;

    // Filter units that are currently selected by user
    const selectedUnitObjects = unitsOrderedByDist.filter(u => selectedRadarUnits.includes(u.label));

    const colorsList = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#a855f7'];

    const activeUnits = selectedUnitObjects.map((u, idx) => ({
      name: u.label,
      distance: u.distance,
      color: colorsList[idx % colorsList.length],
      row: u.row,
      rawRow: u.rawRow
    }));

    const chartData = compNames.map((indicatorName, fIdx) => {
      const item: Record<string, any> = {
        indicator: indicatorName,
        Centroid: Number((centroidVector[fIdx] ?? 0).toFixed(3))
      };
      activeUnits.forEach(u => {
        item[u.name] = Number((u.row[fIdx] ?? 0).toFixed(3));
      });
      return item;
    });

    return {
      chartData,
      activeUnits,
      centroidVector
    };
  }, [clusterCalculations, compNames, selectedRadarUnits]);

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

  // Helper: read current theme and return colors for standalone popup windows
  const getPopupTheme = () => {
    const t = localStorage.getItem('labsom-theme') || 'dark';
    if (t === 'light') return {
      bg: '#eef2f7', card: '#f8fafc', border: '#e2e8f0',
      text: '#1e293b', textSub: '#334155', accent: '#2563eb', accentSub: '#1d4ed8'
    };
    if (t === 'navy') return {
      bg: '#0d1b2a', card: '#112030', border: '#1a2e44',
      text: '#d0e8ff', textSub: '#90b8d8', accent: '#00f0ff', accentSub: '#00a2ff'
    };
    return {
      bg: '#050508', card: '#0e121a', border: '#1e293b',
      text: '#cbd5e1', textSub: '#94a3b8', accent: '#00F0FF', accentSub: '#0088ff'
    };
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
    clonedSvg.removeAttribute('style');
    clonedSvg.setAttribute('width', '100%');
    clonedSvg.setAttribute('height', '100%');
    clonedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Create popup window
    const popup = window.open("", "_blank", "width=1000,height=800,resizable=yes,scrollbars=yes");
    if (!popup) {
      alert("Popup blocker active. Please allow popups for knoMap to open stand-alone charts.");
      return;
    }

    popup.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>knoMap - Standalone Chart</title>
          <style>
            body {
              background-color: ${getPopupTheme().bg};
              color: ${getPopupTheme().text};
              font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
              margin: 0;
              padding: 20px;
              display: flex;
              flex-direction: column;
              height: 100vh;
              overflow: hidden;
              box-sizing: border-box;
            }
            .header-bar {
              width: 100%;
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 1px solid ${getPopupTheme().border};
              padding-bottom: 12px;
              margin-bottom: 16px;
              flex-shrink: 0;
            }
            .title {
              font-size: 16px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: ${getPopupTheme().text};
            }
            .subtitle {
              font-size: 11px;
              color: ${getPopupTheme().accent};
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.1em;
            }
            .chart-container {
              flex: 1;
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              background-color: ${getPopupTheme().card};
              border: 1px solid ${getPopupTheme().border};
              border-radius: 16px;
              padding: 20px;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
              overflow: hidden;
              box-sizing: border-box;
            }
            svg {
              width: 100%;
              height: 100%;
              max-width: 100%;
              max-height: 100%;
              filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
              cursor: grab;
            }
            svg.dragging { cursor: grabbing; }
            polygon {
              transition: opacity 0.15s ease;
            }
            polygon:hover {
              opacity: 1 !important;
              stroke: ${getPopupTheme().text} !important;
              stroke-width: 1.5px !important;
            }
            .zoom-hint {
              position: fixed; bottom: 12px; right: 16px;
              font-size: 10px; color: ${getPopupTheme().textSub};
              opacity: 0.6; pointer-events: none;
            }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <span class="title">${mapTitle}</span>
            <span class="subtitle">knoMap Premium Export</span>
          </div>
          <div class="chart-container" id="zoomWrap">
            ${clonedSvg.outerHTML}
          </div>
          <div class="zoom-hint">Scroll to zoom · Drag to pan · Double-click to reset</div>
          <script>
            (function() {
              const wrap = document.getElementById('zoomWrap');
              const svg  = wrap.querySelector('svg');
              let scale = 1, tx = 0, ty = 0;
              let dragging = false, startX = 0, startY = 0;

              function apply() {
                svg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
                svg.style.transformOrigin = '50% 50%';
              }

              wrap.addEventListener('wheel', function(e) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                scale = Math.min(10, Math.max(0.2, scale * delta));
                apply();
              }, { passive: false });

              wrap.addEventListener('mousedown', function(e) {
                dragging = true; startX = e.clientX - tx; startY = e.clientY - ty;
                svg.classList.add('dragging');
              });
              window.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                tx = e.clientX - startX; ty = e.clientY - startY;
                apply();
              });
              window.addEventListener('mouseup', function() {
                dragging = false; svg.classList.remove('dragging');
              });
              wrap.addEventListener('dblclick', function() {
                scale = 1; tx = 0; ty = 0; apply();
              });
            })();
          </script>
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
        <head><title>UMAP Dimensional Projection — knoMap</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: ${getPopupTheme().bg}; display: flex; flex-direction: column;
                 height: 100vh; overflow: hidden;
                 font-family: ui-sans-serif, system-ui, sans-serif; color: ${getPopupTheme().text}; }
          .header { display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 20px; border-bottom: 1px solid ${getPopupTheme().border}; flex-shrink: 0; }
          .title { font-size: 14px; font-weight: 900; text-transform: uppercase;
                   letter-spacing: .08em; color: ${getPopupTheme().text}; }
          .sub { font-size: 10px; color: ${getPopupTheme().accent}; font-weight: 700;
                 text-transform: uppercase; letter-spacing: .12em; }
          .chart { flex: 1; background: ${getPopupTheme().card}; overflow: hidden;
                   margin: 12px; border-radius: 12px;
                   box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
                   display: flex; align-items: stretch; justify-content: stretch;
                   position: relative; }
          .chart svg { width: 100% !important; height: 100% !important; display: block; cursor: grab; }
          .chart svg.dragging { cursor: grabbing !important; }
          circle { cursor: default !important; }
          .zoom-hint { position: absolute; bottom: 10px; right: 14px;
                       font-size: 10px; color: ${getPopupTheme().textSub};
                       opacity: 0.55; pointer-events: none; }
        </style></head>
        <body>
          <div class="header">
            <span class="title">UMAP Dimensional Projection (2D)</span>
            <span class="sub">knoMap — Premium Export</span>
          </div>
          <div class="chart" id="zoomWrap">
            ${cloned.outerHTML}
            <div class="zoom-hint">Scroll to zoom &middot; Drag to pan &middot; Double-click to reset</div>
          </div>
          <script>
            (function() {
              const wrap = document.getElementById('zoomWrap');
              const svg  = wrap.querySelector('svg');
              let scale = 1, tx = 0, ty = 0;
              let dragging = false, startX = 0, startY = 0;
              function apply() {
                svg.style.transform = 'translate('+tx+'px,'+ty+'px) scale('+scale+')';
                svg.style.transformOrigin = '50% 50%';
              }
              wrap.addEventListener('wheel', function(e) {
                e.preventDefault();
                const d = e.deltaY > 0 ? 0.88 : 1.12;
                scale = Math.min(12, Math.max(0.15, scale * d));
                apply();
              }, { passive: false });
              wrap.addEventListener('mousedown', function(e) {
                dragging = true; startX = e.clientX - tx; startY = e.clientY - ty;
                svg.classList.add('dragging');
              });
              window.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                tx = e.clientX - startX; ty = e.clientY - startY; apply();
              });
              window.addEventListener('mouseup', function() {
                dragging = false; svg.classList.remove('dragging');
              });
              wrap.addEventListener('dblclick', function() {
                scale = 1; tx = 0; ty = 0; apply();
              });
            })();
          </script>
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
        .map(p => {
          const coords = coordMap.get(p.dataIndex);
          if (!coords) return null;
          return { ...coords, dataIndex: p.dataIndex };
        })
        .filter(Boolean) as {cx: number, cy: number, dataIndex: number}[];
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

      // Trajectory Labels
      dCtx.font = '900 11px ui-sans-serif, system-ui, sans-serif';
      dCtx.textAlign = 'center';
      for (const pt of pts) {
        const labelText = labels[pt.dataIndex];
        if (!labelText) continue;
        
        const yOffset = pt.cy - (traj.width || 2) - 6;
        
        // Shadow for contrast
        dCtx.lineWidth = 3;
        dCtx.strokeStyle = 'rgba(0,0,0,0.8)';
        dCtx.strokeText(labelText, pt.cx, yOffset);
        
        // Colored text matching trajectory
        dCtx.fillStyle = traj.color;
        dCtx.fillText(labelText, pt.cx, yOffset);
      }
    }

    const dataUrl = displayCanvas.toDataURL('image/png');

    const popup = window.open('', '_blank', 'width=1280,height=1060,resizable=yes,scrollbars=no');
    if (!popup) { alert('Popup blocker active. Please allow popups.'); return; }
    popup.document.write(`
      <!DOCTYPE html><html>
        <head><title>${name} — UMAP Heatmap — knoMap</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: ${getPopupTheme().bg}; display: flex; flex-direction: column;
                 height: 100vh; overflow: hidden;
                 font-family: ui-sans-serif, system-ui, sans-serif; color: ${getPopupTheme().text}; }
          .header { width: 100%; display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 24px; border-bottom: 1px solid ${getPopupTheme().border}; flex-shrink: 0; }
          .title { font-size: 14px; font-weight: 900; text-transform: uppercase;
                   letter-spacing: .08em; color: ${getPopupTheme().text}; }
          .sub { font-size: 10px; color: ${getPopupTheme().accent}; font-weight: 700;
                 text-transform: uppercase; letter-spacing: .12em; }
          .chart { flex: 1; background: ${getPopupTheme().card};
                   box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
                   display: flex; align-items: center; justify-content: center;
                   position: relative; overflow: hidden; margin: 12px; border-radius: 12px; }
          img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; cursor: grab; }
          img.dragging { cursor: grabbing !important; }
          .zoom-hint { position: absolute; bottom: 10px; right: 14px;
                       font-size: 10px; color: ${getPopupTheme().textSub};
                       opacity: 0.55; pointer-events: none; }
        </style></head>
        <body>
          <div class="header">
            <span class="title">${name}</span>
            <span class="sub">UMAP Variable Heatmap — knoMap</span>
          </div>
          <div class="chart" id="zoomWrap">
            <img id="heatmapImg" src="${dataUrl}" />
            <div class="zoom-hint">Scroll to zoom &middot; Drag to pan &middot; Double-click to reset</div>
          </div>
          <script>
            (function() {
              const wrap = document.getElementById('zoomWrap');
              const img  = document.getElementById('heatmapImg');
              let scale = 1, tx = 0, ty = 0;
              let dragging = false, startX = 0, startY = 0;
              function apply() {
                img.style.transform = 'translate('+tx+'px,'+ty+'px) scale('+scale+')';
                img.style.transformOrigin = '50% 50%';
              }
              wrap.addEventListener('wheel', function(e) {
                e.preventDefault();
                const d = e.deltaY > 0 ? 0.88 : 1.12;
                scale = Math.min(12, Math.max(0.2, scale * d));
                apply();
              }, { passive: false });
              wrap.addEventListener('mousedown', function(e) {
                dragging = true; startX = e.clientX - tx; startY = e.clientY - ty;
                img.classList.add('dragging');
              });
              window.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                tx = e.clientX - startX; ty = e.clientY - startY; apply();
              });
              window.addEventListener('mouseup', function() {
                dragging = false; img.classList.remove('dragging');
              });
              wrap.addEventListener('dblclick', function() {
                scale = 1; tx = 0; ty = 0; apply();
              });
            })();
          </script>
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

  const exportReferenceVectors = () => {
    if (!result || !result.weights) {
      alert("No trained SOM weights available.");
      return;
    }

    // knoMap2D_2019 Format: first line has feature names separated by ';'
    // Subsequent lines have weights separated by ';'
    const lines = [];
    lines.push(compNames.join(';'));

    for (let i = 0; i < result.weights.length; i++) {
      lines.push(result.weights[i].join(';'));
    }

    const fileContent = lines.join('\n');
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName ? fileName.replace('.csv', '') : 'som'}_weights.txt`;
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
                    <td key={cIdx} className="p-2 text-[10px] text-gray-400 font-mono">
                      {typeof val === 'number'
                        ? (val === 0 ? '0' : Math.abs(val) < 0.001 ? val.toExponential(3) : Math.abs(val) < 1 ? val.toFixed(4) : val.toFixed(3))
                        : val}
                    </td>
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

  const renderExperimentHistoryBar = () => {
    if (savedRuns.length === 0) return null;

    // Check if multiple runs originate from the same unit/dataset
    const unitCounts: Record<string, number> = {};
    savedRuns.forEach(r => {
      const key = r.provenance?.unitName || 'Dataset';
      unitCounts[key] = (unitCounts[key] || 0) + 1;
    });
    const repeatedUnits = Object.entries(unitCounts).filter(([_, count]) => count > 1).map(([name]) => name);

    return (
      <div className="bg-gray-900/90 border border-gray-800/80 rounded-2xl p-3 space-y-3 shadow-xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-[11px] font-black uppercase tracking-wider text-gray-300">
              SOM Training Experiments ({savedRuns.length})
            </span>
            <span className="text-[10px] text-gray-500 italic">Click a model to swap dashboard maps instantly</span>
          </div>

          {repeatedUnits.length > 0 && (
            <div className="flex items-center space-x-1.5 bg-amber-950/40 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-full text-[10px] font-medium">
              <span>💡</span>
              <span>
                <strong>{repeatedUnits.join(', ')}</strong> tiene múltiples modelos guardados. Renómbralos para distinguirlos fácilmente.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-800">
          {savedRuns.map((run) => {
            const isActive = activeRunId === run.id;
            const isEditing = editingRunId === run.id;
            const originType = run.provenance?.originType || 'csv_upload';
            
            let icon = '📄';
            if (originType === 'incites') icon = '📊';
            else if (originType === 'bibliometrics') icon = '📚';
            else if (originType === 'dimreduction') icon = '🧪';

            return (
              <div
                key={run.id}
                onClick={() => {
                  if (!isEditing && !isActive) setActiveRunId(run.id);
                }}
                className={`flex-shrink-0 flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs transition-all cursor-pointer border ${
                  isActive
                    ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-md shadow-indigo-950/50 ring-1 ring-indigo-500/50'
                    : 'bg-gray-950/60 border-gray-800/80 text-gray-400 hover:border-gray-700 hover:bg-gray-900/80 hover:text-gray-200'
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                
                <div className="flex flex-col min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingRunName}
                      onChange={(e) => setEditingRunName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingRunName.trim()) renameRun(run.id, editingRunName.trim());
                          setEditingRunId(null);
                        } else if (e.key === 'Escape') {
                          setEditingRunId(null);
                        }
                      }}
                      onBlur={() => {
                        if (editingRunName.trim()) renameRun(run.id, editingRunName.trim());
                        setEditingRunId(null);
                      }}
                      autoFocus
                      className="bg-gray-900 border border-indigo-500 text-white px-1.5 py-0.5 rounded text-xs font-medium focus:outline-none max-w-[180px]"
                    />
                  ) : (
                    <div className="flex items-center space-x-1.5">
                      <span className="font-bold truncate max-w-[170px]" title={run.name}>
                        {run.name}
                      </span>
                      {isActive && (
                        <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[9px] font-black uppercase rounded border border-emerald-500/40">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  )}
                  
                  <div className="flex items-center space-x-2 text-[10px] text-gray-500 font-mono">
                    <span>{run.config.rows}x{run.config.cols}</span>
                    <span>&middot;</span>
                    <span>{run.compNames.length} ind</span>
                    {run.isCmaSmoothingActive && (
                      <>
                        <span>&middot;</span>
                        <span className="text-emerald-400">CMA</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1 pl-1 border-l border-gray-800/80">
                  {!isEditing && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRunId(run.id);
                        setEditingRunName(run.name);
                      }}
                      title="Rename experiment"
                      className="p-1 text-gray-500 hover:text-indigo-300 rounded transition-colors"
                    >
                      ✏️
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`¿Eliminar el entrenamiento '${run.name}'?`)) {
                        deleteRun(run.id);
                      }
                    }}
                    title="Delete experiment"
                    className="p-1 text-gray-500 hover:text-red-400 rounded transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
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

      {/* SOM Experiment History Selector Bar */}
      {renderExperimentHistoryBar()}

      {/* RENDER ACTIVE SUBTAB CONTENT */}
      <div className="flex-1">
        
        {/* SUBTAB 1: DATA IMPORT & EXPLORATION */}
        <div className={subTab === 'import' ? "space-y-6" : "hidden"}>
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
                <div className={`border rounded-2xl p-5 shadow-lg flex flex-col space-y-3 relative transition-all ${
                  isCmaSmoothingActive 
                    ? 'bg-indigo-950/40 border-indigo-500/60 shadow-indigo-950/40' 
                    : 'bg-gray-900 border-gray-800'
                }`}>
                  <div className="absolute -left-3 -top-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg uppercase">
                    Step 2
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-sm font-bold text-indigo-300 flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4 text-indigo-400" />
                        <span>Time-Series Preprocessing (PathSOM)</span>
                      </h3>
                      {isCmaSmoothingActive ? (
                        <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>SMOOTHING ACTIVE (Window = {cmaWindowSize})</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                          RAW DATA (No Smoothing)
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center cursor-pointer space-x-2">
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
                        <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                          {isCmaSmoothingActive ? 'CMA Active' : 'Apply CMA Smoothing'}
                        </span>
                      </label>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 leading-relaxed">
                    {isCmaSmoothingActive ? (
                      <span className="text-indigo-300">
                        ✓ <strong>Centered Moving Average (CMA)</strong> is ENABLED. Feature values across consecutive years are smoothed in real-time before SOM training.
                      </span>
                    ) : (
                      <span>
                        RAW DATA IN USE. Enable <strong>CMA Smoothing</strong> to reduce short-term temporal noise across years for each entity trajectory.
                      </span>
                    )}
                  </p>

                  {isCmaSmoothingActive && (
                    <div className="flex items-center gap-4 border-t border-gray-800/80 pt-3">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Smoothing Window Size (Odd Numbers): <span className="text-indigo-400 font-extrabold text-xs">{cmaWindowSize} steps</span>
                        </label>
                        <input 
                          type="range" 
                          min="3" 
                          max="15" 
                          step="2" 
                          value={cmaWindowSize}
                          onChange={(e) => setCmaWindowSize(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                      <div className="text-[11px] text-gray-500 italic max-w-xs leading-tight">
                        Applies a centered window of size {cmaWindowSize} across consecutive years per entity.
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

        {/* SUBTAB 2: TRAINING AND HYBRID SOLVER STATUS */}
        <div className={subTab === 'training' ? "grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto" : "hidden"}>
            {/* Form configuration card */}
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl space-y-6">
              <div>
                <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2">
                  <Settings className="w-5 h-5 text-indigo-400" />
                  <span>SOM & Algorithm Hyperparameters</span>
                </h3>
                <p className="text-xs text-gray-500 mt-1">Configure clustering grid dimension, iterations, and active fallbacks.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex flex-col space-y-2 mb-4 bg-gray-950 p-3 rounded-xl border border-gray-800">
                    <span className="text-xs text-gray-400 font-semibold mb-1">Grid Size Mode</span>
                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer hover:text-indigo-300">
                      <input 
                        type="radio" 
                        name="somSizeMode" 
                        value="big" 
                        className="text-indigo-500 bg-gray-900 border-gray-700"
                        checked={somSizeMode === 'big'} 
                        onChange={() => {
                          setSomSizeMode('big');
                          if (suggestedBigSom) {
                            setConfig({ cols: suggestedBigSom.width, rows: suggestedBigSom.height });
                          }
                        }} 
                      />
                      <span>Big SOM, Visualization {suggestedBigSom ? `(Suggested: ${suggestedBigSom.width}x${suggestedBigSom.height})` : ''}</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer hover:text-indigo-300">
                      <input 
                        type="radio" 
                        name="somSizeMode" 
                        value="small" 
                        className="text-indigo-500 bg-gray-900 border-gray-700"
                        checked={somSizeMode === 'small'} 
                        onChange={() => {
                          setSomSizeMode('small');
                          if (suggestedSmallSom) {
                            setConfig({ cols: suggestedSmallSom.width, rows: suggestedSmallSom.height });
                          }
                        }} 
                      />
                      <span>Small SOM, Clustering {suggestedSmallSom ? `(Suggested: ${suggestedSmallSom.width}x${suggestedSmallSom.height})` : ''}</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer hover:text-indigo-300">
                      <input 
                        type="radio" 
                        name="somSizeMode" 
                        value="custom" 
                        className="text-indigo-500 bg-gray-900 border-gray-700"
                        checked={somSizeMode === 'custom'} 
                        onChange={() => setSomSizeMode('custom')} 
                      />
                      <span>User Defined</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 font-semibold mb-1.5">Grid Rows</label>
                      <input
                        type="number"
                        value={config.rows}
                        onChange={(e) => {
                          setConfig({ rows: parseInt(e.target.value) || 5 });
                          setSomSizeMode('custom');
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 font-semibold mb-1.5">Grid Columns</label>
                      <input
                        type="number"
                        value={config.cols}
                        onChange={(e) => {
                          setConfig({ cols: parseInt(e.target.value) || 5 });
                          setSomSizeMode('custom');
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 font-semibold mb-1.5">Training Epochs / Iterations</label>
                    <input
                      type="number"
                      value={config.iterations}
                      onChange={(e) => setConfig({ iterations: parseInt(e.target.value) || 1000 })}
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
                      <p className="text-[10px] text-gray-500 leading-normal">
                        Agglomerative Ward hierarchy. Adjust target K and re-cluster in the Optimization Metrics panel below.
                      </p>
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
                      // Automatically run optimal cluster analysis if agglomerative clustering is active
                      if (config.clusteringAlgorithm === 'agglomerative') {
                        analyzeClusters();
                      }
                    }
                  }}
                  disabled={isTraining || dataMatrix.length === 0 || incitesIsUploading}
                  className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900 shadow-opacity-30 cursor-pointer"
                >
                  {isTraining ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Training SOM...</span>
                    </>
                  ) : incitesIsUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                      <span>InCites Processing...</span>
                    </>
                  ) : (
                    <span>Train SOM</span>
                  )}
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

            {/* Training Error Panel (visible when training result has errors) */}
            {result && result.errors && result.errors.length > 0 && (
              <TrainingErrorPanel errors={result.errors} />
            )}

            {/* Clustering Metrics Panel (only visible when Agglomerative) */}
            {config.clusteringAlgorithm === 'agglomerative' && (
              <ClusterMetricsPanel 
                data={clusterMetricsData} 
                loading={isAnalyzingClusters} 
                error={clusterMetricsError}
                nClusters={config.nClusters}
                maxK={config.maxK}
                onNClustersChange={(k) => setConfig({ nClusters: k })}
                onMaxKChange={(k) => setConfig({ maxK: k })}
                onRecluster={handleRecluster}
                onApplyK={() => {
                  const targetMetric = clusterMetricsData?.find(d => d.k === config.nClusters);
                  if (targetMetric && targetMetric.labels) {
                    reclusterLocally(targetMetric.labels);
                    setSubTab('maps');
                  } else {
                    alert("No pre-calculated labels found for this K. Please click 'Analyze Optimal Clusters' first or use 'Backend Re-cluster'.");
                  }
                }}
                disabledRecluster={!result || dataMatrix.length === 0}
              />
            )}
        </div>

        {/* SUBTAB 3: SOM MAPS VIEWPORTS AND 3X3 GRID CLONER */}
        <div className={subTab === 'maps' ? "space-y-8" : "hidden"}>
            {result ? (
              <>
                {/* Section A: Top Row - Clustering Map (First Map!) & Cluster Centroid + 2 Nearest Units Radar Chart */}
                <div className="space-y-4">
                  <h3 className="text-xs uppercase tracking-widest font-black text-gray-400 border-b border-gray-800 pb-2 flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    <span>Neural Clustering & Multidimensional Profile Radar</span>
                  </h3>
                  
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* PathSOM Trajectories Controls (Only if hasTrajectories) */}
                    {hasTrajectories && (
                      <div className="w-full lg:w-64 flex flex-col shrink-0">
                        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-xl flex-1 flex flex-col overflow-hidden h-[480px]">
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
                      {/* 1. Clustering Map (First Map!) */}
                      <div id="comp-viewport-clustering" className="relative border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[480px]">
                        <div className="absolute top-4 right-4 z-20 flex space-x-2 items-center">
                          <SendToAssistantButton
                            title={somTitleName}
                            badge="SOM & UMAP"
                            viewSource="som"
                            chartType="hex_map"
                            targetElementId="comp-viewport-clustering"
                            data={{
                              hexGrid: result?.hexGrid ? result.hexGrid.map((h: any) => ({ x: h.x, y: h.y, index: h.index, row: h.row, col: h.col })) : [],
                              clustering: result?.clustering,
                              frequencies: result?.frequencies,
                              rows: config.rows,
                              cols: config.cols
                            }}
                            dataContextPrompt={`Self-Organizing Map (SOM) Hexagonal Grid (${config.rows}x${config.cols}).\n` +
                              `Active Experiment / Model: "${somTitleName}".\n` +
                              `Mapped Unit of Analysis: "${unitAnalysisName}".\n` +
                              `Clustering Algorithm: ${config.clusteringAlgorithm} with ${config.nClusters} clusters.\n` +
                              `Total Mapped Entities: ${labels?.length || dataMatrix?.length || 0}.\n` +
                              `Analyzed Variables / Indicators (${compNames.length}): ${compNames.slice(0, 15).join(', ')}.\n\n` +
                              `CLUSTER BREAKDOWN & CENTROID VECTORS:\n` +
                              allClustersSummary
                            }
                            buttonText="AI Assistant"
                          />
                          <button
                            onClick={exportReferenceVectors}
                            className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition cursor-pointer shadow-lg flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider border border-gray-700"
                            title="Export Reference Vectors (Weights)"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Ref. Vectors</span>
                          </button>
                          <button
                            onClick={exportClusteredData}
                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition cursor-pointer shadow-lg shadow-indigo-900/20 flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider"
                            title="Export Data with Cluster Column"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Data+Cluster</span>
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
                            onNeuronClick={handleNeuronClick}
                            trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                          />
                        </div>
                      </div>

                      {/* 2. Cluster Centroid & Selectable Cluster Units Radar Chart */}
                      <div className="border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[480px]">
                        <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-2 flex-wrap gap-2">
                          <div>
                            <h4 className="text-xs font-black uppercase text-gray-300 flex items-center space-x-2">
                              <Activity className="w-4 h-4 text-purple-400" />
                              <span>Cluster Profile Radar</span>
                            </h4>
                            <p className="text-[10px] text-gray-500 mt-0.5">Centroid vs. Units (ordered by distance to centroid).</p>
                          </div>

                          <div className="flex items-center space-x-2">
                            <SendToAssistantButton
                              title={`SOM ${(clusterLabels && clusterLabels[selectedClusterId]) || `Cluster ${selectedClusterId + 1}`} Radar Profile (${unitAnalysisName})`}
                              badge="SOM & UMAP"
                              viewSource="som"
                              chartType="radar"
                              data={clusterRadarData.chartData || []}
                              dataContextPrompt={`Radar Profile for ${(clusterLabels && clusterLabels[selectedClusterId]) || `Cluster ${selectedClusterId + 1}`} in the SOM Map.\n` +
                                `Model / Experiment: "${somTitleName}".\n` +
                                `Unit of Analysis: "${unitAnalysisName}".\n` +
                                `Evaluated Variables and Exact Centroid Vector Values:\n` +
                                (clusterRadarData.chartData || []).map((d: any) => `- ${d.indicator}: Centroid = ${typeof d.Centroid === 'number' ? d.Centroid.toFixed(3) : d.Centroid}`).join('\n')
                              }
                              buttonText="AI Assistant"
                            />
                            {availableClusterIds.length > 0 && (
                              <div className="flex items-center space-x-2">
                                <label className="text-[10px] font-bold text-gray-400 uppercase">Cluster:</label>
                                <select
                                  value={selectedClusterId}
                                  onChange={(e) => setSelectedClusterId(Number(e.target.value))}
                                  className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1 text-xs font-bold text-indigo-400 focus:outline-none focus:border-indigo-500 cursor-pointer"
                                >
                                  {availableClusterIds.map(cId => (
                                    <option key={cId} value={cId}>
                                      {(clusterLabels && clusterLabels[cId]) ? clusterLabels[cId] : `Cluster ${cId + 1}`}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Cluster Units Scrollable Selector Bar */}
                        {clusterCalculations.unitsOrderedByDist.length > 0 && (
                          <div className="w-full max-w-full overflow-hidden shrink-0 py-1.5 border-b border-gray-800/80 mb-2">
                            <div 
                              className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 min-w-0"
                              style={{ overflowX: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#475569 transparent' }}
                            >
                              <span className="text-[10px] font-extrabold text-gray-400 uppercase shrink-0 pr-1">Units (by dist):</span>
                              {clusterCalculations.unitsOrderedByDist.map(unit => {
                                const isSelected = selectedRadarUnits.includes(unit.label);
                                return (
                                  <button
                                    key={unit.label}
                                    onClick={() => {
                                      setSelectedRadarUnits(prev =>
                                        isSelected ? prev.filter(u => u !== unit.label) : [...prev, unit.label]
                                      );
                                    }}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all border whitespace-nowrap shrink-0 flex items-center space-x-1 cursor-pointer ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-900/40'
                                        : 'bg-gray-900 text-gray-400 border-gray-750 hover:bg-gray-800 hover:text-gray-200'
                                    }`}
                                    title={`Distance to centroid: ${unit.distance.toFixed(4)}`}
                                  >
                                    <span>{unit.label}</span>
                                    <span className={`text-[9px] ${isSelected ? 'text-indigo-100 font-bold' : 'text-gray-500'}`}>
                                      ({unit.distance.toFixed(2)})
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {clusterRadarData.chartData.length > 0 ? (
                          <div className="flex-1 min-h-0 relative">
                            <ResponsiveContainer width="100%" height="100%">
                              <RadarChart data={clusterRadarData.chartData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                                <PolarGrid stroke="#1e293b" />
                                <PolarAngleAxis 
                                  dataKey="indicator" 
                                  stroke="#94a3b8" 
                                  tick={{ fill: '#cbd5e1', fontSize: 10, fontWeight: 600 }} 
                                />
                                <PolarRadiusAxis domain={[0, 1]} angle={30} stroke="#475569" fontSize={9} />
                                <RechartsTooltip 
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const fIdx = compNames.indexOf(label as string);
                                    return (
                                      <div className="bg-[#090d16]/95 border border-[#1e293b] rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs text-gray-200 min-w-[210px]">
                                        <div className="font-black text-indigo-400 pb-1.5 mb-2 border-b border-gray-800 uppercase tracking-wider text-[11px]">
                                          {label}
                                        </div>
                                        <div className="space-y-1.5">
                                          {payload.map((entry: any, i: number) => {
                                            const normVal = typeof entry.value === 'number' ? entry.value : parseFloat(entry.value) || 0;
                                            let originalVal: number | null = null;
                                            
                                            if (entry.dataKey === 'Centroid') {
                                              const rawC = clusterRadarData.centroidVector?.[fIdx] ?? normVal;
                                              originalVal = fIdx !== -1 ? denormalizeValue(rawC, fIdx, normalizationInfo) : rawC;
                                            } else {
                                              const activeUnit = clusterRadarData.activeUnits.find(u => u.name === entry.dataKey);
                                              if (activeUnit?.rawRow && fIdx !== -1 && activeUnit.rawRow[fIdx] !== undefined) {
                                                originalVal = activeUnit.rawRow[fIdx];
                                              } else if (fIdx !== -1) {
                                                originalVal = denormalizeValue(normVal, fIdx, normalizationInfo);
                                              }
                                            }

                                            const formattedOriginal = originalVal !== null
                                              ? (originalVal === 0
                                                  ? '0'
                                                  : Math.abs(originalVal) < 0.001
                                                    ? originalVal.toExponential(3)
                                                    : Math.abs(originalVal) < 1 && !Number.isInteger(originalVal)
                                                      ? originalVal.toFixed(4)
                                                      : Number.isInteger(originalVal)
                                                        ? originalVal.toLocaleString()
                                                        : originalVal.toFixed(2))
                                              : normVal.toFixed(3);

                                            return (
                                              <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                                                <div className="flex items-center space-x-1.5 truncate max-w-[140px]">
                                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color || entry.stroke }} />
                                                  <span className="text-gray-300 font-semibold truncate" title={entry.name}>{entry.name}</span>
                                                </div>
                                                <div className="text-right shrink-0 font-mono">
                                                  <span className="font-bold text-white">{formattedOriginal}</span>
                                                  {normalizationInfo && (
                                                    <span className="text-[9px] text-gray-500 ml-1.5" title={`Normalized value: ${normVal.toFixed(3)}`}>
                                                      ({normVal.toFixed(2)})
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <Legend 
                                  wrapperStyle={{ fontSize: 11, paddingTop: 5 }}
                                />
                                <Radar 
                                  name={`${(clusterLabels && clusterLabels[selectedClusterId]) || `Cluster ${selectedClusterId + 1}`} Centroid`} 
                                  dataKey="Centroid" 
                                  stroke="#8b5cf6" 
                                  fill="#8b5cf6" 
                                  fillOpacity={0.35} 
                                  strokeWidth={2.5}
                                />
                                {clusterRadarData.activeUnits.map(unit => (
                                  <Radar 
                                    key={unit.name}
                                    name={unit.name} 
                                    dataKey={unit.name} 
                                    stroke={unit.color} 
                                    fill={unit.color} 
                                    fillOpacity={0.2} 
                                    strokeWidth={2}
                                  />
                                ))}
                              </RadarChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs">
                            <Activity className="w-8 h-8 mb-2 text-gray-700 animate-pulse" />
                            <p>No cluster units selected for radar profile.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section B: 3x3 Component Maps Grid */}
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
                        <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px]">Draw Labels</span>
                      </label>

                      <span className="text-gray-700">|</span>

                      {/* Global Scale Calculation Source Toggle */}
                      <div className="flex items-center space-x-1 bg-gray-950 p-1 rounded-xl border border-gray-800 text-[10px]">
                        <span className="text-gray-500 font-bold px-1 uppercase">Scale:</span>
                        <button
                          type="button"
                          onClick={() => setGlobalScaleSource('raw')}
                          className={`px-2 py-0.5 rounded-lg font-bold transition cursor-pointer ${
                            globalScaleSource === 'raw'
                              ? 'bg-indigo-600 text-white shadow'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                          title="Calculate min, mean and max using denormalized raw dataset values"
                        >
                          Raw Data
                        </button>
                        <button
                          type="button"
                          onClick={() => setGlobalScaleSource('weights')}
                          className={`px-2 py-0.5 rounded-lg font-bold transition cursor-pointer ${
                            globalScaleSource === 'weights'
                              ? 'bg-indigo-600 text-white shadow'
                              : 'text-gray-400 hover:text-gray-200'
                          }`}
                          title="Calculate min, mean and max using SOM codebook weight vectors"
                        >
                          SOM Weights
                        </button>
                      </div>

                      {Object.keys(componentScaleConfigs).length > 0 && (
                        <button
                          type="button"
                          onClick={() => resetComponentScaleConfigs()}
                          className="px-2 py-1 bg-gray-950 hover:bg-gray-800 border border-gray-800 hover:border-amber-500/50 text-gray-400 hover:text-amber-300 rounded-xl text-[10px] font-bold transition cursor-pointer flex items-center space-x-1"
                          title="Reset all custom manual ranges to automatic defaults"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset Custom</span>
                        </button>
                      )}
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
                          className="border border-gray-800 bg-gray-900 bg-opacity-30 rounded-xl p-4 flex flex-col h-[290px] shadow-md transition-all hover:border-indigo-500"
                        >
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <span className="text-[11px] font-black uppercase text-gray-300 block truncate" title={name}>
                              {name}
                            </span>
                            <button
                              type="button"
                              onClick={() => openMapPopup(elementId, `Component Map: ${name}`)}
                              className="p-1.5 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-lg transition cursor-pointer shrink-0"
                              title="Open Standalone View"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex-1 min-h-0">
                            <MallaHexagonal 
                              visualizationMode="component" 
                              selectedComponentIndex={globalIdx} 
                              initialScale={25}
                              colorScale={somColorScale}
                              onColorScaleChange={setSomColorScale}
                              onNeuronClick={handleNeuronClick}
                              trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section C: Bottom Maps Grid (U-Matrix & Quantization Error Map) */}
                <div className="space-y-4 pt-4">
                  <h3 className="text-xs uppercase tracking-widest font-black text-gray-400 border-b border-gray-800 pb-2 flex items-center space-x-2">
                    <TrendingUp className="w-4 h-4 text-indigo-400" />
                    <span>Topological Distances & Quantization Error Density Maps</span>
                  </h3>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* U-Matrix Port */}
                    <div id="comp-viewport-umatrix" className="relative border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[420px]">
                      <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
                        <SendToAssistantButton
                          title={`SOM U-Matrix Distances Map (${unitAnalysisName})`}
                          badge="SOM & UMAP"
                          viewSource="som"
                          chartType="hex_map"
                          targetElementId="comp-viewport-umatrix"
                          data={{
                            hexGrid: result?.hexGrid ? result.hexGrid.map((h: any) => ({ x: h.x, y: h.y, index: h.index, row: h.row, col: h.col })) : [],
                            umatrix: result?.umatrix,
                            rows: config.rows,
                            cols: config.cols
                          }}
                          dataContextPrompt={`SOM Topological Distances U-Matrix (${config.rows}x${config.cols}).\n` +
                            `Model / Experiment: "${somTitleName}".\n` +
                            `Mapped Unit of Analysis: "${unitAnalysisName}".\n` +
                            `Identifies topological boundaries and separation barriers between clusters based on Euclidean distances between neighboring neurons.\n` +
                            `Delimited Clusters: ${availableClusterIds.length} clusters.\n` +
                            `Analyzed Variables: ${compNames.length} (${compNames.slice(0, 12).join(', ')}).`
                          }
                          buttonText="AI Assistant"
                        />
                        <button
                          onClick={() => openMapPopup('comp-viewport-umatrix', 'U-Matrix (Distances Map)')}
                          className="p-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-xl transition cursor-pointer"
                          title="Open Standalone View"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mb-2 pr-28">
                        <h4 className="text-xs font-black uppercase text-gray-300">U-Matrix (Distances)</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Visualize topological distances between adjacent nodes.</p>
                      </div>
                      <div className="flex-1 min-h-0">
                        <MallaHexagonal 
                          visualizationMode="umatrix" 
                          initialScale={30} 
                          onNeuronClick={handleNeuronClick}
                          trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                        />
                      </div>
                    </div>

                    {/* Quantization Error Map Port */}
                    <div id="comp-viewport-qe" className="relative border border-gray-800 bg-gray-900 bg-opacity-40 rounded-2xl p-5 shadow-lg flex flex-col h-[420px]">
                      <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
                        <SendToAssistantButton
                          title={`SOM Quantization Error Density Map (${unitAnalysisName})`}
                          badge="SOM & UMAP"
                          viewSource="som"
                          chartType="hex_map"
                          targetElementId="comp-viewport-qe"
                          data={{
                            hexGrid: result?.hexGrid ? result.hexGrid.map((h: any) => ({ x: h.x, y: h.y, index: h.index, row: h.row, col: h.col })) : [],
                            quantizationErrors: result?.quantizationErrors,
                            rows: config.rows,
                            cols: config.cols
                          }}
                          dataContextPrompt={`SOM Quantization Error Density Map per neuron cell (${config.rows}x${config.cols}).\n` +
                            `Model / Experiment: "${somTitleName}".\n` +
                            `Mapped Unit of Analysis: "${unitAnalysisName}".\n` +
                            `Measures the local quantization fit accuracy of weight vectors to the ${labels?.length || dataMatrix?.length || 0} "${unitAnalysisName}" entities.\n` +
                            `Analyzed Variables: ${compNames.length} (${compNames.slice(0, 12).join(', ')}).`
                          }
                          buttonText="AI Assistant"
                        />
                        <button
                          onClick={() => openMapPopup('comp-viewport-qe', 'Quantization Error Map')}
                          className="p-2 bg-gray-950 border border-gray-800 hover:border-indigo-500 text-gray-400 hover:text-white rounded-xl transition cursor-pointer"
                          title="Open Standalone View"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="mb-2 pr-28">
                        <h4 className="text-xs font-black uppercase text-gray-300">Quantization Error Map</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Spatial quantization error density per neuron cell.</p>
                      </div>
                      <div className="flex-1 min-h-0">
                        <MallaHexagonal 
                          visualizationMode="qe" 
                          initialScale={30} 
                          onNeuronClick={handleNeuronClick}
                          trajectories={hasTrajectories ? availableTrajectories.filter(t => activeTrajectories.has(t.name)) : undefined}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section D: Training Error (Quantization Error over Epochs) Chart Card */}
                {result && result.errors && result.errors.length > 0 && (
                  <div className="pt-4">
                    <TrainingErrorPanel errors={result.errors} />
                  </div>
                )}
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 shadow-2xl flex flex-col items-center justify-center text-gray-400 text-center">
                <TrendingUp className="w-12 h-12 mb-4 text-gray-700 animate-pulse" />
                <p className="text-lg font-medium text-gray-200">The grid has not been trained yet</p>
                <p className="text-sm mt-1 max-w-sm">Configure parameters and execute training under the SOM Training tab to render coordinates.</p>
              </div>
            )}
        </div>

        {/* SUBTAB 4: RESPONSIVE UMAP scatterplot */}
        <div className={subTab === 'umap' ? "space-y-6" : "hidden"}>
            <div className="flex justify-between items-center bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-inner">
              <div className="flex-1 max-w-md">
                <label className="block text-xs text-gray-400 font-semibold mb-2">UMAP Data Source</label>
                <select
                  value={config.umapDataSource || 'original'}
                  onChange={(e) => setConfig({ umapDataSource: e.target.value as any })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="original">Original Data Matrix (High Detail)</option>
                  <option value="weights">SOM Neuron Weights (Fast Outline)</option>
                </select>
                <p className="text-[10px] text-gray-500 mt-2">
                  {(config.umapDataSource as string) === 'original' || (config.umapDataSource as string) === 'data'
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
        </div>
      </div>
    </>
  );
};
