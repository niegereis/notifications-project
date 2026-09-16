import 'dotenv/config';

import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './data-source-options.js';

export default new DataSource({
  ...buildDataSourceOptions(process.env['DATABASE_URL'] ?? ''),
  // Resolve ao lado deste arquivo: `src/` quando o CLI roda em TypeScript,
  // `dist/` quando roda compilado.
  migrations: [`${import.meta.dirname}/migrations/*.{ts,js}`],
});
