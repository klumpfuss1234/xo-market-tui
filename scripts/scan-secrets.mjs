import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const includeDist = process.argv.includes("--include-dist");
const skip = new Set([".git", "node_modules", "coverage", ...(includeDist ? [] : ["dist"])]);
const allowedExtensions = new Set([".ts", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".txt"]);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (allowedExtensions.has(extname(entry.name)) || ["LICENSE", ".gitignore", ".env.example"].includes(entry.name)) await inspect(path);
  }
}

async function inspect(path) {
  const text = await readFile(path, "utf8");
  const rules = [
    ["raw 32-byte hex secret", /0x[0-9a-fA-F]{64}/g],
    ["assigned private key", /(?:PRIVATE_KEY|ownerPrivateKey)\s*[=:]\s*["'][^"'\r\n]{20,}["']/gi],
    ["assigned API secret", /(?:API_SECRET|apiSecret)\s*[=:]\s*["'][^"'\r\n]{12,}["']/gi],
    ["assigned passphrase", /(?:PASSPHRASE|apiPassphrase)\s*[=:]\s*["'][^"'\r\n]{8,}["']/gi],
    ["nonblank dotenv credential", /^[ \t]*(?:export[ \t]+)?XO_TUI_(?:OWNER_PRIVATE_KEY|API_KEY|API_SECRET|API_PASSPHRASE)[ \t]*=[ \t]*(?!["']?[ \t]*(?:#.*)?$).+$/gmi]
  ];
  for (const [label, pattern] of rules) {
    for (const match of text.matchAll(pattern)) findings.push(`${relative(root, path)}: ${label} at offset ${match.index}`);
  }
}

await walk(root);
if (findings.length) {
  console.error("Potential credentials found:\n" + findings.join("\n"));
  process.exit(1);
}
console.log("Secret scan passed: no embedded credential-shaped values found.");
