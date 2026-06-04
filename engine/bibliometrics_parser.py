import sys
import json
import os
from collections import defaultdict
import networkx as nx
# Monkey-patch NetworkX for metaknowledge compatibility (G.node was removed in 3.0)
if not hasattr(nx.Graph, 'node'):
    nx.Graph.node = property(lambda self: self.nodes)
import pandas as pd
import metaknowledge as mk

def read_and_generate_bibliometrics(filepath, network_type="co-occurrence", custom_tag="DE", max_terms=100, min_cooccurrence=2, temporal=False):
    """
    Reads a bibliometrics file using metaknowledge and generates a network.
    
    network_type options:
    - 'co-authorship'
    - 'co-citation'
    - 'citation'
    - 'bib-coupling'
    - 'co-occurrence'
    - 'bipartite'
    """
    
    # 1. Pre-clean the raw text file if date tags are requested
    import re
    date_tags = {'DP', 'PY', 'PD'}
    needs_date_cleaning = False
    if network_type == 'co-occurrence' and custom_tag in date_tags:
        needs_date_cleaning = True
    elif network_type == 'bipartite':
        if "," in custom_tag:
            t1, t2 = custom_tag.split(",", 1)
            if t1.strip() in date_tags or t2.strip() in date_tags:
                needs_date_cleaning = True
                
    if needs_date_cleaning:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            with open(filepath, 'w', encoding='utf-8') as f:
                for line in lines:
                    if line.startswith('DP  - ') or line.startswith('PY  - ') or line.startswith('PD  - '):
                        match = re.search(r'\b(19|20)\d{2}\b', line)
                        if match:
                            f.write(line[:6] + match.group(0) + '\n')
                        else:
                            f.write(line)
                    else:
                        f.write(line)
        except Exception as e:
            pass # Ignore and let metaknowledge try its best

    # 2. Parse using metaknowledge
    try:
        RC = mk.RecordCollection(filepath)
    except Exception as e:
        return {"success": False, "error": f"Failed to parse file with MetaKnowledge: {str(e)}"}
        
    if len(RC) == 0:
        return {"success": False, "error": "No records found in the file."}

    # 2. Determine and Build Global Graph
    try:
        if network_type == 'co-authorship':
            global_graph = RC.networkCoAuthor()
        elif network_type == 'co-citation':
            global_graph = RC.networkCoCitation()
        elif network_type == 'citation':
            global_graph = RC.networkCitation()
        elif network_type == 'bib-coupling':
            global_graph = RC.networkBibCoupling()
        elif network_type == 'co-occurrence':
            global_graph = RC.networkOneMode(custom_tag)
        elif network_type == 'bipartite':
            # For bipartite we need two tags. We'll default to AU and DE for now,
            # or allow custom_tag to be split by a comma (e.g., "AU,DE")
            tag1, tag2 = "AU", "DE"
            if "," in custom_tag:
                tag1, tag2 = custom_tag.split(",", 1)
            global_graph = RC.networkTwoMode(tag1, tag2)
        else:
            return {"success": False, "error": f"Unknown network type: {network_type}"}
    except Exception as e:
        return {"success": False, "error": f"Failed to generate network '{network_type}': {str(e)}"}

    # 3. Filter top terms based on frequency (node attribute 'count' or degree)
    if network_type == 'bipartite':
        # For bipartite, max_terms applies to tag2 (columns). We extract top max_terms of tag2, 
        # then find all tag1 nodes connected to them with weight >= min_cooccurrence.
        tag1, tag2 = "AU", "DE"
        if "," in custom_tag:
            tag1, tag2 = custom_tag.split(",", 1)
            
        tag2_nodes = {}
        for n, data in global_graph.nodes(data=True):
            if data.get('type') == tag2:
                tag2_nodes[n] = data.get('count', 1)
                
        sorted_tag2 = sorted(tag2_nodes.items(), key=lambda x: x[1], reverse=True)
        top_tag2 = [n for n, c in sorted_tag2[:max_terms]]
        top_tag2_set = set(top_tag2)
        
        connected_tag1_set = set()
        for u, v, data in global_graph.edges(data=True):
            w = data.get('weight', 1)
            if w >= min_cooccurrence:
                u_type = global_graph.nodes[u].get('type')
                v_type = global_graph.nodes[v].get('type')
                if u in top_tag2_set and v_type == tag1:
                    connected_tag1_set.add(v)
                elif v in top_tag2_set and u_type == tag1:
                    connected_tag1_set.add(u)
                    
        top_nodes_set = top_tag2_set.union(connected_tag1_set)
        global_graph = global_graph.subgraph(top_nodes_set).copy()
        
        edges_to_remove = [(u, v) for u, v, data in global_graph.edges(data=True) if data.get('weight', 1) < min_cooccurrence]
        global_graph.remove_edges_from(edges_to_remove)
        
        # We also need node_frequencies for later
        node_frequencies = {n: data.get('count', 1) for n, data in global_graph.nodes(data=True)}
    else:
        node_frequencies = {}
        for n, data in global_graph.nodes(data=True):
            count = data.get('count', 1)
            node_frequencies[n] = count
            
        sorted_nodes = sorted(node_frequencies.items(), key=lambda x: x[1], reverse=True)
        top_nodes = [n for n, c in sorted_nodes[:max_terms]]
        top_nodes_set = set(top_nodes)
        
        # Filter global graph to only top terms
        global_graph = global_graph.subgraph(top_nodes_set).copy()
        
        # Filter edges by min_cooccurrence
        edges_to_remove = [(u, v) for u, v, data in global_graph.edges(data=True) if data.get('weight', 1) < min_cooccurrence]
        global_graph.remove_edges_from(edges_to_remove)

    # Re-extract filtered nodes to ensure we drop isolated ones if needed (optional)
    
    # 4. Convert Global Graph to JSON Format
    def graph_to_json(G):
        nodes = []
        for n, data in G.nodes(data=True):
            nodes.append({
                "data": {
                    "id": str(n),
                    "label": str(n).title() if isinstance(n, str) else str(n),
                    "frequency": data.get('count', 1)
                }
            })
            
        edges = []
        for u, v, data in G.edges(data=True):
            edges.append({
                "data": {
                    "source": str(u),
                    "target": str(v),
                    "weight": data.get('weight', 1)
                }
            })
        return nodes, edges

    nodes, edges = graph_to_json(global_graph)
    
    # Term counts dict
    term_counts = {str(n): count for n, count in node_frequencies.items() if n in top_nodes_set}

    # Adjacency Matrix (Co-occurrence CSV) for SOM
    # Generate an adjacency matrix. To keep it aligned with previous logic, we can use nx.to_pandas_adjacency
    try:
        # Sort nodes to keep matrix columns stable
        sorted_top_nodes = sorted(list(global_graph.nodes()))
        matrix_cols = sorted_top_nodes
        
        if network_type == 'bipartite':
            tag1, tag2 = "AU", "DE"
            if "," in custom_tag:
                tag1, tag2 = custom_tag.split(",", 1)
            bipartite_rows = sorted([n for n, attr in global_graph.nodes(data=True) if attr.get('type') == tag1])
            bipartite_cols = sorted([n for n, attr in global_graph.nodes(data=True) if attr.get('type') == tag2])
            matrix_cols = bipartite_cols
            
            df_cooc = pd.DataFrame(0, index=bipartite_rows, columns=bipartite_cols, dtype=float)
            for u, v, data in global_graph.edges(data=True):
                w = data.get('weight', 1)
                if u in bipartite_rows and v in bipartite_cols:
                    df_cooc.at[u, v] = w
                elif v in bipartite_rows and u in bipartite_cols:
                    df_cooc.at[v, u] = w
        else:
            df_cooc = nx.to_pandas_adjacency(global_graph, nodelist=sorted_top_nodes, weight='weight')
            # Fill diagonal with node frequencies for compatibility
            for n in sorted_top_nodes:
                df_cooc.at[n, n] = term_counts.get(str(n), 1)
            
        cooccurrence_csv = df_cooc.to_csv()
    except Exception as e:
        cooccurrence_csv = ""

    # Frequency CSV (Document-Term matrix)
    # Metaknowledge doesn't natively expose the raw document-term matrix easily from the graph,
    # but we can reconstruct it for the top nodes.
    # Alternatively, the SOM can just use the cooccurrence_csv (which is symmetric).
    # Previous implementation used Document-Term matrix for unipartite SOM, but we can stick to co-occurrence if it fails.
    # Let's rebuild the Document-Term matrix manually:
    matrix_data = []
    row_labels = []
    
    if network_type == 'co-occurrence':
        for r in RC:
            # Check if record has the tag
            if custom_tag in r:
                val = r[custom_tag]
                # mk sometimes returns lists, sometimes strings
                if isinstance(val, str):
                    val = [val]
                elif val is None:
                    continue
                    
                doc_terms = set([str(t).lower() for t in val])
                row = [1 if str(n).lower() in doc_terms else 0 for n in sorted_top_nodes]
                matrix_data.append(row)
                title = r.get('TI', 'Unknown Title')
                if isinstance(title, list):
                    title = title[0]
                year = r.get('PY', 'N/A')
                if isinstance(year, list):
                    year = year[0]
                row_labels.append(f"{str(title)[:50]} ({year})")
                
        if len(matrix_data) > 0:
            df_freq = pd.DataFrame(matrix_data, columns=[str(n) for n in sorted_top_nodes], index=row_labels)
            frequency_csv = df_freq.to_csv()
        else:
            frequency_csv = cooccurrence_csv
    else:
        # For citations, authors, etc. we just pass the adjacency matrix as the frequency matrix
        frequency_csv = cooccurrence_csv

    # 5. Temporal Networks
    networks_by_year = {}
    if temporal:
        # Find all valid years
        years = set()
        for r in RC:
            year = r.get('PY')
            if year is None:
                # Try PubMed 'DP' (Date of Publication) which usually starts with year, e.g. "2025 Dec 18"
                dp = r.get('DP')
                if dp:
                    if isinstance(dp, list): dp = dp[0]
                    year = str(dp)[:4]
                    
            if year is not None:
                if isinstance(year, list):
                    try:
                        years.add(int(str(year[0])[:4]))
                    except:
                        pass
                else:
                    try:
                        years.add(int(str(year)[:4]))
                    except:
                        pass
        years = sorted(list(years))
        
        # Build giant temporal frequency matrix
        temporal_matrix_data = []
        temporal_row_labels = []
        
        for y in years:
            try:
                RC_year = RC.yearSplit(y, y)
                if len(RC_year) == 0:
                    continue
                    
                # Build graph for this year
                if network_type == 'co-authorship':
                    y_graph = RC_year.networkCoAuthor()
                elif network_type == 'co-citation':
                    y_graph = RC_year.networkCoCitation()
                elif network_type == 'citation':
                    y_graph = RC_year.networkCitation()
                elif network_type == 'bib-coupling':
                    y_graph = RC_year.networkBibCoupling()
                elif network_type == 'co-occurrence':
                    y_graph = RC_year.networkOneMode(custom_tag)
                elif network_type == 'bipartite':
                    y_graph = RC_year.networkTwoMode(tag1, tag2)
                else:
                    y_graph = nx.Graph()
                    
                # Filter to only the top_nodes we found globally to keep matrices aligned!
                y_graph = y_graph.subgraph(top_nodes_set).copy()
                
                # Apply min_cooccurrence filter
                y_edges_to_remove = [(u, v) for u, v, data in y_graph.edges(data=True) if data.get('weight', 1) < min_cooccurrence]
                y_graph.remove_edges_from(y_edges_to_remove)
                
                y_nodes, y_edges = graph_to_json(y_graph)
                networks_by_year[str(y)] = {"nodes": y_nodes, "edges": y_edges}
                
                # Build stacked rows for this year (Adjacency format)
                # We need a matrix where rows are {Year}_{Node1} and columns are {Node2}
                if network_type == 'bipartite':
                    y_df_cooc = pd.DataFrame(0, index=bipartite_rows, columns=bipartite_cols, dtype=float)
                    for n1 in bipartite_rows:
                        row = []
                        for n2 in bipartite_cols:
                            edge_data = y_graph.get_edge_data(n1, n2, default={})
                            w = edge_data.get('weight', 0)
                            row.append(w)
                            y_df_cooc.at[n1, n2] = w
                        temporal_matrix_data.append(row)
                        temporal_row_labels.append(f"{y}_{n1}")
                    y_cooccurrence_csv = y_df_cooc.to_csv()
                else:
                    y_df_cooc = pd.DataFrame(0, index=sorted_top_nodes, columns=sorted_top_nodes, dtype=float)
                    for n1 in sorted_top_nodes:
                        row = []
                        # Get frequency of n1 in this year
                        n1_data = y_graph.nodes.get(n1, {})
                        n1_freq = n1_data.get('count', 0)
                        
                        for n2 in sorted_top_nodes:
                            if n1 == n2:
                                row.append(n1_freq)
                                y_df_cooc.at[n1, n2] = n1_freq
                            else:
                                # Edge weight between n1 and n2 in this year
                                edge_data = y_graph.get_edge_data(n1, n2, default={})
                                w = edge_data.get('weight', 0)
                                row.append(w)
                                y_df_cooc.at[n1, n2] = w
                                
                        temporal_matrix_data.append(row)
                        temporal_row_labels.append(f"{y}_{n1}")
                    y_cooccurrence_csv = y_df_cooc.to_csv()
                    
                networks_by_year[str(y)] = {"nodes": y_nodes, "edges": y_edges, "cooccurrence_csv": y_cooccurrence_csv}
                
            except Exception as e:
                # Some algorithms fail if there aren't enough records in a specific year
                pass
                
        if len(temporal_matrix_data) > 0:
            df_temporal_freq = pd.DataFrame(temporal_matrix_data, columns=[str(n) for n in matrix_cols], index=temporal_row_labels)
            frequency_csv = df_temporal_freq.to_csv()

    # 6. Build Result
    result_dict = {
        "success": True,
        "document_count": len(RC),
        "network": {"nodes": nodes, "edges": edges},
        "term_counts": term_counts,
        "frequency_csv": frequency_csv,
        "cooccurrence_csv": cooccurrence_csv
    }
    
    if temporal:
        result_dict["networks_by_year"] = networks_by_year
        
    return result_dict

if __name__ == "__main__":
    # Expect JSON payload via stdin
    input_data = sys.stdin.read().strip()
    if not input_data:
        print(json.dumps({"success": False, "error": "No input provided"}))
        sys.exit(1)
        
    try:
        payload = json.loads(input_data)
        filepath = payload.get("filepath", "")
        network_type = payload.get("network_type", "co-occurrence")
        custom_tag = payload.get("custom_tag", "DE")
        max_terms = payload.get("max_terms", 100)
        min_cooccurrence = payload.get("min_cooccurrence", 2)
        temporal = payload.get("temporal", False)
        
        result = read_and_generate_bibliometrics(
            filepath, 
            network_type=network_type,
            custom_tag=custom_tag,
            max_terms=max_terms,
            min_cooccurrence=min_cooccurrence,
            temporal=temporal
        )
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Exception in Python script: {str(e)}"}))
        sys.exit(1)
