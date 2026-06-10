using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace LabSOM.Backend.Core.Services
{
    public class SemanticService
    {
        private readonly string _enginePath;

        public SemanticService()
        {
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

        private async Task<TResult> RunPythonActionAsync<TRequest, TResult>(string action, TRequest request, int timeoutMinutes = 5)
            where TResult : class, new()
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "semantic_engine.py"));
            string tempDir = Path.GetFullPath(Path.Combine(_enginePath, "temp"));
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }

            string tempFile = Path.Combine(tempDir, $"sem_{action}_{Guid.NewGuid():N}.json");

            try
            {
                string jsonPayload = JsonSerializer.Serialize(request);
                await File.WriteAllTextAsync(tempFile, jsonPayload);

                var psi = new ProcessStartInfo
                {
                    FileName = "python",
                    Arguments = $"\"{scriptPath}\" {action} \"{tempFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(timeoutMinutes));
                try
                {
                    await process.WaitForExitAsync(cts.Token);
                }
                catch (OperationCanceledException)
                {
                    process.Kill(entireProcessTree: true);
                    var failRes = new TResult();
                    var successProp = failRes.GetType().GetProperty("Success");
                    var errorProp = failRes.GetType().GetProperty("Error");
                    successProp?.SetValue(failRes, false);
                    errorProp?.SetValue(failRes, $"Execution timed out after {timeoutMinutes} minutes.");
                    return failRes;
                }

                string stdout = await stdoutTask;
                string stderr = await stderrTask;

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    int jsonStart = stdout.IndexOf('{');
                    string jsonOnly = jsonStart >= 0 ? stdout[jsonStart..] : stdout;

                    try
                    {
                        var result = JsonSerializer.Deserialize<TResult>(jsonOnly, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        if (result != null) return result;
                    }
                    catch (JsonException jex)
                    {
                        var failRes = new TResult();
                        var successProp = failRes.GetType().GetProperty("Success");
                        var errorProp = failRes.GetType().GetProperty("Error");
                        successProp?.SetValue(failRes, false);
                        errorProp?.SetValue(failRes, $"JSON parse error: {jex.Message} | stdout: {stdout} | stderr: {stderr}");
                        return failRes;
                    }
                }

                var errRes = new TResult();
                var errSuccessProp = errRes.GetType().GetProperty("Success");
                var errErrorProp = errRes.GetType().GetProperty("Error");
                errSuccessProp?.SetValue(errRes, false);
                errErrorProp?.SetValue(errRes, $"Subprocess error (exit code {process.ExitCode}). Stderr: {stderr}");
                return errRes;
            }
            catch (Exception ex)
            {
                var failRes = new TResult();
                var successProp = failRes.GetType().GetProperty("Success");
                var errorProp = failRes.GetType().GetProperty("Error");
                successProp?.SetValue(failRes, false);
                errorProp?.SetValue(failRes, $"Exception: {ex.Message}");
                return failRes;
            }
            finally
            {
                if (File.Exists(tempFile))
                {
                    try { File.Delete(tempFile); } catch { }
                }
            }
        }

        public async Task<SemanticParseResult> PreprocessSemanticAsync(IFormFile uploadedFile, SemanticParseRequest request)
        {
            string tempDir = Path.GetFullPath(Path.Combine(_enginePath, "temp"));
            if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);

            string sourceDataFile = Path.Combine(tempDir, $"data_{Guid.NewGuid():N}.txt");

            try
            {
                using (var stream = new FileStream(sourceDataFile, FileMode.Create))
                {
                    await uploadedFile.CopyToAsync(stream);
                }

                request.Filepath = sourceDataFile;
                var result = await RunPythonActionAsync<SemanticParseRequest, SemanticParseResult>("parse", request);
                return result;
            }
            finally
            {
                if (File.Exists(sourceDataFile))
                {
                    try { File.Delete(sourceDataFile); } catch { }
                }
            }
        }

        public async Task<SemanticEmbedResult> GenerateEmbeddingsAsync(SemanticEmbedRequest request)
        {
            return await RunPythonActionAsync<SemanticEmbedRequest, SemanticEmbedResult>("embed", request, timeoutMinutes: 15);
        }

        public async Task<SemanticReduceResult> ReduceDimensionAsync(SemanticReduceRequest request)
        {
            return await RunPythonActionAsync<SemanticReduceRequest, SemanticReduceResult>("reduce", request, timeoutMinutes: 10);
        }

        public async Task<SemanticClusterResult> ClusterSemanticAsync(SemanticClusterRequest request)
        {
            return await RunPythonActionAsync<SemanticClusterRequest, SemanticClusterResult>("cluster", request, timeoutMinutes: 10);
        }
    }

    public class SemanticParseRequest
    {
        [JsonPropertyName("filepath")]
        public string Filepath { get; set; } = string.Empty;

        [JsonPropertyName("use_mesh")]
        public bool UseMesh { get; set; } = true;

        [JsonPropertyName("extract_title")]
        public bool ExtractTitle { get; set; } = true;

        [JsonPropertyName("extract_abstract")]
        public bool ExtractAbstract { get; set; } = true;

        [JsonPropertyName("extract_keywords")]
        public bool ExtractKeywords { get; set; } = true;

        [JsonPropertyName("extra_fields")]
        public List<string> ExtraFields { get; set; } = new();
    }

    public class SemanticRecord
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("doi")]
        public string Doi { get; set; } = string.Empty;

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("abstract")]
        public string Abstract { get; set; } = string.Empty;

        [JsonPropertyName("keywords")]
        public List<string> Keywords { get; set; } = new();

        [JsonPropertyName("concatenated_text")]
        public string ConcatenatedText { get; set; } = string.Empty;

        [JsonPropertyName("extras")]
        public Dictionary<string, string> Extras { get; set; } = new();
    }

    public class SemanticParseResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;

        [JsonPropertyName("records")]
        public List<SemanticRecord> Records { get; set; } = new();
    }

    public class SemanticEmbedRequest
    {
        [JsonPropertyName("records")]
        public List<SemanticRecord> Records { get; set; } = new();

        [JsonPropertyName("model")]
        public string Model { get; set; } = "nomic";
    }

    public class SemanticEmbedResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;

        [JsonPropertyName("embeddings")]
        public List<List<double>> Embeddings { get; set; } = new();
    }

    public class SemanticReduceRequest
    {
        [JsonPropertyName("embeddings")]
        public List<List<double>> Embeddings { get; set; } = new();

        [JsonPropertyName("estimate_mode")]
        public string EstimateMode { get; set; } = "ceiling";

        [JsonPropertyName("algorithm_name")]
        public string AlgorithmName { get; set; } = "MLE";

        [JsonPropertyName("target_dim")]
        public int TargetDim { get; set; } = 15;
    }

    public class SemanticReduceResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;

        [JsonPropertyName("estimated_dimension")]
        public double EstimatedDimension { get; set; }

        [JsonPropertyName("metrics")]
        public Dictionary<string, double>? Metrics { get; set; }

        [JsonPropertyName("target_dim")]
        public int TargetDim { get; set; }

        [JsonPropertyName("intrinsic_data")]
        public List<List<double>> IntrinsicData { get; set; } = new();

        [JsonPropertyName("coords_2d")]
        public List<Coordinate2D> Coords2D { get; set; } = new();
    }

    public class Coordinate2D
    {
        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }
    }

    public class SemanticClusterRequest
    {
        [JsonPropertyName("intrinsic_data")]
        public List<List<double>> IntrinsicData { get; set; } = new();

        [JsonPropertyName("coords_2d")]
        public List<Coordinate2D> Coords2D { get; set; } = new();

        [JsonPropertyName("records")]
        public List<SemanticRecord> Records { get; set; } = new();

        [JsonPropertyName("num_levels")]
        public int NumLevels { get; set; } = 2;

        [JsonPropertyName("min_size")]
        public int MinSize { get; set; } = 10;
    }

    public class SemanticClusterResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;

        [JsonPropertyName("clusters")]
        public List<JsonElement> Clusters { get; set; } = new();

        [JsonPropertyName("cluster_assignment")]
        public List<string> ClusterAssignment { get; set; } = new();
    }
}
