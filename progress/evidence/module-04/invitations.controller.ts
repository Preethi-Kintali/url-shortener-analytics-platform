import {
  Controller,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CurrentPrincipal } from '../../../api/src/auth/decorators/current-principal.decorator';
import { JwtAuthGuard } from '../../../api/src/auth/guards/jwt-auth.guard';
import { InvitationsService } from './invitations.service';

export class CreateInvitationDto {
  email!: string;
}

@Controller('teams/:teamId/invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @Param('teamId') teamId: string,
    @CurrentPrincipal() principalId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(teamId, principalId, dto?.email);
  }
}
