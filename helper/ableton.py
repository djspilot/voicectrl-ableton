"""TCP client for the AbletonMCP Remote Script (port 9877)."""
from __future__ import annotations

import json
import socket
from typing import Any

HOST = "127.0.0.1"
PORT = 9877
TIMEOUT = 10.0


class AbletonError(RuntimeError):
    pass


def send_command(cmd_type: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send a single JSON command to AbletonMCP and return the parsed response.

    Protocol (from AbletonMCP/__init__.py): a single JSON object per connection,
    response is a JSON object too. Connection is closed after one round-trip.
    """
    payload = {"type": cmd_type, "params": params or {}}
    raw = json.dumps(payload).encode("utf-8")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(TIMEOUT)
        s.connect((HOST, PORT))
        s.sendall(raw)

        # Read until JSON parses or socket closes
        buf = b""
        while True:
            chunk = s.recv(8192)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode("utf-8"))
            except ValueError:
                continue
    if not buf:
        raise AbletonError("empty response from AbletonMCP (is Live running with the AbletonMCP control surface enabled?)")
    raise AbletonError(f"could not parse response: {buf!r}")


def health_check() -> bool:
    try:
        r = send_command("health_check")
        return r.get("status") == "success"
    except Exception:
        return False
