import { Injectable, Logger } from '@nestjs/common';

import { type Policy } from '../../domain/policy.entity';
import { type PolicyPublisher } from '../../application/ports/policy-publisher.port';

/**
 * No-op PolicyPublisher used when `CERBOS_PUBLISH_ENABLED` is false (DESIGN
 * integration toggle). The publish/activate/rollback use-cases run their full
 * application logic without touching the filesystem — so unit/e2e suites need no
 * disk and no live PDP, while a production deployment binds the FS publisher.
 *
 * It still validates+compiles nothing here on purpose: the toggle is about the
 * SIDE EFFECT (the disk write), not the compile (the compile is exercised by its
 * own unit tests). It only logs so the disabled state is observable.
 */
@Injectable()
export class NoopPolicyPublisher implements PolicyPublisher {
  private readonly logger = new Logger(NoopPolicyPublisher.name);

  public publish(policy: Policy): Promise<void> {
    this.logger.debug(
      `Cerbos publishing disabled — skipped policy ${policy.id.toString()} (scope "${policy.scope.toString()}")`,
    );
    return Promise.resolve();
  }
}
