import express from 'express';
import { db } from './db';
import { eq, desc } from 'drizzle-orm';
import { botFiles, fileHistory } from '@shared/schema';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Simple auth middleware
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionToken = req.cookies?.sessionToken;
    
    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Basic session check - in a real app this would validate the session
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
}

// Get all files for a specific bot
router.get('/bot-files/:botId', requireAuth, async (req, res) => {
  try {
    const botId = parseInt(req.params.botId);
    
    const files = await db.select().from(botFiles).where(eq(botFiles.botId, botId));
    
    res.json(files);
  } catch (error) {
    console.error('Error fetching bot files:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bot files' });
  }
});

// Get specific file content
router.get('/bot-files/file/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    
    const [file] = await db.select().from(botFiles).where(eq(botFiles.id, fileId));
    
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
router.put('/bot-files/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const { content } = req.body;
    
    if (!content && content !== '') {
      return res.status(400).json({ success: false, message: 'Content is required' });
    }
    
    // Get current file
    const [currentFile] = await db.select().from(botFiles).where(eq(botFiles.id, fileId));
    
    if (!currentFile) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Create backup in history
    const historyCount = await db.select().from(fileHistory).where(eq(fileHistory.fileId, fileId));
    const newVersion = historyCount.length + 1;
    
    await db.insert(fileHistory).values({
      fileId,
      fileName: currentFile.fileName,
      content: currentFile.content,
      timestamp: new Date(),
      version: newVersion
    });
    
    // Keep only last 5 versions
    if (historyCount.length >= 5) {
      const oldestVersions = await db.select()
        .from(fileHistory)
        .where(eq(fileHistory.fileId, fileId))
        .orderBy(fileHistory.timestamp)
        .limit(historyCount.length - 4);
      
      for (const version of oldestVersions) {
        await db.delete(fileHistory).where(eq(fileHistory.id, version.id));
      }
    }
    
    // Update file
    await db.update(botFiles)
      .set({ 
        content, 
        lastModified: new Date() 
      })
      .where(eq(botFiles.id, fileId));
    
    // Write to actual file system (for Termius sync)
    try {
      const filePath = path.join(process.cwd(), 'bots', currentFile.filePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    } catch (fsError) {
      console.error('Error writing to file system:', fsError);
      // Continue anyway - database is updated
    }
    
    res.json({ success: true, message: 'File updated successfully' });
  } catch (error) {
    console.error('Error updating file:', error);
    res.status(500).json({ success: false, message: 'Failed to update file' });
  }
});

// Get file history
router.get('/file-history/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    
    const history = await db.select()
      .from(fileHistory)
      .where(eq(fileHistory.fileId, fileId))
      .orderBy(desc(fileHistory.timestamp));
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching file history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file history' });
  }
});

// Rollback to specific version
router.post('/bot-files/:fileId/rollback/:historyId', requireAuth, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    const historyId = parseInt(req.params.historyId);
    
    // Get the historical version
    const [historicalVersion] = await db.select()
      .from(fileHistory)
      .where(eq(fileHistory.id, historyId));
    
    if (!historicalVersion) {
      return res.status(404).json({ success: false, message: 'Historical version not found' });
    }
    
    // Get current file for backup
    const [currentFile] = await db.select().from(botFiles).where(eq(botFiles.id, fileId));
    
    if (!currentFile) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Create backup of current version before rollback
    const historyCount = await db.select().from(fileHistory).where(eq(fileHistory.fileId, fileId));
    const newVersion = historyCount.length + 1;
    
    await db.insert(fileHistory).values({
      fileId,
      fileName: currentFile.fileName,
      content: currentFile.content,
      timestamp: new Date(),
      version: newVersion
    });
    
    // Update file with historical content
    await db.update(botFiles)
      .set({ 
        content: historicalVersion.content, 
        lastModified: new Date() 
      })
      .where(eq(botFiles.id, fileId));
    
    // Write to actual file system
    try {
      const filePath = path.join(process.cwd(), 'bots', currentFile.filePath);
      await fs.writeFile(filePath, historicalVersion.content, 'utf8');
    } catch (fsError) {
      console.error('Error writing to file system:', fsError);
    }
    
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

// Create new bot file
router.post('/bot-files', requireAuth, async (req, res) => {
  try {
    const { botId, fileName, filePath, content, fileType } = req.body;
    
    if (!botId || !fileName || !filePath || !fileType) {
      return res.status(400).json({ 
        success: false, 
        message: 'botId, fileName, filePath, and fileType are required' 
      });
    }
    
    const [newFile] = await db.insert(botFiles).values({
      botId,
      fileName,
      filePath,
      content: content || '',
      fileType,
      isProtected: false,
      lastModified: new Date()
    }).returning();
    
    // Create the actual file
    try {
      const fullFilePath = path.join(process.cwd(), 'bots', filePath);
      await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
      await fs.writeFile(fullFilePath, content || '', 'utf8');
    } catch (fsError) {
      console.error('Error creating file:', fsError);
    }
    
    res.json({ success: true, file: newFile });
  } catch (error) {
    console.error('Error creating bot file:', error);
    res.status(500).json({ success: false, message: 'Failed to create bot file' });
  }
});

// Delete bot file
router.delete('/bot-files/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = parseInt(req.params.fileId);
    
    const [file] = await db.select().from(botFiles).where(eq(botFiles.id, fileId));
    
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    if (file.isProtected) {
      return res.status(403).json({ success: false, message: 'Cannot delete protected file' });
    }
    
    // Delete from database
    await db.delete(botFiles).where(eq(botFiles.id, fileId));
    
    // Delete file history
    await db.delete(fileHistory).where(eq(fileHistory.fileId, fileId));
    
    // Delete actual file
    try {
      const filePath = path.join(process.cwd(), 'bots', file.filePath);
      await fs.unlink(filePath);
    } catch (fsError) {
      console.error('Error deleting file:', fsError);
    }
    
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ success: false, message: 'Failed to delete file' });
  }
});

// Bot command endpoint (enhanced)
router.post('/bot-command', requireAuth, async (req, res) => {
  try {
    const { bot, action } = req.body;
    
    if (!bot || !action) {
      return res.status(400).json({ success: false, message: 'Bot and action are required' });
    }
    
    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    
    // Forward to Termius server via Ngrok
    const termiusUrl = 'https://f1e9-2600-3c0a-00-f03c-95ff.ngrok.io';
    
    try {
      const response = await fetch(`${termiusUrl}/bot-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bot, action }),
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`Termius server error: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Log the activity
      console.log(`Bot command executed: ${action} on ${bot}`, result);
      
      res.json({
        success: true,
        message: `Successfully ${action}ed ${bot}`,
        termiusResponse: result
      });
      
    } catch (termiusError) {
      console.error('Termius connection error:', termiusError);
      
      // Return success but note the connection issue
      res.json({
        success: true,
        message: `Command sent: ${action} ${bot} (Termius connection unavailable)`,
        warning: 'Termius server not reachable - command may not have executed'
      });
    }
    
  } catch (error) {
    console.error('Error executing bot command:', error);
    res.status(500).json({ success: false, message: 'Failed to execute bot command' });
  }
});

// Sync with GPT Editor (bonus feature)
router.post('/sync-gpt-editor', requireAuth, async (req, res) => {
  try {
    const { fileId, generatedCode } = req.body;
    
    if (!fileId || !generatedCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'fileId and generatedCode are required' 
      });
    }
    
    // This endpoint allows the GPT-4 Editor to push generated code
    // directly into the selected file in the Live Bot Editor
    
    const [file] = await db.select().from(botFiles).where(eq(botFiles.id, fileId));
    
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Create backup before overwriting
    const historyCount = await db.select().from(fileHistory).where(eq(fileHistory.fileId, fileId));
    const newVersion = historyCount.length + 1;
    
    await db.insert(fileHistory).values({
      fileId,
      fileName: file.fileName,
      content: file.content,
      timestamp: new Date(),
      version: newVersion
    });
    
    // Update with generated code
    await db.update(botFiles)
      .set({ 
        content: generatedCode, 
        lastModified: new Date() 
      })
      .where(eq(botFiles.id, fileId));
    
    res.json({ 
      success: true, 
      message: 'Generated code synced to bot editor',
      fileName: file.fileName
    });
    
  } catch (error) {
    console.error('Error syncing GPT editor:', error);
    res.status(500).json({ success: false, message: 'Failed to sync generated code' });
  }
});

export default router;