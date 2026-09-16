/**
 * The provider that is installed until Bergamot lands in M1.
 *
 * It answers `engine_missing` and never anything else. The alternative -
 * echoing the input, or returning a placeholder string - would put fake
 * translations into the one code path that must never invent them, and a fake
 * that works is a fake that survives into a release.
 */

import { ErrorCode, fail } from "../../protocol.js";

/** @type {import("../index.js").Provider} */
export const noEngine = {
  id: "none",
  async translate() {
    return fail(ErrorCode.ENGINE_MISSING);
  },
};
