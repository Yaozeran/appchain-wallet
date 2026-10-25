# Pin the versions used by the official create-l2-rollup example.
FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.19.3 AS node-binary
FROM us-docker.pkg.dev/oplabs-tools-artifacts/images/op-batcher:v1.16.11 AS batcher-binary

FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates
COPY entrypoint.sh /usr/local/bin/appchain-entrypoint
RUN chmod 755 /usr/local/bin/appchain-entrypoint
ENTRYPOINT ["/usr/local/bin/appchain-entrypoint"]

FROM runtime AS op-node
COPY --from=node-binary /usr/local/bin/op-node /usr/local/bin/op-node
ENV APPCHAIN_SERVICE=op-node

FROM runtime AS op-batcher
COPY --from=batcher-binary /usr/local/bin/op-batcher /usr/local/bin/op-batcher
ENV APPCHAIN_SERVICE=op-batcher
