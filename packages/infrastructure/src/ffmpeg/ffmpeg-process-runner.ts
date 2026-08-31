import { spawn } from "node:child_process";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunOptions {
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly stdin?: Buffer | Uint8Array | undefined;
}

export type SpawnLikeFn = (
  command: string,
  args: readonly string[],
  options?: ProcessRunOptions
) => Promise<ProcessRunResult>;

export const defaultSpawnRunner: SpawnLikeFn = (command, args, options) => {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, [...args], {
        cwd: options?.cwd,
        stdio: [options?.stdin ? "pipe" : "ignore", "pipe", "pipe"]
      });
      if (options?.stdin && child.stdin) {
        child.stdin.end(options.stdin);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const isFfprobe = command.includes("ffprobe");
        return reject(
          new FfmpegAssemblyError(
            isFfprobe ? "FFPROBE_NOT_FOUND" : "FFMPEG_NOT_FOUND",
            `Executable not found: ${command}`,
            { command, args }
          )
        );
      }
      return reject(err);
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }

    let timer: NodeJS.Timeout | undefined;
    if (options?.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new FfmpegAssemblyError(
            "PROCESS_TIMEOUT",
            `Process execution timed out after ${options.timeoutMs}ms: ${command}`,
            { command, args }
          )
        );
      }, options.timeoutMs);
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      if (err.code === "ENOENT") {
        const isFfprobe = command.includes("ffprobe");
        reject(
          new FfmpegAssemblyError(
            isFfprobe ? "FFPROBE_NOT_FOUND" : "FFMPEG_NOT_FOUND",
            `Executable not found: ${command}`,
            { command, args }
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr
      });
    });
  });
};
