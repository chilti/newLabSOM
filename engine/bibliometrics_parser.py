import sys
import json
import os
import csv as csv_module
import tempfile
from collections import defaultdict
from itertools import combinations
import networkx as nx
# Monkey-patch NetworkX for metaknowledge compatibility (G.node was removed in 3.0)
for _cls in (nx.Graph, nx.DiGraph, nx.MultiGraph, nx.MultiDiGraph):
    if not hasattr(_cls, 'node'):
        _cls.node = property(lambda self: self.nodes)
import pandas as pd
import metaknowledge as mk

from vos_thesaurus import VosThesaurus
from vos_nlp import extract_noun_phrases, filter_top_relevant_terms, calculate_relevance_scores
from vos_parsers import (
    is_dimensions_csv, is_lens_csv, is_openalex_csv, is_vos_native_file,
    parse_dimensions_csv, parse_lens_csv, parse_openalex_csv, parse_vos_native_json
)


# =============================================================================
# FILE-FORMAT DETECTION & PRE-PROCESSING
# =============================================================================

def _is_scopus_csv(filepath):
    """
    Detect Scopus CSV exports (UTF-8 BOM + 'Authors'/'Title' in header).
    Works for both the old (MK-compatible) and new (2023+) export formats.
    """
    try:
        with open(filepath, 'rb') as f:
            if f.read(3) != b'\xef\xbb\xbf':   # UTF-8 BOM
                return False
        with open(filepath, 'r', encoding='utf-8-sig') as f:
            header = f.readline()
            cols = [c.strip().strip('"') for c in header.split(',')]
            return 'Authors' in cols and 'Title' in cols
    except Exception:
        return False


# WOS-style tag  →  Scopus CSV full column name
_SCOPUS_TAG_MAP = {
    'AU': 'Authors',
    'TI': 'Title',
    'PY': 'Year',
    'SO': 'Source title',
    'DE': 'Author Keywords',
    'ID': 'Index Keywords',
    'AB': 'Abstract',
    'DI': 'DOI',
    'TC': 'Cited by',
    'UT': 'EID',
}


def _process_scopus_csv(filepath, network_type, custom_tag,
                        max_terms, min_cooccurrence, temporal,
                        extraction_source="keywords", counting_method="full",
                        thesaurus_filepath=None, relevance_ratio=0.60):
    """
    Full pipeline for Scopus CSV files using pandas.
    Supports all VOSviewer network types, units of analysis,
    Full/Fractional counting, thesaurus disambiguation, and NLP mining.
    """
    df = pd.read_csv(filepath, encoding='utf-8-sig', dtype=str, keep_default_na=False)

    # Translate WOS-style tag to Scopus column name
    def scopus_col(tag):
        return _SCOPUS_TAG_MAP.get(tag.strip(), tag.strip())

    def get_terms(row, col):
        """Split a Scopus cell by '; ' into a list of cleaned strings."""
        val = row.get(col, '')
        if not val or val.strip() == '':
            return []
        return [t.strip().lower() for t in val.split(';') if t.strip()]

    base_type = network_type.split(':')[0]
    sub_type = network_type.split(':')[1] if ':' in network_type else ''

    # Citation-graph types requiring raw reference lists:
    if base_type in ('co-citation', 'bib-coupling') and sub_type in ('', 'documents', 'cited_references'):
        return {
            "success": False,
            "error": (
                f"Network type '{network_type}' requires a Web of Science .txt export. "
                "Scopus CSV does not contain raw cited reference lists in tabular export."
            )
        }

    records = df.to_dict(orient='records')
    if not records:
        return {"success": False, "error": "No records found in Scopus CSV."}

    thesaurus = VosThesaurus(thesaurus_filepath) if thesaurus_filepath else None

    # ── Handle NLP Title/Abstract Term Extraction ─────────────────────────────
    if extraction_source in ('title_abstract', 'title', 'abstract') and base_type == 'co-occurrence':
        doc_extracted = []
        for r in records:
            t = r.get('Title', '') or ''
            a = r.get('Abstract', '') or ''
            if extraction_source == 'title_abstract':
                full_text = f"{t}. {a}"
            elif extraction_source == 'title':
                full_text = t
            else:
                full_text = a

            terms = extract_noun_phrases(full_text)
            if thesaurus:
                terms = thesaurus.apply_to_list(terms)
            doc_extracted.append(terms)

        filtered_doc_terms, rel_scores, selected_terms = filter_top_relevant_terms(
            doc_extracted,
            min_occurrence=min_cooccurrence,
            relevance_threshold_ratio=relevance_ratio
        )
        rec_to_terms = {i: terms for i, terms in enumerate(filtered_doc_terms)}
        def term_getter(r):
            idx = records.index(r) if r in records else -1
            return rec_to_terms.get(idx, [])
        col = 'NLP Title/Abstract'

    elif base_type == 'co-authorship':
        if sub_type == 'organizations':
            col = 'Affiliations'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'countries':
            def term_getter(row):
                affils = row.get('Affiliations', '')
                countries = []
                for a in affils.split(';'):
                    parts = a.split(',')
                    if parts:
                        c = parts[-1].strip().lower()
                        if c and len(c) > 2: countries.append(c)
                countries = list(set(countries))
                return thesaurus.apply_to_list(countries) if thesaurus else countries
        else:
            col = 'Authors'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw

    elif base_type == 'co-occurrence':
        if sub_type == 'author_keywords':
            col = 'Author Keywords'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'keywords_plus':
            col = 'Index Keywords'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'all_keywords':
            def term_getter(row):
                raw = list(set(get_terms(row, 'Author Keywords') + get_terms(row, 'Index Keywords')))
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        else:
            col = scopus_col(custom_tag)
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw

    elif base_type in ('citation', 'bib-coupling'):
        if sub_type == 'sources':
            col = 'Source title'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'authors':
            col = 'Authors'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'organizations':
            col = 'Affiliations'
            def term_getter(row):
                raw = get_terms(row, col)
                return thesaurus.apply_to_list(raw) if thesaurus else raw
        elif sub_type == 'countries':
            def term_getter(row):
                affils = row.get('Affiliations', '')
                countries = []
                for a in affils.split(';'):
                    parts = a.split(',')
                    if parts:
                        c = parts[-1].strip().lower()
                        if c and len(c) > 2: countries.append(c)
                countries = list(set(countries))
                return thesaurus.apply_to_list(countries) if thesaurus else countries
        else:
            return {"success": False, "error": f"Network type '{network_type}' requires WoS citation data."}

    elif base_type == 'bipartite':
        tag1_wos, tag2_wos = 'AU', 'DE'
        if ',' in custom_tag:
            tag1_wos, tag2_wos = custom_tag.split(',', 1)
        col1 = scopus_col(tag1_wos.strip())
        col2 = scopus_col(tag2_wos.strip())
        def term_getter(row):
            t1 = get_terms(row, col1)
            t2 = get_terms(row, col2)
            if thesaurus:
                t1 = thesaurus.apply_to_list(t1)
                t2 = thesaurus.apply_to_list(t2)
            return t1, t2

    else:
        return {"success": False, "error": f"Unknown network type: {network_type}"}

    # ── Build graph ───────────────────────────────────────────────────────────
    if base_type == 'bipartite':
        global_graph = _build_bipartite_graph(records, term_getter, tag1_wos, tag2_wos, counting_method=counting_method)
    else:
        global_graph = _build_cooccurrence_graph_from_records(records, term_getter, counting_method=counting_method, thesaurus=thesaurus)

    if len(global_graph) == 0:
        col_used = col if base_type != 'bipartite' else f"{col1}/{col2}"
        return {
            "success": False,
            "error": (
                f"No usable terms found for '{network_type}' in column '{col_used}'. "
                "Try a different network type or verify the file has data for this field."
            )
        }

    # ── Filter, convert, build matrices — shared logic ────────────────────────
    return _finalize_network(
        global_graph, records, network_type, custom_tag,
        max_terms, min_cooccurrence, temporal,
        term_getter_for_matrix=term_getter if base_type != 'bipartite' else None,
        record_title_getter=lambda r: r.get('Title', 'Unknown'),
        record_year_getter=lambda r: r.get('Year', 'N/A'),
        doc_count=len(records),
        counting_method=counting_method
    )


def _build_bipartite_graph(records, term_getter, tag1, tag2, counting_method="full"):
    """Build a bipartite networkx graph from records with Full or Fractional Counting."""
    from collections import defaultdict
    pair_freq = defaultdict(float)
    freq1, freq2 = defaultdict(float)

    for rec in records:
        terms1, terms2 = term_getter(rec)
        terms1 = list({t.strip() for t in terms1 if t and t.strip()})
        terms2 = list({t.strip() for t in terms2 if t and t.strip()})
        n1, n2 = len(terms1), len(terms2)
        if n1 == 0 or n2 == 0:
            continue

        inc1 = (1.0 / n1) if counting_method == "fractional" else 1.0
        inc2 = (1.0 / n2) if counting_method == "fractional" else 1.0
        edge_weight = (1.0 / (n1 * n2)) if counting_method == "fractional" else 1.0

        for t1 in terms1:
            freq1[t1] += inc1
        for t2 in terms2:
            freq2[t2] += inc2
        for t1 in terms1:
            for t2 in terms2:
                pair_freq[(t1, t2)] += edge_weight

    G = nx.Graph()
    for t, c in freq1.items():
        G.add_node(t, count=round(c, 3) if counting_method == "fractional" else int(c), type=tag1)
    for t, c in freq2.items():
        G.add_node(t, count=round(c, 3) if counting_method == "fractional" else int(c), type=tag2)
    for (t1, t2), w in pair_freq.items():
        G.add_edge(t1, t2, weight=round(w, 3) if counting_method == "fractional" else int(w))
    return G


def _build_vosviewer_json_from_graph(graph, term_counts=None, records=None, term_getter=None,
                                     record_year_getter=None, record_citations_getter=None):
    """
    Builds the standard VOSviewer JSON format ({ network: { items, links }, config })
    from a NetworkX graph.
    Computes:
      - Community clusters (Louvain modularity)
      - Force-directed layout (Fruchterman-Reingold spring_layout)
      - Weights: Occurrences, Links (degree), Total link strength
      - Scores: Avg. pub. year, Avg. citations (if record metadata is available)
    """
    if term_counts is None:
        term_counts = {n: d.get('count', 1) for n, d in graph.nodes(data=True)}

    sorted_nodes = sorted(list(graph.nodes()))
    node_to_id = {node: i + 1 for i, node in enumerate(sorted_nodes)}

    # 1. Community detection (Clusters)
    cluster_map = {}
    if len(graph) > 0 and graph.number_of_edges() > 0:
        try:
            communities = nx.community.louvain_communities(graph, weight='weight', seed=42)
            for cluster_idx, comm in enumerate(communities, start=1):
                for node in comm:
                    cluster_map[node] = cluster_idx
        except Exception:
            for cluster_idx, comp in enumerate(nx.connected_components(graph), start=1):
                for node in comp:
                    cluster_map[node] = cluster_idx
    for node in sorted_nodes:
        if node not in cluster_map:
            cluster_map[node] = 1

    # 2. Links count and Total Link Strength
    links_count = {}
    total_link_strength = {}
    for node in sorted_nodes:
        links_count[node] = graph.degree(node)
        tls = sum(d.get('weight', 1) for _, _, d in graph.edges(node, data=True))
        total_link_strength[node] = float(tls)

    # 3. Force-directed layout — Fruchterman-Reingold (spring_layout)
    #    Scale to a ±500 canvas coordinate space so labels are readable.
    layout_pos = {}
    if len(graph) > 0:
        try:
            # Use node weights as initial spring stiffness hints
            node_weights_for_layout = {
                n: float(term_counts.get(str(n), graph.nodes[n].get('count', 1)))
                for n in graph.nodes()
            }
            total_w = sum(node_weights_for_layout.values()) or 1.0
            # seed for reproducibility; k controls ideal edge length
            pos = nx.spring_layout(
                graph,
                weight='weight',
                k=2.5 / max(1, len(graph) ** 0.5),
                iterations=80,
                seed=42,
                scale=500
            )
            layout_pos = {node: (float(pos[node][0]), float(pos[node][1])) for node in graph.nodes()}
        except Exception:
            # Circular fallback only if spring_layout fails
            import math
            n = len(sorted_nodes)
            for idx, node in enumerate(sorted_nodes):
                angle = (idx / n) * 2 * math.pi
                layout_pos[node] = (math.cos(angle) * 350, math.sin(angle) * 350)

    # 4. Score averages per term if records are present
    avg_pub_year = {}
    avg_citations = {}
    if records and term_getter:
        term_years = defaultdict(list)
        term_cits = defaultdict(list)
        for rec in records:
            raw_terms = term_getter(rec)
            if isinstance(raw_terms, tuple): # bipartite (t1, t2)
                raw_terms = raw_terms[0] + raw_terms[1]
            terms = [str(t).lower().strip() for t in raw_terms if str(t).strip()]
            y_val = None
            if record_year_getter:
                try:
                    y_raw = str(record_year_getter(rec)).strip()
                    if y_raw.isdigit() and len(y_raw) == 4:
                        y_val = float(y_raw)
                except Exception:
                    pass
            c_val = None
            if record_citations_getter:
                try:
                    c_raw = str(record_citations_getter(rec)).strip()
                    if c_raw:
                        c_val = float(c_raw)
                except Exception:
                    pass

            for t in set(terms):
                if t in graph:
                    if y_val is not None:
                        term_years[t].append(y_val)
                    if c_val is not None:
                        term_cits[t].append(c_val)

        for node in sorted_nodes:
            if node in term_years and len(term_years[node]) > 0:
                avg_pub_year[node] = round(sum(term_years[node]) / len(term_years[node]), 2)
            if node in term_cits and len(term_cits[node]) > 0:
                avg_citations[node] = round(sum(term_cits[node]) / len(term_cits[node]), 2)

    # 5. Construct items array (with layout coordinates)
    items = []
    for node in sorted_nodes:
        node_id = node_to_id[node]
        freq = term_counts.get(str(node), graph.nodes[node].get('count', 1))
        item_label = str(node).title() if isinstance(node, str) else str(node)

        x_pos, y_pos = layout_pos.get(node, (0.0, 0.0))

        weights = {
            "Occurrences": int(freq),
            "Links": int(links_count.get(node, 0)),
            "Total link strength": float(total_link_strength.get(node, 0.0))
        }

        scores = {}
        if node in avg_pub_year:
            scores["Avg. pub. year"] = avg_pub_year[node]
        if node in avg_citations:
            scores["Avg. citations"] = avg_citations[node]

        item_dict = {
            "id": node_id,
            "label": item_label,
            "x": round(x_pos, 4),
            "y": round(y_pos, 4),
            "cluster": int(cluster_map.get(node, 1)),
            "weights": weights
        }
        if scores:
            item_dict["scores"] = scores
        items.append(item_dict)

    # 6. Construct links array
    links = []
    for u, v, d in graph.edges(data=True):
        if u in node_to_id and v in node_to_id:
            links.append({
                "source_id": node_to_id[u],
                "target_id": node_to_id[v],
                "strength": float(d.get('weight', 1))
            })

    return {
        "network": {
            "items": items,
            "links": links
        },
        "config": {
            "parameters": {
                "scale": 1.0,
                "item_size_variation": 0.5,
                "max_n_links": 1000
            }
        }
    }


def _finalize_network(global_graph, records, network_type, custom_tag,
                       max_terms, min_cooccurrence, temporal,
                       term_getter_for_matrix, record_title_getter,
                       record_year_getter, doc_count, counting_method="full"):
    """
    Shared post-processing: filter top nodes, build JSON + CSV matrices.
    Used by both the Scopus CSV and RIS pipelines.
    """
    base_type = network_type.split(':')[0]
    tag1_wos, tag2_wos = 'AU', 'DE'
    if ',' in custom_tag:
        tag1_wos, tag2_wos = custom_tag.split(',', 1)
        tag1_wos, tag2_wos = tag1_wos.strip(), tag2_wos.strip()

    # ── Filter top terms ──────────────────────────────────────────────────────
    if base_type == 'bipartite':
        tag2_nodes = {
            n: d.get('count', 1) for n, d in global_graph.nodes(data=True)
            if d.get('type') == tag2_wos
        }
        top_tag2_set = {n for n, _ in sorted(tag2_nodes.items(),
                                              key=lambda x: x[1], reverse=True)[:max_terms]}
        connected_tag1 = set()
        for u, v, d in global_graph.edges(data=True):
            if d.get('weight', 1) >= min_cooccurrence:
                if u in top_tag2_set:  connected_tag1.add(v)
                if v in top_tag2_set:  connected_tag1.add(u)
        top_nodes_set = top_tag2_set | connected_tag1
        global_graph  = global_graph.subgraph(top_nodes_set).copy()
        global_graph.remove_edges_from([
            (u, v) for u, v, d in global_graph.edges(data=True)
            if d.get('weight', 1) < min_cooccurrence
        ])
        node_frequencies = {n: d.get('count', 1) for n, d in global_graph.nodes(data=True)}
    else:
        node_frequencies = {n: d.get('count', 1) for n, d in global_graph.nodes(data=True)}
        top_nodes_set    = {n for n, _ in sorted(
            node_frequencies.items(), key=lambda x: x[1], reverse=True)[:max_terms]}
        global_graph = global_graph.subgraph(top_nodes_set).copy()
        global_graph.remove_edges_from([
            (u, v) for u, v, d in global_graph.edges(data=True)
            if d.get('weight', 1) < min_cooccurrence
        ])

    # ── Graph → JSON ──────────────────────────────────────────────────────────
    nodes = [
        {"data": {"id": str(n), "label": str(n).title(), "frequency": d.get('count', 1)}}
        for n, d in global_graph.nodes(data=True)
    ]
    edges = [
        {"data": {"source": str(u), "target": str(v), "weight": d.get('weight', 1)}}
        for u, v, d in global_graph.edges(data=True)
    ]
    term_counts = {str(n): c for n, c in node_frequencies.items() if n in top_nodes_set}

    # ── Adjacency matrix ──────────────────────────────────────────────────────
    sorted_top_nodes = sorted(global_graph.nodes())
    try:
        if base_type == 'bipartite':
            bip_rows = sorted(n for n, d in global_graph.nodes(data=True) if d.get('type') == tag1_wos)
            bip_cols = sorted(n for n, d in global_graph.nodes(data=True) if d.get('type') == tag2_wos)
            df_cooc  = pd.DataFrame(0, index=bip_rows, columns=bip_cols, dtype=float)
            for u, v, d in global_graph.edges(data=True):
                w = d.get('weight', 1)
                if u in bip_rows and v in bip_cols: df_cooc.at[u, v] = w
                elif v in bip_rows and u in bip_cols: df_cooc.at[v, u] = w
        else:
            df_cooc = nx.to_pandas_adjacency(global_graph, nodelist=sorted_top_nodes, weight='weight')
            for n in sorted_top_nodes:
                df_cooc.at[n, n] = term_counts.get(str(n), 1)
        cooccurrence_csv = df_cooc.to_csv()
    except Exception:
        cooccurrence_csv = ""

    # ── Document-term frequency matrix ────────────────────────────────────────
    frequency_csv = cooccurrence_csv
    if term_getter_for_matrix and base_type == 'co-occurrence':
        matrix_data, row_labels = [], []
        for rec in records:
            doc_terms = set(term_getter_for_matrix(rec))
            row = [1 if str(n) in doc_terms else 0 for n in sorted_top_nodes]
            if any(row):
                matrix_data.append(row)
                title = str(record_title_getter(rec))[:50]
                year  = record_year_getter(rec)
                row_labels.append(f"{title} ({year})")
        if matrix_data:
            df_freq = pd.DataFrame(matrix_data,
                                   columns=[str(n) for n in sorted_top_nodes],
                                   index=row_labels)
            frequency_csv = df_freq.to_csv()

    # ── Temporal networks ─────────────────────────────────────────────────────
    networks_by_year = {}
    if temporal and term_getter_for_matrix:
        years = sorted({
            str(record_year_getter(r)) for r in records
            if str(record_year_getter(r)).isdigit()
        })
        temporal_matrix_data, temporal_row_labels = [], []
        for y in years:
            recs_y = [r for r in records if str(record_year_getter(r)) == y]
            if not recs_y:
                continue
            y_graph = _build_cooccurrence_graph_from_records(recs_y, term_getter_for_matrix, counting_method=counting_method)
            y_graph = y_graph.subgraph(top_nodes_set).copy()
            y_graph.remove_edges_from([
                (u, v) for u, v, d in y_graph.edges(data=True)
                if d.get('weight', 1) < min_cooccurrence
            ])
            y_nodes = [
                {"data": {"id": str(n), "label": str(n).title(), "frequency": d.get('count', 1)}}
                for n, d in y_graph.nodes(data=True)
            ]
            y_edges = [
                {"data": {"source": str(u), "target": str(v), "weight": d.get('weight', 1)}}
                for u, v, d in y_graph.edges(data=True)
            ]
            y_df = pd.DataFrame(0, index=sorted_top_nodes, columns=sorted_top_nodes, dtype=float)
            for n1 in sorted_top_nodes:
                row = []
                n1_f = y_graph.nodes[n1].get('count', 0) if n1 in y_graph else 0
                for n2 in sorted_top_nodes:
                    w = n1_f if n1 == n2 else y_graph.get_edge_data(n1, n2, default={}).get('weight', 0)
                    row.append(w); y_df.at[n1, n2] = w
                temporal_matrix_data.append(row)
                temporal_row_labels.append(f"{y}_{n1}")
            y_vos_json = _build_vosviewer_json_from_graph(
                y_graph,
                term_counts={str(n): y_graph.nodes[n].get('count', 1) for n in y_graph.nodes},
                records=recs_y,
                term_getter=term_getter_for_matrix,
                record_year_getter=record_year_getter
            )
            networks_by_year[y] = {
                "nodes": y_nodes,
                "edges": y_edges,
                "cooccurrence_csv": y_df.to_csv(),
                "vosviewer_json": y_vos_json
            }

        if temporal_matrix_data:
            df_t = pd.DataFrame(temporal_matrix_data,
                                columns=[str(n) for n in sorted_top_nodes],
                                index=temporal_row_labels)
            frequency_csv = df_t.to_csv()

    vosviewer_json = _build_vosviewer_json_from_graph(
        global_graph,
        term_counts=term_counts,
        records=records,
        term_getter=term_getter_for_matrix,
        record_year_getter=record_year_getter,
        record_citations_getter=lambda r: r.get('Cited by', r.get('TC', 0)) if isinstance(r, dict) else 0
    )

    result = {
        "success": True,
        "document_count": doc_count,
        "network": {"nodes": nodes, "edges": edges},
        "vosviewer_json": vosviewer_json,
        "term_counts": term_counts,
        "frequency_csv": frequency_csv,
        "cooccurrence_csv": cooccurrence_csv,
    }
    if temporal:
        result["networks_by_year"] = networks_by_year
    return result


# =============================================================================
# RIS PARSER  (MetaKnowledge has no RIS support at all)
# =============================================================================

def _is_ris_file(filepath):
    """Detect RIS format: first non-empty line starts with 'TY  -'."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line:
                    return line.startswith('TY  -') or line.startswith('TY -')
    except Exception:
        return False
    return False


def _parse_ris_records(filepath):
    """
    Parse a RIS file into a list of plain dicts.

    Returned keys per record:
      'title', 'year', 'authors' (list), 'keywords' (list),
      'abstract', 'journal', 'doi', 'doc_type'
    """
    records = []
    current = {}

    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        for raw in f:
            line = raw.rstrip('\n\r')

            # End-of-record
            if line.strip().startswith('ER'):
                if current:
                    records.append(current)
                current = {}
                continue

            # Standard RIS: "XX  - value"
            if len(line) >= 6 and line[2:6] == '  - ':
                tag   = line[:2].strip()
                value = line[6:].strip()

                if tag == 'KW':
                    current.setdefault('keywords', []).append(value)
                elif tag == 'AU':
                    current.setdefault('authors', []).append(value)
                elif tag == 'TY':
                    current['doc_type'] = value
                elif tag in ('TI', 'T1'):
                    current.setdefault('title', value)
                elif tag in ('PY', 'Y1'):
                    # Year may look like "2023///" – take first 4 chars
                    current.setdefault('year', str(value)[:4])
                elif tag in ('JO', 'T2', 'J2', 'JF'):
                    current.setdefault('journal', value)
                elif tag == 'AB':
                    current.setdefault('abstract', value)
                elif tag == 'DO':
                    current.setdefault('doi', value)

    # Flush last record if file doesn't end with ER
    if current:
        records.append(current)

    return records


def _build_cooccurrence_graph_from_records(records, term_getter, counting_method="full", thesaurus=None):
    """
    Build a networkx graph from a list of record dicts.
    Supports Full Counting and Fractional Counting (1 / (n - 1)).
    """
    from collections import Counter, defaultdict

    term_freq = Counter()
    pair_freq = defaultdict(float)

    for rec in records:
        raw_terms = term_getter(rec)
        if thesaurus:
            raw_terms = thesaurus.apply_to_list(raw_terms)
        terms = list({t.lower().strip() for t in raw_terms if t and t.strip()})
        n = len(terms)
        if n == 0:
            continue

        for t in terms:
            term_freq[t] += 1

        if n > 1:
            edge_weight = 1.0 / (n - 1) if counting_method == "fractional" else 1.0
            for pair in combinations(sorted(terms), 2):
                pair_freq[pair] += edge_weight

    G = nx.Graph()
    for term, count in term_freq.items():
        G.add_node(term, count=count)
    for (t1, t2), weight in pair_freq.items():
        G.add_edge(t1, t2, weight=round(weight, 3))
    return G


def _process_record_list(
    records,
    network_type,
    custom_tag,
    max_terms,
    min_cooccurrence,
    temporal,
    extraction_source="keywords",
    counting_method="full",
    thesaurus_filepath=None,
    relevance_ratio=0.60
):
    """
    Generic processing pipeline for any list of record dictionaries
    (RIS, Dimensions, Lens, OpenAlex, Crossref, etc.).
    Supports NLP noun phrase mining and VOSviewer relevance scoring.
    """
    if not records:
        return {"success": False, "error": "No bibliographic records found."}

    thesaurus = VosThesaurus(thesaurus_filepath) if thesaurus_filepath else None

    # ── Choose term getter / NLP mining ──────────────────────────────────────
    base_type = network_type.split(':')[0]
    sub_type = network_type.split(':')[1] if ':' in network_type else ''

    if extraction_source in ('title_abstract', 'title', 'abstract') and (base_type == 'co-occurrence' or network_type == 'co-occurrence'):
        # NLP Noun Phrase Mining on Title and/or Abstract
        doc_extracted = []
        for r in records:
            t = r.get('title', '') or r.get('TI', '') or ''
            a = r.get('abstract', '') or r.get('AB', '') or ''
            if extraction_source == 'title_abstract':
                full_text = f"{t}. {a}"
            elif extraction_source == 'title':
                full_text = t
            else:
                full_text = a

            terms = extract_noun_phrases(full_text)
            if thesaurus:
                terms = thesaurus.apply_to_list(terms)
            doc_extracted.append(terms)

        # Filter by minimum occurrence and Relevance Score
        filtered_doc_terms, rel_scores, selected_terms = filter_top_relevant_terms(
            doc_extracted,
            min_occurrence=min_cooccurrence,
            relevance_threshold_ratio=relevance_ratio
        )

        rec_to_terms = {i: terms for i, terms in enumerate(filtered_doc_terms)}
        def term_getter(r):
            # Lookup by record index if available
            idx = records.index(r) if r in records else -1
            return rec_to_terms.get(idx, [])
    else:
        def term_getter(r):
            terms = []
            if base_type == 'co-authorship':
                if sub_type == 'organizations':
                    terms = r.get('organizations') or r.get('C1') or []
                elif sub_type == 'countries':
                    terms = r.get('countries') or r.get('CU') or []
                else:
                    terms = r.get('authors') or r.get('AU') or []
            elif base_type == 'co-occurrence':
                if sub_type == 'author_keywords':
                    terms = r.get('author_keywords') or r.get('DE') or []
                elif sub_type == 'keywords_plus':
                    terms = r.get('concepts') or r.get('ID') or []
                else:
                    terms = r.get('keywords') or r.get('DE_ID') or []
            elif base_type in ('citation', 'bib-coupling'):
                if sub_type == 'sources':
                    s = r.get('source') or r.get('SO') or ''
                    terms = [s] if s else []
                elif sub_type == 'authors':
                    terms = r.get('authors') or r.get('AU') or []
                elif sub_type == 'organizations':
                    terms = r.get('organizations') or r.get('C1') or []
                elif sub_type == 'countries':
                    terms = r.get('countries') or r.get('CU') or []
                else:
                    t = r.get('title') or r.get('TI') or ''
                    terms = [t] if t else []
            else:
                # Custom tag / field
                tag_candidates = [custom_tag, custom_tag.lower(), custom_tag.upper()]
                for tc in tag_candidates:
                    if tc in r:
                        raw_val = r[tc]
                        if isinstance(raw_val, list):
                            terms = raw_val
                        elif isinstance(raw_val, str) and raw_val:
                            terms = [v.strip() for v in raw_val.split('|') if v.strip()] if '|' in raw_val else [raw_val.strip()]
                        break

            if isinstance(terms, str):
                terms = [terms]
            if thesaurus:
                terms = thesaurus.apply_to_list(terms)
            return [str(t).strip() for t in terms if str(t).strip() and str(t).strip().lower() != 'nan']

    global_graph = _build_cooccurrence_graph_from_records(
        records, term_getter, counting_method=counting_method, thesaurus=thesaurus
    )

    if len(global_graph) == 0:
        return {
            "success": False,
            "error": "No usable terms or entities found with the specified thresholds."
        }

    return _finalize_network(
        global_graph, records, network_type, custom_tag,
        max_terms, min_cooccurrence, temporal,
        term_getter_for_matrix=term_getter,
        record_title_getter=lambda r: r.get('title', 'Unknown'),
        record_year_getter=lambda r: r.get('year', 'N/A'),
        doc_count=len(records),
    )


def _process_ris_file(filepath, network_type, custom_tag,
                       max_terms, min_cooccurrence, temporal,
                       extraction_source="keywords", counting_method="full",
                       thesaurus_filepath=None, relevance_ratio=0.60):
    """Full pipeline for RIS files."""
    records = _parse_ris_records(filepath)
    return _process_record_list(
        records, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
        extraction_source=extraction_source, counting_method=counting_method,
        thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
    )


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def read_and_generate_bibliometrics(
    filepath,
    network_type="co-occurrence",
    custom_tag="DE",
    max_terms=100,
    min_cooccurrence=2,
    temporal=False,
    extraction_source="keywords",
    counting_method="full",
    thesaurus_filepath=None,
    relevance_ratio=0.60
):
    """
    Reads a bibliometrics file and generates a co-occurrence / citation network.

    Supported formats (auto-detected):
      - Native VOSviewer JSON (.json)
      - Dimensions CSV (.csv)
      - Lens CSV (.csv)
      - Web of Science plain text (.txt)
      - PubMed / Medline plain text (.txt)
      - ProQuest (.txt)
      - Scopus CSV (.csv)  — including the new 2023+ export format
      - RIS (.ris)         — co-occurrence and co-authorship
    """

    # ── Route Native VOSviewer JSON files ─────────────────────────────────────
    if is_vos_native_file(filepath):
        return parse_vos_native_json(filepath)

    # ── Route Dimensions CSV exports ──────────────────────────────────────────
    if is_dimensions_csv(filepath):
        records = parse_dimensions_csv(filepath)
        return _process_record_list(
            records, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
        )

    # ── Route Lens.org CSV exports ────────────────────────────────────────────
    if is_lens_csv(filepath):
        records = parse_lens_csv(filepath)
        return _process_record_list(
            records, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
        )

    # ── Route OpenAlex CSV exports ────────────────────────────────────────────
    if is_openalex_csv(filepath):
        records = parse_openalex_csv(filepath)
        return _process_record_list(
            records, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
        )

    # ── Route RIS files to the dedicated parser ───────────────────────────────
    if _is_ris_file(filepath):
        return _process_ris_file(
            filepath, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
        )

    # ── Route Scopus CSV to the pandas-based parser ───────────────────────────
    if _is_scopus_csv(filepath):
        return _process_scopus_csv(
            filepath, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
        )

    # ── All other formats go through MetaKnowledge ────────────────────────────
    return _metaknowledge_process(
        filepath, network_type, custom_tag, max_terms, min_cooccurrence, temporal,
        extraction_source=extraction_source, counting_method=counting_method,
        thesaurus_filepath=thesaurus_filepath, relevance_ratio=relevance_ratio
    )


def _build_graph_for_rc(RC_subset, network_type, custom_tag, counting_method="full", thesaurus=None, extraction_source="keywords", relevance_ratio=0.60, min_cooccurrence=2):
    """Builds a networkx graph using MetaKnowledge based on base_type, sub_type, and counting_method."""
    base_type = network_type.split(':')[0]
    sub_type = network_type.split(':')[1] if ':' in network_type else ''

    # Determine effective tag
    if base_type == 'co-authorship':
        effective_tag = 'C1' if sub_type == 'organizations' else ('CU' if sub_type == 'countries' else 'AU')
    elif base_type == 'co-occurrence':
        effective_tag = 'DE' if sub_type == 'author_keywords' else ('ID' if sub_type == 'keywords_plus' else ('DE_ID' if sub_type == 'all_keywords' else custom_tag))
    elif base_type in ('citation', 'bib-coupling'):
        effective_tag = 'SO' if sub_type == 'sources' else ('AU' if sub_type == 'authors' else ('C1' if sub_type == 'organizations' else ('CU' if sub_type == 'countries' else 'TI')))
    elif base_type == 'co-citation':
        effective_tag = 'CR'
    else:
        effective_tag = custom_tag

    # 1. NLP Mining on Title/Abstract if requested for co-occurrence
    if extraction_source in ('title_abstract', 'title', 'abstract') and base_type == 'co-occurrence':
        doc_extracted = []
        rc_list = list(RC_subset)
        for r in rc_list:
            t = r.get('TI', '') or ''
            if isinstance(t, list): t = " ".join(str(x) for x in t)
            a = r.get('AB', '') or ''
            if isinstance(a, list): a = " ".join(str(x) for x in a)

            if extraction_source == 'title_abstract':
                full_text = f"{t}. {a}"
            elif extraction_source == 'title':
                full_text = str(t)
            else:
                full_text = str(a)

            terms = extract_noun_phrases(full_text)
            if thesaurus:
                terms = thesaurus.apply_to_list(terms)
            doc_extracted.append(terms)

        filtered_doc_terms, rel_scores, selected_terms = filter_top_relevant_terms(
            doc_extracted,
            min_occurrence=min_cooccurrence,
            relevance_threshold_ratio=relevance_ratio
        )
        rec_to_terms = {i: terms for i, terms in enumerate(filtered_doc_terms)}
        def nlp_term_getter(r):
            idx = rc_list.index(r) if r in rc_list else -1
            return rec_to_terms.get(idx, [])

        return _build_cooccurrence_graph_from_records(rc_list, nlp_term_getter, counting_method=counting_method, thesaurus=thesaurus)

    # 2. Fractional counting or Thesaurus on standard entity fields
    if (counting_method == "fractional" or thesaurus) and base_type in ('co-occurrence', 'co-authorship'):
        def standard_term_getter(r):
            if effective_tag == 'DE_ID':
                de = r.get('DE', []) or []
                if isinstance(de, str): de = [de]
                id_k = r.get('ID', []) or []
                if isinstance(id_k, str): id_k = [id_k]
                raw = list(set(de + id_k))
            else:
                raw = r.get(effective_tag, []) or []
                if isinstance(raw, str): raw = [raw]
            return thesaurus.apply_to_list(raw) if thesaurus else raw

        return _build_cooccurrence_graph_from_records(list(RC_subset), standard_term_getter, counting_method=counting_method, thesaurus=thesaurus)

    # 3. Fractional counting on Bipartite
    if counting_method == "fractional" and base_type == 'bipartite':
        tag1, tag2 = "AU", "DE"
        if "," in custom_tag:
            tag1, tag2 = custom_tag.split(",", 1)
        def bip_term_getter(r):
            t1 = r.get(tag1, []) or []
            if isinstance(t1, str): t1 = [t1]
            t2 = r.get(tag2, []) or []
            if isinstance(t2, str): t2 = [t2]
            if thesaurus:
                t1 = thesaurus.apply_to_list(t1)
                t2 = thesaurus.apply_to_list(t2)
            return t1, t2
        return _build_bipartite_graph(list(RC_subset), bip_term_getter, tag1, tag2, counting_method="fractional")

    # 4. Standard MetaKnowledge graph generators (Full counting)
    if base_type == 'co-authorship':
        if sub_type == 'organizations':
            return RC_subset.networkOneMode('C1')
        elif sub_type == 'countries':
            return RC_subset.networkOneMode('CU')
        else: # authors
            return RC_subset.networkCoAuthor()

    elif base_type == 'co-occurrence':
        if sub_type == 'author_keywords':
            return RC_subset.networkOneMode('DE')
        elif sub_type == 'keywords_plus':
            return RC_subset.networkOneMode('ID')
        elif sub_type == 'all_keywords':
            g_de = RC_subset.networkOneMode('DE')
            try:
                g_id = RC_subset.networkOneMode('ID')
                return nx.compose(g_de, g_id)
            except Exception:
                return g_de
        else:
            return RC_subset.networkOneMode(custom_tag)

    elif base_type == 'citation':
        if sub_type == 'sources':
            return RC_subset.networkOneMode('SO')
        elif sub_type == 'authors':
            return RC_subset.networkCitation(nodeType='author')
        elif sub_type == 'organizations':
            return RC_subset.networkOneMode('C1')
        elif sub_type == 'countries':
            return RC_subset.networkOneMode('CU')
        else: # documents
            return RC_subset.networkCitation(nodeType='full')

    elif base_type == 'bib-coupling':
        if sub_type == 'sources':
            return RC_subset.networkOneMode('SO')
        elif sub_type == 'authors':
            return RC_subset.networkOneMode('AU')
        elif sub_type == 'organizations':
            return RC_subset.networkOneMode('C1')
        elif sub_type == 'countries':
            return RC_subset.networkOneMode('CU')
        else: # documents
            return RC_subset.networkBibCoupling()

    elif base_type == 'co-citation':
        if sub_type == 'cited_sources':
            return RC_subset.networkCoCitation(nodeType='journal')
        elif sub_type == 'cited_authors':
            return RC_subset.networkCoCitation(nodeType='author')
        else: # cited_references
            return RC_subset.networkCoCitation(nodeType='full')

    elif base_type == 'bipartite':
        tag1, tag2 = "AU", "DE"
        if "," in custom_tag:
            tag1, tag2 = custom_tag.split(",", 1)
        return RC_subset.networkTwoMode(tag1, tag2)

    else:
        return RC_subset.networkOneMode(custom_tag)


def _metaknowledge_process(filepath, network_type, custom_tag,
                            max_terms, min_cooccurrence, temporal,
                            extraction_source="keywords", counting_method="full",
                            thesaurus_filepath=None, relevance_ratio=0.60):
    """MetaKnowledge-based processing supporting all VOSviewer network types."""

    # 1. Pre-clean the raw text file if date tags are requested
    import re
    date_tags = {'DP', 'PY', 'PD'}
    needs_date_cleaning = False
    base_type = network_type.split(':')[0]
    sub_type = network_type.split(':')[1] if ':' in network_type else ''

    if base_type == 'co-occurrence' and custom_tag in date_tags:
        needs_date_cleaning = True
    elif base_type == 'bipartite':
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
        except Exception:
            pass   # Ignore and let metaknowledge try its best

    # 2. Parse using metaknowledge
    try:
        RC = mk.RecordCollection(filepath)
    except Exception as e:
        return {"success": False, "error": f"Failed to parse file with MetaKnowledge: {str(e)}"}

    if len(RC) == 0:
        return {"success": False, "error": "No records found in the file."}

    thesaurus = VosThesaurus(thesaurus_filepath) if thesaurus_filepath else None

    # 3. Build Global Graph
    try:
        global_graph = _build_graph_for_rc(
            RC, network_type, custom_tag,
            counting_method=counting_method,
            thesaurus=thesaurus,
            extraction_source=extraction_source,
            relevance_ratio=relevance_ratio,
            min_cooccurrence=min_cooccurrence
        )
    except Exception as e:
        return {"success": False, "error": f"Failed to generate network '{network_type}': {str(e)}"}

    # 4. Filter top terms
    if base_type == 'bipartite':
        tag1, tag2 = "AU", "DE"
        if "," in custom_tag:
            tag1, tag2 = custom_tag.split(",", 1)

        tag2_nodes = {}
        for n, data in global_graph.nodes(data=True):
            if data.get('type') == tag2:
                tag2_nodes[n] = data.get('count', 1)

        sorted_tag2  = sorted(tag2_nodes.items(), key=lambda x: x[1], reverse=True)
        top_tag2_set = {n for n, _ in sorted_tag2[:max_terms]}

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
        global_graph  = global_graph.subgraph(top_nodes_set).copy()
        global_graph.remove_edges_from([
            (u, v) for u, v, d in global_graph.edges(data=True)
            if d.get('weight', 1) < min_cooccurrence
        ])
        node_frequencies = {n: d.get('count', 1) for n, d in global_graph.nodes(data=True)}
    else:
        node_frequencies = {n: d.get('count', 1) for n, d in global_graph.nodes(data=True)}
        sorted_nodes  = sorted(node_frequencies.items(), key=lambda x: x[1], reverse=True)
        top_nodes_set = {n for n, _ in sorted_nodes[:max_terms]}

        global_graph = global_graph.subgraph(top_nodes_set).copy()
        global_graph.remove_edges_from([
            (u, v) for u, v, d in global_graph.edges(data=True)
            if d.get('weight', 1) < min_cooccurrence
        ])

    # 5. Graph → JSON
    def graph_to_json(G):
        ns = [
            {"data": {"id": str(n), "label": str(n).title() if isinstance(n, str) else str(n),
                      "frequency": d.get('count', 1)}}
            for n, d in G.nodes(data=True)
        ]
        es = [
            {"data": {"source": str(u), "target": str(v), "weight": d.get('weight', 1)}}
            for u, v, d in G.edges(data=True)
        ]
        return ns, es

    nodes, edges = graph_to_json(global_graph)
    term_counts  = {str(n): c for n, c in node_frequencies.items() if n in top_nodes_set}

    # 6. Adjacency / frequency matrices
    sorted_top_nodes = sorted(list(global_graph.nodes()))
    matrix_cols = sorted_top_nodes

    try:
        if base_type == 'bipartite':
            tag1, tag2 = "AU", "DE"
            if "," in custom_tag:
                tag1, tag2 = custom_tag.split(",", 1)
            bipartite_rows = sorted([n for n, a in global_graph.nodes(data=True) if a.get('type') == tag1])
            bipartite_cols = sorted([n for n, a in global_graph.nodes(data=True) if a.get('type') == tag2])
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
            for n in sorted_top_nodes:
                df_cooc.at[n, n] = term_counts.get(str(n), 1)
        cooccurrence_csv = df_cooc.to_csv()
    except Exception:
        cooccurrence_csv = ""

    # Choose effective tag for record terms
    if base_type == 'co-authorship':
        effective_tag = 'C1' if sub_type == 'organizations' else ('CU' if sub_type == 'countries' else 'AU')
    elif base_type == 'co-occurrence':
        effective_tag = 'DE' if sub_type == 'author_keywords' else ('ID' if sub_type == 'keywords_plus' else ('DE_ID' if sub_type == 'all_keywords' else custom_tag))
    elif base_type in ('citation', 'bib-coupling'):
        effective_tag = 'SO' if sub_type == 'sources' else ('AU' if sub_type == 'authors' else ('C1' if sub_type == 'organizations' else ('CU' if sub_type == 'countries' else 'TI')))
    elif base_type == 'co-citation':
        effective_tag = 'CR'
    else:
        effective_tag = custom_tag

    matrix_data, row_labels = [], []
    if base_type == 'co-occurrence':
        for r in RC:
            doc_terms = set()
            if effective_tag == 'DE_ID':
                de = r.get('DE', []) or []
                if isinstance(de, str): de = [de]
                id_k = r.get('ID', []) or []
                if isinstance(id_k, str): id_k = [id_k]
                doc_terms = {str(t).lower() for t in (de + id_k)}
            elif effective_tag in r:
                val = r[effective_tag]
                if isinstance(val, str):
                    val = [val]
                elif val is None:
                    continue
                doc_terms = {str(t).lower() for t in val}

            if doc_terms:
                row = [1 if str(n).lower() in doc_terms else 0 for n in sorted_top_nodes]
                matrix_data.append(row)
                title = r.get('TI', 'Unknown Title')
                if isinstance(title, list): title = title[0]
                year  = r.get('PY', 'N/A')
                if isinstance(year, list):  year  = year[0]
                row_labels.append(f"{str(title)[:50]} ({year})")

    if matrix_data:
        df_freq = pd.DataFrame(matrix_data,
                               columns=[str(n) for n in sorted_top_nodes],
                               index=row_labels)
        frequency_csv = df_freq.to_csv()
    else:
        frequency_csv = cooccurrence_csv

    # 7. Temporal networks
    networks_by_year = {}
    if temporal:
        years = set()
        for r in RC:
            year = r.get('PY')
            if year is None:
                dp = r.get('DP')
                if dp:
                    if isinstance(dp, list): dp = dp[0]
                    year = str(dp)[:4]
            if year is not None:
                try:
                    years.add(int(str(year[0] if isinstance(year, list) else year)[:4]))
                except Exception:
                    pass
        years = sorted(years)

        temporal_matrix_data, temporal_row_labels = [], []
        for y in years:
            try:
                RC_year = RC.yearSplit(y, y)
                if len(RC_year) == 0:
                    continue

                y_graph = _build_graph_for_rc(
                    RC_year, network_type, custom_tag,
                    counting_method=counting_method,
                    thesaurus=thesaurus,
                    extraction_source=extraction_source,
                    relevance_ratio=relevance_ratio,
                    min_cooccurrence=min_cooccurrence
                )

                y_graph = y_graph.subgraph(top_nodes_set).copy()
                y_graph.remove_edges_from([
                    (u, v) for u, v, d in y_graph.edges(data=True)
                    if d.get('weight', 1) < min_cooccurrence
                ])
                y_nodes, y_edges = graph_to_json(y_graph)

                if base_type == 'bipartite':
                    y_df = pd.DataFrame(0, index=bipartite_rows, columns=bipartite_cols, dtype=float)
                    for n1 in bipartite_rows:
                        row = []
                        for n2 in bipartite_cols:
                            w = y_graph.get_edge_data(n1, n2, default={}).get('weight', 0)
                            row.append(w)
                            y_df.at[n1, n2] = w
                        temporal_matrix_data.append(row)
                        temporal_row_labels.append(f"{y}_{n1}")
                    y_cooc_csv = y_df.to_csv()
                else:
                    y_df = pd.DataFrame(0, index=sorted_top_nodes, columns=sorted_top_nodes, dtype=float)
                    for n1 in sorted_top_nodes:
                        row = []
                        n1_freq = y_graph.nodes[n1].get('count', 0) if n1 in y_graph else 0
                        for n2 in sorted_top_nodes:
                            if n1 == n2:
                                row.append(n1_freq)
                                y_df.at[n1, n2] = n1_freq
                            else:
                                w = y_graph.get_edge_data(n1, n2, default={}).get('weight', 0)
                                row.append(w)
                                y_df.at[n1, n2] = w
                        temporal_matrix_data.append(row)
                        temporal_row_labels.append(f"{y}_{n1}")
                    y_cooc_csv = y_df.to_csv()

                def _mk_term_getter_year(r):
                    if effective_tag == 'DE_ID':
                        de = r.get('DE', []) or []
                        if isinstance(de, str): de = [de]
                        id_k = r.get('ID', []) or []
                        if isinstance(id_k, str): id_k = [id_k]
                        return list(set(de + id_k))
                    if effective_tag in r and r.get(effective_tag) is not None:
                        v = r.get(effective_tag)
                        return v if isinstance(v, list) else [str(v)]
                    return []

                y_vos_json = _build_vosviewer_json_from_graph(
                    y_graph,
                    term_counts={str(n): y_graph.nodes[n].get('count', 1) for n in y_graph.nodes},
                    records=RC_year,
                    term_getter=_mk_term_getter_year,
                    record_year_getter=lambda r: str(y)
                )

                networks_by_year[str(y)] = {
                    "nodes": y_nodes,
                    "edges": y_edges,
                    "cooccurrence_csv": y_cooc_csv,
                    "vosviewer_json": y_vos_json
                }
            except Exception:
                pass

        if temporal_matrix_data:
            df_temporal = pd.DataFrame(temporal_matrix_data,
                                       columns=[str(n) for n in matrix_cols],
                                       index=temporal_row_labels)
            frequency_csv = df_temporal.to_csv()

    # Build full VOSviewer JSON
    def _mk_term_getter_full(r):
        if effective_tag == 'DE_ID':
            de = r.get('DE', []) or []
            if isinstance(de, str): de = [de]
            id_k = r.get('ID', []) or []
            if isinstance(id_k, str): id_k = [id_k]
            return list(set(de + id_k))
        if effective_tag in r and r.get(effective_tag) is not None:
            v = r.get(effective_tag)
            return v if isinstance(v, list) else [str(v)]
        return []

    def _mk_year_getter(r):
        y = r.get('PY') or r.get('DP')
        if y is not None:
            if isinstance(y, list): y = y[0]
            return str(y)[:4]
        return None

    def _mk_cit_getter(r):
        c = r.get('TC')
        if c is not None:
            if isinstance(c, list): c = c[0]
            try: return float(c)
            except Exception: pass
        return 0

    vosviewer_json = _build_vosviewer_json_from_graph(
        global_graph,
        term_counts=term_counts,
        records=RC,
        term_getter=_mk_term_getter_full,
        record_year_getter=_mk_year_getter,
        record_citations_getter=_mk_cit_getter
    )

    # 8. Build result
    result_dict = {
        "success": True,
        "document_count": len(RC),
        "network": {"nodes": nodes, "edges": edges},
        "vosviewer_json": vosviewer_json,
        "term_counts": term_counts,
        "frequency_csv": frequency_csv,
        "cooccurrence_csv": cooccurrence_csv,
    }
    if temporal:
        result_dict["networks_by_year"] = networks_by_year
    return result_dict


# =============================================================================
# CLI entry point (called by PreprocessService.cs via subprocess)
# =============================================================================

if __name__ == "__main__":
    input_data = sys.stdin.read().strip()
    if not input_data:
        print(json.dumps({"success": False, "error": "No input provided"}))
        sys.exit(1)

    try:
        payload        = json.loads(input_data)
        filepath       = payload.get("filepath", "")
        network_type   = payload.get("network_type", "co-occurrence")
        custom_tag     = payload.get("custom_tag", "DE")
        max_terms      = payload.get("max_terms", 100)
        min_cooccurrence = payload.get("min_cooccurrence", 2)
        temporal       = payload.get("temporal", False)
        extraction_source = payload.get("extraction_source", "keywords")
        counting_method   = payload.get("counting_method", "full")
        thesaurus_filepath = payload.get("thesaurus_filepath", None)
        relevance_ratio   = payload.get("relevance_ratio", 0.60)

        result = read_and_generate_bibliometrics(
            filepath,
            network_type=network_type,
            custom_tag=custom_tag,
            max_terms=max_terms,
            min_cooccurrence=min_cooccurrence,
            temporal=temporal,
            extraction_source=extraction_source,
            counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath,
            relevance_ratio=relevance_ratio
        )
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Exception in Python script: {str(e)}"}))
        sys.exit(1)
