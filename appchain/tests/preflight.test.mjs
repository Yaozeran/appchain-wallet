import {test} from "node:test";
import assert from "node:assert/strict";
import {deployerFeeCaps,estimateDeployment} from "../tools/preflight.mjs";

const plan=[{to:"0x"+"1".repeat(40),data:"0x1234",value:"0x0"}];
function rpc({fail=false,chain="0xaa36a7",balance="0x2386f26fc10000"}={}) {
  return async (method,params)=>{
    if(method==="eth_chainId")return chain;
    if(method==="eth_getBlockByNumber")return {number:"0x1",baseFeePerGas:"0x11",gasLimit:"0xbebc200"};
    if(method==="eth_gasPrice")return "0xf4251";
    if(method==="eth_maxPriorityFeePerGas")return "0xf4240";
    if(method==="eth_getBalance")return balance;
    if(method==="eth_estimateGas"){
      assert.equal("gas" in params[0],false,"Never force a gas limit to bypass a revert");
      assert.equal(params[0].gasPrice,"0xf4251");
      if(fail)throw new Error("Proxy: delegatecall to new implementation contract failed");
      return "0x34a6258";
    }
    throw new Error("Unexpected RPC method, including any broadcast");
  };
}
test("upstream fee floors are included even when network gas is cheap",async()=>{
  const report=await estimateDeployment(rpc(),plan,"0x"+"2".repeat(40));
  assert.equal(report.simulationPassed,true);
  assert.equal(report.estimatedGas,"55206488");
  assert.equal(report.maxFeePerGasWei,"3000000000");
  assert.equal(report.requiredBalanceWei,"165619464000000000");
  assert.equal(report.sufficientBalance,false);
});
test("successful large-gas simulation and sufficient funding",async()=>{
  const report=await estimateDeployment(rpc({balance:"0xde0b6b3a7640000"}),plan,"0x"+"2".repeat(40));
  assert.equal(report.sufficientBalance,true);
  assert.equal(deployerFeeCaps(2_000_000_000n,20_000_000_000n).tipCap,50_000_000_000n);
});
test("simulation failure and wrong L1 fail closed without broadcasting",async()=>{
  await assert.rejects(estimateDeployment(rpc({fail:true}),plan,"sender"),/simulation gas cap/);
  await assert.rejects(estimateDeployment(rpc({chain:"0x1"}),plan,"sender"),/Sepolia/);
  await assert.rejects(estimateDeployment(rpc(),[...plan,...plan],"sender"),/atomic/);
});
