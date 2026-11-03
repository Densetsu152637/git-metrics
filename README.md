# Git Metrics API

An API that clones a Git repository and reports its commits, branches,
contributors, and file changes. It exists in three implementations, one per
directory:

| Directory | Implementation | Status |
| --- | --- | --- |
| [`rust/`](rust/) | Rust (Tokio, axum) | Current. Same HTTP/WebSocket protocol as the Haskell service. |
| [`haskell/`](haskell/) | Haskell (Warp, Stack) | Previous service, kept for comparison and rollback. Also on branch `branch/haskell`. |
| [`typescript/`](typescript/) | TypeScript (Node) | The original API (Git API V3, 2025-05-30) from 2025W2-Commitment, aligned with the same contract and behind a minimal HTTP wrapper (no WebSocket). |

Each directory holds its own sources, README, and licence (plus tests and a changelog for Rust and Haskell).

## Docker images

The Dockerfiles live in this root directory and use it as the build context, so
a project that includes this repository (for example as a submodule at `./api`)
can build any implementation with `context: ./api` and the matching file:

```bash
docker build -f Dockerfile.rust -t git-api:rust .
```

```bash
docker build -f Dockerfile.haskell -t git-api:haskell .
```

```bash
docker build -f Dockerfile.typescript -t git-api:typescript .
```

Every image listens on port 8081 and serves `GET /health`.

## Benchmarks

[`bench/compare.py`](bench/compare.py) runs the Rust and Haskell images one at a
time on `localhost:8080`, sends one request at a time, and records per-repository
times (and, with `--memory`, peak memory). Results are in `bench/results/`.
