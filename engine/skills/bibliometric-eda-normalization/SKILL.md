---
name: bibliometric-eda-normalization
description: Experto en Análisis Exploratorio de Datos Bibliométricos (EDA) y flujos de Normalización interactiva de Entidades a través de tesauros (Thesaurus).
---

# Bibliometric EDA & Entity Normalization Expert

Este skill está diseñado para el análisis exploratorio descriptivo de datos bibliométricos (EDA) y la normalización de entidades (limpieza de términos, autores, instituciones) dentro del ecosistema KnoMap.

## 1. Análisis Exploratorio de Datos Bibliométricos (EDA)

KnoMap cuenta con un motor nativo en Python (`engine/biblio_eda_engine.py`) diseñado para extraer métricas cienciométricas avanzadas **sin depender de paquetes de terceros complejos (como pybibx)**.

### Capacidades del Motor EDA (`BiblioEDAEngine`):
- **Cálculo de Índices (H, G, M):** Extrae métricas de impacto de autores usando las citas de los documentos originales (basado en la columna `TC` o `Cited by`).
- **Análisis de Supervivencia / Crecimiento Longitudinal:** Mapea cómo crecen anualmente los términos clave.
- **Topologías (WordCloud y Sankey):** Transforma la red extraída en diccionarios compatibles con herramientas de visualización de React (`recharts`).

### Flujo de Ejecución (EDA):
1. Durante la ingesta de archivos (ej. Scopus, WoS) en `engine/bibliometrics_parser.py`, después de generar la matriz de co-ocurrencia y los nodos, se instancia el `BiblioEDAEngine`.
2. El motor de EDA devuelve un diccionario `eda_data`.
3. El payload JSON de respuesta empaqueta estos datos en `eda_report`, `sankey_data` y `term_growth`.
4. El Frontend (React) almacena estas métricas en `somStore.ts` de forma global para su persistencia.
5. El componente de UI (`BiblioEdaReport.tsx`) usa `Recharts` para montar dinámicamente un dashboard sin interrupciones.

## 2. Normalización Interactiva de Entidades (Thesaurus Mapping)

La limpieza de entidades duplicadas o variantes ortográficas se realiza mediante una tubería de normalización basada en Tesauros (Thesaurus).

### Flujo de Normalización (Merge de Nodos):
1. **Frontend (UI Interactiva):** En lugar de forzar al usuario a editar archivos localmente, KnoMap expone el modal interactivo `EntityMergerModal.tsx`. Aquí el usuario visualiza los nodos actuales, selecciona variantes y asigna un nodo "Canónico".
2. **Generación al Vuelo (Virtual CSV):** Al aplicar la fusión, React crea un archivo `.csv` virtual en memoria con formato `label,replace by`. Si ya existía un archivo de tesauro (subido por el usuario), lo concatena.
3. **Backend en C# (`PreprocessService.cs`):** Este servicio recibe el archivo mediante `IFormFile` etiquetado como `thesaurusFile`, lo almacena temporalmente en disco y se lo inyecta a Python en su payload (`thesaurus_filepath`).
4. **Backend Python (`VosThesaurus`):** En `engine/vos_thesaurus.py` y `engine/bibliometrics_parser.py`, justo antes de generar la red, las cadenas de texto crudas pasan por el tesauro, mapeando las variantes al término maestro y reduciendo el ruido espectral.

## 3. Persistencia de Estado y Contexto
Para garantizar una experiencia continua, todos los artefactos generados (red, thesaurus, reporte EDA) se persisten en:
- Memoria viva: Mediante el store global `zustand` en `frontend/src/store/somStore.ts`.
- Serialización local: Cuando se invoca `exportProject()` o `getProjectPayload()`, los objetos (`edaReport`, `sankeyData`, `termGrowth`) se guardan al archivo nativo del proyecto `.knoMap`.

## Reglas de Implementación
- **Rendimiento:** El EDA debe mantener tiempos de cálculo O(N log N) para que sea en tiempo real. No integrar librerías que requieran instalaciones C++ (ej. evitar dependencias pesadas si pandas/numpy lo puede hacer).
- **Desacoplamiento:** Mantener separada la capa de cálculo matemático en Python y la capa de visualización interactiva en React (no renderizar HTML/gráficos desde Python hacia la interfaz).
- **Inmutabilidad del Corpus:** El Tesauro no modifica el set de datos original `sharedBibFile`, solo normaliza las proyecciones resultantes.
