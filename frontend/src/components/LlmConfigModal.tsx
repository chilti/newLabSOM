import React, { useState, useEffect } from 'react';
import { useAiStore, DEFAULT_LLM_CONFIG } from '../store/aiStore';
import {
  Key, Server, Cpu, Check, AlertCircle, RefreshCw, Eye, EyeOff,
  Sparkles, X, ShieldCheck, Zap, Globe, Laptop
} from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  keyPlaceholder: string;
}

const PRESETS: Preset[] = [
  {
    id: 'unam',
    name: 'UNAM LDNL Server (Default)',
    desc: 'UNAM LDNL academic server (API key required)',
    icon: <Server className="w-4 h-4 text-indigo-400" />,
    baseUrl: 'https://dinamica1.fciencias.unam.mx/v1/',
    model: 'default',
    requiresKey: true,
    keyPlaceholder: 'Enter your API key'
  },
  {
    id: 'openai-mini',
    name: 'OpenAI (GPT-4o Mini)',
    desc: 'Fast, cost-effective high-intelligence model',
    icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    requiresKey: true,
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'openai-4o',
    name: 'OpenAI (GPT-4o)',
    desc: 'Flagship frontier reasoning model',
    icon: <Zap className="w-4 h-4 text-amber-400" />,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    requiresKey: true,
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'gemini-flash',
    name: 'Google AI (Gemini 2.0 Flash)',
    desc: 'Google Gemini 2.0 Flash: Sub-second latency and multimodal reasoning',
    icon: <Sparkles className="w-4 h-4 text-blue-400" />,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    requiresKey: true,
    keyPlaceholder: 'AIzaSy...'
  },
  {
    id: 'gemini-pro',
    name: 'Google AI (Gemini 1.5 Pro)',
    desc: 'Google Gemini 1.5 Pro: Deep reasoning & 2M token context window',
    icon: <Zap className="w-4 h-4 text-cyan-400" />,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-1.5-pro',
    requiresKey: true,
    keyPlaceholder: 'AIzaSy...'
  },
  {
    id: 'lm-studio',
    name: 'Local LM Studio',
    desc: 'Local inference running on your machine (Port 1234)',
    icon: <Laptop className="w-4 h-4 text-purple-400" />,
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    requiresKey: false,
    keyPlaceholder: 'Optional (e.g., lm-studio)'
  },
  {
    id: 'ollama',
    name: 'Local Ollama',
    desc: 'Local Ollama instance (Port 11434)',
    icon: <Cpu className="w-4 h-4 text-cyan-400" />,
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    requiresKey: false,
    keyPlaceholder: 'Optional (e.g., ollama)'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    desc: 'Unified gateway to DeepSeek, Llama 3.3, Claude, etc.',
    icon: <Globe className="w-4 h-4 text-pink-400" />,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    requiresKey: true,
    keyPlaceholder: 'sk-or-v1-...'
  }
];

export const LlmConfigModal: React.FC = () => {
  const {
    llmConfig,
    isLlmConfigModalOpen,
    closeLlmConfigModal,
    setLlmConfig,
    resetLlmConfig,
    testLlmConnection
  } = useAiStore();

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('custom');

  // Test status state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; model?: string } | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (isLlmConfigModalOpen) {
      setApiKey(llmConfig.apiKey || '');
      setBaseUrl(llmConfig.baseUrl || DEFAULT_LLM_CONFIG.baseUrl);
      setModel(llmConfig.model || DEFAULT_LLM_CONFIG.model);
      setTestResult(null);

      // Match preset
      const match = PRESETS.find(p => p.baseUrl.replace(/\/+$/, '') === (llmConfig.baseUrl || '').replace(/\/+$/, '') && p.model === llmConfig.model);
      setSelectedPresetId(match ? match.id : 'custom');
    }
  }, [isLlmConfigModalOpen, llmConfig]);

  if (!isLlmConfigModalOpen) return null;

  const handleSelectPreset = (preset: Preset) => {
    setSelectedPresetId(preset.id);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testLlmConnection({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        isCustom: true
      });
      setTestResult(result);
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || 'Error executing test request.'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const isCustom = (
      baseUrl.trim() !== DEFAULT_LLM_CONFIG.baseUrl ||
      model.trim() !== DEFAULT_LLM_CONFIG.model ||
      !!apiKey.trim()
    );

    setLlmConfig({
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || DEFAULT_LLM_CONFIG.baseUrl,
      model: model.trim() || DEFAULT_LLM_CONFIG.model,
      isCustom
    });

    closeLlmConfigModal();
  };

  const handleResetToDefault = () => {
    resetLlmConfig();
    setApiKey('');
    setBaseUrl(DEFAULT_LLM_CONFIG.baseUrl);
    setModel(DEFAULT_LLM_CONFIG.model);
    setSelectedPresetId('unam');
    setTestResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-950/40 overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-gray-800 flex items-center justify-between bg-gray-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-tr from-amber-500/20 to-indigo-500/20 border border-amber-500/30 rounded-2xl text-amber-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                AI Model & API Configuration
              </h2>
              <p className="text-xs text-gray-400">
                Configure your OpenAI API key or any OpenAI-compatible inference endpoint (LM Studio, Ollama, vLLM).
              </p>
            </div>
          </div>
          <button
            onClick={closeLlmConfigModal}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* Quick Presets */}
          <div>
            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">
              Quick Provider Presets
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-md shadow-indigo-950/50 ring-1 ring-indigo-500/50'
                        : 'bg-gray-950/60 border-gray-800 text-gray-300 hover:border-gray-700 hover:bg-gray-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1.5">
                      <div className="flex items-center space-x-2">
                        {preset.icon}
                        <span className="text-xs font-bold truncate">{preset.name}</span>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                    </div>
                    <span className="text-[10px] text-gray-500 line-clamp-2 leading-tight">
                      {preset.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4 bg-gray-950/70 p-4 rounded-2xl border border-gray-800/80">
            {/* API Key */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <span>API Key</span>
                  <span className="text-[10px] text-gray-500 font-normal">(Bearer Token / Google AI / OpenAI)</span>
                </label>
                <div className="flex items-center text-[10px] text-emerald-400 gap-1 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Cifrado en reposo (AES-GCM 256)</span>
                </div>
              </div>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="AIzaSy... / sk-... (dejar en blanco si tu servidor local no requiere clave)"
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-200"
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5">
                Base URL <span className="text-[10px] text-gray-500 font-normal">(OpenAI-Compatible endpoint)</span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setSelectedPresetId('custom');
                  setTestResult(null);
                }}
                placeholder="https://api.openai.com/v1"
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Model Name */}
            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5">
                Model Name <span className="text-[10px] text-gray-500 font-normal">(e.g., gpt-4o-mini, gpt-4o, openai/gpt-oss-20b)</span>
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSelectedPresetId('custom');
                  setTestResult(null);
                }}
                placeholder="gpt-4o-mini"
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Test Feedback Area */}
          {testResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-start space-x-2.5 animate-fadeIn ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/60 text-red-300'
              }`}
            >
              {testResult.success ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-bold">
                  {testResult.success ? '✓ Connection Verified' : '❌ Connection Failed'}
                </p>
                <p className="text-[11px] opacity-90 mt-0.5 whitespace-pre-wrap font-mono">
                  {testResult.message}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-950 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-xs font-bold rounded-xl transition flex items-center space-x-2 border border-gray-700"
            >
              {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
              <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetToDefault}
              className="px-3 py-2 text-gray-500 hover:text-gray-300 text-xs font-medium transition"
            >
              Reset to Default
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={closeLlmConfigModal}
              className="px-4 py-2 text-gray-400 hover:text-white text-xs font-semibold rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-950/50 transition"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
