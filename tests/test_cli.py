from __future__ import annotations

import contextlib
import io
from pathlib import Path
import tempfile
import unittest

from stx_agent.cli import main


class CLITests(unittest.TestCase):
    def test_inspect_runs_without_model_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "README.md").write_text("hello", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["inspect", "--workspace", temp])
        self.assertEqual(code, 0)
        self.assertIn("README.md", output.getvalue())

    def test_init_creates_starter_config_and_preserves_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["init", "--workspace", temp])
            self.assertEqual(code, 0)
            config = Path(temp) / "stx.config.toml"
            before = config.read_text(encoding="utf-8")
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                code = main(["init", "--workspace", temp])
            self.assertEqual(code, 2)
            self.assertEqual(config.read_text(encoding="utf-8"), before)
            self.assertIn("already exists", errors.getvalue())

    def test_index_and_search_commands_run_without_model_configuration(self) -> None:
        import json
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "checkout.py").write_text("def checkout_order():\n    return True\n", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["index", "--workspace", temp])
            self.assertEqual(code, 0)
            self.assertGreaterEqual(json.loads(output.getvalue())["indexed"], 1)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["search", "checkout", "--workspace", temp])
            self.assertEqual(code, 0)
            results = json.loads(output.getvalue())["results"]
            self.assertTrue(any(item["path"] == "checkout.py" for item in results))

    def test_audit_json_is_read_only_and_reports_missing_configuration(self) -> None:
        import json
        with tempfile.TemporaryDirectory() as temp:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["audit", "--workspace", temp, "--json"])
            report = json.loads(output.getvalue())
            self.assertEqual(code, 0)
            self.assertIn("config.not_found", {item["check_id"] for item in report["findings"]})
            self.assertFalse((Path(temp) / ".stx").exists())
            self.assertFalse((Path(temp) / "stx.config.toml").exists())

    def test_audit_strict_mode_fails_on_warnings(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "audit.toml"
            config.write_text(
                '[network]\nenabled = true\nallowed_hosts = ["*.docs.example.com"]\n',
                encoding="utf-8",
            )
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["audit", "--workspace", temp, "--config", str(config), "--strict"])
        self.assertEqual(code, 1)
        self.assertIn("network.wildcard_allowlist", output.getvalue())
        self.assertIn("Strict mode", output.getvalue())

    def test_audit_critical_finding_returns_nonzero_without_strict_mode(self) -> None:
        import json
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "audit.toml"
            config.write_text(
                '[agent]\nautonomy = "autonomous"\n'
                '[providers.remote]\nkind = "openai_compatible"\n'
                'base_url = "http://model.example/v1"\nallow_insecure_http = true\n'
                '[models.default]\nprovider = "remote"\nmodel = "test"\n'
                '[permissions]\n"filesystem.read_sensitive" = "allow"\n',
                encoding="utf-8",
            )
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = main(["audit", "--workspace", temp, "--config", str(config), "--json"])
        report = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertGreater(report["summary"]["critical"], 0)

    def test_run_without_models_fails_clearly_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                code = main(["run", "do something", "--workspace", temp])
        self.assertEqual(code, 2)
        self.assertIn("No model profiles", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
