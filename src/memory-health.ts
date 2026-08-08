import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseMemoryIndex, serializeMemoryIndex, getMemoryDir } from "./memory-md";

const MAX_AUTO_FIXES_PER_RUN = 3;
const MEMORY_INDEX_MAX_LINES = 200;

export interface HealthReport {
  deadLinks: DeadLink[];
  orphanFiles: OrphanFile[];
  indexLineCount: number;
  autoFixed: AutoFixLog[];
  escalated: string[];
}

export interface DeadLink {
  slug: string;
  title: string;
  filePath: string;
  hook: string;
}

export interface OrphanFile {
  slug: string;
  filename: string;
  name: string;
  description: string;
  type: string;
}

export interface AutoFixLog {
  action: "removed-dead-pointer" | "added-pointer" | "escalated-manual";
  target: string;
  reason: string;
}

export function runHealthCheck(indexContent: string, slug: string): HealthReport {
  const report: HealthReport = {
    deadLinks: [],
    orphanFiles: [],
    indexLineCount: 0,
    autoFixed: [],
    escalated: [],
  };

  const sections = parseMemoryIndex(indexContent);
  const section = sections.find((s) => s.slug === slug);

  // Count index lines (non-empty, non-header)
  report.indexLineCount = sections.reduce((sum, s) => sum + s.entries.length, 0);

  // Check for index bloat
  if (report.indexLineCount >= MEMORY_INDEX_MAX_LINES) {
    report.escalated.push(
      `MEMORY.md at ${report.indexLineCount} lines, requires manual merge (threshold ${MEMORY_INDEX_MAX_LINES})`,
    );
  }

  // Find dead links (index points to non-existent files)
  if (section) {
    for (const entry of section.entries) {
      const actualPath = resolveIndexPath(entry.filePath);
      if (!existsSync(actualPath)) {
        report.deadLinks.push({
          slug,
          title: entry.title,
          filePath: entry.filePath,
          hook: entry.hook,
        });
      }
    }
  }

  // Find orphan files (.mem/*.md not in index)
  const memDir = getMemoryDir(slug);
  if (existsSync(memDir)) {
    const indexedFiles = new Set(
      (section?.entries ?? []).map((e) => extractFilename(e.filePath)),
    );
    const memFiles = readdirSync(memDir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("."))
      .filter((f) => !indexedFiles.has(f));

    for (const filename of memFiles) {
      const filePath = join(memDir, filename);
      const content = readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm) {
        report.orphanFiles.push({
          slug,
          filename,
          name: fm.name,
          description: fm.description,
          type: fm.type,
        });
      }
    }
  }

  return report;
}

export function autoFix(report: HealthReport, indexContent: string, slug: string): { newIndex: string; logs: AutoFixLog[] } {
  const logs: AutoFixLog[] = [];
  let fixCount = 0;
  const sections = parseMemoryIndex(indexContent);
  let section = sections.find((s) => s.slug === slug);
  if (!section) {
    section = { slug, entries: [] };
    sections.push(section);
  }

  // Fix 1: Remove dead links (auto, counts toward limit)
  for (const dead of report.deadLinks) {
    if (fixCount >= MAX_AUTO_FIXES_PER_RUN) {
      logs.push({
        action: "escalated-manual",
        target: dead.filePath,
        reason: `max auto-fixes (${MAX_AUTO_FIXES_PER_RUN}) reached, dead link not removed`,
      });
      continue;
    }
    section.entries = section.entries.filter((e) => e.filePath !== dead.filePath);
    logs.push({
      action: "removed-dead-pointer",
      target: dead.filePath,
      reason: `file not found in .mem/`,
    });
    fixCount++;
  }

  // Fix 2: Add pointers for orphan files (auto, counts toward limit)
  for (const orphan of report.orphanFiles) {
    if (fixCount >= MAX_AUTO_FIXES_PER_RUN) {
      logs.push({
        action: "escalated-manual",
        target: orphan.filename,
        reason: `max auto-fixes (${MAX_AUTO_FIXES_PER_RUN}) reached, orphan file pointer not added`,
      });
      continue;
    }
    const filePath = `~/.opencode/projects/${slug}/.mem/${orphan.filename}`;
    const raw = `- [${orphan.name}](${filePath}) - ${orphan.description}`;
    if (!section.entries.some((e) => e.filePath === filePath)) {
      section.entries.push({
        title: orphan.name,
        filePath,
        hook: orphan.description,
        raw,
      });
    }
    logs.push({
      action: "added-pointer",
      target: orphan.filename,
      reason: `orphan file detected, added pointer`,
    });
    fixCount++;
  }

  // Escalations (no auto-fix, just log)
  for (const msg of report.escalated) {
    logs.push({
      action: "escalated-manual",
      target: "(N/A)",
      reason: msg,
    });
  }

  const newIndex = serializeMemoryIndex(sections);
  return { newIndex, logs };
}

export function formatHealthLog(logs: AutoFixLog[]): string {
  if (logs.length === 0) return "";
  const today = new Date().toISOString().split("T")[0] ?? "";
  const lines = logs.map((log) => {
    const detail = log.reason.replace(/\n/g, " ");
    return `<!-- ${today} auto-fix: ${log.action} ${log.target} - ${detail} -->`;
  });
  return lines.join("\n");
}

function resolveIndexPath(filePath: string): string {
  // filePath is like ~/.opencode/projects/<slug>/.mem/<file>.md
  if (filePath.startsWith("~")) {
    return join(homedir(), filePath.slice(1).replace(/^\/+/, ""));
  }
  return filePath;
}

function extractFilename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? "";
}

interface ParsedFrontmatter {
  name: string;
  description: string;
  type: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1] ?? "";
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  const typeMatch = yaml.match(/^type:\s*(.+)$/m);
  if (!nameMatch || !descMatch || !typeMatch) return null;
  return {
    name: nameMatch[1]!.trim(),
    description: descMatch[1]!.trim(),
    type: typeMatch[1]!.trim(),
  };
}
