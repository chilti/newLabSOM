import { create } from 'zustand';
import { type NormalizationInfo, type NormalizationType, applyNormalizationToMatrix } from '../utils/normalization';
import { applyCmaSmoothing } from '../utils/timeSeries';
import { useAiStore } from './aiStore';

export { getApiUrl } from '../utils/api';
import { getApiUrl } from '../utils/api';


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
  umapDataSource?: 'original' | 'weights';
  maxK?: number;
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

export interface LongitudinalDriftMetric {
  raw_drift?: number[];
  normalized_drift?: number[];
  mean_drift: number;
  max_drift: number;
}

export interface LongitudinalPeriodResult extends TrainingResult {
  period: string;
  training_phase: 'base_full' | 'warm_start_refine';
  iterations: number;
  doc_count?: number;
  drift_from_prev?: LongitudinalDriftMetric;
}

export interface LongitudinalSOMTrainingResult {
  success: boolean;
  error?: string;
  is_longitudinal: boolean;
  periods: string[];
  maps: Record<string, LongitudinalPeriodResult>;
  drift_metrics: Record<string, LongitudinalDriftMetric>;
}

export interface SubperiodMatrixItem {
  data: number[][];
  labels: string[];
  doc_count: number;
  start_year: number;
  end_year: number;
}

export interface HardwareInfo {
  level: number;
  device: string;
  details: string;
}

export interface SemanticRecord {
  id: string;
  doi: string;
  title: string;
  abstract: string;
  keywords: string[];
  concatenated_text: string;
  extras: Record<string, string>;
}

export interface DataProvenance {
  originType: 'incites' | 'bibliometrics' | 'dimreduction' | 'csv_upload';
  unitName?: string;              // e.g. "Locations", "Researchers", "Departments"
  subView?: string;               // e.g. "Heatmap Matrix", "Evolution Profile", "Quartiles"
  indicatorsCount?: number;       // number of features used
  indicatorsList?: string[];      // list of indicators selected
  smoothingInfo?: string;         // e.g. "RAW", "ECMA-3", "CMA Window=5"
}

export interface SomRun {
  id: string;
  name: string;
  createdAt: string;
  provenance: DataProvenance;

  // Data Snapshot
  dataMatrix: number[][];
  originalDataMatrix: number[][] | null;
  labels: string[];
  compNames: string[];
  normalizationInfo: NormalizationInfo | null;
  matrixOrigin: 'csv' | 'monothematic' | 'bipartite';
  fileName: string | null;

  // Hyperparameters
  config: SOMConfig;
  isCmaSmoothingActive: boolean;
  cmaWindowSize: number;

  // Trained SOM Outputs
  result: TrainingResult;

  // PathSOM Customizations
  activeTrajectories?: string[];
  entityColorOverrides?: Record<string, string>;
}

export interface ComponentScaleConfig {
  source: 'raw' | 'weights' | 'custom';
  customMin?: number;
  customMid?: number;
  customMax?: number;
}

interface SOMState {
  // Config & Status
  config: SOMConfig;
  hardware: HardwareInfo | null;
  isTraining: boolean;
  isGeneratingUmap: boolean;
  isPreprocessing: boolean;
  uploadProgress: number | null;
  activeTab: 'multidimensional' | 'temporal' | 'bibliometrics' | 'dimreduction' | 'semantic_bibliometrics' | 'incites' | 'asistente';
  
  // Experiment History (Multi-Training Runs)
  savedRuns: SomRun[];
  activeRunId: string | null;
  pendingProvenance: DataProvenance | null;

  // Size Suggestions
  somSizeMode: 'big' | 'small' | 'custom';
  suggestedBigSom: { width: number, height: number } | null;
  suggestedSmallSom: { width: number, height: number } | null;
  setSomSizeMode: (mode: 'big' | 'small' | 'custom') => void;
  fetchSizeSuggestions: (data: number[][]) => Promise<void>;

  setActiveRunId: (id: string | null) => void;
  deleteRun: (id: string) => void;
  renameRun: (id: string, newName: string) => void;
  setPendingProvenance: (prov: DataProvenance | null) => void;

  // Semantic Bibliometrics State
  semanticRecords: SemanticRecord[] | null;
  semanticEmbeddings: number[][] | null;
  semanticIntrinsicData: number[][] | null;
  semantic2DCoords: Array<{ x: number; y: number }> | null;
  semanticClusters: any[] | null;
  semanticClusterAssignment: string[] | null;
  isSemanticPreprocessing: boolean;
  isSemanticEmbedding: boolean;
  isSemanticReducing: boolean;
  isSemanticClustering: boolean;
  semanticTargetD: number;
  semanticNumLevels: number;
  semanticMinSize: number;
  semanticCeilingResult: any;
  semanticManualAlgo: string;
  semanticManualResult: any;
  semanticFileName: string;
  semanticEmbedModel: 'nomic' | 'specter';
  
  // Data
  dataMatrix: number[][];
  originalDataMatrix: number[][] | null;
  normalizationInfo: NormalizationInfo | null;
  matrixOrigin: 'csv' | 'monothematic' | 'bipartite';
  fileName: string | null;
  labels: string[];
  compNames: string[];
  
  // Preprocessed Bibliometrics
  sharedBibFile: File | null;
  setSharedBibFile: (file: File | null) => void;
  documentCount: number;
  termCounts: Record<string, number>;
  network: { nodes: any[]; edges: any[] } | null;
  vosviewerJson: any | null;
  setVosviewerJson: (json: any) => void;
  networksByYear: Record<string, { nodes: any[]; edges: any[]; cooccurrence_csv?: string; vosviewer_json?: any }> | null;
  cooccurrenceCsv: string | null;
  pendingNetworkCsv: string | null;
  pendingNetworkOrigin: 'monothematic' | 'bipartite' | null;
  
  // Longitudinal SOM & Subperiod State
  temporalWindow: number;
  setTemporalWindow: (w: number) => void;
  temporalAnalysisMode: 'pathsom' | 'longitudinal';
  setTemporalAnalysisMode: (mode: 'pathsom' | 'longitudinal') => void;
  longitudinalResults: LongitudinalSOMTrainingResult | null;
  setLongitudinalResults: (results: LongitudinalSOMTrainingResult | null) => void;
  activeLongitudinalPeriod: string;
  setActiveLongitudinalPeriod: (period: string) => void;
  cooccurrenceMatricesByPeriod: Record<string, SubperiodMatrixItem> | null;
  setCooccurrenceMatricesByPeriod: (matrices: Record<string, SubperiodMatrixItem> | null) => void;
  trainLongitudinalSOM: () => Promise<boolean>;
  
  // Training outputs
  result: TrainingResult | null;
  
  // Time-Series Preprocessing
  isCmaSmoothingActive: boolean;
  cmaWindowSize: number;
  setIsCmaSmoothingActive: (active: boolean) => void;
  setCmaWindowSize: (size: number) => void;
  
  // Label Filters & Individual Custom Styling
  showLabels: boolean;
  labelSearchQuery: string;
  excludedLabels: Set<string>;
  maxLabelsPerNeuron: number;
  labelFontSizeScale: number;
  labelStyleOverrides: Record<string, { color?: string; sizeMultiplier?: number }>;
  showLabelsOnComponents: boolean;

  // Cluster Labels
  clusterLabels: Record<number, string>;
  showClusterLabels: boolean;

  // Component Map Chromatic Scale Customizations
  componentScaleConfigs: Record<number, ComponentScaleConfig>;
  globalScaleSource: 'raw' | 'weights';

  setShowLabels: (show: boolean) => void;
  setLabelSearchQuery: (query: string) => void;
  toggleLabelVisibility: (label: string) => void;
  setExcludedLabels: (labels: Set<string>) => void;
  setMaxLabelsPerNeuron: (max: number) => void;
  setLabelFontSizeScale: (scale: number) => void;
  setLabelStyleOverride: (label: string, style: { color?: string; sizeMultiplier?: number }) => void;
  removeLabelStyleOverride: (label: string) => void;
  setShowLabelsOnComponents: (show: boolean) => void;
  setClusterLabel: (clusterId: number, name: string) => void;
  setShowClusterLabels: (show: boolean) => void;
  resetLabelFilters: () => void;
  setComponentScaleConfig: (compIdx: number, config: Partial<ComponentScaleConfig>) => void;
  setGlobalScaleSource: (source: 'raw' | 'weights') => void;
  resetComponentScaleConfigs: () => void;
  
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

  // Dim Reduction persistent state
  dimData: number[][] | null;
  dimFileName: string;
  dimCeilingResult: any;
  dimManualAlgo: string;
  dimManualResult: any;
  dimTargetD: number;
  dimReducedData: number[][] | null;
  setDimData: (data: number[][] | null, fileName: string) => void;
  setDimCeilingResult: (result: any) => void;
  setDimManualAlgo: (algo: string) => void;
  setDimManualResult: (result: any) => void;
  setDimTargetD: (d: number) => void;
  setDimReducedData: (data: number[][] | null) => void;
  clearDimState: () => void;

  // ExploradorDatos UI preferences
  exploSubTab: 'import' | 'training' | 'maps' | 'umap';
  exploUmapColorScale: 'standard' | 'viridis' | 'cividis';
  exploSomColorScale: 'standard' | 'viridis' | 'cividis';
  setExploSubTab: (tab: 'import' | 'training' | 'maps' | 'umap') => void;
  setExploUmapColorScale: (scale: 'standard' | 'viridis' | 'cividis') => void;
  setExploSomColorScale: (scale: 'standard' | 'viridis' | 'cividis') => void;

  // RedBibliometrica UI preferences
  biblioActiveView: 'vosviewer' | 'force' | 'graph' | 'matrix';
  biblioSelectedYear: string;
  setBiblioActiveView: (view: 'vosviewer' | 'force' | 'graph' | 'matrix') => void;
  setBiblioSelectedYear: (year: string) => void;
  
  // InCites Data State
  incitesUnitNames: string[] | null;
  incitesUnitCache: Record<string, any>;
  incitesLlmCache: Record<string, string>;
  incitesActiveUnit: string | null;
  incitesSidebarTab: 'profiles' | 'temporal';
  incitesIsUploading: boolean;
  incitesBaseline: any | null;
  incitesSelectedBaselineSource: string | null;
  incitesLimitTop50: boolean;
  incitesFilterIndicator: string;
  incitesFilterMinValue: number | string;
  incitesIsFilterActive: boolean;
  incitesIsFilterModalOpen: boolean;
  cloudProjectId: string | null;
  cloudProjectTitle: string | null;
  setIncitesState: (state: Partial<{
    incitesUnitNames: string[] | null,
    incitesUnitCache: Record<string, any>,
    incitesLlmCache: Record<string, string>,
    incitesActiveUnit: string | null,
    incitesSidebarTab: 'profiles' | 'temporal',
    incitesIsUploading: boolean,
    incitesBaseline: any | null,
    incitesSelectedBaselineSource: string | null,
    incitesLimitTop50: boolean,
    incitesFilterIndicator: string,
    incitesFilterMinValue: number | string,
    incitesIsFilterActive: boolean,
    incitesIsFilterModalOpen: boolean
  }>) => void;
  uploadInCitesFiles: (formData: FormData) => Promise<void>;
  
  // Setters & Actions
  setConfig: (config: Partial<SOMConfig>) => void;
  setActiveTab: (tab: 'multidimensional' | 'temporal' | 'bibliometrics' | 'dimreduction' | 'semantic_bibliometrics' | 'incites' | 'asistente') => void;
  fetchSystemStatus: () => Promise<void>;
  loadCsvData: (csvText: string, labelColIndex?: number, ignoreCols?: number[], origin?: 'csv' | 'monothematic' | 'bipartite', fileName?: string, provenance?: DataProvenance) => void;
  applyNormalization: (type: NormalizationType) => void;
  revertNormalization: () => void;
  preprocessBibliometrics: (
    file: File,
    networkType: string,
    customTag?: string,
    maxTerms?: number,
    minCooc?: number,
    onlyMajor?: boolean,
    temporal?: boolean,
    extractionSource?: 'keywords' | 'title_abstract' | 'title' | 'abstract',
    countingMethod?: 'full' | 'fractional',
    thesaurusFile?: File | null,
    relevanceRatio?: number,
    temporalWindow?: number
  ) => Promise<void>;
  queryBibliometricsApi: (params: {
    source: 'openalex' | 'crossref';
    query: string;
    maxResults?: number;
    networkType?: string;
    customTag?: string;
    maxTerms?: number;
    minCooc?: number;
    temporal?: boolean;
    extractionSource?: 'keywords' | 'title_abstract' | 'title' | 'abstract';
    countingMethod?: 'full' | 'fractional';
    relevanceRatio?: number;
  }) => Promise<boolean>;
  vosRecluster: (params: {
    resolution: number;
    minClusterSize: number;
  }) => Promise<{ success: boolean; clusters?: Record<number, number>; error?: string }>;
  trainSOM: () => Promise<boolean>;
  generateUmap: () => Promise<boolean>;
  moveLabel: (label: string, fromBmu: number, toBmu: number) => void;
  recalculatePipeline: () => void;
  reclusterLocally: (clustering: number[]) => void;
  getProjectPayload: () => any;
  ensureAllIncitesUnitsCached: () => Promise<void>;
  exportProject: () => Promise<void>;
  importProject: (fileContent: string) => void;
  clearProject: () => void;
  estimateDimension: (data: number[][], mode: 'ceiling' | 'manual', algorithmName?: string) => Promise<any>;
  reduceDimension: (data: number[][], targetD: number) => Promise<any>;
  
  // Semantic actions
  preprocessSemantic: (file: File, useMesh: boolean, extraFields: string[], extractTitle: boolean, extractAbstract: boolean, extractKeywords: boolean) => Promise<void>;
  generateSemanticEmbeddings: () => Promise<void>;
  estimateSemanticIntrinsicDim: () => Promise<void>;
  reduceSemanticDimension: () => Promise<void>;
  clusterSemantic: () => Promise<void>;
  setSemanticTargetD: (d: number) => void;
  setSemanticNumLevels: (l: number) => void;
  setSemanticMinSize: (s: number) => void;
  setSemanticManualAlgo: (algo: string) => void;
  setSemanticEmbedModel: (model: 'nomic' | 'specter') => void;
  clearSemanticState: () => void;
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
    iterations: 1000,
    method: 'batch',
    init: 'pca',
    metric: 'euclidean',
    learningRate: 0.5,
    clusteringAlgorithm: 'agglomerative',
    nClusters: 4,
    eps: 0.5,
    minSamples: 3,
    umapDataSource: 'original',
    maxK: 15
  },
  hardware: null,
  isTraining: false,
  isGeneratingUmap: false,
  isPreprocessing: false,
  uploadProgress: null,
  activeTab: 'multidimensional',
  cloudProjectId: null,
  cloudProjectTitle: null,
  
  // Size Suggestions
  somSizeMode: 'small',
  suggestedBigSom: null,
  suggestedSmallSom: null,
  setSomSizeMode: (mode) => set({ somSizeMode: mode }),
  fetchSizeSuggestions: async (data: number[][]) => {
    try {
      const response = await fetch(getApiUrl('/api/som/suggest_size'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      const result = await response.json();
      if (result.success) {
        set((state) => {
          const newState = {
            suggestedBigSom: { width: result.bigSomWidth, height: result.bigSomHeight },
            suggestedSmallSom: { width: result.smallSomWidth, height: result.smallSomHeight },
            somSizeMode: result.recommended as 'big' | 'small',
            config: {
              ...state.config,
              cols: result.recommended === 'big' ? result.bigSomWidth : result.smallSomWidth,
              rows: result.recommended === 'big' ? result.bigSomHeight : result.smallSomHeight
            }
          };
          return newState;
        });
      }
    } catch (err) {
      console.error("Error fetching size suggestions:", err);
    }
  },
  
  // Semantic Bibliometrics Initial State
  semanticRecords: null,
  semanticEmbeddings: null,
  semanticIntrinsicData: null,
  semantic2DCoords: null,
  semanticClusters: null,
  semanticClusterAssignment: null,
  isSemanticPreprocessing: false,
  isSemanticEmbedding: false,
  isSemanticReducing: false,
  isSemanticClustering: false,
  semanticTargetD: 15,
  semanticNumLevels: 2,
  semanticMinSize: 10,
  semanticCeilingResult: null,
  semanticManualAlgo: 'TwoNN',
  semanticManualResult: null,
  semanticFileName: '',
  semanticEmbedModel: 'nomic',
  
  dataMatrix: [],
  originalDataMatrix: null,
  normalizationInfo: null,
  matrixOrigin: 'csv',
  fileName: null,
  labels: [],
  compNames: [],
  
  sharedBibFile: null,
  setSharedBibFile: (file) => set({ sharedBibFile: file }),
  documentCount: 0,
  termCounts: {},
  network: null,
  vosviewerJson: null,
  setVosviewerJson: (vosviewerJson) => set({ vosviewerJson }),
  networksByYear: null,
  cooccurrenceCsv: null,
  pendingNetworkCsv: null,
  pendingNetworkOrigin: null,
  result: null,

  // Dim Reduction persistent state
  dimData: null,
  dimFileName: '',
  dimCeilingResult: null,
  dimManualAlgo: 'TwoNN',
  dimManualResult: null,
  dimTargetD: 2,
  dimReducedData: null,
  setDimData: (data, fileName) => set({ dimData: data, dimFileName: fileName }),
  setDimCeilingResult: (result) => set({ dimCeilingResult: result }),
  setDimManualAlgo: (algo) => set({ dimManualAlgo: algo }),
  setDimManualResult: (result) => set({ dimManualResult: result }),
  setDimTargetD: (d) => set({ dimTargetD: d }),
  setDimReducedData: (data) => set({ dimReducedData: data }),
  clearDimState: () => set({
    dimData: null, dimFileName: '', dimCeilingResult: null,
    dimManualAlgo: 'TwoNN', dimManualResult: null, dimTargetD: 2, dimReducedData: null
  }),

  // ExploradorDatos UI preferences
  exploSubTab: 'import',
  exploUmapColorScale: 'standard',
  exploSomColorScale: 'standard',
  setExploSubTab: (tab) => set({ exploSubTab: tab }),
  setExploUmapColorScale: (scale) => set({ exploUmapColorScale: scale }),
  setExploSomColorScale: (scale) => set({ exploSomColorScale: scale }),

  // RedBibliometrica UI preferences
  biblioActiveView: 'force',
  biblioSelectedYear: 'Global',
  setBiblioActiveView: (view) => set({ biblioActiveView: view }),
  setBiblioSelectedYear: (year) => set({ biblioSelectedYear: year }),

  // InCites Data State
  incitesUnitNames: null,
  incitesUnitCache: {},
  incitesLlmCache: {},
  incitesActiveUnit: null,
  incitesSidebarTab: 'profiles',
  incitesIsUploading: false,
  incitesBaseline: null,
  incitesSelectedBaselineSource: null,
  incitesLimitTop50: true,
  incitesFilterIndicator: '',
  incitesFilterMinValue: '',
  incitesIsFilterActive: false,
  incitesIsFilterModalOpen: false,
  setIncitesState: (newState) => set((state) => ({ ...state, ...newState })),
  uploadInCitesFiles: async (formData: FormData) => {
    set({
      incitesIsUploading: true,
      incitesUnitNames: null,
      incitesUnitCache: {},
      incitesLlmCache: {},
      incitesActiveUnit: null,
      incitesBaseline: null,
      incitesSelectedBaselineSource: null
    });

    try {
      const response = await fetch(getApiUrl('/api/incites/process'), {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!data.success) {
        alert("Error procesando InCites: " + data.error);
        set({ incitesIsUploading: false });
        return;
      }

      const rawNames: string[] = data.unit_names ?? [];
      const PREFERRED_INCITES_ORDER = [
        'Locations',
        'Publication Sources',
        'SDG',
        'ESI',
        'WoS Categories',
        'Macro Topics',
        'Meso Topics',
        'Micro Topics',
        'Organizations',
        'Funding Agencies',
        'Researchers'
      ];
      const names = [...rawNames].sort((a, b) => {
        const idxA = PREFERRED_INCITES_ORDER.indexOf(a);
        const idxB = PREFERRED_INCITES_ORDER.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      const baselineData = data.baseline || null;
      const defaultSource = baselineData?.default_source || null;

      // If baseline data exists, default to 'Data Indicators' tab
      const defaultUnit = baselineData && defaultSource ? 'Data Indicators' : (names.includes('Locations') ? 'Locations' : (names[0] || null));

      set({
        incitesUnitNames: names,
        incitesActiveUnit: defaultUnit,
        incitesBaseline: baselineData,
        incitesSelectedBaselineSource: defaultSource,
        incitesIsUploading: false
      });

      // Background pre-fetch all unit tabs so saved projects are 100% self-contained
      names.forEach(async (unitName) => {
        try {
          const res = await fetch(getApiUrl(`/api/incites/unit/${encodeURIComponent(unitName)}`));
          const unitRes = await res.json();
          if (unitRes.success && unitRes.unit) {
            set((state) => ({
              incitesUnitCache: { ...state.incitesUnitCache, [unitName]: unitRes.unit }
            }));
          }
        } catch (e) {
          console.warn(`Background pre-fetch warning for unit ${unitName}:`, e);
        }
      });
    } catch (err) {
      alert('Upload failed: ' + err);
      set({ incitesIsUploading: false });
    }
  },

  ensureAllIncitesUnitsCached: async () => {
    const { incitesUnitNames, incitesUnitCache } = get();
    if (!incitesUnitNames || incitesUnitNames.length === 0) return;

    const missingUnits = incitesUnitNames.filter(name => !incitesUnitCache[name]);
    if (missingUnits.length === 0) return;

    await Promise.all(missingUnits.map(async (unitName) => {
      try {
        const res = await fetch(getApiUrl(`/api/incites/unit/${encodeURIComponent(unitName)}`));
        const data = await res.json();
        if (data.success && data.unit) {
          set((state) => ({
            incitesUnitCache: { ...state.incitesUnitCache, [unitName]: data.unit }
          }));
        }
      } catch (err) {
        console.warn(`Could not pre-cache unit ${unitName} before saving:`, err);
      }
    }));
  },

  // Experiment History (Multi-Training Runs)
  savedRuns: [],
  activeRunId: null,
  pendingProvenance: null,

  setPendingProvenance: (prov) => set({ pendingProvenance: prov }),

  setActiveRunId: (id) => {
    if (!id) {
      set({ activeRunId: null });
      return;
    }
    const target = get().savedRuns.find(r => r.id === id);
    if (!target) return;

    set({
      activeRunId: target.id,
      dataMatrix: target.dataMatrix,
      originalDataMatrix: target.originalDataMatrix,
      labels: target.labels,
      compNames: target.compNames,
      normalizationInfo: target.normalizationInfo,
      matrixOrigin: target.matrixOrigin,
      fileName: target.fileName,
      config: target.config,
      isCmaSmoothingActive: target.isCmaSmoothingActive,
      cmaWindowSize: target.cmaWindowSize,
      result: target.result,
      activeTrajectories: new Set(target.activeTrajectories || []),
      entityColorOverrides: target.entityColorOverrides || {}
    });
  },

  deleteRun: (id) => {
    set((state) => {
      const nextRuns = state.savedRuns.filter(r => r.id !== id);
      const wasActive = state.activeRunId === id;
      const nextActiveId = wasActive ? (nextRuns.length > 0 ? nextRuns[nextRuns.length - 1].id : null) : state.activeRunId;
      
      if (wasActive && nextActiveId) {
        const target = nextRuns.find(r => r.id === nextActiveId);
        if (target) {
          return {
            savedRuns: nextRuns,
            activeRunId: nextActiveId,
            dataMatrix: target.dataMatrix,
            originalDataMatrix: target.originalDataMatrix,
            labels: target.labels,
            compNames: target.compNames,
            normalizationInfo: target.normalizationInfo,
            matrixOrigin: target.matrixOrigin,
            fileName: target.fileName,
            config: target.config,
            isCmaSmoothingActive: target.isCmaSmoothingActive,
            cmaWindowSize: target.cmaWindowSize,
            result: target.result,
            activeTrajectories: new Set(target.activeTrajectories || []),
            entityColorOverrides: target.entityColorOverrides || {}
          };
        }
      }

      return {
        savedRuns: nextRuns,
        activeRunId: nextActiveId,
        ...(nextRuns.length === 0 ? { result: null } : {})
      };
    });
  },

  renameRun: (id, newName) => {
    set((state) => ({
      savedRuns: state.savedRuns.map(r => r.id === id ? { ...r, name: newName } : r)
    }));
  },

  // Longitudinal SOM & Subperiod State
  temporalWindow: 1,
  setTemporalWindow: (temporalWindow) => set({ temporalWindow }),
  temporalAnalysisMode: 'pathsom',
  setTemporalAnalysisMode: (temporalAnalysisMode) => set({ temporalAnalysisMode }),
  longitudinalResults: null,
  setLongitudinalResults: (longitudinalResults) => set({ longitudinalResults }),
  activeLongitudinalPeriod: '',
  setActiveLongitudinalPeriod: (activeLongitudinalPeriod) => set({ activeLongitudinalPeriod }),
  cooccurrenceMatricesByPeriod: null,
  setCooccurrenceMatricesByPeriod: (cooccurrenceMatricesByPeriod) => set({ cooccurrenceMatricesByPeriod }),

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

  // Label Filters & Individual Custom Styling
  showLabels: false,
  labelSearchQuery: '',
  excludedLabels: new Set<string>(),
  maxLabelsPerNeuron: 1,
  labelFontSizeScale: 1.0,
  labelStyleOverrides: {},
  showLabelsOnComponents: false,

  // Cluster Labels
  clusterLabels: {},
  showClusterLabels: true,

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
  setLabelFontSizeScale: (scale) => set({ labelFontSizeScale: scale }),
  setLabelStyleOverride: (label, style) => set((state) => ({
    labelStyleOverrides: {
      ...state.labelStyleOverrides,
      [label]: { ...state.labelStyleOverrides[label], ...style }
    }
  })),
  removeLabelStyleOverride: (label) => set((state) => {
    const next = { ...state.labelStyleOverrides };
    delete next[label];
    return { labelStyleOverrides: next };
  }),
  setShowLabelsOnComponents: (show) => set({ showLabelsOnComponents: show }),
  setClusterLabel: (clusterId, name) => set((state) => ({
    clusterLabels: { ...state.clusterLabels, [clusterId]: name }
  })),
  setShowClusterLabels: (show) => set({ showClusterLabels: show }),
  resetLabelFilters: () => set({
    showLabels: false,
    labelSearchQuery: '',
    excludedLabels: new Set<string>(),
    maxLabelsPerNeuron: 1,
    labelFontSizeScale: 1.0,
    labelStyleOverrides: {},
    clusterLabels: {},
    showClusterLabels: true,
    showLabelsOnComponents: false
  }),

  // Component Map Chromatic Scale Customizations
  componentScaleConfigs: {},
  globalScaleSource: 'raw',
  setComponentScaleConfig: (compIdx, config) => set((state) => ({
    componentScaleConfigs: {
      ...state.componentScaleConfigs,
      [compIdx]: {
        ...(state.componentScaleConfigs[compIdx] || { source: state.globalScaleSource }),
        ...config
      }
    }
  })),
  setGlobalScaleSource: (source) => set({ globalScaleSource: source }),
  resetComponentScaleConfigs: () => set({ componentScaleConfigs: {} }),

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

    // Standard flow (now used for Bibliometrics as well, treating them as static matrices)
    if (!state.originalDataMatrix) return {};
    currentMatrix = state.originalDataMatrix;
    currentLabels = state.labels;
    
    if (normInfo?.type) {
      const { normalizedMatrix, scalerInfo } = applyNormalizationToMatrix(currentMatrix, normInfo.type);
      currentMatrix = normalizedMatrix;
      normInfo = scalerInfo;
    }
    
    // 2. Smooth (CMA) - Only applies if the matrix was already a temporal stack (e.g. InCites)
    if (state.isCmaSmoothingActive) {
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

  loadCsvData: (csvText: string, labelColIndex = 0, ignoreCols: number[] = [], origin: 'csv' | 'monothematic' | 'bipartite' = 'csv', fileName?: string, provenance?: DataProvenance) => {
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
      result: null, // clear active result for new dataset
      activeRunId: null,
      exploSubTab: 'import', // Automatically switch to 1. IMPORT & EXPLORATION for new data
      pendingProvenance: provenance || {
        originType: 'csv_upload',
        unitName: fileName || 'Uploaded Dataset',
        indicatorsCount: parsed.selectedHeaders.length,
        indicatorsList: parsed.selectedHeaders
      },
      isCmaSmoothingActive: false, // reset CMA smoothing flag
      activeTrajectories: new Set<string>(),
      entityColorOverrides: {}
    });
    get().fetchSizeSuggestions(parsed.matrix);
  },

  preprocessBibliometrics: async (
    file: File,
    networkType: string,
    customTag?: string,
    maxTerms?: number,
    minCooc?: number,
    onlyMajor?: boolean,
    temporal?: boolean,
    extractionSource?: 'keywords' | 'title_abstract' | 'title' | 'abstract',
    countingMethod?: 'full' | 'fractional',
    thesaurusFile?: File | null,
    relevanceRatio?: number,
    temporalWindow?: number
  ) => {
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
      if (extractionSource) formData.append('extractionSource', extractionSource);
      if (countingMethod) formData.append('countingMethod', countingMethod);
      if (thesaurusFile) formData.append('thesaurusFile', thesaurusFile);
      if (relevanceRatio !== undefined) formData.append('relevanceRatio', relevanceRatio.toString());
      if (temporalWindow !== undefined) formData.append('temporalWindow', temporalWindow.toString());

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
        xhr.timeout = 3600000; // 1 hour timeout (3600000 ms)
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
        
        const effectiveWindow = result.temporal_window || temporalWindow || 1;
        const hasSubperiods = result.cooccurrence_matrices_by_period && Object.keys(result.cooccurrence_matrices_by_period).length >= 2;
        const autoMode = (effectiveWindow >= 5 && hasSubperiods) ? 'longitudinal' : 'pathsom';

        set({
          dataMatrix: get().dataMatrix,
          originalDataMatrix: null,
          matrixOrigin: networkType === 'bipartite' ? 'bipartite' : 'monothematic',
          labels: get().labels,
          compNames: get().compNames,
          normalizationInfo: null,
          result: null,
          fileName: file.name,
          documentCount: result.document_count,
          termCounts: result.term_counts,
          network: networkType === 'bipartite' ? null : result.network,
          vosviewerJson: result.vosviewer_json || null,
          networksByYear: result.networks_by_year || null,
          cooccurrenceMatricesByPeriod: result.cooccurrence_matrices_by_period || null,
          temporalWindow: effectiveWindow,
          temporalAnalysisMode: autoMode,
          cooccurrenceCsv: result.cooccurrence_csv || null,
          biblioActiveView: 'force',
          isPreprocessing: false,
          pendingProvenance: {
            originType: 'bibliometrics',
            unitName: networkType,
            indicatorsCount: get().dataMatrix[0]?.length || 0,
            indicatorsList: get().compNames
          },
          activeTrajectories: new Set(),
          entityColorOverrides: {},
          longitudinalResults: null,
          activeLongitudinalPeriod: ''
        });
        get().fetchSizeSuggestions(get().dataMatrix);
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

  queryBibliometricsApi: async (params) => {
    set({ isPreprocessing: true, uploadProgress: 40 });
    try {
      const payload = {
        source: params.source,
        query: params.query,
        max_results: params.maxResults ?? 100,
        network_type: params.networkType ?? 'co-occurrence',
        custom_tag: params.customTag ?? 'DE',
        max_terms: params.maxTerms ?? 50,
        min_cooccurrence: params.minCooc ?? 2,
        temporal: params.temporal ?? false,
        extraction_source: params.extractionSource ?? 'keywords',
        counting_method: params.countingMethod ?? 'full',
        relevance_ratio: params.relevanceRatio ?? 0.60
      };

      const res = await fetch(getApiUrl('/api/preprocess/api_query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }

      const result = await res.json();
      if (result?.success) {
        const networkCsv = params.temporal ? result.frequency_csv : result.cooccurrence_csv;
        const origin = params.networkType === 'bipartite' ? 'bipartite' : 'monothematic';

        if (get().dataMatrix && get().dataMatrix.length > 0) {
          set({ pendingNetworkCsv: networkCsv, pendingNetworkOrigin: origin });
        } else if (networkCsv) {
          get().loadCsvData(networkCsv, 0, [], origin);
        }

        set({
          dataMatrix: get().dataMatrix,
          originalDataMatrix: null,
          matrixOrigin: origin,
          labels: get().labels,
          compNames: get().compNames,
          normalizationInfo: null,
          result: null,
          fileName: `${params.source.toUpperCase()}: ${params.query.trim()}`,
          documentCount: result.document_count,
          termCounts: result.term_counts,
          network: result.network,
          vosviewerJson: result.vosviewer_json || null,
          networksByYear: result.networks_by_year || null,
          cooccurrenceCsv: result.cooccurrence_csv || null,
          biblioActiveView: 'force',
          isPreprocessing: false,
          pendingProvenance: {
            originType: 'bibliometrics',
            unitName: params.source,
            indicatorsCount: get().dataMatrix[0]?.length || 0,
            indicatorsList: get().compNames
          },
          activeTrajectories: new Set(),
          entityColorOverrides: {},
          longitudinalResults: null,
          activeLongitudinalPeriod: ''
        });
        get().fetchSizeSuggestions(get().dataMatrix);
        return true;
      } else {
        alert("API Query error: " + (result?.error || "Unknown error"));
        return false;
      }
    } catch (err: any) {
      alert("API Query failed: " + (err.message || "Unknown error"));
      return false;
    } finally {
      set({ isPreprocessing: false, uploadProgress: null });
    }
  },

  vosRecluster: async (params) => {
    const { vosviewerJson } = get();
    if (!vosviewerJson) return { success: false, error: 'No network loaded.' };

    try {
      const response = await fetch('/api/preprocess/vos_recluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vosviewer_json: vosviewerJson,
          resolution: params.resolution,
          min_cluster_size: params.minClusterSize
        })
      });
      const result = await response.json();
      if (result.success && result.clusters) {
        return { success: true, clusters: result.clusters };
      }
      return { success: false, error: result.error || 'Recluster failed.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error.' };
    }
  },

  trainSOM: async (): Promise<boolean> => {
    const { dataMatrix, labels, config, hardware, incitesIsUploading } = get();
    if (incitesIsUploading) {
      alert("InCites files are currently being processed in the background. Please wait a moment until processing finishes before training SOM.");
      return false;
    }
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
        const trainedResult: TrainingResult = {
          weights: result.weights,
          umatrix: result.umatrix,
          clustering: result.clustering,
          frequencies: result.frequencies,
          quantizationErrors: result.quantization_errors,
          bmus: result.bmus,
          hexGrid: result.hex_grid,
          mappedLabels: result.mapped_labels,
          errors: result.errors,
          umap: get().result?.umap ?? null,
          umapSource: get().result?.umapSource ?? null
        };

        const state = get();
        const prov: DataProvenance = state.pendingProvenance || {
          originType: state.matrixOrigin === 'bipartite' || state.matrixOrigin === 'monothematic' ? 'bibliometrics' : 'csv_upload',
          unitName: state.fileName || 'Dataset',
          indicatorsCount: state.compNames.length,
          indicatorsList: state.compNames,
          smoothingInfo: state.isCmaSmoothingActive ? `CMA Window=${state.cmaWindowSize}` : 'RAW'
        };

        const runId = `run_${Date.now()}`;
        let defaultName = `${prov.unitName || 'Run'} (${config.rows}x${config.cols})`;
        if (prov.originType === 'incites' && prov.unitName) {
          defaultName = `[InCites] ${prov.unitName}${prov.subView ? ` - ${prov.subView}` : ''} (${config.rows}x${config.cols})`;
        } else if (prov.originType === 'bibliometrics') {
          defaultName = `[Bibliometrics] ${prov.unitName || 'Co-occ'} (${config.rows}x${config.cols})`;
        } else if (prov.originType === 'dimreduction') {
          defaultName = `[DimRed] ${prov.unitName || 'Reduced'} (${config.rows}x${config.cols})`;
        }

        const newRun: SomRun = {
          id: runId,
          name: defaultName,
          createdAt: new Date().toISOString(),
          provenance: prov,
          dataMatrix: [...state.dataMatrix],
          originalDataMatrix: state.originalDataMatrix ? [...state.originalDataMatrix] : null,
          labels: [...state.labels],
          compNames: [...state.compNames],
          normalizationInfo: state.normalizationInfo,
          matrixOrigin: state.matrixOrigin,
          fileName: state.fileName,
          config: { ...config },
          isCmaSmoothingActive: state.isCmaSmoothingActive,
          cmaWindowSize: state.cmaWindowSize,
          result: trainedResult,
          activeTrajectories: Array.from(state.activeTrajectories || []),
          entityColorOverrides: { ...state.entityColorOverrides }
        };

        set({
          result: trainedResult,
          isTraining: false,
          savedRuns: [...state.savedRuns, newRun],
          activeRunId: runId
        });
        return true;
      } else {
        alert("Training error: " + (result?.error || "Unknown error"));
        set({ isTraining: false });
        return false;
      }
    } catch (e) {
      console.error(e);
      if (get().incitesIsUploading) {
        alert("InCites is currently processing files on the backend. Please wait a moment for file parsing to complete before training.");
      } else {
        alert("Backend server is busy processing background data or unavailable. Please wait a moment and try again.");
      }
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
        weights: (config.umapDataSource as string) === 'original' || (config.umapDataSource as string) === 'data' ? dataMatrix : result.weights,
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

  trainLongitudinalSOM: async (): Promise<boolean> => {
    const { cooccurrenceMatricesByPeriod, config, hardware } = get();
    if (!cooccurrenceMatricesByPeriod || Object.keys(cooccurrenceMatricesByPeriod).length === 0) {
      alert("No hay matrices de subperiodos disponibles para el entrenamiento longitudinal.");
      return false;
    }

    set({ isTraining: true });
    try {
      const periodsData: Record<string, any> = {};
      for (const [period, item] of Object.entries(cooccurrenceMatricesByPeriod)) {
        periodsData[period] = {
          data: item.data,
          labels: item.labels,
          doc_count: item.doc_count
        };
      }

      const payload = {
        periods_data: periodsData,
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
        run_umap: true
      };

      const res = await fetch(getApiUrl('/api/som/train-longitudinal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resJson = await res.json();
      if (resJson?.success && resJson.maps) {
        const formattedMaps: Record<string, LongitudinalPeriodResult> = {};
        for (const [pKey, pMap] of Object.entries(resJson.maps as Record<string, any>)) {
          formattedMaps[pKey] = {
            period: pKey,
            training_phase: pMap.training_phase,
            iterations: pMap.iterations,
            doc_count: pMap.doc_count,
            weights: pMap.weights,
            umatrix: pMap.umatrix,
            clustering: pMap.clustering,
            frequencies: pMap.frequencies,
            quantizationErrors: pMap.quantization_errors,
            bmus: pMap.bmus,
            hexGrid: pMap.hex_grid,
            mappedLabels: pMap.mapped_labels,
            errors: pMap.errors,
            umap: pMap.umap || null,
            umapSource: pMap.umap_source || null,
            drift_from_prev: pMap.drift_from_prev
          };
        }

        const periodsList = resJson.periods || Object.keys(formattedMaps);
        const firstPeriod = periodsList[0] || '';

        set({
          longitudinalResults: {
            success: true,
            is_longitudinal: true,
            periods: periodsList,
            maps: formattedMaps,
            drift_metrics: resJson.drift_metrics || {}
          },
          activeLongitudinalPeriod: firstPeriod,
          isTraining: false
        });
        return true;
      } else {
        alert("Error en entrenamiento longitudinal: " + (resJson?.error || "Error desconocido"));
        set({ isTraining: false });
        return false;
      }
    } catch (e: any) {
      console.error(e);
      alert("Error al conectar con el servidor: " + (e.message || "Error desconocido"));
      set({ isTraining: false });
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
    const { result, activeRunId, savedRuns, config } = get();
    if (!result) return;
    
    // Create new result object with updated clustering array
    const newResult = {
      ...result,
      clustering: clustering
    };
    
    const newSavedRuns = savedRuns.map(run => {
      if (run.id === activeRunId) {
        return {
          ...run,
          config: { ...run.config, nClusters: config.nClusters },
          result: newResult
        };
      }
      return run;
    });

    set({ result: newResult, savedRuns: newSavedRuns });
  },

  getProjectPayload: () => {
    const state = get();
    return {
      version: '2.1',
      activeTab: state.activeTab,
      fileName: state.fileName,
      cloudProjectId: state.cloudProjectId,
      cloudProjectTitle: state.cloudProjectTitle,
      config: state.config,
      dataMatrix: state.dataMatrix,
      originalDataMatrix: state.originalDataMatrix,
      normalizationInfo: state.normalizationInfo,
      matrixOrigin: state.matrixOrigin,
      labels: state.labels,
      compNames: state.compNames,

      // Experiment History (Multi-Training Runs)
      savedRuns: state.savedRuns,
      activeRunId: state.activeRunId,
      pendingProvenance: state.pendingProvenance,

      // Preprocessed Bibliometrics
      documentCount: state.documentCount,
      termCounts: state.termCounts,
      network: state.network,
      vosviewerJson: state.vosviewerJson,
      networksByYear: state.networksByYear,
      cooccurrenceCsv: state.cooccurrenceCsv,
      pendingNetworkCsv: state.pendingNetworkCsv,
      pendingNetworkOrigin: state.pendingNetworkOrigin,
      cooccurrenceMatricesByPeriod: state.cooccurrenceMatricesByPeriod,
      temporalWindow: state.temporalWindow,
      temporalAnalysisMode: state.temporalAnalysisMode,
      longitudinalResults: state.longitudinalResults,
      activeLongitudinalPeriod: state.activeLongitudinalPeriod,
      result: state.result,
      isCmaSmoothingActive: state.isCmaSmoothingActive,
      cmaWindowSize: state.cmaWindowSize,

      // Semantic Bibliometrics
      semanticRecords: state.semanticRecords,
      semanticEmbeddings: state.semanticEmbeddings,
      semanticIntrinsicData: state.semanticIntrinsicData,
      semantic2DCoords: state.semantic2DCoords,
      semanticClusters: state.semanticClusters,
      semanticClusterAssignment: state.semanticClusterAssignment,
      semanticTargetD: state.semanticTargetD,
      semanticNumLevels: state.semanticNumLevels,
      semanticMinSize: state.semanticMinSize,
      semanticCeilingResult: state.semanticCeilingResult,
      semanticManualAlgo: state.semanticManualAlgo,
      semanticManualResult: state.semanticManualResult,
      semanticFileName: state.semanticFileName,
      semanticEmbedModel: state.semanticEmbedModel,

      // InCites Explorer State
      incitesUnitNames: state.incitesUnitNames,
      incitesUnitCache: state.incitesUnitCache,
      incitesActiveUnit: state.incitesActiveUnit,
      incitesSidebarTab: state.incitesSidebarTab,
      incitesBaseline: state.incitesBaseline,
      incitesSelectedBaselineSource: state.incitesSelectedBaselineSource,

      // Dimensionality Reduction State
      dimData: state.dimData,
      dimFileName: state.dimFileName,
      dimCeilingResult: state.dimCeilingResult,
      dimManualAlgo: state.dimManualAlgo,
      dimManualResult: state.dimManualResult,
      dimTargetD: state.dimTargetD,
      dimReducedData: state.dimReducedData,

      // PathSOM / Trajectories & Customizations
      activeTrajectories: Array.from(state.activeTrajectories || []),
      trajectoryLineWidth: state.trajectoryLineWidth,
      isTrajectoriesExpanded: state.isTrajectoriesExpanded,
      entityColorOverrides: state.entityColorOverrides,
      showLabelsOnUmapScatter: state.showLabelsOnUmapScatter,

      // UI Preferences
      exploSubTab: state.exploSubTab,
      exploUmapColorScale: state.exploUmapColorScale,
      exploSomColorScale: state.exploSomColorScale,
      biblioActiveView: state.biblioActiveView,
      biblioSelectedYear: state.biblioSelectedYear,
      showLabels: state.showLabels,
      labelSearchQuery: state.labelSearchQuery,
      excludedLabels: Array.from(state.excludedLabels || []),
      maxLabelsPerNeuron: state.maxLabelsPerNeuron,
      labelFontSizeScale: state.labelFontSizeScale,
      labelStyleOverrides: state.labelStyleOverrides,
      clusterLabels: state.clusterLabels,
      showClusterLabels: state.showClusterLabels,
      showLabelsOnComponents: state.showLabelsOnComponents,

      // AI Assistant & Scientific Reports State (Visual Snapshots, SVGs, Context & Dialogues)
      aiReport: useAiStore.getState().getReportPayload()
    };
  },

  exportProject: async () => {
    await get().ensureAllIncitesUnitsCached();
    const projectData = get().getProjectPayload();
    const jsonString = JSON.stringify(projectData);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `knoMap_project_${new Date().getTime()}.knoMap`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  importProject: (fileContent: string) => {
    try {
      const projectData = JSON.parse(fileContent);
      if (projectData.version || projectData.config || projectData.incitesUnitNames || projectData.result || projectData.dataMatrix) {
        set({
          activeTab: projectData.activeTab || get().activeTab,
          fileName: projectData.fileName ?? null,
          cloudProjectId: projectData.cloudProjectId || null,
          cloudProjectTitle: projectData.cloudProjectTitle || null,
          config: projectData.config || get().config,
          dataMatrix: projectData.dataMatrix || [],
          originalDataMatrix: projectData.originalDataMatrix || null,
          normalizationInfo: projectData.normalizationInfo || null,
          matrixOrigin: projectData.matrixOrigin || 'csv',
          labels: projectData.labels || [],
          compNames: projectData.compNames || [],

          // Experiment History (Multi-Training Runs)
          savedRuns: projectData.savedRuns || [],
          activeRunId: projectData.activeRunId || null,
          pendingProvenance: projectData.pendingProvenance || null,

          // Preprocessed Bibliometrics
          documentCount: projectData.documentCount || 0,
          termCounts: projectData.termCounts || {},
          network: projectData.network || null,
          vosviewerJson: projectData.vosviewerJson || null,
          networksByYear: projectData.networksByYear || null,
          cooccurrenceCsv: projectData.cooccurrenceCsv || null,
          pendingNetworkCsv: projectData.pendingNetworkCsv || null,
          pendingNetworkOrigin: projectData.pendingNetworkOrigin || null,
          result: projectData.result || null,
          isCmaSmoothingActive: projectData.isCmaSmoothingActive || false,
          cmaWindowSize: projectData.cmaWindowSize || 3,

          // Semantic Bibliometrics
          semanticRecords: projectData.semanticRecords || null,
          semanticEmbeddings: projectData.semanticEmbeddings || null,
          semanticIntrinsicData: projectData.semanticIntrinsicData || null,
          semantic2DCoords: projectData.semantic2DCoords || null,
          semanticClusters: projectData.semanticClusters || null,
          semanticClusterAssignment: projectData.semanticClusterAssignment || null,
          semanticTargetD: projectData.semanticTargetD ?? 2,
          semanticNumLevels: projectData.semanticNumLevels ?? 2,
          semanticMinSize: projectData.semanticMinSize ?? 5,
          semanticCeilingResult: projectData.semanticCeilingResult || null,
          semanticManualAlgo: projectData.semanticManualAlgo || 'pca',
          semanticManualResult: projectData.semanticManualResult || null,
          semanticFileName: projectData.semanticFileName || '',
          semanticEmbedModel: projectData.semanticEmbedModel || 'nomic',

          // InCites Explorer State
          incitesUnitNames: projectData.incitesUnitNames || null,
          incitesUnitCache: projectData.incitesUnitCache || {},
          incitesActiveUnit: projectData.incitesActiveUnit || null,
          incitesSidebarTab: projectData.incitesSidebarTab || 'profiles',
          incitesBaseline: projectData.incitesBaseline || null,
          incitesSelectedBaselineSource: projectData.incitesSelectedBaselineSource || null,

          // Dimensionality Reduction State
          dimData: projectData.dimData || null,
          dimFileName: projectData.dimFileName || '',
          dimCeilingResult: projectData.dimCeilingResult || null,
          dimManualAlgo: projectData.dimManualAlgo || 'pca',
          dimManualResult: projectData.dimManualResult || null,
          dimTargetD: projectData.dimTargetD ?? 2,
          dimReducedData: projectData.dimReducedData || null,

          // Longitudinal SOM & Subperiods
          temporalWindow: projectData.temporalWindow || 1,
          temporalAnalysisMode: projectData.temporalAnalysisMode || 'pathsom',
          cooccurrenceMatricesByPeriod: projectData.cooccurrenceMatricesByPeriod || null,
          longitudinalResults: projectData.longitudinalResults || null,
          activeLongitudinalPeriod: projectData.activeLongitudinalPeriod || (projectData.longitudinalResults?.periods?.[0] || ''),

          // PathSOM / Trajectories & Customizations
          activeTrajectories: new Set(projectData.activeTrajectories || []),
          trajectoryLineWidth: projectData.trajectoryLineWidth ?? 2,
          isTrajectoriesExpanded: projectData.isTrajectoriesExpanded ?? false,
          entityColorOverrides: projectData.entityColorOverrides || {},
          showLabelsOnUmapScatter: projectData.showLabelsOnUmapScatter ?? true,

          // UI Preferences
          exploSubTab: projectData.exploSubTab || 'import',
          exploUmapColorScale: projectData.exploUmapColorScale || 'standard',
          exploSomColorScale: projectData.exploSomColorScale || 'standard',
          biblioActiveView: projectData.biblioActiveView || 'force',
          biblioSelectedYear: projectData.biblioSelectedYear || 'Global',
          showLabels: projectData.showLabels ?? true,
          labelSearchQuery: projectData.labelSearchQuery || '',
          excludedLabels: new Set(projectData.excludedLabels || []),
          maxLabelsPerNeuron: projectData.maxLabelsPerNeuron ?? 3,
          labelFontSizeScale: projectData.labelFontSizeScale ?? 1.0,
          labelStyleOverrides: projectData.labelStyleOverrides || {},
          clusterLabels: projectData.clusterLabels || {},
          showClusterLabels: projectData.showClusterLabels ?? true,
          showLabelsOnComponents: projectData.showLabelsOnComponents ?? false
        });

        // Restore AI Assistant & Report State
        if (projectData.aiReport) {
          useAiStore.getState().loadReportPayload(projectData.aiReport, projectData.cloudProjectId || projectData.fileName);
        }
      } else {
        alert('Invalid or corrupted .knoMap file format.');
      }
    } catch (e) {
      console.error('Error importing project:', e);
      alert('Failed to parse .knoMap file.');
    }
  },

  clearProject: () => {
    useAiStore.getState().clearReport();
    set({
      fileName: null,
      dataMatrix: [],
      originalDataMatrix: null,
      normalizationInfo: null,
      matrixOrigin: 'csv',
      labels: [],
      compNames: [],

      // Experiment History
      savedRuns: [],
      activeRunId: null,
      pendingProvenance: null,

      // Bibliometrics
      documentCount: 0,
      termCounts: {},
      network: null,
      vosviewerJson: null,
      networksByYear: null,
      cooccurrenceCsv: null,
      pendingNetworkCsv: null,
      pendingNetworkOrigin: null,
      result: null,
      isCmaSmoothingActive: false,
      cmaWindowSize: 3,

      // Semantic Bibliometrics
      semanticRecords: null,
      semanticEmbeddings: null,
      semanticIntrinsicData: null,
      semantic2DCoords: null,
      semanticClusters: null,
      semanticClusterAssignment: null,
      semanticTargetD: 2,
      semanticNumLevels: 2,
      semanticMinSize: 5,
      semanticCeilingResult: null,
      semanticManualAlgo: 'pca',
      semanticManualResult: null,
      semanticFileName: '',
      semanticEmbedModel: 'nomic',

      // InCites Explorer State
      incitesUnitNames: null,
      incitesUnitCache: {},
      incitesActiveUnit: null,
      incitesSidebarTab: 'profiles',
      incitesBaseline: null,
      incitesSelectedBaselineSource: null,
      incitesIsUploading: false,

      // Dimensionality Reduction State
      dimData: null,
      dimFileName: '',
      dimCeilingResult: null,
      dimManualAlgo: 'TwoNN',
      dimManualResult: null,
      dimTargetD: 2,
      dimReducedData: null,

      // PathSOM & Trajectories
      activeTrajectories: new Set(),
      trajectoryLineWidth: 2,
      isTrajectoriesExpanded: false,
      entityColorOverrides: {},

      // UI Preferences
      labelSearchQuery: '',
      excludedLabels: new Set()
    });
  },

  estimateDimension: async (data: number[][], mode: 'ceiling' | 'manual', algorithmName?: string) => {
    try {
      const res = await fetch(getApiUrl('/api/dim/estimate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, mode, algorithmName })
      });
      const json = await res.json();
      return json;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  reduceDimension: async (data: number[][], targetD: number) => {
    try {
      const res = await fetch(getApiUrl('/api/dim/reduce'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, target_d: targetD })
      });
      const json = await res.json();
      return json;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  preprocessSemantic: async (file: File, useMesh: boolean, extraFields: string[], extractTitle: boolean, extractAbstract: boolean, extractKeywords: boolean) => {
    set({ isSemanticPreprocessing: true });
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('useMesh', useMesh.toString());
      formData.append('extractTitle', extractTitle.toString());
      formData.append('extractAbstract', extractAbstract.toString());
      formData.append('extractKeywords', extractKeywords.toString());
      formData.append('extraFields', extraFields.join(','));

      const res = await fetch(getApiUrl('/api/semantic/preprocess'), {
        method: 'POST',
        body: formData
      });
      const json = await res.json();
      if (json.success) {
        set({
          semanticRecords: json.records,
          semanticFileName: file.name,
          // Reset downstream states
          semanticEmbeddings: null,
          semanticIntrinsicData: null,
          semantic2DCoords: null,
          semanticClusters: null,
          semanticClusterAssignment: null,
          semanticCeilingResult: null,
          semanticManualResult: null
        });
      } else {
        alert("Preprocess error: " + json.error);
      }
    } catch (e: any) {
      alert("Connection failed: " + e.message);
    } finally {
      set({ isSemanticPreprocessing: false });
    }
  },

  generateSemanticEmbeddings: async () => {
    const { semanticRecords, semanticEmbedModel } = get();
    if (!semanticRecords || semanticRecords.length === 0) return;

    set({ isSemanticEmbedding: true });
    try {
      const res = await fetch(getApiUrl('/api/semantic/embed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: semanticRecords, model: semanticEmbedModel })
      });
      const json = await res.json();
      if (json.success) {
        set({
          semanticEmbeddings: json.embeddings,
          // Reset downstream states
          semanticIntrinsicData: null,
          semantic2DCoords: null,
          semanticClusters: null,
          semanticClusterAssignment: null
        });
      } else {
        alert("Embedding error: " + json.error);
      }
    } catch (e: any) {
      alert("Connection failed: " + e.message);
    } finally {
      set({ isSemanticEmbedding: false });
    }
  },

  estimateSemanticIntrinsicDim: async () => {
    const { semanticEmbeddings } = get();
    if (!semanticEmbeddings || semanticEmbeddings.length === 0) return;

    set({ isSemanticReducing: true });
    try {
      // Call reduce endpoint in estimate-only mode (no target_dim override)
      const res = await fetch(getApiUrl('/api/semantic/reduce'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeddings: semanticEmbeddings,
          estimate_mode: 'ceiling',
          algorithm_name: 'MLE',
          target_dim: 0  // 0 means: use the estimated dimension
        })
      });
      const json = await res.json();
      if (json.success) {
        set({
          semanticIntrinsicData: json.intrinsic_data,
          semantic2DCoords: json.coords_2d,
          semanticCeilingResult: {
            success: true,
            estimated_dimension: json.estimated_dimension,
            metrics: json.metrics
          },
          semanticTargetD: json.target_dim,
          // Reset downstream clustering
          semanticClusters: null,
          semanticClusterAssignment: null
        });
      } else {
        alert("Estimation error: " + json.error);
      }
    } catch (e: any) {
      alert("Connection failed: " + e.message);
    } finally {
      set({ isSemanticReducing: false });
    }
  },

  reduceSemanticDimension: async () => {
    const { semanticEmbeddings, semanticTargetD } = get();
    if (!semanticEmbeddings || semanticEmbeddings.length === 0) return;

    set({ isSemanticReducing: true });
    try {
      // Use manual target_dim (user may have adjusted after ceiling estimate)
      const res = await fetch(getApiUrl('/api/semantic/reduce'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeddings: semanticEmbeddings,
          estimate_mode: 'manual_k',  // skip re-estimation, use target_dim directly
          algorithm_name: 'MLE',
          target_dim: semanticTargetD
        })
      });
      const json = await res.json();
      if (json.success) {
        set({
          semanticIntrinsicData: json.intrinsic_data,
          semantic2DCoords: json.coords_2d,
          // Reset downstream clustering
          semanticClusters: null,
          semanticClusterAssignment: null
        });
      } else {
        alert("Reduction error: " + json.error);
      }
    } catch (e: any) {
      alert("Connection failed: " + e.message);
    } finally {
      set({ isSemanticReducing: false });
    }
  },

  clusterSemantic: async () => {
    const { semanticIntrinsicData, semantic2DCoords, semanticRecords, semanticNumLevels, semanticMinSize } = get();
    if (!semanticIntrinsicData || !semantic2DCoords || !semanticRecords) return;

    set({ isSemanticClustering: true });
    try {
      const res = await fetch(getApiUrl('/api/semantic/cluster'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intrinsic_data: semanticIntrinsicData,
          coords_2d: semantic2DCoords,
          records: semanticRecords,
          num_levels: semanticNumLevels,
          min_size: semanticMinSize
        })
      });
      const json = await res.json();
      if (json.success) {
        set({
          semanticClusters: json.clusters,
          semanticClusterAssignment: json.cluster_assignment
        });
      } else {
        alert("Clustering error: " + json.error);
      }
    } catch (e: any) {
      alert("Connection failed: " + e.message);
    } finally {
      set({ isSemanticClustering: false });
    }
  },

  setSemanticTargetD: (d: number) => set({ semanticTargetD: d }),
  setSemanticNumLevels: (l: number) => set({ semanticNumLevels: l }),
  setSemanticMinSize: (s: number) => set({ semanticMinSize: s }),
  setSemanticManualAlgo: (algo: string) => set({ semanticManualAlgo: algo }),
  setSemanticEmbedModel: (model: 'nomic' | 'specter') => set({ semanticEmbedModel: model }),
  
  clearSemanticState: () => set({
    semanticRecords: null,
    semanticEmbeddings: null,
    semanticIntrinsicData: null,
    semantic2DCoords: null,
    semanticClusters: null,
    semanticClusterAssignment: null,
    isSemanticPreprocessing: false,
    isSemanticEmbedding: false,
    isSemanticReducing: false,
    isSemanticClustering: false,
    semanticTargetD: 15,
    semanticNumLevels: 2,
    semanticMinSize: 10,
    semanticCeilingResult: null,
    semanticManualAlgo: 'TwoNN',
    semanticManualResult: null,
    semanticFileName: '',
    semanticEmbedModel: 'nomic'
  })
}));
