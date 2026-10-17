import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import path from "node:path";
import { app } from "electron";
import {
  ENGINE_PROTOCOL_VERSION,
  parseEngineResponse,
  type EngineCommand,
  type EngineEvent,
  type EngineRequest,
  type EngineResponse,
  type EngineStatus
} from "../../../../packages/shared/src/protocol";

interface PendingRequest {
  resolve: (event: EngineEvent) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class EngineManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private status: EngineStatus = { state: "stopped", message: "Audio engine has not started." };
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private intentionalShutdown = false;

  getStatus(): EngineStatus {
    return this.status;
  }

  start(): Promise<void> {
    if (this.status.state === "ready") return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    let executablePath: string;
    try {
      executablePath = this.getExecutablePath();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Native audio engine is not installed.";
      this.updateStatus({ state: "error", message });
      return Promise.reject(new Error(message));
    }
    this.intentionalShutdown = false;
    this.updateStatus({ state: "starting", message: `Starting audio engine: ${path.basename(executablePath)}` });

    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        const error = new Error("Timed out waiting for the native audio engine to start.");
        this.updateStatus({ state: "error", message: error.message });
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.process?.kill();
      }, 15_000);

      const child = spawn(executablePath, [], {
        cwd: path.dirname(executablePath),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      this.process = child;

      const stdout = createInterface({ input: child.stdout });
      stdout.on("line", (line) => this.handleEngineLine(line, () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      }));

      const stderr = createInterface({ input: child.stderr });
      stderr.on("line", (line) => {
        const message = line.trim();
        if (message) this.publish({ type: "diagnostic", message: `Audio engine: ${message}` });
      });

      child.once("error", (error) => {
        clearTimeout(timeout);
        this.updateStatus({ state: "error", message: `Could not launch the audio engine: ${error.message}` });
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.once("exit", (code, signal) => {
        stdout.close();
        stderr.close();
        this.rejectPending(new Error("Audio engine stopped before completing the request."));
        if (this.process === child) this.process = null;
        if (!this.intentionalShutdown) {
          const message = `Audio engine stopped unexpectedly (code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""}).`;
          if (this.status.state !== "error") this.updateStatus({ state: "stopped", message });
          this.publish({ type: "engine.stopped", code, signal });
        }
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error(this.status.message));
        }
        this.startPromise = null;
      });
    }).finally(() => {
      if (this.status.state !== "starting") this.startPromise = null;
    });

    return this.startPromise;
  }

  async send(command: EngineCommand): Promise<EngineEvent> {
    if (!this.process || this.status.state !== "ready") {
      throw new Error(this.status.message || "Audio engine is not ready.");
    }
    const requestId = ++this.requestId;
    const request: EngineRequest = {
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      requestId,
      command
    };

    return new Promise<EngineEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Audio engine did not answer ${command.type} in time.`));
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.process?.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.intentionalShutdown = true;
    this.process = null;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.updateStatus({ state: "stopped", message: "Audio engine stopped." });
  }

  private handleEngineLine(line: string, onReady: () => void): void {
    try {
      const response = parseEngineResponse(JSON.parse(line) as unknown);
      if (response.requestId !== undefined) this.resolveRequest(response);

      if (response.event.type === "engine.ready") {
        this.updateStatus({ state: "ready", message: "Audio engine is ready." });
        onReady();
      } else if (response.event.type === "engine.error") {
        this.publish(response.event);
        if (response.event.fatal) {
          this.updateStatus({ state: "error", message: response.event.message });
        }
      } else {
        this.publish(response.event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid audio engine message.";
      this.updateStatus({ state: "error", message });
      this.publish({ type: "engine.error", message, fatal: false });
    }
  }

  private resolveRequest(response: EngineResponse): void {
    const request = this.pending.get(response.requestId!);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(response.requestId!);
    if (response.ok === false) request.reject(new Error(response.error ?? "Audio engine command failed."));
    else request.resolve(response.event);
  }

  private rejectPending(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      this.pending.delete(id);
    }
  }

  private getExecutablePath(): string {
    const executable = `sir-kevin-audio-engine${process.platform === "win32" ? ".exe" : ""}`;
    if (app.isPackaged) return path.join(process.resourcesPath, "engine", executable);
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
    const configuration = process.env.CMAKE_BUILD_TYPE === "Debug" ? "Debug" : "Release";
    const preset = `${platform}-${configuration.toLowerCase()}`;
    const executablePath = path.resolve(__dirname, "..", "..", "..", "..", "engine", "build", preset, "bin",
      ...(process.platform === "win32" ? [configuration] : []), executable);
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Native audio engine not found at ${executablePath}. Build the ${preset} CMake preset first.`);
    }
    return executablePath;
  }

  private updateStatus(status: EngineStatus): void {
    this.status = status;
    this.emit("status", status);
  }

  private publish(event: EngineEvent): void {
    this.emit("event", event);
  }
}
