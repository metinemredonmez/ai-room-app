import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { log } from './log.js';

export interface AuthContext {
  userId: string;
  role: Role;
  isGuest: boolean;
  admin: boolean; // true only for MFA-complete admin-audience tokens
  /** App tokens: the session (refresh family) the token belongs to (API.md §7.37); null for older tokens and admins. */
  sessionId?: string | null;
}

export type AppRequest = Request & { id: string; clientIp: string; auth?: AuthContext };

/**
 * NET-03: the socket peer is the only trusted source unless we explicitly sit behind N proxies;
 * then the client is the entry N positions from the right of X-Forwarded-For, never the first.
 */
export function resolveClientIp(req: Request, trustedHops: number): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (trustedHops <= 0) return peer;
  const chain = (req.headers['x-forwarded-for'] ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = chain.length - trustedHops;
  return idx >= 0 ? chain[idx] : peer;
}

export function requestContext(trustedHops: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = req as AppRequest;
    const incoming = req.headers['x-request-id'];
    r.id = typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    r.clientIp = resolveClientIp(req, trustedHops);
    res.setHeader('X-Request-Id', r.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      log.info('request', {
        requestId: r.id,
        method: req.method,
        path: req.path, // no query string: signed image URLs carry their signature there
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        userId: r.auth?.userId,
        ip: r.clientIp,
      });
    });
    next();
  };
}

export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>());

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('Auth decorator used on an unguarded route');
  return req.auth;
});

export function todayInIstanbul(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now);
}
