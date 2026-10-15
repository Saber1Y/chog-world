import { formatEther, type PublicClient } from "viem";
import { chogOperatorAbi, type Deployment } from "@chog-world/shared";
import type { TxSender } from "../chain/chain.js";

/**
 * Pulls the gas fees Chogs paid for their moves back to the keeper. Fees accrue in ChogOperator
 * (pull, never push), so this withdraws in batches once enough has built up to be worth a transaction.
 */
export class GasFeeCollector {
  constructor(
    private readonly client: PublicClient,
    private readonly keeper: TxSender,
    private readonly d: Deployment,
    private readonly minWithdraw: bigint,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  owed(): Promise<bigint> {
    return this.client.readContract({
      address: this.d.operator,
      abi: chogOperatorAbi,
      functionName: "gasFeesOwed",
      args: [this.keeper.account.address],
    });
  }

  /**
   * Withdraws when at least `minWithdraw` is owed, or anything owed when `force` (the keeper is
   * running low). Returns the amount withdrawn (0 when it waited).
   */
  async run(force = false): Promise<bigint> {
    const owed = await this.owed();
    if (owed === 0n || (!force && owed < this.minWithdraw)) return 0n;
    await this.keeper.send({ address: this.d.operator, abi: chogOperatorAbi, functionName: "withdrawGasFees", args: [] });
    this.log(`withdrew ${formatEther(owed)} MON of gas fees`);
    return owed;
  }
}
