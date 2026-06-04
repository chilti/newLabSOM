import React from 'react';

interface BoxPlotProps {
  name: string;
  values: number[];
}

export const BoxPlot: React.FC<BoxPlotProps> = ({ name, values }) => {
  if (!values || values.length === 0) {
    return (
      <div className="bg-gray-950 p-4 border border-gray-800 rounded-xl flex items-center justify-center h-48 text-xs text-gray-500">
        No data available
      </div>
    );
  }

  // Sort values
  const sorted = [...values].sort((a, b) => a - b);
  
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  // Percentiles
  const q1Idx = Math.floor(sorted.length * 0.25);
  const medianIdx = Math.floor(sorted.length * 0.5);
  const q3Idx = Math.floor(sorted.length * 0.75);
  
  const q1 = sorted[q1Idx];
  const median = sorted[medianIdx];
  const q3 = sorted[q3Idx];

  const range = max - min || 1;

  // SVG Coordinates setup
  const padding = 15;
  const width = 120;
  const height = 180;
  const plotHeight = height - 2 * padding;

  // Scale value to SVG y-coordinate (min at bottom, max at top)
  const scaleY = (val: number) => {
    const ratio = (val - min) / range;
    return height - padding - ratio * plotHeight;
  };

  const yMax = scaleY(max);
  const yQ3 = scaleY(q3);
  const yMedian = scaleY(median);
  const yQ1 = scaleY(q1);
  const yMin = scaleY(min);

  const centerX = width / 2;
  const boxWidth = 50;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col items-center shadow-lg transition-all duration-200 hover:border-indigo-500 hover:shadow-indigo-950 hover:shadow-opacity-25">
      <span className="text-xs font-bold text-gray-200 truncate w-full text-center mb-3" title={name}>
        {name}
      </span>
      
      <div className="relative">
        <svg width={width} height={height} className="select-none">
          {/* Whiskers vertical line */}
          <line
            x1={centerX}
            y1={yMax}
            x2={centerX}
            y2={yMin}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="2,2"
          />

          {/* Min Whisker cap */}
          <line
            x1={centerX - 15}
            y1={yMin}
            x2={centerX + 15}
            y2={yMin}
            stroke="#94a3b8"
            strokeWidth={2}
          />

          {/* Max Whisker cap */}
          <line
            x1={centerX - 15}
            y1={yMax}
            x2={centerX + 15}
            y2={yMax}
            stroke="#94a3b8"
            strokeWidth={2}
          />

          {/* Interquartile Range Box */}
          <rect
            x={centerX - boxWidth / 2}
            y={yQ3}
            width={boxWidth}
            height={Math.max(2, yQ1 - yQ3)}
            fill="#001026"
            stroke="#00f0ff"
            strokeWidth={2}
            rx={4}
            className="glow-primary transition-all duration-200"
          />

          {/* Median horizontal line */}
          <line
            x1={centerX - boxWidth / 2 + 1}
            y1={yMedian}
            x2={centerX + boxWidth / 2 - 1}
            y2={yMedian}
            stroke="#ffffff"
            strokeWidth={2.5}
          />

          {/* Value markers on hover */}
          <circle cx={centerX} cy={yMedian} r={3} fill="#00f0ff" />
        </svg>
      </div>

      {/* Mini details summary */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 w-full mt-3 pt-3 border-t border-gray-800 text-[9px] text-gray-500">
        <div>Max: <span className="text-gray-300 font-semibold">{max.toFixed(2)}</span></div>
        <div>Q3: <span className="text-gray-300 font-semibold">{q3.toFixed(2)}</span></div>
        <div>Med: <span className="text-gray-300 font-semibold">{median.toFixed(2)}</span></div>
        <div>Q1: <span className="text-gray-300 font-semibold">{q1.toFixed(2)}</span></div>
        <div className="col-span-2">Min: <span className="text-gray-300 font-semibold">{min.toFixed(2)}</span></div>
      </div>
    </div>
  );
};
