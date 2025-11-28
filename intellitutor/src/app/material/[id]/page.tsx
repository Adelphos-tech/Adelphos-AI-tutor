'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  ArrowLeft, 
  BookOpen, 
  MessageSquare, 
  FileText, 
  Lightbulb,
  GraduationCap,
  Loader2
} from 'lucide-react'
import ChatInterface from '@/components/ChatInterface'
import VoiceTeacherRealtime from '@/components/VoiceTeacherRealtime'

interface Material {
  id: string
  title: string
  author: string | null
  pageCount: number | null
  processingStatus: string
  wholeSummary: string | null
  uploadDate: string
  chapters: Chapter[]
  concepts: Concept[]
}

interface PracticeQuestion {
  question: string
  answer?: string
  difficulty?: string
}

interface Chapter {
  id: string
  number: number
  title: string
  pageStart: number
  pageEnd: number
  summaryBrief: string | null
  summaryStandard: string | null
  summaryDetailed: string | null
  practiceQuestions: PracticeQuestion[] | null
}

interface Concept {
  id: string
  term: string
  definition: string
  category: string
  pageReferences: number[]
  chapterNumber: number | null
}

export default function MaterialPage() {
  const params = useParams()
  const materialId = params.id as string
  
  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number>(1)

  const fetchMaterial = useCallback(async () => {
    try {
      const response = await fetch(`/api/materials/${materialId}`)
      if (!response.ok) throw new Error('Failed to fetch material')
      const data: Material = await response.json()
      setMaterial(data)
    } catch (err) {
      setError('Failed to load material')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [materialId])

  useEffect(() => {
    fetchMaterial()
  }, [fetchMaterial])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600 dark:text-gray-400">Loading material...</p>
        </div>
      </div>
    )
  }

  if (error || !material) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error || 'Material not found'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/library">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Library
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentChapter = material.chapters.find(ch => ch.number === selectedChapter)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b">
        <div className="container mx-auto px-4 py-6">
          <Link href="/library">
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Library
            </Button>
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {material.title}
              </h1>
              {material.author && (
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  by {material.author}
                </p>
              )}
              <div className="flex gap-2 items-center">
                <Badge variant="default">
                  {material.processingStatus === 'READY' ? 'Ready' : 'Processing'}
                </Badge>
                {material.pageCount && (
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {material.pageCount} pages
                  </span>
                )}
                {material.chapters.length > 0 && (
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {material.chapters.length} chapters
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="summary" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto">
            <TabsTrigger value="summary" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Summary</span>
            </TabsTrigger>
            <TabsTrigger value="chapters" className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Chapters</span>
            </TabsTrigger>
            <TabsTrigger value="concepts" className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              <span className="hidden sm:inline">Concepts</span>
            </TabsTrigger>
            <TabsTrigger value="teacher" className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Teacher</span>
            </TabsTrigger>
            <TabsTrigger value="qa" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Q&A</span>
            </TabsTrigger>
          </TabsList>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Book Summary</CardTitle>
                <CardDescription>AI-generated overview of the entire textbook</CardDescription>
              </CardHeader>
              <CardContent>
                {material.wholeSummary ? (
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {material.wholeSummary}
                    </p>
                  </div>
                ) : material.processingStatus === 'ERROR' ? (
                  <div className="text-center py-8">
                    <p className="text-red-600 dark:text-red-400 mb-2">⚠️ Processing failed</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      The document was uploaded but AI processing encountered an error.
                      This might be due to API quota limits or database connection issues.
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-4"
                      onClick={() => window.location.reload()}
                    >
                      Retry Processing
                    </Button>
                  </div>
                ) : material.processingStatus === 'PROCESSING' ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
                    <p className="text-gray-500 dark:text-gray-400">
                      Summary is being generated... This may take a few minutes.
                    </p>
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">
                    No summary available yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Chapters Tab */}
          <TabsContent value="chapters" className="space-y-6">
            {material.chapters.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Chapters Available</h3>
                  <p className="text-gray-500 dark:text-gray-400 mb-4">
                    {material.processingStatus === 'ERROR' 
                      ? 'Chapter processing failed. This might be due to API limits or database issues.'
                      : material.processingStatus === 'PROCESSING'
                      ? 'Chapters are being processed. This may take a few minutes.'
                      : 'No chapters have been detected in this document yet.'}
                  </p>
                  {material.processingStatus === 'ERROR' && (
                    <Button 
                      variant="outline" 
                      onClick={() => window.location.reload()}
                    >
                      Retry Processing
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid lg:grid-cols-4 gap-6">
                {/* Chapter List */}
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="text-lg">Chapters</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="space-y-1">
                      {material.chapters.map((chapter) => (
                      <button
                        key={chapter.id}
                        onClick={() => setSelectedChapter(chapter.number)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                          selectedChapter === chapter.number
                            ? 'bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-600'
                            : ''
                        }`}
                      >
                        <div className="font-medium text-sm">Chapter {chapter.number}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                          {chapter.title}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Chapter Content */}
              <div className="lg:col-span-3 space-y-4">
                {currentChapter ? (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Chapter {currentChapter.number}: {currentChapter.title}</CardTitle>
                        <CardDescription>
                          Pages {currentChapter.pageStart} - {currentChapter.pageEnd}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* Brief Summary */}
                        {currentChapter.summaryBrief && (
                          <div>
                            <h3 className="font-semibold mb-2 flex items-center gap-2">
                              <Badge variant="outline">Brief</Badge>
                              Quick Overview
                            </h3>
                            <p className="text-gray-700 dark:text-gray-300">
                              {currentChapter.summaryBrief}
                            </p>
                          </div>
                        )}

                        <Separator />

                        {/* Standard Summary */}
                        {currentChapter.summaryStandard && (
                          <div>
                            <h3 className="font-semibold mb-2 flex items-center gap-2">
                              <Badge variant="outline">Standard</Badge>
                              Detailed Summary
                            </h3>
                            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                              {currentChapter.summaryStandard}
                            </p>
                          </div>
                        )}

                        {/* Practice Questions */}
                        {currentChapter.practiceQuestions && (
                          <>
                            <Separator />
                            <div>
                              <h3 className="font-semibold mb-4 flex items-center gap-2">
                                <GraduationCap className="w-5 h-5" />
                                Practice Questions
                              </h3>
                              <div className="space-y-4">
                                {Array.isArray(currentChapter.practiceQuestions) &&
                                  currentChapter.practiceQuestions.map((q, idx) => (
                                    <Card key={idx} className="bg-gray-50 dark:bg-gray-800">
                                      <CardContent className="pt-4">
                                        <p className="font-medium mb-2">
                                          {idx + 1}. {q.question}
                                        </p>
                                        <details className="text-sm text-gray-600 dark:text-gray-400">
                                          <summary className="cursor-pointer hover:text-gray-900 dark:hover:text-gray-200">
                                            Show Answer
                                          </summary>
                                          <p className="mt-2 pl-4 border-l-2 border-blue-500">
                                            {q.answer}
                                          </p>
                                        </details>
                                      </CardContent>
                                    </Card>
                                  ))}
                              </div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <p className="text-gray-500">Select a chapter to view its content</p>
                    </CardContent>
                  </Card>
                )}
              </div>
              </div>
            )}
          </TabsContent>

          {/* Concepts Tab */}
          <TabsContent value="concepts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Key Concepts</CardTitle>
                <CardDescription>
                  Important terms, definitions, and formulas from the textbook
                </CardDescription>
              </CardHeader>
              <CardContent>
                {material.concepts.length > 0 ? (
                  <div className="grid gap-4">
                    {material.concepts.map((concept) => (
                      <Card key={concept.id} className="bg-gray-50 dark:bg-gray-800">
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-semibold text-lg">{concept.term}</h3>
                                <Badge variant="secondary" className="text-xs">
                                  {concept.category}
                                </Badge>
                              </div>
                              <p className="text-gray-700 dark:text-gray-300 mb-2">
                                {concept.definition}
                              </p>
                              {concept.pageReferences.length > 0 && (
                                <p className="text-sm text-gray-500">
                                  Pages: {concept.pageReferences.join(', ')}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    No concepts extracted yet
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Voice Teacher Tab */}
          <TabsContent value="teacher">
            <VoiceTeacherRealtime materialId={materialId} materialTitle={material.title} />
          </TabsContent>

          {/* Q&A Tab */}
          <TabsContent value="qa">
            <ChatInterface materialId={materialId} materialTitle={material.title} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
