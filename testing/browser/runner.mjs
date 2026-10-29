// The part of node:test that correctness.test.mjs uses, for browsers: describe, test (with todo), run
const tests = []
const path = []

export const describe = (name, fn) => {
    path.push(name)
    try { fn() } finally { path.pop() }
}

export const test = (name, opts, fn) => {
    if (typeof opts == "function") [fn, opts] = [opts, {}]
    tests.push({ name: [...path, name].join(" > "), todo: !!opts.todo, fn })
}

// runs every registered test in order - a todo counts as todo whether it passes or not, as in node:test
export const run = async () => {
    const results = []
    for (const t of tests) {
        try {
            await t.fn()
            results.push({ name: t.name, status: t.todo ? "todo" : "pass" })
        } catch (e) {
            results.push({ name: t.name, status: t.todo ? "todo" : "fail", error: String(e?.stack ?? e) })
        }
    }
    return { userAgent: navigator.userAgent, results }
}
