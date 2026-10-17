/// <reference types="vite/client" />

import type { DeckId, EngineCommand, EngineEvent, EngineStatus, LibraryTrack } from "../../../../packages/shared/src/protocol";

declare global {
  interface Window {
    sirKevinAudioEngine: {
      getStatus(): Promise<EngineStatus>;
      retry(): Promise<EngineStatus>;
      sendCommand(command: EngineCommand): Promise<EngineEvent>;
      chooseTrack(deckId: DeckId): Promise<string | null>;
      getLibraryTracks(): Promise<LibraryTrack[]>;
      addLibraryFolder(): Promise<LibraryTrack[]>;
      loadLibraryTrack(deckId: DeckId, trackPath: string): Promise<void>;
      onEvent(callback: (event: EngineEvent) => void): () => void;
      onStatus(callback: (status: EngineStatus) => void): () => void;
    };
  }
}

export {};
