import { Router } from 'express';
import { authHandlers } from '../middleware/auth';

const router = Router();

router.post('/register', authHandlers.register);
router.post('/login', authHandlers.login);
router.post('/logout', authHandlers.logout);
router.get('/me', authHandlers.me);

export default router;
