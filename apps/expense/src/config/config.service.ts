import { Injectable } from '@nestjs/common';

import { type AppConfig, loadConfig } from './config.schema';

/** DI token-free typed config. Inject `ConfigService` and read `.values`. */
@Injectable()
export class ConfigService {
  public readonly values: AppConfig;

  constructor() {
    this.values = loadConfig();
  }

  public get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }

  public get isTest(): boolean {
    return this.values.NODE_ENV === 'test';
  }
}
