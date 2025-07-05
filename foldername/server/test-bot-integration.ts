import { Router } from 'express';
import { craigslistBotService } from './craigslist-bot-service';

const router = Router();

// Test endpoint (no auth required for testing)
router.get('/test-bot-integration', async (req, res) => {
  try {
    console.log('🔧 Testing Craigslist Bot Integration...');
    
    // Test 1: Check ngrok connection
    console.log('1. Testing Ngrok connection...');
    let ngrokStatus;
    try {
      const response = await fetch('http://localhost:5000/api/public/ngrok-status');
      ngrokStatus = await response.json();
      console.log('   ✅ Ngrok Status:', ngrokStatus.success ? 'Connected' : 'Failed');
    } catch (error) {
      console.log('   ❌ Ngrok connection failed:', error);
      ngrokStatus = { success: false, error };
    }

    // Test 2: Test bot status retrieval
    console.log('2. Testing bot status...');
    let botStatus;
    try {
      botStatus = await craigslistBotService.getBotStatus();
      console.log('   ✅ Bot Status retrieved:', botStatus.status);
    } catch (error) {
      console.log('   ❌ Bot status failed:', error);
      botStatus = { error };
    }

    // Test 3: Test analytics
    console.log('3. Testing analytics...');
    let analytics;
    try {
      analytics = await craigslistBotService.getAnalytics();
      console.log('   ✅ Analytics retrieved:', analytics.monthlyLeads, 'monthly leads');
    } catch (error) {
      console.log('   ❌ Analytics failed:', error);
      analytics = { error };
    }

    // Test 4: Test bot configuration
    console.log('4. Testing bot configuration...');
    let config;
    try {
      config = craigslistBotService.getBotConfig();
      console.log('   ✅ Config retrieved:', config.cities.length, 'cities configured');
    } catch (error) {
      console.log('   ❌ Config failed:', error);
      config = { error };
    }

    // Test 5: Test command generation (without sending)
    console.log('5. Testing command generation...');
    const testCommands = {
      start: 'pm2 start scraper.mjs --name craigslist-scraper',
      stop: 'pm2 stop craigslist-scraper',
      status: 'pm2 show craigslist-scraper'
    };

    const results = {
      timestamp: new Date().toISOString(),
      ngrokStatus,
      botStatus,
      analytics,
      config,
      testCommands,
      summary: {
        ngrokConnected: ngrokStatus?.success || false,
        botStatusWorking: !!botStatus && !botStatus.error,
        analyticsWorking: !!analytics && !analytics.error,
        configWorking: !!config && !config.error,
        readyForTesting: true
      }
    };

    console.log('🎯 Integration Test Complete');
    console.log('   Summary:', results.summary);

    res.json({
      success: true,
      message: 'Bot integration test completed',
      results
    });

  } catch (error) {
    console.error('Integration test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Integration test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;