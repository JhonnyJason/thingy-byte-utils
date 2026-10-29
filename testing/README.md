# Testing

## Files
- `correctness.test.mjs` - correctness of every entry point in `output/`. Known bugs run as `todo`. Standard globals only, besides `node:test` and `node:assert/strict`.
- `correctness-browsers.mjs` - runs `correctness.test.mjs` in headless browsers. `browser/` maps `node:test` and `node:assert/strict` to small shims via an import map.
- `browser-runner.mjs` - serves a page plus `testing/` and `output/` to a headless browser and collects the POSTed result. Used by both browser scripts.
- `bench.mjs` - runtime-agnostic benchmark of candidate implementations per operation. Every candidate is cross-checked against the first one before timing.
- `bench-pool.mjs` - the shipped `output/` per pool block size (one module instance each), plus the memory waste per block size.
- `bench-browsers.mjs` - serves `bench.mjs` to a browser and collects the results.
- `results/` - raw benchmark output per engine.

## Run
```sh
node --test testing/          # also: bun test testing/, deno test -A testing/correctness.test.mjs
node testing/correctness-browsers.mjs [chromium] [firefox] [manual]
node testing/bench.mjs [op]   # also: deno run / bun - op e.g. hexToBytes
node testing/bench-pool.mjs   # also: deno run / bun
node testing/bench-browsers.mjs firefox
node testing/bench-browsers.mjs manual   # open the printed URL in any browser
```

## Results 2026-10-28 (single run per engine)
Engines: Node 26.12 (V8 14.6), Deno 2.9.8 (V8 15.0), Bun 1.4.4 (JavaScriptCore), Firefox 159 (SpiderMonkey), headless Chromium 156 (V8).
Times are medians of 7 batches. Inputs are 16 B, 64 B, 256 B, 1 KB and 1 MB, and each candidate gets its own loop so its call site stays monomorphic. Run-to-run noise was not measured, and Deno's small-input numbers look noisy.

| Operation | Finding |
|---|---|
| bytesToHex | Native `toHex` is fastest everywhere for small inputs. From 1 KB up, Buffer wins on Node (1.1-1.2x) and Bun (2.7-5x). The current browser table loop is 1.5-190x slower. |
| hexToBytes | Native `fromHex` is fastest on Bun and Firefox and matches Buffer on Deno (V8 15), but is 4-9x slower than Buffer on Node (V8 14.6). The current char map is the slowest everywhere (3-250x). The JS charCode loop is the best pure-JS fallback, and at 16 B it beats `fromHex` on every V8 engine, because V8's `fromHex` has a high cost per call. |
| utf8ToBytes | TextEncoder is fastest on Bun and Firefox and for 1 MB inputs on Node. On Node and Deno, Buffer is 4-7x faster for small strings. TextEncoder is slow for short strings on every V8 engine (about 1.4-1.9 µs vs about 0.1 µs on JSC and SpiderMonkey). |
| bytesToUtf8 | TextDecoder is fastest or equal everywhere. The current Node StringDecoder is up to 9x slower for small inputs. |
| bytesToBigInt | Reversing the bytes and then using native `toHex` wins everywhere: 3-50x faster than the current shift loop. |

### Root cause of the V8 anomalies: allocating the result
`new Uint8Array(n)` costs about 50 ns up to 64 B on Node/Chromium (V8 keeps those on the JS heap), about 2 µs above that, and about 1.7 µs at every size on Deno. Bun: 16-240 ns.
`TextEncoder` and `fromHex` seem to pay the expensive allocation on V8 even for small results. Buffer avoids it by slicing results out of a pre-allocated 8 KB pool, so the result shares its `.buffer` with other results.
So on V8, a pure-JS loop wins as long as every array it allocates stays at 64 B or less: up to 64 result bytes for hex, and up to about 21 characters for UTF-8 (the scratch buffer is 3 bytes per character).

### Pooled results (option B, 2026-10-28)
Small results are written into a shared 8 KB pool (`setFromHex`, `encodeInto` or the JS encoder) and returned as `subarray` views. Results above 4 KB get a fresh array.
- On V8 the pool removes the allocation cost. On Node and Deno it matches or beats Buffer, except Node `hexToBytes` from 64 B up, where Node's V8 14.6 `setFromHex` is still 1.3-4x slower than Buffer (Deno's V8 15 is fast). On Chromium it is 2-10x faster than the plain native calls up to 256 B.
- On JSC (Bun) and SpiderMonkey (Firefox) the plain native calls stay fastest for small inputs. The pool costs about 70-200 ns extra there (the `subarray` view).
- UTF-8: the JS encoder writing into the pool beats `encodeInto` on Chromium up to about 64 characters, and on Node/Deno up to about 16. `encodeInto` into the pool is best above that.

### uvy (2026-10-28, Node/Bun/Deno)
- `bytesToUvy`: adding chars to the string one at a time collapses on V8 for large inputs (6-9 MB/s at 1 MB). Writing char codes into a byte array (pool scratch up to 4 KB) and calling `TextDecoder` once gives 128-211 MB/s at 1 MB and is 1.3-4.6x faster from 64 B up. It is only 70-110 ns slower at 16 B on V8, so it is the only path.
- `uvyToBytes`: a JS accumulator writing into the pool gives 83-122 MB/s on Node, about 1.5x slower than `setFromHex` for the same number of output bytes.

### uvy block loop (2026-10-29, Node/Bun/Deno)
5 bytes <-> 8 chars with fixed shifts instead of a bit accumulator. Sizes are multiples of 5 (15 B to 1 MB), so the old and new format give the same strings.
- `bytesToUvy`: 1.5-3x faster than the accumulator from 65 B up on every engine (339-370 MB/s at 1 MB, was 116-190). Equal at 15 B.
- `uvyToBytes` (with the new invalid-char check): 1.1-1.5x faster from 65 B up (134-365 MB/s at 1 MB, was 112-247). Equal at 15 B; a first Node run showed 3x slower at 15 B, reruns did not.

### CoffeeScript vs plain JS (2026-10-28)
The compiled CoffeeScript was slower in the hot loops. A module-level loop `i` was shared by every function, so the loops read and wrote a module variable instead of a local. `for i in [0...n]` also checks the loop direction on every iteration. With the same code as plain JS, `uvyToBytes` 64 B is 20-40% faster and `utf8ToBytes` 30 chars is 20% faster on Node, Bun and Deno. The module is plain JS since then.

### Strict hex fallback (v0.1.1 step 1, 2026-10-29, Node/Bun/Deno)
`jsHexInto` now throws on invalid chars: a sentinel `0xff` in `hexVal`, every char code and looked-up value ORed into one flag, one check after the loop. Compared with the old loop in the pool (16 B - 1 KB): +3-8% on Node, +7-13% on Deno, +12-30% on Bun. This only matters on engines without `setFromHex`.

### Strict utf8ToBytes (v0.1.1 step 2, 2026-10-29, Node/Bun/Deno)
The `encodeInto`/`encode` path now calls `isWellFormed()` first (TextEncoder would silently write U+FFFD). Extra cost over a plain `encodeInto`: ASCII 0-20% (up to 1 KB), none at 1 MB; CJK 5-35%, most on Node/Bun with 256 B - 1 MB. `encodeInto` itself cannot report lone surrogates.
Alternatives tried (pool, 32-1365 chars, ascii/latin/mixed/cjk): skipping the check when `written == s.length` (pure ASCII) is no faster, because V8 already answers `isWellFormed` for one-byte strings almost for free. Searching the output for U+FFFD (`EF BF BD`, what a lone surrogate turns into) with `indexOf` is 10-80% slower. The strict JS encoder beats strict `encodeInto` for non-ASCII up to about 48-64 chars, but loses for ASCII from 48 chars on Node (1.54x vs 1.09x), so the cutoff stays at 32 chars. `isWellFormed` first is kept.

### Pool block size (v0.1.1 step 5, 2026-10-29, Node/Bun/Deno, single run)
`bench-pool.mjs`: blocks of 0 (no pool), 2, 4, 8 and 16 KB, results of 16 B to 8 KB, `hexToBytes`, `uvyToBytes`, `bytesToUvy` (pool as scratch) and `utf8ToBytes` (ASCII, reserves 3 bytes per char). Raw: `results/pool-*.txt`.
- V8 (Node, Deno): any pool is 7-13x faster than none for results up to 64 B (e.g. `hexToBytes` 16 B: 1.8 µs -> 0.15-0.24 µs). Among 2-16 KB the block size makes no difference for results that fit, as long as they fit.
- What changes is which results fit (half the block). A result that no longer fits pays the ~2 µs allocation: `utf8ToBytes` 1 KB (reserves 3 KB) takes 2.3-2.5 µs with 2/4 KB blocks and 0.63-0.65 µs with 8 KB. 16 KB also pools 2 KB strings (0.7-0.8 µs instead of 2.4-3.1 µs) and is 1.1-1.15x faster for Deno `hexToBytes` at 1-4 KB.
- Above about 1 KB the conversion itself dominates (`uvy*`, Node `setFromHex`), and the block size is within noise.
- Bun (JSC): no pool is fastest for small results (`hexToBytes` 16 B: 37 ns vs 154-165 ns, `utf8ToBytes` 64 B: 84 vs 228-258 ns), the `subarray` view costs more than the allocation. The block size makes no difference there.
- Waste: the tail of a replaced block is always smaller than the largest pooled result, so larger blocks waste a smaller share (results of one odd size: 700 B wastes 31% of a 2 KB block, 5.5% of 8 KB; 3000 B wastes 27% of 8 KB). The real cost of a larger block: one kept small result pins the whole block, and every module instance holds one block.
- Recommendation (to confirm): 8 KB stays the default. It pools strings up to 1365 chars and hex/uvy results up to 4 KB, the same block size as Node's Buffer. 16 KB only helps 1-2.7 KB strings and doubles what a kept result pins. 2/4 KB lose 3-4x for strings from about 340/680 chars on V8.

## Correctness 2026-10-30
Passing everywhere (174 tests: 58 each for the native, no native hex and no codec instances): Node 26.12, Bun 1.4.4, Deno 2.9.8, Chromium 156, Firefox 159. The exhaustive tests (every UTF-16 code unit for hex/uvy, every 1-2 byte UTF-8 input) take about 4 s per instance.
Shim names must not match Node's test file patterns (`*-test.mjs`, `test-*.mjs`), or `node --test testing/` runs them.
