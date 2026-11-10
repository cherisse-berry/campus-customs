// Writes docs/coverage-matrix.md from the persona and scenario registries.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/manifest.js";
const { personas } = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "personas.json"), "utf8"));
const { scenarios } = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "scenarios.json"), "utf8"));
const J = "ABCDEFGHIJKL".split("");
let md = `# Persona × journey coverage matrix\n\nGenerated from config/. ● = scenario defined. Journey L (responsive) runs P01 on tablet and mobile via \`npm run batch -- --mobile\`. Phase = Section 27 order.\n\n| Persona | ${J.join(" | ")} | Scenarios (phase) | Risk notes |\n|---|${J.map(() => "---").join("|")}|---|---|\n`;
for (const p of personas) {
  const ss = scenarios.filter((s) => s.persona === p.id);
  const cells = J.map((j) => (ss.some((s) => s.journey.includes(j)) || (j === "L" && p.id === "P01") ? "●" : ""));
  const notes = [ss.some((s) => s.requiresRole) && "needs role-specific account", ss.some((s) => s.requiresServerSideNewUser) && "needs server-side new account", ss.some((s) => s.sharedBenchmark) && "shared benchmark task", /boundary/i.test(p.appropriateDepth + p.reasonableExpectations) && "boundary case"].filter(Boolean).join("; ");
  md += `| ${p.id} ${p.label} | ${cells.join(" | ")} | ${ss.map((s) => `${s.id} (${s.phase})`).join(", ")} | ${notes} |\n`;
}
md += `\n## Dimension spread (pairwise check)\n\n| Persona | Career stage | Methods | Resources | Country | Digital literacy | First goal |\n|---|---|---|---|---|---|---|\n`;
for (const p of personas) { const d = p.dimensions; md += `| ${p.id} | ${d.careerStage} | ${d.methodsExpertise} | ${d.institutionalResources} | ${d.country} | ${d.digitalLiteracy} | ${d.researchOrFundingFirst} |\n`; }
fs.writeFileSync(path.join(ROOT, "docs", "coverage-matrix.md"), md);
console.log("Wrote docs/coverage-matrix.md");
