import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, unlink, statfs } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { processDocument, detectChapters } from '@/lib/file-processor'
import { upsertDocumentChunks, chunkText } from '@/lib/pinecone'
import { generateSummary, extractKeyConcepts, generatePracticeQuestions } from '@/lib/gemini'
import { ConceptCategory } from '@/generated/prisma/client'

type NodeError = NodeJS.ErrnoException | undefined

const normalizeConceptCategory = (value?: string | null): ConceptCategory => {
  if (!value) {
    return 'OTHER'
  }

  const upperValue = value.toUpperCase()
  return (Object.values(ConceptCategory) as string[]).includes(upperValue)
    ? (upperValue as ConceptCategory)
    : 'OTHER'
}

export async function POST(request: NextRequest) {
  console.log('📤 ========== UPLOAD REQUEST RECEIVED ==========')
  try {
    // Handle build-time execution when DATABASE_URL is not available
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    console.log(`📄 File received: ${file?.name}, Size: ${file?.size} bytes`)
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    // Validate file size is not zero
    if (file.size === 0) {
      return NextResponse.json(
        { error: 'File is empty. Please upload a valid file.' },
        { status: 400 }
      )
    }
    
    // Validate filename
    if (file.name.length > 255) {
      return NextResponse.json(
        { error: 'Filename is too long. Please rename the file (max 255 characters).' },
        { status: 400 }
      )
    }
    
    // Check for invalid characters in filename
    const invalidChars = /[<>:"|?*\x00-\x1F]/
    if (invalidChars.test(file.name)) {
      return NextResponse.json(
        { error: 'Filename contains invalid characters. Please rename the file.' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',  // .doc
      'text/plain',
      'text/markdown',
      'text/html',
      'application/epub+zip'
    ]
    
    // Also check by file extension as fallback
    const allowedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.markdown', '.html', '.htm', '.epub']
    const fileExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ''
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Supported: PDF, DOCX, DOC, TXT, MD, HTML, EPUB.' },
        { status: 400 }
      )
    }

    // Validate file size (200MB)
    const maxSize = 200 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File size exceeds 200MB limit. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.` },
        { status: 413 }
      )
    }
    
    // Check disk space (need at least 2x file size for processing)
    const uploadsDir = join(process.cwd(), 'uploads')
    try {
      await mkdir(uploadsDir, { recursive: true })
      const stats = await statfs(uploadsDir)
      const availableSpace = stats.bavail * stats.bsize
      const requiredSpace = file.size * 2
      
      if (availableSpace < requiredSpace) {
        return NextResponse.json(
          { error: 'Insufficient storage space. Please try again later or contact support.' },
          { status: 507 }
        )
      }
    } catch (error) {
      console.error('Error checking disk space:', error)
      // Continue anyway - disk space check is not critical
    }

    // TODO: Replace with actual user ID from session
    const userId = 'demo-user-id'
    
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    // Check for duplicate file (with error handling)
    let existingMaterial = null
    try {
      existingMaterial = await prisma.material.findFirst({
        where: {
          userId,
          fileSize: file.size,
        }
      })
      
      if (existingMaterial && existingMaterial.fileName === file.name) {
        // Same file already uploaded
        return NextResponse.json({
          id: existingMaterial.id,
          message: 'This file has already been uploaded.',
          duplicate: true
        })
      }
    } catch (dbError) {
      console.error('Database connection error during duplicate check:', dbError)
      // Continue with upload even if duplicate check fails
    }

    // Save file to disk
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const filePath = join(uploadsDir, fileName)
    
    try {
      await writeFile(filePath, buffer)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('Error writing file:', error)
      return NextResponse.json(
        { error: `Failed to save file: ${message}` },
        { status: 500 }
      )
    }

    // Create material record in database
    let material
    try {
      material = await prisma.material.create({
        data: {
          userId,
          title: file.name.replace(/\.[^/.]+$/, ''), // Remove file extension
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileUrl: filePath,
          processingStatus: 'PROCESSING',
          categories: []
        }
      })
    } catch (error: unknown) {
      // Clean up file if database insert fails
      try {
        await unlink(filePath)
      } catch (unlinkError) {
        console.error('Error cleaning up file:', unlinkError)
      }
      
      console.error('Database error:', error)
      return NextResponse.json(
        { error: 'Failed to save material to database. Please try again.' },
        { status: 500 }
      )
    }

    // Process document asynchronously (in production, use a queue like Bull or AWS SQS)
    console.log(`🚀 Triggering async processing for material ${material.id}`)
    processDocumentAsync(material.id, filePath, file.type).catch((error) => {
      console.error('❌ ASYNC PROCESSING FAILED:', error)
      console.error('Error stack:', error instanceof Error ? error.stack : error)
    })

    return NextResponse.json({
      id: material.id,
      message: 'File uploaded successfully. Processing started.'
    })

  } catch (error: unknown) {
    console.error('Upload error:', error)
    
    // Provide specific error messages
    if ((error as NodeError)?.code === 'ENOSPC') {
      return NextResponse.json(
        { error: 'Server storage is full. Please contact support.' },
        { status: 507 }
      )
    }
    
    if ((error as NodeError)?.code === 'EACCES') {
      return NextResponse.json(
        { error: 'Server permission error. Please contact support.' },
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      { error: `Upload failed: ${(error as Error)?.message || 'Unknown error'}` },
      { status: 500 }
    )
  }
}

// Async function to process document (should be moved to a background job in production)
async function processDocumentAsync(materialId: string, filePath: string, fileType: string) {
  console.log(`📄 Starting processing for material ${materialId}`)
  try {
    // Step 1: Extract text from document
    console.log(`📝 Step 1: Extracting text from ${filePath}`)
    const processed = await processDocument(filePath, fileType)
    console.log(`✅ Text extracted: ${processed.text.length} characters, ${processed.pageCount} pages`)
    
    // Update material with page count and metadata
    await prisma.material.update({
      where: { id: materialId },
      data: {
        pageCount: processed.pageCount,
        author: processed.metadata?.author
      }
    })

    // Step 2: Detect chapters
    console.log(`📚 Step 2: Detecting chapters`)
    const chapters = detectChapters(processed.text)
    console.log(`✅ Detected ${chapters.length} chapters`)
    
    // Delete any existing chapters for this material (in case of retry)
    await prisma.chapter.deleteMany({
      where: { materialId }
    })
    await prisma.concept.deleteMany({
      where: { materialId }
    })
    
    // Step 3: Process each chapter
    console.log(`🔄 Step 3: Processing ${chapters.length} chapters`)
    let processedChapters = 0
    
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]
      console.log(`\n  📖 [${i + 1}/${chapters.length}] Processing Chapter ${chapter.number}: ${chapter.title}`)
      const chapterText = processed.text.slice(chapter.startIndex, chapter.endIndex)
      
      // Generate summaries (with error handling)
      let summaryBrief = 'Summary generation skipped due to API limits'
      let summaryStandard = 'Summary generation skipped due to API limits'
      let summaryDetailed = 'Summary generation skipped due to API limits'
      
      try {
        // Add delay to avoid rate limits (wait 2 seconds between chapters)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
        
        // Generate summaries sequentially to avoid rate limits
        summaryBrief = await generateSummary(chapterText, 'brief')
        await new Promise(resolve => setTimeout(resolve, 1000))
        summaryStandard = await generateSummary(chapterText, 'standard')
        await new Promise(resolve => setTimeout(resolve, 1000))
        summaryDetailed = await generateSummary(chapterText, 'detailed')
      } catch (error) {
        console.warn('Summary generation failed, using fallback:', error)
      }
      
      // Generate practice questions (with error handling and rate limit delay)
      let practiceQuestions: any[] = []
      try {
        await new Promise(resolve => setTimeout(resolve, 1000))
        practiceQuestions = await generatePracticeQuestions(chapterText, 5)
      } catch (error) {
        console.warn('Practice questions generation failed:', error)
      }
      
      // Save chapter to database (use upsert to handle duplicates)
      await prisma.chapter.upsert({
        where: {
          materialId_number: {
            materialId,
            number: chapter.number
          }
        },
        update: {
          title: chapter.title,
          pageStart: Math.floor(chapter.startIndex / 2000),
          pageEnd: Math.floor(chapter.endIndex / 2000),
          summaryBrief,
          summaryStandard,
          summaryDetailed,
          practiceQuestions
        },
        create: {
          materialId,
          number: chapter.number,
          title: chapter.title,
          pageStart: Math.floor(chapter.startIndex / 2000),
          pageEnd: Math.floor(chapter.endIndex / 2000),
          summaryBrief,
          summaryStandard,
          summaryDetailed,
          practiceQuestions
        }
      })
      
      // Extract key concepts (with error handling and rate limit delay)
      try {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const concepts = await extractKeyConcepts(chapterText)
        
        // Save concepts to database
        for (const concept of concepts) {
          await prisma.concept.create({
            data: {
              materialId,
              term: concept.term,
              definition: concept.definition,
              category: normalizeConceptCategory(concept.category),
              pageReferences: [],
              chapterNumber: chapter.number
            }
          })
        }
      } catch (error) {
        console.warn('Concept extraction failed:', error)
      }
      
      processedChapters++
      console.log(`  ✅ Chapter ${chapter.number} complete (${processedChapters}/${chapters.length})`)
    }
    
    console.log(`\n✅ All ${processedChapters} chapters processed successfully!`)

    // Step 4: Chunk text and create vector embeddings (with error handling)
    console.log(`🔄 Step 4: Creating vector embeddings`)
    try {
      const chunks = chunkText(processed.text, 1000, 300)
      const chunkData = chunks.map((chunk, index) => ({
        id: `${materialId}-chunk-${index}`,
        text: chunk,
        pageNumber: Math.floor(index / 2), // Rough estimate
        chapterNumber: 1 // TODO: Map to actual chapter
      }))
      
      await upsertDocumentChunks(materialId, chunkData)
      console.log(`✅ Created ${chunks.length} vector embeddings`)
    } catch (error) {
      console.warn('❌ Vector embeddings creation failed:', error)
    }

    // Step 5: Generate whole book summary (with error handling)
    console.log(`📝 Step 5: Generating whole document summary`)
    let wholeSummary = null
    try {
      await new Promise(resolve => setTimeout(resolve, 2000))
      wholeSummary = await generateSummary(processed.text.slice(0, 10000), 'detailed')
      console.log(`✅ Whole document summary generated`)
    } catch (error) {
      console.warn('❌ Whole book summary generation failed:', error)
    }
    
    // Update material status to READY
    await prisma.material.update({
      where: { id: materialId },
      data: {
        processingStatus: 'READY',
        wholeSummary
      }
    })
    
    console.log(`✅ ✅ ✅ Material ${materialId} processed successfully!`)
    console.log(`📊 Final stats: ${chapters.length} chapters, ${processed.pageCount} pages, Status: READY`)

  } catch (error: unknown) {
    console.error(`❌ ❌ ❌ Error processing material ${materialId}:`, error)
    console.error('Error details:', error instanceof Error ? error.stack : error)
    
    // Update status to ERROR
    await prisma.material.update({
      where: { id: materialId },
      data: {
        processingStatus: 'ERROR'
      }
    })
  }
}
