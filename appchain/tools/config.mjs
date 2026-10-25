export const L1_CHAIN_ID = 11155111;

export function chainId(value) {
  const id = Number(value || 42069);
  if (!Number.isSafeInteger(id) || id < 10000 || id > 2147483647 || [11155111,11155420].includes(id))
    throw new Error("Choose a development APPCHAIN_CHAIN_ID from 10000 to 2147483647, distinct from Sepolia/OP Sepolia.");
  return id;
}

export function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value))
    throw new Error("Expected a nonzero Ethereum address.");
  return value;
}

export function configureIntent(intent, id, roles) {
  if (Number(intent.l1ChainID) !== L1_CHAIN_ID || intent.chains?.length !== 1 || !intent.chains[0].roles)
    throw new Error("Unexpected op-deployer intent format. Review the pinned deployer version before proceeding.");
  for (const role of ["admin","deployer","sequencer","batcher","proposer","challenger","payment"]) address(roles[role]);
  const chain = intent.chains[0];
  chain.id = "0x" + BigInt(id).toString(16).padStart(64,"0");
  // Never seed public, universally-known development keys on a Sepolia-backed chain.
  intent.fundDevAccounts = false;
  for (const key of ["baseFeeVaultRecipient","l1FeeVaultRecipient","sequencerFeeVaultRecipient","operatorFeeVaultRecipient"])
    chain[key] = roles.admin;
  Object.assign(chain.roles, {
    l1ProxyAdminOwner: roles.admin, l2ProxyAdminOwner: roles.admin, systemConfigOwner: roles.admin,
    unsafeBlockSigner: roles.sequencer, batcher: roles.batcher, proposer: roles.proposer, challenger: roles.challenger,
  });
  return intent;
}

export function validateExport(genesis, rollup, id, roles) {
  if (Number(genesis.config?.chainId) !== id || Number(rollup.l2_chain_id) !== id || Number(rollup.l1_chain_id) !== L1_CHAIN_ID)
    throw new Error("Exported chain IDs do not match the configured deployment.");
  address(rollup.batch_inbox_address);
  address(rollup.deposit_contract_address);
  address(rollup.l1_system_config_address);
  const sender = rollup.genesis?.system_config?.batcherAddr;
  if (sender?.toLowerCase() !== roles.batcher.toLowerCase())
    throw new Error("The exported rollup batch sender does not match our generated batcher key.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(rollup.genesis?.l1?.hash || "") || /^0x0+$/.test(rollup.genesis.l1.hash))
    throw new Error("Missing deployed L1 anchor in rollup configuration.");
}
