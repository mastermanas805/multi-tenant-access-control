import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';
import { type UpstreamName } from '../domain/upstream';
import { type UpstreamRegistry } from '../domain/upstream-registry.port';

/**
 * Config-backed upstream registry (DESIGN §4.1). Maps each logical upstream to its
 * base URL from the typed ConfigService — nothing is hardcoded; the compose
 * topology supplies IDENTITY_URL / AUTHZ_ADMIN_URL / EXPENSE_URL.
 */
@Injectable()
export class ConfigUpstreamRegistry implements UpstreamRegistry {
  constructor(private readonly config: ConfigService) {}

  public baseUrl(upstream: UpstreamName): string {
    switch (upstream) {
      case 'identity':
        return this.config.values.IDENTITY_URL;
      case 'authz-admin':
        return this.config.values.AUTHZ_ADMIN_URL;
      case 'expense':
        return this.config.values.EXPENSE_URL;
    }
  }
}
