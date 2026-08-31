import React, { useState, useEffect } from 'react';
import {
  Cpu, Copy, Check, Terminal, Sparkles, X,
  Wrench, Globe, CheckCircle2, Loader2
} from 'lucide-react';
import { getApiUrl } from '../store/somStore';

interface McpAgentsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface McpTool {
  name: string;
  description: string;
}

export const McpAgentsModal: React.FC<McpAgentsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'claude' | 'picoclaw' | 'antigravity'>('claude');
  const [copied, setCopied] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [configJson, setConfigJson] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchConfig = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(getApiUrl(`/api/mcp/config?target=${activeTab}`));
        if (res.ok) {
          const data = await res.json();
          setConfigJson(JSON.stringify(data.config, null, 2));
          if (data.tools) {
            setTools(data.tools);
          }
        } else {
          generateFallbackConfig(activeTab);
        }
      } catch (err) {
        generateFallbackConfig(activeTab);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfig();
  }, [isOpen, activeTab]);

  const generateFallbackConfig = (tab: 'claude' | 'picoclaw' | 'antigravity') => {
    if (tab === 'claude') {
      setConfigJson(JSON.stringify({
        mcpServers: {
          knomap: {
            command: "python3",
            args: ["/app/engine/cli_mcp.py", "--stdio"],
            env: { PYTHONPATH: "/app/engine" }
          }
        }
      }, null, 2));
    } else if (tab === 'picoclaw') {
      setConfigJson(JSON.stringify({
        name: "knomap-engine",
        transport: "stdio",
        command: "python3",
        args: ["/app/engine/cli_mcp.py", "--stdio"],
        description: "knoMap Scientometrics & Topological Neural Mapping Engine"
      }, null, 2));
    } else {
      setConfigJson(JSON.stringify({
        mcpServers: {
          "knomap-engine": {
            command: "python3",
            args: ["/app/engine/cli_mcp.py", "--stdio"]
          }
        }
      }, null, 2));
    }

    setTools([
      { name: "knomap_get_active_project_manifest", description: "Manifest global del estado de todos los módulos del proyecto activo." },
      { name: "knomap_list_incites_entities", description: "Lista entidades en InCites (Locations, Organizations, Research Areas, Authors)." },
      { name: "knomap_query_incites_entity", description: "Consulta registros e indicadores (CNCI, Citas, Docs, Top 10%, Colaboración) de cualquier entidad." },
      { name: "knomap_get_som_state", description: "Inspecciona la topología de la red SOM activa, U-Matrix, clústeres y UMAP." },
      { name: "knomap_get_bibliometrics_state", description: "Inspecciona redes de co-ocurrencia y estadísticas de términos activos." },
      { name: "knomap_get_dim_reduction_state", description: "Inspecciona dimensión intrínseca (skdim MLE) y coordenadas proyectadas." },
      { name: "knomap_inspect_dataset", description: "Inspecciona formato, registros y columnas de cualquier archivo." },
      { name: "knomap_parse_file", description: "Parsea WoS, Scopus, InCites, PubMed, RIS, CSV a matrices de co-ocurrencia." },
      { name: "knomap_parse_incites", description: "Extrae inventarios y reportes analíticos de InCites ZIP." },
      { name: "knomap_suggest_som_size", description: "Recomienda dimensiones de rejilla hexagonal SOM mediante SVD/PCA." },
      { name: "knomap_train_som", description: "Entrena red neuronal SOM con U-Matrix, UMAP y clustering." },
      { name: "knomap_render_visual_artifact", description: "Genera artefactos visuales interactivos HTML5 y SVG para el chat." },
      { name: "knomap_estimate_intrinsic_dimension", description: "Estima la dimensión intrínseca con skdim (MLE)." },
      { name: "knomap_save_project", description: "Persiste proyectos en formato .knomap y base de datos SQLite." },
      { name: "knomap_get_project", description: "Recupera proyectos guardados desde SQLite o disco." }
    ]);
  };


  const handleCopy = () => {
    navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Conectar Agentes de IA (MCP)
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-medium">
                  FastMCP Activo
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Expone las capacidades de knoMap a agentes externos e internos vía Model Context Protocol
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Agent Tabs */}
          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-2">
              Selecciona tu Cliente de Agente:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('claude')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  activeTab === 'claude'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                    : 'bg-gray-950/40 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Claude Desktop</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('picoclaw')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  activeTab === 'picoclaw'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                    : 'bg-gray-950/40 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
                }`}
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>PicoClaw (Go Agent)</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('antigravity')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  activeTab === 'antigravity'
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                    : 'bg-gray-950/40 border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>Antigravity / Cursor</span>
              </button>
            </div>
          </div>

          {/* Configuration Code Snippet */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-400">
                {activeTab === 'claude' && 'Pega esto en tu claude_desktop_config.json:'}
                {activeTab === 'picoclaw' && 'Configuración de tools para PicoClaw:'}
                {activeTab === 'antigravity' && 'Pega esto en tus ajustes MCP (mcp_config.json):'}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '¡Copiado!' : 'Copiar Configuración'}</span>
              </button>
            </div>

            <div className="relative bg-gray-950 border border-gray-800 rounded-xl p-3 font-mono text-xs text-gray-300 overflow-x-auto">
              {isLoading ? (
                <div className="flex items-center gap-2 py-4 justify-center text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Obteniendo configuración...</span>
                </div>
              ) : (
                <pre>{configJson}</pre>
              )}
            </div>
          </div>

          {/* Active Tools Section */}
          <div>
            <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-indigo-400" />
              Herramientas MCP Expuestas ({tools.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
              {tools.map((t, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-gray-950/60 border border-gray-800/80 hover:border-gray-700 transition"
                >
                  <div className="text-xs font-bold text-indigo-300 font-mono">
                    {t.name}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                    {t.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-gray-800 bg-gray-950/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Transporte JSON-RPC stdio & SSE listo</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow-sm cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
