import express from "express"
import { db } from "./db"
import { 
  rawLeads,
  autoLeads, 
  goodsLeads,
  realEstateLeads, 
  hotLeads,
  users, 
  sessions,
  botInstances,
  alerts
} from "@shared/schema"
import { eq, ilike, and, or, desc, count, sql } from "drizzle-orm"
import { requireAuth } from "./auth-routes"

const router = express.Router()

// Table configuration mapping
const tableConfig: Record<string, any> = {
  raw_leads: rawLeads,
  auto_leads: autoLeads,
  goods_leads: goodsLeads,
  real_estate_leads: realEstateLeads,
  hot_leads: hotLeads,
  users: users,
  sessions: sessions,
  bot_instances: botInstances,
  alerts: alerts
}

// Role-based field restrictions
const roleRestrictions = {
  virtual_assistant: {
    editable_fields: ["contact_name", "contact_email", "contact_phone", "status"]
  }
}

/**
 * GET /api/lead-tables/:tableName
 * Fetch table data with pagination and filtering
 */
router.get("/:tableName", requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params
    const { 
      page = "1", 
      limit = "25", 
      status, 
      city, 
      search 
    } = req.query

    const table = tableConfig[tableName]
    if (!table) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const offset = (pageNum - 1) * limitNum

    // Build where conditions
    const conditions = []
    
    if (status && status !== "all" && table.status) {
      conditions.push(eq(table.status, status as string))
    }
    
    if (city && table.city) {
      conditions.push(ilike(table.city, `%${city}%`))
    }
    
    if (search) {
      const searchConditions = []
      if (table.title) {
        searchConditions.push(ilike(table.title, `%${search}%`))
      }
      if (table.description) {
        searchConditions.push(ilike(table.description, `%${search}%`))
      }
      if (table.contact_name) {
        searchConditions.push(ilike(table.contact_name, `%${search}%`))
      }
      if (table.contact_email) {
        searchConditions.push(ilike(table.contact_email, `%${search}%`))
      }
      
      if (searchConditions.length > 0) {
        conditions.push(or(...searchConditions))
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count
    const [{ totalCount }] = await db
      .select({ totalCount: count() })
      .from(table)
      .where(whereClause)

    // Get paginated data
    const data = await db
      .select()
      .from(table)
      .where(whereClause)
      .orderBy(desc(table.created_at || table.id))
      .limit(limitNum)
      .offset(offset)

    const totalPages = Math.ceil(totalCount / limitNum)

    res.json({
      success: true,
      data,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    })

  } catch (error: any) {
    console.error("Lead tables fetch error:", error)
    res.status(500).json({ 
      error: "Failed to fetch table data",
      details: error.message 
    })
  }
})

/**
 * PATCH /api/lead-tables/:tableName/:recordId
 * Update a specific record field
 */
router.patch("/:tableName/:recordId", requireAuth, async (req, res) => {
  try {
    const { tableName, recordId } = req.params
    const updateData = req.body
    const userRole = (req as any).user?.role

    const table = tableConfig[tableName]
    if (!table) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Role-based access control
    if (userRole === "virtual_assistant") {
      const allowedFields = roleRestrictions.virtual_assistant.editable_fields
      const updateFields = Object.keys(updateData)
      
      const unauthorizedFields = updateFields.filter(field => !allowedFields.includes(field))
      if (unauthorizedFields.length > 0) {
        return res.status(403).json({ 
          error: "Access denied", 
          message: `Virtual assistants can only edit: ${allowedFields.join(", ")}`,
          unauthorizedFields 
        })
      }
    }

    // Validate record exists
    const existingRecord = await db
      .select()
      .from(table)
      .where(eq(table.id, parseInt(recordId)))
      .limit(1)

    if (existingRecord.length === 0) {
      return res.status(404).json({ error: "Record not found" })
    }

    // Sanitize update data
    const sanitizedData: Record<string, any> = {}
    for (const [key, value] of Object.entries(updateData)) {
      if (table[key] !== undefined) {
        sanitizedData[key] = value
      }
    }

    if (Object.keys(sanitizedData).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" })
    }

    // Add updated timestamp if available
    if (table.updated_at) {
      sanitizedData.updated_at = new Date()
    }

    // Perform update
    const [updatedRecord] = await db
      .update(table)
      .set(sanitizedData)
      .where(eq(table.id, parseInt(recordId)))
      .returning()

    // Log the activity
    try {
      await db.insert(activityLogs).values({
        botId: null,
        action: "table_update",
        status: "success", 
        message: `Updated ${tableName} record ${recordId}`,
        ipAddress: req.ip || "unknown",
        userAgent: req.get('User-Agent') || "unknown",
        metadata: JSON.stringify({
          tableName,
          recordId,
          updatedFields: Object.keys(sanitizedData),
          userRole,
          userId: (req as any).user?.id
        })
      })
    } catch (logError) {
      console.error("Failed to log activity:", logError)
    }

    res.json({
      success: true,
      data: updatedRecord,
      message: "Record updated successfully"
    })

  } catch (error: any) {
    console.error("Lead table update error:", error)
    res.status(500).json({ 
      error: "Failed to update record",
      details: error.message 
    })
  }
})

/**
 * GET /api/lead-tables/:tableName/stats
 * Get table statistics and summary data
 */
router.get("/:tableName/stats", requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params
    const table = tableConfig[tableName]
    
    if (!table) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    const stats: any = {
      totalRecords: 0,
      statusBreakdown: {},
      recentActivity: 0
    }

    // Get total count
    const [{ totalCount }] = await db
      .select({ totalCount: count() })
      .from(table)

    stats.totalRecords = totalCount

    // Get status breakdown if status field exists
    if (table.status) {
      const statusCounts = await db
        .select({
          status: table.status,
          count: count()
        })
        .from(table)
        .groupBy(table.status)

      stats.statusBreakdown = statusCounts.reduce((acc: any, item: any) => {
        acc[item.status] = item.count
        return acc
      }, {})
    }

    // Get recent activity (last 24 hours) if created_at exists
    if (table.created_at) {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      const [{ recentCount }] = await db
        .select({ recentCount: count() })
        .from(table)
        .where(sql`${table.created_at} >= ${yesterday}`)

      stats.recentActivity = recentCount
    }

    res.json({
      success: true,
      stats
    })

  } catch (error: any) {
    console.error("Table stats error:", error)
    res.status(500).json({ 
      error: "Failed to get table statistics",
      details: error.message 
    })
  }
})

/**
 * POST /api/lead-tables/:tableName
 * Create a new record (admin only)
 */
router.post("/:tableName", requireAuth, async (req, res) => {
  try {
    const { tableName } = req.params
    const recordData = req.body
    const userRole = (req as any).user?.role

    // Only admins can create new records
    if (userRole === "virtual_assistant") {
      return res.status(403).json({ 
        error: "Access denied", 
        message: "Only administrators can create new records" 
      })
    }

    const table = tableConfig[tableName]
    if (!table) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    // Sanitize input data
    const sanitizedData: Record<string, any> = {}
    for (const [key, value] of Object.entries(recordData)) {
      if (table[key] !== undefined && key !== "id") {
        sanitizedData[key] = value
      }
    }

    // Add timestamps if available
    if (table.created_at) {
      sanitizedData.created_at = new Date()
    }
    if (table.updated_at) {
      sanitizedData.updated_at = new Date()
    }

    const [newRecord] = await db
      .insert(table)
      .values(sanitizedData)
      .returning()

    res.json({
      success: true,
      data: newRecord,
      message: "Record created successfully"
    })

  } catch (error: any) {
    console.error("Lead table create error:", error)
    res.status(500).json({ 
      error: "Failed to create record",
      details: error.message 
    })
  }
})

/**
 * DELETE /api/lead-tables/:tableName/:recordId
 * Delete a record (admin only)
 */
router.delete("/:tableName/:recordId", requireAuth, async (req, res) => {
  try {
    const { tableName, recordId } = req.params
    const userRole = (req as any).user?.role

    // Only admins can delete records
    if (userRole === "virtual_assistant") {
      return res.status(403).json({ 
        error: "Access denied", 
        message: "Only administrators can delete records" 
      })
    }

    const table = tableConfig[tableName]
    if (!table) {
      return res.status(400).json({ error: "Invalid table name" })
    }

    const [deletedRecord] = await db
      .delete(table)
      .where(eq(table.id, parseInt(recordId)))
      .returning()

    if (!deletedRecord) {
      return res.status(404).json({ error: "Record not found" })
    }

    res.json({
      success: true,
      message: "Record deleted successfully"
    })

  } catch (error: any) {
    console.error("Lead table delete error:", error)
    res.status(500).json({ 
      error: "Failed to delete record",
      details: error.message 
    })
  }
})

export default router