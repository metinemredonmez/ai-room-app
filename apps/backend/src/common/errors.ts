import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { log } from './log.js';
import { reportError } from './monitoring.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public headers: Record<string, string> = {},
    /** Extra machine-readable fields for the error body (never internals). */
    public details: Record<string, unknown> = {},
  ) {
    super(message ?? code.replace(/_/g, ' '));
  }
}

export const notFound = () => new AppError(404, 'not_found', 'Kayıt bulunamadı');
export const unauthorized = (msg = 'Oturum geçersiz') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => new AppError(403, 'forbidden', msg);

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  426: 'update_required',
  429: 'rate_limited',
};

/** Parses untrusted input with a strict zod schema; failures become 400 validation_failed. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(body)'))];
    throw new AppError(400, 'validation_failed', `Geçersiz alanlar: ${fields.join(', ')}`);
  }
  return result.data;
}

// EXC-01: every failure becomes a generic, fail-closed JSON error; internals stay in the log.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    let status = 500;
    let code = 'internal';
    let message = 'Beklenmeyen bir hata oluştu';
    let headers: Record<string, string> = {};
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      ({ status, code, message, headers, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? 'internal' : 'bad_request');
      message = status === 413 ? 'Dosya çok büyük' : status === 404 ? 'Bulunamadı' : 'İstek reddedildi';
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'Dosya çok büyük';
    } else if ((exception as { type?: string })?.type === 'entity.parse.failed') {
      status = 400;
      code = 'bad_request';
      message = 'Geçersiz JSON';
    }

    if (status >= 500 && exception instanceof AppError) {
      log.warn('request_failed', { requestId: req.id, path: req.path, status, code });
    } else if (status >= 500) {
      log.error('unhandled_error', {
        requestId: req.id,
        path: req.path,
        error: exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception),
      });
      // The route pattern, not the path: ids in URLs stay out of the report.
      const route = (req as { route?: { path?: string } }).route?.path ?? 'unmatched';
      reportError(exception, { tags: { route: `${req.method} ${route}` }, requestId: req.id });
    }
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status).json({ error: { ...details, code, message } });
  }
}
