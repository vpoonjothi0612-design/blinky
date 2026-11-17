import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max file size
  },
});

/**
 * Flexible middleware that accepts an uploaded image from any field ("file", "image", "photo")
 * and sets req.file consistently for controllers.
 */
export const uploadSingleImage = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "File exceeds maximum allowed size of 15MB",
          },
        });
      }
      return next(err);
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

const videoUpload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB max video size
  },
});

/**
 * Flexible middleware that accepts an uploaded video from field ("file" or "video")
 * and sets req.file consistently for controllers.
 */
export const uploadSingleVideo = (req, res, next) => {
  videoUpload.any()(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          message: "File exceeds maximum allowed size of 250MB",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Video upload failed",
      });
    }
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

export default uploadSingleImage;

