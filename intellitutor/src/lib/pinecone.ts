import { Pinecone } from '@pinecone-database/pinecone'
import { generateLocalEmbedding, generateLocalEmbeddingsBatch, EMBEDDING_DIMENSION } from './local-embeddings'

const PINECONE_ENABLED = !!process.env.PINECONE_API_KEY

if (!PINECONE_ENABLED) {
  console.warn('⚠️ PINECONE_API_KEY not set - vector search will be disabled')
}

const pinecone = PINECONE_ENABLED ? new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
}) : null

// Use document-knowledge-base index (dimension 384, matches all-MiniLM-L6-v2)
const indexName = 'document-knowledge-base'
export const index = pinecone?.index(indexName) ?? null

// Upsert document chunks to Pinecone
export async function upsertDocumentChunks(
  materialId: string,
  chunks: Array<{
    id: string
    text: string
    pageNumber: number
    chapterNumber?: number
  }>
) {
  if (!index) {
    console.warn('Pinecone not configured - skipping vector embeddings')
    return
  }
  
  // Import prisma dynamically to avoid circular dependencies
  const { prisma } = await import('./prisma')
  
  // Step 1: Save full text chunks to database
  console.log(`💾 Saving ${chunks.length} text chunks to database...`)
  await prisma.textChunk.deleteMany({
    where: { materialId }
  })
  
  for (const chunk of chunks) {
    await prisma.textChunk.create({
      data: {
        id: chunk.id,
        materialId,
        text: chunk.text,
        pageNumber: chunk.pageNumber,
        chapterNumber: chunk.chapterNumber || 0
      }
    })
  }
  console.log(`✅ Saved ${chunks.length} text chunks to database`)
  
  // Step 2: Generate embeddings in batch for efficiency
  console.log(`🔄 Generating ${chunks.length} embeddings locally...`)
  const texts = chunks.map(c => c.text)
  const embeddings = await generateLocalEmbeddingsBatch(texts)
  console.log(`✅ Generated ${embeddings.length} embeddings (${EMBEDDING_DIMENSION}D)`)
  
  // Step 3: Store only vectors + minimal metadata in Pinecone
  const vectors = chunks.map((chunk, index) => ({
    id: chunk.id,
    values: embeddings[index],
    metadata: {
      materialId,
      pageNumber: chunk.pageNumber,
      chapterNumber: chunk.chapterNumber || 0
    }
  }))
  
  // Upsert in batches of 100
  console.log(`📤 Uploading ${vectors.length} vectors to Pinecone...`)
  const batchSize = 100
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize)
    await index.upsert(batch)
  }
  console.log(`✅ Uploaded ${vectors.length} vectors to Pinecone`)
}

// Search for relevant chunks based on query
export async function searchRelevantChunks(
  query: string,
  materialId: string,
  topK: number = 5
): Promise<Array<{
  text: string
  pageNumber: number
  score: number
}>> {
  if (!index) {
    console.warn('Pinecone not configured - returning empty results')
    return []
  }
  
  // Import prisma dynamically
  const { prisma } = await import('./prisma')
  
  // Generate embedding for the query (locally)
  const queryEmbedding = await generateLocalEmbedding(query)
  
  // Search in Pinecone (returns only IDs and scores)
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    filter: { materialId: { $eq: materialId } },
    includeMetadata: true
  })
  
  // Fetch full text from database
  const chunkIds = results.matches.map(match => match.id)
  const textChunks = await prisma.textChunk.findMany({
    where: {
      id: { in: chunkIds }
    }
  })
  
  // Create lookup map
  const textMap = new Map(textChunks.map(chunk => [chunk.id, chunk]))
  
  // Combine Pinecone results with database text
  return results.matches.map(match => ({
    text: textMap.get(match.id)?.text || '',
    pageNumber: (match.metadata?.pageNumber as number) || 0,
    score: match.score || 0
  }))
}

// Delete all vectors for a material
export async function deleteMaterialVectors(materialId: string) {
  if (!index) {
    console.warn('Pinecone not configured - skipping vector deletion')
    return
  }
  
  await index.deleteMany({
    filter: { materialId: { $eq: materialId } }
  })
}

// Chunk text into smaller segments for vectorization
// Now uses advanced recursive text splitter
export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 300  // Increased from 200 to 300 for better context retrieval
): string[] {
  // Import text splitter dynamically to avoid circular dependencies
  const { splitTextRecursive } = require('./text-splitter')
  
  const chunks = splitTextRecursive(text, {
    chunkSize,
    chunkOverlap: overlap
  })
  
  return chunks.map((chunk: { text: string }) => chunk.text)
}
