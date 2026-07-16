import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '../config/config.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

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
  checkReadiness() {
    return {
      status: 'ok',
      service: 'ipoint-api',
      timestamp: new Date().toISOString(),
      version: this.configService.appVersion,
      checks: {
        config: 'ok',
      },
    };
  }
}
