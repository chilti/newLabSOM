import React, { useEffect, useState, useMemo } from 'react';
import * as d3Force from 'd3-force';
import { useSomStore } from '../store/somStore';
import { Share2, Users, FileText, Info, ArrowRight, Eye, Layers, Table, Download, ExternalLink } from 'lucide-react';
import { SendToAssistantButton } from './SendToAssistantButton';
import { VosViewerContainer, networkToVosJson } from './vos/VosViewerContainer';
import { VosExportModal } from './vos/VosExportModal';
import { BiblioEdaReport } from './BiblioEdaReport';
import { BarChart2 } from 'lucide-react';

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
  const { 
    network, 
    vosviewerJson,
    networksByYear, 
    documentCount, 
    cooccurrenceCsv, 
    biblioActiveView, 
    setBiblioActiveView, 
    biblioSelectedYear, 
    setBiblioSelectedYear,
    loadCsvData,
    setActiveTab,
    vosRecluster
  } = useSomStore();

  const handleSendToSOM = () => {
    let targetCsv = cooccurrenceCsv;
    let targetName = 'Bibliometrics Co-occurrence';
    if (selectedYear !== 'Global' && networksByYear && networksByYear[selectedYear]?.cooccurrence_csv) {
      targetCsv = networksByYear[selectedYear].cooccurrence_csv;
      targetName = `Bibliometrics (${selectedYear})`;
    }

    if (!targetCsv) {
      alert("No co-occurrence matrix available to send.");
      return;
    }

    loadCsvData(targetCsv, 0, [], 'monothematic', targetName, {
      originType: 'bibliometrics',
      unitName: targetName
    });

    setActiveTab('multidimensional');
  };

  const [nodes, setNodes] = useState<ForceNode[]>([]);
  const [links, setLinks] = useState<ForceLink[]>([]);
  const [hoveredNode, setHoveredNode] = useState<ForceNode | null>(null);
  const [hideDisconnected, setHideDisconnected] = useState<boolean>(false);
  const [onlyLargestComponent, setOnlyLargestComponent] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

  // Sub-view: 'force' (Default) | 'matrix' | 'vosviewer' | 'eda'
  const viewerMode: 'force' | 'matrix' | 'vosviewer' | 'eda' = 
    (biblioActiveView === 'vosviewer' || biblioActiveView === 'matrix' || biblioActiveView === 'eda') ? biblioActiveView : 'force';
  const setViewerMode = (mode: 'force' | 'matrix' | 'vosviewer' | 'eda') => setBiblioActiveView(mode);

  const selectedYear = biblioSelectedYear;
  const setSelectedYear = setBiblioSelectedYear;

  // Zoom, Pan & Dragging States for Classic Force graph
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

  // Derive active VOSviewer JSON data
  const currentVosData = useMemo(() => {
    if (selectedYear !== 'Global' && networksByYear && networksByYear[selectedYear]) {
      const yearEntry = networksByYear[selectedYear];
      if (yearEntry.vosviewer_json) {
        return yearEntry.vosviewer_json;
      }
      return networkToVosJson(yearEntry);
    }
    if (vosviewerJson) {
      return vosviewerJson;
    }
    if (network) {
      return networkToVosJson(network);
    }
    return null;
  }, [vosviewerJson, network, networksByYear, selectedYear]);

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

    // If onlyLargestComponent is true, find and keep ONLY the largest connected component (LCC)
    if (onlyLargestComponent) {
      const adj = new Map<string, Set<string>>();
      parsedNodes.forEach(n => adj.set(n.id, new Set()));
      parsedLinks.forEach(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
        if (adj.has(sourceId) && adj.has(targetId)) {
          adj.get(sourceId)!.add(targetId);
          adj.get(targetId)!.add(sourceId);
        }
      });

      const visited = new Set<string>();
      const components: Set<string>[] = [];

      for (const node of parsedNodes) {
        if (!visited.has(node.id)) {
          const comp = new Set<string>();
          const queue = [node.id];
          visited.add(node.id);

          while (queue.length > 0) {
            const curr = queue.shift()!;
            comp.add(curr);
            for (const neighbor of adj.get(curr) || []) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            }
          }
          components.push(comp);
        }
      }

      // Sort by component size descending
      components.sort((a, b) => b.size - a.size);
      const lccSet = components.length > 0 ? components[0] : new Set<string>();

      parsedNodes = parsedNodes.filter(n => lccSet.has(n.id));
      const nodeIds = new Set(parsedNodes.map(n => n.id));
      parsedLinks = parsedLinks.filter(link => {
        const sourceId = typeof link.source === 'object' ? (link.source as ForceNode).id : link.source;
        const targetId = typeof link.target === 'object' ? (link.target as ForceNode).id : link.target;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    } else if (hideDisconnected) {
      // If hideDisconnected is true, filter out nodes that have no links
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
  }, [network, networksByYear, selectedYear, hideDisconnected, onlyLargestComponent]);

  // Handle passive scroll zoom for Classic force graph
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
  }, [network, viewerMode]);

  if (!network && !vosviewerJson) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-gray-700 rounded-2xl h-96 text-gray-400 bg-gray-900 bg-opacity-40">
        <Share2 className="w-12 h-12 mb-4 text-gray-500 animate-pulse" />
        <p className="text-lg font-medium text-gray-200">No network loaded</p>
        <p className="text-sm mt-1 text-center max-w-md">Load a bibliographic dataset (WoS, Scopus, PubMed, Dimensions, Lens, RIS) and click "Process Bibliometrics".</p>
      </div>
    );
  }

  // Mouse Handlers for Zoom/Pan and Dragging (Classic View)
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
      draggedNode.fx = null;
      draggedNode.fy = null;
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
      <div className="w-full overflow-auto max-h-[600px] border border-gray-800 rounded-xl bg-gray-950 p-4">
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

  const totalItemsCount = currentVosData?.network?.items?.length || nodes.length;
  const totalLinksCount = currentVosData?.network?.links?.length || links.length;

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl p-6">
      {/* Top Header & Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-800 pb-4 mb-4 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-200 flex items-center space-x-2">
            <Share2 className="w-5 h-5 text-indigo-400" />
            <span>Bibliometric Network Visualizer (VOSviewer Engine)</span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Explore Network, Overlay, and Density visualizations with smart labeling, density KDE, and modular clustering.
          </p>
          {viewerMode === 'vosviewer' && (
            <div className="text-[11px] text-gray-400 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <a
                href="https://github.com/neesjanvaneck/VOSviewer-Online"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-0.5 transition-colors"
                title="VOSviewer-Online GitHub Repository"
              >
                <span>GitHub Repository</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-gray-600">•</span>
              <a
                href="https://app.vosviewer.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-0.5 transition-colors"
                title="Official VOSviewer Online Web App"
              >
                <span>app.vosviewer.com</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-gray-600">•</span>
              <span className="text-gray-400">
                <a
                  href="https://orcid.org/0000-0001-8448-4521"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-white underline transition-colors"
                >
                  Nees Jan van Eck
                </a>{' '}
                and{' '}
                <a
                  href="https://orcid.org/0000-0001-8249-1752"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-white underline transition-colors"
                >
                  Ludo Waltman
                </a>
                . Published under a{' '}
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-white underline transition-colors"
                >
                  Creative Commons Attribution 4.0 International (CC BY 4.0)
                </a>{' '}
                license.
              </span>
            </div>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Switcher */}
          <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setViewerMode('force')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                viewerMode === 'force' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Classic 2D Force Graph"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Force Graph</span>
            </button>
            <button
              onClick={() => setViewerMode('matrix')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                viewerMode === 'matrix' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Adjacency Matrix Table"
            >
              <Table className="w-3.5 h-3.5" />
              <span>Matrix</span>
            </button>
            <button
              onClick={() => setViewerMode('vosviewer')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                viewerMode === 'vosviewer' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Interactive VOSviewer Visualizations (Network, Overlay, Density)"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>VOSviewer Map</span>
            </button>
            <button
              onClick={() => setViewerMode('eda')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
                viewerMode === 'eda' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Exploratory Data Analysis & Author Metrics"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>EDA Metrics</span>
            </button>
          </div>

          {/* Temporal Period Selector */}
          {networksByYear && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-gray-950 text-xs text-emerald-400 font-bold border border-gray-800 hover:border-emerald-500 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition shadow-lg cursor-pointer"
            >
              <option value="Global">Global (All Periods)</option>
              {Object.keys(networksByYear).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          )}

          {cooccurrenceCsv && (
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-1.5 bg-gray-900 border border-gray-800 hover:border-indigo-500 rounded-lg text-xs font-bold text-gray-300 hover:text-white transition flex items-center space-x-1.5 cursor-pointer"
              title="Download Adjacency Matrix CSV"
            >
              <span>Download CSV</span>
            </button>
          )}

          <button
            onClick={() => setShowExportModal(true)}
            className="px-3 py-1.5 bg-indigo-950/60 border border-indigo-500/40 hover:bg-indigo-900/60 text-indigo-200 hover:text-white rounded-lg text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-sm"
            title="Export High-Res Graphics (PNG, SVG) & VOS Packages"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Map</span>
          </button>

          <SendToAssistantButton
            title={`Co-occurrence Bibliometric Network (${selectedYear})`}
            badge="NETWORKS"
            viewSource="networks"
            chartType="network"
            data={{
              nodes: nodes.map(n => ({ id: n.id, label: n.label, freq: n.frequency })),
              links: links.map(l => ({
                source: typeof l.source === 'object' ? l.source.id : l.source,
                target: typeof l.target === 'object' ? l.target.id : l.target,
                weight: l.weight
              })),
              vosviewer: currentVosData
            }}
            dataContextPrompt={`Co-occurrence Bibliometric Network (Period/Year: ${selectedYear}).\nTotal items: ${totalItemsCount}.\nTotal links: ${totalLinksCount}.\nTotal corpus documents: ${documentCount}.\nTop entities by frequency: ${nodes.slice(0, 20).map(n => `${n.label} (freq: ${n.frequency})`).join(', ')}.`}
            buttonText="AI Assistant"
            variant="header"
          />

          {(cooccurrenceCsv || (networksByYear && selectedYear !== 'Global')) && (
            <button
              onClick={handleSendToSOM}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-md shadow-indigo-900/30"
              title="Send co-occurrence matrix to SOM & UMAP and switch tab"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>Send Data to SOM & Switch</span>
            </button>
          )}

          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-1.5 text-xs text-gray-300 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800 cursor-pointer hover:border-indigo-500 transition-colors shadow-sm" title="Mostrar sólo el componente conexo más grande (elimina islas periféricas en círculo)">
              <input
                type="checkbox"
                checked={onlyLargestComponent}
                onChange={(e) => {
                  setOnlyLargestComponent(e.target.checked);
                  if (e.target.checked) setHideDisconnected(false);
                }}
                className="w-3.5 h-3.5 bg-gray-950 border-gray-800 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer"
              />
              <span className="font-semibold select-none text-indigo-300">Only Largest Component</span>
            </label>

            <label className="flex items-center space-x-1.5 text-xs text-gray-400 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800 cursor-pointer hover:border-indigo-500 transition-colors">
              <input
                type="checkbox"
                checked={hideDisconnected}
                disabled={onlyLargestComponent}
                onChange={(e) => setHideDisconnected(e.target.checked)}
                className="w-3.5 h-3.5 bg-gray-950 border-gray-800 rounded text-indigo-500 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
              />
              <span className="font-semibold select-none">Hide Disconnected</span>
            </label>
          </div>

          <div className="flex items-center space-x-4 text-xs text-gray-400 bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800">
            <span className="flex items-center"><FileText className="w-3.5 h-3.5 mr-1 text-indigo-400" /> Docs: {documentCount}</span>
            <span className="flex items-center"><Users className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Items: {totalItemsCount}</span>
            <span className="flex items-center text-gray-500">Links: {totalLinksCount}</span>
          </div>
        </div>
      </div>

      {/* Main Visualizer Area */}
      <div className="flex-1 relative bg-gray-950 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center min-h-[620px]">
        {viewerMode === 'eda' ? (
          <BiblioEdaReport />
        ) : viewerMode === 'vosviewer' ? (
          <VosViewerContainer
            data={currentVosData}
            onlyLargestComponent={onlyLargestComponent}
            className="w-full h-full"
            onReclusterRequest={async (params) => {
              const result = await vosRecluster(params);
              return result.success ? { clusters: result.clusters } : null;
            }}
          />
        ) : viewerMode === 'force' ? (
          <>
            <div className="absolute top-4 right-4 flex flex-col items-end space-y-2 z-10">
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

      {/* Export Modal */}
      <VosExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
};
