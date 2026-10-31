import assert from "node:assert/strict";
import { decide } from "./price_watch.js";

assert.equal(decide(100, 80), "manual-review");
assert.equal(decide(100, 95), "notify-merchandiser");
assert.equal(decide(100, 100), "keep-price");
console.log("price decision checks passed");
