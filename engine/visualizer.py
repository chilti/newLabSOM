"""
Visual Artifacts Generator for knoMap.
Generates:
1. Self-contained interactive HTML5 hex-maps for Agent Artifacts.
2. Clean vector SVG maps for reports/preprints.
3. Deep-links for knoMap Desktop and Server Hub.
"""

import json
import math
from typing import Dict, Any, Optional, List

def generate_deep_link(project_id: str, server_base_url: Optional[str] = None) -> Dict[str, str]:
    """Generates desktop URI scheme and web URL deep links."""
    desktop_link = f"knomap://open?project_id={project_id}"
    web_link = f"{server_base_url.rstrip('/')}/project/{project_id}" if server_base_url else None
    return {
        "desktop_uri": desktop_link,
        "web_url": web_link,
        "markdown_link": f"[Abrir en knoMap Desktop]({desktop_link})" + (f" | [Ver en Navegador]({web_link})" if web_link else "")
    }

def render_interactive_html(som_state: Dict[str, Any], title: str = "knoMap SOM Topology", color_by: str = "umatrix") -> str:
    """
    Renders a self-contained, dependency-free interactive HTML5 hexagonal SOM map.
    Features:
    - Interactive hover tooltips displaying neuron metrics, cluster, and mapped terms.
    - Switchable views (U-Matrix distance, Cluster ID, Document Density/Frequencies).
    - Responsive canvas/SVG layout with modern styling.
    """
    hex_grid = som_state.get("hex_grid", [])
    umatrix = som_state.get("umatrix", [])
    clustering = som_state.get("clustering", {})
    cluster_labels = clustering.get("labels", []) if isinstance(clustering, dict) else []
    frequencies = som_state.get("frequencies", [])
    mapped_labels = som_state.get("mapped_labels", [])
    
    # Calculate bounding box for SVG viewBox
    xs = [h.get("x", 0) for h in hex_grid] or [0]
    ys = [h.get("y", 0) for h in hex_grid] or [0]
    min_x, max_x = min(xs) - 1.5, max(xs) + 1.5
    min_y, max_y = min(ys) - 1.5, max(ys) + 1.5
    width = max(100.0, (max_x - min_x) * 40.0)
    height = max(100.0, (max_y - min_y) * 40.0)

    # Flatten umatrix values for normalization
    flat_umatrix = [val for row in umatrix for val in row] if (umatrix and isinstance(umatrix[0], list)) else umatrix
    min_u = min(flat_umatrix) if flat_umatrix else 0.0
    max_u = max(flat_umatrix) if flat_umatrix else 1.0
    range_u = (max_u - min_u) if (max_u - min_u) > 1e-9 else 1.0

    # Max frequency for normalization
    max_freq = max(frequencies) if frequencies else 1

    # Color palettes
    cluster_colors = [
        "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", 
        "#EC4899", "#14B8A6", "#6366F1", "#84CC16", "#F97316"
    ]

    neurons_payload = []
    for idx, hex_cell in enumerate(hex_grid):
        u_val = flat_umatrix[idx] if idx < len(flat_umatrix) else 0.0
        c_id = cluster_labels[idx] if idx < len(cluster_labels) else 0
        freq = frequencies[idx] if idx < len(frequencies) else 0
        labels = mapped_labels[idx] if idx < len(mapped_labels) else []
        
        # Normalized values
        norm_u = (u_val - min_u) / range_u
        # Heatmap color from low (dark blue/purple) to high (yellow/white)
        # Plasma-like gradient:
        r = int(255 * math.sqrt(norm_u))
        g = int(255 * (norm_u ** 2))
        b = int(255 * (1.0 - norm_u))
        u_color = f"rgb({r},{g},{b})"
        
        c_color = cluster_colors[c_id % len(cluster_colors)] if c_id >= 0 else "#64748B"
        
        # Density color (light blue to deep indigo)
        freq_ratio = freq / max_freq if max_freq > 0 else 0
        d_color = f"rgba(59, 130, 246, {max(0.15, freq_ratio):.2f})"

        neurons_payload.append({
            "index": idx,
            "row": hex_cell.get("row", 0),
            "col": hex_cell.get("col", 0),
            "x": hex_cell.get("x", 0),
            "y": hex_cell.get("y", 0),
            "u_val": round(float(u_val), 4),
            "cluster_id": int(c_id),
            "freq": int(freq),
            "labels": labels[:10], # Top 10 mapped items
            "color_umatrix": u_color,
            "color_cluster": c_color,
            "color_density": d_color
        })

    data_json = json.dumps(neurons_payload)

    html_template = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  :root {{
    --bg: #0F172A;
    --card: #1E293B;
    --text: #F8FAFC;
    --text-muted: #94A3B8;
    --border: #334155;
    --accent: #38BDF8;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
  }}
  .header {{
    width: 100%;
    max-width: 900px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }}
  h1 {{ font-size: 1.25rem; font-weight: 700; color: var(--accent); }}
  .controls {{
    display: flex;
    gap: 8px;
  }}
  button {{
    background: var(--card);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }}
  button.active, button:hover {{
    background: var(--accent);
    color: #0F172A;
    border-color: var(--accent);
  }}
  .map-container {{
    position: relative;
    width: 100%;
    max-width: 900px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
  }}
  svg {{
    width: 100%;
    height: auto;
    max-height: 550px;
    overflow: visible;
  }}
  polygon.hexagon {{
    stroke: #1E293B;
    stroke-width: 0.08;
    cursor: pointer;
    transition: transform 0.1s ease, stroke-width 0.1s ease;
  }}
  polygon.hexagon:hover {{
    stroke: #FFFFFF;
    stroke-width: 0.25;
    filter: drop-shadow(0 0 4px rgba(255,255,255,0.7));
  }}
  .tooltip {{
    position: absolute;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 0.8rem;
    color: var(--text);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.7);
    max-width: 280px;
    z-index: 50;
  }}
  .tooltip h4 {{ color: var(--accent); margin-bottom: 4px; font-size: 0.9rem; }}
  .tooltip p {{ margin: 2px 0; color: var(--text-muted); }}
  .tooltip ul {{ margin-top: 6px; padding-left: 16px; color: #E2E8F0; font-size: 0.75rem; }}
</style>
</head>
<body>

<div class="header">
  <h1>⬡ {title}</h1>
  <div class="controls">
    <button id="btn-umatrix" class="active" onclick="switchView('umatrix')">U-Matrix</button>
    <button id="btn-cluster" onclick="switchView('cluster')">Clústeres</button>
    <button id="btn-density" onclick="switchView('density')">Densidad</button>
  </div>
</div>

<div class="map-container">
  <div id="tooltip" class="tooltip"></div>
  <svg id="som-svg" viewBox="{min_x} {min_y} {max_x - min_x} {max_y - min_y}">
    <g id="hex-group"></g>
  </svg>
</div>

<script>
const neurons = {data_json};
let currentMode = 'umatrix';

const hexGroup = document.getElementById('hex-group');
const tooltip = document.getElementById('tooltip');

// R = 1.0, Flat-topped hexagon angles
const R = 0.95;
function getHexPoints(cx, cy) {{
  const pts = [];
  for (let i = 0; i < 6; i++) {{
    const angle_deg = 60 * i;
    const angle_rad = Math.PI / 180 * angle_deg;
    pts.push((cx + R * Math.cos(angle_rad)).toFixed(3) + ',' + (cy + R * Math.sin(angle_rad)).toFixed(3));
  }}
  return pts.join(' ');
}}

function renderMap() {{
  hexGroup.innerHTML = '';
  neurons.forEach(n => {{
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('class', 'hexagon');
    poly.setAttribute('points', getHexPoints(n.x, n.y));
    
    let fill = n.color_umatrix;
    if (currentMode === 'cluster') fill = n.color_cluster;
    if (currentMode === 'density') fill = n.color_density;
    poly.setAttribute('fill', fill);

    poly.addEventListener('mouseenter', (e) => {{
      tooltip.style.opacity = '1';
      let labelsHtml = n.labels.length > 0 
        ? '<ul>' + n.labels.map(l => '<li>' + l + '</li>').join('') + '</ul>'
        : '<p><em>Sin documentos asignados</em></p>';

      tooltip.innerHTML = `
        <h4>Neurona #${{n.index}} [R:${{n.row}}, C:${{n.col}}]</h4>
        <p><strong>U-Matrix:</strong> ${{n.u_val}}</p>
        <p><strong>Clúster:</strong> Grupo ${{n.cluster_id}}</p>
        <p><strong>Frecuencia:</strong> ${{n.freq}} docs</p>
        ${{labelsHtml}}
      `;
    }});

    poly.addEventListener('mousemove', (e) => {{
      const containerRect = document.querySelector('.map-container').getBoundingClientRect();
      let left = e.clientX - containerRect.left + 15;
      let top = e.clientY - containerRect.top + 15;
      if (left + 260 > containerRect.width) left -= 280;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }});

    poly.addEventListener('mouseleave', () => {{
      tooltip.style.opacity = '0';
    }});

    hexGroup.appendChild(poly);
  }});
}}

function switchView(mode) {{
  currentMode = mode;
  document.querySelectorAll('.controls button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + mode).classList.add('active');
  renderMap();
}}

renderMap();
</script>
</body>
</html>
"""
    return html_template

def render_svg_map(som_state: Dict[str, Any], color_by: str = "umatrix") -> str:
    """Renders a standalone clean SVG map string for inclusion in markdown or reports."""
    hex_grid = som_state.get("hex_grid", [])
    umatrix = som_state.get("umatrix", [])
    frequencies = som_state.get("frequencies", [])
    
    xs = [h.get("x", 0) for h in hex_grid] or [0]
    ys = [h.get("y", 0) for h in hex_grid] or [0]
    min_x, max_x = min(xs) - 1.5, max(xs) + 1.5
    min_y, max_y = min(ys) - 1.5, max(ys) + 1.5

    flat_umatrix = [val for row in umatrix for val in row] if (umatrix and isinstance(umatrix[0], list)) else umatrix
    min_u = min(flat_umatrix) if flat_umatrix else 0.0
    max_u = max(flat_umatrix) if flat_umatrix else 1.0
    range_u = (max_u - min_u) if (max_u - min_u) > 1e-9 else 1.0

    polygons_svg = []
    R = 0.95
    for idx, hex_cell in enumerate(hex_grid):
        cx, cy = hex_cell.get("x", 0), hex_cell.get("y", 0)
        pts = []
        for i in range(6):
            angle_rad = math.pi / 180 * (60 * i)
            pts.append(f"{cx + R * math.cos(angle_rad):.2f},{cy + R * math.sin(angle_rad):.2f}")
        points_str = " ".join(pts)

        u_val = flat_umatrix[idx] if idx < len(flat_umatrix) else 0.0
        norm_u = (u_val - min_u) / range_u
        r = int(255 * math.sqrt(norm_u))
        g = int(255 * (norm_u ** 2))
        b = int(255 * (1.0 - norm_u))
        color = f"rgb({r},{g},{b})"

        polygons_svg.append(f'<polygon points="{points_str}" fill="{color}" stroke="#1E293B" stroke-width="0.08" />')

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x:.2f} {min_y:.2f} {max_x - min_x:.2f} {max_y - min_y:.2f}" width="100%" height="auto" style="background:#0F172A; border-radius:8px;">
<g id="hexagons">
{chr(10).join(polygons_svg)}
</g>
</svg>"""
    return svg_content
