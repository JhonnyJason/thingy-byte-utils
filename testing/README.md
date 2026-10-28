# Testing

## Files
- `correctness.test.mjs` - correctness of every entry point in `output/`. Known bugs run as `todo`.
- `bench.mjs` - runtime-agnostic benchmark of candidate implementations per operation. Every candidate is cross-checked against the first one before timing.
- `bench-browsers.mjs` - serves `bench.mjs` to a browser and collects the results.
- `results/` - raw benchmark output per engine.

## Run
```sh
node --test testing/          # also: bun test testing/
node testing/bench.mjs        # also: deno run / bun
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

### CoffeeScript vs plain JS (2026-10-28)
The compiled CoffeeScript was slower in the hot loops. A module-level loop `i` was shared by every function, so the loops read and wrote a module variable instead of a local. `for i in [0...n]` also checks the loop direction on every iteration. With the same code as plain JS, `uvyToBytes` 64 B is 20-40% faster and `utf8ToBytes` 30 chars is 20% faster on Node, Bun and Deno. The module is plain JS since then.
