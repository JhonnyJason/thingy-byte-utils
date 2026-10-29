// The part of node:assert/strict that correctness.test.mjs uses, for browsers
class AssertionError extends Error {}
const fail = (message, detail) => { throw new AssertionError(message ? `${message}: ${detail}` : detail) }
const show = (x) => typeof x == "object" && x ? `${x.constructor?.name}[${Array.from(Object.values(x)).slice(0, 16)}]` : String(x)

// strict like node: same prototype, same own keys, Object.is for primitives
const same = (a, b) => {
    if (Object.is(a, b)) return true
    if (typeof a != "object" || typeof b != "object" || !a || !b) return false
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b) || a.length !== b.length) return false
    const keys = Object.keys(a)
    return keys.length == Object.keys(b).length && keys.every((k) => same(a[k], b[k]))
}

const assert = {
    ok: (value, message) => value || fail(message, `${show(value)} is not truthy`),
    equal: (a, b, message) => Object.is(a, b) || fail(message, `${show(a)} !== ${show(b)}`),
    deepEqual: (a, b, message) => same(a, b) || fail(message, `${show(a)} is not deep-equal to ${show(b)}`),
    match: (s, re, message) => re.test(s) || fail(message, `${show(s)} does not match ${re}`),
    throws: (fn, cls, message) => {
        try { fn() } catch (e) {
            if (typeof cls == "function" && !(e instanceof cls)) fail(message, `threw ${e?.constructor?.name}, expected ${cls.name}`)
            return
        }
        fail(message, "did not throw")
    },
}
export default assert
