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
from pathlib import Path

ROOT       = Path(__file__).resolve().parent
DEVICE_DIR = ROOT / "device"
URL        = "http://127.0.0.1:8765/"
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
    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 8, "minor": 1, "revision": 2,
                "architecture": "x64", "modernui": 1,
            },
            "classnamespace": "box",
            "rect":               [100.0, 100.0, 720.0, 380.0],
            "openrect":           [0.0, 0.0, 720.0, 380.0],
            "bglocked":           0,
            "openinpresentation": 1,
            "default_fontsize":   12.0,
            "default_fontface":   0,
            "default_fontname":   "Arial",
            "gridonopen":         1,
            "gridsize":           [15.0, 15.0],
            "gridsnaponopen":     1,
            "objectsnaponopen":   1,
            "statusbarvisible":   2,
            "toolbarvisible":     1,
            "lefttoolbarpinned":  0,
            "toptoolbarpinned":   0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned":0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj":         0,
            "boxanimatetime":     200,
            "enablehscroll":      1,
            "enablevscroll":      1,
            "devicewidth":        720.0,
            "description":        "VoiceCtrl — local voice assistant for Ableton Live",
            "digest":             "Speak commands; whisper.cpp + Ollama drive Ableton via the AbletonMCP Remote Script.",
            "tags":               "voice,ai,assistant,whisper,ollama,mcp",
            "boxes": [
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
                        "text": "node.script /Users/ds/Documents/Max for Live/VoiceCtrl/VoiceCtrl.js @autostart 1 @watch 1",
                        "patching_rect": [20.0, 280.0, 540.0, 22.0],
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
                        "patching_rect": [110.0, 20.0, 600.0, 250.0],
                        "presentation": 1,
                        "presentation_rect": [0.0, 0.0, 720.0, 320.0],
                        "url": URL,
                        "numinlets": 1,
                        "numoutlets": 2,
                        "outlettype": ["", ""],
                    }
                },
                # --- title strip in presentation ------------------------------
                {
                    "box": {
                        "id": "obj-title",
                        "maxclass": "comment",
                        "text": "VoiceCtrl — local voice → Ableton",
                        "patching_rect": [110.0, 5.0, 400.0, 18.0],
                        "presentation": 1,
                        "presentation_rect": [10.0, 322.0, 700.0, 18.0],
                        "fontface": 1,
                        "textcolor": [0.85, 0.85, 0.85, 1.0],
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
            ],
            "styles": [],
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
    write_amxd(out, build_patcher())
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
