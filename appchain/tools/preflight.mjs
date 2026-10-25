// Fee policy of the pinned op-deployer v0.8.1 keyed broadcaster and txmgr.
// Recheck against upstream when changing the deployer image version.
const GWEI = 1_000_000_000n;
export function deployerFeeCaps(baseFee, suggestedTip) {
  const tip = suggestedTip * 5n;
  const tipCap = tip < GWEI ? GWEI : tip > 50n * GWEI ? 50n * GWEI : tip;
  const paddedBase = baseFee + baseFee / 2n;
  const base = paddedBase < GWEI ? GWEI : paddedBase;
  return { tipCap, maxFeePerGas: tipCap + 2n * base };
}

export async function estimateDeployment(rpc, transactions, from) {
  if (BigInt(await rpc("eth_chainId",[])) !== 11155111n)
    throw new Error("Deployment preflight requires Ethereum Sepolia.");
  // Current standard OPCM deployment is one atomic transaction. Don't pretend
  // independently estimating a multi-step dependent plan proves it can execute.
  if (!Array.isArray(transactions) || transactions.length !== 1)
    throw new Error("Expected one atomic OPCM deployment transaction; review the deployment plan before broadcasting.");
  const block = await rpc("eth_getBlockByNumber",["latest",false]);
  const [gasPrice, tip, balance] = await Promise.all([
    rpc("eth_gasPrice",[]),rpc("eth_maxPriorityFeePerGas",[]),rpc("eth_getBalance",[from,"latest"]),
  ]);
  const fees = deployerFeeCaps(BigInt(block.baseFeePerGas),BigInt(tip));
  const tx = transactions[0];
  let gas;
  try {
    // Let the target node apply its current fork rules and simulation ceiling.
    // A local old-fork trace or a hardcoded gas limit is not an acceptable substitute.
    gas = BigInt(await rpc("eth_estimateGas",[{from,to:tx.to,data:tx.data,value:tx.value || "0x0",gasPrice}]));
  } catch {
    throw new Error("Deployment RPC rejected gas simulation. Check its simulation gas cap and current Sepolia fork support; no transaction was broadcast.");
  }
  if (gas <= 0n || gas > BigInt(block.gasLimit)) throw new Error("Deployment estimate exceeds the current L1 block gas limit.");
  const value = BigInt(tx.value || "0x0");
  const required = gas * fees.maxFeePerGas + value;
  return {
    chainId:11155111, blockNumber:BigInt(block.number).toString(), transactionCount:1,
    estimatedGas:gas.toString(),networkGasPriceWei:BigInt(gasPrice).toString(),
    maxPriorityFeePerGasWei:fees.tipCap.toString(),maxFeePerGasWei:fees.maxFeePerGas.toString(),
    networkQuoteWei:(gas*BigInt(gasPrice)+value).toString(),
    requiredBalanceWei:required.toString(),balanceWei:BigInt(balance).toString(),
    sufficientBalance:BigInt(balance)>=required,simulationPassed:true,
  };
}
