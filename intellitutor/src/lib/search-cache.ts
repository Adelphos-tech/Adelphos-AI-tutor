/**
 * Search Results Cache
 * LRU cache for document search results
 */

interface CacheEntry {
  results: any[]
  timestamp: number
}

class SearchCache {
  private cache: Map<string, CacheEntry>
  private maxSize: number
  private ttl: number // Time to live in milliseconds

  constructor(maxSize = 100, ttlMinutes = 5) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.ttl = ttlMinutes * 60 * 1000
  }

  /**
   * Generate cache key from query and materialId
   */
  private getCacheKey(query: string, materialId: string): string {
    // Use first 100 chars of query to avoid huge keys
    const queryKey = query.substring(0, 100).toLowerCase().trim()
    return `${materialId}:${queryKey}`
  }

  /**
   * Get cached results if available and not expired
   */
  get(query: string, materialId: string): any[] | null {
    const key = this.getCacheKey(query, materialId)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    console.log('💾 Using cached search results')
    return entry.results
  }

  /**
   * Store search results in cache
   */
  set(query: string, materialId: string, results: any[]): void {
    const key = this.getCacheKey(query, materialId)

    // Implement LRU: if cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      results,
      timestamp: Date.now()
    })
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    }
  }
}

// Export singleton instance
export const searchCache = new SearchCache(100, 5)
