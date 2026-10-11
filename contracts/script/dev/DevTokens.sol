// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Stand-in Chog collection for local and testnet worlds (the real Chog lives on mainnet only).
///         Anyone can mint a few so testers can try the full flow.
contract DevChog is ERC721 {
    uint256 public constant MAX_SUPPLY = 2662;
    uint256 public nextId = 1;
    string private _uri;

    error SoldOut();

    constructor(string memory uri_) ERC721("Chog (dev)", "dCHOG") {
        _uri = uri_;
    }

    function mint(address to) external returns (uint256 id) {
        id = nextId++;
        if (id > MAX_SUPPLY) revert SoldOut();
        _mint(to, id);
    }

    /// @dev Mirrors the real collection: every token shares one metadata file.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uri;
    }
}

/// @notice Stand-in $CHOG for local and testnet worlds. Faucet-limited mint for testers.
contract DevCHOG is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 500 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address => uint256) public lastFaucet;

    error FaucetCooldown();

    constructor(address owner_) ERC20("CHOG (dev)", "dCHOG") Ownable(owner_) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function faucet(address to) external {
        if (block.timestamp < lastFaucet[to] + FAUCET_COOLDOWN) revert FaucetCooldown();
        lastFaucet[to] = block.timestamp;
        _mint(to, FAUCET_AMOUNT);
    }
}
