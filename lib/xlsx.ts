/**
 * xlsx export wrapper — calls xlsx_export.py via Python.
 * Writes JSON temp file, invokes Python, returns output path.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Tweet } from "./api";
import type { AnalysisResult } from "./analyze";

const SKILL_DIR = join(import.meta.dir, "..");
const PYTHON_SCRIPT = join(SKILL_DIR, "xlsx_export.py");
const OUTPUT_DIR = join(SKILL_DIR, "data", "exports");

export async function exportXlsx(
  tweets: Tweet[],
  analysis: AnalysisResult,
  opts: { filename?: string; outputDir?: string } = {}
): Promise<string> {
  const outDir = opts.outputDir || OUTPUT_DIR;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // Build filename
  const slug = analysis.query
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .toLowerCase();
  const date = new Date().toISOString().split("T")[0];
  const filename = opts.filename || `x-research-${slug}-${date}.xlsx`;
  const outputPath = join(outDir, filename);

  // Write temp JSON
  const tmpPath = join(outDir, `.tmp-${Date.now()}.json`);
  const data = {
    tweets,
    engagement: analysis.engagement,
    influencers: analysis.influencers,
    keywords: analysis.keywords,
  };
  writeFileSync(tmpPath, JSON.stringify(data));

  try {
    const proc = Bun.spawn(["python3", PYTHON_SCRIPT, tmpPath, outputPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw new Error(`xlsx_export.py failed (exit ${exitCode}): ${stderr}`);
    }
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }

  return outputPath;
}
