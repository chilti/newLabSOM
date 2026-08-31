# Especificación de Arquitectura: knoMap Dual-Layer & Hybrid Deployment (Desktop & Server)

**Proyecto:** knoMap  
**Ecosistema:** Laboratorio de Dinámica No Lineal (Facultad de Ciencias, UNAM) / Analítica Cienciométrica  
**Versión:** 1.2.0  
**Fecha de actualización:** 28 de Agosto de 2026  

---

## 1. Decisiones de Diseño Confirmadas

1. **Runtime Agéntico Embebido:** **PicoClaw** (escrito en Go, binario único independiente, < 10 MB RAM, sin dependencias de Node.js).
2. **Reutilización 100% de Código:** El servidor MCP **NO duplica código**; es una capa delgada (*adapter wrapper*) que importa directamente las clases y funciones existentes de `engine/` (`som_solver.py`, `semantic_engine.py`, etc.).
3. **Transporte MCP Universal:** Soporte nativo para **`stdio`** tanto en Desktop como en Servidor (para agentes locales como PicoClaw/Antigravity), con opción a `SSE/HTTP` para agentes que consumen desde clientes remotos.
4. **Base de Datos Zero-Config:** **SQLite** (integrado nativamente en Python con `sqlite3`, sin necesidad de instalar servidores de bases de datos como PostgreSQL o MySQL).

---

## 2. Diagrama de Arquitectura Unificada

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             CAPA DE CONSUMIDORES                                                 │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────┤
│                  MODALIDAD HUMANA                    │                    MODALIDAD AGÉNTICA                     │
│  ┌────────────────────────┬───────────────────────┐  │  ┌───────────────────────────┬─────────────────────────┐  │
│  │   knoMap Desktop App   │   knoMap Web (Server) │  │  │ Agente Embebido (PicoClaw)│ Agentes Externos (BYOA) │  │
│  │    (Lienzo Local)      │  (Navegador / Multi)  │  │  │  (Binario único Go <10MB) │ (Claude, Antigravity)   │  │
│  └───────────┬────────────┴───────────┬───────────┘  │  └─────────────┬─────────────┴────────────┬────────────┘  │
└──────────────┼────────────────────────┼──────────────┴────────────────┼──────────────────────────┼───────────────┘
               │                        │                               │                          │
               │                        │ (REST / WebSockets)           │ (JSON-RPC stdio)         │ (stdio / SSE)
               │                        ▼                               ▼                          ▼
┌──────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┐
│              │                                    CAPA MCP GATEWAY (`FastMCP`)                                   │
│              │  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐  │
│              │  │ `knomap-mcp` Adapter                                                                        │  │
│              │  │ • Modo Universal: `stdio` (Desktop y Servidor para agentes locales)                        │  │
│              │  │ • Modo Red: `SSE / HTTP` (Opcional para agentes remotos)                                    │  │
│              │  └──────────────────────────────────────┬──────────────────────────────────────────────────────┘  │
│              ▼                                         │                                                         │
│  ┌─────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┐  │
│  │                            CAPA DE PERSISTENCIA Y REPOSITORIO ZERO-CONFIG                                  │  │
│  ├─────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┤  │
│  │ 1. Archivo Local `.knomap` (JSON portable)          │ 2. Base de Datos SQLite (`knomap_hub.db`)             │  │
│  │    - Proyectos offline y anexos en publicaciones    │    - Cero instalación, motor SQLite nativo en Python │  │
│  │                                                     │    - Proyectos compartidos por ID y URL pública      │  │
│  └─────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┘
                                                         │ (Importaciones directas en Python)
                                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CAPA DEL MOTOR COMPUTACIONAL (Python `engine/` - REUTILIZACIÓN 100%)                 │
├────────────────────────────────┬─────────────────────────────┬───────────────────────────────────────────────────┤
│ 1. Ingesta y Parsers           │ 2. Métricas y Topología     │ 3. Modelado Semántico                             │
├────────────────────────────────┼─────────────────────────────┼───────────────────────────────────────────────────┤
│ • `bibliometrics_parser.py`    │ • `som_solver.py`           │ • `semantic_engine.py`                            │
│ • `incites_parser.py`          │ • UMAP (`algo_umap.md`)     │ • SPECTER2 / SentenceTransformers                │
│ • `vos_parsers.py`             │ • `patch_skdim.py` (MLE ID) │ • HDBSCAN / Leiden / Louvain                     │
│ • InCites Zip / OpenAlex JSON  │ • U-Matrix & Component Pl.  │ • TF-IDF / N-gram Extraction                     │
└────────────────────────────────┴─────────────────────────────┴───────────────────────────────────────────────────┘
```

---

## 3. Detalle de Respuestas a las Preguntas de Arquitectura

### 3.1 Reutilización de Código: ¿Los servicios MCP usan el mismo código del engine?
**Sí, al 100%.**  
El servidor MCP no reescribe ninguna lógica matemática ni bibliométrica. Es un archivo puente (ej. `engine/mcp_server.py`) que importa las funciones existentes y las decora con `@mcp.tool()`:

```python
# engine/mcp_server.py (Capa delgada de adaptación)
from mcp.server.fastmcp import FastMCP
from engine.som_solver import SOMSolver
from engine.semantic_engine import SemanticEngine
from engine.incites_parser import parse_incites_file

mcp = FastMCP("knoMap-Engine")

@mcp.tool()
def train_som(grid_x: int, grid_y: int, iterations: int = 1000) -> dict:
    """Entrena la red auto-organizada de Kohonen sobre el corpus actual."""
    solver = SOMSolver(grid_size=(grid_x, grid_y))
    return solver.fit(iterations=iterations)
```
*Cualquier mejora o corrección en el engine beneficia automáticamente a la GUI y a los agentes.*

---

### 3.2 Transporte MCP: ¿Puede ser por `stdio` también en el servidor?
**Sí, absolutamente.**  
El protocolo `stdio` (comunicación a través de entrada/salida estándar) es el estándar universal de MCP y funciona tanto en Linux/servidor como en Windows/Desktop.
* Si el agente (**PicoClaw**, **Antigravity** o **OpenHands**) corre en el servidor, simplemente ejecuta el comando `python -m engine.mcp_server` y se comunica por `stdio` con latencia prácticamente nula.
* El soporte `SSE/HTTP` solo se activa si se desea que un agente corriendo en una computadora remota externa se conecte al servidor de knoMap por internet.

---

### 3.3 Base de Datos de Proyectos: ¿Podemos usar SQLite en lugar de instalar PostgreSQL?
**SQLite es la mejor opción para knoMap:**
1. **Cero instalación y cero mantenimiento:** No requiere instalar servicios de PostgreSQL, MySQL, ni configurar usuarios o contraseñas.
2. **Nativo en Python:** Viene incluido en la biblioteca estándar (`import sqlite3`).
3. **Alto rendimiento y portabilidad:** Un único archivo `knomap_hub.db` en el servidor maneja decenas de miles de proyectos con soporte nativo de JSON (`json_extract`), transacciones ACID y modo WAL (*Write-Ahead Logging*) para accesos concurrentes.
4. **Respaldo trivial:** Para hacer un respaldo de todos los proyectos compartidos del servidor, basta con copiar un solo archivo (`knomap_hub.db`).

---

## 4. Próximos Pasos para el Plan de Implementación

Con todas las decisiones arquitectónicas acordadas:
1. **Fase 1 (Core MCP):** Creación del adaptador `engine/mcp_server.py` con `FastMCP` importando las herramientas existentes de `engine/`.
2. **Fase 2 (Persistencia SQLite & `.knomap`):** Módulo de serialización de proyectos y repositorio SQLite ligero.
3. **Fase 3 (Integración PicoClaw):** Empaquetado del binario de PicoClaw y script de lanzamiento integrado.
4. **Fase 4 (GUI & Documentación):** Vista de conexión MCP en la aplicación de escritorio y borrador de la sección metodológica del paper para *Scientometrics*.
