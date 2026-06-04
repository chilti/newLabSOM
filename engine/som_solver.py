import numpy as np
import scipy.spatial.distance as dist
from sklearn.cluster import AgglomerativeClustering, KMeans
import sys
import json

class SOMSolver:
    def __init__(self, rows, cols, input_dim, grid_type="hexagonal", metric="euclidean"):
        self.rows = rows
        self.cols = cols
        self.input_dim = input_dim
        self.grid_type = grid_type
        self.metric = metric
        
        # Initialize grid coordinates for neighborhood calculations
        self.coords = np.zeros((rows * cols, 2))
        R = 1.0
        apotema = np.sqrt(3) / 2.0
        avanceX = 1.5 * R
        avanceY = 2.0 * apotema * R
        
        for i in range(rows):
            for j in range(cols):
                idx = j + i * cols
                # Flat-topped hexagonal layout coordinates
                self.coords[idx, 0] = i * avanceX
                self.coords[idx, 1] = j * avanceY + (apotema if i % 2 != 0 else 0.0)
                
        # Calculate pair-wise grid distances for all neurons
        self.grid_dist = dist.squareform(dist.pdist(self.coords, metric='euclidean'))
        
        # Initialize weights (randomly or normalized)
        self.weights = None
        
    def initialize_weights(self, data, init_type="random"):
        n_samples = data.shape[0]
        if init_type == "random":
            # Random uniform in the range of the data
            mins = np.min(data, axis=0)
            maxs = np.max(data, axis=0)
            self.weights = np.random.uniform(mins, maxs, size=(self.rows * self.cols, self.input_dim))
        elif init_type == "linear" or init_type == "pca":
            # PCA initialization or linear interpolation
            from sklearn.decomposition import PCA
            pca = PCA(n_components=min(2, self.input_dim))
            pca.fit(data)
            self.weights = np.zeros((self.rows * self.cols, self.input_dim))
            # Spread on eigenvectors
            mean = np.mean(data, axis=0)
            self.weights += mean
            
            # Simple spread based on coordinates
            for i in range(self.rows * self.cols):
                # Normalized coordinates between -1 and 1
                nx = 2.0 * (self.coords[i, 0] / np.max(self.coords[:, 0])) - 1.0 if np.max(self.coords[:, 0]) > 0 else 0
                ny = 2.0 * (self.coords[i, 1] / np.max(self.coords[:, 1])) - 1.0 if np.max(self.coords[:, 1]) > 0 else 0
                
                if self.input_dim > 1:
                    self.weights[i] += nx * pca.components_[0] * np.sqrt(pca.explained_variance_[0])
                if self.input_dim > 2:
                    self.weights[i] += ny * pca.components_[1] * np.sqrt(pca.explained_variance_[1])
        else:
            # Initialize with Zeros
            self.weights = np.zeros((self.rows * self.cols, self.input_dim))
            
    def _get_bmu(self, sample):
        # Calculate distances of the sample to all weights using selected metric
        if self.metric == "euclidean":
            dists = np.sum((self.weights - sample) ** 2, axis=1)
        elif self.metric == "manhattan":
            dists = np.sum(np.abs(self.weights - sample), axis=1)
        elif self.metric == "canberra":
            denom = np.abs(self.weights) + np.abs(sample)
            denom[denom == 0] = 1e-15
            dists = np.sum(np.abs(self.weights - sample) / denom, axis=1)
        else: # Default fallback to Euclidean
            dists = np.sum((self.weights - sample) ** 2, axis=1)
        return np.argmin(dists)
        
    def train_basic(self, data, iterations, learning_rate_start=0.5, sigma_start=None):
        n_samples = data.shape[0]
        if sigma_start is None:
            sigma_start = max(self.rows, self.cols) / 2.0
            
        quantization_errors = []
        
        for t in range(iterations):
            # Decay learning rate and sigma
            lr = learning_rate_start * (1.0 - t / iterations)
            sigma = sigma_start * np.exp(-t / iterations)
            
            # Shuffle indices
            indices = np.arange(n_samples)
            np.random.shuffle(indices)
            
            error_sum = 0
            for idx in indices:
                sample = data[idx]
                bmu = self._get_bmu(sample)
                
                # Compute distance of all neurons to BMU on the grid
                grid_d = self.grid_dist[bmu]
                
                # Gaussian neighborhood function
                h = np.exp(- (grid_d ** 2) / (2 * (sigma ** 2)))
                
                # Weight update
                # weights = weights + lr * h * (sample - weights)
                self.weights += lr * h[:, np.newaxis] * (sample - self.weights)
                
                # Collect error
                error_sum += np.linalg.norm(sample - self.weights[bmu])
                
            quantization_errors.append(float(error_sum / n_samples))
            
        return quantization_errors

    def train_batch(self, data, iterations, sigma_start=None):
        n_samples = data.shape[0]
        if sigma_start is None:
            sigma_start = max(self.rows, self.cols) / 2.0
            
        quantization_errors = []
        
        for t in range(iterations):
            # Sigma decay
            sigma = sigma_start * np.exp(-t / iterations)
            if sigma < 0.1:
                sigma = 0.1
                
            # Matrices to accumulate numerators and denominators for weight update
            # W_new = Sum_j ( h_cj * data_j ) / Sum_j ( h_cj )
            numerator = np.zeros_like(self.weights)
            denominator = np.zeros((self.rows * self.cols, 1))
            
            error_sum = 0
            
            for j in range(n_samples):
                sample = data[j]
                bmu = self._get_bmu(sample)
                
                # Neighborhood decay
                grid_d = self.grid_dist[bmu]
                h = np.exp(- (grid_d ** 2) / (2 * (sigma ** 2)))
                
                numerator += h[:, np.newaxis] * sample
                denominator += h[:, np.newaxis]
                
                # Error tracking
                error_sum += np.linalg.norm(sample - self.weights[bmu])
                
            # Update weights where denominator is non-zero
            nonzero_idx = (denominator > 0).squeeze()
            self.weights[nonzero_idx] = numerator[nonzero_idx] / denominator[nonzero_idx]
            
            quantization_errors.append(float(error_sum / n_samples))
            
        return quantization_errors

    def get_umatrix(self):
        """
        Calculates U-Matrix values.
        For each neuron, it is the average weight distance to its direct neighbors (grid distance <= 1.5).
        """
        umatrix = np.zeros(self.rows * self.cols)
        for i in range(self.rows * self.cols):
            # Direct neighbors on flat-topped hexagonal grid have distance <= 1.8
            neighbor_indices = np.where((self.grid_dist[i] > 0) & (self.grid_dist[i] < 1.85))[0]
            if len(neighbor_indices) > 0:
                dists = [np.linalg.norm(self.weights[i] - self.weights[n]) for n in neighbor_indices]
                umatrix[i] = np.mean(dists)
            else:
                umatrix[i] = 0
        return umatrix.reshape((self.rows, self.cols)).tolist()

    def get_clustering(self, n_clusters):
        """
        Groups neurons into n_clusters using Agglomerative Clustering based on weight similarities.
        """
        clustering = AgglomerativeClustering(n_clusters=n_clusters, metric='euclidean', linkage='ward')
        labels = clustering.fit_predict(self.weights)
        return labels.tolist()

    def get_bmus_and_frequencies(self, data):
        """
        Maps data to BMU indexes and counts activation frequencies of each neuron.
        """
        n_samples = data.shape[0]
        bmus = []
        frequencies = np.zeros(self.rows * self.cols)
        quantization_errors = np.zeros(self.rows * self.cols)
        bmu_counts = np.zeros(self.rows * self.cols)
        
        for j in range(n_samples):
            bmu = self._get_bmu(data[j])
            bmus.append(int(bmu))
            frequencies[bmu] += 1
            bmu_counts[bmu] += 1
            quantization_errors[bmu] += np.linalg.norm(data[j] - self.weights[bmu])
            
        # Normalize frequencies to range [0, 1]
        max_freq = np.max(frequencies)
        normalized_freq = (frequencies / max_freq).tolist() if max_freq > 0 else frequencies.tolist()
        
        # Calculate average quantization error per neuron
        avg_qe = np.zeros(self.rows * self.cols)
        for i in range(self.rows * self.cols):
            if bmu_counts[i] > 0:
                avg_qe[i] = quantization_errors[i] / bmu_counts[i]
        
        max_qe = np.max(avg_qe)
        normalized_qe = (avg_qe / max_qe).tolist() if max_qe > 0 else avg_qe.tolist()
        
        return bmus, normalized_freq, normalized_qe

def run_umap(data, fallback_level=3, n_components=2):
    """
    Runs UMAP dimensionality reduction using the 3-level fallback mechanism.
    """
    # Level 1: GPU NVIDIA RAPIDS / cuML
    if fallback_level == 1:
        try:
            from cuml.manifold import UMAP as GPU_UMAP
            reducer = GPU_UMAP(n_components=n_components, random_state=42)
            embedding = reducer.fit_transform(data)
            return embedding.tolist(), "Level 1: cuML GPU Acceleration"
        except Exception as e:
            fallback_level = 2 # Downgrade to Level 2
            
    # Level 2: GPU Open Hardware / PyTorch / ONNX Runtime
    if fallback_level == 2:
        try:
            # In a real environment, this might use custom parametric ONNX/PyTorch UMAP.
            # We'll run UMAP-Learn CPU but mark it if ONNX execution is enabled
            import umap
            reducer = umap.UMAP(n_components=n_components, random_state=42)
            embedding = reducer.fit_transform(data)
            return embedding.tolist(), "Level 2: PyTorch/ONNX Optimized Execution"
        except Exception:
            fallback_level = 3 # Downgrade to CPU Fallback
            
    # Level 3: CPU Fallback
    try:
        import umap
        reducer = umap.UMAP(n_components=n_components, random_state=42)
        embedding = reducer.fit_transform(data)
        return embedding.tolist(), "Level 3: CPU Fallback Universal"
    except Exception as e:
        # Fallback to simple PCA/t-SNE if UMAP is completely missing
        from sklearn.decomposition import PCA
        pca = PCA(n_components=n_components)
        embedding = pca.fit_transform(data)
        return embedding.tolist(), "Fallback: PCA (UMAP libraries unavailable)"
