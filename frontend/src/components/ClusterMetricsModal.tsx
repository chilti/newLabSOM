import React, { useState, useEffect } from 'react';
import { X, Loader2, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSomStore } from '../store/somStore';

interface Props {
  onClose: () => void;
}

interface MetricResult {
  k: number;
  silhouette: number;
  davies_bouldin: number;
  calinski_harabasz: number;
}

export const ClusterMetricsModal: React.FC<Props> = ({ onClose }) => {
  const [data, setData] = useState<MetricResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      const state = useSomStore.getState();
      const weights = state.result?.weights;
      
      if (!weights || weights.length === 0) {
        setError("No trained SOM weights found. Please train the network first.");
        setLoading(false);
        return;
      }

      try {
        const payload = {
          weights: weights,
          max_k: 15
        };

        const isDesktop = window.location.protocol === 'file:' || window.location.protocol === 'about:' || !window.location.host;
        const apiUrl = isDesktop ? 'http://localhost:5123/api/som/evaluate_clusters' : '/api/som/evaluate_clusters';

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const json = await res.json();
        if (json.success) {
          setData(json.metrics);
        } else {
          setError(json.error || "Unknown error occurred while evaluating clusters.");
        }
      } catch (e: any) {
        setError(e.message || "Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-[90vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
          <div className="flex items-center space-x-3">
            <Activity className="text-indigo-400 w-5 h-5" />
            <h2 className="text-lg font-bold text-gray-100 uppercase tracking-wide">Clustering Optimization Metrics</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
              <p className="text-gray-400 text-sm font-semibold">Calculating Agglomerative hierarchies...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900 bg-opacity-20 border border-red-800 rounded-xl p-4 text-red-400 text-sm">
              <span className="font-bold">Error: </span> {error}
            </div>
          )}

          {!loading && !error && data.length > 0 && (
            <div className="grid grid-cols-1 gap-8">
              
              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                <h3 className="text-center text-sm font-bold text-gray-300 mb-2">Silhouette Score (Higher is better)</h3>
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="k" stroke="#9ca3af" label={{ value: 'Number of Clusters (K)', position: 'insideBottom', offset: -5 }} />
                      <YAxis stroke="#9ca3af" domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#030712', borderColor: '#1f2937', color: '#fff' }} />
                      <Legend verticalAlign="top" height={36}/>
                      <Line type="monotone" dataKey="silhouette" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Silhouette" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                <h3 className="text-center text-sm font-bold text-gray-300 mb-2">Davies-Bouldin Index (Lower is better)</h3>
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="k" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#030712', borderColor: '#1f2937', color: '#fff' }} />
                      <Legend verticalAlign="top" height={36}/>
                      <Line type="monotone" dataKey="davies_bouldin" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4 }} name="Davies-Bouldin" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                <h3 className="text-center text-sm font-bold text-gray-300 mb-2">Calinski-Harabasz Score (Higher is better)</h3>
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="k" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#030712', borderColor: '#1f2937', color: '#fff' }} />
                      <Legend verticalAlign="top" height={36}/>
                      <Line type="monotone" dataKey="calinski_harabasz" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} name="Calinski-Harabasz" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
};
