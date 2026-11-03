// HTTP entry point for the original TypeScript API. In 2025-Commitment the API
// ran inside the Meteor server; this wrapper only exposes `fetchDataFrom` over
// the same HTTP envelope as the Haskell and Rust services so the three can be
// deployed and compared the same way. The API modules themselves are unchanged.

import http from "http"
import { Subject } from "rxjs"

import { fetchDataFrom } from "./commitment"
import { RepositoryData } from "./types"

const PORT = 8081
const MAX_BODY_BYTES = 8192

type Envelope = { type: "value", data: unknown } | { type: "error", message: string }

// Maps are not JSON serialisable, so they become plain objects keyed like the Map.
const toJson = (data: RepositoryData) => ({
    repoName: data.repoName,
    branches: data.branches,
    allCommits: Object.fromEntries(data.allCommits),
    contributors: Object.fromEntries(data.contributors)
})

const reply = (response: http.ServerResponse, status: number, envelope: Envelope) => {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(envelope))
}

const authorised = (request: http.IncomingMessage): boolean => {
    const expected = process.env.GIT_API_TOKEN
    return expected === undefined || request.headers["x-git-api-key"] === expected
}

const readBody = (request: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
            reject(new Error("Request body too large"))
            request.destroy()
        } else chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
})

const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return reply(response, 200, { type: "value", data: "ok" })
    if (!authorised(request)) return reply(response, 401, { type: "error", message: "Unauthorized" })
    if (request.method !== "POST") return reply(response, 405, { type: "error", message: "Method Not Allowed" })

    let url: unknown
    try {
        url = JSON.parse(await readBody(request)).url
    } catch (e) {
        return reply(response, 400, { type: "error", message: e instanceof Error ? e.message : String(e) })
    }
    if (typeof url !== "string") return reply(response, 400, { type: "error", message: "Expected a JSON body with a string url" })

    try {
        const data = await fetchDataFrom(url, new Subject<string>())
        reply(response, 200, { type: "value", data: toJson(data) })
    } catch (e) {
        reply(response, 500, { type: "error", message: "err: " + (e instanceof Error ? e.message : String(e)) })
    }
})

server.listen(PORT, "0.0.0.0", () => console.log(`git-api (TypeScript) listening on 0.0.0.0:${PORT}`))
