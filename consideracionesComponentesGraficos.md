Analizando a fondo la especificación técnica de `ComponentesGraficosWPF` para  **labsom** , la arquitectura que necesitas migrar requiere un manejo geométrico muy preciso (la malla hexagonal *flat-topped* con desfase en filas impares), cálculo topológico de vecindades para fronteras de clustering, dinámica interactiva de arrastre de etiquetas, e interpolación de trayectorias complejas (*splines* para el PATH).

Para el frontend desacoplado (JS/TS), la mejor estrategia es  **no sobrecargar la aplicación con frameworks web de componentes pesados** , sino elegir librerías ligeras, matemáticas y modulares que hagan una sola cosa de forma brillante.

Aquí tienes la selección de bibliotecas óptimas para el Frontend de `labsom`, organizadas por funcionalidad:

## 1. El Núcleo de Renderizado y Geometría (Malla Hexagonal)

La especificación critica con mucha razón el defecto del código original en WPF, donde redimensionar la pantalla obligaba a recalcular y reconstruir miles de objetos en memoria. La solución propuesta de usar **SVG con `viewBox`** es la correcta, ya que delega el escalado a la GPU del navegador sin tocar el DOM.

### D3-Shape (Parte de D3.js)

En lugar de instalar toda la suite masiva de D3, puedes instalar únicamente el módulo  **`d3-shape`** .

* **Para qué sirve:** Es perfecto para la  **Hoja de Ruta de Trayectorias (PATH)** . Olvídate de programar a mano las complejas ecuaciones de la interpolación paramétrica de  *Cubic Splines* . Le pasas las coordenadas **$(x_c, y_c)$** de los centros de tus hexágonos a `d3.line().curve(d3.curveMonotoneX)` y te devolverá instantáneamente el string geométrico (el atributo `d`) listo para un elemento `<path>` de SVG.
* **Peso:** < 5 KB.

### Honeycomb (Opcional, para álgebra de hexágonos)

Si quieres ahorrarle al agente la programación manual de la topología de vecinos (que el documento señala que estaba duplicada y comentada en el código viejo), **Honeycomb** es la librería estándar en JS para esto.

* **Para qué sirve:** Define orientaciones de hexágonos ( *flat-topped* ), calcula vértices, y resuelve la obtención de vecinos considerando automáticamente si la fila `i` es par o impar.
* **Peso:** Muy ligera y no tiene dependencias visuales (genera pura matemática).

## 2. Interactividad y Dinámica de Etiquetas (Drag & Drop)

El documento exige que el usuario pueda arrastrar una etiqueta de una neurona origen a una destino, recalculando su posición basada en el vértice **$P_5$** y actualizando el estado.

### React-Draggable / @hello-pangea/dnd

Si estás usando React para estructurar la SPA, la interacción nativa de Drag & Drop de HTML5 puede ser verbosa y tosca.

* **React-Draggable:** Te permite envolver tus elementos de texto (`<text>` en SVG o `<div>` absolutos) y darles capacidades de arrastre fluido de forma inmediata. Al soltar la etiqueta, te devuelve las coordenadas en píxeles de la pantalla, las cuales puedes mapear usando una función matemática inversa para saber sobre qué centro de hexágono se soltó el elemento.

## 3. Gestión del Estado (El State Manager)

La especificación hace hincapié en un defecto crítico: el acoplamiento extremo de la UI con la lógica (cadenas mágicas en la propiedad `.Tag` de WPF). Se requiere un flujo reactivo unidireccional estricto.

### Zustand

Olvídate de Redux (es demasiado pesado y requiere mucho código repetitivo para una aplicación de escritorio). **Zustand** es la librería de estado más moderna, rápida y ligera en el mundo JS/TS.

* **Para qué sirve:** Creará el *Store* central de `labsom` (ej. `useSomStore`). Guardará la matriz de datos puros provenientes de C# (pesos, distancias, clustering, etiquetas mapeadas).
* **Ventaja:** Cuando ocurra un evento como un arrastre de etiqueta o un click en una celda, la UI solo disparará una acción matemática al *Store* (ej. `moveLabel(from, to)`). Zustand actualizará el estado de forma limpia y React redibujará únicamente los componentes afectados.
* **Peso:** ~1 KB.

## 4. Visualización de Datos Avanzada (Librerías Cromáticas y Gráficos)

Para corregir el formateo frágil de números y las fórmulas cromáticas hardcodeadas basadas en matrices estáticas gigantescas, necesitas herramientas de color profesionales.

### Chroma.js (o d3-color / d3-scale)

Sustituye por completo las transiciones hechas a mano (Verde **$\rightarrow$** Amarillo **$\rightarrow$** Rojo) y las tablas fijas de 489 colores.

* **Para qué sirve:** Te permite generar escalas continuas o discretas (como el modo logarítmico para la U-Matrix o modos centrados en referencias) con una sola línea de código:
  **TypeScript**

  ```
  // Genera la escala exacta Verde-Amarillo-Rojo para el mapa de componentes
  const colorScale = chroma.scale(['green', 'yellow', 'red']).domain([min, max]);
  const hexColor = colorScale(valorActual).hex();
  ```
* Asegura el uso de espacios de color corregidos perceptualmente (como LAB o HSL en lugar de RGB simple) para evitar que los mapas se vean opacos o mal balanceados.

## Resumen del Stack Técnico Sugerido para el Agente

Para que le indiques al agente de IA qué colocar en el archivo `package.json` del Frontend de `labsom`:

| **Capa Funcional**           | **Biblioteca Recomendada**    | **Atributos Clave**                                              |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| **Framework Base**           | **React + TypeScript + Vite** | Estricto tipado de datos para acoplar con C#, empaquetado ultra veloz. |
| **Cálculo de Curvas**       | **`d3-shape`**              | Resuelve el trazado de splines del PATH sin añadir peso innecesario.  |
| **Manipulación Cromática** | **`chroma-js`**             | Manejo dinámico de mapas (U-Matrix, Componentes, Escalas de grises).  |
| **Manejo de Estado**         | **`zustand`**               | Desacopla la lógica científica de la UI visual.                      |
| **Interactividad**           | **`react-draggable`**       | Implementación ágil y fluida del arrastre de etiquetas.              |

Con este conjunto de librerías, el agente podrá construir un clon exacto (y muy superior en rendimiento) de `ComponentesGraficosWPF` aprovechando el contenedor ultraligero de  **Photino.NET** .
