import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  createLedgerEntrySchema,
  paginationQuerySchema,
} from './wallet.dto.js';
import type { CreateLedgerEntryDto, PaginationQueryDto } from './wallet.dto.js';
import { WalletService } from './wallet.service.js';
import { WalletError } from './wallet.types.js';
import type {
  WalletAccountResponse,
  WalletEntryResponse,
  PaginatedWalletEntriesResponse,
} from './wallet.types.js';

@ApiTags('Wallet')
@Controller('wallets')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class WalletController {
  constructor(
    @Inject(WalletService) private readonly walletService: WalletService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List member wallets',
    description: 'Returns all wallets for the authenticated member.',
  })
  @ApiResponse({ status: 200, description: 'Wallets returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getWallets(
    @CurrentActor() actor: RequestActor,
  ): Promise<WalletAccountResponse[]> {
    try {
      return await this.walletService.getWallets(actor.accountId);
    } catch (e) {
      if (e instanceof WalletError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get wallet detail',
    description: 'Returns wallet details with balance for the given wallet ID.',
  })
  @ApiResponse({ status: 200, description: 'Wallet returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  async getWallet(
    @CurrentActor() actor: RequestActor,
    @Param('id') id: string,
  ): Promise<WalletAccountResponse> {
    try {
      return await this.walletService.getWallet(actor.accountId, id);
    } catch (e) {
      if (e instanceof WalletError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Post()
  @ApiOperation({
    summary: 'Create ledger entry',
    description:
      'Creates an immutable ledger entry. This is the ONLY way to change a wallet balance. Idempotent via idempotencyKey.',
  })
  @ApiBody({ type: createLedgerEntrySchema })
  @ApiResponse({ status: 201, description: 'Ledger entry created.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createLedgerEntry(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createLedgerEntrySchema))
    body: CreateLedgerEntryDto,
  ): Promise<WalletEntryResponse> {
    try {
      return await this.walletService.createLedgerEntry({
        ...body,
        actorId: body.actorId ?? actor.accountId,
      });
    } catch (e) {
      if (e instanceof WalletError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Get(':id/entries')
  @ApiOperation({
    summary: 'Get wallet ledger entries',
    description: 'Returns paginated ledger history for the specified wallet.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (1-100, default 20).',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Page offset (default 0).',
  })
  @ApiResponse({ status: 200, description: 'Ledger entries returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  async getEntries(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: PaginationQueryDto,
  ): Promise<PaginatedWalletEntriesResponse> {
    try {
      return await this.walletService.getEntries(id, query);
    } catch (e) {
      if (e instanceof WalletError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Get(':id/entries/:entryId')
  @ApiOperation({
    summary: 'Get single ledger entry',
    description: 'Returns a single ledger entry by ID.',
  })
  @ApiResponse({ status: 200, description: 'Entry returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Entry not found.' })
  async getEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ): Promise<WalletEntryResponse> {
    try {
      return await this.walletService.getEntry(id, entryId);
    } catch (e) {
      if (e instanceof WalletError) {
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }
  }
}
