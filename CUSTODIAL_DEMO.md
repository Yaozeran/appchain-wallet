> Historical custodial API documentation. The main wallet now uses email-linked browser keys and signed offline test payments. See [TASK1.md](TASK1.md) for the current interface, metrics and verification. Existing records/APIs are preserved; their balances are not automatically migrated.

# PostgreSQL custodial wallet demo

This prototype stores accounts, sessions, fake card metadata, balances, and payment records in PostgreSQL. It has no active MoonPay or Transak flow. All USD and ETH in this dashboard are simulated and have no monetary value. No real card is charged and no blockchain transaction is broadcast.

## 1. Start the app

From the repository root, with Docker Desktop running:

```sh
docker compose up -d --build --wait
```

Open **http://localhost:3000**. PostgreSQL is reachable only on the private Docker network; there is no published database port. Its data is stored in the named `wallet-postgres` volume. Flyway applies versioned SQL migrations automatically before the backend becomes healthy.

The existing root `.env` is still used. No provider API keys are needed for the demo. Optional local settings are:

```dotenv
WEB_PORT=3000
POSTGRES_USER=wallet
POSTGRES_PASSWORD=wallet_local_demo
CUSTODY_FRONTEND_ORIGIN=http://localhost:3000
CUSTODY_SECURE_COOKIE=false
```

The password above is a local development default. Choose a different password **before first startup** if desired. These values are passed only to PostgreSQL and/or the backend; database credentials are never included in the frontend bundle. Changing `.env` requires recreating affected containers. After the database volume is initialized, changing `POSTGRES_PASSWORD` does not change the existing PostgreSQL role password: alter the role deliberately, or keep the original value. Do not delete an existing volume to solve a password mismatch.

If you change `WEB_PORT`, update `CUSTODY_FRONTEND_ORIGIN` to the exact URL you open, including the port. Use `localhost` consistently; `127.0.0.1` is a different origin. If `CUSTODY_FRONTEND_ORIGIN` is absent, Compose derives it from `WEB_PORT`. For HTTPS deployments set `CUSTODY_SECURE_COOKIE=true` and use the HTTPS origin. This project remains a local simulator, not a production custody system.

## 2. Open an account

Click **Try the demo account** for a shared account. Its credentials are:

```text
Email: demo@wallet.test
Password: DemoWallet!2026
```

The shared account is created on first use. Opening it again does not reset its balances. Use **Create a separate test account** for an independent fake card with a fresh $1,000 USD balance. Use a test email and a password with 12–128 characters. Email verification and password recovery are not implemented.

Each account gets a synthetic Ethereum-shaped receiving address. It is a database identifier with **no corresponding managed private key**. Never deposit real ETH, tokens, or Sepolia funds into it. The prototype models custody in a database; it does not yet hold or sign with real cryptocurrency keys.

## 3. Convert fake USD to demo ETH

1. Check the **Fake card balance**: a new account starts at $1,000.00.
2. The card shows `•••• 0000`, a demo label, and a synthetic expiry. There is no real card number or CVC to enter.
3. Enter `100.00` under **Spend fake USD**.
4. The quote shows `0.04 demo ETH` at the fixed rate **$2,500 per ETH**.
5. Click **Buy demo ETH**.
6. Expect a $900 fake card balance and a 0.04 demo ETH balance, plus an activity entry with a database reference.

The server determines the price and amount. USD uses integer cents and ETH uses integer wei; neither uses floating-point arithmetic. Amounts must be positive, USD supports at most two decimal places, and a purchase is capped at $1,000 and the remaining card balance. There are no fees, live quotes, card network calls, or provider redirects.

## 4. Test an internal payment

1. In a **different browser profile or private browser window**, create account B. Two tabs in the same profile share login cookies.
2. Copy B's **Demo receiving address**.
3. In account A, paste that address and enter `0.01` ETH.
4. Click **Review payment**, verify the details, then **Confirm demo payment**.
5. A loses exactly 0.01 demo ETH and B gains exactly 0.01 demo ETH in one database transaction. B refreshes automatically within 15 seconds, or use **Refresh**.
6. Both accounts show the transfer; B's entry is marked received.

The journal status is `INTERNAL_COMPLETED`. This is an internal ledger credit, not an Ethereum transaction.

## 5. Test a simulated external payment

Use an address that does not belong to a demo account, for example:

```text
0x1111111111111111111111111111111111111111
```

Send `0.005` demo ETH. The sender balance decreases and the ledger's external settlement account receives the matching entry. The status is **External payment simulated** (`EXTERNAL_SIMULATED`). Nothing arrives on-chain. The receipt contains a database reference, never a fabricated transaction hash. Insufficient funds, self-payments, invalid/zero addresses, zero/negative values, and amounts with more than 18 decimals are rejected without changing balances.

Real external payments require a separately funded chain wallet, managed signing keys, RPC broadcasting, nonce management, withdrawal authorization, and reconciliation. Likewise, charging actual cards requires bank/acquirer/payment-network integration; storing a card in PostgreSQL cannot charge it or create real crypto reserves. Those integrations are outside this fake-money demo.

## 6. Test retries and persistence

Every purchase/payment has a UUID request key. Retrying the same key with the same normalized details returns the original reference without moving balances again. Reusing the key with different details returns HTTP 409. The browser saves pending operation details and its request key in `sessionStorage` before submitting. On a timeout or HTTP 5xx, use **Retry pending operation**. This storage contains no password or card credentials. Do not clear it while an operation's outcome is uncertain.

Sign out and sign back in: balances, addresses, and history must remain. To check database persistence without deleting data:

```sh
docker compose restart backend postgres
docker compose ps
```

Wait for healthy services, then sign in again and compare. Normal `docker compose down` retains the named volume. **`docker compose down -v` deletes all demo accounts and balances**; it is not needed during normal use.

## 7. Automated checks

With the Docker app running:

```sh
python3 tests/custody-smoke.py
```

For another port, pass its origin as the argument. The script creates two isolated test accounts and leaves their records for inspection. It checks authentication, logout, origin restrictions, card ownership, rejection of unknown card fields, exact conversions, duplicate/conflicting request keys, concurrent duplicate purchases, concurrent overspend prevention, internal credits, external simulation, rejected-payment rollback, and re-login persistence.

Additional checks:

```sh
cd wallet
./mvnw test
```

```sh
cd web
npm test
npm run lint
npx tsc --noEmit
```

The Java context test disables Flyway so it can run without a database; the HTTP smoke test is the integration check against real PostgreSQL. It is not an in-memory database substitute.

## 8. Data model and API

`custody_users` stores normalized emails, salted PBKDF2-HMAC-SHA256 password hashes (600,000 iterations), and synthetic receiving addresses. `custody_sessions` stores SHA-256 hashes of random 256-bit session tokens with an eight-hour expiry. The token travels in an HttpOnly, SameSite=Strict cookie; logout revokes it server-side. POST routes require the exact configured frontend Origin, including login and registration.

`custody_cards` stores only a generated fake-card UUID, label, last four digits, expiry, and an enforced fake flag. The API has no PAN, CVC, PIN, bank-login, or real-card-entry fields. Unknown JSON fields are rejected.

`custody_accounts` holds integer balances in `NUMERIC(78,0)`. User balances cannot be negative. `custody_journals` and `custody_entries` retain both sides of funding, conversion, and payment movements. A deferred PostgreSQL constraint trigger checks each journal balances per asset before commit. Ledger mutations use a transaction-scoped advisory lock so multiple backend instances cannot concurrently spend the same balance. This global lock is a deliberate simplicity/throughput tradeoff for the prototype. A unique `(user_id, request_key)` constraint backs idempotency. Balances and journal entries commit or roll back together.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/custody/health` | Database readiness and simulation mode |
| POST | `/api/custody/demo` | Open shared demo account |
| POST | `/api/custody/register` | Create isolated test account with initial fake funds |
| POST | `/api/custody/login` | Authenticate email/password |
| POST | `/api/custody/logout` | Revoke session and clear cookie |
| GET | `/api/custody/me` | Own account, balances, card, and latest 50 activity entries |
| POST | `/api/custody/buy` | `{requestKey, cardId, fiatAmount}`; amount is a decimal string |
| POST | `/api/custody/send` | `{requestKey, recipientAddress, ethAmount}`; amount is a decimal string |

All responses use `Cache-Control: no-store`. User identity comes from the session, never a user ID in the request body. The demo has no production account recovery, MFA, abuse/rate controls, bank settlement, managed signing keys, or withdrawal processing.

## Existing on-chain wallet

The **On-chain wallet** link at `/self-custody` retains the browser-encrypted recovery-phrase wallet and live ETH/Sepolia/BTC/OP balance reader. Existing browser vaults are preserved. Those balances are entirely separate from demo ledger balances. MoonPay and Transak source code remains available but neither is mounted in either purchase UI. [TESTING.md](TESTING.md) retains the historical provider integration instructions.

## Verification performed

- All 34 Java tests and 15 frontend tests pass, along with ESLint and TypeScript checks.
- The integration script passed against the running Docker app and PostgreSQL, including concurrent duplicate and overspend checks.
- Isolated desktop/mobile Chrome sessions passed signup, conversion, payment review, receiving an internal transfer, and a lost-response/reload/retry scenario without a duplicate debit. No browser runtime errors or horizontal overflow were detected.
- Database audits found zero negative user balances, unbalanced per-asset journals, or mismatches between stored balances and ledger entries.
- All balances and account counts persisted unchanged after restarting the backend and PostgreSQL; all three services returned healthy.

## Shared mode control and merchant traffic tests

The top-right **Test mode** control applies to this same wallet interface. Normal
on-chain mode is disabled in the UI and rejected by Java write endpoints. `/appchain`
now opens this same account/payment interface; the Alice/Bob simulator was removed.

Choose 2–200 payments in the send form to run repeated merchant payments. Review
shows the total debit before confirmation. The server commits the run atomically,
retains its request key for retries, and persists the compressed application batch.
The performance panel measures ledger processing and JSON/zlib compression only.
These figures are not OP sequencer/batcher TPS or blockchain confirmations.
Actual inclusion TPS is queried separately from the configured OP Stack RPC and is
unavailable until the real chain runs. See [the procedure and measurement definitions](appchain/README.md#shared-wallet-ui-and-payment-performance-tests).

Additional authenticated endpoints:

- `GET /api/custody/traffic`: this user's latest ten test batch summaries.
- `POST /api/custody/traffic`: requestKey, recipientAddress, ethAmount per payment,
  and count (1–200); same Origin protection and cookie as single payments.
- `GET /api/custody/appchain-metrics`: real RPC inclusion measurements or unavailable.
- `GET /api/custody/capabilities`: public mode availability and reason.

`X-Wallet-Mode: test` is sent by the frontend. Any other explicit mode is rejected
on buy/send/traffic. An omitted header retains the existing test API behavior.
