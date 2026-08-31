using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

using System.Collections.Generic;

namespace LabSOM.Backend.Core.Services
{
    public class LlmChatMessage
    {
        public string Role { get; set; } = "user";
        public string Content { get; set; } = "";
    }

    public class LlmService
    {
        private readonly HttpClient _httpClient;

        public LlmService()
        {
            // Initialize custom HttpClient that ignores SSL errors for LM Studio
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = (message, cert, chain, sslPolicyErrors) => true
            };
            _httpClient = new HttpClient(handler);
        }

        private (string baseUrl, string model, string apiKey) GetConfig()
        {
            var baseUrl = Environment.GetEnvironmentVariable("LLM_BASE_URL");
            var model = Environment.GetEnvironmentVariable("LLM_MODEL");
            var apiKey = Environment.GetEnvironmentVariable("LLM_API_KEY");

            // If any critical var is missing, search for .env file directly on disk
            if (string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(apiKey))
            {
                var searchDir = new DirectoryInfo(AppContext.BaseDirectory);
                while (searchDir != null)
                {
                    var envFile = Path.Combine(searchDir.FullName, ".env");
                    if (File.Exists(envFile))
                    {
                        foreach (var line in File.ReadAllLines(envFile))
                        {
                            var trimmed = line.Trim();
                            if (trimmed.StartsWith("#") || !trimmed.Contains("=")) continue;
                            var parts = trimmed.Split('=', 2);
                            var key = parts[0].Trim();
                            var val = parts[1].Trim();
                            if (key == "LLM_BASE_URL" && string.IsNullOrEmpty(baseUrl)) baseUrl = val;
                            if (key == "LLM_MODEL" && string.IsNullOrEmpty(model)) model = val;
                            if (key == "LLM_API_KEY" && string.IsNullOrEmpty(apiKey)) apiKey = val;
                        }
                        break;
                    }
                    searchDir = searchDir.Parent;
                }
            }

            baseUrl = string.IsNullOrEmpty(baseUrl) ? "https://dinamica1.fciencias.unam.mx/v1/" : baseUrl;
            model = string.IsNullOrEmpty(model) ? "default" : model;
            apiKey = string.IsNullOrEmpty(apiKey) ? "" : apiKey;

            return (baseUrl, model, apiKey);
        }

        public async Task<string> AnalyzeAsync(
            string systemPrompt, 
            string userPrompt, 
            List<LlmChatMessage>? history = null,
            string? customApiKey = null,
            string? customBaseUrl = null,
            string? customModel = null)
        {
            var config = GetConfig();
            var baseUrl = !string.IsNullOrWhiteSpace(customBaseUrl) ? customBaseUrl.Trim() : config.baseUrl;
            var model = !string.IsNullOrWhiteSpace(customModel) ? customModel.Trim() : config.model;
            var apiKey = !string.IsNullOrWhiteSpace(customApiKey) ? customApiKey.Trim() : config.apiKey;

            var url = baseUrl.TrimEnd('/') + "/chat/completions";

            var messages = new List<object>();

            if (!string.IsNullOrEmpty(systemPrompt))
            {
                messages.Add(new { role = "system", content = systemPrompt });
            }

            if (history != null && history.Count > 0)
            {
                foreach (var msg in history)
                {
                    if (!string.IsNullOrEmpty(msg.Content))
                    {
                        messages.Add(new { role = string.IsNullOrEmpty(msg.Role) ? "user" : msg.Role, content = msg.Content });
                    }
                }
            }

            if (!string.IsNullOrEmpty(userPrompt))
            {
                messages.Add(new { role = "user", content = userPrompt });
            }

            var payload = new
            {
                model = model,
                messages,
                temperature = 0.2
            };

            var jsonPayload = JsonSerializer.Serialize(payload);
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            if (!string.IsNullOrEmpty(apiKey))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            }

            var response = await _httpClient.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync();
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized || response.StatusCode == System.Net.HttpStatusCode.Forbidden)
                {
                    throw new Exception($"Authentication failed (HTTP {(int)response.StatusCode}). An API key is required or the provided key is invalid. Please configure your API key in AI Assistant settings. [Details: {error}]");
                }
                throw new Exception($"LLM Request Failed (HTTP {(int)response.StatusCode}) [Model: {model}]: {error}");
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(responseJson);
            
            if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
            {
                var firstChoice = choices[0];
                if (firstChoice.TryGetProperty("message", out var message) && message.TryGetProperty("content", out var textContent))
                {
                    return textContent.GetString() ?? "";
                }
            }

            return "No response content generated by model.";
        }

        public async Task<(bool success, string message, string model)> TestConnectionAsync(
            string? customApiKey = null,
            string? customBaseUrl = null,
            string? customModel = null)
        {
            var config = GetConfig();
            var baseUrl = !string.IsNullOrWhiteSpace(customBaseUrl) ? customBaseUrl.Trim() : config.baseUrl;
            var model = !string.IsNullOrWhiteSpace(customModel) ? customModel.Trim() : config.model;
            var apiKey = !string.IsNullOrWhiteSpace(customApiKey) ? customApiKey.Trim() : config.apiKey;

            var url = baseUrl.TrimEnd('/') + "/chat/completions";

            var messages = new List<object>
            {
                new { role = "user", content = "Respond with 'OK' only." }
            };

            var payload = new
            {
                model = model,
                messages,
                max_tokens = 10,
                temperature = 0.0
            };

            var jsonPayload = JsonSerializer.Serialize(payload);
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            if (!string.IsNullOrEmpty(apiKey))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            }

            try
            {
                using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(12));
                var response = await _httpClient.SendAsync(request, cts.Token);

                if (!response.IsSuccessStatusCode)
                {
                    var error = await response.Content.ReadAsStringAsync();
                    if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized || response.StatusCode == System.Net.HttpStatusCode.Forbidden)
                    {
                        return (false, $"HTTP {(int)response.StatusCode}: Authentication failed. Valid API Key is required for this endpoint.", model);
                    }
                    return (false, $"HTTP {(int)response.StatusCode}: {error}", model);
                }

                var responseJson = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(responseJson);
                
                if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
                {
                    return (true, "Connection successful! Model responded correctly.", model);
                }

                return (false, "Response received but format was unexpected.", model);
            }
            catch (Exception ex)
            {
                return (false, $"Connection error: {ex.Message}", model);
            }
        }
    }
}
