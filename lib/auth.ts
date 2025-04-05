import jwt, { SignOptions, Secret } from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Type definitions
interface JwtPayload extends jwt.JwtPayload {
    userId?: string;
    email?: string;
    [key: string]: any;
}

export async function hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
}

export function generateAccessToken(payload: JwtPayload): string {
    if (!process.env.JWT_ACCESS_SECRET) {
        throw new Error("JWT_ACCESS_SECRET is not defined");
    }

    const options: SignOptions = {
        expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY_TIME || ("15m" as any),
    };

    return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as Secret, options);
}

export function generateRefreshToken(payload: JwtPayload): string {
    if (!process.env.JWT_REFRESH_SECRET) {
        throw new Error("JWT_REFRESH_SECRET is not defined");
    }

    const options: SignOptions = {
        expiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRY_TIME || ("7d" as any),
    };

    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as Secret, options);
}

export async function verifyToken(
    request: Request
): Promise<JwtPayload | null> {
    const authorization = request.headers.get("authorization");
    if (!authorization || !authorization.startsWith("Bearer ")) {
        return null;
    }

    const token = authorization.replace("Bearer ", "");

    if (!process.env.JWT_ACCESS_SECRET) {
        throw new Error("JWT_ACCESS_SECRET is not defined");
    }

    try {
        const payload = jwt.verify(
            token,
            process.env.JWT_ACCESS_SECRET as Secret
        ) as JwtPayload;
        return payload;
    } catch (error) {
        return null;
    }
}
