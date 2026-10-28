// Runs bench.mjs in headless browsers: node testing/bench-browsers.mjs [chromium] [firefox] [manual]
// Serves the bench page, launches the browser, waits for the POSTed results.
import http from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { format } from "./bench.mjs"

const TIMEOUT_MS = 5 * 60 * 1000
const browsers = {
    chromium: (url, dir) => ["chromium", ["--headless=new", "--no-first-run", "--password-store=basic", `--user-data-dir=${dir}`, url]],
    firefox: (url, dir) => ["firefox", ["--headless", "--no-remote", "--profile", dir, url]],
}

const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { run } from "./bench.mjs"
const post = (body) => fetch("/result", { method: "POST", body: JSON.stringify(body) })
run().then(post, (e) => post({ error: String(e) }))
</script>`
const benchSource = await readFile(new URL("./bench.mjs", import.meta.url))

const runIn = async (name) => {
    let deliver
    const result = new Promise((resolve) => deliver = resolve)
    const server = http.createServer((req, res) => {
        // cross-origin isolation gives finer performance.now() resolution
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
        if (req.method == "POST" && req.url == "/result") {
            let body = ""
            req.on("data", (c) => body += c)
            req.on("end", () => { res.end(); deliver(JSON.parse(body)) })
        } else if (req.url == "/bench.mjs") {
            res.setHeader("Content-Type", "text/javascript")
            res.end(benchSource)
        } else if (req.url == "/") {
            res.setHeader("Content-Type", "text/html")
            res.end(page)
        } else {
            res.statusCode = 404
            res.end()
        }
    })
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    const url = `http://127.0.0.1:${server.address().port}/`
    if (name == "manual") {
        console.error(`open ${url} in the browser to benchmark - keep the tab in front`)
        try { return await result } finally { server.close() }
    }
    const profile = await mkdtemp(join(tmpdir(), `bench-${name}-`))
    const [cmd, args] = browsers[name](url, profile)
    // own process group, so the whole browser tree can be killed
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" })
    const timer = setTimeout(() => deliver({ error: `timeout after ${TIMEOUT_MS / 1000}s` }), TIMEOUT_MS)
    try {
        return await result
    } finally {
        clearTimeout(timer)
        try { process.kill(-child.pid) } catch {}
        server.close()
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
}

// "manual": serve and wait - open the printed URL in any browser yourself
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(browsers)
for (const name of names) {
    if (!browsers[name] && name != "manual") throw new Error(`unknown browser: ${name}`)
    console.error(`running in ${name}...`)
    const r = await runIn(name)
    console.log(r.error ? `## ${name}: ${r.error}` : format(r), "\n")
}
