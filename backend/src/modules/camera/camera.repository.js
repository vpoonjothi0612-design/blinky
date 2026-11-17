import Camera from "./camera.model.js";

export const createCamera = async (data) => {
  return Camera.create(data);
};

export const findAllCameras = async () => {
  return Camera.findAll({
    order: [["createdAt", "DESC"]],
  });
};

export const findCameraById = async (id) => {
  return Camera.findByPk(id);
};

export const findCameraByName = async (name) => {
  return Camera.findOne({
    where: { name },
  });
};

export const findCameraByIp = async (ipAddress) => {
  return Camera.findOne({
    where: { ipAddress },
  });
};

export const updateCamera = async (camera, data) => {
  return camera.update(data);
};

export const deleteCamera = async (camera) => {
  return camera.destroy();
};
