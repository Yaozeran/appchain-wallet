# Our OP Stack appchain in Docker

**Current wallet test flow:** see [TASK1.md](../TASK1.md). The main UI now uses email-linked browser keys and signed offline rollup-model payments. The deployment instructions below concern the actual OP services, which remain undeployed; older custodial/application benchmark sections describe retained legacy APIs.

This adds actual OP Stack runtime services to the same Docker Compose project as the wallet. A separate server is not required. The chain is independent of OP Mainnet, with its own chain ID, genesis, execution database, sequencer, and operator keys.

The first supported deployment path settles to **Ethereum Sepolia**, accessed through remote execution RPC and beacon endpoints. This avoids hosting Ethereum L1 locally. It still requires Sepolia ETH for deployment, deposits, and batch publication. This configuration is not a no-L1 simulator.

Setup tools and runtime images are now downloaded/built. Operator identities and the deployment intent are initialized for chain ID 42069, with matching key/address pairs and restricted key-file permissions verified. Execution and beacon endpoints identify Ethereum Sepolia. The proxy-revert preflight issue was traced to gas-simulation limits: the current-fork local trace consumes about 54.8 million gas, and a deployment-capable RPC estimates about 55.2 million. The old trace used outdated EVM rules and reported only about 9 million. A separate deployment RPC now handles large simulations; the original RPC remains for ordinary node reads. Both operator accounts have 0.01 Sepolia ETH, but the stock deployer's fee floors require about 0.166 ETH available upfront for this plan. Deployment is gated by the new preflight balance check. No live transaction has been broadcast. Export, startup, and publication remain pending funded deployment.

## Services and profiles

| Profile | Services | Purpose |
| --- | --- | --- |
| Default | Existing frontend, backend, PostgreSQL | Existing custodial simulator |
| `appchain-tools` | One-shot containerized tools | Operator keys, deployment intent, export, status, test deposits/payments |
| `appchain` | `op-reth`, `op-node` | Actual L2 execution and sequencing |
| `appchain-publish` | `op-batcher` | Upstream OP batch encoding, zlib compression, and Sepolia publication |

This is a development sequencer/batcher integration. A proposer, custom fault-proof prestate, active challenger, withdrawal workflow, and production HA/monitoring are **not configured**. In particular, this is not a complete production settlement/proof deployment; do not treat a successful deposit/payment as validation of withdrawals or dispute security.

Versions are pinned to `op-reth:v2.4.0`, `op-node:v1.19.3`, `op-batcher:v1.16.11`, and `op-deployer:v0.8.1`. The runtime version choices follow the official tutorial example reviewed on 2026-10-25; the deployer is separately pinned. Review release compatibility before updating any version. We use `op-reth` rather than the retired op-geth setup.

The current wallet uses one email-linked, browser-key account UI at `/`,
`/appchain` and `/self-custody`. Its signed offline model is described in
[TASK1.md](../TASK1.md). Test purchases and payments do not create real appchain
transactions. Normal mode stays disabled until the actual deployment and live
payment integration are implemented and validated. Previous custodial data/APIs
are retained without silently converting their ETH balances into wallet funds.
The CLI below provides actual-chain test operations separately from this UI.

## Step 1 — Check resources without installing anything

From the repository root:

```sh
python3 appchain/check.py
```

This reads Docker allocation and free disk, validates Compose, and reports whether deployment files exist. It does not pull images, start services, or expose `.env` values. Docker Desktop must be running.

An 8 GB Mac shares memory among macOS, Docker, the wallet, and the chain. The default container limits below are small **development caps, not official minimums or a guarantee that they will work**. Execution under load may need larger limits. Disk usage grows with images, chain state, and deployment artifacts. Check actual free space before each installation stage; Docker does not remove the hardware cost.

## Step 2 — Add the settings to the existing root `.env`

Keep your existing `.env`; do not replace it with a template. Add:

```dotenv
APPCHAIN_CHAIN_ID=42069
APPCHAIN_RPC_PORT=9545
APPCHAIN_NODE_PORT=9547
APPCHAIN_L1_RPC_URL=https://YOUR_SEPOLIA_EXECUTION_RPC
APPCHAIN_DEPLOYMENT_RPC_URL=https://YOUR_SEPOLIA_LARGE_SIMULATION_RPC
APPCHAIN_L1_BEACON_URL=https://YOUR_SEPOLIA_BEACON_API
APPCHAIN_RETH_MEMORY=1536m
APPCHAIN_NODE_MEMORY=384m
APPCHAIN_BATCHER_MEMORY=256m
```

Use an unused development chain ID and keep it unchanged after initialization. This path rejects Ethereum mainnet, OP Mainnet and OP Sepolia as the new chain's ID. The L1 execution endpoint is checked to be Ethereum Sepolia before deployment or deposits. The beacon endpoint must provide Sepolia beacon data; it is not interchangeable with an execution RPC URL. Provider API keys belong in these backend/operator URLs, never `NEXT_PUBLIC_*` variables.

No operator private keys go in `.env`. The setup container generates them in `appchain/.local/secrets/`. That entire directory is Git-ignored and excluded from Docker build contexts.

`APPCHAIN_DEPLOYMENT_RPC_URL` is an optional separate execution endpoint for deployment planning and broadcasting; if blank, it falls back to `APPCHAIN_L1_RPC_URL`. In the current local configuration, deployment uses `https://sepolia.gateway.tenderly.co` and normal node reads use PublicNode. Verify your own endpoint's current limits rather than assuming every public RPC permits a large deployment simulation. The override is supplied only to setup tools, not the sequencer or batcher.

## Step 3 — Build only the setup tools

```sh
mkdir -p appchain/.local
chmod 700 appchain/.local
./appchain/compose --profile appchain-tools build appchain-tools
```

This is the first step that downloads images/packages. The tools image contains Node, ethers, a TOML parser, and the pinned official op-deployer/forge binaries. No host installation of Go, Rust, Foundry, or op-deployer is necessary. It does not mount the Docker socket. Deployment logs/artifact cache are stored privately under `.local`.

## Step 4 — Generate operator identities and deployment intent

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools init
```

This generates separate admin, deployer, sequencer, batcher, proposer, challenger, and test-payment keys. Addresses are derived from the actual keys using ethers. All fee-vault recipients use the admin address. It initializes the upstream `standard-overrides` intent and sets the corresponding ownership/operator roles. It disables prefunding of publicly-known development keys.

Only public addresses are printed. The JWT and private keys are written with restricted permissions. `init` refuses to overwrite existing keys or deployment state. If initialization fails, retain the directory and inspect the local deployment log before deciding how to recover; do not blindly delete the identities or rerun against a different chain ID.

To view addresses again:

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools addresses
```

Do not post `appchain/.local/secrets/`, full `deployment.log`, or expanded Compose configuration to chat.

## Step 5 — Fund and review the Sepolia deployment

The `deployer` address needs Sepolia ETH. The `batcher` address also needs Sepolia ETH before publication starts. Funding one does not fund the other. The official tutorial estimates around **2–3 Sepolia ETH** for its complete setup; actual costs for this deployment depend on contract versions and network conditions.

Free faucet options:

1. [Google Cloud's Ethereum Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) requires signing in with your Google account; follow its current eligibility instructions.
2. [Superchain Faucet](https://console.optimism.io/faucet) is linked by the official deployment guide. Select **Ethereum Sepolia**, chain ID 11155111.
3. [Alchemy's Ethereum Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia) currently advertises 0.1 ETH per 24 hours, but requires an eligible address with at least 0.001 ETH and sufficient activity on Ethereum mainnet. A newly generated operator address will not meet those requirements. If you already have an eligible wallet, claim to it and transfer the test funds to your deployer/batcher addresses.

Use only public recipient addresses from the `addresses` command; faucets never need our operator private keys. Finish faucet authentication/anti-abuse steps yourself, then tell the assistant when funds arrive so balances can be checked before proceeding. Claim limits and eligibility can change. Acquiring a small faucet amount does not guarantee it covers the whole deployment.

Review `appchain/.local/deployer/intent.toml`, the public operator addresses, and the configured RPC network before broadcasting anything.

First run the **non-broadcasting preflight**:

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools preflight
```

It copies intent and state into an isolated `preflight-*` directory, generates a calldata-only plan, and asks the actual deployment RPC to estimate it under current L1 rules. It does not overwrite the real deployment state or use an old local trace as the gas estimate. It records the result in `appchain/.local/preflight-report.json`. Only the current single-transaction OPCM plan is supported; dependent multi-transaction plans require separate review.

Read both `simulationPassed` and `sufficientBalance`: they answer different questions. For op-deployer v0.8.1, the preflight reproduces its 1 gwei minimum tip, 1 gwei minimum base-fee assumption, tip padding, and fee-cap calculation. At low network fees, this still gives a 3 gwei maximum fee per gas. Approximately 55.2 million gas therefore requires about **0.166 ETH available upfront**. That is a maximum-fee balance allowance, not a statement that all of it will be charged. The expected effective fee can be lower, but the balance must cover the transaction's upfront fee cap. A 0.01 ETH deployer balance is insufficient with this stock broadcaster. Around 0.2 Sepolia ETH provides headroom for this observed plan; recompute before sending because gas usage and fees can change.

The following command reruns preflight and **refuses to broadcast** when simulation fails or the balance cannot cover its fee allowance:

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools deploy
```

The tool checks L1 chain ID before invoking op-deployer and passes its key through the `DEPLOYER_PRIVATE_KEY` child-process environment variable, not command-line arguments. The upstream deployment state is preserved for resumption. If it fails, inspect the private local log; do not reset the state or generate fresh keys as a generic fix. Do not copy a successful calldata-only state over the real deployment state: its start block is not a confirmed deployment receipt.

## Step 6 — Export and validate the chain configuration

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools export
```

This exports `genesis.json` and `rollup.json` from deployment state into `appchain/.local/runtime/`. It verifies matching L1/L2 IDs, nonzero contract addresses and L1 anchor, and the batch sender's match to the generated batcher key. Runtime services mount only the exported configuration and their required individual secret files. They do not get the deployer/admin/payment private keys or the whole root `.env`.

Do not change/re-export genesis against an existing execution database. A chain restart must retain the original genesis, keys, and persistent data volume.

## Step 7 — Start execution and sequencing

```sh
./appchain/compose --profile appchain up -d --build op-reth op-node
./appchain/compose --profile appchain-tools run --rm appchain-tools status
```

The startup command downloads/builds the two runtime images. A named volume persists execution state. Local development wrappers run as root to read setup-created `0600` mounts; the wallet's existing container users remain unchanged. Ports:

| Endpoint | Access |
| --- | --- |
| L2 JSON-RPC | Host `http://127.0.0.1:9545`; Compose network `http://op-reth:8545` |
| Rollup status RPC | Host `http://127.0.0.1:9547`; Compose network `http://op-node:8547` |
| Execution Engine API | Internal `op-reth:8551`, authenticated by shared JWT; no host port |
| Batcher metrics | Internal `op-batcher:7300`; no host port |

P2P is disabled for this private development setup. RPC exposes `eth`, `net`, and `web3`, without debug/admin APIs; host ports bind to loopback. No raw JSON-RPC proxy is added to the public wallet backend.

`status` reports unsafe, safe, and finalized L2 heads separately. The tools container must run on this same Compose network. A failed status immediately after startup can be retried once nodes have connected; it is not evidence of zero balances.

## Step 8 — Enable the real batcher when ready

After funding the batcher address, explicitly start it:

```sh
./appchain/compose --profile appchain --profile appchain-publish up -d --build op-batcher
```

This runs the actual upstream batcher using span batches, zlib compression, and calldata DA. It reads the rollup configuration from the rollup RPC to obtain the correct batch inbox and posts compressed data to Sepolia. The SystemConfig proxy is **not** used as the batch inbox.

There is no independent custom compressor being presented as OP Stack compression. Starting this profile permits real L1 testnet transactions. A stopped batcher does not continuously benchmark compression, because the upstream batcher pipeline is coupled to publication.

For a short sequencing-only test, leave this profile off. Such blocks remain unsafe. The configured sequencer pauses once safe-head lag reaches 64 blocks, and sequencing-window/L1-origin rules still apply. Disabling publication is not an indefinitely operating, settled rollup and is not a production throughput benchmark.

Check status again and verify safe-head progress after batches land on L1. Do not equate successful JSON-RPC requests, unsafe inclusion, safe inclusion, and finalized inclusion.

## Step 9 — Distinguish the live chain from wallet test mode

The current shared wallet UI runs signed **offline test payments**; normal mode
is disabled. Starting these OP containers does not enable normal payments or move
fake-card funds onto the real chain. The older balance service still supports
`chain=appchain` with chain-ID checking, but the current test UI does not call it.

The wallet displays a genuine phrase-derived Ethereum address. After completing
real deployment/startup, you can use the tools to deposit Sepolia test ETH to a
public address you control (including that browser wallet's address):

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools deposit 0xYOUR_BROWSER_WALLET_ADDRESS 0.01
```

This spends Sepolia ETH through the deployed OptimismPortal. The real chain's
balance remains separate from the offline model balance. A current test purchase
cannot fund this deposit. Live wallet sending still needs a normal-mode transport,
network/funding checks, and end-to-end verification before the mode is enabled.

## Step 10 — Make an actual appchain test payment

The separate tools payment account starts unfunded. Deposit to it first (the default recipient):

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools deposit
```

After its deposit is derived, send a small payment to your browser wallet:

```sh
./appchain/compose --profile appchain-tools run --rm appchain-tools pay 0xYOUR_BROWSER_WALLET_ADDRESS 0.001
```

This signs and broadcasts a native ETH transfer on our appchain using the generated payment key. It reports the actual transaction hash and checks a successful receipt. It is not a user-facing custodial withdrawal endpoint and does not use demo-card balances. Check the recipient balance in `/self-custody`. Inclusion is initially unsafe; run `status` to inspect safe/finalized progress separately.

## Stop and preserve data

```sh
./appchain/compose --profile appchain --profile appchain-publish stop op-batcher op-node op-reth
```

The wallet can keep running. Keep the execution volume and `.local` directory together. **Do not run `down -v`: this project also contains your PostgreSQL wallet volume.** Losing operator keys or restarting with mismatched genesis is not fixed by starting fresh containers.

## Validation performed without installation

```sh
node --test appchain/tests/config.test.mjs
node --test appchain/tests/preflight.test.mjs
python3 appchain/tests/compose_test.py
python3 appchain/check.py
```

These tests validate role mapping, identity mismatches, exported configuration guards, optional profiles, RPC/key isolation, and compression settings. Backend tests validate the appchain's balance route and reject an OP Mainnet RPC masquerading as our chain. Runtime boot, funded deployment, L1 publication, and actual appchain transfers still require the manual stages above and have not been executed by these tests.

## Upstream references

- [Official deployment tutorial](https://docs.optimism.io/chain-operators/tutorials/create-l2-rollup)
- [Official sequencer setup](https://docs.optimism.io/chain-operators/tutorials/create-l2-rollup/op-reth-setup)
- [Batcher protocol and compression pipeline](https://specs.optimism.io/protocol/batcher.html)
- [Official example source reviewed](https://github.com/ethereum-optimism/optimism/tree/cb16ccaf3ee887678720c78ec63af33aaf1b8b3a/docs/public-docs/create-l2-rollup-example)
- [Pinned deployer fee estimator](https://github.com/ethereum-optimism/optimism/blob/op-deployer/v0.8.1/op-deployer/pkg/deployer/broadcaster/gas_estimator.go)
- [Pinned deployer broadcaster minimum-fee configuration](https://github.com/ethereum-optimism/optimism/blob/op-deployer/v0.8.1/op-deployer/pkg/deployer/broadcaster/keyed.go)

Validation results: 35 backend tests, 15 frontend tests, 6 appchain tests (including current gas estimation, upstream fee floors, wrong-chain/simulation rejection and insufficient funding), the Compose isolation checks, ESLint, and TypeScript passed. The rebuilt tools' actual Sepolia preflight passed with 55,206,488 gas and recorded a 0.165619464 ETH fee-cap balance requirement in `.local/preflight-report.json`. It reported insufficient funding at 0.01 ETH. The real deployment state remains unapplied, the deployer nonce remains zero, and both balances remain 0.01 ETH: no live transaction was broadcast. The setup-tools and runtime images were built/pulled for ARM64. Container version checks passed for op-deployer, forge, op-node and op-batcher. The pinned op-reth v2.4.0 image runs and reports its underlying Reth build as 2.3.0-dev. Every configured runtime CLI flag was found in the corresponding binary's help output. Generated operator keys match their addresses and configured roles. Chain startup compatibility and resource use still need validation after funding and deployment.

The setup implementation here is independent: it derives real operator addresses, separates role keys, does not overwrite existing state, checks exported identities, and limits Sepolia access. It does not execute the upstream example's shell script wholesale.

## Offline payment wallet and rollup model

See [TASK1.md](../TASK1.md) for the current shared UI, signup/key ownership,
signed payments, offline OP wire-format model, benchmark definitions, repeatable
procedure and requirement mapping. The model does not run op-node, op-reth or
op-batcher and does not establish live OP throughput. It uses a separate private
`rollup-test` service with no external network or operator secrets.

The prior database + JSON/zlib application benchmark is retained only as a legacy
API (`/api/custody/traffic`) and regression test (`tests/payment-traffic.py`). It is
not the current wallet's rollup test pipeline and must not be reported as OP TPS.
