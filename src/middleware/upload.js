const multer = require("multer");
const { ApiError } = require("../utils/api-error");

const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      cb(new ApiError(400, "Only JPEG, PNG, or WebP images are allowed.", {
        code: "INVALID_IMAGE_TYPE",
      }));
      return;
    }
    cb(null, true);
  },
});

const requireUploadedImage = (req, _res, next) => {
  if (!req.file) {
    next(new ApiError(400, "Image file is required.", { code: "IMAGE_REQUIRED" }));
    return;
  }
  next();
};

module.exports = { imageUpload, requireUploadedImage };
