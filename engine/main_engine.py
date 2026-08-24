import json
import sys
import os
import numpy as np

# Adjust path to find local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from hardware_detector import detect_hardware
from bibliometrics_parser import read_and_generate_bibliometrics
from som_solver import SOMSolver, run_umap, recommend_training_epochs, compute_weight_drift
from incites_parser import extract_and_parse_incites, build_incites_inventory, parse_single_unit_from_session
import torch

def handle_detect():
    hw = detect_hardware()
    return {"success": True, "hardware": hw}

def handle_preprocess(params):
    filepath = params.get("filepath", "")
    network_type = params.get("network_type", "co-occurrence")
    custom_tag = params.get("custom_tag", "DE")
    max_terms = params.get("max_terms", 100)
    min_cooc = params.get("min_cooccurrence", 2)
    temporal = params.get("temporal", False)
    extraction_source = params.get("extraction_source", "keywords")
    counting_method = params.get("counting_method", "full")
    thesaurus_filepath = params.get("thesaurus_filepath", None)
    relevance_ratio = params.get("relevance_ratio", 0.60)
    temporal_window = int(params.get("temporal_window", params.get("temporalWindow", 1)))
    
    if not filepath or not os.path.exists(filepath):
        return {"success": False, "error": f"File not found: '{filepath}'"}
        
    try:
        res_dict = read_and_generate_bibliometrics(
            filepath, 
            network_type=network_type,
            custom_tag=custom_tag,
            max_terms=max_terms,
            min_cooccurrence=min_cooc,
            temporal=temporal,
            extraction_source=extraction_source,
            counting_method=counting_method,
            thesaurus_filepath=thesaurus_filepath,
            relevance_ratio=relevance_ratio,
            temporal_window=temporal_window
        )
        
        return res_dict
    except Exception as e:
        return {"success": False, "error": f"Preprocess error: {str(e)}"}

def handle_api_query(params):
    source = params.get("source", "openalex")
    query = params.get("query", "")
    max_results = params.get("max_results", 100)
    network_type = params.get("network_type", "co-occurrence")
    custom_tag = params.get("custom_tag", "DE")
    max_terms = params.get("max_terms", 50)
    min_cooc = params.get("min_cooccurrence", 2)
    temporal = params.get("temporal", False)
    extraction_source = params.get("extraction_source", "keywords")
    counting_method = params.get("counting_method", "full")
    relevance_ratio = params.get("relevance_ratio", 0.60)

    try:
        from vos_api_connectors import search_openalex_works, search_crossref_works
        from bibliometrics_parser import _process_record_list

        if source == "crossref":
            records = search_crossref_works(query, max_results=max_results)
        else:
            records = search_openalex_works(query, max_results=max_results)

        if not records:
            return {"success": False, "error": f"No records returned from {source.title()} for query '{query}'."}

        return _process_record_list(
            records, network_type, custom_tag, max_terms, min_cooc, temporal,
            extraction_source=extraction_source, counting_method=counting_method,
            relevance_ratio=relevance_ratio
        )
    except Exception as e:
        return {"success": False, "error": f"API query error: {str(e)}"}

def handle_suggest_size(params):
    import math
    try:
        from sklearn.decomposition import TruncatedSVD
    except ImportError:
        return {"success": False, "error": "scikit-learn is not installed."}

    data_list = params.get("data", [])
    if not data_list:
        return {"success": False, "error": "Empty data matrix provided."}
        
    data = np.array(data_list, dtype=np.float64)
    N = data.shape[0]
    
    # 1. Big SOM (N <= 1000 defaults to Big SOM, but we calculate it anyway)
    # Target Neurons = 10 * N
    big_target = 10 * N
    
    try:
        # Use TruncatedSVD to find top 2 singular values (fast for large sparse/dense matrices)
        svd = TruncatedSVD(n_components=2, n_iter=7, random_state=42)
        svd.fit(data)
        # Ratio of singular values is ratio of lengths in PCA space
        # Variance is singular_value^2, so std_dev (length) is singular_value
        if len(svd.singular_values_) == 2 and svd.singular_values_[1] > 0:
            ratio = svd.singular_values_[0] / svd.singular_values_[1]
        else:
            ratio = 1.0
    except Exception as e:
        ratio = 1.0

    # Limit ratio to a reasonable range (e.g. max 3:1) to prevent extremely long/wide maps
    ratio = max(1/3, min(3.0, ratio))

    # width / height = ratio, width * height = big_target
    # width = sqrt(big_target * ratio)
    # height = sqrt(big_target / ratio)
    big_width = max(1, int(round(math.sqrt(big_target * ratio))))
    big_height = max(1, int(round(math.sqrt(big_target / ratio))))
    
    # 2. Small SOM
    # Target Neurons = 5 * sqrt(N)
    small_target = 5 * math.sqrt(N)
    # Square grid for small SOM
    small_width = max(1, int(round(math.sqrt(small_target))))
    small_height = small_width
    
    recommended = "big" if N <= 1000 else "small"
    
    # Teuvo Kohonen's recommended epoch criteria
    rec_epochs_batch = 100
    rec_epochs_seq_big = recommend_training_epochs(N, big_width * big_height, method="basic")
    rec_epochs_seq_small = recommend_training_epochs(N, small_width * small_height, method="basic")
    
    return {
        "success": True,
        "N": N,
        "recommended": recommended,
        "bigSomWidth": big_width,
        "bigSomHeight": big_height,
        "smallSomWidth": small_width,
        "smallSomHeight": small_height,
        "recommendedEpochsBatch": rec_epochs_batch,
        "recommendedEpochsSequentialBig": rec_epochs_seq_big,
        "recommendedEpochsSequentialSmall": rec_epochs_seq_small
    }

def handle_train(params):
    data_list = params.get("data", [])
    if not data_list:
        return {"success": False, "error": "Empty data matrix provided for training."}
        
    data = np.array(data_list, dtype=np.float64)
    rows = params.get("rows", 10)
    cols = params.get("cols", 10)
    iterations = params.get("iterations", 100)
    method = params.get("method", "batch").lower() # "basic" or "batch"
    init_type = params.get("init", "random").lower() # "random", "linear" or "pca"
    metric = params.get("metric", "euclidean").lower()
    learning_rate = params.get("learning_rate", 0.5)
    clustering_algorithm = params.get("clustering_algorithm", "dbscan").lower()
    n_clusters = params.get("n_clusters", 4)
    eps = params.get("eps", 0.5)
    min_samples = params.get("min_samples", 3)
    run_umap_flag = params.get("run_umap", False)
    fallback_level = params.get("fallback_level", 3)
    labels = params.get("labels", [])
    
    try:
        # Create and initialize solver
        solver = SOMSolver(rows, cols, data.shape[1], grid_type="hexagonal", metric=metric)
        solver.initialize_weights(data, init_type=init_type)
        
        # Train
        if method == "basic":
            errors = solver.train_basic(data, iterations, learning_rate_start=learning_rate)
        else:
            errors = solver.train_batch(data, iterations)
            
        # Get metrics
        umatrix = solver.get_umatrix()
        clustering = solver.get_clustering(algorithm=clustering_algorithm, n_clusters=n_clusters, eps=eps, min_samples=min_samples)
        bmus, frequencies, quantization_errors = solver.get_bmus_and_frequencies(data)
        
        # Prepare 2D coordinates for visual hex map rendering
        hex_grid = []
        for i in range(rows * cols):
            hex_grid.append({
                "index": int(i),
                "row": int(i // cols),
                "col": int(i % cols),
                "x": float(solver.coords_np[i, 0]),
                "y": float(solver.coords_np[i, 1])
            })
            
        # Format weights to list for JSON response
        # self.weights is (rows*cols, input_dim) -> flat-topped lists
        weights_list = solver.weights.cpu().tolist()
        
        # Build document-to-neuron mapped label arrays
        # map each document label to its BMU
        mapped_labels = [[] for _ in range(rows * cols)]
        if labels and len(labels) == len(bmus):
            for doc_idx, bmu in enumerate(bmus):
                mapped_labels[bmu].append(labels[doc_idx])
                
        # Optional UMAP projection of the input data
        umap_embedding = None
        umap_source = None
        if run_umap_flag:
            umap_embedding, umap_source = run_umap(data, fallback_level=fallback_level, n_components=2)
            
        return {
            "success": True,
            "weights": weights_list,
            "umatrix": umatrix,
            "clustering": clustering,
            "frequencies": frequencies,
            "quantization_errors": quantization_errors,
            "bmus": bmus,
            "hex_grid": hex_grid,
            "mapped_labels": mapped_labels,
            "errors": errors,
            "umap": umap_embedding,
            "umap_source": umap_source
        }
        
    except Exception as e:
        import traceback
        return {
            "success": False, 
            "error": f"Training error: {str(e)}", 
            "traceback": traceback.format_exc()
        }

def handle_train_longitudinal(params):
    """
    Executes Longitudinal SOM training (Evolving Self-Organizing Maps) across multi-year periods.
    Protocol:
      - Period 1 (Base): Initialized with PCA/Linear, trained with 100% iterations (Full two-phase).
      - Successive Periods: Initialized with Warm-Start weights W_{t-1}*, trained with refinement-only
        (20% iterations, sigma_0 = 1.0), preserving topological alignment across time.
      - Calculates weight drift Delta W per neuron between consecutive periods.
    """
    periods_data = params.get("periods_data", {})
    if not periods_data:
        return {"success": False, "error": "No periods data provided for longitudinal training."}

    rows = params.get("rows", 10)
    cols = params.get("cols", 10)
    base_iterations = params.get("iterations", 100)
    method = params.get("method", "batch").lower()
    init_type = params.get("init", "pca").lower()
    metric = params.get("metric", "euclidean").lower()
    learning_rate = params.get("learning_rate", 0.5)
    clustering_algorithm = params.get("clustering_algorithm", "dbscan").lower()
    n_clusters = params.get("n_clusters", 4)
    eps = params.get("eps", 0.5)
    min_samples = params.get("min_samples", 3)
    run_umap_flag = params.get("run_umap", False)
    fallback_level = params.get("fallback_level", 3)

    try:
        # Sort period keys chronologically
        sorted_periods = sorted(list(periods_data.keys()))
        maps = {}
        drift_metrics = {}
        prev_weights = None
        prev_weights_list = None

        for idx, period_key in enumerate(sorted_periods):
            p_obj = periods_data[period_key]
            data_arr = np.array(p_obj.get("data", []), dtype=np.float64)
            labels = p_obj.get("labels", [])

            if data_arr.size == 0:
                continue

            input_dim = data_arr.shape[1]
            solver = SOMSolver(rows, cols, input_dim, grid_type="hexagonal", metric=metric)

            if idx == 0 or prev_weights is None:
                # Base period: Full training from scratch
                solver.initialize_weights(data_arr, init_type=init_type)
                if method == "basic":
                    errors = solver.train_basic(data_arr, base_iterations, learning_rate_start=learning_rate)
                else:
                    errors = solver.train_batch(data_arr, base_iterations)
                training_phase = "base_full"
                effective_iters = base_iterations
            else:
                # Successive periods: Warm-start fine-tuning
                solver.weights = prev_weights.clone()
                solver.grid_dist = torch.tensor(solver.grid_dist_np, dtype=torch.float64, device=solver.device)
                solver.coords = torch.tensor(solver.coords_np, dtype=torch.float64, device=solver.device)
                refine_iters = max(10, int(0.20 * base_iterations))
                if method == "basic":
                    errors = solver.train_basic(data_arr, refine_iters, learning_rate_start=0.05, sigma_start=1.0)
                else:
                    errors = solver.train_batch(data_arr, refine_iters, sigma_start=1.0)
                training_phase = "warm_start_refine"
                effective_iters = refine_iters

            res = solver.extract_results(
                data_arr, 
                labels=labels, 
                clustering_algorithm=clustering_algorithm, 
                n_clusters=n_clusters, 
                eps=eps, 
                min_samples=min_samples
            )
            res["errors"] = errors
            res["period"] = period_key
            res["training_phase"] = training_phase
            res["iterations"] = effective_iters
            res["doc_count"] = p_obj.get("doc_count", len(data_arr))

            if run_umap_flag:
                umap_emb, umap_src = run_umap(data_arr, fallback_level=fallback_level, n_components=2)
                res["umap"] = umap_emb
                res["umap_source"] = umap_src

            if idx > 0 and prev_weights_list is not None:
                drift = compute_weight_drift(prev_weights_list, res["weights"])
                drift_key = f"{sorted_periods[idx-1]} -> {period_key}"
                drift_metrics[drift_key] = drift
                res["drift_from_prev"] = drift

            maps[period_key] = res
            prev_weights = solver.weights.clone()
            prev_weights_list = res["weights"]

        return {
            "success": True,
            "is_longitudinal": True,
            "periods": sorted_periods,
            "maps": maps,
            "drift_metrics": drift_metrics
        }
    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": f"Longitudinal training error: {str(e)}",
            "traceback": traceback.format_exc()
        }

def handle_evaluate_clusters(params):
    weights_list = params.get("weights", [])
    if not weights_list:
        return {"success": False, "error": "No weights provided."}
    
    max_k = params.get("max_k", 15)
    
    try:
        solver = SOMSolver(1, len(weights_list), len(weights_list[0]))
        import torch
        solver.weights = torch.tensor(weights_list, dtype=torch.float32, device=solver.device)
        
        results = solver.evaluate_clustering(max_k=max_k)
        return {"success": True, "metrics": results}
    except Exception as e:
        import traceback
        return {"success": False, "error": f"Evaluation error: {str(e)}", "traceback": traceback.format_exc()}

def handle_recluster(params):
    weights_list = params.get("weights", [])
    if not weights_list:
        return {"success": False, "error": "No weights provided."}
    
    algorithm = params.get("algorithm", "dbscan")
    n_clusters = params.get("n_clusters", 4)
    eps = params.get("eps", 0.5)
    min_samples = params.get("min_samples", 3)
    
    try:
        solver = SOMSolver(1, len(weights_list), len(weights_list[0]))
        import torch
        solver.weights = torch.tensor(weights_list, dtype=torch.float32, device=solver.device)
        
        clustering_labels = solver.get_clustering(algorithm=algorithm, n_clusters=n_clusters, eps=eps, min_samples=min_samples)
        return {"success": True, "clustering": clustering_labels}
    except Exception as e:
        import traceback
        return {"success": False, "error": f"Recluster error: {str(e)}", "traceback": traceback.format_exc()}


def handle_vos_recluster(params):
    """
    Re-runs Louvain community detection on a VOSviewer network (items + links)
    with custom resolution and min_cluster_size parameters.
    Returns: { success, clusters: { item_id -> cluster_number } }
    """
    import networkx as nx

    vos_json = params.get("vosviewer_json", {})
    resolution = float(params.get("resolution", 1.0))
    min_cluster_size = int(params.get("min_cluster_size", 2))

    net = vos_json.get("network", vos_json)
    items = net.get("items", [])
    links = net.get("links", [])

    if not items:
        return {"success": False, "error": "No items in vosviewer_json."}

    try:
        G = nx.Graph()
        for it in items:
            G.add_node(it["id"])
        for lk in links:
            sid = lk.get("source_id") or lk.get("from_id")
            tid = lk.get("target_id") or lk.get("to_id")
            w   = float(lk.get("strength", 1))
            if sid and tid and sid != tid:
                G.add_edge(sid, tid, weight=w)

        cluster_map = {}
        if G.number_of_edges() > 0:
            try:
                communities = nx.community.louvain_communities(
                    G, weight="weight", resolution=resolution, seed=42
                )
                for cidx, comm in enumerate(communities, start=1):
                    for node in comm:
                        cluster_map[node] = cidx
            except Exception:
                for cidx, comp in enumerate(nx.connected_components(G), start=1):
                    for node in comp:
                        cluster_map[node] = cidx
        for it in items:
            if it["id"] not in cluster_map:
                cluster_map[it["id"]] = 1

        # Merge small clusters into the nearest large cluster
        if min_cluster_size > 1:
            cluster_sizes = {}
            for cid in cluster_map.values():
                cluster_sizes[cid] = cluster_sizes.get(cid, 0) + 1

            # Find the largest cluster as fallback
            largest = max(cluster_sizes, key=cluster_sizes.get)
            for node_id, cid in cluster_map.items():
                if cluster_sizes[cid] < min_cluster_size:
                    # Try to assign to neighbor's cluster
                    neighbors = list(G.neighbors(node_id))
                    if neighbors:
                        nbr_clusters = [cluster_map[n] for n in neighbors if cluster_map.get(n) != cid]
                        if nbr_clusters:
                            # Pick the neighbor cluster with most members
                            cluster_map[node_id] = max(set(nbr_clusters), key=nbr_clusters.count)
                        else:
                            cluster_map[node_id] = largest
                    else:
                        cluster_map[node_id] = largest

        # Remap cluster ids to be consecutive starting at 1
        unique_clusters = sorted(set(cluster_map.values()))
        remap = {old: new for new, old in enumerate(unique_clusters, start=1)}
        cluster_map = {node_id: remap[cid] for node_id, cid in cluster_map.items()}

        return {"success": True, "clusters": cluster_map}

    except Exception as e:
        import traceback
        return {"success": False, "error": f"VOS recluster error: {str(e)}", "traceback": traceback.format_exc()}

def handle_umap(params):
    import torch
    from som_solver import run_umap
    
    weights_list = params.get("weights", [])
    if not weights_list:
        return {"success": False, "error": "No weights provided."}
        
    n_neighbors = params.get("n_neighbors", 15)
    min_dist = params.get("min_dist", 0.1)
    metric = params.get("metric", "euclidean")
    
    try:
        data = torch.tensor(weights_list, dtype=torch.float32)
        # Using fallback_level 3 for safety on potentially large inputs in python context
        umap_embedding, umap_source = run_umap(data, fallback_level=3, n_components=2, n_neighbors=n_neighbors, min_dist=min_dist, metric=metric)
        return {
            "success": True,
            "umap": umap_embedding,
            "umap_source": umap_source
        }
    except Exception as e:
        import traceback
        return {"success": False, "error": f"UMAP error: {str(e)}", "traceback": traceback.format_exc()}

def handle_estimate_dim(params):
    data_list = params.get("data", [])
    if not data_list:
        return {"success": False, "error": "No data provided."}
    
    mode = params.get("mode", "ceiling")
    algorithm = params.get("algorithmName", "MLE")
    
    try:
        import numpy as np
        import skdim
        
        X = np.array(data_list, dtype=np.float32)
        
        if mode == "ceiling":
            # Optimal Strategy: Local MLE fit_pw
            model = skdim.id.MLE()
            local_dims = model.fit_transform_pw(X)
            
            # calculate percentiles
            p50 = float(np.percentile(local_dims, 50))
            p90 = float(np.percentile(local_dims, 90))
            p95 = float(np.percentile(local_dims, 95))
            p_max = float(np.max(local_dims))
            p_mean = float(np.mean(local_dims))
            
            return {
                "success": True,
                "mode": "ceiling",
                "estimated_dimension": p95, # recommend 95th percentile
                "metrics": {
                    "mean": p_mean,
                    "median": p50,
                    "p90": p90,
                    "p95": p95,
                    "max": p_max
                }
            }
        else:
            # Manual Mode
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
            
            if algorithm not in estimator_map:
                return {"success": False, "error": f"Unknown skdim algorithm: {algorithm}"}
            
            model = estimator_map[algorithm]()
            # Some global estimators fail on very large or collinear data
            model.fit(X)
            
            return {
                "success": True,
                "mode": "manual",
                "algorithm": algorithm,
                "estimated_dimension": float(model.dimension_)
            }
            
    except Exception as e:
        import traceback
        return {"success": False, "error": f"Estimation error: {str(e)}", "traceback": traceback.format_exc()}

def handle_reduce_dim(params):
    data_list = params.get("data", [])
    if not data_list:
        return {"success": False, "error": "No data provided."}
    
    target_d = params.get("target_d", 2)
    
    try:
        import numpy as np
        import umap
        
        X = np.array(data_list, dtype=np.float32)
        reducer = umap.UMAP(n_components=target_d, random_state=42)
        X_reduced = reducer.fit_transform(X)
        
        return {
            "success": True,
            "reduced_data": X_reduced.tolist()
        }
    except Exception as e:
        import traceback
        return {"success": False, "error": f"Reduction error: {str(e)}", "traceback": traceback.format_exc()}

def main():
    # We allow feeding parameters via a temporary JSON file path to avoid OS command-line character limits
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No arguments provided. Usage: python main_engine.py <detect|preprocess|train> [json_file|json_string]"}))
        sys.exit(1)
        
    action = sys.argv[1].lower()
    
    # If no payload is needed
    if action == "detect":
        res = handle_detect()
        print(json.dumps(res))
        sys.exit(0)
        
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "No payload argument provided for action."}))
        sys.exit(1)
        
    payload_raw = sys.argv[2]
    
    # Parse payload (either literal JSON string or file path containing JSON)
    try:
        if os.path.exists(payload_raw):
            with open(payload_raw, 'r', encoding='utf-8') as f:
                params = json.load(f)
        else:
            params = json.loads(payload_raw)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        sys.exit(1)
        
    if action == "preprocess":
        res = handle_preprocess(params)
        print(json.dumps(res))
    elif action == "incites_preprocess":
        # Fast inventory build (takes ~1-2 seconds)
        result = build_incites_inventory(payload_raw)
        output_file = params.get("output_file", "")
        
        if output_file:
            import warnings; warnings.filterwarnings("ignore")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False)
            print(json.dumps({
                "success": result.get("success", True),
                "unit_names": result.get("unit_names", []),
                "session_dir": result.get("session_dir"),
                "baseline": result.get("baseline")
            }))
        else:
            print(json.dumps(result))
    elif action == "incites_parse_unit":
        session_dir = params.get("session_dir", "")
        unit_name = params.get("unit_name", "")
        res = parse_single_unit_from_session(session_dir, unit_name)
        output_file = params.get("output_file", "")
        if output_file:
            import warnings; warnings.filterwarnings("ignore")
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(res, f, ensure_ascii=False)
            print(json.dumps({"success": res.get("success", True), "unit_name": unit_name}))
        else:
            print(json.dumps(res))
    elif action == "train":
        res = handle_train(params)
        print(json.dumps(res))
    elif action == "train_longitudinal":
        res = handle_train_longitudinal(params)
        print(json.dumps(res))
    elif action == "suggest_size":
        res = handle_suggest_size(params)
        print(json.dumps(res))
    elif action == "evaluate_clusters":
        res = handle_evaluate_clusters(params)
        print(json.dumps(res))
    elif action == "recluster":
        res = handle_recluster(params)
        print(json.dumps(res))
    elif action == "umap":
        res = handle_umap(params)
        print(json.dumps(res))
    elif action == "estimate_dim":
        res = handle_estimate_dim(params)
        print(json.dumps(res))
    elif action == "reduce_dim":
        res = handle_reduce_dim(params)
        print(json.dumps(res))
    elif action == "api_query":
        res = handle_api_query(params)
        print(json.dumps(res))
    elif action == "vos_recluster":
        res = handle_vos_recluster(params)
        print(json.dumps(res))
    else:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))


if __name__ == "__main__":
    main()
