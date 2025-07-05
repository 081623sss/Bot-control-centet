import { WebClient } from '@slack/web-api';

export class SlackService {
  private client: WebClient | null = null;
  private channelId: string | null = null;

  constructor() {
    const token = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (token && channelId) {
      this.client = new WebClient(token);
      this.channelId = channelId;
    }
  }

  private isConfigured(): boolean {
    return this.client !== null && this.channelId !== null;
  }

  async sendBotCrashAlert(botName: string, error: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('Slack not configured - skipping crash alert');
      return false;
    }

    try {
      await this.client!.chat.postMessage({
        channel: this.channelId!,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚨 *Bot Crash Alert*`
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Bot:*\n${botName}`
              },
              {
                type: 'mrkdwn',
                text: `*Status:*\nCrashed`
              },
              {
                type: 'mrkdwn',
                text: `*Time:*\n${new Date().toLocaleString()}`
              },
              {
                type: 'mrkdwn',
                text: `*Error:*\n${error}`
              }
            ]
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Dashboard'
                },
                url: process.env.DASHBOARD_URL || 'http://localhost:5000',
                style: 'primary'
              }
            ]
          }
        ]
      });
      return true;
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
      return false;
    }
  }

  async sendBotStatusUpdate(botName: string, status: string, details?: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('Slack not configured - skipping status update');
      return false;
    }

    const statusEmoji = {
      running: '🟢',
      stopped: '🔴',
      paused: '🟡',
      crashed: '🚨',
      error: '❌'
    }[status] || '⚪';

    try {
      await this.client!.chat.postMessage({
        channel: this.channelId!,
        text: `${statusEmoji} ${botName} is now ${status}${details ? `: ${details}` : ''}`
      });
      return true;
    } catch (error) {
      console.error('Failed to send Slack status update:', error);
      return false;
    }
  }

  async sendDailyReport(stats: {
    totalBots: number;
    activeBots: number;
    totalScraped: number;
    totalErrors: number;
    gptCost: number;
  }): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('Slack not configured - skipping daily report');
      return false;
    }

    try {
      await this.client!.chat.postMessage({
        channel: this.channelId!,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📊 *Daily Bot Report - ${new Date().toLocaleDateString()}*`
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Total Bots:*\n${stats.totalBots}`
              },
              {
                type: 'mrkdwn',
                text: `*Active Bots:*\n${stats.activeBots}`
              },
              {
                type: 'mrkdwn',
                text: `*Items Scraped:*\n${stats.totalScraped.toLocaleString()}`
              },
              {
                type: 'mrkdwn',
                text: `*Errors Today:*\n${stats.totalErrors}`
              },
              {
                type: 'mrkdwn',
                text: `*GPT Cost:*\n$${stats.gptCost.toFixed(4)}`
              }
            ]
          }
        ]
      });
      return true;
    } catch (error) {
      console.error('Failed to send Slack daily report:', error);
      return false;
    }
  }

  async sendHighCostAlert(cost: number, threshold: number = 10): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('Slack not configured - skipping cost alert');
      return false;
    }

    if (cost < threshold) {
      return false; // Don't send alert if under threshold
    }

    try {
      await this.client!.chat.postMessage({
        channel: this.channelId!,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `💰 *High GPT Usage Alert*`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Daily GPT cost has reached *$${cost.toFixed(2)}*, which exceeds the threshold of $${threshold.toFixed(2)}.`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Review Usage'
                },
                url: process.env.DASHBOARD_URL || 'http://localhost:5000',
                style: 'danger'
              }
            ]
          }
        ]
      });
      return true;
    } catch (error) {
      console.error('Failed to send Slack cost alert:', error);
      return false;
    }
  }
}

export const slackService = new SlackService();