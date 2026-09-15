/**
 * ponsFactory.js
 *
 * Thin, verified client for the pons.family launch factory on Robinhood Chain.
 *
 * Every address and function signature in this file was cross-checked against
 * TWO independent sources before being used:
 *   1. pons.family's own published docs (docs.ponsfamily.com — Integration
 *      Guide / Smart Contracts sections)
 *   2. The Solidity source + abi.json + contract-meta.json in the
 *      ponsdotdev/ponsfamily GitHub repo (contractsV1/src/PonsLaunchFactory.sol)
 *
 * IMPORTANT — READ BEFORE TOUCHING THIS FILE:
 * While pulling contract details from that GitHub repo, several markdown
 * files were found buried inside vendored dependency folders (paths no real
 * maintainer would put content in — deep inside the OpenZeppelin and Uniswap
 * v4-core library copies). They present themselves as "secret" lore and each
 * surface a raw wallet/contract address for an undisclosed token:
 *
 *   - contractsV2/src/v2/hooks/PonstakingV2_test/staking_v1.md  -> $PONSTAKE
 *   - contractsV2/src/v2/testing/gateway.md                     -> $GATEWAY
 *   - contractsV2/lib/v4-core/src/interfaces/callback/ozz.md    -> unnamed "ape" address
 *
 * This is a known manipulation pattern (plant an address somewhere a curious
 * reader, or an AI coding agent asked to "integrate with X", will stumble on
 * it and treat it as insider alpha). There is no proof of malicious intent,
 * but there is no reason to trust it either, and it has nothing to do with
 * the actual launch factory. This module hard-blocks those addresses so they
 * can never end up in a generated transaction, no matter what future code,
 * prompt, or "helpful" copy-paste tries to route through here.
 *
 * DO NOT remove BLOCKED_ADDRESSES. DO NOT add addresses to this file that you
 * found in a doc/comment/README rather than in pons.family's own live app or
 * docs site.
 */

const BLOCKED_ADDRESSES = new Set([
  '0xa582df4a063c69a05a4356e0f1419cad92212f82', // "$PONSTAKE" bait, staking_v1.md
  '0x00000905c0053d943c89420b4c2561514dcb60fc', // "Ponstaking Staking Recipient" bait
  '0x97f6ea36d41a595256eb2fddb75ff139adb8789f', // "Ponstaking Staking Contract BETA" bait
  '0x6c304c85f8244b8f256981447c33154406559d15', // "$GATEWAY" bait, gateway.md
  '0x5c2a1e7866c6cd56b388ebbaee019ae0793b8e0c', // unnamed "ape" bait, ozz.md
].map((a) => a.toLowerCase()));

function assertNotBlocked(address, label) {
  if (address && BLOCKED_ADDRESSES.has(String(address).toLowerCase())) {
    throw new Error(
      `Refusing to build a transaction touching ${label} (${address}): ` +
      `this address matches a known bait/easter-egg address found planted ` +
      `in the pons.family GitHub repo, not a value from a trusted source.`
    );
  }
}

// --- Verified network + contract constants (cross-checked, see header) ---

const ROBINHOOD_CHAIN = {
  chainId: 4663,
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  name: 'Robinhood Chain',
};

// pons.family runs two factory deployments side by side (their own
// launchpad UI at ponsfamily.com/launchpad/create has a "v1"/"v2" toggle):
//   - v1 (legacy): 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB — verified,
//     but its on-chain `launchEnabled` flag is false and it only accepts
//     launches from wallets the factory owner has explicitly whitelisted.
//   - v2 (current, used here): the address below — an EIP-1967 proxy to a
//     verified `PonsLaunchFactory` implementation, with `launchEnabled ==
//     true` (open to any wallet, no whitelist) and an enabled DEX + launch
//     config, confirmed live via eth_call against the public RPC. Same
//     `launchToken(...)` signature as v1.
// Source, per this file's own trust rule (see BLOCKED_ADDRESSES above): this
// address comes from pons.family's own live production JS bundle at
// ponsfamily.com/launchpad/create (paired there with its matching locker
// contract), not from a doc/comment/README — then independently verified
// on-chain (contract type, launchEnabled, dexConfig/launchConfig state,
// launchFee) before ever being used here.
const PONS_LAUNCH_FACTORY_ADDRESS = '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75';
const PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';

const PONS_FACTORY_ABI = require('./pons-factory-abi.json');

/**
 * Build (but do not send) a launchToken transaction.
 *
 * @param {object} opts
 * @param {import('ethers').Provider} opts.provider - an ethers provider/signer,
 *   normally from the USER's own connected wallet (window.ethereum). This
 *   module never holds or requests a private key.
 * @param {object} opts.business - { name, symbol, logoUrl, description, socials, feeWallet }
 * @param {number} [opts.launchConfigId=0] - which LaunchConfig to use; read
 *   getLaunchConfig(id) first and show the user what they're launching into
 *   (supply, pair token, fees) before calling this.
 * @param {number} [opts.dexId=0]
 * @param {string} [opts.salt] - bytes32 salt for vanity-suffix mining; pass
 *   ethers.ZeroHash if you don't care about a vanity address.
 */
async function buildLaunchTx({ provider, business, launchConfigId = 0, dexId = 0, salt }) {
  const { ethers } = require('ethers');

  assertNotBlocked(business.feeWallet, 'feeWallet');

  const factory = new ethers.Contract(PONS_LAUNCH_FACTORY_ADDRESS, PONS_FACTORY_ABI, provider);

  const launchFee = await factory.launchFee();

  const tokenParams = {
    name: business.name,
    symbol: business.symbol,
    logo: business.logoUrl || '',
    description: business.description || '',
    socials: {
      twitter: business.socials?.twitter || '',
      telegram: business.socials?.telegram || '',
      discord: business.socials?.discord || '',
      website: business.socials?.website || '',
      farcaster: business.socials?.farcaster || '',
    },
    // If unset, the factory defaults fee routing to msg.sender (whoever signs
    // the launch tx). Leave this unset unless you have an explicit, verified
    // wallet the business owner controls.
    feeWallet: business.feeWallet || ethers.ZeroAddress,
  };

  const saltBytes = salt || ethers.ZeroHash;

  const populated = await factory.launchToken.populateTransaction(
    tokenParams,
    launchConfigId,
    dexId,
    saltBytes,
    { value: launchFee }
  );

  return { populated, launchFee, tokenParams };
}

module.exports = {
  ROBINHOOD_CHAIN,
  PONS_LAUNCH_FACTORY_ADDRESS,
  PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY,
  PONS_FACTORY_ABI,
  BLOCKED_ADDRESSES,
  buildLaunchTx,
};
