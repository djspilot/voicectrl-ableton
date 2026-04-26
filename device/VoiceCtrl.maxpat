{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 0,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      87.0,
      120.0,
      720.0,
      420.0
    ],
    "gridsize": [
      15.0,
      15.0
    ],
    "openinpresentation": 1,
    "devicewidth": 320.0,
    "description": "VoiceCtrl \u2014 local voice assistant for Ableton Live",
    "digest": "Speak commands; whisper.cpp + Ollama drive Ableton via the AbletonMCP Remote Script.",
    "tags": "voice,ai,assistant,whisper,ollama,mcp",
    "boxes": [
      {
        "box": {
          "id": "obj-loadbang",
          "maxclass": "newobj",
          "text": "loadbang",
          "patching_rect": [
            370.0,
            20.0,
            60.0,
            22.0
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ]
        }
      },
      {
        "box": {
          "id": "obj-delay",
          "maxclass": "newobj",
          "text": "del 2500",
          "patching_rect": [
            370.0,
            48.0,
            60.0,
            22.0
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ]
        }
      },
      {
        "box": {
          "id": "obj-start",
          "maxclass": "message",
          "text": "script start",
          "patching_rect": [
            440.0,
            20.0,
            84.0,
            22.0
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-reload-web",
          "maxclass": "message",
          "text": "url file:///Users/ds/Documents/Max%20for%20Live/VoiceCtrl/web/index.html?embed=1&api=http%3A%2F%2F127.0.0.1%3A8765&v=8",
          "patching_rect": [
            440.0,
            48.0,
            150.0,
            22.0
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-node-print",
          "maxclass": "newobj",
          "text": "print VoiceCtrlNode",
          "patching_rect": [
            370.0,
            76.0,
            115.0,
            22.0
          ],
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-bg",
          "maxclass": "panel",
          "patching_rect": [
            20.0,
            20.0,
            320.0,
            200.0
          ],
          "presentation": 1,
          "presentation_rect": [
            0.0,
            0.0,
            320.0,
            200.0
          ],
          "background": 1,
          "ignoreclick": 1,
          "mode": 0,
          "numinlets": 1,
          "numoutlets": 0,
          "bgcolor": [
            0.16,
            0.16,
            0.16,
            1.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-title",
          "maxclass": "comment",
          "text": "VoiceCtrl  local Ableton assistant",
          "patching_rect": [
            30.0,
            24.0,
            120.0,
            20.0
          ],
          "presentation": 1,
          "presentation_rect": [
            10.0,
            5.0,
            230.0,
            18.0
          ],
          "fontsize": 12.0,
          "fontname": "Arial Bold",
          "textcolor": [
            0.91,
            0.91,
            0.91,
            1.0
          ],
          "numinlets": 1,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-in",
          "maxclass": "newobj",
          "text": "plugin~",
          "patching_rect": [
            20.0,
            320.0,
            50.0,
            22.0
          ],
          "numinlets": 0,
          "numoutlets": 3,
          "outlettype": [
            "signal",
            "signal",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-out",
          "maxclass": "newobj",
          "text": "plugout~",
          "patching_rect": [
            20.0,
            350.0,
            60.0,
            22.0
          ],
          "numinlets": 2,
          "numoutlets": 0
        }
      },
      {
        "box": {
          "id": "obj-node",
          "maxclass": "newobj",
          "text": "node.script \"src/index.js\" @autostart 1 @watch 1",
          "patching_rect": [
            20.0,
            280.0,
            500.0,
            22.0
          ],
          "numinlets": 1,
          "numoutlets": 3,
          "outlettype": [
            "",
            "bang",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "obj-web",
          "maxclass": "jweb",
          "patching_rect": [
            24.0,
            50.0,
            312.0,
            170.0
          ],
          "presentation": 1,
          "presentation_rect": [
            4.0,
            26.0,
            312.0,
            170.0
          ],
          "url": "file:///Users/ds/Documents/Max%20for%20Live/VoiceCtrl/web/index.html?embed=1&api=http%3A%2F%2F127.0.0.1%3A8765&v=8",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "",
            ""
          ]
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-in",
            0
          ],
          "destination": [
            "obj-out",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-in",
            1
          ],
          "destination": [
            "obj-out",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-loadbang",
            0
          ],
          "destination": [
            "obj-start",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-loadbang",
            0
          ],
          "destination": [
            "obj-delay",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-delay",
            0
          ],
          "destination": [
            "obj-reload-web",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-reload-web",
            0
          ],
          "destination": [
            "obj-web",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-start",
            0
          ],
          "destination": [
            "obj-node",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-node",
            0
          ],
          "destination": [
            "obj-node-print",
            0
          ]
        }
      }
    ],
    "styles": [],
    "dependency_cache": [
      {
        "name": "index.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src",
        "patcherrelativepath": "./src",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "config.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src",
        "patcherrelativepath": "./src",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "logger.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src",
        "patcherrelativepath": "./src",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "pipeline.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src",
        "patcherrelativepath": "./src",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "server.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src",
        "patcherrelativepath": "./src",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "ableton.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src/services",
        "patcherrelativepath": "./src/services",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "ollama.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src/services",
        "patcherrelativepath": "./src/services",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "whisper.js",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/src/services",
        "patcherrelativepath": "./src/services",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "index.html",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/web",
        "patcherrelativepath": "./web",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "icon.svg",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/web",
        "patcherrelativepath": "./web",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "debug.html",
        "bootpath": "/Users/ds/Documents/Max for Live/VoiceCtrl/web",
        "patcherrelativepath": "./web",
        "type": "TEXT",
        "implicit": 1
      }
    ],
    "autosave": 0,
    "oscreceiveudpport": 0
  }
}