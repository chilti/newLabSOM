---
name: bibliometrics-som-flow
description: "Experto en ingesta y estructuración de corpus bibliográficos (WoS, Scopus, PubMed, CSV/RIS), extracción de redes de co-ocurrencia de términos/palabras clave y mapeo topológico SOM."
version: "1.0.0"
tags: ["bibliometrics", "co-occurrence", "som", "text-mining", "research-fronts", "wos", "scopus"]
---

# Protocolo: Corpus Bibliográfico $\to$ Red de Co-ocurrencia $\to$ Mapa Autoorganizado (SOM)

Este skill define el flujo de trabajo metodológico para transformar un corpus de publicaciones científicas en una matriz de co-ocurrencia conceptual y un mapa neuronal autoorganizado.

## 1. Fundamento Bibliométrico

* **Co-ocurrencia de Palabras Clave (Author Keywords / Keywords Plus):** Mide la proximidad semántica y conceptual entre términos cuando aparecen conjuntamente en los mismos registros bibliográficos.
* **Redes de Acoplamiento y Frentes de Investigación:** Identifica clusters temáticos emergentes mediante la topología no lineal de la red de términos.

---

## 2. Secuencia de Ejecución de Herramientas MCP

### Paso 1: Ingesta y Extracción de la Red de Co-ocurrencia
Procesa el archivo bibliográfico cargado en el sistema o proporcionado por el usuario:
```json
knomap_parse_file({
  "file_path": "/path/to/dataset.csv",
  "max_terms": 50,
  "min_cooccurrence": 2
})
```
O si el dataset ya está cargado en el cliente:
```json
knomap_get_bibliometrics_state({})
```
*Efecto:* Extrae la matriz de co-ocurrencia término $\times$ término ($N \times N$), calcula las frecuencias marginales y registra las etiquetas de los términos en la sesión activa (`_ACTIVE_SESSION["last_matrix"]` y `_ACTIVE_SESSION["last_labels"]`).

---

### Paso 2: Estimación de Tamaño de Malla SVD
```json
knomap_suggest_som_size({})
```

---

### Paso 3: Entrenamiento Neuronal SOM y Proyección UMAP
```json
knomap_train_som({
  "rows": 10,
  "cols": 10,
  "iterations": 100,
  "method": "batch",
  "clustering_algorithm": "dbscan",
  "run_umap": true
})
```
*Efecto:* Organiza los conceptos en un espacio bidimensional preservando las relaciones no lineales de co-ocurrencia.

---

### Paso 4: Renderizado del Artefacto Interactivo
```json
knomap_render_visual_artifact({
  "title": "Mapa de Estructura Conceptual Bibliométrica"
})
```

---

## 3. Estructura del Informe Analítico

1. **Estadísticas del Corpus:** Total de documentos procesados, términos únicos y densidad de la red de co-ocurrencia.
2. **Núcleos Temáticos:** Identificación de los frentes de investigación principales según los clusters de neuronas SOM.
3. **Términos Puente e Interdisciplinariedad:** Detección de conceptos ubicados en fronteras de neuronas intermedias.
