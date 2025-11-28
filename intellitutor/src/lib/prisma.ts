import { PrismaClient } from '@/generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Create Prisma client with conditional configuration
const createPrismaClient = () => {
  // During build time, DATABASE_URL might not be available
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/placeholder'
  
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: databaseUrl
      }
    },
    // Connection pooling configuration
    // @ts-expect-error Prisma doesn't expose __internal types but accepts them at runtime
    __internal: {
      engine: {
        connection_limit: 10,
        pool_timeout: 30,
      }
    }
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Handle connection errors gracefully with retry logic
let connectionAttempts = 0
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

type PrismaConnectionError = Error & { code?: string }

async function connectWithRetry() {
  // Skip connection during build time
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    console.log('⏭️ Skipping database connection during build time')
    return
  }
  
  try {
    await prisma.$connect()
    console.log('✅ Database connected successfully')
    connectionAttempts = 0
  } catch (err: unknown) {
    connectionAttempts++
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`❌ Failed to connect to database (attempt ${connectionAttempts}/${MAX_RETRIES}):`, message)
    
    if (connectionAttempts < MAX_RETRIES) {
      console.log(`⏳ Retrying in ${RETRY_DELAY/1000} seconds...`)
      setTimeout(connectWithRetry, RETRY_DELAY)
    } else {
      console.error('💀 Max connection attempts reached. Database unavailable.')
    }
  }
}

// Only attempt connection if not in build mode
if (typeof window === 'undefined' && process.env.DATABASE_URL) {
  connectWithRetry()
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
  console.log('Database disconnected')
})

// Helper function to execute queries with error handling
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof Error) {
        lastError = error
      }
      
      const code = (error as PrismaConnectionError)?.code
      const message = (error as PrismaConnectionError)?.message || ''
      const retryable = 
        code === 'P1001' || // Can't reach database
        code === 'P1002' || // Database timeout
        code === 'P1008' || // Operations timed out
        code === 'P1017' || // Server closed connection
        message.includes('ECONNREFUSED') ||
        message.includes('ETIMEDOUT')
      
      if (!retryable || attempt === maxRetries) {
        break
      }
      
      // Wait before retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
      console.log(`Retrying database operation in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError ?? new Error('Unknown database error')
}

// Helper function to check database health
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (error: unknown) {
    console.error('Database health check failed:', error)
    return false
  }
}
