#!/bin/sh
set -eu
case "$APPCHAIN_SERVICE" in
  op-node)
    : "${OP_NODE_L1_ETH_RPC:?Set APPCHAIN_L1_RPC_URL in the root .env}"
    : "${OP_NODE_L1_BEACON:?Set APPCHAIN_L1_BEACON_URL in the root .env}"
    export OP_NODE_P2P_SEQUENCER_KEY="$(cat /run/secrets/appchain-sequencer-key)"
    exec op-node "$@"
    ;;
  op-batcher)
    : "${OP_BATCHER_L1_ETH_RPC:?Set APPCHAIN_L1_RPC_URL in the root .env}"
    export OP_BATCHER_PRIVATE_KEY="$(cat /run/secrets/appchain-batcher-key)"
    exec op-batcher "$@"
    ;;
  *) echo "Unsupported appchain service" >&2; exit 1 ;;
esac
