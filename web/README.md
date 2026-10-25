# Payment wallet

The default page is the **custodial payment simulator**, with no active external provider. See [the current testing procedure](../CUSTODIAL_DEMO.md). The on-chain wallet remains at `/self-custody`; provider sections below document preserved legacy code.

Local Next.js frontend for a payment-focused OP Stack appchain project.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:3000. Run `npm test` for wallet cryptography tests and `npm run build` for a production build. Tests use Node 22.6+ experimental TypeScript stripping.

## Anonymous account registration

Feature 1 in `../doc/srs.txt` is implemented entirely in the browser:

1. Generate a cryptographically random 12-word English BIP-39 recovery phrase, or restore an existing valid English mnemonic.
2. For new wallets, save the phrase and fill in missing words in the same 12-word grid over two rounds. Each round blanks six alternating positions, confirming every word before password creation.
3. Set and confirm a device password of at least 12 characters.
4. Derive the BIP-39 seed and Ethereum secp256k1 key pair at `m/44'/60'/0'/0/0` using ethers v6.
5. Save only an encrypted ethers JSON keystore under `wallet.vault.v1` in localStorage. The keystore encrypts the private key and mnemonic metadata using the library's default scrypt-based protection. Passwords, plaintext recovery phrases, seeds, and private keys are never persisted or sent to a backend.
6. Show the public address and public key. Lock manually or reload to return to the password unlock screen.

The device password is not a BIP-39 passphrase: changing the device password through restoration does not change the account. BIP-39 additional passphrases and multiple accounts are not supported yet. There is one saved wallet per browser origin. If the password is lost or storage is damaged, restore the recovery phrase in a fresh browser profile; existing vaults are not overwritten. Clearing browser storage removes the local vault, so retain the recovery phrase offline.

Wallet creation uses no email, identity service, RPC, on-chain registration, or backend registration endpoint. This implements local wallet ownership; it does not provide network anonymity for future transactions. The Spring Boot backend in `../wallet` is required for MoonPay checkout; wallet creation and unlock still work locally without it.

## Fiat-to-crypto with MoonPay (Feature 2)

The account screen includes a MoonPay purchase form. Choose a fiat amount and USD, EUR, or GBP. The frontend sends only the public delivery address, fiat currency, and amount to the Spring Boot backend. The backend constructs and HMAC-SHA256-signs a MoonPay checkout URL with the wallet address and ETH prefilled. The browser checks the destination host, address, and asset before navigating to MoonPay. MoonPay handles payment details, identity checks, pricing, and delivery.

### Start both applications

1. In `../wallet`, copy `config/moonpay-local.properties.example` to `config/moonpay-local.properties` and add your MoonPay sandbox publishable and secret keys. The real file is ignored by Git. See `../wallet/README.md` for environment-variable configuration.
2. Run `./mvnw spring-boot:run` in `../wallet` (Java 25 required).
3. Run `npm run dev` here. Next.js proxies `/api/moonpay/*` to `http://127.0.0.1:8080`. Set the server-only `WALLET_API_URL` in `.env.local` if the backend runs elsewhere; restart Next after changing it. Rebuild for a production deployment after changing that URL.
4. Create or unlock a wallet, then choose **Try a sandbox purchase**.

Without keys, the server starts normally and the UI explains that checkout is not configured. When the server is offline, the UI offers a retry. No MoonPay secret key belongs in the frontend or any `NEXT_PUBLIC_` variable.

Sandbox is the default: no real funds are transferred. Local sandbox checkout also needs IP matching for this account: configure `MOONPAY_SANDBOX_CLIENT_IP` in the root Compose `.env`. Production mode requires matching live keys and signed public-IP binding through a trusted ingress; see the backend README. Production purchases deliver **ETH on Ethereum mainnet**, not our future custom OP Stack appchain. MoonPay determines country coverage, fees, limits, identity requirements, and payment methods.

There is no order database or custody of user funds. Opening checkout or returning to this app never counts as payment success. Order tracking, webhooks, balance reads, and deposit verification are not implemented; check the MoonPay order for its delivery status. The app does not receive payment-card data, identity documents, recovery phrases, private keys, or device passwords at its backend.

References: [URL signing](https://dev.moonpay.com/widget/on-ramp/customization/url-signing), [production IP matching](https://dev.moonpay.com/widget/on-ramp/customization/ip-matching), [checkout parameters](https://dev.moonpay.com/widget/on-ramp/customization/parameters).

## Security boundary

This is a development prototype; use test accounts only. An encrypted local vault does not protect against malicious JavaScript running in the same origin or a compromised browser. Keep secrets out of logs, analytics, and server components. Account creation clears references to the plaintext wallet after encryption; JavaScript does not guarantee memory zeroization. Browser interaction tests and a security review are still needed before use with real funds.

## Verification

Run `npm test` for cryptography and checkout redirect tests, `npm run build -- --webpack` for a production build, and `./mvnw test` from the backend directory (`../wallet`) for server tests. Turbopack previously hit a compiler subprocess port restriction in this execution environment, so production verification uses Webpack. Verified real HTTP responses from the Java server and through the Next.js proxy (configuration 200, unavailable checkout 503, frontend page 200). All 14 backend tests, 8 frontend tests, and the production build pass. Browser interactions and a MoonPay sandbox purchase still need testing with real sandbox credentials.

Reference: [ethers wallet documentation](https://docs.ethers.org/v6/api/wallet/).
# Current wallet UI

The default page is the PostgreSQL-backed custodial simulator. The existing encrypted on-chain wallet remains at `/self-custody`. See [CUSTODIAL_DEMO.md](../CUSTODIAL_DEMO.md) for setup and testing. Start the full stack from the repository root with Docker Compose; the frontend proxies `/api/custody/*` to the backend.

