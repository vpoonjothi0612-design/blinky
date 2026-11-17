import { faceCrossingModeEnabled, fetchCrossings, getCrossingById, getCrossingSummary } from "./crossing.service.js";

const requireMode = (res) => {
  if (faceCrossingModeEnabled()) return false;
  res.status(404).json({ success: false, message: "Face crossing mode is disabled" });
  return true;
};

export const listCrossings = async (req, res, next) => {
  if (requireMode(res)) return;
  try {
    const result = await fetchCrossings(req.query);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
};

export const crossingSummary = async (req, res, next) => {
  if (requireMode(res)) return;
  try {
    res.json({ success: true, data: await getCrossingSummary({ limit: req.query.limit }) });
  } catch (error) { next(error); }
};

export const crossingDetail = async (req, res, next) => {
  if (requireMode(res)) return;
  try {
    const crossing = await getCrossingById(req.params.id);
    if (!crossing) return res.status(404).json({ success: false, message: "Crossing not found" });
    return res.json({ success: true, data: crossing });
  } catch (error) { next(error); }
};
