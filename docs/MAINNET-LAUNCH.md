# Mainnet pilot launch plan

CHOG World on Monad mainnet (chain 143) as a capped pilot, with the real Chog NFT and real $CHOG.
The testnet world at https://chog-world-zeta.vercel.app keeps running so anyone can play free.

## Budget: 41 MON

Prices on 2026-10-16: MON about $0.023, 1 CHOG about 0.07 MON ($0.0016), gas about 102 gwei.

| Use | MON | Notes |
| --- | --- | --- |
| Deploy the contracts | about 2.2 spent | The admin wallet must hold 5 MON during the deploy (Forge checks for headroom); the rest stays in it. |
| Keeper float | 3 | Repaid by the per-move gas fee every Chog pays. |
| Spare | about 3 | Gas top-ups and the admin's own transactions. |
| Treasury seed | about 33, swapped for about 450 CHOG | Bought on nad.fun. |

Settings for the pilot:

| Setting | Value |
| --- | --- |
| Pilot size (`PILOT_MAX_CHOGS`) | 25 Chogs |
| Moves per Chog per day | 6 |
| Treasury daily payout cap (`DAILY_EMISSION_CAP`) | 150 CHOG |
| Gas fee per move | 0.09 MON quest, 0.13 battle, 0.05 buy, 0.04 use |

Quest rewards are tuned so the Treasury mostly recycles player fees (90% of every fee goes into it, 10% is burned).
An empty Treasury never breaks the game: it pays only what it holds.

## What is already done

- Mainnet keeper wallet, created on the server (the key never left it): `0xCfa08a3cC2c71F463C80BbB524C7E39Dc8F9b7Ce`.
- Mainnet database `chogworld_mainnet` and `~/chog-world/mainnet.env` on the server (port 9200, pilot 25, the same model keys as testnet).
- Vercel project `chog-world-mainnet` (root `apps/web`).
- The mainnet fork test and a dry-run deploy against Monad mainnet pass.

## Step 1 (you): fund the keeper

Send 3 MON to `0xCfa08a3cC2c71F463C80BbB524C7E39Dc8F9b7Ce`.

## Step 2 (you): create the admin wallet and deploy

The admin wallet deploys the contracts and becomes the guardian (emergency pause, gas fees, Treasury settings).
Use a brand-new wallet that has never been pasted anywhere, and send it 8 MON.

Store its key in an encrypted Foundry keystore on your Mac (you type the key and a password; nothing is printed or saved in plain text):

```bash
cast wallet import chogworld-admin --interactive
```

Check the fork test, then deploy:

```bash
cd ~/codes/chog-world
MONAD_RPC_URL=https://rpc.monad.xyz pnpm contracts:fork
```

```bash
cd ~/codes/chog-world/contracts
KEEPER=0xCfa08a3cC2c71F463C80BbB524C7E39Dc8F9b7Ce DAILY_EMISSION_CAP=150000000000000000000 GAS_FEE_QUEST=90000000000000000 GAS_FEE_ATTACK=130000000000000000 GAS_FEE_BUY=50000000000000000 GAS_FEE_USE=40000000000000000 forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow --account chogworld-admin
```

The script refuses dev tokens on mainnet, checks $CHOG's decimals, uses Chog Genesis (`0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`), the verified Chog NFT and $CHOG (`0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`), and writes `contracts/deployments/143.json`.
Tell Claude when it is done; the remaining wiring is automated.

## Step 3 (Claude): wire the backend and the mainnet site

- Generate the shared deployment registry from `143.json`, commit and push.
- Start the mainnet backend under pm2 as `chogworld-mainnet` with `mainnet.env`, and add the Caddy site `api-mainnet.chogworld.162-62-231-147.sslip.io`.
- Deploy `chog-world-mainnet` with `NEXT_PUBLIC_CHAIN_ID=143`, the mainnet API, and `NEXT_PUBLIC_OTHER_NETWORK_URL` pointing at the testnet site (and the testnet site pointing back).

## Step 4 (you): seed the Treasury

Buy about 450 CHOG at https://nad.fun/tokens/0x350035555E10d9AfAF1566AaebfCeD5BA6C27777 and send it to the `treasury` address in `143.json`.

## Step 5 (together): verify with a real Chog, then open the pilot

- `/health` on the mainnet API shows `chainId: 143`, a small lag and the keeper balance.
- Awaken a real Chog end to end: wallet, permission, name and goals, about 100 CHOG and 1 MON, first move, settlement, journal.
- The keeper's `gasFeesOwed` grows after moves and the collector withdraws it.
- Pause one Chog and confirm it stops.

## Risks to state plainly

- The contracts are tested (94 tests plus the mainnet fork test) but not audited.
- Players can lose the $CHOG they give their Chog in quests and fights, within the limits they set.
- Only owners of the 1,969 Chog Genesis NFTs can play on mainnet.
- The Treasury's daily payout cap bounds how fast rewards can leave it.
