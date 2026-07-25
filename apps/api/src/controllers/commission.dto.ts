import { IsString, IsOptional, IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LedgerQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() market?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsInt() @Min(1) limit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsInt() @Min(0) offset?: string;
}

export class AdminLedgerSearchDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() beneficiaryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() market?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsInt() @Min(1) limit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsInt() @Min(0) offset?: string;
}

export class ReprocessDto {
  @ApiProperty() @IsString() sourceType!: string;
  @ApiProperty() @IsString() sourceReference!: string;
}

export class CreateAdjustmentDto {
  @ApiProperty() @IsUUID() beneficiaryId!: string;
  @ApiProperty() @IsString() amount!: string;
  @ApiProperty() @IsString() market!: string;
  @ApiProperty() @IsString() currency!: string;
  @ApiProperty() @IsString() reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() auditReference?: string;
}

export class RejectAdjustmentDto {
  @ApiProperty() @IsString() reason!: string;
}

export class CreateRateDto {
  @ApiProperty() @IsString() commissionType!: string;
  @ApiProperty() @IsInt() @Min(0) generation!: number;
  @ApiProperty() @IsString() market!: string;
  @ApiProperty() @IsString() rateValue!: string;
  @ApiProperty() @IsString() rateType!: string;
  @ApiProperty() @IsString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() effectiveUntil?: string;
}

export class RateQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() market?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() commissionType?: string;
}
