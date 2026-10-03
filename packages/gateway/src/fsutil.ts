import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** The gateway's data directory: --home, $CARGOFLOW_GATEWAY_HOME, or ~/.cargoflow-gateway. */
export function resolveHome(explicit?: string): string {
  return path.resolve(explicit || process.env.CARGOFLOW_GATEWAY_HOME || path.join(homedir(), ".cargoflow-gateway"));
}

/**
 * Writes a file so that a crash or power cut leaves either the old or the new content, never a torn file: the data
 * goes to a temporary file in the same directory, is flushed to disk, and is renamed over the target.
 */
export async function writeFileAtomic(file: string, data: string, mode = 0o600): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fh = await fs.open(tmp, "w", mode);
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
  // make the rename itself durable where the platform allows syncing a directory
  try {
    const dh = await fs.open(path.dirname(file), "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    /* Windows cannot open directories; rename is already atomic there */
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
