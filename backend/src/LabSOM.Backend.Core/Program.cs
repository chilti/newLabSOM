using LabSOM.Backend.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddSingleton<HardwareDetectorService>();
builder.Services.AddSingleton<PreprocessService>();
builder.Services.AddSingleton<SOMEngineService>();

// Allow large matrices (e.g. for SOM Weights)
builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(options =>
{
    options.Limits.MaxRequestBodySize = int.MaxValue; 
});

// Enable CORS for local SPA frontends (Vite runs on localhost)
builder.Services.AddCors();

var app = builder.Build();

// Enable CORS
app.UseCors(policy => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod());

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

    var file = req.Form.Files[0];
    
    // Read parameters from form
    var request = new PreprocessRequest
    {
        Network_Type = req.Form["networkType"],
        Custom_Tag = req.Form["customTag"],
        Max_Terms = int.TryParse(req.Form["maxTerms"], out int mt) ? mt : 100,
        Min_Cooccurrence = int.TryParse(req.Form["minCooc"], out int mc) ? mc : 2,
        Only_Major_Mesh = bool.TryParse(req.Form["onlyMajor"], out bool om) ? om : false,
        Temporal = bool.TryParse(req.Form["temporal"], out bool temp) ? temp : false
    };

    var result = await preprocessor.PreprocessBibliometricsWithFileAsync(file, request);
    if (!result.Success)
    {
        return Results.Json(result, statusCode: 500);
    }
    return Results.Ok(result);
});

// 3. SOM and UMAP Training Endpoint
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

// Health check
app.MapGet("/api/health", () => Results.Ok(new { status = "Healthy", app = "newLabSOM Local API" }));

app.Run();
