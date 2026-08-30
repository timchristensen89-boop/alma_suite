import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'Route not found'));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      message: error.message,
      details: error.details ?? null
    });
  }

  // A schema rejection is the caller's fault, not the server's. It used to fall
  // through to the 500 branch below, and because `message` on a ZodError is the
  // stringified issue array, a manager who left the name blank got a wall of
  // `{"code":"invalid_type","path":["name"]…}` on the count screen.
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path?.join('.') ?? '';
    return res.status(400).json({
      message: first ? `${field ? `${field}: ` : ''}${first.message}` : 'That request was not valid.',
      details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
    });
  }

  if (error instanceof Error) {
    return res.status(500).json({
      message: error.message
    });
  }

  return res.status(500).json({
    message: 'Unknown server error'
  });
}
