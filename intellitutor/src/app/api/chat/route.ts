import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { searchRelevantChunks } from '@/lib/pinecone'
import { answerQuestion } from '@/lib/gemini'

type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

const isRateLimitError = (error: unknown): error is { status?: number; message?: string } => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const candidate = error as { status?: number; message?: string }
  return candidate.status === 429 || (candidate.message?.includes('429') ?? false) || (candidate.message?.includes('Too Many Requests') ?? false)
}

export async function POST(request: NextRequest) {
  try {
    // Handle build-time execution when DATABASE_URL is not available
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      )
    }

    const { materialId, question, conversationHistory } = await request.json()

    if (!materialId || !question) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate question length
    if (question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question cannot be empty' },
        { status: 400 }
      )
    }

    if (question.length > 1000) {
      return NextResponse.json(
        { error: 'Question is too long. Please keep it under 1000 characters.' },
        { status: 400 }
      )
    }

    // Verify material exists
    const material = await prisma.material.findUnique({
      where: { id: materialId }
    })

    if (!material) {
      return NextResponse.json(
        { error: 'Material not found' },
        { status: 404 }
      )
    }

    // Only block if still actively processing, allow if READY or ERROR
    if (material.processingStatus === 'PROCESSING') {
      return NextResponse.json(
        { 
          error: 'Material is still being processed',
          message: 'Your textbook is still being processed. This usually takes 2-3 minutes. Please wait and try again.',
          status: material.processingStatus
        },
        { status: 400 }
      )
    }

    // Search for relevant content in Pinecone (with error handling)
    let relevantChunks: Array<{ text: string; pageNumber: number; score: number }> = []
    try {
      relevantChunks = await searchRelevantChunks(question, materialId, 5)
    } catch (error) {
      console.warn('Pinecone search failed, using general knowledge:', error)
      // Continue without context - AI will answer from general knowledge
    }

    // If no relevant content found, still try to answer from general knowledge
    if (relevantChunks.length === 0) {
      console.warn('No relevant chunks found, answering from general knowledge')
      // Don't return error, let AI answer without specific context
    }

    // Combine relevant chunks into context
    const context = relevantChunks
      .map(chunk => `[Page ${chunk.pageNumber}] ${chunk.text}`)
      .join('\n\n')

    // Format conversation history
    const formattedHistory = (conversationHistory as ConversationMessage[] | undefined)?.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })) || []

    // Get answer from Gemini with PhD teacher persona
    const { answer, citations } = await answerQuestion(
      question,
      context,
      formattedHistory,
      true // Enable PhD teacher persona
    )

    // TODO: Save conversation to database
    // For now, we're just returning the response
    // In production, you'd want to save this to the Conversation and Message models

    return NextResponse.json({
      answer,
      citations,
      relevantPages: relevantChunks.map(c => c.pageNumber)
    })

  } catch (error: unknown) {
    console.error('Chat error:', error)
    
    if (isRateLimitError(error)) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Hmm, I need to catch my breath for a moment. Too many questions at once! Let\'s wait about 10 seconds and try again.',
          retryAfter: 10
        },
        { status: 429 }
      )
    }
    
    const message = error instanceof Error ? error.message : 'Failed to process question'
    return NextResponse.json(
      { 
        error: 'Failed to process question',
        message: 'Sorry, I had trouble processing that question. Could you try rephrasing it?',
        details: message
      },
      { status: 500 }
    )
  }
}
