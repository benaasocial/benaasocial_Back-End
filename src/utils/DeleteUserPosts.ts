import Post from "../modules/posts/model";
import { deletePostMediaFromCloudinary } from "./DeleteFromCloudinary";


/**
 * Delete all posts for a specific user, including Cloudinary media.
 */
export const deleteUserPosts = async (userId: string): Promise<number> => {
  const posts = await Post.find({ user: userId });

  if (!posts.length) return 0;

  // delete all media first
  await Promise.all(
    posts.map((post) => deletePostMediaFromCloudinary(post.media))
  );

  // then delete posts from database
  const result = await Post.deleteMany({ user: userId });

  return result.deletedCount ?? 0;
};