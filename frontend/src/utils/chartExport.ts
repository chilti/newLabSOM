/**
 * chartExport.ts - High-Fidelity SVG & PNG Chart Exporter
 * Inlines computed styles, handles Recharts ResponsiveContainers & D3 SVGs,
 * and provides pixel-perfect PNG rendering with fallback.
 */
import html2canvas from 'html2canvas';

const SVG_STYLE_PROPERTIES = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'color', 'opacity', 'visibility', 'display'
];

/**
 * Traverses source and cloned SVG in lockstep to inline all computed styles.
 */
function inlineComputedStyles(sourceSvg: SVGElement, targetSvg: SVGElement) {
    const sourceElements = [sourceSvg, ...Array.from(sourceSvg.querySelectorAll('*'))];
    const targetElements = [targetSvg, ...Array.from(targetSvg.querySelectorAll('*'))];

    const len = Math.min(sourceElements.length, targetElements.length);
    for (let i = 0; i < len; i++) {
        const src = sourceElements[i] as HTMLElement | SVGElement;
        const tgt = targetElements[i] as HTMLElement | SVGElement;
        if (!src || !tgt) continue;

        try {
            const computed = window.getComputedStyle(src);
            for (const prop of SVG_STYLE_PROPERTIES) {
                const val = computed.getPropertyValue(prop);
                if (val && val !== 'initial' && val !== 'inherit') {
                    tgt.style.setProperty(prop, val);
                }
            }

            const tagName = src.tagName.toLowerCase();
            // Handle text and tspans specifically to prevent invisible or black text
            if (tagName === 'text' || tagName === 'tspan') {
                const fill = computed.fill;
                if (!fill || fill === 'none' || fill === 'rgba(0, 0, 0, 0)' || fill === 'rgb(0, 0, 0)') {
                    const col = computed.color;
                    const resolvedFill = (col && col !== 'rgb(0, 0, 0)' && col !== 'rgba(0, 0, 0, 0)') ? col : '#cbd5e1';
                    tgt.setAttribute('fill', resolvedFill);
                    tgt.style.fill = resolvedFill;
                } else {
                    tgt.setAttribute('fill', fill);
                    tgt.style.fill = fill;
                }
                tgt.style.fontFamily = computed.fontFamily || 'Inter, system-ui, -apple-system, sans-serif';
            }

            // Ensure grid lines and axis ticks have proper stroke
            if (tagName === 'line' || tagName === 'path') {
                const stroke = computed.stroke;
                if (stroke && stroke !== 'none') {
                    tgt.setAttribute('stroke', stroke);
                    tgt.style.stroke = stroke;
                }
            }
        } catch {
            // Ignore detached or uncomputable elements
        }
    }
}

/**
 * Prepares and serializes an SVG from a DOM container into a standalone XML string.
 */
export function getSerializedSvg(containerIdOrElement: string | HTMLElement): {
    svgString: string;
    width: number;
    height: number;
} | null {
    const container = typeof containerIdOrElement === 'string'
        ? document.getElementById(containerIdOrElement)
        : containerIdOrElement;

    if (!container) return null;

    const svgElement = container.querySelector('svg.recharts-surface') || container.querySelector('svg');
    if (!svgElement) return null;

    const bbox = svgElement.getBoundingClientRect();
    const width = Math.max(Math.round(bbox.width || container.clientWidth || 800), 300);
    const height = Math.max(Math.round(bbox.height || container.clientHeight || 500), 200);

    const clonedSvg = svgElement.cloneNode(true) as SVGElement;
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clonedSvg.setAttribute('width', String(width));
    clonedSvg.setAttribute('height', String(height));
    clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clonedSvg.style.backgroundColor = '#0f172a';
    clonedSvg.style.borderRadius = '12px';
    clonedSvg.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';

    // Inline CSS styles
    inlineComputedStyles(svgElement as SVGElement, clonedSvg);

    // Insert dark background rectangle
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', '#0f172a');
    bgRect.setAttribute('rx', '12');
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);

    return { svgString, width, height };
}

/**
 * Triggers browser download for a data URL or Blob URL.
 */
function triggerDownload(url: string, filename: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Exports chart as standalone SVG file.
 */
export const exportChartAsSVG = (containerId: string, filename: string) => {
    const serialized = getSerializedSvg(containerId);
    if (!serialized) {
        // Fallback: try html2canvas as SVG not available
        console.warn(`[exportChartAsSVG] SVG not found for container: ${containerId}`);
        return;
    }

    const { svgString } = serialized;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${filename}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Exports chart as high-resolution PNG file with rasterization and html2canvas fallback.
 */
export const exportChartAsPNG = async (containerId: string, filename: string, scale: number = 2) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const serialized = getSerializedSvg(container);

    if (serialized) {
        const { svgString, width, height } = serialized;
        const encodedData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = width * scale;
                canvas.height = height * scale;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.fillStyle = '#0f172a';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const pngUrl = canvas.toDataURL('image/png', 1.0);
                    triggerDownload(pngUrl, `${filename}.png`);
                    return;
                }
            } catch (err) {
                console.warn('[exportChartAsPNG] Canvas draw error, falling back to html2canvas:', err);
            }
            // Fallback if canvas draw fails
            fallbackHtml2Canvas(container, filename, scale);
        };

        img.onerror = () => {
            console.warn('[exportChartAsPNG] Image load failed, falling back to html2canvas');
            fallbackHtml2Canvas(container, filename, scale);
        };

        img.src = encodedData;
    } else {
        // Direct fallback for non-SVG or complex HTML containers
        await fallbackHtml2Canvas(container, filename, scale);
    }
};

/**
 * Robust fallback using html2canvas.
 */
async function fallbackHtml2Canvas(container: HTMLElement, filename: string, scale: number = 2) {
    try {
        const canvas = await html2canvas(container, {
            backgroundColor: '#0f172a',
            scale: scale,
            useCORS: true,
            logging: false,
            allowTaint: true
        });
        const pngUrl = canvas.toDataURL('image/png', 1.0);
        triggerDownload(pngUrl, `${filename}.png`);
    } catch (error) {
        console.error('[exportChartAsPNG] html2canvas export failed:', error);
    }
}
