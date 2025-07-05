import { Router } from 'express'
import { ngrokService } from './ngrok-service'
import { requireAuth } from './auth-routes'

const router = Router()

// Temporary: Skip authentication for testing ngrok functionality
// router.use(requireAuth)

/**
 * GET /api/ngrok/status
 * Get current ngrok tunnel status
 */
router.get('/status', (req, res) => {
  try {
    const status = ngrokService.getStatus()
    res.json({
      success: true,
      status
    })
  } catch (error) {
    console.error('Error getting ngrok status:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to get ngrok status',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * POST /api/ngrok/restart
 * Restart the ngrok tunnel
 */
router.post('/restart', async (req, res) => {
  try {
    await ngrokService.restartNgrok()
    res.json({
      success: true,
      message: 'Ngrok tunnel restart initiated'
    })
  } catch (error) {
    console.error('Error restarting ngrok:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to restart ngrok tunnel',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * POST /api/ngrok/bot-command
 * Send command to bot server through ngrok tunnel
 */
router.post('/bot-command', async (req, res) => {
  try {
    // Handle both frontend format {"bot":"name","action":"command"} and backend format {"command":"cmd","botName":"name"}
    let { command, botName, payload, bot, action } = req.body
    
    // Convert frontend format to backend format
    if (bot && action && !command) {
      command = action
      botName = bot
    }

    if (!command) {
      return res.status(400).json({
        success: false,
        message: 'Command or action is required'
      })
    }

    const result = await ngrokService.sendBotCommand(command, botName, payload)
    
    res.json({
      success: true,
      message: `Bot command '${command}' executed successfully`,
      result
    })

  } catch (error) {
    console.error('Error executing bot command:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to execute bot command',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * GET /api/ngrok/tunnels
 * Get all active ngrok tunnels
 */
router.get('/tunnels', async (req, res) => {
  try {
    const response = await fetch('http://localhost:4040/api/tunnels')
    const data = await response.json()
    
    res.json({
      success: true,
      tunnels: data.tunnels || []
    })
  } catch (error) {
    console.error('Error fetching ngrok tunnels:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ngrok tunnels',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router