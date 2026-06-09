import json
import sys
import os
import numpy as np

# Adjust path to find local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from hardware_detector import detect_hardware
from bibliometrics_parser import read_and_generate_bibliometrics
from som_solver import SOMSolver, run_umap

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
    
    if not filepath or not os.path.exists(filepath):
        return {"success": False, "error": f"File not found: '{filepath}'"}
        
    try:
        res_dict = read_and_generate_bibliometrics(
            filepath, 
            network_type=network_type,
            custom_tag=custom_tag,
            max_terms=max_terms,
            min_cooccurrence=min_cooc,
            temporal=temporal
        )
        
        return res_dict
    except Exception as e:
        return {"success": False, "error": f"Preprocess error: {str(e)}"}

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
            model.fit_pw(X)
            # local dimensions
            local_dims = model.dimension_pw_
            
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
    elif action == "train":
        res = handle_train(params)
    elif action == "evaluate_clusters":
        res = handle_evaluate_clusters(params)
    elif action == "recluster":
        res = handle_recluster(params)
    elif action == "umap":
        res = handle_umap(params)
    elif action == "estimate_dim":
        res = handle_estimate_dim(params)
    elif action == "reduce_dim":
        res = handle_reduce_dim(params)
    else:
        res = {"success": False, "error": f"Unknown action: {action}"}
        
    print(json.dumps(res))

if __name__ == "__main__":
    main()
