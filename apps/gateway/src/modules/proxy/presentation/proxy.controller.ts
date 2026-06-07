import { All, Controller, Req, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Request, type Response } from 'express';

import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { ProxyRequestUseCase } from '../application/use-cases/proxy-request.use-case';

/** Express augments Request with `rawBody` when NestFactory `rawBody: true` is set. */
type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Catch-all reverse-proxy edge (DESIGN §4.1, §4.3). Every non-gateway-local path
 * (i.e. not /health, /docs, /.well-known) lands here. The route-aware JwtAuthGuard
 * runs first: it verifies the JWT for protected routes and sets `req.identity`,
 * or passes public/unknown routes through. The use-case then routes, mints +
 * injects the signed internal identity (stripping client-spoofed headers), and
 * forwards to the upstream — whose response (any status/body) is streamed back
 * verbatim so service §8.1 envelopes survive intact.
 *
 * Excluded from Swagger (it would shadow every path); the aggregated upstream
 * OpenAPI is surfaced separately at /docs via DocumentBuilder in main.ts.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
@Controller({ version: VERSION_NEUTRAL })
export class ProxyController {
  constructor(private readonly proxy: ProxyRequestUseCase) {}

  @All('*')
  public async handle(@Req() req: RequestWithRawBody, @Res() res: Response): Promise<void> {
    const result = await this.proxy.execute({
      path: req.path,
      queryString: this.queryString(req.originalUrl),
      method: req.method,
      headers: req.headers,
      body: req.rawBody,
      identity: req.identity ?? null,
    });

    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.status(result.status).send(result.body);
  }

  /** Extracts the raw query string (after the first `?`) from the original URL. */
  private queryString(originalUrl: string): string {
    const idx = originalUrl.indexOf('?');
    return idx >= 0 ? originalUrl.slice(idx + 1) : '';
  }
}
