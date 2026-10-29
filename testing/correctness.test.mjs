// Correctness tests for every entry point - run: node --test testing/
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import * as nativeImpl from "../output/index.js"

// load a second instance with the native hex functions and isWellFormed hidden, to cover the JS fallbacks
const natives = [
    [Uint8Array.prototype, "toHex"], [Uint8Array.prototype, "setFromHex"], [Uint8Array, "fromHex"],
    [String.prototype, "isWellFormed"],
].map(([obj, key]) => [obj, key, Object.getOwnPropertyDescriptor(obj, key)])
for (const [obj, key] of natives) delete obj[key]
const fallbackImpl = await import("../output/index.js?fallback")
for (const [obj, key, desc] of natives) Object.defineProperty(obj, key, desc)

// a third instance without TextEncoder, TextDecoder and isWellFormed - pre-ES2024 or minimal runtimes
const codecs = [[globalThis, "TextEncoder"], [globalThis, "TextDecoder"], [String.prototype, "isWellFormed"]]
    .map(([obj, key]) => [obj, key, Object.getOwnPropertyDescriptor(obj, key)])
for (const [obj, key] of codecs) delete obj[key]
const noCodecImpl = await import("../output/index.js?nocodec")
for (const [obj, key, desc] of codecs) Object.defineProperty(obj, key, desc)

const impls = { "native": nativeImpl, "fallback": fallbackImpl, "no codec": noCodecImpl }

const u8 = (...bytes) => new Uint8Array(bytes)
// a view with offset into a larger buffer - catches code that ignores byteOffset
const offsetView = (bytes) => {
    const backing = new Uint8Array(bytes.length + 8).fill(0xee)
    backing.set(bytes, 4)
    return backing.subarray(4, 4 + bytes.length)
}
// reference for little-endian bigint
const refBigInt = (bytes) => {
    let v = 0n
    for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i])
    return v
}
// reference for uvy: the big-endian number in base 32, ceil(n * 8 / 5) digits
const uvyRefChars = "0123456789abcdefghijklmnoprstuvy"
const refUvy = (bytes) => {
    if (bytes.length == 0) return ""
    let v = 0n
    for (const x of bytes) v = (v << 8n) | BigInt(x)
    return v.toString(32).split("").map((d) => uvyRefChars[parseInt(d, 32)]).join("")
        .padStart(Math.ceil(bytes.length * 8 / 5), "0")
}
// floor(L * 5 / 8) bytes but at least 1, one more if the number does not fit
const refUvyToBytes = (s) => {
    let v = 0n
    for (const c of s.toLowerCase()) v = v * 32n + BigInt(uvyRefChars.indexOf(c))
    let n = Math.max((s.length * 5) >>> 3, s.length ? 1 : 0)
    if (v >> BigInt(n * 8)) n++
    const r = new Uint8Array(n)
    for (let i = n - 1; i >= 0; i--, v >>= 8n) r[i] = Number(v & 255n)
    return r
}

for (const [name, b] of Object.entries(impls)) {
    describe(name, () => {
        describe("hex", () => {
            test("bytesToHex basic", () => {
                assert.equal(b.bytesToHex(u8(0, 1, 15, 16, 171, 255)), "00010f10abff")
            })
            test("bytesToHex empty", () => assert.equal(b.bytesToHex(u8()), ""))
            test("bytesToHex accepts ArrayBuffer, Buffer, offset view", () => {
                const bytes = u8(0xde, 0xad, 0xbe, 0xef)
                assert.equal(b.bytesToHex(bytes.buffer), "deadbeef")
                assert.equal(b.bytesToHex(Buffer.from(bytes)), "deadbeef")
                assert.equal(b.bytesToHex(offsetView(bytes)), "deadbeef")
            })
            test("hexToBytes basic", () => {
                const r = b.hexToBytes("00010f10abff")
                assert.ok(r instanceof Uint8Array)
                assert.deepEqual([...r], [0, 1, 15, 16, 171, 255])
            })
            test("hexToBytes empty", () => assert.equal(b.hexToBytes("").length, 0))
            test("hexToBytes throws on odd length", () => {
                for (const hex of ["a", "abc", "ab".repeat(5000) + "a"])
                    assert.throws(() => b.hexToBytes(hex), SyntaxError)
            })
            test("hexToBytes throws on invalid chars, small and large", () => {
                const bad = ["g", " ", "x", "0x", "ä", "\x80", "\u0100", "\u0130", "\uff10", "\u{1f44b}"]
                for (const c of bad) {
                    // pad to even length, put the bad char at the start, middle and end
                    const odd = c.length & 1 ? "0" : ""
                    for (const pad of [2, 2 * 5000]) {
                        const fill = "a".repeat(pad)
                        for (const hex of [c + odd + fill, fill + c + odd + fill, fill + odd + c])
                            assert.throws(() => b.hexToBytes(hex), SyntaxError, JSON.stringify(c))
                    }
                }
            })
            test("roundtrip random lengths 0..300", () => {
                for (let n = 0; n <= 300; n++) {
                    const bytes = new Uint8Array(randomBytes(n))
                    const hex = b.bytesToHex(bytes)
                    assert.equal(hex, Buffer.from(bytes).toString("hex"))
                    assert.deepEqual(b.hexToBytes(hex), bytes)
                }
            })
        })

        describe("utf8", () => {
            const text = "HelloWörld! 👋 ∑ 日本"
            const textBytes = new Uint8Array(Buffer.from(text, "utf8"))
            test("utf8ToBytes multi-byte", () => {
                const r = b.utf8ToBytes(text)
                assert.ok(r instanceof Uint8Array)
                assert.deepEqual(r, textBytes)
            })
            test("utf8ToBytes empty", () => assert.equal(b.utf8ToBytes("").length, 0))
            test("bytesToUtf8 accepts Uint8Array, ArrayBuffer, Buffer, offset view", () => {
                assert.equal(b.bytesToUtf8(textBytes), text)
                assert.equal(b.bytesToUtf8(textBytes.slice().buffer), text)
                assert.equal(b.bytesToUtf8(Buffer.from(textBytes)), text)
                assert.equal(b.bytesToUtf8(offsetView(textBytes)), text)
            })
            test("bytesToUtf8 empty", () => assert.equal(b.bytesToUtf8(u8()), ""))
            test("decoder keeps no state between calls", () => {
                // a dangling partial char must not leak into the next call
                assert.throws(() => b.bytesToUtf8(u8(0xc3)), TypeError)
                assert.equal(b.bytesToUtf8(u8(0x41)), "A")
            })
            test("bytesToUtf8 throws on invalid UTF-8", () => {
                const bad = {
                    "overlong 2-byte": [0xc0, 0x80], "overlong 2-byte c1": [0xc1, 0xbf],
                    "overlong 3-byte": [0xe0, 0x80, 0x80], "overlong 4-byte": [0xf0, 0x80, 0x80, 0x80],
                    "truncated 2-byte": [0xc3], "truncated 3-byte": [0xe2, 0x82], "truncated 4-byte": [0xf0, 0x9f, 0x91],
                    "encoded high surrogate": [0xed, 0xa0, 0x80], "encoded low surrogate": [0xed, 0xbf, 0xbf],
                    "above U+10FFFF": [0xf4, 0x90, 0x80, 0x80], "f5 lead": [0xf5, 0x80, 0x80, 0x80], "ff": [0xff],
                    "lone continuation": [0x80], "lead then ascii": [0xc3, 0x41],
                }
                for (const [label, bytes] of Object.entries(bad)) {
                    for (const wrap of [(x) => x, (x) => [0x41, ...x, 0x41], (x) => [...Array(5000).fill(0x41), ...x]])
                        assert.throws(() => b.bytesToUtf8(u8(...wrap(bytes))), TypeError, label)
                }
            })
            test("bytesToUtf8 decodes the limits", () => {
                const s = "\x00\x7f\x80\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}"
                assert.equal(b.bytesToUtf8(new Uint8Array(Buffer.from(s, "utf8"))), s)
            })
            test("a leading BOM survives both ways", () => {
                const bom = u8(0xef, 0xbb, 0xbf, 0x41)
                assert.equal(b.bytesToUtf8(bom), "\ufeffA")
                assert.deepEqual(b.utf8ToBytes("\ufeffA"), bom)
            })
        })

        describe("uvy", () => {
            const alphabet = "0123456789abcdefghijklmnoprstuvy"
            test("known vectors", () => {
                assert.equal(b.bytesToUvy(u8()), "")
                assert.equal(b.bytesToUvy(u8(0)), "00")
                assert.equal(b.bytesToUvy(u8(0xff)), "7y")
                assert.equal(b.bytesToUvy(u8(0, 0, 0, 0, 1)), "00000001")
                assert.equal(b.bytesToUvy(u8(0xff, 0xff, 0xff, 0xff, 0xff)), "yyyyyyyy")
                assert.equal(b.bytesToUvy(u8(0x00, 0x44, 0x32, 0x14, 0xc7)), "01234567")
                assert.deepEqual([...b.uvyToBytes("7y")], [0xff])
                assert.deepEqual([...b.uvyToBytes("01234567")], [0x00, 0x44, 0x32, 0x14, 0xc7])
                assert.equal(b.uvyToBytes("").length, 0)
            })
            test("bytesToUvy matches the reference for lengths 0..11", () => {
                for (let n = 0; n <= 11; n++) {
                    for (const bytes of [new Uint8Array(n), new Uint8Array(n).fill(0xff), new Uint8Array(randomBytes(n))])
                        assert.equal(b.bytesToUvy(bytes), refUvy(bytes), `${n} bytes`)
                }
            })
            test("README table: decoding any uvy string", () => {
                const table = [
                    ["", [], ""], ["7y", [0xff], "7y"], ["8y", [0x01, 0x1f], "008y"], ["y", [0x1f], "0y"],
                    ["0", [0x00], "00"], ["000", [0x00], "00"], ["07y", [0xff], "7y"], ["007y", [0x00, 0xff], "007y"],
                    ["8Y", [0x01, 0x1f], "008y"], ["008y", [0x01, 0x1f], "008y"],
                ]
                for (const [s, bytes, canonical] of table) {
                    const r = b.uvyToBytes(s)
                    assert.deepEqual([...r], bytes, JSON.stringify(s))
                    assert.equal(b.bytesToUvy(r), canonical, JSON.stringify(s))
                }
            })
            test("every length decodes by the rule: all 0, all y, random chars", () => {
                for (let len = 0; len <= 40; len++) {
                    const random = Array.from(randomBytes(len), (x) => alphabet[x & 31]).join("")
                    for (const s of ["0".repeat(len), "y".repeat(len), random]) {
                        const r = b.uvyToBytes(s)
                        assert.deepEqual(r, refUvyToBytes(s), JSON.stringify(s))
                        // the canonical form round-trips exactly
                        const canonical = b.bytesToUvy(r)
                        assert.equal(canonical, refUvy(r))
                        assert.deepEqual(b.uvyToBytes(canonical), r)
                    }
                }
            })
            test("uvyToBytes accepts upper case", () => {
                assert.deepEqual(b.uvyToBytes(alphabet.toUpperCase()), b.uvyToBytes(alphabet))
                assert.deepEqual(b.uvyToBytes("YyYyYyYy"), u8(0xff, 0xff, 0xff, 0xff, 0xff))
            })
            test("uvyToBytes throws on invalid chars, small and large", () => {
                const bad = ["q", "w", "x", "z", "Q", "W", "X", "Z", " ", "-", "ä", "\x80", "Ā", "İ", "\u{1f44b}"]
                for (const c of bad) {
                    for (const fill of ["0".repeat(7), "0".repeat(8000)]) {
                        for (const s of [c, c + fill, fill + c + fill, fill + c])
                            assert.throws(() => b.uvyToBytes(s), SyntaxError, `${JSON.stringify(c)} ${s.length}`)
                    }
                }
            })
            test("alphabet order: 20 bytes hold the digits 0..31 in sequence", () => {
                const bytes = b.uvyToBytes(alphabet)
                assert.equal(bytes.length, 20)
                assert.equal(b.bytesToUvy(bytes), alphabet)
                // digit values match hex: 0x01 0x23 ... as 5-bit groups
                assert.equal(b.bytesToHex(bytes.subarray(0, 5)), "00443214c7")
            })
            test("accepts ArrayBuffer, Buffer, offset view", () => {
                const bytes = u8(0x00, 0x44, 0x32, 0x14, 0xc7)
                assert.equal(b.bytesToUvy(bytes.slice().buffer), "01234567")
                assert.equal(b.bytesToUvy(Buffer.from(bytes)), "01234567")
                assert.equal(b.bytesToUvy(offsetView(bytes)), "01234567")
            })
            test("roundtrip lengths 0..300 and above the pool limit", () => {
                for (const n of [...Array(301).keys(), 4095, 4096, 4097, 20000]) {
                    const bytes = new Uint8Array(randomBytes(n))
                    const uvy = b.bytesToUvy(bytes)
                    assert.equal(uvy.length, Math.ceil(n * 8 / 5))
                    assert.match(uvy, /^[0-9a-pr-vy]*$/)
                    assert.deepEqual(b.uvyToBytes(uvy), bytes)
                }
            })
        })

        describe("bigint (little-endian)", () => {
            test("byte order", () => {
                assert.equal(b.bytesToBigInt(u8(1, 0)), 1n)
                assert.equal(b.bytesToBigInt(u8(0, 1)), 256n)
                assert.equal(b.bytesToBigInt(u8(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)), 2n ** 72n - 1n)
            })
            test("empty is 0n", () => {
                assert.equal(b.bytesToBigInt(u8()), 0n)
            })
            test("accepts ArrayBuffer, Buffer, offset view", () => {
                const bytes = u8(1, 2, 3)
                assert.equal(b.bytesToBigInt(bytes.slice().buffer), 0x030201n)
                assert.equal(b.bytesToBigInt(Buffer.from(bytes)), 0x030201n)
                assert.equal(b.bytesToBigInt(offsetView(bytes)), 0x030201n)
            })
            test("does not mutate the input", () => {
                const bytes = u8(1, 2, 3)
                b.bytesToBigInt(bytes.buffer)
                assert.deepEqual([...bytes], [1, 2, 3])
            })
            test("no bytes-taking function mutates its input, small and large", () => {
                for (const n of [3, 5000]) {
                    const bytes = new Uint8Array(Buffer.from("héllo".repeat(n)))
                    const copy = bytes.slice()
                    for (const fn of [b.bytesToHex, b.bytesToUtf8, b.bytesToUvy, b.bytesToBigInt]) {
                        fn(bytes)
                        fn(offsetView(bytes))
                        assert.deepEqual(bytes, copy, fn.name)
                    }
                }
            })
            test("random lengths 1..300 match reference", () => {
                for (let n = 1; n <= 300; n++) {
                    const bytes = new Uint8Array(randomBytes(n))
                    assert.equal(b.bytesToBigInt(bytes), refBigInt(bytes))
                }
            })
        })

        describe("size paths", () => {
            test("hex above the pool limit (4 KB)", () => {
                for (const n of [4095, 4096, 4097, 20000]) {
                    const bytes = new Uint8Array(randomBytes(n))
                    assert.deepEqual(b.hexToBytes(b.bytesToHex(bytes)), bytes)
                }
            })
            test("hexToBytes accepts upper case", () => {
                assert.deepEqual([...b.hexToBytes("DEADbeef")], [0xde, 0xad, 0xbe, 0xef])
            })
            test("utf8 across JS encoder / encodeInto / encode thresholds", () => {
                for (const n of [1, 31, 32, 33, 1365, 1366, 5000]) {
                    for (const unit of ["a", "ö", "日", "👋"]) {
                        const s = unit.repeat(n).slice(0, n).toWellFormed() // an odd cut through 👋 leaves a lone surrogate
                        assert.deepEqual(b.utf8ToBytes(s), new Uint8Array(Buffer.from(s, "utf8")), `${unit} x${n}`)
                    }
                }
            })
        })

        describe("utf8ToBytes edge chars", () => {
            const valid = {
                "boundaries": "\x00\x7f\x80\u07ff\u0800\uffff\u{10000}\u{10ffff}",
                "around surrogates": "\ud7ff\ue000",
            }
            const lone = {
                "lone high surrogate": "\ud800",
                "lone low surrogate": "\udc00",
                "reversed pair": "\udc00\ud800",
                "two high then low": "\ud800\ud800\udc00",
                "high then high": "\ud83d\ud83d",
            }
            // 1 char: JS encoder, 40: encodeInto, 2000: encode (above the pool limit)
            const fills = [0, 40, 2000].map((n) => "a".repeat(n))
            for (const [label, s] of Object.entries(valid)) {
                test(label, () => {
                    for (const f of fills) assert.deepEqual(b.utf8ToBytes(f + s), new Uint8Array(Buffer.from(f + s, "utf8")))
                })
            }
            for (const [label, s] of Object.entries(lone)) {
                test(`${label} throws at start, middle and end`, () => {
                    for (const f of fills) for (const str of [s + f, f + s + f, f + s])
                        assert.throws(() => b.utf8ToBytes(str), TypeError, `${label} ${str.length}`)
                })
            }
        })

        describe("pool", () => {
            test("kept results never change", () => {
                const kept = []
                // enough calls to fill several 8 KB blocks
                for (let i = 0; i < 3000; i++) {
                    const hex = (i * 2654435761 >>> 0).toString(16).padStart(8, "0")
                    kept.push([hex, b.hexToBytes(hex), `s${i}`, b.utf8ToBytes(`s${i}`)])
                }
                for (const [hex, bytes, s, sBytes] of kept) {
                    assert.equal(b.bytesToHex(bytes), hex)
                    assert.equal(b.bytesToUtf8(sBytes), s)
                }
            })
            test("results are aligned views that do not overlap", () => {
                const r1 = b.hexToBytes("010203")
                const r2 = b.hexToBytes("040506")
                if (r1.buffer === r2.buffer) {
                    assert.equal(r2.byteOffset % 8, 0)
                    assert.ok(r2.byteOffset >= r1.byteOffset + r1.length)
                }
                assert.deepEqual([...r1], [1, 2, 3])
                // writing to one result changes only that result
                r1.fill(0xff)
                assert.deepEqual([...r2], [4, 5, 6])
                assert.deepEqual([...b.hexToBytes("070809")], [7, 8, 9])
            })
            test("a detached pool recovers", () => {
                const r = b.hexToBytes("aabb")
                structuredClone(r.buffer, { transfer: [r.buffer] })
                assert.equal(r.length, 0) // the view is gone with its block
                assert.deepEqual([...b.hexToBytes("ccdd")], [0xcc, 0xdd])
                assert.deepEqual(b.utf8ToBytes("héllo"), new Uint8Array(Buffer.from("héllo")))
            })
            test("a detached pool recovers for an empty result at offset 0", () => {
                b.setPoolSize(8192)
                const r = b.hexToBytes("")
                structuredClone(r.buffer, { transfer: [r.buffer] })
                assert.equal(b.hexToBytes("").length, 0)
                assert.deepEqual([...b.hexToBytes("ab")], [0xab])
            })
        })

        describe("setPoolSize", () => {
            // every decoder, small and large, compared with Buffer
            const decodeAll = (n) => {
                const bytes = new Uint8Array(randomBytes(n))
                const s = Buffer.from(bytes).toString("base64")
                return [
                    [b.hexToBytes(b.bytesToHex(bytes)), bytes],
                    [b.uvyToBytes(b.bytesToUvy(bytes)), bytes],
                    [b.utf8ToBytes(s), new Uint8Array(Buffer.from(s))],
                ]
            }
            const withSize = (size, fn) => {
                try { b.setPoolSize(size); fn() } finally { b.setPoolSize(8192) }
            }
            test("results stay unchanged after setPoolSize", () => {
                const kept = decodeAll(16)
                const copies = kept.map(([r]) => r.slice())
                for (const size of [0, 64, 65536, 8192]) {
                    b.setPoolSize(size)
                    decodeAll(16)
                }
                kept.forEach(([r], i) => assert.deepEqual(r, copies[i]))
            })
            test("sizes 0, 64, 64 KB and odd sizes work across the pool limit", () => {
                for (const size of [0, 1, 63, 64, 65536]) withSize(size, () => {
                    for (const n of [0, 1, 15, 31, 32, 33, 100, 5000, 40000]) {
                        for (const [r, expected] of decodeAll(n)) assert.deepEqual(r, expected, `size ${size} n ${n}`)
                    }
                })
            })
            test("results above half the block size get their own buffer", () => {
                withSize(64, () => {
                    for (const [r] of decodeAll(33)) assert.equal(r.buffer.byteLength, r.length)
                    const small = b.hexToBytes("aabb")
                    assert.equal(small.buffer.byteLength, 64)
                })
            })
            test("0 never returns a view of a shared buffer, not even for empty results", () => {
                withSize(0, () => {
                    const results = [...decodeAll(0), ...decodeAll(1), ...decodeAll(8)].map(([r]) => r)
                    results.push(b.hexToBytes(""), b.uvyToBytes(""), b.utf8ToBytes(""))
                    for (const r of results) assert.equal(r.buffer.byteLength, r.length)
                    assert.equal(new Set(results.map((r) => r.buffer)).size, results.length)
                })
            })
        })
    })
}
