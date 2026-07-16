import { parseServerEnvironment } from '@ipoint/config';

const environment = parseServerEnvironment(process.env);

// Foundation shell startup log — P0-S3 will add proper logging
console.log(
  {
    status: 'ok',
    service: 'ipoint-api',
    version: environment.APP_VERSION,
    timestamp: new Date().toISOString(),
  },
  '[Foundation shell — awaiting P0-S3 backend]',
);
