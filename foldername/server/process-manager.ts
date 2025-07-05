import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { storage } from './storage';
import fs from 'fs/promises';
import path from 'path';
import { snapshotScript, restoreSpecificSnapshot, getSnapshotInfo } from '../rollbackManager.js';

const execAsync = promisify(exec);

export interface ProcessResult {
  success: boolean;
  processId?: number;
  message: string;
  error?: string;
}

export class ProcessManager {
  private scraperDir = './scrapers';

  constructor() {
    this.initializeScraperDirectory();
  }

  private async initializeScraperDirectory() {
    try {
      await fs.mkdir(this.scraperDir, { recursive: true });
      
      // Create platform directories and sample scrapers
      const platforms = ['craigslist', 'facebook', 'offerup', 'reddit'];
      
      for (const platform of platforms) {
        const platformDir = path.join(this.scraperDir, platform);
        await fs.mkdir(platformDir, { recursive: true });
        
        // Create a sample scraper file if it doesn't exist
        const scraperFile = path.join(platformDir, 'scraper.js');
        try {
          await fs.access(scraperFile);
        } catch {
          await this.createSampleScraper(scraperFile, platform);
        }
      }
    } catch (error) {
      console.error('Failed to initialize scraper directory:', error);
    }
  }

  private async createSampleScraper(filePath: string, platform: string) {
    const scraperTemplate = `#!/usr/bin/env node
/*
 * ${platform.charAt(0).toUpperCase() + platform.slice(1)} Scraper Bot
 * Version: 1.0.0
 * Generated: ${new Date().toISOString()}
 */

const { spawn } = require('child_process');
const axios = require('axios');

class ${platform.charAt(0).toUpperCase() + platform.slice(1)}Scraper {
  constructor(city, config = {}) {
    this.city = city;
    this.config = {
      maxPages: 10,
      delay: 1000,
      userAgent: 'Mozilla/5.0 (compatible; Bot/1.0)',
      ...config
    };
    this.isRunning = false;
    this.scrapedCount = 0;
  }

  async start() {
    console.log(\`Starting \${this.city} ${platform} scraper...\`);
    this.isRunning = true;
    
    try {
      while (this.isRunning) {
        await this.scrapeData();
        await this.delay(this.config.delay);
        
        // Simulate progress
        this.scrapedCount++;
        if (this.scrapedCount % 10 === 0) {
          await this.reportProgress();
        }
      }
    } catch (error) {
      console.error('Scraper error:', error);
      await this.reportError(error);
    }
  }

  async scrapeData() {
    // Simulate scraping with random success/failure
    const success = Math.random() > 0.1; // 90% success rate
    
    if (!success) {
      throw new Error('Failed to scrape data - connection timeout');
    }
    
    // Simulate API calls that use GPT tokens
    if (Math.random() > 0.7) {
      await this.processWithGPT();
    }
    
    console.log(\`Scraped item #\${this.scrapedCount} from \${this.city}\`);
  }

  async processWithGPT() {
    // Simulate GPT API call
    const tokensUsed = Math.floor(Math.random() * 500) + 100;
    const cost = tokensUsed * 0.00002; // Rough GPT-4 pricing
    
    // Report GPT usage back to command center
    try {
      await axios.post('http://localhost:5000/api/gpt-usage', {
        botId: process.env.BOT_ID,
        date: new Date().toISOString().split('T')[0],
        tokensUsed,
        cost,
        requestCount: 1
      });
    } catch (error) {
      console.error('Failed to report GPT usage:', error);
    }
  }

  async reportProgress() {
    try {
      await axios.patch(\`http://localhost:5000/api/bots/\${process.env.BOT_ID}\`, {
        dailyCount: this.scrapedCount,
        progress: Math.min(100, (this.scrapedCount / 100) * 100),
        lastRun: new Date()
      });
    } catch (error) {
      console.error('Failed to report progress:', error);
    }
  }

  async reportError(error) {
    try {
      await axios.post('http://localhost:5000/api/error-logs', {
        botId: process.env.BOT_ID,
        error: error.message,
        stackTrace: error.stack
      });
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    console.log(\`Stopping \${this.city} ${platform} scraper...\`);
    this.isRunning = false;
  }
}

// Handle command line arguments
const city = process.argv[2] || 'Miami';
const config = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const scraper = new ${platform.charAt(0).toUpperCase() + platform.slice(1)}Scraper(city, config);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  scraper.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  scraper.stop();
  process.exit(0);
});

// Start scraper
scraper.start().catch(console.error);
`;

    await fs.writeFile(filePath, scraperTemplate);
    await fs.chmod(filePath, '755'); // Make executable
  }

  async startBot(botId: number): Promise<ProcessResult> {
    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return { success: false, message: 'Bot not found' };
      }

      // Check if bot is already running
      if (bot.processId && await this.isProcessRunning(bot.processId)) {
        return { success: false, message: 'Bot is already running' };
      }

      const scraperPath = path.join(this.scraperDir, bot.platform, 'scraper.js');
      
      // Check if scraper file exists
      try {
        await fs.access(scraperPath);
      } catch {
        return { success: false, message: `Scraper file not found: ${scraperPath}` };
      }

      // Use PM2 to start the process
      const pm2Name = `${bot.city}-${bot.platform}-bot`;
      const command = `pm2 start ${scraperPath} --name "${pm2Name}" -- "${bot.city}" '${JSON.stringify(bot.config || {})}'`;
      
      // Set environment variable for bot ID
      process.env.BOT_ID = botId.toString();
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes('PM2')) {
        return { success: false, message: `Failed to start bot: ${stderr}` };
      }

      // Get process ID from PM2
      const processId = await this.getProcessIdByName(pm2Name);
      
      if (!processId) {
        return { success: false, message: 'Failed to get process ID' };
      }

      // Update bot status
      await storage.updateBotInstance(botId, {
        status: 'running',
        processId,
        lastRun: new Date()
      });

      await storage.createActivityLog({
        message: `${bot.name} started successfully`,
        type: 'info',
        botId
      });

      return { 
        success: true, 
        processId, 
        message: `Bot started with process ID ${processId}` 
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await storage.createErrorLog({
        botId,
        error: errorMessage,
        stackTrace: error instanceof Error ? error.stack || '' : ''
      });
      
      return { success: false, message: errorMessage, error: errorMessage };
    }
  }

  async stopBot(botId: number): Promise<ProcessResult> {
    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return { success: false, message: 'Bot not found' };
      }

      if (!bot.processId) {
        return { success: false, message: 'Bot is not running' };
      }

      const pm2Name = `${bot.city}-${bot.platform}-bot`;
      const command = `pm2 stop "${pm2Name}" && pm2 delete "${pm2Name}"`;
      
      await execAsync(command);

      // Update bot status
      await storage.updateBotInstance(botId, {
        status: 'stopped',
        processId: null
      });

      await storage.createActivityLog({
        message: `${bot.name} stopped`,
        type: 'warning',
        botId
      });

      return { success: true, message: 'Bot stopped successfully' };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage, error: errorMessage };
    }
  }

  async restartBot(botId: number): Promise<ProcessResult> {
    const stopResult = await this.stopBot(botId);
    if (!stopResult.success) {
      return stopResult;
    }

    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return await this.startBot(botId);
  }

  async rollbackBot(botId: number, version: string): Promise<ProcessResult> {
    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        return { success: false, message: 'Bot not found' };
      }

      // Stop the bot first if it's running
      if (bot.status === 'running' && bot.processId) {
        await this.stopBot(botId);
      }

      // Create snapshot of current version before rollback
      const scriptPath = path.join(this.scraperDir, bot.platform, 'scraper.js');
      const scriptBaseName = `${bot.platform}_${bot.city}`;
      
      // Take a snapshot of current version
      snapshotScript(scriptBaseName, scriptPath);

      // Perform rollback to specified version
      const rollbackSuccess = restoreSpecificSnapshot(scriptBaseName, version, scriptPath);
      
      if (!rollbackSuccess) {
        return {
          success: false,
          message: `Failed to rollback bot ${botId} to version ${version}`
        };
      }

      // Update bot record with new version info
      await storage.updateBotInstance(botId, {
        version: version,
        status: 'stopped',
        updatedAt: new Date()
      });

      // Log the rollback activity
      await storage.createActivityLog({
        message: `${bot.name} rolled back to version ${version}`,
        type: 'info',
        botId: botId
      });

      return {
        success: true,
        message: `Bot ${botId} successfully rolled back to version ${version}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to rollback bot ${botId}`,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getBotStatus(botId: number): Promise<{ status: string; processId?: number; isRunning: boolean }> {
    const bot = await storage.getBotInstance(botId);
    if (!bot) {
      return { status: 'not_found', isRunning: false };
    }

    if (!bot.processId) {
      return { status: bot.status, isRunning: false };
    }

    const isRunning = await this.isProcessRunning(bot.processId);
    
    // Update status if process is not running but marked as running
    if (!isRunning && bot.status === 'running') {
      await storage.updateBotInstance(botId, { 
        status: 'crashed',
        processId: null 
      });
      
      await storage.createActivityLog({
        message: `${bot.name} crashed unexpectedly`,
        type: 'error',
        botId
      });
    }

    return { 
      status: isRunning ? bot.status : 'crashed', 
      processId: bot.processId,
      isRunning 
    };
  }

  private async isProcessRunning(processId: number): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`pm2 list | grep ${processId}`);
      return stdout.includes('online');
    } catch {
      return false;
    }
  }

  private async getProcessIdByName(name: string): Promise<number | null> {
    try {
      const { stdout } = await execAsync(`pm2 jlist`);
      const processes = JSON.parse(stdout);
      const process = processes.find((p: any) => p.name === name);
      return process ? process.pid : null;
    } catch {
      return null;
    }
  }

  async getAllProcesses(): Promise<any[]> {
    try {
      const { stdout } = await execAsync('pm2 jlist');
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }
}

export const processManager = new ProcessManager();