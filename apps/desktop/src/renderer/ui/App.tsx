import { useCallback, useEffect, useState } from "react";
import logoUrl from "../../../../../sir-kevin-logo.jpg";
import {
  DECK_IDS,
  isDeckIdValue,
  type DeckId,
  type EngineEvent,
  type EngineStatus,
  type LibraryTrack
} from "../../../../../packages/shared/src/protocol";

interface DeckState {
  name: string;
  loaded: boolean;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  gain: number;
  lowDb: number;
  midDb: number;
  highDb: number;
  cue: boolean;
  waveformPeaks: number[];
}

const emptyDeck = (): DeckState => ({
  name: "",
  loaded: false,
  playing: false,
  positionSeconds: 0,
  durationSeconds: 0,
  gain: 1,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
  cue: false,
  waveformPeaks: []
});

const deckNumber = (deckId: DeckId): string => deckId.slice(-1);

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function DeckCard({
  deckId,
  deck,
  command,
  chooseTrack,
  headphoneAvailable
}: {
  deckId: DeckId;
  deck: DeckState;
  command: (action: Parameters<typeof window.sirKevinAudioEngine.sendCommand>[0]) => Promise<void>;
  chooseTrack: (id: DeckId) => Promise<void>;
  headphoneAvailable: boolean;
}) {
  const position = deck.durationSeconds > 0 ? deck.positionSeconds / deck.durationSeconds : 0;
  const updateSeek = (value: number) =>
    command({ type: "deck.seek", deckId, positionSeconds: value / 1000 * deck.durationSeconds });

  return (
    <article className={`deck-card ${deckId}`} aria-labelledby={`${deckId}-title`}>
      <header className="deck-heading">
        <div>
          <div className="deck-kicker">PLAYER {deckNumber(deckId).padStart(2, "0")} · ENGINE SLOT {deckNumber(deckId)}</div>
          <h2 id={`${deckId}-title`}>DECK {String.fromCharCode(64 + Number(deckNumber(deckId)))}</h2>
        </div>
        <span className={`deck-state ${deck.playing ? "playing" : ""}`}>
          {deck.playing ? "PLAYING" : deck.loaded ? "READY" : "EMPTY"}
        </span>
      </header>

      <div className="track-name" title={deck.name || "No track loaded"}>
        {deck.name || "No track loaded"}
      </div>
      <div
        className="waveform-preview"
        aria-label={`${deck.name || "Empty deck"} position overview; click to seek`}
        onClick={(event) => {
          if (!deck.loaded || deck.durationSeconds <= 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
          void updateSeek(Math.round(ratio * 1000));
        }}
        role="slider"
        tabIndex={deck.loaded ? 0 : -1}
        aria-valuemin={0}
        aria-valuemax={1000}
        aria-valuenow={Math.round(position * 1000)}
        aria-disabled={!deck.loaded}
        onKeyDown={(event) => {
          if (!deck.loaded || deck.durationSeconds <= 0) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const current = Math.round(position * 1000);
          void updateSeek(Math.min(1000, Math.max(0, current + direction * 10)));
        }}
      >
        <div className="waveform-bars" aria-hidden="true">
          {Array.from({ length: 56 }, (_, index) => {
            const peakIndex = Math.min(deck.waveformPeaks.length - 1, Math.floor(index / 56 * deck.waveformPeaks.length));
            const peak = deck.waveformPeaks[peakIndex] ?? 0;
            const height = Math.max(2, peak * 100);
            return (
              <span
                key={index}
                className={index / 56 <= position ? "past" : ""}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
        {!deck.loaded && <span className="waveform-placeholder">LOAD TRACK TO ANALYZE WAVEFORM</span>}
        <span className="playhead" style={{ left: `${position * 100}%` }} />
      </div>

      <div className="position-row">
        <span>{formatTime(deck.positionSeconds)}</span>
        <span>{formatTime(deck.durationSeconds)}</span>
      </div>
      <label className="seek-label" htmlFor={`${deckId}-seek`}>SEEK</label>
      <input
        id={`${deckId}-seek`}
        className="seek-slider"
        type="range"
        min="0"
        max="1000"
        step="1"
        value={Math.min(1000, Math.max(0, Math.round(position * 1000)))}
        disabled={!deck.loaded}
        aria-label={`Seek Deck ${deckNumber(deckId)}`}
        onChange={(event) => void updateSeek(Number(event.target.value))}
      />

      <div className="transport-row">
        <button className="secondary-button" type="button" onClick={() => void chooseTrack(deckId)}>
          {deck.loaded ? "REPLACE TRACK" : "LOAD TRACK"}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!deck.loaded}
          onClick={() => void command({ type: deck.playing ? "deck.pause" : "deck.play", deckId })}
        >
          {deck.playing ? "PAUSE" : "PLAY"}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!deck.loaded}
          onClick={() => void command({ type: "deck.stop", deckId })}
        >
          STOP
        </button>
        <button
          className={`cue-button ${deck.cue ? "active" : ""}`}
          type="button"
          disabled={!headphoneAvailable}
          aria-label={`${deck.cue ? "Disable" : "Enable"} headphone cue for Deck ${deckNumber(deckId)}`}
          title={headphoneAvailable ? "Send this deck to headphone outputs 3/4" : "Select an audio interface with at least four output channels"}
          onClick={() => void command({ type: "deck.cue", deckId, enabled: !deck.cue })}
        >
          CUE
        </button>
      </div>

      <label className="gain-control" htmlFor={`${deckId}-gain`}>
        <span>CHANNEL LEVEL</span>
        <output>{Math.round(deck.gain * 100)}%</output>
        <input
          id={`${deckId}-gain`}
          type="range"
          min="0"
          max="150"
          step="1"
          value={Math.round(deck.gain * 100)}
          onChange={(event) =>
            void command({ type: "deck.gain", deckId, gain: Number(event.target.value) / 100 })
          }
        />
      </label>

      <div className="eq-control" aria-label={`Three-band EQ for Deck ${deckNumber(deckId)}`}>
        {([
          ["low", "LOW", deck.lowDb],
          ["mid", "MID", deck.midDb],
          ["high", "HIGH", deck.highDb]
        ] as const).map(([band, label, value]) => (
          <label key={band} htmlFor={`${deckId}-eq-${band}`}>
            <span>{label}</span>
            <output>{value > 0 ? "+" : ""}{value} dB</output>
            <input
              id={`${deckId}-eq-${band}`}
              type="range"
              min="-24"
              max="12"
              step="1"
              value={value}
              aria-label={`${label} EQ Deck ${deckNumber(deckId)}`}
              onChange={(event) => {
                const eq = { lowDb: deck.lowDb, midDb: deck.midDb, highDb: deck.highDb };
                eq[`${band}Db` as keyof typeof eq] = Number(event.target.value);
                void command({ type: "deck.eq", deckId, ...eq });
              }}
            />
          </label>
        ))}
      </div>
    </article>
  );
}

export function App() {
  const [status, setStatus] = useState<EngineStatus>({
    state: "starting",
    message: "Connecting to the native audio engine…"
  });
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>(() =>
    Object.fromEntries(DECK_IDS.map((id) => [id, emptyDeck()])) as Record<DeckId, DeckState>
  );
  const [devices, setDevices] = useState<string[]>([]);
  const [activeDevice, setActiveDevice] = useState("");
  const [deviceDetails, setDeviceDetails] = useState("");
  const [headphoneAvailable, setHeadphoneAvailable] = useState(false);
  const [masterGain, setMasterGain] = useState(1);
  const [headphoneGain, setHeadphoneGain] = useState(1);
  const [crossfader, setCrossfader] = useState(0);
  const [libraryTracks, setLibraryTracks] = useState<LibraryTrack[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryDeck, setLibraryDeck] = useState<DeckId>("deck-1");
  const [error, setError] = useState("");

  const handleEvent = useCallback((event: EngineEvent) => {
    if (event.type === "engine.error") {
      setError(event.message);
    } else if (event.type === "engine.ready") {
      setError("");
    } else if (event.type === "devices.list") {
      setDevices(event.devices);
      setActiveDevice(event.activeDevice);
      setHeadphoneAvailable(event.outputChannels >= 4);
      setError(event.activeDevice ? "" : "No audio output device is active. Select an output device to start playback.");
      setDeviceDetails(
        event.activeDevice
          ? `${event.activeDevice} · ${Math.round(event.sampleRate)} Hz · ${event.bufferSize || "—"} frames · ${event.outputChannels >= 4 ? "headphones 3/4 available" : "stereo output"}`
          : "No output device selected"
      );
    } else if (event.type === "deck.loaded") {
      setDecks((previous) => ({
        ...previous,
        [event.deckId]: {
          ...previous[event.deckId],
          name: event.name,
          loaded: true,
          durationSeconds: event.durationSeconds,
          positionSeconds: 0,
          playing: false,
          waveformPeaks: event.waveformPeaks
        }
      }));
    } else if (event.type === "deck.state") {
      setDecks((previous) => ({
        ...previous,
        [event.deckId]: {
          ...previous[event.deckId],
          loaded: event.loaded,
          playing: event.playing,
          positionSeconds: event.positionSeconds,
          durationSeconds: event.durationSeconds,
          gain: event.gain,
          lowDb: event.lowDb,
          midDb: event.midDb,
          highDb: event.highDb,
          cue: event.cue
        }
      }));
    }
  }, []);

  useEffect(() => {
    if (!window.sirKevinAudioEngine) {
      setStatus({ state: "error", message: "Open the installed desktop app to use the native audio engine." });
      return;
    }
    const removeEventListener = window.sirKevinAudioEngine.onEvent(handleEvent);
    const removeStatusListener = window.sirKevinAudioEngine.onStatus(setStatus);
    void window.sirKevinAudioEngine.getStatus().then(setStatus).catch((reason: unknown) => {
      setStatus({ state: "error", message: reason instanceof Error ? reason.message : "Audio engine status unavailable." });
    });
    void window.sirKevinAudioEngine.sendCommand({ type: "devices.list" }).catch(() => undefined);
    void window.sirKevinAudioEngine.getLibraryTracks().then(setLibraryTracks).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load the local music library.");
    });
    return () => {
      removeEventListener();
      removeStatusListener();
    };
  }, [handleEvent]);

  const sendCommand = useCallback(async (command: Parameters<typeof window.sirKevinAudioEngine.sendCommand>[0]) => {
    try {
      setError("");
      await window.sirKevinAudioEngine.sendCommand(command);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Audio command failed.");
    }
  }, []);

  const chooseTrack = useCallback(async (deckId: DeckId) => {
    try {
      setError("");
      await window.sirKevinAudioEngine.chooseTrack(deckId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the selected track.");
    }
  }, []);

  const changeDevice = async (deviceName: string) => {
    try {
      setError("");
      await sendCommand({ type: "devices.select", deviceName });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select the audio device.");
    }
  };

  const addMusicFolder = async () => {
    try {
      const tracks = await window.sirKevinAudioEngine.addLibraryFolder();
      setLibraryTracks(tracks);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not scan the selected music folder.");
    }
  };

  const loadLibraryTrack = async (trackPath: string) => {
    try {
      await window.sirKevinAudioEngine.loadLibraryTrack(libraryDeck, trackPath);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the selected library track.");
    }
  };

  const filteredLibraryTracks = libraryTracks.filter((track) =>
    `${track.title} ${track.artist} ${track.extension}`.toLocaleLowerCase()
      .includes(librarySearch.trim().toLocaleLowerCase())
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="SIR. KEVIN logo" />
          <div>
            <div className="brand-title">SIR. KEVIN VIRTUAL DJ</div>
            <div className="brand-subtitle">NATIVE ENGINE · FOUR DECK PLAYBACK</div>
          </div>
        </div>
        <div className={`engine-badge ${status.state}`}>
          <span className="engine-dot" />
          {status.state.toUpperCase()}
        </div>
      </header>

      <section className="system-panel" aria-label="Audio engine and device">
        <div className="engine-message" role="status">{status.message}</div>
        <button
          className="secondary-button retry-button"
          type="button"
          disabled={status.state === "starting"}
          onClick={() => void window.sirKevinAudioEngine.retry().then(setStatus)}
        >
          RETRY ENGINE
        </button>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <section className="workstation" aria-label="DJ workstation">
        <div className="deck-bank left-bank" aria-label="Decks A and C">
          {[DECK_IDS[0], DECK_IDS[2]].map((deckId) => (
            <DeckCard
              key={deckId}
              deckId={deckId}
              deck={decks[deckId]}
              command={sendCommand}
              chooseTrack={chooseTrack}
              headphoneAvailable={headphoneAvailable}
            />
          ))}
        </div>

        <section className="mixer-panel" aria-label="Master mixer and output">
          <header className="mixer-heading">
            <span className="eyebrow">SIR. KEVIN</span>
            <h2>MIXER</h2>
            <span className="mixer-subtitle">MASTER SECTION</span>
          </header>

          <div className="limiter-status">
            <span className="limiter-light" />
            <div>
              <span className="meter-label">OUTPUT PROTECTION</span>
              <strong>PEAK LIMITER</strong>
              <small>Engine overload protection active</small>
            </div>
          </div>

          <label className="master-level" htmlFor="master-gain">
            <span>MASTER LEVEL</span>
            <output>{Math.round(masterGain * 100)}%</output>
            <input
              id="master-gain"
              type="range"
              min="0"
              max="150"
              step="1"
              value={Math.round(masterGain * 100)}
              onChange={(event) => {
                const gain = Number(event.target.value) / 100;
                setMasterGain(gain);
                void sendCommand({ type: "master.gain", gain });
              }}
            />
          </label>

          <div className="crossfader-control">
            <div className="crossfader-label"><span>DECK A</span><strong>CROSSFADER</strong><span>DECK B</span></div>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={Math.round(crossfader * 100)}
              aria-label="Crossfader from Deck A to Deck B"
              onChange={(event) => {
                const position = Number(event.target.value) / 100;
                setCrossfader(position);
                void sendCommand({ type: "mixer.crossfader", position });
              }}
            />
          </div>

          <label className={`headphone-level ${headphoneAvailable ? "" : "unavailable"}`}>
            <span>HEADPHONE LEVEL · OUTPUTS 3/4</span>
            <output>{Math.round(headphoneGain * 100)}%</output>
            <input
              type="range"
              min="0"
              max="150"
              step="1"
              value={Math.round(headphoneGain * 100)}
              disabled={!headphoneAvailable}
              onChange={(event) => {
                const gain = Number(event.target.value) / 100;
                setHeadphoneGain(gain);
                void sendCommand({ type: "mixer.headphone-gain", gain });
              }}
            />
            {!headphoneAvailable && <small>Select a four-output interface to enable headphone cue.</small>}
          </label>

          <label className="device-picker">
            <span>MASTER OUTPUT</span>
            <select
              value={activeDevice}
              onChange={(event) => void changeDevice(event.target.value)}
              disabled={status.state !== "ready"}
              aria-label="Audio output device"
            >
              {!activeDevice && <option value="">System default</option>}
              {devices.map((device) => <option key={device} value={device}>{device}</option>)}
            </select>
            <small>{deviceDetails}</small>
          </label>

          <div className="mixer-note">Deck channel levels are controlled on each player.</div>
        </section>

        <div className="deck-bank right-bank" aria-label="Decks B and D">
          {[DECK_IDS[1], DECK_IDS[3]].map((deckId) => (
            <DeckCard
              key={deckId}
              deckId={deckId}
              deck={decks[deckId]}
              command={sendCommand}
              chooseTrack={chooseTrack}
              headphoneAvailable={headphoneAvailable}
            />
          ))}
        </div>
      </section>

      <section className="browser-panel" aria-labelledby="browser-title">
        <header className="browser-heading">
          <div>
            <div className="eyebrow">OFFLINE COLLECTION</div>
            <h2 id="browser-title">MUSIC LIBRARY</h2>
          </div>
          <div className="library-actions">
            <label className="library-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={librarySearch}
                placeholder="Search title, artist, format"
                aria-label="Search local music library"
                onChange={(event) => setLibrarySearch(event.target.value)}
              />
            </label>
            <button className="browser-load add-folder-button" type="button" onClick={() => void addMusicFolder()}>
              ADD MUSIC FOLDER
            </button>
          </div>
        </header>
        <div className="browser-table-wrap">
          <table className="browser-table">
            <thead>
              <tr><th>#</th><th>TITLE</th><th>ARTIST</th><th>FORMAT</th><th aria-label="Deck" /></tr>
            </thead>
            <tbody>
              {filteredLibraryTracks.map((track, index) => (
                <tr className="library-row" key={track.path}>
                  <td className="browser-time">{String(index + 1).padStart(2, "0")}</td>
                  <td className="browser-track" title={track.path}>{track.title}</td>
                  <td className="browser-artist">{track.artist || "—"}</td>
                  <td><span className="format-tag">{track.extension}</span></td>
                  <td className="library-load-cell">
                    <select
                      value={libraryDeck}
                      aria-label={`Load ${track.title} into deck`}
                      onChange={(event) => {
                        if (isDeckIdValue(event.target.value)) setLibraryDeck(event.target.value);
                      }}
                    >
                      {DECK_IDS.map((deckId) => (
                        <option key={deckId} value={deckId}>DECK {String.fromCharCode(64 + Number(deckNumber(deckId)))}</option>
                      ))}
                    </select>
                    <button className="browser-load" type="button" onClick={() => void loadLibraryTrack(track.path)}>LOAD</button>
                  </td>
                </tr>
              ))}
              {filteredLibraryTracks.length === 0 && (
                <tr><td colSpan={5} className="library-empty">
                  {libraryTracks.length === 0 ? "Add a music folder to build your offline library." : "No tracks match this search."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="library-footer">{filteredLibraryTracks.length} TRACK{filteredLibraryTracks.length === 1 ? "" : "S"} · STORED LOCALLY</div>
      </section>

      <footer className="footer-note">
        Local playback · Four independent decks · Audio handled by the JUCE engine
      </footer>
    </main>
  );
}
