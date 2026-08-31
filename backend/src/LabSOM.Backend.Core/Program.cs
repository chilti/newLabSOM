using LabSOM.Backend.Core.Data;
using LabSOM.Backend.Core.Services;
using LabSOM.Backend.Core.Utils;
using Microsoft.AspNetCore.Authentication.JwtBearer;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using System.Diagnostics;
using System.IO;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading;

// Ensure the working directory is the executable's directory (crucial for Start Menu shortcuts)
Directory.SetCurrentDirectory(System.AppContext.BaseDirectory);

// Search for .env file up the directory tree starting from executable location
var searchDir = new DirectoryInfo(System.AppContext.BaseDirectory);
while (searchDir != null)
{
    var candidate = Path.Combine(searchDir.FullName, ".env");
    if (File.Exists(candidate))
    {
        Console.WriteLine($"[Config] Loaded .env file from: {candidate}");
        foreach (var line in File.ReadAllLines(candidate))
        {
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#")) continue;
            var parts = line.Split('=', 2);
            if (parts.Length == 2) Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
        }
        break;
    }
    searchDir = searchDir.Parent;
}

bool isHeadless = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true" || args.Contains("--headless");

// Prevent multiple instances of the desktop GUI application
bool createdNew;
using var mutex = new Mutex(true, "knoMap_SingleInstance_Mutex", out createdNew);
if (!isHeadless && !createdNew)
{
    // If it's a second desktop GUI window, exit to avoid duplicate windows
    return;
}

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddSingleton<HardwareDetectorService>();
builder.Services.AddSingleton<PreprocessService>();
builder.Services.AddSingleton<InCitesService>();
builder.Services.AddSingleton<SOMEngineService>();
builder.Services.AddSingleton<SemanticService>();
builder.Services.AddSingleton<LlmService>();

// SQLite Database & Persistence
string dbPath = Path.Combine(AppContext.BaseDirectory, "App_Data", "knomap.db");
string dbDir = Path.GetDirectoryName(dbPath)!;
if (!Directory.Exists(dbDir)) Directory.CreateDirectory(dbDir);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}"));

builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ProjectService>();

// JWT Authentication Setup
string jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET") 
    ?? "knomap_super_secret_jwt_key_2026_change_in_production_environment_998877665544332211";
var jwtKeyBytes = Encoding.ASCII.GetBytes(jwtSecret);

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = false;
    options.SaveToken = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(jwtKeyBytes),
        ValidateIssuer = false,
        ValidateAudience = false
    };
});

builder.Services.AddAuthorization();

// Allow large matrices (e.g. for SOM Weights)
builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(options =>
{
    options.Limits.MaxRequestBodySize = int.MaxValue; 
});

// Enable CORS for local SPA frontends (Vite runs on localhost)
builder.Services.AddCors();

// Listen on a stable local port (19080) for desktop UI so localStorage and WebView2 state persist properly
if (!isHeadless)
{
    int port = 19080;
    try
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, port);
        listener.Start();
        listener.Stop();
    }
    catch
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
    }
    builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
}


var app = builder.Build();

// Serve the compiled React frontend from wwwroot
app.UseDefaultFiles();
app.UseStaticFiles();

// Enable CORS
app.UseCors(policy => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod());

app.UseAuthentication();
app.UseAuthorization();

// Ensure Database & Initial Admin User exist on startup
using (var scope = app.Services.CreateScope())
{
    var authSvc = scope.ServiceProvider.GetRequiredService<AuthService>();
    await authSvc.EnsureAdminCreatedAsync();
}

// 1. System Hardware Status Endpoint
app.MapGet("/api/system/status", async (HardwareDetectorService detector) =>
{
    var hw = await detector.DetectAsync();
    return Results.Ok(new { success = true, hardware = hw });
});

// 2. Bibliometric Preprocessing Endpoint
app.MapPost("/api/preprocess/bibliometrics", async (HttpRequest req, PreprocessService preprocessor) =>
{
    if (!req.HasFormContentType || req.Form.Files.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "No file uploaded." });
    }

    var file = req.Form.Files["file"] ?? req.Form.Files[0];
    var thesaurusFile = req.Form.Files["thesaurusFile"];
    
    // Read parameters from form
    var request = new PreprocessRequest
    {
        Network_Type = req.Form["networkType"].FirstOrDefault() ?? "co-occurrence",
        Custom_Tag = req.Form["customTag"].FirstOrDefault() ?? "DE",
        Max_Terms = int.TryParse(req.Form["maxTerms"], out int mt) ? mt : 100,
        Min_Cooccurrence = int.TryParse(req.Form["minCooc"], out int mc) ? mc : 2,
        Only_Major_Mesh = bool.TryParse(req.Form["onlyMajor"], out bool om) ? om : false,
        Temporal = bool.TryParse(req.Form["temporal"], out bool temp) ? temp : false,
        Temporal_Window = int.TryParse(req.Form["temporalWindow"], out int tw) ? tw : 1,
        Extraction_Source = req.Form["extractionSource"].FirstOrDefault() ?? "keywords",
        Counting_Method = req.Form["countingMethod"].FirstOrDefault() ?? "full",
        Relevance_Ratio = double.TryParse(req.Form["relevanceRatio"], out double rr) ? rr : 0.60
    };

    var result = await preprocessor.PreprocessBibliometricsWithFileAsync(file, request, thesaurusFile);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 2b. Live API Query Endpoint (OpenAlex / Crossref)
app.MapPost("/api/preprocess/api_query", async (ApiQueryRequest request, PreprocessService preprocessor) =>
{
    if (string.IsNullOrWhiteSpace(request.Query))
    {
        return Results.BadRequest(new { success = false, error = "Search query is required." });
    }

    var result = await preprocessor.PreprocessApiQueryAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 2c. VOS Recluster Endpoint — re-runs Louvain on the current VOS network
app.MapPost("/api/preprocess/vos_recluster", async (VosReclusterRequest request, PreprocessService preprocessor) =>
{
    if (request.Vosviewer_Json is null)
    {
        return Results.BadRequest(new { success = false, error = "vosviewer_json is required." });
    }

    var result = await preprocessor.VosReclusterAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 2.5a InCites Upload & Process — returns ONLY unit names (tiny payload)
app.MapPost("/api/incites/process", async (HttpRequest req, InCitesService service) =>
{
    if (!req.HasFormContentType || req.Form.Files.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "No files uploaded." });
    }

    var files = req.Form.Files.ToList();
    var result = await service.ProcessInCitesFilesAsync(files);
    
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result); // { success, unit_names: [...] }
});

// 2.5b InCites Get Unit Data — returns ONE unit on demand (small payload)
app.MapGet("/api/incites/unit/{unitName}", async (string unitName, InCitesService service) =>
{
    var result = await service.GetUnitDataAsync(unitName);
    if (!result.Success)
    {
        return Results.Json(new { success = false, error = result.Error }, statusCode: 404);
    }
    // Stream the raw JSON directly to avoid double-serialization overhead
    return Results.Content(
        $"{{\"success\":true,\"unit_name\":\"{unitName}\",\"unit\":{result.UnitDataRaw}}}",
        "application/json");
});

// 2.5c InCites Get Baseline Data — returns baseline summary & trend
app.MapGet("/api/incites/baseline", async (InCitesService service) =>
{
    var rawBaseline = await service.GetBaselineDataRawAsync();
    if (string.IsNullOrEmpty(rawBaseline))
    {
        return Results.Json(new { success = false, error = "No baseline data found" }, statusCode: 404);
    }
    return Results.Content(
        $"{{\"success\":true,\"baseline\":{rawBaseline}}}",
        "application/json");
});


// 3. SOM and UMAP Training Endpoint
app.MapPost("/api/som/suggest_size", async (SuggestSizeRequest request, SOMEngineService engine) =>
{
    var result = await engine.SuggestSizeAsync(request);
    return Results.Ok(result);
});

app.MapPost("/api/som/train", async (SOMTrainingRequest request, SOMEngineService engine) =>
{
    if (request.Data == null || request.Data.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Data matrix is empty or invalid." });
    }
    
    var result = await engine.TrainAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

app.MapPost("/api/som/train-longitudinal", async (LongitudinalSOMTrainingRequest request, SOMEngineService engine) =>
{
    if (request.PeriodsData == null || request.PeriodsData.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Periods data is empty or invalid." });
    }
    
    var result = await engine.TrainLongitudinalAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 4. Evaluate Clustering Endpoint
app.MapPost("/api/som/evaluate_clusters", async (EvaluateClustersRequest request, SOMEngineService engine) =>
{
    if (request.Weights == null || request.Weights.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Weights matrix is empty or invalid." });
    }
    
    var result = await engine.EvaluateClustersAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 5. Recluster Fast Endpoint
app.MapPost("/api/som/recluster", async (ReclusterRequest request, SOMEngineService engine) =>
{
    if (request.Weights == null || request.Weights.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Weights matrix is empty or invalid." });
    }
    
    var result = await engine.ReclusterAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 5. UMAP Projections Endpoint
app.MapPost("/api/som/umap", async (UmapRequest request, SOMEngineService engine) =>
{
    if (request.Weights == null || request.Weights.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Weights matrix is empty or invalid." });
    }
    
    var result = await engine.GenerateUmapAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 6. Dimension Estimation Endpoint
app.MapPost("/api/dim/estimate", async (EstimateDimensionRequest request, SOMEngineService engine) =>
{
    if (request.Data == null || request.Data.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Data matrix is empty or invalid." });
    }
    
    var result = await engine.EstimateDimensionAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 7. Dimension Reduction Endpoint
app.MapPost("/api/dim/reduce", async (ReduceDimensionRequest request, SOMEngineService engine) =>
{
    if (request.Data == null || request.Data.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Data matrix is empty or invalid." });
    }
    
    var result = await engine.ReduceDimensionAsync(request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 8. Semantic Bibliometrics Endpoints
app.MapPost("/api/semantic/preprocess", async (HttpRequest req, SemanticService service) =>
{
    if (!req.HasFormContentType || req.Form.Files.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "No file uploaded." });
    }

    var file = req.Form.Files[0];
    
    // Parse fields
    var extraFieldsRaw = req.Form["extraFields"].ToString() ?? "";
    var extraFields = new List<string>();
    if (!string.IsNullOrWhiteSpace(extraFieldsRaw))
    {
        foreach (var field in extraFieldsRaw.Split(','))
        {
            var trimmed = field.Trim();
            if (!string.IsNullOrEmpty(trimmed)) extraFields.Add(trimmed);
        }
    }

    var request = new SemanticParseRequest
    {
        UseMesh = bool.TryParse(req.Form["useMesh"], out bool um) ? um : true,
        ExtractTitle = !bool.TryParse(req.Form["extractTitle"], out bool et) || et,
        ExtractAbstract = !bool.TryParse(req.Form["extractAbstract"], out bool ea) || ea,
        ExtractKeywords = !bool.TryParse(req.Form["extractKeywords"], out bool ek) || ek,
        ExtraFields = extraFields
    };

    var result = await service.PreprocessSemanticAsync(file, request);
    return Results.Ok(result);
});

app.MapPost("/api/semantic/embed", async (SemanticEmbedRequest request, SemanticService service) =>
{
    if (request.Records == null || request.Records.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Records list is empty." });
    }

    var result = await service.GenerateEmbeddingsAsync(request);
    return Results.Ok(result);
});

app.MapPost("/api/semantic/reduce", async (SemanticReduceRequest request, SemanticService service) =>
{
    if (request.Embeddings == null || request.Embeddings.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Embeddings list is empty." });
    }

    var result = await service.ReduceDimensionAsync(request);
    return Results.Ok(result);
});

app.MapPost("/api/semantic/cluster", async (SemanticClusterRequest request, SemanticService service) =>
{
    if (request.IntrinsicData == null || request.IntrinsicData.Count == 0)
    {
        return Results.BadRequest(new { success = false, error = "Intrinsic data list is empty." });
    }

    var result = await service.ClusterSemanticAsync(request);
    return Results.Ok(result);
});

// ----------------------------------------------------
// AUTH & USER MANAGEMENT ENDPOINTS
// ----------------------------------------------------

app.MapPost("/api/auth/login", async (HttpContext ctx, AuthService authSvc) =>
{
    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync();
    var doc = System.Text.Json.JsonDocument.Parse(body);
    string username = doc.RootElement.GetProperty("username").GetString() ?? "";
    string password = doc.RootElement.GetProperty("password").GetString() ?? "";

    var user = await authSvc.AuthenticateAsync(username, password);
    if (user == null)
    {
        return Results.Json(new { success = false, error = "Invalid username or password" }, statusCode: 401);
    }

    string token = authSvc.GenerateJwtToken(user);
    return Results.Ok(new
    {
        success = true,
        token,
        user = new { id = user.Id, username = user.Username, email = user.Email, role = user.Role }
    });
});

app.MapGet("/api/auth/me", async (HttpContext ctx, AuthService authSvc, AppDbContext db) =>
{
    // Auto-login as desktop_local for standalone desktop mode
    if (!isHeadless)
    {
        var localUser = await db.Users.FirstOrDefaultAsync(u => u.Username == "desktop_local");
        if (localUser != null)
        {
            string token = authSvc.GenerateJwtToken(localUser);
            return Results.Ok(new
            {
                success = true,
                isWebMode = false,
                token,
                user = new { id = localUser.Id, username = localUser.Username, email = localUser.Email, role = localUser.Role }
            });
        }
    }

    var userIdClaim = ctx.User.FindFirst(ClaimTypes.NameIdentifier);
    if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
    {
        return Results.Ok(new { success = false, isWebMode = true });
    }

    var user = await db.Users.FindAsync(userId);
    if (user == null) return Results.Ok(new { success = false, isWebMode = true });

    return Results.Ok(new
    {
        success = true,
        isWebMode = true,
        user = new { id = user.Id, username = user.Username, email = user.Email, role = user.Role }
    });
});

app.MapPost("/api/auth/users", async (HttpContext ctx, AuthService authSvc) =>
{
    var roleClaim = ctx.User.FindFirst(ClaimTypes.Role)?.Value;
    if (roleClaim != "Admin") return Results.Forbid();

    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync();
    var doc = System.Text.Json.JsonDocument.Parse(body);
    string username = doc.RootElement.GetProperty("username").GetString() ?? "";
    string email = doc.RootElement.GetProperty("email").GetString() ?? "";
    string password = doc.RootElement.GetProperty("password").GetString() ?? "";
    string role = doc.RootElement.TryGetProperty("role", out var r) ? r.GetString() ?? "User" : "User";

    try
    {
        var newUser = await authSvc.CreateUserAsync(username, email, password, role);
        return Results.Ok(new { success = true, user = new { id = newUser!.Id, username = newUser.Username, email = newUser.Email, role = newUser.Role } });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
}).RequireAuthorization();

app.MapGet("/api/auth/users", async (AppDbContext db) =>
{
    var users = await db.Users
        .Select(u => new { id = u.Id, username = u.Username, email = u.Email, role = u.Role })
        .ToListAsync();
    return Results.Ok(new { success = true, users });
}).RequireAuthorization();

// ----------------------------------------------------
// SERVER PROJECT PERSISTENCE & SHARING ENDPOINTS
// ----------------------------------------------------

static int GetUserId(HttpContext ctx)
{
    var claim = ctx.User.FindFirst(ClaimTypes.NameIdentifier);
    return claim != null && int.TryParse(claim.Value, out int id) ? id : 0;
}

app.MapGet("/api/projects", async (HttpContext ctx, ProjectService projSvc) =>
{
    int userId = GetUserId(ctx);
    var result = await projSvc.GetUserProjectsAsync(userId);
    return Results.Ok(new { success = true, data = result });
}).RequireAuthorization();

app.MapPost("/api/projects", async (HttpContext ctx, ProjectService projSvc) =>
{
    int userId = GetUserId(ctx);

    // 1. Client-side compressed GZIP multipart upload (Ultra-fast)
    if (ctx.Request.HasFormContentType)
    {
        var form = await ctx.Request.ReadFormAsync();
        string? projectId = form["id"].FirstOrDefault();
        string title = form["title"].FirstOrDefault() ?? "Untitled Project";
        string? description = form["description"].FirstOrDefault();
        var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();

        if (file != null)
        {
            using var fileStream = file.OpenReadStream();
            var project = await projSvc.SaveProjectCompressedStreamAsync(userId, projectId, title, description, fileStream);
            return Results.Ok(new { success = true, project = new { id = project.Id, title = project.Title } });
        }
    }

    // 2. Fallback for uncompressed JSON payload (Backwards compatibility)
    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync();
    var doc = System.Text.Json.JsonDocument.Parse(body);
    
    string? projId = doc.RootElement.TryGetProperty("id", out var idP) ? idP.GetString() : null;
    string projTitle = doc.RootElement.GetProperty("title").GetString() ?? "Untitled Project";
    string? projDesc = doc.RootElement.TryGetProperty("description", out var dP) ? dP.GetString() : null;
    string payloadJson = doc.RootElement.GetProperty("payload").GetRawText();

    var savedProject = await projSvc.SaveProjectAsync(userId, projId, projTitle, projDesc, payloadJson);
    return Results.Ok(new { success = true, project = new { id = savedProject.Id, title = savedProject.Title } });
}).RequireAuthorization();

app.MapGet("/api/projects/{id}", async (string id, HttpContext ctx, ProjectService projSvc) =>
{
    int userId = GetUserId(ctx);
    try
    {
        string payload = await projSvc.LoadProjectPayloadAsync(userId, id);
        return Results.Content(payload, "application/json");
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
}).RequireAuthorization();

app.MapDelete("/api/projects/{id}", async (string id, HttpContext ctx, ProjectService projSvc) =>
{
    int userId = GetUserId(ctx);
    try
    {
        await projSvc.DeleteProjectAsync(userId, id);
        return Results.Ok(new { success = true });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
}).RequireAuthorization();

app.MapPost("/api/projects/{id}/share", async (string id, HttpContext ctx, ProjectService projSvc) =>
{
    int userId = GetUserId(ctx);
    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync();
    var doc = System.Text.Json.JsonDocument.Parse(body);

    string target = doc.RootElement.GetProperty("target").GetString() ?? "";
    string permission = doc.RootElement.TryGetProperty("permission", out var pP) ? pP.GetString() ?? "Read" : "Read";

    try
    {
        await projSvc.ShareProjectAsync(userId, id, target, permission);
        return Results.Ok(new { success = true });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
}).RequireAuthorization();

// LLM Analysis Endpoint
app.MapPost("/api/llm/analyze", async (HttpContext ctx, LlmService llmSvc) =>
{
    try
    {
        using var reader = new StreamReader(ctx.Request.Body);
        var body = await reader.ReadToEndAsync();
        using var doc = JsonDocument.Parse(body);
        
        string systemPrompt = doc.RootElement.TryGetProperty("systemPrompt", out var spProp) ? spProp.GetString() ?? "" : "";
        string userPrompt = doc.RootElement.TryGetProperty("userPrompt", out var upProp) ? upProp.GetString() ?? "" : "";
        string? apiKey = doc.RootElement.TryGetProperty("apiKey", out var keyProp) ? keyProp.GetString() : null;
        string? baseUrl = doc.RootElement.TryGetProperty("baseUrl", out var urlProp) ? urlProp.GetString() : null;
        string? model = doc.RootElement.TryGetProperty("model", out var mProp) ? mProp.GetString() : null;

        // Also check custom headers if passed
        if (string.IsNullOrEmpty(apiKey) && ctx.Request.Headers.TryGetValue("X-LLM-API-KEY", out var hKey)) apiKey = hKey.ToString();
        if (string.IsNullOrEmpty(baseUrl) && ctx.Request.Headers.TryGetValue("X-LLM-BASE-URL", out var hUrl)) baseUrl = hUrl.ToString();
        if (string.IsNullOrEmpty(model) && ctx.Request.Headers.TryGetValue("X-LLM-MODEL", out var hModel)) model = hModel.ToString();

        List<LlmChatMessage>? history = null;
        if (doc.RootElement.TryGetProperty("history", out var histProp) && histProp.ValueKind == JsonValueKind.Array)
        {
            history = new List<LlmChatMessage>();
            foreach (var item in histProp.EnumerateArray())
            {
                var role = item.TryGetProperty("role", out var rProp) ? rProp.GetString() ?? "user" : "user";
                var content = item.TryGetProperty("content", out var cProp) ? cProp.GetString() ?? "" : "";
                if (!string.IsNullOrWhiteSpace(content))
                {
                    history.Add(new LlmChatMessage { Role = role, Content = content });
                }
            }
        }

        var response = await llmSvc.AnalyzeAsync(systemPrompt, userPrompt, history, apiKey, baseUrl, model);
        return Results.Ok(new { success = true, response });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
});

// LLM Test Connection Endpoint
app.MapPost("/api/llm/test", async (HttpContext ctx, LlmService llmSvc) =>
{
    try
    {
        using var reader = new StreamReader(ctx.Request.Body);
        var body = await reader.ReadToEndAsync();
        string? apiKey = null, baseUrl = null, model = null;
        if (!string.IsNullOrWhiteSpace(body))
        {
            using var doc = JsonDocument.Parse(body);
            apiKey = doc.RootElement.TryGetProperty("apiKey", out var k) ? k.GetString() : null;
            baseUrl = doc.RootElement.TryGetProperty("baseUrl", out var u) ? u.GetString() : null;
            model = doc.RootElement.TryGetProperty("model", out var m) ? m.GetString() : null;
        }

        var result = await llmSvc.TestConnectionAsync(apiKey, baseUrl, model);
        return Results.Ok(new { success = result.success, message = result.message, model = result.model });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, message = ex.Message });
    }
});

// Robust engine directory resolver
static string GetEngineDirectory()
{
    string? dir = AppDomain.CurrentDomain.BaseDirectory;
    while (!string.IsNullOrEmpty(dir))
    {
        var candidate = Path.Combine(dir, "engine");
        if (Directory.Exists(candidate))
        {
            return candidate;
        }
        dir = Path.GetDirectoryName(dir);
    }
    return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "engine");
}

// MCP & Agent Gateway Endpoints
app.MapGet("/api/mcp/config", (HttpRequest req) =>
{
    string target = req.Query["target"].FirstOrDefault() ?? "claude";
    string engineDir = GetEngineDirectory();
    string pythonExe = PythonUtils.GetPythonExecutablePath(engineDir);
    string cliPath = Path.Combine(engineDir, "cli_mcp.py");

    object configObj;
    if (target.ToLower() == "picoclaw")
    {
        configObj = new
        {
            name = "knomap-engine",
            transport = "stdio",
            command = pythonExe,
            args = new[] { cliPath, "--stdio" },
            description = "knoMap Scientometrics & Topological Neural Mapping Engine"
        };
    }
    else if (target.ToLower() == "antigravity" || target.ToLower() == "cursor")
    {
        configObj = new
        {
            mcpServers = new Dictionary<string, object>
            {
                ["knomap-engine"] = new
                {
                    command = pythonExe,
                    args = new[] { cliPath, "--stdio" }
                }
            }
        };
    }
    else
    {
        configObj = new
        {
            mcpServers = new Dictionary<string, object>
            {
                ["knomap"] = new
                {
                    command = pythonExe,
                    args = new[] { cliPath, "--stdio" },
                    env = new Dictionary<string, string>
                    {
                        ["PYTHONPATH"] = engineDir
                    }
                }
            }
        };
    }

    return Results.Ok(new
    {
        success = true,
        target,
        config = configObj,
        tools = new[]
        {
            new { name = "knomap_get_active_project_manifest", description = "Global manifest of loaded modules and active dataset." },
            new { name = "knomap_list_incites_entities", description = "Lists InCites entities (Locations, Organizations, Research Areas, Authors)." },
            new { name = "knomap_query_incites_entity", description = "Queries records & metrics (CNCI, Times Cited, Documents, Top 10%, Collab) for any InCites entity." },
            new { name = "knomap_get_som_state", description = "Inspects active SOM neural map topology, U-Matrix, clusters, and UMAP." },
            new { name = "knomap_get_bibliometrics_state", description = "Inspects active co-occurrence networks and term statistics." },
            new { name = "knomap_get_dim_reduction_state", description = "Inspects intrinsic dimensionality (skdim MLE) and reduced coordinates." },
            new { name = "knomap_inspect_dataset", description = "Inspects format, size, columns of any bibliometrics file." },
            new { name = "knomap_parse_file", description = "Parses WoS, Scopus, InCites, PubMed, RIS, CSV into co-occurrence matrix." },
            new { name = "knomap_parse_incites", description = "Extracts InCites ZIP sessions and benchmarking units." },
            new { name = "knomap_suggest_som_size", description = "Recommends Big/Small SOM grid size via SVD/PCA." },
            new { name = "knomap_train_som", description = "Trains Kohonen SOM neural map with U-Matrix, UMAP, and clustering." },
            new { name = "knomap_render_visual_artifact", description = "Generates self-contained interactive HTML5/SVG map artifacts." },
            new { name = "knomap_estimate_intrinsic_dimension", description = "Estimates intrinsic dimensionality via skdim (MLE)." },
            new { name = "knomap_save_project", description = "Persists projects to .knomap file and SQLite zero-config hub." },
            new { name = "knomap_get_project", description = "Retrieves stored projects from SQLite or disk." }
        }
    });
});

// Autonomous Agent Chat Endpoint (PicoClaw / Native Agent Loop)
app.MapPost("/api/agent/chat", async (HttpContext ctx) =>
{
    try
    {
        using var reader = new StreamReader(ctx.Request.Body);
        var body = await reader.ReadToEndAsync();
        string userPrompt = "";
        string? apiKey = null, baseUrl = null, model = null;
        string? projectContextJson = null;

        if (!string.IsNullOrWhiteSpace(body))
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("prompt", out var p)) userPrompt = p.GetString() ?? "";
            if (doc.RootElement.TryGetProperty("apiKey", out var k)) apiKey = k.GetString();
            if (doc.RootElement.TryGetProperty("baseUrl", out var u)) baseUrl = u.GetString();
            if (doc.RootElement.TryGetProperty("model", out var m)) model = m.GetString();
            if (doc.RootElement.TryGetProperty("projectContext", out var pc)) projectContextJson = pc.GetRawText();
        }

        if (string.IsNullOrWhiteSpace(userPrompt))
        {
            return Results.BadRequest(new { success = false, error = "Prompt is required." });
        }

        string engineDir = GetEngineDirectory();
        string bridgeScript = Path.Combine(engineDir, "agent_bridge.py");
        string pythonExe = PythonUtils.GetPythonExecutablePath(engineDir);

        string tempCtxPath = "";
        if (!string.IsNullOrEmpty(projectContextJson))
        {
            string tempDir = Path.Combine(engineDir, "temp");
            if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);
            tempCtxPath = Path.Combine(tempDir, $"agent_ctx_{Guid.NewGuid():N}.json");
            await File.WriteAllTextAsync(tempCtxPath, projectContextJson);
        }

        var psi = new ProcessStartInfo
        {
            FileName = pythonExe,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add(bridgeScript);
        psi.ArgumentList.Add(userPrompt);
        if (!string.IsNullOrEmpty(tempCtxPath))
        {
            psi.ArgumentList.Add(tempCtxPath);
        }

        if (!string.IsNullOrWhiteSpace(apiKey)) 
            psi.EnvironmentVariables["LLM_API_KEY"] = apiKey;
        else if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LLM_API_KEY")))
            psi.EnvironmentVariables["LLM_API_KEY"] = Environment.GetEnvironmentVariable("LLM_API_KEY")!;

        if (!string.IsNullOrWhiteSpace(baseUrl)) 
            psi.EnvironmentVariables["LLM_BASE_URL"] = baseUrl;
        else if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LLM_BASE_URL")))
            psi.EnvironmentVariables["LLM_BASE_URL"] = Environment.GetEnvironmentVariable("LLM_BASE_URL")!;

        if (!string.IsNullOrWhiteSpace(model)) 
            psi.EnvironmentVariables["LLM_MODEL"] = model;
        else if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LLM_MODEL")))
            psi.EnvironmentVariables["LLM_MODEL"] = Environment.GetEnvironmentVariable("LLM_MODEL")!;

        psi.EnvironmentVariables["PYTHONPATH"] = engineDir;


        using var proc = new Process { StartInfo = psi };
        proc.Start();
        string stdout = await proc.StandardOutput.ReadToEndAsync();
        string stderr = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();

        if (!string.IsNullOrEmpty(tempCtxPath) && File.Exists(tempCtxPath))
        {
            try { File.Delete(tempCtxPath); } catch { }
        }


        if (proc.ExitCode == 0 && !string.IsNullOrWhiteSpace(stdout))
        {
            try
            {
                var parsedResponse = JsonDocument.Parse(stdout);
                return Results.Ok(parsedResponse.RootElement);
            }
            catch
            {
                return Results.Ok(new { success = true, reply = stdout, steps = Array.Empty<object>(), artifacts = Array.Empty<object>() });
            }
        }
        else
        {
            return Results.Ok(new { success = false, error = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr });
        }
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, error = ex.Message });
    }
});

app.MapGet("/api/health", () => Results.Ok(new { status = "Healthy", app = "newknoMap Local API" }));



// Fallback to index.html for Single Page Application (SPA) client-side routing
app.MapFallbackToFile("index.html");

// Start the ASP.NET Core web server in the background
await app.StartAsync();

// Retrieve the dynamically assigned local port
var server = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>();
var addressFeature = server.Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>();
var localUrl = addressFeature?.Addresses.FirstOrDefault() ?? "http://127.0.0.1:5000";

Console.WriteLine($"[Backend] API Server running at {localUrl}");


if (isHeadless)
{
    Console.WriteLine("[Backend] Running in headless mode. Press Ctrl+C to shut down.");
    Console.CancelKeyPress += (sender, eventArgs) =>
    {
        Console.WriteLine("[Backend] Shutting down server...");
        eventArgs.Cancel = true;
        _ = app.StopAsync(TimeSpan.FromSeconds(1));
        Environment.Exit(0);
    };
    await app.WaitForShutdownAsync();
}
else
{
    // Initialize Photino native desktop window on an STA thread (required for Windows UI)
    var windowThread = new System.Threading.Thread(() =>
    {
        string startUrl = localUrl.TrimEnd('/') + "/index.html";
        string userDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "knoMap", "WebViewData");
        if (!Directory.Exists(userDataDir))
        {
            Directory.CreateDirectory(userDataDir);
        }

        var window = new Photino.NET.PhotinoWindow()
            .SetTitle("knoMap")
            .SetUseOsDefaultLocation(false)
            .SetUseOsDefaultSize(false)
            .SetSize(1280, 800)
            .Center()
            .SetChromeless(true)
            .RegisterWebMessageReceivedHandler((object sender, string message) => {
                var w = (Photino.NET.PhotinoWindow)sender;
                if (message == "window:minimize") w.SetMinimized(true);
                if (message == "window:maximize") {
                    if (WindowDragger.IsZoomed(w.WindowHandle))
                        WindowDragger.ShowWindow(w.WindowHandle, WindowDragger.SW_RESTORE);
                    else
                        WindowDragger.ShowWindow(w.WindowHandle, WindowDragger.SW_MAXIMIZE);
                }
                if (message == "window:close") w.Close();
                if (message == "window:drag") {
                    WindowDragger.ReleaseCapture();
                    WindowDragger.DefWindowProc(w.WindowHandle, WindowDragger.WM_SYSCOMMAND, (UIntPtr)WindowDragger.MOUSE_MOVE, IntPtr.Zero);
                }
            })
            .Load(startUrl);

#if DEBUG
        window.SetDevToolsEnabled(true);
#else
        window.SetDevToolsEnabled(false);
#endif

        window.RegisterWindowCreatedHandler((object sender, EventArgs e) => 
        {
            if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows))
            {
                var w = (Photino.NET.PhotinoWindow)sender;
                var hWnd = w.WindowHandle;
                int style = WindowDragger.GetWindowLong(hWnd, WindowDragger.GWL_STYLE);
                style |= WindowDragger.WS_MINIMIZEBOX | WindowDragger.WS_MAXIMIZEBOX | WindowDragger.WS_THICKFRAME;
                WindowDragger.SetWindowLong(hWnd, WindowDragger.GWL_STYLE, style);

                int useImmersiveDarkMode = 1;
                WindowDragger.DwmSetWindowAttribute(hWnd, WindowDragger.DWMWA_USE_IMMERSIVE_DARK_MODE, ref useImmersiveDarkMode, sizeof(int));
            }
        });

        window.WaitForClose();
    });

    if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows))
    {
        windowThread.SetApartmentState(System.Threading.ApartmentState.STA);
    }
    
    windowThread.Start();
    windowThread.Join();

    // Forcefully stop the application and backend server when the window is closed
    // Avoid awaiting StopAsync indefinitely which can cause zombie processes
    _ = app.StopAsync(TimeSpan.FromSeconds(1));
    Environment.Exit(0);
}

public static class WindowDragger
{
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, UIntPtr wParam, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    public static extern bool IsZoomed(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public const uint WM_SYSCOMMAND = 0x0112;
    public const uint MOUSE_MOVE = 0xF012;
    public const int SW_MAXIMIZE = 3;
    public const int SW_RESTORE = 9;
    
    public const int GWL_STYLE = -16;
    public const int WS_MINIMIZEBOX = 0x00020000;
    public const int WS_MAXIMIZEBOX = 0x00010000;
    public const int WS_THICKFRAME = 0x00040000;
    
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
}
