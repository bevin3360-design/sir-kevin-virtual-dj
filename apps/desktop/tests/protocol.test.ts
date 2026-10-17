import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_PROTOCOL_VERSION,
  parseEngineCommand,
  parseEngineResponse
} from "../../../packages/shared/src/protocol";

test("accepts bounded four-deck playback commands", () => {
  assert.deepEqual(parseEngineCommand({
    type: "deck.seek",
    deckId: "deck-4",
    positionSeconds: 123.5
  }), {
    type: "deck.seek",
    deckId: "deck-4",
    positionSeconds: 123.5
  });
  assert.deepEqual(parseEngineCommand({ type: "master.gain", gain: 1.25 }), {
    type: "master.gain",
    gain: 1.25
  });
});

test("rejects malformed deck IDs, paths, seek positions and gains", () => {
  assert.throws(() => parseEngineCommand({ type: "deck.play", deckId: "deck-5" }));
  assert.throws(() => parseEngineCommand({ type: "deck.load", deckId: "deck-1", path: "x".repeat(32_769) }));
  assert.throws(() => parseEngineCommand({ type: "deck.seek", deckId: "deck-1", positionSeconds: -1 }));
  assert.throws(() => parseEngineCommand({ type: "deck.gain", deckId: "deck-1", gain: 2 }));
  assert.throws(() => parseEngineCommand({ type: "deck.eq", deckId: "deck-1", lowDb: -25, midDb: 0, highDb: 0 }));
  assert.throws(() => parseEngineCommand({ type: "mixer.crossfader", position: 1.1 }));
});

test("validates mixer, EQ, and headphone cue commands", () => {
  assert.deepEqual(parseEngineCommand({
    type: "deck.eq",
    deckId: "deck-2",
    lowDb: -12,
    midDb: 0,
    highDb: 6
  }), { type: "deck.eq", deckId: "deck-2", lowDb: -12, midDb: 0, highDb: 6 });
  assert.deepEqual(parseEngineCommand({ type: "deck.cue", deckId: "deck-1", enabled: true }), {
    type: "deck.cue",
    deckId: "deck-1",
    enabled: true
  });
  assert.deepEqual(parseEngineCommand({ type: "mixer.crossfader", position: -1 }), {
    type: "mixer.crossfader",
    position: -1
  });
});

test("requires the supported version and validates engine events", () => {
  assert.equal(parseEngineResponse({
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    event: { type: "engine.ready", protocolVersion: ENGINE_PROTOCOL_VERSION }
  }).event.type, "engine.ready");
  assert.throws(() => parseEngineResponse({
    protocolVersion: 99,
    event: { type: "engine.ready", protocolVersion: 99 }
  }));
  assert.throws(() => parseEngineResponse({
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    event: { type: "deck.state", deckId: "deck-1", playing: true }
  }));
  assert.equal(parseEngineResponse({
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    event: {
      type: "deck.loaded",
      deckId: "deck-1",
      name: "test.wav",
      durationSeconds: 10,
      waveformPeaks: [0, 0.5, 1]
    }
  }).event.type, "deck.loaded");
  assert.throws(() => parseEngineResponse({
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    event: {
      type: "deck.loaded",
      deckId: "deck-1",
      name: "test.wav",
      durationSeconds: 10,
      waveformPeaks: [2]
    }
  }));
});
