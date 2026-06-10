import sys
import json
import os
import re
import time
import numpy as np
import pandas as pd
import metaknowledge as mk

# For UMAP and skdim
import umap
import skdim

# For clustering
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer

# For dotenv
from dotenv import load_dotenv

# Try to import GPU UMAP
try:
    import cuml
    from cuml.manifold import UMAP as GPU_UMAP
    HAS_CUML = True
except ImportError:
    HAS_CUML = False

# Stop words combining English and Spanish
spanish_stop_words = [
    "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "en", "de", "del", "al", "a", 
    "ante", "bajo", "cabe", "con", "contra", "desde", "durante", "entre", "hacia", "hasta", 
    "mediante", "para", "por", "según", "sin", "so", "sobre", "tras", "que", "es", "se", "su", 
    "sus", "como", "más", "pero", "este", "esta", "estos", "estas", "son", "fue", "lo", "ya", 
    "muy", "también", "nos", "sí", "qué", "cuando", "donde", "quien", "porque", "estudio", 
    "análisis", "efecto", "uso", "study", "analysis", "effect", "use", "based", "artículo",
    "investigación", "research", "paper", "results", "resultados", "diseño", "desarrollo"
]
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
ALL_STOPWORDS = list(ENGLISH_STOP_WORDS) + spanish_stop_words

def load_environment():
    # 1. Try to load from local newLabSOM root (.env is in parent directory relative to engine/)
    local_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    if os.path.exists(local_env):
        load_dotenv(local_env)
        return
    # 2. Try current working directory
    if os.path.exists(".env"):
        load_dotenv(".env")
        return
    # 3. Fallback to user's Proyectos/RAGs/.env path
    fallback_env = r"c:\Users\jlja\Documents\Proyectos\RAGs\.env"
    if os.path.exists(fallback_env):
        load_dotenv(fallback_env)

def clean_text(text):
    if not text:
        return ""
    # Remove HTML/XML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Clean whitespace
    return re.sub(r"\s+", " ", text).strip()

def extract_doi(record):
    # Try typical fields
    for field in ['DI', 'doi', 'DOI', 'do', 'DO']:
        val = record.get(field)
        if val:
            if isinstance(val, list): val = val[0]
            val = str(val).strip()
            if val: return val
            
    # Search in all text fields for DOI regex
    doi_regex = r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b"
    for field, val in record.items():
        if isinstance(val, str):
            match = re.search(doi_regex, val, re.IGNORECASE)
            if match:
                return match.group(0)
        elif isinstance(val, list):
            for v in val:
                if isinstance(v, str):
                    match = re.search(doi_regex, v, re.IGNORECASE)
                    if match:
                        return match.group(0)
                        
    return ""

def handle_parse(params):
    filepath = params.get("filepath", "")
    use_mesh = params.get("use_mesh", True)
    extract_title = params.get("extract_title", True)
    extract_abstract = params.get("extract_abstract", True)
    extract_keywords = params.get("extract_keywords", True)
    extra_fields = params.get("extra_fields", [])
    
    if not filepath or not os.path.exists(filepath):
        return {"success": False, "error": f"File not found: '{filepath}'"}
        
    try:
        RC = mk.RecordCollection(filepath)
    except Exception as e:
        return {"success": False, "error": f"Failed to parse file with MetaKnowledge: {str(e)}"}
        
    if len(RC) == 0:
        return {"success": False, "error": "No records found in the file."}
        
    records = []
    for idx, r in enumerate(RC):
        # Extract DOI
        doi = extract_doi(r)
        if not doi:
            # Generate a temporary unique ID
            pmid = r.get('PMID')
            if pmid:
                if isinstance(pmid, list): pmid = pmid[0]
                doi = f"PMID_{pmid}"
            else:
                doi = f"ID_{idx+1}"
                
        # Extract Title
        title = r.get('TI') or r.get('T1') or r.get('title') or ""
        if isinstance(title, list): title = " ".join(str(t) for t in title)
        title = clean_text(title)
        
        # Extract Abstract
        abstract = r.get('AB') or r.get('ABst') or r.get('abstract') or ""
        if isinstance(abstract, list): abstract = " ".join(str(a) for a in abstract)
        abstract = clean_text(abstract)
        
        # Extract Keywords
        keywords = []
        is_pubmed = 'MH' in r or 'OT' in r
        
        if is_pubmed and use_mesh:
            mh = r.get('MH')
            if mh:
                if isinstance(mh, list): keywords = [str(k) for k in mh]
                else: keywords = [str(mh)]
        else:
            de = r.get('DE') or r.get('OT') or r.get('ID') or []
            if isinstance(de, list): keywords = [str(k) for k in de]
            else: keywords = [str(de)]
            
        # Clean keywords
        keywords = [clean_text(k) for k in keywords if k]
        
        # Extract Extras
        extras = {}
        for field in extra_fields:
            val = r.get(field)
            if val:
                if isinstance(val, list):
                    # Format authors, institutions, years nicely
                    if field == 'AU':
                        val = ", ".join(str(v) for v in val)
                    else:
                        val = " | ".join(str(v) for v in val)
                extras[field] = clean_text(str(val))
                
        # Handle standard fallbacks if requested but empty
        if 'AU' in extra_fields and 'AU' not in extras:
            # Try other author tags
            au = r.get('authors') or r.get('AF')
            if au:
                if isinstance(au, list): au = ", ".join(str(v) for v in au)
                extras['AU'] = clean_text(str(au))
                
        if 'PY' in extra_fields and 'PY' not in extras:
            py = r.get('PY') or r.get('DP') or r.get('year')
            if py:
                if isinstance(py, list): py = py[0]
                extras['PY'] = clean_text(str(py))[:4]
                
        if 'SO' in extra_fields and 'SO' not in extras:
            so = r.get('SO') or r.get('JT') or r.get('journal')
            if so:
                if isinstance(so, list): so = so[0]
                extras['SO'] = clean_text(str(so))
                
        # Build concatenated text for embedding
        parts = []
        if extract_title and title: parts.append(f"Title: {title}")
        if extract_abstract and abstract: parts.append(f"Abstract: {abstract}")
        if extract_keywords and keywords: parts.append(f"Keywords: {', '.join(keywords)}")
        
        # We can also add authors or journal to text block if they provide context
        if 'SO' in extras: parts.append(f"Journal: {extras['SO']}")
        
        concatenated_text = " | ".join(parts) if parts else "Unknown document content"
        
        records.append({
            "id": doi,
            "doi": doi,
            "title": title,
            "abstract": abstract,
            "keywords": keywords,
            "concatenated_text": concatenated_text,
            "extras": extras
        })
        
    return {"success": True, "records": records}

def handle_embed(params):
    records = params.get("records", [])
    model_name = params.get("model", "nomic").lower()
    
    if not records:
        return {"success": False, "error": "No records provided for embedding."}
        
    texts = [r.get("concatenated_text", "") for r in records]
    
    # Load environment variables
    load_environment()
    
    embeddings = []
    
    try:
        if model_name == "nomic":
            # Call LM Studio / OpenAI compatible API
            # Get credentials from env
            base_url = os.getenv("LLM_BASE_URL", "http://localhost:1234/v1/")
            user = os.getenv("LLM_USER")
            password = os.getenv("LLM_PASSWORD")
            api_key = os.getenv("LLM_API_KEY", "lm-studio")
            emb_model = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
            
            # Format base_url with basic auth if credentials exist
            if user and password:
                if "://" in base_url:
                    proto, rest = base_url.split("://", 1)
                    auth_url = f"{proto}://{user}:{password}@{rest}"
                else:
                    auth_url = f"http://{user}:{password}@{base_url}"
            else:
                auth_url = base_url
                
            from openai import OpenAI
            import httpx
            
            # Custom client that bypasses SSL verification
            client = OpenAI(
                base_url=auth_url,
                api_key=api_key,
                http_client=httpx.Client(verify=False, timeout=120.0)
            )
            
            # Batch call in chunks of 32
            batch_size = 32
            for i in range(0, len(texts), batch_size):
                chunk = texts[i:i+batch_size]
                resp = client.embeddings.create(model=emb_model, input=chunk)
                for item in resp.data:
                    embeddings.append(item.embedding)
                    
        elif model_name == "specter":
            # Local SPECTER2 via sentence-transformers
            from sentence_transformers import SentenceTransformer
            # Suppress logs/warnings if possible
            os.environ["TOKENIZERS_PARALLELISM"] = "false"
            
            # SentenceTransformer automatically downloads and caches locally
            model = SentenceTransformer('allenai/specter2_base')
            
            # Encode texts
            vecs = model.encode(texts, batch_size=32, convert_to_numpy=True)
            embeddings = vecs.tolist()
        else:
            return {"success": False, "error": f"Unknown embedding model: '{model_name}'"}
            
        return {"success": True, "embeddings": embeddings}
    except Exception as e:
        import traceback
        return {
            "success": False, 
            "error": f"Embedding error: {str(e)}", 
            "traceback": traceback.format_exc()
        }

def handle_reduce(params):
    embeddings_list = params.get("embeddings", [])
    estimate_mode = params.get("estimate_mode", "ceiling")
    algorithm_name = params.get("algorithm_name", "MLE")
    target_dim = params.get("target_dim", 0)  # 0 means "use estimated"
    
    if not embeddings_list:
        return {"success": False, "error": "No embeddings provided for dimension reduction."}
        
    try:
        X = np.array(embeddings_list, dtype=np.float32)
        estimated_d = None  # will be set below
        metrics = {}
        
        # 1. Intrinsic Dimension Estimation
        if estimate_mode == "ceiling":
            # MLE pairwise: compute local intrinsic dimensionality at every point
            model = skdim.id.MLE()
            local_dims = model.fit_transform_pw(X)
            
            p50 = float(np.percentile(local_dims, 50))
            p90 = float(np.percentile(local_dims, 90))
            p95 = float(np.percentile(local_dims, 95))
            p_max = float(np.max(local_dims))
            p_mean = float(np.mean(local_dims))
            
            estimated_d = int(np.ceil(p95))
            metrics = {
                "mean": p_mean,
                "median": p50,
                "p90": p90,
                "p95": p95,
                "max": p_max
            }
        elif estimate_mode == "manual":
            estimator_map = {
                "CorrInt": skdim.id.CorrInt,
                "DANCo": skdim.id.DANCo,
                "ESS": skdim.id.ESS,
                "FisherS": skdim.id.FisherS,
                "KNN": skdim.id.KNN,
                "lPCA": skdim.id.lPCA,
                "MADA": skdim.id.MADA,
                "MiND_ML": skdim.id.MiND_ML,
                "MLE": skdim.id.MLE,
                "MOM": skdim.id.MOM,
                "TLE": skdim.id.TLE,
                "TwoNN": skdim.id.TwoNN
            }
            if algorithm_name in estimator_map:
                model = estimator_map[algorithm_name]()
                model.fit(X)
                estimated_d = int(np.ceil(float(model.dimension_)))
                metrics = {"estimated": float(model.dimension_)}
                
        # 'manual_k' mode: skip estimation entirely, jump to UMAP with target_dim
        
        # Determine final target dimension:
        # - 'manual_k': use target_dim directly (user explicitly set K)
        # - 'ceiling'/'manual' with target_dim <= 0: use estimated
        # - 'ceiling'/'manual' with target_dim > 0: use target_dim (explicit override)
        if estimate_mode == "manual_k":
            final_target_dim = max(2, target_dim)
            if estimated_d is None:
                estimated_d = final_target_dim  # no separate estimate was run
        elif target_dim and target_dim > 0:
            final_target_dim = target_dim  # explicit user override of the estimate
        else:
            final_target_dim = estimated_d if estimated_d else 10  # fallback
            
        # Safeguard dimension boundaries
        final_target_dim = max(2, min(final_target_dim, X.shape[1] - 1))
        if estimated_d:
            estimated_d = max(2, min(estimated_d, X.shape[1] - 1))
        else:
            estimated_d = final_target_dim
        
        # 2. UMAP to Target Intrinsic Dimension
        print(f"Reducing {X.shape[0]} points to intrinsic dim {final_target_dim}...")
        
        if HAS_CUML and X.shape[0] > 500:
            try:
                reducer_int = GPU_UMAP(n_components=final_target_dim, metric='cosine', random_state=42)
                X_int = reducer_int.fit_transform(X)
                
                # UMAP to 2D for visualization
                reducer_2d = GPU_UMAP(n_components=2, metric='cosine', random_state=42)
                X_2d = reducer_2d.fit_transform(X_int)
            except Exception as e:
                # Fallback to CPU
                reducer_int = umap.UMAP(n_components=final_target_dim, metric='cosine', random_state=42, n_jobs=-1)
                X_int = reducer_int.fit_transform(X)
                reducer_2d = umap.UMAP(n_components=2, metric='cosine', random_state=42, n_jobs=-1)
                X_2d = reducer_2d.fit_transform(X_int)
        else:
            reducer_int = umap.UMAP(n_components=final_target_dim, metric='cosine', random_state=42, n_jobs=-1)
            X_int = reducer_int.fit_transform(X)
            
            reducer_2d = umap.UMAP(n_components=2, metric='cosine', random_state=42, n_jobs=-1)
            X_2d = reducer_2d.fit_transform(X_int)
            
        # Return results
        return {
            "success": True,
            "estimated_dimension": estimated_d,
            "metrics": metrics,
            "target_dim": final_target_dim,
            "intrinsic_data": X_int.tolist(),
            "coords_2d": [{"x": float(row[0]), "y": float(row[1])} for row in X_2d]
        }
    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": f"Dimension reduction error: {str(e)}",
            "traceback": traceback.format_exc()
        }

def get_top_keywords_text(titles, top_n=5):
    if not titles: return []
    vectorizer = TfidfVectorizer(stop_words=ALL_STOPWORDS, max_features=1000, ngram_range=(1, 2))
    try:
        X = vectorizer.fit_transform(titles)
        features = vectorizer.get_feature_names_out()
        sums = X.sum(axis=0)
        words = [(features[col], sums[0, col]) for col in range(sums.shape[1])]
        # Filter too short terms
        words = [w for w in words if len(w[0]) > 3]
        words = sorted(words, key=lambda x: x[1], reverse=True)
        
        final_words = []
        for w, score in words:
            if len(final_words) >= top_n: break
            is_redundant = False
            for fw in final_words:
                if w in fw or fw in w:
                    is_redundant = True
                    break
            if not is_redundant:
                final_words.append(w.title())
        return final_words
    except Exception as e:
        print(f"TFIDF Error: {e}")
        return []

def handle_cluster(params):
    intrinsic_data_list = params.get("intrinsic_data", [])
    coords_2d_list = params.get("coords_2d", [])
    records = params.get("records", [])
    num_levels = params.get("num_levels", 2)
    min_size = params.get("min_size", 10)
    
    if not intrinsic_data_list:
        return {"success": False, "error": "No intrinsic dimension data provided for clustering."}
        
    try:
        # Load environment variables
        load_environment()
        
        # Initialize local LLM client if available
        client = None
        model_name = None
        try:
            sys.path.append(r"c:\Users\jlja\Documents\Proyectos\RAGs")
            from lib.llm_utils import get_openai_client, LLMConfig
            client = get_openai_client(async_mode=False)
            model_name = LLMConfig.get_model_name()
            print(f"LLM loaded for clustering labeling: {model_name}")
        except Exception as e:
            print(f"LLM not available, fallback to TF-IDF keywords: {e}")
            
        X_int = np.array(intrinsic_data_list, dtype=np.float32)
        X_2d = np.array([[pt["x"], pt["y"]] for pt in coords_2d_list], dtype=np.float32)
        
        # Let's run HDBSCAN at Level 1 to find the primary clusters
        import hdbscan
        
        # HDBSCAN min_cluster_size can adapt to the dataset size
        n_samples = X_int.shape[0]
        hdb_min_size = max(5, min(min_size, n_samples // 10))
        clusterer = hdbscan.HDBSCAN(min_cluster_size=hdb_min_size, min_samples=max(2, hdb_min_size // 3))
        level1_labels = clusterer.fit_predict(X_int)
        
        unique_labels = sorted(list(set(level1_labels)))
        
        # If HDBSCAN found only noise or just 1 cluster, fallback to KMeans
        if len(unique_labels) <= 2:
            print("HDBSCAN found too few clusters, falling back to KMeans for Level 1...")
            k_val = min(5, max(2, n_samples // 20))
            if k_val > 1:
                km = KMeans(n_clusters=k_val, random_state=42, n_init="auto")
                level1_labels = km.fit_predict(X_int)
                unique_labels = sorted(list(set(level1_labels)))
                
        # Recursive Clustering function
        def run_clustering(indices, current_level, parent_label):
            if current_level > num_levels or len(indices) < min_size:
                return []
                
            sub_clusters = []
            
            # Sub-clustering at Level 2+ is done using KMeans on coordinates (spatial partitioning)
            # just like generate_sublabels.py does to match zoom visual regions
            k_val = min(4, len(indices) // min_size)
            if k_val < 2:
                return []
                
            coords_sub = X_2d[indices]
            km = KMeans(n_clusters=k_val, random_state=42, n_init="auto")
            sub_labels = km.fit_predict(coords_sub)
            
            for c_idx in range(k_val):
                sub_indices = [indices[i] for i, lbl in enumerate(sub_labels) if lbl == c_idx]
                if len(sub_indices) < min_size:
                    continue
                    
                # Compute centroid in intrinsic space to find closest representative papers
                vecs_sub = X_int[sub_indices]
                centroid = np.mean(vecs_sub, axis=0)
                norms = np.linalg.norm(vecs_sub, axis=1)
                centroid_norm = np.linalg.norm(centroid)
                
                closest_titles = []
                if centroid_norm > 0:
                    sims = np.dot(vecs_sub, centroid) / (norms * centroid_norm + 1e-9)
                    closest = np.argsort(-sims)[:10]
                    closest_titles = [records[sub_indices[i]]["title"] for i in closest if records[sub_indices[i]]["title"]]
                    
                # If closest_titles is empty, just take the first few
                if not closest_titles:
                    closest_titles = [records[idx]["title"] for idx in sub_indices[:10] if records[idx]["title"]]
                    
                # TFIDF Keywords
                all_titles = [records[idx]["title"] for idx in sub_indices if records[idx]["title"]]
                keywords = get_top_keywords_text(all_titles, top_n=5)
                
                # LLM Labeling
                label = None
                if client is not None and len(closest_titles) > 0:
                    try:
                        kw_str = ", ".join(keywords)
                        bullets = "\n".join(f"- {t}" for t in closest_titles)
                        
                        prompt = f"""Analiza los siguientes títulos de artículos científicos que pertenecen a un SUB-GRUPO dentro del tema general: "{parent_label}".
Genera una etiqueta específica y descriptiva para este sub-grupo que lo diferencie claramente del tema general.

Reglas obligatorias:
1. La etiqueta debe describir el ángulo ESPECÍFICO de este sub-grupo.
2. Debe ser muy corta: entre 2 y 4 palabras.
3. Debe estar en ESPAÑOL.
4. Responde ÚNICAMENTE con la etiqueta, sin explicaciones, sin comillas, sin introducciones.

Palabras clave del sub-grupo (TF-IDF):
{kw_str}

Títulos representativos del sub-grupo:
{bullets}

Etiqueta específica del sub-grupo:"""
                        
                        response = client.chat.completions.create(
                            model=model_name,
                            messages=[
                                {"role": "system", "content": "Eres un experto en clasificar literatura científica. Generas etiquetas temáticas muy cortas en español."},
                                {"role": "user", "content": prompt}
                            ],
                            temperature=0.1,
                            max_tokens=64,
                            timeout=15.0
                        )
                        label = response.choices[0].message.content.strip().replace('"', '').replace("'", "")
                    except Exception as ex:
                        print(f"LLM Cluster failed: {ex}")
                        
                if not label:
                    # Fallback to top keywords
                    label = " / ".join(keywords[:2]) if keywords else f"Sub-tema {c_idx+1}"
                    
                # Calculate sub-cluster median coordinates
                cx = float(np.median(X_2d[sub_indices, 0]))
                cy = float(np.median(X_2d[sub_indices, 1]))
                
                # Recurse
                nested_sublabels = run_clustering(sub_indices, current_level + 1, label)
                
                sub_clusters.append({
                    "label": label,
                    "x": cx,
                    "y": cy,
                    "size": len(sub_indices),
                    "level": current_level,
                    "sublabels": nested_sublabels
                })
                
            return sorted(sub_clusters, key=lambda x: -x["size"])
            
        # Compile Level 1 clusters
        clusters_res = []
        cluster_assignment = ["Ruido"] * len(records)
        
        for c in unique_labels:
            indices = [i for i, lbl in enumerate(level1_labels) if lbl == c]
            if len(indices) < min_size:
                continue
                
            # Compute centroid to find representative papers
            vecs_sub = X_int[indices]
            centroid = np.mean(vecs_sub, axis=0)
            norms = np.linalg.norm(vecs_sub, axis=1)
            centroid_norm = np.linalg.norm(centroid)
            
            closest_titles = []
            if centroid_norm > 0:
                sims = np.dot(vecs_sub, centroid) / (norms * centroid_norm + 1e-9)
                closest = np.argsort(-sims)[:10]
                closest_titles = [records[indices[i]]["title"] for i in closest if records[indices[i]]["title"]]
                
            if not closest_titles:
                closest_titles = [records[idx]["title"] for idx in indices[:10] if records[idx]["title"]]
                
            # TFIDF Keywords
            all_titles = [records[idx]["title"] for idx in indices if records[idx]["title"]]
            keywords = get_top_keywords_text(all_titles, top_n=5)
            
            label = None
            if c == -1:
                label = "Ruido"
            elif client is not None and len(closest_titles) > 0:
                try:
                    kw_str = ", ".join(keywords)
                    bullets = "\n".join(f"- {t}" for t in closest_titles)
                    
                    prompt = f"""Analiza los siguientes títulos de artículos de investigación y palabras clave que pertenecen al mismo grupo temático (clúster).
Genera un título o etiqueta sumamente descriptivo, corto y conciso para este grupo.

Reglas obligatorias:
1. La etiqueta debe resumir el área temática común de forma clara.
2. Debe ser muy corta (máximo de 2 a 4 palabras).
3. Debe estar en ESPAÑOL.
4. Responde ÚNICAMENTE con la etiqueta generada, sin explicaciones, sin comillas, sin introducciones.

Palabras clave (TF-IDF):
{kw_str}

Títulos representativos:
{bullets}

Etiqueta del grupo:"""
                    
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=[
                            {"role": "system", "content": "Eres un experto en clasificar literatura científica. Generas etiquetas temáticas muy cortas en español."},
                            {"role": "user", "content": prompt}
                        ],
                        temperature=0.1,
                        max_tokens=64,
                        timeout=15.0
                    )
                    label = response.choices[0].message.content.strip().replace('"', '').replace("'", "")
                except Exception as ex:
                    print(f"LLM L1 Cluster failed: {ex}")
                    
            if not label:
                label = " / ".join(keywords[:2]) if keywords else f"Tema {c}"
                
            # Record cluster assignment
            for idx in indices:
                cluster_assignment[idx] = label
                
            cx = float(np.median(X_2d[indices, 0]))
            cy = float(np.median(X_2d[indices, 1]))
            
            # Recurse for sublabels starting at level 2
            sublabels = run_clustering(indices, 2, label)
            
            clusters_res.append({
                "cluster_id": int(c),
                "label": label,
                "x": cx,
                "y": cy,
                "size": len(indices),
                "level": 1,
                "sublabels": sublabels
            })
            
        # Return results
        return {
            "success": True,
            "clusters": clusters_res,
            "cluster_assignment": cluster_assignment
        }
    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": f"Clustering error: {str(e)}",
            "traceback": traceback.format_exc()
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No arguments provided. Usage: python semantic_engine.py <parse|embed|reduce|cluster> [json_file|json_string]"}))
        sys.exit(1)
        
    action = sys.argv[1].lower()
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "No payload argument provided."}))
        sys.exit(1)
        
    payload_raw = sys.argv[2]
    
    # Parse payload (either json string or json filepath)
    try:
        if os.path.exists(payload_raw):
            with open(payload_raw, 'r', encoding='utf-8') as f:
                params = json.load(f)
        else:
            params = json.loads(payload_raw)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        sys.exit(1)
        
    if action == "parse":
        res = handle_parse(params)
    elif action == "embed":
        res = handle_embed(params)
    elif action == "reduce":
        res = handle_reduce(params)
    elif action == "cluster":
        res = handle_cluster(params)
    else:
        res = {"success": False, "error": f"Unknown action: {action}"}
        
    print(json.dumps(res))

if __name__ == "__main__":
    main()
