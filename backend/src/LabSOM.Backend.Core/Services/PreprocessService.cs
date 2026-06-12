using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

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

        public async Task<PreprocessResult> PreprocessBibliometricsWithFileAsync(Microsoft.AspNetCore.Http.IFormFile uploadedFile, PreprocessRequest request)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            
            // Use the OS temp folder (always writable) instead of engine\temp which may be
            // inside Program Files or another protected directory.
            // Resolves to: C:\Users\<user>\AppData\Local\Temp\SinapsisMap\
            string tempDir = Path.Combine(Path.GetTempPath(), "SinapsisMap");
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            string payloadFile = Path.Combine(tempDir, $"preprocess_{Guid.NewGuid():N}.json");
            // Preserve the original file extension so MetaKnowledge can detect the format correctly
            // (e.g. Scopus .csv, PubMed .txt, BibTeX .bib, Web of Science .txt)
            string uploadedExt = Path.GetExtension(uploadedFile.FileName);
            if (string.IsNullOrEmpty(uploadedExt)) uploadedExt = ".txt";
            string sourceDataFile = Path.Combine(tempDir, $"data_{Guid.NewGuid():N}{uploadedExt}");
            
            try
            {
                // Save the uploaded file to disk temporarily
                using (var stream = new FileStream(sourceDataFile, FileMode.Create))
                {
                    await uploadedFile.CopyToAsync(stream);
                }

                // Update request filepath to point to the new temporary file on the server
                request.Filepath = sourceDataFile;

                // Write payload to JSON file
                string jsonPayload = JsonSerializer.Serialize(request);
                await File.WriteAllTextAsync(payloadFile, jsonPayload);
                
                var psi = new ProcessStartInfo
                {
                    FileName = "python",
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
                        return result;
                    }
                }

                return new PreprocessResult
                {
                    Success = false,
                    Error = $"Subprocess error (exit code {process.ExitCode}). Stderr: {stderr}"
                };
            }
            catch (Exception ex)
            {
                return new PreprocessResult
                {
                    Success = false,
                    Error = $"Exception during preprocessing: {ex.Message}"
                };
            }
            finally
            {
                // Clean up the temporary files safely
                if (File.Exists(payloadFile))
                {
                    try { File.Delete(payloadFile); } catch { }
                }
                if (File.Exists(sourceDataFile))
                {
                    try { File.Delete(sourceDataFile); } catch { }
                }
            }
        }
    }

    public class PreprocessRequest
    {
        [JsonPropertyName("filepath")]
        public string Filepath { get; set; }
        
        [JsonPropertyName("network_type")]
        public string Network_Type { get; set; }
        
        [JsonPropertyName("custom_tag")]
        public string Custom_Tag { get; set; }
        
        [JsonPropertyName("max_terms")]
        public int Max_Terms { get; set; } = 100;
        
        [JsonPropertyName("min_cooccurrence")]
        public int Min_Cooccurrence { get; set; } = 2;
        
        [JsonPropertyName("only_major_mesh")]
        public bool Only_Major_Mesh { get; set; } = false;
        
        [JsonPropertyName("temporal")]
        public bool Temporal { get; set; } = false;
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
        
        [JsonPropertyName("term_counts")]
        public Dictionary<string, int> Term_Counts { get; set; }
        
        [JsonPropertyName("frequency_csv")]
        public string? Frequency_Csv { get; set; }
        
        [JsonPropertyName("cooccurrence_csv")]
        public string? Cooccurrence_Csv { get; set; }

        [JsonPropertyName("networks_by_year")]
        public JsonElement? Networks_By_Year { get; set; }
    }
}
