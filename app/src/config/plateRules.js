export const INDIAN_PLATE_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
export const PLATE_THRESHOLDS = { recognized: 0.85, lowConfidence: 0.6 };

export const normalizePlate = (value) => String(value || "").toUpperCase().replace(/[\s.-]/g, "");
export const isValidIndianPlate = (value) => INDIAN_PLATE_PATTERN.test(normalizePlate(value));
export const formatPlate = (value) => {
  const normalized = normalizePlate(value);
  if (!INDIAN_PLATE_PATTERN.test(normalized)) return null;
  const match = normalized.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  return [match[1], match[2], match[3], match[4]].filter(Boolean).join(" ");
};
export const plateStatus = (text, confidence) => {
  const score = Number(confidence ?? 0);
  if (!text || score < PLATE_THRESHOLDS.lowConfidence) return "Not Recognized";
  if (!isValidIndianPlate(text)) return "Invalid Format";
  if (score < PLATE_THRESHOLDS.recognized) return "Low Confidence";
  return "Recognized";
};
