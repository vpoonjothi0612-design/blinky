import {
  createShift,
  getAllShifts,
  getShiftById,
  updateShift,
  deleteShift,
} from "./shift.service.js";

export const create = async (req, res, next) => {
  try {
    const shift = await createShift(req.body);
    return res.status(201).json({
      success: true,
      message: "Shift created successfully",
      data: shift,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const shifts = await getAllShifts();
    return res.status(200).json({
      success: true,
      message: "Shifts retrieved successfully",
      data: shifts,
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const shift = await getShiftById(req.params.id);
    return res.status(200).json({
      success: true,
      message: "Shift retrieved successfully",
      data: shift,
    });
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const shift = await updateShift(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      message: "Shift updated successfully",
      data: shift,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    const result = await deleteShift(req.params.id);
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};
