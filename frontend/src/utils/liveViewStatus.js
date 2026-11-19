const HUMAN_ORIENTATIONS = new Set([
  'FRONT',
  'FRONT_LEFT',
  'FRONT_RIGHT',
  'LEFT_PROFILE',
  'RIGHT_PROFILE',
  'LEFT',
  'RIGHT',
  'BACK',
  'UNKNOWN',
  'UNKNOWN_ORIENTATION',
]);
const VEHICLE_ANGLES = new Set(['FRONT', 'LEFT', 'RIGHT', 'REAR', 'TOP', 'UNKNOWN']);

export const resolveLiveViewStatus = (event) => {
  const eventType = String(event?.event_type || event?.eventType || '');
  if (eventType.startsWith('PERSON') || eventType === 'NO_FACE_CAPTURED') {
    const value = event.human_orientation || event.metadata?.humanOrientation;
    const orientation = String(value || 'UNKNOWN').trim().toUpperCase();
    const fields = [`Orientation: ${HUMAN_ORIENTATIONS.has(orientation) ? orientation : 'UNKNOWN'}`];
    const trackId = event.metadata?.trackId || event.track_id;
    if (trackId != null && String(trackId).trim()) fields.push(`Track #${String(trackId).trim()}`);
    const similarity = event.match_score ?? event.matchScore ?? event.metadata?.bestScore;
    if (similarity != null && Number.isFinite(Number(similarity))) fields.push(`${(Number(similarity) * 100).toFixed(1)}% similarity`);
    return fields.join(' | ');
  }
  if (eventType.startsWith('VEHICLE')) {
    const value = event.vehicle_angle || event.metadata?.vehicleAngle;
    const angle = String(value || 'UNKNOWN').trim().toUpperCase();
    return `Angle: ${VEHICLE_ANGLES.has(angle) ? angle : 'UNKNOWN'}`;
  }
  return null;
};
