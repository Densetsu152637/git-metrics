# TypeScript Git API

The original Git API from
[2025W2-Commitment](https://github.com/Monash-FIT3170/2025W2-Commitment), taken
from `commitment/server/commitment_api` at commit `cc93101` ("Git API V3",
2025-05-30). It was the last TypeScript version before the Haskell rewrite in
August 2025.

In 2025W2-Commitment the API ran inside the Meteor server and was called
directly (`fetchDataFrom(url, notifier)`). Two changes make it comparable with
the Haskell and Rust services:

- **Same contract.** It returns the same `RepositoryData` as the Haskell and Rust
  services: `repoName`, branch names without `origin/`/`remotes/`, the committer
  timestamp as Git prints it (`%cI`), and per-file `diff`, `newLines` and
  `deletedLines` from `git diff-tree -p` instead of whole file contents. It uses
  a bare clone and the same Git commands. Responses are byte-identical to the
  Rust service on the repositories checked so far.
- **HTTP wrapper.** `src/server.ts` exposes it over HTTP so it runs in its own
  container: `POST` any path with `{"url": "..."}` returns
  `{"type":"value","data":...}`, or `{"type":"error","message":"..."}` with status
  `400`, `401` or `500`. `X-Git-Api-Key` must match `GIT_API_TOKEN` when that
  variable is set. `GET /health` answers without authentication. There is no
  WebSocket endpoint and no URL validation.

The rest of the original design is kept, including its concurrency: the
`pLimit` wrapper receives promises that have already started, so it does not
actually limit how many Git processes run at once.

## Running

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

The container is built from `Dockerfile.typescript` in the repository root.
