global.window = {}

const but  = require("../output/index.js")
const bench = require("micro-bmark")
const {run, mark} = bench

const constArray =  new Uint8Array(10)
constArray.fill(32)
constArray[9] = 42

const constArrayBuffer = constArray.buffer
const constBuffer = Buffer.from(constArrayBuffer)
const constHex = but.bufferToHex(constArray)
const constUtf8 = "HelloWorld!"

const samples = 1000
let result


run(async () => {
    
    // BufferToBigInt
    await mark('bufferToBigInt Uint8Array', samples, () => {
        but.bufferToBigInt(constArray)
    });

    await mark('bufferToBigInt ArrayBuffer', samples, () => {
        but.bufferToBigInt(constArrayBuffer)
    });

    await mark('bufferToBigInt Buffer', samples, () => {
        but.bufferToBigInt(constBuffer)
    });


    // BufferToHex
    await mark('bufferToHex Uint8Array', samples, () => {
        but.bufferToHex(constArray)
    });

    await mark('bufferToHex ArrayBuffer', samples, () => {
        but.bufferToHex(constArrayBuffer)
    });

    await mark('bufferToHex Buffer', samples, () => {
        but.bufferToHex(constBuffer)
    });


    // HexToBuffer
    await mark('hexToBuffer', samples, () => {
        but.hexToBuffer(constHex)
    });


    // Utf8ToBuffer
    await mark('utf8ToBuffer', samples, () => {
        but.utf8ToBuffer(constUtf8)
    });


    // BufferToUtf8
    await mark('bufferToUtf8 Uint8Array', samples, () => {
        but.bufferToUtf8(constArray)
    });

    await mark('bufferToUtf8 ArrayBuffer', samples, () => {
        but.bufferToUtf8(constArrayBuffer)
    });

    await mark('bufferToUtf8 Buffer', samples, () => {
        but.bufferToUtf8(constBuffer)
    });


    // Log current RAM
    bench.logMem();
   
    // Get current time in nanoseconds
    bench.getTime();
  });
