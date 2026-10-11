// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551.sol";
import {ChogState} from "../src/ChogState.sol";
import {Treasury} from "../src/Treasury.sol";
import {ChogItems} from "../src/ChogItems.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {Arena} from "../src/Arena.sol";
import {ChogOperator} from "../src/ChogOperator.sol";
import {Stats} from "../src/libraries/ChogDNA.sol";

/// @notice Single source of truth for wiring and seeding CHOG World. Used by the deploy scripts and by
///         the test fixture, so tests exercise exactly what gets deployed.
abstract contract ChogWorldDeployer {
    struct Config {
        address admin;
        address keeper;
        IERC6551Registry registry;
        address accountImplementation;
        address collection;
        IERC20 chog;
        uint256 dailyEmissionCap;
        uint16 burnBps;
        string itemsUri;
    }

    struct World {
        ChogState state;
        Treasury treasury;
        ChogItems items;
        QuestBoard quests;
        Arena arena;
        ChogOperator operator;
    }

    // Quest ids, shared with the backend through packages/shared.
    uint32 internal constant Q_SLIME_PIT = 0;
    uint32 internal constant Q_BANDIT_CAMP = 1;
    uint32 internal constant Q_ELDER_WYRM = 2;
    uint32 internal constant Q_EXPLORE_BASE = 3; // 3..6, one per zone
    uint32 internal constant Q_TRAIN = 7;

    /// @dev Must be called by `cfg.admin` (as the broadcaster in scripts, or pranked in tests).
    function _deployWorld(Config memory cfg) internal returns (World memory w) {
        w.state = new ChogState(cfg.admin, cfg.registry, cfg.accountImplementation);
        w.treasury = new Treasury(cfg.admin, cfg.chog, cfg.dailyEmissionCap, cfg.burnBps);
        w.items = new ChogItems(cfg.admin, w.state, w.treasury, cfg.itemsUri);
        w.quests = new QuestBoard(cfg.admin, w.state, w.treasury, w.items);
        w.arena = new Arena(cfg.admin, w.state, w.treasury);
        w.operator = new ChogOperator(w.state, w.quests, w.arena, w.items, cfg.admin, cfg.keeper);

        bytes32 stateGame = w.state.GAME_ROLE();
        w.state.grantRole(stateGame, address(w.quests));
        w.state.grantRole(stateGame, address(w.arena));
        w.state.grantRole(stateGame, address(w.items));
        w.state.grantRole(stateGame, address(w.operator));
        w.treasury.grantRole(w.treasury.GAME_ROLE(), address(w.quests));
        w.treasury.grantRole(w.treasury.GAME_ROLE(), address(w.arena));
        w.items.grantRole(w.items.GAME_ROLE(), address(w.quests));

        w.state.setItems(w.items);
        w.state.setCollection(cfg.collection, true);

        _seedItems(w.items);
        _seedQuests(w.quests);
    }

    function _seedItems(ChogItems items) internal {
        items.setItem(1, 15 ether, ChogItems.Kind.POTION, 0, true);
        items.setItem(2, 25 ether, ChogItems.Kind.ELIXIR, 0, true);
        items.setItem(11, 40 ether, ChogItems.Kind.WEAPON, 1, true);
        items.setItem(12, 120 ether, ChogItems.Kind.WEAPON, 2, true);
        items.setItem(13, 300 ether, ChogItems.Kind.WEAPON, 3, true);
        items.setItem(21, 40 ether, ChogItems.Kind.ARMOR, 1, true);
        items.setItem(22, 120 ether, ChogItems.Kind.ARMOR, 2, true);
        items.setItem(23, 300 ether, ChogItems.Kind.ARMOR, 3, true);
    }

    function _seedQuests(QuestBoard quests) internal {
        quests.setQuest(Q_SLIME_PIT, _hunt(5 ether, 6 ether, 12 ether, 20, 1, 0, 3_000, 1, Stats(40, 8, 2, 4, 0, 1)));
        quests.setQuest(
            Q_BANDIT_CAMP, _hunt(15 ether, 18 ether, 35 ether, 45, 3, 1, 1_500, 11, Stats(130, 17, 9, 11, 8, 2))
        );
        quests.setQuest(
            Q_ELDER_WYRM, _hunt(40 ether, 60 ether, 120 ether, 120, 8, 3, 2_000, 13, Stats(260, 30, 16, 14, 12, 0))
        );
        for (uint8 zone; zone < 4; zone++) {
            QuestBoard.Quest memory e = _base(2 ether, 1 ether, 4 ether, 15, 1, zone);
            e.kind = QuestBoard.Kind.EXPLORE;
            e.cooldown = 2 hours;
            e.lootBps = 1_000;
            e.lootId = 2;
            quests.setQuest(Q_EXPLORE_BASE + zone, e);
        }
        QuestBoard.Quest memory t = _base(3 ether, 0, 0, 40, 1, 0);
        t.kind = QuestBoard.Kind.TRAIN;
        t.cooldown = 30 minutes;
        quests.setQuest(Q_TRAIN, t);
    }

    function _hunt(
        uint128 fee,
        uint128 rewardMin,
        uint128 rewardMax,
        uint32 xp,
        uint16 minLevel,
        uint8 zone,
        uint16 lootBps,
        uint16 lootId,
        Stats memory monster
    ) private pure returns (QuestBoard.Quest memory q) {
        q = _base(fee, rewardMin, rewardMax, xp, minLevel, zone);
        q.kind = QuestBoard.Kind.HUNT;
        q.cooldown = 10 minutes;
        q.lootBps = lootBps;
        q.lootId = lootId;
        q.monster = monster;
    }

    function _base(uint128 fee, uint128 rewardMin, uint128 rewardMax, uint32 xp, uint16 minLevel, uint8 zone)
        private
        pure
        returns (QuestBoard.Quest memory q)
    {
        q.fee = fee;
        q.rewardMin = rewardMin;
        q.rewardMax = rewardMax;
        q.xp = xp;
        q.minLevel = minLevel;
        q.zone = zone;
        q.active = true;
    }
}
