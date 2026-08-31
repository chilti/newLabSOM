"""
Agent Bridge & Orchestrator for knoMap.
Provides the runtime interface between the knoMap GUI (Desktop / Web)
and the embedded AI Agent (PicoClaw or native Tool-Calling loop) using the knoMap MCP Server.
"""

import os
import sys
import json
import subprocess
import shutil
from typing import Dict, Any, Optional, List

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_LIB = os.path.join(ENGINE_DIR, "lib")
for p in [ENGINE_DIR, ENGINE_LIB]:
    if p not in sys.path:
        sys.path.insert(0, p)

import mcp_server
import storage
import visualizer

# Complete Tool definitions in OpenAI / ReAct Function Calling format
KNOMAP_AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "knomap_get_active_project_manifest",
            "description": "Returns the global manifest and status of everything loaded in the active knoMap project (SOM & UMAP, InCites Explorer, Bibliometrics, Dim Reduction).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_list_incites_entities",
            "description": "Lists all available benchmarking entities in InCites (Locations, Organizations, Research Areas, Authors, Funding Agencies).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_query_incites_entity",
            "description": "Queries detailed tabular data and scientometric indicators for an InCites entity (Locations, Organizations, Research Areas, Authors). Returns rows, CNCI, Times Cited, % Documents Cited, % Top 10%, and % International Collabs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_name": {
                        "type": "string",
                        "description": "Entity name to query (e.g. 'Locations', 'Organizations', 'Research Areas', 'Authors', 'Funding Agencies').",
                        "default": "Locations"
                    },
                    "top_n": {
                        "type": "integer",
                        "description": "Number of top records to return.",
                        "default": 25
                    },
                    "sort_by": {
                        "type": "string",
                        "description": "Metric to sort by ('wos_docs', 'cnci', 'times_cited', 'top10_percent', 'intl_collab_percent').",
                        "default": "wos_docs"
                    }
                },
                "required": ["entity_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_get_som_state",
            "description": "Inspects the active trained SOM topology (grid size, U-Matrix, clusters, neuron frequencies, UMAP coordinates, document mappings).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_get_bibliometrics_state",
            "description": "Inspects the active bibliometrics network (co-occurrence matrix shape, term counts, top nodes).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_get_dim_reduction_state",
            "description": "Inspects the active dimension reduction state (intrinsic dimension MLE/TwoNN, PCA, UMAP, t-SNE).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_inspect_dataset",
            "description": "Rapidly inspects any bibliometric file (.csv, .xlsx, .json, .zip, .ris, .txt). Returns detected format, record count, and sample columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Absolute or relative path to the file."}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_parse_file",
            "description": "Parses and extracts the bibliometric matrix (co-occurrence, co-citation, coupling) from WoS, Scopus, PubMed, Dimensions, RIS, or CSV.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to the bibliographic dataset file."},
                    "network_type": {"type": "string", "enum": ["co-occurrence", "co-citation", "coupling"], "default": "co-occurrence"},
                    "max_terms": {"type": "integer", "default": 50, "description": "Maximum number of terms or keywords to extract."},
                    "min_cooccurrence": {"type": "integer", "default": 2, "description": "Minimum co-occurrence threshold."}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_suggest_som_size",
            "description": "Recommends optimal hexagonal grid dimensions (Big SOM vs Small SOM) based on PCA/SVD ratios and Kohonen criteria.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_matrix": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}, "description": "2D numeric data matrix."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_train_som",
            "description": "Trains a Self-Organizing Map (SOM) on the provided data matrix. Calculates U-Matrix distances, clustering, frequencies, and UMAP coordinates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_matrix": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}, "description": "2D numeric data matrix."},
                    "rows": {"type": "integer", "default": 10, "description": "Number of grid rows."},
                    "cols": {"type": "integer", "default": 10, "description": "Number of grid columns."},
                    "iterations": {"type": "integer", "default": 100, "description": "Training iterations/epochs."},
                    "method": {"type": "string", "enum": ["batch", "basic"], "default": "batch"},
                    "run_umap": {"type": "boolean", "default": True, "description": "Whether to compute UMAP 2D coordinates."},
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Optional list of document or keyword labels."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_render_visual_artifact",
            "description": "Generates a self-contained interactive HTML5 hex-map artifact and SVG with tooltips and cluster colors.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "default": "knoMap SOM Science Map", "description": "Title for the visual artifact."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_estimate_intrinsic_dimension",
            "description": "Estimates the intrinsic dimensionality of high-dimensional embeddings using skdim (MLE or TwoNN).",
            "parameters": {
                "type": "object",
                "properties": {
                    "data_matrix": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
                    "algorithm": {"type": "string", "enum": ["mle", "two_nn"], "default": "mle"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_save_project",
            "description": "Saves the current research project to a portable .knomap file and SQLite zero-config hub.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the research project."},
                    "report_markdown": {"type": "string", "description": "Summary report and findings written in Markdown."}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_get_project",
            "description": "Retrieves a saved knoMap project by ID from SQLite or from a .knomap file path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id_or_path": {"type": "string", "description": "Project ID or file path."}
                },
                "required": ["project_id_or_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knomap_list_projects",
            "description": "Lists all saved projects from the SQLite database hub.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 50, "description": "Maximum number of projects to list."}
                }
            }
        }
    }
]

BASE_SYSTEM_PROMPT = """Eres el Agente Científico Autónomo de knoMap (Laboratorio de Dinámica No Lineal, UNAM).
Tienes acceso a todas las herramientas MCP para análisis cienciométrico, modelado neuronal de Kohonen (SOM), UMAP y reducción de dimensionalidad.

PROTOCOLOS METODOLÓGICOS DE ORQUESTACIÓN (SKILLS):

1. **Protocolo A (Benchmarking InCites -> SOM -> Mapa Visual):**
   Cuando el usuario pida entrenar un SOM o analizar entidades de InCites (p. ej. Locations, Organizations, Authors, Research Areas):
   - **Paso 1:** Consulta la entidad con `knomap_query_incites_entity(entity_name="...")`. Esto extrae los indicadores cuantitativos y publica la matriz en la sesión.
   - **Paso 2:** Entrena la red neuronal con `knomap_train_som(rows=10, cols=10, run_umap=True)`.
   - **Paso 3:** Genera el mapa interactivo con `knomap_render_visual_artifact(title="...")`.
   - **Paso 4:** Redacta el informe analítico de discusión con las métricas extraídas (CNCI, citas, clusters y topología).

2. **Protocolo B (Corpus Bibliográfico -> Red de Co-ocurrencia -> SOM):**
   Cuando se solicite procesar un archivo o dataset bibliométrico (WoS, Scopus, PubMed, RIS, CSV):
   - **Paso 1:** Extrae la red con `knomap_parse_file(file_path="...", max_terms=50)`.
   - **Paso 2:** Entrena el mapa SOM con `knomap_train_som()`.
   - **Paso 3:** Genera el artefacto visual con `knomap_render_visual_artifact()`.

3. **Protocolo C (Inspección de Estado y Manifold):**
   - Usa `knomap_get_active_project_manifest` para conocer los módulos y datos activos.
   - Usa `knomap_estimate_intrinsic_dimension` para calcular dimensión intrínseca con skdim (MLE).
   - Usa `knomap_get_som_state` para inspeccionar topología y clusters del lienzo.

4. **Protocolo D (Persistencia y Gestión de Proyectos):**
   - Usa `knomap_list_projects` y `knomap_get_project` para explorar y recuperar proyectos almacenados.
   - Usa `knomap_save_project` para guardar sesiones y reportes.

DIRECTIVAS CRÍTICAS:
- Ejecuta las herramientas necesarias en secuencia para completar la instrucción del usuario antes de emitir tu conclusión final.
- NUNCA inventes números ni respondas con enlaces/URLs ficticios. Invoca siempre las herramientas MCP correspondientes para que los artefactos visuales y métricas se generen en tiempo real.
"""

def load_modular_skills() -> str:
    """Dynamically loads and consolidates all SKILL.md files from engine/skills or .agents/skills."""
    skills_dirs = [
        os.path.join(os.path.dirname(__file__), "skills"),
        os.path.join(os.path.dirname(__file__), "..", ".agents", "skills")
    ]
    
    loaded_skills = []
    seen_skills = set()

    for s_dir in skills_dirs:
        if not os.path.exists(s_dir):
            continue
        try:
            for entry in sorted(os.listdir(s_dir)):
                sub_path = os.path.join(s_dir, entry)
                if os.path.isdir(sub_path):
                    skill_md_path = os.path.join(sub_path, "SKILL.md")
                    if os.path.exists(skill_md_path) and entry not in seen_skills:
                        seen_skills.add(entry)
                        try:
                            with open(skill_md_path, "r", encoding="utf-8") as f:
                                content = f.read()
                                if content.startswith("---"):
                                    parts = content.split("---", 2)
                                    if len(parts) >= 3:
                                        content = parts[2].strip()
                                loaded_skills.append(f"### Skill Especializado: {entry}\n{content}")
                        except Exception:
                            pass
        except Exception:
            pass

    if loaded_skills:
        return "\n\n=== SKILLS METODOLÓGICOS CARGADOS DESDE DISCO (engine/skills/) ===\n\n" + "\n\n---\n\n".join(loaded_skills)
    return ""

def build_system_prompt(project_context: Optional[Dict[str, Any]] = None) -> str:
    """Builds the complete system prompt with modular skills and injected project context summary."""
    prompt = BASE_SYSTEM_PROMPT
    modular_skills = load_modular_skills()
    if modular_skills:
        prompt += modular_skills

    if not project_context or not isinstance(project_context, dict):
        return prompt

    lines = ["\n\n--- ESTADO DEL PROYECTO ACTIVO EN EL CLIENTE ---"]
    proj_name = project_context.get("project_name") or "Active Workspace"
    proj_id = project_context.get("project_id") or "active_workspace"
    lines.append(f"- Proyecto: {proj_name} (ID: {proj_id})")

    file_name = project_context.get("file_name")
    if file_name:
        lines.append(f"- Archivo origen: {file_name}")

    ds = project_context.get("data_summary")
    if isinstance(ds, dict):
        total_items = ds.get("total_items", 0)
        dimensions = ds.get("dimensions", 0)
        labels = ds.get("labels_preview", [])
        if total_items > 0:
            lines.append(f"- Dataset cargado: {total_items} registros, {dimensions} dimensiones/features.")
        if labels:
            lines.append(f"- Muestra de etiquetas/términos ({len(labels)}): {', '.join(str(l) for l in labels[:10])}...")

    som = project_context.get("som_state")
    if isinstance(som, dict) and som.get("status") == "trained":
        grid = som.get("grid", [10, 10])
        n_clusters = som.get("n_clusters", 0)
        has_umap = som.get("has_umap", False)
        lines.append(f"- Red SOM: Entrenada (Grid: {grid[0]}x{grid[1]}, Clusters: {n_clusters}, UMAP 2D: {'Sí' if has_umap else 'No'})")
    else:
        lines.append("- Red SOM: No entrenada aún (disponible para entrenar con `knomap_train_som`)")

    inc = project_context.get("incites_data")
    if isinstance(inc, dict) and inc.get("loaded"):
        units = inc.get("available_units", [])
        active_u = inc.get("active_unit") or (units[0] if units else "N/A")
        lines.append(f"- InCites Explorer: Cargado. Unidades: {', '.join(units)}. Unidad activa: {active_u} ({inc.get('records_count', 0)} registros).")

    dim = project_context.get("dim_reduction")
    if isinstance(dim, dict) and dim.get("has_data"):
        lines.append(f"- Reducción Dimensional: Archivo {dim.get('file_name', '')}, Dimensión Intrínseca MLE: {dim.get('intrinsic_dimension', 'No calculada')}")

    lines.append("--------------------------------------------------\n")
    return prompt + "\n".join(lines)

class AgentBridge:
    def __init__(self, picoclaw_bin_path: Optional[str] = None):
        self.picoclaw_bin = picoclaw_bin_path or shutil.which("picoclaw")
        self.system_prompt = BASE_SYSTEM_PROMPT

    def is_picoclaw_available(self) -> bool:
        """Checks if the PicoClaw executable is available."""
        return self.picoclaw_bin is not None and os.path.exists(self.picoclaw_bin)

    def execute_tool(self, tool_name: str, arguments: Dict[str, Any], session_context: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches tool execution directly to mcp_server functions."""
        try:
            if tool_name == "knomap_get_active_project_manifest":
                return mcp_server.knomap_get_active_project_manifest()
            
            elif tool_name == "knomap_list_incites_entities":
                return mcp_server.knomap_list_incites_entities()
            
            elif tool_name == "knomap_query_incites_entity":
                entity = arguments.get("entity_name", "Locations")
                top_n = arguments.get("top_n", 25)
                sort_by = arguments.get("sort_by", "wos_docs")
                return mcp_server.knomap_query_incites_entity(entity_name=entity, top_n=top_n, sort_by=sort_by)
            
            elif tool_name == "knomap_get_som_state":
                return mcp_server.knomap_get_som_state()
            
            elif tool_name == "knomap_get_bibliometrics_state":
                return mcp_server.knomap_get_bibliometrics_state()
            
            elif tool_name == "knomap_get_dim_reduction_state":
                return mcp_server.knomap_get_dim_reduction_state()

            elif tool_name == "knomap_inspect_dataset":
                return mcp_server.knomap_inspect_dataset(arguments.get("file_path", ""))
            
            elif tool_name == "knomap_parse_file":
                res = mcp_server.knomap_parse_file(
                    file_path=arguments.get("file_path", ""),
                    network_type=arguments.get("network_type", "co-occurrence"),
                    max_terms=arguments.get("max_terms", 50),
                    min_cooccurrence=arguments.get("min_cooccurrence", 2)
                )
                if res.get("matrix"):
                    session_context["last_matrix"] = res.get("matrix")
                    session_context["last_labels"] = res.get("terms", [])
                return {"success": True, "n_terms": len(res.get("terms", [])), "matrix_shape": [len(res.get("matrix", [])), len(res.get("matrix", [[]])[0]) if res.get("matrix") else 0]}
            
            elif tool_name == "knomap_suggest_som_size":
                matrix = arguments.get("data_matrix") or session_context.get("last_matrix") or []
                if not matrix:
                    # Check active session in mcp_server
                    matrix = mcp_server._ACTIVE_SESSION.get("last_matrix") or []
                if not matrix:
                    return {"success": False, "error": "No active data matrix found. Call knomap_parse_file or load a project first."}
                return mcp_server.knomap_suggest_som_size(matrix)
            
            elif tool_name == "knomap_train_som":
                matrix = arguments.get("data_matrix") or session_context.get("last_matrix") or mcp_server._ACTIVE_SESSION.get("last_matrix") or []
                labels = arguments.get("labels") or session_context.get("last_labels") or mcp_server._ACTIVE_SESSION.get("last_labels") or []
                if not matrix:
                    return {"success": False, "error": "No data matrix available. Call knomap_parse_file first."}
                
                rows = arguments.get("rows", 10)
                cols = arguments.get("cols", 10)
                res = mcp_server.knomap_train_som(
                    data_matrix=matrix,
                    rows=rows,
                    cols=cols,
                    iterations=arguments.get("iterations", 100),
                    method=arguments.get("method", "batch"),
                    run_umap=arguments.get("run_umap", True),
                    labels=labels
                )
                if res.get("success"):
                    session_context["last_som_state"] = res
                return {
                    "success": res.get("success", False),
                    "grid": [rows, cols],
                    "quantization_error_mean": round(float(sum(res.get("quantization_errors", [0])) / max(1, len(res.get("quantization_errors", [1])))), 4),
                    "n_clusters": len(set(res.get("clustering", {}).get("labels", []))) if isinstance(res.get("clustering"), dict) else 0
                }
            
            elif tool_name == "knomap_render_visual_artifact":
                som_state = session_context.get("last_som_state") or mcp_server._ACTIVE_SESSION.get("last_som_state")
                if not som_state:
                    return {"success": False, "error": "No SOM map trained yet. Call knomap_train_som first."}
                title = arguments.get("title", "knoMap SOM Topology")
                art = mcp_server.knomap_render_visual_artifact(som_state, title=title)
                session_context["artifacts"] = session_context.get("artifacts", []) + [{
                    "type": "html_hex_map",
                    "title": title,
                    "html": art.get("html_artifact", ""),
                    "svg": art.get("svg_artifact", "")
                }]
                return {"success": True, "message": "Visual artifact generated and attached to chat."}
            
            elif tool_name == "knomap_estimate_intrinsic_dimension":
                matrix = arguments.get("data_matrix") or session_context.get("last_matrix") or mcp_server._ACTIVE_SESSION.get("last_matrix") or []
                if not matrix:
                    return {"success": False, "error": "No data matrix available."}
                return mcp_server.knomap_estimate_intrinsic_dimension(matrix, algorithm=arguments.get("algorithm", "mle"))
            
            elif tool_name == "knomap_save_project":
                name = arguments.get("name", "Project Generated by knoMap Agent")
                report_md = arguments.get("report_markdown", "")
                som_state = session_context.get("last_som_state") or mcp_server._ACTIVE_SESSION.get("last_som_state") or {}
                save_res = mcp_server.knomap_save_project(
                    name=name,
                    metadata={"created_by": "knoMap AI Agent", "source": "Autonomous Workflow"},
                    som_state=som_state,
                    report_markdown=report_md,
                    save_to_sqlite=True
                )
                session_context["saved_project_id"] = save_res.get("project_id")
                return save_res

            elif tool_name == "knomap_get_project":
                return mcp_server.knomap_get_project(arguments.get("project_id_or_path", ""))

            elif tool_name == "knomap_list_projects":
                return mcp_server.knomap_list_projects(limit=arguments.get("limit", 50))

            else:
                return {"success": False, "error": f"Tool '{tool_name}' not implemented in bridge."}

        except Exception as e:
            return {"success": False, "error": f"Error executing tool '{tool_name}': {str(e)}"}

    def run_native_tool_loop(
        self,
        user_message: str,
        history: Optional[List[Dict[str, str]]] = None,
        custom_base_url: Optional[str] = None,
        custom_api_key: Optional[str] = None,
        custom_model: Optional[str] = None,
        project_context: Optional[Dict[str, Any]] = None,
        max_turns: int = 8
    ) -> Dict[str, Any]:
        """
        Executes the autonomous ReAct tool loop using OpenAI / LM Studio / UNAM LDNL client.
        """
        import urllib.request
        import urllib.error

        # Hydrate active session with incoming project context from frontend
        if project_context and isinstance(project_context, dict):
            mcp_server.hydrate_session(project_context)

        active_system_prompt = build_system_prompt(project_context)

        base_url = custom_base_url or os.environ.get("LLM_BASE_URL", "https://dinamica1.fciencias.unam.mx/v1/")
        api_key = custom_api_key or os.environ.get("LLM_API_KEY", "")
        model = custom_model or os.environ.get("LLM_MODEL", "default")
        url = base_url.rstrip("/") + "/chat/completions"

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": active_system_prompt}
        ]

        if history:
            for h in history:
                messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})

        messages.append({"role": "user", "content": user_message})

        session_context: Dict[str, Any] = {
            "artifacts": [],
            "steps": [],
            "last_matrix": mcp_server._ACTIVE_SESSION.get("last_matrix"),
            "last_labels": mcp_server._ACTIVE_SESSION.get("last_labels")
        }

        for turn in range(max_turns):
            payload = {
                "model": model,
                "messages": messages,
                "tools": KNOMAP_AGENT_TOOLS,
                "tool_choice": "auto",
                "temperature": 0.3
            }

            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}" if api_key else ""
                }
            )

            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_detail = ""
                try:
                    err_detail = e.read().decode("utf-8")
                except Exception:
                    pass
                msg = f"HTTP {e.code}: {e.reason}"
                if e.code == 401:
                    msg += " -> Se requiere una API Key válida. Haz clic en el botón 'API & Model' en la barra superior para configurarla o selecciona tu proveedor local."
                elif err_detail:
                    msg += f" - {err_detail}"
                return {
                    "success": False,
                    "agent_engine": "native_fallback_error",
                    "error": f"Error de comunicación con el LLM ({msg})",
                    "steps": session_context["steps"],
                    "artifacts": session_context["artifacts"]
                }
            except Exception as e:
                return {
                    "success": False,
                    "agent_engine": "native_fallback_error",
                    "error": f"Error de red al conectar con el servidor LLM: {str(e)}",
                    "steps": session_context["steps"],
                    "artifacts": session_context["artifacts"]
                }


            choice = resp_data.get("choices", [{}])[0]
            message = choice.get("message", {})
            tool_calls = message.get("tool_calls", [])

            if not tool_calls:
                final_text = (message.get("content") or "").strip()
                if not final_text and message.get("reasoning"):
                    final_text = (message.get("reasoning") or "").strip()

                # Check if model emitted JSON tool call in text content
                synthesized_call = None
                try:
                    if (final_text.startswith("{") and final_text.endswith("}")) or ("```json" in final_text and "}" in final_text) or ("```" in final_text and "}" in final_text):
                        clean_json = final_text
                        if "```json" in clean_json:
                            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
                        elif "```" in clean_json:
                            clean_json = clean_json.split("```")[1].split("```")[0].strip()
                        
                        parsed = json.loads(clean_json)
                        if isinstance(parsed, dict):
                            fn_candidate = parsed.get("name") or parsed.get("tool") or parsed.get("function")
                            args_candidate = parsed.get("arguments") or parsed.get("parameters") or parsed.get("args") or {}
                            if fn_candidate and any(t["function"]["name"] == fn_candidate for t in KNOMAP_AGENT_TOOLS):
                                synthesized_call = [{
                                    "id": f"call_text_{fn_candidate}",
                                    "type": "function",
                                    "function": {
                                        "name": fn_candidate,
                                        "arguments": json.dumps(args_candidate) if isinstance(args_candidate, dict) else str(args_candidate)
                                    }
                                }]
                except Exception:
                    synthesized_call = None

                if synthesized_call:
                    tool_calls = synthesized_call
                    message["tool_calls"] = synthesized_call
                    message["content"] = None
                else:
                    return {
                        "success": True,
                        "agent_engine": "native_react_loop",
                        "reply": final_text,
                        "steps": session_context["steps"],
                        "artifacts": session_context["artifacts"],
                        "project_id": session_context.get("saved_project_id")
                    }

            messages.append(message)

            for tc in tool_calls:
                fn = tc.get("function", {})
                fn_name = fn.get("name", "")
                try:
                    fn_args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    fn_args = {}

                step_info = {
                    "tool": fn_name,
                    "arguments": fn_args
                }

                tool_output = self.execute_tool(fn_name, fn_args, session_context)
                step_info["result"] = tool_output
                session_context["steps"].append(step_info)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"call_{fn_name}"),
                    "content": json.dumps(tool_output)
                })

        return {
            "success": True,
            "agent_engine": "native_react_loop_max_turns",
            "reply": messages[-1].get("content") or messages[-1].get("reasoning") or "Se completó la ejecución de las herramientas.",
            "steps": session_context["steps"],
            "artifacts": session_context["artifacts"],
            "project_id": session_context.get("saved_project_id")
        }

    def run_agent_turn(
        self,
        user_message: str,
        history: Optional[List[Dict[str, str]]] = None,
        custom_base_url: Optional[str] = None,
        custom_api_key: Optional[str] = None,
        custom_model: Optional[str] = None,
        project_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Main entry point for agent execution (PicoClaw with Native Tool Loop fallback)."""
        if self.is_picoclaw_available():
            try:
                cmd = [
                    self.picoclaw_bin,
                    "--prompt", user_message,
                    "--system", build_system_prompt(project_context)
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                output = proc.stdout if proc.returncode == 0 else proc.stderr
                return {
                    "success": proc.returncode == 0,
                    "agent_engine": "picoclaw",
                    "reply": output,
                    "steps": [],
                    "artifacts": []
                }
            except Exception:
                return self.run_native_tool_loop(user_message, history, custom_base_url, custom_api_key, custom_model, project_context)
        else:
            return self.run_native_tool_loop(user_message, history, custom_base_url, custom_api_key, custom_model, project_context)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Check if json payload passed via stdin or file
        prompt = sys.argv[1]
        proj_ctx = None
        if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
            try:
                with open(sys.argv[2], "r", encoding="utf-8") as f:
                    proj_ctx = json.load(f)
            except Exception:
                pass
        bridge = AgentBridge()
        res = bridge.run_agent_turn(prompt, project_context=proj_ctx)
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print("knoMap Agent Bridge is ready. Pass a prompt to test.")
