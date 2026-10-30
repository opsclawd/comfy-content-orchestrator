import { createRequire } from "node:module";
import type {
  PrevisTextDetectionInput,
  PrevisTextDetectionPort,
  PrevisTextDetectionResult,
  PrevisTextRegion
} from "@cco/application";

export const TESSERACT_ENGINE_ID = "tesseract.js";
/** tesseract.js PSM.SPARSE_TEXT — suits scattered scene text such as signage. */
export const TESSERACT_SPARSE_TEXT_PSM = "11";

interface TesseractWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractPage {
  readonly blocks?: ReadonlyArray<{
    paragraphs: ReadonlyArray<{ lines: ReadonlyArray<{ words: readonly TesseractWord[] }> }>;
  }> | null;
}

export interface TesseractWorkerLike {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: Buffer,
    options: Record<string, unknown>,
    output: Record<string, boolean>
  ): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}

export type CreateTesseractWorker = (
  lang: string,
  oem: number,
  options: Record<string, unknown>
) => Promise<TesseractWorkerLike>;

export interface TesseractPrevisTextDetectorOptions {
  readonly createWorker?: CreateTesseractWorker;
  /** Directory holding `<lang>.traineddata(.gz)`. Defaults to @tesseract.js-data/eng. */
  readonly langPath?: string;
  readonly gzip?: boolean;
  readonly engineVersion?: string;
}

interface TessdataPackage {
  readonly langPath: string;
  readonly gzip: boolean;
}

function loadEnglishData(): TessdataPackage {
  const require = createRequire(import.meta.url);
  return require("@tesseract.js-data/eng") as TessdataPackage;
}

async function defaultCreateWorker(
  lang: string,
  oem: number,
  options: Record<string, unknown>
): Promise<TesseractWorkerLike> {
  const tesseract = await import("tesseract.js");
  const createWorker = (tesseract.default ?? tesseract).createWorker;
  return (await createWorker(lang, oem, options)) as unknown as TesseractWorkerLike;
}

function readEngineVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("tesseract.js/package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
}

export class TesseractPrevisTextDetector implements PrevisTextDetectionPort {
  private workerPromise: Promise<TesseractWorkerLike> | undefined;
  private readonly createWorker: CreateTesseractWorker;
  private readonly options: TesseractPrevisTextDetectorOptions;

  constructor(options: TesseractPrevisTextDetectorOptions = {}) {
    this.options = options;
    this.createWorker = options.createWorker ?? defaultCreateWorker;
  }

  private getWorker(): Promise<TesseractWorkerLike> {
    if (!this.workerPromise) {
      const data = this.options.langPath === undefined ? loadEnglishData() : undefined;
      const langPath = this.options.langPath ?? data!.langPath;
      const gzip = this.options.gzip ?? data?.gzip ?? true;
      const created = this.createWorker("eng", 1, {
        langPath,
        gzip,
        // Never fetch traineddata from a CDN or cache it at runtime.
        cacheMethod: "none"
      }).then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: TESSERACT_SPARSE_TEXT_PSM });
        return worker;
      });
      created.catch(() => {
        // Allow a later call to retry worker creation.
        this.workerPromise = undefined;
      });
      this.workerPromise = created;
    }
    return this.workerPromise;
  }

  async detectText(input: PrevisTextDetectionInput): Promise<PrevisTextDetectionResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(Buffer.from(input.bytes), {}, { blocks: true });
    const regions: PrevisTextRegion[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            regions.push({
              text: word.text,
              confidence: Math.max(0, Math.min(1, word.confidence / 100)),
              ...(word.bbox ? { bbox: { ...word.bbox } } : {})
            });
          }
        }
      }
    }
    return {
      engine: {
        id: TESSERACT_ENGINE_ID,
        version: this.options.engineVersion ?? readEngineVersion()
      },
      regions
    };
  }

  /** Drops the (possibly wedged) shared worker so the next call starts a fresh one. */
  async recycleAfterTimeout(): Promise<void> {
    await this.terminate();
  }

  async terminate(): Promise<void> {
    const pending = this.workerPromise;
    this.workerPromise = undefined;
    if (!pending) return;
    try {
      await (await pending).terminate();
    } catch {
      // Worker never started; nothing to terminate.
    }
  }
}
