import { Router } from 'express';
import { craigslistBotService } from './craigslist-bot-service';
import { requireAuth } from './auth-routes';
import { TERMIUS_CONFIG, checkTermiusConnection } from './termius-config';

const router = Router();

// Check Termius server connection status
router.get('/connection-status', requireAuth, async (req, res) => {
  try {
    const connectionStatus = await checkTermiusConnection();
    res.json({
      success: true,
      data: {
        ...connectionStatus,
        config: {
          url: TERMIUS_CONFIG.baseUrl,
          botName: TERMIUS_CONFIG.botName,
          scriptFile: TERMIUS_CONFIG.scriptFile
        }
      }
    });
  } catch (error) {
    console.error('Failed to check connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check connection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get bot status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await craigslistBotService.getBotStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Failed to get bot status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get bot status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start bot
router.post('/start', requireAuth, async (req, res) => {
  try {
    const result = await craigslistBotService.startBot();
    res.json(result);
  } catch (error) {
    console.error('Failed to start bot:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start bot',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop bot
router.post('/stop', requireAuth, async (req, res) => {
  try {
    const result = await craigslistBotService.stopBot();
    res.json(result);
  } catch (error) {
    console.error('Failed to stop bot:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to stop bot',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Rollback bot
router.post('/rollback', requireAuth, async (req, res) => {
  try {
    const result = await craigslistBotService.rollbackBot();
    res.json(result);
  } catch (error) {
    console.error('Failed to rollback bot:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to rollback bot',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create snapshot
router.post('/snapshot', requireAuth, async (req, res) => {
  try {
    const result = await craigslistBotService.createSnapshot();
    res.json(result);
  } catch (error) {
    console.error('Failed to create snapshot:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create snapshot',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get analytics
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const analytics = await craigslistBotService.getAnalytics();
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Failed to get analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get analytics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get bot configuration
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = craigslistBotService.getBotConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Failed to get bot config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get bot config',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update enrichment prompt
router.post('/update-prompt', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ 
        success: false, 
        message: 'Prompt is required' 
      });
    }
    
    const result = await craigslistBotService.updateEnrichmentPrompt(prompt);
    res.json(result);
  } catch (error) {
    console.error('Failed to update prompt:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update prompt',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get recent logs
router.get('/logs', requireAuth, async (req, res) => {
  try {
    const response = await craigslistBotService.sendCommandToTermius('logs');
    if (response.success) {
      res.json({ success: true, data: response.result });
    } else {
      res.json({ success: false, message: response.message || 'Failed to get logs' });
    }
  } catch (error) {
    console.error('Failed to get logs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get logs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;