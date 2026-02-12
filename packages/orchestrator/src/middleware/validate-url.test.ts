import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertValidRepoUrl } from './validate-url.js'

describe('assertValidRepoUrl', () => {
  it('returns null for a valid GitHub repo URL', () => {
    assert.equal(assertValidRepoUrl('https://github.com/OWASP/NodeGoat'), null)
  })

  it('returns null for a GitHub URL with nested path', () => {
    assert.equal(assertValidRepoUrl('https://github.com/owner/repo/tree/main'), null)
  })

  it('rejects undefined', () => {
    assert.equal(typeof assertValidRepoUrl(undefined), 'string')
  })

  it('rejects null', () => {
    assert.equal(typeof assertValidRepoUrl(null), 'string')
  })

  it('rejects empty string', () => {
    assert.equal(typeof assertValidRepoUrl(''), 'string')
  })

  it('rejects non-string values', () => {
    assert.equal(typeof assertValidRepoUrl(123), 'string')
  })

  it('rejects malformed URL', () => {
    const error = assertValidRepoUrl('not-a-url')
    assert.ok(error)
    assert.match(error, /Invalid URL/)
  })

  it('rejects HTTP (non-HTTPS) URLs', () => {
    const error = assertValidRepoUrl('http://github.com/owner/repo')
    assert.ok(error)
    assert.match(error, /HTTPS/)
  })

  it('rejects non-GitHub hosts', () => {
    const error = assertValidRepoUrl('https://gitlab.com/user/repo')
    assert.ok(error)
    assert.match(error, /GitHub/)
  })

  it('rejects GitHub URL without owner/repo path', () => {
    const error = assertValidRepoUrl('https://github.com/')
    assert.ok(error)
    assert.match(error, /repository/)
  })

  it('rejects GitHub URL with only owner (no repo)', () => {
    const error = assertValidRepoUrl('https://github.com/owner')
    assert.ok(error)
    assert.match(error, /repository/)
  })

  it('rejects file:// protocol', () => {
    const error = assertValidRepoUrl('file:///etc/passwd')
    assert.ok(error)
    assert.match(error, /HTTPS/)
  })

  it('rejects internal network URLs', () => {
    const error = assertValidRepoUrl('https://internal.corp/owner/repo')
    assert.ok(error)
    assert.match(error, /GitHub/)
  })

  it('rejects URLs with embedded username', () => {
    const error = assertValidRepoUrl('https://user@github.com/owner/repo')
    assert.ok(error)
    assert.match(error, /credentials/)
  })

  it('rejects URLs with embedded username and password', () => {
    const error = assertValidRepoUrl('https://user:password@github.com/owner/repo')
    assert.ok(error)
    assert.match(error, /credentials/)
  })

  it('rejects URLs with token as username (common GitHub PAT pattern)', () => {
    const error = assertValidRepoUrl('https://ghp_abc123:x-oauth-basic@github.com/owner/repo')
    assert.ok(error)
    assert.match(error, /credentials/)
  })
})
