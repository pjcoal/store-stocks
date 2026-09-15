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

// pons.family's real "v2" launchpad — the bonding-curve `PonsV2LaunchFactory`
// this project's UI at ponsfamily.com/launchpad/create actually sends
// launchToken() transactions to. See README.md "v2 factory correction" for
// the full story: an earlier pass here mistook a second deployment of the
// OLD Uniswap-V3-LP-seeding contract (still verified, still open, just also
// called "v2" in its own comments) for this one, because both showed up
// under the UI's "v1"/"v2" toggle and both were independently verifiable
// on-chain — verifiable is not the same as "the one the live UI actually
// calls." This address was corrected by capturing the real eth_call traffic
// the live page makes (network requests from the running app, not a doc or
// a JS-bundle text scrape), then independently confirmed on-chain
// (verified `PonsV2LaunchFactory` source, `launchEnabled() == true`,
// `canLaunch()` true for an arbitrary unrelated address, matching
// launchFee/launchConfig state) before ever being used here.
//
// This is a fundamentally different contract from the one the address
// below used to point at — different TokenParams shape (creatorFeeRecipient
// + creatorTaxBps instead of feeWallet; no dexId — pairToken is now a
// direct address, address(0) for native ETH), different launchToken(...)
// signature, and different post-launch mechanics (trades on a bonding
// curve until a graduation threshold is raised, then migrates into a
// Uniswap V4 pool, instead of seeding a Uniswap V3 pool immediately).
const PONS_LAUNCH_FACTORY_ADDRESS = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
// The address this file previously (incorrectly) called "v2": a second,
// open (launchEnabled == true) deployment of the same old LP-seeding
// contract type as the v1-legacy address above, not the bonding-curve
// PonsV2LaunchFactory the live UI's "v2" tab actually uses. Kept only for
// reference / for anyone who registered a launch against it before this
// correction.
const PONS_LAUNCH_FACTORY_ADDRESS_V1_OPEN_MISLABELED_V2 = '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75';
// Native-ETH pairing on this factory is the zero address, not a separate
// "dex" selector (verified against its source: `pairToken == address(0)`
// is the native-ETH branch throughout `_launchToken`).
const PAIR_TOKEN_ETH = '0x0000000000000000000000000000000000000000';

const PONS_FACTORY_ABI = require('./pons-factory-abi.json');

/**
 * Build (but do not send) a launchToken transaction.
 *
 * @param {object} opts
 * @param {import('ethers').Provider} opts.provider - an ethers provider/signer,
 *   normally from the USER's own connected wallet (window.ethereum). This
 *   module never holds or requests a private key.
 * @param {object} opts.business - { name, symbol, logoUrl, description, socials,
 *   creatorFeeRecipient, creatorTaxBps, buybackEnabled }
 * @param {number} [opts.launchConfigId=0] - which LaunchConfig to use; read
 *   getLaunchConfig(id) first and show the user what they're launching into
 *   (supply, pool fee, graduation threshold) before calling this.
 * @param {string} [opts.pairToken] - defaults to PAIR_TOKEN_ETH (native ETH).
 * @param {string} [opts.salt] - bytes32 salt for vanity-suffix mining; pass
 *   ethers.ZeroHash if you don't care about a vanity address.
 */
async function buildLaunchTx({ provider, business, launchConfigId = 0, pairToken, salt }) {
  const { ethers } = require('ethers');

  assertNotBlocked(business.creatorFeeRecipient, 'creatorFeeRecipient');

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
    // If unset, the factory defaults fee routing to whoever signs the
    // launch tx. Leave this unset unless you have an explicit, verified
    // wallet the business owner (or this project's platform wallet)
    // controls.
    creatorFeeRecipient: business.creatorFeeRecipient || ethers.ZeroAddress,
    // Basis points, capped by the factory's live maxCreatorTaxBps() and by
    // curveFeeBps + creatorTaxBps <= MAX_TOTAL_TRADE_FEE_BPS — read both
    // live before assuming a value like 300 (3%) will be accepted.
    creatorTaxBps: business.creatorTaxBps || 0,
    buybackEnabled: !!business.buybackEnabled,
    expectedEconomics: ethers.ZeroHash,
    salt: salt || ethers.ZeroHash,
  };

  const populated = await factory.launchToken.populateTransaction(
    tokenParams,
    launchConfigId,
    pairToken || PAIR_TOKEN_ETH,
    { value: launchFee }
  );

  return { populated, launchFee, tokenParams };
}

module.exports = {
  ROBINHOOD_CHAIN,
  PONS_LAUNCH_FACTORY_ADDRESS,
  PONS_LAUNCH_FACTORY_ADDRESS_V1_LEGACY,
  PONS_LAUNCH_FACTORY_ADDRESS_V1_OPEN_MISLABELED_V2,
  PAIR_TOKEN_ETH,
  PONS_FACTORY_ABI,
  BLOCKED_ADDRESSES,
  buildLaunchTx,
};
