export const ENGINE_PROTOCOL_VERSION = 1;

export const DECK_IDS = ["deck-1", "deck-2", "deck-3", "deck-4"] as const;
export type DeckId = (typeof DECK_IDS)[number];

export interface LibraryTrack {
  path: string;
  title: string;
  artist: string;
  extension: string;
}

export type EngineCommand =
  | { type: "devices.list" }
  | { type: "devices.select"; deviceName: string }
  | { type: "deck.load"; deckId: DeckId; path: string }
  | { type: "deck.play"; deckId: DeckId }
  | { type: "deck.pause"; deckId: DeckId }
  | { type: "deck.stop"; deckId: DeckId }
  | { type: "deck.seek"; deckId: DeckId; positionSeconds: number }
  | { type: "deck.gain"; deckId: DeckId; gain: number }
  | { type: "deck.eq"; deckId: DeckId; lowDb: number; midDb: number; highDb: number }
  | { type: "deck.cue"; deckId: DeckId; enabled: boolean }
  | { type: "mixer.crossfader"; position: number }
  | { type: "mixer.headphone-gain"; gain: number }
  | { type: "master.gain"; gain: number };

export type EngineEvent =
  | { type: "engine.ready"; protocolVersion: number }
  | { type: "engine.error"; message: string; fatal: boolean }
  | { type: "engine.stopped"; code: number | null; signal: string | null }
  | {
      type: "devices.list";
      devices: string[];
      activeDevice: string;
      sampleRate: number;
      bufferSize: number;
      outputChannels: number;
    }
  | {
      type: "deck.state";
      deckId: DeckId;
      playing: boolean;
      loaded: boolean;
      positionSeconds: number;
      durationSeconds: number;
      gain: number;
      lowDb: number;
      midDb: number;
      highDb: number;
      cue: boolean;
    }
  | { type: "deck.loaded"; deckId: DeckId; name: string; durationSeconds: number; waveformPeaks: number[] }
  | { type: "diagnostic"; message: string };

export interface EngineRequest {
  protocolVersion: number;
  requestId: number;
  command: EngineCommand;
}

export interface EngineResponse {
  protocolVersion: number;
  event: EngineEvent;
  requestId?: number;
  ok?: boolean;
  error?: string;
}

export interface EngineStatus {
  state: "starting" | "ready" | "stopped" | "error";
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isDeckId = (value: unknown): value is DeckId =>
  typeof value === "string" && DECK_IDS.includes(value as DeckId);

export function parseEngineCommand(value: unknown): EngineCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid engine command.");
  }

  switch (value.type) {
    case "devices.list":
      return { type: "devices.list" };
    case "devices.select":
      if (typeof value.deviceName !== "string" || value.deviceName.length > 512) {
        throw new Error("Invalid audio device name.");
      }
      return { type: "devices.select", deviceName: value.deviceName };
    case "deck.load":
      if (!isDeckId(value.deckId) || typeof value.path !== "string" || value.path.length > 32_768) {
        throw new Error("Invalid deck load request.");
      }
      return { type: "deck.load", deckId: value.deckId, path: value.path };
    case "deck.play":
    case "deck.pause":
    case "deck.stop":
      if (!isDeckId(value.deckId)) throw new Error("Invalid deck ID.");
      return { type: value.type, deckId: value.deckId };
    case "deck.seek":
      if (!isDeckId(value.deckId) || !isFiniteNumber(value.positionSeconds) || value.positionSeconds < 0) {
        throw new Error("Invalid seek position.");
      }
      return { type: "deck.seek", deckId: value.deckId, positionSeconds: value.positionSeconds };
    case "deck.gain":
    case "master.gain":
      if (!isFiniteNumber(value.gain) || value.gain < 0 || value.gain > 1.5) {
        throw new Error("Gain must be between 0 and 1.5.");
      }
      if (value.type === "master.gain") return { type: value.type, gain: value.gain };
      if (!isDeckId(value.deckId)) throw new Error("Invalid deck ID.");
      return { type: value.type, deckId: value.deckId, gain: value.gain };
    case "deck.eq":
      if (
        !isDeckId(value.deckId) ||
        !isFiniteNumber(value.lowDb) ||
        !isFiniteNumber(value.midDb) ||
        !isFiniteNumber(value.highDb) ||
        [value.lowDb, value.midDb, value.highDb].some((band) => band < -24 || band > 12)
      ) throw new Error("EQ bands must be between -24 dB and +12 dB.");
      return { type: "deck.eq", deckId: value.deckId, lowDb: value.lowDb, midDb: value.midDb, highDb: value.highDb };
    case "deck.cue":
      if (!isDeckId(value.deckId) || typeof value.enabled !== "boolean") throw new Error("Invalid headphone cue setting.");
      return { type: "deck.cue", deckId: value.deckId, enabled: value.enabled };
    case "mixer.crossfader":
      if (!isFiniteNumber(value.position) || value.position < -1 || value.position > 1) {
        throw new Error("Crossfader position must be between -1 and 1.");
      }
      return { type: "mixer.crossfader", position: value.position };
    case "mixer.headphone-gain":
      if (!isFiniteNumber(value.gain) || value.gain < 0 || value.gain > 1.5) {
        throw new Error("Headphone gain must be between 0 and 1.5.");
      }
      return { type: "mixer.headphone-gain", gain: value.gain };
    default:
      throw new Error(`Unsupported engine command: ${value.type}.`);
  }
}

export function parseEngineResponse(value: unknown): EngineResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== ENGINE_PROTOCOL_VERSION ||
    !isRecord(value.event) ||
    typeof value.event.type !== "string"
  ) {
    throw new Error("Engine sent an invalid or incompatible protocol message.");
  }

  const event = value.event;
  switch (event.type) {
    case "engine.ready":
      if (event.protocolVersion !== ENGINE_PROTOCOL_VERSION) throw new Error("Engine protocol mismatch.");
      break;
    case "engine.error":
      if (typeof event.message !== "string" || typeof event.fatal !== "boolean") throw new Error("Invalid engine error event.");
      break;
    case "engine.stopped":
      if (
        (event.code !== null && typeof event.code !== "number") ||
        (event.signal !== null && typeof event.signal !== "string")
      ) throw new Error("Invalid engine stopped event.");
      break;
    case "devices.list":
      if (
        !Array.isArray(event.devices) ||
        !event.devices.every((device) => typeof device === "string") ||
        typeof event.activeDevice !== "string" ||
        !isFiniteNumber(event.sampleRate) ||
        !isFiniteNumber(event.bufferSize) ||
        !isFiniteNumber(event.outputChannels) ||
        !Number.isInteger(event.outputChannels) ||
        event.outputChannels < 0
      ) throw new Error("Invalid audio device list.");
      break;
    case "deck.state":
      if (
        !isDeckId(event.deckId) ||
        typeof event.loaded !== "boolean" ||
        typeof event.playing !== "boolean" ||
        !isFiniteNumber(event.positionSeconds) ||
        !isFiniteNumber(event.durationSeconds) ||
        !isFiniteNumber(event.gain) ||
        !isFiniteNumber(event.lowDb) ||
        !isFiniteNumber(event.midDb) ||
        !isFiniteNumber(event.highDb) ||
        typeof event.cue !== "boolean"
      ) throw new Error("Invalid deck-state event.");
      break;
    case "deck.loaded":
      if (
        !isDeckId(event.deckId) ||
        typeof event.name !== "string" ||
        !isFiniteNumber(event.durationSeconds) ||
        !Array.isArray(event.waveformPeaks) ||
        event.waveformPeaks.length > 2048 ||
        !event.waveformPeaks.every((peak) => isFiniteNumber(peak) && peak >= 0 && peak <= 1)
      ) throw new Error("Invalid track waveform event.");
      break;
    case "diagnostic":
      if (typeof event.message !== "string") throw new Error("Invalid engine diagnostic.");
      break;
    default:
      throw new Error(`Unsupported engine event: ${event.type}.`);
  }

  if (value.requestId !== undefined && (!Number.isInteger(value.requestId) || (value.requestId as number) < 1)) {
    throw new Error("Invalid engine request ID.");
  }
  if (value.ok !== undefined && typeof value.ok !== "boolean") throw new Error("Invalid engine acknowledgement.");
  if (value.error !== undefined && typeof value.error !== "string") throw new Error("Invalid engine error message.");
  return value as unknown as EngineResponse;
}

export function isDeckIdValue(value: unknown): value is DeckId {
  return isDeckId(value);
}
