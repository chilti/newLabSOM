declare module 'react-umap-heatmap' {
  import React from 'react';
  
  export interface UmapPoint {
    x: number;
    y: number;
    value: number;
    label?: string;
  }
  
  export interface UmapHeatmapProps {
    points: UmapPoint[];
    width?: number;
    height?: number;
    colorScale?: 'standard' | 'viridis' | 'cividis';
    sigma?: number;
    resolution?: number;
    showPoints?: boolean;
    showLabels?: boolean;
  }
  
  export const UmapHeatmap: React.FC<UmapHeatmapProps>;
}
