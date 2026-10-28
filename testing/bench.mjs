// Runtime-agnostic benchmark of candidate implementations.
// CLI: node|deno|bun testing/bench.mjs   - browsers: testing/bench-browsers.mjs
// Uses only standard globals; runtime-specific candidates register when available.

const hasBuffer = typeof globalThis.Buffer == "function"
const hasNativeHex = typeof Uint8Array.prototype.toHex == "function"
const stringDecoder = await import("node:string_decoder").catch(() => null)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

//############################################################
// building blocks of the current implementations
const hexMap = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))
const frontHexMap = new Array(256), backHexMap = new Array(256)
Array.from("0123456789abcdef").forEach((c) => {
    frontHexMap[c] = 16 * parseInt(c, 16)
    backHexMap[c] = parseInt(c, 16)
})
// charCode lookup - candidate for a faster pure-JS fallback
const hexVal = new Uint8Array(128)
Array.from("0123456789abcdef").forEach((c, i) => hexVal[c.charCodeAt(0)] = i)

const asView = (buf) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
const nodeBuf = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)

const jsBytesToHex = (bytes) => {
    let r = ""
    for (let i = 0; i < bytes.length; i++) r += hexMap[bytes[i]]
    return r
}

// manual UTF-8 encoding - candidate against slow TextEncoder calls on V8
// writes into r from offset j, returns the end offset; r needs 3 bytes per UTF-16 unit
const jsUtf8Into = (s, r, j) => {
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i)
        if (c < 0x80) r[j++] = c
        else if (c < 0x800) {
            r[j++] = 0xc0 | c >> 6; r[j++] = 0x80 | c & 63
        } else if (c < 0xdc00 && c >= 0xd800 && (s.charCodeAt(i + 1) & 0xfc00) == 0xdc00) {
            c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00)
            r[j++] = 0xf0 | c >> 18; r[j++] = 0x80 | c >> 12 & 63
            r[j++] = 0x80 | c >> 6 & 63; r[j++] = 0x80 | c & 63
        } else {
            if (c >= 0xd800 && c < 0xe000) c = 0xfffd // lone surrogate, as TextEncoder does
            r[j++] = 0xe0 | c >> 12; r[j++] = 0x80 | c >> 6 & 63; r[j++] = 0x80 | c & 63
        }
    }
    return j
}
const jsUtf8Encode = (s) => {
    const r = new Uint8Array(s.length * 3)
    return r.slice(0, jsUtf8Into(s, r, 0))
}

// Buffer-style pool: small results are views into a shared 8 KB block,
// so V8's ~2 µs off-heap allocation is paid once per block, not per call
const POOL_SIZE = 8192, POOL_MAX = POOL_SIZE >>> 1
let pool = new Uint8Array(POOL_SIZE), poolOffset = 0
const reserve = (n) => {
    // a transferred (detached) pool has length 0 and gets replaced here too
    if (poolOffset + n > pool.length) { pool = new Uint8Array(POOL_SIZE); poolOffset = 0 }
}
const commit = (used) => {
    const r = pool.subarray(poolOffset, poolOffset + used)
    poolOffset = (poolOffset + used + 7) & ~7 // keep 8-byte alignment like Buffer
    return r
}
const hasSetFromHex = typeof Uint8Array.prototype.setFromHex == "function"

const uvyChars = "0123456789abcdefghijklmnoprstuvy"
const uvyVal = new Uint8Array(128)
for (let i = 0; i < 32; i++) uvyVal[uvyChars.charCodeAt(i)] = i
const uvyCodes = Uint8Array.from(uvyChars, (c) => c.charCodeAt(0))
// first idea - string concat, collapses for large inputs on V8
const jsBytesToUvy = (bytes) => {
    let r = "", acc = 0, bits = 0
    for (let i = 0; i < bytes.length; i++) {
        acc = ((acc << 8) | bytes[i]) & 0xfff
        bits += 8
        while (bits >= 5) { bits -= 5; r += uvyChars[(acc >>> bits) & 31] }
    }
    if (bits > 0) r += uvyChars[(acc << (5 - bits)) & 31]
    return r
}

//############################################################
// candidates per operation; "current-*" mirror what output/ ships today
const ops = {
    bytesToHex: {
        "current-browser (table)": jsBytesToHex,
        ...hasBuffer && { "current-node (Buffer)": (b) => Buffer.from(b).toString("hex") },
        ...hasNativeHex && { "native toHex": (b) => b.toHex() },
    },
    hexToBytes: {
        "current (char map)": (hex) => {
            const r = new Uint8Array(hex.length / 2)
            for (let i = 0; i < hex.length; i += 2) r[i / 2] = frontHexMap[hex[i]] + backHexMap[hex[i + 1]]
            return r
        },
        "js charCode": (hex) => {
            const r = new Uint8Array(hex.length >>> 1)
            for (let i = 0, j = 0; j < r.length; i += 2, j++)
                r[j] = (hexVal[hex.charCodeAt(i)] << 4) | hexVal[hex.charCodeAt(i + 1)]
            return r
        },
        ...hasBuffer && { "Buffer.from hex": (hex) => asView(Buffer.from(hex, "hex")) },
        ...hasNativeHex && { "native fromHex": (hex) => Uint8Array.fromHex(hex) },
        "pool js charCode": (hex) => {
            const n = hex.length >>> 1
            if (n > POOL_MAX) return Uint8Array.fromHex(hex)
            reserve(n)
            const r = commit(n)
            for (let i = 0, j = 0; j < n; i += 2, j++)
                r[j] = (hexVal[hex.charCodeAt(i)] << 4) | hexVal[hex.charCodeAt(i + 1)]
            return r
        },
        ...hasSetFromHex && { "pool setFromHex": (hex) => {
            const n = hex.length >>> 1
            if (n > POOL_MAX) return Uint8Array.fromHex(hex)
            reserve(n)
            const r = commit(n)
            r.setFromHex(hex)
            return r
        } },
    },
    utf8ToBytes: {
        "current-browser (TextEncoder)": (s) => encoder.encode(s),
        "TextEncoder encodeInto": (s) => {
            const r = new Uint8Array(s.length * 3)
            return r.slice(0, encoder.encodeInto(s, r).written)
        },
        "js encode": jsUtf8Encode,
        "pool encodeInto": (s) => {
            const max = s.length * 3
            if (max > POOL_MAX) return encoder.encode(s)
            reserve(max)
            return commit(encoder.encodeInto(s, pool.subarray(poolOffset, poolOffset + max)).written)
        },
        "pool js encode": (s) => {
            const max = s.length * 3
            if (max > POOL_MAX) return encoder.encode(s)
            reserve(max)
            return commit(jsUtf8Into(s, pool, poolOffset) - poolOffset)
        },
        ...hasBuffer && {
            "current-node (Buffer+copy)": (s) => new Uint8Array(Buffer.from(s, "utf8")),
            "Buffer view": (s) => asView(Buffer.from(s, "utf8")),
        },
    },
    bytesToUtf8: {
        "current-browser (TextDecoder)": (b) => decoder.decode(b),
        ...stringDecoder && { "current-node (StringDecoder)": (b) => new stringDecoder.StringDecoder("utf-8").end(b) },
        ...hasBuffer && { "Buffer toString": (b) => nodeBuf(b).toString("utf8") },
    },
    bytesToUvy: {
        "js concat": jsBytesToUvy,
        "codes + TextDecoder (shipped)": (bytes) => {
            const n = Math.ceil(bytes.length * 8 / 5)
            let codes
            if (n > POOL_MAX) codes = new Uint8Array(n)
            else { reserve(n); codes = pool.subarray(poolOffset, poolOffset + n) } // scratch, not committed
            let acc = 0, bits = 0, j = 0
            for (let i = 0; i < bytes.length; i++) {
                acc = ((acc << 8) | bytes[i]) & 0xfff
                bits += 8
                while (bits >= 5) { bits -= 5; codes[j++] = uvyCodes[(acc >>> bits) & 31] }
            }
            if (bits > 0) codes[j] = uvyCodes[(acc << (5 - bits)) & 31]
            return decoder.decode(codes)
        },
    },
    uvyToBytes: {
        "pool js accumulator": (uvy) => {
            const n = (uvy.length * 5) >>> 3
            let r
            if (n > POOL_MAX) r = new Uint8Array(n)
            else { reserve(n); r = commit(n) }
            for (let i = 0, j = 0, acc = 0, bits = 0; i < uvy.length; i++) {
                acc = ((acc << 5) | uvyVal[uvy.charCodeAt(i)]) & 0xfff
                bits += 5
                if (bits >= 8) { bits -= 8; r[j++] = acc >>> bits }
            }
            return r
        },
    },
    bytesToBigInt: {
        "current-browser (shift loop)": (b) => {
            let v = 0n
            for (let i = 0; i < b.length; i++) v += BigInt(b[i]) << (8n * BigInt(i))
            return v
        },
        "reverse + js hex": (b) => b.length ? BigInt("0x" + jsBytesToHex(b.slice().reverse())) : 0n,
        ...hasNativeHex && { "reverse + native toHex": (b) => b.length ? BigInt("0x" + b.slice().reverse().toHex()) : 0n },
    },
}

//############################################################
// inputs
const randomBytes = (n) => {
    const r = new Uint8Array(n)
    for (let i = 0; i < n; i += 65536) crypto.getRandomValues(r.subarray(i, i + 65536))
    return r
}
const textOfSize = (unit, n) => {
    let s = unit.repeat(Math.ceil(n / encoder.encode(unit).length))
    while (encoder.encode(s).length > n) s = s.slice(0, -1)
    return s
}
const sizes = [16, 64, 256, 1024, 1024 * 1024]
const inputsFor = {
    bytesToHex: () => sizes.map((n) => ["random", n, randomBytes(n)]),
    hexToBytes: () => sizes.map((n) => ["random", n, jsBytesToHex(randomBytes(n))]),
    utf8ToBytes: () => sizes.flatMap((n) => [
        ["ascii", n, textOfSize("Hello World! ", n)],
        ["mixed", n, textOfSize("HelloWörld! 👋 日本 ", n)],
    ]),
    bytesToUvy: () => sizes.map((n) => ["random", n, randomBytes(n)]),
    uvyToBytes: () => sizes.map((n) => ["random", n, jsBytesToUvy(randomBytes(n))]),
    bytesToUtf8: () => inputsFor.utf8ToBytes().map(([kind, n, s]) => [kind, n, encoder.encode(s)]),
    // shift loop is O(n²) - 1 MB is pointless
    bytesToBigInt: () => [16, 64, 1024].map((n) => ["random", n, randomBytes(n)]),
}

//############################################################
// measurement
let sink
const BATCH_MS = 30, BATCHES = 7

// each candidate gets its own loop code, so its call site stays monomorphic
// like in real use - one shared loop would go megamorphic and skew small inputs
const loopBody = "let r; for (let i = 0; i < iters; i++) r = fn(input); return r"
const measure = (fn, input) => {
    const loop = new Function("fn", "input", "iters", loopBody)
    let iters = 1
    // grow the batch until it takes long enough for coarse browser timers
    for (;;) {
        const t0 = performance.now()
        sink = loop(fn, input, iters)
        if (performance.now() - t0 >= BATCH_MS) break
        iters *= 2
    }
    const perOp = []
    for (let b = 0; b < BATCHES; b++) {
        const t0 = performance.now()
        sink = loop(fn, input, iters)
        perOp.push((performance.now() - t0) * 1e6 / iters)
    }
    perOp.sort((a, b) => a - b)
    return perOp[BATCHES >> 1] // median ns/op
}

const same = (a, b) => {
    if (!(a instanceof Uint8Array)) return a === b
    if (!(b instanceof Uint8Array) || a.length != b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false
    return true
}

export const engine = globalThis.Bun ? `bun ${Bun.version}`
    : globalThis.Deno ? `deno ${Deno.version.deno} (v8 ${Deno.version.v8})`
    : globalThis.process?.versions?.node ? `node ${process.versions.node} (v8 ${process.versions.v8})`
    : navigator.userAgent

export const run = async (log = () => {}) => {
    const results = []
    for (const [op, candidates] of Object.entries(ops)) {
        for (const [input, size, data] of inputsFor[op]()) {
            const entries = Object.entries(candidates)
            const expected = entries[0][1](data)
            for (const [candidate, fn] of entries) {
                // a fast wrong answer is worthless
                if (!same(fn(data), expected)) throw new Error(`${op}/${candidate} disagrees on ${input} ${size}B`)
                const ns = measure(fn, data)
                results.push({ op, input, size, candidate, ns })
                log(`${op} ${input} ${size}B ${candidate}: ${ns.toFixed(0)} ns`)
                await new Promise((r) => setTimeout(r)) // keep browsers responsive
            }
        }
    }
    return { engine, hasNativeHex, results }
}

//############################################################
const fmtSize = (n) => n >= 1048576 ? `${n / 1048576}MB` : n >= 1024 ? `${n / 1024}KB` : `${n}B`
const fmtNs = (ns) => ns >= 1e6 ? `${(ns / 1e6).toFixed(2)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)} µs` : `${ns.toFixed(0)} ns`

export const format = ({ engine, results }) => {
    const lines = [`## ${engine}`]
    const groups = Map.groupBy(results, (r) => `${r.op} ${r.input} ${fmtSize(r.size)}`)
    for (const [title, rows] of groups) {
        const best = Math.min(...rows.map((r) => r.ns))
        lines.push(`\n${title}`)
        for (const r of rows.toSorted((a, b) => a.ns - b.ns)) {
            const mbs = r.size / r.ns * 1e3
            lines.push(`  ${r.candidate.padEnd(32)} ${fmtNs(r.ns).padStart(10)}  ${mbs.toFixed(0).padStart(6)} MB/s  ${(r.ns / best).toFixed(2)}x`)
        }
    }
    return lines.join("\n")
}

if (import.meta.main) console.log(format(await run()))
