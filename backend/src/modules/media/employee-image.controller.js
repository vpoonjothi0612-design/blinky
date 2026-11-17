import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const enrollmentRoot = path.resolve(moduleDir, "../../../../ai-services/data/enrollment");

export const getEmployeeImage = async (req, res, next) => {
  try {
    const { employeeCode, filename } = req.params;
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(employeeCode) || !/^[A-Za-z0-9_.-]{1,160}$/.test(filename) || filename.includes("..")) {
      return res.status(404).json({ success: false, message: "Employee image not found" });
    }
    const target = path.resolve(enrollmentRoot, employeeCode, filename);
    if (!target.startsWith(`${enrollmentRoot}${path.sep}`)) return res.status(404).json({ success: false, message: "Employee image not found" });
    await fs.access(target);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.type(path.extname(target));
    return res.sendFile(target);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ success: false, message: "Employee image not found" });
    return next(error);
  }
};
