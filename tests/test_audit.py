from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from stx_agent.audit import audit_workspace
from stx_agent.config import AppConfig, load_config
from stx_agent.workspace import Workspace


class SecurityAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspace"
        self.root.mkdir()
        self.workspace = Workspace(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_audit_uses_safe_defaults_and_does_not_create_files(self) -> None:
        config_path = self.root / "stx.config.toml"
        config = load_config(config_path)
        report = audit_workspace(self.workspace, config, config_path=config_path)
        ids = {finding.check_id for finding in report.findings}
        self.assertIn("config.not_found", ids)
        self.assertIn("model.no_profiles", ids)
        self.assertFalse((self.root / ".stx").exists())
        self.assertFalse(config_path.exists())
        self.assertFalse(report.has_critical)

    def test_sensitive_reads_and_remote_cleartext_have_stable_findings(self) -> None:
        config_path = self.root / "stx.config.toml"
        config_path.write_text(
            '[agent]\nautonomy = "autonomous"\n'
            '[providers.remote]\nkind = "openai_compatible"\n'
            'base_url = "http://model.example/v1"\n'
            'api_key_env = "STX_AUDIT_TEST_KEY"\n'
            'require_api_key = true\nallow_insecure_http = true\n'
            '[models.default]\nprovider = "remote"\nmodel = "model"\n'
            '[permissions]\n"filesystem.read_sensitive" = "allow"\n',
            encoding="utf-8",
        )
        config = load_config(config_path)
        report = audit_workspace(self.workspace, config, config_path=config_path)
        ids = {finding.check_id for finding in report.findings}
        self.assertIn("policy.sensitive_reads_allowed", ids)
        self.assertIn("provider.cleartext_remote_http.remote", ids)
        self.assertTrue(report.has_critical)
        serialized = str(report.as_dict())
        self.assertNotIn("STX_AUDIT_TEST_KEY", serialized)
        self.assertNotIn("api_key_env", serialized)

    def test_wildcard_and_long_retention_are_warnings_but_not_critical(self) -> None:
        config_path = self.root / "stx.config.toml"
        config_path.write_text(
            '[network]\nenabled = true\nallowed_hosts = ["*.docs.example.com"]\n'
            '[tasks]\nretention_days = 730\n'
            '[permissions]\n"network.fetch" = "confirm"\n',
            encoding="utf-8",
        )
        report = audit_workspace(self.workspace, load_config(config_path), config_path=config_path)
        ids = {finding.check_id for finding in report.findings}
        self.assertIn("network.wildcard_allowlist", ids)
        self.assertIn("data.task_retention_long", ids)
        self.assertTrue(report.has_warnings)
        self.assertFalse(report.has_critical)
        self.assertEqual(report.as_dict()["schema_version"], 1)

    @unittest.skipIf(os.name == "nt", "POSIX mode-bit assertions do not model NTFS ACLs")
    def test_audit_flags_broad_data_directory_and_database_permissions(self) -> None:
        data = self.root / ".stx"
        data.mkdir()
        database = data / "tasks.sqlite3"
        database.write_bytes(b"test-only")
        os.chmod(data, 0o755)
        os.chmod(database, 0o644)
        report = audit_workspace(self.workspace, AppConfig())
        ids = {finding.check_id for finding in report.findings}
        self.assertIn("storage.permissions_broad.data_directory", ids)
        self.assertIn("storage.permissions_broad.database_tasks", ids)

    def test_report_is_deterministically_sorted_and_machine_readable(self) -> None:
        config_path = self.root / "stx.config.toml"
        config_path.write_text(
            '[agent]\nautonomy = "autonomous"\n'
            '[network]\nenabled = true\nallowed_hosts = ["*.example.org"]\n'
            '[permissions]\n"terminal.execute" = "allow"\n',
            encoding="utf-8",
        )
        report = audit_workspace(self.workspace, load_config(config_path), config_path=config_path)
        ordering = {"critical": 0, "warning": 1, "info": 2}
        keys = [(ordering[finding.severity], finding.check_id) for finding in report.findings]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(set(report.as_dict()), {"schema_version", "summary", "findings"})


if __name__ == "__main__":
    unittest.main()
