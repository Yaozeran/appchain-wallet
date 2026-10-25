# Wallet backend

The active flow is the **PostgreSQL-backed custodial simulator**, with `/api/custody/*` routes. See [CUSTODIAL_DEMO.md](../CUSTODIAL_DEMO.md) for setup and test procedures. The provider notes below describe preserved legacy code. On-chain reads remain available via `/api/balances`.

Spring Boot 4.1.1 / Java 25 server for demo authentication, balances, fake card conversions, and simulated payments. Use root Docker Compose to run it with PostgreSQL. The separate self-custody wallet still derives and encrypts keys in the browser.

## Local setup

```sh
cp config/moonpay-local.properties.example config/moonpay-local.properties
```

Put the `pk_test_...` and `sk_test_...` keys from your MoonPay developer dashboard into the copied file, then start the server from this directory:

```sh
./mvnw spring-boot:run
```

The local file is ignored by Git. Alternatively configure `MOONPAY_PUBLISHABLE_KEY` and `MOONPAY_SECRET_KEY` in the server environment. Never put a secret key in a frontend environment variable. The default environment is `sandbox`; missing or mismatched keys disable checkout without preventing startup. The default address is `127.0.0.1:8080`; override with `SERVER_ADDRESS` and `SERVER_PORT` for your deployment.

Start the frontend separately in `../web` with `npm run dev`. Its same-origin `/api/moonpay/*` routes proxy to this backend, so browser CORS configuration is not required. `WALLET_API_URL` controls the upstream at Next startup/build time. The backend origin should not be publicly exposed when placed behind the application ingress.

## API

- `GET /api/moonpay/config`: non-secret availability, environment, asset/network, and supported form currencies.
- `POST /api/moonpay/checkout`: `{ "walletAddress": "0x...", "fiatCurrency": "usd", "fiatAmount": 50 }`; returns `{ "url": "https://buy-sandbox.moonpay.com?...", "environment": "sandbox" }`.

The destination is a nonzero 20-byte Ethereum address. The form supports USD, EUR, GBP and integer amounts 1–100000 as application input bounds; these are not MoonPay's purchase limits. MoonPay enforces its own regional limits, quotes, fees, and payment availability. ETH (`eth`) and the checkout hosts are fixed on the server. Arbitrary URLs, other networks, extra fee parameters, and redirect URLs cannot be supplied for signing. Configuration, checkout, and handled error responses use `Cache-Control: no-store`.

No account registration API, database, order state, payment capture, balance query, or webhook endpoint is included. A signed URL is not proof of a payment or deposit. MoonPay order status remains the source for the customer's checkout result. Do not credit any internal balance based on a redirect or a frontend callback.

## Local sandbox IP matching

MoonPay may display “Signature check failed” when its actual API error is `5_PARTNERS_IP_MISSING` (“Missing allowedIpAddress on signed URL”). A correctly computed URL signature alone is insufficient for accounts enforcing IP matching.

For local Docker testing by one developer, configure the root `.env`:

```dotenv
MOONPAY_IP_MATCHING=true
MOONPAY_SANDBOX_CLIENT_IP=your_browser_public_ip
```

Use the public IP seen by MoonPay for the browser opening checkout, not a Docker/container, loopback, or LAN IP. Obtain it through MoonPay's [IP address endpoint](https://dev.moonpay.com/api-reference/widget/getipaddress) with your publishable test key. The response's `ipAddress` is the address MoonPay observes for that request; VPNs, Private Relay, or IPv4/IPv6 routing can cause a different browser address. Then run `docker compose up -d --wait` from the repository root. When running Java directly, use `moonpay.sandbox-client-ip` in your local properties instead.

This explicit fixed IP is for single-developer sandbox use only. It is ignored in production; production still requires a trusted ingress. When the public IP changes, update the setting and recreate the backend. Do not use one developer's IP for a publicly shared app.

## Sandbox and production

Sandbox is the default and does not spend real money or deliver real crypto. Test signing and request validation with `./mvnw test`.

For a production deployment:

- Set `MOONPAY_ENVIRONMENT=production` and matching `pk_live_...` / `sk_live_...` keys after MoonPay enables your account. Production buys ETH on **Ethereum mainnet**, not the custom OP Stack chain.
- Production always requires IP binding; `MOONPAY_IP_MATCHING=false` cannot disable it. Sandbox defaults to binding too: this MoonPay account rejects signed URLs without `allowedIpAddress`. Disabling our flag does not disable MoonPay enforcement.
- Configure a trusted ingress to overwrite `True-Client-IP` with the visitor's public IP. Forward that header through Next to Java, and set `MOONPAY_TRUSTED_PROXIES` to the comma-separated **socket peer addresses** Java sees (for example, the internal Next proxy addresses). It defaults to no trusted proxies. Lock down direct access to both the Java server and any Next origin that bypasses this ingress; visitors must never be able to set this header through a bypass route. Do not use a shared or arbitrary client-controlled header as the IP source.
- The server accepts `True-Client-IP` only from configured peers, validates literal IPv4/IPv6 addresses without DNS, normalizes IPv6 to RFC 5952, unmaps mapped IPv4, and rejects local addresses. It HMACs the IP and includes that hash in the signed query. Missing/untrusted IP context fails checkout with 503. VPN or network changes between URL creation and opening MoonPay can invalidate the URL; create a new checkout in that case.
- Use HTTPS for the public application and configure MoonPay's allowed domains. Keep signed URLs out of access/analytics logs. Before public exposure, configure ingress request-size limits and rate limits for the signing endpoint.

The secret key stays in the backend. The API never asks for a recovery phrase or private key; payment and identity details are entered only at MoonPay.

## Verification limits

Automated tests cover signing against an independently computed HMAC fixture, fixed recipients/assets, malformed input, missing credentials, sandbox/live key isolation, production IP binding, trusted-proxy enforcement, IP normalization, HTTP responses, and credential redaction. Completing provider checkout requires your own valid MoonPay sandbox credentials. No real purchase is made during tests. The Docker services were also built and started successfully, and headless Chrome verified that adding `allowedIpAddress` removed `5_PARTNERS_IP_MISSING` and reached MoonPay's Test Mode “Buy ETH” screen. No payment or identity information was submitted.

References: [MoonPay URL signing](https://dev.moonpay.com/widget/on-ramp/customization/url-signing), [IP matching](https://dev.moonpay.com/widget/on-ramp/customization/ip-matching), [widget parameters](https://dev.moonpay.com/widget/on-ramp/customization/parameters).
# Current custodial demo

The backend now requires PostgreSQL and applies Flyway migrations at startup. Start the full app from the repository root with `docker compose up -d --build --wait`. See [CUSTODIAL_DEMO.md](../CUSTODIAL_DEMO.md) for configuration, account/payment APIs, and integration checks. Provider notes below describe the retained legacy integration.

