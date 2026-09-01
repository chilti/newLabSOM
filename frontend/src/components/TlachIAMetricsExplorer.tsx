import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
    Upload, Activity, BarChart2, Loader2, Download, Database, TrendingUp, 
    Sparkles, ShieldCheck, Globe, Network, BookOpen
} from "lucide-react";
import { useSomStore } from "../store/somStore";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
    ScatterChart, Scatter, Cell
} from "recharts";
import chroma from "chroma-js";
import { SendToAssistantButton } from "./SendToAssistantButton";
import { exportChartAsSVG, exportChartAsPNG } from "../utils/chartExport";

const ExportButtons: React.FC<{ 
    containerId: string; 
    filename: string;
    chartTitle?: string;
    chartType?: "bubble" | "trend" | "bar" | "radar" | "scatter" | "network" | "table" | "custom";
    chartData?: any;
    dataPrompt?: string;
}> = ({ containerId, filename, chartTitle, chartType = "trend", chartData, dataPrompt }) => {
    const formattedTitle = chartTitle || filename.replace(/_/g, " ").toUpperCase();
    const promptText = dataPrompt || (chartData ? `Datos de la visualización ${formattedTitle}:\n\`\`\`json\n${typeof chartData === "string" ? chartData : JSON.stringify(chartData, null, 2).slice(0, 3500)}\n\`\`\`` : `Gráfica generada en TlachIA Metrics Explorer: ${formattedTitle}`);

    return (
        <div className="flex items-center space-x-1.5 shrink-0">
            <SendToAssistantButton
                title={formattedTitle}
                badge="TLACHIA"
                viewSource="custom"
                chartType={chartType}
                targetElementId={containerId}
                data={chartData || []}
                dataContextPrompt={promptText}
                buttonText="AI Assistant"
            />
            <button
                onClick={() => exportChartAsSVG(containerId, filename)}
                className="px-2 py-1 text-[10px] font-bold bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 flex items-center space-x-1 transition-all shadow-sm"
                title="Export as SVG"
            >
                <Download className="w-3 h-3 text-cyan-400" />
                <span>SVG</span>
            </button>
            <button
                onClick={() => exportChartAsPNG(containerId, filename)}
                className="px-2 py-1 text-[10px] font-bold bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 flex items-center space-x-1 transition-all shadow-sm"
                title="Export as PNG"
            >
                <Download className="w-3 h-3 text-emerald-400" />
                <span>PNG</span>
            </button>
        </div>
    );
};

const parseVal = (raw: any): number => {
    if (typeof raw === "number") return isNaN(raw) ? 0 : raw;
    if (typeof raw === "string") return parseFloat(raw.replace("%", "").replace(",", ".").trim()) || 0;
    return 0;
};

const TlachIAUnitPanel: React.FC<{ unitName: string; unit: any }> = ({ unitName, unit }) => {
    const { 
        loadCsvData, 
        setActiveTab, 
        tlachiaSidebarTab, 
        setTlachiaState,
        tlachiaLimitTop50,
        tlachiaFilterIndicator,
        tlachiaFilterMinValue,
        tlachiaIsFilterActive
    } = useSomStore();
    
    const sidebarTab = tlachiaSidebarTab || "profiles";
    const setSidebarTab = (tab: "profiles" | "temporal") => setTlachiaState({ tlachiaSidebarTab: tab });

    const limitTop50 = tlachiaLimitTop50 !== undefined ? tlachiaLimitTop50 : true;
    const filterIndicator = tlachiaFilterIndicator || (unit?.indicators?.includes("Documents") ? "Documents" : (unit?.indicators?.[0] || ""));
    const filterMinValue = tlachiaFilterMinValue ?? "";
    const isFilterActive = tlachiaIsFilterActive || false;

    const [selectedProfileIndicators, setSelectedProfileIndicators] = useState<string[]>([]);
    const [tsIndicator, setTsIndicator] = useState<string>("");
    const [tsSmoothing, setTsSmoothing] = useState<"raw" | "ecma3" | "ecma5">("raw");
    const [useRecent, setUseRecent] = useState<boolean>(false);
    
    // Bubble Chart state
    const [bubbleIndX, setBubbleIndX] = useState<string>("");
    const [bubbleIndY, setBubbleIndY] = useState<string>("");
    const [bubbleIndSize, setBubbleIndSize] = useState<string>("");
    const [bubbleIndColor, setBubbleIndColor] = useState<string>("");

    useEffect(() => {
        if (!unit) return;
        if (unit.indicators && unit.indicators.length > 0) {
            const defaultsExact = ["Documents", "Times Cited", "Category Normalized Citation Impact", "% Documents in Top 10%", "H-Index", "i10-Index", "% All Open Access Documents", "% Free to Read / Diamond Documents"];
            let initialSelected = unit.indicators.filter((ind: string) => defaultsExact.includes(ind));
            if (initialSelected.length === 0) initialSelected = unit.indicators.slice(0, 6);
            setSelectedProfileIndicators(initialSelected);

            setTsIndicator(unit.indicators.includes("Documents") ? "Documents" : unit.indicators[0]);
            setBubbleIndX(unit.indicators.includes("Documents") ? "Documents" : unit.indicators[0]);
            setBubbleIndY(unit.indicators.includes("Times Cited") ? "Times Cited" : (unit.indicators[1] || unit.indicators[0]));
            setBubbleIndSize(unit.indicators.includes("Category Normalized Citation Impact") ? "Category Normalized Citation Impact" : (unit.indicators[2] || unit.indicators[0]));
            setBubbleIndColor(unit.indicators.includes("% Free to Read / Diamond Documents") ? "% Free to Read / Diamond Documents" : (unit.indicators[3] || unit.indicators[0]));
        }
    }, [unit]);

    const activeProfileRaw = useRecent ? (unit.profile_5years || []) : (unit.profile || []);

    const activeProfile = useMemo(() => {
        let list = [...activeProfileRaw];
        if (isFilterActive && filterIndicator && filterMinValue !== "") {
            const minNum = parseFloat(String(filterMinValue));
            if (!isNaN(minNum)) {
                list = list.filter((r: any) => parseVal(r[filterIndicator]) >= minNum);
            }
        }
        if (limitTop50) {
            list = list.slice(0, 50);
        }
        return list;
    }, [activeProfileRaw, isFilterActive, filterIndicator, filterMinValue, limitTop50]);

    // Send Profile Data to SOM
    const handleSendProfileToSom = () => {
        if (!activeProfile || activeProfile.length === 0 || selectedProfileIndicators.length === 0) {
            alert("Seleccione al menos una fila y un indicador para enviar a SOM.");
            return;
        }
        const headers = ["Entity", ...selectedProfileIndicators];
        const lines = [headers.join(",")];
        activeProfile.forEach((r: any) => {
            const rowVals = [
                `"${String(r.entity).replace(/"/g, "")}"`,
                ...selectedProfileIndicators.map(ind => parseVal(r[ind]))
            ];
            lines.push(rowVals.join(","));
        });
        const csvContent = lines.join("\n");
        loadCsvData(csvContent, 0, [], "csv", `${unitName} - Indicators Profile`, {
            originType: "tlachia",
            unitName: unitName,
            subView: useRecent ? "Profile 2021-2025" : "Full Profile",
            indicatorsCount: selectedProfileIndicators.length,
            indicatorsList: selectedProfileIndicators
        });
        setActiveTab("multidimensional");
    };

    return (
        <div className="flex-1 flex flex-col min-w-0 bg-gray-950 text-gray-100 overflow-hidden">
            {/* Unit Action Bar */}
            <div className="bg-gray-900/80 border-b border-gray-800/80 px-6 py-3 flex items-center justify-between backdrop-blur-md">
                <div className="flex items-center space-x-3">
                    <span className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 rounded-xl border border-cyan-500/30 text-cyan-400 shadow-inner">
                        <Database className="w-5 h-5" />
                    </span>
                    <div>
                        <h2 className="text-base font-bold text-white tracking-wide flex items-center space-x-2">
                            <span>{unitName}</span>
                            <span className="text-[10px] px-2 py-0.5 bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 rounded-full font-mono">
                                {activeProfile.length} entidades
                            </span>
                        </h2>
                        <p className="text-xs text-gray-400">Indicadores Cienciométricos & Ciencia Abierta OpenAlex</p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {/* View switcher */}
                    <div className="flex bg-gray-800/80 p-0.5 rounded-lg border border-gray-700/60 text-xs">
                        <button
                            onClick={() => setSidebarTab("profiles")}
                            className={`px-3 py-1.5 rounded-md font-semibold transition-all ${sidebarTab === "profiles" ? "bg-cyan-600 text-white shadow" : "text-gray-400 hover:text-gray-200"}`}
                        >
                            📊 Perfiles Multidimensionales
                        </button>
                        <button
                            onClick={() => setSidebarTab("temporal")}
                            className={`px-3 py-1.5 rounded-md font-semibold transition-all ${sidebarTab === "temporal" ? "bg-cyan-600 text-white shadow" : "text-gray-400 hover:text-gray-200"}`}
                        >
                            📈 Series Temporales (Trend)
                        </button>
                    </div>

                    <button
                        onClick={handleSendProfileToSom}
                        className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold rounded-lg shadow-lg flex items-center space-x-1.5 transition-all border border-cyan-400/30"
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Entrenar SOM</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {sidebarTab === "profiles" ? (
                    <div className="space-y-6">
                        {/* Summary Metric Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-gray-900/60 border border-cyan-500/20 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                                <div className="flex items-center justify-between text-xs text-cyan-400 font-semibold mb-1">
                                    <span>Total Entidades</span>
                                    <Globe className="w-4 h-4" />
                                </div>
                                <div className="text-2xl font-black text-white font-mono">{activeProfile.length}</div>
                                <div className="text-[11px] text-gray-400 mt-1">Registradas en el corpus</div>
                            </div>
                            <div className="bg-gray-900/60 border border-emerald-500/20 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                                <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold mb-1">
                                    <span>Indicadores Disponibles</span>
                                    <Activity className="w-4 h-4" />
                                </div>
                                <div className="text-2xl font-black text-white font-mono">{unit?.indicators?.length || 0}</div>
                                <div className="text-[11px] text-gray-400 mt-1">Métricas calculadas</div>
                            </div>
                            <div className="bg-gray-900/60 border border-amber-500/20 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                                <div className="flex items-center justify-between text-xs text-amber-400 font-semibold mb-1">
                                    <span>Ventana Activa</span>
                                    <TrendingUp className="w-4 h-4" />
                                </div>
                                <div className="text-lg font-bold text-white flex items-center space-x-2 mt-1">
                                    <button 
                                        onClick={() => setUseRecent(!useRecent)}
                                        className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30 hover:bg-amber-500/30 transition-all"
                                    >
                                        {useRecent ? "Lustro Reciente (2021-2025)" : "Histórico Acumulado Total"}
                                    </button>
                                </div>
                            </div>
                            <div className="bg-gray-900/60 border border-indigo-500/20 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                                <div className="flex items-center justify-between text-xs text-indigo-400 font-semibold mb-1">
                                    <span>Ciencia Abierta & APC</span>
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                                <div className="text-xs text-indigo-300 font-medium mt-1">
                                    Evaluación Diamante vs APC y Redes Sur-Sur
                                </div>
                            </div>
                        </div>

                        {/* Interactive 4D Bubble Chart */}
                        <div id="tlachia-bubble-container" className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 shadow-lg space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                                <div className="flex items-center space-x-2">
                                    <BarChart2 className="w-5 h-5 text-cyan-400" />
                                    <h3 className="text-sm font-bold text-white tracking-wide">Mapa Multidimensional 4D (Dispersión)</h3>
                                </div>
                                <ExportButtons 
                                    containerId="tlachia-bubble-container" 
                                    filename={`${unitName}_bubble_chart`} 
                                    chartTitle={`Mapa 4D - ${unitName}`}
                                    chartType="scatter"
                                    chartData={activeProfile.slice(0, 40)}
                                />
                            </div>

                            {/* Chart Controls */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-gray-950/60 p-3 rounded-xl border border-gray-800/80">
                                <div>
                                    <label className="text-gray-400 font-semibold block mb-1">Eje X:</label>
                                    <select 
                                        value={bubbleIndX} 
                                        onChange={e => setBubbleIndX(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-1"
                                    >
                                        {(unit.indicators || []).map((ind: string) => <option key={ind} value={ind}>{ind}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-gray-400 font-semibold block mb-1">Eje Y:</label>
                                    <select 
                                        value={bubbleIndY} 
                                        onChange={e => setBubbleIndY(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-1"
                                    >
                                        {(unit.indicators || []).map((ind: string) => <option key={ind} value={ind}>{ind}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-gray-400 font-semibold block mb-1">Tamaño de Burbuja:</label>
                                    <select 
                                        value={bubbleIndSize} 
                                        onChange={e => setBubbleIndSize(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-1"
                                    >
                                        {(unit.indicators || []).map((ind: string) => <option key={ind} value={ind}>{ind}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-gray-400 font-semibold block mb-1">Escala de Color:</label>
                                    <select 
                                        value={bubbleIndColor} 
                                        onChange={e => setBubbleIndColor(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-1"
                                    >
                                        {(unit.indicators || []).map((ind: string) => <option key={ind} value={ind}>{ind}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Recharts Scatter Plot */}
                            <div className="h-80 w-full pt-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                        <XAxis 
                                            type="number" 
                                            dataKey="x" 
                                            name={bubbleIndX} 
                                            stroke="#9CA3AF" 
                                            label={{ value: bubbleIndX, position: "insideBottom", offset: -10, fill: "#9CA3AF", fontSize: 11 }}
                                        />
                                        <YAxis 
                                            type="number" 
                                            dataKey="y" 
                                            name={bubbleIndY} 
                                            stroke="#9CA3AF" 
                                            label={{ value: bubbleIndY, angle: -90, position: "insideLeft", fill: "#9CA3AF", fontSize: 11 }}
                                        />
                                        <RechartsTooltip 
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl text-xs text-gray-200">
                                                            <div className="font-bold text-white mb-1">{d.entity}</div>
                                                            <div><span className="text-gray-400">{bubbleIndX}:</span> {d.x}</div>
                                                            <div><span className="text-gray-400">{bubbleIndY}:</span> {d.y}</div>
                                                            <div><span className="text-gray-400">{bubbleIndSize}:</span> {d.sizeVal}</div>
                                                            <div><span className="text-gray-400">{bubbleIndColor}:</span> {d.colorVal}</div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Scatter 
                                            name={unitName} 
                                            data={activeProfile.slice(0, 45).map((r: any) => ({
                                                entity: r.entity,
                                                x: parseVal(r[bubbleIndX]),
                                                y: parseVal(r[bubbleIndY]),
                                                sizeVal: parseVal(r[bubbleIndSize]),
                                                colorVal: parseVal(r[bubbleIndColor]),
                                                z: Math.max(8, Math.min(45, parseVal(r[bubbleIndSize]) * 3))
                                            }))}
                                            fill="#06B6D4"
                                        >
                                            {activeProfile.slice(0, 45).map((entry: any, index: number) => {
                                                const colorScale = chroma.scale(["#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"]).mode("lch");
                                                const vals = activeProfile.slice(0, 45).map((p: any) => parseVal(p[bubbleIndColor]));
                                                const minV = Math.min(...vals) || 0;
                                                const maxV = Math.max(...vals) || 1;
                                                const norm = maxV > minV ? (parseVal(entry[bubbleIndColor]) - minV) / (maxV - minV) : 0.5;
                                                return <Cell key={`cell-${index}`} fill={colorScale(norm).hex()} />;
                                            })}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Complete Metrics Table */}
                        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 shadow-lg space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                                <div className="flex items-center space-x-2">
                                    <Database className="w-5 h-5 text-indigo-400" />
                                    <h3 className="text-sm font-bold text-white tracking-wide">Tabla de Indicadores Consolidados</h3>
                                </div>
                                <div className="text-xs text-gray-400">
                                    {selectedProfileIndicators.length} de {unit?.indicators?.length || 0} columnas visibles
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-gray-800">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-gray-950 text-gray-300 font-semibold border-b border-gray-800">
                                            <th className="py-2.5 px-3 sticky left-0 bg-gray-950 z-10">Entidad</th>
                                            {selectedProfileIndicators.map(ind => (
                                                <th key={ind} className="py-2.5 px-3 whitespace-nowrap text-right">{ind}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/60 font-mono">
                                        {activeProfile.slice(0, 50).map((row: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-gray-800/40 transition-colors">
                                                <td className="py-2 px-3 font-sans font-medium text-white sticky left-0 bg-gray-900/90 z-10 max-w-[240px] truncate">
                                                    {row.entity}
                                                </td>
                                                {selectedProfileIndicators.map(ind => {
                                                    const val = row[ind];
                                                    const num = parseVal(val);
                                                    const isPct = ind.includes("%") || ind.includes("Percentile");
                                                    return (
                                                        <td key={ind} className="py-2 px-3 text-right text-gray-300">
                                                            {isPct ? `${num.toFixed(1)}%` : (Number.isInteger(num) ? num.toLocaleString() : num.toFixed(2))}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Temporal Series Tab */
                    <div className="space-y-6">
                        <div id="tlachia-trend-container" className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 shadow-lg space-y-4">
                            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                                <div className="flex items-center space-x-2">
                                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                                    <h3 className="text-sm font-bold text-white tracking-wide">Evolución Anual (Series de Tiempo)</h3>
                                </div>
                                <ExportButtons 
                                    containerId="tlachia-trend-container" 
                                    filename={`${unitName}_annual_trend`} 
                                    chartTitle={`Tendencia Anual - ${unitName}`}
                                    chartType="trend"
                                    chartData={unit.time_series?.[tsIndicator] || []}
                                />
                            </div>

                            <div className="flex items-center space-x-4 text-xs">
                                <label className="text-gray-400 font-semibold">Métrica:</label>
                                <select 
                                    value={tsIndicator} 
                                    onChange={e => setTsIndicator(e.target.value)}
                                    className="bg-gray-900 border border-gray-700 text-gray-200 rounded px-3 py-1"
                                >
                                    {Object.keys(unit.time_series || {}).map(ind => (
                                        <option key={ind} value={ind}>{ind}</option>
                                    ))}
                                </select>

                                <div className="flex bg-gray-800 p-0.5 rounded-lg border border-gray-700">
                                    {(["raw", "ecma3", "ecma5"] as const).map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setTsSmoothing(mode)}
                                            className={`px-2.5 py-1 rounded text-[11px] font-bold ${tsSmoothing === mode ? "bg-emerald-600 text-white" : "text-gray-400"}`}
                                        >
                                            {mode.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="h-80 w-full pt-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                        <XAxis dataKey="time" stroke="#9CA3AF" />
                                        <YAxis stroke="#9CA3AF" />
                                        <RechartsTooltip contentStyle={{ backgroundColor: "#111827", borderColor: "#374151", color: "#fff" }} />
                                        <Legend />
                                        {(unit.time_series?.[tsIndicator] || []).slice(0, 8).map((serie: any, idx: number) => {
                                            const colors = ["#06b6d4", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#3b82f6", "#14b8a6", "#f97316"];
                                            const lineData = serie.times.map((t: string, i: number) => ({
                                                time: t,
                                                [serie.entity]: serie[tsSmoothing]?.[i] ?? serie.raw[i]
                                            }));
                                            return (
                                                <Line 
                                                    key={serie.entity} 
                                                    data={lineData} 
                                                    type="monotone" 
                                                    dataKey={serie.entity} 
                                                    stroke={colors[idx % colors.length]} 
                                                    strokeWidth={2}
                                                    dot={{ r: 3 }}
                                                />
                                            );
                                        })}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const TlachIAMetricsExplorer: React.FC = () => {
    const { 
        tlachiaUnitNames, 
        tlachiaActiveUnit, 
        tlachiaUnitCache, 
        tlachiaIsUploading, 
        uploadTlachIAFiles, 
        setTlachiaState,
        documentCount,
        setActiveTab
    } = useSomStore();

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const formData = new FormData();
        Array.from(e.target.files).forEach(f => formData.append("files", f));
        await uploadTlachIAFiles(formData);
    };

    const currentUnitData = tlachiaActiveUnit ? tlachiaUnitCache[tlachiaActiveUnit] : null;

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-gray-950 text-gray-100">
            {/* Top Bar / Upload header */}
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-gradient-to-br from-cyan-600 to-blue-700 rounded-xl text-white shadow-md">
                        <Database className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center space-x-2">
                            <h1 className="text-lg font-black text-white tracking-wide">TlachIA Metrics</h1>
                            <span className="text-[10px] px-2 py-0.5 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30 rounded-full font-mono font-bold">
                                OpenAlex ClickHouse Engine
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Explorador de producción, impacto normalizado, ciencia abierta diamante, APC y redes
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    {/* OpenAlex JSON Status Pill */}
                    {documentCount > 0 && (
                        <div className="hidden lg:flex items-center space-x-2 bg-gray-800/80 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span className="text-gray-300">Corpus: <strong className="text-emerald-400 font-mono">{documentCount.toLocaleString()}</strong> artículos</span>
                            <button
                                onClick={() => setActiveTab("bibliometrics")}
                                className="ml-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 underline flex items-center space-x-1"
                            >
                                <Network className="w-3 h-3" />
                                <span>Ver Redes</span>
                            </button>
                            <button
                                onClick={() => setActiveTab("semantic_bibliometrics")}
                                className="ml-1 text-[11px] font-bold text-purple-400 hover:text-purple-300 underline flex items-center space-x-1"
                            >
                                <BookOpen className="w-3 h-3" />
                                <span>Ver Semántica</span>
                            </button>
                        </div>
                    )}

                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept=".zip,.xlsx,.csv" 
                        multiple 
                        className="hidden" 
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={tlachiaIsUploading}
                        className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center space-x-2 transition-all border border-cyan-400/30 disabled:opacity-50"
                    >
                        {tlachiaIsUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span>{tlachiaIsUploading ? "Procesando..." : "Cargar Paquete TlachIA (.zip)"}</span>
                    </button>
                </div>
            </div>

            {/* Navigation Tabs by Entity */}
            {tlachiaUnitNames && tlachiaUnitNames.length > 0 && (
                <div className="bg-gray-900/90 border-b border-gray-800 px-6 py-2 overflow-x-auto flex items-center space-x-1 scrollbar-thin">
                    {tlachiaUnitNames.map(unitName => {
                        const isActive = tlachiaActiveUnit === unitName;
                        return (
                            <button
                                key={unitName}
                                onClick={() => setTlachiaState({ tlachiaActiveUnit: unitName })}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                                    isActive 
                                        ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/30 border border-cyan-400/40" 
                                        : "bg-gray-800/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-transparent"
                                }`}
                            >
                                <span>{unitName}</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Content Body */}
            {currentUnitData ? (
                <TlachIAUnitPanel unitName={tlachiaActiveUnit!} unit={currentUnitData} />
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-600/20 to-blue-700/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-6 shadow-2xl">
                        <Upload className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-black text-white tracking-wide mb-2">Cargar Paquete de Indicadores TlachIA Metrics</h3>
                    <p className="text-sm text-gray-400 max-w-lg mb-6 leading-relaxed">
                        Arrastra o selecciona el archivo <code className="text-cyan-400 bg-gray-900 px-2 py-0.5 rounded border border-gray-800 font-mono">.zip</code> generado por <strong className="text-gray-200">openalex_indicators_engine</strong>. 
                        El sistema generará dinámicamente las 16 pestañas analíticas y sincronizará la producción con <strong className="text-gray-200">Biblio Networks</strong> y <strong className="text-gray-200">Semantic Biblio</strong>.
                    </p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={tlachiaIsUploading}
                        className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-sm font-bold rounded-xl shadow-xl flex items-center space-x-2 transition-all border border-cyan-400/30"
                    >
                        <Upload className="w-5 h-5" />
                        <span>Seleccionar Archivo .ZIP</span>
                    </button>
                </div>
            )}
        </div>
    );
};
