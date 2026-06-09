import { create } from 'zustand';
import { type NormalizationInfo, type NormalizationType, applyNormalizationToMatrix } from '../utils/normalization';
import { applyCmaSmoothing } from '../utils/timeSeries';

// Helper to resolve API URLs dynamically based on deployment environment
export const getApiUrl = (path: string): string => {
  // 1. Desktop context (Photino loads local index.html using file:// or app://)
  const isDesktop = window.location.protocol === 'file:' || window.location.protocol === 'about:' || !window.location.host;
  if (isDesktop) {
    return `http://localhost:5123${path}`;
  }
  
  // 2. Production browser context served under a subdirectory path (e.g., /labsom/)
  if (window.location.pathname.startsWith('/labsom')) {
    return `/labsom${path}`;
  }
  
  // 3. Standard relative API calls (Development or domain-root deployment)
  return path;
};

export interface SOMConfig {
  rows: number;
  cols: number;
  iterations: number;
  method: 'basic' | 'batch';
  init: 'random' | 'linear' | 'pca';
  metric: 'euclidean' | 'manhattan' | 'canberra';
  learningRate: number;
  clusteringAlgorithm: 'agglomerative' | 'dbscan';
  nClusters: number;
  eps: number;
  minSamples: number;
  umapDataSource: 'data' | 'weights';
}

export interface TrainingResult {
  weights: number[][];
  umatrix: number[][];
  clustering: number[];
  frequencies: number[];
  quantizationErrors: number[];
  bmus: number[];
  hexGrid: Array<{ index: number; row: number; col: number; x: number; y: number }>;
  mappedLabels: string[][];
  errors: number[];
  umap: number[][] | null;
  umapSource: string | null;
}

export interface HardwareInfo {
  level: number;
  device: string;
  details: string;
}

interface SOMState {
  // Config & Status
  config: SOMConfig;
  hardware: HardwareInfo | null;
  isTraining: boolean;
  isGeneratingUmap: boolean;
  isPreprocessing: boolean;
  uploadProgress: number | null;
  activeTab: 'multidimensional' | 'temporal' | 'bibliometrics';
  
  // Data
  dataMatrix: number[][];
  originalDataMatrix: number[][] | null;
  normalizationInfo: NormalizationInfo | null;
  matrixOrigin: 'csv' | 'monothematic' | 'bipartite';
  fileName: string | null;
  labels: string[];
  compNames: string[];
  
  // Preprocessed Bibliometrics
  documentCount: number;
  termCounts: Record<string, number>;
  network: { nodes: any[]; edges: any[] } | null;
  networksByYear: Record<string, { nodes: any[]; edges: any[]; cooccurrence_csv?: string }> | null;
  cooccurrenceCsv: string | null;
  pendingNetworkCsv: string | null;
  pendingNetworkOrigin: 'monothematic' | 'bipartite' | null;
  
  // Training outputs
  result: TrainingResult | null;
  
  // Time-Series Preprocessing
  isCmaSmoothingActive: boolean;
  cmaWindowSize: number;
  setIsCmaSmoothingActive: (active: boolean) => void;
  setCmaWindowSize: (size: number) => void;
  
  // Label Filters
  showLabels: boolean;
  labelSearchQuery: string;
  excludedLabels: Set<string>;
  maxLabelsPerNeuron: number;
  showLabelsOnComponents: boolean;

  setShowLabels: (show: boolean) => void;
  setLabelSearchQuery: (query: string) => void;
  toggleLabelVisibility: (label: string) => void;
  setExcludedLabels: (labels: Set<string>) => void;
  setMaxLabelsPerNeuron: (max: number) => void;
  setShowLabelsOnComponents: (show: boolean) => void;
  resetLabelFilters: () => void;
  
  // PathSOM (Trajectory) State
  activeTrajectories: Set<string>;
  trajectoryLineWidth: number;
  isTrajectoriesExpanded: boolean;
  entityColorOverrides: Record<string, string>;
  showLabelsOnUmapScatter: boolean;

  setActiveTrajectories: (trajectories: Set<string>) => void;
  setTrajectoryLineWidth: (width: number) => void;
  setIsTrajectoriesExpanded: (expanded: boolean) => void;
  setEntityColorOverrides: (overrides: Record<string, string>) => void;
  setShowLabelsOnUmapScatter: (show: boolean) => void;
  
  // Setters & Actions
  setConfig: (config: Partial<SOMConfig>) => void;
  setActiveTab: (tab: 'multidimensional' | 'temporal' | 'bibliometrics') => void;
  fetchSystemStatus: () => Promise<void>;
  loadCsvData: (csvText: string, labelColIndex?: number, ignoreCols?: number[], origin?: 'csv' | 'monothematic' | 'bipartite', fileName?: string) => void;
  applyNormalization: (type: NormalizationType) => void;
  revertNormalization: () => void;
  preprocessBibliometrics: (file: File, networkType: string, customTag?: string, maxTerms?: number, minCooc?: number, onlyMajor?: boolean, temporal?: boolean) => Promise<void>;
  trainSOM: () => Promise<boolean>;
  generateUmap: () => Promise<boolean>;
  moveLabel: (label: string, fromBmu: number, toBmu: number) => void;
  recalculatePipeline: () => void;
  reclusterLocally: (clustering: number[]) => void;
  exportProject: () => void;
  importProject: (fileContent: string) => void;
}

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i+1] === '"') {
      current += '"';
      i++; // skip escaped quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(s => s.trim());
};

const parseRawCsvToMatrix = (csvText: string, labelColIndex = 0, ignoreCols: number[] = []) => {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  
  const headers = parseCSVLine(lines[0]);
  const matrix: number[][] = [];
  const documentLabels: string[] = [];
  const numericColIndices: number[] = [];
  const selectedHeaders: string[] = [];
  
  headers.forEach((h, idx) => {
    if (idx !== labelColIndex && !ignoreCols.includes(idx)) {
      numericColIndices.push(idx);
      selectedHeaders.push(h);
    }
  });

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length < headers.length) continue;
    
    documentLabels.push(parts[labelColIndex]);
    const row = numericColIndices.map(idx => parseFloat(parts[idx]) || 0.0);
    matrix.push(row);
  }
  
  return { matrix, documentLabels, selectedHeaders };
};

export const useSomStore = create<SOMState>((set, get) => ({
  config: {
    rows: 8,
    cols: 8,
    iterations: 100,
    method: 'batch',
    init: 'pca',
    metric: 'euclidean',
    learningRate: 0.5,
    clusteringAlgorithm: 'dbscan',
    nClusters: 4,
    eps: 1.5,
    minSamples: 2,
    umapDataSource: 'data',
  },
  hardware: null,
  isTraining: false,
  isGeneratingUmap: false,
  isPreprocessing: false,
  uploadProgress: null,
  activeTab: 'bibliometrics',
  
  dataMatrix: [],
  originalDataMatrix: null,
  normalizationInfo: null,
  matrixOrigin: 'csv',
  fileName: null,
  labels: [],
  compNames: [],
  
  documentCount: 0,
  termCounts: {},
  network: null,
  networksByYear: null,
  cooccurrenceCsv: null,
  pendingNetworkCsv: null,
  pendingNetworkOrigin: null,
  result: null,

  // Time-Series Preprocessing
  isCmaSmoothingActive: false,
  cmaWindowSize: 3,
  setIsCmaSmoothingActive: (active) => {
    set({ isCmaSmoothingActive: active });
    get().recalculatePipeline();
  },
  setCmaWindowSize: (size) => {
    set({ cmaWindowSize: size });
    get().recalculatePipeline();
  },

  // Label Filters
  showLabels: false,
  labelSearchQuery: '',
  excludedLabels: new Set<string>(),
  maxLabelsPerNeuron: 1,
  showLabelsOnComponents: false,

  setShowLabels: (show) => set({ showLabels: show }),
  setLabelSearchQuery: (query) => set({ labelSearchQuery: query }),
  toggleLabelVisibility: (label) => set((state) => {
    const next = new Set(state.excludedLabels);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    return { excludedLabels: next };
  }),
  setExcludedLabels: (labels) => set({ excludedLabels: labels }),
  setMaxLabelsPerNeuron: (max) => set({ maxLabelsPerNeuron: max }),
  setShowLabelsOnComponents: (show) => set({ showLabelsOnComponents: show }),
  resetLabelFilters: () => set({
    showLabels: false,
    labelSearchQuery: '',
    excludedLabels: new Set<string>(),
    maxLabelsPerNeuron: 1,
    showLabelsOnComponents: false
  }),

  // PathSOM (Trajectory) State
  activeTrajectories: new Set<string>(),
  trajectoryLineWidth: 2,
  isTrajectoriesExpanded: false,
  entityColorOverrides: {},
  showLabelsOnUmapScatter: false,

  setActiveTrajectories: (trajectories) => set({ activeTrajectories: trajectories }),
  setTrajectoryLineWidth: (width) => set({ trajectoryLineWidth: width }),
  setIsTrajectoriesExpanded: (expanded) => set({ isTrajectoriesExpanded: expanded }),
  setEntityColorOverrides: (overrides) => set({ entityColorOverrides: overrides }),
  setShowLabelsOnUmapScatter: (show) => set({ showLabelsOnUmapScatter: show }),

  setConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),
  setActiveTab: (tab) => set({ activeTab: tab }),

  applyNormalization: (type) => {
    set({ normalizationInfo: { type, params: {} } as unknown as NormalizationInfo });
    get().recalculatePipeline();
  },

  revertNormalization: () => {
    set({ normalizationInfo: null });
    get().recalculatePipeline();
  },

  recalculatePipeline: () => set((state) => {
    let currentMatrix: number[][] = [];
    let currentLabels: string[] = [];
    let normInfo = state.normalizationInfo;

    const isTemporal = state.networksByYear && Object.keys(state.networksByYear).length > 0;

    if (isTemporal && state.networksByYear) {
      // Temporal Stack: Parse each year, normalize it, then stack
      const years = Object.keys(state.networksByYear).sort();
      for (const year of years) {
        const yNet = state.networksByYear[year];
        if (yNet.cooccurrence_csv) {
          const parsed = parseRawCsvToMatrix(yNet.cooccurrence_csv);
          if (parsed) {
            let yMatrix = parsed.matrix;
            if (normInfo?.type) {
              const { normalizedMatrix } = applyNormalizationToMatrix(yMatrix, normInfo.type);
              yMatrix = normalizedMatrix;
            }
            
            for (let i = 0; i < yMatrix.length; i++) {
              currentMatrix.push(yMatrix[i]);
              currentLabels.push(`${year}_${parsed.documentLabels[i]}`);
            }
          }
        }
      }
    } else {
      // Standard flow
      if (!state.originalDataMatrix) return {};
      currentMatrix = state.originalDataMatrix;
      currentLabels = state.labels;
      
      if (normInfo?.type) {
        const { normalizedMatrix, scalerInfo } = applyNormalizationToMatrix(currentMatrix, normInfo.type);
        currentMatrix = normalizedMatrix;
        normInfo = scalerInfo;
      }
    }
    
    // 2. Smooth (CMA)
    if (state.isCmaSmoothingActive && isTemporal) {
      currentMatrix = applyCmaSmoothing(currentMatrix, currentLabels, state.cmaWindowSize);
    }
    
    return {
      dataMatrix: currentMatrix,
      labels: currentLabels,
      normalizationInfo: normInfo,
      result: null // clear previous results because data changed
    };
  }),

  fetchSystemStatus: async () => {
    try {
      const res = await fetch(getApiUrl(`/api/system/status`));
      const data = await res.json();
      if (data?.success) {
        set({ hardware: data.hardware });
      }
    } catch (e) {
      console.error("Failed to fetch system GPU status, local API might not be running", e);
    }
  },

  loadCsvData: (csvText: string, labelColIndex = 0, ignoreCols: number[] = [], origin: 'csv' | 'monothematic' | 'bipartite' = 'csv', fileName?: string) => {
    const parsed = parseRawCsvToMatrix(csvText, labelColIndex, ignoreCols);
    if (!parsed) return;
    
    set({
      dataMatrix: parsed.matrix,
      originalDataMatrix: parsed.matrix,
      normalizationInfo: null,
      matrixOrigin: origin,
      fileName: fileName || null,
      labels: parsed.documentLabels,
      compNames: parsed.selectedHeaders,
      result: null, // clear previous results
      isCmaSmoothingActive: false, // reset CMA smoothing flag
      activeTrajectories: new Set<string>(),
      entityColorOverrides: {}
    });
  },

  preprocessBibliometrics: async (file: File, networkType: string, customTag?: string, maxTerms?: number, minCooc?: number, onlyMajor?: boolean, temporal?: boolean) => {
    set({ isPreprocessing: true, uploadProgress: 0 });
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('networkType', networkType);
      if (customTag) formData.append('customTag', customTag);
      if (maxTerms !== undefined) formData.append('maxTerms', maxTerms.toString());
      if (minCooc !== undefined) formData.append('minCooc', minCooc.toString());
      if (onlyMajor !== undefined) formData.append('onlyMajor', onlyMajor.toString());
      if (temporal !== undefined) formData.append('temporal', temporal.toString());

      const responseText = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            set({ uploadProgress: percent });
          }
        };
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            let errMsg = `Server error ${xhr.status}`;
            try {
              const resJson = JSON.parse(xhr.responseText);
              errMsg = resJson.error || errMsg;
            } catch {}
            reject(new Error(errMsg));
          }
        };
        
        xhr.onerror = () => reject(new Error("Local API Connection failed. Make sure the backend is booted."));
        xhr.ontimeout = () => reject(new Error("Request timed out"));
        
        xhr.open('POST', getApiUrl(`/api/preprocess/bibliometrics`));
        xhr.send(formData);
      });

      const result = JSON.parse(responseText);
      if (result?.success) {
        // Note: For temporal sequences, we load frequency_csv instead of cooccurrence_csv because it contains the stacked Year_Entity vectors
        const networkCsv = temporal ? result.frequency_csv : result.cooccurrence_csv;
        const origin = networkType === 'bipartite' ? 'bipartite' : 'monothematic';
        
        if (get().dataMatrix && get().dataMatrix.length > 0) {
          set({
            pendingNetworkCsv: networkCsv,
            pendingNetworkOrigin: origin
          });
        } else if (networkCsv) {
          get().loadCsvData(networkCsv, 0, [], origin);
        }
        
        set({
          documentCount: result.document_count,
          termCounts: result.term_counts,
          network: result.network,
          networksByYear: result.networks_by_year || null,
          cooccurrenceCsv: result.cooccurrence_csv,
          isPreprocessing: false,
          uploadProgress: null
        });
      } else {
        alert("Preprocess error: " + (result?.error || "Unknown error"));
        set({ isPreprocessing: false, uploadProgress: null });
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Local API Connection failed. Make sure the backend is booted.");
      set({ isPreprocessing: false, uploadProgress: null });
    }
  },

  trainSOM: async (): Promise<boolean> => {
    const { dataMatrix, labels, config, hardware } = get();
    if (dataMatrix.length === 0) {
      alert("Por favor, cargue una matriz de datos primero.");
      return false;
    }
    
    set({ isTraining: true });
    try {
      const payload = {
        data: dataMatrix,
        rows: config.rows,
        cols: config.cols,
        iterations: config.iterations,
        method: config.method,
        init: config.init,
        metric: config.metric,
        learning_rate: config.learningRate,
        clustering_algorithm: config.clusteringAlgorithm,
        n_clusters: config.nClusters,
        eps: config.eps,
        min_samples: config.minSamples,
        fallback_level: hardware?.level ?? 3,
        labels: labels
      };
      
      const res = await fetch(getApiUrl('/api/som/train'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await res.json();
      if (result?.success) {
        set({
          result: {
            weights: result.weights,
            umatrix: result.umatrix,
            clustering: result.clustering,
            frequencies: result.frequencies,
            quantizationErrors: result.quantization_errors,
            bmus: result.bmus,
            hexGrid: result.hex_grid,
            mappedLabels: result.mapped_labels,
            errors: result.errors,
            umap: get().result?.umap ?? null, // Preserve existing UMAP
            umapSource: get().result?.umapSource ?? null
          },
          isTraining: false
        });
        return true;
      } else {
        alert("Training error: " + (result?.error || "Unknown error"));
        set({ isTraining: false });
        return false;
      }
    } catch (e) {
      console.error(e);
      alert("Local API Connection failed. Make sure the backend is booted.");
      set({ isTraining: false });
      return false;
    }
  },

  generateUmap: async (): Promise<boolean> => {
    const { result, config, dataMatrix } = get();
    if (!result || !result.weights) {
      alert("La red debe estar entrenada para generar proyecciones UMAP.");
      return false;
    }

    set({ isGeneratingUmap: true });
    try {
      const payload = {
        weights: config.umapDataSource === 'data' ? dataMatrix : result.weights,
        n_neighbors: 15,
        min_dist: 0.1,
        metric: config.metric
      };

      const res = await fetch(getApiUrl('/api/som/umap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resJson = await res.json();
      if (resJson?.success) {
        set({
          result: {
            ...result,
            umap: resJson.umap,
            umapSource: resJson.umap_source
          },
          isGeneratingUmap: false
        });
        return true;
      } else {
        alert("UMAP error: " + (resJson?.error || "Unknown error"));
        set({ isGeneratingUmap: false });
        return false;
      }
    } catch (e) {
      console.error(e);
      alert("Local API Connection failed.");
      set({ isGeneratingUmap: false });
      return false;
    }
  },

  moveLabel: (label, fromBmu, toBmu) => {
    set((state) => {
      if (!state.result) return {};
      
      const newMappedLabels = state.result.mappedLabels.map((lblList, idx) => {
        if (idx === fromBmu) {
          return lblList.filter(l => l !== label);
        }
        if (idx === toBmu) {
          return [...lblList, label];
        }
        return lblList;
      });
      
      const newBmus = state.result.bmus.map((bmu, idx) => {
        if (state.labels[idx] === label) {
          return toBmu;
        }
        return bmu;
      });
      
      return {
        result: {
          ...state.result,
          mappedLabels: newMappedLabels,
          bmus: newBmus
        }
      };
    });
  },

  reclusterLocally: (clustering: number[]) => {
    const { result } = get();
    if (!result) return;
    
    // Create new result object with updated clustering array
    const newResult = {
      ...result,
      clustering: clustering
    };
    
    set({ result: newResult });
  },

  exportProject: () => {
    const state = get();
    const projectData = {
      version: '1.0',
      config: state.config,
      dataMatrix: state.dataMatrix,
      originalDataMatrix: state.originalDataMatrix,
      normalizationInfo: state.normalizationInfo,
      matrixOrigin: state.matrixOrigin,
      labels: state.labels,
      compNames: state.compNames,
      documentCount: state.documentCount,
      termCounts: state.termCounts,
      network: state.network,
      networksByYear: state.networksByYear,
      cooccurrenceCsv: state.cooccurrenceCsv,
      pendingNetworkCsv: state.pendingNetworkCsv,
      pendingNetworkOrigin: state.pendingNetworkOrigin,
      result: state.result,
      isCmaSmoothingActive: state.isCmaSmoothingActive,
      cmaWindowSize: state.cmaWindowSize
    };

    const jsonString = JSON.stringify(projectData);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `labsom_project_${new Date().getTime()}.labsom`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  importProject: (fileContent: string) => {
    try {
      const projectData = JSON.parse(fileContent);
      if (projectData.version === '1.0' || projectData.config) {
        set({
          config: projectData.config || get().config,
          dataMatrix: projectData.dataMatrix || [],
          originalDataMatrix: projectData.originalDataMatrix || null,
          normalizationInfo: projectData.normalizationInfo || null,
          matrixOrigin: projectData.matrixOrigin || 'csv',
          labels: projectData.labels || [],
          compNames: projectData.compNames || [],
          documentCount: projectData.documentCount || 0,
          termCounts: projectData.termCounts || {},
          network: projectData.network || null,
          networksByYear: projectData.networksByYear || null,
          cooccurrenceCsv: projectData.cooccurrenceCsv || null,
          pendingNetworkCsv: projectData.pendingNetworkCsv || null,
          pendingNetworkOrigin: projectData.pendingNetworkOrigin || null,
          result: projectData.result || null,
          isCmaSmoothingActive: projectData.isCmaSmoothingActive || false,
          cmaWindowSize: projectData.cmaWindowSize || 3
        });
      } else {
        alert('Invalid or corrupted .labsom file format.');
      }
    } catch (e) {
      console.error('Error importing project:', e);
      alert('Failed to parse .labsom file.');
    }
  }
}));
