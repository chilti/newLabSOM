"""
vos_parsers.py - Extended parsers for Dimensions, Lens, and native VOSviewer files for knoMap
---------------------------------------------------------------------------------------------
"""

import os
import json
import csv
from typing import List, Dict, Any, Optional, Tuple


def is_dimensions_csv(filepath: str) -> bool:
    """Checks if a CSV file is an export from Dimensions."""
    if not filepath.lower().endswith('.csv'):
        return False
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            # Check first 3 lines (Dimensions sometimes includes metadata headers)
            for _ in range(3):
                line = f.readline().lower()
                if 'dimensions' in line or ('publication title' in line and 'times cited' in line) or ('title' in line and 'doi' in line and 'funder' in line):
                    return True
    except Exception:
        pass
    return False


def is_openalex_csv(filepath: str) -> bool:
    """Checks if a CSV file is an export from OpenAlex."""
    if not filepath.lower().endswith('.csv'):
        return False
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            first_line = f.readline().lower()
            if 'work id' in first_line or 'concept ids' in first_line or 'keyword ids' in first_line:
                return True
            if 'open access' in first_line and 'concept' in first_line and 'author' in first_line:
                return True
            if 'fwci' in first_line and 'topic' in first_line:
                return True
    except Exception:
        pass
    return False


def is_lens_csv(filepath: str) -> bool:
    """Checks if a CSV file is an export from Lens.org."""
    if not filepath.lower().endswith('.csv'):
        return False
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            first_line = f.readline().lower()
            if 'lens id' in first_line or ('citing works count' in first_line and 'publication year' in first_line):
                return True
    except Exception:
        pass
    return False


def is_vos_native_file(filepath: str) -> bool:
    """Checks if a file is a native VOSviewer JSON or MAP/NETWORK text file."""
    lower = filepath.lower()
    if lower.endswith('.json'):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                d = json.load(f)
                return isinstance(d, dict) and ('network' in d or 'items' in d)
        except Exception:
            return False
    if lower.endswith('.map') or lower.endswith('.net') or 'map.txt' in lower or 'network.txt' in lower:
        return True
    return False


def parse_dimensions_csv(filepath: str) -> List[Dict[str, Any]]:
    """Parses a Dimensions CSV export into standardized records."""
    records = []
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        # Skip potential preface lines until actual CSV header
        pos = f.tell()
        line = f.readline()
        while line and not ('title' in line.lower() and ('doi' in line.lower() or 'authors' in line.lower())):
            pos = f.tell()
            line = f.readline()
        f.seek(pos)

        reader = csv.DictReader(f)
        for row in reader:
            title = row.get('Title') or row.get('Publication Title') or ''
            if not title:
                continue

            abstract = row.get('Abstract') or ''
            year = row.get('Publication Year') or row.get('Year') or ''
            if year:
                year = str(year).strip()[:4]

            citations = 0
            cit_raw = row.get('Times cited') or row.get('Citations') or '0'
            try:
                citations = float(cit_raw.replace(',', ''))
            except Exception:
                citations = 0

            # Authors
            authors_raw = row.get('Authors') or ''
            authors = [a.strip() for a in authors_raw.split(';') if a.strip()]

            # Keywords / MeSH
            mesh = row.get('MeSH terms') or ''
            mesh_list = [m.strip() for m in mesh.split(';') if m.strip()]
            for_terms = row.get('Fields of Research (ANZSRC 2020)') or ''
            for_list = [t.strip() for t in for_terms.split(';') if t.strip()]

            keywords = mesh_list + for_list

            rec = {
                'title': title,
                'abstract': abstract,
                'year': year,
                'citations': citations,
                'authors': authors,
                'keywords': keywords,
                'source': row.get('Source title') or row.get('Journal') or '',
                'doi': row.get('DOI') or ''
            }
            records.append(rec)
    return records


def parse_lens_csv(filepath: str) -> List[Dict[str, Any]]:
    """Parses a Lens.org CSV export into standardized records."""
    records = []
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = row.get('Title') or ''
            if not title:
                continue

            abstract = row.get('Abstract') or ''
            year = row.get('Publication Year') or row.get('Year') or ''
            if year:
                year = str(year).strip()[:4]

            citations = 0
            cit_raw = row.get('Citing Works Count') or row.get('Citations') or '0'
            try:
                citations = float(cit_raw.replace(',', ''))
            except Exception:
                citations = 0

            # Authors
            authors_raw = row.get('Authors') or ''
            authors = [a.strip() for a in authors_raw.split(';') if a.strip()]

            # Keywords & Mesh
            kw_raw = row.get('Keywords') or ''
            mesh_raw = row.get('Mesh Terms') or ''
            keywords = [k.strip() for k in (kw_raw + ';' + mesh_raw).split(';') if k.strip()]

            rec = {
                'title': title,
                'abstract': abstract,
                'year': year,
                'citations': citations,
                'authors': authors,
                'keywords': keywords,
                'source': row.get('Source Title') or row.get('Journal') or '',
                'doi': row.get('DOI') or ''
            }
            records.append(rec)
    return records


def parse_openalex_csv(filepath: str) -> List[Dict[str, Any]]:
    """Parses an OpenAlex CSV export into standardized records with all available fields."""
    records = []
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = (row.get('Title') or '').strip()
            if not title:
                continue

            abstract = (row.get('Abstract') or '').strip()
            if abstract == '.':
                abstract = ''

            year = (row.get('Year') or '').strip()
            if not year and row.get('Date'):
                date_val = str(row.get('Date')).strip()
                if len(date_val) >= 4:
                    year = date_val[:4]

            citations = 0
            cit_raw = row.get('Citation count') or row.get('Cited by') or '0'
            try:
                citations = float(str(cit_raw).replace(',', ''))
            except Exception:
                citations = 0

            # Authors (pipe-separated)
            authors_raw = row.get('Author') or ''
            authors = [a.strip() for a in str(authors_raw).split('|') if a.strip() and a.strip().lower() != 'nan']

            # Keywords & Concepts (pipe-separated)
            kw_raw = row.get('Keyword') or ''
            author_keywords = [k.strip() for k in str(kw_raw).split('|') if k.strip() and k.strip().lower() != 'nan']

            concepts_raw = row.get('Concept') or ''
            concepts = [c.strip() for c in str(concepts_raw).split('|') if c.strip() and c.strip().lower() != 'nan']

            # Combined keywords
            keywords = list(dict.fromkeys(author_keywords + concepts))

            # Topics / Fields / Subfields
            topics = []
            for t_col in ['Topic', 'Subfield', 'Field', 'Domain']:
                t_val = row.get(t_col) or ''
                if t_val and str(t_val).strip().lower() != 'nan':
                    topics.extend([t.strip() for t in str(t_val).split('|') if t.strip()])
            topics = list(dict.fromkeys(topics))

            # Institutions / Organizations
            inst_raw = row.get('Institution') or ''
            organizations = [i.strip() for i in str(inst_raw).split('|') if i.strip() and i.strip().lower() != 'nan']

            # Countries
            country_raw = row.get('Country') or ''
            countries = [c.strip() for c in str(country_raw).split('|') if c.strip() and c.strip().lower() != 'nan']

            # Continents
            continent_raw = row.get('Continent') or ''
            continents = [c.strip() for c in str(continent_raw).split('|') if c.strip() and c.strip().lower() != 'nan']

            # Funders
            funder_raw = row.get('Funder') or ''
            funders = [f.strip() for f in str(funder_raw).split('|') if f.strip() and f.strip().lower() != 'nan']

            # Source / Journal
            source = (row.get('Source') or row.get('Any location source') or '').strip()
            if source.lower() == 'nan':
                source = ''

            # DOI
            doi = (row.get('DOI') or '').strip()
            if doi.lower() == 'nan':
                doi = ''

            rec = {
                'title': title,
                'abstract': abstract,
                'year': year,
                'citations': citations,
                'authors': authors,
                'keywords': keywords,
                'author_keywords': author_keywords,
                'concepts': concepts,
                'topics': topics,
                'organizations': organizations,
                'countries': countries,
                'continents': continents,
                'funders': funders,
                'source': source,
                'doi': doi,
                'work_id': (row.get('Work ID') or '').strip(),
                'open_access': (row.get('Open access') or '').strip(),
                'fwci': (row.get('FWCI') or '').strip(),
                # Metaknowledge / WOS tags compatibility
                'TI': title,
                'AU': authors,
                'PY': year,
                'TC': citations,
                'DE': author_keywords,
                'ID': concepts,
                'SO': source,
                'C1': organizations,
                'CU': countries,
                'FU': funders,
                'AB': abstract,
                'DI': doi,
                'Topic': topics,
                'Concept': concepts,
                'Continent': continents
            }
            records.append(rec)
    return records


def parse_vos_native_json(filepath: str) -> Dict[str, Any]:
    """Reads a native VOSviewer JSON file and prepares it for knoMap."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data.get('network', {}).get('items', []) or data.get('items', [])
    links = data.get('network', {}).get('links', []) or data.get('links', [])

    # Format nodes & edges
    nodes = [
        {
            "data": {
                "id": str(it.get('id', idx + 1)),
                "label": it.get('label', f"Item {idx + 1}"),
                "frequency": it.get('weights', {}).get('Occurrences', 1),
                "cluster": it.get('cluster', 1),
                "avg_year": it.get('scores', {}).get('Avg. pub. year'),
                "avg_citations": it.get('scores', {}).get('Avg. citations')
            }
        }
        for idx, it in enumerate(items)
    ]

    edges = [
        {
            "data": {
                "source": str(l.get('source_id')),
                "target": str(l.get('target_id')),
                "weight": l.get('strength', 1)
            }
        }
        for l in links
    ]

    return {
        "success": True,
        "document_count": len(items),
        "network": {"nodes": nodes, "edges": edges},
        "vosviewer_json": data if 'network' in data else {"network": {"items": items, "links": links}},
        "term_counts": {n["data"]["id"]: n["data"]["frequency"] for n in nodes},
        "frequency_csv": "",
        "cooccurrence_csv": ""
    }
