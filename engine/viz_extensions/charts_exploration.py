import os
import pandas as pd
import json
from typing import Dict
from pyecharts import options as opts
from pyecharts.charts import Boxplot, Bar, Line, Grid, Page, Map, TreeMap, WordCloud

# Mapping common InCites countries to Pyecharts Map standard names
INCITES_COUNTRY_MAP = {
    "USA": "United States",
    "ENGLAND": "United Kingdom",
    "SCOTLAND": "United Kingdom",
    "WALES": "United Kingdom",
    "NORTHERN IRELAND": "United Kingdom",
    "SOUTH KOREA": "Korea",
    "PEOPLES R CHINA": "China",
    "RUSSIA": "Russia",
    "TAIWAN": "Taiwan",
    # Add other variants if necessary
}

def detect_temporal_column(df: pd.DataFrame) -> str:
    """Detecta si hay alguna columna que parezca año o fecha."""
    for col in df.columns:
        if str(col).lower() in ["year", "año", "date", "fecha", "time"]:
            return col
    return None

def normalize_country_name(name: str) -> str:
    if not isinstance(name, str):
        return str(name)
    upper_name = name.upper()
    return INCITES_COUNTRY_MAP.get(upper_name, name.title())

def render_exploration_dashboard(df: pd.DataFrame, output_path: str, filename_hint: str = "") -> dict:
    """
    Genera un panel HTML interactivo (Profiler) para la exploración inicial (Paso 1).
    Detecta datos específicos de InCites para agregar vistas especializadas:
    - Map (Choropleth) para Locations.
    - TreeMap para Topics / Research Areas.
    - WordCloud para Organizations / Funding Agencies.
    Y dibuja visualizaciones genéricas para los demás.
    """
    page = Page(layout=Page.SimplePageLayout)
    filename_lower = filename_hint.lower()
    added_special_charts = False
    
    # 1. Detectar Entidades InCites (Locations, Topics, Organizations)
    
    # CHOROPLETH MAP para Locations
    if "location" in filename_lower or "country" in filename_lower:
        # Asume que la columna 'Name' tiene el país, 'Web of Science Documents' la métrica principal
        if 'Name' in df.columns and 'Web of Science Documents' in df.columns:
            # Agrupar UK si es necesario, mapear nombres
            df_map = df.copy()
            df_map['Pyecharts_Country'] = df_map['Name'].apply(normalize_country_name)
            map_data = df_map.groupby('Pyecharts_Country')['Web of Science Documents'].sum().reset_index()
            
            c_map = Map()
            c_map.add(
                "WoS Documents",
                [list(z) for z in zip(map_data['Pyecharts_Country'].tolist(), map_data['Web of Science Documents'].tolist())],
                maptype="world",
                is_map_symbol_show=False
            )
            max_val = float(map_data['Web of Science Documents'].max()) if len(map_data) > 0 else 100
            c_map.set_global_opts(
                title_opts=opts.TitleOpts(title="Distribución Geográfica Mundial"),
                visualmap_opts=opts.VisualMapOpts(max_=max_val, is_piecewise=False),
                tooltip_opts=opts.TooltipOpts(trigger="item", formatter="{b}: {c}")
            )
            page.add(c_map)
            added_special_charts = True

    # TREEMAP para Topics / Research Areas
    elif "topic" in filename_lower or "area" in filename_lower:
        if 'Name' in df.columns and 'Web of Science Documents' in df.columns:
            # Preparamos la jerarquía simple para Treemap
            tree_data = []
            for _, row in df.head(30).iterrows(): # Top 30 para legibilidad
                tree_data.append({
                    "name": str(row['Name']),
                    "value": int(row['Web of Science Documents'])
                })
            
            treemap = TreeMap()
            treemap.add(
                "Topics",
                tree_data,
                label_opts=opts.LabelOpts(position="inside"),
                roam="move",
            )
            treemap.set_global_opts(
                title_opts=opts.TitleOpts(title="Jerarquía de Tópicos (Top 30 por Producción)"),
                tooltip_opts=opts.TooltipOpts(trigger="item", formatter="{b}: {c} Docs")
            )
            page.add(treemap)
            added_special_charts = True

    # WORDCLOUD para Organizations / Funding Agencies
    elif "organization" in filename_lower or "agenc" in filename_lower or "institut" in filename_lower:
        if 'Name' in df.columns and 'Web of Science Documents' in df.columns:
            words = [
                (str(row['Name']), int(row['Web of Science Documents']))
                for _, row in df.head(50).iterrows() # Top 50 
            ]
            
            wordcloud = WordCloud()
            wordcloud.add("", words, word_size_range=[20, 100], shape="circle")
            wordcloud.set_global_opts(
                title_opts=opts.TitleOpts(title="Nube de Palabras: Actores Principales")
            )
            page.add(wordcloud)
            added_special_charts = True

    # 2. Generación Genérica (Boxplot, Bar, Line)
    numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
    categorical_cols = df.select_dtypes(exclude=['number']).columns.tolist()
    temporal_col = detect_temporal_column(df)
    
    if temporal_col and len(numeric_cols) > 0:
        temporal_cols_to_plot = [c for c in numeric_cols if c != temporal_col][:5]
        if temporal_cols_to_plot:
            df_temp = df.groupby(temporal_col)[temporal_cols_to_plot].mean().reset_index()
            df_temp = df_temp.sort_values(temporal_col)
            
            line = Line()
            line.add_xaxis(df_temp[temporal_col].astype(str).tolist())
            for col in temporal_cols_to_plot:
                line.add_yaxis(col, df_temp[col].tolist(), is_smooth=True)
            line.set_global_opts(
                title_opts=opts.TitleOpts(title="Evolución Temporal Promedio"),
                tooltip_opts=opts.TooltipOpts(trigger="axis"),
                xaxis_opts=opts.AxisOpts(type_="category")
            )
            page.add(line)
            
            if temporal_col in numeric_cols:
                numeric_cols.remove(temporal_col)
                
    if numeric_cols:
        cols_to_plot = [c for c in numeric_cols if c != 'Web of Science Documents' and c != 'Times Cited'][:10]
        if cols_to_plot:
            boxplot = Boxplot()
            boxplot.add_xaxis(["Distribución"])
            for col in cols_to_plot:
                y_data = [df[col].dropna().tolist()]
                boxplot.add_yaxis(col, boxplot.prepare_data(y_data))
                
            boxplot.set_global_opts(
                title_opts=opts.TitleOpts(title="Distribución de Indicadores Relativos (Boxplot)"),
                tooltip_opts=opts.TooltipOpts(trigger="item")
            )
            page.add(boxplot)
        
    if categorical_cols:
        for col in categorical_cols[:2]:
            counts = df[col].value_counts().head(15)
            bar = Bar()
            bar.add_xaxis(counts.index.astype(str).tolist())
            bar.add_yaxis("Frecuencia", counts.values.tolist())
            bar.set_global_opts(
                title_opts=opts.TitleOpts(title=f"Top 15 Frecuencias: {col}"),
                xaxis_opts=opts.AxisOpts(axislabel_opts=opts.LabelOpts(rotate=15)),
                tooltip_opts=opts.TooltipOpts(trigger="axis")
            )
            page.add(bar)

    page.render(output_path)
    
    return {
        "visual_artifact_path": output_path,
        "agent_summary": "Se generó exitosamente el Dashboard Exploratorio." + (" Se detectaron entidades InCites y se incluyó gráfico especializado." if added_special_charts else "")
    }
