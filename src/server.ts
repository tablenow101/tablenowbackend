import dotenv from 'dotenv';
import path from 'path';

// For PM2 production safety, explicitly resolve the .env path regardless of where the app is launched from
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Import routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import bookingRoutes from './routes/bookings';
import vapiRoutes from './routes/vapi';
import customersRoutes from './routes/customers';
import availabilityRoutes from './routes/availability';
import emailRoutes from './routes/email';
import calendarRoutes from './routes/calendar';
import settingsRoutes from './routes/settings';
import { checkAvailability } from './controllers/checkAvailability';
import { createReservation } from './controllers/createReservation';

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for express-rate-limit
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:5174',
    'https://tablenowfrontend.vercel.app',
    'https://www.tablenowfrontend.vercel.app',
    'https://app.tablenow.io'
].filter(Boolean); // Remove any undefined values

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, origin || allowedOrigins[0]);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan('combined'));

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/vapi', vapiRoutes);
app.use('/api', customersRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/settings', settingsRoutes);

// VAPI Webhook routes (top-level, no rate limiting)
app.post('/check-availability', checkAvailability);
app.post('/create-reservation', createReservation);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`🚀 TableNow Backend running on port ${PORT}`);
    console.log(`🌍 Public URL: ${process.env.BACKEND_URL}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
