// Onboards Chogs on a dev/test deployment the same way the web app's Awaken wizard does:
// mint a DevChog, let the backend sponsor its token-bound account, grant the operator,
// enroll with goals and a budget, fund it from the DevCHOG faucet, fill its gas tank, and nudge the agent.
//
//   RPC_URL=https://testnet-rpc.monad.xyz DEPLOYMENT_JSON=contracts/deployments/10143.json \
//   API_URL=http://localhost:9101 OWNER_PRIVATE_KEY=0x... COUNT=1 FUND_MON=0.5 node scripts/onboard.mjs
//
// Only for DevChog/DevCHOG deployments (testnet or local). The key is read from the environment.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { accountV3Abi, chogOperatorAbi, Goal, policyParams } from "@chog-world/shared";

const { RPC_URL, DEPLOYMENT_JSON, API_URL = "http://localhost:9100", OWNER_PRIVATE_KEY, COUNT = "1", FUND = "150", FUND_MON = "0.5" } = process.env;
if (!RPC_URL || !DEPLOYMENT_JSON || !OWNER_PRIVATE_KEY) {
  console.error("Set RPC_URL, DEPLOYMENT_JSON and OWNER_PRIVATE_KEY");
  process.exit(1);
}
const d = JSON.parse(readFileSync(DEPLOYMENT_JSON, "utf8"));
if (d.chainId === 143) {
  console.error("Refusing to run against mainnet: this script mints dev tokens.");
  process.exit(1);
}

const chain = defineChain({ id: d.chainId, name: `chain ${d.chainId}`, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
const account = privateKeyToAccount(OWNER_PRIVATE_KEY);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ chain, transport: http(RPC_URL), account });

const devChog = parseAbi(["function mint(address to) returns (uint256)", "function nextId() view returns (uint256)"]);
const devToken = parseAbi(["function faucet(address to)", "function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

async function send(address, abi, functionName, args) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, account });
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

async function api(path, method = "POST") {
  const res = await fetch(`${API_URL}${path}`, { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${body.message ?? ""}`);
  return body;
}

const fund = parseEther(FUND);
const balance = await pub.readContract({ address: d.chogToken, abi: devToken, functionName: "balanceOf", args: [account.address] });
if (balance < fund * BigInt(COUNT)) {
  console.log("Claiming 500 dCHOG from the faucet…");
  await send(d.chogToken, devToken, "faucet", [account.address]);
}

for (let i = 0; i < Number(COUNT); i++) {
  const id = await pub.readContract({ address: d.collection, abi: devChog, functionName: "nextId" });
  await send(d.collection, devChog, "mint", [account.address]);
  console.log(`Minted Chog #${id} to ${account.address}`);

  const { account: tba } = await api(`/chogs/${id}/account`);
  console.log(`  account ${tba} (sponsored by the keeper)`);
  await send(tba, accountV3Abi, "setPermissions", [[d.operator], [true]]);
  console.log("  granted the operator");
  await send(d.operator, chogOperatorAbi, "enroll", [d.collection, id, policyParams("BALANCED"), Goal.MONEY | Goal.EXPLORE]);
  console.log("  enrolled (Balanced, goals: money + explore)");
  await send(d.chogToken, devToken, "transfer", [tba, fund]);
  console.log(`  funded with ${FUND} dCHOG`);
  // The Chog pays its own gas: a little MON in its account covers the keeper's fee per move.
  const gasHash = await wallet.sendTransaction({ to: tba, value: parseEther(FUND_MON) });
  await pub.waitForTransactionReceipt({ hash: gasHash });
  console.log(`  gas tank filled with ${FUND_MON} MON`);
  await api(`/chogs/${id}/nudge`).catch(() => undefined);
  console.log("  agent nudged");
}
