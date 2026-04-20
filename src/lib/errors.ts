export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: unknown) {
        super(400, 'VALIDATION_ERROR', message, details);
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string) {
        super(404, 'NOT_FOUND', `${resource} not found`);
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(409, 'CONFLICT', message);
        this.name = 'ConflictError';
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(401, 'UNAUTHORIZED', message);
        this.name = 'UnauthorizedError';
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, details?: unknown) {
        super(500, 'DATABASE_ERROR', message, details);
        this.name = 'DatabaseError';
    }
}
