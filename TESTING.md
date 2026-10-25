# Testing Transak and on-chain balances

> Historical provider integration guide. The default app is now the provider-free custodial simulator; see [CUSTODIAL_DEMO.md](CUSTODIAL_DEMO.md) for current setup and testing. The on-chain balance viewer remains at `/self-custody`, without an active provider checkout.

The active purchase channel is **Transak**. MoonPay's Java package, API routes, frontend component (`web/src/components/moonpay-buy-crypto.tsx`), URL validator, and tests remain available; its existing credentials have not been changed. MoonPay is not loaded by the default account screen.

## 1. Configure Transak staging

Create a partner account at [Transak's dashboard](https://dashboard.transak.com/) and obtain **staging** API credentials. Transak requires your backend's public/static egress IP to be whitelisted for both staging and production. Complete that partner-side setup before testing sessions. Local home networks with changing IPs may need their whitelist updated; don't work around the requirement by making browser calls directly to Transak.

From the project root, copy `.env.example` to `.env` only if you don't already have one. If `.env` exists, edit it and retain any MoonPay settings. Add:

```dotenv
TRANSAK_ENVIRONMENT=staging
TRANSAK_API_KEY=your_staging_api_key
TRANSAK_API_SECRET=your_staging_api_secret
TRANSAK_REFERRER_DOMAIN=http://localhost:3000
TRANSAK_SANDBOX_CLIENT_IP=your_browser_public_ip
TRANSAK_TRUSTED_PROXIES=
```

Replace the placeholders. The referrer must be the **exact frontend origin** you open, including the port. If you use `http://127.0.0.1:3000`, configure that value instead. Never put provider secrets in the frontend or `NEXT_PUBLIC_` variables.

The browser's public IP is required by Transak's `x-user-ip` header. For single-developer local Docker testing, the explicit `TRANSAK_SANDBOX_CLIENT_IP` setting supplies it because the Java backend otherwise sees only a Docker proxy address. Update it after network/VPN changes. This setting is ignored in production. Your backend's egress IP whitelist is a separate requirement from the end user's IP.

For Java outside Docker, copy `wallet/config/transak-local.properties.example` to `wallet/config/transak-local.properties` and configure the corresponding properties. Both actual local credential files are Git-ignored and excluded from Docker builds.

References: [session API](https://docs.transak.com/api/public/create-widget-url), [security requirements](https://docs.transak.com/guides/mandatory-security-changes).

## 2. Build and start the application

Start Docker Desktop, then:

```sh
cd /Users/zeranyao/Projects/wallet
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Open `http://localhost:3000` and create or unlock your wallet. Existing encrypted phrase-based wallets remain compatible, and their Ethereum address does not change.

A quick API check:

```sh
curl --fail http://localhost:3000/api/transak/config
```

Expect staging configuration. `available: false` means credentials are missing. `available: true` means keys are present locally, not that Transak has validated them or approved your egress IP.

After only editing `.env`, `docker compose up -d --wait` reloads changed container settings; `restart` alone does not. After code changes, use `--build`.

## 3. Create a staging checkout

1. On the unlocked account screen, find **Buy crypto with Transak**.
2. Select **Try a staging purchase**.
3. For a delivered test token, choose **USDC**, an amount accepted by Transak, and a supported fiat currency. The initial form uses GBP 50; Transak sets actual limits and fees.
4. Check the Ethereum destination address shown in the form.
5. Select **Continue to Transak**. The backend obtains/caches a partner access token, creates a new single-use session, and redirects to Transak's staging widget.
6. Confirm you are in staging/test mode before using test identity or card data.

The destination is locked to this wallet and the purchase network is fixed to Ethereum. Selecting Bitcoin or OP Mainnet in the balance panel does not redirect Ethereum purchases to those networks.

Sessions expire after five minutes and are single-use. Start again from the app for each attempt; don't bookmark/reopen old checkout URLs. Opening a session or returning to the wallet never marks a payment as successful. This implementation does not track orders or process webhooks.

## 4. Use Transak's test buyer and card data

Use the **current official [staging credentials guide](https://docs.transak.com/guides/sandbox-credentials)**. Do not reuse MoonPay's test-card settings: they belong to a different provider.

The guide supplies a US dummy identity, a downloadable test ID document, staging KYC instructions, and the US test SSN `123456789`. Follow its exact field values and supported document/selfie flow; don't invent production identity data. Use an email inbox you control for login messages.

Representative **staging-only** purchase cards:

| Fiat | Flow | Card | Expiry | CVV |
| --- | --- | --- | --- | --- |
| GBP | No visible 3DS challenge | `5352151570003404` | `10/33` | `100` |
| USD | 3DS | `4024764449971519` | `10/33` | `123` |
| GBP | 3DS | `4010061700000021` | `10/33` | `123` |
| GBP | Deliberate insufficient-funds failure | `4544249167673670` | `10/33` | `123` |

For staging 3DS authorization, the documented password is `Checkout1!`. A no-3DS card still needs payment approval. For UK staging buyers, the guide documents the `+seamless` email alias to skip the staging FCA journey. Use it only in staging and only as documented.

Complete the simulated payment in Transak, then check its order dashboard for the actual status and transaction hash. Do not infer success from the local balance alone. Test `+failed` and `+refund` staging aliases using the official guide if you need negative order scenarios.

## 5. Understand which tokens staging delivers

**A native ETH staging purchase does not send Sepolia ETH.** Transak's current guide says native-token orders are simulated without token delivery.

For ERC-20 purchases such as USDC on Ethereum, staging delivers **Transak Test Token (TRNSK)** on **Ethereum Sepolia**, rather than actual USDC. The published contract is:

```text
0x0c86a754a29714c4fe9c6f1359fa7099ed174c0b
```

Check the [official network table](https://docs.transak.com/guides/sandbox-credentials#blockchain-testnets-onramp) and the order's transaction hash. A completed dummy order and native ETH balance staying unchanged are compatible outcomes.

## 6. Verify a Sepolia test-token deposit

1. Return to the wallet and unlock it if necessary.
2. In **On-chain balance**, select **ETH · Sepolia testnet**.
3. Select **TRNSK · Transak staging test token**.
4. Select **Refresh balance** after the transaction is mined. The panel also refreshes every 30 seconds while the page is visible.
5. Open **View on block explorer** and compare the token transfer's destination with your Ethereum address and the contract above.

The backend reads the token's `balanceOf` and `decimals` from Sepolia. It is not a fake balance updated from checkout. Provider errors show **Unavailable** and an explanation rather than a fabricated zero.

## 7. Verify native Sepolia ETH balance independently

1. Keep Sepolia selected and change the asset to **ETH · native Sepolia gas token**.
2. Copy the receive address.
3. Send a small amount of **Sepolia test ETH** from another test wallet or request it from a Sepolia faucet. Never send mainnet ETH expecting it to appear on Sepolia.
4. Wait for the transaction to be mined and refresh.
5. Compare the balance with the address on Sepolia Etherscan.

Both networks use the same Ethereum address but have independent balances. A TRNSK deposit will not increase the native ETH figure.

Direct read-only API checks (replace the address):

```sh
curl --fail 'http://localhost:3000/api/balances?chain=sepolia&address=0xYOUR_ADDRESS&asset=native'
curl --fail 'http://localhost:3000/api/balances?chain=sepolia&address=0xYOUR_ADDRESS&asset=trnsk'
```

## 8. Switch chains and verify address handling

| Selector | Network | Address | Data shown |
| --- | --- | --- | --- |
| ETH · Sepolia testnet | Ethereum Sepolia, ID 11155111 | Existing `0x...` address | Native ETH or staging TRNSK |
| ETH · Ethereum mainnet | Ethereum, ID 1 | Same `0x...` address | Native ETH |
| BTC · Bitcoin mainnet | Bitcoin | Separate `bc1q...` receive address | Confirmed BTC plus unconfirmed net change |
| ETH · OP Mainnet | Optimism, ID 10 | Same `0x...` address | Native ETH |

OP Mainnet is an existing public OP Stack chain, **not our own appchain**. No custom rollup is deployed by this feature. Switching the display never moves funds or submits transactions.

Bitcoin uses BIP-84 path `m/84'/0'/0'/0/0`, derived in the browser from the original phrase. It is not the Ethereum private key reused as a Bitcoin address. The view covers the first receive address only, not a full Bitcoin wallet's change addresses or address-gap discovery. Raw-private-key wallets without mnemonic metadata show Bitcoin as unavailable rather than inventing an address. Phrase-based wallets created by this app continue to derive the same BTC address after locking/unlocking.

Do not send real BTC merely to test this development prototype. Verify zero balances and address/chain selection, or compare an existing receive-address balance without exposing private keys.

## 9. RPC and explorer configuration

The backend defaults to PublicNode's Ethereum, Sepolia and Optimism RPCs and mempool.space's Bitcoin address API. Optional root `.env` settings:

```dotenv
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
OPTIMISM_RPC_URL=https://optimism-rpc.publicnode.com
BITCOIN_API_URL=https://mempool.space/api
```

Use your provider's backend RPC URL here if you need more capacity. Values remain server-side. EVM reads check `eth_chainId` before using the configured endpoint. Wrong-network endpoints fail explicitly. Requests time out rather than leaving the UI waiting indefinitely. These are native-asset balances plus the single TRNSK contract; there is no automatic token discovery or fiat valuation.

Balance reads send only a public address to the selected public provider through our backend. Requests are not blockchain transactions and cost no gas. Their existence may be visible to the provider.

## 10. Failure checks

If partner authentication returns HTTP 400 with “Invalid API key,” obtain the **staging** API key and matching API secret from the Transak partner dashboard. Set `TRANSAK_ENVIRONMENT=staging`, `TRANSAK_API_KEY`, and `TRANSAK_API_SECRET` in the root `.env`, then run `docker compose up -d --force-recreate backend`. Restarting an existing container does not load changed environment variables. Do not switch to production just to bypass a staging credential error. This rejection happens before checkout creation or payment processing; test cards cannot fix it.

| Test | Expected result |
| --- | --- |
| No Transak credentials | Setup message; local wallet and balances remain usable. |
| Wrong frontend origin | Checkout API returns 403 before creating a session. |
| No verified client IP | Checkout API returns a setup error; it doesn't substitute a container IP. |
| Invalid API credentials | Clear provider-authentication failure; no key/token is echoed to the UI. |
| Backend egress IP not whitelisted | Provider failure with whitelist guidance. |
| Reopen a used/expired URL | Start a new checkout from the app. |
| Read provider offline or rate limited | Balance shows unavailable and can be retried. |
| Switch chains during an in-flight balance request | Old-chain values do not replace the selected-chain result. |
| Purchase ETH in staging | Order may complete with no native token delivery. |
| Purchase USDC in staging | Inspect TRNSK on Sepolia, not USDC or native ETH. |

For provider failures, inspect Transak's partner dashboard and retain its error code/order reference. Do not share secrets, identity details, session URLs, or access tokens in logs or chat. Before exposing this app publicly, configure HTTPS, ingress origin/IP enforcement, and signing/session endpoint rate limits. The fixed staging client IP is for local use only; production uses trusted ingress headers and ignores it.

## 11. Automated checks

```sh
cd wallet
./mvnw test
```

In another terminal from the project root:

```sh
cd web
npm test
npm run build -- --webpack
```

The backend tests use a fake HTTP transport for Transak and balances: they do not create provider orders. Tests cover session creation, token caching, origin enforcement, environment isolation, upstream failures, RPC chain checks, wei/satoshi precision, and token balance calls. Frontend tests include the official BIP-84 address vector, existing-vault compatibility, exact balance formatting, opaque Transak URL validation, and the retained MoonPay tests.

Real Transak session creation and a simulated payment still require valid staging credentials and provider-side IP whitelisting. No real money is spent by automated checks.

## Verification performed for this implementation

- 30 backend tests passed, including the preserved MoonPay suite.
- 12 frontend tests passed.
- Both Docker images built and the containers became healthy.
- Live read-only API checks returned balances for Ethereum, Sepolia, OP Mainnet, Bitcoin, and Sepolia TRNSK.
- Headless Chrome passed phrase restore, default Sepolia selection, chain/address switching, BTC address persistence through lock/unlock, Transak UI selection, and mobile-width/runtime checks in an isolated test browser profile.
- Transak configuration correctly reports unavailable when credentials are missing. Provider session creation and simulated payment have **not** been verified against Transak: staging credentials and egress-IP whitelisting still need to be configured. Mocked provider tests are not a substitute for that final staging purchase.
