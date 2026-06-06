import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** HTTP request body for POST /v1/tenants/:id/suspend. */
export class SuspendTenantRequest {
  @ApiProperty({ example: 'Non-payment', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  public reason!: string;
}
