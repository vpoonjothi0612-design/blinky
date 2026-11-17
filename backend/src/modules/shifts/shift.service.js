import Shift from "./shift.model.js";

export const createShift = async (data) => {
  const isCrossMidnight =
    data.isCrossMidnight !== undefined
      ? data.isCrossMidnight
      : data.startTime > data.endTime;

  return Shift.create({
    ...data,
    isCrossMidnight,
  });
};

export const getAllShifts = async () => {
  return Shift.findAll({ order: [["createdAt", "ASC"]] });
};

export const getShiftById = async (id) => {
  const shift = await Shift.findByPk(id);
  if (!shift) {
    const error = new Error("Shift not found");
    error.statusCode = 404;
    throw error;
  }
  return shift;
};

export const updateShift = async (id, data) => {
  const shift = await getShiftById(id);
  let isCrossMidnight = shift.isCrossMidnight;
  if (data.isCrossMidnight !== undefined) {
    isCrossMidnight = data.isCrossMidnight;
  } else if (data.startTime && data.endTime) {
    isCrossMidnight = data.startTime > data.endTime;
  }

  await shift.update({
    ...data,
    isCrossMidnight,
  });
  return shift;
};

export const deleteShift = async (id) => {
  const shift = await getShiftById(id);
  await shift.destroy();
  return { message: "Shift deleted successfully" };
};
