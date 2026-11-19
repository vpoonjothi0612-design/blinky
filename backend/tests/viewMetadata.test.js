import test from 'node:test';
import assert from 'node:assert/strict';
import { mapViewMetadata } from '../src/modules/event/view-metadata.js';
import { mapCrossing } from '../src/modules/crossing/crossing.service.js';

test('view metadata defaults to unverified and excludes backside human captures', () => {
  const metadata = mapViewMetadata({
    humanOrientation: 'back',
    humanOrientationConfidence: 0.9,
    humanAngleImages: { BACK: 'back.jpg', LEFT: 'left.jpg', UNKNOWN: 'unknown.jpg' },
    vehicleAngle: 'unverified',
    vehicleAngleImages: { FRONT: 'front.jpg', TOP: 'top.jpg', invalid: 'invalid.jpg' },
  });

  assert.equal(metadata.human_orientation, 'BACK');
  assert.deepEqual(metadata.human_angle_images, { LEFT: 'left.jpg' });
  assert.equal(metadata.human_orientation_confidence, 0.9);
  assert.equal(metadata.vehicle_angle, 'UNKNOWN');
  assert.equal(metadata.vehicle_angle_confidence, null);
  assert.deepEqual(metadata.vehicle_angle_images, { FRONT: 'front.jpg' });

  const empty = mapViewMetadata();
  assert.equal(empty.human_orientation, 'UNKNOWN');
  assert.equal(empty.human_orientation_confidence, null);
  assert.equal(empty.vehicle_angle, 'UNKNOWN');
  assert.deepEqual(empty.vehicle_angle_images, {});
});

test('crossing output carries normalized view metadata', () => {
  const crossing = mapCrossing({
    id: 'crossing-1',
    cameraId: 'CAM-02',
    direction: 'IN',
    eventType: 'PERSON_UNKNOWN_IN',
    timestamp: '2026-11-18T10:00:00Z',
    metadata: {
      humanOrientation: 'left',
      humanOrientationConfidence: 0.81,
      humanAngleImages: { LEFT: 'captures/left.jpg', BACK: 'captures/back.jpg' },
    },
  });

  assert.equal(crossing.human_orientation, 'LEFT');
  assert.equal(crossing.human_orientation_confidence, 0.81);
  assert.deepEqual(crossing.human_angle_images, { LEFT: 'captures/left.jpg' });
});

test('view metadata preserves supported profile and diagonal face orientations', () => {
  const metadata = mapViewMetadata({
    humanOrientation: 'right_profile',
    humanOrientationConfidence: 0.77,
    humanAngleImages: {
      FRONT_LEFT: 'captures/front-left.jpg',
      RIGHT_PROFILE: 'captures/right-profile.jpg',
      BACK: 'captures/back.jpg',
    },
  });

  assert.equal(metadata.human_orientation, 'RIGHT_PROFILE');
  assert.equal(metadata.human_orientation_confidence, 0.77);
  assert.deepEqual(metadata.human_angle_images, {
    FRONT_LEFT: 'captures/front-left.jpg',
    RIGHT_PROFILE: 'captures/right-profile.jpg',
  });
});
