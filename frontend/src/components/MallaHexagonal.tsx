import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import chroma from 'chroma-js';
import { line, curveCatmullRom } from 'd3-shape';
import { useSomStore } from '../store/somStore';
import { RefreshCw, ZoomIn, ZoomOut, Tags, Download, Layers, Sliders } from 'lucide-react';
import { denormalizeValue } from '../utils/normalization';

export interface Trajectory {
  name: string;
  points: { index: number; dataIndex: number }[];
  color: string;
  width?: number;
}

interface MallaHexagonalProps {
  visualizationMode: 'umatrix' | 'clustering' | 'component' | 'frequencies' | 'qe';
  selectedComponentIndex?: number;
  centerReference?: number;
  initialScale?: number;
  colorScale?: 'standard' | 'viridis' | 'cividis';
  onColorScaleChange?: (scale: 'standard' | 'viridis' | 'cividis') => void;
  trajectories?: Trajectory[];
  onNeuronClick?: (neuronIndex: number) => void;
}

export const MallaHexagonal: React.FC<MallaHexagonalProps> = ({
  visualizationMode,
  selectedComponentIndex = 0,
  centerReference,
  initialScale,
  colorScale = 'standard',
  onColorScaleChange,
  trajectories = [],
  onNeuronClick
}) => {
  const { 
    result, 
    config: somConfig,
    dataMatrix,
    originalDataMatrix,
    labels,
    compNames,
    normalizationInfo,
    componentScaleConfigs,
    globalScaleSource,
    setComponentScaleConfig,
    // Label Filters Zustand states & actions
    showLabels,
    labelSearchQuery,
    excludedLabels,
    maxLabelsPerNeuron,
    labelFontSizeScale,
    labelStyleOverrides,
    clusterLabels,
    showClusterLabels,
    showLabelsOnComponents,
    setShowLabels,
    setLabelSearchQuery,
    toggleLabelVisibility,
    setExcludedLabels,
    setMaxLabelsPerNeuron,
    setLabelFontSizeScale,
    setLabelStyleOverride,
    removeLabelStyleOverride,
    setClusterLabel,
    setShowClusterLabels,
    resetLabelFilters
  } = useSomStore();

  const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
  
  // Calculate a scale factor that scales down dynamically for large grid sizes (e.g. 20x20)
  const baseScale = initialScale ?? 60;
  const maxDim = Math.max(somConfig.rows, somConfig.cols);
  const calculatedScale = maxDim > 8 ? Math.max(8, Math.floor(baseScale * (8 / maxDim))) : baseScale;

  const [scale, setScale] = useState(calculatedScale); // pixel scale factor
  const [selectedNeuron, setSelectedNeuron] = useState<number | null>(null);
  const [hoveredNeuron, setHoveredNeuron] = useState<{ index: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Local state to control filters modal visibility and active tab
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'docs' | 'clusters'>('docs');

  // Sync scale if calculatedScale changes (e.g. when grid size changes or new training is loaded)
  useEffect(() => {
    setScale(calculatedScale);
  }, [calculatedScale]);
  
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-700 rounded-2xl h-96 text-gray-400 bg-gray-900 bg-opacity-40">
        <RefreshCw className="w-12 h-12 mb-4 animate-spin text-indigo-500" />
        <p className="text-lg font-medium text-gray-200">The map has not been trained yet</p>
        <p className="text-sm mt-1">Load a CSV dataset or preprocess bibliometrics data, then click "Train SOM".</p>
      </div>
    );
  }

  const { hexGrid, umatrix, clustering, frequencies, quantizationErrors, weights, mappedLabels } = result;
  const { rows, cols } = somConfig;

  // Compute centroid / geometric medoid of each cluster
  const clusterCentroids = useMemo(() => {
    if (!result || !clustering || clustering.length === 0) return [];
    
    const clusterMap = new Map<number, number[]>();
    clustering.forEach((cId, idx) => {
      if (cId === -1 || cId === null || cId === undefined) return;
      if (!clusterMap.has(cId)) clusterMap.set(cId, []);
      clusterMap.get(cId)!.push(idx);
    });

    const centroids: { clusterId: number; x: number; y: number; count: number; color: string }[] = [];

    clusterMap.forEach((neuronIndices, cId) => {
      if (neuronIndices.length === 0) return;
      const avgX = neuronIndices.reduce((sum, idx) => sum + hexGrid[idx].x, 0) / neuronIndices.length;
      const avgY = neuronIndices.reduce((sum, idx) => sum + hexGrid[idx].y, 0) / neuronIndices.length;

      let bestIdx = neuronIndices[0];
      let minDist = Infinity;
      neuronIndices.forEach(idx => {
        const dx = hexGrid[idx].x - avgX;
        const dy = hexGrid[idx].y - avgY;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          bestIdx = idx;
        }
      });

      const hue = (cId * 137.5) % 360;
      const color = chroma.hsl(hue, 0.75, 0.65).hex();

      centroids.push({
        clusterId: cId,
        x: hexGrid[bestIdx].x,
        y: hexGrid[bestIdx].y,
        count: neuronIndices.length,
        color
      });
    });

    return centroids.sort((a, b) => a.clusterId - b.clusterId);
  }, [result, clustering, hexGrid]);

  // Hexagon math constants
  const R = 1.0;
  const apotema = Math.sqrt(3) / 2.0;
  
  // Calculate bounding box in relative grid coordinates
  const maxX = Math.max(...hexGrid.map(n => n.x)) + 1.2 * R;
  const maxY = Math.max(...hexGrid.map(n => n.y)) + 1.2 * R;
  const minX = -1.2 * R;
  const minY = -1.2 * apotema * R;

  // Convert bounding box to pixels for CSS rendered size
  const gridWidth = maxX - minX;
  const gridHeight = maxY - minY;
  const widthPx = gridWidth * scale;
  const heightPx = gridHeight * scale;
  const viewboxStr = `${minX} ${minY} ${gridWidth} ${gridHeight}`;

  // 1. Raw Dataset metrics
  let rawMin = 0, rawMax = 1, rawAvg = 0.5;
  const baseMatrix = (originalDataMatrix && originalDataMatrix.length > 0) ? originalDataMatrix : dataMatrix;
  if (baseMatrix && baseMatrix.length > 0 && selectedComponentIndex < baseMatrix[0].length) {
    const colValues = baseMatrix.map(row => row[selectedComponentIndex]);
    rawMin = Math.min(...colValues);
    rawMax = Math.max(...colValues);
    rawAvg = colValues.reduce((a, b) => a + b, 0) / colValues.length;
  }

  // 2. SOM Neuron Weights metrics (desnormalized)
  let somMin = 0, somMax = 1, somAvg = 0.5;
  if (result?.weights && result.weights.length > 0 && selectedComponentIndex < result.weights[0].length) {
    const denormWeights = result.weights.map(w => denormalizeValue(w[selectedComponentIndex] ?? 0, selectedComponentIndex, normalizationInfo));
    somMin = Math.min(...denormWeights);
    somMax = Math.max(...denormWeights);
    somAvg = denormWeights.reduce((a, b) => a + b, 0) / denormWeights.length;
  }

  // 3. Resolve active scale configuration
  const currentScaleConfig = componentScaleConfigs[selectedComponentIndex] || { source: globalScaleSource };
  const scaleSource = currentScaleConfig.source;

  let compMin = rawMin;
  let compMax = rawMax;
  let compAvg = rawAvg;

  if (scaleSource === 'weights') {
    compMin = somMin;
    compMax = somMax;
    compAvg = somAvg;
  } else if (scaleSource === 'custom') {
    compMin = currentScaleConfig.customMin ?? rawMin;
    compMax = currentScaleConfig.customMax ?? rawMax;
    compAvg = currentScaleConfig.customMid ?? (centerReference ?? rawAvg);
  }

  const effectiveMin = compMin;
  const effectiveMax = compMax === compMin ? compMin + 1e-6 : compMax;
  let effectiveMid = currentScaleConfig.source === 'custom' && currentScaleConfig.customMid !== undefined
    ? currentScaleConfig.customMid
    : (centerReference ?? compAvg);

  if (effectiveMid <= effectiveMin || effectiveMid >= effectiveMax) {
    effectiveMid = (effectiveMin + effectiveMax) / 2.0;
  }

  // Extract all unique labels present in the trained result for selection list
  const uniqueLabels = useMemo(() => {
    if (!result || !result.mappedLabels) return [];
    const set = new Set<string>();
    result.mappedLabels.forEach(list => {
      if (list) {
        list.forEach(label => set.add(label));
      }
    });
    return Array.from(set).sort();
  }, [result]);

  // Filter unique labels based on search query in the modal list
  const filteredUniqueLabels = useMemo(() => {
    if (!labelSearchQuery) return uniqueLabels;
    return uniqueLabels.filter(l => l.toLowerCase().includes(labelSearchQuery.toLowerCase()));
  }, [uniqueLabels, labelSearchQuery]);

  const handleSelectAllLabels = () => setExcludedLabels(new Set<string>());
  const handleClearAllLabels = () => setExcludedLabels(new Set<string>(uniqueLabels));

  // Pre-calculate color scale functions and expensive aggregations to avoid O(N^2) overhead per cell
  const colorScales = useMemo(() => {
    const scales: any = {
      umatrixFn: null,
      freqFn: chroma.scale(['#38a169', '#dd6b20', '#e53e3e']).domain([0, 1]),
      qeFn: chroma.scale(['#cbd5e0', '#4a5568']).domain([0, 1]),
      compFn: null
    };

    if (!result) return scales;

    // 1. U-Matrix Scale
    if (visualizationMode === 'umatrix' && result.umatrix) {
      const flatUmatrix = result.umatrix.flat();
      const minU = Math.min(...flatUmatrix);
      const maxU = Math.max(...flatUmatrix);
      scales.umatrixFn = chroma.scale(['#e53e3e', '#ecc94b']).domain([minU, maxU]);
    }

    // 2. Component Scale
    if (visualizationMode === 'component' && result.weights && result.weights.length > 0) {
      if (colorScale === 'viridis') {
        scales.compFn = chroma.scale(['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'])
          .domain([effectiveMin, (effectiveMin + effectiveMid) / 2, effectiveMid, (effectiveMid + effectiveMax) / 2, effectiveMax]);
      } else if (colorScale === 'cividis') {
        scales.compFn = chroma.scale(['#00204d', '#414d6b', '#7c7b78', '#b9ad71', '#ffea46'])
          .domain([effectiveMin, (effectiveMin + effectiveMid) / 2, effectiveMid, (effectiveMid + effectiveMax) / 2, effectiveMax]);
      } else {
        scales.compFn = chroma.scale(['#38a169', '#ecc94b', '#e53e3e']).domain([effectiveMin, effectiveMid, effectiveMax]);
      }
    }
    return scales;
  }, [visualizationMode, result, selectedComponentIndex, colorScale, effectiveMin, effectiveMid, effectiveMax]);

  // Get color for a specific cell based on visualization mode
  const getCellColor = (neuronIdx: number): string => {
    switch (visualizationMode) {
      case 'umatrix': {
        const row = Math.floor(neuronIdx / cols);
        const col = neuronIdx % cols;
        const val = umatrix[row][col];
        return colorScales.umatrixFn ? colorScales.umatrixFn(val).hex() : '#ffffff';
      }
      
      case 'clustering': {
        const clusterId = clustering[neuronIdx];
        if (clusterId === -1) {
          // DBSCAN Noise
          return '#2d3748';
        }
        // Dynamic golden ratio HSL generation to provide highly distinct colors
        const hue = (clusterId * 137.5) % 360;
        return chroma.hsl(hue, 0.75, 0.65).hex();
      }
      
      case 'frequencies': {
        const val = frequencies[neuronIdx];
        return colorScales.freqFn(val).hex();
      }
      
      case 'qe': {
        const val = quantizationErrors[neuronIdx];
        // Greyscale or black if zero
        if (val === 0) return '#1a202c'; // dark grey/black for empty cells
        return colorScales.qeFn(val).hex();
      }
      
      case 'component': {
        const rawW = weights[neuronIdx]?.[selectedComponentIndex] ?? 0;
        const val = denormalizeValue(rawW, selectedComponentIndex, normalizationInfo);
        const clampedVal = Math.max(effectiveMin, Math.min(effectiveMax, val));
        return colorScales.compFn ? colorScales.compFn(clampedVal).hex() : '#4a5568';
      }
      
      default:
        return '#4a5568';
    }
  };

  // Check neighbors to draw clustering borders
  const getClusteringBorders = (i: number, j: number): string[] => {
    const borderLines: string[] = [];
    const neuronIdx = j + i * cols;
    const clusterId = clustering[neuronIdx];
    
    // Hexagonal neighbors based on column j parity
    const neighborsMap: Record<string, { r: number; c: number; edgeIdxs: [number, number] }> = {
      n1: { r: j % 2 === 0 ? i : i + 1, c: j + 1, edgeIdxs: [0, 1] },     // bottom-right
      n2: { r: i + 1, c: j, edgeIdxs: [1, 2] },                           // bottom
      n3: { r: j % 2 === 0 ? i : i + 1, c: j - 1, edgeIdxs: [2, 3] },     // bottom-left
      n4: { r: j % 2 === 0 ? i - 1 : i, c: j - 1, edgeIdxs: [3, 4] },     // top-left
      n5: { r: i - 1, c: j, edgeIdxs: [4, 5] },                           // top
      n6: { r: j % 2 === 0 ? i - 1 : i, c: j + 1, edgeIdxs: [5, 0] }      // top-right
    };

    // Calculate vertex coordinates for a given cell center (xc, yc) in grid units
    const getHexPoints = (xc: number, yc: number) => {
      return [
        { x: xc + R, y: yc },                               // P1
        { x: xc + 0.5 * R, y: yc + apotema * R },           // P2
        { x: xc - 0.5 * R, y: yc + apotema * R },           // P3
        { x: xc - R, y: yc },                               // P4
        { x: xc - 0.5 * R, y: yc - apotema * R },           // P5
        { x: xc + 0.5 * R, y: yc - apotema * R }            // P6
      ];
    };

    const xc = hexGrid[neuronIdx].x;
    const yc = hexGrid[neuronIdx].y;
    const points = getHexPoints(xc, yc);

    Object.keys(neighborsMap).forEach(key => {
      const { r, c, edgeIdxs } = neighborsMap[key];
      const neighIdx = c + r * cols;
      
      // Draw border if out of bounds (map border) or if belongs to a different cluster
      const isOutOfBounds = r < 0 || r >= rows || c < 0 || c >= cols;
      const isDiffCluster = !isOutOfBounds && clustering[neighIdx] !== clusterId;
      
      if (isOutOfBounds || isDiffCluster) {
        const pStart = points[edgeIdxs[0]];
        const pEnd = points[edgeIdxs[1]];
        borderLines.push(`${pStart.x},${pStart.y} ${pEnd.x},${pEnd.y}`);
      }
    });

    return borderLines;
  };

  // Generate SVG polygon points string for a hexagon centered at (xc, yc) in grid units
  const getHexPolygonPoints = (xc: number, yc: number): string => {
    const points = [
      { x: xc + R, y: yc },
      { x: xc + 0.5 * R, y: yc + apotema * R },
      { x: xc - 0.5 * R, y: yc + apotema * R },
      { x: xc - R, y: yc },
      { x: xc - 0.5 * R, y: yc - apotema * R },
      { x: xc + 0.5 * R, y: yc - apotema * R }
    ];
    return points.map(p => `${p.x},${p.y}`).join(' ');
  };

  // Helper to determine if we should draw labels for the current map viewport
  const shouldRenderLabels = () => {
    if (visualizationMode === 'component') {
      return showLabelsOnComponents;
    }
    return showLabels;
  };

  const handleDownload = (format: 'svg' | 'png') => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgRef.current);
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const svgData = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<?xml version="1.0" standalone="no"?>\r\n' + source);

    if (format === 'svg') {
      const a = document.createElement("a");
      a.href = svgData;
      a.download = `sinapsis_map_${visualizationMode}.svg`;
      a.click();
    } else {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scaleFactor = 3; // High res
      canvas.width = widthPx * scaleFactor;
      canvas.height = heightPx * scaleFactor;
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png", 1.0);
        a.download = `sinapsis_map_${visualizationMode}_highres.png`;
        a.click();
      };
      img.src = svgData;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl relative">
      {/* Visual Controls Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-950 border-b border-gray-800 flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <span className="text-xs uppercase tracking-wider text-gray-500 font-bold mr-1">Zoom</span>
          <button
            onClick={() => setScale(prev => Math.min(240, prev + 10))}
            disabled={scale >= 240}
            className="p-1.5 bg-gray-850 hover:bg-gray-750 disabled:opacity-40 text-gray-200 rounded-lg transition border border-gray-700 shadow-sm"
            title="Zoom In (Etiquetas y celdas más grandes)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setScale(prev => Math.max(8, prev - 5))}
            disabled={scale <= 8}
            className="p-1.5 bg-gray-850 hover:bg-gray-750 disabled:opacity-40 text-gray-200 rounded-lg transition border border-gray-700 shadow-sm"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-mono text-indigo-400 font-bold bg-indigo-950/60 px-2 py-1 rounded border border-indigo-800/40">
            {scale}px
          </span>
        </div>

        {visualizationMode === 'component' && (
          <div className="flex items-center space-x-2">
            <span className="text-xs uppercase tracking-wider text-gray-500 font-bold">Palette</span>
            <select
              value={colorScale}
              onChange={(e) => onColorScaleChange?.(e.target.value as any)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[10px] text-gray-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="standard">Standard (Green-Red)</option>
              <option value="viridis">Viridis (Accessible)</option>
              <option value="cividis">Cividis (Accessible)</option>
            </select>
          </div>
        )}

        {visualizationMode !== 'component' && (
          <div className="flex items-center space-x-6 flex-wrap gap-2">
            {/* Main show labels toggle */}
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                className="w-4 h-4 bg-gray-800 border-gray-700 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
              />
              <span>Show labels</span>
            </label>

            {/* Cluster labels toggle */}
            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer" title="Mostrar/ocultar nombres de cluster en el mapa">
              <input
                type="checkbox"
                checked={showClusterLabels}
                onChange={(e) => setShowClusterLabels(e.target.checked)}
                className="w-4 h-4 bg-gray-800 border-gray-700 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900 cursor-pointer"
              />
              <span>Cluster Labels</span>
            </label>

            {/* Subset filters modal open trigger button & font size controls */}
            {showLabels && shouldRenderLabels() && (
              <>
                <button
                  onClick={() => setIsFilterModalOpen(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5 shadow-lg shadow-indigo-950 cursor-pointer"
                  title="Open Labels Subset Manager"
                >
                  <Tags className="w-3.5 h-3.5" />
                  <span>Label Filters</span>
                </button>

                {/* Quick Font Size Controls */}
                <div className="flex items-center space-x-1 bg-gray-950 px-2.5 py-1 rounded-xl border border-gray-800" title="Ajustar tamaño de fuente de las etiquetas (hasta 1000%)">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">Fuente:</span>
                  <button
                    onClick={() => setLabelFontSizeScale(Math.max(0.4, parseFloat((labelFontSizeScale - 0.2).toFixed(1))))}
                    disabled={labelFontSizeScale <= 0.4}
                    className="px-2 py-0.5 bg-gray-850 hover:bg-gray-750 disabled:opacity-30 text-gray-200 rounded text-[10px] font-black border border-gray-700 transition cursor-pointer"
                    title="Disminuir tamaño de fuente"
                  >
                    A-
                  </button>
                  <span className="text-[10px] font-mono font-bold text-indigo-400 w-11 text-center">
                    {Math.round(labelFontSizeScale * 100)}%
                  </span>
                  <button
                    onClick={() => setLabelFontSizeScale(Math.min(10.0, parseFloat((labelFontSizeScale + 0.2).toFixed(1))))}
                    disabled={labelFontSizeScale >= 10.0}
                    className="px-2 py-0.5 bg-gray-850 hover:bg-gray-750 disabled:opacity-30 text-gray-200 rounded text-[10px] font-black border border-gray-700 transition cursor-pointer"
                    title="Aumentar tamaño de fuente"
                  >
                    A+
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Download actions */}
        <div className="flex items-center space-x-2 ml-auto">
          <button
            onClick={() => handleDownload('png')}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg transition flex items-center space-x-1.5"
            title="Save as High-Res PNG"
          >
            <Download className="w-3.5 h-3.5" />
            <span>PNG</span>
          </button>
          <button
            onClick={() => handleDownload('svg')}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg transition flex items-center space-x-1.5"
            title="Save as Vector SVG"
          >
            <Download className="w-3.5 h-3.5" />
            <span>SVG</span>
          </button>
        </div>
      </div>

      {/* Main Canvas SVG Drawing */}
      <div className="flex-1 relative overflow-hidden flex flex-row items-stretch bg-gray-950">
        <div className="relative flex-1 flex justify-center items-center overflow-auto p-4 min-w-0">
          <svg
            ref={svgRef}
            viewBox={viewboxStr}
            style={{
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              minWidth: `${widthPx}px`,
              minHeight: `${heightPx}px`,
              maxWidth: 'none',
              maxHeight: 'none'
            }}
            className="map-hexagonal-svg transition-all select-none"
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0,0 L 6,3 L 0,6 Z" fill="context-stroke" />
              </marker>
            </defs>
            {useMemo(() => (
              <g>
                {/* 1. Hexagon Cells */}
                {hexGrid.map((neuron) => {
                  const isSelected = selectedNeuron === neuron.index;
                  const fillClr = getCellColor(neuron.index);
                  return (
                    <polygon
                      key={neuron.index}
                      points={getHexPolygonPoints(neuron.x, neuron.y)}
                      fill={fillClr}
                      stroke={isSelected ? '#ffffff' : '#4a5568'}
                      strokeWidth={isSelected ? 0.08 : 0.025}
                      opacity={0.9}
                      className="cursor-pointer transition-colors duration-150 hover:opacity-100"
                      onClick={() => {
                        setSelectedNeuron(neuron.index);
                        onNeuronClick?.(neuron.index);
                      }}
                      onMouseEnter={(e) => setHoveredNeuron({ index: neuron.index, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setHoveredNeuron({ index: neuron.index, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredNeuron(null)}
                    />
                  );
                })}

                {/* 2. Cluster Contours / Frontiers */}
                {hexGrid.map((neuron) => {
                  const borders = getClusteringBorders(neuron.row, neuron.col);
                  return borders.map((bStr, idx) => {
                    const [p1, p2] = bStr.split(' ');
                    const [x1, y1] = p1.split(',');
                    const [x2, y2] = p2.split(',');
                    return (
                      <line
                        key={`${neuron.index}_b_${idx}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#000000"
                        strokeWidth={0.06}
                        strokeLinecap="round"
                        className="pointer-events-none"
                      />
                    );
                  });
                })}

                {/* 3. Spline PATH Trajectories (PathSOM) */}
                {trajectories.map((traj, idx) => {
                  if (traj.points.length < 2) return null;

                  // Create coords for the spline in grid units
                  const coords = traj.points.map(p => {
                    const node = hexGrid[p.index];
                    return [node.x, node.y] as [number, number];
                  });

                  const lineGen = line()
                    .curve(curveCatmullRom.alpha(0.5))
                    .x(d => d[0])
                    .y(d => d[1]);

                  const pathData = lineGen(coords) || '';

                  return (
                    <g key={`traj_${idx}_${traj.name}`}>
                      <path
                        d={pathData}
                        fill="none"
                        stroke={traj.color}
                        strokeWidth={(traj.width || 2) * 0.035}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        markerEnd="url(#arrowhead)"
                        className="transition-all duration-300"
                        style={{ filter: 'drop-shadow(0px 0.05px 0.1px rgba(0,0,0,0.8))' }}
                      />
                      
                      {/* Trajectory waypoints (dots) */}
                      {coords.map((c, i) => (
                        <circle
                          key={`traj_p_${idx}_${i}`}
                          cx={c[0]}
                          cy={c[1]}
                          r={(traj.width || 2) * 0.045}
                          fill={traj.color}
                          stroke="#050508"
                          strokeWidth={0.02}
                        />
                      ))}
                      
                      {/* Trajectory specific labels */}
                      {coords.map((c, i) => {
                        const dataIndex = traj.points[i].dataIndex;
                        const labelText = labels[dataIndex];
                        if (!labelText) return null;
                        const trajFontSize = 0.55 * labelFontSizeScale;
                        return (
                          <text
                            key={`traj_lbl_${idx}_${i}`}
                            x={c[0]}
                            y={c[1] - (traj.width || 2) * 0.045 - (trajFontSize * 0.45)}
                            textAnchor="middle"
                            dominantBaseline="alphabetic"
                            fill={traj.color}
                            stroke="#050508"
                            strokeWidth={`${Math.max(0.04, trajFontSize * 0.22).toFixed(3)}`}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            fontSize={`${trajFontSize.toFixed(3)}`}
                            fontWeight="900"
                            className="font-sans select-none pointer-events-none uppercase tracking-tight"
                            style={{ filter: 'drop-shadow(0px 0.08px 0.15px rgba(0,0,0,0.95))' }}
                          >
                            {labelText}
                          </text>
                        );
                      })}
                    </g>
                  );
                })}

                {/* 4. Flat, Centered SVG Document Labels Overlays (Scales dynamically with Zoom & Manual Font Scale) */}
                {shouldRenderLabels() &&
                  hexGrid.map((neuron) => {
                    const docList = mappedLabels[neuron.index] || [];
                    if (docList.length === 0) return null;

                    const filteredDocs = docList
                      .filter(label => {
                        if (labelSearchQuery && !label.toLowerCase().includes(labelSearchQuery.toLowerCase())) {
                          return false;
                        }
                        if (excludedLabels.has(label)) {
                          return false;
                        }
                        return true;
                      })
                      .slice(0, maxLabelsPerNeuron);

                    if (filteredDocs.length === 0) return null;

                    const xc = neuron.x;
                    const yc = neuron.y;

                    // Generous base size so labels are prominently readable even in large grids
                    const baseSize = 0.55 * R;
                    const dynamicFontSize = (filteredDocs.length > 1 
                      ? Math.min(baseSize, (2.2 * apotema * R) / (filteredDocs.length * 1.15)) 
                      : baseSize) * labelFontSizeScale;
                    const lineSpacing = dynamicFontSize * 1.15;

                    return (
                      <g key={`lbl_group_${neuron.index}`} className="pointer-events-none">
                        {filteredDocs.map((label, idx) => {
                          const yOffset = (idx - (filteredDocs.length - 1) / 2) * lineSpacing;
                          const customStyle = labelStyleOverrides[label];
                          const customColor = customStyle?.color;
                          const customSizeMult = customStyle?.sizeMultiplier ?? 1.0;
                          const effectiveFontSize = dynamicFontSize * customSizeMult;

                          return (
                            <text
                              key={`${label}_${idx}`}
                              x={xc}
                              y={yc + yOffset}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fill={customColor || "#ffffff"}
                              stroke="#050508"
                              strokeWidth={`${Math.max(0.04, effectiveFontSize * 0.22).toFixed(3)}`}
                              paintOrder="stroke fill"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              fontSize={`${effectiveFontSize.toFixed(3)}`}
                              fontWeight="900"
                              className="font-sans select-none pointer-events-none uppercase tracking-tight"
                              style={{ filter: 'drop-shadow(0px 0.06px 0.12px rgba(0,0,0,0.95))' }}
                            >
                              {label}
                            </text>
                          );
                        })}
                      </g>
                    );
                  })}

                {/* 5. Prominent Cluster Labels / Badges (Centered at cluster medoid) */}
                {showClusterLabels && clusterCentroids.map((c) => {
                  const clusterText = clusterLabels[c.clusterId] !== undefined && clusterLabels[c.clusterId] !== ''
                    ? clusterLabels[c.clusterId]
                    : `Cluster ${c.clusterId + 1}`;
                  
                  if (!clusterText) return null;
                  const badgeFontSize = 0.70 * labelFontSizeScale;

                  return (
                    <g key={`cluster_badge_${c.clusterId}`} className="pointer-events-none select-none">
                      <text
                        x={c.x}
                        y={c.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#ffffff"
                        stroke="#000000"
                        strokeWidth={`${Math.max(0.08, badgeFontSize * 0.32).toFixed(3)}`}
                        paintOrder="stroke fill"
                        strokeLinejoin="round"
                        fontSize={`${badgeFontSize.toFixed(3)}`}
                        fontWeight="900"
                        className="font-sans uppercase tracking-wider"
                        style={{ filter: 'drop-shadow(0px 0.1px 0.25px rgba(0,0,0,0.95))' }}
                      >
                        {clusterText}
                      </text>
                    </g>
                  );
                })}
              </g>
            ), [
              hexGrid, 
              selectedNeuron, 
              clustering, 
              scale, 
              colorScales,
              visualizationMode,
              showLabels,
              showClusterLabels,
              showLabelsOnComponents,
              mappedLabels,
              excludedLabels,
              labelSearchQuery,
              maxLabelsPerNeuron,
              labelFontSizeScale,
              labelStyleOverrides,
              clusterLabels,
              clusterCentroids,
              trajectories,
              labels,
              onNeuronClick
            ])}
          </svg>
        </div>

        {/* Color Bar Legend for Component Maps */}
        {visualizationMode === 'component' && (
          <div 
            className="flex flex-col items-center justify-between px-2 py-3 border-l border-gray-800 bg-gray-900/60 select-none group relative"
            style={{ flexShrink: 0, width: '68px', maxWidth: '68px' }}
          >
            {/* Settings trigger */}
            <button
              onClick={() => setIsScaleModalOpen(true)}
              className="p-1 hover:bg-gray-800 text-gray-400 hover:text-indigo-400 rounded-md transition mb-1 cursor-pointer flex items-center space-x-1"
              title="Adjust color range and reference scale"
            >
              <Sliders className="w-3 h-3" />
              <span className="text-[8px] font-bold uppercase tracking-wider">{scaleSource === 'custom' ? 'Manual' : scaleSource === 'weights' ? 'SOM' : 'Raw'}</span>
            </button>

            <span className="text-[9px] font-bold text-gray-300 font-mono truncate max-w-[60px]" title={`Maximum: ${effectiveMax}`}>
              {effectiveMax >= 1000 ? effectiveMax.toExponential(2) : effectiveMax.toFixed(2)}
            </span>
            
            <div 
              onClick={() => setIsScaleModalOpen(true)}
              className="relative rounded-full shadow-inner my-1 cursor-pointer hover:ring-2 hover:ring-indigo-500/50 transition-all"
              title="Click to adjust color range and reference value"
              style={{
                width: '12px',
                minWidth: '12px',
                height: '110px',
                background: colorScale === 'standard'
                  ? 'linear-gradient(to bottom, #e53e3e, #ecc94b, #38a169)'
                  : colorScale === 'viridis'
                    ? 'linear-gradient(to bottom, #fde725, #5ec962, #21918c, #3b528b, #440154)'
                    : 'linear-gradient(to bottom, #ffea46, #b9ad71, #7c7b78, #414d6b, #00204d)'
              }}
            >
              {/* Mid / Average indicator line */}
              <div 
                className="absolute bg-white z-10 rounded-full shadow-md" 
                style={{ 
                  width: '20px', 
                  height: '2px', 
                  left: '-4px', 
                  top: `${Math.max(0, Math.min(100, 100 - ((effectiveMid - effectiveMin) / (effectiveMax - effectiveMin || 1)) * 100))}%` 
                }}
                title={`Center / Reference Value: ${effectiveMid.toFixed(2)}`}
              />
            </div>
            
            <span className="text-[9px] font-bold text-gray-300 font-mono truncate max-w-[60px]" title={`Minimum: ${effectiveMin}`}>
              {effectiveMin >= 1000 ? effectiveMin.toExponential(2) : effectiveMin.toFixed(2)}
            </span>
            
            <button
              onClick={() => setIsScaleModalOpen(true)}
              className="mt-2 pt-1 border-t border-gray-800 w-full flex flex-col items-center hover:bg-gray-800/60 rounded py-0.5 transition cursor-pointer" 
              title={`Center / Reference: ${effectiveMid.toFixed(2)} (Click to configure)`}
            >
              <span className="text-[7px] text-gray-500 font-bold uppercase tracking-wider">{scaleSource === 'custom' ? 'Ref' : 'Mean'}</span>
              <span className="text-[8px] font-bold text-indigo-300 font-mono truncate max-w-[60px]">
                {effectiveMid.toFixed(2)}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* COMPONENT CHROMATIC SCALE & REFERENCE MODAL */}
      {isScaleModalOpen && visualizationMode === 'component' && (
        <div className="absolute inset-0 bg-gray-950/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-all">
          <div className="bg-gray-900 border border-gray-800 w-full max-w-sm rounded-2xl p-5 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-black uppercase text-gray-200 tracking-wider">
                  Chromatic Scale Range {compNames && compNames[selectedComponentIndex] ? `(${compNames[selectedComponentIndex]})` : `#${selectedComponentIndex + 1}`}
                </h3>
              </div>
              <button 
                onClick={() => setIsScaleModalOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-300 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Source Selection Tabs */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                Calculation Source:
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-950 rounded-xl border border-gray-800">
                <button
                  type="button"
                  onClick={() => setComponentScaleConfig(selectedComponentIndex, { source: 'raw' })}
                  className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    scaleSource === 'raw' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Raw Data
                </button>
                <button
                  type="button"
                  onClick={() => setComponentScaleConfig(selectedComponentIndex, { source: 'weights' })}
                  className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    scaleSource === 'weights' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  SOM Weights
                </button>
                <button
                  type="button"
                  onClick={() => setComponentScaleConfig(selectedComponentIndex, { 
                    source: 'custom',
                    customMin: currentScaleConfig.customMin ?? compMin,
                    customMid: currentScaleConfig.customMid ?? compAvg,
                    customMax: currentScaleConfig.customMax ?? compMax
                  })}
                  className={`py-1.5 px-2 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    scaleSource === 'custom' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Custom Range
                </button>
              </div>
            </div>

            {/* Scale Presets and Manual Controls */}
            {scaleSource === 'custom' ? (
              <div className="space-y-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-indigo-400">Range Values:</span>
                  <span className="text-[9px] text-gray-500">Manual adjustment</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[9px] text-gray-400 mb-1 font-semibold">Minimum</label>
                    <input 
                      type="number"
                      step="any"
                      value={currentScaleConfig.customMin ?? compMin}
                      onChange={(e) => setComponentScaleConfig(selectedComponentIndex, { customMin: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-indigo-300 mb-1 font-bold">Center (Ref)</label>
                    <input 
                      type="number"
                      step="any"
                      value={currentScaleConfig.customMid ?? compAvg}
                      onChange={(e) => setComponentScaleConfig(selectedComponentIndex, { customMid: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-gray-900 border border-indigo-500/80 rounded-lg px-2 py-1 text-xs text-indigo-200 font-mono font-bold focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-gray-400 mb-1 font-semibold">Maximum</label>
                    <input 
                      type="number"
                      step="any"
                      value={currentScaleConfig.customMax ?? compMax}
                      onChange={(e) => setComponentScaleConfig(selectedComponentIndex, { customMax: parseFloat(e.target.value) || 1 })}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="pt-2 border-t border-gray-800 space-y-1.5">
                  <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Bibliometric Presets:</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setComponentScaleConfig(selectedComponentIndex, {
                        source: 'custom',
                        customMin: 0,
                        customMid: 1.0,
                        customMax: Math.max(2.5, Math.ceil(rawMax * 10) / 10)
                      })}
                      className="px-2 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 text-[9px] font-semibold rounded-lg transition cursor-pointer"
                      title="Category Normalized Citation Impact: Center at 1.0 (World average)"
                    >
                      CNCI (Ref: 1.0)
                    </button>
                    <button
                      type="button"
                      onClick={() => setComponentScaleConfig(selectedComponentIndex, {
                        source: 'custom',
                        customMin: 0,
                        customMid: 1.0,
                        customMax: Math.max(3.0, Math.ceil(rawMax * 10) / 10)
                      })}
                      className="px-2 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 text-[9px] font-semibold rounded-lg transition cursor-pointer"
                      title="% Top 1% Most Cited Documents: Center at 1.0%"
                    >
                      % Top 1% (Ref: 1.0)
                    </button>
                    <button
                      type="button"
                      onClick={() => setComponentScaleConfig(selectedComponentIndex, {
                        source: 'custom',
                        customMin: 0,
                        customMid: 10.0,
                        customMax: Math.max(25.0, Math.ceil(rawMax * 10) / 10)
                      })}
                      className="px-2 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 text-[9px] font-semibold rounded-lg transition cursor-pointer"
                      title="% Top 10% Most Cited Documents: Center at 10.0%"
                    >
                      % Top 10% (Ref: 10.0)
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-950/70 p-3 rounded-xl border border-gray-800 text-[11px] space-y-2">
                <div className="flex justify-between text-gray-400">
                  <span>Minimum:</span>
                  <span className="font-mono text-gray-200 font-bold">{compMin.toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-indigo-300 font-semibold">
                  <span>Mean ({scaleSource === 'weights' ? 'SOM' : 'Raw Data'}):</span>
                  <span className="font-mono font-bold">{compAvg.toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Maximum:</span>
                  <span className="font-mono text-gray-200 font-bold">{compMax.toFixed(3)}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-2 pt-2 border-t border-gray-800">
              <button
                type="button"
                onClick={() => {
                  setComponentScaleConfig(selectedComponentIndex, { source: globalScaleSource });
                  setIsScaleModalOpen(false);
                }}
                className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setIsScaleModalOpen(false)}
                className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}



      {/* 5. INTERACTIVE POP-UP MODAL: LABEL FILTER MANAGER */}
      {isFilterModalOpen && (
        <div className="absolute inset-0 bg-gray-950 bg-opacity-80 backdrop-blur-xs z-50 flex items-center justify-center p-6 transition-all duration-300">
          <div className="bg-gray-900 border border-gray-800 w-full max-w-md rounded-2xl p-6 shadow-2xl flex flex-col max-h-[90%] space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center space-x-2">
                <Tags className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-black uppercase text-gray-200 tracking-wider">Label Filter & Style Manager</h3>
              </div>
              <button 
                onClick={() => setIsFilterModalOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-300 font-bold uppercase tracking-wider cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-800 -mx-6 px-6">
              <button
                onClick={() => setModalTab('docs')}
                className={`flex-1 pb-2.5 text-xs font-bold flex items-center justify-center space-x-1.5 transition border-b-2 cursor-pointer ${
                  modalTab === 'docs'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <Tags className="w-3.5 h-3.5" />
                <span>Document Labels ({uniqueLabels.length})</span>
              </button>
              <button
                onClick={() => setModalTab('clusters')}
                className={`flex-1 pb-2.5 text-xs font-bold flex items-center justify-center space-x-1.5 transition border-b-2 cursor-pointer ${
                  modalTab === 'clusters'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Cluster Labels ({clusterCentroids.length})</span>
              </button>
            </div>

            {modalTab === 'docs' ? (
              <>
                {/* Density Limiter Counter Component */}
                <div className="flex items-center justify-between bg-gray-950 p-3 rounded-xl border border-gray-850">
                  <span className="text-xs text-gray-400 font-bold">Max labels per hexagon:</span>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => setMaxLabelsPerNeuron(Math.max(1, maxLabelsPerNeuron - 1))}
                      className="w-7 h-7 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 rounded-lg flex items-center justify-center font-black text-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                      disabled={maxLabelsPerNeuron <= 1}
                    >
                      -
                    </button>
                    <span className="text-sm text-white font-black w-6 text-center">{maxLabelsPerNeuron}</span>
                    <button
                      onClick={() => setMaxLabelsPerNeuron(Math.min(15, maxLabelsPerNeuron + 1))}
                      className="w-7 h-7 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 rounded-lg flex items-center justify-center font-black text-gray-200 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                      disabled={maxLabelsPerNeuron >= 15}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Manual Font Size Scale Slider */}
                <div className="bg-gray-950 p-3 rounded-xl border border-gray-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 font-bold">Global Font Size Scale:</span>
                    <span className="text-xs font-mono font-black text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">
                      {Math.round(labelFontSizeScale * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[9px] text-gray-500 font-bold">40%</span>
                    <input
                      type="range"
                      min="0.4"
                      max="10.0"
                      step="0.1"
                      value={labelFontSizeScale}
                      onChange={(e) => setLabelFontSizeScale(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <span className="text-[9px] text-gray-500 font-bold">1000%</span>
                  </div>
                </div>

                {/* Instant Search Bar */}
                <div className="space-y-1.5">
                  <label className="block text-[9px] text-gray-500 font-bold uppercase tracking-wider">Search Keywords / Years / Authors</label>
                  <input
                    type="text"
                    placeholder="Type to filter labels..."
                    value={labelSearchQuery}
                    onChange={(e) => setLabelSearchQuery(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-850 rounded-xl px-4 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Subsets checkboxes list header */}
                <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-gray-500 pt-2 border-t border-gray-850">
                  <span>MAPPED LABELS ({uniqueLabels.length})</span>
                  <div className="flex space-x-3">
                    <button 
                      onClick={handleSelectAllLabels}
                      className="text-indigo-400 hover:text-indigo-300 uppercase tracking-widest font-black cursor-pointer text-[9px]"
                    >
                      Select All
                    </button>
                    <button 
                      onClick={handleClearAllLabels}
                      className="text-amber-500 hover:text-amber-400 uppercase tracking-widest font-black cursor-pointer text-[9px]"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {/* Scrollable list container with individual color & size customization */}
                <div className="flex-1 overflow-auto bg-gray-950 border border-gray-850 rounded-xl p-2.5 max-h-[220px] space-y-1.5">
                  {filteredUniqueLabels.length > 0 ? (
                    filteredUniqueLabels.map((label, idx) => {
                      const isChecked = !excludedLabels.has(label);
                      const customStyle = labelStyleOverrides[label];
                      const customColor = customStyle?.color || '#ffffff';
                      const customSizeMult = customStyle?.sizeMultiplier ?? 1.0;
                      const hasCustomStyle = !!customStyle && (customStyle.color !== undefined || (customStyle.sizeMultiplier !== undefined && customStyle.sizeMultiplier !== 1.0));

                      return (
                        <div 
                          key={idx} 
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition ${
                            hasCustomStyle 
                              ? 'bg-indigo-950/30 border-indigo-700/50' 
                              : 'bg-gray-900/50 border-gray-850/80 hover:border-gray-750'
                          }`}
                        >
                          <label className="flex items-center space-x-2.5 text-xs text-gray-300 hover:text-gray-100 cursor-pointer min-w-0 flex-1 mr-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleLabelVisibility(label)}
                              className="w-3.5 h-3.5 bg-gray-900 border-gray-750 rounded text-indigo-500 focus:ring-indigo-500 shrink-0"
                            />
                            <span 
                              className="truncate font-bold text-xs"
                              style={{ color: customStyle?.color || undefined }}
                              title={label}
                            >
                              {label}
                            </span>
                          </label>

                          {/* Individual color & size controls */}
                          <div className="flex items-center space-x-1.5 shrink-0">
                            {/* Custom Color input */}
                            <div className="relative flex items-center" title="Color individual de fuente">
                              <input
                                type="color"
                                value={customColor}
                                onChange={(e) => setLabelStyleOverride(label, { color: e.target.value })}
                                className="w-4 h-4 rounded-full border border-gray-600 cursor-pointer bg-transparent appearance-none p-0 overflow-hidden"
                                style={{ backgroundColor: customColor }}
                              />
                            </div>

                            {/* Individual Size Multiplier */}
                            <select
                              value={customSizeMult}
                              onChange={(e) => setLabelStyleOverride(label, { sizeMultiplier: parseFloat(e.target.value) })}
                              className="bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-200 px-1 py-0.5 font-mono cursor-pointer"
                              title="Tamaño individual de la etiqueta"
                            >
                              <option value="0.6">0.6x</option>
                              <option value="0.8">0.8x</option>
                              <option value="1.0">1.0x</option>
                              <option value="1.5">1.5x</option>
                              <option value="2.0">2.0x</option>
                              <option value="2.5">2.5x</option>
                              <option value="3.0">3.0x</option>
                              <option value="4.0">4.0x</option>
                            </select>

                            {/* Reset individual button */}
                            {hasCustomStyle && (
                              <button
                                onClick={() => removeLabelStyleOverride(label)}
                                className="text-xs text-gray-500 hover:text-red-400 font-bold px-1 cursor-pointer transition"
                                title="Restablecer estilo predeterminado para esta etiqueta"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-gray-600 block text-center py-4">No matching labels found.</span>
                  )}
                </div>

                {/* Reset Filters action */}
                <button
                  onClick={resetLabelFilters}
                  className="w-full py-2.5 bg-gray-850 hover:bg-gray-800 text-gray-300 text-xs font-bold rounded-xl transition uppercase tracking-wider cursor-pointer"
                >
                  Reset All Filters & Custom Styles
                </button>
              </>
            ) : (
              <>
                {/* Cluster Labels Tab Content */}
                <div className="flex items-center justify-between bg-gray-950 p-3 rounded-xl border border-gray-850">
                  <div>
                    <span className="text-xs text-gray-200 font-bold block">Show Cluster Labels on Map</span>
                    <span className="text-[10px] text-gray-500">Display thematic titles centered at each cluster</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showClusterLabels}
                    onChange={(e) => setShowClusterLabels(e.target.checked)}
                    className="w-4 h-4 bg-gray-900 border-gray-700 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                {/* Cluster Font Size Scale Slider */}
                <div className="bg-gray-950 p-3 rounded-xl border border-gray-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 font-bold">Cluster Labels Font Scale:</span>
                    <span className="text-xs font-mono font-black text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">
                      {Math.round(labelFontSizeScale * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[9px] text-gray-500 font-bold">40%</span>
                    <input
                      type="range"
                      min="0.4"
                      max="10.0"
                      step="0.1"
                      value={labelFontSizeScale}
                      onChange={(e) => setLabelFontSizeScale(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <span className="text-[9px] text-gray-500 font-bold">1000%</span>
                  </div>
                </div>

                {/* Cluster list title */}
                <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 pt-1 border-t border-gray-850">
                  <span>ACTIVE CLUSTERS & THEMATIC NAMES ({clusterCentroids.length})</span>
                </div>

                {/* Scrollable list of clusters for direct renaming */}
                <div className="flex-1 overflow-auto bg-gray-950 border border-gray-850 rounded-xl p-2.5 max-h-[220px] space-y-2">
                  {clusterCentroids.length > 0 ? (
                    clusterCentroids.map((c) => {
                      const currentText = clusterLabels[c.clusterId] ?? '';
                      return (
                        <div key={c.clusterId} className="bg-gray-900/60 border border-gray-850 p-2.5 rounded-xl flex flex-col space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <div className="w-3.5 h-3.5 rounded-full border border-gray-700 shadow-sm shrink-0" style={{ backgroundColor: c.color }} />
                              <span className="text-xs font-black text-gray-200">Cluster {c.clusterId + 1}</span>
                              <span className="text-[10px] text-gray-500 font-mono">({c.count} neuronas)</span>
                            </div>
                            {currentText && (
                              <button
                                onClick={() => setClusterLabel(c.clusterId, '')}
                                className="text-[10px] text-amber-500 hover:text-amber-400 font-bold cursor-pointer uppercase tracking-wider"
                              >
                                Revert Default
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            placeholder={`e.g. Economías Emergentes / OECD...`}
                            value={currentText}
                            onChange={(e) => setClusterLabel(c.clusterId, e.target.value)}
                            className="w-full bg-gray-950 border border-gray-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none transition"
                          />
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-gray-600 block text-center py-4">No active clusters found.</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 5. Floating Hover Tooltip: Mapped Units (up to 5) via Portal */}
      {hoveredNeuron && result && createPortal(
        (() => {
          // Resolve mapped labels for hovered neuron with fallbacks
          let allMapped: string[] = [];
          if (mappedLabels && mappedLabels[hoveredNeuron.index] && mappedLabels[hoveredNeuron.index].length > 0) {
            allMapped = mappedLabels[hoveredNeuron.index];
          } else if (result.bmus && labels && labels.length > 0) {
            result.bmus.forEach((bmuIdx, dIdx) => {
              if (bmuIdx === hoveredNeuron.index && labels[dIdx]) {
                allMapped.push(labels[dIdx]);
              }
            });
          }

          const displayList = allMapped.slice(0, 5);
          const extraCount = Math.max(0, allMapped.length - 5);
          const clusterId = result.clustering ? result.clustering[hoveredNeuron.index] : null;

          return (
            <div 
              className="fixed z-[99999] pointer-events-none bg-[#090d16]/95 border border-[#1e293b] rounded-xl p-3 shadow-2xl backdrop-blur-md max-w-xs text-xs text-gray-200"
              style={{
                left: Math.min(window.innerWidth - 250, hoveredNeuron.x + 14),
                top: Math.min(window.innerHeight - 200, hoveredNeuron.y + 14)
              }}
            >
              <div className="flex items-center justify-between border-b border-gray-800 pb-1.5 mb-2 gap-3">
                <span className="font-black text-indigo-400 text-[11px] uppercase tracking-wider">
                  Neuron #{hoveredNeuron.index}
                </span>
                {clusterId !== null && clusterId !== -1 && (
                  <span className="px-1.5 py-0.5 bg-purple-900/60 border border-purple-500/50 text-purple-200 text-[9px] font-bold rounded">
                    {(clusterLabels && clusterLabels[clusterId]) || `Cluster ${clusterId + 1}`}
                  </span>
                )}
              </div>

              {visualizationMode === 'component' && result.weights && (
                <div className="mb-2 py-1 px-2 bg-gray-900/80 rounded-lg border border-gray-800 flex items-center justify-between text-[10px]">
                  <span className="text-gray-400 font-semibold">Neuron Weight:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {(() => {
                      const rawW = result.weights[hoveredNeuron.index]?.[selectedComponentIndex] ?? 0;
                      const denormW = denormalizeValue(rawW, selectedComponentIndex, normalizationInfo);
                      const formatted = Math.abs(denormW) < 0.001 && denormW !== 0
                        ? denormW.toExponential(3)
                        : Math.abs(denormW) < 1 && !Number.isInteger(denormW)
                          ? denormW.toFixed(4)
                          : Number.isInteger(denormW)
                            ? denormW.toLocaleString()
                            : denormW.toFixed(2);
                      return `${formatted} ${normalizationInfo ? `(Norm: ${rawW.toFixed(3)})` : ''}`;
                    })()}
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">
                  Mapped Units ({allMapped.length}):
                </p>
                {displayList.length > 0 ? (
                  <ul className="space-y-1">
                    {displayList.map((unitName, i) => (
                      <li key={i} className="flex items-center space-x-1.5 text-[11px] text-gray-200 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                        <span className="truncate">{unitName}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">No units mapped to this cell</p>
                )}

                {extraCount > 0 && (
                  <p className="text-[10px] text-indigo-400 font-semibold pt-1">
                    + {extraCount} more unit{extraCount > 1 ? 's' : ''}...
                  </p>
                )}
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
};
