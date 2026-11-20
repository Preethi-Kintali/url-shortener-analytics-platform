import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { redactSensitiveText, sanitizeRoutePath } from '../logging/redaction.util';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  computeLatencyMs,
  HttpResponseLike,
  RequestWithContext,
  resolveOrCreateRequestId,
} from '../middleware/request-id.util';

const PRISMA_UNAVAILABLE_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1011',
  'P1017',
  'P2024',
]);

export interface SafeErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
}

interface MappedError {
  statusCode: number;
  code: string;
  message: string;
  internalDetail?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithContext>();
    const res = ctx.getResponse<HttpResponseLike>();

    const requestId = resolveOrCreateRequestId(req, res);
    const route = sanitizeRoutePath(req.originalUrl || req.url);
    const mapped = this.mapException(exception);

    if (!res.locals) {
      res.locals = {};
    }
    res.locals.errorCode = mapped.code;

    const logPayload: Record<string, unknown> = {
      event: 'request_error',
      request_id: requestId,
      method: req.method,
      route,
      status_code: mapped.statusCode,
      latency_ms: computeLatencyMs(req.requestStartNs),
      error_code: mapped.code,
      error_name: exception instanceof Error ? exception.name : typeof exception,
      error_message: redactSensitiveText(mapped.internalDetail || mapped.message),
    };

    if (mapped.statusCode >= 500) {
      this.logger.error(logPayload, undefined, 'ExceptionsFilter');
    } else {
      this.logger.warn(logPayload, 'ExceptionsFilter');
    }

    // If RequestIdMiddleware did not run (e.g. body-parser JSON SyntaxError), also emit http_request log on finish.
    if (!req.requestLoggerAttached) {
      req.requestLoggerAttached = true;
      res.on('finish', () => {
        const payload = {
          event: 'http_request',
          request_id: requestId,
          method: req.method,
          route,
          status_code: res.statusCode,
          latency_ms: computeLatencyMs(req.requestStartNs),
          error_code: mapped.code,
        };
        if (res.statusCode >= 500) {
          this.logger.error(payload, undefined, 'HTTP');
        } else {
          this.logger.warn(payload, 'HTTP');
        }
      });
    }

    const body: SafeErrorEnvelope = {
      error: {
        code: mapped.code,
        message: mapped.message,
        request_id: requestId,
      },
    };

    res.status(mapped.statusCode).json(body);
  }

  mapException(exception: unknown): MappedError {
    // 1. Express body-parser malformed JSON errors
    if (this.isJsonSyntaxError(exception)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_JSON',
        message: 'Malformed JSON request body',
        internalDetail: exception.message,
      };
    }

    // 2. Prisma database errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'A resource with that unique identifier already exists',
          internalDetail: `Prisma ${exception.code}`,
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Requested resource was not found',
          internalDetail: `Prisma ${exception.code}`,
        };
      }
      if (exception.code === 'P2003') {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'VALIDATION_ERROR',
          message: 'Invalid resource reference',
          internalDetail: `Prisma ${exception.code}`,
        };
      }
      if (PRISMA_UNAVAILABLE_CODES.has(exception.code)) {
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable. Please try again later.',
          internalDetail: `Prisma ${exception.code}: ${exception.message}`,
        };
      }
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        internalDetail: `Prisma ${exception.code}: ${exception.message}`,
      };
    }

    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable. Please try again later.',
        internalDetail: exception.message,
      };
    }

    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        internalDetail: exception.message,
      };
    }

    // 3. NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const extracted = this.extractSafeHttpMessage(exception);

      if (exception instanceof BadRequestException && this.isWrappedJsonParseBadRequest(exception)) {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'INVALID_JSON',
          message: 'Malformed JSON request body',
          internalDetail: extracted || exception.message,
        };
      }

      if (exception instanceof BadRequestException || status === HttpStatus.BAD_REQUEST) {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'VALIDATION_ERROR',
          message: extracted || 'Validation failed',
        };
      }

      if (exception instanceof UnauthorizedException || status === HttpStatus.UNAUTHORIZED) {
        return {
          statusCode: HttpStatus.UNAUTHORIZED,
          code: 'UNAUTHORIZED',
          message: extracted || 'Authentication required',
        };
      }

      if (exception instanceof ForbiddenException || status === HttpStatus.FORBIDDEN) {
        return {
          statusCode: HttpStatus.FORBIDDEN,
          code: 'FORBIDDEN',
          message: 'Access denied',
        };
      }

      if (exception instanceof NotFoundException || status === HttpStatus.NOT_FOUND) {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Requested resource was not found',
        };
      }

      if (exception instanceof ConflictException || status === HttpStatus.CONFLICT) {
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: extracted || 'Resource conflict',
        };
      }

      if (exception instanceof ThrottlerException || status === HttpStatus.TOO_MANY_REQUESTS) {
        return {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
        };
      }

      if (
        exception instanceof ServiceUnavailableException ||
        status === HttpStatus.SERVICE_UNAVAILABLE
      ) {
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable',
        };
      }

      if (status >= 500) {
        return {
          statusCode: status,
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          internalDetail: extracted || exception.message,
        };
      }

      return {
        statusCode: status,
        code: 'CLIENT_ERROR',
        message: extracted || 'Request could not be processed',
      };
    }

    // 4. Network, DNS, and Timeout failure modes
    if (exception instanceof Error) {
      const msg = exception.message || '';
      const errCode = (exception as { code?: string }).code || '';

      if (
        errCode === 'ENOTFOUND' ||
        errCode === 'EAI_AGAIN' ||
        msg.includes('getaddrinfo') ||
        errCode === 'ECONNREFUSED' ||
        errCode === 'ECONNRESET' ||
        errCode === 'ETIMEDOUT'
      ) {
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'DEPENDENCY_UNAVAILABLE',
          message:
            'Upstream dependency or network resolution is temporarily unavailable. Please try again later.',
          internalDetail: `${errCode || 'NETWORK_ERROR'}: ${msg}`,
        };
      }

      if (
        exception.name === 'TimeoutError' ||
        exception.name === 'AbortError' ||
        msg.toLowerCase().includes('timeout')
      ) {
        return {
          statusCode: HttpStatus.GATEWAY_TIMEOUT,
          code: 'GATEWAY_TIMEOUT',
          message: 'Upstream operation timed out. Please try again later.',
          internalDetail: msg,
        };
      }
    }

    // 5. Unknown / unhandled errors
    const detail = exception instanceof Error ? exception.message : String(exception);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      internalDetail: detail,
    };
  }

  private isJsonSyntaxError(exception: unknown): exception is SyntaxError & { status?: number; type?: string } {
    if (!(exception instanceof SyntaxError)) {
      return false;
    }
    const candidate = exception as SyntaxError & { status?: number; statusCode?: number; type?: string };
    return (
      candidate.type === 'entity.parse.failed' ||
      candidate.status === HttpStatus.BAD_REQUEST ||
      candidate.statusCode === HttpStatus.BAD_REQUEST
    );
  }

  // NestJS RoutesResolver wraps Express body-parser SyntaxError into BadRequestException(err.message).
  private isWrappedJsonParseBadRequest(exception: BadRequestException): boolean {
    const response = exception.getResponse();
    if (typeof response !== 'object' || response === null) {
      return false;
    }
    const rawMsg = (response as Record<string, unknown>).message;
    if (typeof rawMsg !== 'string') {
      return false;
    }
    return (
      /\bin JSON at position\b/.test(rawMsg) ||
      rawMsg === 'Unexpected end of JSON input' ||
      /\bis not valid JSON\b/.test(rawMsg) ||
      rawMsg === 'strict violation' ||
      rawMsg.startsWith('Unexpected token ')
    );
  }

  private extractSafeHttpMessage(exception: HttpException): string {
    const response = exception.getResponse();
    let rawMessage: string;

    if (typeof response === 'string') {
      rawMessage = response;
    } else if (typeof response === 'object' && response !== null) {
      const msg = (response as Record<string, unknown>).message;
      if (Array.isArray(msg)) {
        rawMessage = msg.map((item) => String(item)).join('; ');
      } else if (typeof msg === 'string') {
        rawMessage = msg;
      } else {
        rawMessage = exception.message;
      }
    } else {
      rawMessage = exception.message;
    }

    return redactSensitiveText(rawMessage);
  }
}
