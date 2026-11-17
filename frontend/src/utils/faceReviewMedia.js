export const isNoFaceCapture = (face) => {
  if (face?.personType === 'NO_FACE_CAPTURED' || face?.faceDecision === 'NO_FACE_CAPTURED' || face?.decision === 'NO_FACE_CAPTURED') return true;
  try {
    const notes = typeof face?.notes === 'string' ? JSON.parse(face.notes) : face?.notes;
    return notes?.faceStatus === 'NO_FACE_CAPTURED';
  } catch {
    return false;
  }
};

export const getFaceReviewMedia = (face) => {
  if (!face) return { mediaKey: null, placeholder: 'No face photo available' };
  const mediaKey = isNoFaceCapture(face)
    ? face.facePassportMediaKey || face.face_passport_url || face.bodyMediaKey || face.body_url || face.photo_url || face.frameMediaKey || face.frame_url
    : face.photo_url || face.facePassportMediaKey || (face.photoUrl?.startsWith('/api/media/') ? face.photoUrl : null);
  return {
    mediaKey: mediaKey || null,
    placeholder: mediaKey ? null : (isNoFaceCapture(face) ? noFaceReasonLabel(face) : 'No face photo available'),
  };
};

export const noFaceReasonLabel = (face) => {
  const reason = String(face?.faceReason || '').toUpperCase();
  if (reason === 'FACE_TURNED_AWAY') return 'Face not visible (looking down or turned away)';
  if (reason === 'FACE_TOO_SMALL') return 'Face too small';
  if (reason === 'FACE_QUALITY_LOW') return 'Face quality too low';
  return 'Face not visible';
};
