import { custodyApi } from "./custody.ts";
import { createWallet, encryptWallet, unlockWallet, walletFromPhrase, VAULT_KEY } from "./wallet.ts";
import type { HDNodeWallet, Wallet } from "ethers";
export { createWallet, walletFromPhrase };
export type Signer = Wallet | HDNodeWallet;
export type PaymentAccount = {email:string;linked:boolean;address:string;cryptoWei:string;nonce:number;chainId:number;gasPriceWei:string;gasLimit:string;normalEnabled:boolean;card:{id:string;label:string;lastFour:string;expires:string;fiatCents:string};usdPerEth:string};
export type Receipt = {transactionHash:string;from:string;to:string;value:string;nonce:number;blockNumber:number;blockHash:string;transactionIndex:number;status:string;gasUsed:string;feeWei:string;modeledConfirmationMs:number};
export type Run = {id:string;scope:string;chainId:number;blocks:{number:number;hash:string;parentHash:string;gasUsed:string;transactionHashes:string[]}[];receipts:Receipt[];batch:{id:string;format:string;frames:string[];rawBytes:number;compressedBytes:number;frameBytes:number;l1Status:string};metrics:{payments:number;blocks:number;executionMs:number;batchMs:number;totalMs:number;processingTps:number;executionTps:number;batchingTps:number;modeledInclusionTps:number;averageModeledConfirmationMs:number;totalFeeWei:string;assumedEthereumFeeWei:string;rawBytes:number;compressedBytes:number;frameBytes:number;comparison:string}};
export type History = {runs:Run[];receipts:Receipt[];purchases:{id:string;wei:string;created_at:string}[]};
export type Pending = {action:"buy"|"send";body:{requestKey:string;cardId?:string;fiatAmount?:string;rawTransactions?:string[];blockCapacity?:number}};
export const vaultKey = (email:string) => `wallet.email.v1:${email.trim().toLowerCase()}`;
export async function saveSigner(email:string, signer:Signer,password:string, expectedAddress?:string) {
  if(expectedAddress && signer.address.toLowerCase()!==expectedAddress.toLowerCase())throw new Error("This phrase belongs to a different wallet. Restore the phrase linked to this email.");
  // An existing vault must be unlocked, never silently replaced during signup/setup.
  if(localStorage.getItem(vaultKey(email))){
    const saved=await loadSigner(email,password);
    if(saved.address.toLowerCase()!==signer.address.toLowerCase())throw new Error("This email already has another wallet on this device. Unlock it instead of replacing it.");
    return;
  }
  const encrypted=await encryptWallet(signer as HDNodeWallet,password);
  localStorage.setItem(vaultKey(email),encrypted);
}
export async function loadSigner(email:string,password:string,address?:string) {
  const vault=localStorage.getItem(vaultKey(email));
  if(!vault)throw new Error("Restore your recovery phrase on this device.");
  const signer=await unlockWallet(vault,password);
  if(address && signer.address.toLowerCase()!==address.toLowerCase())throw new Error("Saved wallet does not match this email account. Restore the linked wallet in a fresh browser profile.");
  return signer;
}
export async function bindSigner(signer:Signer) {
  const challenge=await custodyApi<{message:string}>("wallet/challenge",{});
  return custodyApi<PaymentAccount>("wallet/bind",{address:signer.address,signature:await signer.signMessage(challenge.message)});
}
export async function importLegacySigner(email:string,password:string,address?:string) {
  const vault=localStorage.getItem(VAULT_KEY);
  if(!vault)throw new Error("No earlier wallet is saved in this browser.");
  const signer=await unlockWallet(vault,password);
  await saveSigner(email,signer,password,address);
  return signer;
}
export async function signPayments(signer:Signer,account:PaymentAccount,to:string,value:bigint,count:number) {
  if(account.chainId!==420690001)throw new Error("Unexpected offline test chain ID. Signing stopped.");
  const transactions=[];
  for(let i=0;i<count;i++)transactions.push(await signer.signTransaction({type:2,chainId:account.chainId,nonce:account.nonce+i,to,value,gasLimit:BigInt(account.gasLimit),maxFeePerGas:BigInt(account.gasPriceWei),maxPriorityFeePerGas:BigInt(0),data:"0x"}));
  return transactions;
}
