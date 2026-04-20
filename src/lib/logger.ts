import pino from 'pino';

const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    ...(process.env.NODE_ENV !== 'production' && {
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
        }
    }),
    base: { service: 'tablenow-api', env: process.env.NODE_ENV || 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
        err: pino.stdSerializers.err,
        req: (req) => ({ method: req.method, url: req.url, correlationId: req.headers?.['x-correlation-id'] }),
        res: (res) => ({ statusCode: res.statusCode })
    }
});

export default logger;
