import { readFileSync } from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet, requireDeployment, type Deployment } from "@chog-world/shared";
import type { Env } from "../config/env.js";
import { RpcLimiter } from "./rpc-limiter.js";

export function chainFor(chainId: number, rpcUrl?: string): Chain {
  const base = chainId === monad.id ? monad : chainId === monadTestnet.id ? monadTestnet : undefined;
  if (!base) throw new Error(`Unsupported CHAIN_ID ${chainId}; expected ${monad.id} or ${monadTestnet.id}`);
  return rpcUrl ? { ...base, rpcUrls: { default: { http: [rpcUrl] } } } : base;
}

export function loadDeployment(env: Pick<Env, "CHAIN_ID" | "DEPLOYMENT_JSON">): Deployment {
  if (env.DEPLOYMENT_JSON) {
    const d = JSON.parse(readFileSync(env.DEPLOYMENT_JSON, "utf8")) as Deployment;
    if (d.chainId !== env.CHAIN_ID) {
      throw new Error(`DEPLOYMENT_JSON is for chain ${d.chainId} but CHAIN_ID is ${env.CHAIN_ID}`);
    }
    return d;
  }
  return requireDeployment(env.CHAIN_ID);
}

export interface SendResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

/** A decoded revert: the custom error name when the ABI knows it, otherwise the short message. */
export function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends transactions for one key strictly one at a time (simulate, send, wait), so nonces never race.
 * Monad charges for the gas limit, not gas used, so the limit is the estimate plus a small margin
 * (`marginBps`), never a blanket ceiling.
 */
export class TxSender {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly publicClient: PublicClient,
    readonly wallet: WalletClient,
    readonly account: Account,
    private readonly marginBps = 1_000,
  ) {}

  send(req: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<SendResult> {
    const run = async (): Promise<SendResult> => {
      const { request } = await this.publicClient.simulateContract({ ...req, account: this.account } as never);
      const estimate = await this.publicClient.estimateContractGas({ ...req, account: this.account } as never);
      const hash = await this.wallet.writeContract({
        ...(request as object),
        gas: (estimate * BigInt(10_000 + this.marginBps)) / 10_000n,
        account: this.account,
        chain: this.wallet.chain,
      } as never);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      return { hash, receipt };
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class ChainService {
  readonly chain: Chain;
  readonly deployment: Deployment;
  readonly publicClient: PublicClient;
  readonly keeper: TxSender;
  readonly resolver: TxSender;
  readonly limiter: RpcLimiter;

  constructor(env: Env) {
    this.chain = chainFor(env.CHAIN_ID, env.RPC_URL);
    this.deployment = loadDeployment(env);
    this.limiter = new RpcLimiter({
      maxConcurrent: env.RPC_MAX_CONCURRENCY,
      maxPerSecond: env.RPC_MAX_RPS,
      maxBackground: Math.max(1, Math.floor(env.RPC_MAX_CONCURRENCY / 2)),
    });

    const base = http(this.chain.rpcUrls.default.http[0], { retryCount: 3, timeout: 20_000 });
    const limiter = this.limiter;
    const chain = this.chain;
    const transport = custom({
      request: (args: { method: string; params?: unknown }) =>
        limiter.run(false, () => base({ chain }).request(args as never)),
    });

    // Monad makes a block every ~400ms; viem's default 4s block-number cache would be ~10 blocks stale.
    this.publicClient = createPublicClient({
      chain,
      transport,
      batch: { multicall: true },
      cacheTime: 0,
      pollingInterval: 500,
    }) as PublicClient;

    const keeperAccount = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
    if (env.KEEPER_ADDRESS_EXPECTED && env.KEEPER_ADDRESS_EXPECTED.toLowerCase() !== keeperAccount.address.toLowerCase()) {
      throw new Error("KEEPER_PRIVATE_KEY does not match KEEPER_ADDRESS_EXPECTED");
    }
    const resolverAccount = env.RESOLVER_PRIVATE_KEY ? privateKeyToAccount(env.RESOLVER_PRIVATE_KEY) : keeperAccount;

    this.keeper = new TxSender(this.publicClient, createWalletClient({ chain, transport, account: keeperAccount }), keeperAccount, env.GAS_MARGIN_BPS);
    this.resolver =
      resolverAccount === keeperAccount
        ? this.keeper
        : new TxSender(this.publicClient, createWalletClient({ chain, transport, account: resolverAccount }), resolverAccount, env.GAS_MARGIN_BPS);
  }

  keeperBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.keeper.account.address });
  }

  /** Confirms the RPC and the keeper are wired to the deployment this process expects. */
  async verify(operatorKeeper: () => Promise<Address>): Promise<void> {
    const id = await this.publicClient.getChainId();
    if (id !== this.chain.id) throw new Error(`RPC reports chain ${id}, expected ${this.chain.id}`);
    const code = await this.publicClient.getCode({ address: this.deployment.operator });
    if (!code || code === "0x") throw new Error(`No ChogOperator at ${this.deployment.operator} on chain ${id}`);
    const keeper = await operatorKeeper();
    if (keeper.toLowerCase() !== this.keeper.account.address.toLowerCase()) {
      throw new Error(`ChogOperator keeper is ${keeper}, but this backend signs as ${this.keeper.account.address}`);
    }
  }
}

export { parseEventLogs };
