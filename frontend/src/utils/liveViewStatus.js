const HUMAN_ORIENTATIONS = new Set(['FRONT', 'LEFT', 'RIGHT', 'BACK', 'UNKNOWN']);
const VEHICLE_ANGLES = new Set(['FRONT', 'LEFT', 'RIGHT', 'REAR', 'TOP', 'UNKNOWN']);

export const resolveLiveViewStatus = (event) => {
  const eventType = String(event?.event_type || event?.eventType || '');
  if (eventType.startsWith('PERSON') || eventType === 'NO_FACE_CAPTURED') {
    const value = event.human_orientation || event.metadata?.humanOrientation;
    const orientation = String(value || 'UNKNOWN').trim().toUpperCase();
    return `Orientation: ${HUMAN_ORIENTATIONS.has(orientation) ? orientation : 'UNKNOWN'}`;
  }
  if (eventType.startsWith('VEHICLE')) {
    const value = event.vehicle_angle || event.metadata?.vehicleAngle;
    const angle = String(value || 'UNKNOWN').trim().toUpperCase();
    return `Angle: ${VEHICLE_ANGLES.has(angle) ? angle : 'UNKNOWN'}`;
  }
  return null;
};
