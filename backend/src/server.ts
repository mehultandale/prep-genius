import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { config } from './config';
import { connectDb } from './db';
import authRouter from './routes/auth';
import kitsRouter from './routes/kits';
import { errorMiddleware } from './middleware/errors';
import { Kit } from './models/Kit';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/kits', kitsRouter);

app.use(errorMiddleware);

async function main() {
  await connectDb();
  app.listen(config.port, () => {
    console.log(`[prep-genius] API listening on http://localhost:${config.port}`);
  });

  // Janitor: every 10 minutes, mark jobs stuck in "generating" for > 20 min
  // as failed (covers crashed workers / lost mid-flight runs).
  cron.schedule('*/10 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 20 * 60 * 1000);
      const result = await Kit.updateMany(
        { status: 'generating', updatedAt: { $lt: cutoff } },
        {
          $set: {
            status: 'failed',
            phase: 'failed',
            error: { code: 'STALLED', message: 'Generation stalled and was reaped by the janitor' },
          },
        }
      );
      if (result.modifiedCount > 0) {
        console.log(`[prep-genius] janitor reaped ${result.modifiedCount} stalled generation(s)`);
      }
    } catch (err) {
      console.error('[prep-genius] janitor error', err);
    }
  });
}

main().catch((err) => {
  console.error('[prep-genius] fatal', err);
  process.exit(1);
});
