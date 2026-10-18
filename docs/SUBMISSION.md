# Chogathon 2026 submission: CHOG World

Copy each block into the matching field.

## 01 Basics

### Project name

```text
CHOG World
```

### Banner image

Upload `docs/media/chog-world-intro-poster.png` (logo, tagline and URL from the intro's last frame).

### Description

```text
CHOG World gives every Chog Genesis NFT its own ERC-6551 wallet and an AI agent that decides what it does: quests, arena fights, shopping or rest. Every move is checked onchain against limits the owner signed, and everything the Chog earns lives in its own wallet, so it moves with the NFT when it is sold.

Every Chog has a look. CHOG World gives it a life.

THE PROBLEM
A Chog Genesis NFT is a picture. Once it is in your wallet it does nothing: no history, no growth, no reason to come back. And "AI agents for NFTs" usually means a server holding your keys, which no holder should accept.

HOW IT WORKS
1. Awaken (one short wizard). The Chog gets a Tokenbound V3 account from the canonical ERC-6551 registry, created free. The owner grants permission to ChogOperator, our rules contract, never to a server key. They name it, give it a personality, pick goals (money, reputation, exploring, strength) and a daily budget, and fund it with $CHOG for fees and a little MON for gas.
2. It lives on its own. A few times a day the backend builds the Chog's menu of legal, affordable moves, and an LLM (Gemini, falling back to OpenRouter, then a rule-based picker) chooses one and writes a thought in the Chog's voice, shaped by its personality. Arena odds come from simulating the real battle engine.
3. The chain decides. ChogOperator checks every move against the owner's policy: per-move cap, rolling 24-hour budget, moves per day, allowed actions, expiry, pause, and a gas limit the owner signed. The keeper can only call typed game actions; it can never move funds anywhere else.
4. Fair outcomes. Quests and fights resolve from a block hash two blocks after the move, which nobody can know when the move is made. The battle engine exists in Solidity and TypeScript; every replay on the Arena page is re-run in the browser and checked against the onchain log hash.
5. It becomes someone. XP, levels, titles (First Blood, Giant Slayer, Unbroken, Explorer), scars, gear and rivalries. Its portrait is its own Genesis artwork with an evolving frame, level badge, gear and title ribbon, and every Chog gets a share card for X.
6. It moves with the NFT. Sell the Chog and the agent stops instantly; its $CHOG, gear and trophies go to the buyer inside its own wallet.

WHAT THE OWNER STILL CONTROLS
Goals and budget presets, pause and revoke, a daily check-in streak (XP boost, Devoted trophy), a "While you were away" recap written by the AI from the journal, a gas tank, and a Grudge: name a rival and, while the odds are fair, it is the only Chog yours will challenge.

ARENA
Chogs challenge Chogs owned by other wallets, staking 10, 50 or 200 $CHOG. The winner gets the stake back plus a 70% Treasury bonus; a defender who holds keeps half the stake as a bounty, so Chogs earn while their owners sleep. Pair cooldowns, a defender hourly cap and a different-owner rule stop farming.

$CHOG
$CHOG is the whole economy: quest fees, arena stakes, gear and rewards. 10% of every fee and stake is burned. The Treasury is refilled with 90% of every fee, shop purchases and lost stakes, pays out at most 150 $CHOG a day, and never more than it holds, so it cannot be drained. Quest rewards are tuned so the Treasury mostly recycles player fees.

SUSTAINABLE BY DESIGN
Monad charges the gas limit, so every move costs the keeper real MON. Each Chog repays it: a fixed per-move gas fee in MON from its own wallet, capped by the owner's signed limit and a hard 0.5 MON ceiling, pulled by the keeper rather than pushed so a recipient can never break a move. Moves are spread across the day (6 on the Balanced preset). Running the world does not get more expensive as players join.

WHAT IS LIVE RIGHT NOW
- Mainnet pilot on Chog Genesis and real $CHOG, open to the first 25 Chogs: https://chog-world-mainnet.vercel.app
  ChogOperator 0xaDaA7f21Fb843140E20115D84F51F6f85D5342D1, Treasury 0x1814943bc12E643D1477b47F0B3cD495Fe07fce6 (seeded with 390 $CHOG), ChogState 0x33B273B62d3e364dc1Ec33aC2800AAeAb1067618.
- Free testnet with test Chogs and test $CHOG: https://chog-world-zeta.vercel.app
  7 Chogs have played, 14 arena battles have been fought (13 settled onchain), and the agents write their own thoughts.
- 94 Foundry tests (including invariants), plus a fork test against Monad mainnet with a real Chog Genesis NFT and the real Tokenbound V3 account; 51 backend tests, including an end-to-end loop on a forked chain with gas fees.

HONEST SCOPE
No Chog Genesis holder has played on mainnet yet; the mainnet flow is proven by the fork test and a simulated awakening, and the demo video is recorded on testnet. The contracts are tested but not audited.

WHY THE NFT IS ESSENTIAL
Take the NFT away and nothing works: the Chog's wallet is derived from the NFT, the agent's authority is bound to the NFT's owner, and the character, its wallet and everything in it transfer with the NFT.

WHAT'S NEXT (ROADMAP)
Grow the pilot past 25 Chogs; weekly seasons with Treasury prizes; Genesis traits as gameplay (what a Chog wears gives it bonuses).
```

## 02 Show it

### App link

```text
https://chog-world-mainnet.vercel.app
```

### Demo video

Upload the edited demo to YouTube (Unlisted is fine) or Google Drive (set to "Anyone with the link"), and paste the link.

### Tech stack

```text
Monad, Solidity, Foundry, OpenZeppelin, ERC-6551 (Tokenbound V3), NestJS, PostgreSQL, Drizzle, viem, Next.js, React, Tailwind CSS, wagmi, RainbowKit, Gemini, OpenRouter, sharp, Remotion
```

## 03 For judges

### GitHub repo

```text
https://github.com/Saber1Y/chog-world
```

The repo is private: make it public, or add the judges as collaborators, before submitting.

### Contact email

```text
ayodejiakintobi1@gmail.com
```

### Judge access instructions

```text
No logins needed. Two ways in:

FREE ON TESTNET (recommended)
1. Open https://chog-world-zeta.vercel.app with MetaMask or Rabby on Monad Testnet (chain 10143). Backpack does not support Monad Testnet. You need a little test MON for gas from a Monad testnet faucet.
2. My Chogs, then "Mint a free test Chog". You land on its page.
3. Awaken it: create its wallet (free), "Allow the agent" (one signature), name it, give it a personality, pick goals and the Balanced budget (one signature), then "Get 500 test CHOG", send about 100 to it, and add 0.5 MON to its gas tank.
4. Within about a minute its AI makes its first move: watch "Right now" and the journal ("Thinks" lines are written by the AI). Later moves come a few times a day.
5. To see a Chog with history right away, open Chog #1 or #5. The Arena page replays battles and checks each one against the chain ("verified against chain").

MAINNET PILOT
https://chog-world-mainnet.vercel.app works the same way for Chog Genesis holders with real $CHOG (no faucet; the wizard links to nad.fun). Every Chog's page also shows its own Genesis artwork.

HEALTH
Backends: https://api-mainnet.chogworld.162-62-231-147.sslip.io/health and https://api.chogworld.162-62-231-147.sslip.io/health (chain, indexer lag, keeper balance, active AI models).

Docs in the repo: README.md (architecture, safety, honesty table), docs/TESTING-GUIDE.md (every page, step by step), docs/MAINNET-LAUNCH.md (deployment and budget).
```

## 04 Go-to-market

### Plan

```text
WHO
Chog Genesis holders first: 1,969 NFTs and about 980 owners, a community that already shares Chogs on X and in Discord. The NFT is required on mainnet, so every player is an existing holder, and anyone can try it free on testnet first.

LAUNCH (NOW)
A capped mainnet pilot for the first 25 Chogs, with a small Treasury seed and a 150 $CHOG daily payout cap, so the economy is tested with real players at low risk. Distribution through the Chog Discord and X, where each Chog's share card ("look what my Chog became") is the built-in marketing loop.

WHY PLAYERS STAY
An idle game: it asks for a minute a day. Players come back for the "While you were away" recap, the daily check-in streak, titles, rivalries, grudges and the leaderboard. Over time an evolved Chog (level, titles, gear, history) is worth more than a fresh one, and all of it transfers with the NFT.

ECONOMICS
The world pays for itself: each Chog pays its own gas from its wallet, and the Treasury mostly recycles player fees (90% of every fee) while 10% of every fee and stake is burned, which is direct, ongoing demand for $CHOG. Treasury top-ups are a marketing budget, not a subsidy the game depends on.

NEXT
1. Open the pilot to every Chog Genesis holder once the economy holds steady.
2. Weekly seasons with Treasury prizes and end-of-season trophies.
3. Genesis traits as gameplay, so what a Chog wears matters.
4. More collections: the contracts already allowlist collections, so other Monad communities can bring their NFTs to life without a redeploy.
```
