import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RedisClientService } from '../redis/redis.client.js';

const DEPENDENCY_CHECK_TIMEOUT_MS = 3_000;

/**
 * P8-S7 readiness dependency checks (contract G-07 / O-7 bounded extension).
 *
 * Readiness reports per-check status for configuration, PostgreSQL and Redis
 * (when configured) WITHOUT leaking connection strings or credentials — the
 * check values are fixed strings (`ok` / `unavailable`). The overall
 * `status` field is the probe's source of truth: `ok` only when every
 * configured dependency passes, otherwise `degraded` (the HTTP status stays
 * 200 so existing consumers keep working; orchestrators map `degraded` to
 * not-ready). A hung dependency cannot block readiness: every check is
 * bounded by DEPENDENCY_CHECK_TIMEOUT_MS.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(RedisClientService)
    private readonly redisClientService: RedisClientService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  checkLiveness() {
    return {
      status: 'ok',
      service: 'ipoint-api',
      timestamp: new Date().toISOString(),
      version: this.configService.appVersion,
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async checkReadiness() {
    const checks: Record<string, string> = { config: 'ok' };
    let status = 'ok';

    checks.database = (await this.databaseHealthy()) ? 'ok' : 'unavailable';
    if (checks.database !== 'ok') status = 'degraded';

    checks.redis = (await this.redisHealthy()) ? 'ok' : 'unavailable';
    if (checks.redis !== 'ok') status = 'degraded';

    return {
      status,
      service: 'ipoint-api',
      timestamp: new Date().toISOString(),
      version: this.configService.appVersion,
      checks,
    };
  }

  private async databaseHealthy(): Promise<boolean> {
    return this.withTimeout(async () => {
      await this.databaseService.pool.query('SELECT 1');
      return true;
    });
  }

  private async redisHealthy(): Promise<boolean> {
    return this.withTimeout(async () => this.redisClientService.isAvailable());
  }

  private async withTimeout(check: () => Promise<boolean>): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        check().catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), DEPENDENCY_CHECK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
