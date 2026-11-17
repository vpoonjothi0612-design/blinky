import net from "node:net";
import {
  createCamera as createCameraRepository,
  findAllCameras,
  findCameraById,
  findCameraByName,
  findCameraByIp as findCameraByIpRepository,
  updateCamera as updateCameraRepository,
  deleteCamera as deleteCameraRepository,
} from "./camera.repository.js";

export const checkCameraReachability = (ip, port = 80, timeoutMs = 600) => {
  return new Promise((resolve) => {
    if (!ip) return resolve(false);
    const socket = net.createConnection({ host: ip, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
};

export const findCameraByIp = async (ipAddress) => {
  return findCameraByIpRepository(ipAddress);
};

export const createCamera = async (data) => {
  const existingName = await findCameraByName(data.name);

  if (existingName) {
    const error = new Error("Camera name already exists");
    error.statusCode = 409;
    throw error;
  }

  return createCameraRepository(data);
};

export const getAllCameras = async () => {
  return findAllCameras();
};

export const getCameraById = async (id) => {
  const camera = await findCameraById(id);

  if (!camera) {
    const error = new Error("Camera not found");
    error.statusCode = 404;
    throw error;
  }

  return camera;
};

export const updateCamera = async (id, data) => {
  const camera = await findCameraById(id);

  if (!camera) {
    const error = new Error("Camera not found");
    error.statusCode = 404;
    throw error;
  }

  if (data.name && data.name !== camera.name) {
    const existingName = await findCameraByName(data.name);

    if (existingName) {
      const error = new Error("Camera name already exists");
      error.statusCode = 409;
      throw error;
    }
  }

  return updateCameraRepository(camera, data);
};

export const deleteCamera = async (id) => {
  const camera = await findCameraById(id);

  if (!camera) {
    const error = new Error("Camera not found");
    error.statusCode = 404;
    throw error;
  }

  await deleteCameraRepository(camera);

  return true;
};
