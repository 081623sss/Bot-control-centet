import express from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from './auth-service';
import { storage } from './storage';
import { z } from 'zod';

const router = express.Router();

// Rate limiting for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { success: false, message: 'Too many authentication attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictAuthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 attempts per window
  message: { success: false, message: 'Too many verification attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper functions
function getClientIP(req: express.Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress || 
         req.ip || 
         'unknown';
}

function getUserAgent(req: express.Request): string {
  return req.headers['user-agent'] || 'Unknown';
}

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

const verifySchema = z.object({
  codeId: z.string().uuid('Invalid code ID'),
  code: z.string().length(6, 'Verification code must be 6 digits').regex(/^\d+$/, 'Code must contain only digits')
});

// POST /api/auth/login
// Step 1: Verify email and password, send 2FA code
router.post('/login', authLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input',
        errors: validation.error.errors
      });
    }

    const { email, password } = validation.data;
    const ip = getClientIP(req);
    const userAgent = getUserAgent(req);

    const result = await authService.verifyCredentials(email, password, ip, userAgent);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        codeId: result.codeId,
        expiresIn: result.expiresIn
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/verify
// Step 2: Verify 2FA code and create session
router.post('/verify', strictAuthLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const validation = verifySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input',
        errors: validation.error.errors
      });
    }

    const { codeId, code } = validation.data;
    const ip = getClientIP(req);

    const result = await authService.verify2FACode(codeId, code, ip);

    if (result.success) {
      // Set secure HTTP-only cookie
      res.cookie('sessionToken', result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      res.status(200).json({
        success: true,
        message: result.message,
        user: {
          id: result.user?.id,
          email: result.user?.email,
          name: result.user?.name,
          role: result.user?.role
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout
// Logout and destroy session
router.post('/logout', async (req: express.Request, res: express.Response) => {
  try {
    const sessionToken = req.cookies.sessionToken;
    
    if (sessionToken) {
      await authService.logout(sessionToken);
    }

    res.clearCookie('sessionToken');
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /api/auth/status
// Check authentication status
router.get('/status', async (req: express.Request, res: express.Response) => {
  try {
    const sessionToken = req.cookies.sessionToken;
    
    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
        authenticated: false
      });
    }

    const verification = await authService.verifySession(sessionToken);
    
    if (verification.valid) {
      res.status(200).json({
        success: true,
        message: 'Authenticated',
        authenticated: true,
        user: {
          id: verification.user?.id,
          email: verification.user?.email,
          name: verification.user?.name,
          role: verification.user?.role
        }
      });
    } else {
      res.clearCookie('sessionToken');
      res.status(401).json({
        success: false,
        message: verification.message || 'Invalid session',
        authenticated: false
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      authenticated: false
    });
  }
});

// Middleware to require authentication
export async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionToken = req.cookies.sessionToken;
    
    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const verification = await authService.verifySession(sessionToken);
    
    if (!verification.valid) {
      res.clearCookie('sessionToken');
      return res.status(401).json({
        success: false,
        message: verification.message || 'Invalid session'
      });
    }

    // Add user info to request
    (req as any).user = verification.user;
    (req as any).session = verification.session;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
}

// GET /api/auth/security/logs
// Get authentication logs (admin only)
router.get('/security/logs', requireAuth, async (req: express.Request, res: express.Response) => {
  try {
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const logs = await storage.getActivityLogs(50);
    
    res.status(200).json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Security logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch security logs'
    });
  }
});

// PUT /api/auth/security/password
// Change admin password (admin only)
router.put('/security/password', requireAuth, strictAuthLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    const result = await authService.changePassword(user.id, currentPassword, newPassword);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

// PUT /api/auth/security/whitelist
// Update IP whitelist (admin only)
router.put('/security/whitelist', requireAuth, async (req: express.Request, res: express.Response) => {
  try {
    const user = (req as any).user;
    
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const { ips } = req.body;
    
    if (!Array.isArray(ips)) {
      return res.status(400).json({
        success: false,
        message: 'IPs must be an array'
      });
    }

    const result = await authService.updateIPWhitelist(user.id, ips);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('IP whitelist update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update IP whitelist'
    });
  }
});

export default router;