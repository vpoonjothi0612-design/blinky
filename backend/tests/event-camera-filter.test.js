import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalActiveEventCameraIds } from '../src/modules/event/event.service.js';

test('active camera display labels map to event camera IDs', () => {
  assert.deepEqual(
    canonicalActiveEventCameraIds(['CAM-01 (Exit Gate • OUT)', 'CAM-02 Entry Gate', 'Spare Camera']),
    ['CAM-01', 'CAM-02'],
  );
});

test('generic camera labels do not filter out canonical event IDs', () => {
  assert.deepEqual(canonicalActiveEventCameraIds(['Main Entrance', 'Loading Bay']), []);
});
