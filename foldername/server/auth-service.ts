import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { storage } from './storage';
import { 
  type User, 
  type InsertUser, 
  type AuthSession, 
  type InsertAuthSession,
  type InsertActivityLog
} from '@shared/schema';

interface VerificationCode {
  code: string;
  email: string;
  ip: string;
  userAgent: string;
  expiresAt: Date;
  used: boolean;
}

interface LoginAttempt {
  count: number;
  lastAttempt: number;
}

interface AuthResult {
  success: boolean;
  message: string;
  code?: string;
  codeId?: string;
  expiresIn?: number;
  sessionToken?: string;
  user?: User;
}

interface SessionVerification {
  valid: boolean;
  message?: string;
  user?: User;
  session?: AuthSession;
}

export class AuthService {
  private adminEmail: string = 'admin@supersmartstealz.com';
  private verificationCodes: Map<string, VerificationCode> = new Map();
  private loginAttempts: Map<string, LoginAttempt> = new Map();
  private emailTransporter: any = null;

  // Configuration
  private maxLoginAttempts: number = 3;
  private lockoutDuration: number = 15 * 60 * 1000; // 15 minutes
  private codeExpiry: number = 5 * 60 * 1000; // 5 minutes
  private sessionExpiry: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initializeEmailTransporter();
    this.initializeAdminUser();
  }

  private initializeEmailTransporter(): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('Development mode: Email verification bypassed');
      return;
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailUser || !gmailPass) {
      console.warn('Gmail credentials not configured - email verification disabled');
      return;
    }

    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });
  }

  private async initializeAdminUser(): Promise<void> {
    try {
      const existingUser = await storage.getUserByEmail(this.adminEmail);
      if (!existingUser) {
        const hashedPassword = await bcrypt.hash('SuperSecureBot2024!', 12);
        const adminUser: InsertUser = {
          email: this.adminEmail,
          passwordHash: hashedPassword,
          role: 'admin',
          name: 'Super Smart Stealz Admin',
          company: 'Super Smart Stealz',
          isActive: true,
          whitelistedIPs: ['127.0.0.1', 'localhost', '::1'] // Allow localhost for development
        };
        
        await storage.createUser(adminUser);
        console.log('Admin user created successfully');
      }
    } catch (error) {
      console.error('Failed to initialize admin user:', error);
    }
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private checkLoginAttempts(ip: string): { allowed: boolean; remainingTime?: number } {
    const attempts = this.loginAttempts.get(ip);
    if (!attempts) return { allowed: true };

    const timeSinceLastAttempt = Date.now() - attempts.lastAttempt;
    if (attempts.count >= this.maxLoginAttempts) {
      if (timeSinceLastAttempt < this.lockoutDuration) {
        return {
          allowed: false,
          remainingTime: Math.ceil((this.lockoutDuration - timeSinceLastAttempt) / 1000)
        };
      } else {
        // Reset attempts after lockout period
        this.loginAttempts.delete(ip);
        return { allowed: true };
      }
    }

    return { allowed: true };
  }

  private recordLoginAttempt(ip: string, success: boolean): void {
    if (success) {
      this.loginAttempts.delete(ip);
      return;
    }

    const attempts = this.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    this.loginAttempts.set(ip, attempts);
  }

  private isIPWhitelisted(user: User, ip: string): boolean {
    if (!user.whitelistedIPs || user.whitelistedIPs.length === 0) return true;
    
    // Allow localhost variations in development
    const localhostIPs = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];
    if (process.env.NODE_ENV === 'development' && localhostIPs.includes(ip)) {
      return true;
    }

    return user.whitelistedIPs.includes(ip);
  }

  private async sendVerificationCode(email: string, code: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'development') {
      console.log(`Development mode - Verification code for ${email}: ${code}`);
      return true;
    }

    if (!this.emailTransporter) {
      console.error('Email transporter not configured');
      return false;
    }

    try {
      await this.emailTransporter.sendMail({
        from: process.env.GMAIL_USER,
        to: email,
        subject: 'Super Smart Stealz - Login Verification',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Super Smart Stealz Login Verification</h2>
            <p>Your verification code is:</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 3px; margin: 20px 0;">
              ${code}
            </div>
            <p>This code will expire in 5 minutes.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
          </div>
        `,
      });
      return true;
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return false;
    }
  }

  private async logActivity(userId: number, action: string, status: string, message: string, ip: string, userAgent?: string): Promise<void> {
    try {
      const log: InsertActivityLog = {
        userId,
        action,
        status,
        message,
        ipAddress: ip,
        userAgent: userAgent || 'Unknown'
      };
      await storage.createActivityLog(log);
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  // Step 1: Verify email and password, send 2FA code
  async verifyCredentials(email: string, password: string, ip: string, userAgent: string): Promise<AuthResult> {
    try {
      // Check login attempts
      const attemptCheck = this.checkLoginAttempts(ip);
      if (!attemptCheck.allowed) {
        return {
          success: false,
          message: `Too many login attempts. Try again in ${attemptCheck.remainingTime} seconds.`
        };
      }

      // Find user
      const user = await storage.getUserByEmail(email.toLowerCase());
      if (!user || !user.isActive) {
        this.recordLoginAttempt(ip, false);
        return {
          success: false,
          message: 'Invalid credentials'
        };
      }

      // Check password
      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        this.recordLoginAttempt(ip, false);
        await this.logActivity(user.id, 'login_attempt', 'error', 'Invalid password', ip, userAgent);
        return {
          success: false,
          message: 'Invalid credentials'
        };
      }

      // Check IP whitelist
      if (!this.isIPWhitelisted(user, ip)) {
        this.recordLoginAttempt(ip, false);
        await this.logActivity(user.id, 'login_attempt', 'error', `Unauthorized IP: ${ip}`, ip, userAgent);
        return {
          success: false,
          message: 'Access denied: IP not authorized'
        };
      }

      // Generate and send verification code
      const code = this.generateVerificationCode();
      const codeId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + this.codeExpiry);

      const verificationCode: VerificationCode = {
        code,
        email: user.email,
        ip,
        userAgent,
        expiresAt,
        used: false
      };

      this.verificationCodes.set(codeId, verificationCode);

      // Send email
      const emailSent = await this.sendVerificationCode(user.email, code);
      if (!emailSent && process.env.NODE_ENV !== 'development') {
        return {
          success: false,
          message: 'Failed to send verification code'
        };
      }

      await this.logActivity(user.id, 'login_step1', 'success', 'Credentials verified, 2FA sent', ip, userAgent);

      return {
        success: true,
        message: 'Verification code sent to your email',
        codeId,
        expiresIn: this.codeExpiry / 1000
      };

    } catch (error) {
      console.error('Error in verifyCredentials:', error);
      return {
        success: false,
        message: 'Authentication service error'
      };
    }
  }

  // Step 2: Verify 2FA code and create session
  async verify2FACode(codeId: string, inputCode: string, ip: string): Promise<AuthResult> {
    try {
      const verification = this.verificationCodes.get(codeId);
      if (!verification) {
        return {
          success: false,
          message: 'Invalid or expired verification code'
        };
      }

      // Check if code is expired
      if (new Date() > verification.expiresAt) {
        this.verificationCodes.delete(codeId);
        return {
          success: false,
          message: 'Verification code expired'
        };
      }

      // Check if code is already used
      if (verification.used) {
        return {
          success: false,
          message: 'Verification code already used'
        };
      }

      // Check IP consistency
      if (verification.ip !== ip) {
        return {
          success: false,
          message: 'Security error: IP mismatch'
        };
      }

      // Verify code
      if (verification.code !== inputCode) {
        return {
          success: false,
          message: 'Invalid verification code'
        };
      }

      // Mark code as used
      verification.used = true;
      this.verificationCodes.set(codeId, verification);

      // Get user
      const user = await storage.getUserByEmail(verification.email);
      if (!user || !user.isActive) {
        return {
          success: false,
          message: 'User not found or inactive'
        };
      }

      // Create session
      const sessionToken = this.generateSessionToken();
      const expiresAt = new Date(Date.now() + this.sessionExpiry);

      const session: InsertAuthSession = {
        userId: user.id,
        sessionToken,
        ipAddress: ip,
        userAgent: verification.userAgent,
        isActive: true,
        expiresAt
      };

      await storage.createAuthSession(session);

      // Record successful login
      this.recordLoginAttempt(ip, true);
      await this.logActivity(user.id, 'login_success', 'success', 'Successfully logged in', ip, verification.userAgent);

      // Clean up verification code
      this.verificationCodes.delete(codeId);

      return {
        success: true,
        message: 'Login successful',
        sessionToken,
        user
      };

    } catch (error) {
      console.error('Error in verify2FACode:', error);
      return {
        success: false,
        message: 'Authentication service error'
      };
    }
  }

  // Verify session token
  async verifySession(sessionToken: string): Promise<SessionVerification> {
    try {
      if (!sessionToken) {
        return { valid: false, message: 'No session token provided' };
      }

      const session = await storage.getAuthSession(sessionToken);
      if (!session) {
        return { valid: false, message: 'Invalid session token' };
      }

      if (!session.isActive) {
        return { valid: false, message: 'Session is inactive' };
      }

      if (new Date() > session.expiresAt) {
        await storage.updateAuthSession(sessionToken, { isActive: false });
        return { valid: false, message: 'Session expired' };
      }

      const user = await storage.getUser(session.userId);
      if (!user || !user.isActive) {
        await storage.updateAuthSession(sessionToken, { isActive: false });
        return { valid: false, message: 'User not found or inactive' };
      }

      return {
        valid: true,
        user,
        session
      };

    } catch (error) {
      console.error('Error in verifySession:', error);
      return { valid: false, message: 'Session verification error' };
    }
  }

  // Logout user
  async logout(sessionToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const sessionDeleted = await storage.deleteAuthSession(sessionToken);
      return {
        success: sessionDeleted,
        message: sessionDeleted ? 'Logged out successfully' : 'Session not found'
      };
    } catch (error) {
      console.error('Error in logout:', error);
      return {
        success: false,
        message: 'Logout error'
      };
    }
  }

  // Cleanup expired data
  async cleanupExpiredData(): Promise<void> {
    try {
      // Clean up expired sessions
      await storage.cleanupExpiredSessions();

      // Clean up expired verification codes
      const now = new Date();
      for (const [id, code] of this.verificationCodes.entries()) {
        if (now > code.expiresAt) {
          this.verificationCodes.delete(id);
        }
      }

      // Clean up old login attempts (older than 1 hour)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      for (const [ip, attempt] of this.loginAttempts.entries()) {
        if (attempt.lastAttempt < oneHourAgo) {
          this.loginAttempts.delete(ip);
        }
      }
    } catch (error) {
      console.error('Error in cleanupExpiredData:', error);
    }
  }

  // Change password
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!passwordValid) {
        return { success: false, message: 'Current password is incorrect' };
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 12);
      await storage.updateUser(userId, { passwordHash: hashedNewPassword });

      // Log password change
      await this.logActivity(userId, 'password_change', 'success', 'Password changed successfully', 'system');

      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      console.error('Error in changePassword:', error);
      return { success: false, message: 'Failed to change password' };
    }
  }

  // Update IP whitelist
  async updateIPWhitelist(userId: number, ips: string[]): Promise<{ success: boolean; message: string }> {
    try {
      await storage.updateUser(userId, { whitelistedIPs: ips });
      await this.logActivity(userId, 'ip_whitelist_update', 'success', `Updated IP whitelist: ${ips.join(', ')}`, 'system');
      return { success: true, message: 'IP whitelist updated successfully' };
    } catch (error) {
      console.error('Error in updateIPWhitelist:', error);
      return { success: false, message: 'Failed to update IP whitelist' };
    }
  }
}

export const authService = new AuthService();