// `mount`: USB mass-storage loggers (Elitech RC-5+, LIBERO Cx, TempTale USB and others) appear as a small removable
// volume when plugged in. The gateway finds such volumes, picks the newest export on each and ingests it.
import { existsSync, promises as fs } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { isExportFile } from "./watch.js";

export interface Volume {
  path: string;
  /** how it was found, for the logs */
  via: string;
}

const REMOVABLE_FS = /^(vfat|msdos|exfat|fat|fat32|fuseblk|ntfs|ntfs3|hfsplus|apfs)$/i;

/** Parses /proc/mounts: removable-looking file systems mounted from a block device under media-style directories. */
export function linuxVolumesFromMounts(mounts: string, user = safeUser()): Volume[] {
  const out: Volume[] = [];
  for (const line of mounts.split("\n")) {
    const [dev, rawMp, type] = line.split(/\s+/);
    if (!dev || !rawMp || !type) continue;
    const mp = rawMp.replace(/\\040/g, " ").replace(/\\011/g, "\t");
    if (!dev.startsWith("/dev/")) continue;
    if (!REMOVABLE_FS.test(type)) continue;
    if (mp === "/" || mp.startsWith("/boot") || mp.startsWith("/efi")) continue;
    if (/^\/(media|run\/media|mnt)\//.test(mp) || (user && mp.includes(`/${user}/`))) out.push({ path: mp, via: `/proc/mounts (${type} on ${dev})` });
  }
  return out;
}

function safeUser(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Candidate logger volumes on this machine. */
export async function detectVolumes(platform = process.platform): Promise<Volume[]> {
  const seen = new Map<string, Volume>();
  const add = (v: Volume) => {
    if (!seen.has(v.path)) seen.set(v.path, v);
  };
  if (platform === "linux") {
    try {
      for (const v of linuxVolumesFromMounts(await fs.readFile("/proc/mounts", "utf8"))) add(v);
    } catch {
      /* not a standard Linux /proc */
    }
    const user = safeUser();
    // desktop automounters (udisks) mount removable media here; a bare /mnt is left alone (often fixed disks)
    for (const base of [user && `/media/${user}`, user && `/run/media/${user}`].filter(Boolean) as string[])
      for (const d of await subdirs(base)) add({ path: d, via: base });
  } else if (platform === "darwin") {
    for (const d of await subdirs("/Volumes")) {
      const real = await fs.realpath(d).catch(() => d);
      if (real === "/" || /Macintosh HD|Recovery|Preboot|com\.apple/i.test(d)) continue;
      add({ path: d, via: "/Volumes" });
    }
  } else if (platform === "win32") {
    for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      if (existsSync(root)) add({ path: root, via: "drive letter" });
    }
  }
  return [...seen.values()];
}

/** The most recently modified export on a volume (searched to `depth` levels), or undefined. */
export async function newestExport(root: string, depth = 3): Promise<{ file: string; mtimeMs: number } | undefined> {
  let best: { file: string; mtimeMs: number } | undefined;
  const walk = async (dir: string, level: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "System Volume Information" || e.name === "$RECYCLE.BIN") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && level < depth) await walk(p, level + 1);
      else if (e.isFile() && isExportFile(e.name)) {
        const st = await fs.stat(p).catch(() => undefined);
        if (st && (!best || st.mtimeMs > best.mtimeMs)) best = { file: p, mtimeMs: st.mtimeMs };
      }
    }
  };
  await walk(root, 0);
  return best;
}

/** Lists PDF-only volumes so the operator knows why nothing was read (LIBERO / TempTale PDF reports). */
export async function hasOnlyPdf(root: string): Promise<boolean> {
  try {
    const names = await fs.readdir(root);
    return names.some((n) => /\.pdf$/i.test(n)) && !names.some((n) => isExportFile(n));
  } catch {
    return false;
  }
}
