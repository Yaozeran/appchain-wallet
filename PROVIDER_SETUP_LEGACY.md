# Historical provider setup

Superseded by [CUSTODIAL_DEMO.md](CUSTODIAL_DEMO.md). These notes retain the earlier provider integration.

# Wallet

The active fiat-to-crypto provider is **Transak**. MoonPay code and credentials are preserved for later use.

The wallet now reads Sepolia ETH, Sepolia TRNSK test tokens, Ethereum mainnet ETH, Bitcoin BTC, and OP Mainnet ETH. Bitcoin uses its own BIP-84 address derived locally from the phrase. Existing phrase-based vaults remain compatible.

**Start with [TESTING.md](TESTING.md)** for Transak staging setup, test KYC/cards, Docker commands, expected token delivery, and chain/balance verification. Copy missing settings from [.env.example](.env.example) into the root `.env`; do not overwrite existing secrets. Run `docker compose up --build -d --wait` and open http://localhost:3000.

Transak staging simulates native ETH purchases without delivering ETH. Choose USDC to test a TRNSK deposit on Sepolia, then select Sepolia → TRNSK in the balance panel. Native Sepolia ETH must be funded independently.

The notes below retain the earlier MoonPay setup. Transak is the active UI and has its own credentials and partner IP-whitelisting requirements.

Next.js wallet frontend and Spring Boot MoonPay checkout backend.

For a step-by-step walkthrough with explanations, see [DOCKER_SETUP.md](DOCKER_SETUP.md).

## Run with Docker Compose

Install and start Docker Desktop, then run from the repository root:

```sh
cp .env.example .env
```

Edit **`/Users/zeranyao/Projects/wallet/.env`**, alongside `compose.yaml`:

```dotenv
MOONPAY_ENVIRONMENT=sandbox
MOONPAY_PUBLISHABLE_KEY=pk_test_your_key
MOONPAY_SECRET_KEY=sk_test_your_secret
```

Use the matching sandbox keys from the MoonPay developer dashboard. The values above are placeholders. Leave them empty to run the app with checkout disabled.

```sh
docker compose up --build -d --wait
```

Open **http://localhost:3000**. Change `WEB_PORT` in `.env` if port 3000 is already in use. Wallet browser storage belongs to an origin, so use the same host and port to see an existing wallet; restore your recovery phrase if switching origins.

```sh
docker compose ps
docker compose logs -f
docker compose down
```

## Where secrets go

- **Compose:** put MoonPay keys in the root `.env`, next to `compose.yaml`. Compose reads it automatically and passes the explicitly listed settings to the backend at runtime. No keys are passed to the frontend or Docker builds. Do not put MoonPay secrets in `web/.env.local` or any `NEXT_PUBLIC_` variable.
- The real `.env` is ignored by Git. Both build contexts exclude `.env` files, and the backend build excludes local `config/` credentials. Only `.env.example` belongs in source control. Do not share the output of `docker compose config`, which can contain expanded secrets; use `docker compose config --quiet` for validation.
- **Running Java without Docker:** use `wallet/config/moonpay-local.properties` or server environment variables as described in [the backend README](wallet/README.md). The root Compose `.env` is not automatically loaded by Java or Next when launched directly.
- After changing keys, run `docker compose up -d` to recreate the backend with updated settings. Rebuilding images is unnecessary for credential changes.

Only the frontend is published to the host, bound to loopback by default. It proxies `/api/moonpay/*` over the private Compose network to `backend:8080`. The backend health check succeeds even with empty credentials; the app then displays the checkout setup message. Both containers run as non-root users.

The frontend's proxy destination is set during image build, because Next.js serializes rewrites. The image uses `http://backend:8080`; browser requests use the frontend's origin. Docker builds need internet access for dependencies, base images, and Google fonts. No database or persistent server volume is needed; encrypted wallets remain in browser storage and MoonPay handles purchases.

## Local sandbox checkout IP

Keep `MOONPAY_IP_MATCHING=true`. This MoonPay account requires `allowedIpAddress` even in sandbox; otherwise it shows “Signature check failed” with API code `5_PARTNERS_IP_MISSING`.

Set `MOONPAY_SANDBOX_CLIENT_IP` in the root `.env` to the public IP of the browser opening checkout, then run `docker compose up -d --wait`. The development machine's current public IPv4 was configured during debugging. Update it after a network/VPN change. This override is only for a single developer testing locally and is ignored in production. See [sandbox IP configuration](wallet/README.md#local-sandbox-ip-matching).

## Live MoonPay checkout

Sandbox is the default and transfers no real funds. Production requires matching live keys, MoonPay approval, HTTPS, and a trusted ingress that supplies `True-Client-IP` for signed IP binding. This local Compose file does not set up that ingress. See [backend configuration](wallet/README.md#sandbox-and-production) before enabling production. Live purchases buy ETH on Ethereum mainnet, not the future OP Stack appchain.

See [frontend documentation](web/README.md) for registration and checkout behavior.
