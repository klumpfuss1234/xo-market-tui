#!/usr/bin/env node
import { select } from "@inquirer/prompts";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { PublicXoClient } from "./api/public-client.js";
import { runDashboard } from "./ui/dashboard.js";
import { inspectWalletEnvironment, promptWalletSession, type WalletEnvironmentState } from "./wallet/session.js";
import type { WalletSession } from "./types.js";

const envPath = resolve(process.cwd(), ".env");

function loadLocalEnvironment(): boolean {
  try {
    loadEnvFile(envPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Could not load the local .env file; continuing without it.");
    }
    return false;
  }
}

function printWalletGuide(state?: WalletEnvironmentState): void {
  console.log("\nWallet setup (optional — browsing and live books work without it)\n");
  if (state?.missing.length) console.log(`Missing: ${state.missing.join(", ")}`);
  if (state?.invalid) console.log(`Invalid wallet configuration: ${state.invalid}`);
  console.log([
    "1. Create and fund an XO smart account in the official XO app.",
    "2. Obtain your own XO CLOB API key, HMAC secret, and passphrase.",
    "3. In the directory where you launch XO TUI, create a file named .env:",
    "",
    "   XO_TUI_SMART_ACCOUNT=",
    "   XO_TUI_OWNER_PRIVATE_KEY=",
    "   XO_TUI_API_KEY=",
    "   XO_TUI_API_SECRET=",
    "   XO_TUI_API_PASSPHRASE=",
    "   XO_TUI_HMAC_MODE=path-only",
    "",
    "4. Fill your own values, restrict the file with chmod 600 .env, and never commit it.",
    "5. Restart XO TUI. Add --read-only to skip wallet setup.",
    "",
    "A source checkout also includes docs/WALLET_SETUP.md.",
    "For a diskless session, start XO TUI with --wallet."
  ].join("\n"));
}

async function chooseInitialSession(command: string | undefined, envLoaded: boolean): Promise<WalletSession | undefined> {
  if (command === "--read-only") return undefined;
  if (command === "--wallet") return promptWalletSession();
  const state = inspectWalletEnvironment();
  if (state.session) return state.session;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn("Wallet configuration is missing or invalid; continuing read-only. See docs/WALLET_SETUP.md.");
    return undefined;
  }
  const reason = state.invalid
    ? `Wallet values in ${envLoaded ? ".env" : "the environment"} are invalid.`
    : envLoaded
      ? "The local .env does not contain a complete wallet configuration."
      : "No local .env wallet configuration was found.";
  console.log(`\n${reason}`);
  const choice = await select<"read-only" | "temporary" | "guide">({
    message: "How should XO TUI start?",
    default: "read-only",
    choices: [
      { name: "Continue read-only (recommended first run)", value: "read-only" },
      { name: "Enter wallet credentials for this session only", value: "temporary" },
      { name: "Show safe .env setup instructions, then continue read-only", value: "guide" }
    ]
  });
  if (choice === "temporary") return promptWalletSession();
  if (choice === "guide") printWalletGuide(state);
  return undefined;
}

async function doctor(): Promise<void> {
  const client = new PublicXoClient();
  const started = performance.now();
  const page = await client.listEvents({ take: 1 });
  const summary = page.data[0];
  if (!summary) throw new Error("No XO events returned");
  const event = await client.getEvent(summary.slug);
  const markets = event.markets.filter((entry) => entry.market.outcomes.length >= 2);
  const books = await client.getBooks(markets.flatMap((entry) => entry.market.outcomes.map((outcome) => outcome.outcomeTokenId)));
  console.log(`OK data API: ${page.meta.itemCount} XO events`);
  console.log(`OK event model: ${markets.length} related outcome markets for “${event.title}”`);
  console.log(`OK orderbook API: ${books.length} books`);
  console.log(`OK round trip: ${(performance.now() - started).toFixed(0)} ms`);
  console.log("No wallet credentials were read or written by doctor.");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "doctor") { await doctor(); return; }
  if (command === "--read-only") {
    await runDashboard(undefined);
    return;
  }
  const envLoaded = loadLocalEnvironment();
  if (command === "setup") {
    printWalletGuide(inspectWalletEnvironment());
    return;
  }
  let session = await chooseInitialSession(command, envLoaded);
  for (;;) {
    const action = await runDashboard(session);
    if (action.type !== "connect-wallet") return;
    session = await promptWalletSession();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
