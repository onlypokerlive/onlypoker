'use client'

import { useRef, useState } from 'react'
import { Camera, ImageUp, X } from 'lucide-react'
import { toast } from 'sonner'

import { PlayerAvatar } from '@/components/player-avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export type UploadedPhoto = {
  bucket: string
  path: string
  url: string
}

export function PhotoUpload({
  scope,
  currentUrl,
  name,
  size = 'xl',
  onUploaded,
  onCleared,
}: {
  scope: 'avatar' | 'guest'
  currentUrl?: string | null
  name?: string | null
  size?: 'lg' | 'xl'
  onUploaded: (photo: UploadedPhoto) => void
  onCleared?: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const libraryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('scope', scope)
      const res = await fetch('/srv/photo/upload', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? 'Upload failed.')
      }
      onUploaded({ bucket: data.bucket, path: data.path, url: data.url })
      toast.success('Photo added.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (libraryRef.current) libraryRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <PlayerAvatar src={currentUrl} name={name} size={size} />
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Spinner className="size-5" />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            // Prefer the front camera on phones for a selfie.
            capture="user"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => libraryRef.current?.click()}
          >
            <ImageUp className="size-4" />
            Upload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="size-4" />
            Take selfie
          </Button>
          {currentUrl && onCleared && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={onCleared}
            >
              <X className="size-4" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          JPG, PNG, WebP or GIF, up to 8&nbsp;MB.
        </p>
      </div>
    </div>
  )
}
