"""Tool definitions for the LLM (Ollama function-calling format).

Curated subset of the most common AbletonMCP commands. Adding more is
just a matter of appending to TOOLS — the names map 1:1 to the
``command_type`` strings handled by the AbletonMCP Remote Script.
"""
from __future__ import annotations

TOOLS: list[dict] = [
    # --- Transport -----------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "start_playback",
            "description": "Start playback in Ableton Live.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stop_playback",
            "description": "Stop playback in Ableton Live.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_tempo",
            "description": "Set the song tempo (BPM).",
            "parameters": {
                "type": "object",
                "properties": {"tempo": {"type": "number", "description": "BPM, 20-999"}},
                "required": ["tempo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_metronome",
            "description": "Enable or disable the metronome.",
            "parameters": {
                "type": "object",
                "properties": {"enabled": {"type": "boolean"}},
                "required": ["enabled"],
            },
        },
    },
    # --- Recording -----------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "start_recording",
            "description": "Start recording (arrangement record).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stop_recording",
            "description": "Stop recording.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "toggle_session_record",
            "description": "Toggle session record button.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_midi",
            "description": "Capture recently played MIDI into a clip.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # --- Tracks --------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "create_midi_track",
            "description": "Create a new MIDI track at the given index (-1 = end).",
            "parameters": {
                "type": "object",
                "properties": {"index": {"type": "integer", "default": -1}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_audio_track",
            "description": "Create a new audio track at the given index (-1 = end).",
            "parameters": {
                "type": "object",
                "properties": {"index": {"type": "integer", "default": -1}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_volume",
            "description": "Set track volume in dB (e.g. -6, 0, +3).",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "volume_db": {"type": "number"},
                },
                "required": ["track_index", "volume_db"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_pan",
            "description": "Set track pan (-1.0 left, 0 center, +1.0 right).",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "pan": {"type": "number"},
                },
                "required": ["track_index", "pan"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_mute",
            "description": "Mute or unmute a track.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "muted": {"type": "boolean"},
                },
                "required": ["track_index", "muted"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_solo",
            "description": "Solo or unsolo a track.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "soloed": {"type": "boolean"},
                },
                "required": ["track_index", "soloed"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_track_arm",
            "description": "Arm or disarm a track for recording.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "armed": {"type": "boolean"},
                },
                "required": ["track_index", "armed"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_track",
            "description": "Select the given track (by index).",
            "parameters": {
                "type": "object",
                "properties": {"track_index": {"type": "integer"}},
                "required": ["track_index"],
            },
        },
    },
    # --- Clips ---------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "fire_clip",
            "description": "Fire (launch) a clip in the session view.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "clip_index": {"type": "integer"},
                },
                "required": ["track_index", "clip_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stop_clip",
            "description": "Stop a clip in the session view.",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_index": {"type": "integer"},
                    "clip_index": {"type": "integer"},
                },
                "required": ["track_index", "clip_index"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fire_scene",
            "description": "Fire (launch) an entire scene.",
            "parameters": {
                "type": "object",
                "properties": {"scene_index": {"type": "integer"}},
                "required": ["scene_index"],
            },
        },
    },
    # --- Arrangement ---------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "set_arrangement_loop",
            "description": "Set the arrangement loop region in beats.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "enabled": {"type": "boolean", "default": True},
                },
                "required": ["start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "jump_to_time",
            "description": "Jump the playhead to the given time (in beats).",
            "parameters": {
                "type": "object",
                "properties": {"time": {"type": "number"}},
                "required": ["time"],
            },
        },
    },
    # --- Inspection ----------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "get_session_info",
            "description": "Read the current Live set: tracks, tempo, etc. Use this when the user refers to a track by name instead of index.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def db_to_live(db: float) -> float:
    """Convert dB (-inf..+6) to Live's internal mixer 0..1 scale.

    Uses Ableton's published mapping (0 dB == 0.85, -inf == 0).
    """
    import math
    if db <= -70:
        return 0.0
    # Ableton mixer curve approximation
    return min(1.0, max(0.0, 10 ** ((db - 6) / 30) * (10 ** (6 / 30))))


# Map LLM tool name → (AbletonMCP command_type, param-translator)
def _track_volume(args: dict) -> tuple[str, dict]:
    return "set_track_volume", {
        "track_index": int(args["track_index"]),
        "volume": db_to_live(float(args["volume_db"])),
    }


COMMAND_MAP: dict[str, callable] = {
    "start_playback":         lambda a: ("start_playback", {}),
    "stop_playback":          lambda a: ("stop_playback", {}),
    "set_tempo":              lambda a: ("set_tempo", {"tempo": float(a["tempo"])}),
    "set_metronome":          lambda a: ("set_metronome", {"enabled": bool(a["enabled"])}),
    "start_recording":        lambda a: ("start_recording", {}),
    "stop_recording":         lambda a: ("stop_recording", {}),
    "toggle_session_record":  lambda a: ("toggle_session_record", {}),
    "capture_midi":           lambda a: ("capture_midi", {}),
    "create_midi_track":      lambda a: ("create_midi_track", {"index": int(a.get("index", -1))}),
    "create_audio_track":     lambda a: ("create_audio_track", {"index": int(a.get("index", -1))}),
    "set_track_volume":       _track_volume,
    "set_track_pan":          lambda a: ("set_track_pan",  {"track_index": int(a["track_index"]), "pan": float(a["pan"])}),
    "set_track_mute":         lambda a: ("set_track_mute", {"track_index": int(a["track_index"]), "mute":  bool(a["muted"])}),
    "set_track_solo":         lambda a: ("set_track_solo", {"track_index": int(a["track_index"]), "solo":  bool(a["soloed"])}),
    "set_track_arm":          lambda a: ("set_track_arm",  {"track_index": int(a["track_index"]), "arm":   bool(a["armed"])}),
    "select_track":           lambda a: ("select_track",   {"track_index": int(a["track_index"])}),
    "fire_clip":              lambda a: ("fire_clip",  {"track_index": int(a["track_index"]), "clip_index": int(a["clip_index"])}),
    "stop_clip":              lambda a: ("stop_clip",  {"track_index": int(a["track_index"]), "clip_index": int(a["clip_index"])}),
    "fire_scene":             lambda a: ("fire_scene", {"scene_index": int(a["scene_index"])}),
    "set_arrangement_loop":   lambda a: ("set_arrangement_loop", {
        "start": float(a["start"]),
        "end":   float(a["end"]),
        "enabled": bool(a.get("enabled", True)),
    }),
    "jump_to_time":           lambda a: ("jump_to_time", {"time": float(a["time"])}),
    "get_session_info":       lambda a: ("get_session_info", {}),
}
