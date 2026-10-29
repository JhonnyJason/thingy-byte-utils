// Runs correctness.test.mjs in headless browsers: node testing/correctness-browsers.mjs [chromium] [firefox] [manual]
// node:test and node:assert/strict are mapped to the shims in testing/browser/
import { runIn, browserNames } from "./browser-runner.mjs"

const page = `<!doctype html><meta charset="utf-8">
<script type="importmap">{ "imports": {
    "node:test": "/testing/browser/runner.mjs",
    "node:assert/strict": "/testing/browser/assert.mjs"
} }</script>
<script type="module">
import { run } from "node:test"
const post = (body) => fetch("/result", { method: "POST", body: JSON.stringify(body) })
import("/testing/correctness.test.mjs").then(run).then(post, (e) => post({ error: String(e?.stack ?? e) }))
</script>`

let failed = false
for (const name of browserNames()) {
    console.error(`testing in ${name}...`)
    const r = await runIn(name, page)
    if (r.error) {
        console.log(`## ${name}: ${r.error}`)
        failed = true
        continue
    }
    const count = (status) => r.results.filter((t) => t.status == status).length
    for (const t of r.results) if (t.status == "fail") console.log(`✖ ${t.name}\n  ${t.error}`)
    console.log(`## ${name} (${r.userAgent}): ${count("pass")} pass, ${count("fail")} fail, ${count("todo")} todo`)
    if (count("fail") || !r.results.length) failed = true
}
process.exitCode = failed ? 1 : 0
