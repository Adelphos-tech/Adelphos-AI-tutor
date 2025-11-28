import mammoth from 'mammoth'
import { readFile } from 'fs/promises'

export interface ProcessedDocument {
  text: string
  pageCount: number
  metadata?: {
    title?: string
    author?: string
    subject?: string
  }
}

// Process PDF files
export async function processPDF(filePath: string): Promise<ProcessedDocument> {
  try {
    // Use pdf-parse with workaround for test file issue
    const pdfParse = require('pdf-parse/lib/pdf-parse.js')
    const dataBuffer = await readFile(filePath)
    
    const data = await pdfParse(dataBuffer)
    
    return {
      text: data.text,
      pageCount: data.numpages,
      metadata: {
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject
      }
    }
  } catch (error: unknown) {
    console.error('Error processing PDF:', error)
    console.error('File path:', filePath)
    throw new Error(`Failed to process PDF file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Process DOCX files
export async function processDOCX(filePath: string): Promise<ProcessedDocument> {
  try {
    const result = await mammoth.extractRawText({ path: filePath })
    const text = result.value
    
    // Estimate page count (roughly 500 words per page)
    const wordCount = text.split(/\s+/).length
    const pageCount = Math.ceil(wordCount / 500)
    
    return {
      text,
      pageCount,
      metadata: {}
    }
  } catch (error: unknown) {
    console.error('Error processing DOCX:', error)
    throw new Error('Failed to process DOCX file')
  }
}

// Process TXT files
export async function processTXT(filePath: string): Promise<ProcessedDocument> {
  try {
    const text = await readFile(filePath, 'utf-8')
    
    // Estimate page count
    const wordCount = text.split(/\s+/).length
    const pageCount = Math.ceil(wordCount / 500)
    
    return {
      text,
      pageCount,
      metadata: {}
    }
  } catch (error: unknown) {
    console.error('Error processing TXT:', error)
    throw new Error('Failed to process TXT file')
  }
}

// Process EPUB files (basic text extraction)
export async function processEPUB(filePath: string): Promise<ProcessedDocument> {
  // For now, we'll treat EPUB as a complex format that needs additional library
  // In production, use epub2 or similar library
  throw new Error(`EPUB processing not yet implemented for ${filePath}. Please use PDF or DOCX format.`)
}

// Main processor that routes to appropriate handler
export async function processDocument(
  filePath: string,
  fileType: string
): Promise<ProcessedDocument> {
  const type = fileType.toLowerCase()
  
  if (type === 'application/pdf' || type === 'pdf') {
    return processPDF(filePath)
  } else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || type === 'docx') {
    return processDOCX(filePath)
  } else if (type === 'text/plain' || type === 'txt') {
    return processTXT(filePath)
  } else if (type === 'application/epub+zip' || type === 'epub') {
    return processEPUB(filePath)
  } else {
    throw new Error(`Unsupported file type: ${type}`)
  }
}

// Detect chapter boundaries in text
export function detectChapters(text: string): Array<{
  number: number
  title: string
  startIndex: number
  endIndex: number
}> {
  const chapters: Array<{
    number: number
    title: string
    startIndex: number
    endIndex: number
  }> = []
  
  // Common chapter patterns
  const chapterPatterns = [
    /Chapter\s+(\d+)[:\s]+([^\n]+)/gi,
    /CHAPTER\s+(\d+)[:\s]+([^\n]+)/gi,
    /(\d+)\.\s+([A-Z][^\n]+)/g
  ]
  
  const seenNumbers = new Set<number>()
  
  for (const pattern of chapterPatterns) {
    const matches = [...text.matchAll(pattern)]
    
    if (matches.length > 0) {
      matches.forEach((match, index) => {
        const number = parseInt(match[1])
        
        // Skip duplicate chapter numbers (keep only first occurrence)
        if (seenNumbers.has(number)) {
          return
        }
        seenNumbers.add(number)
        
        const title = match[2].trim()
        const startIndex = match.index ?? 0
        const endIndex = index < matches.length - 1 
          ? (matches[index + 1].index ?? text.length)
          : text.length
        
        chapters.push({ number, title, startIndex, endIndex })
      })
      
      break // Use first pattern that finds chapters
    }
  }
  
  // If no chapters found, treat entire document as one chapter
  if (chapters.length === 0) {
    chapters.push({
      number: 1,
      title: 'Full Document',
      startIndex: 0,
      endIndex: text.length
    })
  }
  
  return chapters
}
