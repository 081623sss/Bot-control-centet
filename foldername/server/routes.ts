import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import authRoutes, { requireAuth } from "./auth-routes";
import { 
  insertBotInstanceSchema, 
  insertActivityLogSchema,
  insertSystemMetricSchema,
  insertAutoLeadSchema,
  insertRealEstateLeadSchema,
  insertPetLeadSchema,
  insertSubscriptionSchema
} from "@shared/schema";
import { z } from "zod";
import cookieParser from 'cookie-parser';

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware
  app.use(cookieParser());
  
  // Authentication routes
  app.use("/api/auth", authRoutes);

  // Bot Instance routes
  app.get("/api/bots", requireAuth, async (req, res) => {
    try {
      const bots = await storage.getBots();
      res.json(bots);
    } catch (error) {
      console.error("Error fetching bots:", error);
      res.status(500).json({ error: "Failed to fetch bots" });
    }
  });

  app.get("/api/bots/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      res.json(bot);
    } catch (error) {
      console.error("Error fetching bot:", error);
      res.status(500).json({ error: "Failed to fetch bot" });
    }
  });

  app.post("/api/bots", requireAuth, async (req, res) => {
    try {
      const validation = insertBotInstanceSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid bot data", 
          details: validation.error.errors 
        });
      }

      const newBot = await storage.createBot(validation.data);
      
      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: newBot.id,
        action: 'bot_created',
        status: 'success',
        message: `Created bot: ${newBot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.status(201).json(newBot);
    } catch (error) {
      console.error("Error creating bot:", error);
      res.status(500).json({ error: "Failed to create bot" });
    }
  });

  app.put("/api/bots/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const updates = req.body;
      const updatedBot = await storage.updateBot(id, updates);
      
      if (!updatedBot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: id,
        action: 'bot_updated',
        status: 'success',
        message: `Updated bot: ${updatedBot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json(updatedBot);
    } catch (error) {
      console.error("Error updating bot:", error);
      res.status(500).json({ error: "Failed to update bot" });
    }
  });

  app.delete("/api/bots/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      const deleted = await storage.deleteBot(id);
      
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete bot" });
      }

      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: id,
        action: 'bot_deleted',
        status: 'success',
        message: `Deleted bot: ${bot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ success: true, message: "Bot deleted successfully" });
    } catch (error) {
      console.error("Error deleting bot:", error);
      res.status(500).json({ error: "Failed to delete bot" });
    }
  });

  // Bot control routes
  app.post("/api/bots/:id/start", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      // Update bot status to running
      const updatedBot = await storage.updateBot(id, { 
        status: "running",
        lastRun: new Date()
      });

      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: id,
        action: 'bot_started',
        status: 'success',
        message: `Started bot: ${bot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: "Bot started successfully",
        bot: updatedBot
      });
    } catch (error) {
      console.error("Error starting bot:", error);
      res.status(500).json({ error: "Failed to start bot" });
    }
  });

  app.post("/api/bots/:id/stop", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      // Update bot status to stopped
      const updatedBot = await storage.updateBot(id, { 
        status: "stopped",
        processId: null
      });

      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: id,
        action: 'bot_stopped',
        status: 'success',
        message: `Stopped bot: ${bot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: "Bot stopped successfully",
        bot: updatedBot
      });
    } catch (error) {
      console.error("Error stopping bot:", error);
      res.status(500).json({ error: "Failed to stop bot" });
    }
  });

  // Activity logs
  app.get("/api/logs", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // System metrics
  app.get("/api/metrics", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const metrics = await storage.getSystemMetrics(limit);
      res.json(metrics);
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  app.post("/api/metrics", requireAuth, async (req, res) => {
    try {
      const validation = insertSystemMetricSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid metric data", 
          details: validation.error.errors 
        });
      }

      const newMetric = await storage.createSystemMetric(validation.data);
      res.status(201).json(newMetric);
    } catch (error) {
      console.error("Error creating metric:", error);
      res.status(500).json({ error: "Failed to create metric" });
    }
  });

  // Statistics
  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Subscription management
  app.get("/api/subscriptions", requireAuth, async (req, res) => {
    try {
      const subscriptions = await storage.getSubscriptions();
      res.json(subscriptions);
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });

  app.post("/api/subscriptions", requireAuth, async (req, res) => {
    try {
      const validation = insertSubscriptionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid subscription data", 
          details: validation.error.errors 
        });
      }

      const newSubscription = await storage.createSubscription(validation.data);
      res.status(201).json(newSubscription);
    } catch (error) {
      console.error("Error creating subscription:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  // Lead management routes
  app.get("/api/leads/auto", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const leads = await storage.getAutoLeads(limit);
      res.json(leads);
    } catch (error) {
      console.error("Error fetching auto leads:", error);
      res.status(500).json({ error: "Failed to fetch auto leads" });
    }
  });

  app.get("/api/leads/real-estate", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const leads = await storage.getRealEstateLeads(limit);
      res.json(leads);
    } catch (error) {
      console.error("Error fetching real estate leads:", error);
      res.status(500).json({ error: "Failed to fetch real estate leads" });
    }
  });

  app.get("/api/leads/pets", requireAuth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const leads = await storage.getPetLeads(limit);
      res.json(leads);
    } catch (error) {
      console.error("Error fetching pet leads:", error);
      res.status(500).json({ error: "Failed to fetch pet leads" });
    }
  });

  // GPT prompt management
  app.get("/api/bots/:id/prompts", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      res.json({
        prompts: bot.gptPrompts || {
          enrichment: "Analyze and enrich this lead data with relevant insights and contact information.",
          outreach: "Create a personalized outreach message for this lead.",
          matching: "Match this lead to the most appropriate dealer or vertical."
        }
      });
    } catch (error) {
      console.error("Error fetching prompts:", error);
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  app.put("/api/bots/:id/prompts", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }

      const { prompts } = req.body;
      if (!prompts || typeof prompts !== 'object') {
        return res.status(400).json({ error: "Invalid prompts data" });
      }

      const updatedBot = await storage.updateBot(id, { 
        gptPrompts: prompts 
      });

      if (!updatedBot) {
        return res.status(404).json({ error: "Bot not found" });
      }

      // Log activity
      const user = (req as any).user;
      await storage.createActivityLog({
        userId: user.id,
        botId: id,
        action: 'prompts_updated',
        status: 'success',
        message: `Updated GPT prompts for bot: ${updatedBot.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: "Prompts updated successfully",
        prompts: updatedBot.gptPrompts
      });
    } catch (error) {
      console.error("Error updating prompts:", error);
      res.status(500).json({ error: "Failed to update prompts" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}