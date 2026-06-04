import React, { useEffect, useRef, useMemo, Component, useCallback } from 'react';
import type { ErrorInfo } from 'react';
import chroma from 'chroma-js';
import { line, curveCatmullRom } from 'd3-shape';
import { type Trajectory } from './MallaHexagonal';

export interface UmapPoint {
  x: number;
  y: number;
  value: number;
  label?: string;
  dataIndex?: number; // original row index in the data matrix
}

export interface UmapHeatmapProps {
  points: UmapPoint[];
  width?: number;
  height?: number;
  colorScale?: 'standard' | 'viridis' | 'cividis';
  sigma?: number;
  resolution?: number;
  showPoints?: boolean;
  showLabels?: boolean;
  trajectories?: Trajectory[];
  onPointHover?: (dataIndex: number | null, canvasX: number, canvasY: number) => void;
}

// --- Error Boundary to prevent crashes from propagating ---
interface EBState { hasError: boolean; message: string }
class HeatmapErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UmapHeatmap] Render error caught by boundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: '#ff6b6b', fontSize: 10, padding: 8, border: '1px solid #ff6b6b', borderRadius: 8 }}>
          ⚠ Heatmap error: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Inner canvas renderer ---
const UmapHeatmapInner: React.FC<UmapHeatmapProps> = ({
  points,
  width = 400,
  height = 400,
  colorScale = 'standard',
  sigma = 0.1,
  resolution = 200,
  showPoints = true,
  showLabels = false,
  trajectories = [],
  onPointHover,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store bounds so mouse handlers can reuse them
  const boundsRef = useRef({ minX: 0, maxX: 1, minY: 0, maxY: 1, safeRangeX: 1, safeRangeY: 1 });
  const validPointsRef = useRef<UmapPoint[]>([]);

  const scales = useMemo(() => ({
    standard: ['#38a169', '#ecc94b', '#e53e3e'] as string[],
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] as string[],
    cividis: ['#00204d', '#414d6b', '#7c7b78', '#b9ad71', '#ffea46'] as string[],
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    try {
      const validPoints = points.filter(
        p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value)
      );
      validPointsRef.current = validPoints;
      if (validPoints.length === 0) return;

      // 1. Compute boundaries
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minV = Infinity, maxV = -Infinity;
      for (const p of validPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.value < minV) minV = p.value;
        if (p.value > maxV) maxV = p.value;
      }

      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      if (minV >= maxV) maxV = minV + 1;

      const padX = rangeX * 0.1;
      const padY = rangeY * 0.1;
      minX -= padX; maxX += padX;
      minY -= padY; maxY += padY;
      const safeRangeX = maxX - minX;
      const safeRangeY = maxY - minY;

      boundsRef.current = { minX, maxX, minY, maxY, safeRangeX, safeRangeY };

      // 2. Build colour scaler with percentile-clipped domain.
      // This prevents a single extreme outlier from washing out all colors.
      // Use the 2nd–98th percentile of actual data values as the color range.
      const sortedValues = validPoints.map(p => p.value).sort((a, b) => a - b);
      const p2Idx  = Math.floor(sortedValues.length * 0.02);
      const p98Idx = Math.floor(sortedValues.length * 0.98);
      const clipMin = sortedValues[p2Idx]  ?? minV;
      const clipMax = sortedValues[p98Idx] ?? maxV;
      const colorDomainMin = clipMin < clipMax ? clipMin : minV;
      const colorDomainMax = clipMin < clipMax ? clipMax : maxV;
      const scaleFn = chroma.scale(scales[colorScale] ?? scales.standard).domain([colorDomainMin, colorDomainMax]);

      // 3. Offscreen canvas for heatmap
      const off = document.createElement('canvas');
      off.width = resolution;
      off.height = resolution;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;

      const imgData = offCtx.createImageData(resolution, resolution);
      const data = imgData.data;

      const gridPts = validPoints.map(p => ({
        gx: ((p.x - minX) / safeRangeX) * resolution,
        gy: ((p.y - minY) / safeRangeY) * resolution,
        v: p.value
      }));

      const s = Math.max(sigma, 0.01) * resolution;
      const s2 = s * s;
      // Radius of influence in pixels (3 sigma cutoff)
      const radius = Math.ceil(3 * s);

      const densityMap = new Float32Array(resolution * resolution);
      const valueMap   = new Float32Array(resolution * resolution);
      // Separate weight accumulator to compute weighted average
      const weightSumMap = new Float32Array(resolution * resolution);

      // FAST SCATTER / SPLAT: each point contributes to its nearby pixels.
      // Complexity: O(N_points * radius^2) instead of O(resolution^2 * N_points)
      for (const p of gridPts) {
        const cx = Math.round(p.gx);
        const cy = Math.round(p.gy);
        const x0 = Math.max(0, cx - radius);
        const x1 = Math.min(resolution - 1, cx + radius);
        const y0 = Math.max(0, cy - radius);
        const y1 = Math.min(resolution - 1, cy + radius);

        for (let py = y0; py <= y1; py++) {
          const ddy = p.gy - py;
          for (let px = x0; px <= x1; px++) {
            const ddx = p.gx - px;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 > 9 * s2) continue;
            const w = Math.exp(-d2 / (2 * s2));
            const idx = py * resolution + px;
            densityMap[idx]  += w;
            weightSumMap[idx] += w;
            valueMap[idx]    += w * p.v;
          }
        }
      }

      // Normalize value map and find max density
      let maxDensity = 0;
      for (let i = 0; i < resolution * resolution; i++) {
        const ws = weightSumMap[i];
        if (ws > 0) valueMap[i] /= ws;
        if (densityMap[i] > maxDensity) maxDensity = densityMap[i];
      }

      // Tighten alphaNorm: reach full opacity at 8% of max density (was 20%).
      // This makes sparse high-value regions show their true color more vividly.
      const alphaNorm = maxDensity > 0 ? maxDensity * 0.08 : 1;

      for (let i = 0; i < resolution * resolution; i++) {
        const sumW = densityMap[i];
        const pIdx = i * 4;
        if (sumW > 0.001) {
          const color = scaleFn(valueMap[i]).rgba();
          const alpha = Math.min(1, sumW / alphaNorm);
          data[pIdx]     = Math.round(color[0]);
          data[pIdx + 1] = Math.round(color[1]);
          data[pIdx + 2] = Math.round(color[2]);
          data[pIdx + 3] = Math.round(255 * alpha);
        } else {
          data[pIdx + 3] = 0;
        }
      }

      offCtx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, width, height);

      // 4. Scatter overlay — color dots by their component value
      if (showPoints) {
        for (const p of validPoints) {
          const cx = ((p.x - minX) / safeRangeX) * width;
          const cy = ((p.y - minY) / safeRangeY) * height;
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
          
          // Use the same clipped color scale as the heatmap
          const dotColor = scaleFn(p.value).hex();
          
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          ctx.lineWidth = 0.5;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
          if (showLabels && p.label) {
            ctx.fillStyle = '#fff';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.label, cx, cy - 5);
          }
        }
      }

      // 5. Draw Trajectories
      if (trajectories.length > 0) {
        // Build a fast lookup array for mapping from dataIndex to canvas coordinates
        // We use an array instead of a Map because dataIndex is a sequential integer (much faster)
        const coordsByDataIndex: {cx: number, cy: number}[] = [];
        for (let i = 0; i < validPoints.length; i++) {
          const p = validPoints[i];
          if (p.dataIndex !== undefined) {
            const cx = ((p.x - minX) / safeRangeX) * width;
            const cy = ((p.y - minY) / safeRangeY) * height;
            coordsByDataIndex[p.dataIndex] = { cx, cy };
          }
        }

        const curveGen = line<{cx: number, cy: number}>()
          .x(d => d.cx)
          .y(d => d.cy)
          .curve(curveCatmullRom.alpha(0.5))
          .context(ctx);

        for (const traj of trajectories) {
          // Filter out points that might be missing from the UMAP calculation
          const tPoints = traj.points
            .map(p => coordsByDataIndex[p.dataIndex])
            .filter(Boolean) as {cx: number, cy: number}[];
          
          if (tPoints.length > 1) {
            ctx.beginPath();
            curveGen(tPoints);
            
            // Fast shadow technique: draw a thicker semi-transparent black stroke underneath
            // (Canvas shadowBlur is extremely slow and causes lag when rendering multiple maps)
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = (traj.width || 2) + 2;
            ctx.stroke();

            // Actual colored curve
            ctx.strokeStyle = traj.color;
            ctx.lineWidth = traj.width || 2;
            ctx.stroke();
            
            // Draw waypoints (circles at each node of the trajectory)
            ctx.fillStyle = traj.color;
            for (const pt of tPoints) {
              ctx.beginPath();
              ctx.arc(pt.cx, pt.cy, (traj.width || 2) + 1, 0, Math.PI * 2);
              ctx.fill();
              
              // Small white dot in the middle of the waypoint
              ctx.beginPath();
              ctx.arc(pt.cx, pt.cy, 1.5, 0, Math.PI * 2);
              ctx.fillStyle = '#fff';
              ctx.fill();
              ctx.fillStyle = traj.color; // Restore
            }
          }
        }
      }
    } catch (err) {
      console.error('[UmapHeatmap] Canvas rendering error:', err);
      ctx.fillStyle = 'rgba(255,100,100,0.3)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Render error – check console', width / 2, height / 2);
    }
  }, [points, width, height, colorScale, sigma, resolution, showPoints, showLabels, scales, trajectories]);

  // Mouse move: find nearest scatter point within 16px
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPointHover) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (width / rect.width);
    const mouseY = (e.clientY - rect.top) * (height / rect.height);

    const { minX, safeRangeX, minY, safeRangeY } = boundsRef.current;
    const pts = validPointsRef.current;

    let bestIdx: number | null = null;
    let bestDist = 16 * 16; // px^2 threshold

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const cx = ((p.x - minX) / safeRangeX) * width;
      const cy = ((p.y - minY) / safeRangeY) * height;
      const d2 = (cx - mouseX) ** 2 + (cy - mouseY) ** 2;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = i;
      }
    }

    if (bestIdx !== null) {
      const p = pts[bestIdx];
      onPointHover(p.dataIndex ?? bestIdx, e.clientX, e.clientY);
    } else {
      onPointHover(null, 0, 0);
    }
  }, [onPointHover, width, height]);

  const handleMouseLeave = useCallback(() => {
    onPointHover?.(null, 0, 0);
  }, [onPointHover]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', width, height, background: 'transparent', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
};

// --- Public export: wrapped in ErrorBoundary ---
export const UmapHeatmap: React.FC<UmapHeatmapProps> = (props) => (
  <HeatmapErrorBoundary>
    <UmapHeatmapInner {...props} />
  </HeatmapErrorBoundary>
);
