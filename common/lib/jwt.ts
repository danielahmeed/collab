import { sign, verify } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-key-change-in-production";

export interface AuthToken {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export const generateToken = (userId: string, username: string): string => {
  return sign({ userId, username }, JWT_SECRET, {
    expiresIn: "24h",
  });
};

export const verifyToken = (token: string): AuthToken | null => {
  try {
    const decoded = verify(token, JWT_SECRET) as AuthToken;
    return decoded;
  } catch {
    return null;
  }
};
