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

                // IMPORTANT: Read stdout and stderr CONCURRENTLY to avoid the classic deadlock
                // where the process fills one pipe's OS buffer while we're blocking on the other.
                // With large datasets (e.g. 8000+ rows) stderr receives enough PyTorch/engine logs
                // to fill the buffer and stall the process while we wait on stdout.
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();
                
                // Apply a generous timeout for large training runs (10 minutes)
                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
                try
                {
                    await process.WaitForExitAsync(cts.Token);
                }
                catch (OperationCanceledException)
                {
                    process.Kill(entireProcessTree: true);
                    return new SOMTrainingResult
                    {
                        Success = false,
                        Error = "Training timed out after 10 minutes. Consider reducing dataset size, grid dimensions, or iterations."
                    };
                }
                
                string stdout = await stdoutTask;
                string stderr = await stderrTask;

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    // Some libraries (e.g. cuML) print info/log lines directly to stdout BEFORE
                    // the JSON payload. Strip everything before the first '{' to get clean JSON.
                    int jsonStart = stdout.IndexOf('{');
                    string jsonOnly = jsonStart > 0 ? stdout[jsonStart..] : stdout;
                    
                    try
                    {
                        var result = JsonSerializer.Deserialize<SOMTrainingResult>(jsonOnly, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        
                        if (result != null)
                        {
                            return result;
                        }
                    }
                    catch (JsonException jex)
                    {
                        string stdoutPreview = stdout.Length > 500 ? stdout[..500] + "..." : stdout;
                        return new SOMTrainingResult
                        {
                            Success = false,
                            Error = $"JSON parse error: {jex.Message} | stdout preview: {stdoutPreview} | stderr: {stderr}"
                        };
                    }
                }

                return new SOMTrainingResult
                {
                    Success = false,
                    Error = $"Subprocess error (exit code {process.ExitCode}). stdout: {(string.IsNullOrWhiteSpace(stdout) ? "(empty)" : stdout[..Math.Min(200, stdout.Length)])} | stderr: {stderr}"
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
    public async Task<EvaluateClustersResult> EvaluateClustersAsync(EvaluateClustersRequest request)
    {
        var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
        string tempDir = Path.GetFullPath(Path.Combine(_enginePath, "temp"));
        if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);
        
        string tempFile = Path.Combine(tempDir, $"som_eval_{Guid.NewGuid():N}.json");
        
        try
        {
            string jsonPayload = JsonSerializer.Serialize(request);
            await File.WriteAllTextAsync(tempFile, jsonPayload);
            
            var psi = new ProcessStartInfo
            {
                FileName = "python",
                Arguments = $"\"{scriptPath}\" evaluate_clusters \"{tempFile}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = new Process { StartInfo = psi };
            process.Start();

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                return new EvaluateClustersResult { Success = false, Error = "Evaluation timed out." };
            }
            
            string stdout = await stdoutTask;
            string stderr = await stderrTask;

            if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
            {
                int jsonStart = stdout.IndexOf('{');
                string jsonOnly = jsonStart > 0 ? stdout[jsonStart..] : stdout;
                
                try
                {
                    var result = JsonSerializer.Deserialize<EvaluateClustersResult>(jsonOnly, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (result != null) return result;
                }
                catch (JsonException jex)
                {
                    return new EvaluateClustersResult { Success = false, Error = $"JSON parse error: {jex.Message}" };
                }
            }
            return new EvaluateClustersResult { Success = false, Error = $"Subprocess error (exit code {process.ExitCode}). stderr: {stderr}" };
        }
        catch (Exception ex)
        {
            return new EvaluateClustersResult { Success = false, Error = $"Exception: {ex.Message}" };
        }
        finally
        {
            if (File.Exists(tempFile)) { try { File.Delete(tempFile); } catch { } }
        }
    }

    public async Task<UmapResult> GenerateUmapAsync(UmapRequest request)
    {
        var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
        string tempDir = Path.GetFullPath(Path.Combine(_enginePath, "temp"));
        if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);
        
        string tempFile = Path.Combine(tempDir, $"som_umap_{Guid.NewGuid():N}.json");
        
        try
        {
            string jsonPayload = JsonSerializer.Serialize(request);
            await File.WriteAllTextAsync(tempFile, jsonPayload);
            
            var psi = new ProcessStartInfo
            {
                FileName = "python",
                Arguments = $"\"{scriptPath}\" umap \"{tempFile}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = new Process { StartInfo = psi };
            process.Start();

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                return new UmapResult { Success = false, Error = "UMAP generation timed out." };
            }
            
            string stdout = await stdoutTask;
            string stderr = await stderrTask;

            if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
            {
                int jsonStart = stdout.IndexOf('{');
                string jsonOnly = jsonStart > 0 ? stdout[jsonStart..] : stdout;
                
                try
                {
                    var result = JsonSerializer.Deserialize<UmapResult>(jsonOnly, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (result != null) return result;
                }
                catch (JsonException ex)
                {
                    return new UmapResult { Success = false, Error = "Failed to parse Python UMAP JSON. " + ex.Message };
                }
            }

            return new UmapResult { Success = false, Error = "UMAP failed. Process output: " + stderr };
        }
        finally
        {
            if (File.Exists(tempFile)) { try { File.Delete(tempFile); } catch { } }
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
        
        [JsonPropertyName("clustering_algorithm")]
        public string Clustering_Algorithm { get; set; }
        
        [JsonPropertyName("eps")]
        public double Eps { get; set; }
        
        [JsonPropertyName("min_samples")]
        public int Min_Samples { get; set; }
        
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

    public class EvaluateClustersRequest
    {
        [JsonPropertyName("weights")]
        public List<List<double>> Weights { get; set; }

        [JsonPropertyName("max_k")]
        public int Max_K { get; set; }
    }
    
    public class EvaluateClustersResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }
        
        [JsonPropertyName("error")]
        public string Error { get; set; }
        
        [JsonPropertyName("metrics")]
        public List<JsonElement> Metrics { get; set; }
    }

    public class UmapRequest
    {
        [JsonPropertyName("weights")]
        public List<List<double>> Weights { get; set; }

        [JsonPropertyName("n_neighbors")]
        public int N_Neighbors { get; set; }

        [JsonPropertyName("min_dist")]
        public double Min_Dist { get; set; }

        [JsonPropertyName("metric")]
        public string Metric { get; set; }
    }

    public class UmapResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }
        
        [JsonPropertyName("error")]
        public string Error { get; set; }
        
        [JsonPropertyName("umap")]
        public List<List<double>> Umap { get; set; }
        
        [JsonPropertyName("umap_source")]
        public string Umap_Source { get; set; }
    }
}
