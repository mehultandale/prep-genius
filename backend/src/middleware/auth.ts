import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config';
import { User } from '../models/User';
import { AppError, asyncHandler } from './errors';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.sessionSecret, { expiresIn: '7d' });
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.token as string | undefined);
  if (!token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue'));
  }
  try {
    const payload = jwt.verify(token, config.sessionSecret) as { sub?: string };
    if (!payload.sub) throw new Error('bad payload');
    req.userId = payload.sub;
    return next();
  } catch {
    return next(
      new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.')
    );
  }
}

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const authHandlers = {
  register: asyncHandler(async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { email, password } = parsed.data;
    const existing = await User.findOne({ email });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    const token = signToken(String(user._id));
    res
      .cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 3600 * 1000,
      })
      .status(201)
      .json({ token, user: { id: String(user._id), email: user.email } });
  }),

  login: asyncHandler(async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { email, password } = parsed.data;
    const user = await User.findOne({ email });
    if (!user) throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password');
    const token = signToken(String(user._id));
    res
      .cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 3600 * 1000,
      })
      .json({ token, user: { id: String(user._id), email: user.email } });
  }),
  logout: asyncHandler(async (_req, res) => {
    res.clearCookie('token').json({ ok: true });
  }),

  me: asyncHandler(async (req: AuthedRequest, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session invalid');
    res.json({ user: { id: String(user._id), email: user.email } });
  }),
};
