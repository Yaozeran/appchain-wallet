FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-deployer:v0.8.1 AS deployer
FROM node:22-alpine3.23
RUN apk add --no-cache ca-certificates libstdc++ libgcc openssl
COPY --from=deployer /usr/local/bin/op-deployer /usr/local/bin/op-deployer
COPY --from=deployer /usr/local/bin/forge /usr/local/bin/forge
ENV FORGE_ENV=alpine
WORKDIR /tools
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY setup.mjs config.mjs preflight.mjs ./
ENTRYPOINT ["node", "/tools/setup.mjs"]
