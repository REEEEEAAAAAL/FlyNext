const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

export async function hashPassword(password) {
	return await bcrypt.hash(password, 10);
}

export function comparePassword(password, hash) {
	return bcrypt.compareSync(password, hash);
}

export function generateAccessToken(payload) {
	return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
		expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY_TIME,
	});
}

export function generateRefreshToken(payload) {
	return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
		expiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRY_TIME,
	});
}

export async function verifyToken(request) {
	const authorization = request.headers.get("authorization");
	if (!authorization || !authorization.startsWith("Bearer ")) {
		return null;
	}

	const token = authorization.replace("Bearer ", "");

	try {
		const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
		return payload;
	} catch (error) {
		return null;
	}
}