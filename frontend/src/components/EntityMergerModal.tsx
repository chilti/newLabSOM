import React, { useState, useMemo } from 'react';
import { useSomStore } from '../store/somStore';
import { X, Search, GitMerge, FileUp, Save, Trash2 } from 'lucide-react';

interface EntityMergerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (mergesCsvFile: File) => void;
  existingThesaurusFile?: File | null;
}

export const EntityMergerModal: React.FC<EntityMergerModalProps> = ({ isOpen, onClose, onApply, existingThesaurusFile }) => {
  const { network } = useSomStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [targetEntity, setTargetEntity] = useState<string>('');
  const [manualMerges, setManualMerges] = useState<Record<string, string>>({});
  
  // Extract all unique labels from network nodes
  const availableEntities = useMemo(() => {
    if (!network?.nodes) return [];
    const labels = Array.from(new Set(network.nodes.map(n => n.data.label as string)));
    return labels.sort((a, b) => a.localeCompare(b));
  }, [network]);

  const filteredEntities = useMemo(() => {
    if (!searchQuery) return availableEntities;
    return availableEntities.filter(e => e.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [availableEntities, searchQuery]);

  const handleToggleSource = (entity: string) => {
    const next = new Set(selectedSources);
    if (next.has(entity)) {
      next.delete(entity);
    } else {
      next.add(entity);
    }
    setSelectedSources(next);
  };

  const handleAddMerge = () => {
    if (selectedSources.size === 0 || !targetEntity) return;
    
    const nextMerges = { ...manualMerges };
    selectedSources.forEach(src => {
      if (src !== targetEntity) {
        nextMerges[src] = targetEntity;
      }
    });
    setManualMerges(nextMerges);
    setSelectedSources(new Set());
    setTargetEntity('');
  };

  const handleRemoveMerge = (source: string) => {
    const nextMerges = { ...manualMerges };
    delete nextMerges[source];
    setManualMerges(nextMerges);
  };

  const handleApply = async () => {
    // Generate CSV from manual merges
    let csvContent = 'label,replace_by\n';
    
    // If there's an existing thesaurus file, read it first and append
    if (existingThesaurusFile) {
      try {
        const existingText = await existingThesaurusFile.text();
        csvContent = existingText;
        if (!csvContent.endsWith('\n')) csvContent += '\n';
      } catch (err) {
        console.error("Failed to read existing thesaurus file", err);
      }
    }
    
    // Append manual merges
    Object.entries(manualMerges).forEach(([source, target]) => {
      // Escape quotes
      const safeSource = source.replace(/"/g, '""');
      const safeTarget = target.replace(/"/g, '""');
      csvContent += `"${safeSource}","${safeTarget}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const mergedFile = new File([blob], 'normalization_thesaurus.csv', { type: 'text/csv' });
    
    onApply(mergedFile);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col h-[85vh] max-h-[800px] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900/50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-200 flex items-center space-x-2">
              <GitMerge className="w-6 h-6 text-indigo-400" />
              <span>Interactive Entity Normalization</span>
            </h2>
            <p className="text-xs text-gray-500 mt-1">Merge duplicate authors, keywords, or institutions into a canonical name.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white bg-gray-900 hover:bg-gray-800 p-2 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Panel: Entity Selection */}
          <div className="w-1/2 flex flex-col border-r border-gray-800 p-5 space-y-4">
            <div className="flex items-center space-x-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none text-sm text-gray-200 focus:outline-none w-full"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto border border-gray-800 rounded-xl bg-gray-900/30 p-2 custom-scrollbar">
              {filteredEntities.map(entity => (
                <div 
                  key={entity}
                  onClick={() => handleToggleSource(entity)}
                  className={`px-3 py-2 text-sm rounded-lg cursor-pointer mb-1 transition-colors flex items-center justify-between ${
                    selectedSources.has(entity) ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/50' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  }`}
                >
                  <span className="truncate pr-2">{entity}</span>
                  {selectedSources.has(entity) && <span className="text-xs font-bold text-indigo-400">Selected</span>}
                </div>
              ))}
              {filteredEntities.length === 0 && (
                <div className="text-center text-gray-600 mt-10 text-sm">No entities found.</div>
              )}
            </div>

            <div className="flex flex-col space-y-2 pt-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Canonical Target Entity</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Type target name or select from above..."
                  value={targetEntity}
                  onChange={(e) => setTargetEntity(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (selectedSources.size === 1) {
                      setTargetEntity(Array.from(selectedSources)[0]);
                    }
                  }}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold rounded-xl transition"
                  title="Use selected as target"
                >
                  Use Selected
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddMerge}
                disabled={selectedSources.size === 0 || !targetEntity}
                className="w-full py-2.5 mt-2 bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                Merge {selectedSources.size} into Target
              </button>
            </div>
          </div>

          {/* Right Panel: Merge List & Actions */}
          <div className="w-1/2 flex flex-col p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Pending Merges</h3>
            
            <div className="flex-1 overflow-y-auto border border-gray-800 rounded-xl bg-gray-900/30 custom-scrollbar">
              {Object.keys(manualMerges).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-3">
                  <GitMerge className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No merges defined yet.</p>
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-900 border-b border-gray-800 sticky top-0">
                    <tr>
                      <th className="p-3 text-gray-400 font-medium">Source</th>
                      <th className="p-3 text-gray-400 font-medium">Target</th>
                      <th className="p-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(manualMerges).map(([source, target]) => (
                      <tr key={source} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="p-3 text-gray-300 truncate max-w-[150px]" title={source}>{source}</td>
                        <td className="p-3 text-indigo-300 font-medium truncate max-w-[150px]" title={target}>{target}</td>
                        <td className="p-3 text-right">
                          <button 
                            onClick={() => handleRemoveMerge(source)}
                            className="text-gray-500 hover:text-red-400 transition"
                            title="Remove merge rule"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center space-x-3 pt-4 border-t border-gray-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold rounded-xl transition flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={Object.keys(manualMerges).length === 0 && !existingThesaurusFile}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl transition flex-1 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-900/30"
              >
                <Save className="w-4 h-4" />
                <span>Apply & Regenerate</span>
              </button>
            </div>
            {existingThesaurusFile && (
              <p className="text-xs text-indigo-400 text-center mt-2 flex items-center justify-center">
                <FileUp className="w-3 h-3 mr-1" />
                Will append to uploaded: {existingThesaurusFile.name}
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
