import test from 'node:test';
import assert from 'node:assert/strict';
import { getFaceReviewMedia } from '../src/utils/faceReviewMedia.js';
import { crossingToReviewFace, formatCrossingTime, recentCrossingHref } from '../src/utils/crossingView.js';

test('no-face review shows reason placeholder and never uses body or frame media', () => {
  const review = getFaceReviewMedia({
    personType: 'NO_FACE_CAPTURED',
    faceReason: 'FACE_TURNED_AWAY',
    bodyMediaKey: 'body-key',
    frameMediaKey: 'frame-key',
  });
  assert.equal(review.mediaKey, null);
  assert.match(review.placeholder, /looking down/);
});

test('face slot uses only passport media even when body and frame are present', () => {
  const review = getFaceReviewMedia({
    facePassportMediaKey: 'passport-key',
    bodyMediaKey: 'body-key',
    frameMediaKey: 'frame-key',
  });
  assert.equal(review.mediaKey, 'passport-key');
});

test('recent crossing links to its filtered review row and opens as detail data', () => {
  const crossing = { id: 'crossing/9', decision: 'UNKNOWN', detected_at: '2026-11-16T10:00:00.000Z', camera_id: 'CAM-02', direction: 'IN', photo_url: '/api/media/abc', photo_source: 'CAPTURE', frame_url: '/api/media/frame', body_url: '/api/media/body' };
  const row = crossingToReviewFace(crossing);
  assert.equal(recentCrossingHref(crossing), '/unknown-faces?crossing=crossing%2F9');
  assert.equal(row.photo_url, crossing.photo_url);
  assert.equal(row.frameMediaKey, crossing.frame_url);
  assert.equal(row.bodyMediaKey, crossing.body_url);
  assert.equal(row.isCrossingRecord, true);
  assert.match(formatCrossingTime(crossing.detected_at), /16 Nov 2026/);
});
