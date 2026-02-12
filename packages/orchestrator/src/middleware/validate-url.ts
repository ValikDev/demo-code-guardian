import type { Request, Response, NextFunction } from 'express'

/**
 * Validate that a repo URL is a well-formed GitHub repository URL.
 * Returns `null` when valid, or an error message string when invalid.
 */
export function assertValidRepoUrl(repoUrl: unknown): string | null {
  if (!repoUrl || typeof repoUrl !== 'string') {
    return 'repoUrl is required and must be a string'
  }

  let url: URL
  try {
    url = new URL(repoUrl)
  } catch {
    return 'Invalid URL format'
  }

  if (url.protocol !== 'https:') {
    return 'Only HTTPS URLs are supported'
  }

  if (url.hostname !== 'github.com') {
    return 'Only GitHub repository URLs are supported'
  }

  // Expect at least /owner/repo in the path
  const pathParts = url.pathname.split('/').filter(Boolean)
  if (pathParts.length < 2) {
    return 'URL must point to a GitHub repository (e.g. https://github.com/owner/repo)'
  }

  return null
}

/** Express middleware that rejects requests with an invalid repoUrl body field. */
export function validateUrl(req: Request, res: Response, next: NextFunction): void {
  const { repoUrl } = req.body as Record<string, unknown>
  const error = assertValidRepoUrl(repoUrl)

  if (error) {
    res.status(400).json({ error })
    return
  }

  next()
}
