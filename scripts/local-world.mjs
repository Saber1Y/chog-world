// Local CHOG World for development: an anvil fork of Monad testnet (real ERC-6551 registry and
// Tokenbound AccountV3), CHOG World deployed with dev token stand-ins, and a few awakened Chogs.
//
//   node scripts/local-world.mjs            # anvil on :8545, writes contracts/deployments/local.json
//   OWNER=0xYourWallet node scripts/local-world.mjs   # also mints 2 Chogs + 500 dCHOG to your wallet
//
// Uses anvil's public development accounts only. Never point this at a real network.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { EXTERNAL, chogOperatorAbi, accountV3Abi, chogStateAbi, Goal, POLICY_PRESETS } from "@chog-world/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? "8545";
const RPC = `http://127.0.0.1:${PORT}`;
const FORK = process.env.FORK_URL ?? "https://testnet-rpc.monad.xyz";
const ADMIN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const KEEPER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OWNERS = [
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
];

const chain = { id: 10143, name: "Monad Testnet (local fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (account) => createWalletClient({ chain, transport: http(RPC), account });

async function send(account, address, abi, functionName, args) {
  const hash = await wallet(account).writeContract({ address, abi, functionName, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
}

const anvil = spawn("anvil", ["--fork-url", FORK, "--port", PORT, "--block-time", "1"], { stdio: ["ignore", "ignore", "inherit"] });
process.on("SIGINT", () => { anvil.kill(); process.exit(0); });
for (let i = 0; ; i++) {
  try { await pub.getChainId(); break; } catch { if (i > 150) throw new Error("anvil did not start"); await new Promise((r) => setTimeout(r, 200)); }
}

execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "--unlocked", "--sender", ADMIN], {
  cwd: join(root, "contracts"),
  env: { ...process.env, DEV_TOKENS: "true", KEEPER, DEPLOYMENT_FILE: "local.json" },
  stdio: "ignore",
});
const d = JSON.parse(readFileSync(join(root, "contracts/deployments/local.json"), "utf8"));
const devChog = parseAbi(["function mint(address to) returns (uint256)", "function nextId() view returns (uint256)"]);
const devToken = parseAbi(["function mint(address to, uint256 amount)"]);
const registry = parseAbi(["function createAccount(address,bytes32,uint256,address,uint256) returns (address)"]);
const proxy = parseAbi(["function initialize(address implementation)"]);
const p = POLICY_PRESETS.BALANCED;

// A mix of goals so the local world shows different behaviour.
const GOALS = [Goal.MONEY, Goal.REPUTATION | Goal.STRONGEST, Goal.EXPLORE, 0];
for (const [i, owner] of OWNERS.entries()) {
  const id = await pub.readContract({ address: d.collection, abi: devChog, functionName: "nextId" });
  await send(owner, d.collection, devChog, "mint", [owner]);
  const account = await pub.readContract({ address: d.state, abi: chogStateAbi, functionName: "accountOf", args: [d.collection, id] });
  await send(owner, EXTERNAL.erc6551Registry, registry, "createAccount", [EXTERNAL.tokenboundAccountProxy, `0x${"0".repeat(64)}`, 10143n, d.collection, id]);
  await send(owner, account, proxy, "initialize", [EXTERNAL.tokenboundAccountV3]);
  await send(owner, account, accountV3Abi, "setPermissions", [[d.operator], [true]]);
  await send(owner, d.operator, chogOperatorAbi, "enroll", [d.collection, id, { expiry: 0n, actionMask: 0x0f, maxActionsPerDay: p.maxActionsPerDay, maxPerAction: p.maxPerAction, dailyCap: p.dailyCap }, GOALS[i % GOALS.length]]);
  await send(ADMIN, d.chogToken, devToken, "mint", [account, 400n * 10n ** 18n]);
  console.log(`Chog #${id} awakened for ${owner} (account ${account})`);
}

if (process.env.OWNER) {
  for (let i = 0; i < 2; i++) await send(ADMIN, d.collection, devChog, "mint", [process.env.OWNER]);
  await send(ADMIN, d.chogToken, devToken, "mint", [process.env.OWNER, 500n * 10n ** 18n]);
  await pub.request({ method: "anvil_setBalance", params: [process.env.OWNER, "0x56BC75E2D63100000"] });
  console.log(`Minted 2 Chogs, 500 dCHOG and 100 MON to ${process.env.OWNER}`);
}

console.log(`\nLocal CHOG World ready on ${RPC} (chain 10143 fork). Deployment: contracts/deployments/local.json`);
console.log("Backend: CHAIN_ID=10143 RPC_URL=" + RPC + " DEPLOYMENT_JSON=../../contracts/deployments/local.json");
console.log("Keeper key: anvil account #1. Ctrl+C stops anvil.");
