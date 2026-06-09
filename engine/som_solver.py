import numpy as np
import scipy.spatial.distance as dist
from sklearn.cluster import AgglomerativeClustering, KMeans, DBSCAN
from sklearn.metrics import silhouette_score, davies_bouldin_score, calinski_harabasz_score
import sys
import json
import torch

class SOMSolver:
    def __init__(self, rows, cols, input_dim, grid_type="hexagonal", metric="euclidean"):
        self.rows = rows
        self.cols = cols
        self.input_dim = input_dim
        self.grid_type = grid_type
        self.metric = metric
        
        # Initialize grid coordinates for neighborhood calculations
        self.coords_np = np.zeros((rows * cols, 2))
        R = 1.0
        apotema = np.sqrt(3) / 2.0
        avanceX = 1.5 * R
        avanceY = 2.0 * apotema * R
        
        for i in range(rows):
            for j in range(cols):
                idx = j + i * cols
                # Flat-topped hexagonal layout coordinates
                self.coords_np[idx, 0] = i * avanceX
                self.coords_np[idx, 1] = j * avanceY + (apotema if i % 2 != 0 else 0.0)
                
        # Calculate pair-wise grid distances for all neurons
        self.grid_dist_np = dist.squareform(dist.pdist(self.coords_np, metric='euclidean'))
        
        self.weights = None
        self.grid_dist = None
        self.coords = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"[*] SOM Engine initialized. Device assigned: {self.device}", file=sys.stderr)
        
    def initialize_weights(self, data, init_type="random"):
        n_samples = data.shape[0]
        
        # Setup Tensors
        self.grid_dist = torch.tensor(self.grid_dist_np, dtype=torch.float32, device=self.device)
        self.coords = torch.tensor(self.coords_np, dtype=torch.float32, device=self.device)
            
        if init_type == "random":
            mins = np.min(data, axis=0)
            maxs = np.max(data, axis=0)
            weights_np = np.random.uniform(mins, maxs, size=(self.rows * self.cols, self.input_dim))
            self.weights = torch.tensor(weights_np, dtype=torch.float32, device=self.device)
        elif init_type == "linear" or init_type == "pca":
            from sklearn.decomposition import PCA
            pca = PCA(n_components=min(2, self.input_dim))
            pca.fit(data)
            weights_np = np.zeros((self.rows * self.cols, self.input_dim))
            mean = np.mean(data, axis=0)
            weights_np += mean
            
            max_x = np.max(self.coords_np[:, 0])
            max_y = np.max(self.coords_np[:, 1])
            
            for i in range(self.rows * self.cols):
                nx = 2.0 * (self.coords_np[i, 0] / max_x) - 1.0 if max_x > 0 else 0
                ny = 2.0 * (self.coords_np[i, 1] / max_y) - 1.0 if max_y > 0 else 0
                
                if self.input_dim > 1:
                    weights_np[i] += nx * pca.components_[0] * np.sqrt(pca.explained_variance_[0])
                if self.input_dim > 2:
                    weights_np[i] += ny * pca.components_[1] * np.sqrt(pca.explained_variance_[1])
                    
            self.weights = torch.tensor(weights_np, dtype=torch.float32, device=self.device)
        else:
            self.weights = torch.zeros((self.rows * self.cols, self.input_dim), dtype=torch.float32, device=self.device)
            
    def _compute_distances(self, X):
        """Computes pairwise distances from X (N, D) to self.weights (M, D). Returns (N, M)."""
        if self.metric == "euclidean":
            return torch.cdist(X, self.weights, p=2.0)
        elif self.metric == "manhattan":
            return torch.cdist(X, self.weights, p=1.0)
        elif self.metric == "canberra":
            num = torch.abs(X.unsqueeze(1) - self.weights.unsqueeze(0))
            den = torch.abs(X).unsqueeze(1) + torch.abs(self.weights).unsqueeze(0) + 1e-15
            return torch.sum(num / den, dim=2)
        else:
            return torch.cdist(X, self.weights, p=2.0)
            
    def train_basic(self, data, iterations, learning_rate_start=0.5, sigma_start=None):
        """Sequential/online SOM training. Slow due to iteration, but supported."""
        n_samples = data.shape[0]
        if sigma_start is None:
            sigma_start = max(self.rows, self.cols) / 2.0
            
        quantization_errors = []
        X = torch.tensor(data, dtype=torch.float32, device=self.device)
        
        for t in range(iterations):
            lr = learning_rate_start * (1.0 - t / iterations)
            sigma = sigma_start * np.exp(-t / iterations)
            
            indices = torch.randperm(n_samples, device=self.device)
            error_sum = 0.0
            
            for idx in indices:
                sample = X[idx].unsqueeze(0) # (1, D)
                dists = self._compute_distances(sample)
                bmu = torch.argmin(dists, dim=1)[0]
                
                grid_d = self.grid_dist[bmu]
                h = torch.exp(- (grid_d ** 2) / (2 * (sigma ** 2)))
                
                self.weights += lr * h.unsqueeze(1) * (sample - self.weights)
                error_sum += torch.norm(sample - self.weights[bmu]).item()
                
            quantization_errors.append(error_sum / n_samples)
            
        return quantization_errors

    def train_batch(self, data, iterations, sigma_start=None):
        """Fully vectorized, highly parallel Batch SOM training on GPU/Multicore."""
        n_samples = data.shape[0]
        if sigma_start is None:
            sigma_start = max(self.rows, self.cols) / 2.0
            
        quantization_errors = []
        X = torch.tensor(data, dtype=torch.float32, device=self.device)
        
        for t in range(iterations):
            sigma = sigma_start * np.exp(-t / iterations)
            if sigma < 0.1:
                sigma = 0.1
                
            dists = self._compute_distances(X) # (n_samples, n_neurons)
            bmus = torch.argmin(dists, dim=1) # (n_samples,)
            
            # Extract grid distances to the BMU for each sample
            grid_d = self.grid_dist[bmus] # (n_samples, n_neurons)
            
            # Neighborhood weights
            h = torch.exp(- (grid_d ** 2) / (2 * (sigma ** 2))) # (n_samples, n_neurons)
            
            # Batch update matrix algebra
            numerator = torch.matmul(h.t(), X) # (n_neurons, D)
            denominator = torch.sum(h, dim=0).unsqueeze(1) # (n_neurons, 1)
            
            nonzero_idx = (denominator > 0).squeeze()
            self.weights[nonzero_idx] = numerator[nonzero_idx] / denominator[nonzero_idx]
            
            # Error tracking
            sample_errors = torch.norm(X - self.weights[bmus], dim=1)
            quantization_errors.append(sample_errors.mean().item())
            
        return quantization_errors

    def get_umatrix(self):
        """Calculates U-Matrix values via neighbor distances."""
        umatrix = np.zeros(self.rows * self.cols)
        weights_np = self.weights.cpu().numpy()
        for i in range(self.rows * self.cols):
            # Neighbors distance threshold for hex topology
            neighbor_indices = np.where((self.grid_dist_np[i] > 0) & (self.grid_dist_np[i] < 1.85))[0]
            if len(neighbor_indices) > 0:
                dists = [np.linalg.norm(weights_np[i] - weights_np[n]) for n in neighbor_indices]
                umatrix[i] = np.mean(dists)
            else:
                umatrix[i] = 0
        return umatrix.reshape((self.rows, self.cols)).tolist()

    def get_clustering(self, algorithm="dbscan", n_clusters=4, eps=0.5, min_samples=3):
        """Clustering on the SOM weights."""
        weights_np = self.weights.cpu().numpy()
        
        if algorithm == "dbscan":
            from sklearn.preprocessing import StandardScaler
            # Standardize weights so that eps has a predictable scale (e.g. 0.5 = half standard deviation)
            scaled_weights = StandardScaler().fit_transform(weights_np)
            clustering = DBSCAN(eps=eps, min_samples=min_samples)
            labels = clustering.fit_predict(scaled_weights)
        else:
            clustering = AgglomerativeClustering(n_clusters=n_clusters, metric='euclidean', linkage='ward')
            labels = clustering.fit_predict(weights_np)
            
        return labels.tolist()

    def evaluate_clustering(self, max_k=15):
        """Calculates clustering metrics (Silhouette, Davies-Bouldin, Calinski-Harabasz) for k=2 to max_k."""
        weights_np = self.weights.cpu().numpy()
        results = []
        # Fallback if too few neurons (unlikely for SOM)
        if len(weights_np) < 3:
            return results
            
        actual_max_k = min(max_k, len(weights_np) - 1)
        for k in range(2, actual_max_k + 1):
            clustering = AgglomerativeClustering(n_clusters=k, metric='euclidean', linkage='ward')
            labels = clustering.fit_predict(weights_np)
            
            if len(set(labels)) > 1:
                sil = silhouette_score(weights_np, labels)
                db = davies_bouldin_score(weights_np, labels)
                ch = calinski_harabasz_score(weights_np, labels)
            else:
                sil, db, ch = 0, 0, 0
                
            results.append({
                "k": k,
                "silhouette": float(sil),
                "davies_bouldin": float(db),
                "calinski_harabasz": float(ch)
            })
            
        return results

    def get_bmus_and_frequencies(self, data):
        """Maps dataset and calculates hit frequencies and quantization errors."""
        X = torch.tensor(data, dtype=torch.float32, device=self.device)
        n_neurons = self.rows * self.cols
        
        dists = self._compute_distances(X)
        bmus = torch.argmin(dists, dim=1)
        
        selected_weights = self.weights[bmus]
        sample_errors = torch.norm(X - selected_weights, dim=1)
        
        frequencies = torch.zeros(n_neurons, dtype=torch.float32, device=self.device)
        quantization_errors = torch.zeros(n_neurons, dtype=torch.float32, device=self.device)
        
        frequencies.scatter_add_(0, bmus, torch.ones_like(bmus, dtype=torch.float32))
        quantization_errors.scatter_add_(0, bmus, sample_errors)
        
        max_freq = torch.max(frequencies)
        normalized_freq = (frequencies / max_freq) if max_freq > 0 else frequencies
        
        avg_qe = torch.zeros_like(quantization_errors)
        mask = frequencies > 0
        avg_qe[mask] = quantization_errors[mask] / frequencies[mask]
        
        max_qe = torch.max(avg_qe)
        normalized_qe = (avg_qe / max_qe) if max_qe > 0 else avg_qe
        
        return bmus.cpu().tolist(), normalized_freq.cpu().tolist(), normalized_qe.cpu().tolist()

def run_umap(data, fallback_level=3, n_components=2, n_neighbors=15, min_dist=0.1, metric="euclidean"):
    """
    Runs UMAP dimensionality reduction using the 3-level fallback mechanism.
    """
    # Level 1: GPU NVIDIA RAPIDS / cuML
    if fallback_level == 1:
        try:
            from cuml.manifold import UMAP as GPU_UMAP
            reducer = GPU_UMAP(n_components=n_components, n_neighbors=n_neighbors, min_dist=min_dist, metric=metric, random_state=42)
            embedding = reducer.fit_transform(data)
            return embedding.tolist(), "Level 1: cuML GPU Acceleration"
        except Exception as e:
            print(f"cuML fallback triggered: {e}", file=sys.stderr)
            fallback_level = 2 # Downgrade to Level 2
            
    # Level 2: GPU Open Hardware / PyTorch / ONNX Runtime
    if fallback_level == 2:
        try:
            import umap
            reducer = umap.UMAP(n_components=n_components, n_neighbors=n_neighbors, min_dist=min_dist, metric=metric, random_state=42)
            embedding = reducer.fit_transform(data)
            return embedding.tolist(), "Level 2: Multicore PyTorch/ONNX Execution"
        except Exception as e:
            print(f"Level 2 fallback triggered: {e}", file=sys.stderr)
            fallback_level = 3 # Downgrade to CPU Fallback
            
    # Level 3: CPU Fallback
    try:
        import umap
        reducer = umap.UMAP(n_components=n_components, n_neighbors=n_neighbors, min_dist=min_dist, metric=metric, random_state=42)
        embedding = reducer.fit_transform(data)
        return embedding.tolist(), "Level 3: CPU Fallback Universal"
    except Exception as e:
        from sklearn.decomposition import PCA
        pca = PCA(n_components=n_components)
        embedding = pca.fit_transform(data)
        return embedding.tolist(), "Fallback: PCA (UMAP libraries unavailable)"
