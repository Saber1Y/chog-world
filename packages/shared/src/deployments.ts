import type { Address } from "viem";
import { DEPLOYMENTS } from "./deployments.generated.js";

export interface Deployment {
  chainId: number;
  /** Block the world was deployed at; indexers start here. */
  startBlock: number;
  collection: Address;
  chogToken: Address;
  state: Address;
  treasury: Address;
  items: Address;
  quests: Address;
  arena: Address;
  operator: Address;
}

/** A chain without an entry has no CHOG World deployment; callers must handle that. */
export function deploymentFor(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}

export function requireDeployment(chainId: number): Deployment {
  const d = DEPLOYMENTS[chainId];
  if (!d) throw new Error(`CHOG World is not deployed on chain ${chainId}`);
  return d;
}
