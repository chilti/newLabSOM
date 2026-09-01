import os
import re
import json
import zipfile
import shutil
import tempfile
import pandas as pd
import numpy as np
import io
import warnings

# Suppress warnings that pollute stdout and break JSON parsing in C#
warnings.filterwarnings("ignore")

def identify_file_type(filename):
    """
    Returns (unit_type, period) by inspecting the filename.
    Dynamically extracts unit names for standard or custom InCites export files
    (e.g., 'Incites Organizations Colab 2021-2025.xlsx' -> unit='Organizations Colab', period='5Years').
    """
    base = os.path.basename(filename)
    name, ext = os.path.splitext(base)
    if ext.lower() not in ('.csv', '.xlsx', '.xls', '.xlsb'):
        return None, None

    clean = re.sub(r'^up_[a-zA-Z0-9]+_', '', name)

    # Determine period
    period = "Whole"
    if re.search(r'Trend', clean, re.IGNORECASE):
        period = "Trend"
        clean = re.sub(r'[\s_]*Trend[\s_]*', ' ', clean, flags=re.IGNORECASE)
    elif re.search(r'\d{4}\s*-\s*\d{4}', clean):
        period = "5Years"
        clean = re.sub(r'[\s_]*\d{4}\s*-\s*\d{4}[\s_]*', ' ', clean)
    elif re.search(r'\b(19|20)\d{2}\b', clean):
        period = "5Years"
        clean = re.sub(r'[\s_]*\b(19|20)\d{2}\b[\s_]*', ' ', clean)

    # Strip leading 'Incites' / 'InCites'
    clean = re.sub(r'^(incites|in_cites)[\s_]*', '', clean, flags=re.IGNORECASE)

    # Handle 'Research Areas' vs specific sub-units (ESI, SDG, Topics, etc.)
    if re.match(r'^Research[\s_]*Areas[\s_]+(ESI|SDG|Macro|Meso|Micro|WoS)', clean, re.IGNORECASE):
        clean = re.sub(r'^Research[\s_]*Areas[\s_]+', '', clean, flags=re.IGNORECASE)
    else:
        clean = re.sub(r'^Research[\s_]*Areas', 'WoS Categories', clean, flags=re.IGNORECASE)

    clean = clean.strip()
    clean = re.sub(r'\s+', ' ', clean)

    # Canonical naming for standard units
    if re.match(r'^WoS[\s_]*Categories$', clean, re.IGNORECASE):
        clean = "WoS Categories"
    elif re.match(r'^Publication[\s_]*Sources$', clean, re.IGNORECASE):
        clean = "Publication Sources"
    elif re.match(r'^Funding[\s_]*Agencies$', clean, re.IGNORECASE):
        clean = "Funding Agencies"
    elif re.match(r'^Organizations$', clean, re.IGNORECASE):
        clean = "Organizations"
    elif re.match(r'^Locations$', clean, re.IGNORECASE):
        clean = "Locations"
    elif re.match(r'^Researchers$', clean, re.IGNORECASE):
        clean = "Researchers"
    elif re.match(r'^Patentometrics$', clean, re.IGNORECASE):
        clean = "Patentometrics"

    if not clean:
        clean = "Dataset Unit"

    return clean, period


def clean_and_read_file(filepath):
    try:
        lower_path = filepath.lower()
        if lower_path.endswith('.csv'):
            # Step 1: Find the real header row by reading raw text lines
            # InCites CSVs often start with a metadata row like:
            #   "InCites dataset updated Feb 2026."
            # When pandas reads this, the whole file collapses into 1 column.
            # The fix: scan the first 15 lines as text, find the line with
            # the most field separators, and use skiprows to skip past it.
            encoding_used = 'utf-8-sig'
            header_idx = 0

            for enc in ['utf-8-sig', 'utf-8', 'cp1252', 'latin-1']:
                try:
                    with open(filepath, 'r', encoding=enc, errors='replace') as f:
                        sample_lines = [f.readline() for _ in range(15)]
                    encoding_used = enc
                    break
                except Exception:
                    continue

            # Count commas (CSV) or tabs per line
            sep_counts = [max(line.count(','), line.count('\t')) for line in sample_lines]
            max_seps = max(sep_counts) if sep_counts else 0
            if max_seps > 1:
                # Use the FIRST line that has the maximum separator count as header
                header_idx = next(i for i, c in enumerate(sep_counts) if c == max_seps)

            sep = '\t' if sample_lines[header_idx].count('\t') > sample_lines[header_idx].count(',') else ','

            try:
                df = pd.read_csv(filepath, skiprows=header_idx, encoding=encoding_used,
                                 sep=sep, on_bad_lines='skip')
            except Exception:
                # Fallback: try all encodings without skiprows
                df = None
                for enc in ['utf-8-sig', 'utf-8', 'cp1252', 'latin-1']:
                    try:
                        df = pd.read_csv(filepath, encoding=enc, on_bad_lines='skip')
                        break
                    except UnicodeDecodeError:
                        continue
                if df is None:
                    df = pd.read_csv(filepath, encoding='utf-8', encoding_errors='replace',
                                     on_bad_lines='skip')

        elif lower_path.endswith('.xlsx') or lower_path.endswith('.xls') or lower_path.endswith('.xlsb'):
            # Read Excel without header first to scan for the real header row
            df_raw = pd.read_excel(filepath, header=None)
            if df_raw is None or df_raw.empty:
                return None

            # Find the row with the most non-null values (that's the real header)
            header_idx = 0
            max_valid = 0
            for i in range(min(10, len(df_raw))):
                valid_count = df_raw.iloc[i].dropna().count()
                if valid_count > max_valid:
                    max_valid = valid_count
                    header_idx = i

            df = pd.read_excel(filepath, skiprows=header_idx)
        else:
            return None

        if df is None or df.empty:
            return df

        df = df.dropna(how='all', axis=1)
        df = df.dropna(how='all', axis=0)

        # Rename any remaining "Unnamed" column to remove confusion
        df.columns = [
            c if not str(c).startswith('Unnamed') else df.columns[idx]
            for idx, c in enumerate(df.columns)
        ]

        # Convert numeric-looking string columns to actual numeric types
        for col in df.columns:
            if df[col].dtype == object:
                converted = pd.to_numeric(
                    df[col].astype(str).str.replace(',', '').str.replace('%', '').str.strip(),
                    errors='coerce'
                )
                # Only replace if the conversion didn't make everything NaN
                non_null_original = df[col].dropna().shape[0]
                non_null_converted = converted.dropna().shape[0]
                if non_null_converted > 0 and non_null_converted >= non_null_original * 0.5:
                    df[col] = converted

        return df
    except Exception as e:
        print(f"Error loading {filepath}: {e}", flush=True)
    return None



def calculate_ecma(series, window=3):
    return series.ewm(span=window, adjust=False).mean()


# ── Indicators that CANNOT be averaged across topics (must be summed) ───────
# Ratios / normalised indicators should be averaged; absolute counts summed.
SUMMABLE_INDICATORS = {
    'Web of Science Documents', 'Times Cited', 'Citations From Patents',
    'Documents in Top 1%', 'Documents in Top 10%',
    'Documents in Q1 Journals', 'Documents in Q2 Journals',
    'Documents in Q3 Journals', 'Documents in Q4 Journals',
    'Highly Cited Papers', 'Hot Papers',
    'All Open Access Documents', 'Gold Documents',
}


def _decode_topic_code(full_name: str):
    """
    Decode the InCites topic code embedded in the row label.
    Format: "MacroID.MesoID.MicroID Rest of name"
    e.g.  "1.23.456 Quantum Chemistry"
    Returns (macro_id, meso_id, micro_id, short_name) or None on failure.
    """
    try:
        parts = str(full_name).split(' ', 1)
        codes = parts[0].split('.')
        if len(codes) < 3:
            return None
        short = parts[1].strip() if len(parts) > 1 else parts[0]
        return codes[0], codes[1], codes[2], short
    except Exception:
        return None


def build_sunburst_from_micro_topics(df_micro, df_meso=None, df_macro=None, min_docs=0):
    """
    Build a Sunburst-ready node list from an InCites Micro Topics dataframe.

    The hierarchy Macro→Meso→Micro is inferred directly from the topic codes
    embedded in each row's index/name (e.g. "1.23.456 Topic name").
    No external Topics.txt is needed.

    For each numeric indicator the function produces TWO aggregation strategies:
      - 'sum'  : total absolute value (appropriate for counts like WoS Documents)
      - 'mean' : weighted average (appropriate for ratios like CNCI, % Top 10%)

    Returns a dict:
    {
      "nodes": [ { "id", "parent", "value", "level",
                   "indicators_sum": {...}, "indicators_mean": {...} }, ... ],
      "indicators": [ list of numeric indicator names ],
      "summable_indicators": [ indicators suitable for SUM aggregation ],
      "meanable_indicators":  [ indicators suitable for MEAN aggregation ]
    }
    """
    if df_micro is None or df_micro.empty:
        return None

    entity_col = df_micro.columns[0]
    # If the df has a proper index (entity name is the index), use it;
    # otherwise use the first column as entity name.
    if df_micro.index.dtype == object and df_micro.index[0] != 0:
        names = df_micro.index.tolist()
        df_work = df_micro.copy()
    else:
        names = df_micro[entity_col].tolist()
        df_work = df_micro.set_index(entity_col)

    numeric_cols = df_work.select_dtypes(include=[np.number]).columns.tolist()
    # Remove baseline rows
    baseline_mask = df_work.index.astype(str).str.contains(r'Baseline', case=False, na=False)
    df_work = df_work[~baseline_mask].copy()
    df_work[numeric_cols] = df_work[numeric_cols].fillna(0)

    # Apply min_docs filter
    if 'Web of Science Documents' in numeric_cols and min_docs > 0:
        df_work = df_work[df_work['Web of Science Documents'] > min_docs]

    # ── Pre-build name lookup dicts from Meso / Macro dfs ─────────────────
    # macro_id (str) -> human-readable name
    macro_name_dict: dict = {}
    if df_macro is not None:
        for idx_m in df_macro.index:
            d = _decode_topic_code(str(idx_m))
            if d:
                macro_name_dict[d[0]] = d[3]

    # meso_id (str) -> human-readable name
    meso_name_dict: dict = {}
    if df_meso is not None:
        for idx_m in df_meso.index:
            d = _decode_topic_code(str(idx_m))
            if d:
                meso_name_dict[d[1]] = d[3]

    # ── Build flat rows with decoded hierarchy ─────────────────────────
    macro_nodes: dict = {}
    meso_nodes:  dict = {}
    micro_rows:  list = []

    for full_name, row in df_work.iterrows():
        decoded = _decode_topic_code(str(full_name))
        if decoded is None:
            continue
        macro_id, meso_id, micro_id, micro_short = decoded

        # Resolve names (fall back to the ID string if not found)
        macro_name = macro_name_dict.get(macro_id, f'Macro {macro_id}')
        meso_name  = meso_name_dict.get(meso_id,  f'Meso {meso_id}')

        w = float(row.get('Web of Science Documents', 1) or 1)
        ind_vals = {c: float(row[c]) for c in numeric_cols}

        # Accumulate for meso (keyed by (macro,meso) pair to avoid name collisions)
        meso_key = (macro_name, meso_name)
        if meso_key not in meso_nodes:
            meso_nodes[meso_key] = {'sum': {c: 0.0 for c in numeric_cols},
                                     'wsum': {c: 0.0 for c in numeric_cols},
                                     'weight': 0.0}
        meso_nodes[meso_key]['weight'] += w
        for c in numeric_cols:
            meso_nodes[meso_key]['sum'][c]  += ind_vals[c]
            meso_nodes[meso_key]['wsum'][c] += ind_vals[c] * w

        # Accumulate for macro
        if macro_name not in macro_nodes:
            macro_nodes[macro_name] = {'sum': {c: 0.0 for c in numeric_cols},
                                        'wsum': {c: 0.0 for c in numeric_cols},
                                        'weight': 0.0}
        macro_nodes[macro_name]['weight'] += w
        for c in numeric_cols:
            macro_nodes[macro_name]['sum'][c]  += ind_vals[c]
            macro_nodes[macro_name]['wsum'][c] += ind_vals[c] * w

        # Use full_name as id to guarantee uniqueness among micro topics
        micro_rows.append({
            'id':     str(full_name),   # unique: full InCites row label
            'parent': meso_name,
            'label':  micro_short,      # human-readable short name for display
            'level':  'Micro Topics',
            'value':  w,
            'indicators_sum':  ind_vals,
            'indicators_mean': ind_vals,  # leaf: both identical
        })

    # ── Build meso nodes ──────────────────────────────────────────────
    meso_rows = []
    for (macro_name, meso_name), acc in meso_nodes.items():
        w = acc['weight'] if acc['weight'] > 0 else 1.0
        meso_rows.append({
            'id':     meso_name,
            'parent': macro_name,
            'label':  meso_name,
            'level':  'Meso Topics',
            'value':  acc['sum'].get('Web of Science Documents', 0),
            'indicators_sum':  {c: acc['sum'][c]  for c in numeric_cols},
            'indicators_mean': {c: acc['wsum'][c] / w for c in numeric_cols},
        })

    # ── Build macro nodes ─────────────────────────────────────────────
    macro_rows = []
    for macro_name, acc in macro_nodes.items():
        w = acc['weight'] if acc['weight'] > 0 else 1.0
        macro_rows.append({
            'id':     macro_name,
            'parent': '',
            'label':  macro_name,
            'level':  'Macro Topics',
            'value':  acc['sum'].get('Web of Science Documents', 0),
            'indicators_sum':  {c: acc['sum'][c]  for c in numeric_cols},
            'indicators_mean': {c: acc['wsum'][c] / w for c in numeric_cols},
        })

    all_nodes = macro_rows + meso_rows + micro_rows

    summable  = [c for c in numeric_cols if c in SUMMABLE_INDICATORS]
    meanable  = [c for c in numeric_cols if c not in SUMMABLE_INDICATORS]

    return {
        'nodes': all_nodes,
        'indicators': numeric_cols,
        'summable_indicators': summable,
        'meanable_indicators': meanable,
    }



def process_unit(unit_name, df_whole, df_5years, df_trend, all_units_dfs=None, all_units_5y_dfs=None):

    """
    all_units_dfs: optional dict {unit_name: df} so Micro Topics can look up
                   Meso and Macro dfs for resolving human-readable names.
    """
    result = {
        "unit": unit_name,
        "indicators": [],
        "profile": [],
        "quartiles": [],
        "sunburst": None,
        "profile_5years": [],
        "quartiles_5years": [],
        "sunburst_5years": None,
        "time_series": {}
    }

    df_entities = None  # keep reference for trend filtering later

    def extract_profile_data(df):
        prof, quart, cols = [], [], []
        ent_df = None
        if df is None or df.empty:
            return prof, quart, cols, ent_df
            
        entity_col = df.columns[0]
        baseline_mask = df[entity_col].astype(str).str.contains(r'Baseline', case=False, na=False)
        baseline_df   = df[baseline_mask]
        ent_df   = df[~baseline_mask].copy()

        numeric_cols = ent_df.select_dtypes(include=[np.number]).columns.tolist()

        doc_col = 'Web of Science Documents' if 'Web of Science Documents' in numeric_cols else ('Documents' if 'Documents' in numeric_cols else None)
        if doc_col:
            if not baseline_df.empty:
                wos_baseline = baseline_df[doc_col].sum()
                if wos_baseline > 0:
                    ent_df['Share'] = (ent_df[doc_col] / wos_baseline) * 100
                    if 'Share' not in numeric_cols:
                        numeric_cols.append('Share')

            if 'Times Cited' in numeric_cols and 'Impact Factor' not in numeric_cols:
                ent_df['Impact Factor'] = (
                    ent_df['Times Cited'] / ent_df[doc_col].replace(0, np.nan)
                ).fillna(0)
                numeric_cols.append('Impact Factor')

            if 'Citations From Patents' in numeric_cols and 'Citations From Patents/Paper' not in numeric_cols:
                ent_df['Citations From Patents/Paper'] = (
                    ent_df['Citations From Patents'] / ent_df[doc_col].replace(0, np.nan)
                ).fillna(0)
                numeric_cols.append('Citations From Patents/Paper')

        ent_df[numeric_cols] = ent_df[numeric_cols].fillna(0)

        sort_col = next(
            (c for c in numeric_cols if 'web of science documents' in c.lower()),
            numeric_cols[0] if numeric_cols else None
        )
        if sort_col:
            ent_df = ent_df.sort_values(by=sort_col, ascending=False).head(1500)

        cols = numeric_cols

        q1_col = next((c for c in ent_df.columns if re.search(r'Q1|Top\s*25%', str(c), re.IGNORECASE)), None)
        q2_col = next((c for c in ent_df.columns if re.search(r'Q2', str(c), re.IGNORECASE)), None)
        q3_col = next((c for c in ent_df.columns if re.search(r'Q3', str(c), re.IGNORECASE)), None)
        q4_col = next((c for c in ent_df.columns if re.search(r'Q4', str(c), re.IGNORECASE)), None)

        def safe_float(val):
            if pd.isna(val): return 0.0
            if isinstance(val, str):
                val = val.replace('%', '').replace(',', '').strip()
            try:
                return float(val)
            except:
                return 0.0

        for _, row in ent_df.iterrows():
            entity_name = str(row[entity_col])
            if pd.isna(row[entity_col]) or entity_name.strip() == "":
                continue

            profile_row = {"entity": entity_name}
            for col in numeric_cols:
                profile_row[col] = float(row[col]) if pd.notna(row[col]) else 0.0
            prof.append(profile_row)

            q1 = safe_float(row[q1_col]) if q1_col else 0.0
            q2 = safe_float(row[q2_col]) if q2_col else 0.0
            q3 = safe_float(row[q3_col]) if q3_col else 0.0
            q4 = safe_float(row[q4_col]) if q4_col else 0.0

            if q1 > 0 or q2 > 0 or q3 > 0 or q4 > 0:
                quart.append({
                    "entity": entity_name,
                    "Q1": q1, "Q2": q2, "Q3": q3, "Q4": q4,
                })
        
        return prof, quart, cols, ent_df

    # ── Profile and Quartiles (Whole and 5Years) ───────────────
    p_whole, q_whole, c_whole, df_entities = extract_profile_data(df_whole)
    p_5y, q_5y, c_5y, _ = extract_profile_data(df_5years)

    # If Whole is missing or empty, fall back to 5Years data for main profile & indicators
    if not p_whole and p_5y:
        result["profile"] = p_5y
        result["quartiles"] = q_5y
        result["indicators"] = c_5y
    else:
        result["profile"] = p_whole
        result["quartiles"] = q_whole
        result["indicators"] = c_whole if c_whole else c_5y

    result["profile_5years"] = p_5y
    result["quartiles_5years"] = q_5y

    # ── Time Series Processing ─────────────────────────────────────────────
    # Prefer the dedicated Trend file; fall back to df_whole if it has time columns
    target_trend = df_trend
    if (target_trend is None or target_trend.empty) and df_whole is not None and not df_whole.empty:
        has_time  = any(re.search(r'time\s*period|year|periodo|año', str(c), re.IGNORECASE) for c in df_whole.columns)
        year_cols = [c for c in df_whole.columns if re.match(r'^(19|20)\d{2}$', str(c))]
        if has_time or len(year_cols) >= 2:
            target_trend = df_whole

    if target_trend is not None and not target_trend.empty:
        entity_col = target_trend.columns[0]
        result["profile_evolution"] = {"raw": [], "ecma3": [], "ecma5": []}

        # 1. Long format: single "Time Period" / "Year" column
        time_col = None
        for col in target_trend.columns:
            if re.search(r'time\s*period|year|periodo|año|year\s*published', str(col), re.IGNORECASE):
                time_col = col
                break

        if time_col:
            baseline_mask = target_trend[entity_col].astype(str).str.contains(r'Baseline', case=False, na=False)
            baseline_df   = target_trend[baseline_mask]
            trend_data    = target_trend[~baseline_mask].copy()

            def safe_float(val):
                if pd.isna(val): return 0.0
                if isinstance(val, str):
                    val = val.replace('%', '').replace(',', '').strip()
                try:
                    return float(val)
                except:
                    return 0.0

            for col in trend_data.columns:
                if col != entity_col and col != time_col:
                    if trend_data[col].dtype == object:
                        trend_data[col] = trend_data[col].apply(safe_float)

            numeric_ts = trend_data.select_dtypes(include=[np.number]).columns.tolist()
            if time_col in numeric_ts:
                numeric_ts.remove(time_col)

            doc_ts_col = 'Web of Science Documents' if 'Web of Science Documents' in numeric_ts else ('Documents' if 'Documents' in numeric_ts else None)
            if doc_ts_col:
                if not baseline_df.empty:
                    base_docs_per_year = baseline_df.groupby(time_col)[doc_ts_col].sum()
                    def calc_share(row):
                        year = row[time_col]
                        b_docs = base_docs_per_year.get(year, 0)
                        if b_docs > 0:
                            return (row[doc_ts_col] / b_docs) * 100
                        return 0.0
                    trend_data['Share'] = trend_data.apply(calc_share, axis=1)
                    if 'Share' not in numeric_ts:
                        numeric_ts.append('Share')

                if 'Times Cited' in numeric_ts and 'Impact Factor' not in numeric_ts:
                    trend_data['Impact Factor'] = (trend_data['Times Cited'] / trend_data[doc_ts_col].replace(0, np.nan)).fillna(0)
                    numeric_ts.append('Impact Factor')

                if 'Citations From Patents' in numeric_ts and 'Citations From Patents/Paper' not in numeric_ts:
                    trend_data['Citations From Patents/Paper'] = (trend_data['Citations From Patents'] / trend_data[doc_ts_col].replace(0, np.nan)).fillna(0)
                    numeric_ts.append('Citations From Patents/Paper')

            for indicator in numeric_ts:
                series_data = []
                for name, group in trend_data.groupby(entity_col):
                    group      = group.sort_values(by=time_col)
                    raw_values = group[indicator].fillna(0).tolist()
                    times      = group[time_col].astype(str).tolist()
                    if not raw_values:
                        continue
                    s = pd.Series(raw_values)
                    series_data.append({
                        "entity":     str(name),
                        "times":      times,
                        "raw":        raw_values,
                        "ecma3":      calculate_ecma(s, 3).tolist(),
                        "ecma5":      calculate_ecma(s, 5).tolist(),
                        "latest_val": float(raw_values[-1]),
                    })

                series_data.sort(key=lambda x: x["latest_val"], reverse=True)
                series_data = series_data[:20]
                for sd in series_data:
                    del sd["latest_val"]
                result["time_series"][indicator] = series_data

            # Build profile_evolution (Long format)
            evolution_raw = []
            evolution_ecma3 = []
            evolution_ecma5 = []
            # Key indicators to score entities (filter truly-empty rows)
            score_inds = [i for i in numeric_ts if 'Documents' in i or 'Cited' in i or 'Share' in i]
            if not score_inds:
                score_inds = numeric_ts[:1] if numeric_ts else []

            for name, group in trend_data.groupby(entity_col):
                group = group.sort_values(by=time_col)
                # Skip entities with zero output across all years
                if score_inds:
                    total_docs = group[score_inds[0]].fillna(0).sum()
                    if total_docs == 0:
                        continue

                smoothed3 = {}
                smoothed5 = {}
                for ind in numeric_ts:
                    s = pd.Series(group[ind].fillna(0).tolist())
                    smoothed3[ind] = calculate_ecma(s, 3).tolist()
                    smoothed5[ind] = calculate_ecma(s, 5).tolist()
                
                times = group[time_col].astype(str).tolist()
                for i, t in enumerate(times):
                    row_name = f"{t}_{name}"
                    r_raw = {"entity": row_name}
                    r_e3  = {"entity": row_name}
                    r_e5  = {"entity": row_name}
                    for ind in numeric_ts:
                        r_raw[ind] = float(group.iloc[i][ind]) if pd.notna(group.iloc[i][ind]) else 0.0
                        r_e3[ind]  = float(smoothed3[ind][i])
                        r_e5[ind]  = float(smoothed5[ind][i])
                    evolution_raw.append(r_raw)
                    evolution_ecma3.append(r_e3)
                    evolution_ecma5.append(r_e5)

            # Sort by year descending, then by first score indicator descending
            def evo_sort_key(r):
                year = int(r["entity"].split("_")[0]) if r["entity"].split("_")[0].isdigit() else 0
                score = r.get(score_inds[0], 0) if score_inds else 0
                return (-year, -score)

            evolution_raw.sort(key=evo_sort_key)
            evolution_ecma3.sort(key=evo_sort_key)
            evolution_ecma5.sort(key=evo_sort_key)
            
            result["profile_evolution"] = {
                "raw": evolution_raw,
                "ecma3": evolution_ecma3,
                "ecma5": evolution_ecma5
            }

        else:
            # 2. Wide format: year numbers as column headers (2015, 2016, …)
            year_cols = sorted(
                [c for c in target_trend.columns if re.match(r'^(19|20)\d{2}$', str(c))],
                key=lambda x: int(x)
            )
            if len(year_cols) >= 2:
                baseline_mask = target_trend[entity_col].astype(str).str.contains(r'Baseline', case=False, na=False)
                trend_data    = target_trend[~baseline_mask]
                series_data   = []

                for _, row in trend_data.iterrows():
                    entity_name = str(row[entity_col])
                    if pd.isna(row[entity_col]) or entity_name.strip() == "":
                        continue
                    raw_values = [float(row[y]) if pd.notna(row[y]) else 0.0 for y in year_cols]
                    s = pd.Series(raw_values)
                    series_data.append({
                        "entity":     entity_name,
                        "times":      [str(y) for y in year_cols],
                        "raw":        raw_values,
                        "ecma3":      calculate_ecma(s, 3).tolist(),
                        "ecma5":      calculate_ecma(s, 5).tolist(),
                        "latest_val": raw_values[-1],
                    })

                series_data.sort(key=lambda x: x["latest_val"], reverse=True)
                series_data = series_data[:20]
                for sd in series_data:
                    del sd["latest_val"]
                result["time_series"]["Documents (Time Series)"] = series_data

                # Build profile_evolution (Wide format)
                evolution_raw = []
                evolution_ecma3 = []
                evolution_ecma5 = []
                for _, row in trend_data.iterrows():
                    entity_name = str(row[entity_col])
                    if pd.isna(row[entity_col]) or entity_name.strip() == "":
                        continue
                    raw_values = [float(row[y]) if pd.notna(row[y]) else 0.0 for y in year_cols]
                    s = pd.Series(raw_values)
                    smoothed3 = calculate_ecma(s, 3).tolist()
                    smoothed5 = calculate_ecma(s, 5).tolist()
                    
                    for i, y in enumerate(year_cols):
                        row_name = f"{y}_{entity_name}"
                        evolution_raw.append({"entity": row_name, "Documents (Time Series)": raw_values[i]})
                        evolution_ecma3.append({"entity": row_name, "Documents (Time Series)": smoothed3[i]})
                        evolution_ecma5.append({"entity": row_name, "Documents (Time Series)": smoothed5[i]})
                        
                result["profile_evolution"] = {
                    "raw": evolution_raw,
                    "ecma3": evolution_ecma3,
                    "ecma5": evolution_ecma5
                }

    # ── Sunburst (only for Micro Topics) ──────────────────────────────
    if unit_name in ('Micro Topics', 'Meso Topics'):
        df_meso  = (all_units_dfs or {}).get('Meso Topics')
        df_macro = (all_units_dfs or {}).get('Macro Topics')
        if unit_name == 'Micro Topics':
            result['sunburst'] = build_sunburst_from_micro_topics(
                df_micro=df_whole,
                df_meso=df_meso,
                df_macro=df_macro,
                min_docs=0
            )
            if df_5years is not None and not df_5years.empty:
                # To build 5-years sunburst we ideally need 5-years meso/macro too
                # but if missing, build_sunburst_from_micro_topics handles it gracefully
                df_meso_5y  = (all_units_5y_dfs or {}).get('Meso Topics')
                df_macro_5y = (all_units_5y_dfs or {}).get('Macro Topics')
                result['sunburst_5years'] = build_sunburst_from_micro_topics(
                    df_micro=df_5years,
                    df_meso=df_meso_5y,
                    df_macro=df_macro_5y,
                    min_docs=0
                )

    return result



def extract_baseline_data_from_dfs(df_whole, df_5years, df_trend, whole_path, path_5y, trend_path):
    summary = []
    indicators = []

    def clean_val(v):
        if pd.isna(v): return 0.0
        if isinstance(v, str):
            v = v.replace('%', '').replace(',', '').strip()
        try:
            return float(v)
        except:
            return str(v)

    target_df = df_whole if (df_whole is not None and not df_whole.empty) else df_5years
    target_path = whole_path if (df_whole is not None and not df_whole.empty) else path_5y

    if target_df is not None and not target_df.empty:
        ent_col1 = target_df.columns[0]
        b1 = target_df[target_df[ent_col1].astype(str).str.contains(r'Baseline', case=False, na=False)]
        for _, row in b1.iterrows():
            name = str(row[ent_col1]).strip()
            item = {'name': name}
            for col in target_df.columns[1:]:
                item[col] = clean_val(row[col])
            summary.append(item)

    trend_list = []
    if df_trend is not None and not df_trend.empty:
        ent_col2 = df_trend.columns[0]
        time_col = next((c for c in df_trend.columns if re.search(r'year|date|period', str(c), re.IGNORECASE)), None)
        b2 = df_trend[df_trend[ent_col2].astype(str).str.contains(r'Baseline', case=False, na=False)]
        
        trend_by_year = {}
        indicators = [c for c in df_trend.columns if c not in (ent_col2, time_col)]
        for _, row in b2.iterrows():
            name = str(row[ent_col2]).strip()
            year = str(row[time_col]) if time_col else 'All'
            if year not in trend_by_year:
                trend_by_year[year] = {'year': year}
            if name not in trend_by_year[year]:
                trend_by_year[year][name] = {}
            for ind in indicators:
                trend_by_year[year][name][ind] = clean_val(row[ind])
        
        trend_list = [trend_by_year[y] for y in sorted(trend_by_year.keys())]

    if not summary and not trend_list:
        return None

    if not indicators and summary:
        indicators = [k for k in summary[0].keys() if k != 'name']

    return {
        "summary": summary,
        "trend": trend_list,
        "indicators": indicators,
        "whole_filename": os.path.basename(target_path) if target_path else None,
        "trend_filename": os.path.basename(trend_path) if trend_path else None,
    }


def build_incites_inventory(payload_path):
    with open(payload_path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    file_paths = payload.get("files", [])
    session_dir = tempfile.mkdtemp(prefix="incites_session_")

    extracted_files = []
    for fp in file_paths:
        if fp.endswith('.zip'):
            with zipfile.ZipFile(fp, 'r') as zip_ref:
                zip_ref.extractall(session_dir)
                for root, _, files in os.walk(session_dir):
                    for file in files:
                        extracted_files.append(os.path.join(root, file))
        else:
            target = os.path.join(session_dir, os.path.basename(fp))
            shutil.copy2(fp, target)
            extracted_files.append(target)

    units = {}
    for ef in extracted_files:
        unit, period = identify_file_type(ef)
        if unit:
            if unit not in units:
                units[unit] = {"Whole": None, "5Years": None, "Trend": None}
            units[unit][period] = ef

    baseline_sources = {}
    for unit_name, files in units.items():
        df_whole = clean_and_read_file(files["Whole"]) if files["Whole"] else None
        df_5years = clean_and_read_file(files["5Years"]) if files["5Years"] else None
        df_trend = clean_and_read_file(files["Trend"]) if files["Trend"] else None

        b_data = extract_baseline_data_from_dfs(df_whole, df_5years, df_trend, files["Whole"], files["5Years"], files["Trend"])
        if b_data:
            b_data["unit_name"] = unit_name
            baseline_sources[unit_name] = b_data

    default_source = None
    PREFERRED_BASELINE_ORDER = ['WoS Categories', 'Research Areas', 'ESI', 'SDG', 'Locations', 'Organizations']
    for p in PREFERRED_BASELINE_ORDER:
        if p in baseline_sources:
            default_source = p
            break
    if not default_source and baseline_sources:
        default_source = list(baseline_sources.keys())[0]

    # Auto-detect and parse OpenAlex JSON if present in the package
    json_work_files = [f for f in extracted_files if f.endswith('.json') and not f.endswith('inventory.json') and not f.endswith('payload.json')]
    openalex_json_data = None
    if json_work_files:
        json_file_path = json_work_files[0]
        try:
            from vos_parsers import is_openalex_json
            if is_openalex_json(json_file_path):
                from bibliometrics_parser import read_and_generate_bibliometrics
                biblio_res = read_and_generate_bibliometrics(json_file_path, network_type='co-occurrence', max_terms=100)
                from semantic_engine import handle_parse
                semantic_res = handle_parse({'filepath': json_file_path, 'extract_title': True, 'extract_abstract': True, 'extract_keywords': True})
                
                openalex_json_data = {
                    'has_json': True,
                    'json_file_name': os.path.basename(json_file_path),
                    'document_count': biblio_res.get('document_count', len(semantic_res.get('records', []))),
                    'network': biblio_res.get('network'),
                    'networks_by_year': biblio_res.get('networks_by_year'),
                    'cooccurrence_csv': biblio_res.get('cooccurrence_csv'),
                    'term_counts': biblio_res.get('term_counts', {}),
                    'semantic_records': semantic_res.get('records')
                }
        except Exception as err:
            warnings.warn(f'Error processing OpenAlex JSON in session: {err}')

    inventory_map = {
        "session_dir": session_dir,
        "units": units,
        "openalex_data": openalex_json_data
    }
    with open(os.path.join(session_dir, "inventory.json"), 'w', encoding='utf-8') as f:
        json.dump(inventory_map, f, ensure_ascii=False)

    return {
        "success": True,
        "session_dir": session_dir,
        "unit_names": list(units.keys()),
        "baseline": {
            "default_source": default_source,
            "sources": baseline_sources
        },
        "openalex_data": openalex_json_data
    }


def parse_single_unit_from_session(session_dir, unit_name):
    inventory_file = os.path.join(session_dir, "inventory.json")
    if not os.path.exists(inventory_file):
        return {"success": False, "error": f"Session inventory not found in {session_dir}"}

    with open(inventory_file, 'r', encoding='utf-8') as f:
        inventory_map = json.load(f)

    units = inventory_map.get("units", {})
    if unit_name not in units:
        return {"success": False, "error": f"Unit '{unit_name}' not found in session inventory"}

    files = units[unit_name]
    
    all_whole_dfs = {}
    all_5y_dfs = {}
    for u, f_dict in units.items():
        if u in ('Meso Topics', 'Macro Topics', 'Micro Topics'):
            all_whole_dfs[u] = clean_and_read_file(f_dict["Whole"]) if f_dict.get("Whole") else None
            all_5y_dfs[u] = clean_and_read_file(f_dict["5Years"]) if f_dict.get("5Years") else None

    df_whole = clean_and_read_file(files["Whole"]) if files.get("Whole") else None
    df_5years = clean_and_read_file(files["5Years"]) if files.get("5Years") else None
    df_trend = clean_and_read_file(files["Trend"]) if files.get("Trend") else None

    parsed = process_unit(unit_name, df_whole, df_5years, df_trend, all_units_dfs=all_whole_dfs, all_units_5y_dfs=all_5y_dfs)
    return {
        "success": True,
        "unit_name": unit_name,
        "unit": parsed
    }


def extract_and_parse_incites(payload_path):
    # Backwards-compatible wrapper that calls build_incites_inventory
    return build_incites_inventory(payload_path)
