# SIR. KEVIN VIRTUAL DJ: architecture and product roadmap

## Product direction

Build a reliable, offline-first desktop DJ application for local music, with a
React/TypeScript interface and a separate C++20/JUCE audio process. The engine
starts with four deck slots and must keep deck count and audio routing
configurable in its design. The product earns trust through stable playback,
clear device routing, a persistent library, and dependable performance tools
before it grows into streaming, cloud, or AI features.

This is a staged product, not a claim of immediate parity with mature
commercial DJ platforms. A credible first release should be excellent at local
file preparation, four-deck playback, mixing, cueing, and recovery. Broad
controller coverage, advanced time-stretching, streaming integrations, and
large-scale library management need separate validation and, in some cases,
licensing agreements.

## Current implementation: honest status

The native implementation is now a **Windows-validated four-deck mixing
preview**, but it is not yet a live-performance-ready or packaged release:

| Area | Native implementation today | Remaining work |
| --- | --- | --- |
| Desktop shell | React/TypeScript/Vite in Electron; isolated renderer, narrow preload API, original logo asset; Electron runtime restored and dev window launches | Installer, signing, release/update process, and clean-machine installation |
| Engine process | Separate JUCE process; versioned JSON Lines; Electron supervises startup and exit | Protocol recovery/version migration, crash recovery, packaging on every OS |
| Decks | Four fixed slots; load local files, play, pause, stop, seek, report position | User-configurable deck count; cue, repeat, pitch, jog, loop, hot cues, tempo/key lock |
| Audio | Device list/selection; summed deck output; deck/master/headphone gain; block peak protection on master and cue buses | Verify audible output on supported systems; measured latency/underrun handling and device-loss recovery |
| Waveform | 512-point peak overview measured from decoded track audio and used for seeking | Detailed zoom waveform, beat grid, cue/loop overlays, cached analysis |
| Mixer | Per-deck channel level, three-band low/mid/high EQ, equal-power A/B crossfader (Decks A/C left, B/D right), master level, headphone cue bus on devices with 4+ outputs | Selectable crossfader curves, visible VU/clip meters, independent headphone device selection and hardware loopback validation, booth routing |
| Library | Folder scanning, filename-derived title/artist, format labels, persistent local JSON catalog, text search, load a result into any deck | Embedded database/migrations, metadata tags, playlists/crates, ratings, duplicate/missing-file workflow, history, paging/large-collection performance |
| Analysis/performance | None in the native engine | BPM/key analysis, beat grid, sync, beat jump, slip, hot cues, quantize, loops, jog modes |
| Effects/sampler/recording | None in the native engine | DSP effects, sample pads, microphone path, and reliable recording/export |
| Cross-platform | CMake presets and CI matrix are present | macOS/Linux build-and-device playback acceptance has not been demonstrated; no release installers are verified |

The separate legacy prototype has a three-deck Web Audio interface with more
visible controls, including a basic sampler, cue/loop controls, recording,
filters, and headphone-related UI. Some are limited or simulated; for example,
its waveform is not track analysis and its frequency-band controls are not
vocal/instrument separation. Legacy functionality must not be described as
implemented in the native app until it is ported and verified there. Keep both
products clearly labelled while the native app is developed.

## Target architecture

```text
┌─────────────────────────────────────────────┐
│ React + TypeScript UI                       │
│ Decks · mixer · library · performance · UX  │
└──────────────────────┬──────────────────────┘
                       │ narrow typed API
┌──────────────────────▼──────────────────────┐
│ Electron main + preload                     │
│ Window security · engine lifecycle · IPC     │
└──────────────────────┬──────────────────────┘
                       │ versioned JSON Lines
┌──────────────────────▼──────────────────────┐
│ C++20 + JUCE engine process                  │
│ Devices · decks · routing · DSP · recording  │
└──────────────────────┬──────────────────────┘
                       │
             Speakers / headphones / interface
```

Repository boundaries:

- `apps/desktop/src/main`: Electron lifecycle, engine process, validated IPC.
- `apps/desktop/src/preload`: explicitly typed, minimal renderer API.
- `apps/desktop/src/renderer`: React interface and display state only.
- `packages/shared`: protocol types and runtime validation.
- `engine/src/app`: engine process and JSON Lines protocol.
- `engine/src/audio`: devices, callbacks, routing, and master bus.
- `engine/src/deck`, `engine/src/dsp`, `engine/src/analysis`: planned deck,
  processing, and analysis modules; create these as their behavior is
  implemented rather than as empty scaffolding.
- `docs` and `.github/workflows`: product decisions, build/release notes, and
  cross-platform automation.

The engine owns device I/O, decoded audio, sample-position transport, DSP,
mixing, and recording. The Electron side owns file selection, library UI,
settings UI, and presentation. Commands and events are validated at both
process boundaries. Standard output is reserved for one compact JSON object
per line; diagnostics go to standard error.

### Real-time and recovery rules

- Decode, analyze, and read files away from the audio callback. Prepare
  buffers before atomically publishing them to playback.
- Keep callback work bounded and allocation-free: no disk access, logging,
  IPC, blocking locks, or unbounded work.
- Use explicit ownership/retirement for buffers replaced while playback is
  active; add stress tests for simultaneous load, seek, and playback.
- Report device loss, malformed protocol messages, failed decode, clipping,
  and engine exits visibly. Do not silently fall back to an unrelated device
  or show a success state after a failed command.
- Persist user data atomically, version the schema, and retain a recoverable
  backup before migrations.
- Define measurable audio stress tests and run physical loopback/listening
  tests on representative hardware. A successful compile or a generated-WAV
  command smoke test is not proof of reliable audible playback.

## Feasibility-first delivery plan

Each stage is a release gate. Do not start broad feature work until the
previous gate passes. This controls scope and keeps the project useful at each
step.

### Stage 0 — Playback foundation and integration gate

**Status: code and Windows checks pass; end-user audio acceptance is still
open.**

- Keep the JUCE process independent, support four initial slots, select an
  output, load local audio, play/pause/stop/seek, and adjust deck/master gain.
- Finish Electron packaging with the engine executable and verify launch,
  engine retry, shutdown, missing-engine errors, and failed audio-file loads.
- Manually verify audible two-deck playback, seek while playing, device
  changes, and recovery after unplugging/reconnecting an output.
- Run a sustained playback test and record the hardware, driver, sample rate,
  buffer, and any dropouts. Repeat on macOS and Linux before claiming
  cross-platform support.

**Exit gate:** packaged app installs and launches on Windows; two different
local tracks play together on a selected device; seeking and gains are
audible; the UI remains responsive; failures are visible. macOS/Linux remain
platform-specific release gates, not assumed from CI compilation alone.

### Stage 1 — Trustworthy DJ mixing

**Status: initial controls and DSP are implemented; hardware acceptance and
several polish items remain.**

Build the minimum usable live-mixing workflow before analysis or cosmetic
features:

- Per-deck channel fader, three-band high/mid/low EQ, and cue button.
- Equal-power crossfader with a predictable center blend; master
  output control and overload protection with documented behavior.
- Separate headphone cue bus to output channels 3/4 when the selected device
  exposes at least four channels. Unsupported stereo-only devices disable cue
  and report why.
- Still add: a filter, selectable crossfader curve, VU/clip meters, and
  independently selected headphone device/output pair.
- Transport cue point, repeat-track toggle, and accurate elapsed/remaining
  display. Keep seek available while paused and playing.
- Keyboard-accessible controls, clear focus/disabled/error states, and a
  compact/responsive layout that stays usable at the minimum window size.

**Exit gate:** blind functional test of a two-track transition: pre-listen to
one deck without sending it to master, adjust EQ and levels, crossfade both
decks, and avoid clipping. Validate headphone routing on a multi-output
interface and validate master-only operation on a standard stereo device.

### Stage 2 — Persistent local library and recovery

**Status: first searchable folder-backed catalog is implemented using an
atomic JSON file; replace/extend it with a versioned database before relying on
large collections or rich metadata.**

- Use a local, versioned database for track metadata, file paths, playlists,
  ratings/tags, history, settings, and performance data. Keep source audio
  files in place unless the user explicitly imports/copies them.
- Add folder scanning, supported-format/error reporting, search, sort, filters,
  recently added/played, favorites, playlists/crates, and drag/drop to decks.
- Handle moved/missing files, duplicate detection, rescan, and metadata edits
  without losing playlist or cue data.
- Persist output/deck preferences and restore the prior workspace safely;
  provide an explicit option to restore deck tracks paused rather than
  unexpectedly starting audio.
- Add database backup/export and crash-safe writes before inviting users to
  trust it with a large library.

**Exit gate:** indexed library survives restart; search and playlist operations
work on a representative user-sized collection; moved/missing files are
recoverable; a forced shutdown does not corrupt the database.

### Stage 3 — Accurate waveforms and core performance tools

**Status: decoded-audio peak waveform overview is implemented. Beat analysis
and all performance features listed below remain outstanding.**

- Generate/cache real overview and detailed waveform data from decoded audio;
  clicking or dragging seeks to the corresponding audio position.
- Analyze BPM and beat positions, let users correct the first beat/grid, and
  persist analysis. Show confidence/unknown states rather than inventing BPM
  or key values.
- Implement cue points and 8 hot-cue slots per deck first; provide set,
  trigger, clear, rename/color where useful, and persistence per track.
- Implement quantized beat loops (1/2, 1, 2, 4, 8, 16 beats), loop in/out and
  reloop; test track-end, seek, and analysis-boundary behavior.
- Add pitch ranges and pitch bend. Add sync only after beat-grid correction
  and tempo control work reliably. Treat key lock/time-stretching as a
  separately benchmarked dependency/feature with a licensing decision.
- Add jog-wheel search/nudge before scratch emulation; only claim scratch
  behavior when low-latency control and audio quality are demonstrated.

**Exit gate:** known test tracks produce reviewable grids; manual correction
persists; waveform seeking, cue recall, loops, and sync remain stable across
restart. Measure BPM/grid error against a curated test set and publish the
accepted range and unsupported cases.

### Stage 4 — Effects, sampler, and recording

- Add a small high-quality starter effect set (filter, echo/delay, reverb)
  with real DSP parameters, wet/dry control, per-deck routing, and safe
  parameter smoothing. Add creative effects only after the core DSP is stable.
- Port the existing eight-pad sampler idea to the native mixer: load/replace,
  trigger/stop, one-shot/loop, gain, clear pad names, and persistent
  assignments. Avoid downloading copyrighted sample packs; ship only assets
  with clear redistribution rights.
- Add master-mix recording with format/quality, destination, available-space
  checks, failure reporting, and a finalization/recovery path if the app exits.
- Add microphone input and ducking only after input routing and monitoring
  feedback safeguards are specified and tested.

**Exit gate:** effects and samples mix without blocking the callback; recording
matches the audible master, finalizes correctly, and does not glitch playback
under documented load.

### Stage 5 — Hardware, release quality, and differentiation

- Add MIDI device discovery, learn, editable mappings, feedback/output
  mappings, profiles, and per-device persistence. Start with a small
  test-controller matrix and expand based on actual user hardware.
- Add automated packaging on Windows/macOS/Linux and verify clean-machine
  installs, upgrades, uninstall behavior, audio-device permissions, and data
  preservation. Sign/notarize releases where distribution requires it.
- Add crash reports with privacy-conscious opt-in, engine log rotation,
  diagnostics export, settings reset, and documented recovery steps.
- Track audio callback underruns, CPU/memory, library scan time, and startup
  time on a defined reference-hardware matrix.
- Differentiate around a dependable four-deck, offline-first workflow:
  fast local preparation, stable recovery, clear routing, quick cue/loop
  access, and useful controller mappings. Add cloud sync, streaming, video,
  collaboration, or AI stems only after validating user demand, APIs,
  redistribution/public-performance rights, operating cost, and support
  burden.

**Release gate:** every supported OS has a packaged install and hardware test
record; license obligations are reviewed; known limitations and supported
audio formats/devices are published; a user can back up and restore their
library and settings.

## Explicitly out of scope for the first DJ-ready release

- Streaming-provider integration, ripping/downloading provider content, or
  bypassing DRM. These require provider contracts and rights review.
- Cloud accounts, subscriptions, social sharing, video, and multi-user sync.
- AI stem separation, automatic full-library key correction, and speculative
  beat-grid fixes. These add compute, model/dependency, licensing, and support
  costs before the basic workflow is proven.
- Arbitrary plug-ins and a large effects catalog.
- Claims of scratch-grade latency, professional mastering, or universal
  controller compatibility without measurements and device-specific testing.

## Toolchain, dependencies, and licensing

- UI: React, TypeScript, Vite, Electron.
- Audio: C++20, JUCE, CMake; Visual Studio on Windows, Xcode/Clang on macOS,
  GCC/Clang on Linux.
- Audio formats: start with formats verified by the bundled JUCE readers on
  each target OS. Test corrupt, truncated, variable-rate, long, and
  multi-channel files. Clearly report unsupported files.
- JUCE is pinned to 8.0.6 in CMake FetchContent and is available under GPLv3
  or commercial licensing. Review the applicable license before distributing
  a closed-source product. Evaluate codec patents/redistribution and every
  analysis, time-stretch, and sample dependency before inclusion.
- Rubber Band is not part of the playback foundation. Consider it for
  time-stretching only after performance tests and GPL/commercial licensing
  review.
- Use platform-native audio backends through JUCE. Document actual backend,
  latency, channel routing, and sample-rate limitations for each supported OS.

## Secure Electron requirements

- Keep `nodeIntegration` disabled; enable `contextIsolation` and renderer
  sandboxing; load packaged local content.
- Expose only narrow operations through `contextBridge`; never expose raw
  `ipcRenderer`, unrestricted filesystem access, or shell access.
- Validate IPC sender identity and every command payload. Keep file picking in
  the main process and pass only the selected path to the engine.
- Test malformed messages, oversized input, engine startup timeout, process
  crash, and renderer reload/reconnect behavior.
- See [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security/)
  and [contextBridge documentation](https://www.electronjs.org/docs/latest/api/context-bridge).

## Cross-platform development and validation

CMake presets are provided for Debug and Release builds. The workflow builds
and tests Windows, macOS, and Linux. CI proves compilation and automated
tests; it does not prove audible device output, real-time latency, or hardware
routing. Keep those as explicit manual test gates with recorded results.

Windows commands from PowerShell:

```powershell
Set-Location engine
cmake --preset windows-debug
cmake --build --preset windows-debug --parallel
ctest --preset windows-debug
Set-Location ..\apps\desktop
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Use `windows-release` to build the production engine. Build and sign macOS
releases on macOS; test Linux packages on supported distributions. The
desktop installer must bundle the matching engine binary and must not be
advertised as a release until clean-machine installation and playback pass.

## Immediate next work

1. Produce a native preview installer that bundles the engine; install and
   launch it on a clean Windows account or machine.
2. Validate two-deck playback, EQ, crossfade, and headphone cue with a
   four-output interface; verify stereo-only devices correctly disable cue.
3. Extend the JSON catalog into a versioned database and add missing-file
   handling, playlists, and metadata tags.
4. Add BPM/grid correction, cue points, loops, and pitch controls on top of
   the decoded waveform foundation.
5. Keep legacy prototype and native preview labels separate until the native
   product passes these acceptance gates.

## Original playback-foundation prompt

The first milestone was scoped to implement a separate C++20/JUCE process,
four deck slots, versioned JSON Lines, secure Electron IPC, local file loading,
play/pause/stop/seek, device selection, deck/master gain, playback position
events, visible errors, CMake presets, CI, build instructions, and license
notes. It deliberately excluded BPM analysis, sync, time-stretching, effects,
recording, and controller support. The broader roadmap above extends that
foundation in testable releases instead of pretending those features are
already present.
