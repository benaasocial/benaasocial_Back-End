import cloudinary from "../configs/cloudinary";

type MediaDoc = {
  kind: "images" | "video";
  images?: Array<{
    kind: "image";
    url: string;
    publicId: string;
    width: number;
    height: number;
    format?: string;
  }>;
  video?: {
    kind: "video";
    url: string;
    publicId: string;
    duration: number;
    format: string;
  };
};

export const deletePostMediaFromCloudinary = async (
  media: MediaDoc
): Promise<void> => {
  if (!media) return;

  if (media.kind === "images" && media.images?.length) {
    await Promise.all(
      media.images.map((image) =>
        cloudinary.uploader.destroy(image.publicId, {
          resource_type: "image",
        })
      )
    );
  }

  if (media.kind === "video" && media.video?.publicId) {
    await cloudinary.uploader.destroy(media.video.publicId, {
      resource_type: "video",
    });
  }
};