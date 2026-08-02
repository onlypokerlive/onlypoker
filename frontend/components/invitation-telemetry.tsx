'use client'

import { useEffect } from 'react'

import { recordInvitationViewed, type PreviewStatus } from '@/lib/growth'

/** Records only the coarse invitation state; room identifiers never leave the page. */
export function InvitationTelemetry({ status }: { status: PreviewStatus }) {
  useEffect(() => recordInvitationViewed(status), [status])
  return null
}
