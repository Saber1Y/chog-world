// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IAccountV3} from "../../src/interfaces/IERC6551.sol";

contract MockChog is ERC721 {
    constructor() ERC721("Chog", "CHOG") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract MockCHOG is ERC20 {
    constructor() ERC20("CHOG", "CHOG") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal stand-in for Tokenbound AccountV3, deployed behind the real ERC-6551 registry.
///         Mirrors the V3 behaviours CHOG World relies on: token() from the bytecode footer, owner from
///         the NFT, `permissions[rootOwner][caller]`, and execute by owner or permissioned caller.
///         The day-3 fork test checks the same behaviours against the real V3 on Monad.
contract MockAccountV3 is IAccountV3 {
    mapping(address owner => mapping(address caller => bool)) public permissions;

    error NotAuthorized();
    error OnlyCall();
    error LengthMismatch();

    receive() external payable {}

    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function setPermissions(address[] calldata callers, bool[] calldata _permissions) external {
        address o = owner();
        if (msg.sender != o) revert NotAuthorized();
        if (callers.length != _permissions.length) revert LengthMismatch();
        for (uint256 i; i < callers.length; i++) {
            permissions[o][callers[i]] = _permissions[i];
        }
    }

    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (operation != 0) revert OnlyCall();
        address o = owner();
        if (msg.sender != o && !permissions[o][msg.sender]) revert NotAuthorized();
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}
