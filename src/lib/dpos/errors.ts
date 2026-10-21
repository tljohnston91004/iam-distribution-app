import type { Prisma, PrismaClient } from "@prisma/client";

/** Any Prisma handle: the client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export class DposError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DposError";
  }
}

export function isDposError(e: unknown): e is DposError {
  return e instanceof DposError;
}

export function errorBody(e: unknown): { error: { code: string; message: string; details?: Record<string, unknown> } } {
  if (isDposError(e)) return { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } };
  return { error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : String(e) } };
}
