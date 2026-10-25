import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Wallet, JsonRpcProvider, Contract, parseEther, formatEther } from "ethers";
import TOML from "@iarna/toml";
import { address, chainId, configureIntent, validateExport, L1_CHAIN_ID } from "./config.mjs";
import { estimateDeployment } from "./preflight.mjs";

process.umask(0o077);
const root = "/data";
const work = path.join(root,"deployer");
const id = chainId(process.env.APPCHAIN_CHAIN_ID);
const publicFile = path.join(root,"public.json");
const action = process.argv[2] || "help";
const roleNames = ["admin","deployer","sequencer","batcher","proposer","challenger","payment"];
const readJson = file => JSON.parse(fs.readFileSync(file,"utf8"));
function write(file, content) { fs.writeFileSync(file,content,{mode:0o600}); }
function publicConfig() {
  if (!fs.existsSync(publicFile)) throw new Error("Run the tools init command first.");
  const config = readJson(publicFile);
  if (config.chainId !== id) throw new Error("APPCHAIN_CHAIN_ID differs from the initialized chain. Restore the original value.");
  return config;
}
function wallet(role, provider) { return new Wallet(fs.readFileSync(path.join(root,"secrets",role+".key"),"utf8").trim(),provider); }
function deployer(args, env = {}) {
  const logfile = path.join(root,"deployment.log");
  const log = fs.openSync(logfile,"a",0o600);
  try {
    const captureJson = args[0] === "inspect";
    const result = spawnSync("op-deployer",["--cache-dir",path.join(root,"cache"),...args],{
      env:{...process.env,...env},encoding:"utf8",stdio:["ignore",captureJson ? "pipe" : log,log],maxBuffer:128*1024*1024,
      // Only a non-broadcasting collector may be interrupted by this timeout.
      timeout: args.includes("calldata") ? 300000 : undefined,
    });
    if (result.status !== 0 || result.error) {
      if (result.stdout) fs.appendFileSync(logfile,result.stdout);
      throw new Error("op-deployer failed. Inspect appchain/.local/deployment.log locally; it may contain sensitive deployment details.");
    }
    return result.stdout || "";
  } finally { fs.closeSync(log); }
}
async function l1(deployment = false) {
  const url = deployment ? (process.env.APPCHAIN_DEPLOYMENT_RPC_URL || process.env.APPCHAIN_L1_RPC_URL) : process.env.APPCHAIN_L1_RPC_URL;
  if (!url) throw new Error("Set APPCHAIN_L1_RPC_URL in the root .env (a Sepolia execution RPC).");
  if (!process.env.APPCHAIN_L1_BEACON_URL) throw new Error("Set APPCHAIN_L1_BEACON_URL in the root .env.");
  const provider = new JsonRpcProvider(url);
  if ((await provider.getNetwork()).chainId !== BigInt(L1_CHAIN_ID)) throw new Error("L1 RPC must be Ethereum Sepolia. Mainnet and OP Mainnet are refused.");
  return provider;
}
async function l2() {
  const provider = new JsonRpcProvider("http://op-reth:8545");
  if ((await provider.getNetwork()).chainId !== BigInt(id)) throw new Error("The appchain RPC returned the wrong chain ID.");
  return provider;
}
async function init() {
  // Check before generating anything: never replace existing operator identities or state.
  if (fs.existsSync(publicFile) || fs.existsSync(work) || fs.existsSync(path.join(root,"secrets")))
    throw new Error("Deployment files already exist. Initialization will not overwrite keys or deployment state.");
  fs.mkdirSync(path.join(root,"secrets"),{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(root,"runtime"),{recursive:true,mode:0o700});
  const roles = {};
  for (const role of roleNames) {
    const created = Wallet.createRandom();
    write(path.join(root,"secrets",role+".key"),created.privateKey+"\n");
    roles[role] = created.address;
  }
  write(path.join(root,"secrets","jwt"),randomBytes(32).toString("hex")+"\n");
  write(publicFile,JSON.stringify({chainId:id,l1ChainId:L1_CHAIN_ID,roles},null,2)+"\n");
  deployer(["init","--l1-chain-id",String(L1_CHAIN_ID),"--l2-chain-ids",String(id),"--intent-type","standard-overrides","--workdir",work]);
  const intentFile = path.join(work,"intent.toml");
  const intent = configureIntent(TOML.parse(fs.readFileSync(intentFile,"utf8")),id,roles);
  write(intentFile,TOML.stringify(intent));
  console.log("Initialized new operator identities and intent. No L1 transactions were sent.");
  console.log(JSON.stringify({chainId:id,roles},null,2));
}
async function deploy() {
  const report = await preflight();
  if (!report.sufficientBalance) throw new Error(`Deployment simulation passed, but the pinned deployer fee caps require ${formatEther(report.requiredBalanceWei)} ETH available; current balance is ${formatEther(report.balanceWei)} ETH. No transaction was broadcast.`);
  const provider = await l1(true);
  const signer = wallet("deployer",provider);
  if ((await provider.getBalance(signer.address)) === 0n) throw new Error("Fund the deployer address in public.json with Sepolia ETH before deploying.");
  console.log("Deploying contracts on Ethereum Sepolia. This spends test ETH and preserves resumable deployment state.");
  deployer(["apply","--workdir",work,"--deployment-target","live"],{
    L1_RPC_URL:process.env.APPCHAIN_DEPLOYMENT_RPC_URL || process.env.APPCHAIN_L1_RPC_URL, DEPLOYER_PRIVATE_KEY:signer.privateKey,
  });
  console.log("L1 deployment completed. Run tools export next.");
}
async function preflight() {
  const config = publicConfig();
  const provider = await l1(true);
  const signer = wallet("deployer",provider);
  const staging = fs.mkdtempSync(path.join(root,"preflight-"));
  // Retain operator identities and original deployment state. The collector target
  // produces calldata only; it never calls eth_sendRawTransaction.
  for (const name of ["intent.toml","state.json"])
    fs.copyFileSync(path.join(work,name),path.join(staging,name));
  console.log("Generating a non-broadcasting deployment plan in an isolated work directory…");
  deployer(["apply","--workdir",staging,"--deployment-target","calldata","--no-verify"],{
    L1_RPC_URL:process.env.APPCHAIN_DEPLOYMENT_RPC_URL || process.env.APPCHAIN_L1_RPC_URL,
    DEPLOYER_PRIVATE_KEY:signer.privateKey,
  });
  const state = readJson(path.join(staging,"state.json"));
  const report = await estimateDeployment((method,params)=>provider.send(method,params),state.DeploymentCalldata,config.roles.deployer);
  write(path.join(root,"preflight-report.json"),JSON.stringify({...report,checkedAt:new Date().toISOString()},null,2)+"\n");
  console.log(JSON.stringify({...report,
    requiredBalanceEth:formatEther(report.requiredBalanceWei),balanceEth:formatEther(report.balanceWei)},null,2));
  return report;
}
function exportConfig() {
  const config = publicConfig();
  const genesis = JSON.parse(deployer(["inspect","genesis","--workdir",work,String(id)]));
  const rollup = JSON.parse(deployer(["inspect","rollup","--workdir",work,String(id)]));
  validateExport(genesis,rollup,id,config.roles);
  const runtime = path.join(root,"runtime");
  write(path.join(runtime,"genesis.json"),JSON.stringify(genesis));
  write(path.join(runtime,"rollup.json"),JSON.stringify(rollup,null,2));
  console.log("Exported matching genesis and rollup configuration. Batcher address matches its actual key.");
}
async function status() {
  publicConfig();
  const provider = await l2();
  const response = await fetch("http://op-node:8547",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method:"optimism_syncStatus",params:[]}),signal:AbortSignal.timeout(10000)});
  const result = await response.json();
  if (!response.ok || result.error) throw new Error("Rollup status unavailable.");
  console.log(JSON.stringify({chainId:id,block:await provider.getBlockNumber(),
    unsafeL2:result.result.unsafe_l2,safeL2:result.result.safe_l2,finalizedL2:result.result.finalized_l2},null,2));
}
async function deposit() {
  const config = publicConfig();
  const to = address(process.argv[3] || config.roles.payment);
  const amount = parseEther(process.argv[4] || "0.01");
  if (amount <= 0n || amount > parseEther("1")) throw new Error("A demo deposit must be greater than zero and at most 1 Sepolia ETH.");
  const rollup = readJson(path.join(root,"runtime","rollup.json"));
  const signer = wallet("deployer",await l1());
  const portal = new Contract(address(rollup.deposit_contract_address),[
    "function depositTransaction(address to,uint256 value,uint64 gasLimit,bool isCreation,bytes data) payable",
  ],signer);
  const tx = await portal.depositTransaction(to,amount,100000,false,"0x",{value:amount});
  console.log("Sepolia deposit submitted:",tx.hash);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Deposit reverted.");
  console.log("Deposit included on L1. Wait for the sequencer to derive it; this does not modify PostgreSQL demo balances.");
}
async function pay() {
  publicConfig();
  const to = address(process.argv[3]);
  const amount = parseEther(process.argv[4] || "0.001");
  if (amount <= 0n) throw new Error("Payment must be positive.");
  const signer = wallet("payment",await l2());
  const tx = await signer.sendTransaction({to,value:amount});
  console.log("Appchain payment submitted:",tx.hash);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Payment reverted.");
  console.log(`Included in L2 block ${receipt.blockNumber}: ${formatEther(amount)} ETH. Inclusion is not L1 finality.`);
}
try {
  if (action === "init") await init();
  else if (action === "preflight") await preflight();
  else if (action === "deploy") await deploy();
  else if (action === "export") exportConfig();
  else if (action === "status") await status();
  else if (action === "deposit") await deposit();
  else if (action === "pay") await pay();
  else if (action === "addresses") console.log(JSON.stringify(publicConfig(),null,2));
  else console.log("Commands: init | addresses | preflight | deploy | export | status | deposit [recipient] [ETH] | pay <recipient> [ETH]");
} catch (error) {
  // ethers/provider errors may embed RPC credentials or signed payloads; don't echo them.
  const safe = error instanceof Error && !error.code && !error.info && !error.payload && !error.transaction;
  console.error(safe ? error.message : "Chain operation failed. Check RPC connectivity, account funding and local deployment logs. Do not share secrets or signed payloads.");
  process.exitCode = 1;
}
