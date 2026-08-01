import {
  Controller,
  Get,
  Inject,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { RequestActor } from '../auth/auth.types.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';
import { RbacGuard, RequirePermission } from './rbac.guard.js';

const auditQuerySchema = z
  .object({
    entityType: z.string().trim().min(1).max(100),
    entityId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

type AuditQuery = z.infer<typeof auditQuerySchema>;

@Controller('admin/audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('audit.read')
  query(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId)
      throw new UnauthorizedException({ code: 'ADMIN_SESSION_REQUIRED' });
    return this.audit.queryEntity(actor.adminUserId, query);
  }
}
