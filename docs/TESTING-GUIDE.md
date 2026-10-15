# CHOG World testing guide

This guide walks through every page of CHOG World on Monad testnet and what to check on each one.

## Before you start

- Live site: https://chog-world-zeta.vercel.app
- Local dev server: http://localhost:3101, which uses the same hosted testnet backend, so both show the same world.
- Wallet: MetaMask or Rabby on Monad testnet (chain 10143) with a little test MON for gas.
- Pace: a Chog makes at most a few moves a day, spread evenly (6 a day on Balanced, so about every 4 hours), and its first move comes soon after it is funded.
- Gas: each move costs the Chog a small fee in MON from its own wallet (0.09 MON for a quest, 0.13 for a battle), so keep a little test MON for its gas tank.
- Quests and battles settle a few seconds after they start, once the block they use for randomness exists.

To run the local dev server yourself:

```bash
cd chog-world/apps/web
NEXT_PUBLIC_API_URL=https://api.chogworld.162-62-231-147.sslip.io NEXT_PUBLIC_CHAIN_ID=10143 pnpm exec next dev -p 3101
```

The backend only accepts browser requests from the Vercel site and from `localhost:3100` to `3102`.

## 1. World (`/`)

What it shows:

- The hero fans out the top Chogs as cards, with the leader in the raised centre card.
- Empty slots read "Your Chog here" and link to *My Chogs*.
- "How it works" explains the idea in three steps.
- The live world feed updates on its own as Chogs act.

What to check:

- The cards show evolved pictures, not blank squares.
- Clicking a card opens that Chog.
- New feed lines appear without refreshing.

## 2. My Chogs (`/chogs`)

What it shows:

- Every Chog your wallet owns, with its *DNA stats*: the hidden stats it was born with.
- All Chogs share one picture, so these stats are what makes each one different before it does anything.
- A "Chog #" box to open any Chog by number.

What to check:

- Connect your wallet.
- Press *Mint a free test Chog* (testnet only). After one confirmation you land on the new Chog's page.
- Open Chog #1 or #2 with the number box.

Note: a freshly minted Chog can take up to about 5 minutes to appear in this list, because ownership is refreshed on a timer.

## 3. A Chog you own, first visit: the Awaken wizard (`/chog/<id>`)

Four steps, each saved onchain, so you can stop and come back:

1. *Give it a wallet.* Free: the server pays to create the Chog's own ERC-6551 account. This gives the server no control over it.
2. *Let it act.* One signature lets the game's rules contract (`ChogOperator`), not the server, act for the Chog.
3. *Goals and budget.* Pick goals and a preset (Cautious, Balanced or Degen), then sign. The limits are enforced onchain, including the most MON it may pay in gas per move (0.2).
4. *Fund it.* Press *Get 500 test CHOG*, send 100 or so to the Chog, then add 0.5 or 1 MON to its gas tank.

What to check:

- Each step turns green when its transaction confirms.
- Cancelling in the wallet shows a clear message and lets you retry.
- Leaving and coming back resumes at the right step.

## 4. A living Chog (`/chog/<id>`)

What it shows:

- *Portrait*: level badge, element, frame and title banner, re-rendered as the Chog changes.
- *Level bar and record*: XP, reputation, wins, losses and scars.
- *Stats*: bright bars are what it was born with, faint bars are what it has earned since.
- *Right now*: when its next move comes, its last move and its goals.
- *While you were away* (owner only): a short summary of what happened since your last visit, in the Chog's voice.
- *Its wallet*: CHOG balance, spent today against the daily cap, moves left today, its gas tank in MON and total earned.
- *Journal*: live lines for what it thought, where it went, what it won, level-ups and titles.
- *Battles*: its arena fights, with links to the replays.
- *Trophies*: titles it has earned, minted into its own wallet.

The owner panel, shown only to the owner:

- *Check in* once a day for +10 XP and a 24-hour +50% XP boost.
- Change goals or the budget preset.
- *Wallet* tab: top up or withdraw CHOG, and fill the gas tank with MON.
- Pause and resume.
- Set a nickname and personality, signed with your wallet.
- Stop its agent (revoke).

What to check:

- After funding, *Right now* switches to its first move and the journal fills in.
- Pause it, then confirm no new moves happen.
- Lower the budget and confirm *moves left* and the cap change.
- Set a nickname and confirm the name and the picture banner update.
- Open someone else's Chog and confirm the owner panel is not shown.

## 5. Arena (`/arena`)

What it shows:

- The selected battle replayed round by round, re-run in your browser and checked against the hash stored onchain, which is why it says *verified against chain*.
- Replay controls at 1x, 2x and 4x, plus a link to the settlement transaction.
- *Recent battles*: click one to replay it. A voided battle settled too late and was refunded.
- *Rivalries*: two Chogs become rivals after three fights.

What to check:

- The replay plays to the same result the chain recorded.
- Times in *Recent battles* match when the fights happened.

Your Chog only attacks Chogs owned by a different wallet.
If the same wallet owns your new Chog and #1, your Chog can fight #2 but not #1.

## 6. Leaderboard (`/leaderboard`)

What it shows:

- A podium for the top three and a ranked list below it.
- Tabs for Reputation, Level, Wins and Earnings.
- Your own Chogs are highlighted when your wallet is connected.

What to check:

- Switching tabs re-ranks the board.
- A Chog that just levelled up or won moves up within about 20 seconds.

## 7. Safety checks worth trying

- Let the gas tank run dry: the Chog rests with "out of MON for gas" and sends nothing until you top it up.
- Transfer a test Chog to another wallet: its agent stops acting, and its coins and gear stay in the Chog's wallet for the new owner.
- Set the Cautious preset and watch the Chog stop for the day once it reaches the cap.
- Stop its agent from the owner panel and confirm the wizard offers to wake it again.

## If something looks wrong

- Health of the backend: https://api.chogworld.162-62-231-147.sslip.io/health shows the chain head, how far the indexer is behind and the keeper's balance.
- If the keeper balance is low, every Chog stops starting new moves until it is topped up.
- Note the page, the Chog number and the time, and include a screenshot.
