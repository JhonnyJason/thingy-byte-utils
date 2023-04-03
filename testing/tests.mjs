// global.window = {}
import * as but from "../output/index.js"
import * as bench from "micro-bmark"

const constArray =  new Uint8Array(10)
constArray.fill(32)
constArray[9] = 42

const constArrayBuffer = constArray.buffer
const constBuffer = Buffer.from(constArrayBuffer)
const constHex = but.bytesToHex(constArray)
const constUtf8 = "HelloWörld!"

const samples = 10000000
let result

const buffer = but.utf8ToBytes(constUtf8)
const newstring = but.bytesToUtf8(buffer)
console.log(newstring) 
console.log(constHex)

bench.run(async () => {
    
    // // bytesToBigInt
    // await bench.mark('bytesToBigInt Uint8Array', samples, () => {
    //     but.bytesToBigInt(constArray)
    // });

    // await bench.mark('bytesToBigInt ArrayBuffer', samples, () => {
    //     but.bytesToBigInt(constArrayBuffer)
    // });

    // await bench.mark('bytesToBigInt Buffer', samples, () => {
    //     but.bytesToBigInt(constBuffer)
    // });


    // Utf8ToBytes
    await bench.mark('utf8ToBytes', samples, () => {
        but.utf8ToBytes(constUtf8)
    });


    // // bytesToUtf8
    // await bench.mark('bytesToUtf8 Uint8Array', samples, () => {
    //     but.bytesToUtf8(constArray)
    // });


    // // bytesToHex
    // await bench.mark('bytesToHex Uint8Array', samples, () => {
    //     but.bytesToHex(constArray)
    // });

    // await bench.mark('bytesToHex ArrayBuffer', samples, () => {
    //     but.bytesToHex(constArrayBuffer)
    // });

    // await bench.mark('bytesToHex Buffer', samples, () => {
    //     but.bytesToHex(constBuffer)
    // });


    // HexToBytes
    await bench.mark('hexToBytes', samples, () => {
        but.hexToBytes(constHex)
    });
    

    // await bench.mark('bytesToUtf8 ArrayBuffer', samples, () => {
    //     but.bytesToUtf8(constArrayBuffer)
    // });

    // await bench.mark('bytesToUtf8 Buffer', samples, () => {
    //     but.bytesToUtf8(constBuffer)
    // });


    // Log current RAM
    bench.utils.logMem();
   
    // Get current time in nanoseconds
    bench.utils.getTime();
  });
