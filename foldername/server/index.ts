import express, { type Request, Response, NextFunction } from "express";
import cookieSession from "cookie-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { authRoutes } from "../routes/authRoutes";
import { addSecurityHeaders, authLogger, protectDashboard } from "../middleware/authMiddleware";
import advancedRoutes from "./advanced-routes";
import leadTablesRoutes from "./lead-tables-routes";
import botEditorRoutes from "./simple-bot-editor-routes";
import ngrokRoutes from "./ngrok-routes";
import craigslistBotRoutes from "./craigslist-bot-routes";
import { readBotFile, saveBotFile, createBotFile, listBotFiles } from "./bot-handlers";
import { ngrokService } from "./ngrok-service";

const app = express();

// Public ngrok status endpoint (no auth or middleware required)
app.get('/api/public/ngrok-status', (req, res) => {
  try {
    const status = ngrokService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error getting ngrok status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ngrok status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Development seed route (bypasses all middleware)
if (process.env.NODE_ENV === 'development') {
  app.post('/api/dev-seed', express.json(), async (req: Request, res: Response) => {
    try {
      const { seedDatabase } = await import('./seed-data');
      const result = await seedDatabase();
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('Seed error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
}

// Trust proxy for correct IP detection
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // We'll handle this in our custom middleware
  hsts: false // We'll handle this in our custom middleware
}));

// Rate limiting for API requests
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many API requests. Please try again later.',
    code: 'RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// Custom security headers
app.use(addSecurityHeaders);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Session configuration with secure settings
app.use(cookieSession({
  name: 'bot-command-center-session',
  keys: [
    process.env.SESSION_SECRET_1 || 'secure-key-1-change-in-production',
    process.env.SESSION_SECRET_2 || 'secure-key-2-change-in-production'
  ],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
  sameSite: 'strict' // CSRF protection
}));

// Auth logging middleware
app.use(authLogger);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});



// Register authentication routes first
app.use('/api/auth', authRoutes);

// Register advanced features routes
app.use('/api', advancedRoutes);

// Register lead tables routes
app.use('/api/lead-tables', leadTablesRoutes);

// Register bot editor routes
app.use('/api', botEditorRoutes);

// Register ngrok routes
app.use('/api/ngrok', ngrokRoutes);

// Register craigslist bot routes
app.use('/api/craigslist-bot', craigslistBotRoutes);

// Register test routes (no auth for testing)
import testBotIntegration from './test-bot-integration';
app.use('/api/test', testBotIntegration);

// Register simple bot file handler routes (protected)
app.get('/api/bot/read', protectDashboard, readBotFile);
app.post('/api/bot/save', protectDashboard, express.json(), saveBotFile);
app.post('/api/bot/create', protectDashboard, express.json(), createBotFile);
app.get('/api/bot/list', protectDashboard, listBotFiles);

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
