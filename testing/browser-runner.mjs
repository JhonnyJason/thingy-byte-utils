// Runs a page in a headless browser and waits for the result it POSTs to /result.
// Serves the page at / and the files under testing/ and output/ at their project paths.
import http from "node:http"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TIMEOUT_MS = 5 * 60 * 1000
const root = new URL("../", import.meta.url)
export const browsers = {
    chromium: (url, dir) => ["chromium", ["--headless=new", "--no-first-run", "--password-store=basic", `--user-data-dir=${dir}`, url]],
    firefox: (url, dir) => ["firefox", ["--headless", "--no-remote", "--profile", dir, url]],
}

// "manual": serve and wait - open the printed URL in any browser yourself
export const runIn = async (name, page) => {
    if (!browsers[name] && name != "manual") throw new Error(`unknown browser: ${name}`)
    let deliver
    const result = new Promise((resolve) => deliver = resolve)
    const server = http.createServer(async (req, res) => {
        // cross-origin isolation gives finer performance.now() resolution
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
        // the query only makes separate module instances (e.g. index.js?fallback)
        const path = new URL(req.url, "http://x").pathname
        const file = new URL("." + path, root)
        if (req.method == "POST" && path == "/result") {
            let body = ""
            req.on("data", (c) => body += c)
            req.on("end", () => { res.end(); deliver(JSON.parse(body)) })
        } else if (path == "/") {
            res.setHeader("Content-Type", "text/html")
            res.end(page)
        } else if (file.href.startsWith(root.href) && /^(testing|output)\/[^/]+(\/[^/]+)?\.m?js$/.test(file.href.slice(root.href.length))) {
            try {
                const data = await readFile(file)
                res.setHeader("Content-Type", "text/javascript")
                res.end(data)
            } catch {
                res.statusCode = 404
                res.end()
            }
        } else {
            res.statusCode = 404
            res.end()
        }
    })
    await new Promise((r) => server.listen(0, "127.0.0.1", r))
    const url = `http://127.0.0.1:${server.address().port}/`
    if (name == "manual") {
        console.error(`open ${url} in the browser - keep the tab in front`)
        try { return await result } finally { server.close() }
    }
    const profile = await mkdtemp(join(tmpdir(), `${name}-`))
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

// the browsers named on the command line, or all of them
export const browserNames = () => process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(browsers)
