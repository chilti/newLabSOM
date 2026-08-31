"""
Storage and Persistence Module for knoMap.
Supports:
1. Portable .knomap JSON session files (local storage/sharing).
2. Zero-config SQLite database (`knomap_hub.db`) for server projects and shared hubs.
"""

import os
import json
import sqlite3
import datetime
from typing import Dict, Any, Optional, List

DEFAULT_DB_PATH = os.environ.get("KNOMAP_DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "knomap_hub.db"))

def get_db_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Returns a SQLite connection configured with WAL mode and row factory."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

def init_db(db_path: str = DEFAULT_DB_PATH):
    """Initializes the SQLite schema for projects, sessions, and agent logs."""
    conn = get_db_connection(db_path)
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_file TEXT,
                source_format TEXT,
                is_public INTEGER DEFAULT 1,
                metadata_json TEXT,
                som_state_json TEXT,
                clusters_json TEXT,
                report_markdown TEXT
            );
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT,
                timestamp TEXT NOT NULL,
                agent_name TEXT,
                action TEXT,
                details_json TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
        """)
    conn.close()

def save_project_to_db(project_data: Dict[str, Any], db_path: str = DEFAULT_DB_PATH) -> str:
    """
    Saves or updates a project record in the SQLite database.
    Returns the project_id.
    """
    init_db(db_path)
    conn = get_db_connection(db_path)
    
    project_id = project_data.get("id")
    if not project_id:
        import uuid
        project_id = f"knomap-{uuid.uuid4().hex[:8]}"
        project_data["id"] = project_id

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    created_at = project_data.get("created_at", now_iso)
    name = project_data.get("name", "Untitled knoMap Project")
    source_file = project_data.get("source_file", "")
    source_format = project_data.get("source_format", "unknown")
    is_public = 1 if project_data.get("is_public", True) else 0
    
    metadata_json = json.dumps(project_data.get("metadata", {}))
    som_state_json = json.dumps(project_data.get("som_state", {}))
    clusters_json = json.dumps(project_data.get("clusters", {}))
    report_markdown = project_data.get("report_markdown", "")

    with conn:
        conn.execute("""
            INSERT INTO projects (
                id, name, created_at, updated_at, source_file, source_format,
                is_public, metadata_json, som_state_json, clusters_json, report_markdown
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                updated_at=excluded.updated_at,
                source_file=excluded.source_file,
                source_format=excluded.source_format,
                is_public=excluded.is_public,
                metadata_json=excluded.metadata_json,
                som_state_json=excluded.som_state_json,
                clusters_json=excluded.clusters_json,
                report_markdown=excluded.report_markdown;
        """, (
            project_id, name, created_at, now_iso, source_file, source_format,
            is_public, metadata_json, som_state_json, clusters_json, report_markdown
        ))
    conn.close()
    return project_id

def get_project_from_db(project_id: str, db_path: str = DEFAULT_DB_PATH) -> Optional[Dict[str, Any]]:
    """Retrieves a project from the SQLite database by ID."""
    init_db(db_path)
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "source_file": row["source_file"],
        "source_format": row["source_format"],
        "is_public": bool(row["is_public"]),
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "som_state": json.loads(row["som_state_json"] or "{}"),
        "clusters": json.loads(row["clusters_json"] or "{}"),
        "report_markdown": row["report_markdown"] or ""
    }

def list_projects_from_db(limit: int = 50, db_path: str = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    """Lists summary info of saved projects."""
    init_db(db_path)
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, created_at, updated_at, source_file, source_format, is_public
        FROM projects ORDER BY updated_at DESC LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]

def export_knomap_file(project_data: Dict[str, Any], file_path: str) -> str:
    """Exports a project dictionary to a portable .knomap JSON file."""
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(project_data, f, ensure_ascii=False, indent=2)
    return os.path.abspath(file_path)

def import_knomap_file(file_path: str) -> Dict[str, Any]:
    """Imports a project dictionary from a .knomap JSON file."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"knoMap session file not found: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)
