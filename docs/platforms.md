# Platform notes

## Support status

STX targets Linux, Windows, and Termux/Android with Python 3.11+. The code avoids third-party runtime packages and uses the Python standard library. That is a portability design goal, not proof of identical behavior:

- **Linux:** current local development/test environment; ordinary unit and local HTTP integration tests run here.
- **Windows:** GitHub Actions is configured for Windows on Python 3.11 and 3.12. Check the branch's latest actual CI results; a workflow configuration alone is not a passing run.
- **Termux/Android:** target only. There is no Termux runner in GitHub Actions, and no real Android device was available in this work session. Run the smoke test below before relying on it.

The project has no hosted-model integration test and no live external website fetch in the normal suite.

## Linux

Install Python 3.11+ and Git from the distribution packages, then:

```sh
python3 -m pip install -e .
stx init
stx doctor
stx audit
PYTHONPATH=src python -m unittest discover -s tests -v
```

Export the provider key only in the invoking shell or a protected secret manager. If the endpoint is local, configure its OpenAI-compatible or native Anthropic base URL, model name, and key requirements in TOML. `stx audit` is read-only and does not contact providers; it cannot replace OS-level isolation or a security review.

## Windows (PowerShell)

Install Python 3.11+ and Git for Windows. From the repository:

```powershell
py -3.11 -m pip install -e .
stx init
$env:OPENAI_API_KEY = "..."  # process-scoped example; keep the value private
stx doctor
stx audit
py -3.11 -m unittest discover -s tests -v
```

Windows-specific limitations:

- `os.chmod` does not provide POSIX-style `0600` confidentiality. Use NTFS ACLs to restrict the workspace and `.stx/` directory to the intended Windows account. The local audit notes this limitation but does not inspect ACL entries.
- Current process cleanup can terminate the direct process but does not provide a Job Object/container boundary for every descendant process. A command that launches children is not safely isolated.
- Path, symlink/reparse-point, executable resolution, and Git behavior should be checked on the actual filesystem and Git installation.
- Network binding, firewall rules, and reverse-proxy TLS are configured by the host OS/operator, not STX.

## Termux / Android

Install Termux from a trusted distribution source, then:

```sh
pkg update
pkg install python git
python --version
python -m pip install -e .
stx init
stx doctor
stx audit
PYTHONPATH=src python -m unittest discover -s tests -v
```

Use Termux's private home/workspace where possible. Android shared-storage permissions and scoped storage can restrict symlinks, chmod behavior, execution, and file access. Keep the app alive during longer runs; Android may suspend or kill background work. `stx serve` is an HTTP server bound to loopback by default and is intended for the same device. Do not expose it through a tunnel or network bind without understanding the token/TLS setup.

### Minimum real-device smoke test

1. Record `python --version`, `git --version`, `stx doctor`, and `stx audit` output (redact paths/usernames if sharing).
2. Run `stx inspect --workspace <private Termux directory>`.
3. Run `stx index --workspace <small test project>` and `stx search <term> --workspace <small test project>`.
4. Run the unit suite; record any Android-specific skips/failures.
5. Start `stx serve --workspace <test project> --port 8765` and open `http://127.0.0.1:8765/` on-device. Do not submit a model task without a configured endpoint; dashboard approval/cancellation integration is exercised by the local test suite.
6. Do not report the platform as verified based only on successful installation or `doctor`/`audit` output.

## Running the dashboard

By default `stx serve` listens at `127.0.0.1:8765`. Only one task server can hold a workspace lock at a time. Remote binding requires an environment variable named `STX_API_TOKEN` with at least 24 ASCII characters, for example:

```sh
export STX_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
stx serve --host 0.0.0.0 --port 8765
```

The built-in server does **not** provide TLS. For remote use, restrict network access and put a trusted TLS-terminating reverse proxy in front; never send the bearer token over plain untrusted networks. Do not commit or paste the token. Static dashboard assets are served so the browser can show the token-entry screen; all API data and actions still require bearer authentication. Loopback mode does not require a token but is still a local control surface over workspace tasks and persisted results.

The control center has Overview, Tasks, Memory, Workspace index, Security audit, and read-only Agent settings pages. Memory and index operations honor their configured permissions; finished-history deletion is confirmation-gated. The settings view never returns API-key values and cannot edit TOML or install providers/plugins.
