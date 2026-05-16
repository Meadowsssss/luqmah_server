const { v2: cloudinary } = require("cloudinary");
const { Readable } = require("stream");
const { env } = require("../config/env");

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

const uploadImageBuffer = ({ buffer, folder, transformation }) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        ...(transformation ? { transformation } : {}),
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    Readable.from(buffer).pipe(stream);
  });
};

module.exports = { uploadImageBuffer };
