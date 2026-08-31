---
name: semantic-manifold-mle
description: "Experto en estimación de dimensión intrínseca local (MLE al percentil 95, TwoNN) mediante skdim, análisis de variedades de datos y compresión topológica UMAP."
version: "1.0.0"
tags: ["manifold-learning", "intrinsic-dimension", "skdim", "mle", "umap", "topological-data-analysis"]
---

# Protocolo: Estimación de Dimensión Intrínseca (skdim) & Análisis de Variedades Semánticas

Este skill proporciona las pautas metodológicas para evaluar la verdadera complejidad geométrica y dimensional de un espacio de datos antes o después de la proyección topológica.

## 1. Fundamento de Aprendizaje de Variedades

* **Dimensión Intrínseca (ID):** Es el número mínimo de parámetros o variables independientes necesarios para describir la estructura geométrica subyacente de un conjunto de datos multidimensional sin pérdida significativa de información.
* **Algoritmo Maximum Likelihood Estimation (MLE):** Estima la dimensión intrínseca local ajustando un proceso de Poisson a las distancias de los $k$-vecinos más cercanos (kNN). En knoMap se evalúa al percentil 95 para garantizar robustez ante ruido y outliers.
* **Algoritmo TwoNN:** Estima la ID basándose en la razón entre las distancias al primer y segundo vecino más cercano, siendo invariante a fluctuaciones locales de densidad.

---

## 2. Secuencia de Ejecución de Herramientas MCP

### Paso 1: Inspección del Módulo de Reducción Dimensional
```json
knomap_get_dim_reduction_state({})
```
*Efecto:* Verifica si existe un dataset cargado en el módulo de reducción dimensional (`PCA`, `UMAP`, `t-SNE`) y el número de dimensiones observadas.

---

### Paso 2: Estimación de la Dimensión Intrínseca Local
```json
knomap_estimate_intrinsic_dimension({
  "algorithm": "mle"
})
```
*Efecto:* Retorna el valor estimado de la dimensión intrínseca (ej. $d_{int} = 6.4$ frente a una dimensión ambiental de $D = 128$), permitiendo evaluar el grado de compresión óptimo.

---

### Paso 3: Interpretación de la Compresión Topológica
Compara la dimensión intrínseca estimada con la dimensionalidad de las proyecciones visuales (2D/3D en UMAP o mallas SOM):
* Si $d_{int} \le 3$, la proyección 2D/3D preserva casi la totalidad de la variedad semántica original.
* Si $d_{int} \gg 3$, se debe informar al usuario sobre posibles tensiones topológicas o pérdida de estructura de alta dimensión.
