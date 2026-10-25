# Payment wallet and offline OP Stack rollup lab

Email signup creates a recovery-phrase wallet in the browser. Your encrypted keys
stay on your device; the Java server stores your email account, public wallet
binding, fake card, offline test state and receipts. Email alone cannot authorize
a payment: the browser signs native transfers with your wallet key.

```sh
docker compose up -d --build
```

Open **http://localhost:3000**. Create a test account, back up and verify its phrase,
convert fake USD directly into wallet test ETH, and send a signed payment to any
Ethereum-compatible wallet address. Recipients do not need to register first or
deposit into the platform. The fake card starts with $1,000. No real money moves.

The top-right **Test mode** control applies to the same payment interface. Normal
mode is disabled in the UI and server until a deployed, validated OP Stack live
payment flow exists. `/`, `/appchain` and `/self-custody` now use this unified UI.
**[/performance](http://localhost:3000/performance)** shows measured offline model
processing/batching rates, virtual inclusion/latency, compression, fees and receipts.

The offline engine verifies signed transactions, enforces nonce/balance/fee rules,
constructs linked model blocks, encodes OP singular batches, compresses channels and
splits frames. It is **not the upstream OP execution/sequencer/batcher runtime**, an
EVM, or proof of live OP throughput. It uses isolated test chain ID 420690001 and
makes no L1/L2 requests. Modeled inclusion and assumed Ethereum fees are labeled
separately from measured CPU processing. See **[TASK1.md](TASK1.md)** for architecture,
requirement mapping, procedure, test commands and limitations.

The Compose services are Next.js frontend, Spring Boot Java backend, PostgreSQL
and a private offline rollup engine. The engine has no host port, operator keys,
wallet secrets or external network. Persistent state stays in the existing PostgreSQL
volume. Keep the existing root `.env`; examples are in [.env.example](.env.example).
Do not use `docker compose down -v` if you want to keep account/test history.

Existing accounts can sign in and generate or restore their wallet. Earlier browser
vaults remain intact; **Use my earlier browser wallet** imports one after unlocking.
Old custodial balances and test records are preserved separately, not reclassified as
wallet funds. Historical implementation notes remain in [CUSTODIAL_DEMO.md](CUSTODIAL_DEMO.md).

Actual OP Stack deployment tooling and optional op-reth/op-node/op-batcher services
remain in [compose.appchain.yaml](compose.appchain.yaml) and [appchain/README.md](appchain/README.md).
Real deployment, genesis export, startup, publication, proofs and withdrawals are
not completed by the offline test mode. No operator funds are spent by this app flow.
MoonPay and Transak source remains available, with archived [setup](PROVIDER_SETUP_LEGACY.md)
and [testing](TESTING.md) notes; neither provider is used in the current test flow.
