---
name: project-hub-manager
description: "Experto en persistencia relacional SQLite (knomap_hub.db), gestión del manifiesto de proyectos .knomap y exportación de reportes analíticos consolidados."
version: "1.0.0"
tags: ["sqlite", "project-management", "persistence", "manifest", "workspace", "export"]
---

# Protocolo: Gestión de Proyectos, Persistencia Relacional & Manifiesto Activo

Este skill define cómo el agente interactúa con el almacén local de proyectos de knoMap para consultar, recuperar, clonar o persistir sesiones completas de investigación.

## 1. Estructura de Almacenamiento en knoMap

knoMap utiliza un modelo de persistencia dual:
1. **Base de Datos SQLite (`engine/knomap_hub.db`):** Registro relacional indexado con UUIDs de proyecto, metadatos, resúmenes estadísticos, configuración de hiperparámetros y reportes en Markdown.
2. **Archivos de Proyecto (`.knomap`):** Paquetes JSON/ZIP serializados que contienen matrices completas, pesos neuronales, proyecciones UMAP y estructuras de red.

---

## 2. Secuencia de Ejecución de Herramientas MCP

### Paso 1: Inspeccionar el Manifiesto del Proyecto Activo
Para conocer el estado actual de los módulos antes de ejecutar cualquier acción destructiva o de análisis:
```json
knomap_get_active_project_manifest({})
```

---

### Paso 2: Listar Proyectos Disponibles en el Repositorio Local
```json
knomap_list_projects({
  "limit": 20
})
```
*Efecto:* Retorna la lista de proyectos con sus nombres, fechas de creación, tamaño del dataset y estado de entrenamiento.

---

### Paso 3: Recuperar o Cargar un Proyecto Existente
```json
knomap_get_project({
  "project_id_or_path": "uuid-del-proyecto"
})
```

---

### Paso 4: Persistir la Sesión Actual y el Reporte Analítico
Cuando el usuario solicite guardar los resultados o al finalizar un pipeline completo:
```json
knomap_save_project({
  "name": "Estudio Bibliométrico y SOM - IA en Salud 2026",
  "report_markdown": "# Informe Final...",
  "save_to_sqlite": true
})
```
*Efecto:* Registra el proyecto en SQLite y emite el identificador único `project_id`.
