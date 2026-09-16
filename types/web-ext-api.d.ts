// The slice of the web-ext npm package's programmatic API that
// tools/sign-upload.mjs is allowed to touch - web-ext ships no types of its
// own. Kept as narrow as the call site: two commands, and only the fields the
// upload actually sets or reads. Anything more gets declared here first, the
// same contract webext.d.ts makes for browser APIs.

declare module "web-ext" {
  /** What sign passes into its build step, plus the one knob the upload sets. */
  interface WebExtBuildParams {
    sourceDir: string;
    artifactsDir: string;
    ignoreFiles?: string[];
    /** Filename template for the zip; "{version}" resolves from the manifest. */
    filename?: string;
  }

  /** Internals (manifestData, showReadyMessage) passed through untouched. */
  type WebExtBuildOptions = Record<string, unknown>;

  interface WebExtBuildResult {
    extensionPath: string;
  }

  interface WebExtSignParams {
    sourceDir: string;
    artifactsDir: string;
    channel: "listed" | "unlisted";
    amoBaseUrl: string;
    apiKey: string;
    apiSecret: string;
    /** Only feeds the User-Agent header of the AMO requests. */
    webextVersion?: string;
  }

  interface WebExtSignOptions {
    build?: (
      params: WebExtBuildParams,
      options: WebExtBuildOptions,
    ) => Promise<WebExtBuildResult>;
  }

  interface WebExtSignResult {
    id: string;
    downloadedFiles: string[];
  }

  const webExt: {
    cmd: {
      build(
        params: WebExtBuildParams,
        options?: WebExtBuildOptions,
      ): Promise<WebExtBuildResult>;
      sign(
        params: WebExtSignParams,
        options?: WebExtSignOptions,
      ): Promise<WebExtSignResult>;
    };
  };
  export default webExt;
}
