import OpenAI from "openai";
import { db } from "./db";
import { gptPrompts, activityLogs, type InsertActivityLog } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface EnrichmentResult {
  category: string;
  urgency: 'low' | 'medium' | 'high' | 'urgent';
  location: string;
  contactGuess: string;
  estimatedBudget: number;
  buyerIntent: 'browsing' | 'serious' | 'ready_to_buy';
  extractedInfo: Record<string, any>;
}

export interface OutreachMessage {
  subject: string;
  message: string;
  tone: 'professional' | 'friendly' | 'urgent';
  platform: 'sms' | 'email' | 'internal';
}

export interface AuctionOpportunityReport {
  financialBreakdown: {
    estimatedValue: number;
    maxBidThreshold: number;
    profitMargin: number;
  };
  resaleVelocity: {
    averageDaysToSell: number;
    marketDemand: 'low' | 'medium' | 'high';
    seasonalFactors: string[];
  };
  leadMatchSummary: {
    matchScore: number;
    keyMatchingFactors: string[];
    riskFactors: string[];
  };
  recommendation: 'pursue' | 'caution' | 'pass';
  reasoning: string;
}

export class GPTService {
  
  async getPrompt(vertical: string, promptType: string): Promise<string> {
    const [prompt] = await db
      .select()
      .from(gptPrompts)
      .where(
        and(
          eq(gptPrompts.vertical, vertical),
          eq(gptPrompts.promptType, promptType),
          eq(gptPrompts.isActive, true)
        )
      )
      .orderBy(gptPrompts.createdAt)
      .limit(1);
    
    return prompt?.prompt || this.getDefaultPrompt(promptType);
  }

  private getDefaultPrompt(promptType: string): string {
    const defaultPrompts = {
      enrichment: `You are a lead enrichment specialist for Super Smart Stealz, a surplus/liquidation resale platform that matches buyer demand to auction inventory for profitable arbitrage.

MISSION: Extract actionable intelligence from raw buyer demand data (Craigslist wanted ads, Facebook requests) to identify profitable arbitrage opportunities.

ANALYSIS FOCUS:
- Product specificity and quality requirements
- Budget indicators and payment capability
- Urgency signals and timeline constraints
- Geographic location and delivery preferences
- Buyer sophistication level (dealer vs consumer)
- Contact methods and response patterns

Return JSON with:
{
  "category": "Auto|RealEstate|Pets|Goods|Electronics|Industrial|Other",
  "subcategory": "specific classification",
  "urgency": "low|medium|high|urgent",
  "urgencyIndicators": ["specific signals found"],
  "location": "city, state/region",
  "locationFlexibility": "local_only|regional|national|flexible",
  "contactInfo": {
    "email": "extracted email",
    "phone": "extracted phone",
    "preferredMethod": "email|phone|text"
  },
  "budgetAnalysis": {
    "minBudget": number,
    "maxBudget": number,
    "budgetConfidence": "low|medium|high",
    "paymentCapability": "cash|financing|unknown"
  },
  "buyerProfile": {
    "buyerType": "dealer|reseller|end_consumer|commercial|flipper",
    "experienceLevel": "novice|experienced|expert",
    "intent": "browsing|serious|ready_to_buy"
  },
  "productRequirements": {
    "makeModel": "specific requirements",
    "yearRange": "acceptable years",
    "conditionRequired": "any|fair|good|excellent|new",
    "mustHaveFeatures": [],
    "dealBreakers": []
  },
  "opportunityScore": 1-100,
  "arbitrageNotes": "profit potential insights"
}`,
      
      outreach: `You are an outreach specialist for Super Smart Stealz, a surplus/liquidation platform that connects buyers with auction inventory from GSA, AllSurplus, and dealer sources.

MISSION: Create compelling outreach messages that convert leads into profitable transactions by matching their specific needs with available auction opportunities.

APPROACH:
- Reference their specific product requirements
- Highlight immediate availability and competitive pricing
- Create urgency around auction timelines and limited inventory
- Position Super Smart Stealz as insider access to wholesale/liquidation deals
- Include clear next steps and contact methods

TONE GUIDELINES:
- Professional but approachable for dealers/commercial buyers
- Informative and helpful for end consumers
- Urgent for time-sensitive auction opportunities
- Consultative for high-value prospects

AVOID:
- Generic sales language
- Overpromising specific items without inventory confirmation
- Pushy tactics that could damage long-term relationships

Generate personalized outreach based on lead profile and requirements. Return JSON with:
{
  "subject": "compelling subject line mentioning specific product/opportunity",
  "message": "personalized message body with auction value proposition",
  "tone": "professional|friendly|urgent|consultative",
  "platform": "sms|email|phone",
  "followUpStrategy": "recommended next steps",
  "keyMessages": ["value prop 1", "value prop 2", "call to action"]
}`,
      
      matching: `You are an expert analyst for Super Smart Stealz, a surplus/liquidation resale platform that matches buyer demand to auction inventory for profitable arbitrage.

MISSION: Generate comprehensive Auction Opportunity Reports (AORs) that evaluate profit potential when matching scraped buyer leads to auction listings (GSA, AllSurplus, dealer inventory).

ANALYSIS FRAMEWORK:
1. Auction Overview: Item details, source, timeline, lot information
2. Financial Breakdown: Acquisition costs, fees, total investment, resale value, profit margins
3. Resale Potential: Market analysis, optimal platforms, pricing strategy
4. Resale Velocity: Historical sell-through rates, seasonal factors, demand trends
5. Lead Match Score: Buyer-item compatibility, urgency alignment, geographic factors
6. Bidding Strategy: Recommended max bids for 25%+ profit margins
7. Risk Assessment: Market saturation, condition concerns, logistics challenges

BUSINESS REQUIREMENTS:
- Target minimum 25% profit margins
- Consider transportation/storage costs
- Factor in platform fees (eBay 10-13%, Facebook 5%, etc.)
- Account for buyer urgency and payment capability
- Assess market demand and competition

Return JSON with:
{
  "auctionOverview": {
    "auctionHouse": string,
    "lotNumber": string,
    "auctionDate": string,
    "itemDescription": string,
    "condition": string,
    "location": string
  },
  "financialBreakdown": {
    "startingBid": number,
    "estimatedAcquisitionCost": number,
    "buyersPremium": number,
    "shippingCost": number,
    "totalInvestment": number,
    "estimatedResaleValue": number,
    "grossProfitMargin": number,
    "profitPercentage": number
  },
  "resalePotential": {
    "primaryPlatforms": ["platform1", "platform2"],
    "marketValue": {"low": number, "high": number},
    "competitorAnalysis": string,
    "pricingStrategy": string
  },
  "resaleVelocity": {
    "averageDaysToSell": number,
    "marketDemand": "low|medium|high",
    "seasonalFactors": ["factor1", "factor2"],
    "velocityScore": number
  },
  "leadMatchSummary": {
    "matchScore": number,
    "buyerUrgency": string,
    "geographicAlignment": string,
    "keyMatchingFactors": ["factor1", "factor2"],
    "riskFactors": ["risk1", "risk2"]
  },
  "maxBidRecommendation": {
    "recommendedMaxBid": number,
    "conservativeMaxBid": number,
    "aggressiveMaxBid": number,
    "biddingStrategy": string
  },
  "approvalTier": "PURSUE|CAUTION|PASS",
  "reasoning": string,
  "confidenceScore": number
}`
    };

    return defaultPrompts[promptType as keyof typeof defaultPrompts] || "Analyze the provided data and return structured JSON.";
  }

  async enrichLead(rawLeadData: string, vertical: string = 'auto'): Promise<EnrichmentResult> {
    try {
      const prompt = await this.getPrompt(vertical, 'enrichment');
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Raw lead data: ${rawLeadData}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      await this.logActivity('enrichment', 'success', `Enriched lead for ${vertical}`, {
        tokensUsed: response.usage?.total_tokens || 0,
        cost: this.calculateCost(response.usage?.total_tokens || 0)
      });

      return result as EnrichmentResult;
    } catch (error: any) {
      await this.logActivity('enrichment', 'error', error.message);
      throw new Error(`Enrichment failed: ${error.message}`);
    }
  }

  async generateOutreach(leadData: any, vertical: string = 'auto'): Promise<OutreachMessage> {
    try {
      const prompt = await this.getPrompt(vertical, 'outreach');
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Lead data: ${JSON.stringify(leadData)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      await this.logActivity('outreach', 'success', `Generated outreach for ${vertical}`, {
        tokensUsed: response.usage?.total_tokens || 0,
        cost: this.calculateCost(response.usage?.total_tokens || 0)
      });

      return result as OutreachMessage;
    } catch (error: any) {
      await this.logActivity('outreach', 'error', error.message);
      throw new Error(`Outreach generation failed: ${error.message}`);
    }
  }

  async generateAOR(leadData: any, inventoryData: any, vertical: string = 'auto'): Promise<AuctionOpportunityReport> {
    try {
      const prompt = await this.getPrompt(vertical, 'matching');
      
      const context = `Lead: ${JSON.stringify(leadData)}\nInventory: ${JSON.stringify(inventoryData)}`;
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: context }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      await this.logActivity('matching', 'success', `Generated AOR for ${vertical}`, {
        tokensUsed: response.usage?.total_tokens || 0,
        cost: this.calculateCost(response.usage?.total_tokens || 0)
      });

      return result as AuctionOpportunityReport;
    } catch (error: any) {
      await this.logActivity('matching', 'error', error.message);
      throw new Error(`AOR generation failed: ${error.message}`);
    }
  }

  async generateCode(description: string, currentCode?: string): Promise<string> {
    try {
      const systemPrompt = `You are an expert JavaScript/TypeScript developer specializing in web scraping and automation. 
Generate clean, production-ready code based on the user's description. 
If current code is provided, modify it according to the instructions.
Return only the code without explanations.`;

      const userPrompt = currentCode 
        ? `Current code:\n\`\`\`\n${currentCode}\n\`\`\`\n\nModification request: ${description}`
        : `Generate code for: ${description}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2
      });

      const generatedCode = response.choices[0].message.content || '';
      
      await this.logActivity('code_generation', 'success', 'Generated code with GPT-4', {
        tokensUsed: response.usage?.total_tokens || 0,
        cost: this.calculateCost(response.usage?.total_tokens || 0)
      });

      return generatedCode;
    } catch (error: any) {
      await this.logActivity('code_generation', 'error', error.message);
      throw new Error(`Code generation failed: ${error.message}`);
    }
  }

  private calculateCost(tokens: number): number {
    // GPT-4o pricing: $5.00 / 1M input tokens, $15.00 / 1M output tokens
    // Simplified calculation assuming 50/50 split
    return (tokens * 10) / 1000000; // $10 average per 1M tokens
  }

  private async logActivity(action: string, status: string, message: string, metadata?: any): Promise<void> {
    try {
      const log: InsertActivityLog = {
        userId: 1, // Admin user
        botId: null,
        action: `gpt_${action}`,
        status,
        message,
        ipAddress: 'localhost'
      };
      
      await db.insert(activityLogs).values(log);
    } catch (error) {
      console.error('Failed to log GPT activity:', error);
    }
  }

  async updatePrompt(vertical: string, promptType: string, newPrompt: string, userId: number): Promise<void> {
    try {
      // Deactivate old prompt
      await db
        .update(gptPrompts)
        .set({ isActive: false })
        .where(
          and(
            eq(gptPrompts.vertical, vertical),
            eq(gptPrompts.promptType, promptType)
          )
        );

      // Insert new prompt
      await db.insert(gptPrompts).values({
        vertical,
        promptType,
        prompt: newPrompt,
        createdBy: userId,
        isActive: true,
        version: `v${Date.now()}`
      });

      await this.logActivity('prompt_update', 'success', `Updated ${promptType} prompt for ${vertical}`);
    } catch (error: any) {
      await this.logActivity('prompt_update', 'error', error.message);
      throw new Error(`Prompt update failed: ${error.message}`);
    }
  }
}

export const gptService = new GPTService();