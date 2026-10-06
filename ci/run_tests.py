"""Run unittest and publish concise GitHub Actions annotations on failures."""

from __future__ import annotations
import io
import os
from pathlib import Path
import sys
import unittest


def _escape_command(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main() -> int:
    suite = unittest.defaultTestLoader.discover("tests")
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    output = stream.getvalue()
    sys.stdout.write(output)
    sys.stdout.flush()
    if result.failures or result.errors:
        summaries = []
        for test, traceback in result.failures + result.errors:
            summaries.append(f"### {test}\n\n```text\n{traceback[-5000:]}\n```")
            title = _escape_command(str(test))
            details = _escape_command(traceback[-3500:])
            print(f"::error title=Unit test failure: {title}::{details}")
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_path:
            with Path(summary_path).open("a", encoding="utf-8") as handle:
                handle.write("\n\n".join(summaries) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
