using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace LabSOM.Backend.Core.Services
{
    public class HardwareDetectorService
    {
        private readonly string _enginePath;

        public HardwareDetectorService()
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

        public async Task<HardwareInfo> DetectAsync()
        {
            var scriptPath = Path.GetFullPath(Path.Combine(_enginePath, "main_engine.py"));
            
            var psi = new ProcessStartInfo
            {
                FileName = "python",
                Arguments = $"\"{scriptPath}\" detect",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            try
            {
                using var process = new Process { StartInfo = psi };
                process.Start();

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
                {
                    var response = JsonSerializer.Deserialize<DetectResponse>(stdout, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    
                    if (response != null && response.Success && response.Hardware != null)
                    {
                        return response.Hardware;
                    }
                }

                return new HardwareInfo
                {
                    Level = 3,
                    Device = "CPU (Fallback Universal)",
                    Details = $"Execution failed or python not found. Stderr: {stderr}"
                };
            }
            catch (Exception ex)
            {
                return new HardwareInfo
                {
                    Level = 3,
                    Device = "CPU (Fallback Universal)",
                    Details = $"Exception during detection: {ex.Message}"
                };
            }
        }
    }

    public class DetectResponse
    {
        public bool Success { get; set; }
        public HardwareInfo Hardware { get; set; }
    }

    public class HardwareInfo
    {
        public int Level { get; set; }
        public string Device { get; set; }
        public string Details { get; set; }
    }
}
