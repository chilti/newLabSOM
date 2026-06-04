import React, { useEffect, useState } from 'react';
import * as d3Force from 'd3-force';
import { useSomStore } from '../store/somStore';
import { Share2, Users, FileText, Info } from 'lucide-react';

interface ForceNode extends d3Force.SimulationNodeDatum {
  id: string;
  label: string;
  frequency: number;
  group_type?: string;
}

interface ForceLink extends d3Force.SimulationLinkDatum<ForceNode> {
  source: string | ForceNode;
  target: string | ForceNode;
  weight: number;
}

export const RedBibliometrica: React.FC = () => {
  const { network, networksByYear, documentCount, cooccurrenceCsv } = useSomStore();
  const [nodes, setNodes] = useState<ForceNode[]>([]);
  const [links, setLinks] = useState<ForceLink[]>([]);
  const [hoveredNode, setHoveredNode] = useState<ForceNode | null>(null);
  const [activeView, setActiveView] = useState<'graph' | 'matrix'>('graph');
  const [hideDisconnected, setHideDisconnected] = useState<boolean>(false);
  const [selectedYear, setSelectedYear] = useState<string>('Global');

  // Zoom, Pan & Dragging States
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggedNode, setDraggedNode] = useState<ForceNode | null>(null);

  const simulationRef = React.useRef<d3Force.Simulation<ForceNode, ForceLink> | null>(null);
  const nodesRef = React.useRef<ForceNode[]>([]);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  
  const width = 800;
  const height = 500;

  useEffect(() => {
    if (!network) return;

    let targetNetwork = network;
    if (selectedYear !== 'Global' && networksByYear && networksByYear[selectedYear]) {
      targetNetwork = networksByYear[selectedYear];
    }

    // Deep copy nodes and links from store
    let parsedNodes: ForceNode[] = targetNetwork.nodes.map(n => ({
      id: n.data.id,
      label: n.data.label,
      frequency: n.data.frequency,
      group_type: n.data.group_type
    }));

    let parsedLinks: ForceLink[] = targetNetwork.edges.map(e => ({
      source: e.data.source,
      target: e.data.target,
      weight: e.data.weight
    }));

    // If hideDisconnected is true, filter out nodes that have no links
    if (hideDisconnected) {
      const connectedNodeIds = new Set<string>();
      parsedLinks.forEach(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
        connectedNodeIds.add(sourceId);
        connectedNodeIds.add(targetId);
      });

      // Filter nodes
      parsedNodes = parsedNodes.filter(n => connectedNodeIds.has(n.id));

      // Filter links to make sure both source and target are still in parsedNodes
      const nodeIds = new Set(parsedNodes.map(n => n.id));
      parsedLinks = parsedLinks.filter(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    }

    // Set up D3 Force Simulation with explicit types
    const simulation = d3Force.forceSimulation<ForceNode>(parsedNodes)
      .force('link', d3Force.forceLink<ForceNode, ForceLink>(parsedLinks).id((d: ForceNode) => d.id).distance(100))
      .force('charge', d3Force.forceManyBody().strength(-150))
      .force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('collision', d3Force.forceCollide<ForceNode>().radius((d: ForceNode) => Math.sqrt(d.frequency) * 3 + 12));

    simulationRef.current = simulation;
    nodesRef.current = parsedNodes;

    simulation.on('tick', () => {
      setNodes([...parsedNodes]);
      setLinks([...parsedLinks]);
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [network, networksByYear, selectedYear, hideDisconnected]);

  // Handle passive scroll zoom (prevents browser/body scroll)
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handleWheelRaw = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      setZoomScale(s => {
        const nextScale = e.deltaY < 0 ? s * zoomFactor : s / zoomFactor;
        return Math.max(0.1, Math.min(10, nextScale));
      });
    };

    svgEl.addEventListener('wheel', handleWheelRaw, { passive: false });
    return () => {
      svgEl.removeEventListener('wheel', handleWheelRaw);
    };
  }, [network]);

  if (!network) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-700 rounded-2xl h-96 text-gray-400 bg-gray-900 bg-opacity-40">
        <Share2 className="w-12 h-12 mb-4 text-gray-500 animate-pulse" />
        <p className="text-lg font-medium text-gray-200">No network loaded</p>
        <p className="text-sm mt-1 text-center max-w-md">Load a Pubmed or Web of Science file in the control panel and click "Process Bibliometrics".</p>
      </div>
    );
  }

  // Mouse Handlers for Zoom/Pan and Dragging
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;
    if (target.tagName === 'svg' || target.tagName === 'rect' || target.id === 'bg-panner') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggedNode) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      
      const transformedX = ((mouseX * scaleX) - panOffset.x) / zoomScale;
      const transformedY = ((mouseY * scaleY) - panOffset.y) / zoomScale;
      
      draggedNode.fx = transformedX;
      draggedNode.fy = transformedY;
      
      if (simulationRef.current) {
        simulationRef.current.alphaTarget(0.3).restart();
      }
    }
  };

  const handleMouseUpOrLeave = () => {
    setIsPanning(false);
    if (draggedNode) {
      if (hoveredNode && hoveredNode.id === draggedNode.id) {
        // Keep hovered node pinned at its current position
      } else {
        draggedNode.fx = null;
        draggedNode.fy = null;
      }
      setDraggedNode(null);
      if (simulationRef.current) {
        simulationRef.current.alphaTarget(0);
      }
    }
  };

  const handleNodeMouseDown = (e: React.MouseEvent, node: ForceNode) => {
    e.stopPropagation();
    const simNode = nodesRef.current.find(n => n.id === node.id);
    if (simNode) {
      simNode.fx = simNode.x;
      simNode.fy = simNode.y;
      setDraggedNode(simNode);
    }
  };

  const handleNodeMouseEnter = (node: ForceNode) => {
    const simNode = nodesRef.current.find(n => n.id === node.id);
    if (simNode) {
      simNode.fx = simNode.x;
      simNode.fy = simNode.y;
    }
    setHoveredNode(node);
  };

  const handleNodeMouseLeave = (node: ForceNode) => {
    const simNode = nodesRef.current.find(n => n.id === node.id);
    if (simNode && (!draggedNode || draggedNode.id !== node.id)) {
      simNode.fx = null;
      simNode.fy = null;
    }
    setHoveredNode(null);
  };

  const getCursorClass = () => {
    if (draggedNode) return 'cursor-grabbing';
    if (isPanning) return 'cursor-grabbing';
    return 'cursor-grab';
  };

  const getNodeCoords = (nodeRef: string | ForceNode) => {
    if (typeof nodeRef === 'object') {
      return { x: nodeRef.x ?? 0, y: nodeRef.y ?? 0 };
    }
    const node = nodes.find(n => n.id === nodeRef);
    return { x: node?.x ?? 0, y: node?.y ?? 0 };
  };

  const handleDownloadCsv = () => {
    let currentCsv = cooccurrenceCsv;
    if (selectedYear !== 'Global' && networksByYear && networksByYear[selectedYear]?.cooccurrence_csv) {
      currentCsv = networksByYear[selectedYear].cooccurrence_csv;
    }
    
    if (!currentCsv) return;
    const blob = new Blob([currentCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'adjacency_matrix.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderAdjacencyTable = () => {
    let currentCsv = cooccurrenceCsv;
    if (selectedYear !== 'Global' && networksByYear && networksByYear[selectedYear]?.cooccurrence_csv) {
      currentCsv = networksByYear[selectedYear].cooccurrence_csv;
    }
    
    if (!currentCsv) return null;
    
    const lines = currentCsv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const parts = line.split(',');
      return parts.map(p => p.replace(/^"|"$/g, ''));
    });
    
    return (
      <div className="w-full overflow-auto max-h-[450px] border border-gray-800 rounded-xl bg-gray-950">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900 bg-opacity-80 sticky top-0 backdrop-blur-md z-10">
              <th className="p-3 font-bold text-gray-400 border-r border-gray-800 bg-gray-900 sticky left-0 z-20">Term</th>
              {headers.slice(1).map((h, idx) => (
                <th key={idx} className="p-3 font-bold text-gray-400 text-center min-w-[100px] border-r border-gray-850">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-gray-850 hover:bg-gray-900 hover:bg-opacity-30 transition-colors">
                <td className="p-3 font-bold text-indigo-400 border-r border-gray-800 bg-gray-900 bg-opacity-20 sticky left-0 z-10">{row[0]}</td>
                {row.slice(1).map((val, valIdx) => {
                  const numVal = parseInt(val) || 0;
                  return (
                    <td 
                      key={valIdx} 
                      className={`p-3 text-center border-r border-gray-850 ${
                        numVal > 0 ? 'text-emerald-400 font-bold bg-emerald-950 bg-opacity-10' : 'text-gray-600'
                      }`}
                    >
                      {numVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-800 pb-4 mb-4 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-200 flex items-center space-x-2">
            <Share2 className="w-5 h-5 text-indigo-400" />
            <span>Bibliometric Co-occurrence Network</span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">Nodes and links generated from the analyzed documents.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setActiveView('graph')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeView === 'graph' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Network Graph
            </button>
            <button
              onClick={() => setActiveView('matrix')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeView === 'matrix' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Adjacency Matrix
            </button>
          </div>

          {cooccurrenceCsv && (
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-1.5 bg-gray-900 border border-gray-800 hover:border-indigo-500 rounded-lg text-xs font-bold text-gray-300 hover:text-white transition flex items-center space-x-1.5 cursor-pointer"
              title="Download Adjacency Matrix CSV"
            >
              <span>Download CSV</span>
            </button>
          )}

          {activeView === 'graph' && (
            <label className="flex items-center space-x-1.5 text-xs text-gray-400 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800 cursor-pointer hover:border-indigo-500 transition-colors">
              <input
                type="checkbox"
                checked={hideDisconnected}
                onChange={(e) => setHideDisconnected(e.target.checked)}
                className="w-3.5 h-3.5 bg-gray-950 border-gray-800 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer"
              />
              <span className="font-semibold select-none">Hide Disconnected</span>
            </label>
          )}

          <div className="flex items-center space-x-4 text-xs text-gray-400 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800">
            <span className="flex items-center"><FileText className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Docs: {documentCount}</span>
            <span className="flex items-center"><Users className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Nodes: {nodes.length}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative bg-gray-950 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center min-h-[450px]">
        {activeView === 'graph' ? (
          <>
            <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 z-10">
              {networksByYear && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-gray-900 bg-opacity-95 text-xs text-emerald-400 font-bold border border-gray-800 hover:border-emerald-500 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition shadow-lg cursor-pointer mb-2"
                >
                  <option value="Global">Global</option>
                  {Object.keys(networksByYear).map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              )}
              
              <button
                type="button"
                onClick={() => setZoomScale(s => Math.min(10, s * 1.2))}
                className="w-8 h-8 bg-gray-900 bg-opacity-95 border border-gray-800 hover:border-indigo-500 rounded-lg flex items-center justify-center text-gray-300 hover:text-white transition shadow-lg cursor-pointer font-bold text-sm"
                title="Zoom In"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(s => Math.max(0.1, s / 1.2))}
                className="w-8 h-8 bg-gray-900 bg-opacity-95 border border-gray-800 hover:border-indigo-500 rounded-lg flex items-center justify-center text-gray-300 hover:text-white transition shadow-lg cursor-pointer font-bold text-sm"
                title="Zoom Out"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomScale(1);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="w-8 h-8 bg-gray-900 bg-opacity-95 border border-gray-800 hover:border-indigo-500 rounded-lg flex items-center justify-center text-gray-300 hover:text-white transition shadow-lg cursor-pointer text-xs"
                title="Reset View"
              >
                ⟲
              </button>
            </div>

            <svg 
              ref={svgRef}
              width="100%" 
              height="100%" 
              viewBox={`0 0 ${width} ${height}`} 
              className={`select-none ${getCursorClass()}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUpOrLeave}
              onMouseLeave={handleMouseUpOrLeave}
            >
              <rect id="bg-panner" width="100%" height="100%" fill="transparent" />

              <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoomScale})`}>
                {links.map((link, idx) => {
                  const sourceCoords = getNodeCoords(link.source);
                  const targetCoords = getNodeCoords(link.target);
                  const strokeWidth = Math.max(1, Math.min(6, Math.sqrt(link.weight) * 1.5));
                  
                  return (
                    <line
                      key={`link_${idx}`}
                      x1={sourceCoords.x}
                      y1={sourceCoords.y}
                      x2={targetCoords.x}
                      y2={targetCoords.y}
                      stroke="#0088ff"
                      strokeOpacity={0.3}
                      strokeWidth={strokeWidth}
                    />
                  );
                })}

                {nodes.map((node) => {
                  const radius = Math.max(6, Math.min(30, Math.sqrt(node.frequency) * 3 + 4));
                  const isHovered = hoveredNode?.id === node.id;
                  
                  let nodeColor = '#0088ff';
                  if (node.id.startsWith('t2_')) {
                    nodeColor = isHovered ? '#d946ef' : '#8b5cf6';
                  } else {
                    nodeColor = isHovered ? '#00f0ff' : '#0088ff';
                  }

                  return (
                    <g 
                      key={node.id} 
                      transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
                      className="cursor-pointer"
                      onMouseDown={(e) => handleNodeMouseDown(e, node)}
                      onMouseEnter={() => handleNodeMouseEnter(node)}
                      onMouseLeave={() => handleNodeMouseLeave(node)}
                    >
                      <circle
                        r={radius}
                        fill={nodeColor}
                        stroke="#ffffff"
                        strokeWidth={isHovered ? 2 : 1}
                        className="transition-all duration-150 shadow-md"
                      />
                      
                      {(node.frequency > 5 || isHovered) && (
                        <text
                          y={radius + 14}
                          textAnchor="middle"
                          fill={isHovered ? '#ffffff' : '#cbd5e0'}
                          fontSize={isHovered ? '11px' : '9px'}
                          fontWeight={isHovered ? 'bold' : 'normal'}
                          className="transition-all pointer-events-none drop-shadow-md"
                        >
                          {node.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {hoveredNode && (
              <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-95 border border-indigo-500 p-4 rounded-xl shadow-xl max-w-xs text-xs text-gray-200 pointer-events-none">
                <h4 className="font-bold text-sm text-indigo-400 uppercase tracking-wider mb-2 flex items-center">
                  <Info className="w-4 h-4 mr-1" />
                  <span>Term Details</span>
                </h4>
                <div>
                  <p className="mb-1"><span className="text-gray-500 font-bold">Concept:</span> {hoveredNode.label}</p>
                  <p><span className="text-gray-500 font-bold">Doc Frequency:</span> {hoveredNode.frequency} documents</p>
                  {hoveredNode.group_type && (
                    <p className="mt-1"><span className="text-gray-500 font-bold">Type:</span> <span className="text-indigo-400 capitalize">{hoveredNode.group_type}</span></p>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          renderAdjacencyTable()
        )}
      </div>
    </div>
  );
};
