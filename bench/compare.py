"""Times the Rust and Haskell git-api containers on the same public repositories.

Each implementation runs alone in a container published on localhost:8080, and
every repository is analysed over HTTP, one request at a time.

    python bench/compare.py [--set small|large|all] [--runs N] [--memory] [--out DIR]

With --memory every request gets a fresh container, so the peaks read after
the request belong to it alone and nothing samples the container while the
request runs:
    service_peak_rss_mb    VmHWM of the git-api process (PID 1), without Git
    container_peak_mb      cgroup memory.peak: git-api, its Git children and
                           page cache from the clone

Images are expected to be built already:
    git-api-bench:rust     (docker build -t git-api-bench:rust .)
    git-api-bench:haskell  (Dockerfile.haskell from branch/haskell)
"""

import argparse
import csv
import hashlib
import json
import secrets
import socket
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = 8080
CONTAINER = "git-api-bench"
IMAGES = {"rust": "git-api-bench:rust", "haskell": "git-api-bench:haskell"}
REQUEST_TIMEOUT = 1800

# Small to medium public repositories. The services cap a clone at 10 seconds,
# so very large histories are left out.
REPOSITORIES = [
    "https://github.com/octocat/Hello-World",
    "https://github.com/kelseyhightower/nocode",
    "https://github.com/jonschlinkert/is-number",
    "https://github.com/expressjs/cors",
    "https://github.com/chalk/chalk",
    "https://github.com/pallets/itsdangerous",
    "https://github.com/dtolnay/anyhow",
    "https://github.com/sindresorhus/got",
    "https://github.com/serde-rs/json",
    "https://github.com/BurntSushi/ripgrep",
]

# Larger histories (roughly 3k to 9k commits) whose bare clones still fit the
# 10-second clone limit on a typical connection.
LARGE_REPOSITORIES = [
    "https://github.com/pallets/click",
    "https://github.com/junegunn/fzf",
    "https://github.com/tokio-rs/tokio",
    "https://github.com/pallets/flask",
    "https://github.com/expressjs/express",
    "https://github.com/psf/requests",
    "https://github.com/clap-rs/clap",
]

REPOSITORY_SETS = {
    "small": REPOSITORIES,
    "large": LARGE_REPOSITORIES,
    "all": REPOSITORIES + LARGE_REPOSITORIES,
}


def docker(*arguments: str, check: bool = True) -> str:
    completed = subprocess.run(
        ["docker", *arguments], capture_output=True, text=True, check=False
    )
    if check and completed.returncode != 0:
        raise RuntimeError(f"docker {' '.join(arguments)}: {completed.stderr.strip()}")
    return completed.stdout.strip()


def start(image: str, token: str) -> None:
    docker("rm", "-f", CONTAINER, check=False)
    docker(
        "run", "-d", "--name", CONTAINER, "-p", f"{PORT}:8081",
        "-e", f"GIT_API_TOKEN={token}", image,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                pass
            request = urllib.request.Request(
                f"http://127.0.0.1:{PORT}/", method="GET",
                headers={"X-Git-Api-Key": token},
            )
            try:
                urllib.request.urlopen(request, timeout=2).close()
            except urllib.error.HTTPError:
                pass  # Any HTTP answer means the server is accepting requests.
            return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f"{image} did not start listening on port {PORT}")


def read_memory() -> dict:
    """Memory of the running container, in MiB."""
    output = docker(
        "exec", CONTAINER, "sh", "-c",
        "cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak; "
        "grep -E '^(VmRSS|VmHWM):' /proc/1/status",
    ).splitlines()
    status = {line.split(":")[0]: int(line.split()[1]) for line in output[2:]}
    return {
        "container_current_mb": round(int(output[0]) / 2**20, 1),
        "container_peak_mb": round(int(output[1]) / 2**20, 1),
        "service_rss_mb": round(status["VmRSS"] / 1024, 1),
        "service_peak_rss_mb": round(status["VmHWM"] / 1024, 1),
    }


def stop() -> None:
    docker("rm", "-f", CONTAINER, check=False)


def analyse(url: str, token: str) -> dict:
    body = json.dumps({"url": url}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/", data=body, method="POST",
        headers={"Content-Type": "application/json", "X-Git-Api-Key": token},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    seconds = time.perf_counter() - started

    record = {"seconds": round(seconds, 3), "status": status, "commits": "", "digest": "", "core_digest": "", "error": ""}
    try:
        envelope = json.loads(raw)
    except ValueError:
        record["error"] = raw[:200].decode(errors="replace")
        return record
    if envelope.get("type") == "value":
        data = envelope["data"]
        record["commits"] = len(data.get("allCommits", data.get("all_commits", {})))
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        record["digest"] = hashlib.sha256(canonical).hexdigest()[:16]
        # Everything except contributors: the Haskell service finds no emails
        # for non-ASCII author names, which would otherwise mask other changes.
        core = {key: value for key, value in data.items() if key != "contributors"}
        canonical = json.dumps(core, sort_keys=True, separators=(",", ":")).encode()
        record["core_digest"] = hashlib.sha256(canonical).hexdigest()[:16]
    else:
        record["error"] = str(envelope.get("message", ""))[:200].replace("\n", " ")
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=REPOSITORY_SETS, default="small")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--memory", action="store_true")
    parser.add_argument("--out", type=Path, default=Path(__file__).with_name("results"))
    arguments = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    arguments.out.mkdir(parents=True, exist_ok=True)
    repositories = REPOSITORY_SETS[arguments.set]

    token = secrets.token_hex(32)
    rows = []
    for language, image in IMAGES.items():
        print(f"== {language} ({image})", flush=True)
        start(image, token)
        try:
            for url in repositories:
                for run in range(1, arguments.runs + 1):
                    if arguments.memory:
                        start(image, token)
                        idle = read_memory()
                    record = analyse(url, token)
                    if arguments.memory:
                        used = read_memory()
                        record.update(
                            idle_service_rss_mb=idle["service_rss_mb"],
                            idle_container_mb=idle["container_current_mb"],
                            service_peak_rss_mb=used["service_peak_rss_mb"],
                            container_peak_mb=used["container_peak_mb"],
                        )
                    rows.append({"language": language, "repository": url, "run": run, **record})
                    memory = (
                        f" rss peak {record['service_peak_rss_mb']}MiB"
                        f" container peak {record['container_peak_mb']}MiB"
                        if arguments.memory
                        else ""
                    )
                    print(
                        f"{language:8} {url:50} run {run}: {record['seconds']:8.3f}s{memory} "
                        f"status {record['status']} commits {record['commits']} {record['error']}",
                        flush=True,
                    )
        finally:
            stop()

    suffix = f"{arguments.set}-memory" if arguments.memory else arguments.set
    runs_path = arguments.out / f"runs-{suffix}.csv"
    summary_path = arguments.out / f"summary-{suffix}.csv"
    with runs_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    summary = []
    for url in repositories:
        entry = {"repository": url}
        for language in IMAGES:
            runs = [r for r in rows if r["language"] == language and r["repository"] == url]
            ok = [r["seconds"] for r in runs if r["status"] == 200]
            entry[f"{language}_median_s"] = round(statistics.median(ok), 3) if ok else ""
            entry[f"{language}_ok_runs"] = len(ok)
            if arguments.memory:
                for column in ("service_peak_rss_mb", "container_peak_mb"):
                    peaks = [r[column] for r in runs if r["status"] == 200]
                    entry[f"{language}_{column}"] = statistics.median(peaks) if peaks else ""
            entry[f"{language}_commits"] = next((r["commits"] for r in runs if r["commits"] != ""), "")
            entry[f"{language}_digest"] = next((r["digest"] for r in runs if r["digest"]), "")
            entry[f"{language}_core_digest"] = next(
                (r["core_digest"] for r in runs if r["core_digest"]), ""
            )
        summary.append(entry)
    with summary_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary[0]))
        writer.writeheader()
        writer.writerows(summary)
    print(f"Wrote {runs_path} and {summary_path}")


if __name__ == "__main__":
    main()
