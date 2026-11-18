import test from "node:test";
import assert from "node:assert/strict";
import { resolvePhotoLogMatch } from "../src/modules/attendance/photo-log-search.js";

test("photo log accepts only a single explicitly recognized employee", () => {
  assert.deepEqual(resolvePhotoLogMatch({
      facesDetected: 1,
      results: [{ status: "RECOGNIZED", employeeId: "EMP001", similarity: 0.87 }],
    }), {
      matched: true,
      employeeIdentifier: "EMP001",
      similarity: 0.87,
    });
});

for (const status of ["UNKNOWN", "AMBIGUOUS", "LOW_QUALITY"]) {
  test(`photo log does not identify a ${status} face`, () => {
    assert.equal(resolvePhotoLogMatch({
      facesDetected: 1,
      results: [{ status, employeeId: "EMP001" }],
    }).matched, false);
  });
}

test("photo log rejects images without exactly one face result", () => {
  assert.equal(resolvePhotoLogMatch({ facesDetected: 0, results: [] }).matched, false);
  assert.equal(resolvePhotoLogMatch({
      facesDetected: 2,
      results: [{ status: "RECOGNIZED", employeeId: "EMP001" }],
    }).matched, false);
});
