import React, { useState, useRef, useEffect } from 'react';
import { useAiStore, type ReportEntry } from '../store/aiStore';
import { InteractiveChartViewer } from './InteractiveChartViewer';
import { StudyContextModal } from './StudyContextModal';
import { McpAgentsModal } from './McpAgentsModal';

import {
  Sparkles, Bot, Send, Trash2, RefreshCw, FileText, Download,
  Check, Loader2, Key, Cpu, Wrench, CheckCircle2, Eye, Copy
} from 'lucide-react';

export const AiAssistantTab: React.FC = () => {
  const {
    llmConfig,
    openLlmConfigModal,
    entries,
    activeEntryId,
    setActiveEntryId,
    sendMessage,
    reanalyzeEntry,
    deleteEntry,
    clearAllEntries,
    exportReportMarkdown,
    exportReportPdf,
    assistantMode,
    setAssistantMode,
    agentMessages,
    isAgentRunning,
    sendAgentMessage,
    clearAgentMessages
  } = useAiStore();

  const [inputQuestion, setInputQuestion] = useState('');
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);

  const handleCopyMsg = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const activeEntry: ReportEntry | undefined = entries.find(e => e.id === activeEntryId) || entries[entries.length - 1];


  // Scroll to bottom of agent chat when new messages arrive
  useEffect(() => {
    if (assistantMode === 'autonomous_agent' && agentScrollRef.current) {
      setTimeout(() => {
        agentScrollRef.current?.scrollTo({
          top: agentScrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 50);
    }
  }, [agentMessages.length, isAgentRunning, assistantMode]);

  const handleSendQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuestion.trim()) return;

    if (assistantMode === 'autonomous_agent') {
      if (isAgentRunning) return;
      const q = inputQuestion;
      setInputQuestion('');
      await sendAgentMessage(q);
    } else {
      if (!activeEntry || activeEntry.isAnalyzing) return;
      const q = inputQuestion;
      setInputQuestion('');
      await sendMessage(activeEntry.id, q);
    }
  };

  const handleExportMd = () => {

    const md = exportReportMarkdown();
    navigator.clipboard.writeText(md);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2500);
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      await exportReportPdf();
    } catch (e) {
      console.error(e);
      alert('Error generating PDF report');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden select-text font-sans">
      {/* Header Bar */}
      <header className="px-6 py-3.5 bg-gray-900/80 border-b border-gray-800 flex items-center justify-between shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-950/50">
            {assistantMode === 'autonomous_agent' ? <Bot className="w-5 h-5 text-emerald-300" /> : <Sparkles className="w-5 h-5 text-white" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white">
                {assistantMode === 'autonomous_agent' ? 'Agente Científico Autónomo' : 'Asistente Científico Copiloto'}
              </h1>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                assistantMode === 'autonomous_agent'
                  ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                  : 'bg-indigo-950/80 border-indigo-500/40 text-indigo-300'
              }`}>
                {assistantMode === 'autonomous_agent' ? 'PicoClaw + FastMCP' : 'Análisis Visual'}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {assistantMode === 'autonomous_agent'
                ? 'Ejecución autónoma de herramientas, mapas SOM, UMAP y artefactos interactivos'
                : 'Diálogo analítico multi-turno integrado con todas las vistas de knoMap'}
            </p>
          </div>
        </div>

        {/* Center: Mode Switcher */}
        <div className="flex items-center bg-gray-950 p-1 rounded-xl border border-gray-800 shadow-inner">
          <button
            type="button"
            onClick={() => setAssistantMode('copilot')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              assistantMode === 'copilot'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Copiloto Visual</span>
          </button>
          <button
            type="button"
            onClick={() => setAssistantMode('autonomous_agent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              assistantMode === 'autonomous_agent'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-emerald-300" />
            <span>Agente Autónomo</span>
          </button>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* MCP Tools Modal Button */}
          <button
            onClick={() => setIsMcpModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-500/50 text-indigo-300 hover:text-white text-xs font-semibold transition cursor-pointer shadow-sm shadow-indigo-950/50"
            title="Conectar a Claude Desktop, PicoClaw o Antigravity vía MCP"
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>Agentes (MCP)</span>
          </button>

          {/* LLM Model & API Key Settings */}
          <button
            onClick={openLlmConfigModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
              llmConfig.isCustom
                ? 'bg-amber-950/50 border-amber-500/60 text-amber-300 hover:bg-amber-900/60 shadow-sm shadow-amber-950/50'
                : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300 hover:text-white'
            }`}
            title="Configurar API Key, Modelo o Servidor Local"
          >
            <Key className={`w-3.5 h-3.5 ${llmConfig.isCustom ? 'text-amber-400' : 'text-gray-400'}`} />
            <span className="max-w-[120px] truncate">
              {llmConfig.isCustom ? (llmConfig.model || 'Custom') : 'API & Model'}
            </span>
          </button>

          {assistantMode === 'copilot' && entries.length > 0 && (
            <>
              <button
                onClick={handleExportMd}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-medium text-gray-200 transition"
                title="Copiar reporte en Markdown"
              >
                {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileText className="w-3.5 h-3.5 text-indigo-400" />}
                <span>{copiedMd ? 'Copiado' : 'Markdown'}</span>
              </button>

              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-xs font-semibold text-white shadow-md shadow-indigo-950/40 transition disabled:opacity-50"
                title="Exportar reporte PDF"
              >
                {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{isExportingPdf ? 'Exportando...' : 'PDF'}</span>
              </button>

              <button
                onClick={() => {
                  if (confirm('¿Deseas limpiar todas las visualizaciones del reporte actual?')) {
                    clearAllEntries();
                  }
                }}
                className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded-xl transition"
                title="Limpiar reporte"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}

          {assistantMode === 'autonomous_agent' && (
            <button
              onClick={() => {
                if (confirm('¿Deseas reiniciar la conversación con el agente?')) {
                  clearAgentMessages();
                }
              }}
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded-xl transition"
              title="Reiniciar chat del agente"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MODE 1: AUTONOMOUS AGENT WORKSPACE (PicoClaw & FastMCP Tool Execution)     */}
      {/* ========================================================================= */}
      {assistantMode === 'autonomous_agent' ? (
        <div className="flex-1 min-h-0 flex flex-col bg-gray-950 overflow-hidden">
          {/* Top Prominent Input Bar */}
          <div className="p-4 bg-gray-900/90 border-b border-gray-800 shrink-0 max-w-5xl mx-auto w-full shadow-lg z-10">
            <form onSubmit={handleSendQuestion} className="flex gap-2">
              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                placeholder="Escribe una instrucción al Agente Científico (ej. 'Analiza la entidad Locations y entrena un SOM')..."
                className="flex-1 bg-gray-950 border border-gray-700 focus:border-emerald-500 rounded-xl px-4 py-3 text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition shadow-inner"
                autoFocus
              />
              <button
                type="submit"
                disabled={!inputQuestion.trim() || isAgentRunning}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs sm:text-sm shadow-md shadow-emerald-950/40 flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Enviar</span>
              </button>
            </form>
          </div>

          {/* Agent Message Stream */}
          <div ref={agentScrollRef} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 custom-scrollbar max-w-5xl mx-auto w-full">
            {agentMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-sm ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-1">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div className={`max-w-3xl space-y-3 ${msg.role === 'user' ? 'w-auto' : 'w-full'}`}>
                  {/* User Bubble */}
                  {msg.role === 'user' ? (
                    <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-4 rounded-2xl rounded-br-none shadow-md">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-5 shadow-lg space-y-4">
                      {/* Tool Steps Accordion (if any tools were executed) */}
                      {msg.steps && msg.steps.length > 0 && (
                        <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-2">
                          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wide">
                            <Wrench className="w-3.5 h-3.5" />
                            <span>Herramientas Ejecutadas ({msg.steps.length})</span>
                          </div>
                          <div className="space-y-1.5">
                            {msg.steps.map((s, sIdx) => (
                              <div key={sIdx} className="flex items-center gap-2 text-xs text-gray-300 font-mono bg-gray-900/80 px-2.5 py-1.5 rounded-lg border border-gray-800">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span className="font-semibold text-emerald-300">{s.tool}</span>
                                {s.arguments && Object.keys(s.arguments).length > 0 && (
                                  <span className="text-gray-500 text-[11px] truncate">
                                    {JSON.stringify(s.arguments)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Assistant Text / Response */}
                      <div className="text-gray-200 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap select-text selection:bg-emerald-600 selection:text-white">
                        {msg.content}
                      </div>

                      {/* Footer Actions: Copy button & timestamp */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-800/60">
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyMsg(msg.id, msg.content)}
                          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg text-gray-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-gray-800 hover:border-emerald-500/40 transition cursor-pointer"
                          title="Copiar respuesta al portapapeles"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400 font-medium">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copiar texto</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Embedded Interactive Visual Artifacts (HTML5 Maps / SVG) */}
                      {msg.artifacts && msg.artifacts.length > 0 && (
                        <div className="space-y-3 pt-2">
                          {msg.artifacts.map((art, aIdx) => (
                            <div key={aIdx} className="border border-emerald-500/40 rounded-xl bg-gray-950 p-4 shadow-xl space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                                  <Eye className="w-4 h-4 text-emerald-400" />
                                  {art.title || 'Mapa Topológico Interactivo'}
                                </h4>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-emerald-400">
                                  Artefacto HTML5
                                </span>
                              </div>

                              {art.html && (
                                <div className="w-full h-80 rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                                  <iframe
                                    srcDoc={art.html}
                                    title={art.title}
                                    className="w-full h-full border-0"
                                    sandbox="allow-scripts"
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`text-[10px] ${msg.role === 'user' ? 'text-emerald-300 text-right' : 'text-gray-500'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {isAgentRunning && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-900/90 border border-emerald-500/30 text-emerald-300 text-xs max-w-md animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
                <span>El Agente está ejecutando el razonamiento y las herramientas MCP...</span>
              </div>
            )}
          </div>
        </div>
      ) : (

        /* ========================================================================= */
        /* MODE 2: VISUAL COPILOT & MULTI-TURN CHART ANALYSIS                        */
        /* ========================================================================= */
        entries.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-8 text-center max-w-2xl mx-auto space-y-6 animate-fadeIn overflow-y-auto custom-scrollbar">
            <div className="w-16 h-16 rounded-3xl bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-950/50">
              <Sparkles className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">No Visualizations in Report Yet</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Navigate through the <strong>SOM & UMAP</strong>, <strong>Dim Reduction</strong>, <strong>Bibliometrics</strong>, or <strong>InCites Explorer</strong> modules and click the <strong className="text-indigo-300">"Send to AI Assistant"</strong> button on any chart.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Left Sidebar: Visualizations List */}
            <aside className="w-80 bg-gray-900/60 border-r border-gray-800 flex flex-col shrink-0">
              <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Report Entries ({entries.length})
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => setActiveEntryId(entry.id)}
                    className={`p-3 rounded-xl border transition cursor-pointer ${
                      entry.id === (activeEntry?.id)
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-gray-950/40 border-gray-850 text-gray-300 hover:bg-gray-800/40 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">
                        {entry.badge}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteEntry(entry.id);
                        }}
                        className="text-gray-500 hover:text-red-400 p-1 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-xs font-semibold line-clamp-1">{entry.title}</div>
                  </div>
                ))}
              </div>
            </aside>

            {/* Right Main Analysis Panel */}
            {activeEntry ? (
              <main className="flex-1 min-h-0 relative flex flex-col h-full bg-gray-950 overflow-hidden">
                {/* Entry Subheader */}
                <div className="px-6 py-3 bg-gray-900/40 border-b border-gray-800 flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-wide">
                        {activeEntry.badge}
                      </span>
                      <span className="text-xs text-gray-600">•</span>
                      <span className="text-xs text-gray-400">
                        {new Date(activeEntry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-white mt-0.5">
                      {activeEntry.title}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => reanalyzeEntry(activeEntry.id)}
                      disabled={activeEntry.isAnalyzing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-200 transition disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${activeEntry.isAnalyzing ? 'animate-spin' : ''}`} />
                      <span>Re-analyze</span>
                    </button>
                  </div>
                </div>

                {/* Scrollable Content (Chart + Conversation) */}
                <div ref={contentContainerRef} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                  <InteractiveChartViewer snapshot={activeEntry.snapshot} />

                  <div className="space-y-4">
                    {activeEntry.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 text-sm ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 mt-1">
                            <Bot className="w-4 h-4" />
                          </div>
                        )}
                        <div
                          className={`max-w-3xl rounded-2xl p-4 leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-none'
                              : 'bg-gray-900/90 border border-gray-800 text-gray-200 rounded-bl-none'
                          }`}
                        >
                          <div className="whitespace-pre-wrap text-xs sm:text-sm">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Input Form */}
                <div className="p-4 bg-gray-900/90 border-t border-gray-800 shrink-0">
                  <form onSubmit={handleSendQuestion} className="flex gap-2">
                    <input
                      type="text"
                      value={inputQuestion}
                      onChange={(e) => setInputQuestion(e.target.value)}
                      placeholder="Ask a scientific question about this visualization..."
                      className="flex-1 bg-gray-950 border border-gray-700 rounded-xl px-4 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!inputQuestion.trim() || activeEntry.isAnalyzing}
                      className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs sm:text-sm"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </main>
            ) : null}
          </div>
        )
      )}

      {/* Study Context Modal */}
      <StudyContextModal />

      {/* MCP Agents Configuration Modal */}
      <McpAgentsModal
        isOpen={isMcpModalOpen}
        onClose={() => setIsMcpModalOpen(false)}
      />
    </div>
  );
};
