using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;
using System.Linq;
using LabSOM.Backend.Core.Utils;

namespace LabSOM.Backend.Core.Services
{
    /// <summary>
    /// Stateful InCites service: Python parses all data and writes it
    /// to a temp JSON file on disk. The frontend then fetches each unit
    /// on-demand via lightweight REST calls, avoiding huge payloads over
    /// WebView2's internal message bus.
    /// </summary>
    public class InCitesService
    {
        private readonly string _enginePath;

        // In-memory index: stores the path to the full result JSON file
        // and the list of unit names discovered, keyed by a session ID.
        // Using a simple singleton approach (single-user desktop app).
        private string? _resultFilePath = null;
        private string? _sessionDir = null;
        private List<string> _unitNames = new();
        private Dictionary<string, string> _unitCacheRaw = new();

        private static readonly JsonSerializerOptions _jsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
            NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals
        };

        public InCitesService()
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
                dir = Path.GetDirectoryName(dir)!;
            }
            _enginePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "engine");
        }

        // ─────────────────────────────────────────────────────────────
        // Step 1: Upload & Process
        // Returns only { success, unit_names[], error } — very small.
        // ─────────────────────────────────────────────────────────────
        public async Task<InCitesUploadResult> ProcessInCitesFilesAsync(List<IFormFile> uploadedFiles)
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));

            string tempDir = Path.Combine(Path.GetTempPath(), "SinapsisMap_InCites");
            Directory.CreateDirectory(tempDir);

            // Clean up any previous result file
            if (_resultFilePath != null && File.Exists(_resultFilePath))
            {
                try { File.Delete(_resultFilePath); } catch { }
                _resultFilePath = null;
                _unitNames.Clear();
            }

            string payloadFile = Path.Combine(tempDir, $"incites_payload_{Guid.NewGuid():N}.json");
            string resultFile = Path.Combine(tempDir, $"incites_result_{Guid.NewGuid():N}.json");
            List<string> savedFilePaths = new();

            try
            {
                foreach (var file in uploadedFiles)
                {
                    // IMPORTANT: preserve the original filename so Python's
                    // identify_file_type() can detect the unit (e.g. "Incites Researchers.xlsx")
                    string safeOriginal = Path.GetFileName(file.FileName);
                    // Ensure uniqueness with a short prefix to avoid collisions
                    string destPath = Path.Combine(tempDir, $"up_{Guid.NewGuid():N}_{safeOriginal}");

                    using (var stream = new FileStream(destPath, FileMode.Create))
                        await file.CopyToAsync(stream);

                    savedFilePaths.Add(destPath);
                }

                // Pass the desired output file path to Python so it WRITES there
                // instead of printing to stdout.
                var payload = new { files = savedFilePaths, output_file = resultFile };
                await File.WriteAllTextAsync(payloadFile, JsonSerializer.Serialize(payload));

                var psi = new ProcessStartInfo
                {
                    FileName = PythonUtils.GetPythonExecutablePath(_enginePath),
                    Arguments = $"\"{scriptPath}\" incites_preprocess \"{payloadFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();

                await Task.WhenAll(stdoutTask, stderrTask);
                await process.WaitForExitAsync();

                string stdout = stdoutTask.Result.Trim();
                string stderr = stderrTask.Result.Trim();

                if (process.ExitCode != 0)
                {
                    return new InCitesUploadResult
                    {
                        Success = false,
                        Error = $"Subprocess error (exit {process.ExitCode}): {stderr}"
                    };
                }

                // Python should have written the result to resultFile.
                // stdout now contains only a tiny status JSON: {"success":true,"unit_names":[...]}
                if (!File.Exists(resultFile))
                {
                    // Fallback: maybe Python still printed to stdout (old behavior)
                    if (!string.IsNullOrEmpty(stdout))
                    {
                        await File.WriteAllTextAsync(resultFile, stdout);
                    }
                    else
                    {
                        return new InCitesUploadResult
                        {
                            Success = false,
                            Error = "Python process completed but produced no output."
                        };
                    }
                }

                // Read unit names and session_dir from result file
                using var stream2 = File.OpenRead(resultFile);
                using var doc = await JsonDocument.ParseAsync(stream2);
                var root = doc.RootElement;

                if (root.TryGetProperty("unit_names", out var namesEl))
                {
                    _unitNames = namesEl.EnumerateArray().Select(x => x.GetString()!).Where(x => x != null).ToList();
                }
                else if (root.TryGetProperty("units", out var unitsEl))
                {
                    _unitNames = unitsEl.EnumerateObject().Select(p => p.Name).ToList();
                }
                else
                {
                    _unitNames.Clear();
                }

                if (root.TryGetProperty("session_dir", out var sDirEl))
                {
                    _sessionDir = sDirEl.GetString();
                }

                _unitCacheRaw.Clear();

                JsonElement? baselineEl = null;
                if (root.TryGetProperty("baseline", out var bProp))
                {
                    baselineEl = bProp.Clone();
                }

                JsonElement? openAlexEl = null;
                if (root.TryGetProperty("openalex_data", out var oaProp))
                {
                    openAlexEl = oaProp.Clone();
                }

                _resultFilePath = resultFile;

                return new InCitesUploadResult
                {
                    Success = true,
                    UnitNames = _unitNames,
                    Baseline = baselineEl,
                    OpenAlexData = openAlexEl
                };
            }
            catch (Exception ex)
            {
                return new InCitesUploadResult
                {
                    Success = false,
                    Error = $"Exception: {ex.Message}"
                };
            }
            finally
            {
                if (File.Exists(payloadFile))
                    try { File.Delete(payloadFile); } catch { }

                foreach (var path in savedFilePaths)
                    if (File.Exists(path))
                        try { File.Delete(path); } catch { }
            }
        }

        public async Task<string?> GetBaselineDataRawAsync()
        {
            if (_resultFilePath == null || !File.Exists(_resultFilePath))
                return null;

            using var stream = File.OpenRead(_resultFilePath);
            using var doc = await JsonDocument.ParseAsync(stream);
            if (doc.RootElement.TryGetProperty("baseline", out var bProp))
            {
                return bProp.GetRawText();
            }
            return null;
        }

        // ─────────────────────────────────────────────────────────────
        // Step 2: Get a single unit's data on-demand (Lazy Loading)
        // ─────────────────────────────────────────────────────────────
        public async Task<InCitesUnitResult> GetUnitDataAsync(string unitName)
        {
            if (_unitCacheRaw.TryGetValue(unitName, out var cachedRaw))
            {
                return new InCitesUnitResult { Success = true, UnitName = unitName, UnitDataRaw = cachedRaw };
            }

            // Fallback for pre-parsed full files
            if (_resultFilePath != null && File.Exists(_resultFilePath))
            {
                using var stream = File.OpenRead(_resultFilePath);
                using var doc = await JsonDocument.ParseAsync(stream);
                if (doc.RootElement.TryGetProperty("units", out var unitsEl) && unitsEl.TryGetProperty(unitName, out var unitEl))
                {
                    var raw = unitEl.GetRawText();
                    _unitCacheRaw[unitName] = raw;
                    return new InCitesUnitResult { Success = true, UnitName = unitName, UnitDataRaw = raw };
                }
            }

            if (string.IsNullOrEmpty(_sessionDir) || !Directory.Exists(_sessionDir))
            {
                return new InCitesUnitResult
                {
                    Success = false,
                    Error = "No active session inventory found. Please upload files first."
                };
            }

            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            string payloadFile = Path.Combine(Path.GetTempPath(), $"incites_unit_req_{Guid.NewGuid():N}.json");
            string unitOutputFile = Path.Combine(_sessionDir, $"parsed_{unitName.Replace(" ", "_")}.json");

            try
            {
                var payload = new { session_dir = _sessionDir, unit_name = unitName, output_file = unitOutputFile };
                await File.WriteAllTextAsync(payloadFile, JsonSerializer.Serialize(payload));

                var psi = new ProcessStartInfo
                {
                    FileName = PythonUtils.GetPythonExecutablePath(_enginePath),
                    Arguments = $"\"{scriptPath}\" incites_parse_unit \"{payloadFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = new Process { StartInfo = psi };
                process.Start();

                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();

                await Task.WhenAll(stdoutTask, stderrTask);
                await process.WaitForExitAsync();

                if (File.Exists(unitOutputFile))
                {
                    using var stream = File.OpenRead(unitOutputFile);
                    using var doc = await JsonDocument.ParseAsync(stream);
                    if (doc.RootElement.TryGetProperty("unit", out var uEl))
                    {
                        string rawText = uEl.GetRawText();
                        _unitCacheRaw[unitName] = rawText;
                        return new InCitesUnitResult { Success = true, UnitName = unitName, UnitDataRaw = rawText };
                    }
                }

                return new InCitesUnitResult
                {
                    Success = false,
                    Error = $"Failed to parse unit '{unitName}': {stderrTask.Result}"
                };
            }
            catch (Exception ex)
            {
                return new InCitesUnitResult
                {
                    Success = false,
                    Error = $"Exception parsing unit '{unitName}': {ex.Message}"
                };
            }
            finally
            {
                if (File.Exists(payloadFile))
                    try { File.Delete(payloadFile); } catch { }
            }
        }
    }

    // ── DTOs ──────────────────────────────────────────────────────────

    public class InCitesUploadResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("unit_names")]
        public List<string>? UnitNames { get; set; }

        [JsonPropertyName("baseline")]
        public JsonElement? Baseline { get; set; }

        [JsonPropertyName("openalex_data")]
        public JsonElement? OpenAlexData { get; set; }
    }

    public class InCitesUnitResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("unit_name")]
        public string? UnitName { get; set; }

        // Raw JSON string to be passed directly to the client
        [JsonIgnore]
        public string? UnitDataRaw { get; set; }
    }

    // Keep for backwards compat
    public class InCitesResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("traceback")]
        public string? Traceback { get; set; }

        [JsonPropertyName("units")]
        public JsonElement? Units { get; set; }
    }
}
