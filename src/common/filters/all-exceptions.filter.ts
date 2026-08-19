import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = 500;
    let message: string | object = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      // Las HttpException de Nest (incl. las que arma ValidationPipe) ya
      // devuelven { statusCode, message, error } en getResponse(). Si acá
      // asignáramos ese objeto entero a `message`, quedaría doblemente
      // anidado (`errorResponse.message.message`) en vez del string/array
      // real que espera el resto de la API.
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const body = exceptionResponse as { message: string | string[] };
        message = body.message;
      } else {
        message = exceptionResponse;
      }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      ...(!isProduction && exception instanceof Error
        ? { stack: exception.stack }
        : {}),
    };

    this.logger.error(
      `[${request.method}] ${request.url} → ${status} | ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorResponse);
  }
}
