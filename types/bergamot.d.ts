// The surface of the vendored engine that this extension actually touches.
//
// Hand-written for the same reason as `webext.d.ts`: it is the list of what we
// depend on in 5 MB of compiled C++, so a change here is a visible diff rather
// than a discovery at runtime. Verified against
// `worker/translator-worker.js` in `@browsermt/bergamot-translator@0.4.9`.

interface BergamotAlignedMemory {
  getByteArrayView(): Int8Array;
}

interface BergamotAlignedMemoryList {
  push_back(memory: BergamotAlignedMemory): void;
}

interface BergamotVectorString {
  push_back(text: string): void;
  delete(): void;
}

interface BergamotResponseOptions {
  alignment: boolean;
  html: boolean;
  qualityScores: boolean;
}

interface BergamotVectorResponseOptions {
  push_back(options: BergamotResponseOptions): void;
  delete(): void;
}

interface BergamotResponse {
  getTranslatedText(): string;
}

interface BergamotResponseList {
  get(index: number): BergamotResponse;
  delete(): void;
}

interface BergamotTranslationModel {
  delete(): void;
}

interface BergamotBlockingService {
  translate(
    model: BergamotTranslationModel,
    texts: BergamotVectorString,
    options: BergamotVectorResponseOptions,
  ): BergamotResponseList;
  delete(): void;
}

interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => BergamotAlignedMemory;
  AlignedMemoryList: new () => BergamotAlignedMemoryList;
  VectorString: new () => BergamotVectorString;
  VectorResponseOptions: new () => BergamotVectorResponseOptions;
  TranslationModel: new (
    config: string,
    model: BergamotAlignedMemory,
    shortlist: BergamotAlignedMemory,
    vocabs: BergamotAlignedMemoryList,
    qualityModel: BergamotAlignedMemory | null,
  ) => BergamotTranslationModel;
  BlockingService: new (options: { cacheSize: number }) => BergamotBlockingService;

  /** Raw WebAssembly exports, where the fallback matrix kernels live. */
  asm: Record<string, (...args: number[]) => number>;

  /** Emscripten hooks we set before the glue runs. */
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    accept: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
  onRuntimeInitialized?: () => void;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}

declare var Module: BergamotModule;

// Worker global, absent from the DOM lib this project type-checks against.
declare function importScripts(...urls: string[]): void;
