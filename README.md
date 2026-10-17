# SIR. KEVIN VIRTUAL DJ

The original prototype is still available with `npm start`. A separate
React/TypeScript + Electron + JUCE native playback foundation is implemented
alongside it. The native engine and desktop production build have passed
Windows build checks, but the native preview has not yet passed packaged
installer and real-hardware listening acceptance, and it is not the default
installed application. See the [native roadmap and implementation status](./docs/native-architecture.md)
for missing features, release gates, and the feasibility-first delivery plan.

The native preview now includes per-deck three-band EQ, an equal-power
crossfader, headphone cue routing on audio devices with at least four output
channels, decoded-audio waveform overviews, and a persistent searchable local
folder catalog. Headphone cue is unavailable on stereo-only devices. The
catalog currently stores file paths and filename-derived title/artist in a
local JSON file; it is not yet a full metadata database or playlist manager.

A Windows desktop app for the SIR. KEVIN VIRTUAL DJ prototype. It includes
four independent audio decks with logo-centered, draggable jog wheels, a
four-channel mixer, local-track library, pitch and EQ controls, beat loops,
loop in/out markers, hot cues, frequency-band toggles, vinyl/slip jog modes,
deck and master filters, echo, an eight-pad audio sampler, device-voice
shout-outs, MIDI note input, separate master/headphone output routing (when
supported), headphone cue/master mix, channel and master level meters, a
master limiter, themes, layouts, keyboard shortcuts, per-deck
repeat-from-beginning, local mix recording, and decoded-audio waveform
analysis on loaded tracks. The original app name, S/K logo, and Windows icon
remain part of the app and its installer.

Each deck can seek through a loaded track with the **SEEK** slider below its
elapsed/duration readout or by clicking the waveform preview. The deck
waveform follows playback in a rolling, beat-gridded view; the separate
overview shows the full track. Press **WAVE LOOP**, then click the visible
waveform once for loop-in and again to the right for loop-out.

After a track is decoded, the app estimates its BPM and musical key and uses
the BPM to draw beat/bar guides. These are prototype estimates, not guaranteed
analysis; correct the BPM in the deck's BPM field if needed. The BPM and key
also appear in the searchable library.

## Run from source

1. Install Node.js LTS.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Run `npm start`.

## Build the Windows installer

Run `npm install`, then `npm run dist`. The installer is written to `dist/`.
Run the generated `SIR. KEVIN VIRTUAL DJ Setup 1.1.0.exe` and follow the
installer. It creates Start menu and desktop shortcuts.

Audio processing lives in `audio-engine.js`, separate from the UI. The deck
signals feed a shared master bus with limiter, metering, and mix recording.
Headphone cue uses an independent pre-channel-fader monitor bus; choose a
separate headphone output and enable a deck's CUE checkbox to pre-listen. A
multi-output interface is required for separate speaker/headphone devices.

The four-channel crossfader routes Decks A and C to the left and Decks B and D
to the right. Its blend is normalized to reduce combined-level clipping.

The Windows installer is unsigned, so Windows SmartScreen may show an
unrecognized-app warning. Only install a build you trust.

The app plays files selected from the laptop and stores no music in the
installer. Choose local audio again after restarting the app; the prototype
does not yet persist library entries between sessions.

The supplied S/K artwork is used as the Windows app, taskbar, and installer
icon. Automatic updates are not active yet: they require a public GitHub
repository for release hosting and publishing each signed/versioned release.
Once that repository exists, configure its owner/name and release workflow
before distributing builds that should update themselves.

## Sampler

Use **MORE TOOLS → DECK AUDIO FX & SAMPLER** to load an audio clip into any of
the eight pads. Trigger plays the sample once; Stop ends playback; Loop repeats
it; and each pad has independent volume. Samples pass through the shared
master bus and are included in mix recordings. Assignments and pad settings
are stored locally in the app's user-data folder, with imported sample copies
remaining on this computer. WAV, MP3, OGG/OGA, FLAC, M4A, AAC, and WebM are
offered for loading, but decoding depends on the codecs available in
Electron/Windows.
The standalone browser preview can load samples for the current session but
does not persist them.

## Prototype limitations

- Automatic BPM and key results are estimates and can be ambiguous on sparse,
  noisy, or harmonically unusual tracks. Review BPM before relying on its beat
  grid, beat loops, or sync; BPM can be corrected manually.
- Repeat Track restarts the loaded song at the beginning when it ends; it is
  a per-deck toggle.
- STEMS toggles split low, mid, and high frequency ranges; they do not separate
  vocals or instruments with AI.
- MIDI currently maps notes 60–63 to play Decks A–D and notes 48–51 to cue
  Decks A–D. Controller mapping/custom bindings are not implemented.
- Online music buttons open provider search pages in the system browser. They
  do not stream, download, or record provider audio. Confirm the track,
  account, venue, and public-performance licensing terms before commercial use.
- Separate audio output selection depends on support exposed by the installed
  Chromium/Electron version and the connected audio interface. Headphone cue
  routing and meters are implemented in this prototype; latency and timing
  guarantees of a native professional audio engine are not.
- The limiter uses the Web Audio compressor and is basic overload protection,
  not a configurable mastering limiter.
- Recording downloads a local WebM audio file; format support may vary.
- Plug-ins/extensions, streaming, microphone routing, cloud sync, and
  persistent playlists/history are not included in this prototype.
