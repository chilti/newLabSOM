import React, { useState, useEffect, useMemo } from 'react';
import { useSomStore } from '../store/somStore';
import { 
  Play, Pause, SkipBack, SkipForward, Activity, 
  TrendingUp, Compass, Grid, Zap, RefreshCw, BarChart2, 
  Info
} from 'lucide-react';
import { SendToAssistantButton } from './SendToAssistantButton';

export const LongitudinalSomViewer: React.FC = () => {
  const {
    longitudinalResults,
    activeLongitudinalPeriod,
    setActiveLongitudinalPeriod,
    cooccurrenceMatricesByPeriod,
    trainLongitudinalSOM,
    isTraining,
    config
  } = useSomStore();

  const [activeSubTab, setActiveSubTab] = useState<'player' | 'side_by_side' | 'drift' | 'migration'>('player');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1500); // ms per step
  const [colorMode, setColorMode] = useState<'umatrix' | 'clusters' | 'frequencies'>('umatrix');
  const [selectedNeuron, setSelectedNeuron] = useState<number | null>(null);

  const periods = useMemo(() => {
    if (longitudinalResults?.periods && longitudinalResults.periods.length > 0) {
      return longitudinalResults.periods;
    }
    if (cooccurrenceMatricesByPeriod) {
      return Object.keys(cooccurrenceMatricesByPeriod);
    }
    return [];
  }, [longitudinalResults, cooccurrenceMatricesByPeriod]);

  // Set default active period if not set
  useEffect(() => {
    if (periods.length > 0 && (!activeLongitudinalPeriod || !periods.includes(activeLongitudinalPeriod))) {
      setActiveLongitudinalPeriod(periods[0]);
    }
  }, [periods, activeLongitudinalPeriod, setActiveLongitudinalPeriod]);

  // Auto-play timeline animation
  useEffect(() => {
    if (!isPlaying || periods.length <= 1) return;
    const interval = setInterval(() => {
      const currIdx = periods.indexOf(activeLongitudinalPeriod);
      const nextIdx = (currIdx + 1) % periods.length;
      setActiveLongitudinalPeriod(periods[nextIdx]);
    }, playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, periods, activeLongitudinalPeriod, playbackSpeed, setActiveLongitudinalPeriod]);

  const activeMap = useMemo(() => {
    if (!longitudinalResults?.maps || !activeLongitudinalPeriod) return null;
    return longitudinalResults.maps[activeLongitudinalPeriod] || null;
  }, [longitudinalResults, activeLongitudinalPeriod]);

  // Derive cluster color palette
  const clusterColors = useMemo(() => [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', 
    '#06b6d4', '#f97316', '#14b8a6', '#e11d48', '#84cc16'
  ], []);

  // Compute hex grid parameters
  const renderHexGrid = (mapData: any, highlightDrift = false, driftMetric?: any) => {
    if (!mapData?.hexGrid || mapData.hexGrid.length === 0) return null;

    const hexGrid = mapData.hexGrid;
    const umatrix = mapData.umatrix || [];
    const clustering = mapData.clustering || [];
    const frequencies = mapData.frequencies || [];
    const mappedLabels = mapData.mappedLabels || [];
    const rawDrift = driftMetric?.raw_drift || [];
    const maxDrift = driftMetric?.max_drift || 1;

    // SVG coordinate bounds
    const xs = hexGrid.map((h: any) => h.x);
    const ys = hexGrid.map((h: any) => h.y);
    const minX = Math.min(...xs) - 30;
    const maxX = Math.max(...xs) + 30;
    const minY = Math.min(...ys) - 30;
    const maxY = Math.max(...ys) + 30;
    const width = maxX - minX;
    const height = maxY - minY;

    // Compute min/max for U-matrix normalization
    const uMin = umatrix.length > 0 ? Math.min(...umatrix) : 0;
    const uMax = umatrix.length > 0 ? Math.max(...umatrix) : 1;
    const uSpan = uMax - uMin > 0 ? uMax - uMin : 1;

    const maxFreq = frequencies.length > 0 ? Math.max(...frequencies) : 1;

    return (
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="w-full h-full max-h-[560px] select-none"
      >
        <defs>
          <radialGradient id="hexGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#312e81" stopOpacity="0" />
          </radialGradient>
        </defs>

        {hexGrid.map((hex: any, idx: number) => {
          const uVal = umatrix[idx] ?? 0;
          const uNorm = (uVal - uMin) / uSpan; // 0 = close, 1 = distant
          const clusterId = clustering[idx] ?? -1;
          const freq = frequencies[idx] ?? 0;
          const labels = mappedLabels[idx] || [];
          const driftVal = rawDrift[idx] ?? 0;
          const driftNorm = maxDrift > 0 ? driftVal / maxDrift : 0;

          let fillColor = '#1e293b';
          let strokeColor = '#334155';

          if (highlightDrift) {
            // Drift heatmap (fire scale: dark violet -> orange -> yellow)
            const r = Math.round(30 + driftNorm * 225);
            const g = Math.round(20 + Math.pow(driftNorm, 2) * 180);
            const b = Math.round(60 + (1 - driftNorm) * 80);
            fillColor = `rgb(${r}, ${g}, ${b})`;
            strokeColor = driftNorm > 0.6 ? '#fde047' : '#475569';
          } else if (colorMode === 'umatrix') {
            // U-Matrix gray/cyan gradient (dark = close cluster core, light = boundary)
            const lightness = Math.round(15 + uNorm * 65);
            fillColor = `hsl(220, 30%, ${lightness}%)`;
            strokeColor = uNorm > 0.7 ? '#f43f5e' : '#475569';
          } else if (colorMode === 'clusters') {
            if (clusterId >= 0) {
              const baseColor = clusterColors[clusterId % clusterColors.length];
              fillColor = baseColor;
            } else {
              fillColor = '#1e293b';
            }
          } else if (colorMode === 'frequencies') {
            const fNorm = freq / (maxFreq || 1);
            const r = Math.round(20 + fNorm * 200);
            const g = Math.round(30 + fNorm * 120);
            const b = Math.round(70 + fNorm * 180);
            fillColor = `rgb(${r}, ${g}, ${b})`;
          }

          const isSelected = selectedNeuron === idx;

          return (
            <g
              key={`hex-${idx}`}
              onClick={() => setSelectedNeuron(isSelected ? null : idx)}
              className="cursor-pointer transition-transform duration-200 hover:scale-105"
              style={{ transformOrigin: `${hex.x}px ${hex.y}px` }}
            >
              {/* Hexagon Path */}
              <polygon
                points={hex.vertices.map((v: any) => `${v.x},${v.y}`).join(' ')}
                fill={fillColor}
                stroke={isSelected ? '#38bdf8' : strokeColor}
                strokeWidth={isSelected ? 3 : 1.2}
                className="transition-colors duration-300"
              />

              {/* Hit circle marker */}
              {freq > 0 && !highlightDrift && (
                <circle
                  cx={hex.x}
                  cy={hex.y}
                  r={Math.min(18, 4 + Math.sqrt(freq) * 3)}
                  fill="#ffffff"
                  fillOpacity={0.25}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              )}

              {/* Top Label summary on hexagon */}
              {labels.length > 0 && (
                <text
                  x={hex.x}
                  y={hex.y + (freq > 0 ? 12 : 3)}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="7.5"
                  fontWeight="bold"
                  className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                >
                  {labels[0].length > 12 ? `${labels[0].slice(0, 11)}…` : labels[0]}
                </text>
              )}

              {/* Neuron Frequency badge */}
              {freq > 0 && (
                <text
                  x={hex.x}
                  y={hex.y - 3}
                  textAnchor="middle"
                  fill="#38bdf8"
                  fontSize="8.5"
                  fontWeight="900"
                  className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                >
                  {freq}
                </text>
              )}

              {/* Highlight selection ring */}
              {isSelected && (
                <polygon
                  points={hex.vertices.map((v: any) => `${v.x},${v.y}`).join(' ')}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={3}
                  strokeDasharray="4 2"
                />
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  // If no longitudinal results yet, show training initiation card
  if (!longitudinalResults || !longitudinalResults.maps) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-gray-900/60 border border-gray-800 rounded-3xl max-w-4xl mx-auto my-8 shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-6">
          <TrendingUp className="w-8 h-8 text-white" />
        </div>

        <h3 className="text-2xl font-black text-white tracking-tight mb-2">
          Longitudinal SOM Analysis (Chained Evolutionary Maps)
        </h3>
        <p className="text-sm text-gray-400 text-center max-w-xl mb-8 leading-relaxed">
          For subperiods of <strong>5 years or more</strong>, the system trains a map for each time window using Kohonen's <em>Warm-Start</em> protocol: previous period weights initialize the next SOM, accelerating convergence in the refinement phase (20% iterations) and ensuring topological quadrant coherence across periods.
        </p>

        {periods.length > 0 ? (
          <div className="w-full bg-gray-950/80 border border-gray-800 rounded-2xl p-6 mb-8 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <span className="text-xs font-bold uppercase text-gray-400">Subperiods Detected:</span>
              <span className="text-xs font-bold text-indigo-400">{periods.length} Time Windows</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {periods.map((p, idx) => (
                <div key={p} className="flex items-center space-x-2 px-3 py-1.5 bg-indigo-950/50 border border-indigo-500/30 rounded-xl text-xs text-indigo-200">
                  <span className="w-5 h-5 rounded-full bg-indigo-600/60 text-white font-bold flex items-center justify-center text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="font-bold">{p}</span>
                  {idx === 0 ? (
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-1.5 py-0.5 rounded font-mono">
                      Base (100% Iters)
                    </span>
                  ) : (
                    <span className="text-[9px] bg-purple-950 text-purple-300 border border-purple-800/60 px-1.5 py-0.5 rounded font-mono">
                      Warm-Start (20% Refine)
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4 pt-2 text-xs">
              <div className="bg-gray-900/60 p-3 rounded-xl border border-gray-800">
                <span className="text-gray-500 block mb-1">SOM Grid</span>
                <span className="text-white font-bold">{config.rows} × {config.cols} ({config.rows * config.cols} neurons)</span>
              </div>
              <div className="bg-gray-900/60 p-3 rounded-xl border border-gray-800">
                <span className="text-gray-500 block mb-1">Base Iterations</span>
                <span className="text-white font-bold">{config.iterations} epochs</span>
              </div>
              <div className="bg-gray-900/60 p-3 rounded-xl border border-gray-800">
                <span className="text-gray-500 block mb-1">Refinement Iterations</span>
                <span className="text-indigo-300 font-bold">{Math.max(10, Math.round(config.iterations * 0.2))} epochs (Warm-Start)</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-2xl text-xs text-amber-300 mb-6">
            ⚠️ No subperiod matrices found. Please check "Generate Temporal Sequences" with a subperiod of 5 years or more in the Bibliometric Networks tab.
          </div>
        )}

        <button
          onClick={() => trainLongitudinalSOM()}
          disabled={isTraining || periods.length === 0}
          className="px-8 py-3.5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-bold rounded-2xl transition shadow-xl shadow-indigo-900/40 flex items-center space-x-3 cursor-pointer text-sm"
        >
          {isTraining ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Training Evolutionary Maps ({periods.length} SOMs)...</span>
            </>
          ) : (
            <>
              <Zap className="w-5 h-5 text-amber-300" />
              <span>Train Longitudinal SOMs</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-gray-950 p-6 space-y-6 overflow-y-auto">
      {/* Top Header & Metrics Bar */}
      <div className="flex items-center justify-between bg-gray-900/80 border border-gray-800 rounded-2xl p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-indigo-600/20 border border-indigo-500/40 rounded-xl flex items-center justify-center text-indigo-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-black text-white tracking-tight">
                Longitudinal SOM Analysis (Evolutionary Maps)
              </h2>
              <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full font-bold uppercase">
                Warm-Start Chaining
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Continuous temporal evolution with spatial alignment of thematic quadrants
            </p>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex items-center bg-gray-950 border border-gray-800 rounded-xl p-1 space-x-1">
          <button
            onClick={() => setActiveSubTab('player')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeSubTab === 'player' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Timeline Player</span>
          </button>

          <button
            onClick={() => setActiveSubTab('side_by_side')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeSubTab === 'side_by_side' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Side-by-Side</span>
          </button>

          <button
            onClick={() => setActiveSubTab('drift')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeSubTab === 'drift' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Knowledge Drift (ΔW)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('migration')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
              activeSubTab === 'migration' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Thematic Migration</span>
          </button>
        </div>

        {/* AI Assistant Snapshot */}
        <SendToAssistantButton
          title={`Longitudinal SOM Map (${activeLongitudinalPeriod})`}
          viewSource="som"
          chartType="hex_map"
          dataContextPrompt={`Longitudinal SOM Evolutionary Map for period ${activeLongitudinalPeriod}`}
          data={{
            activePeriod: activeLongitudinalPeriod,
            periods: longitudinalResults.periods,
            driftMetrics: longitudinalResults.drift_metrics,
            mapInfo: activeMap ? {
              training_phase: activeMap.training_phase,
              iterations: activeMap.iterations,
              frequencies: activeMap.frequencies,
              quantizationErrors: activeMap.quantizationErrors
            } : null
          }}
        />
      </div>

      {/* SUB-VIEW 1: TIMELINE PLAYER */}
      {activeSubTab === 'player' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
          {/* Main Map Visualizer */}
          <div className="lg:col-span-3 bg-gray-900/60 border border-gray-800 rounded-3xl p-6 flex flex-col justify-between shadow-2xl">
            {/* Map Top Bar */}
            <div className="flex items-center justify-between border-b border-gray-800/80 pb-4 mb-4">
              <div className="flex items-center space-x-3">
                <span className="text-sm font-bold text-gray-300">Active Period:</span>
                <div className="flex space-x-1.5 bg-gray-950 p-1 rounded-xl border border-gray-800">
                  {periods.map(p => (
                    <button
                      key={p}
                      onClick={() => setActiveLongitudinalPeriod(p)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        activeLongitudinalPeriod === p
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Mode Switcher */}
              <div className="flex items-center space-x-2 bg-gray-950 p-1 rounded-xl border border-gray-800 text-xs">
                <button
                  onClick={() => setColorMode('umatrix')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                    colorMode === 'umatrix' ? 'bg-gray-800 text-cyan-300' : 'text-gray-400'
                  }`}
                >
                  U-Matrix
                </button>
                <button
                  onClick={() => setColorMode('clusters')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                    colorMode === 'clusters' ? 'bg-gray-800 text-purple-300' : 'text-gray-400'
                  }`}
                >
                  Clusters
                </button>
                <button
                  onClick={() => setColorMode('frequencies')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                    colorMode === 'frequencies' ? 'bg-gray-800 text-indigo-300' : 'text-gray-400'
                  }`}
                >
                  BMU Density
                </button>
              </div>
            </div>

            {/* Map Hex SVG */}
            <div className="flex-1 flex items-center justify-center min-h-[420px]">
              {activeMap ? renderHexGrid(activeMap) : (
                <div className="text-gray-500 text-xs">No data for this map</div>
              )}
            </div>

            {/* Timeline Controls Bottom Bar */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-800/80 mt-4 bg-gray-950/60 p-3 rounded-2xl">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const idx = periods.indexOf(activeLongitudinalPeriod);
                    if (idx > 0) setActiveLongitudinalPeriod(periods[idx - 1]);
                  }}
                  disabled={periods.indexOf(activeLongitudinalPeriod) === 0}
                  className="p-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-xl text-gray-200 transition"
                  title="Previous Period"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center space-x-2 shadow-lg shadow-indigo-900/40 transition"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span className="text-xs">{isPlaying ? 'Pause' : 'Play'}</span>
                </button>

                <button
                  onClick={() => {
                    const idx = periods.indexOf(activeLongitudinalPeriod);
                    if (idx < periods.length - 1) setActiveLongitudinalPeriod(periods[idx + 1]);
                  }}
                  disabled={periods.indexOf(activeLongitudinalPeriod) === periods.length - 1}
                  className="p-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-xl text-gray-200 transition"
                  title="Next Period"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* Progress Slider */}
              <div className="flex-1 mx-6 flex items-center space-x-3">
                <input
                  type="range"
                  min="0"
                  max={periods.length - 1}
                  value={periods.indexOf(activeLongitudinalPeriod)}
                  onChange={(e) => setActiveLongitudinalPeriod(periods[parseInt(e.target.value)])}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <span className="text-xs font-mono font-bold text-indigo-400 min-w-[70px]">
                  {activeLongitudinalPeriod}
                </span>
              </div>

              {/* Speed dropdown */}
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseInt(e.target.value))}
                className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-gray-300 focus:outline-none"
              >
                <option value={2500}>0.5x (Slow)</option>
                <option value={1500}>1.0x (Normal)</option>
                <option value={800}>2.0x (Fast)</option>
              </select>
            </div>
          </div>

          {/* Right Sidebar: Details & Mapped Labels */}
          <div className="space-y-6">
            {/* Period Statistics */}
            <div className="bg-gray-900/60 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
                <Info className="w-4 h-4 text-indigo-400" />
                <span>Period Metadata</span>
              </h4>

              {activeMap && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-gray-800/60">
                    <span className="text-gray-400">Training Phase:</span>
                    <span className="font-bold text-indigo-300">
                      {activeMap.training_phase === 'base_full' ? 'Base (Global Ordering)' : 'Warm-Start (Refinement)'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-800/60">
                    <span className="text-gray-400">Epochs Executed:</span>
                    <span className="font-bold text-white">{activeMap.iterations} epochs</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-800/60">
                    <span className="text-gray-400">Active Terms:</span>
                    <span className="font-bold text-emerald-400">
                      {activeMap.mappedLabels?.reduce((acc: number, cur: any[]) => acc + cur.length, 0) || 0}
                    </span>
                  </div>
                  {activeMap.drift_from_prev && (
                    <div className="flex justify-between py-1 border-b border-gray-800/60">
                      <span className="text-gray-400">Mean Drift (ΔW):</span>
                      <span className="font-bold text-amber-400">
                        {activeMap.drift_from_prev.mean_drift?.toFixed(4)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selected Neuron Inspector */}
            <div className="bg-gray-900/60 border border-gray-800 rounded-3xl p-5 shadow-xl space-y-4">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
                <Compass className="w-4 h-4 text-purple-400" />
                <span>
                  {selectedNeuron !== null ? `Neuron #${selectedNeuron}` : 'Neuron Inspector'}
                </span>
              </h4>

              {selectedNeuron !== null && activeMap ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-950 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-500 block text-[10px]">Cluster ID</span>
                      <span className="text-white font-bold">
                        {activeMap.clustering?.[selectedNeuron] ?? 'N/A'}
                      </span>
                    </div>
                    <div className="bg-gray-950 p-2.5 rounded-xl border border-gray-800">
                      <span className="text-gray-500 block text-[10px]">BMU Frequency</span>
                      <span className="text-indigo-400 font-bold">
                        {activeMap.frequencies?.[selectedNeuron] ?? 0}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-gray-400 block mb-1.5">
                      Mapped Terms ({activeMap.mappedLabels?.[selectedNeuron]?.length || 0}):
                    </span>
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {(activeMap.mappedLabels?.[selectedNeuron] || []).map((lbl: string) => (
                        <div key={lbl} className="px-2.5 py-1 bg-gray-950 border border-gray-800/80 rounded-lg text-xs text-gray-200 truncate">
                          {lbl}
                        </div>
                      ))}
                      {(!activeMap.mappedLabels?.[selectedNeuron] || activeMap.mappedLabels[selectedNeuron].length === 0) && (
                        <span className="text-xs text-gray-600 italic">Empty neuron in this period</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500 leading-relaxed">
                  Click on any hexagon on the SOM grid to inspect associated terms, cluster and evolution in this period.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: SIDE-BY-SIDE COMPARISON */}
      {activeSubTab === 'side_by_side' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {periods.map((p, idx) => {
            const pMap = longitudinalResults.maps[p];
            if (!pMap) return null;
            return (
              <div key={p} className="bg-gray-900/60 border border-gray-800 rounded-3xl p-5 flex flex-col shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-300 font-bold flex items-center justify-center text-xs">
                      {idx + 1}
                    </span>
                    <h3 className="text-sm font-bold text-white">{p}</h3>
                  </div>
                  <span className="text-[10px] bg-gray-950 text-gray-400 border border-gray-800 px-2 py-0.5 rounded-full font-mono">
                    {pMap.training_phase === 'base_full' ? 'Base' : 'Warm-Start'}
                  </span>
                </div>

                <div className="flex-1 flex items-center justify-center min-h-[300px]">
                  {renderHexGrid(pMap)}
                </div>

                <div className="pt-3 border-t border-gray-800/60 mt-3 flex justify-between text-[11px] text-gray-400">
                  <span>Terms: <strong className="text-white">{pMap.mappedLabels?.reduce((acc: number, cur: any[]) => acc + cur.length, 0) || 0}</strong></span>
                  {pMap.drift_from_prev && (
                    <span>Drift: <strong className="text-amber-400">{pMap.drift_from_prev.mean_drift?.toFixed(3)}</strong></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SUB-VIEW 3: KNOWLEDGE DRIFT HEATMAP (ΔW) */}
      {activeSubTab === 'drift' && (
        <div className="space-y-6">
          <div className="p-4 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl flex items-start space-x-3">
            <Activity className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
            <div className="text-xs text-indigo-200 leading-relaxed">
              <strong>Knowledge Drift (&Delta;W_t = ||W_t - W_&#123;t-1&#125;||_2):</strong> Measures the displacement magnitude of neural centroids between consecutive periods. Warmer and more intense colors highlight conceptual fronts with high dynamism and disciplinary restructuring.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(longitudinalResults.drift_metrics || {}).map(([transitionKey, driftMetric]) => {
              const targetPeriod = transitionKey.split(' -> ')[1];
              const targetMap = longitudinalResults.maps[targetPeriod];
              if (!targetMap) return null;

              return (
                <div key={transitionKey} className="bg-gray-900/60 border border-gray-800 rounded-3xl p-6 shadow-xl flex flex-col">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>Transition:</span>
                      <span className="text-amber-400">{transitionKey}</span>
                    </h3>
                    <div className="flex space-x-2 text-[10px]">
                      <span className="px-2 py-0.5 bg-gray-950 rounded border border-gray-800 text-gray-300">
                        Mean: <strong>{driftMetric.mean_drift?.toFixed(4)}</strong>
                      </span>
                      <span className="px-2 py-0.5 bg-gray-950 rounded border border-gray-800 text-amber-300">
                        Max: <strong>{driftMetric.max_drift?.toFixed(4)}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center justify-center min-h-[320px]">
                    {renderHexGrid(targetMap, true, driftMetric)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: THEMATIC MIGRATION TABLE */}
      {activeSubTab === 'migration' && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-3xl p-6 shadow-2xl space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wide">
            Term Evolution Across Subperiods
          </h3>
          <p className="text-xs text-gray-400">
            BMU neuron trajectory tracking for each term across all temporal periods.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="py-2.5 px-3">Term / Concept</th>
                  {periods.map(p => (
                    <th key={p} className="py-2.5 px-3">{p} (Neuron / BMU)</th>
                  ))}
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60 text-gray-300">
                {(() => {
                  // Collect unique labels across all periods
                  const labelMap = new Map<string, Record<string, number | null>>();
                  periods.forEach(p => {
                    const pMap = longitudinalResults.maps[p];
                    if (pMap?.mappedLabels) {
                      pMap.mappedLabels.forEach((lbls: string[], neuronIdx: number) => {
                        lbls.forEach(lbl => {
                          if (!labelMap.has(lbl)) labelMap.set(lbl, {});
                          labelMap.get(lbl)![p] = neuronIdx;
                        });
                      });
                    }
                  });

                  const sortedEntries = Array.from(labelMap.entries()).slice(0, 50);

                  return sortedEntries.map(([lbl, periodLocations]) => {
                    const presentCount = Object.keys(periodLocations).length;
                    const isPersistent = presentCount === periods.length;
                    const isEmerging = presentCount < periods.length && periodLocations[periods[periods.length - 1]] !== undefined;

                    return (
                      <tr key={lbl} className="hover:bg-gray-950/60 transition">
                        <td className="py-2.5 px-3 font-semibold text-white truncate max-w-[200px]">{lbl}</td>
                        {periods.map(p => {
                          const nIdx = periodLocations[p];
                          return (
                            <td key={p} className="py-2.5 px-3 font-mono">
                              {nIdx !== undefined ? (
                                <span className="px-2 py-0.5 bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded">
                                  N#{nIdx}
                                </span>
                              ) : (
                                <span className="text-gray-600">-</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3">
                          {isPersistent ? (
                            <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded font-bold">
                              Persistent
                            </span>
                          ) : isEmerging ? (
                            <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800/60 px-2 py-0.5 rounded font-bold">
                              Emerging
                            </span>
                          ) : (
                            <span className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-bold">
                              Transient
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
