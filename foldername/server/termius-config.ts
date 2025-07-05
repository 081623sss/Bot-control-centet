// Termius Server Configuration
// Update this URL when your Termius server restarts with a new Ngrok tunnel

export const TERMIUS_CONFIG = {
  // Current Termius server URL (update this when Ngrok tunnel changes)
  baseUrl: 'https://cc30-2600-3c0a-00-f03c-95ff.ngrok-free.app',
  
  // API endpoints
  endpoints: {
    botCommand: '/bot-command',
    health: '/health',
    status: '/api/status'
  },
  
  // Bot configuration
  botName: 'craigslist-scraper',
  scriptFile: 'scraper.mjs',
  
  // Connection settings
  timeout: 10000, // 10 seconds
  retries: 3
};

// Helper function to check if Termius server is online
export async function checkTermiusConnection(): Promise<{
  online: boolean;
  url: string;
  error?: string;
  responseTime?: number;
}> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${TERMIUS_CONFIG.baseUrl}${TERMIUS_CONFIG.endpoints.health}`, {
      method: 'GET',
      signal: AbortSignal.timeout(TERMIUS_CONFIG.timeout)
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      return {
        online: true,
        url: TERMIUS_CONFIG.baseUrl,
        responseTime
      };
    } else {
      return {
        online: false,
        url: TERMIUS_CONFIG.baseUrl,
        error: `HTTP ${response.status}: ${response.statusText}`,
        responseTime
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      online: false,
      url: TERMIUS_CONFIG.baseUrl,
      error: error instanceof Error ? error.message : 'Connection failed',
      responseTime
    };
  }
}

// Helper function to update Termius URL (for admin use)
export function updateTermiusUrl(newUrl: string): void {
  // In a production environment, this would update a database or config file
  // For now, it just logs the change needed
  console.log(`🔄 Termius URL needs to be updated from ${TERMIUS_CONFIG.baseUrl} to ${newUrl}`);
  console.log('📝 Please update server/termius-config.ts with the new URL');
}