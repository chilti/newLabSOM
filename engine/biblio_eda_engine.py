import json
from collections import defaultdict, Counter

def calculate_h_index(citations_list):
    citations = sorted([int(c) for c in citations_list if str(c).isdigit()], reverse=True)
    h_index = 0
    for i, c in enumerate(citations):
        if c >= i + 1:
            h_index = i + 1
        else:
            break
    return h_index

def calculate_g_index(citations_list):
    citations = sorted([int(c) for c in citations_list if str(c).isdigit()], reverse=True)
    g_index = 0
    sum_citations = 0
    for i, c in enumerate(citations):
        sum_citations += c
        if sum_citations >= (i + 1) ** 2:
            g_index = i + 1
        else:
            break
    return g_index

def calculate_m_index(h_index, first_year, current_year=2026):
    try:
        years_active = current_year - int(first_year)
        if years_active <= 0:
            years_active = 1
        return round(h_index / years_active, 3)
    except Exception:
        return 0.0

def generate_eda_report(records):
    """
    Computes Descriptive EDA and Author metrics without pybibx.
    records: list of dictionaries representing parsed bibliographic records.
    """
    total_docs = len(records)
    if total_docs == 0:
        return {"success": False, "error": "No records to analyze."}

    authors_docs = defaultdict(list)
    authors_cits = defaultdict(list)
    authors_years = defaultdict(list)
    
    sources_count = Counter()
    countries_count = Counter()
    languages_count = Counter()
    keywords_count = Counter()
    
    total_citations = 0
    multi_authored = 0
    single_authored = 0
    
    for r in records:
        # Resolve fields flexibly (Scopus CSV vs RIS vs Web of Science)
        authors_raw = r.get('Authors', r.get('authors', []))
        if isinstance(authors_raw, list):
            authors = authors_raw
        else:
            authors = [a.strip() for a in str(authors_raw).split(';') if a.strip()]
            
        year = r.get('Year', r.get('year', ''))
        source = r.get('Source title', r.get('journal', ''))
        cits = r.get('Cited by', r.get('TC', r.get('tc', 0)))
        affils = r.get('Affiliations', r.get('affiliations', ''))
        language = r.get('Language', r.get('language', 'English'))
        
        kw_raw = r.get('Author Keywords', r.get('keywords', []))
        if isinstance(kw_raw, list):
            keywords = kw_raw
        else:
            keywords = [k.strip() for k in str(kw_raw).split(';') if k.strip()]
            
        cits_val = 0
        if str(cits).isdigit():
            cits_val = int(cits)
        total_citations += cits_val
        
        n_authors = len(authors)
        if n_authors > 1:
            multi_authored += 1
        elif n_authors == 1:
            single_authored += 1
            
        for a in authors:
            authors_docs[a].append(1)
            authors_cits[a].append(cits_val)
            if str(year).isdigit():
                authors_years[a].append(int(year))
                
        if source:
            sources_count[source] += 1
        if language:
            languages_count[language] += 1
            
        for kw in keywords:
            if len(kw) > 1:
                keywords_count[kw.lower()] += 1
            
        # Extract countries from affiliations if possible
        if affils:
            if isinstance(affils, str):
                for aff in affils.split(';'):
                    parts = aff.split(',')
                    if parts:
                        country = parts[-1].strip().lower()
                        if len(country) > 2:
                            countries_count[country] += 1

    unique_authors = len(authors_docs)
    
    # Calculate Author Metrics
    author_metrics = []
    for a in authors_docs.keys():
        docs_count = len(authors_docs[a])
        cits_list = authors_cits[a]
        total_cits_a = sum(cits_list)
        h_idx = calculate_h_index(cits_list)
        g_idx = calculate_g_index(cits_list)
        
        first_yr = min(authors_years[a]) if authors_years[a] else 2026
        m_idx = calculate_m_index(h_idx, first_yr)
        
        author_metrics.append({
            "author": a,
            "documents": docs_count,
            "citations": total_cits_a,
            "h_index": h_idx,
            "g_index": g_idx,
            "m_index": m_idx,
            "first_year": first_yr
        })
        
    author_metrics = sorted(author_metrics, key=lambda x: x['h_index'], reverse=True)[:100]
    
    timespan = "N/A"
    all_years = [y for yl in authors_years.values() for y in yl]
    if all_years:
        timespan = f"{min(all_years)} - {max(all_years)}"

    report = {
        "success": True,
        "health": {
            "timespan": timespan,
            "total_documents": total_docs,
            "total_authors": unique_authors,
            "total_sources": len(sources_count),
            "total_countries": len(countries_count),
            "single_authored_docs": single_authored,
            "multi_authored_docs": multi_authored,
            "total_citations": total_citations
        },
        "averages": {
            "docs_per_author": round(total_docs / unique_authors, 2) if unique_authors > 0 else 0,
            "cits_per_doc": round(total_citations / total_docs, 2) if total_docs > 0 else 0,
            "collab_index": round(sum([len(authors_docs[a]) for a in authors_docs]) / total_docs, 2) if total_docs > 0 else 0
        },
        "author_metrics": author_metrics,
        "top_keywords": [{"text": k, "value": v} for k, v in keywords_count.most_common(100)],
        "languages": [{"name": k, "count": v} for k, v in languages_count.most_common(10)]
    }
    return report

def generate_sankey_data(records, top_n=10):
    """
    Generates data for a Sankey diagram: Country -> Institution -> Journal
    """
    links = defaultdict(int)
    nodes_set = set()
    
    for r in records:
        affils = r.get('Affiliations', r.get('affiliations', ''))
        source = r.get('Source title', r.get('journal', ''))
        if not source or not affils:
            continue
            
        source = str(source).title()
        if isinstance(affils, str):
            for aff in affils.split(';'):
                parts = aff.split(',')
                if len(parts) >= 2:
                    institution = parts[0].strip().title()
                    country = parts[-1].strip().title()
                    
                    if len(country) > 2 and len(institution) > 2:
                        nodes_set.add(country)
                        nodes_set.add(institution)
                        nodes_set.add(source)
                        
                        links[(country, institution)] += 1
                        links[(institution, source)] += 1
                        
    # Convert to D3/Recharts format
    sorted_links = sorted(links.items(), key=lambda x: x[1], reverse=True)[:top_n * 3]
    
    filtered_nodes = set()
    sankey_links = []
    for (src, dst), weight in sorted_links:
        filtered_nodes.add(src)
        filtered_nodes.add(dst)
        
    node_list = list(filtered_nodes)
    node_idx = {n: i for i, n in enumerate(node_list)}
    
    for (src, dst), weight in sorted_links:
        sankey_links.append({
            "source": node_idx[src],
            "target": node_idx[dst],
            "value": weight,
            "sourceName": src,
            "targetName": dst
        })
        
    return {
        "nodes": [{"name": n} for n in node_list],
        "links": sankey_links
    }

def generate_term_growth(records, top_n=5):
    """
    Generates temporal growth of top keywords.
    """
    year_term_count = defaultdict(lambda: defaultdict(int))
    term_total = Counter()
    
    for r in records:
        year = r.get('Year', r.get('year', ''))
        kw_raw = r.get('Author Keywords', r.get('keywords', []))
        if not str(year).isdigit() or not kw_raw:
            continue
            
        if isinstance(kw_raw, list):
            keywords = kw_raw
        else:
            keywords = [k.strip().lower() for k in str(kw_raw).split(';') if k.strip()]
            
        y = int(year)
        for kw in keywords:
            if len(kw) > 2:
                year_term_count[y][kw] += 1
                term_total[kw] += 1
                
    top_terms = [k for k, v in term_total.most_common(top_n)]
    
    growth_data = []
    if year_term_count:
        min_y = min(year_term_count.keys())
        max_y = max(year_term_count.keys())
        
        for y in range(min_y, max_y + 1):
            row = {"year": str(y)}
            for t in top_terms:
                row[t] = year_term_count[y].get(t, 0)
            growth_data.append(row)
            
    return {
        "data": growth_data,
        "lines": top_terms
    }
