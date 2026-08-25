import React, { useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  CartesianGrid, Legend
} from 'recharts';
import type { ChartSnapshot } from '../store/aiStore';
import { Eye, Image as ImageIcon, Download, Copy, Check, Layers, Sparkles } from 'lucide-react';

interface InteractiveChartViewerProps {
  snapshot: ChartSnapshot;
  onOpenOriginal?: () => void;
}

export const InteractiveChartViewer: React.FC<InteractiveChartViewerProps> = ({ snapshot }) => {
  const [viewMode, setViewMode] = useState<'svg' | 'interactive' | 'image'>(
    snapshot.svgMarkup ? 'svg' : 'interactive'
  );
  const [copied, setCopied] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<any>(null);

  const { chartType, data, config, thumbnailPng, svgMarkup } = snapshot;

  const handleCopyData = () => {
    try {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy data', e);
    }
  };

  const handleDownloadPng = () => {
    if (!thumbnailPng) return;
    const a = document.createElement('a');
    a.href = thumbnailPng;
    a.download = `${snapshot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.png`;
    a.click();
  };

  const handleDownloadSvg = () => {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_vector.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 1. Render Bubble Chart
  const renderBubbleChart = () => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const xKey = config?.xAxisKey || 'cnci' || 'x';
    const yKey = config?.yAxisKey || 'docs' || 'y';
    const zKey = config?.sizeKey || 'timesCited' || 'z';
    const nameKey = config?.nameKey || 'name' || 'entity';

    return (
      <div className="w-full h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.5} />
            <XAxis 
              dataKey={xKey} 
              name={config?.labels?.[xKey] || 'CNCI / Impacto'} 
              stroke="#9CA3AF" 
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              domain={['auto', 'auto']}
            />
            <YAxis 
              dataKey={yKey} 
              name={config?.labels?.[yKey] || 'Documentos'} 
              stroke="#9CA3AF" 
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              domain={['auto', 'auto']}
            />
            <ZAxis dataKey={zKey} range={[60, 400]} />
            <Tooltip 
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const p = payload[0].payload;
                  return (
                    <div className="bg-gray-950/95 border border-indigo-500/50 p-3 rounded-xl shadow-xl text-xs space-y-1 backdrop-blur-sm z-50">
                      <div className="font-bold text-indigo-300 border-b border-gray-800 pb-1">{p[nameKey] || p.title || 'Entidad'}</div>
                      <div className="text-gray-300">
                        <span className="text-gray-400">{config?.labels?.[xKey] || 'Eje X'}:</span> <strong className="text-white">{p[xKey]}</strong>
                      </div>
                      <div className="text-gray-300">
                        <span className="text-gray-400">{config?.labels?.[yKey] || 'Eje Y'}:</span> <strong className="text-white">{p[yKey]}</strong>
                      </div>
                      {p[zKey] !== undefined && (
                        <div className="text-gray-300">
                          <span className="text-gray-400">{config?.labels?.[zKey] || 'Tamaño'}:</span> <strong className="text-white">{p[zKey]}</strong>
                        </div>
                      )}
                      {p.percentile !== undefined && (
                        <div className="text-gray-300">
                          <span className="text-gray-400">% Percentil:</span> <strong className="text-emerald-400">{p.percentile}%</strong>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Scatter name="Entidades" data={data} fill="#6366f1" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 2. Render Trend / Time Series Chart
  const renderTrendChart = () => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const xKey = config?.xAxisKey || 'year' || 'period';
    const seriesKeys = config?.seriesKeys || Object.keys(data[0] || {}).filter(k => k !== xKey && typeof data[0][k] === 'number');
    const colors = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#a78bfa', '#fb7185'];

    return (
      <div className="w-full h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.4} />
            <XAxis dataKey={xKey} stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#030712', borderColor: '#4f46e5', borderRadius: '0.75rem', fontSize: '12px' }}
              itemStyle={{ color: '#e0e7ff' }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
            {seriesKeys.slice(0, 7).map((key: string, idx: number) => (
              <Line 
                key={key} 
                type="monotone" 
                dataKey={key} 
                name={config?.labels?.[key] || key} 
                stroke={colors[idx % colors.length]} 
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 3. Render Bar Chart
  const renderBarChart = () => {
    if (!Array.isArray(data) || data.length === 0) return null;
    
    // Check if this is a Quartiles stacked bar dataset (contains Q1, Q2, Q3, Q4)
    const isQuartileData = data.some((d: any) => d && (d.Q1 !== undefined || d.Q2 !== undefined || d.Q3 !== undefined || d.Q4 !== undefined));
    if (isQuartileData) {
      const chartHeight = Math.max(340, Math.min(data.length * 28, 500));
      return (
        <div className="w-full overflow-y-auto custom-scrollbar" style={{ maxHeight: '420px' }}>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height={chartHeight} minHeight={300}>
              <BarChart data={data} layout="vertical" margin={{ top: 5, right: 25, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} opacity={0.4} />
                <XAxis type="number" domain={[0, 100]} stroke="#9CA3AF" tick={{ fontSize: 10, fill: '#9CA3AF' }} unit="%" />
                <YAxis dataKey="entity" type="category" width={150} stroke="#9CA3AF" tick={{ fontSize: 9, fill: '#cbd5e1' }} interval={0} />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    return (
                      <div className="bg-gray-900 border border-gray-700 p-2.5 rounded-xl shadow-xl text-xs space-y-1 z-50">
                        <p className="font-bold text-gray-200 border-b border-gray-800 pb-1 mb-1">{label}</p>
                        {payload.map((entry: any, i: number) => (
                          <div key={i} className="flex items-center justify-between space-x-4">
                            <span className="font-medium" style={{ color: entry.fill }}>
                              {entry.name}:
                            </span>
                            <span className="font-bold text-gray-200 ml-2">
                              {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}%
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px', color: '#cbd5e1' }} />
                <Bar dataKey="Q1" name="Q1 (Top 25%)" stackId="q" fill="#6366f1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Q2" name="Q2 (25%-50%)" stackId="q" fill="#34d399" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Q3" name="Q3 (50%-75%)" stackId="q" fill="#fbbf24" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Q4" name="Q4 (75%-100%)" stackId="q" fill="#f87171" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    const xKey = config?.xAxisKey || (data[0]?.entity !== undefined ? 'entity' : 'name');
    const yKey = config?.yAxisKey || (data[0]?.value !== undefined ? 'value' : 'docs');

    return (
      <div className="w-full h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.slice(0, 25)} margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.4} />
            <XAxis dataKey={xKey} stroke="#9CA3AF" angle={-35} textAnchor="end" interval={0} height={55} tick={{ fill: '#9CA3AF', fontSize: 10 }} />
            <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#030712', borderColor: '#6366f1', borderRadius: '0.75rem', fontSize: '12px' }}
            />
            <Bar dataKey={yKey} name={config?.labels?.[yKey] || yKey} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 4. Render Radar Chart
  const renderRadarChart = () => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const indicatorKey = config?.indicatorKey || (data[0]?.indicator !== undefined ? 'indicator' : 'subject');
    
    // Check if multi-entity radar data (each column other than indicator is an entity)
    const entityKeys = Object.keys(data[0] || {}).filter(k => 
      k !== indicatorKey && k !== 'subject' && k !== 'indicator' && !k.endsWith('_raw') && typeof data[0][k] === 'number'
    );

    const colors = ['#818cf8', '#34d399', '#f87171', '#fbbf24', '#c084fc', '#2dd4bf', '#fb923c', '#f472b6'];

    if (entityKeys.length > 0) {
      return (
        <div className="w-full h-80 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart outerRadius={95} data={data} margin={{ top: 15, right: 25, bottom: 15, left: 25 }}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey={indicatorKey} stroke="#9CA3AF" tick={{ fill: '#cbd5e1', fontSize: 10, fontWeight: 500 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#6B7280" tick={{ fontSize: 9, fill: '#9CA3AF' }} unit="%" />
              <Tooltip 
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  return (
                    <div className="bg-gray-900 border border-gray-700 p-3 rounded-xl shadow-xl text-xs space-y-1 z-50">
                      <p className="font-bold text-gray-200 border-b border-gray-800 pb-1">{label}</p>
                      {payload.map((entry: any) => (
                        <p key={entry.name} style={{ color: entry.color }}>
                          <span className="font-semibold">{entry.name}:</span> {entry.value}% {entry.payload?.[`${entry.name}_raw`] !== undefined ? <span className="text-gray-400 text-[10px]">({entry.payload[`${entry.name}_raw`]})</span> : null}
                        </p>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
              {entityKeys.map((ent, i) => (
                <Radar 
                  key={ent} 
                  name={ent} 
                  dataKey={ent} 
                  stroke={colors[i % colors.length]} 
                  fill={colors[i % colors.length]} 
                  fillOpacity={0.25} 
                  strokeWidth={2} 
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    const valKey = config?.valueKey || 'value' || 'A';
    return (
      <div className="w-full h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart outerRadius={90} data={data}>
            <PolarGrid stroke="#374151" />
            <PolarAngleAxis dataKey={indicatorKey} stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
            <PolarRadiusAxis stroke="#6B7280" />
            <Radar name="Indicador" dataKey={valKey} stroke="#818cf8" fill="#6366f1" fillOpacity={0.5} />
            <Tooltip contentStyle={{ backgroundColor: '#030712', borderColor: '#4f46e5', borderRadius: '0.75rem', fontSize: '12px' }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 5. Render Hexagonal SOM Grid
  const renderHexMap = () => {
    const hexGrid = data?.hexGrid || [];
    const clusters = data?.clustering || [];
    const frequencies = data?.frequencies || [];

    if (!Array.isArray(hexGrid) || hexGrid.length === 0) {
      return (
        <div className="p-6 text-center text-xs text-gray-400">
          Visualización de Malla SOM lista para análisis de pesos y neuronas.
        </div>
      );
    }

    // Cluster palette
    const clusterColors = [
      '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6',
      '#8b5cf6', '#14b8a6', '#f43f5e', '#84cc16', '#06b6d4'
    ];

    // Compute bounding box for SVG viewbox
    const xs = hexGrid.map((h: any) => h.x);
    const ys = hexGrid.map((h: any) => h.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Dynamically deduce the true circumradius R based on minimum distance between grid neighbors
    let r = 1.0;
    if (hexGrid.length >= 2) {
      let minDistance = Infinity;
      const sampleLimit = Math.min(hexGrid.length, 50);
      for (let i = 0; i < sampleLimit; i++) {
        for (let j = i + 1; j < sampleLimit; j++) {
          const dx = hexGrid[i].x - hexGrid[j].x;
          const dy = hexGrid[i].y - hexGrid[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 0.001 && d < minDistance) {
            minDistance = d;
          }
        }
      }
      if (minDistance < Infinity) {
        // Pointy-topped hexagon center-to-center distance is sqrt(3) * R
        r = minDistance / Math.sqrt(3);
      }
    }

    const padding = r * 1.5;
    const width = (maxX - minX) + padding * 2;
    const height = (maxY - minY) + padding * 2;
    const strokeW = Math.max(0.04, r * 0.08);
    const fontSz = r * 0.55;
    const showTextOnCells = hexGrid.length <= 400;

    return (
      <div className="w-full flex flex-col items-center justify-center p-2">
        <svg 
          viewBox={`${minX - padding} ${minY - padding} ${width} ${height}`} 
          className="w-auto max-w-full"
          style={{ maxHeight: '340px' }}
        >
          {hexGrid.map((node: any, idx: number) => {
            const clusterId = clusters[idx] !== undefined ? clusters[idx] : 0;
            const color = clusterColors[Math.abs(clusterId) % clusterColors.length];
            const rawFreq = frequencies[idx];
            const parsedFreq = typeof rawFreq === 'number' ? Math.round(rawFreq) : parseInt(rawFreq, 10) || 0;
            
            // Hexagon points
            const points = Array.from({ length: 6 }).map((_, i) => {
              const angle = (Math.PI / 3) * i - Math.PI / 6;
              return `${(node.x + r * Math.cos(angle)).toFixed(3)},${(node.y + r * Math.sin(angle)).toFixed(3)}`;
            }).join(' ');

            return (
              <g 
                key={idx}
                onMouseEnter={() => setHoveredNode({ ...node, clusterId, freq: parsedFreq })}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer transition-all duration-150 group"
              >
                <polygon
                  points={points}
                  fill={color}
                  fillOpacity={0.85}
                  stroke="#050508"
                  strokeWidth={`${strokeW.toFixed(3)}`}
                  className="group-hover:stroke-white group-hover:fill-opacity-100 transition"
                />
                {showTextOnCells && parsedFreq > 0 && (
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    stroke="#000000"
                    strokeWidth={`${(fontSz * 0.22).toFixed(3)}`}
                    paintOrder="stroke fill"
                    fontSize={`${fontSz.toFixed(3)}`}
                    fontWeight="900"
                    pointerEvents="none"
                    className="select-none font-sans"
                  >
                    {parsedFreq}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoveredNode && (
          <div className="mt-2 text-xs bg-gray-950 border border-indigo-500/40 px-3 py-1.5 rounded-lg text-gray-300 shadow-lg">
            Neuron #{hoveredNode.index} (Row: {hoveredNode.row}, Col: {hoveredNode.col}) • 
            <span className="text-indigo-300 font-semibold ml-1">Cluster {hoveredNode.clusterId + 1}</span> • 
            <span className="text-emerald-400 font-semibold ml-1">{hoveredNode.freq} documents</span>
          </div>
        )}
      </div>
    );
  };

  // 6. Render 2D Scatter (UMAP / Semantics)
  const renderScatterPlot = () => {
    const points = Array.isArray(data) ? data : data?.points || [];
    if (!Array.isArray(points) || points.length === 0) return null;

    return (
      <div className="w-full h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis dataKey="x" stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
            <YAxis dataKey="y" stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const p = payload[0].payload;
                  return (
                    <div className="bg-gray-950/95 border border-indigo-500/40 p-2.5 rounded-xl shadow-xl text-xs max-w-xs backdrop-blur-sm">
                      <div className="font-bold text-indigo-300 line-clamp-2">{p.title || p.label || `Point #${p.id || ''}`}</div>
                      {p.cluster !== undefined && <div className="text-gray-400 mt-1">Cluster: <strong className="text-white">{p.cluster}</strong></div>}
                      {p.author && <div className="text-gray-400">Author: <span className="text-gray-300">{p.author}</span></div>}
                      {p.year && <div className="text-gray-400">Year: <span className="text-gray-300">{p.year}</span></div>}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Scatter name="2D Projection" data={points} fill="#a855f7" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 7. Render Network Graph Preview
  const renderNetworkGraph = () => {
    const nodes = data?.nodes || [];
    const links = data?.links || [];

    return (
      <div className="w-full h-80 flex flex-col items-center justify-center p-4 bg-gray-950/60 rounded-xl">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Layers className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-bold text-white">Bibliometric Network Graph</h4>
          <p className="text-xs text-gray-400">
            {nodes.length > 0 ? `${nodes.length} Nodes / Entities and ${links.length} Co-occurrence links` : 'Captured network graph with degree and modularity metrics'}
          </p>
        </div>
      </div>
    );
  };

  // Main interactive renderer selector
  const renderInteractiveContent = () => {
    switch (chartType) {
      case 'bubble':
        return renderBubbleChart();
      case 'trend':
        return renderTrendChart();
      case 'bar':
        return renderBarChart();
      case 'radar':
        return renderRadarChart();
      case 'hex_map':
        return renderHexMap();
      case 'scatter':
        return renderScatterPlot();
      case 'network':
        return renderNetworkGraph();
      default:
        // Generic or fallback
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
          return renderBarChart() || renderBubbleChart();
        }
        return (
          <div className="p-6 text-center text-xs text-gray-400">
            Structured data captured for LLM analysis.
          </div>
        );
    }
  };

  return (
    <div className="w-full bg-gray-950/80 border border-gray-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900/90 border-b border-gray-800/80 text-xs flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          {svgMarkup && (
            <button
              onClick={() => setViewMode('svg')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                viewMode === 'svg' 
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-sm' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
              title="View exact configured vector map/chart"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Original SVG</span>
            </button>
          )}

          <button
            onClick={() => setViewMode('interactive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
              viewMode === 'interactive' 
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-sm' 
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
            title="Interactive analysis view with dynamic tooltips"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Interactive</span>
          </button>

          {thumbnailPng && (
            <button
              onClick={() => setViewMode('image')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                viewMode === 'image' 
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-sm' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
              title="Static PNG snapshot"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>PNG Snapshot</span>
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleCopyData}
            title="Copy JSON data"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition flex items-center gap-1 text-[11px] cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Data'}</span>
          </button>

          {svgMarkup && (
            <button
              onClick={handleDownloadSvg}
              title="Download vector SVG file"
              className="p-1.5 rounded-lg text-indigo-300 hover:text-white hover:bg-indigo-950/80 border border-indigo-800/40 transition flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>SVG</span>
            </button>
          )}

          {thumbnailPng && (
            <button
              onClick={handleDownloadPng}
              title="Download PNG image"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition flex items-center gap-1 text-[11px] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG</span>
            </button>
          )}
        </div>
      </div>

      {/* Main View Area */}
      <div className="relative p-3 flex items-center justify-center min-h-[260px] max-h-[500px] overflow-auto custom-scrollbar">
        {viewMode === 'svg' && svgMarkup ? (
          <div 
            className="w-full h-auto max-h-[460px] overflow-auto custom-scrollbar flex items-center justify-center pointer-events-auto select-none bg-white rounded-xl p-2 border border-gray-200 shadow-sm [&>svg]:max-h-[440px] [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:h-auto [&>svg]:mx-auto [&>svg]:rounded-lg"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : viewMode === 'interactive' ? (
          renderInteractiveContent()
        ) : thumbnailPng ? (
          <img 
            src={thumbnailPng} 
            alt={snapshot.title} 
            className="max-h-[440px] w-auto max-w-full rounded-xl object-contain border border-gray-200 shadow-md bg-white p-1"
          />
        ) : (
          renderInteractiveContent()
        )}
      </div>
    </div>
  );
};
