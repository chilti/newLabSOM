# PROMPT DE INGENIERÍA: Plan de Migración y Arquitectura para "labsom" (C:\Users\jlja\Documents\LabSOM_Github) y PAthSOM (C:\Users\jlja\Documents\LabSOM_Github\PathSOM)

## OBJETIVO GENERAL

Actúas como el Ingeniero de Software Principal encargado de modernizar "labsom", una aplicación científica de escritorio desarrollada originalmente en C#. El objetivo es transformarla en una aplicación híbrida, multiplataforma (Windows, Linux, macOS), desacoplada y de alto rendimiento, manteniendo su naturaleza de escritorio.

Ya tienes acceso al código base antiguo y a la documentación inicial de sus componentes. A continuación, se detallan las directivas globales de arquitectura que guiarán todo el proceso de desarrollo y migración.

---

## 1. ARQUITECTURA DE COMUNICACIÓN LOCAL (DESACOPLADA)

La interfaz visual y el motor de procesamiento deben estar completamente separados. La aplicación coexistirá localmente en la máquina del usuario bajo el siguiente flujo:

* **Backend Core (C# con .NET 8/.NET 9):** Actuará como el "director de orquesta" y un servidor de microservicios local. Al arrancar la aplicación, levantará de forma segura una API web interna (*Minimal APIs*) en un puerto aleatorio de `localhost` (ej. `http://localhost:5123`). Manejará la concurrencia, la lógica de negocio pesada, el acceso al sistema de archivos y la coordinación de subprocesos.
* **Frontend (JS/TS + Framework SPA):** La interfaz de usuario se construirá con tecnologías web modernas utilizando TypeScript y un framework como React o Vue.js (empaquetado con Vite). No generará UI desde C#. Toda la interactividad visual y las visualizaciones de datos complejas (como mapas o redes) se renderizarán en el navegador y consumirán los endpoints del backend de C# mediante peticiones HTTP locales o WebSockets. Revisar el archivo C:\Users\jlja\Documents\newLabSOM\consideracionesComponentesGraficos.md.

---

## 2. CONTENEDOR MULTIPLATAFORMA: Photino.NET (La Ruta Ligera)

Para empaquetar y renderizar la aplicación sin penalizar el rendimiento ni el consumo de memoria RAM:

* **Uso de Photino.NET:** Se utilizará Photino como el contenedor nativo de escritorio en lugar de soluciones pesadas como Electron.
* **Mecanismo:** El backend en C# configurará Photino para que cargue los archivos estáticos generados por el frontend web (HTML/JS/CSS). Photino invocará automáticamente el motor de renderizado web nativo que ya está instalado en el sistema operativo del usuario (WebView2 en Windows, WebKit en macOS y WebKitGTK en Linux).
* **Resultado esperado:** Un ejecutable multiplataforma nativo, ligero (instalador base pequeño) y de bajo consumo de memoria.

---

## 3. MOTOR DEL BACKEND: Estrategia de Cómputo Híbrido (C#, C++ y Python)

El backend debe ser capaz de integrar algoritmos avanzados de Ciencia de Datos y reducción de dimensionalidad (como UMAP y Mapas Autoorganizados) combinando lenguajes especializados. Para garantizar una velocidad brutal en la reducción de datos sin perder compatibilidad multiplataforma, implementarás un **Mecanismo de Caída (Fallback) de Tres Niveles** controlado dinámicamente por C#:

### Nivel 1: Aceleración Máxima por GPU NVIDIA (Windows / Linux)

* **Condición:** Si el Backend Core (C#) detecta hardware NVIDIA con soporte CUDA en el sistema.
* **Acción:** Levanta un subproceso local de Python que ejecute la suite de **GPU Accelerated Data Science (RAPIDS / cuML)**.
* **Objetivo:** Conseguir el máximo rendimiento posible (paralelización masiva) para procesos pesados de UMAP o clustering. En Windows, si es necesario, se coordinará mediante el entorno local o WSL si se requiere compatibilidad estricta de Linux.

### Nivel 2: Aceleración Multiplataforma por Hardware Abierto (macOS M1/M2/M3 o GPUs AMD)

* **Condición:** Si no hay hardware NVIDIA, pero el sistema tiene un procesador Apple Silicon (M*) o una tarjeta gráfica AMD/Intel compatible.
* **Acción:** C# redirigirá el flujo hacia una implementación basada en **UMAP Paramétrico** optimizada sobre **PyTorch** o mediante modelos ejecutados en **ONNX Runtime** (`Microsoft.ML.OnnxRuntime`).
* **Mecanismo de aceleración:** Se utilizará el backend de **MPS (Metal Performance Shaders)** en macOS o **DirectML/Vulkan** en Windows/Linux para aprovechar los núcleos gráficos unificados y los motores neuronales disponibles, evitando la dependencia exclusiva de CUDA.

### Nivel 3: Compatibilidad Garantizada por CPU (Fallback Universal)

* **Condición:** Si el usuario corre la app en hardware antiguo, entornos virtualizados restrictivos o máquinas sin GPU dedicada compatible.
* **Acción:** El sistema caerá de forma segura al cómputo tradicional en CPU utilizando la librería estándar de Python (`umap-learn` / `scikit-learn`).
* **Experiencia de Usuario (UX):** La interfaz web de la aplicación debe notificar de forma limpia al usuario que el procesamiento se realizará por CPU y que los tiempos de cálculo se incrementarán significativamente.

---

## INSTRUCCIONES PARA EL AGENTE DE IA (PRÓXIMOS PASOS)

1. Analiza los módulos del código antiguo de "labsom" que realizan cálculos matemáticos (especialmente el algoritmo SOM actual).
2. Diseña la estructura de carpetas que permita separar el frontend de TypeScript, el backend de C# y los scripts del motor de Python.
3. Propón la estructura básica de la Minimal API en C# que iniciará el servidor `localhost` y configurará la ventana de Photino.NET.
4. Genera una propuesta para el módulo detector de hardware en C# que determine qué nivel de Fallback (Nivel 1, 2 o 3) debe activarse al inicializar la aplicación.

Comienza presentándome la estructura de carpetas propuesta para este nuevo enfoque arquitectónico.
