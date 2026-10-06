"""Small HTTP transport helpers shared by native provider adapters."""

from __future__ import annotations

from urllib.request import HTTPRedirectHandler, Request, build_opener


class _RejectRedirects(HTTPRedirectHandler):
    """Provider credentials and prompts must not follow unreviewed redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(request: Request, *, timeout: float):
    """Open exactly the configured endpoint; redirects surface as HTTP errors."""
    return build_opener(_RejectRedirects()).open(request, timeout=timeout)
