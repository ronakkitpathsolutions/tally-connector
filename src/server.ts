import 'dotenv/config';
import express from 'express';
import { loadConfig } from './config';
import { buildRouter } from './routes';

const cfg = loadConfig(process.env);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(buildRouter(cfg));

app.listen(cfg.port, cfg.host, () => {
  console.log(`tally-connector listening on http://${cfg.host}:${cfg.port}`);
  console.log(`tally target: http://${cfg.tallyHost}:${cfg.tallyPort}`);
  console.log(`default company: ${cfg.defaultCompany}`);
});
