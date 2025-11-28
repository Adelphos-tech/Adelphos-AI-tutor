import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import { processDocument } from '@/lib/file-processor'
import { chunkText } from '@/lib/pinecone'
import { generateEmbedding } from '@/lib/gemini'
import { index } from '@/lib/pinecone'

const prisma = new PrismaClient()

type VectorRecord = {
  id: string
  values: number[]
  metadata: {
    materialId: string
    text: string
    pageNumber: number
    chapterNumber: number
  }
}

async function uploadMaterial(materialId: string, title: string, fileUrl: string, fileType: string) {
  console.log(`\n🔄 Processing: ${title}`)
  
  if (!index) {
    console.warn('⚠️ Pinecone index not available - skipping vector upload')
    return
  }
  
  // Get the document text
  const { text } = await processDocument(fileUrl, fileType)
  
  // Chunk the text
  const textChunks = chunkText(text, 800, 100) // Smaller chunks
  console.log(`   Created ${textChunks.length} chunks`)
  
  // Process in small batches to avoid memory issues
  const batchSize = 5
  let processed = 0
  
  for (let i = 0; i < textChunks.length; i += batchSize) {
    const batch = textChunks.slice(i, i + batchSize)
    
    const vectors: VectorRecord[] = []
    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j]
      const chunkIndex = i + j
      
      try {
        const embedding = await generateEmbedding(chunk)
        vectors.push({
          id: `${materialId}-chunk-${chunkIndex}`,
          values: embedding,
          metadata: {
            materialId,
            text: chunk,
            pageNumber: Math.floor(chunkIndex / 3) + 1,
            chapterNumber: 0
          }
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.log(`   ⚠️  Skipped chunk ${chunkIndex}: ${message}`)
      }
    }
    
    if (vectors.length > 0) {
      await index.upsert(vectors)
      processed += vectors.length
      console.log(`   Progress: ${processed}/${textChunks.length} chunks`)
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log(`   ✅ Success! Uploaded ${processed} vectors`)
}

async function main() {
  try {
    const materials = await prisma.material.findMany({
      where: { processingStatus: 'READY' },
      take: 1 // Process one at a time
    })

    console.log(`\n📚 Found ${materials.length} material(s) to vectorize\n`)

    for (const material of materials) {
      try {
        await uploadMaterial(material.id, material.title, material.fileUrl, material.fileType)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.log(`   ❌ Failed: ${message}`)
      }
    }

    console.log('\n🎉 Done! Run again to process more materials.')

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('❌ Error:', message)
  } finally {
    await prisma.$disconnect()
  }
}

main()
