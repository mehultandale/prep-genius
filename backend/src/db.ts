import mongoose from 'mongoose';

let connected = false;

export async function connectDb(): Promise<void> {
  if (connected) return;
  const { config } = await import('./config');
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  connected = true;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
