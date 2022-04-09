// global.window = {}
import * as but from "../output/index.js"
import {getTime, logMem, run, mark} from "micro-bmark"

const constArray =  new Uint8Array(10)
constArray.fill(32)
constArray[9] = 42

const constArrayBuffer = constArray.buffer
const constBuffer = Buffer.from(constArrayBuffer)
const constHex = but.bytesToHex(constArray)
const constUtf8 = "HelloWörld!"

const samples = 1
let result

const buffer = but.utf8ToBytes(constUtf8)
const newstring = but.bytesToUtf8(buffer)
console.log(newstring) 
console.log(constHex)

run(async () => {
    
    // bytesToBigInt
    await mark('bytesToBigInt Uint8Array', samples, () => {
        r = but.bytesToBigInt(constArray)
        console.log(r)
    });

    await mark('bytesToBigInt ArrayBuffer', samples, () => {
        but.bytesToBigInt(constArrayBuffer)
    });

    await mark('bytesToBigInt Buffer', samples, () => {
        but.bytesToBigInt(constBuffer)
    });


    // bytesToHex
    await mark('bytesToHex Uint8Array', samples, () => {
        but.bytesToHex(constArray)
    });

    await mark('bytesToHex ArrayBuffer', samples, () => {
        but.bytesToHex(constArrayBuffer)
    });

    await mark('bytesToHex Buffer', samples, () => {
        but.bytesToHex(constBuffer)
    });


    // HexToBytes
    await mark('hexToBytes', samples, () => {
        but.hexToBytes(constHex)
    });

    // Utf8ToBytes
    await mark('utf8ToBytes', samples, () => {
        but.utf8ToBytes(constUtf8)
    });


    // bytesToUtf8
    await mark('bytesToUtf8 Uint8Array', samples, () => {
        but.bytesToUtf8(constArray)
    });

    await mark('bytesToUtf8 ArrayBuffer', samples, () => {
        but.bytesToUtf8(constArrayBuffer)
    });

    await mark('bytesToUtf8 Buffer', samples, () => {
        but.bytesToUtf8(constBuffer)
    });


    // Log current RAM
    logMem();
   
    // Get current time in nanoseconds
    getTime();
  });
