import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fileSize, megabytes } from "../src/lib/i18n.js";

describe("fileSize", () => {
  it("says whole kilobytes under a megabyte, and never zero", () => {
    // The line after an export names the file's size (D153); "0.0 MB" for
    // a small .json or .md would say nothing, and "0 KB" would say the
    // file is not there.
    assert.equal(fileSize(0), "1 KB");
    assert.equal(fileSize(700), "1 KB");
    assert.equal(fileSize(40_000), "39 KB");
    assert.equal(fileSize(1_048_575), `${(1024).toLocaleString()} KB`);
  });

  it("hands a megabyte and more to the megabytes line", () => {
    assert.equal(fileSize(1_048_576), megabytes(1_048_576));
    assert.match(fileSize(2_300_000), /^2[.,]2 MB$/);
  });
});
