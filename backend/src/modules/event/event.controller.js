import {
  recordSurveillanceEvent,
  getSurveillanceEvents,
  getSurveillanceEventById,
  correctSurveillanceEventPlate,
} from "./event.service.js";

export const getEventsHandler = async (req, res, next) => {
  try {
    const result = await getSurveillanceEvents(req.query);
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      page: result.page,
      limit: result.limit,
      total: result.total,
      counts: result.counts,
    });
  } catch (error) {
    next(error);
  }
};

export const getEventByIdHandler = async (req, res, next) => {
  try {
    const event = await getSurveillanceEventById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.status(200).json({ success: true, data: event });
  } catch (error) { next(error); }
};

export const correctEventPlateHandler = async (req, res, next) => {
  try {
    const event = await correctSurveillanceEventPlate(req.params.id, req.body?.plate_text || req.body?.plateText);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.status(200).json({ success: true, message: "Plate correction saved", data: event });
  } catch (error) { next(error); }
};

export const createEventHandler = async (req, res, next) => {
  try {
    const event = await recordSurveillanceEvent(req.body);
    res.status(201).json({
      success: true,
      message: "Gate surveillance event recorded",
      data: event,
    });
  } catch (error) {
    next(error);
  }
};
