# Changelog for `git-api`

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- Rewrote the service in Rust. The executable name (`git-api`), listeners
  (`0.0.0.0:8081`, plus `/tmp/haskell-ipc.sock` on Unix), HTTP/WebSocket
  protocol, JSON shapes, Git commands and parsing rules are unchanged.
- Container and CI builds use Cargo (`Dockerfile.rust`) instead of GHC/Stack. The CI
  image tag and cache scope are unchanged.
- Cleanup of cloned repositories now also succeeds for read-only Git object
  files on Windows.
- A batch of Git commands is fetched into memory first, then parsed in one
  blocking task per parsing worker (contiguous chunks) instead of one task per
  command. Results and the reported failure still follow input order.

### Fixed

- Repository path segments that become `.` or `..` after removing the `.git`
  suffix (for example `owner/..git`) are rejected instead of resolving to a
  parent directory.

- The repository holds one directory per implementation: this service moved
  to `rust/`, the Haskell service lives on in `haskell/` (and on branch
  `branch/haskell`), and the original TypeScript API is in `typescript/`. The
  Dockerfiles (`Dockerfile.rust`, `Dockerfile.haskell`, `Dockerfile.typescript`)
  stay in the repository root and use it as the build context.

## 0.1.0 - YYYY-MM-DD
