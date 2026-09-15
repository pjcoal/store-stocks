#!/usr/bin/env node
/**
 * launch_token.js
 *
 * Manual, confirm-before-you-sign CLI for launching ONE business's token on
 * pons.family / Robinhood Chain via the verified PonsLaunchFactory contract.
 *
 * This intentionally does NOT support batch/unattended launching. Every
 * launch requires you to read a printed summary and type "yes". That's a
 * deliberate guardrail, not a missing feature — see README.md for why.
 *
 * Usage:
 *   PONS_LAUNCHER_PK=0x...            (your wallet's private key; never share it,
 *                                       never commit it, prefer a fresh burner
 *                                       wallet with just enough ETH for fees)
 *   node scripts/launch_token.js --file data/businesses.json --id places-abc123
 */
const fs = require('fs');
const readline = require('readline');
const { ethers } = require('ethers');
const { ROBINHOOD_CHAIN, PONS_LAUNCH_FACTORY_ADDRESS, buildLaunchTx } = require('../lib/ponsFactory');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  const file = arg('file', 'data/businesses.json');
  const id = arg('id');
  const launchConfigId = Number(arg('launchConfigId', '0'));
  const dexId = Number(arg('dexId', '0'));

  if (!id) {
    console.error('Usage: node scripts/launch_token.js --file data/businesses.json --id <business-id>');
    process.exit(1);
  }

  const pk = process.env.PONS_LAUNCHER_PK;
  if (!pk) {
    console.error('Set PONS_LAUNCHER_PK to your wallet private key (fresh burner wallet recommended).');
    process.exit(1);
  }

  const businesses = JSON.parse(fs.readFileSync(file, 'utf8'));
  const business = businesses.find((b) => b.id === id);
  if (!business) {
    console.error(`No business with id ${id} in ${file}`);
    process.exit(1);
  }

  if (business.isFictionalDemo === false && !business.ownerVerified) {
    console.warn(
      '\n⚠️  This business has not been marked ownerVerified: true.\n' +
      '   You are about to create an "unofficial" token using a real business\'s\n' +
      '   name without their consent. Make sure the description/socials clearly\n' +
      '   say "unofficial, not affiliated" before continuing — see README.md.\n'
    );
  }

  const provider = new ethers.JsonRpcProvider(ROBINHOOD_CHAIN.rpcUrl, ROBINHOOD_CHAIN.chainId);
  const wallet = new ethers.Wallet(pk, provider);

  const { populated, launchFee, tokenParams } = await buildLaunchTx({
    provider: wallet,
    business,
    launchConfigId,
    dexId,
  });

  console.log('\n--- Launch summary ---');
  console.log('Factory contract:', PONS_LAUNCH_FACTORY_ADDRESS);
  console.log('Chain:', ROBINHOOD_CHAIN.name, `(chainId ${ROBINHOOD_CHAIN.chainId})`);
  console.log('Signer wallet:', await wallet.getAddress());
  console.log('Name / Symbol:', tokenParams.name, '/', tokenParams.symbol);
  console.log('Description:', tokenParams.description);
  console.log('Fee wallet (creator payout):', tokenParams.feeWallet);
  console.log('Launch fee:', ethers.formatEther(launchFee), 'ETH');
  console.log('-----------------------\n');

  const answer = await ask('Type "yes" to sign and send this transaction, anything else to abort: ');
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted. Nothing was sent.');
    process.exit(0);
  }

  const tx = await wallet.sendTransaction(populated);
  console.log('Submitted:', tx.hash);
  const receipt = await tx.wait();
  console.log('Confirmed in block', receipt.blockNumber, '- status:', receipt.status === 1 ? 'success' : 'FAILED');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
