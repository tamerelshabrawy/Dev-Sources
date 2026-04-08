# Alexandria Pedestrian Soundwalk — Setup & Build Guide

This repository contains the Pure Data patch and web bridge for the **Alexandria
Pedestrian Soundwalk**, an outdoor interactive audio installation that maps a GPS
walking route in Alexandria, Egypt to generative music zones.

---

## Requirements

| Tool | Version | Install |
|------|---------|---------|
| Python | **3.12** (not 3.14, not 3.9) | `brew install python@3.12` |
| pipx | any | `pip install pipx` |
| pd4web | 3.1.1a1 | see below |

> **macOS note:** The system Python at `/usr/bin/python3` is 3.9.6 and is
> incompatible with the Emscripten SDK bundled with pd4web (which uses
> `list[str] | None` syntax requiring Python 3.10+). You **must** ensure
> `python3` resolves to 3.12 before building.

---

## Install pd4web

```bash
pipx install --python python3.12 pd4web==3.1.1a1
```

Verify:

```bash
pd4web --version
# pd4web 3.1.1-alpha | ... Python 3.12 ...
```

---

## Build

Every new terminal session on macOS requires putting Homebrew Python 3.12 first
in `$PATH`:

```bash
export PATH="$(brew --prefix python@3.12)/bin:$PATH"
```

To make this permanent, add the line above to `~/.zshrc` (or `~/.bash_profile`).

Then build from the project root:

```bash
cd ~/Dev-Sources
pd4web Main_scenes_adc.pd --nogui -m 512
```

The first build downloads Emscripten and Pure Data — this can take 10–30 minutes.
Subsequent builds are fast (seconds).

---

## Post-build: add geolocation + AI classifier

pd4web generates a default `Pd4Web/index.html` that handles audio, but does **not**
include GPS or the AI sound classifier. Run the post-build script to overlay the
custom web bridge:

```bash
bash scripts/post-build.sh
```

This copies three files from `custom-js/` into `Pd4Web/`:

| File | Purpose |
|------|---------|
| `index.html` | Replaces default pd4web HTML; adds GPS pill, zone debug panel, morph bar |
| `geolocation.js` | Route projection, zone mapping, polygon helpers (no browser deps) |
| `ai-classifier-bridge.js` | YAMNet microphone classifier for Street Aura zones 32–35 |

---

## Run locally

```bash
cd ~/Dev-Sources/Pd4Web && python3 -m http.server 8080
```

Open **http://localhost:8080** in Chrome or Firefox.

### Browser permission prompts

The page requests **two** permissions:

1. **Microphone** — triggered automatically by `[adc~]` in
   `streetAuraAdcCapture06_idlework.pd`. Pure Data's audio input object is
   compiled into the WebAssembly module; pd4web requests `getUserMedia` on the
   first audio unlock click.

2. **Geolocation (GPS)** — triggered by `navigator.geolocation.watchPosition()`
   in `custom-js/index.html` once the WebAssembly module finishes loading.
   GPS coordinates are projected onto the 35-zone walking route and sent into
   the Pd patch via `PD4WEB.sendFloat('zone', z)`.  
   The patch receives this at `[r zone]` objects in:
   - `alexandria_micro_zone_driver.pd`
   - `alexandria_zone_scene_map.pd`
   - `alexandria_zone_scene_player.pd`

> **Why GPS was not being requested before:** The default pd4web-generated
> `Pd4Web/index.html` does not include any geolocation code. The geolocation
> bridge lives in `custom-js/index.html` and only becomes active after running
> `bash scripts/post-build.sh` which copies it into `Pd4Web/`.

---

## GPS simulation (desktop testing)

The debug panel at the bottom of the page has two modes:

- **📡 Real GPS** — uses `navigator.geolocation.watchPosition()`, suitable for
  on-site testing with a mobile device.
- **🎚 Simulate** — drag the zone slider (1–35) to test scenes without walking.
  Use this for development on a desktop where GPS is unavailable.

---

## AI Sound Classifier (Street Aura, zones 32–35)

When the walker enters zones 32–35 (Street Aura, lower El Naby Danial + El
Horeya Road), the page automatically starts the YAMNet-based audio classifier:

- Loads YAMNet via TensorFlow.js from TFHub
- Classifies live microphone audio into 6 categories:
  `silence | chatter | horn | traffic | birds | sea`
- Sends probability-weighted parameters to Pd:
  `aiSilence, aiChatter, aiHorn, aiTraffic, aiBirds, aiSea, aiClass,`
  `aiGrain, aiPitch, aiStretch, aiRmsDb`

The AI panel appears in the debug overlay only while in zones 32–35.

---

## Known issues fixed

| Issue | Fix |
|-------|-----|
| `display` object crash in `markov.pd` | Run `find ~/.local/pipx/venvs/pd4web -name "markov.pd" -exec sed -i.bak '/display/d' {} \;` after pd4web downloads the ELSE library (first build only) |
| `TypeError: list[str] \| None` in emcmake | Set `export PATH="$(brew --prefix python@3.12)/bin:$PATH"` before building |
| `externally-managed-environment` pip error | Install pd4web via `pipx` instead of `pip` |
| GPS not requested | Run `bash scripts/post-build.sh` after every pd4web build |
| `generate-zones-geojson.js` broken path | Fixed — now references `custom-js/geolocation.js` |

---

## Utility scripts

| Script | Purpose |
|--------|---------|
| `scripts/post-build.sh` | Copy custom web files into `Pd4Web/` after building |
| `scripts/generate-zones-geojson.js` | Re-generate `docs/alexandria-soundwalk-zones.geojson` from route data |
