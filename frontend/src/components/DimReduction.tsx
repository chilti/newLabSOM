import React, { useState, useRef } from 'react';
import { useSomStore } from '../store/somStore';
import { Upload, Activity, Calculator, ArrowRight, Layers, Database } from 'lucide-react';
import Papa from 'papaparse';

const ALGORITHMS = [
  'CorrInt', 'DANCo', 'ESS', 'FisherS', 'KNN', 'lPCA', 'MADA', 'MiND_ML', 'MLE', 'MOM', 'TLE', 'TwoNN'
];

export const DimReduction: React.FC = () => {
  const { estimateDimension, reduceDimension, loadCsvData, setActiveTab } = useSomStore();
  
  const [data, setData] = useState<number[][] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  
  // Estimation State
  const [isEstimatingCeiling, setIsEstimatingCeiling] = useState(false);
  const [ceilingResult, setCeilingResult] = useState<any>(null);
  
  const [isEstimatingManual, setIsEstimatingManual] = useState(false);
  const [manualAlgo, setManualAlgo] = useState<string>('TwoNN');
  const [manualResult, setManualResult] = useState<any>(null);
  
  // Reduction State
  const [targetD, setTargetD] = useState<number>(2);
  const [isReducing, setIsReducing] = useState(false);
  const [reducedData, setReducedData] = useState<number[][] | null>(null);

  // Error State
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        // Assume first row is header if contains non-numbers
        const rows = results.data as string[][];
        if (rows.length === 0) return;
        
        let startIndex = 0;
        if (rows[0].some(val => isNaN(Number(val)))) {
          startIndex = 1; // skip header
        }

        const parsedData = rows.slice(startIndex).map(row => row.map(val => Number(val) || 0));
        setData(parsedData);
      }
    });
  };

  const runCeiling = async () => {
    if (!data) return;
    setIsEstimatingCeiling(true);
    setErrorMessage(null);
    const res = await estimateDimension(data, 'ceiling');
    if (res.success) {
      setCeilingResult(res);
      setTargetD(Math.ceil(res.estimated_dimension));
    } else {
      setErrorMessage("Ceiling Estimation Error: " + res.error);
    }
    setIsEstimatingCeiling(false);
  };

  const runManual = async () => {
    if (!data) return;
    setIsEstimatingManual(true);
    setErrorMessage(null);
    const res = await estimateDimension(data, 'manual', manualAlgo);
    if (res.success) {
      setManualResult(res);
    } else {
      setErrorMessage("Manual Estimation Error: " + res.error);
    }
    setIsEstimatingManual(false);
  };

  const runUMAP = async () => {
    if (!data) return;
    setIsReducing(true);
    setErrorMessage(null);
    const res = await reduceDimension(data, targetD);
    if (res.success) {
      setReducedData(res.reduced_data);
    } else {
      setErrorMessage("UMAP Reduction Error: " + res.error);
    }
    setIsReducing(false);
  };

  const sendToSOM = () => {
    if (!reducedData) return;
    
    // Create CSV text from reducedData
    const csvContent = reducedData.map(row => row.join(',')).join('\n');
    loadCsvData(csvContent, undefined, [], 'csv', `Reduced_${fileName}`);
    setActiveTab('multidimensional');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* 1. File Upload */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2 mb-4">
          <Upload className="w-5 h-5 text-indigo-400" />
          <span>Upload High-Dimensional Dataset</span>
        </h3>
        
        {!data ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700 rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-gray-800 transition-all group"
          >
            <Upload className="w-10 h-10 text-gray-500 mb-3 group-hover:text-indigo-400 transition-colors" />
            <p className="text-sm text-gray-300 font-medium">Click to browse your CSV matrix</p>
            <p className="text-xs text-gray-600 mt-1">Numerical arrays. Headers are automatically ignored.</p>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-emerald-900 bg-opacity-20 border border-emerald-800 rounded-xl p-4">
            <div>
              <p className="text-emerald-400 font-bold">{fileName}</p>
              <p className="text-xs text-gray-400 mt-1">Loaded {data.length} rows and {data[0].length} dimensions.</p>
            </div>
            <button 
              onClick={() => { setData(null); setReducedData(null); setCeilingResult(null); setManualResult(null); setErrorMessage(null); }}
              className="text-xs text-gray-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
        <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={handleFileUpload} />
        
        {errorMessage && (
          <div className="mt-4 bg-red-950 border border-red-800 text-red-400 text-sm p-4 rounded-xl">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 2. Optimal Strategy: The Ceiling */}
        <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl ${!data ? 'opacity-50 pointer-events-none' : ''}`}>
          <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2 mb-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <span>Optimal Strategy: The "Ceiling"</span>
          </h3>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            Uses Local MLE (fit_pw) to find the local intrinsic dimensionality distribution across all points. It calculates the 95th percentile, acting as a robust "ceiling" to prevent SOM tearing.
          </p>

          <button 
            onClick={runCeiling}
            disabled={isEstimatingCeiling}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isEstimatingCeiling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            <span>Calculate Intrinsic Ceiling</span>
          </button>

          {ceilingResult && (
            <div className="mt-6 bg-gray-950 rounded-xl p-4 border border-gray-800">
              <p className="text-emerald-400 font-black text-3xl text-center mb-1">{ceilingResult.estimated_dimension.toFixed(1)}</p>
              <p className="text-xs text-center text-gray-500 mb-4">Recommended Target Dimension (95th Percentile)</p>
              
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="bg-gray-900 p-2 rounded text-center">
                  <span className="block text-gray-500">Median</span>
                  <span className="font-bold text-gray-200">{ceilingResult.metrics.median.toFixed(2)}</span>
                </div>
                <div className="bg-gray-900 p-2 rounded text-center">
                  <span className="block text-gray-500">Mean</span>
                  <span className="font-bold text-gray-200">{ceilingResult.metrics.mean.toFixed(2)}</span>
                </div>
                <div className="bg-gray-900 p-2 rounded text-center">
                  <span className="block text-gray-500">90th Percentile</span>
                  <span className="font-bold text-gray-200">{ceilingResult.metrics.p90.toFixed(2)}</span>
                </div>
                <div className="bg-gray-900 p-2 rounded text-center">
                  <span className="block text-gray-500">Maximum</span>
                  <span className="font-bold text-gray-200">{ceilingResult.metrics.max.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. Manual Estimator */}
        <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl ${!data ? 'opacity-50 pointer-events-none' : ''}`}>
          <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2 mb-2">
            <Calculator className="w-5 h-5 text-indigo-400" />
            <span>Manual Estimation</span>
          </h3>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            Experiment with specific intrinsic dimension estimation algorithms from the skdim library.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 font-semibold mb-1.5">Algorithm</label>
              <select
                value={manualAlgo}
                onChange={(e) => setManualAlgo(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                {ALGORITHMS.map(algo => (
                  <option key={algo} value={algo}>{algo}</option>
                ))}
              </select>
            </div>

            <button 
              onClick={runManual}
              disabled={isEstimatingManual}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-colors border border-indigo-500 disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {isEstimatingManual ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              <span>Estimate Global ID</span>
            </button>
          </div>

          {manualResult && (
            <div className="mt-6 bg-gray-950 rounded-xl p-4 border border-gray-800 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Algorithm</p>
                <p className="font-bold text-indigo-400">{manualResult.algorithm}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Estimated Dimension</p>
                <p className="font-black text-2xl text-white">{manualResult.estimated_dimension.toFixed(2)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Reduction & Export */}
      <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl flex items-center justify-between ${!data ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex-1 max-w-sm">
          <h3 className="text-md font-bold text-gray-200 flex items-center space-x-2 mb-2">
            <Layers className="w-5 h-5 text-amber-400" />
            <span>UMAP Reduction</span>
          </h3>
          <p className="text-xs text-gray-400 mb-4">Reduce the original matrix directly using the target dimensionality.</p>
          
          <div className="flex space-x-4 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 font-semibold mb-1.5">Target K</label>
              <input
                type="number"
                value={targetD}
                onChange={(e) => setTargetD(parseInt(e.target.value) || 2)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-500"
              />
            </div>
            <button 
              onClick={runUMAP}
              disabled={isReducing}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center space-x-2 shadow-lg"
            >
              {isReducing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Reduce</span>}
            </button>
          </div>
        </div>

        {reducedData && (
          <div className="flex flex-col items-end">
            <div className="flex items-center space-x-2 mb-4 text-emerald-400 bg-emerald-400 bg-opacity-10 px-4 py-2 rounded-lg border border-emerald-900">
              <Database className="w-4 h-4" />
              <span className="text-xs font-bold">Reduction Successful ({reducedData.length} x {reducedData[0].length})</span>
            </div>
            
            <button 
              onClick={sendToSOM}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors shadow-lg flex items-center space-x-2"
            >
              <span>Send Matrix to Data & SOM Pipeline</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
