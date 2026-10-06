import type { NextConfig } from "next";

/**
 * `res.cloudinary.com` is allow-listed for `next/image` because uploaded hotel
 * logos and room galleries are served from Cloudinary. Any other remote host is a
 * bug, not a feature, so this stays narrow.
 *
 * Both `pathname` and `search` are pinned: the delivery path Cloudinary returns
 * is `/image/upload/...` under the cloud name, and the query string is part of
 * the generated address. A pattern that allowed `search: ""` would be stricter
 * than what Cloudinary actually produces and every image would be rejected.
 */
const CLOUDINARY_HOST = "res.cloudinary.com";

const nextConfig: NextConfig = {
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: CLOUDINARY_HOST,
				pathname: "/**",
			},
		],
	},
};

export default nextConfig;
