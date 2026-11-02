"""Security headers for every response.

The demo is served at nandaindex.org/demo: the same origin as the web app, whose
session token lives in that origin's localStorage. Caddy routes /demo before
Next, so Next's headers never reach it, and the demo has to send its own.

The page's one inline script and one inline style are admitted by hash, not by
``'unsafe-inline'``: a hash admits exactly the page that shipped, and nothing a
third party's catalog manages to inject into it. The hashes are computed from
the file at startup, so editing the page cannot leave a stale hash behind.
"""

from __future__ import annotations

import base64
import hashlib
import re

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

__all__ = ["SecurityHeaders", "content_security_policy"]

#: Where the page's fonts come from. The stylesheet is Google's; the files are
#: served from a second host.
FONT_STYLESHEETS = "https://fonts.googleapis.com"
FONT_FILES = "https://fonts.gstatic.com"

_SCRIPT = re.compile(r"<script>(.*?)</script>", re.S)
_STYLE = re.compile(r"<style>(.*?)</style>", re.S)


def _hashes(pattern: re.Pattern[str], html: str) -> list[str]:
    return [
        "'sha256-" + base64.b64encode(hashlib.sha256(block.encode("utf-8")).digest()).decode() + "'"
        for block in pattern.findall(html)
    ]


def content_security_policy(html: str) -> str:
    """The policy for ``html``: its own inline blocks by hash, nothing else inline."""
    directives = [
        "default-src 'self'",
        " ".join(["script-src 'self'", *_hashes(_SCRIPT, html)]),
        " ".join(["style-src 'self'", *_hashes(_STYLE, html), FONT_STYLESHEETS]),
        f"font-src {FONT_FILES}",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ]
    return "; ".join(directives)


class SecurityHeaders:
    """Pure ASGI, so a streamed response (the run's event stream) is not buffered."""

    def __init__(self, app: ASGIApp, *, csp: str) -> None:
        self.app = app
        self.headers = {
            "Content-Security-Policy": csp,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers.items():
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)
