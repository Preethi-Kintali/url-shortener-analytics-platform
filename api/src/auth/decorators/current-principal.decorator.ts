import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth.types';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedPrincipal | undefined;

    if (!user || typeof user.principal_id !== 'string' || user.principal_id.trim() === '') {
      throw new UnauthorizedException('Authenticated principal not found');
    }

    return user.principal_id;
  },
);

