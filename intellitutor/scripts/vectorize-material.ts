import 'dotenv/config'
import { PrismaClient } from '@/generated/prisma/client'
import { generateEmbedding } from '@/lib/gemini'
import { index } from '@/lib/pinecone'
import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'

const prisma = new PrismaClient()

function simpleChunk(text: string, size: number = 300): string[] {
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
    // Fine_Time_Measurement material
    const materialId = 'cmhp2ey2r0003scnybwvad1gi'
    
    const material = await prisma.material.findUnique({
      where: { id: materialId }
    })

    if (!material) {
      console.log('Material not found')
      return
    }

    console.log(`\n📚 Processing: ${material.title}`)
    console.log(`📁 File: ${material.fileUrl}\n`)
    
    // Process PDF
    console.log('1️⃣ Extracting text...')
    const dataBuffer = await readFile(material.fileUrl)
    const data = await pdfParse(dataBuffer)
    
    console.log(`   ✅ Extracted ${data.text.length} characters from ${data.numpages} pages`)
    
    console.log('\n2️⃣ Creating chunks...')
    const chunks = simpleChunk(data.text, 300)
    console.log(`   ✅ Created ${chunks.length} chunks`)
    
    // Upload vectors (limit to 50 for this large document)
    console.log('\n3️⃣ Uploading to Pinecone...')
    
    if (!index) {
      console.warn('⚠️ Pinecone index not available - skipping vector upload')
      return
    }
    
    const limit = Math.min(chunks.length, 50)
    
    for (let i = 0; i < limit; i++) {
      try {
        const embedding = await generateEmbedding(chunks[i])
        
        await index.upsert([{
          id: `${materialId}-chunk-${i}`,
          values: embedding,
          metadata: {
            materialId,
            text: chunks[i].substring(0, 500),
            pageNumber: Math.floor(i / 3) + 1,
            chapterNumber: 0
          }
        }])
        
        if ((i + 1) % 5 === 0) {
          console.log(`   ✅ Uploaded ${i + 1}/${limit} chunks`)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error: unknown) {
        console.log(`   ⚠️  Skipped chunk ${i}: ${getErrorMessage(error)}`)
      }
    }
    
    console.log(`\n✅ Done! Uploaded ${limit} vectors.`)

  } catch (error: unknown) {
    console.error('❌ Error:', getErrorMessage(error))
  } finally {
    await prisma.$disconnect()
  }
}

main()
