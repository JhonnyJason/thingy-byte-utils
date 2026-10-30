// Type check of output/index.d.ts - run: see README.md "Types"
// not a test file name on purpose: node --test testing/ would run it
import * as t from "../output/index.js"
import { UnsafeMemPooled, type Bytes } from "../output/index.js"

const bytes = new Uint8Array(4)
const inputs: Bytes[] = [bytes, bytes.buffer, new SharedArrayBuffer(4), new Uint8Array(new SharedArrayBuffer(4)), bytes.subarray(1)]
for (const b of inputs) {
    const s: string = t.bytesToHex(b) + t.bytesToUtf8(b) + t.bytesToUvy(b)
    const n: bigint = t.bytesToBigInt(b)
}

// results own a plain ArrayBuffer, so they are a BufferSource for WebCrypto
const own: ArrayBuffer = t.hexToBytes("aa").buffer
crypto.subtle.digest("SHA-256", t.utf8ToBytes("x"))
crypto.subtle.digest("SHA-256", t.uvyToBytes("7y"))

const pooled = new UnsafeMemPooled()
new UnsafeMemPooled(64)
const { hexToBytes, bytesToBigInt } = pooled
const p: Uint8Array<ArrayBuffer> = hexToBytes("aa")
const n: bigint = bytesToBigInt(p)

// @ts-expect-error strings are not bytes
t.bytesToHex("aa")
// @ts-expect-error number arrays are not bytes
t.bytesToUtf8([1, 2])
// @ts-expect-error bytes are not a string
t.hexToBytes(bytes)
// @ts-expect-error the size is a number of KB
new UnsafeMemPooled("8")
// @ts-expect-error removed in 0.2.0
t.setPoolSize(0)
