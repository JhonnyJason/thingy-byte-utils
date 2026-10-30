// bytesToUvy scratch size: speed of the shipped output/ per SCRATCH_SIZE (chars)
// CLI: node|deno|bun testing/bench-scratch.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { measure, format, engine } from "./bench.mjs"

// one module copy per scratch size, written to a temp dir (Bun cannot import data: URLs) - 0 allocates on every call
const dir = mkdtempSync(join(tmpdir(), "bench-scratch-"))
const source = readFileSync(new URL("../output/index.js", import.meta.url), "utf8")
if (!source.includes("const SCRATCH_SIZE = ")) throw new Error("SCRATCH_SIZE not found in output/index.js")
const scratchSizes = [0, 1024, 4096, 16384, 65536]
const impls = await Promise.all(scratchSizes.map(async (size) => {
    const variant = source.replace(/const SCRATCH_SIZE = \d+/, `const SCRATCH_SIZE = ${size}`)
    const file = join(dir, `index-${size}.mjs`)
    writeFileSync(file, variant)
    const b = await import(file)
    return [size ? `scratch ${size / 1024} K` : "scratch 0 (alloc)", b]
}))
rmSync(dir, { recursive: true })

const random = (n) => Uint8Array.from({ length: n }, () => Math.random() * 256 | 0)
// input bytes - the output has 8/5 as many chars: 640 B -> 1 K, 2560 B -> 4 K, 10 KB -> 16 K, 40 KB -> 64 K chars
const sizes = [16, 64, 256, 640, 1024, 2560, 4096, 10240, 40960]

const results = []
for (const size of sizes) {
    const input = random(size)
    const expected = impls[0][1].bytesToUvy(input)
    for (const [candidate, b] of impls) {
        if (b.bytesToUvy(input) !== expected) throw new Error(`${candidate} disagrees at ${size}B`)
        results.push({ op: "bytesToUvy", input: "", size, candidate, ns: measure(b.bytesToUvy, input) })
    }
}
console.log(format({ engine, results }))
