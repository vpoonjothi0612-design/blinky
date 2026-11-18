const HUMAN_ORIENTATIONS = new Set(["FRONT", "LEFT", "RIGHT", "BACK", "UNKNOWN"]);
const HUMAN_IMAGE_ANGLES = new Set(["FRONT", "LEFT", "RIGHT"]);
const VEHICLE_ANGLES = new Set(["FRONT", "LEFT", "RIGHT", "REAR", "TOP", "UNKNOWN"]);
const VEHICLE_IMAGE_ANGLES = new Set(["FRONT", "LEFT", "RIGHT", "REAR"]);

const normalizeLabel = (value, allowed) => {
  const label = typeof value === "string" ? value.trim().toUpperCase() : "";
  return allowed.has(label) ? label : "UNKNOWN";
};

const normalizeConfidence = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null;
};

const normalizeImages = (value, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([angle, imagePath]) => typeof angle === "string" && allowed.has(angle.trim().toUpperCase()) && typeof imagePath === "string" && imagePath.trim())
      .map(([angle, imagePath]) => [angle.trim().toUpperCase(), imagePath.trim()]),
  );
};

export const mapViewMetadata = (metadata = {}) => {
  const humanOrientation = normalizeLabel(metadata.humanOrientation, HUMAN_ORIENTATIONS);
  const vehicleAngle = normalizeLabel(metadata.vehicleAngle, VEHICLE_ANGLES);
  return {
    human_orientation: humanOrientation,
    human_orientation_confidence: humanOrientation === "UNKNOWN" ? null : normalizeConfidence(metadata.humanOrientationConfidence),
    human_angle_images: normalizeImages(metadata.humanAngleImages, HUMAN_IMAGE_ANGLES),
    vehicle_angle: vehicleAngle,
    vehicle_angle_confidence: vehicleAngle === "UNKNOWN" ? null : normalizeConfidence(metadata.vehicleAngleConfidence),
    vehicle_angle_images: normalizeImages(metadata.vehicleAngleImages, VEHICLE_IMAGE_ANGLES),
  };
};
