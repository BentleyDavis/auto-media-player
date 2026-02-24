#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type CliOptions = {
  inputDir: string;
  outputDir: string;
  originalsDir: string;
  dryRun: boolean;
  force: boolean;
  quiet: boolean;
  concurrency: number;
};

type Job = {
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  archivedOriginalPath: string;
};

const mediaRootDir = path.join(homedir(), "Documents", "auto-media-player");

const defaultDirs = {
  input: path.join(mediaRootDir, "_toBeNormalized"),
  output: path.join(mediaRootDir, "_normalized"),
  originals: path.join(mediaRootDir, "_originals")
};

const usageText = `
External MP3 processor (FFmpeg)

Usage:
  node --experimental-strip-types tools/mp3-process.ts [options]

Options:
  --input <dir>         Input folder to scan recursively for .mp3 files (default: Documents/auto-media-player/_toBeNormalized).
  --output <dir>        Output folder where processed MP3 files are written (default: Documents/auto-media-player/_normalized).
  --originals <dir>     Archive folder where original files are moved after success (default: Documents/auto-media-player/_originals).
  --concurrency <num>   Number of files to process in parallel (default: 2).
  --force               Reprocess and overwrite output files if they already exist.
  --quiet               Suppress non-error logs.
  --dry-run             Show intended actions without writing/moving files.
  --help                Show this help text.

Preset:
  FM-radio loud (aggressive)
  - Dynamic compression before loudness normalization
  - Target loudness: -10 LUFS, True Peak: -1 dB, LRA: 7
  - MP3 output quality: libmp3lame VBR q=1
`;

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    console.log(usageText.trim());
    return;
  }

  const options = parseArgs(process.argv.slice(2));

  if (!options) {
    process.exitCode = 1;
    return;
  }

  const log = (...parts: Array<string | number>): void => {
    if (!options.quiet) {
      console.log(...parts);
    }
  };

  await assertCommand("ffmpeg", ["-version"]);
  await assertCommand("ffprobe", ["-version"]);

  const inputDir = path.resolve(options.inputDir);
  const outputDir = path.resolve(options.outputDir);
  const originalsDir = path.resolve(options.originalsDir);

  if (inputDir === outputDir || inputDir === originalsDir || outputDir === originalsDir) {
    throw new Error("input, output, and originals directories must all be different paths.");
  }

  const createdDirs = await ensureDirectories([inputDir, outputDir, originalsDir]);
  for (const createdDir of createdDirs) {
    log(`[init] created folder: ${createdDir}`);
  }

  const sourceFiles = await collectMp3Files(inputDir);

  if (sourceFiles.length === 0) {
    log(`No .mp3 files found under: ${inputDir}`);
    return;
  }

  const jobs: Job[] = sourceFiles.map((sourcePath) => {
    const relativePath = path.relative(inputDir, sourcePath);
    return {
      sourcePath,
      relativePath,
      outputPath: path.join(outputDir, relativePath),
      archivedOriginalPath: path.join(originalsDir, relativePath)
    };
  });

  log(`Found ${jobs.length} MP3 files.`);
  log(`Input:     ${inputDir}`);
  log(`Processed: ${outputDir}`);
  log(`Originals: ${originalsDir}`);
  log(`Mode:      ${options.dryRun ? "dry-run" : "write"}`);
  log(`Workers:   ${options.concurrency}`);

  const summary = {
    processed: 0,
    skipped: 0,
    moved: 0,
    failed: 0
  };

  await runWithConcurrency(jobs, options.concurrency, async (job) => {
    const outputExists = await fileExists(job.outputPath);

    if (outputExists && !options.force) {
      summary.skipped += 1;
      log(`[skip] output exists: ${job.relativePath}`);
      return;
    }

    if (options.dryRun) {
      summary.processed += 1;
      summary.moved += 1;
      log(`[dry ] ffmpeg -> ${job.relativePath}`);
      log(`      move original -> ${job.archivedOriginalPath}`);
      return;
    }

    try {
      await ensureParent(job.outputPath);
      await ensureParent(job.archivedOriginalPath);

      await runFfmpeg(job.sourcePath, job.outputPath);
      await verifyOutput(job.outputPath);

      await rename(job.sourcePath, job.archivedOriginalPath);

      summary.processed += 1;
      summary.moved += 1;
      log(`[ok  ] ${job.relativePath}`);
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${job.relativePath}`);
      console.error(`      ${message}`);
    }
  });

  log("\nDone.");
  log(`Processed: ${summary.processed}`);
  log(`Skipped:   ${summary.skipped}`);
  log(`Moved:     ${summary.moved}`);
  log(`Failed:    ${summary.failed}`);

  if (summary.failed > 0) {
    process.exitCode = 2;
  }
}

function parseArgs(args: string[]): CliOptions | null {
  const inputDir = readArgValue(args, "--input") ?? defaultDirs.input;
  const outputDir = readArgValue(args, "--output") ?? defaultDirs.output;
  const originalsDir = readArgValue(args, "--originals") ?? defaultDirs.originals;
  const concurrencyRaw = readArgValue(args, "--concurrency") ?? "2";
  const concurrency = Number.parseInt(concurrencyRaw, 10);

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be an integer >= 1");
  }

  return {
    inputDir,
    outputDir,
    originalsDir,
    concurrency,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    quiet: args.includes("--quiet")
  };
}

function readArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected value after ${key}`);
  }

  return value;
}

async function collectMp3Files(rootDir: string): Promise<string[]> {
  const items: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.toLowerCase().endsWith(".mp3")) {
        items.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return items;
}

async function runWithConcurrency<T>(
  values: T[],
  workerCount: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  let index = 0;

  const runners = new Array(Math.min(workerCount, values.length)).fill(0).map(async () => {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      await worker(values[currentIndex]);
    }
  });

  await Promise.all(runners);
}

async function runFfmpeg(sourcePath: string, outputPath: string): Promise<void> {
  const audioFilter = [
    "acompressor=threshold=-18dB:ratio=4:attack=5:release=120:makeup=5",
    "loudnorm=I=-10:TP=-1:LRA=7"
  ].join(",");

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-vn",
    "-map_metadata",
    "0",
    "-af",
    audioFilter,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "1",
    outputPath
  ];

  await runCommand("ffmpeg", args);
}

async function verifyOutput(filePath: string): Promise<void> {
  const details = await stat(filePath);
  if (details.size < 16_384) {
    throw new Error(`Output file appears too small: ${filePath}`);
  }

  await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
}

async function assertCommand(command: string, args: string[]): Promise<void> {
  try {
    await runCommand(command, args);
  } catch {
    throw new Error(
      `${command} is required but was not found. Install FFmpeg and ensure ${command} is in PATH.`
    );
  }
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} exited with code ${code}. ${stderr.trim()}`));
    });
  });
}

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectories(dirPaths: string[]): Promise<string[]> {
  const created: string[] = [];

  for (const dirPath of dirPaths) {
    if (!(await fileExists(dirPath))) {
      await mkdir(dirPath, { recursive: true });
      created.push(dirPath);
    }
  }

  return created;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});