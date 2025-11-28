import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Handle build-time execution when DATABASE_URL is not available
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      )
    }

    const { id: materialId } = await params

    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: {
        chapters: {
          orderBy: { number: 'asc' }
        },
        concepts: {
          orderBy: { term: 'asc' }
        }
      }
    })

    if (!material) {
      return NextResponse.json(
        { error: 'Material not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(material)
  } catch (error) {
    console.error('Error fetching material:', error)
    return NextResponse.json(
      { error: 'Failed to fetch material' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Handle build-time execution when DATABASE_URL is not available
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      )
    }

    const { id: materialId } = await params

    // Get material to find file path
    const material = await prisma.material.findUnique({
      where: { id: materialId }
    })

    if (!material) {
      return NextResponse.json(
        { error: 'Material not found' },
        { status: 404 }
      )
    }

    // Delete from database (cascade will delete chapters and concepts)
    await prisma.material.delete({
      where: { id: materialId }
    })

    // Delete file from disk
    if (material.fileUrl) {
      try {
        await unlink(material.fileUrl)
        console.log(`Deleted file: ${material.fileUrl}`)
      } catch (fileError) {
        // File might not exist, log but don't fail
        console.warn(`Could not delete file: ${material.fileUrl}`, fileError)
      }
    }

    return NextResponse.json({ 
      success: true,
      message: 'Material deleted successfully' 
    })
  } catch (error) {
    console.error('Error deleting material:', error)
    return NextResponse.json(
      { error: 'Failed to delete material' },
      { status: 500 }
    )
  }
}
