import mongoose, { Schema, type Model } from 'mongoose';

export interface UserDoc {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const User: Model<UserDoc> =
  mongoose.models.User ?? mongoose.model<UserDoc>('User', UserSchema);
