"""
knoMap Universal MCP Command-Line Interface (CLI).
Enables running the MCP Server in stdio / SSE mode and exporting configuration for Claude Desktop, PicoClaw, and Antigravity.
"""

import sys
import os
import argparse
import json

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_LIB = os.path.join(ENGINE_DIR, "lib")
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)
if ENGINE_LIB not in sys.path:
    sys.path.append(ENGINE_LIB)



from mcp_server import mcp

def export_config(target: str):
    python_bin = sys.executable
    server_script = os.path.join(ENGINE_DIR, "cli_mcp.py")

    if target.lower() in ["claude", "claude_desktop"]:
        config = {
            "mcpServers": {
                "knomap": {
                    "command": python_bin,
                    "args": [server_script, "--stdio"],
                    "env": {
                        "PYTHONPATH": ENGINE_DIR
                    }
                }
            }
        }
        print(json.dumps(config, indent=2))
    elif target.lower() in ["picoclaw", "pico"]:
        config = {
            "name": "knomap-engine",
            "transport": "stdio",
            "command": python_bin,
            "args": [server_script, "--stdio"],
            "description": "knoMap Scientometrics & Topological Neural Mapping Engine"
        }
        print(json.dumps(config, indent=2))
    elif target.lower() in ["antigravity", "cursor", "vscode"]:
        config = {
            "mcpServers": {
                "knomap-engine": {
                    "command": python_bin,
                    "args": [server_script, "--stdio"]
                }
            }
        }
        print(json.dumps(config, indent=2))
    else:
        print(f"Unknown target '{target}'. Available options: claude, picoclaw, antigravity")

def main():
    parser = argparse.ArgumentParser(description="knoMap Universal MCP Server Runner & Config Exporter")
    parser.add_argument("--stdio", action="store_true", default=True, help="Run MCP Server over stdio transport (default)")
    parser.add_argument("--sse", action="store_true", help="Run MCP Server over HTTP/SSE transport")
    parser.add_argument("--port", type=int, default=5055, help="Port for SSE transport (default: 5055)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host for SSE transport (default: 0.0.0.0)")
    parser.add_argument("--export-config", type=str, choices=["claude", "picoclaw", "antigravity"], help="Export MCP configuration JSON for target agent")

    args = parser.parse_args()

    if args.export_config:
        export_config(args.export_config)
        return

    if args.sse:
        print(f"[*] Starting knoMap MCP Server on SSE http://{args.host}:{args.port}/sse", file=sys.stderr)
        mcp.run(transport="sse")
    else:
        # Default is stdio
        mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
