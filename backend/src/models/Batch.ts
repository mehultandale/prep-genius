import mongoose, { Schema } from 'mongoose';

export interface BatchDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  total: number;
  completed: number;
  failed: number;
  status: 'running' | 'done';
  createdAt: Date;
}

const BatchSchema = new Schema<BatchDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    total: { type: Number, required: true },
    completed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'done'], default: 'running' },
  },
  { timestamps: true }
);

export const Batch: mongoose.Model<BatchDoc> =
  (mongoose.models.Batch as mongoose.Model<BatchDoc>) ?? mongoose.model<BatchDoc>('Batch', BatchSchema);
