import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCrossings, getCrossingSummary, mapCrossing } from '../src/modules/crossing/crossing.service.js';

test('crossing list scopes camera and limit and requests newest first', async () => {
  let query;
  const rows = [
    { id: 'new', cameraId: 'CAM-02', direction: 'IN', eventType: 'PERSON_IN', timestamp: '2026-11-16T10:00:02Z', createdAt: '2026-11-16T10:00:02Z', employeeId: null, metadata: {} },
    { id: 'old', cameraId: 'CAM-02', direction: 'IN', eventType: 'PERSON_UNKNOWN_IN', timestamp: '2026-11-16T10:00:01Z', createdAt: '2026-11-16T10:00:01Z', employeeId: null, metadata: {} },
  ];
  const EventModel = {
    async findAndCountAll(args) { query = args; return { rows, count: 2 }; },
  };
  const result = await fetchCrossings({ camera_id: 'CAM-02', limit: 2, sort: 'desc', EventModel });
  assert.deepEqual(result.rows.map((row) => row.id), ['new', 'old']);
  assert.equal(query.where.cameraId, 'CAM-02');
  assert.equal(query.limit, 2);
  assert.deepEqual(query.order, [['createdAt', 'DESC']]);
});

test('registered employee uses joined registry photo when present', () => {
  const row = mapCrossing({
    id: 'employee-crossing', cameraId: 'CAM-02', direction: 'IN', eventType: 'PERSON_IN',
    timestamp: '2026-11-16T10:00:00Z', employeeId: 'employee-1', metadata: {},
    employee: { id: 'employee-1', employeeCode: 'EMP701', firstName: 'Asha', lastName: 'Rao', faceEnrollment: { id: 'enrollment-1', photoUrl: 'enrollment/EMP701/registry.jpg' } },
  }, { enrollmentRoot: '/enrollment', fileExists: (filePath) => filePath === '/enrollment/EMP701/registry.jpg' });
  assert.equal(row.photo_source, 'REGISTRY');
  assert.equal(row.photo_url, '/employee-images/EMP701/registry.jpg');
  assert.equal(row.employee_name, 'Asha Rao');
});

test('unknown uses passport capture and no-face uses placeholder', () => {
  const unknown = mapCrossing({ id: 'unknown', cameraId: 'CAM-02', eventType: 'PERSON_UNKNOWN_IN', direction: 'IN', timestamp: '2026-11-16T10:00:00Z', metadata: { facePassportPath: 'captures/CAM-02/1/1/face_passport.jpg' } });
  assert.equal(unknown.decision, 'UNKNOWN');
  assert.equal(unknown.photo_source, 'CAPTURE');
  assert.equal(unknown.photo_url, unknown.face_passport_url);

  const noFace = mapCrossing({ id: 'no-face', cameraId: 'CAM-01', eventType: 'NO_FACE_CAPTURED', direction: 'OUT', timestamp: '2026-11-16T10:00:00Z', metadata: { bodyPath: 'captures/CAM-01/1/1/body.jpg', framePath: 'captures/CAM-01/1/1/frame.jpg', faceReason: 'FACE_TURNED_AWAY' } });
  assert.equal(noFace.decision, 'NO_FACE_CAPTURED');
  assert.equal(noFace.face_status, 'FACE_TURNED_AWAY');
  assert.equal(noFace.photo_source, 'PLACEHOLDER');
  assert.equal(noFace.photo_url, null);
});

test('summary keeps one result group for each camera', async () => {
  const seen = [];
  const EventModel = { async findAndCountAll(args) { seen.push(args.where.cameraId); return { rows: [], count: 0 }; } };
  const result = await getCrossingSummary({ EventModel });
  assert.deepEqual(seen, ['CAM-02', 'CAM-01']);
  assert.deepEqual(Object.keys(result), ['CAM-02', 'CAM-01']);
});
