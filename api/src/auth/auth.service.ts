import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedPrincipal, JwtPayload } from './auth.types';

export const JWT_TTL_SECONDS = 900; // 15 minutes

interface DevPrincipalRecord {
  principal_id: string;
  email: string;
  salt: string;
  passwordHashHex: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createDevPrincipal(
  principalId: string,
  email: string,
  password: string,
): DevPrincipalRecord {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    principal_id: principalId,
    email: email.toLowerCase(),
    salt,
    passwordHashHex: hashPassword(password, salt),
  };
}

// Development-only static user directory for Module 04 authentication & ownership drills.
// Replace with database-backed user accounts before production deployment.
const DEV_PRINCIPALS: DevPrincipalRecord[] = [
  createDevPrincipal('principal_a', 'alice@example.com', 'dev-alice-secret-01'),
  createDevPrincipal('principal_b', 'bob@example.com', 'dev-bob-secret-02'),
];

@Injectable()
export class AuthService {
  private readonly dummySalt = crypto.randomBytes(16).toString('hex');
  private readonly dummyHashHex = hashPassword('dummy-constant-time-pad', this.dummySalt);

  constructor(private readonly jwtService: JwtService) {}

  private verifyPassword(password: string, salt: string, expectedHex: string): boolean {
    const candidateHex = hashPassword(password, salt);
    const candidateBuf = Buffer.from(candidateHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (candidateBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(candidateBuf, expectedBuf);
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = DEV_PRINCIPALS.find((record) => record.email === normalizedEmail);

    // Always run scrypt + timingSafeEqual to mitigate user-enumeration timing leaks.
    const valid = user
      ? this.verifyPassword(dto.password, user.salt, user.passwordHashHex)
      : this.verifyPassword(dto.password, this.dummySalt, this.dummyHashHex) && false;

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = {
      sub: user.principal_id,
      principal_id: user.principal_id,
      email: user.email,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: JWT_TTL_SECONDS,
      principal_id: user.principal_id,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedPrincipal> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (
        !payload ||
        typeof payload.principal_id !== 'string' ||
        payload.principal_id.trim() === ''
      ) {
        throw new UnauthorizedException('Invalid authentication token payload');
      }

      return {
        principal_id: payload.principal_id,
        email: typeof payload.email === 'string' ? payload.email : '',
      };
    } catch {
      throw new UnauthorizedException('Missing or invalid authentication token');
    }
  }
}

