import React, { useMemo, useState, Component } from 'react';

import { exportChartAsSVG as exportSunburstAsSVG, exportChartAsPNG as exportSunburstAsPNG } from '../utils/chartExport';
export { exportSunburstAsSVG, exportSunburstAsPNG };

// ─── Error Boundary ───────────────────────────────────────────────────────────
class SunburstErrorBoundary extends Component<
    { children: React.ReactNode },
    { error: string | null }
> {
    constructor(props: any) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(e: Error) {
        return { error: e.message };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
                    <p className="text-sm font-bold text-gray-300 mb-1">Sunburst Hierarchy</p>
                    <p className="text-xs text-red-400">Error al renderizar: {this.state.error}</p>
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function tropicColor(t: number): string {
    const low  = [0, 155, 158];
    const mid  = [220, 220, 220];
    const high = [241, 148, 138];
    const [src, dst] = t < 0.5 ? [low, mid] : [mid, high];
    const tt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const r = Math.round(lerp(src[0], dst[0], tt));
    const g = Math.round(lerp(src[1], dst[1], tt));
    const b = Math.round(lerp(src[2], dst[2], tt));
    return `rgb(${r},${g},${b})`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SunburstNode {
    id: string;
    parent: string;
    label?: string;   // human-readable short name (optional, falls back to id)
    level: 'Macro Topics' | 'Meso Topics' | 'Micro Topics';
    value: number;
    indicators_sum:  Record<string, number>;
    indicators_mean: Record<string, number>;
}

export interface SunburstData {
    nodes: SunburstNode[];
    indicators: string[];
    summable_indicators: string[];
    meanable_indicators: string[];
}

// ─── Arc math (no d3-shape dependency) ───────────────────────────────────────
function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    return {
        x: cx + r * Math.cos(angle - Math.PI / 2),
        y: cy + r * Math.sin(angle - Math.PI / 2),
    };
}

function describeArc(cx: number, cy: number, r0: number, r1: number, startAngle: number, endAngle: number): string {
    const gap = 0.002; // tiny gap between arcs
    const a0 = startAngle + gap;
    const a1 = endAngle - gap;
    if (a1 <= a0) return '';
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;

    const p0 = polarToCartesian(cx, cy, r1, a0);
    const p1 = polarToCartesian(cx, cy, r1, a1);
    const p2 = polarToCartesian(cx, cy, r0, a1);
    const p3 = polarToCartesian(cx, cy, r0, a0);

    if (r0 === 0) {
        // Sector (pie slice)
        return [
            `M ${cx} ${cy}`,
            `L ${p0.x} ${p0.y}`,
            `A ${r1} ${r1} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
            'Z',
        ].join(' ');
    }
    return [
        `M ${p0.x} ${p0.y}`,
        `A ${r1} ${r1} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
        `L ${p2.x} ${p2.y}`,
        `A ${r0} ${r0} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
        'Z',
    ].join(' ');
}

// ─── Tree building ────────────────────────────────────────────────────────────
interface TreeNode {
    id: string;
    label: string;   // display name
    level: string;
    value: number;
    ind_sum: Record<string, number>;
    ind_mean: Record<string, number>;
    children: TreeNode[];
    // layout
    x0: number; x1: number;
    y0: number; y1: number;
}

function buildTree(nodes: SunburstNode[], sizeIndicator: string): TreeNode | null {
    if (!nodes || nodes.length === 0) return null;

    const map: Record<string, TreeNode> = {};
    for (const n of nodes) {
        map[n.id] = {
            id: n.id,
            label: n.label || n.id,
            level: n.level,
            value: n.indicators_sum?.[sizeIndicator] ?? 0,
            ind_sum: n.indicators_sum || {},
            ind_mean: n.indicators_mean || {},
            children: [],
            x0: 0, x1: 0, y0: 0, y1: 0,
        };
    }

    const roots: TreeNode[] = [];
    for (const n of nodes) {
        if (!n.parent || !map[n.parent]) {
            roots.push(map[n.id]);
        } else {
            map[n.parent].children.push(map[n.id]);
        }
    }

    if (roots.length === 0) return null;

    // Synthetic root
    const root: TreeNode = {
        id: '__root__', label: 'root', level: 'root', value: 0,
        ind_sum: {}, ind_mean: {}, children: roots,
        x0: 0, x1: 2 * Math.PI, y0: 0, y1: 0,
    };

    // Sum up values bottom-up
    function sumValues(node: TreeNode): number {
        if (node.children.length === 0) return node.value;
        node.value = node.children.reduce((acc, c) => acc + sumValues(c), 0);
        return node.value;
    }
    sumValues(root);

    return root;
}

function layoutPartition(node: TreeNode, x0: number, x1: number, depth: number, maxDepth: number): void {
    node.x0 = x0;
    node.x1 = x1;
    node.y0 = depth;
    node.y1 = depth + 1;

    if (node.children.length === 0 || node.value === 0) return;

    let currentAngle = x0;
    for (const child of node.children) {
        const fraction = child.value / node.value;
        const childX1 = currentAngle + fraction * (x1 - x0);
        layoutPartition(child, currentAngle, childX1, depth + 1, maxDepth);
        currentAngle = childX1;
    }
}

function collectNodes(node: TreeNode, result: TreeNode[]): void {
    if (node.id !== '__root__') result.push(node);
    for (const child of node.children) collectNodes(child, result);
}

// ─── Main Component ───────────────────────────────────────────────────────────
const SunburstInner: React.FC<{ data: SunburstData }> = ({ data }) => {
    const SIZE = 540;
    const CX = SIZE / 2;
    const CY = SIZE / 2;
    const MAX_R = SIZE / 2 - 4;
    const RING_W = MAX_R / 3; // 3 rings: macro, meso, micro

    const [colorIndicator, setColorIndicator] = useState<string>('');
    const [sizeIndicator, setSizeIndicator] = useState<string>('Web of Science Documents');
    const [tooltip, setTooltip] = useState<{ x: number; y: number; node: TreeNode } | null>(null);

    const defaultColorIndicator = useMemo(() => {
        const prefer = [
            'Category Normalized Citation Impact',
            '% Documents in Top 10%',
            '% Documents in Q1 Journals',
            'Average Percentile',
        ];
        for (const p of prefer) {
            if (data.meanable_indicators?.includes(p)) return p;
        }
        return data.meanable_indicators?.[0] ?? '';
    }, [data]);

    const activeColor = colorIndicator || defaultColorIndicator;

    // Build & layout tree
    const allNodes = useMemo<TreeNode[]>(() => {
        const root = buildTree(data.nodes, sizeIndicator);
        if (!root) return [];
        layoutPartition(root, 0, 2 * Math.PI, 0, 3);
        const result: TreeNode[] = [];
        collectNodes(root, result);
        return result;
    }, [data.nodes, sizeIndicator]);

    // Colour scale (always uses ind_mean since it's ratios)
    const { minC, maxC } = useMemo(() => {
        let minC = Infinity, maxC = -Infinity;
        for (const n of allNodes) {
            const v = n.ind_mean?.[activeColor] ?? 0;
            if (v < minC) minC = v;
            if (v > maxC) maxC = v;
        }
        if (!isFinite(minC)) minC = 0;
        if (!isFinite(maxC)) maxC = 1;
        return { minC, maxC };
    }, [allNodes, activeColor]);

    function getColor(node: TreeNode): string {
        const v = node.ind_mean?.[activeColor] ?? 0;
        const range = maxC - minC;
        const t = range > 0 ? Math.min(1, Math.max(0, (v - minC) / range)) : 0.5;
        return tropicColor(t);
    }


    if (allNodes.length === 0) {
        return (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex items-center justify-center">
                <p className="text-xs text-gray-500">No Micro Topics data available to build the hierarchy.</p>
            </div>
        );
    }

    const summable = data.summable_indicators ?? [];
    const meanable = data.meanable_indicators ?? [];

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col space-y-4">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-gray-200">Sunburst Hierarchy</h3>
                    <p className="text-xs text-gray-500">Macro → Meso → Micro Topics</p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-end gap-3">
                    {/* Size Selector */}
                    <div className="flex flex-col items-end space-y-1">
                        <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Slice Size (Sum)</label>
                        <select
                            value={sizeIndicator}
                            onChange={e => setSizeIndicator(e.target.value)}
                            className="bg-gray-950 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 max-w-xs"
                        >
                            {summable.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                        </select>
                    </div>

                    {/* Color Selector */}
                    <div className="flex flex-col items-end space-y-1">
                        <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Slice Color (Average)</label>
                        <select
                            value={activeColor}
                            onChange={e => setColorIndicator(e.target.value)}
                            className="bg-gray-950 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 max-w-xs"
                        >
                            {meanable.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* SVG */}
            <div className="relative flex justify-center" id="sunburst-chart-container">
                <svg
                    width={SIZE} height={SIZE}
                    viewBox={`0 0 ${SIZE} ${SIZE}`}
                    onMouseLeave={() => setTooltip(null)}
                >
                    {allNodes.map((node, i) => {
                        const depth = node.y0; // 1=Macro, 2=Meso, 3=Micro
                        const r0 = (depth - 1) * RING_W;
                        const r1 = depth * RING_W;
                        const d = describeArc(CX, CY, r0, r1, node.x0, node.x1);
                        if (!d) return null;
                        const fill = getColor(node);
                        
                        // Text label positioning
                        const midAngle = (node.x0 + node.x1) / 2;
                        const midRadius = r0 + (r1 - r0) / 2;
                        const labelX = CX + midRadius * Math.cos(midAngle - Math.PI / 2);
                        const labelY = CY + midRadius * Math.sin(midAngle - Math.PI / 2);
                        // Rotate text to match arc (if on bottom half, flip so it's readable)
                        let textAngle = (midAngle * 180) / Math.PI - 90;
                        if (textAngle > 90 || textAngle < -90) {
                            textAngle += 180;
                        }
                        
                        // Only show text if slice is wide enough (e.g., > 0.1 radians) and it's Macro/Meso
                        const showText = (node.x1 - node.x0) > 0.1 && depth < 3;
                        let shortLabel = node.label;
                        if (shortLabel.length > 15) shortLabel = shortLabel.substring(0, 13) + '...';

                        return (
                            <g key={`${node.id}-${i}`}>
                                <path
                                    d={d}
                                    fill={fill}
                                    stroke="#0f172a"
                                    strokeWidth={0.5}
                                    opacity={0.88}
                                    style={{ cursor: 'pointer', transition: 'opacity 0.12s' }}
                                    onMouseEnter={e => {
                                        (e.currentTarget as SVGPathElement).style.opacity = '1';
                                        const svgRect = (e.currentTarget as SVGPathElement)
                                            .closest('svg')!.getBoundingClientRect();
                                        setTooltip({
                                            x: e.clientX - svgRect.left,
                                            y: e.clientY - svgRect.top,
                                            node,
                                        });
                                    }}
                                    onMouseLeave={e => {
                                        (e.currentTarget as SVGPathElement).style.opacity = '0.88';
                                        setTooltip(null);
                                    }}
                                />
                                {showText && (
                                    <text
                                        x={labelX}
                                        y={labelY}
                                        fill="#111827"
                                        fontSize="9"
                                        fontWeight="bold"
                                        textAnchor="middle"
                                        alignmentBaseline="middle"
                                        pointerEvents="none"
                                        transform={`rotate(${textAngle}, ${labelX}, ${labelY})`}
                                    >
                                        {shortLabel}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>

                {/* Tooltip */}
                {tooltip && (() => {
                    const n = tooltip.node;
                    const cv = n.ind_mean?.[activeColor] ?? 0;
                    const sizeVal = n.ind_sum?.[sizeIndicator] ?? n.value;
                    return (
                        <div
                            className="absolute pointer-events-none z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-2xl text-xs max-w-xs"
                            style={{ left: Math.min(tooltip.x + 12, SIZE - 200), top: Math.max(tooltip.y - 30, 4) }}
                        >
                            <p className="font-bold text-gray-100 mb-0.5 truncate">{n.label}</p>
                            <p className="text-gray-500 text-[10px] mb-2">{n.level}</p>
                            <div className="space-y-0.5">
                                <div className="flex justify-between gap-4">
                                    <span className="text-gray-500 truncate max-w-[140px]">{sizeIndicator}</span>
                                    <span className="text-gray-200 font-mono">{Math.round(sizeVal).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <span className="text-gray-500 truncate max-w-[140px]">{activeColor}</span>
                                    <span className="text-gray-200 font-mono">{cv.toFixed(3)}</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* Colour scale legend */}
            <div className="flex flex-col items-center justify-center space-y-1 bg-gray-950/50 p-2 rounded-lg border border-gray-800 self-center">
                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Color Scale: {activeColor}</span>
                <div className="flex items-center space-x-3">
                    <span className="text-xs text-gray-400 font-mono">{minC.toFixed(2)}</span>
                    <div className="h-3 w-48 rounded-full border border-gray-800" style={{
                        background: 'linear-gradient(to right, rgb(0,155,158), rgb(220,220,220), rgb(241,148,138))'
                    }} />
                    <span className="text-xs text-gray-400 font-mono">{maxC.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

// ─── Export (wrapped in error boundary) ──────────────────────────────────────
const SunburstChart: React.FC<{ data: SunburstData }> = ({ data }) => (
    <SunburstErrorBoundary>
        <SunburstInner data={data} />
    </SunburstErrorBoundary>
);

export default SunburstChart;
