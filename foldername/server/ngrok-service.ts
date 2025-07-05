import { spawn, ChildProcess } from 'child_process'

interface NgrokStatus {
  connected: boolean
  publicUrl: string | null
  error: string | null
  pid: number | null
}

class NgrokService {
  private ngrokProcess: ChildProcess | null = null
  private status: NgrokStatus = {
    connected: false,
    publicUrl: null,
    error: null,
    pid: null
  }
  private connectionCheckInterval: NodeJS.Timeout | null = null
  private readonly botCommandApiKey = process.env.BOT_COMMAND_API_KEY || 'SUPER_SECRET_INTERNAL_KEY'

  constructor() {
    // Skip starting local Ngrok since external tunnel is provided
    // this.startNgrok()
    
    // Set external URL from environment
    const externalUrl = process.env.VITE_NGROK_URL
    if (externalUrl) {
      this.status.publicUrl = externalUrl
      this.status.connected = true
      console.log(`🌐 Using external Ngrok URL: ${externalUrl}`)
    }
    
    this.startConnectionMonitoring()
  }

  private async startNgrok(): Promise<void> {
    try {
      console.log('🛰️ Starting Ngrok tunnel...')
      
      // Kill any existing ngrok processes
      await this.stopNgrok()
      
      // Start ngrok process
      this.ngrokProcess = spawn('npx', ['ngrok', 'http', '5000'], {
        stdio: 'pipe',
        detached: false
      })

      this.status.pid = this.ngrokProcess.pid || null

      // Handle ngrok output
      this.ngrokProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        console.log('Ngrok stdout:', output)
        
        // Extract the forwarding URL
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.ngrok\.io/)
        if (urlMatch) {
          this.status.publicUrl = urlMatch[0]
          this.status.connected = true
          this.status.error = null
          console.log(`✅ Ngrok tunnel established: ${this.status.publicUrl}`)
        }
      })

      this.ngrokProcess.stderr?.on('data', (data) => {
        const error = data.toString()
        console.error('Ngrok stderr:', error)
        this.status.error = error
        this.status.connected = false
      })

      this.ngrokProcess.on('exit', (code) => {
        console.log(`❌ Ngrok process exited with code ${code}`)
        this.status.connected = false
        this.status.publicUrl = null
        this.status.pid = null
        
        // Skip auto-restart for external tunnels
        if (!process.env.VITE_NGROK_URL) {
          setTimeout(() => {
            if (!this.status.connected) {
              console.log('🔄 Auto-restarting Ngrok...')
              this.startNgrok()
            }
          }, 5000)
        }
      })

      // Wait for connection to establish
      setTimeout(async () => {
        if (!this.status.publicUrl) {
          // Try to get URL from ngrok API
          await this.fetchNgrokUrl()
        }
      }, 3000)

    } catch (error) {
      console.error('Failed to start Ngrok:', error)
      this.status.error = error instanceof Error ? error.message : 'Unknown error'
      this.status.connected = false
    }
  }

  private async fetchNgrokUrl(): Promise<void> {
    try {
      const response = await fetch('http://localhost:4040/api/tunnels')
      const data = await response.json() as any
      
      if (data.tunnels && data.tunnels.length > 0) {
        const httpsTunnel = data.tunnels.find((t: any) => t.public_url?.startsWith('https://'))
        if (httpsTunnel) {
          this.status.publicUrl = httpsTunnel.public_url
          this.status.connected = true
          this.status.error = null
          console.log(`✅ Ngrok URL retrieved: ${this.status.publicUrl}`)
        }
      }
    } catch (error) {
      console.error('Failed to fetch ngrok URL from API:', error)
    }
  }

  private startConnectionMonitoring(): void {
    // Skip connection monitoring for external tunnels
    if (process.env.VITE_NGROK_URL) {
      console.log('📡 Connection monitoring disabled - using external tunnel')
      return
    }
    
    this.connectionCheckInterval = setInterval(async () => {
      if (this.status.publicUrl) {
        try {
          // Test connection to bot server through ngrok
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000)
          
          const response = await fetch(`${this.status.publicUrl}/health`, {
            method: 'GET',
            signal: controller.signal
          })
          clearTimeout(timeoutId)
          
          if (response.ok) {
            this.status.connected = true
            this.status.error = null
          } else {
            this.status.connected = false
            this.status.error = `Health check failed: ${response.status}`
          }
        } catch (error) {
          this.status.connected = false
          this.status.error = error instanceof Error ? error.message : 'Connection failed'
        }
      }
    }, 10000) // Check every 10 seconds
  }

  public async stopNgrok(): Promise<void> {
    if (this.ngrokProcess) {
      this.ngrokProcess.kill('SIGTERM')
      this.ngrokProcess = null
    }
    
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval)
      this.connectionCheckInterval = null
    }

    this.status = {
      connected: false,
      publicUrl: null,
      error: null,
      pid: null
    }
  }

  public getStatus(): NgrokStatus {
    return { ...this.status }
  }

  public async sendBotCommand(command: string, botName?: string, payload?: any): Promise<any> {
    if (!this.status.connected || !this.status.publicUrl) {
      throw new Error('Ngrok tunnel not connected')
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      
      const response = await fetch(`${this.status.publicUrl}/api/ngrok/bot-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.botCommandApiKey}`
        },
        body: JSON.stringify({
          bot: botName,
          action: command,
          payload,
          timestamp: new Date().toISOString()
        }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Bot command failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      console.log(`✅ Bot command '${command}' executed successfully:`, result)
      return result

    } catch (error) {
      console.error(`❌ Bot command '${command}' failed:`, error)
      throw error
    }
  }

  public async restartNgrok(): Promise<void> {
    console.log('🔄 Restarting Ngrok tunnel...')
    await this.stopNgrok()
    await new Promise(resolve => setTimeout(resolve, 1000))
    await this.startNgrok()
  }
}

export const ngrokService = new NgrokService()