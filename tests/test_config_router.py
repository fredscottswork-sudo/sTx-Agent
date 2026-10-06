from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from stx_agent.config import load_config, write_default_config
from stx_agent.errors import ConfigError
from stx_agent.router import ModelRouter


class ConfigAndRouterTests(unittest.TestCase):
    def test_missing_config_returns_safe_unconfigured_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "missing.toml"
            config = load_config(path)
        self.assertEqual(config.autonomy, "assisted")
        self.assertEqual(config.profiles, {})
        self.assertFalse(config.logging.enabled)

    def test_default_config_is_created_but_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "stx.config.toml"
            write_default_config(path)
            original = path.read_text(encoding="utf-8")
            with self.assertRaises(ConfigError):
                write_default_config(path)
            self.assertEqual(path.read_text(encoding="utf-8"), original)
            config = load_config(path)
        self.assertIn("default", config.profiles)
        self.assertEqual(config.profiles["default"].provider, "openai")
        self.assertEqual(config.permissions["filesystem.read_sensitive"].value, "deny")

    def test_repository_example_configuration_loads(self) -> None:
        example = Path(__file__).parents[1] / "stx.config.example.toml"
        config = load_config(example)
        self.assertFalse(config.network.enabled)
        self.assertEqual(config.tasks.retention_days, 90)
        self.assertEqual(config.permissions["network.fetch"].value, "confirm")

    def test_config_rejects_unknown_permission_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.toml"
            path.write_text('[permissions]\n"terminal.execute" = "sometimes"\n', encoding="utf-8")
            with self.assertRaisesRegex(ConfigError, "allow, confirm, deny"):
                load_config(path)

    def test_config_rejects_missing_provider_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.toml"
            path.write_text('[models.default]\nprovider = "missing"\nmodel = "x"\n', encoding="utf-8")
            with self.assertRaisesRegex(ConfigError, "unknown provider"):
                load_config(path)

    def test_network_configuration_requires_safe_hostname_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.toml"
            path.write_text(
                '[network]\nenabled = true\nallowed_hosts = ["docs.example", "*.read.example"]\n',
                encoding="utf-8",
            )
            config = load_config(path)
            self.assertEqual(config.network.allowed_hosts, ("docs.example", "*.read.example"))
            self.assertTrue(config.network.enabled)
            path.write_text('[network]\nallowed_hosts = ["https://evil.example/path"]\n', encoding="utf-8")
            with self.assertRaises(ConfigError):
                load_config(path)

    def test_config_rejects_secrets_embedded_in_endpoint_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.toml"
            path.write_text(
                '[providers.test]\nbase_url = "https://user:secret@example.com/v1?token=x"\n'
                '[models.default]\nprovider = "test"\nmodel = "m"\n',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ConfigError, "without embedded credentials"):
                load_config(path)

    def test_router_uses_profiles_only_when_configured(self) -> None:
        config = load_config(None)
        with self.assertRaisesRegex(ConfigError, "No model profiles"):
            ModelRouter(config.profiles).select("Fix this bug")

        from stx_agent.config import ModelProfile
        profiles = {
            "default": ModelProfile("default", "p", "small"),
            "coding": ModelProfile("coding", "p", "code"),
            "reasoning": ModelProfile("reasoning", "p", "reason"),
            "fast": ModelProfile("fast", "p", "tiny"),
        }
        router = ModelRouter(profiles)
        self.assertEqual(router.select("Fix this failing test").profile.name, "coding")
        self.assertEqual(router.select("Design the system architecture").profile.name, "reasoning")
        self.assertEqual(router.select("Quickly summarize this file").profile.name, "fast")
        self.assertEqual(router.select("anything", "default").profile.model, "small")

    def test_router_falls_back_to_only_configured_profile(self) -> None:
        from stx_agent.config import ModelProfile
        profile = ModelProfile("only", "p", "model")
        route = ModelRouter({"only": profile}, "default").select("do something")
        self.assertEqual(route.profile, profile)
        self.assertIn("only configured", route.reason)


if __name__ == "__main__":
    unittest.main()
