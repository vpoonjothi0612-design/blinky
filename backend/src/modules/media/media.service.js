import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_ROOT = path.resolve(__dirname, "../../../../ai-services/data");
const ALLOWED_TOP_LEVEL = new Set(["captures", "unknown", "snapshots", "vehicle", "animal", "enrollment"]);

export const encodeMediaKey = (relativePath) => Buffer.from(String(relativePath), "utf8").toString("base64url");
export const mediaUrl = (relativePath) => relativePath ? `/api/media/${encodeMediaKey(relativePath)}` : null;

export const normalizeMediaPath = (value, legacyFolder = "unknown") => {
  if (!value || typeof value !== "string") return null;
  let candidate = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (candidate.startsWith("/api/media/")) return null;
  if (candidate.startsWith("unknown-images/")) candidate = `unknown/${candidate.slice("unknown-images/".length)}`;
  else if (candidate.startsWith("captured-images/")) candidate = `captures/${candidate.slice("captured-images/".length)}`;
  else if (candidate.startsWith("snapshot-images/")) candidate = `snapshots/${candidate.slice("snapshot-images/".length)}`;
  else if (candidate.startsWith("vehicle-images/")) candidate = `vehicle/${candidate.slice("vehicle-images/".length)}`;
  else if (candidate.startsWith("animal-images/")) candidate = `animal/${candidate.slice("animal-images/".length)}`;
  else if (candidate.startsWith("enrollment-images/")) candidate = `enrollment/${candidate.slice("enrollment-images/".length)}`;
  else if (!candidate.includes("/")) candidate = `${legacyFolder}/${candidate}`;

  const normalized = path.posix.normalize(candidate);
  if (normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  if (!ALLOWED_TOP_LEVEL.has(normalized.split("/")[0])) return null;
  return normalized;
};

export const resolveMediaPath = (relativePath) => {
  const normalized = normalizeMediaPath(relativePath);
  if (!normalized) return null;
  const absolute = path.resolve(MEDIA_ROOT, ...normalized.split("/"));
  return absolute.startsWith(`${MEDIA_ROOT}${path.sep}`) ? absolute : null;
};

export const decodeMediaKey = (key) => {
  try {
    const decoded = Buffer.from(String(key), "base64url").toString("utf8");
    return normalizeMediaPath(decoded);
  } catch {
    return null;
  }
};

export const readImageDimensions = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if ([0xd8, 0x01, ...Array.from({ length: 8 }, (_, i) => 0xd0 + i)].includes(marker)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (sof.has(marker) && segmentLength >= 7) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
};
