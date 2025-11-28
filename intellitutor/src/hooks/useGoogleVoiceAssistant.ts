'use client'

import { useState, useEffect, useRef } from 'react'
import { VOICE_LIBRARY, resolveVoice as resolveVoicePreset, type VoiceOption } from '@/lib/voice-presets'
import { createWavFile } from '@/lib/audio-utils'

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionResultEvent {
  resultIndex: number
  results: SpeechRecognitionResultLike[]
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionErrorEvent {
  error: string
}

type SpeechRecognitionWindow = Window &
  Partial<{
    SpeechRecognition: SpeechRecognitionConstructor
    webkitSpeechRecognition: SpeechRecognitionConstructor
  }>

interface UseGoogleVoiceAssistantProps {
  onTranscript?: (text: string) => void
  onError?: (error: string) => void
}

export function useGoogleVoiceAssistant({ onTranscript, onError }: UseGoogleVoiceAssistantProps = {}) {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const audioCacheRef = useRef<Map<string, { blob: Blob; timestamp: number }>>(new Map())
  const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes cache
  const isGeneratingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const listeningTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isStoppingRef = useRef(false)

  useEffect(() => {
    // Initialize Web Speech Recognition for STT (more reliable than custom audio processing)
    if (typeof window !== 'undefined') {
      const speechWindow = window as SpeechRecognitionWindow
      const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
      
      if (SpeechRecognition) {
        try {
          recognitionRef.current = new SpeechRecognition()
          recognitionRef.current.continuous = true // Keep listening for natural conversation
          recognitionRef.current.interimResults = true // Show interim results for faster feedback
          recognitionRef.current.lang = 'en-US'
          recognitionRef.current.maxAlternatives = 1

          recognitionRef.current.onresult = (event: SpeechRecognitionResultEvent) => {
            const current = event.resultIndex
            const alternative = event.results[current]?.[0]
            const transcriptText = alternative?.transcript ?? ''
            setTranscript(transcriptText)
            
            if (event.results[current].isFinal) {
              // Clear timeout since we got a result
              if (listeningTimeoutRef.current) {
                clearTimeout(listeningTimeoutRef.current)
                listeningTimeoutRef.current = null
              }
              onTranscript?.(transcriptText)
            }
          }

          recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
            setIsListening(false)
            
            // Clear timeout
            if (listeningTimeoutRef.current) {
              clearTimeout(listeningTimeoutRef.current)
              listeningTimeoutRef.current = null
            }
            
            // Handle specific errors
            if (event.error === 'no-speech') {
              // This is normal - user just hasn't spoken yet
              // Don't log or report this error
              return
            } else if (event.error === 'aborted') {
              // User stopped - this is intentional
              return
            } else {
              // Only log and report unexpected errors
              console.error('Speech recognition error:', event.error)
              onError?.(event.error)
            }
          }

          recognitionRef.current.onend = () => {
            // Clear timeout
            if (listeningTimeoutRef.current) {
              clearTimeout(listeningTimeoutRef.current)
              listeningTimeoutRef.current = null
            }
            
            setIsListening(false)
            isStoppingRef.current = false
          }
        } catch (error) {
          console.error('Failed to initialize speech recognition:', error)
        }
      }
    }

    return () => {
      // Cleanup on unmount
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {
          // Ignore errors on cleanup
        }
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = null
      }
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current)
        listeningTimeoutRef.current = null
      }
    }
  }, [onTranscript, onError])

  const startListening = async () => {
    if (!recognitionRef.current || isListening) {
      return // Prevent race conditions
    }
    
    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true })
      
      setTranscript('')
      isStoppingRef.current = false
      recognitionRef.current.start()
      setIsListening(true)
      
      // Set timeout for listening (90 seconds max for natural conversation)
      listeningTimeoutRef.current = setTimeout(() => {
        if (isListening) {
          stopListening()
          onError?.('Still listening? Say something or I\'ll take a break.')
        }
      }, 90000)
    } catch (error: unknown) {
      console.error('Microphone error:', error)
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        onError?.('Microphone permission denied. Please allow microphone access in your browser settings.')
      } else if (error instanceof Error && error.message.includes('already started')) {
        // Already listening, ignore
      } else {
        onError?.('Failed to start listening. Please try again.')
      }
    }
  }

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      try {
        isStoppingRef.current = true
        recognitionRef.current.stop()
        setIsListening(false)
      } catch {
        // Ignore errors when stopping
        setIsListening(false)
      }
      
      // Clear timeout
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current)
        listeningTimeoutRef.current = null
      }
    }
  }

  // Using shared voice library and utilities from imports

  const speak = async (text: string, options?: { voice?: string; rate?: number }) => {
    try {
      // Stop any ongoing speech first (but don't reset state yet)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      setIsSpeaking(true)
      isGeneratingRef.current = true
      
      // Create abort controller for this request
      abortControllerRef.current = new AbortController()

      const voiceMeta = resolveVoicePreset(options?.voice)
      const isGeminiVoice = voiceMeta.engine === 'gemini'

      // Create cache key
      const cacheKey = `${text}-${voiceMeta.name}-${options?.rate || 0.95}`
      
      // Check cache first
      const cached = audioCacheRef.current.get(cacheKey)
      const now = Date.now()
      
      let audioBlob: Blob
      
      if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        // Use cached audio
        audioBlob = cached.blob
      } else {
        // Generate new audio
        const payload: Record<string, unknown> = {
          text,
          voice: isGeminiVoice ? voiceMeta.name.replace('GEMINI_', '') : voiceMeta.name,
          speakingRate: options?.rate || 0.95,
          engine: voiceMeta.engine,
        }

        if (isGeminiVoice) {
          payload.style = voiceMeta.style
        }

        // Call TTS API with abort signal
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortControllerRef.current?.signal
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to generate speech')
        }

        // Play audio - handle different formats
        let audioData = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
        
        // Determine the correct MIME type
        let mimeType = data.contentType || 'audio/mpeg'
        
        // If it's Gemini voice, it returns PCM audio which needs to be wrapped as WAV
        if (isGeminiVoice && (mimeType.includes('pcm') || mimeType.includes('L16'))) {
          audioData = new Uint8Array(createWavFile(audioData))
          mimeType = 'audio/wav'
        }
        
        audioBlob = new Blob([audioData], { type: mimeType })
        
        // Cache the audio blob
        audioCacheRef.current.set(cacheKey, { blob: audioBlob, timestamp: now })
        
        // Clean old cache entries (keep cache size manageable)
        if (audioCacheRef.current.size > 20) {
          const entries = Array.from(audioCacheRef.current.entries())
          entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
          // Remove oldest 5 entries
          for (let i = 0; i < 5; i++) {
            audioCacheRef.current.delete(entries[i][0])
          }
        }
      }
      // Clean up previous audio if exists
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }
      
      const audioUrl = URL.createObjectURL(audioBlob)
      audioUrlRef.current = audioUrl
      
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      isGeneratingRef.current = false

      audio.onended = () => {
        setIsSpeaking(false)
        isGeneratingRef.current = false
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current)
          audioUrlRef.current = null
        }
        audioRef.current = null
      }

      audio.onerror = () => {
        setIsSpeaking(false)
        isGeneratingRef.current = false
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current)
          audioUrlRef.current = null
        }
        onError?.('Failed to play audio')
      }

      // Play audio and handle promise properly
      await audio.play().catch(err => {
        console.error('Audio play error:', err)
        setIsSpeaking(false)
        isGeneratingRef.current = false
        throw err
      })
    } catch (error: unknown) {
      setIsSpeaking(false)
      isGeneratingRef.current = false
      
      // Don't show error if request was aborted (user interrupted)
      // Check for both Error.name and DOMException
      if (error instanceof Error && 
          (error.name === 'AbortError' || 
           (error.message?.includes('aborted') ?? false) ||
           (error.message?.includes('signal is aborted') ?? false))) {
        return // Silent return - this is intentional interruption
      }
      
      // Only log and report actual errors
      console.error('TTS error:', error)
      const message = error instanceof Error ? error.message : 'Failed to play audio'
      onError?.(message)
    }
  }

  const stopSpeaking = () => {
    // Abort any ongoing API request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    
    // Clean up URL
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    
    setIsSpeaking(false)
    isGeneratingRef.current = false
  }

  const getAvailableVoices = () => VOICE_LIBRARY

  // Check if speech APIs are available
  const speechWindow = typeof window !== 'undefined' ? (window as SpeechRecognitionWindow) : undefined
  const isSupported = Boolean(speechWindow?.SpeechRecognition || speechWindow?.webkitSpeechRecognition)

  return {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    getAvailableVoices,
    isSupported: !!isSupported
  }
}
