import React, { useState, useEffect, useRef } from 'react';
import { useSomStore } from './store/somStore';
import { RedBibliometrica } from './components/RedBibliometrica';
import { ExploradorDatos } from './components/ExploradorDatos';
import { DimReduction } from './components/DimReduction';
import { SemanticBibliometrics } from './components/SemanticBibliometrics';
import { InCitesExplorer } from './components/InCitesExplorer';
import { AiAssistantTab } from './components/AiAssistantTab';
import { LongitudinalSomViewer } from './components/LongitudinalSomViewer';
import { useAiStore } from './store/aiStore';
import { useAuthStore } from './store/authStore';
import { LoginScreen } from './components/LoginScreen';
import { LoginModal } from './components/LoginModal';
import { UserManagementModal } from './components/UserManagementModal';
import { ProjectsDrawer } from './components/ProjectsDrawer';
import { LlmConfigModal } from './components/LlmConfigModal';
import { VosApiModal } from './components/vos/VosApiModal';
import { Database, Share2, Sliders, ArrowRight, RefreshCw, ChevronLeft, ChevronRight, Settings, Upload, Save, FolderOpen, FolderX, Layers, Compass, BarChart2, ChevronDown, BookOpen, Cloud, User as UserIcon, LogIn, LogOut, Shield, Bot, Key, TrendingUp } from 'lucide-react';

const isDesktopApp = typeof (window as any).external?.sendMessage === 'function';

export default function App() {
  const {
    activeTab,
    setActiveTab,
    sharedBibFile,
    setSharedBibFile,
    isPreprocessing,
    preprocessBibliometrics,
    fetchSystemStatus,
    hardware,
    pendingNetworkCsv,
    uploadProgress,
    exportProject,
    importProject,
    clearProject,
    temporalWindow,
    setTemporalWindow,
    cooccurrenceMatricesByPeriod,
    setTemporalAnalysisMode
  } = useSomStore();

  const { llmConfig, openLlmConfigModal } = useAiStore();
  const { isWebMode, isAuthenticated, user, checkAuth, saveCloudProject, logout, isLoading: isAuthLoading } = useAuthStore();

  const [biblioMainView, setBiblioMainView] = useState<'network' | 'longitudinal'>('network');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isUserMgmtModalOpen, setIsUserMgmtModalOpen] = useState(false);
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);

  const handleSaveToCloud = async () => {
    const state = useSomStore.getState();
    const authState = useAuthStore.getState();
    const activeFileName = state.fileName || state.semanticFileName || state.dimFileName || (state.incitesUnitNames && state.incitesUnitNames.length > 0 ? 'InCites Project' : 'My Project');
    const fallbackTitle = activeFileName.replace(/\.[^/.]+$/, '');
    const currentTitle = state.cloudProjectTitle || fallbackTitle;

    // Check if current project is owned by the logged-in user or shared
    const isOwnedByMe = authState.ownedProjects.some(p => p.id === state.cloudProjectId);
    const sharedProjectInfo = authState.sharedProjects.find(p => p.id === state.cloudProjectId);
    const isSharedWithMe = !!sharedProjectInfo;

    let promptMessage = "Enter project title to save on server:";
    if (state.cloudProjectId) {
      if (isSharedWithMe && !isOwnedByMe) {
        promptMessage = `This project was shared by @${sharedProjectInfo?.ownerUsername || 'another user'}. Save a copy to your projects (change name to customize):`;
      } else {
        promptMessage = `Save changes to server project '${state.cloudProjectTitle}'? (Change name to save as new):`;
      }
    }

    const title = prompt(promptMessage, currentTitle);
    if (!title || !title.trim()) return;

    const trimmedTitle = title.trim();
    const isSameTitle = trimmedTitle === (state.cloudProjectTitle || '').trim();

    setIsSavingCloud(true);

    // If the name changed OR if this is a shared project where name changed or user is not an editor with same name,
    // targetId must be null so a brand new project is created for the current user.
    let targetId: string | null = null;
    if (state.cloudProjectId && isSameTitle) {
      if (isOwnedByMe) {
        targetId = state.cloudProjectId;
      } else if (isSharedWithMe && sharedProjectInfo?.permission === 'Write') {
        targetId = state.cloudProjectId;
      }
    }

    const success = await saveCloudProject(trimmedTitle, undefined, targetId);
    setIsSavingCloud(false);

    if (success) {
      alert(`Project '${trimmedTitle}' saved successfully to server!`);
    } else {
      alert("Failed to save project to server.");
    }
  };

  // Collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Collapsible Bibliometrics group menu state (collapsed by default)
  const [isBiblioMenuOpen, setIsBiblioMenuOpen] = useState(false);

  // Theme state
  const [theme, setTheme] = useState<'dark' | 'navy' | 'light'>(
    () => (localStorage.getItem('labsom-theme') as 'dark' | 'navy' | 'light') || 'dark'
  );

  const applyTheme = (t: 'dark' | 'navy' | 'light') => {
    setTheme(t);
    localStorage.setItem('labsom-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  };

  // Apply theme on mount
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  // Preprocessor form states
  const [networkType, setNetworkType] = useState<string>('co-occurrence:all_keywords');
  const [customTag, setCustomTag] = useState<string>('AU');
  const [customTag2, setCustomTag2] = useState<string>('DE');
  const [showAdvancedPopup, setShowAdvancedPopup] = useState<boolean>(false);
  const [maxTerms, setMaxTerms] = useState<number>(50);
  const [minCooc, setMinCooc] = useState<number>(2);
  const [temporal, setTemporal] = useState<boolean>(false);
  const [showTagsModal, setShowTagsModal] = useState<boolean>(false);
  const [showApiModal, setShowApiModal] = useState<boolean>(false);

  // VOSviewer Advanced NLP & Thesaurus states
  const [extractionSource, setExtractionSource] = useState<'keywords' | 'title_abstract' | 'title' | 'abstract'>('keywords');
  const [countingMethod, setCountingMethod] = useState<'full' | 'fractional'>('full');
  const [thesaurusFile, setThesaurusFile] = useState<File | null>(null);
  const [relevanceRatio, setRelevanceRatio] = useState<number>(0.60);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thesaurusInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const getNetworkTypeOptions = () => {
    return [
      {
        group: 'Co-authorship',
        options: [
          { value: 'co-authorship:authors', label: 'Authors (AU)' },
          { value: 'co-authorship:organizations', label: 'Organizations (Affiliations)' },
          { value: 'co-authorship:countries', label: 'Countries (CU)' },
        ]
      },
      {
        group: 'Co-occurrence',
        options: [
          { value: 'co-occurrence:all_keywords', label: 'All Keywords (Author + Keywords Plus)' },
          { value: 'co-occurrence:author_keywords', label: 'Author Keywords (DE)' },
          { value: 'co-occurrence:keywords_plus', label: 'KeyWords Plus (ID)' },
        ]
      },
      {
        group: 'Citation',
        options: [
          { value: 'citation:documents', label: 'Documents' },
          { value: 'citation:sources', label: 'Sources / Journals (SO)' },
          { value: 'citation:authors', label: 'Authors (AU)' },
          { value: 'citation:organizations', label: 'Organizations (Affiliations)' },
          { value: 'citation:countries', label: 'Countries (CU)' },
        ]
      },
      {
        group: 'Bibliographic Coupling',
        options: [
          { value: 'bib-coupling:documents', label: 'Documents' },
          { value: 'bib-coupling:sources', label: 'Sources / Journals (SO)' },
          { value: 'bib-coupling:authors', label: 'Authors (AU)' },
          { value: 'bib-coupling:organizations', label: 'Organizations (Affiliations)' },
          { value: 'bib-coupling:countries', label: 'Countries (CU)' },
        ]
      },
      {
        group: 'Co-citation',
        options: [
          { value: 'co-citation:cited_references', label: 'Cited References (CR)' },
          { value: 'co-citation:cited_sources', label: 'Cited Sources / Journals' },
          { value: 'co-citation:cited_authors', label: 'Cited Authors' },
        ]
      },
      {
        group: 'Custom',
        options: [
          { value: 'bipartite', label: 'Bipartite (Two-Mode Custom)' },
        ]
      }
    ];
  };

  useEffect(() => {
    fetchSystemStatus();
    checkAuth();
    
    // Prevent accidental page refresh or close
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Setting returnValue to any string triggers the browser's native confirmation dialog
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const aiEntries = useAiStore(state => state.entries);

  if (isWebMode && !isAuthenticated && !isAuthLoading) {
    return <LoginScreen />;
  }

  const handleTabChange = (newTab: 'multidimensional' | 'bibliometrics' | 'dimreduction' | 'semantic_bibliometrics' | 'incites' | 'asistente') => {
    const state = useSomStore.getState();
    if (newTab === 'multidimensional' && state.activeTab === 'bibliometrics') {
      if (state.pendingNetworkCsv) {
        state.loadCsvData(state.pendingNetworkCsv, 0, [], state.pendingNetworkOrigin || 'monothematic');
        useSomStore.setState({ pendingNetworkCsv: null, pendingNetworkOrigin: null });
      }
    }
    setActiveTab(newTab);
  };

  const handlePreprocess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sharedBibFile) {
      alert("Please select a file first.");
      return;
    }
    const finalCustomTag = networkType.startsWith('bipartite') ? `${customTag},${customTag2}` : customTag;
    await preprocessBibliometrics(
      sharedBibFile,
      networkType,
      finalCustomTag,
      maxTerms,
      minCooc,
      true,
      temporal,
      extractionSource,
      countingMethod,
      thesaurusFile,
      relevanceRatio
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
      <div className="flex flex-col h-screen w-full bg-gray-950 text-gray-100 font-sans antialiased overflow-hidden">

        {/* Custom Title Bar */}
        {isDesktopApp && (
          <div
            style={{ WebkitAppRegion: 'drag' } as any}
            className="h-10 w-full bg-gray-950 border-b border-gray-900 flex items-center justify-between pl-3 shrink-0 select-none z-50"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'SVG' && (e.target as HTMLElement).tagName !== 'RECT' && (e.target as HTMLElement).tagName !== 'POLYGON') {
                (window as any).external?.sendMessage?.('window:drag');
              }
            }}
          >
            {/* Left: Logo & Title */}
            <div className="flex items-center space-x-2">
              <img src="./icon.png" alt="Logo" className="w-5 h-5 object-cover rounded-sm" />
              <span className="text-xs font-bold text-gray-300 tracking-wide">knoMap</span>
            </div>

            {/* Right: Window Controls */}
            <div style={{ WebkitAppRegion: 'no-drag' } as any} className="flex h-full">
              <button onClick={() => (window as any).external?.sendMessage?.('window:minimize')} className="h-full px-4 bg-gray-950 hover:bg-gray-800 text-white transition-colors flex items-center justify-center border-none outline-none">
                <svg className="pointer-events-none" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg>
              </button>
              <button onClick={() => (window as any).external?.sendMessage?.('window:maximize')} className="h-full px-4 bg-gray-950 hover:bg-gray-800 text-white transition-colors flex items-center justify-center border-none outline-none">
                <svg className="pointer-events-none" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg>
              </button>
              <button onClick={() => (window as any).external?.sendMessage?.('window:close')} className="h-full px-4 bg-gray-950 hover:bg-red-600 text-white transition-colors flex items-center justify-center border-none outline-none">
                <svg className="pointer-events-none" width="12" height="12" viewBox="0 0 12 12"><polygon fill="currentColor" points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"></polygon></svg>
              </button>
            </div>
          </div>
        )}

        {/* Main Workspace (Sidebar + Content) */}
        <div className="flex flex-1 overflow-hidden">
          {/* 1. Left Navigation Sidebar */}
          <aside
            className={`relative ${isSidebarCollapsed ? 'w-16' : 'w-80'
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

            <div className={`flex flex-col flex-1 space-y-8 p-6 ${isDesktopApp ? 'pt-10' : ''}`}>
              {/* Logo Header (Only shown in Browser) */}
              {!isDesktopApp && (
                <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'space-x-3 pt-2 pb-4'}`}>
                  <div
                    className={`bg-gray-950 border border-gray-800 rounded-2xl flex items-center justify-center overflow-hidden shadow-xl shadow-indigo-900/20 shrink-0 transition-all duration-300 ${isSidebarCollapsed ? 'w-8 h-8' : ''}`}
                    style={!isSidebarCollapsed ? { width: '83px', height: '83px' } : undefined}
                  >
                    <img src="./icon.png" alt="knoMap Logo" className="w-full h-full object-cover" />
                  </div>
                  {!isSidebarCollapsed && (
                    <div className="transition-opacity-custom">
                      <h1 className="text-xl font-black tracking-tight text-white leading-tight">knoMap</h1>
                    </div>
                  )}
                </div>
              )}

              {/* Nav Items */}
              <nav className="flex flex-col space-y-1.5">
                {/* 1. SOM & UMAP */}
                <button
                  onClick={() => handleTabChange('multidimensional')}
                  title={isSidebarCollapsed ? "SOM & UMAP" : undefined}
                  className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
                    } rounded-xl text-sm font-semibold transition-all ${activeTab === 'multidimensional'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950 shadow-opacity-50'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                  <span className="flex items-center">
                    <Database className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} />
                    {!isSidebarCollapsed && <span>SOM & UMAP</span>}
                  </span>
                  {!isSidebarCollapsed && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
                </button>

                {/* 2. Dim Reduction */}
                <button
                  onClick={() => handleTabChange('dimreduction')}
                  title={isSidebarCollapsed ? "Dim Reduction" : undefined}
                  className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
                    } rounded-xl text-sm font-semibold transition-all ${activeTab === 'dimreduction'
                      ? 'bg-indigo-600 text-white shadow-lg'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                  <span className="flex items-center">
                    <Layers className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} />
                    {!isSidebarCollapsed && <span>Dim Reduction</span>}
                  </span>
                  {!isSidebarCollapsed && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
                </button>

                {/* 3. Collapsible Bibliometrics Group */}
                {(() => {
                  const isChildActive = activeTab === 'bibliometrics' || activeTab === 'semantic_bibliometrics' || activeTab === 'incites';
                  const isOpen = isBiblioMenuOpen || (isSidebarCollapsed && isChildActive);

                  return (
                    <div className="flex flex-col space-y-1">
                      <button
                        onClick={() => setIsBiblioMenuOpen(!isBiblioMenuOpen)}
                        title={isSidebarCollapsed ? "Bibliometrics" : undefined}
                        className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
                          } rounded-xl text-sm font-semibold transition-all ${
                            isChildActive
                              ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 shadow-inner'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                          }`}
                      >
                        <span className="flex items-center">
                          <BookOpen className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'}`} />
                          {!isSidebarCollapsed && <span>Bibliometrics</span>}
                        </span>
                        {!isSidebarCollapsed && (
                          <ChevronDown
                            className={`w-4 h-4 opacity-70 transition-transform duration-200 ${
                              isOpen ? 'transform rotate-180 text-indigo-400' : ''
                            }`}
                          />
                        )}
                      </button>

                      {/* Sub-items */}
                      {isOpen && (
                        <div className={`flex flex-col space-y-1 ${isSidebarCollapsed ? 'pl-0' : 'pl-4 border-l-2 border-indigo-900/40 ml-4 py-1'}`}>
                          {/* Sub 1: Biblio Networks */}
                          <button
                            onClick={() => handleTabChange('bibliometrics')}
                            title={isSidebarCollapsed ? "Biblio Networks" : undefined}
                            className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2'
                              } rounded-lg text-xs font-semibold transition-all ${activeTab === 'bibliometrics'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-gray-400 hover:bg-gray-800/80 hover:text-gray-200'
                              }`}
                          >
                            <span className="flex items-center">
                              <Share2 className={`w-3.5 h-3.5 ${isSidebarCollapsed ? '' : 'mr-2.5'}`} />
                              {!isSidebarCollapsed && <span>Biblio Networks</span>}
                            </span>
                          </button>

                          {/* Sub 2: Semantic Biblio */}
                          <button
                            onClick={() => handleTabChange('semantic_bibliometrics')}
                            title={isSidebarCollapsed ? "Semantic Biblio" : undefined}
                            className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2'
                              } rounded-lg text-xs font-semibold transition-all ${activeTab === 'semantic_bibliometrics'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-gray-400 hover:bg-gray-800/80 hover:text-gray-200'
                              }`}
                          >
                            <span className="flex items-center">
                              <Compass className={`w-3.5 h-3.5 ${isSidebarCollapsed ? '' : 'mr-2.5'}`} />
                              {!isSidebarCollapsed && <span>Semantic Biblio</span>}
                            </span>
                          </button>

                          {/* Sub 3: InCites Data */}
                          <button
                            onClick={() => handleTabChange('incites')}
                            title={isSidebarCollapsed ? "InCites Data" : undefined}
                            className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2'
                              } rounded-lg text-xs font-semibold transition-all ${activeTab === 'incites'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-gray-400 hover:bg-gray-800/80 hover:text-gray-200'
                              }`}
                          >
                            <span className="flex items-center">
                              <BarChart2 className={`w-3.5 h-3.5 ${isSidebarCollapsed ? '' : 'mr-2.5'}`} />
                              {!isSidebarCollapsed && <span>InCites Data</span>}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 4. AI Assistant */}
                <button
                  onClick={() => handleTabChange('asistente')}
                  title={isSidebarCollapsed ? "AI Assistant" : undefined}
                  className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-4 py-3'
                    } rounded-xl text-sm font-semibold transition-all ${activeTab === 'asistente'
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-950/60'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                  <span className="flex items-center">
                    <Bot className={`w-4 h-4 ${isSidebarCollapsed ? '' : 'mr-3'} ${activeTab === 'asistente' ? 'text-white' : 'text-indigo-400'}`} />
                    {!isSidebarCollapsed && <span>AI Assistant</span>}
                  </span>
                  {!isSidebarCollapsed && (
                    <div className="flex items-center gap-1.5">
                      {aiEntries.length > 0 && (
                        <span className="text-[10px] bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 px-1.5 py-0.2 rounded-full font-bold">
                          {aiEntries.length}
                        </span>
                      )}
                      <ArrowRight className="w-3.5 h-3.5 opacity-50" />
                    </div>
                  )}
                </button>
              </nav>
            </div>

            {/* Added Lab Links */}
            {!isSidebarCollapsed && (
              <div className="px-6 pb-6 flex flex-col space-y-2 text-[9px] text-gray-500">
                <a href="https://www.dynamics.unam.mx/" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity mb-2 block">
                  <img src="https://www.dynamics.unam.mx/images/logos/ldnl-logo.png" alt="Laboratorio de Dinámica no Lineal" className="h-9 w-auto object-contain" />
                </a>
                <div className="flex flex-col space-y-1 border-l-2 border-gray-800 pl-3 ml-1 mt-1">
                  <span className="font-bold text-gray-400 mb-0.5">Authors:</span>
                  <a href="https://www.dynamics.unam.mx/integrantes/humberto-carrillo/" target="_blank" rel="noopener noreferrer" className="text-white hover:text-indigo-400 transition-colors">
                    Humberto Andrés Carrillo Calvet
                  </a>
                  <a href="https://scholar.google.com/citations?user=C9Z2wNAAAAAJ&hl=es" target="_blank" rel="noopener noreferrer" className="text-white hover:text-indigo-400 transition-colors">
                    José Luis Jiménez Andrade
                  </a>
                </div>
              </div>
            )}

            {/* System footer */}
            <div className={`p-6 border-t border-gray-800 bg-gray-950 flex ${isSidebarCollapsed ? 'justify-center' : 'flex-col space-y-3'}`}>
              {/* Theme Picker */}
              {!isSidebarCollapsed && (
                <div>
                  <p className="text-[10px] text-gray-500 mb-1.5 uppercase tracking-widest">Theme</p>
                  <div className="flex space-x-1.5">
                    {([
                      { key: 'dark',  label: 'Dark',  icon: '●', color: '#050508', ring: '#475569' },
                      { key: 'navy',  label: 'Navy',  icon: '●', color: '#0d1b2a', ring: '#5882a0' },
                      { key: 'light', label: 'Light', icon: '●', color: '#eef2f7', ring: '#94a3b8' },
                    ] as const).map(t => (
                      <button
                        key={t.key}
                        onClick={() => applyTheme(t.key)}
                        title={t.label}
                        style={{ backgroundColor: t.color, outline: theme === t.key ? `2px solid ${t.ring}` : 'none', outlineOffset: '2px' }}
                        className="w-5 h-5 rounded-full border border-gray-700 cursor-pointer transition-all hover:scale-110"
                      />
                    ))}
                    <span className="text-[10px] text-gray-500 self-center capitalize ml-1">{theme}</span>
                  </div>
                </div>
              )}
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
                  {user && (
                    <div className="mt-2 pt-2 border-t border-gray-800/60 flex items-center justify-between text-[10px]">
                      <span className="font-bold text-indigo-400">@{user.username}</span>
                      <span className="text-gray-600 font-mono text-[9px] uppercase tracking-wider">
                        {isWebMode && user.username !== 'desktop_local' ? 'Web Server' : 'Desktop Local'}
                      </span>
                    </div>
                  )}

                  {/* AI API & Model Configuration */}
                  <button
                    onClick={openLlmConfigModal}
                    className="mt-2 pt-2 border-t border-gray-800/60 flex items-center justify-between text-[10px] text-gray-400 hover:text-amber-300 transition w-full text-left cursor-pointer group"
                    title="Configure OpenAI API Key & Model"
                  >
                    <span className="flex items-center gap-1.5">
                      <Key className="w-3 h-3 text-amber-400 group-hover:rotate-12 transition-transform" />
                      <span>AI Model:</span>
                    </span>
                    <span className="font-mono text-[9px] truncate max-w-[110px] text-gray-300 group-hover:text-amber-200">
                      {llmConfig?.isCustom ? (llmConfig.model || 'Custom') : 'Default (UNAM)'}
                    </span>
                  </button>
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
                  {activeTab === 'semantic_bibliometrics' && 'Semantic Bibliometrics'}
                  {activeTab === 'incites' && 'InCites Explorer'}
                  {activeTab === 'asistente' && 'AI Assistant & Reports'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {activeTab === 'multidimensional' && 'Load CSV datasets and train your Self-Organizing Map (SOM).'}
                  {activeTab === 'bibliometrics' && 'Extract and parse scientific metrics from PubMed/WoS to build co-occurrence networks.'}
                  {activeTab === 'dimreduction' && 'Estimate intrinsic dimensionality and reduce feature space using UMAP before training.'}
                  {activeTab === 'semantic_bibliometrics' && 'Process documents semantically using AI embeddings, UMAP, and hierarchical clustering.'}
                  {activeTab === 'incites' && 'Analyze institutional and country metrics across InCites units.'}
                  {activeTab === 'asistente' && 'Interpret quantitative visualizations, formulate hypotheses, and compile interactive reports with the local model.'}
                </p>
              </div>

              <div className="flex items-center space-x-3 flex-wrap gap-y-2">
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to close the current project and reset the workspace?")) {
                      clearProject();
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                  title="Close current project and reset workspace"
                >
                  <FolderX className="w-4 h-4 text-white" />
                  <span>Close Project</span>
                </button>

                <button
                  onClick={() => projectInputRef.current?.click()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                  title="Load Local Project File"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                  <span>Load Local File</span>
                </button>
                <input
                  type="file"
                  ref={projectInputRef}
                  accept=".json,.knoMap"
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
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                  title="Save Local Project File"
                >
                  <Save className="w-4 h-4 text-white" />
                  <span>Save Local File</span>
                </button>

                {/* Web Server Cloud & Auth Actions */}
                {isWebMode && user?.username !== 'desktop_local' && (
                  <>
                    <div className="h-5 w-px bg-gray-800 mx-1" />

                    <button
                      onClick={handleSaveToCloud}
                      disabled={isSavingCloud}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                      title="Save project to server"
                    >
                      <Cloud className="w-4 h-4 text-white" />
                      <span>{isSavingCloud ? 'Saving...' : 'Save to Server'}</span>
                    </button>

                    <button
                      onClick={() => setIsProjectsDrawerOpen(true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                      title="Open Server Projects Drawer"
                    >
                      <FolderOpen className="w-4 h-4 text-white" />
                      <span>Server Projects</span>
                    </button>

                    {isAuthenticated && user ? (
                      <div className="flex items-center space-x-3">
                        <div className="px-4 py-2 bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 text-xs font-bold rounded-xl flex items-center space-x-2">
                          <UserIcon className="w-4 h-4 text-indigo-300" />
                          <span>@{user.username}</span>
                        </div>

                        {user.role === 'Admin' && (
                          <button
                            onClick={() => setIsUserMgmtModalOpen(true)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                            title="User Management (Admin)"
                          >
                            <Shield className="w-4 h-4 text-white" />
                            <span>Users</span>
                          </button>
                        )}

                        <button
                          onClick={logout}
                          className="p-2 bg-indigo-600/20 hover:bg-rose-600 text-gray-300 hover:text-white rounded-xl transition cursor-pointer"
                          title="Log Out"
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsLoginModalOpen(true)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-900/30 flex items-center space-x-2 cursor-pointer"
                      >
                        <LogIn className="w-4 h-4 text-white" />
                        <span>Log In</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </header>

            {/* 3. Render Dashboard Tabs */}
            <section className={`flex-1 min-h-0 ${activeTab === 'asistente' ? 'p-0 overflow-hidden h-full' : 'p-8 overflow-auto'}`}>
              {/* Tab 1: Dataset & SOM config */}
              {activeTab === 'multidimensional' && <ExploradorDatos />}

              {/* Tab 2: Dimensionality Reduction */}
              {activeTab === 'dimreduction' && <DimReduction />}

              {/* Tab 4: Semantic Bibliometrics */}
              {activeTab === 'semantic_bibliometrics' && (
                <SemanticBibliometrics />
              )}

              {/* Tab 5: InCites Explorer */}
              {activeTab === 'incites' && (
                <InCitesExplorer />
              )}

              {/* Tab 6: Asistente IA */}
              {activeTab === 'asistente' && (
                <AiAssistantTab />
              )}

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
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5 shadow-md"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>Import File</span>
                            </button>

                            <input
                              type="file"
                              ref={fileInputRef}
                              accept=".txt,.csv,.tsv,.ris,.json,.map,.net"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) setSharedBibFile(file);
                              }}
                              className="hidden"
                            />
                          </div>

                          {sharedBibFile && (
                            <div className="flex items-center space-x-2 bg-emerald-950/40 border border-emerald-800/60 px-3 py-1.5 rounded-lg">
                              <span className="text-xs text-emerald-400 font-bold truncate max-w-[220px]" title={sharedBibFile.name}>
                                {sharedBibFile.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSharedBibFile(null)}
                                className="text-gray-500 hover:text-red-400 text-xs ml-auto"
                                title="Clear file"
                              >
                                ✕
                              </button>
                            </div>
                          )}

                          <p className="text-[10px] text-gray-500">
                            Supports: <strong>WoS, Scopus, PubMed, Dimensions, Lens, RIS, VOS JSON</strong>.
                          </p>
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
                              if (val.startsWith('bipartite')) {
                                setShowAdvancedPopup(true);
                                setMaxTerms(10);
                              } else {
                                setShowAdvancedPopup(false);
                              }
                            }}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                          >
                            {getNetworkTypeOptions().map(grp => (
                              <optgroup key={grp.group} label={grp.group} className="bg-gray-900 text-indigo-300 font-bold">
                                {grp.options.map(opt => (
                                  <option key={opt.value} value={opt.value} className="bg-gray-950 text-gray-200 font-normal">
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Counting Method</label>
                          <select
                            value={countingMethod}
                            onChange={(e) => setCountingMethod(e.target.value as 'full' | 'fractional')}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                            title="Full Counting counts all co-occurrences equally; Fractional Counting weights by 1/(n-1)"
                          >
                            <option value="full">Full Counting</option>
                            <option value="fractional">Fractional Counting (1/n)</option>
                          </select>
                        </div>
                      </div>

                      {/* Extraction Source & NLP Mining */}
                      {networkType.startsWith('co-occurrence') && (
                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Term Extraction Source</label>
                          <select
                            value={extractionSource}
                            onChange={(e) => setExtractionSource(e.target.value as any)}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-indigo-400 font-bold focus:outline-none"
                          >
                            <option value="keywords">Keywords (DE, ID, MeSH)</option>
                            <option value="title_abstract">Title & Abstract (NLP Mining & Relevance Score)</option>
                            <option value="title">Title only (NLP)</option>
                            <option value="abstract">Abstract only (NLP)</option>
                          </select>
                        </div>
                      )}

                      {/* Relevance Score Slider (when NLP is active) */}
                      {extractionSource !== 'keywords' && networkType.startsWith('co-occurrence') && (
                        <div className="p-3 bg-gray-950/70 border border-indigo-500/30 rounded-xl space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-300 font-semibold">VOS Relevance Filter</span>
                            <span className="text-indigo-400 font-bold">Top {Math.round(relevanceRatio * 100)}% terms</span>
                          </div>
                          <input
                            type="range"
                            min="0.2"
                            max="1.0"
                            step="0.05"
                            value={relevanceRatio}
                            onChange={(e) => setRelevanceRatio(parseFloat(e.target.value))}
                            className="w-full accent-indigo-500 cursor-pointer"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Max Nodes</label>
                          <input
                            type="number"
                            value={maxTerms}
                            onChange={(e) => setMaxTerms(parseInt(e.target.value) || 20)}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Min Weight</label>
                          <input
                            type="number"
                            value={minCooc}
                            onChange={(e) => setMinCooc(parseInt(e.target.value) || 2)}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2 text-xs text-gray-200 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Thesaurus & Disambiguation File Upload */}
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">VOS Thesaurus File (Optional)</label>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => thesaurusInputRef.current?.click()}
                            className="px-3 py-1.5 bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-300 hover:text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>Select Thesaurus .txt</span>
                          </button>
                          <input
                            type="file"
                            ref={thesaurusInputRef}
                            accept=".txt,.csv"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) setThesaurusFile(file);
                            }}
                            className="hidden"
                          />
                          {thesaurusFile && (
                            <div className="flex items-center space-x-1.5 text-xs text-indigo-400 font-bold bg-indigo-950/40 border border-indigo-800/60 px-2.5 py-1 rounded-lg">
                              <span className="truncate max-w-[150px]">{thesaurusFile.name}</span>
                              <button
                                type="button"
                                onClick={() => setThesaurusFile(null)}
                                className="text-gray-500 hover:text-red-400 ml-1"
                                title="Remove thesaurus"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {(networkType.startsWith('co-occurrence') || networkType.startsWith('bipartite')) && (
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
                              {networkType.startsWith('bipartite') ? (
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
                                <strong>WoS/Scopus:</strong> <b>DE</b> (Author Keywords), <b>ID</b> (Keywords Plus), <b>AU</b> (Authors), <b>CR</b> (Cited Refs), <b>C1</b> (Institutions), <b>CU</b> (Countries), <b>PY</b> (Year).<br />
                                <strong>PubMed (MEDLINE):</strong> <b>MH</b> (MeSH Terms), <b>OT</b> (Other Terms/Keywords), <b>AU</b> (Authors), <b>AD</b> (Affiliation), <b>JT</b> (Journal Title), <b>DP</b> (Year).
                                <br /><button type="button" onClick={() => setShowTagsModal(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-[10px] font-bold transition mt-2 inline-block">View full tags list</button>
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
                            Generate Temporal Sequences
                          </label>
                        </div>

                        {temporal && (
                          <div className="p-3 bg-gray-950/80 border border-gray-800 rounded-xl space-y-2.5">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                              Tamaño de Subperiodo (Años)
                            </label>
                            <div className="grid grid-cols-4 gap-1.5 text-xs">
                              {[
                                { val: 1, label: '1 Año', mode: 'PathSOM' },
                                { val: 2, label: '2 Años', mode: 'PathSOM' },
                                { val: 3, label: '3 Años', mode: 'PathSOM' },
                                { val: 5, label: '5 Años', mode: 'Longitudinal' }
                              ].map(opt => (
                                <button
                                  key={opt.val}
                                  type="button"
                                  onClick={() => {
                                    setTemporalWindow(opt.val);
                                    setTemporalAnalysisMode(opt.val >= 5 ? 'longitudinal' : 'pathsom');
                                  }}
                                  className={`py-1.5 rounded-lg font-bold transition flex flex-col items-center justify-center ${
                                    temporalWindow === opt.val
                                      ? 'bg-indigo-600 text-white shadow-md'
                                      : 'bg-gray-900 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  <span className="text-[9px] opacity-75 font-normal">{opt.mode}</span>
                                </button>
                              ))}
                            </div>

                            {/* Custom window input */}
                            <div className="flex items-center space-x-2 pt-1">
                              <span className="text-[11px] text-gray-500">Personalizado:</span>
                              <input
                                type="number"
                                min="1"
                                max="20"
                                value={temporalWindow}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 1;
                                  setTemporalWindow(val);
                                  setTemporalAnalysisMode(val >= 5 ? 'longitudinal' : 'pathsom');
                                }}
                                className="w-16 bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white font-mono text-center focus:outline-none"
                              />
                              <span className="text-[11px] text-gray-500">años por subperiodo</span>
                            </div>

                            {/* Dynamic explanation badge */}
                            <div className={`p-2 rounded-lg border text-[11px] leading-relaxed ${
                              temporalWindow >= 5
                                ? 'bg-purple-950/40 border-purple-800/60 text-purple-200'
                                : 'bg-indigo-950/40 border-indigo-800/60 text-indigo-200'
                            }`}>
                              {temporalWindow >= 5 ? (
                                <span>
                                  🔥 <strong>Modo Longitudinal SOM:</strong> Se generarán mapas evolutivos encadenados con <em>Warm-Start</em> ($W_t = W_{'{'}t-1{'}'}$) y refinamiento acelerado (20% iteraciones).
                                </span>
                              ) : (
                                <span>
                                  📈 <strong>Modo Trayectorias PathSOM:</strong> Se proyectarán vectores de frecuencia anuales sobre un único espacio SOM global.
                                </span>
                              )}
                            </div>
                          </div>
                        )}
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

                  {/* Interactive Network Graph or Longitudinal SOM */}
                  <div className="lg:col-span-2 flex flex-col space-y-4">
                    {cooccurrenceMatricesByPeriod && Object.keys(cooccurrenceMatricesByPeriod).length >= 2 && (
                      <div className="flex items-center justify-between bg-gray-900/90 border border-gray-800 rounded-2xl p-2 px-3 shadow-lg">
                        <span className="text-xs font-bold text-gray-300">
                          Vista Científica:
                        </span>
                        <div className="flex space-x-1.5 bg-gray-950 p-1 rounded-xl border border-gray-800">
                          <button
                            onClick={() => setBiblioMainView('network')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                              biblioMainView === 'network'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Red Bibliométrica</span>
                          </button>
                          <button
                            onClick={() => setBiblioMainView('longitudinal')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${
                              biblioMainView === 'longitudinal'
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>Evolución Longitudinal SOM</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1">
                      {biblioMainView === 'longitudinal' && cooccurrenceMatricesByPeriod && Object.keys(cooccurrenceMatricesByPeriod).length >= 2 ? (
                        <LongitudinalSomViewer />
                      ) : (
                        <RedBibliometrica />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </main>
        </div>
      </div>

      {/* Auth & Cloud Projects Modals */}
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
      <UserManagementModal isOpen={isUserMgmtModalOpen} onClose={() => setIsUserMgmtModalOpen(false)} />
      <ProjectsDrawer isOpen={isProjectsDrawerOpen} onClose={() => setIsProjectsDrawerOpen(false)} />

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

      {/* Global LLM API & Model Configuration Modal */}
      <LlmConfigModal />

      {/* Live Bibliographic API Query Modal */}
      <VosApiModal
        isOpen={showApiModal}
        onClose={() => setShowApiModal(false)}
      />
    </>
  );
}
