using System;
using System.IO;
using System.Text.Json;
using System.Windows.Forms;
using Photino.NET;

namespace LabSOM.Desktop
{
    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Required for WinForms dialogs on the STA thread
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Title of the window
            string windowTitle = "Sinapsis Map - Multidimensional and Temporal Data Analysis";

            // Resolve absolute path to index.html robustly
            string indexPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot", "index.html");
            if (!File.Exists(indexPath))
            {
                // Walk up directories to find wwwroot robustly (in dev environment)
                string? dir = AppDomain.CurrentDomain.BaseDirectory;
                while (!string.IsNullOrEmpty(dir))
                {
                    var candidate = Path.Combine(dir, "wwwroot", "index.html");
                    if (File.Exists(candidate))
                    {
                        indexPath = candidate;
                        break;
                    }
                    var candidateSource = Path.Combine(dir, "backend", "src", "LabSOM.Desktop", "wwwroot", "index.html");
                    if (File.Exists(candidateSource))
                    {
                        indexPath = candidateSource;
                        break;
                    }
                    dir = Path.GetDirectoryName(dir);
                }
            }

            // Initialize Photino window
            PhotinoWindow? window = null;
            window = new PhotinoWindow()
                .SetTitle(windowTitle)
                .SetUseOsDefaultSize(false)
                .SetSize(1280, 800)
                // IPC: handle messages from JavaScript
                .RegisterWebMessageReceivedHandler((object sender, string message) =>
                {
                    var win = (PhotinoWindow)sender;
                    Console.WriteLine($"[Desktop IPC] Received message: {message}");
                    try
                    {
                        using var doc = JsonDocument.Parse(message);
                        var root = doc.RootElement;

                        if (root.TryGetProperty("action", out var actionEl) &&
                            actionEl.GetString() == "select-file")
                        {
                            Console.WriteLine("[Desktop IPC] Opening file dialog...");

                            // Open the native file dialog on the STA thread – appears ABOVE the Photino window
                            using var dlg = new OpenFileDialog
                            {
                                Title = "Select bibliography file",
                                Filter = "Bibliography files (*.txt;*.tsv;*.csv)|*.txt;*.tsv;*.csv|All files (*.*)|*.*",
                                CheckFileExists = true,
                                Multiselect = false
                            };

                            var result = dlg.ShowDialog();

                            string response;
                            bool success = result == DialogResult.OK && !string.IsNullOrEmpty(dlg.FileName);

                            response = JsonSerializer.Serialize(new
                            {
                                action = "file-selected",
                                success,
                                filepath = success ? dlg.FileName : null
                            });

                            Console.WriteLine($"[Desktop IPC] Sending response: {response}");

                            // Send via Photino's web-message mechanism.
                            // On WebView2 (Windows) this triggers window.external.receiveMessage(message)
                            // which the React app's handler intercepts.
                            win.SendWebMessage(response);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[Desktop IPC] Error: {ex.Message}");
                    }
                })
                // Point Photino to load index.html from our dynamically resolved absolute path
                .Load(indexPath);

            // Allow dragging window and open developer tools in debug mode
#if DEBUG
            window.SetDevToolsEnabled(true);
#else
            window.SetDevToolsEnabled(false);
#endif

            // Run the desktop window loop
            window.WaitForClose();
        }
    }
}
