import fs from "fs/promises";
import path from "path";
import { decodeMediaKey, MEDIA_ROOT, resolveMediaPath } from "./media.service.js";

export const getMedia = async (req, res, next) => {
  try {
    const relativePath = decodeMediaKey(req.params.key);
    const filePath = relativePath && resolveMediaPath(relativePath);
    if (!filePath) return res.status(404).json({ success: false, message: "Media not found" });
    const resolvedRoot = path.resolve(MEDIA_ROOT);
    if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      return res.status(404).json({ success: false, message: "Media not found" });
    }
    await fs.access(filePath);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.type(path.extname(filePath));
    return res.sendFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ success: false, message: "Media not found" });
    return next(error);
  }
};
