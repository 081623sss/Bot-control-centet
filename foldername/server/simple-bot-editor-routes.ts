import express from 'express';
import { protectDashboard } from '../middleware/authMiddleware';

const router = express.Router();

// Mock bot files data for demonstration
const mockBotFiles = [
  {
    id: 1,
    botId: 1,
    fileName: 'scraper.js',
    filePath: 'bots/orlando-craigslist/scraper.js',
    content: `// Orlando Craigslist Auto Scraper
const puppeteer = require('puppeteer');

class OrlandoAutoScraper {
  constructor() {
    this.baseUrl = 'https://orlando.craigslist.org/search/cta';
    this.isRunning = false;
  }

  async startScraper() {
    console.log('Starting Orlando Auto Scraper...');
    this.isRunning = true;
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      await page.goto(this.baseUrl);
      
      // Extract car listings
      const listings = await page.evaluate(() => {
        const results = [];
        const listItems = document.querySelectorAll('.result-row');
        
        listItems.forEach(item => {
          const titleElement = item.querySelector('.result-title');
          const priceElement = item.querySelector('.result-price');
          const locationElement = item.querySelector('.result-hood');
          
          if (titleElement) {
            results.push({
              title: titleElement.textContent.trim(),
              price: priceElement ? priceElement.textContent.trim() : 'Not specified',
              location: locationElement ? locationElement.textContent.trim() : 'Orlando',
              url: titleElement.href,
              datePosted: new Date()
            });
          }
        });
        
        return results;
      });
      
      console.log(\`Found \${listings.length} auto listings\`);
      
      // Process each listing
      for (const listing of listings) {
        await this.processListing(listing);
      }
      
    } catch (error) {
      console.error('Scraping error:', error);
    } finally {
      await browser.close();
      this.isRunning = false;
    }
  }

  async processListing(listing) {
    // Send to GPT for enrichment
    console.log('Processing:', listing.title);
    
    // Store in database
    // TODO: Implement database storage
  }

  stopScraper() {
    this.isRunning = false;
    console.log('Scraper stopped');
  }
}

module.exports = OrlandoAutoScraper;`,
    fileType: 'js',
    isProtected: false,
    lastModified: new Date().toISOString()
  },
  {
    id: 2,
    botId: 1,
    fileName: 'config.json',
    filePath: 'bots/orlando-craigslist/config.json',
    content: `{
  "bot": {
    "name": "Orlando Auto Scraper",
    "city": "Orlando",
    "platform": "craigslist",
    "vertical": "auto"
  },
  "scraping": {
    "interval": 300000,
    "maxPages": 5,
    "delayBetweenRequests": 2000
  },
  "targets": {
    "minPrice": 1000,
    "maxPrice": 50000,
    "makes": ["Honda", "Toyota", "Ford", "Chevrolet", "Nissan"],
    "maxAge": 15
  },
  "gpt": {
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 500
  },
  "database": {
    "table": "auto_leads",
    "batchSize": 50
  }
}`,
    fileType: 'json',
    isProtected: true,
    lastModified: new Date().toISOString()
  },
  {
    id: 3,
    botId: 1,
    fileName: 'enrichment.js',
    filePath: 'bots/orlando-craigslist/enrichment.js',
    content: `// GPT-powered lead enrichment
const OpenAI = require('openai');

class LeadEnrichment {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async enrichLead(rawLead) {
    const prompt = \`Analyze this auto listing and extract key information:

Title: \${rawLead.title}
Description: \${rawLead.description || 'No description'}
Price: \${rawLead.price}

Extract and return JSON with:
- make (string)
- model (string) 
- year (number)
- estimatedMileage (number or null)
- condition (excellent/good/fair/poor)
- urgency (high/medium/low based on language)
- buyerType (dealer/individual/flipper)
- redFlags (array of potential issues)
- confidence (0-1 score)

Respond only with valid JSON.\`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const enrichedData = JSON.parse(response.choices[0].message.content);
      
      return {
        ...rawLead,
        enrichedData,
        gptStatus: 'completed',
        processedAt: new Date()
      };
      
    } catch (error) {
      console.error('GPT enrichment error:', error);
      return {
        ...rawLead,
        gptStatus: 'error',
        enrichmentError: error.message
      };
    }
  }
}

module.exports = LeadEnrichment;`,
    fileType: 'js',
    isProtected: false,
    lastModified: new Date().toISOString()
  }
];

const mockFileHistory = [
  {
    id: 1,
    fileId: 1,
    fileName: 'scraper.js',
    content: '// Previous version of scraper...',
    version: 1,
    timestamp: new Date(Date.now() - 86400000).toISOString() // 1 day ago
  },
  {
    id: 2,
    fileId: 1,
    fileName: 'scraper.js',
    content: '// Another previous version...',
    version: 2,
    timestamp: new Date(Date.now() - 43200000).toISOString() // 12 hours ago
  }
];

// Get all files for a specific bot
router.get('/bot-files/:botId', protectDashboard, async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    const files = mockBotFiles.filter(f => f.botId === botId);
    res.json(files);
  } catch (error) {
    console.error('Error fetching bot files:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bot files' });
  }
});

// Get specific file content
router.get('/bot-files/file/:fileId', protectDashboard, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const file = mockBotFiles.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    res.json(file);
  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file' });
  }
});

// Update file content
router.put('/bot-files/:fileId', protectDashboard, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const { content } = req.body;
    
    if (!content && content !== '') {
      return res.status(400).json({ success: false, message: 'Content is required' });
    }
    
    const fileIndex = mockBotFiles.findIndex(f => f.id === fileId);
    
    if (fileIndex === -1) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Create backup in history
    const currentFile = mockBotFiles[fileIndex];
    const newHistoryEntry = {
      id: mockFileHistory.length + 1,
      fileId,
      fileName: currentFile.fileName,
      content: currentFile.content,
      version: mockFileHistory.filter(h => h.fileId === fileId).length + 1,
      timestamp: new Date().toISOString()
    };
    
    mockFileHistory.push(newHistoryEntry);
    
    // Update file
    mockBotFiles[fileIndex] = {
      ...currentFile,
      content,
      lastModified: new Date().toISOString()
    };
    
    res.json({ success: true, message: 'File updated successfully' });
  } catch (error) {
    console.error('Error updating file:', error);
    res.status(500).json({ success: false, message: 'Failed to update file' });
  }
});

// Get file history
router.get('/file-history/:fileId', protectDashboard, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const history = mockFileHistory
      .filter(h => h.fileId === fileId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching file history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file history' });
  }
});

// Rollback to specific version
router.post('/bot-files/:fileId/rollback/:historyId', protectDashboard, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const historyId = parseInt(req.params.historyId);
    
    const historicalVersion = mockFileHistory.find(h => h.id === historyId);
    
    if (!historicalVersion) {
      return res.status(404).json({ success: false, message: 'Historical version not found' });
    }
    
    const fileIndex = mockBotFiles.findIndex(f => f.id === fileId);
    
    if (fileIndex === -1) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Create backup of current version
    const currentFile = mockBotFiles[fileIndex];
    const newHistoryEntry = {
      id: mockFileHistory.length + 1,
      fileId,
      fileName: currentFile.fileName,
      content: currentFile.content,
      version: mockFileHistory.filter(h => h.fileId === fileId).length + 1,
      timestamp: new Date().toISOString()
    };
    
    mockFileHistory.push(newHistoryEntry);
    
    // Update with historical content
    mockBotFiles[fileIndex] = {
      ...currentFile,
      content: historicalVersion.content,
      lastModified: new Date().toISOString()
    };
    
    res.json({ 
      success: true, 
      message: 'File rolled back successfully',
      content: historicalVersion.content
    });
  } catch (error) {
    console.error('Error rolling back file:', error);
    res.status(500).json({ success: false, message: 'Failed to rollback file' });
  }
});

// Enhanced bot command endpoint
router.post('/bot-command', protectDashboard, async (req, res) => {
  try {
    const { bot, action } = req.body;
    
    if (!bot || !action) {
      return res.status(400).json({ success: false, message: 'Bot and action are required' });
    }
    
    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    
    // Simulate bot command execution
    console.log(`Executing bot command: ${action} on ${bot}`);
    
    // For demo purposes, we'll simulate success
    res.json({
      success: true,
      message: `Successfully ${action}ed ${bot}`,
      timestamp: new Date().toISOString(),
      action,
      bot
    });
    
  } catch (error) {
    console.error('Error executing bot command:', error);
    res.status(500).json({ success: false, message: 'Failed to execute bot command' });
  }
});

export default router;