"""Read-only checks of the actual Compose model. Never prints expanded secrets."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
COMMAND = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.appchain.yaml"]


def config(*args):
    result = subprocess.run(COMMAND + list(args), cwd=ROOT, capture_output=True, text=True, check=True)
    return result.stdout


normal = set(config("config", "--services").split())
assert normal == {"postgres", "backend", "frontend", "rollup-test"}, "OP services must be opt-in"
active = json.loads(config("--profile", "appchain", "--profile", "appchain-publish", "--profile",
                           "appchain-tools", "config", "--format", "json"))
services = active["services"]
assert services["op-reth"]["profiles"] == ["appchain"]
assert services["op-batcher"]["profiles"] == ["appchain-publish"]
assert services["appchain-tools"]["profiles"] == ["appchain-tools"]
assert services["backend"]["environment"]["APPCHAIN_RPC_URL"] == "http://op-reth:8545"
assert "APPCHAIN_DEPLOYMENT_RPC_URL" in services["appchain-tools"]["environment"]
for service in ["op-node", "op-batcher", "frontend", "backend"]:
    assert "APPCHAIN_DEPLOYMENT_RPC_URL" not in services[service].get("environment", {}), "Deployment RPC must stay isolated to tools"
for service in ["op-reth", "op-node"]:
    assert all(p["host_ip"] == "127.0.0.1" for p in services[service].get("ports", []))
assert all(p["target"] != 8551 for p in services["op-reth"].get("ports", [])), "Engine API must stay private"
assert not services["op-batcher"].get("ports"), "Do not publish batcher administration"
assert "--compression-algo=zlib" in services["op-batcher"]["command"]
assert "--data-availability-type=calldata" in services["op-batcher"]["command"]
for service in ["op-reth", "op-node", "op-batcher"]:
    assert not any("PRIVATE_KEY" in key or "SEQUENCER_KEY" in key for key in services[service].get("environment", {}))
    assert services[service].get("secrets"), "Operator material must use file mounts"
for service in ["frontend", "backend"]:
    assert not services[service].get("secrets"), "Wallet services must not receive operator key files"
assert any(s["target"] == "jwt" for s in services["op-node"]["secrets"])
assert any(s["target"] == "jwt" for s in services["op-reth"]["secrets"])
print("PASS: optional profiles, private Engine API, loopback RPC, separate publication, compression, key isolation, and shared Docker network.")

assert not services["rollup-test"].get("ports"), "Offline engine must not be exposed"
assert services["rollup-test"]["read_only"]
assert set(services["rollup-test"]["networks"]) == {"offline-rollup"}
assert active["networks"]["offline-rollup"]["internal"]
assert not services["rollup-test"].get("secrets")
