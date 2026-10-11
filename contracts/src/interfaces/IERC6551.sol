// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Canonical ERC-6551 registry (0x000000006551c19487814612e58FE06813775758).
interface IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address account);
}

interface IERC6551Account {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
}

/// @notice Subset of Tokenbound AccountV3 used by CHOG World.
///         `permissions[rootOwner][caller]` grants `caller` executor rights over the account.
interface IAccountV3 is IERC6551Account {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);

    function setPermissions(address[] calldata callers, bool[] calldata permissions) external;

    function permissions(address owner, address caller) external view returns (bool);
}
