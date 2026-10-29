// Pool block size: speed of the shipped output/ per block size, and memory waste.
// CLI: node|deno|bun testing/bench-pool.mjs
import { measure, format, engine } from "./bench.mjs"

// one module instance per block size, so every pool keeps its own state
const blocks = [0, 2048, 4096, 8192, 16384]
const impls = await Promise.all(blocks.map(async (size) => {
    const b = await import(`../output/index.js?pool${size}`)
    b.setPoolSize(size)
    return [size ? `${size / 1024} KB` : "0 (no pool)", b]
}))

const random = (n) => Uint8Array.from({ length: n }, () => Math.random() * 256 | 0)
const ref = impls[0][1]
const sizes = [16, 64, 256, 1024, 2048, 4096, 8192]
const inputsFor = {
    hexToBytes: (n) => ref.bytesToHex(random(n)),
    uvyToBytes: (n) => ref.bytesToUvy(random(n)),
    bytesToUvy: (n) => random(n), // the pool is only scratch here
    utf8ToBytes: (n) => "Hello World! ".repeat(n).slice(0, n), // ascii: n chars -> n bytes, reserves 3n
}

const same = (a, b) => typeof a == "string" ? a === b : a.length == b.length && a.every((v, i) => v == b[i])

const results = []
for (const [op, make] of Object.entries(inputsFor)) {
    for (const size of sizes) {
        const input = make(size)
        const expected = ref[op](input)
        for (const [candidate, b] of impls) {
            if (!same(b[op](input), expected)) throw new Error(`${op} ${candidate} disagrees at ${size}B`)
            results.push({ op, input: "", size, candidate, ns: measure(b[op], input) })
        }
    }
}
console.log(format({ engine, results }))

// waste does not depend on the engine: the unused tail of a replaced block
// when it is filled with results of one size (8-byte aligned), and what one kept result pins
// odd sizes - powers of two fill every block exactly
const lines = ["\n## waste: unused tail per replaced block (pins = block size)", `  result ${blocks.slice(1).map((b) => `${b / 1024} KB`.padStart(8)).join("")}`]
for (const r of [24, 100, 300, 700, 1500, 3000, 6000]) {
    const cells = blocks.slice(1).map((block) => {
        if (r > block >>> 1) return "own".padStart(8)
        const step = (r + 7) & ~7
        const used = Math.floor((block - r) / step) * step + r // the last result needs no alignment padding
        return `${((block - used) / block * 100).toFixed(1)}%`.padStart(8)
    })
    lines.push(`  ${`${r}B`.padStart(6)} ${cells.join("")}`)
}
console.log(lines.join("\n"))
