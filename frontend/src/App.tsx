import React, { useState, useEffect, useRef } from 'react';
import { useSomStore } from './store/somStore';
import { RedBibliometrica } from './components/RedBibliometrica';
import { ExploradorDatos } from './components/ExploradorDatos';
import { DimReduction } from './components/DimReduction';
import { Database, Share2, Sliders, ArrowRight, RefreshCw, ChevronLeft, ChevronRight, Settings, Upload, Save, FolderOpen, Layers } from 'lucide-react';

export default function App() {
  const { 
    activeTab, 
    setActiveTab, 
    isPreprocessing, 
    preprocessBibliometrics,
    fetchSystemStatus,
    hardware,
    pendingNetworkCsv,
    uploadProgress,
    exportProject,
    importProject
  } = useSomStore();

  // Collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Preprocessor form states
  const [bibFile, setBibFile] = useState<File | null>(null);
  const [networkType, setNetworkType] = useState<string>('co-occurrence');
  const [customTag, setCustomTag] = useState<string>('DE');
  const [customTag2, setCustomTag2] = useState<string>('AU');
  const [showAdvancedPopup, setShowAdvancedPopup] = useState<boolean>(false);
  const [maxTerms, setMaxTerms] = useState<number>(50);
  const [minCooc, setMinCooc] = useState<number>(2);
  const [temporal, setTemporal] = useState<boolean>(false);
  const [showTagsModal, setShowTagsModal] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const getNetworkTypeOptions = () => {
    return [
      { value: 'co-occurrence', label: 'Co-occurrence (Keywords, etc.)' },
      { value: 'co-authorship', label: 'Co-Authorship' },
      { value: 'co-citation', label: 'Co-Citation' },
      { value: 'citation', label: 'Citation' },
      { value: 'bib-coupling', label: 'Bibliographic Coupling' },
      { value: 'bipartite', label: 'Bipartite (Custom)' }
    ];
  };

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  const handleTabChange = (newTab: 'multidimensional' | 'bibliometrics' | 'dimreduction') => {
    const state = useSomStore.getState();
    if (newTab === 'multidimensional' && state.activeTab === 'bibliometrics') {
      if (state.pendingNetworkCsv) {
        if (window.confirm("You have calculated new networks in Bibliometrics.\nDo you want these new networks to replace the existing data in Data & SOM?")) {
          state.loadCsvData(state.pendingNetworkCsv, 0, [], state.pendingNetworkOrigin || 'monothematic');
          useSomStore.setState({ pendingNetworkCsv: null, pendingNetworkOrigin: null });
        }
      }
    }
    setActiveTab(newTab);
  };

  // Deprecated handleSelectFile removed, using standard input type="file"


  const handlePreprocess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bibFile) {
      alert("Please select a file first.");
      return;
    }
    const finalCustomTag = networkType === 'bipartite' ? `${customTag},${customTag2}` : customTag;
    await preprocessBibliometrics(
      bibFile, 
      networkType,
      finalCustomTag,
      maxTerms, 
      minCooc, 
      true, // onlyMajor is unused now, passed as true
      temporal
    );
  };

  // Dynamic padding based on collapsed statebar
  const getHardwareColor = () => {
    if (hardware?.level === 1) return 'bg-emerald-400 shadow-[0_0_8px_#00F0FF]';
    if (hardware?.level === 2) return 'bg-amber-400 shadow-[0_0_8px_#fbbf24]';
    return 'bg-gray-500';
  };

  const getHardwareTitle = () => {
    if (hardware?.level === 1) return `GPU Active: ${hardware.device}`;
    if (hardware?.level === 2) return `Accelerated: ${hardware.device}`;
    return `CPU Mode: ${hardware?.device || 'Local execution'}`;
  };

  return (
    <>
      <div className="flex h-screen w-full bg-gray-950 text-gray-100 font-sans antialiased overflow-hidden">
        {/* 1. Left Navigation Sidebar */}
        <aside 
        className={`relative ${
          isSidebarCollapsed ? 'w-16' : 'w-80'
        } bg-gray-900 border-r border-gray-800 flex flex-col justify-between shadow-2xl transition-width duration-300 z-30`}
      >
        {/* Toggle Collapse Button */}
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute top-1/2 -right-3 transform -translate-y-1/2 w-6 h-6 bg-gray-900 border border-gray-800 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:border-indigo-500 transition-all shadow-md z-50 cursor-pointer"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        <div className="flex flex-col space-y-8 p-6">
          {/* Logo Header */}
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'space-x-3'}`}>
            <div className="w-8 h-8 bg-gray-950 border border-gray-800 rounded-xl flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-900 shadow-opacity-10 shrink-0">
              <img src="./icon.png" alt="Sinapsis Map Logo" className="w-full h-full object-cover" />
            </div>
            {!isSidebarCollapsed && (
              <div className="transition-opacity-custom">
                <h1 className="text-md font-black tracking-tight text-white leading-tight">Sinapsis Map</h1>
                <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">V3.0 Hybrid Desktop</span>
              </div>
            )}
          </div>

          {/* Nav Items */}
          <nav className="flex flex-col space-y-1-5">
            <button
              onClick={() => handleTabChange('bibliometrics')}
              title={isSidebarCollapsed ? "Bibliometrics" : undefined}
              className={`flex items-center ${
                isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
              } rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'bibliometrics'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950 shadow-opacity-50'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="flex items-center">
                <Share2 className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} /> 
                {!isSidebarCollapsed && <span>Bibliometrics</span>}
              </span>
              {!isSidebarCollapsed && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
            </button>

            <button
              onClick={() => handleTabChange('multidimensional')}
              title={isSidebarCollapsed ? "Data & SOM" : undefined}
              className={`flex items-center ${
                isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
              } rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'multidimensional'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950 shadow-opacity-50'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="flex items-center">
                <Database className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} /> 
                {!isSidebarCollapsed && <span>Data & SOM</span>}
              </span>
              {!isSidebarCollapsed && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
            </button>

            <button
              onClick={() => handleTabChange('dimreduction')}
              title={isSidebarCollapsed ? "Dim Reduction" : undefined}
              className={`flex items-center ${
                isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
              } rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'dimreduction'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950 shadow-opacity-50'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="flex items-center">
                <Layers className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} /> 
                {!isSidebarCollapsed && <span>Dim Reduction</span>}
              </span>
              {!isSidebarCollapsed && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
            </button>
          </nav>
        </div>

        {/* System footer */}
        <div className={`p-6 border-t border-gray-800 bg-gray-950 flex ${isSidebarCollapsed ? 'justify-center' : 'flex-col'}`}>
          {isSidebarCollapsed ? (
            <div 
              className={`w-3.5 h-3.5 rounded-full ${getHardwareColor()} transition-all cursor-help`}
              title={getHardwareTitle()}
            />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Hardware:</span>
                <span className="text-emerald-400 font-bold uppercase tracking-wider">
                  {hardware?.level === 1 ? 'NVIDIA GPU' : hardware?.level === 2 ? 'Accelerated' : 'Local CPU'}
                </span>
              </div>
              <p className="text-[10px] text-gray-600 truncate mt-1">{hardware?.device || "Validating hardware..."}</p>
            </>
          )}
        </div>
      </aside>

      {/* 2. Main Area Container */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-950">
        <header className="px-8 py-6 bg-gray-900 bg-opacity-30 border-b border-gray-800 flex items-center justify-between shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-white uppercase tracking-wide">
              {activeTab === 'multidimensional' && 'Multidimensional Data Analysis'}
              {activeTab === 'bibliometrics' && 'Bibliometric Preprocessing'}
              {activeTab === 'dimreduction' && 'Dimensionality Estimation & Reduction'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {activeTab === 'multidimensional' && 'Load CSV datasets and train your Self-Organizing Map (SOM).'}
              {activeTab === 'bibliometrics' && 'Extract and parse scientific metrics from PubMed/WoS to build co-occurrence networks.'}
              {activeTab === 'dimreduction' && 'Estimate intrinsic dimensionality and reduce feature space using UMAP before training.'}
            </p>
          </div>
          
          <div className="flex space-x-3">
            <button 
              onClick={() => projectInputRef.current?.click()}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs font-bold rounded-xl transition flex items-center space-x-2"
              title="Load Workspace"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Load Project</span>
            </button>
            <input
              type="file"
              ref={projectInputRef}
              accept=".json,.labsom"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const content = event.target?.result as string;
                    importProject(content);
                  };
                  reader.readAsText(file);
                }
              }}
              className="hidden"
            />
            
            <button 
              onClick={() => exportProject()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900 shadow-opacity-20 flex items-center space-x-2"
              title="Save Workspace"
            >
              <Save className="w-4 h-4" />
              <span>Save Project</span>
            </button>
          </div>
        </header>

        {/* 3. Render Dashboard Tabs */}
        <section className="flex-1 overflow-auto p-8">
          {/* Tab 1: Dataset & SOM config */}
          {activeTab === 'multidimensional' && <ExploradorDatos />}

          {/* Tab 2: Bibliometrics */}
          {activeTab === 'bibliometrics' && <RedBibliometrica />}

          {/* Tab 3: Dim Reduction */}
          {activeTab === 'dimreduction' && <DimReduction />}
          {/* Tab 3: Bibliometrics Preprocessor */}
          {activeTab === 'bibliometrics' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
              {/* Bibliometric input form */}
              <div className="lg:col-span-1 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl space-y-6 flex flex-col overflow-auto max-h-[75vh]">
                <div>
                  <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2">
                    <Sliders className="w-5 h-5 text-indigo-400" />
                    <span>Bibliometric Configuration</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Configure local source paths and parsing thresholds to build co-occurrence maps.</p>
                </div>

                <form onSubmit={handlePreprocess} className="space-y-4">

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bibliometric Data Source</label>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-4">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-2"
                        >
                          <Upload className="w-4 h-4" />
                          <span>Import Bibliometric Data</span>
                        </button>
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept=".txt,.csv,.tsv"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setBibFile(file);
                          }}
                          className="hidden"
                        />
                        {bibFile && (
                          <span className="text-xs text-emerald-400 font-bold truncate max-w-[200px]" title={bibFile.name}>
                            {bibFile.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Network Type</label>
                      <select
                        value={networkType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNetworkType(val);
                          if (val === 'co-occurrence' || val === 'bipartite') {
                            setShowAdvancedPopup(true);
                          } else {
                            setShowAdvancedPopup(false);
                          }
                          
                          if (val === 'bipartite') {
                            setMaxTerms(10);
                          }
                        }}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                      >
                        {getNetworkTypeOptions().map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Max Nodes</label>
                      <input
                        type="number"
                        value={maxTerms}
                        onChange={(e) => setMaxTerms(parseInt(e.target.value) || 20)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Min Co-occurrence Weight</label>
                    <input
                      type="number"
                      value={minCooc}
                      onChange={(e) => setMinCooc(parseInt(e.target.value) || 2)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                    />
                  </div>

                  {(networkType === 'co-occurrence' || networkType === 'bipartite') && (
                    <div className="mt-2">
                      <button 
                        type="button" 
                        onClick={() => setShowAdvancedPopup(!showAdvancedPopup)}
                        className="text-xs text-gray-200 hover:text-white font-bold tracking-wide uppercase flex items-center space-x-1"
                      >
                        <Settings className="w-4 h-4" />
                        <span>Advanced Tag Config</span>
                      </button>
                      
                      {showAdvancedPopup && (
                        <div className="mt-3 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
                          {networkType === 'bipartite' ? (
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tag 1 (Columns)</label>
                                <input
                                  type="text"
                                  value={customTag2}
                                  onChange={(e) => setCustomTag2(e.target.value)}
                                  placeholder="e.g. MH"
                                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tag 2 (Rows)</label>
                                <input
                                  type="text"
                                  value={customTag}
                                  onChange={(e) => setCustomTag(e.target.value)}
                                  placeholder="e.g. AU"
                                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                                />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Custom Tag (2-Letter Code)</label>
                              <input
                                type="text"
                                value={customTag}
                                onChange={(e) => setCustomTag(e.target.value)}
                                placeholder="e.g. DE, ID, AU, CR"
                                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                              />
                            </div>
                          )}
                          <p className="text-[10px] text-gray-500">
                            <strong>WoS/Scopus:</strong> <b>DE</b> (Author Keywords), <b>ID</b> (Keywords Plus), <b>AU</b> (Authors), <b>CR</b> (Cited Refs), <b>C1</b> (Institutions), <b>CU</b> (Countries), <b>PY</b> (Year).<br/>
                            <strong>PubMed (MEDLINE):</strong> <b>MH</b> (MeSH Terms), <b>OT</b> (Other Terms/Keywords), <b>AU</b> (Authors), <b>AD</b> (Affiliation), <b>JT</b> (Journal Title), <b>DP</b> (Year).
                            <br/><button type="button" onClick={() => setShowTagsModal(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-[10px] font-bold transition mt-2 inline-block">View full tags list</button>
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col space-y-3 pt-2 pb-2 border-t border-gray-800 mt-4">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="temporal"
                        checked={temporal}
                        onChange={(e) => setTemporal(e.target.checked)}
                        className="w-4 h-4 bg-gray-950 border-gray-800 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                      />
                      <label htmlFor="temporal" className="text-xs text-gray-200 cursor-pointer select-none font-bold uppercase tracking-wide">
                        Generate Temporal Sequences (PathSOM)
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isPreprocessing}
                    className="relative w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-900 disabled:text-gray-500 text-white rounded-xl font-bold transition flex items-center justify-center space-x-2 mt-4 overflow-hidden"
                  >
                    {isPreprocessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin z-10" />
                        <span className="z-10">
                          {uploadProgress !== null && uploadProgress < 100 
                            ? `Uploading dataset... ${uploadProgress}%` 
                            : 'Analyzing data on server...'}
                        </span>
                        {uploadProgress !== null && uploadProgress < 100 && (
                          <div 
                            className="absolute left-0 top-0 bottom-0 bg-indigo-500 opacity-35 transition-all duration-200" 
                            style={{ width: `${uploadProgress}%` }}
                          />
                        )}
                      </>
                    ) : (
                      <span>Process Bibliometrics</span>
                    )}
                  </button>
                  
                  {pendingNetworkCsv && (
                    <button
                      type="button"
                      onClick={() => handleTabChange('multidimensional')}
                      className="w-full py-2 mt-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center space-x-2 text-xs"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Send Data to SOM & Switch Tab</span>
                    </button>
                  )}
                </form>
              </div>

              {/* Interactive Network Graph */}
              <div className="lg:col-span-2">
                <RedBibliometrica />
              </div>
            </div>
          )}
        </section>
      </main>
      </div>

      {/* Tags Reference Modal */}
      {showTagsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-80 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-950 rounded-t-2xl">
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">Metaknowledge Processable Tags</h3>
              <button onClick={() => setShowTagsModal(false)} className="text-gray-400 hover:text-white transition cursor-pointer">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
              {/* Web of Science / Scopus */}
              <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 shadow-inner">
                <h4 className="text-emerald-400 font-bold uppercase tracking-widest text-sm mb-4 border-b border-gray-800 pb-2">Web of Science / Scopus</h4>
                <ul className="text-sm text-gray-300 space-y-3">
                  <li><b className="text-indigo-400 inline-block w-10">DE</b> Author Keywords</li>
                  <li><b className="text-indigo-400 inline-block w-10">ID</b> Keywords Plus</li>
                  <li><b className="text-indigo-400 inline-block w-10">AU</b> Authors</li>
                  <li><b className="text-indigo-400 inline-block w-10">CR</b> Cited References</li>
                  <li><b className="text-indigo-400 inline-block w-10">C1</b> Institutions</li>
                  <li><b className="text-indigo-400 inline-block w-10">CU</b> Countries</li>
                  <li><b className="text-indigo-400 inline-block w-10">PY</b> Year</li>
                </ul>
              </div>

              {/* PubMed */}
              <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 shadow-inner">
                <h4 className="text-emerald-400 font-bold uppercase tracking-widest text-sm mb-4 border-b border-gray-800 pb-2">PubMed (MEDLINE)</h4>
                <ul className="text-sm text-gray-300 space-y-3">
                  <li><b className="text-indigo-400 inline-block w-10">MH</b> MeSH Terms</li>
                  <li><b className="text-indigo-400 inline-block w-10">OT</b> Other Terms/Keywords</li>
                  <li><b className="text-indigo-400 inline-block w-10">AU</b> Authors</li>
                  <li><b className="text-indigo-400 inline-block w-10">AD</b> Affiliation</li>
                  <li><b className="text-indigo-400 inline-block w-10">JT</b> Journal Title</li>
                  <li><b className="text-indigo-400 inline-block w-10">DP</b> Year</li>
                </ul>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-950 border-t border-gray-800 text-right rounded-b-2xl">
              <button 
                onClick={() => setShowTagsModal(false)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
