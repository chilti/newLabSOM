import React, { useState, useRef, useEffect } from 'react';
import { useSomStore } from '../store/somStore';
import { Upload, Activity, Layers, Database, RefreshCw, Play, Compass, FileText, Search, ExternalLink } from 'lucide-react';
import { SendToAssistantButton } from './SendToAssistantButton';

export const SemanticBibliometrics: React.FC = () => {
  const {
    sharedBibFile,
    setSharedBibFile,
    semanticRecords,
    semanticEmbeddings,
    semanticIntrinsicData,
    semantic2DCoords,
    semanticClusters,
    semanticClusterAssignment,
    isSemanticPreprocessing,
    isSemanticEmbedding,
    isSemanticReducing,
    isSemanticClustering,
    semanticTargetD,
    semanticNumLevels,
    semanticMinSize,
    semanticFileName,
    semanticEmbedModel,
    semanticCeilingResult,
    
    preprocessSemantic,
    generateSemanticEmbeddings,
    estimateSemanticIntrinsicDim,
    reduceSemanticDimension,
    clusterSemantic,
    setSemanticTargetD,
    setSemanticNumLevels,
    setSemanticMinSize,
    setSemanticEmbedModel,
    clearSemanticState
  } = useSomStore();

  const [useMesh, setUseMesh] = useState<boolean>(false);
  
  // Field check boxes
  const [extractTitle, setExtractTitle] = useState<boolean>(true);
  const [extractAbstract, setExtractAbstract] = useState<boolean>(true);
  const [extractKeywords, setExtractKeywords] = useState<boolean>(true);
  const [extractJournal, setExtractJournal] = useState<boolean>(false);

  // Search filter for preview table
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSharedBibFile(file);
    }
  };

  const runPreprocessing = async () => {
    if (!sharedBibFile) return;
    const extraFields: string[] = [];
    if (extractJournal) extraFields.push('SO');

    await preprocessSemantic(sharedBibFile, useMesh, extraFields, extractTitle, extractAbstract, extractKeywords);
  };

  const handleEmbed = async () => {
    await generateSemanticEmbeddings();
  };

  // Synchronize map data to iframe
  const sendDataToMap = () => {
    if (iframeRef.current && semantic2DCoords && semanticClusterAssignment) {
      const iframeWin = iframeRef.current.contentWindow;
      if (iframeWin) {
        iframeWin.postMessage({
          type: 'LOAD_DATA',
          data: {
            records: semanticRecords,
            coords_2d: semantic2DCoords,
            cluster_assignment: semanticClusterAssignment,
            clusters: semanticClusters
          }
        }, '*');
      }
    }
  };

  useEffect(() => {
    sendDataToMap();
  }, [semantic2DCoords, semanticClusterAssignment, semanticClusters, semanticRecords]);

  // Handle map ready signal
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'MAP_READY') {
        sendDataToMap();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [semantic2DCoords, semanticClusterAssignment, semanticClusters, semanticRecords]);

  // Filtered preview data
  const filteredRecords = (semanticRecords || []).filter(r => {
    const q = searchQuery.toLowerCase();
    return (
      (r.title || '').toLowerCase().includes(q) ||
      (r.abstract || '').toLowerCase().includes(q) ||
      (r.doi && r.doi.toLowerCase().includes(q)) ||
      (r.keywords || []).some(k => k && k.toLowerCase().includes(q))
    );
  });

  const getDoiUrl = (doi: string) => {
    if (doi.startsWith('10.')) return `https://doi.org/${doi}`;
    if (doi.startsWith('PMID_')) return `https://pubmed.ncbi.nlm.nih.gov/${doi.replace('PMID_', '')}`;
    if (doi.startsWith('http')) return doi;
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(doi)}`;
  };

  return (
    <div className="flex flex-col space-y-6 pb-12 w-full">
      {/* Top Row: Control Panel (1/3) & Extracted Table (2/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* 1. Control panel left column */}
        <div className="lg:col-span-1 space-y-6 flex flex-col overflow-auto max-h-[60vh] pr-2">
        {/* Step 1: Upload, Parse and Embed */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-gray-200 flex items-center space-x-2">
            <Upload className="w-4 h-4 text-indigo-400" />
            <span>1. Load and Vectorize</span>
          </h3>

          {!semanticRecords ? (
            <div className="space-y-4">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-800 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-gray-800 transition-all text-center"
              >
                <Upload className="w-8 h-8 text-gray-500 mb-2" />
                <p className="text-xs text-gray-300 font-medium">Browse bibliographic file</p>
                <p className="text-[10px] text-gray-600 mt-1">WoS, Scopus (.txt, .csv), PubMed (.txt), RIS, VOS JSON</p>
              </div>
              <input type="file" ref={fileInputRef} accept=".txt,.csv,.tsv,.ris,.json,.map,.net" className="hidden" onChange={handleFileUpload} />
              
              {sharedBibFile && (
                <div className="bg-emerald-950/40 px-3 py-2.5 rounded-xl border border-emerald-800/60 flex justify-between items-center">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-xs text-emerald-400 font-bold truncate" title={sharedBibFile.name}>{sharedBibFile.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{(sharedBibFile.size / 1024).toFixed(1)} KB &bull; Shared file ready</span>
                  </div>
                  <button onClick={() => setSharedBibFile(null)} className="text-[10px] text-gray-500 hover:text-red-400 font-bold px-1.5 py-0.5" title="Remove file">✕ Clear</button>
                </div>
              )}

              {/* Extras configuration */}
              <div className="space-y-2 bg-gray-950 p-3 rounded-xl border border-gray-800">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide block">Fields to Extract</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={extractTitle} onChange={(e) => setExtractTitle(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-indigo-600" />
                    <span>Title</span>
                  </label>
                  <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={extractAbstract} onChange={(e) => setExtractAbstract(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-indigo-600" />
                    <span>Abstract</span>
                  </label>
                  <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={extractKeywords} onChange={(e) => setExtractKeywords(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-indigo-600" />
                    <span>Keywords</span>
                  </label>
                  <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={extractJournal} onChange={(e) => setExtractJournal(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-indigo-600" />
                    <span>Journal (SO)</span>
                  </label>
                </div>
                <div className="pt-2 border-t border-gray-800 mt-2">
                  <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={useMesh} onChange={(e) => setUseMesh(e.target.checked)} className="rounded bg-gray-900 border-gray-700 text-indigo-600" />
                    <span>Include MeSH (PubMed)</span>
                  </label>
                </div>
              </div>

              <button
                onClick={runPreprocessing}
                disabled={isSemanticPreprocessing || !sharedBibFile}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-bold rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSemanticPreprocessing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Process File</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-emerald-950 bg-opacity-20 border border-emerald-800/40 rounded-xl p-3 flex justify-between items-center text-xs">
                <div>
                  <p className="text-emerald-400 font-bold truncate max-w-[180px]" title={semanticFileName}>{semanticFileName}</p>
                  <p className="text-gray-400 text-[10px] mt-0.5">Extracted {semanticRecords.length} articles.</p>
                </div>
                <button onClick={clearSemanticState} className="text-[10px] text-gray-500 hover:text-white">Reset</button>
              </div>

              {/* Embedding execution */}
              {!semanticEmbeddings ? (
                <div className="space-y-3 bg-gray-950 p-3 rounded-xl border border-gray-800">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Embedding Model</label>
                    <select
                      value={semanticEmbedModel}
                      onChange={(e) => setSemanticEmbedModel(e.target.value as 'nomic' | 'specter')}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none"
                    >
                      <option value="nomic">Nomic (LM Studio Remote API)</option>
                      <option value="specter">SPECTER2 (Local SentenceTransformer)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleEmbed}
                    disabled={isSemanticEmbedding}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center justify-center space-x-2"
                  >
                    {isSemanticEmbedding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                    <span>Generate Embeddings</span>
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-950 bg-opacity-20 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-400 font-bold flex items-center space-x-2">
                  <span>✓ Embeddings ready ({semanticEmbeddings.length} vectors)</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Dimension Reduction */}
        <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4 ${!semanticEmbeddings ? 'opacity-40 pointer-events-none' : ''}`}>
          <h3 className="text-sm font-bold text-gray-200 flex items-center space-x-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>2. Intrinsic Dimension Reduction</span>
          </h3>

          {/* Phase A: Estimate ceiling */}
          <div className="space-y-2">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Estimate optimal intrinsic dimension using local MLE (95th percentile). The result will be used as K for UMAP reduction.
            </p>
            <button
              onClick={() => estimateSemanticIntrinsicDim()}
              disabled={isSemanticReducing}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center justify-center space-x-2"
            >
              {isSemanticReducing && !semanticCeilingResult ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              <span>Calculate Intrinsic Dimension</span>
            </button>

            {semanticCeilingResult && (
              <div className="bg-gray-950 rounded-xl p-3 border border-gray-800 text-[10px] space-y-2">
                <div className="text-center">
                  <span className="text-emerald-400 font-black text-2xl block">{semanticCeilingResult.estimated_dimension.toFixed(1)}</span>
                  <span className="text-gray-500 text-[9px] uppercase font-bold">Recommended Target Dimension (95th Percentile MLE)</span>
                </div>
                {semanticCeilingResult.metrics && (
                  <div className="grid grid-cols-2 gap-1 text-[9px] border-t border-gray-800 pt-2">
                    <div className="bg-gray-900 p-1.5 rounded text-center">
                      <span className="block text-gray-500">Median</span>
                      <span className="font-bold text-gray-200">{semanticCeilingResult.metrics.median?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div className="bg-gray-900 p-1.5 rounded text-center">
                      <span className="block text-gray-500">Mean</span>
                      <span className="font-bold text-gray-200">{semanticCeilingResult.metrics.mean?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div className="bg-gray-900 p-1.5 rounded text-center">
                      <span className="block text-gray-500">90th Percentile</span>
                      <span className="font-bold text-gray-200">{semanticCeilingResult.metrics.p90?.toFixed(2) || 'N/A'}</span>
                    </div>
                    <div className="bg-gray-900 p-1.5 rounded text-center">
                      <span className="block text-gray-500">Maximum</span>
                      <span className="font-bold text-gray-200">{semanticCeilingResult.metrics.max?.toFixed(2) || 'N/A'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Phase B: Reduce to K dimensions */}
          <div className={`space-y-2 border-t border-gray-800 pt-3 ${!semanticEmbeddings ? 'opacity-50' : ''}`}>
            <p className="text-[10px] text-gray-500">
              Adjust Target K and apply UMAP to that dimension (for clustering) and to 2D (for visualization).
            </p>
            <div className="flex space-x-3 items-end">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Target K</label>
                <input
                  type="number"
                  min="2"
                  value={semanticTargetD}
                  onChange={(e) => setSemanticTargetD(parseInt(e.target.value) || 2)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none"
                />
              </div>
              <button
                onClick={reduceSemanticDimension}
                disabled={isSemanticReducing}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-2 disabled:opacity-50"
              >
                {isSemanticReducing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>Reduce</span>}
              </button>
            </div>

            {semantic2DCoords && (
              <div className="bg-emerald-950 bg-opacity-20 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-400 font-bold flex items-center space-x-2">
                <span>✓ Reduction ready — {semanticIntrinsicData?.length || 0} points in K={semanticTargetD}D + 2D</span>
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Clustering & automatic AI labels */}
        <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4 ${!semanticIntrinsicData ? 'opacity-40 pointer-events-none' : ''}`}>
          <h3 className="text-sm font-bold text-gray-200 flex items-center space-x-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>3. Clustering & AI Labeling</span>
          </h3>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Apply HDBSCAN in intrinsic dimension and KMeans on 2D coordinates. A local LLM will label the thematic areas in English with automatic TF-IDF fallbacks.
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Zoom Levels</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={semanticNumLevels}
                  onChange={(e) => setSemanticNumLevels(parseInt(e.target.value) || 2)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Min Cluster Size</label>
                <input
                  type="number"
                  min="3"
                  value={semanticMinSize}
                  onChange={(e) => setSemanticMinSize(parseInt(e.target.value) || 10)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={clusterSemantic}
              disabled={isSemanticClustering}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition flex items-center justify-center space-x-2"
            >
              {isSemanticClustering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Generate Clusters</span>
            </button>

            {semanticClusters && (
              <div className="bg-emerald-950 bg-opacity-20 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-400 font-bold flex items-center space-x-2">
                <span>✓ {semanticClusters.length} Level 1 clusters created</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Searchable preview table */}
      <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl flex flex-col overflow-hidden max-h-[60vh]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-gray-800 mb-4 gap-2">
          <h3 className="text-sm font-bold text-gray-200 flex items-center space-x-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <span>Extracted Articles ({filteredRecords.length})</span>
          </h3>
          
          {/* Search Input */}
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search title, abstract, DOI..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Table Container */}
        <div className="flex-1 overflow-auto">
          {filteredRecords.length === 0 ? (
            <div className="text-center text-xs text-gray-600 py-8">
              No data to display.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="py-2 font-semibold">Title</th>
                  <th className="py-2 font-semibold">Keywords / MeSH</th>
                  <th className="py-2 font-semibold">Vector</th>
                  <th className="py-2 font-semibold">Topic</th>
                  <th className="py-2 font-semibold text-right">DOI</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.slice(0, 10).map((record, idx) => {
                  const originalIdx = semanticRecords ? semanticRecords.indexOf(record) : -1;
                  const label = (semanticClusterAssignment && originalIdx !== -1 && originalIdx < semanticClusterAssignment.length)
                    ? semanticClusterAssignment[originalIdx]
                    : null;
                  const vector = (semanticEmbeddings && originalIdx !== -1 && originalIdx < semanticEmbeddings.length)
                    ? semanticEmbeddings[originalIdx]
                    : null;
                  return (
                    <tr key={record.id || idx} className="border-b border-gray-800/40 hover:bg-gray-850/30 transition-colors">
                      <td className="py-3 pr-4 font-medium text-gray-100 max-w-sm truncate" title={record.title}>
                        {record.title}
                      </td>
                      <td className="py-3 pr-4 text-gray-400 max-w-xs truncate" title={(record.keywords || []).join(', ')}>
                        {(record.keywords || []).join(', ') || 'N/A'}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[10px]" title={vector ? JSON.stringify(vector) : undefined}>
                        {vector ? (
                          <span className="text-emerald-400 font-semibold">
                            {`[${vector.slice(0, 3).map(v => v.toFixed(3)).join(', ')}, ...] (${vector.length}d)`}
                          </span>
                        ) : (
                          <span className="text-gray-600 italic">Unvectorized</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-indigo-400 font-semibold">
                        {label || 'Noise'}
                      </td>
                      <td className="py-3 text-right">
                        {record.doi ? (
                          <a
                             href={getDoiUrl(record.doi)}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="inline-flex items-center text-indigo-500 hover:text-indigo-400 space-x-1"
                          >
                             <span className="truncate max-w-[90px]">{record.doi}</span>
                             <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-600">N/A</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filteredRecords.length > 10 && (
            <div className="text-[10px] text-gray-500 text-center py-2 border-t border-gray-800/20">
              Showing first 10 of {filteredRecords.length} articles. Use the search box to filter.
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Bottom Row: WebGL Map visualizer spanning full width */}
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl relative w-full" style={{ height: '800px' }}>
      <div className="absolute top-4 left-4 z-20 flex items-center space-x-2 bg-gray-950/80 px-3 py-1.5 rounded-full border border-gray-800 backdrop-blur-md">
        <Compass className="w-4 h-4 text-indigo-400 animate-pulse" />
        <span className="text-[10px] text-gray-200 font-black tracking-wider uppercase">Semantic Literature Map</span>
      </div>

      <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
        <SendToAssistantButton
          title="Semantic Literature Map (Embeddings & Clusters)"
          badge="SEMANTICS"
          viewSource="semantic"
          chartType="scatter"
          data={semantic2DCoords ? semantic2DCoords.map((c, i) => ({
            x: c.x,
            y: c.y,
            title: semanticRecords?.[i]?.title || `Doc ${i}`,
            cluster: semanticClusterAssignment?.[i] || 'Noise'
          })) : []}
          dataContextPrompt={`Semantic Literature Map (${semanticFileName || 'Dataset'}).\nEmbedding Model: ${semanticEmbedModel}.\nTotal documents: ${semanticRecords?.length || 0}.\nOptimal Intrinsic Dimension K=${semanticTargetD}.\nIdentified semantic clusters: ${semanticClusters?.length || 0}.\nTopics: ${semanticClusters?.map(c => c.label || c.name || `Cluster ${c.id}`).slice(0, 12).join(', ')}.`}
          buttonText="AI Assistant"
          variant="header"
        />
      </div>

      <iframe
        ref={iframeRef}
        src="./semantic_map.html"
        className="w-full h-full border-none bg-gray-950"
        scrolling="no"
      />
    </div>
  </div>
);
};
