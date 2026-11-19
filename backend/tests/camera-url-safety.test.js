import test from "node:test";
import assert from "node:assert/strict";
import { createCameraSchema, updateCameraSchema } from "../src/modules/camera/camera.zod.js";

test("camera RTSP URLs cannot embed credentials", () => {
  const result = createCameraSchema.safeParse({
    name: "Entry",
    rtspUrl: "rtsp://user:secret@10.0.0.2:554/stream",
  });

  assert.equal(result.success, false);
  assert.ok(result.error.flatten().fieldErrors.rtspUrl);
});

test("camera RTSP URL without credentials remains valid for create and update", () => {
  const publicUrl = "rtsp://10.0.0.2:554/stream";

  assert.equal(createCameraSchema.safeParse({ name: "Entry", rtspUrl: publicUrl }).success, true);
  assert.equal(updateCameraSchema.safeParse({ rtspUrl: publicUrl }).success, true);
});
