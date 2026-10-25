#!/usr/bin/env python3
"""Read-only preflight: no image pulls, builds, deployment, or secret output."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def run(args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=True).stdout


def main():
    try:
        run(["docker", "compose", "-f", "compose.yaml", "-f", "compose.appchain.yaml", "--profile", "appchain",
             "--profile", "appchain-publish", "--profile", "appchain-tools", "config", "--quiet"])
        info = json.loads(run(["docker", "info", "--format", "{{json .}}"]));
    except (OSError, subprocess.CalledProcessError):
        print("Docker or Compose validation failed. Start Docker Desktop and check your local Compose configuration.")
        return 1
    print("Compose configuration: valid (no images downloaded)")
    print(f'Docker allocation: {info["MemTotal"] / 1024**3:.1f} GiB RAM, {info["NCPU"]} CPUs')
    print(f'Host filesystem free: {shutil.disk_usage(ROOT).free / 1024**3:.1f} GiB')
    print("These are observed resources, not a guarantee that this workload will fit.")
    for name in ["public.json", "secrets/jwt", "runtime/genesis.json", "runtime/rollup.json"]:
        print(f'{name}: {"present" if (ROOT / "appchain" / ".local" / name).is_file() else "not initialized"}')
    print("No chain services were started and no L1 transactions were sent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
