/**
 * chartExport.ts - High-Fidelity SVG & PNG Chart Exporter
 * Inlines computed styles, handles Recharts ResponsiveContainers & D3 SVGs,
 * and provides pixel-perfect PNG rendering with fallback.
 */
import html2canvas from 'html2canvas';

const SVG_SHAPE_PROPERTIES = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
    'opacity', 'visibility', 'display'
];

const SVG_TEXT_PROPERTIES = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing',
    'text-anchor', 'dominant-baseline', 'alignment-baseline',
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'color', 'opacity', 'visibility', 'display'
];

/**
 * Traverses source and cloned SVG in lockstep to inline all computed styles.
 */
function inlineComputedStyles(sourceSvg: SVGElement, targetSvg: SVGElement, bgColor: string = '#ffffff') {
    const isLightBg = bgColor === '#ffffff' || bgColor === 'white' || bgColor.toLowerCase().startsWith('#f') || bgColor.toLowerCase().startsWith('#e');
    const sourceElements = [sourceSvg, ...Array.from(sourceSvg.querySelectorAll('*'))];
    const targetElements = [targetSvg, ...Array.from(targetSvg.querySelectorAll('*'))];

    const len = Math.min(sourceElements.length, targetElements.length);
    for (let i = 0; i < len; i++) {
        const src = sourceElements[i] as HTMLElement | SVGElement;
        const tgt = targetElements[i] as HTMLElement | SVGElement;
        if (!src || !tgt) continue;

        const tagName = (src.tagName || '').toLowerCase();

        // Never set direct fill/stroke on root SVG or <defs>/<clipPath> to prevent cascade corruption
        if (i === 0 || tagName === 'svg' || tagName === 'defs' || tagName === 'clippath') {
            tgt.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';
            continue;
        }

        try {
            const computed = window.getComputedStyle(src);

            // For <g> grouping containers, do not force computed fill/stroke to avoid breaking child inheritance
            if (tagName === 'g') {
                const opacity = computed.opacity;
                if (opacity && opacity !== '1') {
                    tgt.style.opacity = opacity;
                }
                const display = computed.display;
                if (display === 'none') {
                    tgt.style.display = 'none';
                }
                continue;
            }

            // Handle text and tspans specifically to ensure high-contrast readability
            if (tagName === 'text' || tagName === 'tspan') {
                for (const prop of SVG_TEXT_PROPERTIES) {
                    const val = computed.getPropertyValue(prop);
                    if (val && val !== 'initial' && val !== 'inherit') {
                        tgt.style.setProperty(prop, val);
                    }
                }

                const fill = computed.fill;
                const color = computed.color;
                
                if (isLightBg) {
                    // On light background, if text is transparent, light, or unspecified, make it dark slate
                    if (!fill || fill === 'none' || fill === 'rgba(0, 0, 0, 0)' || fill === 'rgb(255, 255, 255)' || fill.includes('203, 213, 225') || fill.includes('148, 163, 184')) {
                        const resolved = (color && color !== 'rgb(255, 255, 255)' && color !== 'rgba(0, 0, 0, 0)' && !color.includes('203, 213, 225')) ? color : '#1e293b';
                        tgt.setAttribute('fill', resolved);
                        tgt.style.fill = resolved;
                    } else {
                        tgt.setAttribute('fill', fill);
                        tgt.style.fill = fill;
                    }
                } else {
                    if (!fill || fill === 'none' || fill === 'rgba(0, 0, 0, 0)' || fill === 'rgb(0, 0, 0)') {
                        const resolved = (color && color !== 'rgb(0, 0, 0)' && color !== 'rgba(0, 0, 0, 0)') ? color : '#cbd5e1';
                        tgt.setAttribute('fill', resolved);
                        tgt.style.fill = resolved;
                    } else {
                        tgt.setAttribute('fill', fill);
                        tgt.style.fill = fill;
                    }
                }
                tgt.style.fontFamily = computed.fontFamily || 'Inter, system-ui, -apple-system, sans-serif';
                continue;
            }

            // Handle graphic shapes: path, rect, circle, polygon, polyline, line
            for (const prop of SVG_SHAPE_PROPERTIES) {
                const val = computed.getPropertyValue(prop);
                if (val && val !== 'initial' && val !== 'inherit') {
                    tgt.style.setProperty(prop, val);
                }
            }

            // Ensure grid lines and axis ticks have proper stroke
            if (tagName === 'line' || tagName === 'path') {
                const stroke = computed.stroke;
                if (stroke && stroke !== 'none') {
                    tgt.setAttribute('stroke', stroke);
                    tgt.style.stroke = stroke;
                }
            }

            // Ensure polygons (radar, SOM cells) preserve fill & opacity
            if (tagName === 'polygon') {
                const fill = computed.fill;
                const fillOpacity = computed.fillOpacity || computed.getPropertyValue('fill-opacity');
                if (fill && fill !== 'none') {
                    tgt.setAttribute('fill', fill);
                    tgt.style.fill = fill;
                }
                if (fillOpacity) {
                    tgt.setAttribute('fill-opacity', fillOpacity);
                    tgt.style.fillOpacity = fillOpacity;
                }
            }
        } catch {
            // Ignore detached or uncomputable elements
        }
    }
}

/**
 * Accurately finds the primary chart SVG element inside a container,
 * ignoring tiny legend icons, buttons, toolbars, and Lucide icons.
 */
export function findMainChartSvg(container: HTMLElement): SVGElement | null {
    // 1. Check for explicit main Recharts surface as direct child of .recharts-wrapper
    const rechartsDirect = container.querySelector('.recharts-wrapper > svg.recharts-surface') as SVGElement | null;
    if (rechartsDirect) return rechartsDirect;

    // 2. Check for SOM hex map SVG or Sunburst
    const specialSvg = container.querySelector('svg.map-hexagonal-svg, #sunburst-chart-container svg, svg[id*="som"], svg[id*="hex"]') as SVGElement | null;
    if (specialSvg) return specialSvg;

    // 3. Filter all SVGs inside container
    const allSvgs = Array.from(container.querySelectorAll('svg')) as SVGElement[];
    const candidates = allSvgs.filter(svg => {
        // Exclude buttons and controls
        if (svg.closest('button')) return false;
        // Exclude legend containers and legend item icons
        if (svg.closest('.recharts-legend-wrapper, .recharts-default-legend, .recharts-legend-item, .legend-item')) return false;
        
        const cls = (svg.getAttribute('class') || '') + ' ' + (svg.className?.baseVal || '');
        if (cls.includes('lucide') || cls.includes('recharts-legend-icon')) return false;

        const attrW = parseFloat(svg.getAttribute('width') || '0');
        const attrH = parseFloat(svg.getAttribute('height') || '0');
        if ((attrW > 0 && attrW <= 40) || (attrH > 0 && attrH <= 40)) {
            return false;
        }

        const bbox = svg.getBoundingClientRect();
        if ((bbox.width > 0 && bbox.width <= 40) || (bbox.height > 0 && bbox.height <= 40)) {
            return false;
        }

        return true;
    });

    if (candidates.length > 0) {
        // Pick the largest candidate SVG by area
        candidates.sort((a, b) => {
            const aW = parseFloat(a.getAttribute('width') || '0') || a.getBoundingClientRect().width || 0;
            const aH = parseFloat(a.getAttribute('height') || '0') || a.getBoundingClientRect().height || 0;
            const bW = parseFloat(b.getAttribute('width') || '0') || b.getBoundingClientRect().width || 0;
            const bH = parseFloat(b.getAttribute('height') || '0') || b.getBoundingClientRect().height || 0;
            return (bW * bH) - (aW * aH);
        });
        return candidates[0];
    }

    // 4. Fallback: Any SVG not inside a button or legend
    return allSvgs.find(s => !s.closest('button') && !s.closest('.recharts-legend-wrapper')) || null;
}

/**
 * Prepares and serializes an SVG from a DOM container into a standalone XML string.
 */
export function getSerializedSvg(containerIdOrElement: string | HTMLElement, bgColor: string = '#ffffff'): {
    svgString: string;
    width: number;
    height: number;
} | null {
    const container = typeof containerIdOrElement === 'string'
        ? document.getElementById(containerIdOrElement)
        : containerIdOrElement;

    if (!container) return null;

    const svgElement = findMainChartSvg(container);
    if (!svgElement) return null;

    const bbox = svgElement.getBoundingClientRect();
    const attrW = parseFloat(svgElement.getAttribute('width') || '0');
    const attrH = parseFloat(svgElement.getAttribute('height') || '0');
    
    // Check viewBox attribute if present
    const viewBoxAttr = svgElement.getAttribute('viewBox');
    let viewBoxWidth = 0;
    let viewBoxHeight = 0;
    if (viewBoxAttr) {
        const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && !isNaN(parts[2]) && !isNaN(parts[3]) && parts[2] > 0 && parts[3] > 0) {
            viewBoxWidth = parts[2];
            viewBoxHeight = parts[3];
        }
    }

    const scrollW = (svgElement as any).scrollWidth || (svgElement as any).clientWidth || container.scrollWidth;
    const scrollH = (svgElement as any).scrollHeight || (svgElement as any).clientHeight || container.scrollHeight;

    // Determine the true rendered dimensions (accounting for vertical scroll lists like Quartiles)
    const width = Math.max(Math.round(attrW || viewBoxWidth || scrollW || bbox.width || container.clientWidth || 800), 300);
    const height = Math.max(Math.round(attrH || viewBoxHeight || scrollH || bbox.height || container.clientHeight || 500), 200);

    const clonedSvg = svgElement.cloneNode(true) as SVGElement;
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clonedSvg.setAttribute('width', String(width));
    clonedSvg.setAttribute('height', String(height));
    clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    clonedSvg.style.backgroundColor = bgColor;
    clonedSvg.style.borderRadius = '12px';
    clonedSvg.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';

    // Inline CSS styles
    inlineComputedStyles(svgElement as SVGElement, clonedSvg, bgColor);

    // Insert background rectangle with explicit non-inheriting style
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', bgColor);
    bgRect.style.setProperty('fill', bgColor, 'important');
    bgRect.setAttribute('rx', '8');
    clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);

    return { svgString, width, height };
}

/**
 * Converts serialized SVG XML string into high-resolution PNG Data URL via HTML5 Canvas and Blob.
 */
export const convertSvgStringToPngDataUrl = (
    svgString: string, 
    width: number, 
    height: number, 
    scale: number = 2, 
    bgColor: string = '#ffffff'
): Promise<string | null> => {
    return new Promise((resolve) => {
        try {
            const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(width * scale, 300);
                    canvas.height = Math.max(height * scale, 200);
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const pngUrl = canvas.toDataURL('image/png', 1.0);
                        URL.revokeObjectURL(url);
                        resolve(pngUrl);
                        return;
                    }
                } catch (e) {
                    console.warn('[convertSvgStringToPngDataUrl] Canvas error:', e);
                }
                URL.revokeObjectURL(url);
                resolve(null);
            };

            img.onerror = (e) => {
                console.warn('[convertSvgStringToPngDataUrl] Image load error:', e);
                URL.revokeObjectURL(url);
                resolve(null);
            };

            img.src = url;
        } catch (err) {
            console.warn('[convertSvgStringToPngDataUrl] Exception:', err);
            resolve(null);
        }
    });
};

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
export const exportChartAsSVG = (containerId: string, filename: string, bgColor: string = '#ffffff') => {
    const serialized = getSerializedSvg(containerId, bgColor);
    if (!serialized) {
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
 * Robust fallback using html2canvas.
 */
async function fallbackHtml2Canvas(container: HTMLElement, filename: string, scale: number = 2, bgColor: string = '#ffffff') {
    try {
        const canvas = await html2canvas(container, {
            backgroundColor: bgColor,
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

/**
 * Exports chart as high-resolution PNG file with rasterization and html2canvas fallback.
 */
export const exportChartAsPNG = async (containerId: string, filename: string, scale: number = 2, bgColor: string = '#ffffff') => {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`[exportChartAsPNG] Container not found: ${containerId}`);
        return;
    }

    const serialized = getSerializedSvg(container, bgColor);

    if (serialized) {
        const { svgString, width, height } = serialized;
        const pngUrl = await convertSvgStringToPngDataUrl(svgString, width, height, scale, bgColor);
        if (pngUrl) {
            triggerDownload(pngUrl, `${filename}.png`);
            return;
        }
    }

    // Fallback if SVG rasterization couldn't complete
    await fallbackHtml2Canvas(container, filename, scale, bgColor);
};

