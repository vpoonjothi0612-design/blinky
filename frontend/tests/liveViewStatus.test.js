import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLiveViewStatus } from '../src/utils/liveViewStatus.js';

test('live view status displays validated human orientation or UNKNOWN', () => {
  assert.equal(resolveLiveViewStatus({ event_type: 'PERSON_IN', human_orientation: 'left' }), 'Orientation: LEFT');
  assert.equal(resolveLiveViewStatus({ event_type: 'PERSON_UNKNOWN_IN', metadata: { humanOrientation: 'sideways' } }), 'Orientation: UNKNOWN');
  assert.equal(
    resolveLiveViewStatus({
      event_type: 'PERSON_IN',
      human_orientation: 'right_profile',
      match_score: 0.84,
      metadata: { trackId: '17' },
    }),
    'Orientation: RIGHT_PROFILE | Track #17 | 84.0% similarity',
  );
});

test('live view status displays validated vehicle angle and ignores unrelated events', () => {
  assert.equal(resolveLiveViewStatus({ eventType: 'VEHICLE_IN', vehicle_angle: 'rear' }), 'Angle: REAR');
  assert.equal(resolveLiveViewStatus({ event_type: 'ANIMAL_DETECTED' }), null);
});
