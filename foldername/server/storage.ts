import { 
  users, 
  subscriptions, 
  botInstances, 
  activityLogs, 
  authSessions, 
  systemMetrics, 
  autoLeads, 
  realEstateLeads, 
  petLeads,
  type User,
  type InsertUser, 
  type Subscription,
  type InsertSubscription,
  type BotInstance, 
  type InsertBotInstance, 
  type ActivityLog, 
  type InsertActivityLog,
  type AuthSession,
  type InsertAuthSession,
  type SystemMetric,
  type InsertSystemMetric,
  type AutoLead,
  type InsertAutoLead,
  type RealEstateLead,
  type InsertRealEstateLead,
  type PetLead,
  type InsertPetLead
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;

  // Authentication
  createAuthSession(session: InsertAuthSession): Promise<AuthSession>;
  getAuthSession(token: string): Promise<AuthSession | undefined>;
  updateAuthSession(token: string, updates: Partial<InsertAuthSession>): Promise<AuthSession | undefined>;
  deleteAuthSession(token: string): Promise<boolean>;
  cleanupExpiredSessions(): Promise<void>;

  // Bot management
  getBots(): Promise<BotInstance[]>;
  getBot(id: number): Promise<BotInstance | undefined>;
  createBot(insertBot: InsertBotInstance): Promise<BotInstance>;
  updateBot(id: number, updates: Partial<InsertBotInstance>): Promise<BotInstance | undefined>;
  deleteBot(id: number): Promise<boolean>;

  // Subscription management
  getSubscriptions(): Promise<Subscription[]>;
  getSubscriptionsByUser(userId: number): Promise<Subscription[]>;
  createSubscription(insertSubscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: number, updates: Partial<InsertSubscription>): Promise<Subscription | undefined>;
  deleteSubscription(id: number): Promise<boolean>;

  // Activity logging
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;

  // System metrics
  getSystemMetrics(limit?: number): Promise<SystemMetric[]>;
  createSystemMetric(metric: InsertSystemMetric): Promise<SystemMetric>;

  // Lead management
  getAutoLeads(limit?: number): Promise<AutoLead[]>;
  createAutoLead(lead: InsertAutoLead): Promise<AutoLead>;
  getRealEstateLeads(limit?: number): Promise<RealEstateLead[]>;
  createRealEstateLead(lead: InsertRealEstateLead): Promise<RealEstateLead>;
  getPetLeads(limit?: number): Promise<PetLead[]>;
  createPetLead(lead: InsertPetLead): Promise<PetLead>;

  // Statistics
  getStats(): Promise<{
    totalBots: number;
    runningBots: number;
    totalLeads: number;
    dailyLeads: number;
    activeSubscriptions: number;
    totalCost: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // User management
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return user || undefined;
  }

  // Authentication
  async createAuthSession(session: InsertAuthSession): Promise<AuthSession> {
    const [authSession] = await db.insert(authSessions).values(session).returning();
    return authSession;
  }

  async getAuthSession(token: string): Promise<AuthSession | undefined> {
    const [session] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, token));
    return session || undefined;
  }

  async updateAuthSession(token: string, updates: Partial<InsertAuthSession>): Promise<AuthSession | undefined> {
    const [session] = await db.update(authSessions).set(updates).where(eq(authSessions.sessionToken, token)).returning();
    return session || undefined;
  }

  async deleteAuthSession(token: string): Promise<boolean> {
    const result = await db.delete(authSessions).where(eq(authSessions.sessionToken, token));
    return result.rowCount > 0;
  }

  async cleanupExpiredSessions(): Promise<void> {
    await db.delete(authSessions).where(sql`${authSessions.expiresAt} < NOW()`);
  }

  // Bot management
  async getBots(): Promise<BotInstance[]> {
    return await db.select().from(botInstances).orderBy(desc(botInstances.createdAt));
  }

  async getBot(id: number): Promise<BotInstance | undefined> {
    const [bot] = await db.select().from(botInstances).where(eq(botInstances.id, id));
    return bot || undefined;
  }

  async createBot(insertBot: InsertBotInstance): Promise<BotInstance> {
    const [bot] = await db.insert(botInstances).values(insertBot).returning();
    return bot;
  }

  async updateBot(id: number, updates: Partial<InsertBotInstance>): Promise<BotInstance | undefined> {
    const [bot] = await db.update(botInstances).set(updates).where(eq(botInstances.id, id)).returning();
    return bot || undefined;
  }

  async deleteBot(id: number): Promise<boolean> {
    const result = await db.delete(botInstances).where(eq(botInstances.id, id));
    return result.rowCount > 0;
  }

  // Subscription management
  async getSubscriptions(): Promise<Subscription[]> {
    return await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
  }

  async getSubscriptionsByUser(userId: number): Promise<Subscription[]> {
    return await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const [subscription] = await db.insert(subscriptions).values(insertSubscription).returning();
    return subscription;
  }

  async updateSubscription(id: number, updates: Partial<InsertSubscription>): Promise<Subscription | undefined> {
    const [subscription] = await db.update(subscriptions).set(updates).where(eq(subscriptions.id, id)).returning();
    return subscription || undefined;
  }

  async deleteSubscription(id: number): Promise<boolean> {
    const result = await db.delete(subscriptions).where(eq(subscriptions.id, id));
    return result.rowCount > 0;
  }

  // Activity logging
  async getActivityLogs(limit = 100): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs)
      .orderBy(desc(activityLogs.timestamp))
      .limit(limit);
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [activityLog] = await db.insert(activityLogs).values(log).returning();
    return activityLog;
  }

  // System metrics
  async getSystemMetrics(limit = 100): Promise<SystemMetric[]> {
    return await db.select().from(systemMetrics)
      .orderBy(desc(systemMetrics.timestamp))
      .limit(limit);
  }

  async createSystemMetric(metric: InsertSystemMetric): Promise<SystemMetric> {
    const [systemMetric] = await db.insert(systemMetrics).values(metric).returning();
    return systemMetric;
  }

  // Lead management
  async getAutoLeads(limit = 100): Promise<AutoLead[]> {
    return await db.select().from(autoLeads)
      .orderBy(desc(autoLeads.createdAt))
      .limit(limit);
  }

  async createAutoLead(lead: InsertAutoLead): Promise<AutoLead> {
    const [autoLead] = await db.insert(autoLeads).values(lead).returning();
    return autoLead;
  }

  async getRealEstateLeads(limit = 100): Promise<RealEstateLead[]> {
    return await db.select().from(realEstateLeads)
      .orderBy(desc(realEstateLeads.createdAt))
      .limit(limit);
  }

  async createRealEstateLead(lead: InsertRealEstateLead): Promise<RealEstateLead> {
    const [realEstateLead] = await db.insert(realEstateLeads).values(lead).returning();
    return realEstateLead;
  }

  async getPetLeads(limit = 100): Promise<PetLead[]> {
    return await db.select().from(petLeads)
      .orderBy(desc(petLeads.createdAt))
      .limit(limit);
  }

  async createPetLead(lead: InsertPetLead): Promise<PetLead> {
    const [petLead] = await db.insert(petLeads).values(lead).returning();
    return petLead;
  }

  // Statistics
  async getStats(): Promise<{
    totalBots: number;
    runningBots: number;
    totalLeads: number;
    dailyLeads: number;
    activeSubscriptions: number;
    totalCost: number;
  }> {
    const [botStats] = await db.select({
      totalBots: sql<number>`COUNT(*)`,
      runningBots: sql<number>`COUNT(CASE WHEN ${botInstances.status} = 'running' THEN 1 END)`
    }).from(botInstances);

    const [leadStats] = await db.select({
      autoLeads: sql<number>`COUNT(*)`,
    }).from(autoLeads);

    const [realEstateLeadStats] = await db.select({
      realEstateLeads: sql<number>`COUNT(*)`,
    }).from(realEstateLeads);

    const [petLeadStats] = await db.select({
      petLeads: sql<number>`COUNT(*)`,
    }).from(petLeads);

    const [dailyLeadStats] = await db.select({
      dailyAutoLeads: sql<number>`COUNT(*)`,
    }).from(autoLeads).where(sql`DATE(${autoLeads.createdAt}) = CURRENT_DATE`);

    const [subscriptionStats] = await db.select({
      activeSubscriptions: sql<number>`COUNT(CASE WHEN ${subscriptions.isActive} = true THEN 1 END)`
    }).from(subscriptions);

    const [costStats] = await db.select({
      totalCost: sql<number>`COALESCE(SUM(${systemMetrics.value}), 0)`
    }).from(systemMetrics).where(eq(systemMetrics.metric, 'cost_estimate'));

    const totalLeads = (leadStats?.autoLeads || 0) + (realEstateLeadStats?.realEstateLeads || 0) + (petLeadStats?.petLeads || 0);

    return {
      totalBots: botStats?.totalBots || 0,
      runningBots: botStats?.runningBots || 0,
      totalLeads,
      dailyLeads: dailyLeadStats?.dailyAutoLeads || 0,
      activeSubscriptions: subscriptionStats?.activeSubscriptions || 0,
      totalCost: parseFloat(costStats?.totalCost?.toString() || '0')
    };
  }
}

export const storage = new DatabaseStorage();