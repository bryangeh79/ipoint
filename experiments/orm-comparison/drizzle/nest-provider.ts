import { ExperimentalOrmProvider } from '../shared/nest-provider.js';
import { DrizzleHarness } from './harness.js';

export const DRIZZLE_POC_PROVIDER = Symbol('DRIZZLE_POC_PROVIDER');

export class DrizzlePocProvider extends ExperimentalOrmProvider {
  constructor(connectionString: string) {
    super(new DrizzleHarness(connectionString));
  }
}
