#!/usr/bin/env node
// Source-verifies every contract of a deployment on Blockscout, from the broadcast record alone: the address, the
// contract name and the constructor arguments of each CREATE are read from broadcast/Deploy.s.sol/<chain>/run-latest.json,
// the constructor signature and the source path from the compiled artifact, and the arguments are ABI-encoded with
// `cast abi-encode`. Run it after `forge build` (the artifacts must match the deployed bytecode: solc 0.8.19, paris,
// 200 runs — the fork profile produces the same bytecode, solc 0.8.19 caps the EVM version at paris).
//
//   node script/verify.mjs --chain 4663                    # verify all
//   node script/verify.mjs --chain 46630 --only VigilOracle
//   node script/verify.mjs --chain 4663 --dry              # print the forge commands only
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const chain = Number(flag("chain", "46630"));
const VERIFIER_URL = flag("verifier-url", {
  46630: "https://explorer.testnet.chain.robinhood.com/api",
  4663: "https://robinhoodchain.blockscout.com/api",
}[chain]);
if (!VERIFIER_URL) throw new Error(`no explorer known for chain ${chain}; pass --verifier-url`);
const only = flag("only");
const dry = args.includes("--dry");

const run = JSON.parse(fs.readFileSync(flag("broadcast", `broadcast/Deploy.s.sol/${chain}/run-latest.json`), "utf8"));
if (run.chain !== chain) throw new Error(`broadcast is for chain ${run.chain}, not ${chain}`);
const creates = run.transactions.filter((t) => t.transactionType === "CREATE" && (!only || t.contractName === only));
if (!creates.length) throw new Error("nothing to verify");

let failed = 0;
for (const t of creates) {
  const artifact = JSON.parse(fs.readFileSync(`out/${t.contractName}.sol/${t.contractName}.json`, "utf8"));
  const target = Object.entries(JSON.parse(artifact.rawMetadata).settings.compilationTarget)[0]; // ["src/VigilOracle.sol", "VigilOracle"]
  const ctor = artifact.abi.find((f) => f.type === "constructor");
  const types = ctor ? ctor.inputs.map((i) => i.type) : [];
  const values = (t.arguments ?? []).map((a) => a.replace(/\s+/g, "")); // forge prints arrays as "[1, 2]"; cast wants no spaces
  if (types.length !== values.length) throw new Error(`${t.contractName}: ${types.length} constructor inputs but ${values.length} recorded arguments`);
  const encoded = types.length ? execFileSync("cast", ["abi-encode", `constructor(${types.join(",")})`, ...values]).toString().trim() : null;
  const cmd = [
    "verify-contract", "--chain-id", String(chain), "--verifier", "blockscout", "--verifier-url", VERIFIER_URL, "--watch",
    t.contractAddress, `${target[0]}:${target[1]}`, ...(encoded ? ["--constructor-args", encoded] : []),
  ];
  console.log(`\n== ${t.contractName} ${t.contractAddress}${encoded ? `  constructor(${types.join(",")})` : ""}`);
  if (dry) { console.log(`forge ${cmd.join(" ")}`); continue; }
  const r = spawnSync("forge", cmd, { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(`   FAILED ${t.contractName}`); }
}
if (failed) { console.log(`\n${failed} of ${creates.length} verifications failed`); process.exit(1); }
console.log(dry ? `\n${creates.length} commands (dry run)` : `\n${creates.length} contracts verified`);
