const { uploadImageBuffer } = require("../lib/cloudinary");
const { ApiError } = require("../utils/api-error");

const productImageTransformation = [
  {
    width: 1000,
    height: 1000,
    crop: "pad",
    background: "#f8f3ea",
  },
];

const uploadToFolder = (folder, options = {}) => async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Image file is required.", { code: "IMAGE_REQUIRED" });
  }

  const result = await uploadImageBuffer({
    buffer: req.file.buffer,
    folder,
    transformation: options.transformation,
  });

  res.status(201).json({ imageUrl: result.secure_url });
};

const uploadMenuItemImage = uploadToFolder("luqmah/menu-items", {
  transformation: productImageTransformation,
});
const uploadRestaurantCover = uploadToFolder("luqmah/restaurant-covers");

module.exports = { uploadMenuItemImage, uploadRestaurantCover };
