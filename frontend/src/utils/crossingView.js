export const crossingToReviewFace = (crossing) => ({
  ...crossing,
  isCrossingRecord: true,
  employeeId: crossing.employee_id || null,
  employeeCode: crossing.employee_code || null,
  personName: crossing.employee_name || (crossing.decision === 'NO_FACE_CAPTURED' ? 'Face not captured' : 'Unknown person'),
  status: crossing.employee_id ? 'REGISTERED' : 'UNREGISTERED',
  personType: crossing.decision,
  faceDecision: crossing.decision,
  faceReason: crossing.face_status || crossing.reason,
  photoUrl: crossing.photo_url,
  facePassportMediaKey: crossing.face_passport_url,
  frameMediaKey: crossing.frame_url,
  bodyMediaKey: crossing.body_url,
  createdAt: crossing.detected_at,
  camera: { name: crossing.camera_id, location: 'Main Gate' },
  allScans: [{ timestamp: crossing.detected_at, photoUrl: crossing.photo_url, camera: crossing.camera_id, direction: crossing.direction }],
  detectionCount: 1,
  inCount: crossing.direction === 'IN' ? 1 : 0,
  outCount: crossing.direction === 'OUT' ? 1 : 0,
});

export const recentCrossingHref = (crossing) => `/unknown-faces?crossing=${encodeURIComponent(crossing.id)}`;

export const formatCrossingTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
};
