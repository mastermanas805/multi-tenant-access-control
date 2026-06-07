import { Inject, Injectable } from '@nestjs/common';

import { PageQuery } from '@kernel/core';

import {
  type AuditEventRepository,
  AUDIT_EVENT_REPOSITORY,
} from '../../domain/audit-event.repository.port';
import { type ListAuditEventsQuery } from '../dto/audit-event.commands';
import { type AuditEventPageView, toAuditEventPageView } from '../dto/audit-event.view';

/**
 * Cursor-paginated listing of audit events for the explainer/decision-log UI
 * (DESIGN §11 "decision-explainer"). Filterable by tenant; newest first.
 */
@Injectable()
export class ListAuditEventsUseCase {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly events: AuditEventRepository) {}

  public async execute(query: ListAuditEventsQuery): Promise<AuditEventPageView> {
    const page = PageQuery.from({ limit: query.limit, cursor: query.cursor });
    const result = await this.events.list({
      limit: page.limit,
      cursor: page.cursor,
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    });
    return toAuditEventPageView(result);
  }
}
