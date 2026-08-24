using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

using LabSOM.Backend.Core.Utils;

namespace LabSOM.Backend.Core.Services
{
    public class PreprocessService
    {
        private readonly string _enginePath;

        public PreprocessService()
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

        public async Task<PreprocessResult> PreprocessBibliometricsWithFileAsync(
            Microsoft.AspNetCore.Http.IFormFile uploadedFile,
            PreprocessRequest request,
            Microsoft.AspNetCore.Http.IFormFile? uploadedThesaurusFile = null)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            
            string tempDir = Path.Combine(Path.GetTempPath(), "SinapsisMap");
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            string payloadFile = Path.Combine(tempDir, $"preprocess_{Guid.NewGuid():N}.json");
            string uploadedExt = Path.GetExtension(uploadedFile.FileName);
            if (string.IsNullOrEmpty(uploadedExt)) uploadedExt = ".txt";
            string sourceDataFile = Path.Combine(tempDir, $"data_{Guid.NewGuid():N}{uploadedExt}");
            string? sourceThesaurusFile = null;
            
            try
            {
                // Save the uploaded main data file
                using (var stream = new FileStream(sourceDataFile, FileMode.Create))
                {
                    await uploadedFile.CopyToAsync(stream);
                }

                // If a thesaurus file was also uploaded, save it
                if (uploadedThesaurusFile != null && uploadedThesaurusFile.Length > 0)
                {
                    string thExt = Path.GetExtension(uploadedThesaurusFile.FileName);
                    if (string.IsNullOrEmpty(thExt)) thExt = ".txt";
                    sourceThesaurusFile = Path.Combine(tempDir, $"thesaurus_{Guid.NewGuid():N}{thExt}");
                    using (var thStream = new FileStream(sourceThesaurusFile, FileMode.Create))
                    {
                        await uploadedThesaurusFile.CopyToAsync(thStream);
                    }
                    request.Thesaurus_Filepath = sourceThesaurusFile;
                }

                request.Filepath = sourceDataFile;

                // Write payload to JSON file
                string jsonPayload = JsonSerializer.Serialize(request);
                await File.WriteAllTextAsync(payloadFile, jsonPayload);
                
                var psi = new ProcessStartInfo
                {
                    FileName = PythonUtils.GetPythonExecutablePath(_enginePath),
                    Arguments = $"\"{scriptPath}\" preprocess \"{payloadFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    var result = JsonSerializer.Deserialize<PreprocessResult>(stdout, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                    if (result != null)
                    {
                        result.Term_Type = request.Custom_Tag ?? "Keywords";
                        return result;
                    }
                }

                return new PreprocessResult
                {
                    Success = false,
                    Error = !string.IsNullOrWhiteSpace(stderr) ? stderr : "Failed to parse bibliometrics data from Python engine."
                };
            }
            catch (Exception ex)
            {
                return new PreprocessResult
                {
                    Success = false,
                    Error = $"Preprocess error: {ex.Message}"
                };
            }
            finally
            {
                if (File.Exists(payloadFile)) { try { File.Delete(payloadFile); } catch { } }
                if (File.Exists(sourceDataFile)) { try { File.Delete(sourceDataFile); } catch { } }
                if (sourceThesaurusFile != null && File.Exists(sourceThesaurusFile)) { try { File.Delete(sourceThesaurusFile); } catch { } }
            }
        }

        public async Task<PreprocessResult> PreprocessApiQueryAsync(ApiQueryRequest request)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            
            string tempDir = Path.Combine(Path.GetTempPath(), "SinapsisMap");
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            string payloadFile = Path.Combine(tempDir, $"api_query_{Guid.NewGuid():N}.json");
            
            try
            {
                string jsonPayload = JsonSerializer.Serialize(request);
                await File.WriteAllTextAsync(payloadFile, jsonPayload);
                
                var psi = new ProcessStartInfo
                {
                    FileName = PythonUtils.GetPythonExecutablePath(_enginePath),
                    Arguments = $"\"{scriptPath}\" api_query \"{payloadFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    var result = JsonSerializer.Deserialize<PreprocessResult>(stdout, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                    if (result != null)
                    {
                        result.Term_Type = request.Custom_Tag ?? "Keywords";
                        return result;
                    }
                }

                return new PreprocessResult
                {
                    Success = false,
                    Error = !string.IsNullOrWhiteSpace(stderr) ? stderr : "Failed to query API from Python engine."
                };
            }
            catch (Exception ex)
            {
                return new PreprocessResult
                {
                    Success = false,
                    Error = $"API query error: {ex.Message}"
                };
            }
            finally
            {
                if (File.Exists(payloadFile)) { try { File.Delete(payloadFile); } catch { } }
            }
        }

        public async Task<VosReclusterResult> VosReclusterAsync(VosReclusterRequest request)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));

            string tempDir = Path.Combine(Path.GetTempPath(), "SinapsisMap");
            if (!Directory.Exists(tempDir))
                Directory.CreateDirectory(tempDir);

            string payloadFile = Path.Combine(tempDir, $"vos_recluster_{Guid.NewGuid():N}.json");

            try
            {
                var payload = new
                {
                    vosviewer_json  = request.Vosviewer_Json,
                    resolution      = request.Resolution,
                    min_cluster_size = request.Min_Cluster_Size
                };

                var payloadJson = JsonSerializer.Serialize(payload);
                await File.WriteAllTextAsync(payloadFile, payloadJson, System.Text.Encoding.UTF8);

                var psi = new ProcessStartInfo
                {
                    FileName = PythonUtils.GetPythonExecutablePath(_enginePath),
                    Arguments = $"\"{scriptPath}\" vos_recluster \"{payloadFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                    UseShellExecute  = false,
                    CreateNoWindow   = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    var result = JsonSerializer.Deserialize<VosReclusterResult>(stdout,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                    if (result != null) return result;
                }

                return new VosReclusterResult
                {
                    Success = false,
                    Error = !string.IsNullOrWhiteSpace(stderr) ? stderr : "VOS recluster failed."
                };
            }
            catch (Exception ex)
            {
                return new VosReclusterResult { Success = false, Error = $"VOS recluster error: {ex.Message}" };
            }
            finally
            {
                if (File.Exists(payloadFile)) { try { File.Delete(payloadFile); } catch { } }
            }
        }
    }

    // ─── DTOs ────────────────────────────────────────────────────────────────────

    public class VosReclusterRequest
    {
        [JsonPropertyName("vosviewer_json")]
        public object? Vosviewer_Json { get; set; }

        [JsonPropertyName("resolution")]
        public double Resolution { get; set; } = 1.0;

        [JsonPropertyName("min_cluster_size")]
        public int Min_Cluster_Size { get; set; } = 2;
    }

    public class VosReclusterResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        /// <summary>Dictionary of item_id (int) → cluster_number (int).</summary>
        [JsonPropertyName("clusters")]
        public Dictionary<int, int>? Clusters { get; set; }
    }

    public class ApiQueryRequest
    {
        [JsonPropertyName("source")]
        public string Source { get; set; } = "openalex";

        [JsonPropertyName("query")]
        public string Query { get; set; } = "";

        [JsonPropertyName("max_results")]
        public int Max_Results { get; set; } = 100;

        [JsonPropertyName("network_type")]
        public string Network_Type { get; set; } = "co-occurrence";

        [JsonPropertyName("custom_tag")]
        public string Custom_Tag { get; set; } = "DE";

        [JsonPropertyName("max_terms")]
        public int Max_Terms { get; set; } = 50;

        [JsonPropertyName("min_cooccurrence")]
        public int Min_Cooccurrence { get; set; } = 2;

        [JsonPropertyName("temporal")]
        public bool Temporal { get; set; } = false;

        [JsonPropertyName("temporal_window")]
        public int Temporal_Window { get; set; } = 1;

        [JsonPropertyName("extraction_source")]
        public string Extraction_Source { get; set; } = "keywords";

        [JsonPropertyName("counting_method")]
        public string Counting_Method { get; set; } = "full";

        [JsonPropertyName("relevance_ratio")]
        public double Relevance_Ratio { get; set; } = 0.60;
    }

    public class PreprocessRequest
    {
        [JsonPropertyName("filepath")]
        public string Filepath { get; set; } = "";
        
        [JsonPropertyName("network_type")]
        public string Network_Type { get; set; } = "co-occurrence";
        
        [JsonPropertyName("custom_tag")]
        public string Custom_Tag { get; set; } = "DE";
        
        [JsonPropertyName("max_terms")]
        public int Max_Terms { get; set; } = 100;
        
        [JsonPropertyName("min_cooccurrence")]
        public int Min_Cooccurrence { get; set; } = 2;
        
        [JsonPropertyName("only_major_mesh")]
        public bool Only_Major_Mesh { get; set; } = false;
        
        [JsonPropertyName("temporal")]
        public bool Temporal { get; set; } = false;

        [JsonPropertyName("temporal_window")]
        public int Temporal_Window { get; set; } = 1;

        [JsonPropertyName("extraction_source")]
        public string Extraction_Source { get; set; } = "keywords";

        [JsonPropertyName("counting_method")]
        public string Counting_Method { get; set; } = "full";

        [JsonPropertyName("thesaurus_filepath")]
        public string? Thesaurus_Filepath { get; set; }

        [JsonPropertyName("relevance_ratio")]
        public double Relevance_Ratio { get; set; } = 0.60;
    }

    public class PreprocessResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }
        
        [JsonPropertyName("error")]
        public string Error { get; set; }
        
        [JsonPropertyName("document_count")]
        public int Document_Count { get; set; }
        
        [JsonPropertyName("term_type")]
        public string Term_Type { get; set; }
        
        [JsonPropertyName("network")]
        public JsonElement? Network { get; set; }
        
        [JsonPropertyName("vosviewer_json")]
        public JsonElement? Vosviewer_Json { get; set; }
        
        [JsonPropertyName("term_counts")]
        public Dictionary<string, int> Term_Counts { get; set; }
        
        [JsonPropertyName("frequency_csv")]
        public string? Frequency_Csv { get; set; }
        
        [JsonPropertyName("cooccurrence_csv")]
        public string? Cooccurrence_Csv { get; set; }

        [JsonPropertyName("networks_by_year")]
        public JsonElement? Networks_By_Year { get; set; }

        [JsonPropertyName("cooccurrence_matrices_by_period")]
        public JsonElement? Cooccurrence_Matrices_By_Period { get; set; }

        [JsonPropertyName("temporal_window")]
        public int Temporal_Window { get; set; } = 1;
    }
}
