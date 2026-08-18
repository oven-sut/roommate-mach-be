import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Turns Prisma's error codes into the HTTP answers they actually mean.
 *
 * Without this a duplicate email or a missing row surfaces as a bare 500 with
 * the query in the body, which is both unhelpful to the app and more than a
 * client should be told.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`Invalid query: ${exception.message}`);
      return response
        .status(HttpStatus.BAD_REQUEST)
        .json({ statusCode: 400, message: 'Invalid request data' });
    }

    const { status, message } = this.translate(exception);
    // Only a code we could not translate is worth a log line; the rest are
    // ordinary client mistakes.
    if (status >= 500) this.logger.error(exception.message);
    return response.status(status).json({ statusCode: status, message });
  }

  private translate(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: `${this.fieldName(error)} is already in use`,
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Referenced record does not exist',
        };
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'A value is too long for its field',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    }
  }

  private fieldName(error: Prisma.PrismaClientKnownRequestError): string {
    const target = (error.meta as { target?: string | string[] })?.target;
    if (Array.isArray(target)) return target.join(', ');
    return target ?? 'That value';
  }
}
