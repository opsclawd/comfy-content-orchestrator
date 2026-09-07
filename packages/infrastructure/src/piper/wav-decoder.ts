import { PiperSynthesisError } from "./piper-error.js";

export interface DecodedWav {
  readonly sampleRateHz: number;
  readonly numChannels: number;
  readonly bitsPerSample: number;
  /** Byte offset of the audio payload in the original WAV buffer. */
  readonly dataByteOffset: number;
  readonly dataByteLength: number;
  readonly durationMs: number;
}

/**
 * Decodes RIFF/WAVE audio data and extracts format and duration metadata.
 *
 * Scans chunks dynamically by 4-byte identifier and declared length rather than
 * assuming a fixed 44-byte header, supporting optional metadata chunks (LIST, INFO, fact)
 * and word-aligned RIFF chunk boundaries.
 *
 * Invariant: durationMs is calculated from the measured audio data and sample rate,
 * rounded to integer milliseconds via Math.round.
 */
export function decodeWav(input: Uint8Array | ArrayBuffer): DecodedWav {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 12) {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      "WAV data too short to contain a valid RIFF header",
      { details: { byteLength: bytes.byteLength } }
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);

  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      `Invalid RIFF/WAVE header markers: expected 'RIFF'/'WAVE', got '${riff}'/'${wave}'`,
      { details: { riff, wave } }
    );
  }

  let offset = 12;
  let fmt:
    | {
        readonly audioFormat: number;
        readonly numChannels: number;
        readonly sampleRateHz: number;
        readonly bitsPerSample: number;
      }
    | undefined;
  let dataByteLength: number | undefined;
  let dataByteOffset: number | undefined;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;

    if (payloadOffset + chunkSize > bytes.byteLength) {
      throw new PiperSynthesisError(
        "DECODE_FAILED",
        `Truncated WAV chunk '${chunkId}': declared size ${chunkSize} bytes exceeds buffer bounds (${bytes.byteLength - payloadOffset} bytes remaining)`,
        { details: { chunkId, chunkSize, remainingBytes: bytes.byteLength - payloadOffset } }
      );
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new PiperSynthesisError(
          "DECODE_FAILED",
          `Invalid 'fmt ' chunk size: expected at least 16 bytes for PCM format, got ${chunkSize}`,
          { details: { chunkSize } }
        );
      }
      const audioFormat = view.getUint16(payloadOffset, true);
      const numChannels = view.getUint16(payloadOffset + 2, true);
      const sampleRateHz = view.getUint32(payloadOffset + 4, true);
      const bitsPerSample = view.getUint16(payloadOffset + 14, true);

      fmt = { audioFormat, numChannels, sampleRateHz, bitsPerSample };
    } else if (chunkId === "data") {
      dataByteOffset = payloadOffset;
      dataByteLength = chunkSize;
    }

    // RIFF chunk payloads are padded to 2-byte word boundaries if length is odd
    const paddedChunkSize = chunkSize + (chunkSize % 2);
    offset = payloadOffset + paddedChunkSize;
  }

  if (!fmt) {
    throw new PiperSynthesisError("DECODE_FAILED", "Missing required 'fmt ' chunk in WAV file");
  }

  if (fmt.audioFormat !== 1) {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      `Unsupported audio format ${fmt.audioFormat}: only PCM (format 1) is supported`,
      { details: { audioFormat: fmt.audioFormat } }
    );
  }

  if (fmt.numChannels <= 0) {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      `Invalid channel count ${fmt.numChannels}: must be greater than 0`,
      { details: { numChannels: fmt.numChannels } }
    );
  }

  if (fmt.sampleRateHz <= 0) {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      `Invalid sample rate ${fmt.sampleRateHz}: must be greater than 0`,
      { details: { sampleRateHz: fmt.sampleRateHz } }
    );
  }

  if (fmt.bitsPerSample <= 0 || fmt.bitsPerSample % 8 !== 0) {
    throw new PiperSynthesisError(
      "DECODE_FAILED",
      `Invalid bits per sample ${fmt.bitsPerSample}: must be a positive multiple of 8`,
      { details: { bitsPerSample: fmt.bitsPerSample } }
    );
  }

  if (dataByteOffset === undefined || dataByteLength === undefined || dataByteLength <= 0) {
    throw new PiperSynthesisError("DECODE_FAILED", "Missing or empty 'data' chunk in WAV file", {
      details: { dataByteLength }
    });
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const totalSamples = dataByteLength / (bytesPerSample * fmt.numChannels);
  const durationMs = Math.round((totalSamples / fmt.sampleRateHz) * 1000);

  return {
    sampleRateHz: fmt.sampleRateHz,
    numChannels: fmt.numChannels,
    bitsPerSample: fmt.bitsPerSample,
    dataByteOffset,
    dataByteLength,
    durationMs
  };
}
