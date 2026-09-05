import { KokoroSynthesisError } from "./kokoro-error.js";

/**
 * Encodes floating-point audio samples into a standard 16-bit PCM mono WAV file.
 *
 * Architecture & format invariants:
 * - Channels: 1 (mono). Kokoro produces mono speech synthesis. Multi-channel
 *   layout is handled downstream in assembly/mixing (e.g. FFmpeg media assembler),
 *   not within this encoder.
 * - Format: 16-bit linear PCM (WAVE_FORMAT_PCM = 0x0001).
 * - Header: Canonical 44-byte RIFF/WAVE container.
 * - Endianness: Little-endian integer representations throughout header and data.
 *
 * @param samples Float32Array containing normalized audio samples (nominally [-1.0, 1.0]).
 * @param sampleRateHz Integer sample rate in Hertz (e.g. 24000).
 * @returns Uint8Array containing complete binary RIFF WAV data.
 */
export function encodeWav(samples: Float32Array, sampleRateHz: number): Uint8Array {
  if (!samples || !(samples instanceof Float32Array) || samples.length === 0) {
    throw new KokoroSynthesisError(
      "INVALID_INPUT",
      "Cannot encode empty or invalid audio samples into WAV",
      { sampleRateHz }
    );
  }

  if (typeof sampleRateHz !== "number" || !Number.isInteger(sampleRateHz) || sampleRateHz <= 0) {
    throw new KokoroSynthesisError(
      "INVALID_INPUT",
      `Invalid sample rate ${sampleRateHz}: must be a positive integer`,
      { sampleRateHz }
    );
  }

  const numChannels = 1; // Mono assumption: single channel voice synthesis output
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRateHz * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const totalSize = 44 + dataSize;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // RIFF Chunk Descriptor
  // 0..3: "RIFF"
  buffer[0] = 0x52; // 'R'
  buffer[1] = 0x49; // 'I'
  buffer[2] = 0x46; // 'F'
  buffer[3] = 0x46; // 'F'
  // 4..7: ChunkSize = 36 + SubChunk2Size (little-endian)
  view.setUint32(4, 36 + dataSize, true);
  // 8..11: "WAVE"
  buffer[8] = 0x57; // 'W'
  buffer[9] = 0x41; // 'A'
  buffer[10] = 0x56; // 'V'
  buffer[11] = 0x45; // 'E'

  // "fmt " sub-chunk
  // 12..15: "fmt "
  buffer[12] = 0x66; // 'f'
  buffer[13] = 0x6d; // 'm'
  buffer[14] = 0x74; // 't'
  buffer[15] = 0x20; // ' '
  // 16..19: Subchunk1Size = 16 for PCM
  view.setUint32(16, 16, true);
  // 20..21: AudioFormat = 1 (PCM)
  view.setUint16(20, 1, true);
  // 22..23: NumChannels = 1 (Mono)
  view.setUint16(22, numChannels, true);
  // 24..27: SampleRate
  view.setUint32(24, sampleRateHz, true);
  // 28..31: ByteRate
  view.setUint32(28, byteRate, true);
  // 32..33: BlockAlign
  view.setUint16(32, blockAlign, true);
  // 34..35: BitsPerSample
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  // 36..39: "data"
  buffer[36] = 0x64; // 'd'
  buffer[37] = 0x61; // 'a'
  buffer[38] = 0x74; // 't'
  buffer[39] = 0x61; // 'a'
  // 40..43: Subchunk2Size
  view.setUint32(40, dataSize, true);

  // Write PCM samples: float32 [-1.0, 1.0] -> signed int16 [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const pcm = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    const clamped = Math.max(-32768, Math.min(32767, pcm));
    view.setInt16(offset, clamped, true);
    offset += 2;
  }

  return buffer;
}
