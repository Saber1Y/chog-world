// Writes src/deployments.generated.ts from contracts/deployments/<chainId>.json.
// Local and dry-run files (local*.json, dryrun*.json) are never published.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../../contracts/deployments");
const entries = readdirSync(dir)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .sort((a, b) => a.chainId - b.chainId);

const body = entries.map((d) => `  ${d.chainId}: ${JSON.stringify(d, null, 4).replace(/\n/g, "\n  ")},`).join("\n");
writeFileSync(
  join(here, "../src/deployments.generated.ts"),
  `// Written by scripts/gen-deployments.mjs from contracts/deployments. Do not edit by hand.\nimport type { Deployment } from "./deployments.js";\n\nexport const DEPLOYMENTS: Partial<Record<number, Deployment>> = {\n${body}\n};\n`,
);
console.log(`wrote ${entries.length} deployment(s)`);
