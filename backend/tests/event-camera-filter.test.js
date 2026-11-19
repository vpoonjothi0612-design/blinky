import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalActiveEventCameraIds,
  formatEventResponse,
  normalizePlateStatus,
  resolvePlateStatus,
} from '../src/modules/event/event.service.js';

test('active camera display labels map to event camera IDs', () => {
  assert.deepEqual(
    canonicalActiveEventCameraIds(['CAM-01 (Exit Gate • OUT)', 'CAM-02 Entry Gate', 'Spare Camera']),
    ['CAM-01', 'CAM-02'],
  );
});

test('generic camera labels do not filter out canonical event IDs', () => {
  assert.deepEqual(canonicalActiveEventCameraIds(['Main Entrance', 'Loading Bay']), []);
});

test('pending plate evidence remains pending instead of being marked recognized', () => {
  const status = normalizePlateStatus('PENDING_VERIFICATION');
  assert.equal(status, 'pending_verification');
  assert.equal(resolvePlateStatus('MH12AB1234', 0.95, status), 'pending_verification');
});

test('recognized plate status requires a valid plate and existing confidence threshold', () => {
  assert.equal(resolvePlateStatus('MH12AB1234', 0.90, 'recognized'), 'recognized');
  assert.equal(resolvePlateStatus('MH12AB1234', 0.65, 'recognized'), 'low_confidence');
  assert.equal(resolvePlateStatus('NOTAPLATE', 0.99, 'recognized'), 'invalid_format');
  assert.equal(resolvePlateStatus(null, 0.99, 'recognized'), 'not_recognized');
  assert.equal(resolvePlateStatus('TN09BK1234', 0.99, 'recognized', 'TNO9BK1234'), 'pending_verification');
});

test('only confirmed recognized plates can expose registered vehicle ownership', () => {
  const registeredVehicle = {
    registration_number: 'MH12AB1234',
    owner: { employee_code: 'EMP001', name: 'Example Employee' },
  };
  const baseEvent = {
    eventType: 'VEHICLE_IN',
    plateText: 'MH12AB1234',
    metadata: {},
  };

  assert.equal(
    formatEventResponse({ ...baseEvent, plateStatus: 'pending_verification' }, registeredVehicle).registered_vehicle,
    null,
  );
  assert.deepEqual(
    formatEventResponse({ ...baseEvent, plateStatus: 'recognized' }, registeredVehicle).registered_vehicle,
    registeredVehicle,
  );
});
