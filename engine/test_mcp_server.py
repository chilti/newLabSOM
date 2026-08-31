"""
Comprehensive Test Suite for knoMap MCP Server, Storage, and Visualizer.
"""

import os
import sys
import unittest
import tempfile
import json
import numpy as np

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_LIB = os.path.join(ENGINE_DIR, "lib")
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)
if ENGINE_LIB not in sys.path:
    sys.path.append(ENGINE_LIB)



import storage
import visualizer
import mcp_server

class TestKnomapMCPFramework(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_knomap_hub.db")

    def test_01_storage_sqlite_and_file(self):
        """Tests SQLite zero-config persistence and .knomap file export/import."""
        project_payload = {
            "name": "Biomedicine LATAM 2026",
            "metadata": {"source_format": "scopus_csv", "records": 500},
            "som_state": {
                "grid_size": [5, 5],
                "umatrix": [[0.1, 0.2], [0.3, 0.4]],
                "frequencies": [10, 20, 5, 12]
            },
            "clusters": {"labels": [0, 1, 0, 1]},
            "report_markdown": "# Informe de Frentes de Investigación"
        }

        # 1. Save to SQLite
        project_id = storage.save_project_to_db(project_payload, db_path=self.db_path)
        self.assertTrue(project_id.startswith("knomap-"))

        # 2. Retrieve from SQLite
        retrieved = storage.get_project_from_db(project_id, db_path=self.db_path)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["name"], "Biomedicine LATAM 2026")
        self.assertEqual(retrieved["metadata"]["records"], 500)

        # 3. List projects
        projects_list = storage.list_projects_from_db(db_path=self.db_path)
        self.assertEqual(len(projects_list), 1)
        self.assertEqual(projects_list[0]["id"], project_id)

        # 4. Export to .knomap file
        file_path = os.path.join(self.test_dir, "project.knomap")
        exported_path = storage.export_knomap_file(project_payload, file_path)
        self.assertTrue(os.path.exists(exported_path))

        # 5. Import from .knomap file
        imported = storage.import_knomap_file(file_path)
        self.assertEqual(imported["name"], "Biomedicine LATAM 2026")

    def test_02_visualizer_html_and_svg(self):
        """Tests interactive HTML5 and SVG artifact generation and deep links."""
        dummy_som = {
            "hex_grid": [
                {"index": 0, "row": 0, "col": 0, "x": 0.0, "y": 0.0},
                {"index": 1, "row": 0, "col": 1, "x": 1.5, "y": 0.866},
                {"index": 2, "row": 1, "col": 0, "x": 0.0, "y": 1.732},
                {"index": 3, "row": 1, "col": 1, "x": 1.5, "y": 2.598}
            ],
            "umatrix": [0.1, 0.4, 0.2, 0.8],
            "clustering": {"labels": [0, 0, 1, 1]},
            "frequencies": [5, 12, 3, 9],
            "mapped_labels": [
                ["crispr", "gene editing"],
                ["cas9", "knockout"],
                ["immunotherapy"],
                ["t-cells"]
            ]
        }

        # 1. Render Interactive HTML
        html_out = visualizer.render_interactive_html(dummy_som, title="Test Map")
        self.assertIn("<!DOCTYPE html>", html_out)
        self.assertIn("Test Map", html_out)
        self.assertIn("crispr", html_out)
        self.assertIn("U-Matrix", html_out)

        # 2. Render SVG
        svg_out = visualizer.render_svg_map(dummy_som)
        self.assertIn("<svg", svg_out)
        self.assertIn("<polygon", svg_out)

        # 3. Deep links
        links = visualizer.generate_deep_link("test-123", server_base_url="https://knomap.unam.mx")
        self.assertEqual(links["desktop_uri"], "knomap://open?project_id=test-123")
        self.assertEqual(links["web_url"], "https://knomap.unam.mx/project/test-123")

    def test_03_mcp_tools_execution(self):
        """Tests execution of analytical and topological MCP tools."""
        # 1. Detect hardware
        hw_res = mcp_server.knomap_detect_hardware()
        self.assertTrue(hw_res["success"])
        self.assertIn("hardware", hw_res)

        # 2. Synthetic data matrix (20 samples, 10 features)
        np.random.seed(42)
        dummy_matrix = np.random.uniform(0.0, 1.0, size=(20, 10)).tolist()

        # 3. Suggest SOM size
        size_res = mcp_server.knomap_suggest_som_size(dummy_matrix)
        self.assertTrue(size_res["success"])
        self.assertIn("bigSomWidth", size_res)
        self.assertIn("smallSomWidth", size_res)

        # 4. Train SOM
        train_res = mcp_server.knomap_train_som(
            data_matrix=dummy_matrix,
            rows=4,
            cols=4,
            iterations=50,
            method="batch",
            run_umap=True,
            labels=[f"doc_{i}" for i in range(20)]
        )
        self.assertTrue(train_res["success"])
        self.assertEqual(len(train_res["weights"]), 16)
        self.assertIn("umatrix", train_res)
        self.assertIn("hex_grid", train_res)
        self.assertIn("umap", train_res)

        # 5. Render visual artifact via MCP tool
        artifact_res = mcp_server.knomap_render_visual_artifact(
            som_state=train_res,
            title="Biomedical Science Map Test"
        )
        self.assertTrue(artifact_res["success"])
        self.assertIn("html_artifact", artifact_res)
        self.assertIn("svg_artifact", artifact_res)

        # 6. Save project via MCP
        save_res = mcp_server.knomap_save_project(
            name="Test Science Map Project",
            metadata={"corpus": "Synthetic", "samples": 20},
            som_state=train_res,
            report_markdown="## Resumen de Hallazgos"
        )
        self.assertTrue(save_res["success"])
        self.assertIsNotNone(save_res["project_id"])

        # 7. Retrieve project via MCP
        get_res = mcp_server.knomap_get_project(save_res["project_id"])
        self.assertTrue(get_res["success"])
        self.assertEqual(get_res["project"]["name"], "Test Science Map Project")

        # 8. Estimate intrinsic dimension
        dim_res = mcp_server.knomap_estimate_intrinsic_dimension(dummy_matrix, algorithm="mle")
        self.assertTrue(dim_res["success"])
        self.assertIn("intrinsic_dimension", dim_res)

if __name__ == "__main__":
    unittest.main()
