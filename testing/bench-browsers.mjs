// Runs bench.mjs in headless browsers: node testing/bench-browsers.mjs [chromium] [firefox] [manual]
import { runIn, browserNames } from "./browser-runner.mjs"
import { format } from "./bench.mjs"

const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { run } from "/testing/bench.mjs"
const post = (body) => fetch("/result", { method: "POST", body: JSON.stringify(body) })
run().then(post, (e) => post({ error: String(e) }))
</script>`

for (const name of browserNames()) {
    console.error(`running in ${name}...`)
    const r = await runIn(name, page)
    console.log(r.error ? `## ${name}: ${r.error}` : format(r), "\n")
}
