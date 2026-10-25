# Task 1 — signed wallet payments and offline rollup tests

This implements the test scope in `.agent/task.txt`. Normal mode stays disabled as
requested; actual OP Stack execution and L1 publication still require deployment.

| Requirement | Implementation |
| --- | --- |
| Fake fiat → crypto | Issued fake USD card; fixed $2,500/ETH conversion credits the phrase-derived address's offline test balance directly. No platform ETH deposit is required. |
| Wallet payments with rollup flow | Native transfers signed in the browser; ownership, chain, nonce, fees and balance checked; modeled sequence/execution → linked blocks → OP singular batches → compressed channels → frames. This is the offline test implementation, not deployed OP execution. |
| TPS without on-chain interaction | Private stateless engine has no external network or RPC. Test state, receipts, compressed payloads and results persist in PostgreSQL. |
| Shared UI and mode switch | `/`, `/appchain`, `/self-custody` render the same wallet. Upper-right test control; normal mode disabled in both UI and Java write API. |
| Email account + unique phrase | Email/password signup plus random BIP-39 phrase, BIP-32/44 keys, two-round backup verification and encrypted browser vault. Server links public address after a one-use ownership challenge. Email is not phrase entropy. |
| Performance page | `/performance`: measured model execution/batching TPS, virtual inclusion TPS/latency, actual encoded/compressed/frame sizes, modeled fees, assumed comparison, block and receipt inspection, JSON export. |

## Components and trust boundaries

- **Browser:** generates and encrypts keys; holds unlocked signer in memory; signs
  EIP-1559 transactions. Sends public addresses/signatures/signed transactions, never
  recovery phrases, seeds, private keys or encrypted vaults to Java.
- **Java:** existing email/password sessions, exact Origin checks, explicit test-mode
  enforcement, wallet ownership challenge, fake-card accounting, durable offline state,
  atomic transactions, idempotency and user-scoped history. Challenge lasts ten minutes
  and is consumed after successful binding. A wallet cannot silently replace an existing
  binding or be bound to another account. Registration does not verify email ownership.
- **Private engine:** ethers signature recovery; fixed native-transfer execution model;
  sequence and block construction; OP singular batch RLP byte-string stream, zlib channel,
  version-0 frames. No provider, RPC, operator key, private wallet key or database access.
- **PostgreSQL:** migration V3 adds wallet bindings, address balances/nonces, model head,
  direct test purchases, runs and receipts. Previous schema/data is retained. It stores
  simulated chain state; this is not a production custody arrangement.

Recovery phrases are random, not derived from predictable email addresses. The local
vault key is `wallet.email.v1:<normalized email>`. Device encryption uses ethers'
keystore format. Lock/reload/sign-out discards the active signer from the UI. A fresh
browser restores the same address from the phrase after email login. Email password
recovery does not recover wallet keys. Anyone with the phrase controls those keys.
Earlier `wallet.vault.v1` is preserved and can be imported after unlocking. No key
rotation or silent wallet/balance migration occurs.

## Repeatable procedure

1. Keep your root `.env` and run `docker compose up -d --build`. No additional
   provider credential, faucet ETH, OP operator funding or local L1 is needed.
2. Open http://localhost:3000. Choose **Create a test account** or **Use fake account
   details**. Save your email/password. Create the account, write down its generated
   twelve-word phrase, complete both alternating-word verification rounds, and finish.
3. The UI displays your phrase-derived address and fake $1,000 card. Keys are local;
   the Java server links the address using a signed ownership challenge.
4. Buy **$100** of test ETH: card becomes **$900**, wallet test balance **0.04 ETH**.
   No ETH is credited to the older custodial account or sent to a live network.
5. Copy a merchant wallet address. It may belong to a second account or an external
   wallet not registered in this application. Enter **0.0001 ETH**, **20 payments**,
   and **5 payments per simulated block**. Review **0.00200042 ETH** including modeled
   fees, then choose **Sign and confirm payment**.
6. Expect four linked model blocks, twenty signed receipts, and one compressed channel.
   Sender test balance becomes **0.03799958 ETH**. Recipient test balance increases by
   **0.002 ETH**. Fees total **0.00000042 ETH** and are burned by the model. An unregistered
   recipient retains its test credit and sees it after later proving ownership.
7. Open **Performance**. Inspect model processing and batch encoding rates, virtual
   inclusion rate (20 / (4 × 2s) = **2.5 tx/s**), virtual average confirmation (**5,000 ms**),
   encoded bytes, model fees and the assumed Ethereum comparison. Expand blocks and
   receipts or download the complete JSON, including raw signed transactions/frame bytes.
8. Repeat with the same traffic count and capacity **20**: one block, modeled inclusion
   **10 tx/s**, virtual average confirmation **2,000 ms**. Compare measured encoding and
   sizes; do not interpret virtual clock rates as measured blockchain capacity.
9. Reload and unlock with the device password. History and nonce persist. In a fresh
   browser profile, sign in with email/password, choose **Restore recovery phrase**,
   and restore the same wallet with a device password. Wrong phrases cannot replace it.
10. Upper-right **Test mode** shows normal mode unavailable. Java rejects normal writes
    too. If a response is lost, retry the saved pending request without re-signing it:
    request keys and transaction nonces prevent duplicate debits. A failed multi-payment
    run rolls back the entire run. A stale nonce requires refreshing and signing anew.

## Metrics and assumptions

- **Measured model processing TPS:** payments / wall time for signature validation,
  sequencing, native-transfer balance/nonce/fee execution, block identifiers and batch
  encoding. Excludes browser signing, HTTP, database locking/persistence/commit.
- **Measured batching TPS:** payments / time to RLP encode, compress and frame. This is
  this implementation's codec throughput, not the stock `op-batcher` runtime.
- **Modeled inclusion TPS:** payment count / virtual duration. Fixed 2-second blocks,
  configured payment capacity, simultaneous arrival at time zero. No actual waiting
  or consensus occurs; it is a scheduling scenario, not an empirical chain benchmark.
- **Modeled latency:** each payment's virtual block inclusion time; average across run.
- **Fees:** 21,000 modeled gas × 1,000,000 wei/gas (0.001 gwei), burned by the model.
  The comparison assumes 1 gwei for Ethereum. Neither is a live gas quote. L1 data fees
  and blob pricing are omitted; no real cost-saving claim follows from this assumption.
- **Encoding:** Bedrock singular batch type 0, RLP byte strings, zlib, and frames with
  a 16-byte channel ID, uint16 frame number, uint32 data length, data and final flag.
  Frame payload capacity is 1,000 bytes here. The optional actual deployment currently
  configures span batches; this model does not reproduce that compression strategy.
- **Block hashes:** model identifiers, not Ethereum block headers/state roots. Transaction
  hashes are genuine hashes of signed test transactions, never publicly submitted.
- **Isolation:** test signatures use chain ID **420690001**, whereas actual appchain
  configuration uses **42069**. Real-chain signatures and contract calls are rejected.

No EVM/contracts, L1 traversal/attributes, full derivation validation, sequencing-window
rules, reorg handling, proofs, finality, withdrawal or settlement security is implemented
by this model. It uses a synthetic L1 origin and virtual blocks. Results cannot establish
live OP throughput or satisfy a claim of deployed rollup operation. The real optional OP
Stack Docker setup is retained; normal mode must remain disabled until it is deployed
and a live payment flow is implemented and verified.

Wire-format references: [OP derivation specification](https://specs.optimism.io/protocol/derivation.html)
and [upstream batch encoding](https://github.com/ethereum-optimism/optimism/blob/op-node/v1.19.3/op-node/rollup/derive/batch.go).

## Verification

```sh
npm ci --prefix appchain/simulator --ignore-scripts
npm test --prefix appchain/simulator
npm test --prefix web
(cd web && npm run lint && npx tsc --noEmit)
(cd wallet && ./mvnw -B -ntp test)
python3 appchain/tests/compose_test.py
node appchain/simulator/integration.mjs
```

The integration test uses fresh random wallets/accounts and checks challenge ownership,
replay rejection, wallet test credit without platform ETH deposit, twenty signed payments,
block/receipt consistency, duplicate and concurrent retry, nonce/chain checks, rollback,
unregistered recipients, user isolation and server-side normal-mode rejection. It never
prints private keys/phrases. Native engine tests independently decode frames and the RLP
stream and verify model balances, fees, nonces, linking and immutable failure behavior.

## Development evidence and decisions

The earlier Alice/Bob browser simulation and database+JSON/zlib benchmark did not cover
signed wallet ownership or a rollup-format pipeline. Those were rejected as the primary
Task 1 flow. The implementation retains previous account data and actual OP deployment
files, but replaces the main UI with a unified phrase-wallet flow and an explicitly
bounded offline native-transfer model. The real deployment is not bypassed or falsely
reported as complete. Review the simulator assumptions above when presenting results.

### Verification recorded

- 39 Java tests, 17 frontend tests and 4 offline engine tests passed, plus lint,
  TypeScript, Compose isolation validation and Docker production builds.
- HTTP integration passed direct-wallet test credit, signed 20-payment/4-block
  execution, concurrent/idempotent retry, ownership/chain/nonce rejection, rollback,
  unregistered recipients, account isolation and disabled normal mode. Legacy API
  regression tests also passed; their DB-only metrics remain separate.
- Browser verification passed email/phrase signup, incorrect-word rejection, both
  backup rounds, encrypted local storage, no phrase/private-key transmission,
  purchase/review/signing, performance page, reload/unlock, fresh-profile restore,
  interrupted-signup resumption and original-vault-preserving import. Mobile views
  had no horizontal overflow or browser runtime errors.
- One local 20-payment/4-block model run measured about 477.82 processing tx/s and
  9,513.24 encoding tx/s; 2,648 batch-stream bytes compressed to 1,727 bytes. These
  are single-run model measurements, not OP Stack capacity. Virtual inclusion was
  2.5 tx/s by the documented scheduling assumption. No L1/L2 interaction occurred.
