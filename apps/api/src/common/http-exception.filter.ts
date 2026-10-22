import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** Formato de error uniforme y traducción de errores de Prisma sin filtrar detalles internos. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json({ statusCode: status, ...body });
  }

  private toResponse(e: unknown): { status: number; body: Record<string, unknown> } {
    if (e instanceof HttpException) {
      const r = e.getResponse();
      const body = typeof r === 'string' ? { message: r } : (r as Record<string, unknown>);
      return { status: e.getStatus(), body: { error: HttpStatus[e.getStatus()], ...body } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2025':
          return { status: 404, body: { error: 'NOT_FOUND', message: 'Recurso no encontrado', code: 'NOT_FOUND' } };
        case 'P2002':
          return { status: 409, body: { error: 'CONFLICT', message: 'Ya existe un registro con esos datos', code: 'DUPLICATE' } };
        case 'P2003':
          return { status: 404, body: { error: 'NOT_FOUND', message: 'Referencia no encontrada', code: 'NOT_FOUND' } };
      }
    }
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('cross-tenant reference') || msg.includes('row-level security')) {
      return { status: 404, body: { error: 'NOT_FOUND', message: 'Referencia no encontrada', code: 'NOT_FOUND' } };
    }
    return { status: 500, body: { error: 'INTERNAL_SERVER_ERROR', message: 'Error interno' } };
  }
}
