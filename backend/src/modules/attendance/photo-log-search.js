export const resolvePhotoLogMatch = (recognition) => {
  const results = Array.isArray(recognition?.results) ? recognition.results : [];
  if (Number(recognition?.facesDetected) !== 1 || results.length !== 1) {
    return {
      matched: false,
      message: "Upload a photo with one clearly visible face.",
    };
  }

  const face = results[0];
  if (face?.status !== "RECOGNIZED" || typeof face.employeeId !== "string" || !face.employeeId.trim()) {
    return {
      matched: false,
      message: "No confident employee match was found. Try a clearer photo or search by name, code, or department.",
    };
  }

  const similarity = Number(face.similarity);
  return {
    matched: true,
    employeeIdentifier: face.employeeId.trim(),
    similarity: Number.isFinite(similarity) ? similarity : null,
  };
};
