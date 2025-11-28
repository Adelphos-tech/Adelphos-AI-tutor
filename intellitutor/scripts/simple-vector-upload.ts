import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import { generateEmbedding } from '@/lib/gemini'
import { index } from '@/lib/pinecone'
import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'

const prisma = new PrismaClient()

// Simple chunking without memory issues
function simpleChunk(text: string, size: number = 500): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(' '))
  }
  
  return chunks
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown error'

async function main() {
  try {
    // Get one material
    const material = await prisma.material.findFirst({
      where: { 
        processingStatus: 'READY',
        id: 'cmhpvlh300001scmvblmytqbj' // The one you're viewing
      }
    })

    if (!material) {
      console.log('Material not found')
      return
    }

    console.log(`\n📚 Processing: ${material.title}`)
    
    // Read file and extract text
    let text = ''
    if (material.fileType === 'application/pdf') {
      const dataBuffer = await readFile(material.fileUrl)
      const data = await pdfParse(dataBuffer)
      text = data.text
    }
    
    console.log(`   Text length: ${text.length} characters`)
    
    // Create simple chunks
    const chunks = simpleChunk(text, 300) // Small chunks
    console.log(`   Created ${chunks.length} chunks`)
    
    // Upload in very small batches
    console.log('   Uploading to Pinecone...')
    
    if (!index) {
      console.warn('⚠️ Pinecone index not available - skipping vector upload')
      return
    }
    
    for (let i = 0; i < Math.min(chunks.length, 20); i++) { // Only first 20 chunks for testing
      try {
        const embedding = await generateEmbedding(chunks[i])
        
        await index.upsert([{
          id: `${material.id}-chunk-${i}`,
          values: embedding,
          metadata: {
            materialId: material.id,
            text: chunks[i].substring(0, 500), // Limit metadata size
            pageNumber: Math.floor(i / 3) + 1,
            chapterNumber: 0
          }
        }])
        
        console.log(`   ✅ Uploaded chunk ${i + 1}/20`)
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error: unknown) {
        console.log(`   ⚠️  Skipped chunk ${i}: ${getErrorMessage(error)}`)
      }
    }
    
    console.log('\n✅ Done! Try asking a question now.')

  } catch (error: unknown) {
    console.error('❌ Error:', getErrorMessage(error))
  } finally {
    await prisma.$disconnect()
  }
}

main()
