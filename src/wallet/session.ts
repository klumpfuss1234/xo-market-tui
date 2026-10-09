import { input, password, select } from "@inquirer/prompts";
import { Wallet, getAddress } from "ethers";
import type { WalletSession } from "../types.js";

export const WALLET_ENV_KEYS = [
  "XO_TUI_SMART_ACCOUNT",
  "XO_TUI_OWNER_PRIVATE_KEY",
  "XO_TUI_API_KEY",
  "XO_TUI_API_SECRET",
  "XO_TUI_API_PASSPHRASE"
] as const;

export interface WalletEnvironmentState {
  session?: WalletSession;
  missing: string[];
  invalid?: string;
}

export function inspectWalletEnvironment(): WalletEnvironmentState {
  const values = {
    smartAccount: process.env.XO_TUI_SMART_ACCOUNT,
    ownerPrivateKey: process.env.XO_TUI_OWNER_PRIVATE_KEY,
    apiKey: process.env.XO_TUI_API_KEY,
    apiSecret: process.env.XO_TUI_API_SECRET,
    apiPassphrase: process.env.XO_TUI_API_PASSPHRASE
  };
  const missing = WALLET_ENV_KEYS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) return { missing };
  let smartAccount: string;
  try {
    smartAccount = getAddress(values.smartAccount!);
  } catch { return { missing: [], invalid: "XO_TUI_SMART_ACCOUNT is not a valid address" }; }
  const ownerPrivateKey = values.ownerPrivateKey!;
  try { new Wallet(ownerPrivateKey); }
  catch { return { missing: [], invalid: "XO_TUI_OWNER_PRIVATE_KEY is not a valid signing key" }; }
  if (values.apiKey!.length <= 5) return { missing: [], invalid: "XO_TUI_API_KEY is too short" };
  if (values.apiSecret!.length <= 10) return { missing: [], invalid: "XO_TUI_API_SECRET is too short" };
  if (values.apiPassphrase!.length <= 3) return { missing: [], invalid: "XO_TUI_API_PASSPHRASE is too short" };
  return {
    missing: [],
    session: {
      smartAccount,
      ownerPrivateKey,
      apiKey: values.apiKey!, apiSecret: values.apiSecret!, apiPassphrase: values.apiPassphrase!,
      hmacMode: process.env.XO_TUI_HMAC_MODE === "path-with-query" ? "path-with-query" : "path-only"
    }
  };
}

export function sessionFromEnvironment(): WalletSession | undefined {
  return inspectWalletEnvironment().session;
}

export async function promptWalletSession(): Promise<WalletSession> {
  console.log("\nWallet session — secrets remain in memory and are never written to disk.\n");
  const smartAccount = await input({
    message: "XO smart-account address",
    validate: (value) => { try { getAddress(value); return true; } catch { return "Enter a valid 0x address"; } }
  });
  const ownerPrivateKey = await password({
    message: "Owner signing private key (hidden)",
    mask: "•",
    validate: (value) => { try { new Wallet(value); return true; } catch { return "Invalid private key"; } }
  });
  const apiKey = await password({ message: "XO API key (hidden)", mask: "•", validate: (value) => value.length > 5 || "Required" });
  const apiSecret = await password({ message: "XO HMAC secret (hidden)", mask: "•", validate: (value) => value.length > 10 || "Required" });
  const apiPassphrase = await password({ message: "XO API passphrase (hidden)", mask: "•", validate: (value) => value.length > 3 || "Required" });
  const hmacMode = await select<WalletSession["hmacMode"]>({
    message: "HMAC request target",
    default: "path-only",
    choices: [
      { name: "Live XO compatibility: path only", value: "path-only" },
      { name: "Documented form: path + query", value: "path-with-query" }
    ]
  });
  return { smartAccount: getAddress(smartAccount), ownerPrivateKey, apiKey, apiSecret, apiPassphrase, hmacMode };
}

export function sessionLabel(session?: WalletSession): string {
  if (!session) return "READ ONLY";
  return `${session.smartAccount.slice(0, 6)}…${session.smartAccount.slice(-4)}`;
}
