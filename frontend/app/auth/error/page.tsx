import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <Card className="w-full max-w-md border-primary/15 shadow-xl">
        <CardHeader>
          <span className="flex size-10 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <AlertTriangle className="size-5" />
          </span>
          <CardTitle className="mt-3 font-serif text-2xl">
            Sign-in failed
          </CardTitle>
          <CardDescription>
            Something went wrong while signing you in. This can happen if the
            link expired or was already used. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/" />} className="w-full">
            Back to home
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
