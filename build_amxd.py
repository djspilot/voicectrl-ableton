#!/usr/bin/env python3
"""Build a real Ableton Max-for-Live device (.amxd) for VoiceCtrl.

The .amxd container format (reverse-engineered, v8/v9 compatible):

    offset  bytes  meaning
    ------  -----  ----------------------------------------------------
       0    4     'ampf'                       magic
       4    4     0x00000004 (LE)              header size
       8    4     'aaaa'/'mmmm'/'iiii'         device type
      12    4     'meta'                       chunk id
      16    4     0x00000004 (LE)              meta size
      20    4     0x00000000                   meta data
      24    4     'ptch'                       chunk id
      28    4     <ptch size LE>               size of patcher json
      32   ...    UTF-8 patcher JSON

Run this script to (re)generate ``device/VoiceCtrl.amxd`` and copy it
into Ableton's User Library so it shows up in the browser.
"""
from __future__ import annotations

import json
import shutil
import struct
import sys
from urllib.parse import quote
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
DEVICE_DIR = ROOT / "device"
API_URL    = "http://127.0.0.1:8765"
UI_URL     = f"{(ROOT / 'web' / 'index.html').resolve().as_uri()}?embed=1&api={quote(API_URL, safe='')}&v=8"
DEVICE_TYPE = b"aaaa"   # audio effect (works on any track type)

USER_LIB_DST = (
    Path.home()
    / "Music" / "Ableton" / "User Library"
    / "Presets" / "Audio Effects" / "Max Audio Effect"
    / "VoiceCtrl.amxd"
)


def build_patcher() -> dict:
    """Construct the Max patcher JSON.

    A minimal M4L audio effect: ``plugin~`` → ``plugout~`` (audio passes
    through untouched) plus a ``jweb`` object showing our local web UI in
    presentation mode.
    """
    node_path = str(ROOT / "VoiceCtrl.js")
    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9, "minor": 0, "revision": 0,
                "architecture": "x64", "modernui": 1,
            },
            "classnamespace": "box",
            "rect":               [87.0, 120.0, 720.0, 420.0],
            "gridsize":           [15.0, 15.0],
            "openinpresentation": 1,
            "devicewidth":        320.0,
            "description":        "VoiceCtrl — local voice assistant for Ableton Live",
            "digest":             "Speak commands; whisper.cpp + Ollama drive Ableton via the AbletonMCP Remote Script.",
            "tags":               "voice,ai,assistant,whisper,ollama,mcp",
            "boxes": [
                # --- visible background + title in device view ---------------
                {
                    "box": {
                        "id": "obj-loadbang",
                        "maxclass": "newobj",
                        "text": "loadbang",
                        "patching_rect": [370.0, 20.0, 60.0, 22.0],
                        "numinlets": 1,
                        "numoutlets": 1,
                        "outlettype": ["bang"],
                    }
                },
                {
                    "box": {
                        "id": "obj-delay",
                        "maxclass": "newobj",
                        "text": "del 2500",
                        "patching_rect": [370.0, 48.0, 60.0, 22.0],
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": ["bang"],
                    }
                },
                {
                    "box": {
                        "id": "obj-start",
                        "maxclass": "message",
                        "text": "script start",
                        "patching_rect": [440.0, 20.0, 84.0, 22.0],
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": [""],
                    }
                },
                {
                    "box": {
                        "id": "obj-reload-web",
                        "maxclass": "message",
                        "text": f"url {UI_URL}",
                        "patching_rect": [440.0, 48.0, 150.0, 22.0],
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": [""],
                    }
                },
                {
                    "box": {
                        "id": "obj-node-print",
                        "maxclass": "newobj",
                        "text": "print VoiceCtrlNode",
                        "patching_rect": [370.0, 76.0, 115.0, 22.0],
                        "numinlets": 1,
                        "numoutlets": 0,
                    }
                },
                {
                    "box": {
                        "id": "obj-bg",
                        "maxclass": "panel",
                        "patching_rect": [20.0, 20.0, 320.0, 200.0],
                        "presentation": 1,
                        "presentation_rect": [0.0, 0.0, 320.0, 200.0],
                        "background": 1,
                        "ignoreclick": 1,
                        "mode": 0,
                        "numinlets": 1,
                        "numoutlets": 0,
                        "bgcolor": [0.16, 0.16, 0.16, 1.0],
                    }
                },
                {
                    "box": {
                        "id": "obj-title",
                        "maxclass": "comment",
                        "text": "VoiceCtrl  local Ableton assistant",
                        "patching_rect": [30.0, 24.0, 120.0, 20.0],
                        "presentation": 1,
                        "presentation_rect": [10.0, 5.0, 230.0, 18.0],
                        "fontsize": 12.0,
                        "fontname": "Arial Bold",
                        "textcolor": [0.91, 0.91, 0.91, 1.0],
                        "numinlets": 1,
                        "numoutlets": 0,
                    }
                },
                # --- audio passthrough so this is a valid M4L Audio Effect ----
                {
                    "box": {
                        "id": "obj-in",
                        "maxclass": "newobj",
                        "text": "plugin~",
                        "patching_rect": [20.0, 320.0, 50.0, 22.0],
                        "numinlets": 0, "numoutlets": 3,
                        "outlettype": ["signal", "signal", ""],
                    }
                },
                {
                    "box": {
                        "id": "obj-out",
                        "maxclass": "newobj",
                        "text": "plugout~",
                        "patching_rect": [20.0, 350.0, 60.0, 22.0],
                        "numinlets": 2, "numoutlets": 0,
                    }
                },
                # --- node helper: starts the local server automatically ------
                {
                    "box": {
                        "id": "obj-node",
                        "maxclass": "newobj",
                        "text": f'node.script "{node_path}" @autostart 1 @watch 1',
                        "patching_rect": [20.0, 280.0, 500.0, 22.0],
                        "numinlets": 1,
                        "numoutlets": 3,
                        "outlettype": ["", "bang", ""],
                    }
                },
                # --- the embedded web view (Melosurf-style) -------------------
                {
                    "box": {
                        "id": "obj-web",
                        "maxclass": "jweb",
                        "patching_rect": [24.0, 50.0, 312.0, 170.0],
                        "presentation": 1,
                        "presentation_rect": [4.0, 26.0, 312.0, 170.0],
                        "url": UI_URL,
                        "numinlets": 1,
                        "numoutlets": 2,
                        "outlettype": ["", ""],
                    }
                },
            ],
            "lines": [
                {"patchline": {
                    "source":      ["obj-in",  0],
                    "destination": ["obj-out", 0],
                }},
                {"patchline": {
                    "source":      ["obj-in",  1],
                    "destination": ["obj-out", 1],
                }},
                {"patchline": {
                    "source":      ["obj-loadbang", 0],
                    "destination": ["obj-start", 0],
                }},
                {"patchline": {
                    "source":      ["obj-loadbang", 0],
                    "destination": ["obj-delay", 0],
                }},
                {"patchline": {
                    "source":      ["obj-delay", 0],
                    "destination": ["obj-reload-web", 0],
                }},
                {"patchline": {
                    "source":      ["obj-reload-web", 0],
                    "destination": ["obj-web", 0],
                }},
                {"patchline": {
                    "source":      ["obj-start", 0],
                    "destination": ["obj-node", 0],
                }},
                {"patchline": {
                    "source":      ["obj-node", 0],
                    "destination": ["obj-node-print", 0],
                }},
            ],
            "styles": [],
            "dependency_cache": [
                {
                    "name": "VoiceCtrl.js",
                    "bootpath": str(ROOT),
                    "patcherrelativepath": ".",
                    "type": "TEXT",
                    "implicit": 1,
                },
                {
                    "name": "index.html",
                    "bootpath": str(ROOT / "web"),
                    "patcherrelativepath": "./web",
                    "type": "TEXT",
                    "implicit": 1,
                },
                {
                    "name": "icon.svg",
                    "bootpath": str(ROOT / "web"),
                    "patcherrelativepath": "./web",
                    "type": "TEXT",
                    "implicit": 1,
                },
                {
                    "name": "debug.html",
                    "bootpath": str(ROOT / "web"),
                    "patcherrelativepath": "./web",
                    "type": "TEXT",
                    "implicit": 1,
                },
            ],
            "autosave": 0,
            "oscreceiveudpport": 0,
        }
    }


def write_amxd(dst: Path, patcher: dict, device_type: bytes = DEVICE_TYPE) -> None:
    body = json.dumps(patcher, indent=1).encode("utf-8")
    header  = b"ampf" + struct.pack("<I", 4) + device_type
    header += b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00"
    header += b"ptch" + struct.pack("<I", len(body))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(header + body)


def main() -> None:
    out = DEVICE_DIR / "VoiceCtrl.amxd"
    patch = build_patcher()
    # Keep the editable .maxpat in sync with the packed .amxd.
    maxpat_path = DEVICE_DIR / "VoiceCtrl.maxpat"
    maxpat_path.write_text(json.dumps(patch, indent=2), encoding="utf-8")
    write_amxd(out, patch)
    print(f"✓ wrote {maxpat_path}")
    print(f"✓ wrote {out}  ({out.stat().st_size} bytes)")

    # also copy into Ableton's User Library so it shows in the browser
    USER_LIB_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out, USER_LIB_DST)
    print(f"✓ installed to {USER_LIB_DST}")
    print()
    print("In Ableton: browser → Categories → Max for Live → Max Audio Effect")
    print("(or User Library → Presets → Audio Effects → Max Audio Effect)")


if __name__ == "__main__":
    main()
