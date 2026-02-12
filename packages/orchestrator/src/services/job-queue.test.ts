import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createJobQueue, type Job } from './job-queue.js'

describe('createJobQueue', () => {
  const makeJob = (id: string): Job => ({ scanId: id, repoUrl: `https://github.com/test/${id}` })

  describe('enqueue', () => {
    it('returns true when queue has capacity', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      assert.equal(queue.enqueue(makeJob('1')), true)
    })

    it('returns false when queue is full', () => {
      const queue = createJobQueue({ maxQueued: 2, maxConcurrent: 0 })
      assert.equal(queue.enqueue(makeJob('1')), true)
      assert.equal(queue.enqueue(makeJob('2')), true)
      assert.equal(queue.enqueue(makeJob('3')), false)
    })

    it('increments pending count', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 0 })
      assert.equal(queue.pending, 0)
      queue.enqueue(makeJob('1'))
      assert.equal(queue.pending, 1)
      queue.enqueue(makeJob('2'))
      assert.equal(queue.pending, 2)
    })
  })

  describe('processor', () => {
    it('calls processor immediately when capacity is available', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      const processed: Job[] = []
      queue.setProcessor((job) => processed.push(job))

      queue.enqueue(makeJob('1'))
      assert.equal(processed.length, 1)
      assert.equal(processed[0].scanId, '1')
    })

    it('does not call processor when at max concurrent', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      const processed: Job[] = []
      queue.setProcessor((job) => processed.push(job))

      queue.enqueue(makeJob('1'))
      queue.enqueue(makeJob('2'))

      // Only first job processed, second stays pending
      assert.equal(processed.length, 1)
      assert.equal(queue.pending, 1)
      assert.equal(queue.active, 1)
    })

    it('processes pending jobs after onJobComplete', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      const processed: Job[] = []
      queue.setProcessor((job) => processed.push(job))

      queue.enqueue(makeJob('1'))
      queue.enqueue(makeJob('2'))
      assert.equal(processed.length, 1)

      queue.onJobComplete()
      assert.equal(processed.length, 2)
      assert.equal(processed[1].scanId, '2')
    })

    it('processes queued jobs when processor is set after enqueue', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      queue.enqueue(makeJob('1'))
      assert.equal(queue.pending, 1)

      const processed: Job[] = []
      queue.setProcessor((job) => processed.push(job))
      assert.equal(processed.length, 1)
      assert.equal(queue.pending, 0)
    })
  })

  describe('isFull', () => {
    it('returns false when queue has capacity', () => {
      const queue = createJobQueue({ maxQueued: 2, maxConcurrent: 0 })
      assert.equal(queue.isFull, false)
    })

    it('returns true when queue is at capacity', () => {
      const queue = createJobQueue({ maxQueued: 2, maxConcurrent: 0 })
      queue.enqueue(makeJob('1'))
      queue.enqueue(makeJob('2'))
      assert.equal(queue.isFull, true)
    })
  })

  describe('concurrency', () => {
    it('respects maxConcurrent limit', () => {
      const queue = createJobQueue({ maxQueued: 10, maxConcurrent: 2 })
      const processed: Job[] = []
      queue.setProcessor((job) => processed.push(job))

      queue.enqueue(makeJob('1'))
      queue.enqueue(makeJob('2'))
      queue.enqueue(makeJob('3'))

      assert.equal(processed.length, 2)
      assert.equal(queue.active, 2)
      assert.equal(queue.pending, 1)
    })

    it('active count never goes below zero', () => {
      const queue = createJobQueue({ maxQueued: 5, maxConcurrent: 1 })
      queue.onJobComplete()
      queue.onJobComplete()
      assert.equal(queue.active, 0)
    })
  })
})
