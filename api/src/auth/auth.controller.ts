import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from '../config/rate-limits';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: RATE_LIMITS.login_per_min, ttl: RATE_LIMIT_TTL_MS } })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}

