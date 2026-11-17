import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureDecision } from '../src/modules/face-enrollment/face-enrollment.controller.js';

test('UNKNOWN and CONFIRMED decisions require a passport face path', () => {
  assert.match(validateCaptureDecision('UNKNOWN', null), /face_passport_path is required/);
  assert.match(validateCaptureDecision('CONFIRMED', ''), /face_passport_path is required/);
  assert.equal(validateCaptureDecision('UNKNOWN', 'captures/CAM-02/t/1/face_passport.jpg'), null);
});

test('NO_FACE_CAPTURED is allowed without a face path', () => {
  assert.equal(validateCaptureDecision('NO_FACE_CAPTURED', null), null);
});
