import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    // Handle build-time execution when DATABASE_URL is not available
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      )
    }

    // TODO: Get userId from session
    const userId = 'demo-user-id'

    const materials = await prisma.material.findMany({
      where: { userId },
      orderBy: { uploadDate: 'desc' },
      select: {
        id: true,
        title: true,
        author: true,
        uploadDate: true,
        processingStatus: true,
        pageCount: true,
        isFavorite: true,
        categories: true
      }
    })

    return NextResponse.json(materials)
  } catch (error) {
    console.error('Error fetching materials:', error)
    return NextResponse.json(
      { error: 'Failed to fetch materials' },
      { status: 500 }
    )
  }
}
