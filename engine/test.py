import metaknowledge as mk
import re
import networkx as nx

if not hasattr(nx.Graph, 'node'):
    nx.Graph.node = property(lambda self: self.nodes)

orig_get = mk.Record.get
def new_get(self, tag, default=None):
    val = orig_get(self, tag, default)
    if tag in {'DP', 'PY', 'PD'} and isinstance(val, str):
        match = re.search(r'\b(19|20)\d{2}\b', val)
        if match:
            return match.group(0)
    return val
mk.Record.get = new_get

RC = mk.RecordCollection(r'C:\Users\jlja\Desktop\pubmed-transforme-set.txt')
print("Sample DP:", list(RC)[0].get('DP'))
g = RC.networkTwoMode('AU', 'DP')
print("Nodes:", list(g.nodes())[:10])
