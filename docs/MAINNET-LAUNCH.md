# Mainnet pilot launch checklist

This is the step-by-step for launching CHOG World on Monad mainnet (chain 143) as a capped pilot with the real Chog NFT and real $CHOG.
The testnet world keeps running unchanged.

## Costs

Prices on 2026-10-15: MON about $0.023, $CHOG about $0.0016, gas about 102 gwei.

| Item | Amount | Dollars |
| --- | --- | --- |
| Contract deploy (simulated: 21.3M gas) | about 2.2 MON spent, 5 MON in the wallet for headroom | about $0.05 spent |
| Keeper float | 3 MON | about $0.07, repaid by gas fees |
| Treasury seed | 20,000 to 50,000 CHOG | about $32 to $80 |
| Hosting | same server | $0 extra |

## 0. Decisions

- Admin wallet: a fresh wallet (ideally a hardware wallet) that has never been pasted anywhere. It deploys and becomes the guardian.
- Treasury seed and daily payout cap (`DAILY_EMISSION_CAP`, default 2,000 CHOG a day).
- Pilot size (`PILOT_MAX_CHOGS`, suggested 25).
- Web: a separate Vercel project for mainnet, or switch the main site to mainnet.

## 1. Keeper wallet (on the server, so the key never leaves it)

```bash
ssh ubuntu@162.62.231.147
cast wallet new
```

Put the private key in `~/chog-world/mainnet.env` as `KEEPER_PRIVATE_KEY=` (`chmod 600`), and note the address.
Send it 3 MON.

## 2. Deploy the contracts (on your machine, with the admin wallet)

Check first that the mainnet fork test passes:

```bash
cd chog-world
MONAD_RPC_URL=https://rpc.monad.xyz pnpm contracts:fork
```

Then deploy (`--ledger` for a hardware wallet, or `--interactive` to type the key without saving it):

```bash
cd chog-world/contracts
KEEPER=<keeper address> DAILY_EMISSION_CAP=2000000000000000000000 GAS_FEE_QUEST=90000000000000000 GAS_FEE_ATTACK=130000000000000000 GAS_FEE_BUY=50000000000000000 GAS_FEE_USE=40000000000000000 forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow --ledger
```

The script refuses dev tokens on mainnet, checks $CHOG's decimals, uses the real Chog collection, and writes `contracts/deployments/143.json`.

```bash
cd chog-world
pnpm --filter @chog-world/shared gen:deployments
git add contracts/deployments/143.json packages/shared/src/deployments.generated.ts
git commit -m "deploy(mainnet): CHOG World pilot"
```

## 3. Fund the Treasury

Buy $CHOG on nad.fun (`https://nad.fun/tokens/0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`) and send the seed amount to the `treasury` address in `143.json`.

## 4. Mainnet backend (a second process next to testnet)

On the server:
- Create a `chogworld_mainnet` Postgres database and role, as for testnet.
- Complete `~/chog-world/mainnet.env` with `CHAIN_ID=143`, `RPC_URL=https://rpc.monad.xyz`, `HOST=127.0.0.1`, `PORT=9200`, `DATABASE_URL`, `PILOT_MAX_CHOGS=25`, `MOVES_PER_DAY=6`, `SITE_URL`, `PUBLIC_URL`, `CORS_ORIGIN`, the same model keys as testnet, and `ART_CACHE_PATH`.
- Start it: `pm2 start dist/main.js --name chogworld-mainnet --node-args="--env-file=/home/ubuntu/chog-world/mainnet.env" --max-memory-restart 400M --time` from `~/chog-world/app`, then `pm2 save`.
- Add a Caddy site `api-mainnet.chogworld.162-62-231-147.sslip.io` proxying `127.0.0.1:9200`, validate and reload.

## 5. Mainnet web

Deploy `apps/web` with `NEXT_PUBLIC_CHAIN_ID=143`, `NEXT_PUBLIC_API_URL` pointing at the mainnet API, and the WalletConnect id.
On mainnet the wizard hides the faucet and links to nad.fun instead, and shows when the pilot is full.

## 6. Verify before announcing

- `/health` on the mainnet API shows `chainId: 143`, a small lag, and the keeper balance.
- Awaken one real Chog end to end: wallet, permission, name and goals, CHOG and MON, first move, settlement, journal.
- The keeper's `gasFeesOwed` grows after moves, and the gas fee collector withdraws it.
- Pause one Chog and confirm it stops; transfer one and confirm its agent stands down.

## Risks to state plainly

- The contracts are tested (94 tests plus the mainnet fork test) but not audited.
- Players can lose the $CHOG they give their Chog in quests and fights, within the limits they set.
- The Treasury's daily payout cap bounds how fast rewards can leave it.
