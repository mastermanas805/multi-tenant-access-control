import { ApiProperty } from '@nestjs/swagger';

import { type ChainVerificationView } from '../../application/dto/audit-event.view';

/** Where the chain first broke, when invalid. */
export class ChainBreakResponse {
  @ApiProperty({ description: 'Chain position of the first broken record.' })
  public seq!: number;

  @ApiProperty({ description: 'Why the chain is broken at this record.' })
  public reason!: string;
}

/** Swagger-documented response for the integrity verification endpoint. */
export class ChainVerificationResponse {
  @ApiProperty({ description: 'True when the whole chain is intact from genesis to head.' })
  public valid!: boolean;

  @ApiProperty({ description: 'Number of records replayed.' })
  public count!: number;

  @ApiProperty({ description: 'The chain head hash (genesis hash when empty).' })
  public headHash!: string;

  @ApiProperty({ type: ChainBreakResponse, nullable: true })
  public brokenAt!: ChainBreakResponse | null;

  public static from(view: ChainVerificationView): ChainVerificationResponse {
    const res = new ChainVerificationResponse();
    res.valid = view.valid;
    res.count = view.count;
    res.headHash = view.headHash;
    res.brokenAt = view.brokenAt;
    return res;
  }
}
