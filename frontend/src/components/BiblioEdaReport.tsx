import React, { useMemo } from 'react';
import { useSomStore } from '../store/somStore';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, 
  LineChart, Line, Legend, Sankey
} from 'recharts';
import { Award, FileText, Globe, Users, BookOpen } from 'lucide-react';

export const BiblioEdaReport: React.FC = () => {
  const { edaReport, sankeyData, termGrowth } = useSomStore();

  if (!edaReport || !edaReport.success) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8 text-center bg-gray-950">
        <p className="text-lg font-medium text-gray-200">No EDA Data Available</p>
        <p className="text-sm mt-2 max-w-md">Run bibliometrics parsing to generate Exploratory Data Analysis metrics.</p>
        {edaReport?.error && (
          <p className="text-xs mt-4 text-red-400 bg-red-950/40 p-2 rounded border border-red-900/50">
            {edaReport.error}
          </p>
        )}
      </div>
    );
  }

  const { health, averages, author_metrics, top_keywords } = edaReport;

  // Colors for charts
  const colors = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4"];

  const wordCloud = useMemo(() => {
    if (!top_keywords || top_keywords.length === 0) return null;
    const maxVal = Math.max(...top_keywords.map((k: any) => k.value));
    const minVal = Math.min(...top_keywords.map((k: any) => k.value));
    
    return top_keywords.map((kw: any, i: number) => {
      // Normalize font size between 12px and 48px
      const size = 12 + ((kw.value - minVal) / (maxVal - minVal || 1)) * 36;
      return (
        <span 
          key={i} 
          style={{ fontSize: `${size}px`, color: colors[i % colors.length] }}
          className="mx-2 my-1 inline-block font-semibold drop-shadow-sm transition-transform hover:scale-110 cursor-pointer"
          title={`Frequency: ${kw.value}`}
        >
          {kw.text}
        </span>
      );
    });
  }, [top_keywords]);

  // Sankey Node colors
  const sankeyNodes = sankeyData?.nodes?.map((n: any, i: number) => ({
    ...n,
    fill: colors[i % colors.length]
  })) || [];

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-200 overflow-y-auto p-6 space-y-8 hide-scrollbar">
      {/* Header Summary Cards */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center">
          <BookOpen className="w-5 h-5 mr-2 text-indigo-400" />
          Exploratory Data Analysis
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-lg">
            <div className="flex items-center space-x-2 text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Documents</span>
            </div>
            <div className="text-3xl font-bold text-white">{health.total_documents}</div>
            <div className="text-xs text-gray-500 mt-1">Timespan: {health.timespan}</div>
          </div>
          
          <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-lg">
            <div className="flex items-center space-x-2 text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Users className="w-4 h-4 text-blue-400" />
              <span>Authors</span>
            </div>
            <div className="text-3xl font-bold text-white">{health.total_authors}</div>
            <div className="text-xs text-gray-500 mt-1">Collab Index: {averages.collab_index}</div>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-lg">
            <div className="flex items-center space-x-2 text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Globe className="w-4 h-4 text-purple-400" />
              <span>Sources</span>
            </div>
            <div className="text-3xl font-bold text-white">{health.total_sources}</div>
            <div className="text-xs text-gray-500 mt-1">Countries: {health.total_countries}</div>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl shadow-lg">
            <div className="flex items-center space-x-2 text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Award className="w-4 h-4 text-pink-400" />
              <span>Citations</span>
            </div>
            <div className="text-3xl font-bold text-white">{health.total_citations}</div>
            <div className="text-xs text-gray-500 mt-1">Avg/Doc: {averages.cits_per_doc}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Author Metrics */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col h-[400px]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center">
            <Award className="w-4 h-4 mr-2 text-yellow-400" />
            Top Authors by H-Index
          </h3>
          <div className="flex-1 min-h-0">
            {author_metrics && author_metrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={author_metrics.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                  <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                  <YAxis dataKey="author" type="category" width={100} stroke="#9ca3af" fontSize={10} tickFormatter={(val) => val.length > 15 ? val.substring(0, 15) + '...' : val} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', color: '#f3f4f6' }}
                    itemStyle={{ color: '#818cf8' }}
                  />
                  <Bar dataKey="h_index" name="H-Index" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="g_index" name="G-Index" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">No citation data available.</div>
            )}
          </div>
        </div>

        {/* WordCloud */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col h-[400px]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
            Topics WordCloud
          </h3>
          <div className="flex-1 overflow-auto bg-gray-950 border border-gray-800 rounded-lg p-4 flex flex-wrap items-center justify-center align-content-center">
            {wordCloud ? wordCloud : <div className="text-gray-500">No keyword data found.</div>}
          </div>
        </div>

        {/* Term Growth Plot */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col h-[450px]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
            Temporal Term Growth
          </h3>
          <div className="flex-1 min-h-0">
            {termGrowth && termGrowth.data && termGrowth.data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={termGrowth.data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="year" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', color: '#f3f4f6' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  {termGrowth.lines.map((t: string, i: number) => (
                    <Line key={t} type="monotone" dataKey={t} stroke={colors[i % colors.length]} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">No temporal data available.</div>
            )}
          </div>
        </div>

        {/* Sankey Diagram */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg flex flex-col h-[450px]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">
            Knowledge Flows (Country → Institution → Source)
          </h3>
          <div className="flex-1 min-h-0">
            {sankeyData && sankeyData.nodes && sankeyData.nodes.length > 0 && sankeyData.links && sankeyData.links.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={{ nodes: sankeyNodes, links: sankeyData.links }}
                  nodePadding={20}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                  link={{ stroke: '#374151', strokeOpacity: 0.3 }}
                >
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', color: '#f3f4f6' }}
                    formatter={(val, name, props) => {
                      // Custom formatter for links
                      if (props?.payload?.sourceName) {
                         return [val, `${props.payload.sourceName} → ${props.payload.targetName}`];
                      }
                      return [val, name];
                    }}
                  />
                </Sankey>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">Not enough data to build Sankey flow.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
