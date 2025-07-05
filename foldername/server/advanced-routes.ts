import express from 'express';
import { db } from './db';
import { requireAuth } from './auth-routes';
import { 
  alerts, botFiles, gptPrompts, commandHistory, subscriptions,
  botInstances, autoLeads, realEstateLeads, petLeads, activityLogs,
  InsertAlert, InsertActivityLog, systemMetrics
} from '@shared/schema';
import { eq, desc, and, gte, count } from 'drizzle-orm';

// Termius server configuration
const TERMIUS_BASE_URL = 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

// Helper function to make authenticated Termius API calls
async function termiusRequest(endpoint: string, options: any = {}) {
  try {
    const response = await fetch(`${TERMIUS_BASE_URL}${endpoint}`, {
      method: 'GET',
      timeout: 5000,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Termius API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Termius API Error:', error.message);
    return { error: error.message, success: false };
  }
}

// Helper function to log activity
async function logActivity(userId: number, botId: number | null, action: string, status: string, message: string, ip: string) {
  try {
    await db.insert(activityLogs).values({
      userId,
      botId,
      action,
      status,
      message,
      ipAddress: ip,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// ================================
// GPT-POWERED FEATURES
// ================================

// GPT-powered Lead Enrichment
router.post('/enrich-lead', async (req, res) => {
  try {
    const { rawLeadData, vertical = 'auto' } = req.body;
    
    if (!rawLeadData) {
      return res.status(400).json({ success: false, message: 'Raw lead data is required' });
    }

    const { gptService } = await import('./gpt-service');
    const enrichmentResult = await gptService.enrichLead(rawLeadData, vertical);
    
    res.json({ 
      success: true, 
      enrichment: enrichmentResult,
      message: 'Lead enriched successfully'
    });
  } catch (error: any) {
    console.error('Lead enrichment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to enrich lead'
    });
  }
});

// GPT-powered Outreach Generation
router.post('/generate-outreach', async (req, res) => {
  try {
    const { leadData, vertical = 'auto' } = req.body;
    
    if (!leadData) {
      return res.status(400).json({ success: false, message: 'Lead data is required' });
    }

    const { gptService } = await import('./gpt-service');
    const outreachMessage = await gptService.generateOutreach(leadData, vertical);
    
    res.json({ 
      success: true, 
      outreach: outreachMessage,
      message: 'Outreach message generated successfully'
    });
  } catch (error: any) {
    console.error('Outreach generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to generate outreach'
    });
  }
});

// GPT-powered AOR Generation
router.post('/generate-aor', async (req, res) => {
  try {
    const { leadData, inventoryData, vertical = 'auto' } = req.body;
    
    if (!leadData || !inventoryData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Both lead data and inventory data are required'
      });
    }

    const { gptService } = await import('./gpt-service');
    const aorReport = await gptService.generateAOR(leadData, inventoryData, vertical);
    
    res.json({ 
      success: true, 
      aor: aorReport,
      message: 'AOR generated successfully'
    });
  } catch (error: any) {
    console.error('AOR generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to generate AOR'
    });
  }
});

// GPT-4 Code Editor
router.post('/generate-code', async (req, res) => {
  try {
    const { description, currentCode } = req.body;
    
    if (!description) {
      return res.status(400).json({ success: false, message: 'Code description is required' });
    }

    const { gptService } = await import('./gpt-service');
    const generatedCode = await gptService.generateCode(description, currentCode);
    
    res.json({ 
      success: true, 
      code: generatedCode,
      message: 'Code generated successfully'
    });
  } catch (error: any) {
    console.error('Code generation error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to generate code'
    });
  }
});

// Update GPT Prompts
router.post('/update-prompt', async (req, res) => {
  try {
    const { vertical, promptType, prompt } = req.body;
    
    if (!vertical || !promptType || !prompt) {
      return res.status(400).json({ 
        success: false, 
        message: 'Vertical, prompt type, and prompt content are required'
      });
    }

    const { gptService } = await import('./gpt-service');
    await gptService.updatePrompt(vertical, promptType, prompt, 1); // Admin user ID
    
    res.json({ 
      success: true, 
      message: 'Prompt updated successfully'
    });
  } catch (error: any) {
    console.error('Prompt update error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to update prompt'
    });
  }
});

// Get Current Prompts
router.get('/prompts/:vertical/:promptType', async (req, res) => {
  try {
    const { vertical, promptType } = req.params;
    
    const { gptService } = await import('./gpt-service');
    const prompt = await gptService.getPrompt(vertical, promptType);
    
    res.json({ 
      success: true, 
      prompt,
      vertical,
      promptType
    });
  } catch (error: any) {
    console.error('Get prompt error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get prompt'
    });
  }
});

// ================================
// HEALTH MONITOR ROUTES
// ================================

// Get comprehensive health overview
router.get('/health-overview', async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get active bots count
    const activeBots = await db.select({ count: count() })
      .from(botInstances)
      .where(eq(botInstances.status, 'running'));

    // Get failures in last 24 hours
    const failures = await db.select({ count: count() })
      .from(alerts)
      .where(and(
        eq(alerts.alertType, 'error'),
        gte(alerts.createdAt, last24Hours)
      ));

    // Get warnings/errors (real-time)
    const warnings = await db.select({ count: count() })
      .from(alerts)
      .where(and(
        eq(alerts.isResolved, false),
        eq(alerts.alertType, 'warning')
      ));

    // Get recent alerts for details
    const recentAlerts = await db.select()
      .from(alerts)
      .where(gte(alerts.createdAt, last24Hours))
      .orderBy(desc(alerts.createdAt))
      .limit(10);

    res.json({
      success: true,
      data: {
        activeBots: activeBots[0]?.count || 0,
        failures24h: failures[0]?.count || 0,
        warnings: warnings[0]?.count || 0,
        recentAlerts: recentAlerts
      }
    });

  } catch (error: any) {
    console.error('Health overview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// BOT MANAGEMENT ROUTES
// ================================

// Get all bots with enhanced details
router.get('/bots', async (req, res) => {
  try {
    const bots = await db.select().from(botInstances).orderBy(desc(botInstances.createdAt));
    
    // Get Termius status for each bot
    const botsWithStatus = await Promise.all(bots.map(async (bot) => {
      try {
        const termiusStatus = await termiusRequest(`/bot-status/${bot.name}`);
        return {
          ...bot,
          termiusStatus: termiusStatus.success ? termiusStatus.status : 'disconnected',
          lastError: termiusStatus.error || null
        };
      } catch (error) {
        return {
          ...bot,
          termiusStatus: 'disconnected',
          lastError: 'Failed to connect to Termius server'
        };
      }
    }));

    res.json({ success: true, data: botsWithStatus });
  } catch (error: any) {
    console.error('Bots fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start bot
router.post('/bots/:id/start', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const userId = (req as any).user.id;
    const bot = await db.select().from(botInstances).where(eq(botInstances.id, botId)).limit(1);
    
    if (!bot.length) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Call Termius API to start bot
    const result = await termiusRequest(`/bot-command`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'start',
        botName: bot[0].name,
        city: bot[0].city
      })
    });

    if (result.success) {
      // Update bot status in database
      await db.update(botInstances)
        .set({ 
          status: 'running',
          lastRun: new Date(),
          updatedAt: new Date()
        })
        .where(eq(botInstances.id, botId));

      // Log activity
      await logActivity(userId, botId, 'start_bot', 'success', `Started bot ${bot[0].name}`, req.ip);

      res.json({ success: true, message: `Bot ${bot[0].name} started successfully` });
    } else {
      throw new Error(result.error || 'Failed to start bot');
    }

  } catch (error: any) {
    console.error('Start bot error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop bot
router.post('/bots/:id/stop', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const userId = (req as any).user.id;
    const bot = await db.select().from(botInstances).where(eq(botInstances.id, botId)).limit(1);
    
    if (!bot.length) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Call Termius API to stop bot
    const result = await termiusRequest(`/bot-command`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'stop',
        botName: bot[0].name
      })
    });

    if (result.success) {
      // Update bot status in database
      await db.update(botInstances)
        .set({ 
          status: 'stopped',
          updatedAt: new Date()
        })
        .where(eq(botInstances.id, botId));

      // Log activity
      await logActivity(userId, botId, 'stop_bot', 'success', `Stopped bot ${bot[0].name}`, req.ip);

      res.json({ success: true, message: `Bot ${bot[0].name} stopped successfully` });
    } else {
      throw new Error(result.error || 'Failed to stop bot');
    }

  } catch (error: any) {
    console.error('Stop bot error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pause bot
router.post('/bots/:id/pause', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const userId = (req as any).user.id;
    const bot = await db.select().from(botInstances).where(eq(botInstances.id, botId)).limit(1);
    
    if (!bot.length) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Update bot status in database (paused state)
    await db.update(botInstances)
      .set({ 
        status: 'paused',
        updatedAt: new Date()
      })
      .where(eq(botInstances.id, botId));

    // Log activity
    await logActivity(userId, botId, 'pause_bot', 'success', `Paused bot ${bot[0].name}`, req.ip);

    res.json({ success: true, message: `Bot ${bot[0].name} paused successfully` });

  } catch (error: any) {
    console.error('Pause bot error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create snapshot
router.post('/bots/:id/snapshot', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const userId = (req as any).user.id;
    const { description } = req.body;
    
    const bot = await db.select().from(botInstances).where(eq(botInstances.id, botId)).limit(1);
    
    if (!bot.length) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Call Termius API to create snapshot
    const result = await termiusRequest(`/bot-snapshot`, {
      method: 'POST',
      body: JSON.stringify({
        botName: bot[0].name,
        description: description || `Snapshot created at ${new Date().toISOString()}`
      })
    });

    if (result.success) {
      // Log activity
      await logActivity(userId, botId, 'create_snapshot', 'success', `Created snapshot for bot ${bot[0].name}`, req.ip);

      res.json({ success: true, message: `Snapshot created for bot ${bot[0].name}` });
    } else {
      throw new Error(result.error || 'Failed to create snapshot');
    }

  } catch (error: any) {
    console.error('Create snapshot error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rollback bot
router.post('/bots/:id/rollback', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const userId = (req as any).user.id;
    
    const bot = await db.select().from(botInstances).where(eq(botInstances.id, botId)).limit(1);
    
    if (!bot.length) {
      return res.status(404).json({ success: false, error: 'Bot not found' });
    }

    // Call Termius API to rollback
    const result = await termiusRequest(`/bot-rollback`, {
      method: 'POST',
      body: JSON.stringify({
        botName: bot[0].name
      })
    });

    if (result.success) {
      // Log activity
      await logActivity(userId, botId, 'rollback_bot', 'success', `Rolled back bot ${bot[0].name}`, req.ip);

      res.json({ success: true, message: `Bot ${bot[0].name} rolled back successfully` });
    } else {
      throw new Error(result.error || 'Failed to rollback bot');
    }

  } catch (error: any) {
    console.error('Rollback bot error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// FILE MANAGER ROUTES
// ================================

// Get bot files
router.get('/bots/:id/files', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    
    // Get bot files from Termius server
    const result = await termiusRequest(`/bot-files/${botId}`);
    
    if (result.success) {
      res.json({ success: true, data: result.files });
    } else {
      // Fallback to database files
      const files = await db.select().from(botFiles).where(eq(botFiles.botId, botId));
      res.json({ success: true, data: files });
    }

  } catch (error: any) {
    console.error('Get files error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get file content
router.get('/bots/:id/files/:fileName', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const fileName = req.params.fileName;
    
    // Get file content from Termius server
    const result = await termiusRequest(`/bot-file-content/${botId}/${fileName}`);
    
    if (result.success) {
      res.json({ success: true, data: { content: result.content, fileName } });
    } else {
      throw new Error(result.error || 'Failed to get file content');
    }

  } catch (error: any) {
    console.error('Get file content error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save file content
router.post('/bots/:id/files/:fileName', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const fileName = req.params.fileName;
    const { content } = req.body;
    const userId = (req as any).user.id;
    
    // Save file to Termius server
    const result = await termiusRequest(`/bot-file-save/${botId}/${fileName}`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    
    if (result.success) {
      // Log activity
      await logActivity(userId, botId, 'file_edit', 'success', `Edited file ${fileName}`, req.ip);
      
      res.json({ success: true, message: `File ${fileName} saved successfully` });
    } else {
      throw new Error(result.error || 'Failed to save file');
    }

  } catch (error: any) {
    console.error('Save file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Backup file
router.post('/bots/:id/files/:fileName/backup', async (req, res) => {
  try {
    const botId = parseInt(req.params.id);
    const fileName = req.params.fileName;
    const userId = (req as any).user.id;
    
    // Create backup on Termius server
    const result = await termiusRequest(`/bot-file-backup/${botId}/${fileName}`, {
      method: 'POST'
    });
    
    if (result.success) {
      // Log activity
      await logActivity(userId, botId, 'file_backup', 'success', `Backed up file ${fileName}`, req.ip);
      
      res.json({ success: true, message: `File ${fileName} backed up successfully` });
    } else {
      throw new Error(result.error || 'Failed to backup file');
    }

  } catch (error: any) {
    console.error('Backup file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// SUPABASE LEADS INTEGRATION
// ================================

// Get leads from all tables with pagination
router.get('/leads/:table', async (req, res) => {
  try {
    const tableName = req.params.table;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string || '';
    const offset = (page - 1) * limit;

    let leads: any[] = [];
    
    if (tableName === 'auto') {
      leads = await db.select().from(autoLeads)
        .limit(limit)
        .offset(offset);
    } else if (tableName === 'real_estate') {
      leads = await db.select().from(realEstateLeads)
        .limit(limit)
        .offset(offset);
    } else if (tableName === 'pets') {
      leads = await db.select().from(petLeads)
        .limit(limit)
        .offset(offset);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid table name' });
    }

    // Apply search filter if provided
    if (search) {
      leads = leads.filter((lead: any) => 
        lead.title?.toLowerCase().includes(search.toLowerCase()) ||
        lead.location?.toLowerCase().includes(search.toLowerCase())
      );
    }

    res.json({ 
      success: true, 
      data: leads,
      pagination: {
        page,
        limit,
        total: leads.length
      }
    });

  } catch (error: any) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update lead
router.put('/leads/:table/:id', async (req, res) => {
  try {
    const tableName = req.params.table;
    const leadId = parseInt(req.params.id);
    const updates = req.body;
    const userId = (req as any).user.id;
    
    if (tableName === 'auto') {
      await db.update(autoLeads)
        .set(updates)
        .where(eq(autoLeads.id, leadId));
    } else if (tableName === 'real_estate') {
      await db.update(realEstateLeads)
        .set(updates)
        .where(eq(realEstateLeads.id, leadId));
    } else if (tableName === 'pets') {
      await db.update(petLeads)
        .set(updates)
        .where(eq(petLeads.id, leadId));
    } else {
      return res.status(400).json({ success: false, error: 'Invalid table name' });
    }

    // Log activity
    await logActivity(userId, null, 'lead_edit', 'success', `Updated ${tableName} lead ${leadId}`, req.ip);

    res.json({ success: true, message: 'Lead updated successfully' });

  } catch (error: any) {
    console.error('Update lead error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// ANALYTICS ROUTES
// ================================

// Get analytics overview
router.get('/analytics/overview', async (req, res) => {
  try {
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // Get lead counts by vertical
    const autoCount = await db.select({ count: count() })
      .from(autoLeads)
      .where(gte(autoLeads.createdAt, last30Days));
      
    const realEstateCount = await db.select({ count: count() })
      .from(realEstateLeads)
      .where(gte(realEstateLeads.createdAt, last30Days));
      
    const petCount = await db.select({ count: count() })
      .from(petLeads)
      .where(gte(petLeads.createdAt, last30Days));

    // Get GPT costs
    const gptCosts = await db.select()
      .from(systemMetrics)
      .where(and(
        eq(systemMetrics.metric, 'openai_cost'),
        gte(systemMetrics.timestamp, last30Days)
      ));

    const totalCost = gptCosts.reduce((sum, metric) => sum + parseFloat(metric.value), 0);

    res.json({
      success: true,
      data: {
        leads: {
          auto: autoCount[0]?.count || 0,
          realEstate: realEstateCount[0]?.count || 0,
          pets: petCount[0]?.count || 0
        },
        costs: {
          total: totalCost,
          daily: totalCost / 30
        }
      }
    });

  } catch (error: any) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// DATABASE SEEDING ROUTE
// ================================

// Seed database with sample data
router.post('/seed-database', async (req, res) => {
  try {
    console.log('Seeding database with initial bot data...');

    // Clear existing data
    await db.delete(botInstances);
    await db.delete(alerts);
    await db.delete(autoLeads);
    await db.delete(realEstateLeads);
    await db.delete(petLeads);

    // Insert sample bots
    const bots = await db.insert(botInstances).values([
      {
        name: 'Orlando Scraper',
        city: 'Orlando',
        platform: 'craigslist',
        vertical: 'auto',
        type: 'scraper',
        status: 'running',
        dailyCount: 47,
        totalScraped: 1234,
        successRate: '94.5',
        progress: 78,
        version: '2.1.0',
        lastRun: new Date(),
        config: {
          searchTerms: ['honda', 'toyota', 'ford'],
          priceRange: [5000, 50000],
          maxAge: 10
        },
        gptPrompts: {
          enrichment: "Analyze this auto listing and extract key details about make, model, year, condition, and seller motivation.",
          outreach: "Create a personalized outreach message for this auto lead showing genuine interest."
        }
      },
      {
        name: 'Tampa Scraper',
        city: 'Tampa',
        platform: 'craigslist',
        vertical: 'auto',
        type: 'scraper',
        status: 'running',
        dailyCount: 52,
        totalScraped: 987,
        successRate: '91.2',
        progress: 65,
        version: '2.1.0',
        lastRun: new Date(),
        config: {
          searchTerms: ['honda', 'toyota', 'nissan'],
          priceRange: [3000, 45000],
          maxAge: 12
        }
      },
      {
        name: 'Miami Real Estate Scraper',
        city: 'Miami',
        platform: 'craigslist',
        vertical: 'real_estate',
        type: 'scraper',
        status: 'paused',
        dailyCount: 23,
        totalScraped: 456,
        successRate: '88.7',
        progress: 0,
        version: '1.9.0',
        lastRun: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      },
      {
        name: 'Enrichment Bot',
        city: 'All',
        platform: 'gpt',
        vertical: 'auto',
        type: 'enrichment',
        status: 'running',
        dailyCount: 89,
        totalScraped: 2341,
        successRate: '97.8',
        progress: 45,
        version: '3.0.1',
        lastRun: new Date(),
      },
      {
        name: 'Outreach Bot',
        city: 'All',
        platform: 'email',
        vertical: 'auto',
        type: 'outreach',
        status: 'stopped',
        dailyCount: 34,
        totalScraped: 789,
        successRate: '76.3',
        progress: 0,
        version: '2.5.0',
        lastRun: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
      },
      {
        name: 'Matching Bot',
        city: 'All',
        platform: 'ai',
        vertical: 'auto',
        type: 'matching',
        status: 'running',
        dailyCount: 67,
        totalScraped: 1567,
        successRate: '92.1',
        progress: 89,
        version: '1.8.0',
        lastRun: new Date(),
      }
    ]).returning();

    // Insert sample alerts
    await db.insert(alerts).values([
      {
        botId: bots[2].id, // Miami Real Estate Scraper
        alertType: 'warning',
        title: 'Bot Paused by User',
        message: 'Miami Real Estate Scraper was manually paused',
        severity: 'medium',
        isResolved: false,
        suggestedAction: 'Review bot configuration and resume if needed'
      },
      {
        botId: bots[4].id, // Outreach Bot
        alertType: 'error',
        title: 'Email Service Error',
        message: 'Failed to connect to SMTP server for outreach',
        severity: 'high',
        isResolved: false,
        errorStack: 'Error: ECONNREFUSED 127.0.0.1:587',
        suggestedAction: 'Check email credentials and SMTP configuration'
      },
      {
        botId: bots[0].id, // Orlando Scraper
        alertType: 'info',
        title: 'High Performance',
        message: 'Orlando Scraper exceeded daily target by 15%',
        severity: 'low',
        isResolved: true,
        resolvedAt: new Date()
      }
    ]);

    // Insert sample auto leads
    await db.insert(autoLeads).values([
      {
        botId: bots[0].id,
        title: '2018 Honda Accord LX - Clean Title',
        price: '18500',
        location: 'Orlando, FL',
        description: 'Excellent condition, one owner, recently serviced',
        contactInfo: { phone: '407-555-0123', email: 'seller1@example.com' },
        images: ['/img/honda-accord-1.jpg', '/img/honda-accord-2.jpg'],
        platform: 'craigslist',
        originalUrl: 'https://orlando.craigslist.org/cto/123456.html',
        enrichedData: {
          make: 'Honda',
          model: 'Accord',
          year: 2018,
          mileage: 45000,
          condition: 'excellent'
        },
        status: 'new'
      },
      {
        botId: bots[1].id,
        title: '2020 Toyota Camry SE - Low Miles',
        price: '22000',
        location: 'Tampa, FL',
        description: 'Like new, under warranty, perfect for commuting',
        contactInfo: { phone: '813-555-0456' },
        platform: 'craigslist',
        originalUrl: 'https://tampa.craigslist.org/cto/123457.html',
        status: 'assigned'
      },
      {
        botId: bots[0].id,
        title: '2019 Ford F-150 XLT - Work Truck',
        price: '28500',
        location: 'Orlando, FL',
        description: 'Perfect for work, towing package included',
        contactInfo: { phone: '407-555-0789', email: 'worktrucks@example.com' },
        platform: 'craigslist',
        originalUrl: 'https://orlando.craigslist.org/cto/123458.html',
        status: 'contacted'
      }
    ]);

    // Insert sample real estate leads
    await db.insert(realEstateLeads).values([
      {
        botId: bots[2].id,
        title: '3BR/2BA Single Family Home - Move-in Ready',
        price: '325000',
        location: 'Miami, FL',
        bedrooms: 3,
        bathrooms: 2.0,
        sqft: 1850,
        description: 'Beautiful home in quiet neighborhood, recently updated',
        contactInfo: { phone: '305-555-0123', email: 'realestate@example.com' },
        platform: 'craigslist',
        originalUrl: 'https://miami.craigslist.org/mdc/rea/123459.html',
        status: 'new'
      }
    ]);

    // Insert sample pet leads
    await db.insert(petLeads).values([
      {
        botId: bots[0].id, // Using Orlando scraper for example
        title: 'Golden Retriever Puppies - AKC Registered',
        price: '1200',
        location: 'Orlando, FL',
        breed: 'Golden Retriever',
        age: '8 weeks',
        description: 'Beautiful golden retriever puppies, health checked',
        contactInfo: { phone: '407-555-0999' },
        platform: 'craigslist',
        originalUrl: 'https://orlando.craigslist.org/pet/123460.html',
        status: 'new'
      }
    ]);

    // Insert sample system metrics
    await db.insert(systemMetrics).values([
      {
        metric: 'openai_cost',
        value: '12.45',
        botId: bots[3].id, // Enrichment Bot
        timestamp: new Date()
      },
      {
        metric: 'openai_tokens',
        value: '45230',
        botId: bots[3].id,
        timestamp: new Date()
      },
      {
        metric: 'api_calls',
        value: '156',
        timestamp: new Date()
      }
    ]);

    console.log('Database seeded successfully!');
    res.json({ success: true, message: 'Database seeded with sample data', botsCreated: bots.length });

  } catch (error: any) {
    console.error('Error seeding database:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================
// GPT-4 Code Generation Routes
// ================================

// Generate code with GPT-4
router.post('/gpt-generate', async (req, res) => {
  try {
    const { bot, prompt, currentCode, type } = req.body;

    // Mock GPT-4 response for now - replace with actual OpenAI API
    const generatedCode = `// GPT-4 Generated Code for: ${prompt}
// Bot: ${bot}
// Type: ${type}

const enhancedScript = async () => {
  try {
    // Enhanced code based on prompt: ${prompt}
    console.log('Starting enhanced ${bot} script...');
    
    // Add improved error handling
    const errorHandler = (error) => {
      console.error('Bot error:', error);
      // Send to monitoring system
    };
    
    // Original code with improvements
    ${currentCode || '// Original code would be here'}
    
    // Additional enhancements
    return { success: true, message: 'Script enhanced successfully' };
  } catch (error) {
    errorHandler(error);
    throw error;
  }
};

module.exports = enhancedScript;`;

    res.json({
      success: true,
      generatedCode,
      diff: {
        additions: prompt.length * 2, // Mock diff stats
        deletions: 5,
        changes: 3
      }
    });
  } catch (error) {
    console.error('GPT generation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update bot script via Ngrok
router.post('/bot-update-script', async (req, res) => {
  try {
    const { bot, newScript, backup } = req.body;
    const API_BASE = process.env.VITE_API_BASE || 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

    // Send to Termius server via Ngrok
    const response = await fetch(`${API_BASE}/update-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot,
        script: newScript,
        backup
      })
    });

    if (!response.ok) {
      throw new Error('Failed to update script on Termius server');
    }

    const result = await response.json();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Script update error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// Bot File Management Routes
// ================================

// Get files for a specific bot
router.get('/bot-files/:botId', async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const files = await db.select().from(botFiles).where(eq(botFiles.botId, botId));
    res.json(files);
  } catch (error) {
    console.error('Get bot files error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update file content
router.put('/bot-files/:fileId', async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const { content } = req.body;

    await db.update(botFiles)
      .set({ content, lastModified: new Date() })
      .where(eq(botFiles.id, fileId));

    res.json({ success: true, message: 'File updated successfully' });
  } catch (error) {
    console.error('Update file error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create new file
router.post('/bot-files', async (req, res) => {
  try {
    const { botId, fileName, fileType, content, filePath } = req.body;

    const [newFile] = await db.insert(botFiles).values({
      botId,
      fileName,
      fileType,
      content,
      filePath
    }).returning();

    res.json({ success: true, file: newFile });
  } catch (error) {
    console.error('Create file error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// Subscription Management Routes
// ================================

// Get all subscriptions
router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
    res.json(subs);
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create new subscription
router.post('/subscriptions', async (req, res) => {
  try {
    const subscriptionData = req.body;

    const [newSub] = await db.insert(subscriptions).values(subscriptionData).returning();
    res.json({ success: true, subscription: newSub });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update subscription
router.put('/subscriptions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updateData = req.body;

    await db.update(subscriptions)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(subscriptions.id, id));

    res.json({ success: true, message: 'Subscription updated successfully' });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// Database/Supabase Sync Routes
// ================================

// Get leads from all verticals
router.get('/leads', async (req, res) => {
  try {
    const { vertical, limit = 100 } = req.query;

    let leads = [];
    if (!vertical || vertical === 'auto') {
      const autoData = await db.select().from(autoLeads).limit(parseInt(limit as string));
      leads = [...leads, ...autoData.map(lead => ({ ...lead, vertical: 'auto' }))];
    }
    if (!vertical || vertical === 'real_estate') {
      const realEstateData = await db.select().from(realEstateLeads).limit(parseInt(limit as string));
      leads = [...leads, ...realEstateData.map(lead => ({ ...lead, vertical: 'real_estate' }))];
    }
    if (!vertical || vertical === 'pets') {
      const petData = await db.select().from(petLeads).limit(parseInt(limit as string));
      leads = [...leads, ...petData.map(lead => ({ ...lead, vertical: 'pets' }))];
    }

    res.json(leads);
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update lead status
router.put('/leads/:vertical/:id', async (req, res) => {
  try {
    const { vertical, id } = req.params;
    const { status, userId } = req.body;
    const leadId = parseInt(id);

    let table;
    switch (vertical) {
      case 'auto':
        table = autoLeads;
        break;
      case 'real_estate':
        table = realEstateLeads;
        break;
      case 'pets':
        table = petLeads;
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid vertical' });
    }

    await db.update(table)
      .set({ status, userId })
      .where(eq(table.id, leadId));

    res.json({ success: true, message: 'Lead updated successfully' });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// AI Assistant Routes
// ================================

// Process natural language command
router.post('/ai-command', async (req, res) => {
  try {
    const { command, userId } = req.body;

    // Save command to history
    const [historyEntry] = await db.insert(commandHistory).values({
      userId,
      command,
      interpretation: `Processing: ${command}`,
      executed: false
    }).returning();

    // Simple command interpretation (replace with actual AI)
    let interpretation = '';
    let executed = false;
    let result = '';

    if (command.toLowerCase().includes('launch') && command.toLowerCase().includes('scraper')) {
      interpretation = 'Launch bot scraper command detected';
      result = 'Bot launch initiated';
      executed = true;
    } else if (command.toLowerCase().includes('stop') || command.toLowerCase().includes('pause')) {
      interpretation = 'Stop/pause bot command detected';
      result = 'Bot stopped';
      executed = true;
    } else if (command.toLowerCase().includes('status') || command.toLowerCase().includes('health')) {
      interpretation = 'System status request detected';
      result = 'System status: All bots operational';
      executed = true;
    } else {
      interpretation = 'Command not recognized';
      result = 'Please try a different command format';
    }

    // Update history with result
    await db.update(commandHistory)
      .set({ interpretation, executed, result })
      .where(eq(commandHistory.id, historyEntry.id));

    res.json({
      success: true,
      interpretation,
      result,
      executed
    });
  } catch (error) {
    console.error('AI command error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get command history
router.get('/command-history/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const history = await db.select()
      .from(commandHistory)
      .where(eq(commandHistory.userId, userId))
      .orderBy(desc(commandHistory.createdAt))
      .limit(50);

    res.json(history);
  } catch (error) {
    console.error('Get command history error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// Alerts & Health Monitoring Routes
// ================================

// Get all alerts
router.get('/alerts', async (req, res) => {
  try {
    const allAlerts = await db.select().from(alerts).orderBy(desc(alerts.createdAt));
    res.json(allAlerts);
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create new alert
router.post('/alerts', async (req, res) => {
  try {
    const alertData = req.body;

    const [newAlert] = await db.insert(alerts).values(alertData).returning();

    // Send to Slack if configured and critical
    if (newAlert.severity === 'critical' && process.env.SLACK_BOT_TOKEN) {
      // Add Slack notification logic here
    }

    res.json({ success: true, alert: newAlert });
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mark alert as resolved
router.put('/alerts/:id/resolve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    await db.update(alerts)
      .set({ isResolved: true, resolvedAt: new Date() })
      .where(eq(alerts.id, id));

    res.json({ success: true, message: 'Alert resolved' });
  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// GPT Prompt Management Routes
// ================================

// Get all GPT prompts
router.get('/gpt-prompts', async (req, res) => {
  try {
    const prompts = await db.select().from(gptPrompts).orderBy(desc(gptPrompts.createdAt));
    res.json(prompts);
  } catch (error) {
    console.error('Get GPT prompts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create new prompt version
router.post('/gpt-prompts', async (req, res) => {
  try {
    const promptData = req.body;

    // Deactivate previous versions
    await db.update(gptPrompts)
      .set({ isActive: false })
      .where(and(
        eq(gptPrompts.vertical, promptData.vertical),
        eq(gptPrompts.promptType, promptData.promptType)
      ));

    // Create new active version
    const [newPrompt] = await db.insert(gptPrompts).values({
      ...promptData,
      isActive: true
    }).returning();

    res.json({ success: true, prompt: newPrompt });
  } catch (error) {
    console.error('Create GPT prompt error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ================================
// Dev Tools Routes
// ================================

// Restart all bots
router.post('/dev/restart-all', async (req, res) => {
  try {
    const API_BASE = process.env.VITE_API_BASE || 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

    const response = await fetch(`${API_BASE}/restart-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to restart bots on Termius server');
    }

    const result = await response.json();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Restart all error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download logs
router.get('/dev/logs', async (req, res) => {
  try {
    const API_BASE = process.env.VITE_API_BASE || 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

    const response = await fetch(`${API_BASE}/download-logs`);
    
    if (!response.ok) {
      throw new Error('Failed to get logs from Termius server');
    }

    const logs = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="bot-logs.txt"');
    res.send(logs);
  } catch (error) {
    console.error('Download logs error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle debug mode
router.post('/dev/debug-toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const API_BASE = process.env.VITE_API_BASE || 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

    const response = await fetch(`${API_BASE}/debug-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });

    if (!response.ok) {
      throw new Error('Failed to toggle debug mode on Termius server');
    }

    const result = await response.json();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Debug toggle error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get system stats
router.get('/dev/system-stats', async (req, res) => {
  try {
    const API_BASE = process.env.VITE_API_BASE || 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';

    const response = await fetch(`${API_BASE}/system-stats`);
    
    if (!response.ok) {
      throw new Error('Failed to get system stats from Termius server');
    }

    const stats = await response.json();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('System stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;