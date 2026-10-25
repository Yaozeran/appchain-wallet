import { test } from "node:test";
import assert from "node:assert/strict";
import { chainId, configureIntent, validateExport, address } from "../tools/config.mjs";

const roles = Object.fromEntries(["admin","deployer","sequencer","batcher","proposer","challenger","payment"]
  .map((role,i) => [role,"0x"+(i+1).toString(16).padStart(40,"0")]));

test("operator addresses fill all chain roles without reusing the deployment key", () => {
  const input = { l1ChainID:11155111, fundDevAccounts:true, opcmAddress:"keep-upstream-opcm", chains:[{roles:{}}] };
  const result = configureIntent(input,42069,roles);
  assert.equal(result.opcmAddress,"keep-upstream-opcm");
  assert.equal(result.fundDevAccounts,false);
  assert.equal(BigInt(result.chains[0].id),42069n);
  assert.equal(result.chains[0].roles.unsafeBlockSigner,roles.sequencer);
  assert.equal(result.chains[0].roles.batcher,roles.batcher);
  assert.notEqual(result.chains[0].roles.batcher,roles.deployer);
  assert.equal(result.chains[0].operatorFeeVaultRecipient,roles.admin);
});
test("rejects unknown intent schema and unsafe chain IDs", () => {
  for (const value of [1,10,11155111,11155420,"NaN",1.5,-1]) assert.throws(() => chainId(value));
  assert.equal(chainId("42069"),42069);
  assert.throws(() => address("0x"+"0".repeat(40)));
  assert.throws(() => configureIntent({l1ChainID:1,chains:[{roles:{}}]},42069,roles));
});
test("export validation catches wrong chain, portal, and batcher key", () => {
  const genesis = {config:{chainId:42069}};
  const rollup = {l1_chain_id:11155111,l2_chain_id:42069,batch_inbox_address:roles.admin,
    deposit_contract_address:roles.admin,l1_system_config_address:roles.admin,
    genesis:{system_config:{batcherAddr:roles.batcher},l1:{hash:"0x"+"1".repeat(64)}}};
  validateExport(genesis,rollup,42069,roles);
  assert.throws(() => validateExport(genesis,{...rollup,l2_chain_id:10},42069,roles));
  assert.throws(() => validateExport(genesis,{...rollup,deposit_contract_address:""},42069,roles));
  assert.throws(() => validateExport(genesis,rollup,42069,{...roles,batcher:roles.deployer}));
});
