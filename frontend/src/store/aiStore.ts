import { create } from 'zustand';
import { getApiUrl } from './somStore';
import { jsPDF } from 'jspdf';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  apiKey: '',
  baseUrl: 'https://dinamica1.fciencias.unam.mx/v1/',
  model: 'openai/gpt-oss-20b',
  isCustom: false
};

const LLM_CONFIG_STORAGE_KEY = 'knomap_llm_config';

const loadSavedLlmConfig = (): LlmConfig => {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        apiKey: parsed.apiKey || '',
        baseUrl: parsed.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
        model: parsed.model || DEFAULT_LLM_CONFIG.model,
        isCustom: !!parsed.isCustom
      };
    }
  } catch (e) {
    console.error('Failed to load LLM config from localStorage', e);
  }
  return { ...DEFAULT_LLM_CONFIG };
};

export interface StudyContext {
  title: string;
  description: string;
  updatedAt: string;
}

export interface ChartSnapshot {
  viewSource: 'som' | 'incites' | 'networks' | 'semantic' | 'dimreduction' | 'custom';
  chartType: 'hex_map' | 'bubble' | 'trend' | 'bar' | 'radar' | 'scatter' | 'network' | 'table' | 'custom';
  title: string;
  subtitle?: string;
  data: any;
  config?: {
    xAxisKey?: string;
    yAxisKey?: string;
    zAxisKey?: string;
    colorKey?: string;
    sizeKey?: string;
    seriesKeys?: string[];
    labels?: Record<string, string>;
    unit?: string;
    [key: string]: any;
  };
  thumbnailPng?: string | null;
  svgMarkup?: string | null;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ReportEntry {
  id: string;
  title: string;
  badge: string;
  snapshot: ChartSnapshot;
  dataContextPrompt: string;
  systemPrompt: string;
  messages: AiMessage[];
  createdAt: string;
  isAnalyzing?: boolean;
  error?: string | null;
}

interface AiState {
  studyContext: StudyContext | null;
  isContextModalOpen: boolean;
  llmConfig: LlmConfig;
  isLlmConfigModalOpen: boolean;
  entries: ReportEntry[];
  activeEntryId: string | null;
  currentProjectId: string;

  // Actions
  setStudyContext: (description: string, title?: string) => void;
  openContextModal: () => void;
  closeContextModal: () => void;
  setLlmConfig: (config: Partial<LlmConfig>) => void;
  resetLlmConfig: () => void;
  openLlmConfigModal: () => void;
  closeLlmConfigModal: () => void;
  testLlmConnection: (customConfig?: Partial<LlmConfig>) => Promise<{ success: boolean; message: string; model?: string }>;
  addReportEntry: (params: {
    title: string;
    badge?: string;
    snapshot: ChartSnapshot;
    dataContextPrompt: string;
    initialUserPrompt?: string;
    autoAnalyze?: boolean;
  }) => Promise<string>;
  sendMessage: (entryId: string, text: string) => Promise<void>;
  reanalyzeEntry: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string) => void;
  clearAllEntries: () => void;
  setActiveEntryId: (entryId: string | null) => void;
  exportReportMarkdown: () => string;
  exportReportPdf: () => Promise<void>;
  initForProject: (projectId?: string | null) => void;
  getReportPayload: () => { studyContext: StudyContext | null; entries: ReportEntry[]; activeEntryId: string | null };
  loadReportPayload: (payload: any, projectId?: string | null) => void;
  clearReport: () => void;
}

const STORAGE_PREFIX = 'knomap_ai_data_';

const getStorageKey = (projectId?: string | null) => {
  return `${STORAGE_PREFIX}${projectId || 'default'}`;
};

/**
 * Safely persists reports to browser localStorage, automatically pruning heavy base64
 * thumbnails when approaching the ~5MB quota limit so analysis calls never fail.
 */
const safePersistReport = (key: string, studyContext: StudyContext | null, entries: ReportEntry[]) => {
  try {
    // 1. Attempt standard full save
    localStorage.setItem(key, JSON.stringify({ studyContext, entries }));
    return;
  } catch (e: any) {
    console.warn('[aiStore] localStorage quota reached, pruning older thumbnails:', e?.message);
  }

  try {
    // 2. Strip heavy base64 thumbnailPng from older entries (keep only newest)
    const prunedEntries = entries.map((entry, idx) => {
      if (idx === entries.length - 1) return entry;
      return {
        ...entry,
        snapshot: {
          ...entry.snapshot,
          thumbnailPng: null
        }
      };
    });
    localStorage.setItem(key, JSON.stringify({ studyContext, entries: prunedEntries }));
    return;
  } catch (e: any) {
    console.warn('[aiStore] Pruned persistence failed, stripping all thumbnails from storage:', e?.message);
  }

  try {
    // 3. Strip all thumbnailPng from localStorage (in-memory state still retains them)
    const lightweightEntries = entries.map(entry => ({
      ...entry,
      snapshot: {
        ...entry.snapshot,
        thumbnailPng: null
      }
    }));
    localStorage.setItem(key, JSON.stringify({ studyContext, entries: lightweightEntries }));
    return;
  } catch (e: any) {
    console.warn('[aiStore] Lightweight persistence failed, keeping last 8 entries:', e?.message);
  }

  try {
    // 4. Keep only the last 8 entries
    const minimalEntries = entries.slice(-8).map(entry => ({
      ...entry,
      snapshot: {
        ...entry.snapshot,
        thumbnailPng: null
      }
    }));
    localStorage.setItem(key, JSON.stringify({ studyContext, entries: minimalEntries }));
  } catch (finalErr) {
    console.warn('[aiStore] Unable to persist to localStorage (quota exhausted):', finalErr);
  }
};

const buildDefaultSystemPrompt = (studyContext: StudyContext | null): string => {
  let prompt = `You are a senior scientific researcher, scientometrician, and academic co-author expert in quantitative analysis and complex visual data exploration on the KnoMap platform.

EDITORIAL AND STYLISTIC DIRECTIVES (MANDATORY):
1. Write your response with the formal, rigorous, objective, and analytical tone characteristic of the "Results and Discussion" section of a peer-reviewed scientific journal article (JCR / Scopus Q1).
2. Structure your analysis by writing EXACTLY two to three continuous paragraphs in fluent academic prose (do NOT use bulleted lists, dashes, or numbered lists):
   - First paragraph: Technical and structural description of the figure or map (topology, spatial distribution, parameter configurations, and observed global patterns).
   - Second paragraph: In-depth critical analysis of the empirical findings (density concentrations, outliers or anomalies, contrasts between clusters/categories, and key quantitative metrics).
   - Third paragraph: Scientometric/methodological interpretation and scientific implications (the significance of patterns in relation to the literature or domain under study, potential biases, and methodological insights).
3. Use formal academic transitions and discourse markers (e.g., "In alignment with...", "Furthermore, it is observed that...", "Consequently...", "This behavior suggests that...").
4. Always respond in English.\n\n`;

  if (studyContext && studyContext.description.trim()) {
    prompt += `SPECIFIC STUDY CONTEXT:\n`;
    if (studyContext.title) prompt += `Title/Theme: ${studyContext.title}\n`;
    prompt += `Objective & Field: ${studyContext.description}\n\n`;
    prompt += `Integrate this thematic context into your interpretation so that the analysis reads as if drafted specifically for this manuscript.`;
  }

  return prompt;
};

export const useAiStore = create<AiState>((set, get) => ({
  studyContext: null,
  isContextModalOpen: false,
  llmConfig: loadSavedLlmConfig(),
  isLlmConfigModalOpen: false,
  entries: [],
  activeEntryId: null,
  currentProjectId: 'default',

  setLlmConfig: (partial) => {
    const updated: LlmConfig = {
      ...get().llmConfig,
      ...partial,
      isCustom: partial.isCustom !== undefined ? partial.isCustom : (
        !!partial.apiKey || 
        (partial.baseUrl !== undefined && partial.baseUrl !== DEFAULT_LLM_CONFIG.baseUrl) ||
        (partial.model !== undefined && partial.model !== DEFAULT_LLM_CONFIG.model)
      )
    };
    set({ llmConfig: updated });
    try {
      localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to persist llmConfig to localStorage', e);
    }
  },

  resetLlmConfig: () => {
    const def = { ...DEFAULT_LLM_CONFIG };
    set({ llmConfig: def });
    try {
      localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(def));
    } catch (e) {
      console.error('Failed to reset llmConfig in localStorage', e);
    }
  },

  openLlmConfigModal: () => set({ isLlmConfigModalOpen: true }),
  closeLlmConfigModal: () => set({ isLlmConfigModalOpen: false }),

  testLlmConnection: async (customConfig) => {
    const configToTest = {
      ...get().llmConfig,
      ...customConfig
    };
    try {
      const res = await fetch(getApiUrl('/api/llm/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: configToTest.apiKey,
          baseUrl: configToTest.baseUrl,
          model: configToTest.model
        })
      });
      const data = await res.json();
      return {
        success: !!data.success,
        message: data.message || (data.success ? 'Connection successful!' : 'Connection failed'),
        model: data.model || configToTest.model
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message || 'Network error connecting to backend API.'
      };
    }
  },

  setStudyContext: (description: string, title: string = 'Research Study') => {
    const updated: StudyContext = {
      title: title.trim() || 'Research Study',
      description: description.trim(),
      updatedAt: new Date().toISOString()
    };
    set({ studyContext: updated });
    
    // Save to localStorage safely
    const key = getStorageKey(get().currentProjectId);
    safePersistReport(key, updated, get().entries);
  },

  openContextModal: () => set({ isContextModalOpen: true }),
  closeContextModal: () => set({ isContextModalOpen: false }),

  getReportPayload: () => ({
    studyContext: get().studyContext,
    entries: get().entries,
    activeEntryId: get().activeEntryId
  }),

  loadReportPayload: (payload: any, projectId?: string | null) => {
    if (!payload) return;
    const pid = projectId || get().currentProjectId || 'default';
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const studyContext = payload.studyContext || null;
    const activeEntryId = payload.activeEntryId || (entries.length > 0 ? entries[entries.length - 1].id : null);

    set({
      currentProjectId: pid,
      studyContext,
      entries,
      activeEntryId
    });

    const key = getStorageKey(pid);
    safePersistReport(key, studyContext, entries);
  },

  clearReport: () => {
    set({
      studyContext: null,
      entries: [],
      activeEntryId: null
    });
  },

  initForProject: (projectId?: string | null) => {
    const pid = projectId || 'default';
    try {
      const key = getStorageKey(pid);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          currentProjectId: pid,
          studyContext: parsed.studyContext || null,
          entries: parsed.entries || [],
          activeEntryId: parsed.entries?.length ? parsed.entries[parsed.entries.length - 1].id : null
        });
        return;
      }
    } catch (e) {
      console.error('Failed to load AI store for project:', pid, e);
    }

    set({
      currentProjectId: pid,
      studyContext: null,
      entries: [],
      activeEntryId: null
    });
  },

  addReportEntry: async (params) => {
    const { title, badge, snapshot, dataContextPrompt, initialUserPrompt, autoAnalyze = true } = params;
    const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newEntry: ReportEntry = {
      id: entryId,
      title: title || snapshot.title || 'Data Visualization',
      badge: badge || snapshot.viewSource.toUpperCase(),
      snapshot,
      dataContextPrompt,
      systemPrompt: buildDefaultSystemPrompt(get().studyContext),
      messages: [],
      createdAt: new Date().toISOString(),
      isAnalyzing: autoAnalyze,
      error: null
    };

    const updatedEntries = [...get().entries, newEntry];
    set({
      entries: updatedEntries,
      activeEntryId: entryId
    });

    // Save to localStorage safely
    const key = getStorageKey(get().currentProjectId);
    safePersistReport(key, get().studyContext, updatedEntries);

    if (autoAnalyze) {
      const userText = initialUserPrompt || `Write a two to three paragraph scientific analysis in peer-reviewed journal style discussing the figure "${newEntry.title}". Describe the overall observed structure, elaborate on the empirical quantitative contrasts and findings, and synthesize the methodological and scientometric implications.`;
      // Trigger analysis
      setTimeout(() => {
        get().sendMessage(entryId, userText);
      }, 50);
    }

    return entryId;
  },

  sendMessage: async (entryId: string, text: string) => {
    const state = get();
    const entryIndex = state.entries.findIndex(e => e.id === entryId);
    if (entryIndex === -1) return;

    const targetEntry = state.entries[entryIndex];
    const userMessage: AiMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    // Prepare multi-turn history
    const existingHistory = targetEntry.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Update UI state with user message and loading flag
    const updatedMessages = [...targetEntry.messages, userMessage];
    const updatedEntries = [...state.entries];
    updatedEntries[entryIndex] = {
      ...targetEntry,
      messages: updatedMessages,
      isAnalyzing: true,
      error: null
    };

    set({ entries: updatedEntries });

    try {
      const fullSystemPrompt = buildDefaultSystemPrompt(state.studyContext);

      // Structure the prompt with tabular data
      let fullUserPrompt = "";
      if (targetEntry.messages.length === 0) {
        fullUserPrompt = `=== STRUCTURED VISUALIZATION DATA ===\n${targetEntry.dataContextPrompt}\n======================================\n\nQuestion / Request:\n${text}`;
      } else {
        fullUserPrompt = text;
      }

      const reqPayload: any = {
        systemPrompt: fullSystemPrompt,
        userPrompt: fullUserPrompt,
        history: existingHistory
      };

      if (state.llmConfig) {
        if (state.llmConfig.apiKey) reqPayload.apiKey = state.llmConfig.apiKey;
        if (state.llmConfig.isCustom) {
          if (state.llmConfig.baseUrl) reqPayload.baseUrl = state.llmConfig.baseUrl;
          if (state.llmConfig.model) reqPayload.model = state.llmConfig.model;
        }
      }

      const res = await fetch(getApiUrl('/api/llm/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayload)
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Error calling AI model.');
      }

      const assistantMessage: AiMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: data.response || 'No response received from local model.',
        timestamp: new Date().toISOString()
      };

      const finalEntries = [...get().entries];
      const curIdx = finalEntries.findIndex(e => e.id === entryId);
      if (curIdx !== -1) {
        finalEntries[curIdx] = {
          ...finalEntries[curIdx],
          messages: [...finalEntries[curIdx].messages, assistantMessage],
          isAnalyzing: false,
          error: null
        };
        set({ entries: finalEntries });

        // Save to localStorage safely (never throws)
        const key = getStorageKey(get().currentProjectId);
        safePersistReport(key, get().studyContext, finalEntries);
      }
    } catch (err: any) {
      console.error('Error calling LLM analyze:', err);
      const finalEntries = [...get().entries];
      const curIdx = finalEntries.findIndex(e => e.id === entryId);
      if (curIdx !== -1) {
        finalEntries[curIdx] = {
          ...finalEntries[curIdx],
          isAnalyzing: false,
          error: err.message || 'Error communicating with AI service.'
        };
        set({ entries: finalEntries });
      }
    }
  },

  reanalyzeEntry: async (entryId: string) => {
    const state = get();
    const entry = state.entries.find(e => e.id === entryId);
    if (!entry) return;

    // Reset messages and send initial prompt
    const updatedEntries = state.entries.map(e => {
      if (e.id === entryId) {
        return {
          ...e,
          messages: [],
          isAnalyzing: true,
          error: null
        };
      }
      return e;
    });

    set({ entries: updatedEntries });
    const prompt = `Write a two to three paragraph scientific analysis in peer-reviewed journal style discussing the figure "${entry.title}". Describe the overall observed structure, elaborate on the empirical quantitative contrasts and findings, and synthesize the methodological and scientometric implications.`;
    await get().sendMessage(entryId, prompt);
  },

  deleteEntry: (entryId: string) => {
    const currentEntries = get().entries;
    const updatedEntries = currentEntries.filter(e => e.id !== entryId);
    let nextActiveId = get().activeEntryId;

    if (nextActiveId === entryId) {
      nextActiveId = updatedEntries.length > 0 ? updatedEntries[updatedEntries.length - 1].id : null;
    }

    set({
      entries: updatedEntries,
      activeEntryId: nextActiveId
    });

    // Save to localStorage safely
    const key = getStorageKey(get().currentProjectId);
    safePersistReport(key, get().studyContext, updatedEntries);
  },

  clearAllEntries: () => {
    set({ entries: [], activeEntryId: null });
    const key = getStorageKey(get().currentProjectId);
    safePersistReport(key, get().studyContext, []);
  },

  setActiveEntryId: (entryId: string | null) => {
    set({ activeEntryId: entryId });
  },

  exportReportMarkdown: () => {
    const { studyContext, entries } = get();
    let md = `# Scientific & Bibliometric Report - KnoMap\n\n`;
    md += `*Automatically generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}*\n\n`;

    if (studyContext && studyContext.description.trim()) {
      md += `## 🎯 Study Context\n\n`;
      if (studyContext.title) md += `**Title:** ${studyContext.title}\n\n`;
      md += `${studyContext.description}\n\n`;
      md += `---\n\n`;
    }

    if (entries.length === 0) {
      md += `*No visualizations currently added to the report.*\n`;
      return md;
    }

    md += `## 📊 Analyzed Visualizations & Sections (${entries.length})\n\n`;

    entries.forEach((entry, idx) => {
      md += `### ${idx + 1}. ${entry.title} [${entry.badge}]\n\n`;
      md += `*Added: ${new Date(entry.createdAt).toLocaleString()}*\n\n`;

      if (entry.dataContextPrompt) {
        md += `#### Visualization Data\n\n\`\`\`\n${entry.dataContextPrompt}\n\`\`\`\n\n`;
      }

      if (entry.messages && entry.messages.length > 0) {
        md += `#### 🤖 Analysis & Discussion\n\n`;
        entry.messages.forEach(msg => {
          if (msg.role === 'assistant') {
            md += `**AI Assistant:**\n\n${msg.content}\n\n`;
          } else {
            md += `> **Researcher Question:** *${msg.content}*\n\n`;
          }
        });
      }

      md += `---\n\n`;
    });

    return md;
  },

  exportReportPdf: async () => {
    const { studyContext, entries } = get();
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let currentY = 20;

    // Header
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text('Scientific & Bibliometric Report', margin, currentY);
    currentY += 8;

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`KnoMap Analytics • ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, margin, currentY);
    currentY += 12;

    // Context section
    if (studyContext && studyContext.description.trim()) {
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, currentY, contentWidth, 24, 2, 2, 'F');
      
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(`Context: ${studyContext.title || 'General Study'}`, margin + 4, currentY + 7);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const splitDesc = doc.splitTextToSize(studyContext.description, contentWidth - 8);
      doc.text(splitDesc.slice(0, 3), margin + 4, currentY + 14);
      currentY += 30;
    }

    // Entries
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      
      // Page break check
      if (currentY > 240) {
        doc.addPage();
        currentY = 20;
      }

      // Title
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 58, 138);
      doc.text(`${i + 1}. ${entry.title}`, margin, currentY);
      currentY += 6;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 116, 139);
      doc.text(`Source: ${entry.badge} • ${new Date(entry.createdAt).toLocaleDateString()}`, margin, currentY);
      currentY += 8;

      // Render thumbnail image if available
      if (entry.snapshot.thumbnailPng) {
        try {
          const imgProps = doc.getImageProperties(entry.snapshot.thumbnailPng);
          const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
          const clampedHeight = Math.min(imgHeight, 80);

          if (currentY + clampedHeight > 260) {
            doc.addPage();
            currentY = 20;
          }

          doc.addImage(entry.snapshot.thumbnailPng, 'PNG', margin, currentY, contentWidth, clampedHeight);
          currentY += clampedHeight + 8;
        } catch (e) {
          console.warn('Could not add image to PDF', e);
        }
      }

      // Analysis Text
      const assistantMsgs = entry.messages.filter(m => m.role === 'assistant');
      if (assistantMsgs.length > 0) {
        const text = assistantMsgs.map(m => m.content).join('\n\n');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);

        const lines = doc.splitTextToSize(text, contentWidth);
        for (const line of lines) {
          if (currentY > 270) {
            doc.addPage();
            currentY = 20;
          }
          doc.text(line, margin, currentY);
          currentY += 5;
        }
      }

      currentY += 10;
    }

    doc.save(`KnoMap_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  }
}));

// Initialize store from localStorage on load
if (typeof window !== 'undefined') {
  useAiStore.getState().initForProject('default');
}
