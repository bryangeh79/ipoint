import { ExperimentalOrmProvider } from '../shared/nest-provider.js';
import { PrismaHarness } from './harness.js';

export const PRISMA_POC_PROVIDER = Symbol('PRISMA_POC_PROVIDER');

export class PrismaPocProvider extends ExperimentalOrmProvider {
  constructor(connectionString: string) {
    super(new PrismaHarness(connectionString));
  }
}
