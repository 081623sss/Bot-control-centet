import { db } from './db';
import { botInstances, alerts, autoLeads, realEstateLeads, petLeads, systemMetrics } from '@shared/schema';

export async function seedDatabase() {
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
    return { success: true, message: 'Database seeded with sample data' };

  } catch (error) {
    console.error('Error seeding database:', error);
    return { success: false, error: error.message };
  }
}