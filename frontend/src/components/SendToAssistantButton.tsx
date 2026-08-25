import React, { useState } from 'react';
import html2canvas from 'html2canvas';
import { useAiStore, type ChartSnapshot } from '../store/aiStore';
import { useSomStore } from '../store/somStore';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { getSerializedSvg, convertSvgStringToPngDataUrl } from '../utils/chartExport';

interface SendToAssistantButtonProps {
  title: string;
  badge?: string;
  viewSource: 'som' | 'incites' | 'networks' | 'semantic' | 'dimreduction' | 'custom';
  chartType: 'hex_map' | 'bubble' | 'trend' | 'bar' | 'radar' | 'scatter' | 'network' | 'table' | 'custom';
  data: any;
  config?: any;
  dataContextPrompt: string;
  initialPrompt?: string;
  targetRef?: React.RefObject<HTMLElement | null>;
  targetElementId?: string;
  className?: string;
  variant?: 'compact' | 'standard' | 'pill' | 'header';
  buttonText?: string;
  onBeforeSend?: () => void;
}

export const SendToAssistantButton: React.FC<SendToAssistantButtonProps> = ({
  title,
  badge,
  viewSource,
  chartType,
  data,
  config,
  dataContextPrompt,
  initialPrompt,
  targetRef,
  targetElementId,
  className = '',
  variant = 'compact',
  buttonText = 'AI Assistant'
}) => {
  const { addReportEntry } = useAiStore();
  const { setActiveTab } = useSomStore();
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSend = async (e: React.MouseEvent) => {
    e.stopPropagation();

    setIsCapturing(true);
    let thumbnailPng: string | null = null;
    let svgMarkup: string | null = null;

    // 1. Locate container element
    let container: HTMLElement | null = null;
    if (targetRef && targetRef.current) {
      container = targetRef.current;
    } else if (targetElementId) {
      container = document.getElementById(targetElementId);
    } else {
      container = (e.currentTarget.closest('[id^="comp-viewport"], [id^="comp-grid"], .chart-container, .relative, .border') as HTMLElement);
    }

    // 2. Extract serialized SVG with inlined styles and calculated dimensions
    if (container) {
      const serialized = getSerializedSvg(container, '#ffffff');
      if (serialized) {
        svgMarkup = serialized.svgString;
        try {
          thumbnailPng = await convertSvgStringToPngDataUrl(
            serialized.svgString, 
            serialized.width, 
            serialized.height, 
            2, 
            '#ffffff'
          );
        } catch (err) {
          console.warn('Fast SVG to PNG rasterization failed:', err);
        }
      }

      // 3. Fallback only when no SVG is found or rasterization failed
      if (!thumbnailPng && container) {
        try {
          const canvas = await html2canvas(container, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true
          });
          thumbnailPng = canvas.toDataURL('image/png', 1.0);
        } catch (err) {
          console.warn('Could not capture DOM snapshot with html2canvas:', err);
        }
      }
    }

    const snapshot: ChartSnapshot = {
      viewSource,
      chartType,
      title,
      data,
      config,
      thumbnailPng,
      svgMarkup
    };

    try {
      await addReportEntry({
        title,
        badge: badge || viewSource.toUpperCase(),
        snapshot,
        dataContextPrompt,
        initialUserPrompt: initialPrompt,
        autoAnalyze: true
      });

      setIsSuccess(true);
      // Instantly switch tab to Assistant
      (setActiveTab as any)('asistente');
      setTimeout(() => {
        setIsSuccess(false);
      }, 300);
    } catch (err) {
      console.error('Failed to add to AI report:', err);
    } finally {
      setIsCapturing(false);
    }
  };

  if (variant === 'pill') {
    return (
      <button
        onClick={handleSend}
        disabled={isCapturing}
        title="Send chart and structured data to AI Assistant for scientific analysis"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 hover:border-indigo-400 transition-all shadow-sm shadow-indigo-950/50 disabled:opacity-50 ${className}`}
      >
        {isCapturing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        ) : isSuccess ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span>{isCapturing ? 'Capturing...' : isSuccess ? 'Sent!' : buttonText}</span>
      </button>
    );
  }

  if (variant === 'header') {
    return (
      <button
        onClick={handleSend}
        disabled={isCapturing}
        title="Send full visualization to AI Assistant"
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-950/50 border border-indigo-400/30 transition-all active:scale-95 disabled:opacity-50 ${className}`}
      >
        {isCapturing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
        ) : isSuccess ? (
          <Check className="w-3.5 h-3.5 text-emerald-300" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
        )}
        <span>{isCapturing ? 'Processing...' : isSuccess ? 'Sent!' : buttonText}</span>
      </button>
    );
  }

  // Compact variant (default)
  return (
    <button
      onClick={handleSend}
      disabled={isCapturing}
      title="Send this chart to AI Assistant"
      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-800/80 hover:bg-indigo-950/80 text-gray-300 hover:text-indigo-200 border border-gray-700/80 hover:border-indigo-500/50 transition-all shadow-sm disabled:opacity-50 ${className}`}
    >
      {isCapturing ? (
        <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
      ) : isSuccess ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Sparkles className="w-3 h-3 text-indigo-400" />
      )}
      <span>{isCapturing ? '...' : isSuccess ? 'Sent' : buttonText}</span>
    </button>
  );
};
