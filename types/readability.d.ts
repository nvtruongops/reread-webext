// The vendored extractor, as much of it as this extension touches.
//
// Hand-written for the same reason as `webext.d.ts`: it is a short list, and an
// entry showing up here means something new is being used. The library ships
// its own `index.d.ts`, which describes the npm package - we do not install the
// package, we vendor one file and load it with a script tag, so this describes
// the global that file leaves behind.
//
// Source: vendor/readability/Readability.js (0.6.0, Apache-2.0).

interface ReadabilityArticle {
  title: string | null;
  byline: string | null;
  /** Text direction, when the page said one: `ltr` or `rtl`. */
  dir: string | null;
  lang: string | null;
  /** The article as HTML. Somebody else's HTML - see `src/lib/reader/`. */
  content: string | null;
  textContent: string | null;
  length: number;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
}

interface ReadabilityInstance {
  /** `null` when there was no article to find, which is not an error. */
  parse(): ReadabilityArticle | null;
}

interface ReadabilityConstructor {
  new (
    doc: Document,
    options?: {
      debug?: boolean;
      maxElemsToParse?: number;
      nbTopCandidates?: number;
      charThreshold?: number;
      keepClasses?: boolean;
    },
  ): ReadabilityInstance;
}
