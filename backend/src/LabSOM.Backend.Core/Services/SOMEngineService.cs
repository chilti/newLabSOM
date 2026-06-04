using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LabSOM.Backend.Core.Services
{
    public class SOMEngineService
    {
        private readonly string _enginePath;

        public SOMEngineService()
        {
            // Walk up directory tree starting from BaseDirectory to find 'engine' folder robustly
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            while (!string.IsNullOrEmpty(dir))
            {
                var candidate = Path.Combine(dir, "engine");
                if (Directory.Exists(candidate))
                {
                    _enginePath = candidate;
                    return;
                }
                dir = Path.GetDirectoryName(dir);
            }
            
            _enginePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "engine");
        }

        public async Task<SOMTrainingResult> TrainAsync(SOMTrainingRequest request)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            
            // Create temporary folder inside the engine directory
            string tempDir = Path.GetFullPath(Path.Combine(_enginePath, "temp"));
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            string tempFile = Path.Combine(tempDir, $"som_train_{Guid.NewGuid():N}.json");
            
            try
            {
                // Write payload to JSON file to prevent command-line limit issues
                string jsonPayload = JsonSerializer.Serialize(request);
                await File.WriteAllTextAsync(tempFile, jsonPayload);
                
                var psi = new ProcessStartInfo
                {
                    FileName = "python",
                    Arguments = $"\"{scriptPath}\" train \"{tempFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                // Read output streams asynchronously
                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    var result = JsonSerializer.Deserialize<SOMTrainingResult>(stdout, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    
                    if (result != null)
                    {
                        return result;
                    }
                }

                return new SOMTrainingResult
                {
                    Success = false,
                    Error = $"Subprocess error (exit code {process.ExitCode}). Stderr: {stderr}"
                };
            }
            catch (Exception ex)
            {
                return new SOMTrainingResult
                {
                    Success = false,
                    Error = $"Exception during SOM training: {ex.Message}"
                };
            }
            finally
            {
                // Safe cleanup of temporary JSON parameter file
                if (File.Exists(tempFile))
                {
                    try
                    {
                        File.Delete(tempFile);
                    }
                    catch { /* Silence cleanup failures */ }
                }
            }
        }
    }

    public class SOMTrainingRequest
    {
        [JsonPropertyName("data")]
        public List<List<double>> Data { get; set; }
        
        [JsonPropertyName("rows")]
        public int Rows { get; set; }
        
        [JsonPropertyName("cols")]
        public int Cols { get; set; }
        
        [JsonPropertyName("iterations")]
        public int Iterations { get; set; }
        
        [JsonPropertyName("method")]
        public string Method { get; set; } // "basic" or "batch"
        
        [JsonPropertyName("init")]
        public string Init { get; set; } // "random", "linear", or "pca"
        
        [JsonPropertyName("metric")]
        public string Metric { get; set; } // "euclidean", "manhattan", "canberra"
        
        [JsonPropertyName("learning_rate")]
        public double Learning_Rate { get; set; }
        
        [JsonPropertyName("n_clusters")]
        public int N_Clusters { get; set; }
        
        [JsonPropertyName("run_umap")]
        public bool Run_Umap { get; set; }
        
        [JsonPropertyName("fallback_level")]
        public int Fallback_Level { get; set; }
        
        [JsonPropertyName("labels")]
        public List<string> Labels { get; set; }
    }

    public class SOMTrainingResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }
        
        [JsonPropertyName("error")]
        public string Error { get; set; }
        
        [JsonPropertyName("traceback")]
        public string Traceback { get; set; }
        
        [JsonPropertyName("weights")]
        public List<List<double>> Weights { get; set; }
        
        [JsonPropertyName("umatrix")]
        public List<List<double>> Umatrix { get; set; }
        
        [JsonPropertyName("clustering")]
        public List<int> Clustering { get; set; }
        
        [JsonPropertyName("frequencies")]
        public List<double> Frequencies { get; set; }
        
        [JsonPropertyName("quantization_errors")]
        public List<double> Quantization_Errors { get; set; }
        
        [JsonPropertyName("bmus")]
        public List<int> Bmus { get; set; }
        
        [JsonPropertyName("hex_grid")]
        public List<JsonElement> Hex_Grid { get; set; }
        
        [JsonPropertyName("mapped_labels")]
        public List<List<string>> Mapped_Labels { get; set; }
        
        [JsonPropertyName("errors")]
        public List<double> Errors { get; set; }
        
        [JsonPropertyName("umap")]
        public List<List<double>> Umap { get; set; }
        
        [JsonPropertyName("umap_source")]
        public string Umap_Source { get; set; }
    }
}
