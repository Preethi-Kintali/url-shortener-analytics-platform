import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authorization header is required');
    }

    const [scheme, token, ...extra] = authHeader.trim().split(/\s+/);
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token || extra.length > 0) {
      throw new UnauthorizedException('Authorization header must use Bearer <token> format');
    }

    request.user = await this.authService.verifyAccessToken(token);
    return true;
  }
}

