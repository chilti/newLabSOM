import os
import json
import math
import numpy as np
from typing import Dict, Any
from pyecharts import options as opts
from pyecharts.charts import Surface3D, HeatMap, Page, Grid

def render_umatrix_3d(som_state: Dict[str, Any], output_path: str) -> dict:
    """
    Renderiza la matriz de distancias U-Matrix como una superficie 3D navegable.
    Los "valles" representan alta densidad/cohesión, las "montañas" representan fronteras.
    """
    umatrix = som_state.get("umatrix", [])
    if not umatrix:
        return {"error": "No u-matrix data found in som_state."}

    # Determinar si umatrix es 1D (plano) o 2D (grid)
    # En knoMap a veces se serializa plano.
    grid_rows = som_state.get("config", {}).get("rows", 0)
    grid_cols = som_state.get("config", {}).get("cols", 0)
    
    is_flat = False
    if len(umatrix) > 0 and not isinstance(umatrix[0], list):
        is_flat = True
        if grid_rows == 0 or grid_cols == 0:
            # Intentar inferir si es cuadrado
            size = math.isqrt(len(umatrix))
            grid_rows = size
            grid_cols = size

    data_3d = []
    max_z = 0
    min_z = float('inf')
    
    if is_flat:
        for i in range(grid_rows):
            for j in range(grid_cols):
                idx = i * grid_cols + j
                if idx < len(umatrix):
                    z = float(umatrix[idx])
                    data_3d.append([j, i, z])
                    if z > max_z: max_z = z
                    if z < min_z: min_z = z
    else:
        grid_rows = len(umatrix)
        grid_cols = len(umatrix[0]) if grid_rows > 0 else 0
        for i, row in enumerate(umatrix):
            for j, z_val in enumerate(row):
                z = float(z_val)
                data_3d.append([j, i, z])
                if z > max_z: max_z = z
                if z < min_z: min_z = z

    surface = Surface3D(init_opts=opts.InitOpts(width="100%", height="800px"))
    surface.add(
        series_name="Distancia",
        shading="color",
        data=data_3d,
        xaxis3d_opts=opts.Axis3DOpts(type_="value", name="Columna X"),
        yaxis3d_opts=opts.Axis3DOpts(type_="value", name="Fila Y"),
        zaxis3d_opts=opts.Axis3DOpts(type_="value", name="U-Matrix"),
        grid3d_opts=opts.Grid3DOpts(width=100, height=40, depth=100),
    )
    surface.set_global_opts(
        title_opts=opts.TitleOpts(title="Superficie 3D: Topología del SOM (U-Matrix)"),
        visualmap_opts=opts.VisualMapOpts(
            max_=max_z,
            min_=min_z,
            range_color=[
                "#313695",
                "#4575b4",
                "#74add1",
                "#abd9e9",
                "#e0f3f8",
                "#ffffbf",
                "#fee090",
                "#fdae61",
                "#f46d43",
                "#d73027",
                "#a50026",
            ],
        )
    )
    
    surface.render(output_path)
    return {"visual_artifact_path": output_path, "agent_summary": "Superficie 3D de U-Matrix generada exitosamente."}

def render_component_planes(som_state: Dict[str, Any], output_path: str, max_components: int = 12) -> dict:
    """
    Renderiza los Planos de Componentes (Component Planes) usando mapas de calor,
    para permitir correlación visual de indicadores.
    """
    weights = som_state.get("weights", [])
    if not weights:
        return {"error": "No weights data found in som_state."}

    grid_rows = som_state.get("config", {}).get("rows", 0)
    grid_cols = som_state.get("config", {}).get("cols", 0)
    
    if grid_rows == 0 or grid_cols == 0:
        size = math.isqrt(len(weights))
        grid_rows = size
        grid_cols = size

    # Si weights es una lista de listas (cada sublista es el vector de características de una neurona)
    if isinstance(weights, list) and len(weights) > 0 and isinstance(weights[0], list):
        num_features = len(weights[0])
    else:
        return {"error": "Weights format not supported or empty."}
        
    num_plots = min(num_features, max_components)
    
    page = Page(layout=Page.SimplePageLayout)
    
    for f_idx in range(num_plots):
        heatmap_data = []
        max_val = -float('inf')
        min_val = float('inf')
        
        for i in range(grid_rows):
            for j in range(grid_cols):
                idx = i * grid_cols + j
                if idx < len(weights):
                    val = float(weights[idx][f_idx])
                    # Heatmap espera [x, y, value]
                    heatmap_data.append([j, grid_rows - 1 - i, val])
                    if val > max_val: max_val = val
                    if val < min_val: min_val = val

        hm = HeatMap(init_opts=opts.InitOpts(width="600px", height="500px"))
        hm.add_xaxis([str(x) for x in range(grid_cols)])
        hm.add_yaxis(
            f"Dimensión {f_idx + 1}",
            [str(y) for y in range(grid_rows)],
            heatmap_data,
            label_opts=opts.LabelOpts(is_show=False),
        )
        hm.set_global_opts(
            title_opts=opts.TitleOpts(title=f"Plano: Dimensión {f_idx + 1}"),
            visualmap_opts=opts.VisualMapOpts(
                min_=min_val,
                max_=max_val,
                # Usa gradiente de calor estándar
            )
        )
        page.add(hm)

    page.render(output_path)
    return {"visual_artifact_path": output_path, "agent_summary": f"Generados {num_plots} Planos de Componentes exitosamente."}
