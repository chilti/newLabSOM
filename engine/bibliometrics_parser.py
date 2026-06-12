import sys
import json
import os
import csv as csv_module
import tempfile
from collections import defaultdict
from itertools import combinations
import networkx as nx
# Monkey-patch NetworkX for metaknowledge compatibility (G.node was removed in 3.0)
if not hasattr(nx.Graph, 'node'):
    nx.Graph.node = property(lambda self: self.nodes)
import pandas as pd
import metaknowledge as mk


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
                          max_terms, min_cooccurrence, temporal):
    """
    Full pipeline for Scopus CSV files using pandas instead of MetaKnowledge.

    MetaKnowledge's Scopus support uses full column names as internal tags
    ('Author Keywords', not 'DE'), which breaks when the UI sends WOS-style
    tags.  This function reads the CSV directly with pandas and builds the
    network from scratch, giving us full control over both old and new formats.

    Supports all network types that depend on per-document term lists:
      co-occurrence, co-authorship, bipartite
    Falls back to MetaKnowledge for citation-graph types.
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

    # ── Citation-graph types: let MetaKnowledge handle them ───────────────────
    if network_type in ('co-citation', 'citation', 'bib-coupling'):
        return {
            "success": False,
            "error": (
                f"Network type '{network_type}' requires a Web of Science .txt export. "
                "Scopus CSV does not contain enough citation data for this analysis."
            )
        }

    # ── Build records list ────────────────────────────────────────────────────
    records = df.to_dict(orient='records')
    if not records:
        return {"success": False, "error": "No records found in Scopus CSV."}

    # ── Choose term getter based on network_type ──────────────────────────────
    if network_type == 'co-authorship':
        col = 'Authors'
        def term_getter(row): return get_terms(row, col)

    elif network_type == 'co-occurrence':
        col = scopus_col(custom_tag)
        def term_getter(row): return get_terms(row, col)

    elif network_type == 'bipartite':
        tag1_wos, tag2_wos = 'AU', 'DE'
        if ',' in custom_tag:
            tag1_wos, tag2_wos = custom_tag.split(',', 1)
        col1 = scopus_col(tag1_wos.strip())
        col2 = scopus_col(tag2_wos.strip())
        # For bipartite we build two separate term lists
        def term_getter(row):   # returns (list1, list2)
            return get_terms(row, col1), get_terms(row, col2)

    else:
        return {"success": False, "error": f"Unknown network type: {network_type}"}

    # ── Build graph ───────────────────────────────────────────────────────────
    if network_type == 'bipartite':
        global_graph = _build_bipartite_graph(records, term_getter, tag1_wos, tag2_wos)
    else:
        global_graph = _build_cooccurrence_graph_from_records(records, term_getter)

    if len(global_graph) == 0:
        col_used = col if network_type != 'bipartite' else f"{col1}/{col2}"
        return {
            "success": False,
            "error": (
                f"No usable terms found in column '{col_used}'. "
                "Try a different network type or verify the file has keyword data."
            )
        }

    # ── Filter, convert, build matrices — shared logic ────────────────────────
    return _finalize_network(
        global_graph, records, network_type, custom_tag,
        max_terms, min_cooccurrence, temporal,
        term_getter_for_matrix=term_getter if network_type != 'bipartite' else None,
        record_title_getter=lambda r: r.get('Title', 'Unknown'),
        record_year_getter=lambda r: r.get('Year', 'N/A'),
        doc_count=len(records),
    )


def _build_bipartite_graph(records, term_getter, tag1, tag2):
    """Build a bipartite networkx graph from Scopus CSV records."""
    from collections import Counter
    pair_freq  = Counter()
    freq1, freq2 = Counter(), Counter()

    for rec in records:
        terms1, terms2 = term_getter(rec)
        terms1 = list(set(terms1))
        terms2 = list(set(terms2))
        freq1.update(terms1)
        freq2.update(terms2)
        for t1 in terms1:
            for t2 in terms2:
                pair_freq[(t1, t2)] += 1

    G = nx.Graph()
    for t, c in freq1.items():
        G.add_node(t, count=c, type=tag1)
    for t, c in freq2.items():
        G.add_node(t, count=c, type=tag2)
    for (t1, t2), w in pair_freq.items():
        G.add_edge(t1, t2, weight=w)
    return G


def _finalize_network(global_graph, records, network_type, custom_tag,
                       max_terms, min_cooccurrence, temporal,
                       term_getter_for_matrix, record_title_getter,
                       record_year_getter, doc_count):
    """
    Shared post-processing: filter top nodes, build JSON + CSV matrices.
    Used by both the Scopus CSV and RIS pipelines.
    """
    # ── Filter top terms ──────────────────────────────────────────────────────
    if network_type == 'bipartite':
        tag1_wos, tag2_wos = 'AU', 'DE'
        if ',' in custom_tag:
            tag1_wos, tag2_wos = custom_tag.split(',', 1)
            tag1_wos, tag2_wos = tag1_wos.strip(), tag2_wos.strip()

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
        if network_type == 'bipartite':
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
    if term_getter_for_matrix and network_type == 'co-occurrence':
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
            y_graph = _build_cooccurrence_graph_from_records(recs_y, term_getter_for_matrix)
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
            networks_by_year[y] = {"nodes": y_nodes, "edges": y_edges, "cooccurrence_csv": y_df.to_csv()}

        if temporal_matrix_data:
            df_t = pd.DataFrame(temporal_matrix_data,
                                columns=[str(n) for n in sorted_top_nodes],
                                index=temporal_row_labels)
            frequency_csv = df_t.to_csv()

    result = {
        "success": True,
        "document_count": doc_count,
        "network": {"nodes": nodes, "edges": edges},
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


def _build_cooccurrence_graph_from_records(records, term_getter):
    """
    Build a MetaKnowledge-compatible networkx graph from a list of record dicts.

    term_getter(record) → list[str]

    Nodes carry 'count' (document frequency).
    Edges carry 'weight' (co-occurrence count).
    """
    from collections import Counter

    term_freq = Counter()
    pair_freq = Counter()

    for rec in records:
        terms = term_getter(rec)
        # Normalise: lowercase, strip, deduplicate per document
        terms = list({t.lower().strip() for t in terms if t.strip()})
        term_freq.update(terms)
        for pair in combinations(sorted(terms), 2):
            pair_freq[pair] += 1

    G = nx.Graph()
    for term, count in term_freq.items():
        G.add_node(term, count=count)
    for (t1, t2), weight in pair_freq.items():
        G.add_edge(t1, t2, weight=weight)
    return G


def _process_ris_file(filepath, network_type, custom_tag,
                       max_terms, min_cooccurrence, temporal):
    """
    Full pipeline for RIS files without MetaKnowledge.
    Supports: co-occurrence (keywords) and co-authorship.
    """
    records = _parse_ris_records(filepath)
    if not records:
        return {"success": False, "error": "No records found in RIS file."}

    # ── Choose term getter ────────────────────────────────────────────────────
    if network_type == 'co-authorship':
        def term_getter(r): return r.get('authors', [])
    elif network_type == 'co-occurrence':
        # DE (Author Keywords) and ID (Index Keywords) both map to 'keywords' in RIS
        def term_getter(r): return r.get('keywords', [])
    else:
        return {
            "success": False,
            "error": (
                f"Network type '{network_type}' is not yet supported for RIS files. "
                "Supported types: 'co-occurrence' (keywords) and 'co-authorship'. "
                "For citation networks, please export as Web of Science .txt format."
            )
        }

    global_graph = _build_cooccurrence_graph_from_records(records, term_getter)

    if len(global_graph) == 0:
        field = "keywords" if network_type == "co-occurrence" else "authors"
        return {
            "success": False,
            "error": f"No usable {field} found in the RIS file for network type '{network_type}'."
        }

    # ── Filter top terms ──────────────────────────────────────────────────────
    node_frequencies = {n: d.get('count', 1) for n, d in global_graph.nodes(data=True)}
    sorted_nodes     = sorted(node_frequencies.items(), key=lambda x: x[1], reverse=True)
    top_nodes_set    = {n for n, _ in sorted_nodes[:max_terms]}

    global_graph = global_graph.subgraph(top_nodes_set).copy()
    edges_to_remove = [
        (u, v) for u, v, d in global_graph.edges(data=True)
        if d.get('weight', 1) < min_cooccurrence
    ]
    global_graph.remove_edges_from(edges_to_remove)

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

    # ── Co-occurrence adjacency matrix ────────────────────────────────────────
    sorted_top_nodes = sorted(list(global_graph.nodes()))
    try:
        df_cooc = nx.to_pandas_adjacency(global_graph, nodelist=sorted_top_nodes, weight='weight')
        for n in sorted_top_nodes:
            df_cooc.at[n, n] = term_counts.get(str(n), 1)
        cooccurrence_csv = df_cooc.to_csv()
    except Exception:
        cooccurrence_csv = ""

    # ── Document-term frequency matrix ────────────────────────────────────────
    matrix_data, row_labels = [], []
    for rec in records:
        terms = term_getter(rec)
        doc_terms = {t.lower().strip() for t in terms}
        row = [1 if str(n) in doc_terms else 0 for n in sorted_top_nodes]
        if any(row):
            matrix_data.append(row)
            title = rec.get('title', 'Unknown')
            year  = rec.get('year', 'N/A')
            row_labels.append(f"{str(title)[:50]} ({year})")

    if matrix_data:
        df_freq = pd.DataFrame(matrix_data,
                               columns=[str(n) for n in sorted_top_nodes],
                               index=row_labels)
        frequency_csv = df_freq.to_csv()
    else:
        frequency_csv = cooccurrence_csv

    # ── Temporal networks (RIS) ───────────────────────────────────────────────
    networks_by_year = {}
    if temporal:
        years = sorted({
            int(r['year']) for r in records
            if r.get('year', '').isdigit() and len(r.get('year', '')) == 4
        })
        temporal_matrix_data, temporal_row_labels = [], []

        for y in years:
            recs_y = [r for r in records if r.get('year', '') == str(y)]
            if not recs_y:
                continue
            y_graph = _build_cooccurrence_graph_from_records(recs_y, term_getter)
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

            networks_by_year[str(y)] = {
                "nodes": y_nodes,
                "edges": y_edges,
                "cooccurrence_csv": y_df.to_csv()
            }

        if temporal_matrix_data:
            df_temporal = pd.DataFrame(temporal_matrix_data,
                                       columns=[str(n) for n in sorted_top_nodes],
                                       index=temporal_row_labels)
            frequency_csv = df_temporal.to_csv()

    result = {
        "success": True,
        "document_count": len(records),
        "network": {"nodes": nodes, "edges": edges},
        "term_counts": term_counts,
        "frequency_csv": frequency_csv,
        "cooccurrence_csv": cooccurrence_csv,
    }
    if temporal:
        result["networks_by_year"] = networks_by_year
    return result


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def read_and_generate_bibliometrics(filepath, network_type="co-occurrence", custom_tag="DE", max_terms=100, min_cooccurrence=2, temporal=False):
    """
    Reads a bibliometrics file and generates a co-occurrence / citation network.

    Supported formats (auto-detected):
      - Web of Science plain text (.txt)
      - PubMed / Medline plain text (.txt)
      - ProQuest (.txt)
      - Scopus CSV (.csv)  — including the new 2023+ export format
      - RIS (.ris)         — co-occurrence and co-authorship only

    network_type options:
      'co-authorship', 'co-citation', 'citation',
      'bib-coupling', 'co-occurrence', 'bipartite'
    """

    # ── Route RIS files to the dedicated parser ───────────────────────────────
    if _is_ris_file(filepath):
        return _process_ris_file(filepath, network_type, custom_tag,
                                  max_terms, min_cooccurrence, temporal)

    # ── Route Scopus CSV to the pandas-based parser ───────────────────────────
    if _is_scopus_csv(filepath):
        return _process_scopus_csv(filepath, network_type, custom_tag,
                                    max_terms, min_cooccurrence, temporal)

    # ── All other formats go through MetaKnowledge ────────────────────────────
    return _metaknowledge_process(filepath, network_type, custom_tag,
                                   max_terms, min_cooccurrence, temporal)


def _metaknowledge_process(filepath, network_type, custom_tag,
                            max_terms, min_cooccurrence, temporal):
    """Original MetaKnowledge-based processing (WOS, Medline, ProQuest, Scopus CSV)."""

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
        except Exception:
            pass   # Ignore and let metaknowledge try its best

    # 2. Parse using metaknowledge
    try:
        RC = mk.RecordCollection(filepath)
    except Exception as e:
        return {"success": False, "error": f"Failed to parse file with MetaKnowledge: {str(e)}"}

    if len(RC) == 0:
        return {"success": False, "error": "No records found in the file."}

    # 3. Build Global Graph
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
            tag1, tag2 = "AU", "DE"
            if "," in custom_tag:
                tag1, tag2 = custom_tag.split(",", 1)
            global_graph = RC.networkTwoMode(tag1, tag2)
        else:
            return {"success": False, "error": f"Unknown network type: {network_type}"}
    except Exception as e:
        return {"success": False, "error": f"Failed to generate network '{network_type}': {str(e)}"}

    # 4. Filter top terms
    if network_type == 'bipartite':
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
        if network_type == 'bipartite':
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

    matrix_data, row_labels = [], []
    if network_type == 'co-occurrence':
        for r in RC:
            if custom_tag in r:
                val = r[custom_tag]
                if isinstance(val, str):
                    val = [val]
                elif val is None:
                    continue
                doc_terms = {str(t).lower() for t in val}
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

                y_graph = y_graph.subgraph(top_nodes_set).copy()
                y_graph.remove_edges_from([
                    (u, v) for u, v, d in y_graph.edges(data=True)
                    if d.get('weight', 1) < min_cooccurrence
                ])
                y_nodes, y_edges = graph_to_json(y_graph)

                if network_type == 'bipartite':
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

                networks_by_year[str(y)] = {"nodes": y_nodes, "edges": y_edges, "cooccurrence_csv": y_cooc_csv}
            except Exception:
                pass

        if temporal_matrix_data:
            df_temporal = pd.DataFrame(temporal_matrix_data,
                                       columns=[str(n) for n in matrix_cols],
                                       index=temporal_row_labels)
            frequency_csv = df_temporal.to_csv()

    # 8. Build result
    result_dict = {
        "success": True,
        "document_count": len(RC),
        "network": {"nodes": nodes, "edges": edges},
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

        result = read_and_generate_bibliometrics(
            filepath,
            network_type=network_type,
            custom_tag=custom_tag,
            max_terms=max_terms,
            min_cooccurrence=min_cooccurrence,
            temporal=temporal,
        )
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Exception in Python script: {str(e)}"}))
        sys.exit(1)
