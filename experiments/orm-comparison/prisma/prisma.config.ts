import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations' },
  datasource: {
    url:
      process.env.PRISMA_POC_DATABASE_URL ??
      'postgresql://ipoint_poc:ipoint_poc@localhost:55431/ipoint_prisma_poc',
  },
});
