// Correctness tests for every entry point - run: node --test testing/
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import * as nativeImpl from "../output/index.js"

// load a second instance with the native hex functions hidden, to cover the JS fallbacks
const natives = [
    [Uint8Array.prototype, "toHex"], [Uint8Array.prototype, "setFromHex"], [Uint8Array, "fromHex"],
].map(([obj, key]) => [obj, key, Object.getOwnPropertyDescriptor(obj, key)])
for (const [obj, key] of natives) delete obj[key]
const fallbackImpl = await import("../output/index.js?fallback")
for (const [obj, key, desc] of natives) Object.defineProperty(obj, key, desc)

const impls = { "native": nativeImpl, "fallback": fallbackImpl }

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
                b.bytesToUtf8(u8(0xc3))
                assert.equal(b.bytesToUtf8(u8(0x41)), "A")
            })
        })

        describe("uvy", () => {
            const alphabet = "0123456789abcdefghijklmnoprstuvy"
            test("known vectors", () => {
                assert.equal(b.bytesToUvy(u8()), "")
                assert.equal(b.bytesToUvy(u8(0)), "00")
                assert.equal(b.bytesToUvy(u8(0xff)), "yt")
                assert.equal(b.bytesToUvy(u8(0xff, 0xff, 0xff, 0xff, 0xff)), "yyyyyyyy")
                assert.equal(b.bytesToUvy(u8(0x00, 0x44, 0x32, 0x14, 0xc7)), "01234567")
                assert.deepEqual([...b.uvyToBytes("yt")], [0xff])
                assert.deepEqual([...b.uvyToBytes("01234567")], [0x00, 0x44, 0x32, 0x14, 0xc7])
                assert.equal(b.uvyToBytes("").length, 0)
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
            test("uvyToBytes throws on impossible lengths", () => {
                for (const len of [1, 3, 6, 9, 11, 14]) assert.throws(() => b.uvyToBytes("0".repeat(len)), SyntaxError)
                for (const len of [0, 2, 4, 5, 7, 8]) assert.equal(b.uvyToBytes("0".repeat(len)).length, (len * 5) >>> 3)
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
                        const s = unit.repeat(n).slice(0, n)
                        assert.deepEqual(b.utf8ToBytes(s), new Uint8Array(Buffer.from(s, "utf8")), `${unit} x${n}`)
                    }
                }
            })
        })

        describe("JS UTF-8 encoder edge chars", () => {
            const encoder = new TextEncoder()
            const cases = {
                "boundaries": "\x00\x7f\x80\u07ff\u0800\uffff\u{10000}\u{10ffff}",
                "lone high surrogate": "a\ud800b",
                "lone low surrogate": "a\udc00b",
                "trailing high surrogate": "ab\ud83d",
                "reversed pair": "\udc00\ud800",
                "two high then low": "\ud800\ud800\udc00",
                "around surrogates": "\ud7ff\ue000",
            }
            for (const [label, s] of Object.entries(cases)) {
                test(label, () => assert.deepEqual(b.utf8ToBytes(s), encoder.encode(s)))
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
            })
            test("a detached pool recovers", () => {
                const r = b.hexToBytes("aabb")
                structuredClone(r.buffer, { transfer: [r.buffer] })
                assert.equal(r.length, 0) // the view is gone with its block
                assert.deepEqual([...b.hexToBytes("ccdd")], [0xcc, 0xdd])
                assert.deepEqual(b.utf8ToBytes("héllo"), new Uint8Array(Buffer.from("héllo")))
            })
        })
    })
}
