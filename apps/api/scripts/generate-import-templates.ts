// Writes the downloadable import templates and their column references.
// Run: pnpm --filter @alma/api generate:import-templates
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATASETS, buildDataDictionary, buildSampleCsv } from "../src/lib/forecast/import-templates.js";

const out = resolve(process.cwd(), "../../docs/forecast-import-templates");
mkdirSync(out, { recursive: true });

const index: string[] = [
  "# Forecast import templates",
  "",
  "Download a template, fill it in, and upload it at `/forecast/imports`.",
  "",
  "Money columns are entered in **dollars** and stored as integer cents. Every",
  "money column states whether it is GST inclusive or exclusive — that is never",
  "inferred, because mixing the two is how a cost base gets overstated.",
  "",
  "Each file ships with two clearly-labelled example rows. Delete them before",
  "uploading your own data.",
  "",
  "| Dataset | Template | Reference | Rows identified by |",
  "| --- | --- | --- | --- |",
];

for (const dataset of DATASETS) {
  writeFileSync(resolve(out, `${dataset.key}.csv`), buildSampleCsv(dataset));
  writeFileSync(resolve(out, `${dataset.key}.md`), buildDataDictionary(dataset));
  index.push(
    `| ${dataset.title} | [\`${dataset.key}.csv\`](${dataset.key}.csv) | [columns](${dataset.key}.md) | ${dataset.naturalKey.join(" + ")} |`,
  );
}

writeFileSync(resolve(out, "README.md"), index.join("\n") + "\n");
console.log(`Wrote ${DATASETS.length} templates and column references to ${out}`);
