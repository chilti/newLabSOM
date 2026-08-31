---
name: incites-som-pipeline
description: "Experto en orquestación de flujos cienciométricos desde el Explorador InCites hacia mapas autoorganizados (SOM), calibración de topología neuronal y generación de artefactos visuales interactivos."
version: "1.0.0"
tags: ["incites", "som", "kohonen", "scientometrics", "umap", "interactive-maps"]
---

# Protocolo: InCites Benchmarking $\to$ Mapa Autoorganizado (SOM) $\to$ Artefacto Visual

Este skill define la metodología paso a paso para transformar datos de producción e impacto científico de Clarivate InCites en un mapa neuronal de Kohonen con clusters e interactividad visual.

## 1. Fundamento Cienciométrico

El análisis se basa en el perfil multidimensional de las entidades académicas mediante indicadores normalizados:
* **CNCI (Category Normalized Citation Impact):** Impacto citacional normalizado por área de conocimiento, año y tipo de documento (CNCI > 1.0 indica desempeño superior al promedio mundial).
* **Times Cited:** Volumen acumulado de citas recibidas.
* **Web of Science Documents:** Producción total de documentos indizados en la Colección Principal de WoS.
* **% Documents in Top 10%:** Porcentaje de producción ubicada en el percentil de excelencia mundial.
* **% International Collaboration:** Grado de internacionalización y cooperación transfronteriza.

---

## 2. Secuencia de Ejecución de Herramientas MCP

El agente debe seguir estrictamente este flujo secuencial:

### Paso 1: Extracción de Indicadores de la Entidad
Consulta la entidad requerida (`Locations`, `Organizations`, `Research Areas`, `Authors`, `Institutions`, `Funding Agencies`):
```json
knomap_query_incites_entity({
  "entity_name": "Locations",
  "top_n": 25,
  "sort_by": "wos_docs"
})
```
*Efecto:* El servidor extrae los registros cuantitativos, calcula estadísticas resumen y publica automáticamente la matriz numérica en la sesión activa (`_ACTIVE_SESSION["last_matrix"]` y `_ACTIVE_SESSION["last_labels"]`).

---

### Paso 2: Calibración de la Malla Neuronal (Opcional pero recomendado)
Calcula las dimensiones óptimas de la cuadrícula SOM basándose en la relación de valores propios SVD/PCA:
```json
knomap_suggest_som_size({})
```
*Efecto:* Retorna el tamaño recomendado (`Big` para resolución fina o `Small` para condensación de clusters).

---

### Paso 3: Entrenamiento del Mapa SOM y Reducción UMAP
Entrena la red de Kohonen con algoritmo Batch o Online, agrupamiento DBSCAN/K-Means y coordenadas UMAP:
```json
knomap_train_som({
  "rows": 10,
  "cols": 10,
  "iterations": 100,
  "method": "batch",
  "metric": "euclidean",
  "clustering_algorithm": "dbscan",
  "eps": 0.5,
  "min_samples": 3,
  "run_umap": true
})
```
*Efecto:* Calcula la matriz de distancias U-Matrix, error de cuantización, frecuencias por neurona y asignación de clusters.

---

### Paso 4: Generación del Artefacto Visual Interactivo
Genera el mapa visual HTML5/SVG embebible en el chat:
```json
knomap_render_visual_artifact({
  "title": "Mapa SOM de InCites - Locations"
})
```
*Efecto:* Crea un mapa hexagonal interactivo con tooltips, clusters coloreados y visualización de distancias topológicas.

---

## 3. Estructura del Informe Analítico Final

Tras ejecutar las herramientas, el agente redacta un reporte académico estructurado:
1. **Resumen Ejecutivo:** Entidad analizada, número de registros y fecha de extracción.
2. **Tabla de Indicadores Principales:** Muestra de las entidades líderes en producción (WoS Docs) e impacto (CNCI).
3. **Análisis de la Topología SOM:**
   - Descripción de los clusters identificados (p. ej. *Cluster de Alta Producción y Alto Impacto* vs *Cluster de Cooperación Regional*).
   - Interpretación de la U-Matrix (fronteras de alta distancia vs cuencas de similitud).
4. **Discusión y Recomendaciones Estratégicas:** Sugerencias para políticas científicas o alianzas interinstitucionales.
