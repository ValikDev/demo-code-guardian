import type { Request, Response, NextFunction } from 'express'

export function validateUrl(req: Request, res: Response, next: NextFunction): void {
  const { repoUrl } = req.body as Record<string, unknown>

  if (!repoUrl || typeof repoUrl !== 'string') {
    res.status(400).json({ error: 'repoUrl is required and must be a string' })
    return
  }

  let url: URL
  try {
    url = new URL(repoUrl)
  } catch {
    res.status(400).json({ error: 'Invalid URL format' })
    return
  }

  if (url.hostname !== 'github.com') {
    res.status(400).json({ error: 'Only GitHub repository URLs are supported' })
    return
  }

  // Expect at least /owner/repo in the path
  const pathParts = url.pathname.split('/').filter(Boolean)
  if (pathParts.length < 2) {
    res.status(400).json({ error: 'URL must point to a GitHub repository (e.g. https://github.com/owner/repo)' })
    return
  }

  next()
}
